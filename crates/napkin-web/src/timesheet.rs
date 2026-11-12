// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! AI timesheets, Phase 1 (features/timesheet-sessions.clan): work sessions kept for
//! one person, a drafted day, and a one-tap confirm.
//!
//! The rules the shape of this module enforces (v3.1 section 8):
//!
//!   * **Consent first.** [`Store::record`] keeps nothing unless the person's own consent
//!     log says yes. Not asked and no both mean no capture, and in-app sessions are not
//!     exempt.
//!   * **One person's data, read by that person.** Every function here takes the one
//!     person the session names. There is no query across people, no total per person for
//!     anyone else and no route that takes another person's name and answers: a request
//!     that names someone else is a 403, for a manager as for anyone.
//!   * **Never submitted, never scored.** A day is drafted, then confirmed by its person
//!     with one call. Nothing leaves this store, and no number here is a rank, a rating or
//!     a comparison of people.
//!   * **Corrections are private.** They are kept in the person's own folder and read by
//!     that person alone.
//!
//! The store is an interface (`Store`: record, list, confirm) with a file store behind it
//! so the agency database can replace the files without touching the routes.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::extract::{Query, State};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};
use chrono::{Datelike, Duration, NaiveDate};
use napkin_host::DocId;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{ApiError, ApiResult};
use crate::state::AppCtx;
use crate::tenant::{Person, Tenant};

/// A session with no event for this long is over: a crashed tab must not keep earning time.
pub const STALE_MS: i64 = 90_000;
/// Between two sessions, a stretch at least this long is shown as not accounted for.
pub const GAP_MIN_MS: i64 = 15 * 60_000;
/// ...and no longer than this: a longer stretch is the person being away, not a gap to guess.
pub const GAP_MAX_MS: i64 = 4 * 60 * 60_000;
/// A focus for the document already live, this soon after the last, changes nothing and writes nothing.
const QUIET_MS: i64 = 5_000;

type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

// ── what is kept ─────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Consent {
    NotAsked,
    Yes,
    No,
}

/// One stretch of one job's document open and in focus, by one person. Times are epoch ms.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub doc: String,
    pub job: String,
    pub label: String,
    pub start: i64,
    pub end: i64,
    pub live: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Open,
    Focus,
    Blur,
    Close,
}

/// A line of a day: built from sessions, added by hand, or from a gap's best guess.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Line {
    pub key: String,
    pub job: Option<String>,
    pub label: String,
    pub minutes: i64,
    /// `sessions`, `hand` or `guess`.
    pub source: String,
    /// The sessions the line was built from: what a confirmed line links back to.
    pub session_ids: Vec<String>,
    /// The person's own decisions in the document that day.
    pub edits: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Gap {
    pub from: i64,
    pub to: i64,
    pub minutes: i64,
    pub guess: Option<Guess>,
    pub session_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Guess {
    pub job: String,
    pub label: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SessionsFile {
    pub sessions: Vec<Session>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Added {
    id: String,
    job: Option<String>,
    label: String,
    minutes: i64,
    source: String,
    session_ids: Vec<String>,
    from: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Confirmed {
    at: i64,
    lines: Vec<Line>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct DayFile {
    added: Vec<Added>,
    /// Minutes the person changed a drafted line to, by line key.
    overrides: BTreeMap<String, i64>,
    confirmed: Option<Confirmed>,
}

/// One change the person made to a drafted line. Private: read by the person alone.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Correction {
    pub at: i64,
    pub date: String,
    pub line: String,
    pub before: i64,
    pub after: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ConsentEntry {
    actor: String,
    action: String,
    at: i64,
}

// ── the day, drafted ─────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct Day {
    pub date: String,
    pub consent: Consent,
    /// `draft` until the person confirms it, then `confirmed`.
    pub status: &'static str,
    pub lines: Vec<Line>,
    pub gaps: Vec<Gap>,
    pub total_minutes: i64,
    pub confirmed_at: Option<i64>,
    /// The last date the person may still change a confirmed day (the Friday on or after it).
    pub editable_until: String,
}

/// The Friday on or after `date`: the proposal lets a confirmed day change until Friday.
pub fn editable_until(date: NaiveDate) -> NaiveDate {
    let to_fri = (4 + 7 - date.weekday().num_days_from_monday() as i64) % 7;
    date + Duration::days(to_fri)
}

fn ceil_minutes(ms: i64) -> i64 {
    (ms.max(0) + 59_999) / 60_000
}

/// Apply one event to a person's sessions. Pure: `resolve` says which job and label a
/// document belongs to (none: not a job's document, nothing is kept).
///
/// Only the focused document accrues time: a focus on one document ends whatever was live.
/// Returns whether anything changed, so a quiet repeat costs no write.
pub fn apply(
    file: &mut SessionsFile,
    kind: EventKind,
    doc: &str,
    now: i64,
    resolve: impl Fn(&str) -> Option<(String, String)>,
) -> bool {
    let live = file.sessions.iter().position(|s| s.live);
    match kind {
        EventKind::Open | EventKind::Focus => {
            if let Some(i) = live {
                let s = &mut file.sessions[i];
                if s.doc == doc && now - s.end <= STALE_MS {
                    if now - s.end < QUIET_MS {
                        return false;
                    }
                    s.end = now;
                    return true;
                }
                // another document, or a tab that went quiet: that session is over
                if now - s.end <= STALE_MS {
                    s.end = now;
                }
                s.live = false;
            }
            let Some((job, label)) = resolve(doc) else {
                return live.is_some();
            };
            file.sessions.push(Session {
                id: uuid::Uuid::new_v4().simple().to_string()[..12].to_string(),
                doc: doc.to_string(),
                job,
                label,
                start: now,
                end: now,
                live: true,
            });
            true
        }
        EventKind::Blur | EventKind::Close => match live {
            Some(i) if file.sessions[i].doc == doc => {
                let s = &mut file.sessions[i];
                if now - s.end <= STALE_MS {
                    s.end = now;
                }
                s.live = false;
                true
            }
            _ => false,
        },
    }
}

/// The lines a day's sessions make: one per document, with the person's own decisions in it.
/// `edits` counts those by document.
pub fn lines_from(
    sessions: &[Session],
    edits: &BTreeMap<String, usize>,
    overrides: &BTreeMap<String, i64>,
) -> Vec<Line> {
    let mut by: BTreeMap<String, Line> = BTreeMap::new();
    let mut ms: BTreeMap<String, i64> = BTreeMap::new();
    for s in sessions {
        let key = format!("{}:{}", s.job, s.doc);
        *ms.entry(key.clone()).or_default() += (s.end - s.start).max(0);
        let line = by.entry(key.clone()).or_insert_with(|| Line {
            key: key.clone(),
            job: Some(s.job.clone()),
            label: s.label.clone(),
            minutes: 0,
            source: "sessions".into(),
            session_ids: vec![],
            edits: edits.get(&s.doc).copied().unwrap_or(0),
        });
        line.session_ids.push(s.id.clone());
    }
    by.into_iter()
        .map(|(k, mut l)| {
            l.minutes = overrides
                .get(&k)
                .copied()
                .unwrap_or_else(|| ceil_minutes(ms[&k]));
            l
        })
        .filter(|l| l.minutes > 0)
        .collect()
}

/// The stretches between a day's sessions that nothing accounts for, each with a best guess.
/// The guess is a job only when the person had the same job open before and after.
pub fn gaps_of(sessions: &[Session], taken: &[i64]) -> Vec<Gap> {
    let mut sorted: Vec<&Session> = sessions.iter().collect();
    sorted.sort_by_key(|s| s.start);
    let mut out = Vec::new();
    for w in sorted.windows(2) {
        let (a, b) = (w[0], w[1]);
        let len = b.start - a.end;
        if !(GAP_MIN_MS..=GAP_MAX_MS).contains(&len) || taken.contains(&a.end) {
            continue;
        }
        out.push(Gap {
            from: a.end,
            to: b.start,
            minutes: ceil_minutes(len),
            guess: (a.job == b.job).then(|| Guess {
                job: a.job.clone(),
                label: a.label.clone(),
            }),
            session_ids: vec![a.id.clone(), b.id.clone()],
        });
    }
    out
}

// ── the store ────────────────────────────────────────────────────────────────

/// Where a person's timesheet things live. The file store is the first; the agency database
/// replaces it later without changing the routes.
pub trait Store: Send + Sync {
    fn consent(&self, person: &str) -> Consent;
    fn set_consent(&self, person: &str, actor: &str, yes: bool, now: i64) -> ApiResult<()>;
    /// Keeps a session only when the person has said yes. Returns whether it was kept.
    fn record(
        &self,
        person: &str,
        kind: EventKind,
        doc: &str,
        now: i64,
        resolve: &dyn Fn(&str) -> Option<(String, String)>,
    ) -> ApiResult<bool>;
    fn sessions(&self, person: &str, from: i64, to: i64) -> Vec<Session>;
    fn day(&self, person: &str, date: &str) -> DayState;
    fn save_day(&self, person: &str, date: &str, day: &DayState) -> ApiResult<()>;
    fn correction(&self, person: &str, c: Correction) -> ApiResult<()>;
    fn corrections(&self, person: &str) -> Vec<Correction>;
    /// Delete one person's sessions, days and corrections (GDPR). The consent log stays: it is
    /// the record that the person was asked.
    fn erase(&self, person: &str) -> ApiResult<()>;
}

pub type DayState = DayFileView;

/// A day's stored state, opaque outside this module.
#[derive(Clone, Debug, Default)]
pub struct DayFileView(DayFile);

pub struct FileStore {
    root: PathBuf,
    lock: Mutex<()>,
}

impl FileStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            lock: Mutex::new(()),
        }
    }

    /// One folder per person, named from their name with anything but letters, digits and `.-_@` replaced.
    fn dir(&self, person: &str) -> PathBuf {
        let safe: String = person
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '@') {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        self.root.join(safe.replace("..", "-"))
    }
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(p: &Path) -> T {
    fs::read(p)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(p: &Path, v: &T) -> ApiResult<()> {
    let fail = |e: String| ApiError::new(500, format!("the timesheet could not be saved: {e}"));
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| fail(e.to_string()))?;
    }
    let tmp = p.with_extension("tmp");
    fs::write(
        &tmp,
        serde_json::to_vec(v).map_err(|e| fail(e.to_string()))?,
    )
    .and_then(|_| fs::rename(&tmp, p))
    .map_err(|e| fail(e.to_string()))
}

fn append_line<T: Serialize>(p: &Path, v: &T) -> ApiResult<()> {
    let fail = |e: String| ApiError::new(500, format!("the timesheet could not be saved: {e}"));
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| fail(e.to_string()))?;
    }
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(p)
        .map_err(|e| fail(e.to_string()))?;
    let mut line = serde_json::to_string(v).map_err(|e| fail(e.to_string()))?;
    line.push('\n');
    f.write_all(line.as_bytes())
        .map_err(|e| fail(e.to_string()))
}

fn read_lines<T: for<'de> Deserialize<'de>>(p: &Path) -> Vec<T> {
    fs::read_to_string(p)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

impl Store for FileStore {
    fn consent(&self, person: &str) -> Consent {
        let _g = self.lock.lock().unwrap();
        let log: Vec<ConsentEntry> = read_lines(&self.dir(person).join("consent.jsonl"));
        match log.last().map(|e| e.action.as_str()) {
            Some("consent yes") => Consent::Yes,
            Some("consent no") => Consent::No,
            _ => Consent::NotAsked,
        }
    }

    fn set_consent(&self, person: &str, actor: &str, yes: bool, now: i64) -> ApiResult<()> {
        let _g = self.lock.lock().unwrap();
        append_line(
            &self.dir(person).join("consent.jsonl"),
            &ConsentEntry {
                actor: actor.to_string(),
                action: if yes { "consent yes" } else { "consent no" }.into(),
                at: now,
            },
        )
    }

    fn record(
        &self,
        person: &str,
        kind: EventKind,
        doc: &str,
        now: i64,
        resolve: &dyn Fn(&str) -> Option<(String, String)>,
    ) -> ApiResult<bool> {
        // consent is read from the person's own log, under the same lock as the write
        let _g = self.lock.lock().unwrap();
        let dir = self.dir(person);
        let log: Vec<ConsentEntry> = read_lines(&dir.join("consent.jsonl"));
        if log.last().map(|e| e.action.as_str()) != Some("consent yes") {
            return Ok(false);
        }
        let path = dir.join("sessions.json");
        let mut file: SessionsFile = read_json(&path);
        if apply(&mut file, kind, doc, now, |d| resolve(d)) {
            write_json(&path, &file)?;
        }
        Ok(true)
    }

    fn sessions(&self, person: &str, from: i64, to: i64) -> Vec<Session> {
        let _g = self.lock.lock().unwrap();
        let file: SessionsFile = read_json(&self.dir(person).join("sessions.json"));
        file.sessions
            .into_iter()
            .filter(|s| s.start >= from && s.start < to)
            .collect()
    }

    fn day(&self, person: &str, date: &str) -> DayState {
        let _g = self.lock.lock().unwrap();
        DayFileView(read_json(
            &self.dir(person).join("days").join(format!("{date}.json")),
        ))
    }

    fn save_day(&self, person: &str, date: &str, day: &DayState) -> ApiResult<()> {
        let _g = self.lock.lock().unwrap();
        write_json(
            &self.dir(person).join("days").join(format!("{date}.json")),
            &day.0,
        )
    }

    fn correction(&self, person: &str, c: Correction) -> ApiResult<()> {
        let _g = self.lock.lock().unwrap();
        append_line(&self.dir(person).join("corrections.jsonl"), &c)
    }

    fn corrections(&self, person: &str) -> Vec<Correction> {
        let _g = self.lock.lock().unwrap();
        read_lines(&self.dir(person).join("corrections.jsonl"))
    }

    fn erase(&self, person: &str) -> ApiResult<()> {
        let _g = self.lock.lock().unwrap();
        let dir = self.dir(person);
        for name in ["sessions.json", "corrections.jsonl"] {
            let _ = fs::remove_file(dir.join(name));
        }
        let _ = fs::remove_dir_all(dir.join("days"));
        Ok(())
    }
}

/// The service the routes use: a store and a clock (a test sets the clock).
pub struct Timesheets {
    pub store: Box<dyn Store>,
    clock: Clock,
}

impl Timesheets {
    pub fn new(root: PathBuf) -> Self {
        Self {
            store: Box::new(FileStore::new(root.join("timesheets"))),
            clock: Arc::new(|| chrono::Utc::now().timestamp_millis()),
        }
    }

    pub fn with_clock(mut self, clock: impl Fn() -> i64 + Send + Sync + 'static) -> Self {
        self.clock = Arc::new(clock);
        self
    }

    fn now(&self) -> i64 {
        (self.clock)()
    }
}

// ── the day for a person ─────────────────────────────────────────────────────

/// The person's own edits by document, within `[from, to)`, read only from the documents in `only`.
type Edits<'a> = dyn Fn(&str, i64, i64, &BTreeSet<String>) -> BTreeMap<String, usize> + 'a;

/// The day `date` as `person` has it. Nothing here reads anyone else.
pub fn day_for(
    ts: &Timesheets,
    person: &str,
    date: &str,
    tz_min: i64,
    edits: &Edits<'_>,
) -> ApiResult<Day> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| ApiError::new(400, "date must be YYYY-MM-DD"))?;
    let from = d.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis() - tz_min * 60_000;
    let to = from + 86_400_000;
    let consent = ts.store.consent(person);
    let state = ts.store.day(person, date).0;
    let until = editable_until(d).to_string();
    if let Some(c) = &state.confirmed {
        let total = c.lines.iter().map(|l| l.minutes).sum();
        return Ok(Day {
            date: date.into(),
            consent,
            status: "confirmed",
            lines: c.lines.clone(),
            gaps: vec![],
            total_minutes: total,
            confirmed_at: Some(c.at),
            editable_until: until,
        });
    }
    // A person who has not said yes has no sessions to draft from: their day is what they add.
    let sessions = if consent == Consent::Yes {
        ts.store.sessions(person, from, to)
    } else {
        vec![]
    };
    // Only a line's own documents are counted: the day reads the documents its sessions name, not every
    // document of the agency.
    let worked: BTreeSet<String> = sessions.iter().map(|s| s.doc.clone()).collect();
    let counted = edits(person, from, to, &worked);
    let mut lines = lines_from(&sessions, &counted, &state.overrides);
    let taken: Vec<i64> = state.added.iter().filter_map(|a| a.from).collect();
    for a in &state.added {
        lines.push(Line {
            key: a.id.clone(),
            job: a.job.clone(),
            label: a.label.clone(),
            minutes: state.overrides.get(&a.id).copied().unwrap_or(a.minutes),
            source: a.source.clone(),
            session_ids: a.session_ids.clone(),
            edits: 0,
        });
    }
    let gaps = gaps_of(&sessions, &taken);
    let total = lines.iter().map(|l| l.minutes).sum();
    Ok(Day {
        date: date.into(),
        consent,
        status: "draft",
        lines,
        gaps,
        total_minutes: total,
        confirmed_at: None,
        editable_until: until,
    })
}

// ── routes ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route(
            "/t/{tenant}/timesheet/consent",
            get(get_consent).post(post_consent),
        )
        .route("/t/{tenant}/timesheet/events", post(post_event))
        .route("/t/{tenant}/timesheet/sessions", get(get_sessions))
        .route("/t/{tenant}/timesheet/day", get(get_day))
        .route("/t/{tenant}/timesheet/day/confirm", post(confirm_day))
        .route("/t/{tenant}/timesheet/day/reopen", post(reopen_day))
        .route("/t/{tenant}/timesheet/lines", post(add_line))
        .route("/t/{tenant}/timesheet/lines/change", put(change_line))
        .route("/t/{tenant}/timesheet/corrections", get(get_corrections))
        .route("/t/{tenant}/timesheet/mine", delete(erase_mine))
}

/// The one rule of reading: a request may name only the person who is signed in. A manager
/// naming someone else is refused like anyone, and a day is never read by its name.
fn mine(asked: &Option<String>, me: &str) -> ApiResult<()> {
    match asked {
        Some(p) if p != me => Err(ApiError::new(403, "A timesheet is read by its own person.")),
        _ => Ok(()),
    }
}

#[derive(Deserialize)]
pub struct Who {
    person: Option<String>,
}

#[derive(Deserialize)]
pub struct DayQuery {
    person: Option<String>,
    date: String,
    tz: Option<i64>,
}

#[derive(Deserialize)]
pub struct SessionsQuery {
    person: Option<String>,
    date: Option<String>,
    tz: Option<i64>,
}

async fn get_consent(
    State(ctx): State<Arc<AppCtx>>,
    Extension(Person(me)): Extension<Person>,
    Query(q): Query<Who>,
) -> ApiResult<Json<Value>> {
    mine(&q.person, &me)?;
    Ok(Json(
        serde_json::json!({ "consent": ctx.timesheets.store.consent(&me) }),
    ))
}

#[derive(Deserialize)]
pub struct ConsentBody {
    consent: bool,
}

async fn post_consent(
    State(ctx): State<Arc<AppCtx>>,
    Extension(Person(me)): Extension<Person>,
    Json(b): Json<ConsentBody>,
) -> ApiResult<Json<Value>> {
    let ts = &ctx.timesheets;
    ts.store.set_consent(&me, &me, b.consent, ts.now())?;
    Ok(Json(
        serde_json::json!({ "ok": true, "consent": ts.store.consent(&me) }),
    ))
}

#[derive(Deserialize)]
pub struct EventBody {
    event: EventKind,
    doc: String,
}

/// A document opened, focused, blurred or closed. Kept only with the person's yes, and only
/// for a document that belongs to a job.
async fn post_event(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    Extension(Person(me)): Extension<Person>,
    Json(b): Json<EventBody>,
) -> ApiResult<Json<Value>> {
    let ts = &ctx.timesheets;
    // Not asked or no: nothing is read, nothing is written, not even to look the document up.
    if ts.store.consent(&me) != Consent::Yes {
        return Ok(Json(serde_json::json!({ "ok": true, "captured": false })));
    }
    let ws = ctx.workspace(&tenant);
    let resolve = |doc: &str| job_of(&*ws.store, doc);
    let kept = ts.store.record(&me, b.event, &b.doc, ts.now(), &resolve)?;
    Ok(Json(serde_json::json!({ "ok": true, "captured": kept })))
}

fn range(date: &Option<String>, tz: i64) -> ApiResult<(i64, i64)> {
    match date {
        None => Ok((i64::MIN, i64::MAX)),
        Some(d) => {
            let d = NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .map_err(|_| ApiError::new(400, "date must be YYYY-MM-DD"))?;
            let from = d.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis() - tz * 60_000;
            Ok((from, from + 86_400_000))
        }
    }
}

/// The person's own sessions: `[]` for a person who has not said yes.
async fn get_sessions(
    State(ctx): State<Arc<AppCtx>>,
    Extension(Person(me)): Extension<Person>,
    Query(q): Query<SessionsQuery>,
) -> ApiResult<Json<Vec<Session>>> {
    mine(&q.person, &me)?;
    let (from, to) = range(&q.date, q.tz.unwrap_or(0))?;
    Ok(Json(ctx.timesheets.store.sessions(&me, from, to)))
}

/// The job a document is filed under, and its title, read from that document's own manifest: `None` for a
/// document that names no job, or a job the registry does not hold. One document and the registry are read,
/// not every document of the agency, so an event costs the same however many documents the agency has.
fn job_of(store: &dyn napkin_host::DocStore, doc: &str) -> Option<(String, String)> {
    let bytes = store.read(&DocId::new(doc)).ok()?;
    let clan = clan_sdk::ClanFile::from_bytes(bytes).ok()?;
    let m = clan.manifest();
    let job = m.job.clone()?;
    napkin_host::jobs::list(store)
        .ok()?
        .iter()
        .any(|r| r.number == job)
        .then(|| (job, m.title.clone()))
}

/// The person's own decisions in each document, within a time range: what a line is "built from".
/// Read from the documents in `only` (the day's sessions name them, and each was filed under a job
/// when its session was kept), so a day reads its own documents and no others.
fn edits_in(
    ctx: &AppCtx,
    tenant: &crate::tenant::TenantId,
) -> impl Fn(&str, i64, i64, &BTreeSet<String>) -> BTreeMap<String, usize> {
    let ws = ctx.workspace(tenant);
    move |person: &str, from: i64, to: i64, only: &BTreeSet<String>| {
        let me = format!("human:{person}");
        let mut out = BTreeMap::new();
        for doc in only {
            let Ok(s) = ws.session(&DocId::new(doc)) else {
                continue;
            };
            let Ok(chain) = s.chain_json() else { continue };
            let n = chain
                .get("decisions")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter(|d| d.get("actor").and_then(Value::as_str) == Some(me.as_str()))
                        .filter(|d| {
                            d.get("timestamp")
                                .and_then(Value::as_str)
                                .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                                .map(|t| t.timestamp_millis())
                                .is_some_and(|t| t >= from && t < to)
                        })
                        .count()
                })
                .unwrap_or(0);
            if n > 0 {
                out.insert(doc.clone(), n);
            }
        }
        out
    }
}

async fn get_day(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    Extension(Person(me)): Extension<Person>,
    Query(q): Query<DayQuery>,
) -> ApiResult<Json<Day>> {
    mine(&q.person, &me)?;
    let edits = edits_in(&ctx, &tenant);
    Ok(Json(day_for(
        &ctx.timesheets,
        &me,
        &q.date,
        q.tz.unwrap_or(0),
        &edits,
    )?))
}

#[derive(Deserialize)]
pub struct DateBody {
    date: String,
    tz: Option<i64>,
}

/// The one tap. The day is frozen as the person saw it, each line keeping its sessions.
/// Nothing is sent anywhere: confirming writes to the person's own folder and that is all.
async fn confirm_day(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    Extension(Person(me)): Extension<Person>,
    Json(b): Json<DateBody>,
) -> ApiResult<Json<Day>> {
    let ts = &ctx.timesheets;
    let tz = b.tz.unwrap_or(0);
    let d = NaiveDate::parse_from_str(&b.date, "%Y-%m-%d")
        .map_err(|_| ApiError::new(400, "date must be YYYY-MM-DD"))?;
    let mut state = ts.store.day(&me, &b.date);
    if state.0.confirmed.is_some() {
        // a confirmed day changes until the Friday on or after it, and not after
        let now = chrono::DateTime::from_timestamp_millis(ts.now()).map(|t| t.date_naive());
        if now.is_some_and(|n| n > editable_until(d)) {
            return Err(ApiError::new(409, "This day can no longer be changed."));
        }
        state.0.confirmed = None;
    }
    ts.store.save_day(&me, &b.date, &state)?;
    let edits = edits_in(&ctx, &tenant);
    let draft = day_for(ts, &me, &b.date, tz, &edits)?;
    if draft.lines.is_empty() {
        return Err(ApiError::new(
            400,
            "There is nothing in this day to confirm.",
        ));
    }
    state.0.confirmed = Some(Confirmed {
        at: ts.now(),
        lines: draft.lines.clone(),
    });
    ts.store.save_day(&me, &b.date, &state)?;
    Ok(Json(day_for(ts, &me, &b.date, tz, &edits)?))
}

/// A confirmed day opened again for its person, until the Friday on or after it. It is a draft
/// again, and nothing is confirmed until the person confirms it once more.
async fn reopen_day(
    State(ctx): State<Arc<AppCtx>>,
    Extension(Person(me)): Extension<Person>,
    Json(b): Json<DateBody>,
) -> ApiResult<Json<Value>> {
    let ts = &ctx.timesheets;
    let d = NaiveDate::parse_from_str(&b.date, "%Y-%m-%d")
        .map_err(|_| ApiError::new(400, "date must be YYYY-MM-DD"))?;
    let today = chrono::DateTime::from_timestamp_millis(ts.now()).map(|t| t.date_naive());
    if today.is_some_and(|n| n > editable_until(d)) {
        return Err(ApiError::new(409, "This day can no longer be changed."));
    }
    let mut state = ts.store.day(&me, &b.date);
    state.0.confirmed = None;
    ts.store.save_day(&me, &b.date, &state)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct AddBody {
    date: String,
    job: Option<String>,
    label: String,
    minutes: i64,
    /// `hand` (default) or `guess`.
    source: Option<String>,
    from: Option<i64>,
    #[serde(default)]
    session_ids: Vec<String>,
}

/// A line the person adds by hand, or a gap's guess they accept. Both are theirs alone.
async fn add_line(
    State(ctx): State<Arc<AppCtx>>,
    Extension(Person(me)): Extension<Person>,
    Json(b): Json<AddBody>,
) -> ApiResult<Json<Value>> {
    let ts = &ctx.timesheets;
    if b.minutes <= 0 || b.minutes > 24 * 60 || b.label.trim().is_empty() {
        return Err(ApiError::new(
            400,
            "A line needs a name and minutes in the day.",
        ));
    }
    let source = match b.source.as_deref() {
        Some("guess") => "guess",
        _ => "hand",
    };
    let mut state = ts.store.day(&me, &b.date);
    if state.0.confirmed.is_some() {
        return Err(ApiError::new(409, "This day is confirmed."));
    }
    let id = format!("a-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
    state.0.added.push(Added {
        id: id.clone(),
        job: b.job,
        label: b.label.trim().to_string(),
        minutes: b.minutes,
        source: source.into(),
        session_ids: if source == "guess" {
            b.session_ids
        } else {
            vec![]
        },
        from: if source == "guess" { b.from } else { None },
    });
    ts.store.save_day(&me, &b.date, &state)?;
    Ok(Json(serde_json::json!({ "ok": true, "key": id })))
}

#[derive(Deserialize)]
pub struct ChangeBody {
    date: String,
    key: String,
    minutes: i64,
}

/// A person's change to a drafted line. The before and after are kept as a correction,
/// private to them, and are shown to no one else.
async fn change_line(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    Extension(Person(me)): Extension<Person>,
    Json(b): Json<ChangeBody>,
) -> ApiResult<Json<Value>> {
    let ts = &ctx.timesheets;
    if b.minutes <= 0 || b.minutes > 24 * 60 {
        return Err(ApiError::new(400, "Minutes must be within the day."));
    }
    let mut state = ts.store.day(&me, &b.date);
    if state.0.confirmed.is_some() {
        return Err(ApiError::new(409, "This day is confirmed."));
    }
    let edits = edits_in(&ctx, &tenant);
    let now = day_for(ts, &me, &b.date, 0, &edits)?;
    let before = now
        .lines
        .iter()
        .find(|l| l.key == b.key)
        .map(|l| l.minutes)
        .ok_or_else(|| ApiError::new(404, "No such line."))?;
    state.0.overrides.insert(b.key.clone(), b.minutes);
    ts.store.save_day(&me, &b.date, &state)?;
    ts.store.correction(
        &me,
        Correction {
            at: ts.now(),
            date: b.date,
            line: b.key,
            before,
            after: b.minutes,
        },
    )?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// The person's own corrections, to the person alone.
async fn get_corrections(
    State(ctx): State<Arc<AppCtx>>,
    Extension(Person(me)): Extension<Person>,
    Query(q): Query<Who>,
) -> ApiResult<Json<Vec<Correction>>> {
    mine(&q.person, &me)?;
    Ok(Json(ctx.timesheets.store.corrections(&me)))
}

/// Delete everything kept about the signed-in person's time, on request.
async fn erase_mine(
    State(ctx): State<Arc<AppCtx>>,
    Extension(Person(me)): Extension<Person>,
) -> ApiResult<Json<Value>> {
    ctx.timesheets.store.erase(&me)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_762_851_600_000; // 2025-11-11 09:00 UTC, a Tuesday

    fn job(doc: &str) -> Option<(String, String)> {
        match doc {
            "doc-brief" => Some(("J001".into(), "Brief".into())),
            "doc-research" => Some(("J001".into(), "Research".into())),
            _ => None,
        }
    }

    fn ts(dir: &Path) -> Timesheets {
        Timesheets::new(dir.to_path_buf())
    }

    fn ev(t: &Timesheets, p: &str, k: EventKind, doc: &str, at: i64) -> bool {
        t.store.record(p, k, doc, at, &job).unwrap()
    }

    /// What the shell does: open, then a focus every 30 seconds, then close.
    fn work(t: &Timesheets, p: &str, doc: &str, from: i64, to: i64) {
        ev(t, p, EventKind::Open, doc, from);
        let mut at = from + 30_000;
        while at < to {
            ev(t, p, EventKind::Focus, doc, at);
            at += 30_000;
        }
        ev(t, p, EventKind::Close, doc, to);
    }

    fn no_edits(_: &str, _: i64, _: i64, _: &BTreeSet<String>) -> BTreeMap<String, usize> {
        BTreeMap::new()
    }

    #[test]
    fn a_day_counts_edits_only_in_the_documents_its_sessions_name() {
        // The edits behind a line are read from that line's documents, not from every document of the agency:
        // the day asks about exactly the documents its sessions name (and nothing for a person with none).
        let dir = tempfile::tempdir().unwrap();
        let t = ts(dir.path());
        let asked = std::cell::RefCell::new(Vec::<BTreeSet<String>>::new());
        let edits = |_: &str, _: i64, _: i64, only: &BTreeSet<String>| {
            asked.borrow_mut().push(only.clone());
            only.iter()
                .map(|d| (d.clone(), 2))
                .collect::<BTreeMap<_, _>>()
        };
        day_for(&t, "p", "2025-11-11", 0, &edits).unwrap();
        assert_eq!(
            asked.borrow_mut().pop().unwrap(),
            BTreeSet::new(),
            "no sessions, no document read"
        );
        t.store.set_consent("p", "p", true, T0).unwrap();
        work(&t, "p", "doc-brief", T0, T0 + 3_600_000);
        let day = day_for(&t, "p", "2025-11-11", 0, &edits).unwrap();
        assert_eq!(
            asked.borrow_mut().pop().unwrap(),
            BTreeSet::from(["doc-brief".to_string()])
        );
        assert_eq!(day.lines.len(), 1);
        assert_eq!(
            day.lines[0].edits, 2,
            "the line still carries its document's edits"
        );
    }

    #[test]
    fn nothing_is_captured_before_a_yes_and_not_after_a_no() {
        let dir = tempfile::tempdir().unwrap();
        let t = ts(dir.path());
        assert!(!ev(&t, "aoife@wk", EventKind::Open, "doc-brief", T0));
        assert!(!ev(
            &t,
            "aoife@wk",
            EventKind::Close,
            "doc-brief",
            T0 + 600_000
        ));
        assert!(t.store.sessions("aoife@wk", 0, i64::MAX).is_empty());
        t.store
            .set_consent("aoife@wk", "aoife@wk", false, T0)
            .unwrap();
        assert!(!ev(&t, "aoife@wk", EventKind::Open, "doc-brief", T0));
        assert!(t.store.sessions("aoife@wk", 0, i64::MAX).is_empty());
        // and no file of sessions was ever made
        assert!(!dir
            .path()
            .join("timesheets/aoife@wk/sessions.json")
            .exists());
        // a yes starts it, and a later no stops it again
        t.store
            .set_consent("aoife@wk", "aoife@wk", true, T0)
            .unwrap();
        assert!(ev(&t, "aoife@wk", EventKind::Open, "doc-brief", T0));
        t.store
            .set_consent("aoife@wk", "aoife@wk", false, T0 + 1)
            .unwrap();
        assert!(!ev(
            &t,
            "aoife@wk",
            EventKind::Focus,
            "doc-brief",
            T0 + 60_000
        ));
        assert_eq!(t.store.consent("aoife@wk"), Consent::No);
    }

    #[test]
    fn consent_is_an_attributed_dated_log() {
        let dir = tempfile::tempdir().unwrap();
        let t = ts(dir.path());
        t.store
            .set_consent("aoife@wk", "aoife@wk", true, T0)
            .unwrap();
        t.store
            .set_consent("aoife@wk", "aoife@wk", false, T0 + 5)
            .unwrap();
        let log = fs::read_to_string(dir.path().join("timesheets/aoife@wk/consent.jsonl")).unwrap();
        let rows: Vec<Value> = log
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["actor"], "aoife@wk");
        assert_eq!(rows[0]["action"], "consent yes");
        assert_eq!(rows[0]["at"], T0);
        assert_eq!(rows[1]["action"], "consent no");
    }

    #[test]
    fn a_document_open_for_a_set_time_is_one_session_of_that_length() {
        let dir = tempfile::tempdir().unwrap();
        let t = ts(dir.path());
        t.store.set_consent("p", "p", true, T0).unwrap();
        ev(&t, "p", EventKind::Open, "doc-brief", T0);
        for i in 1..=19 {
            ev(&t, "p", EventKind::Focus, "doc-brief", T0 + i * 30_000);
        }
        ev(&t, "p", EventKind::Close, "doc-brief", T0 + 600_000);
        let s = t.store.sessions("p", 0, i64::MAX);
        assert_eq!(s.len(), 1);
        assert_eq!(
            (s[0].job.as_str(), s[0].end - s[0].start),
            ("J001", 600_000)
        );
        assert!(!s[0].live);
    }

    #[test]
    fn only_the_focused_document_accrues_time() {
        let dir = tempfile::tempdir().unwrap();
        let t = ts(dir.path());
        t.store.set_consent("p", "p", true, T0).unwrap();
        // brief for 10 minutes, then research for 20; both "open", one focused at a time
        ev(&t, "p", EventKind::Open, "doc-brief", T0);
        for i in 1..20 {
            ev(&t, "p", EventKind::Focus, "doc-brief", T0 + i * 30_000);
        }
        ev(&t, "p", EventKind::Open, "doc-research", T0 + 600_000);
        work(&t, "p", "doc-research", T0 + 600_000, T0 + 1_800_000);
        let s = t.store.sessions("p", 0, i64::MAX);
        let ms = |doc: &str| {
            s.iter()
                .filter(|x| x.doc == doc)
                .map(|x| x.end - x.start)
                .sum::<i64>()
        };
        assert_eq!(ms("doc-brief"), 600_000);
        assert_eq!(ms("doc-research"), 1_200_000);
        assert_eq!(s.iter().filter(|x| x.live).count(), 0);
    }

    #[test]
    fn a_tab_that_goes_quiet_does_not_keep_earning() {
        let dir = tempfile::tempdir().unwrap();
        let t = ts(dir.path());
        t.store.set_consent("p", "p", true, T0).unwrap();
        ev(&t, "p", EventKind::Open, "doc-brief", T0);
        ev(&t, "p", EventKind::Focus, "doc-brief", T0 + 30_000);
        // the laptop shut; the next event is three hours later, on the same document
        ev(&t, "p", EventKind::Focus, "doc-brief", T0 + 3 * 3_600_000);
        let s = t.store.sessions("p", 0, i64::MAX);
        assert_eq!(s.len(), 2);
        assert_eq!(
            s[0].end - s[0].start,
            30_000,
            "the first ends where it last spoke"
        );
    }

    #[test]
    fn a_document_outside_a_job_is_not_kept() {
        let dir = tempfile::tempdir().unwrap();
        let t = ts(dir.path());
        t.store.set_consent("p", "p", true, T0).unwrap();
        ev(&t, "p", EventKind::Open, "doc-loose", T0);
        assert!(t.store.sessions("p", 0, i64::MAX).is_empty());
    }

    #[test]
    fn a_gap_between_two_sessions_of_one_job_is_flagged_with_that_job() {
        let dir = tempfile::tempdir().unwrap();
        let t = ts(dir.path());
        t.store.set_consent("p", "p", true, T0).unwrap();
        // 09:00-10:00 brief, 11:15-12:00 brief: 75 minutes between
        work(&t, "p", "doc-brief", T0, T0 + 3_600_000);
        work(
            &t,
            "p",
            "doc-brief",
            T0 + 3_600_000 + 4_500_000,
            T0 + 3_600_000 + 4_500_000 + 2_700_000,
        );
        let day = day_for(&t, "p", "2025-11-11", 0, &no_edits).unwrap();
        assert_eq!(day.gaps.len(), 1);
        assert_eq!(day.gaps[0].minutes, 75);
        assert_eq!(day.gaps[0].guess.as_ref().unwrap().job, "J001");
        assert_eq!(day.lines.len(), 1);
        assert_eq!(day.lines[0].minutes, 105);
        assert_eq!(day.lines[0].session_ids.len(), 2);
        // two different jobs either side: flagged, and no guess made up
        let two = [
            Session {
                id: "a".into(),
                doc: "d1".into(),
                job: "J001".into(),
                label: "Brief".into(),
                start: 0,
                end: 600_000,
                live: false,
            },
            Session {
                id: "b".into(),
                doc: "d2".into(),
                job: "J002".into(),
                label: "Brief".into(),
                start: 4_000_000,
                end: 4_600_000,
                live: false,
            },
        ];
        let g = gaps_of(&two, &[]);
        assert_eq!(g.len(), 1);
        assert!(g[0].guess.is_none());
    }

    #[test]
    fn a_person_who_said_no_fills_the_day_by_hand_and_confirms_it_the_same_way() {
        let dir = tempfile::tempdir().unwrap();
        let t = ts(dir.path());
        t.store.set_consent("p", "p", false, T0).unwrap();
        let mut state = t.store.day("p", "2025-11-11");
        state.0.added.push(Added {
            id: "a-1".into(),
            job: Some("J001".into()),
            label: "Brief".into(),
            minutes: 120,
            source: "hand".into(),
            session_ids: vec![],
            from: None,
        });
        t.store.save_day("p", "2025-11-11", &state).unwrap();
        let draft = day_for(&t, "p", "2025-11-11", 0, &no_edits).unwrap();
        assert_eq!(
            (draft.lines.len(), draft.total_minutes, draft.status),
            (1, 120, "draft")
        );
        assert!(draft.gaps.is_empty());
        // the same freeze a consenting person's confirm makes
        state.0.confirmed = Some(Confirmed {
            at: T0,
            lines: draft.lines.clone(),
        });
        t.store.save_day("p", "2025-11-11", &state).unwrap();
        let done = day_for(&t, "p", "2025-11-11", 0, &no_edits).unwrap();
        assert_eq!((done.status, done.total_minutes), ("confirmed", 120));
    }

    #[test]
    fn a_day_carries_no_score_rank_or_warning_of_any_kind() {
        let dir = tempfile::tempdir().unwrap();
        let t = ts(dir.path());
        for yes in [true, false] {
            t.store.set_consent("p", "p", yes, T0).unwrap();
            let day = serde_json::to_string(&day_for(&t, "p", "2025-11-11", 0, &no_edits).unwrap())
                .unwrap();
            for word in [
                "score",
                "rank",
                "rating",
                "utilis",
                "utiliz",
                "productiv",
                "warning",
                "behind",
                "compare",
                "penal",
            ] {
                assert!(!day.to_lowercase().contains(word), "{word} in {day}");
            }
        }
    }

    #[test]
    fn a_confirmed_day_can_change_until_the_friday_on_or_after_it() {
        let tue = NaiveDate::from_ymd_opt(2025, 11, 11).unwrap();
        assert_eq!(editable_until(tue).to_string(), "2025-11-14");
        let fri = NaiveDate::from_ymd_opt(2025, 11, 14).unwrap();
        assert_eq!(editable_until(fri), fri);
        let sat = NaiveDate::from_ymd_opt(2025, 11, 15).unwrap();
        assert_eq!(editable_until(sat).to_string(), "2025-11-21");
    }

    #[test]
    fn erasing_one_person_removes_their_sessions_and_leaves_the_consent_record() {
        let dir = tempfile::tempdir().unwrap();
        let t = ts(dir.path());
        t.store.set_consent("p", "p", true, T0).unwrap();
        t.store.set_consent("q", "q", true, T0).unwrap();
        ev(&t, "p", EventKind::Open, "doc-brief", T0);
        ev(&t, "q", EventKind::Open, "doc-brief", T0);
        t.store.erase("p").unwrap();
        assert!(t.store.sessions("p", 0, i64::MAX).is_empty());
        assert_eq!(
            t.store.consent("p"),
            Consent::Yes,
            "the record that p was asked stays"
        );
        assert_eq!(
            t.store.sessions("q", 0, i64::MAX).len(),
            1,
            "another person is untouched"
        );
    }
}
