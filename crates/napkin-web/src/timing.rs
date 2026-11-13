// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! One timing line per request (features/web-request-timing.clan).
//!
//! [`layer`] wraps every routed request. It notes the method and the route
//! template (`/api/t/{tenant}/d/{doc}`, never the path itself), runs the
//! request inside a task-local [`Record`], and writes one flat JSON object when
//! the handler has answered:
//!
//! ```json
//! {"kind":"request","method":"GET","route":"/api/t/{tenant}/d/{doc}",
//!  "status":200,"total_ms":412.3,"tenant":"9f2c1a0b","user":"51de07aa",
//!  "doc":"c03b2e91","bytes":1843221,
//!  "phases":{"session":388.0,"lock":0.0,"read":12.1,"verify":301.4,
//!            "resolve":70.2,"describe":4.1,"token":0.1}}
//! ```
//!
//! Tenant, user and document are short sha256 hashes: enough to tell one from
//! another across lines, nothing that names anyone. A request slower than
//! [`SLOW_MS`] is written at WARN (`"level":"warn"` in the line too).
//!
//! The handlers add phases with [`phase`], and an open of a document reports its
//! own steps through [`open`] — the host marks them (it keeps no clock: wasm32
//! has none it may use), this module measures. Code outside a timed request
//! (tests, background work) records nothing and costs nothing.
//!
//! The total runs until the handler has answered; compressing the body on the
//! way out is not in it.

use std::cell::RefCell;
use std::fmt::Write as _;
use std::time::Instant;

use axum::extract::{MatchedPath, Request};
use axum::middleware::Next;
use axum::response::Response;
use napkin_host::{DocId, HostResult, OpenMark, OpenResult, Session};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// The tracing target of the timing lines. `main` writes them raw, one JSON
/// object per line, so CloudWatch Logs Insights finds their fields itself.
pub const TARGET: &str = "napkin_web::timing";

/// Requests slower than this are written at WARN.
pub const SLOW_MS: f64 = 1000.0;

/// What one request did, gathered while it runs.
#[derive(Default)]
struct Record {
    phases: Vec<(&'static str, f64)>,
    bytes: Option<usize>,
    doc: Option<String>,
    tenant: Option<String>,
    user: Option<String>,
    op: Option<String>,
}

tokio::task_local! {
    static REQUEST: RefCell<Record>;
}

fn with(f: impl FnOnce(&mut Record)) {
    let _ = REQUEST.try_with(|r| f(&mut r.borrow_mut()));
}

/// A short, stable stand-in for `s`: the first 8 hex digits of its sha256.
pub fn short_hash(s: &str) -> String {
    let digest = Sha256::digest(s.as_bytes());
    let mut out = String::with_capacity(8);
    for b in &digest[..4] {
        let _ = write!(out, "{b:02x}");
    }
    out
}

fn ms_since(t: Instant) -> f64 {
    (t.elapsed().as_secs_f64() * 10_000.0).round() / 10.0
}

/// Run `f` as the phase `name` of this request. Phases of the same name add up.
pub fn phase<T>(name: &'static str, f: impl FnOnce() -> T) -> T {
    let t = Instant::now();
    let out = f();
    add(name, ms_since(t));
    out
}

/// Record the time since `since` as the phase `name`.
pub fn add_ms(name: &'static str, since: Instant) {
    add(name, ms_since(since));
}

/// The size of what this request read or composed.
pub fn note_bytes(n: usize) {
    with(|r| r.bytes = Some(r.bytes.unwrap_or(0) + n));
}

fn add(name: &'static str, ms: f64) {
    with(|r| match r.phases.iter_mut().find(|(n, _)| *n == name) {
        Some((_, total)) => *total += ms,
        None => r.phases.push((name, ms)),
    });
}

/// Who this request is for. Only the hashes are kept.
pub fn note_who(tenant: &str, person: &str) {
    with(|r| {
        r.tenant = Some(short_hash(tenant));
        r.user = Some(short_hash(person));
    });
}

/// Which document this request reaches. Only the hash is kept.
pub fn note_doc(doc: &DocId) {
    with(|r| r.doc = Some(short_hash(doc.as_str())));
}

/// What a sandbox call asked the host for: the first segment of its path
/// (`decisions`, `upstream`, `api-proxy`, `assets`), never the rest.
pub fn note_op(path: &str) {
    let op: String = path
        .trim_start_matches('/')
        .split('/')
        .next()
        .unwrap_or_default()
        .chars()
        .take(32)
        .collect();
    with(|r| r.op = Some(op));
}

/// Open `id` in `session` (holding its view lock across the read, as
/// [`Session::open`] does), timing each step as a phase: `lock` (the wait for
/// the view lock), `read`, `verify` (parse and signature), `resolve` (the
/// installed app's view) and `describe`; and noting the archive's size.
pub fn open(session: &Session, id: DocId) -> HostResult<OpenResult> {
    let mut last = Instant::now();
    session.open_observed(id, &mut |m| {
        let ms = ms_since(last);
        last = Instant::now();
        let name = match m {
            OpenMark::Locked => "lock",
            OpenMark::Read { bytes } => {
                note_bytes(bytes);
                "read"
            }
            OpenMark::Verified => "verify",
            OpenMark::Resolved => "resolve",
            OpenMark::Described => "describe",
        };
        add(name, ms);
    })
}

/// Time the request and write its line.
pub async fn layer(req: Request, next: Next) -> Response {
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| "(unmatched)".into());
    // The load balancer's health check is not a request anyone waits on.
    if route.ends_with("/healthz") {
        return next.run(req).await;
    }
    let method = req.method().to_string();
    let started = Instant::now();
    let (response, record) = REQUEST
        .scope(RefCell::new(Record::default()), async {
            let response = next.run(req).await;
            let record = REQUEST.with(|r| r.take());
            (response, record)
        })
        .await;
    let total = ms_since(started);
    let status = response.status().as_u16();
    let slow = total > SLOW_MS;
    let line = line(&method, &route, status, total, slow, record);
    if slow {
        tracing::warn!(target: TARGET, "{line}");
    } else {
        tracing::info!(target: TARGET, "{line}");
    }
    response
}

fn line(method: &str, route: &str, status: u16, total: f64, slow: bool, r: Record) -> String {
    let mut o = Map::new();
    o.insert("kind".into(), json!("request"));
    o.insert("level".into(), json!(if slow { "warn" } else { "info" }));
    o.insert("method".into(), json!(method));
    o.insert("route".into(), json!(route));
    o.insert("status".into(), json!(status));
    o.insert("total_ms".into(), json!(total));
    let fields = [
        ("op", r.op),
        ("tenant", r.tenant),
        ("user", r.user),
        ("doc", r.doc),
    ];
    for (k, v) in fields {
        if let Some(v) = v {
            o.insert(k.into(), json!(v));
        }
    }
    if let Some(b) = r.bytes {
        o.insert("bytes".into(), json!(b));
    }
    if !r.phases.is_empty() {
        let phases: Map<String, Value> = r
            .phases
            .into_iter()
            .map(|(k, ms)| (k.to_string(), json!((ms * 10.0).round() / 10.0)))
            .collect();
        o.insert("phases".into(), Value::Object(phases));
    }
    Value::Object(o).to_string()
}

/// Writes the timing lines as they are — the JSON object alone, one per line —
/// to stdout. `main` gives every other target the ordinary formatter.
pub struct Lines;

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Lines {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        if let Some(line) = message_of(event) {
            use std::io::Write;
            let mut out = std::io::stdout().lock();
            let _ = writeln!(out, "{line}");
        }
    }
}

/// The JSON line a timing event carries, or `None` for any other event.
pub fn message_of(event: &tracing::Event<'_>) -> Option<String> {
    struct Message(Option<String>);
    impl tracing::field::Visit for Message {
        fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
            if field.name() == "message" {
                self.0 = Some(format!("{value:?}"));
            }
        }
    }
    if event.metadata().target() != TARGET {
        return None;
    }
    let mut m = Message(None);
    event.record(&mut m);
    m.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hash_is_short_stable_and_not_the_input() {
        let h = short_hash("ana@agency.example");
        assert_eq!(h.len(), 8);
        assert_eq!(h, short_hash("ana@agency.example"));
        assert_ne!(h, short_hash("bo@agency.example"));
        assert!(!h.contains("ana"));
    }

    #[test]
    fn a_sandbox_op_is_its_first_segment_only() {
        let op = |p: &str| {
            let mut out = None;
            let rec = RefCell::new(Record::default());
            block_on(REQUEST.scope(rec, async {
                note_op(p);
                out = REQUEST.with(|r| r.borrow().op.clone());
            }));
            out.unwrap()
        };
        assert_eq!(op("/decisions"), "decisions");
        assert_eq!(op("/assets/doc-1234/logo.png"), "assets");
        assert_eq!(op(""), "");
    }

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(f)
    }

    /// Collects the timing lines, with the level each was written at.
    #[derive(Clone, Default)]
    struct Captured(std::sync::Arc<std::sync::Mutex<Vec<(tracing::Level, Value)>>>);

    impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Captured {
        fn on_event(
            &self,
            event: &tracing::Event<'_>,
            _ctx: tracing_subscriber::layer::Context<'_, S>,
        ) {
            if let Some(line) = message_of(event) {
                let v = serde_json::from_str(&line).expect("a timing line is one JSON object");
                self.0.lock().unwrap().push((*event.metadata().level(), v));
            }
        }
    }

    fn capture() -> (Captured, tracing::subscriber::DefaultGuard) {
        use tracing_subscriber::prelude::*;
        let c = Captured::default();
        let guard =
            tracing::subscriber::set_default(tracing_subscriber::registry().with(c.clone()));
        (c, guard)
    }

    async fn call(app: &axum::Router, uri: &str) -> u16 {
        use tower::ServiceExt;
        let req = axum::http::Request::get(uri)
            .body(axum::body::Body::empty())
            .unwrap();
        app.clone().oneshot(req).await.unwrap().status().as_u16()
    }

    // One line per request, by route template, with who it was for as hashes:
    // never the document id or the person's email.
    #[tokio::test]
    async fn a_request_writes_one_line_with_its_route_template_and_no_raw_ids() {
        use axum::extract::Path;
        let (lines, _guard) = capture();
        let app = axum::Router::new()
            .route(
                "/t/{tenant}/d/{doc}",
                axum::routing::get(|Path((t, d)): Path<(String, String)>| async move {
                    note_who(&t, "ana@agency.example");
                    note_doc(&DocId::new(d));
                    phase("read", || note_bytes(1234));
                    "ok"
                }),
            )
            .route_layer(axum::middleware::from_fn(layer));

        assert_eq!(call(&app, "/t/agency-acme/d/doc-secret-plan").await, 200);

        let lines = lines.0.lock().unwrap();
        assert_eq!(lines.len(), 1, "one line per request");
        let (level, line) = &lines[0];
        assert_eq!(*level, tracing::Level::INFO);
        assert_eq!(line["kind"], "request");
        assert_eq!(line["method"], "GET");
        assert_eq!(line["route"], "/t/{tenant}/d/{doc}");
        assert_eq!(line["status"], 200);
        assert!(line["total_ms"].as_f64().unwrap() >= 0.0);
        assert_eq!(line["tenant"], short_hash("agency-acme"));
        assert_eq!(line["user"], short_hash("ana@agency.example"));
        assert_eq!(line["doc"], short_hash("doc-secret-plan"));
        assert_eq!(line["bytes"], 1234);
        assert!(line["phases"]["read"].is_number());
        let text = line.to_string();
        for raw in ["agency-acme", "doc-secret-plan", "ana@", "agency.example"] {
            assert!(!text.contains(raw), "{raw} leaked into {text}");
        }
    }

    #[tokio::test]
    async fn a_request_over_a_second_is_written_at_warn() {
        let (lines, _guard) = capture();
        let app = axum::Router::new()
            .route(
                "/slow",
                axum::routing::get(|| async {
                    tokio::time::sleep(std::time::Duration::from_millis(1050)).await;
                    "ok"
                }),
            )
            .route_layer(axum::middleware::from_fn(layer));
        call(&app, "/slow").await;
        let lines = lines.0.lock().unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].0, tracing::Level::WARN);
        assert_eq!(lines[0].1["level"], "warn");
        assert!(lines[0].1["total_ms"].as_f64().unwrap() > SLOW_MS);
    }

    // Through the real router: opening a document names its phases, the open's
    // own steps among them, and the archive's size.
    #[tokio::test]
    async fn a_document_open_through_the_service_times_its_phases() {
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let ctx = std::sync::Arc::new(crate::state::AppCtx::new(
            dir.path().to_path_buf(),
            std::sync::Arc::new(napkin_host::NoConfig),
            None,
            0,
        ));
        let app = crate::router(ctx, None, false);
        let first = app
            .clone()
            .oneshot(
                axum::http::Request::get("/api/session")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let cookie = first.headers()[axum::http::header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let tenant = cookie.split_once('=').unwrap().1.to_string();
        let bytes = clan_sdk::create(clan_sdk::CreateOptions {
            title: "Timed".into(),
            brief: "test brief".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap();
        let up = app
            .clone()
            .oneshot(
                axum::http::Request::post(format!("/api/t/{tenant}/documents/upload"))
                    .header(axum::http::header::COOKIE, &cookie)
                    .body(axum::body::Body::from(bytes))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(up.status(), 200);

        let (lines, _guard) = capture();
        // the upload left its session cached: a warm open re-reads the
        // archive, so the open's own steps are timed too
        let docs = std::fs::read_dir(dir.path().join(&tenant).join("documents"))
            .unwrap()
            .flatten()
            .next()
            .unwrap();
        let doc = format!("doc-{}", docs.path().file_stem().unwrap().to_str().unwrap());
        let status = app
            .clone()
            .oneshot(
                axum::http::Request::get(format!("/api/t/{tenant}/d/{doc}"))
                    .header(axum::http::header::COOKIE, &cookie)
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status();
        assert_eq!(status, 200);

        let lines = lines.0.lock().unwrap();
        assert_eq!(lines.len(), 1);
        let line = &lines[0].1;
        assert_eq!(line["route"], "/api/t/{tenant}/d/{doc}");
        assert_eq!(line["tenant"], short_hash(&tenant));
        assert_eq!(line["doc"], short_hash(&doc));
        assert!(line["bytes"].as_u64().unwrap() > 0);
        for p in [
            "session", "lock", "read", "verify", "resolve", "describe", "token",
        ] {
            assert!(line["phases"][p].is_number(), "no {p} phase in {line}");
        }
        let text = line.to_string();
        assert!(!text.contains(&tenant) && !text.contains(&doc));
    }

    #[test]
    fn outside_a_request_nothing_is_recorded_and_nothing_fails() {
        assert_eq!(phase("x", || 7), 7);
        note_who("t", "p");
        note_op("/decisions");
    }
}
