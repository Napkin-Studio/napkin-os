// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The dogfood build's record of everything a person does.
//!
//! On only with `NAPKIN_DOGFOOD=1` (staging; features/dogfood-telemetry.clan).
//! Everything an account does after it has acknowledged the notice is kept:
//! the shell's clicks, navigation and feedback (`POST /api/dogfood/events`),
//! and every request it sends, `/api/…` and the app frames' `clan://` calls,
//! with the body. The owner chose full content (2026-10-05): the build is for
//! testing, not client work. A body is capped per event (`truncated`, `size`).
//!
//! One JSON object per line, in `<root>/<yyyy-mm-dd>/<agency>/<user>.jsonl`.
//! Writing is a background thread behind a bounded queue: a request never
//! waits on it, and when the queue is full the event is dropped and counted.
//! Nothing expires: the whole record is kept until `purge`, run once when the
//! dogfood ends (`POST /api/dogfood/purge`, or `napkin-web dogfood-purge`).
//! Only Napkin's own accounts (agency `napkin`) read or purge it.

use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use axum::body::{to_bytes, Body, Bytes};
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::auth::Account;
use crate::state::AppCtx;

/// The agency whose people may read and purge the record.
pub const READERS: &str = "napkin";
/// A request body is kept up to this many bytes unless `NAPKIN_DOGFOOD_BODY_CAP` says otherwise.
pub const DEFAULT_BODY_CAP: usize = 64 * 1024;
/// Events waiting to be written. A burst bigger than this is dropped, not waited for.
const QUEUE: usize = 4096;
/// Events one shell batch may carry.
const BATCH_MAX: usize = 500;

/// One line of the record.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub ts: String,
    pub account: String,
    pub agency: String,
    /// `click`, `nav`, `feedback`, `request`, `consent`, …
    pub kind: String,
    /// What it was: the element, the screen, the route.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(default)]
    pub data: Value,
}

impl Event {
    pub fn now(account: &Account, kind: &str, name: &str) -> Self {
        Self {
            ts: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            account: account.username.clone(),
            agency: account.agency.clone(),
            kind: kind.into(),
            name: name.into(),
            doc: None,
            app: None,
            data: Value::Null,
        }
    }

    /// `<date>/<agency>/<user>.jsonl`: the agency and user come from a parsed
    /// account (letters, digits, `._-`), so the path cannot leave the root.
    fn file(&self, root: &Path) -> PathBuf {
        let date = self.ts.get(..10).unwrap_or("undated");
        let user = self.account.split('@').next().unwrap_or("unknown");
        root.join(date)
            .join(&self.agency)
            .join(format!("{user}.jsonl"))
    }
}

/// A body as the record keeps it: text when it is text, else base64; cut at
/// `cap` bytes, saying so.
pub fn body_value(bytes: &[u8], cap: usize) -> Value {
    let size = bytes.len();
    let kept = &bytes[..size.min(cap)];
    let truncated = size > cap;
    match std::str::from_utf8(kept) {
        Ok(text) => {
            serde_json::json!({ "size": size, "truncated": truncated, "text": text })
        }
        // a cut can split a character: keep the valid prefix as text
        Err(e) if e.error_len().is_none() => serde_json::json!({
            "size": size, "truncated": truncated,
            "text": std::str::from_utf8(&kept[..e.valid_up_to()]).unwrap_or_default(),
        }),
        Err(_) => {
            serde_json::json!({ "size": size, "truncated": truncated, "base64": B64.encode(kept) })
        }
    }
}

enum Msg {
    Write(Box<Event>),
    /// Answered once everything queued before it is on disk.
    Flush(SyncSender<()>),
    /// Remove the whole record; answered with how many files went.
    Purge(SyncSender<usize>),
}

pub struct Dogfood {
    root: PathBuf,
    pub body_cap: usize,
    tx: SyncSender<Msg>,
    dropped: AtomicU64,
    /// Accounts that have acknowledged the notice, and when (`consent.json`).
    consent: Mutex<BTreeMap<String, String>>,
}

impl Dogfood {
    /// Start the writer for a record kept under `root`.
    pub fn start(root: PathBuf, body_cap: usize) -> Arc<Self> {
        let (tx, rx) = sync_channel(QUEUE);
        let writer_root = root.clone();
        std::thread::Builder::new()
            .name("dogfood-writer".into())
            .spawn(move || write_loop(&writer_root, rx))
            .expect("cannot start the dogfood writer");
        let consent = std::fs::read(root.join("consent.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Arc::new(Self {
            root,
            body_cap,
            tx,
            dropped: AtomicU64::new(0),
            consent: Mutex::new(consent),
        })
    }

    /// Queue an event. Never waits: a full queue drops it and counts the drop.
    pub fn record(&self, event: Event) {
        match self.tx.try_send(Msg::Write(Box::new(event))) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                let n = self.dropped.fetch_add(1, Ordering::Relaxed) + 1;
                if n.is_power_of_two() {
                    tracing::warn!(dropped = n, "dogfood: events dropped (queue full)");
                }
            }
        }
    }

    pub fn dropped(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }

    pub fn consented(&self, account: &str) -> bool {
        self.consent.lock().unwrap().contains_key(account)
    }

    /// The account has read the notice. Kept with the record, so a purge
    /// shows the notice again.
    pub fn consent(&self, account: &Account) -> std::io::Result<()> {
        let mut c = self.consent.lock().unwrap();
        let event = Event::now(account, "consent", "dogfood notice acknowledged");
        c.insert(account.username.clone(), event.ts.clone());
        std::fs::create_dir_all(&self.root)?;
        let tmp = self.root.join("consent.json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&*c)?)?;
        std::fs::rename(tmp, self.root.join("consent.json"))?;
        drop(c);
        self.record(event);
        Ok(())
    }

    /// Wait until everything queued so far is written. Blocking: call it off
    /// the async runtime.
    pub fn flush(&self) {
        let (tx, rx) = sync_channel(0);
        if self.tx.send(Msg::Flush(tx)).is_ok() {
            let _ = rx.recv();
        }
    }

    /// Every line, oldest day first, optionally only one day / agency / user.
    pub fn export(&self, date: Option<&str>, agency: Option<&str>, user: Option<&str>) -> String {
        self.flush();
        let mut out = String::new();
        for day in sorted_dirs(&self.root) {
            let d = day.file_name().unwrap_or_default().to_string_lossy();
            if date.is_some_and(|want| want != d) {
                continue;
            }
            for ag in sorted_dirs(&day) {
                let a = ag.file_name().unwrap_or_default().to_string_lossy();
                if agency.is_some_and(|want| want != a) {
                    continue;
                }
                let mut files: Vec<PathBuf> = std::fs::read_dir(&ag)
                    .map(|r| r.flatten().map(|e| e.path()).collect())
                    .unwrap_or_default();
                files.sort();
                for f in files {
                    let stem = f.file_stem().unwrap_or_default().to_string_lossy();
                    if user.is_some_and(|want| want != stem) {
                        continue;
                    }
                    if let Ok(text) = std::fs::read_to_string(&f) {
                        out.push_str(&text);
                    }
                }
            }
        }
        out
    }

    /// Delete the whole record, consent included. Blocking: call it off the
    /// async runtime. Returns how many files went.
    pub fn purge(&self) -> usize {
        let (tx, rx) = sync_channel(0);
        let removed = if self.tx.send(Msg::Purge(tx)).is_ok() {
            rx.recv().unwrap_or(0)
        } else {
            0
        };
        self.consent.lock().unwrap().clear();
        removed
    }
}

fn sorted_dirs(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|r| {
            r.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// Remove `root` and everything in it; how many files it held.
pub fn purge_dir(root: &Path) -> usize {
    fn count(p: &Path) -> usize {
        std::fs::read_dir(p)
            .map(|r| {
                r.flatten()
                    .map(|e| {
                        let p = e.path();
                        if p.is_dir() {
                            count(&p)
                        } else {
                            1
                        }
                    })
                    .sum()
            })
            .unwrap_or(0)
    }
    let n = count(root);
    let _ = std::fs::remove_dir_all(root);
    n
}

fn write_loop(root: &Path, rx: Receiver<Msg>) {
    for msg in rx {
        match msg {
            Msg::Write(e) => {
                let path = e.file(root);
                let line = match serde_json::to_string(&*e) {
                    Ok(l) => l,
                    Err(_) => continue,
                };
                let ok = path
                    .parent()
                    .map(|d| std::fs::create_dir_all(d).is_ok())
                    .unwrap_or(false)
                    && std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&path)
                        .and_then(|mut f| writeln!(f, "{line}"))
                        .is_ok();
                if !ok {
                    tracing::warn!(file = %path.display(), "dogfood: an event could not be written");
                }
            }
            Msg::Flush(done) => {
                let _ = done.send(());
            }
            Msg::Purge(done) => {
                let _ = done.send(purge_dir(root));
            }
        }
    }
}

// ── capture ─────────────────────────────────────────────────────────────────

/// The account a request records as, when the build records and it has agreed.
fn recording<'a>(ctx: &'a AppCtx, account: Option<&Account>) -> Option<(&'a Dogfood, Account)> {
    let d = ctx.dogfood.as_deref()?;
    let a = account?;
    d.consented(&a.username).then(|| (d, a.clone()))
}

/// Every `/api` request a consenting account sends, with its body. Signing in
/// is left out (no account yet) and so are the dogfood routes themselves.
pub async fn capture_api(State(ctx): State<Arc<AppCtx>>, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let account = request.extensions().get::<Account>().cloned();
    let Some((dog, account)) = recording(&ctx, account.as_ref())
        .filter(|_| !path.starts_with("/dogfood/") && !path.starts_with("/auth/"))
    else {
        return next.run(request).await;
    };
    let method = request.method().to_string();
    let query = request.uri().query().unwrap_or_default().to_string();
    let (parts, body) = request.into_parts();
    let bytes = match to_bytes(body, crate::UPLOAD_MAX).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::PAYLOAD_TOO_LARGE, "request body too large").into_response(),
    };
    let data = serde_json::json!({
        "method": method,
        "query": query,
        "body": body_value(&bytes, dog.body_cap),
    });
    let start = Instant::now();
    let response = next
        .run(Request::from_parts(parts, Body::from(bytes)))
        .await;
    let mut e = Event::now(&account, "request", &format!("/api{path}"));
    e.data = with_outcome(data, response.status(), start);
    dog.record(e);
    response
}

/// One `clan://` call an app frame made (from `sandbox::dispatch`).
pub struct SandboxCall<'a> {
    /// The grant's person: `user@agency` with accounts.
    pub person: &'a str,
    pub doc: &'a str,
    pub app: Option<String>,
    pub path: &'a str,
    pub method: &'a str,
    pub body: &'a Bytes,
    pub status: StatusCode,
    pub start: Instant,
}

/// Record one `clan://` call, with its body.
pub fn capture_sandbox(ctx: &AppCtx, call: SandboxCall<'_>) {
    let SandboxCall {
        person,
        doc,
        app,
        path,
        method,
        body,
        status,
        start,
    } = call;
    let Some((user, agency)) = Account::parse_username(person) else {
        return; // an anonymous tenant: nobody to record
    };
    let account = Account {
        username: user,
        agency,
        name: None,
    };
    let Some((dog, account)) = recording(ctx, Some(&account)) else {
        return;
    };
    let mut e = Event::now(&account, "request", &format!("clan:/{path}"));
    e.doc = Some(doc.to_string());
    e.app = app;
    e.data = with_outcome(
        serde_json::json!({ "method": method, "body": body_value(body, dog.body_cap) }),
        status,
        start,
    );
    dog.record(e);
}

fn with_outcome(mut data: Value, status: StatusCode, start: Instant) -> Value {
    data["status"] = status.as_u16().into();
    data["ms"] = (start.elapsed().as_millis() as u64).into();
    data
}

// ── routes ──────────────────────────────────────────────────────────────────

fn off() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({ "ok": false, "error": "not a dogfood build" })),
    )
        .into_response()
}

fn deny(status: StatusCode, msg: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "ok": false, "error": msg })),
    )
        .into_response()
}

/// What the shell sends: events without the account, which the session says.
#[derive(Deserialize)]
pub struct Batch {
    events: Vec<ShellEvent>,
}

#[derive(Deserialize)]
struct ShellEvent {
    kind: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    doc: Option<String>,
    #[serde(default)]
    app: Option<String>,
    #[serde(default)]
    data: Value,
    /// When the browser saw it; the line's own `ts` is the server's.
    #[serde(default)]
    at: Option<String>,
}

pub async fn post_events(
    State(ctx): State<Arc<AppCtx>>,
    account: Option<Extension<Account>>,
    Json(batch): Json<Batch>,
) -> Response {
    let Some(dog) = ctx.dogfood.as_deref() else {
        return off();
    };
    let Some(Extension(account)) = account else {
        return deny(StatusCode::UNAUTHORIZED, "sign in");
    };
    if !dog.consented(&account.username) {
        return deny(
            StatusCode::FORBIDDEN,
            "the dogfood notice has not been acknowledged",
        );
    }
    let n = batch.events.len().min(BATCH_MAX);
    for s in batch.events.into_iter().take(BATCH_MAX) {
        let mut e = Event::now(&account, &s.kind, &s.name);
        e.doc = s.doc;
        e.app = s.app;
        // a shell event's data is capped like a body: it can carry what was typed
        let raw = serde_json::to_vec(&s.data).unwrap_or_default();
        e.data = if raw.len() > dog.body_cap {
            serde_json::json!({ "capped": body_value(&raw, dog.body_cap) })
        } else {
            s.data
        };
        if let Some(at) = s.at {
            if let Value::Object(m) = &mut e.data {
                m.insert("at".into(), at.into());
            } else {
                e.data = serde_json::json!({ "value": e.data, "at": at });
            }
        }
        dog.record(e);
    }
    Json(serde_json::json!({ "ok": true, "recorded": n })).into_response()
}

pub async fn post_consent(
    State(ctx): State<Arc<AppCtx>>,
    account: Option<Extension<Account>>,
) -> Response {
    let Some(dog) = ctx.dogfood.clone() else {
        return off();
    };
    let Some(Extension(account)) = account else {
        return deny(StatusCode::UNAUTHORIZED, "sign in");
    };
    match tokio::task::spawn_blocking(move || dog.consent(&account)).await {
        Ok(Ok(())) => Json(serde_json::json!({ "ok": true })).into_response(),
        _ => deny(
            StatusCode::INTERNAL_SERVER_ERROR,
            "the acknowledgement could not be saved",
        ),
    }
}

#[derive(Deserialize)]
pub struct ExportQuery {
    date: Option<String>,
    agency: Option<String>,
    user: Option<String>,
}

fn reader(
    ctx: &AppCtx,
    account: Option<Extension<Account>>,
) -> Result<Arc<Dogfood>, Box<Response>> {
    let Some(dog) = ctx.dogfood.clone() else {
        return Err(Box::new(off()));
    };
    match account {
        Some(Extension(a)) if a.agency == READERS => Ok(dog),
        Some(_) => Err(Box::new(deny(
            StatusCode::FORBIDDEN,
            "only Napkin's own accounts read the dogfood record",
        ))),
        None => Err(Box::new(deny(StatusCode::UNAUTHORIZED, "sign in"))),
    }
}

pub async fn get_export(
    State(ctx): State<Arc<AppCtx>>,
    account: Option<Extension<Account>>,
    axum::extract::Query(q): axum::extract::Query<ExportQuery>,
) -> Response {
    let dog = match reader(&ctx, account) {
        Ok(d) => d,
        Err(r) => return *r,
    };
    let text = tokio::task::spawn_blocking(move || {
        dog.export(q.date.as_deref(), q.agency.as_deref(), q.user.as_deref())
    })
    .await
    .unwrap_or_default();
    (
        [(axum::http::header::CONTENT_TYPE, "application/x-ndjson")],
        text,
    )
        .into_response()
}

pub async fn post_purge(
    State(ctx): State<Arc<AppCtx>>,
    account: Option<Extension<Account>>,
) -> Response {
    let dog = match reader(&ctx, account.clone()) {
        Ok(d) => d,
        Err(r) => return *r,
    };
    let who = account.map(|Extension(a)| a.username).unwrap_or_default();
    let removed = tokio::task::spawn_blocking(move || dog.purge())
        .await
        .unwrap_or(0);
    tracing::warn!(by = %who, files = removed, "dogfood record purged");
    Json(serde_json::json!({ "ok": true, "removed_files": removed })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn me() -> Account {
        Account {
            username: "engineer@napkin".into(),
            agency: "napkin".into(),
            name: None,
        }
    }

    #[test]
    fn a_body_is_kept_whole_under_the_cap_and_cut_over_it() {
        assert_eq!(
            body_value(b"{\"a\":1}", 64),
            serde_json::json!({"size": 7, "truncated": false, "text": "{\"a\":1}"})
        );
        let v = body_value(&[b'x'; 100], 10);
        assert_eq!(v["size"], 100);
        assert_eq!(v["truncated"], true);
        assert_eq!(v["text"].as_str().unwrap().len(), 10);
        // binary is base64; a cut through a character keeps the valid text
        assert!(body_value(&[0xff, 0x00, 0x10], 64)["base64"].is_string());
        assert_eq!(body_value("é".as_bytes(), 1)["text"], "");
    }

    #[test]
    fn events_land_per_day_agency_and_person_and_purge_removes_all() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("_dogfood");
        let d = Dogfood::start(root.clone(), DEFAULT_BODY_CAP);
        assert!(!d.consented("engineer@napkin"));
        d.consent(&me()).unwrap();
        assert!(d.consented("engineer@napkin"));
        let mut e = Event::now(&me(), "click", "Generate");
        e.doc = Some("brief-1".into());
        d.record(e.clone());
        d.flush();
        let file = e.file(&root);
        assert!(
            file.ends_with("napkin/engineer.jsonl"),
            "{}",
            file.display()
        );
        let lines = d.export(None, None, None);
        let kinds: Vec<String> = lines
            .lines()
            .map(|l| serde_json::from_str::<Event>(l).unwrap().kind)
            .collect();
        assert_eq!(kinds, ["consent", "click"]);
        assert_eq!(d.export(None, Some("javelin"), None), "");
        assert!(d.export(None, None, Some("engineer")).contains("Generate"));

        // consent survives a restart; a purge removes the record and the consent
        drop(d);
        let d = Dogfood::start(root.clone(), DEFAULT_BODY_CAP);
        assert!(d.consented("engineer@napkin"));
        assert!(d.purge() >= 2);
        assert!(!root.exists());
        assert!(!d.consented("engineer@napkin"));
        assert_eq!(d.export(None, None, None), "");
    }

    #[test]
    fn a_full_queue_drops_events_instead_of_waiting() {
        // a writer that never runs: its channel is full after QUEUE events
        let (tx, _rx) = sync_channel(1);
        let d = Dogfood {
            root: PathBuf::from("/nonexistent"),
            body_cap: 8,
            tx,
            dropped: AtomicU64::new(0),
            consent: Mutex::new(BTreeMap::new()),
        };
        let start = Instant::now();
        for _ in 0..1000 {
            d.record(Event::now(&me(), "click", "x"));
        }
        assert!(start.elapsed().as_millis() < 500, "recording must not wait");
        assert_eq!(d.dropped(), 999);
    }
}
