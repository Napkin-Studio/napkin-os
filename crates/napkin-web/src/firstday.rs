// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! First day (features/first-day.clan): an admin invites a person who is already on the People page, and the
//! person's first sign-in is explained once.
//!
//! An invite is a [`FirstDayRec`] on a person in the one People store (people.rs): the date it was made, by whom and an
//! optional first document on a live job of the person's own agency. It is made and withdrawn through the store's own
//! change path, so each change is on `changes.jsonl` and the agency's audit chain before the store takes it. It holds
//! nothing of what the person does afterwards.
//!
//! The person's own two marks (saw the pointers, pressed the first task) are in `first-day-marks.json` beside the
//! store, written whole with tmp and rename, and not at all when a mark changes nothing. They are the person's own
//! flags, not a change to who may sign in, so they take no change number and write no line (no time of use is kept
//! here); keeping them out of `people.json` means a mark can never revert an admin's change when two web tasks write.
//! No route tells an admin what a person has done since the invite (the agency's audit chain keeps sign-in lines by
//! an older design; see the record's open questions).
//!
//! The link carries the sign-in name and nothing else: `/?welcome=<name>`. It holds no token, no signature and no session
//! and grants nothing. Who a person is and what they may do comes from the People store at sign-in, as for anyone
//! (live.rs). Inviting never adds a person or a role: a name that is not on the list is not found.
//!
//! Mail (optional, `{mail: true}`): to the address the People store holds for the person, never one from the request,
//! with a link built from the server's own `NAPKIN_PUBLIC_ORIGIN`, never a request header; at most one a person a
//! day; the address is kept nowhere new. When no mail is sent the answer says why and the link is still given to copy.
//!
//! Who may call: [`crate::admin::scope`], from the session alone. A Napkin admin invites anyone; an admin of an
//! agency invites their own people; anyone else gets 403. For an agency's admin a person of another agency, a
//! person nobody holds and an agency nobody holds all answer alike. A first document may be named only by an admin
//! of the person's own agency, so no one learns of another agency's documents.
//!
//! The first task is a web-level need built as the timesheet reminder is (needs.rs): from the caller's own
//! record, in the answer of `GET /needs`, for the invited person alone.

use std::collections::BTreeMap;
use std::path::Path as FsPath;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Json, Router};
use napkin_host::jobindex::{Audience, JobIndex, Need};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::admin::{acct, answer, body, in_scope, refused, scope, Who};
use crate::auth::Account;
use crate::mail::Message;
use crate::people::{FirstDayRec, FirstRef, People, Refusal};
use crate::state::AppCtx;
use crate::tenant::{Tenant, TenantId};

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route(
            "/admin/people/{id}/first-day",
            axum::routing::post(make).delete(withdraw),
        )
        .route("/t/{tenant}/me/first-day", get(mine).post(mark))
}

/// The link an invite answers: the address of the studio and the sign-in name. One function, so a later
/// record that signs the person in has one place to change.
pub fn link_for(origin: &str, person: &str) -> String {
    format!("{origin}/?welcome={person}")
}

/// `http(s)://host` from the request, or nothing when the host is not one (the link is then the path alone).
fn origin_of(headers: &HeaderMap) -> String {
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .trim();
    let plain = !host.is_empty()
        && host.len() <= 255
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'));
    if !plain {
        return String::new();
    }
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|h| h.to_str().ok())
        .and_then(|p| p.split(',').next())
        .map(str::trim)
        .filter(|p| matches!(*p, "http" | "https"))
        .unwrap_or("http");
    format!("{proto}://{host}")
}

// ── the store's side: methods on the one People store, and the marks file beside it ──

/// One person's marks and when an invite mail last went to them (a date, no address).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Mark {
    /// The record these marks belong to; a new invite has a new one and the marks start again.
    #[serde(default)]
    rev: u64,
    #[serde(default)]
    seen: bool,
    #[serde(default)]
    opened: bool,
    /// `YYYY-MM-DD`: one invite mail a person a day, however many invites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mailed_on: Option<String>,
}

const MARKS_FILE: &str = "first-day-marks.json";
static MARKS_LOCK: Mutex<()> = Mutex::new(());

fn read_marks(dir: &FsPath) -> BTreeMap<String, Mark> {
    std::fs::read(dir.join(MARKS_FILE))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_marks(dir: &FsPath, marks: &BTreeMap<String, Mark>) -> Result<(), Refusal> {
    let io = |e: std::io::Error| Refusal::Io(e.to_string());
    let tmp = dir.join(format!(".{MARKS_FILE}.{}.tmp", std::process::id()));
    std::fs::write(
        &tmp,
        serde_json::to_vec(marks).map_err(|e| Refusal::Io(e.to_string()))?,
    )
    .map_err(io)?;
    std::fs::rename(&tmp, dir.join(MARKS_FILE)).map_err(io)
}

/// A first day as the person lives it: the record and their own marks for it.
#[derive(Clone, Debug)]
pub struct FirstDay {
    pub rec: FirstDayRec,
    pub seen: bool,
    pub opened: bool,
}

fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

impl People {
    /// The first day of `person`, when one was made and the person is still on the list.
    pub fn first_day(&self, person: &str) -> Option<FirstDay> {
        let book = self.book();
        book.person(person).filter(|p| p.active())?;
        let rec = book
            .first_days
            .iter()
            .find(|f| f.person == person)
            .cloned()?;
        let _g = MARKS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mark = read_marks(self.dir())
            .remove(person)
            .filter(|m| m.rev == rec.rev);
        let (seen, opened) = mark.map_or((false, false), |m| (m.seen, m.opened));
        Some(FirstDay { rec, seen, opened })
    }

    /// Make (or make again, from the start) the first-day record of `person`. On the change log and the audit
    /// chain before the store takes it.
    pub fn invite(
        &self,
        by: &str,
        person: &str,
        first: Option<FirstRef>,
    ) -> Result<FirstDayRec, Refusal> {
        self.change(by, "first day invited", |book| {
            let Some(p) = book.people.iter().find(|p| p.id == person && p.active()) else {
                return Err(Refusal::NotFound(format!("{person} is not on the list.")));
            };
            let rec = FirstDayRec {
                person: p.id.clone(),
                agency: p.agency.clone(),
                made_by: by.to_string(),
                made_on: today(),
                first,
                rev: chrono::Utc::now()
                    .timestamp_nanos_opt()
                    .unwrap_or_default()
                    .unsigned_abs(),
            };
            book.first_days.retain(|f| f.person != person);
            book.first_days.push(rec.clone());
            let line = json!({ "person": rec.person, "agency": rec.agency,
                "after": { "first_job": rec.first.as_ref().map(|f| f.job.clone()) } });
            Ok((rec, line))
        })
    }

    /// Withdraw the record; not found when there is none.
    pub fn withdraw_first_day(&self, by: &str, person: &str) -> Result<(), Refusal> {
        self.change(by, "first day withdrawn", |book| {
            let Some(rec) = book.first_days.iter().find(|f| f.person == person).cloned() else {
                return Err(Refusal::NotFound(format!("{person} has no first day.")));
            };
            book.first_days.retain(|f| f.person != person);
            Ok((
                (),
                json!({ "person": rec.person, "agency": rec.agency, "before": { "first_job": rec.first.map(|f| f.job) } }),
            ))
        })
    }

    /// The person's own mark: saw the pointers, or pressed the first task. Nothing is written when it changes
    /// nothing. Not found when there is no record.
    pub fn mark_first_day(&self, person: &str, seen: bool, opened: bool) -> Result<(), Refusal> {
        let Some(day) = self.first_day(person) else {
            return Err(Refusal::NotFound("There is no first day to mark.".into()));
        };
        let _g = MARKS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut all = read_marks(self.dir());
        let mine = all.entry(person.to_string()).or_default();
        let before = mine.clone();
        if mine.rev != day.rec.rev {
            *mine = Mark {
                rev: day.rec.rev,
                mailed_on: mine.mailed_on.take(),
                ..Mark::default()
            };
        }
        mine.seen |= seen;
        mine.opened |= opened;
        if *mine == before {
            return Ok(());
        }
        write_marks(self.dir(), &all)
    }

    /// Whether an invite mail already went to `person` today.
    fn mailed_today(&self, person: &str) -> bool {
        let _g = MARKS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        read_marks(self.dir())
            .get(person)
            .and_then(|m| m.mailed_on.as_deref())
            == Some(today().as_str())
    }

    /// An invite mail went to `person` today: a date, never the address.
    fn note_mailed(&self, person: &str) -> Result<(), Refusal> {
        let _g = MARKS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut all = read_marks(self.dir());
        all.entry(person.to_string()).or_default().mailed_on = Some(today());
        write_marks(self.dir(), &all)
    }
}

// ── the admin's routes ──────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FirstIn {
    path: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InviteBody {
    #[serde(default)]
    first: Option<FirstIn>,
    /// Also mail the link, to the address the People store holds for the person.
    #[serde(default)]
    mail: bool,
}

/// The agency's display name, for the mail's "from" line.
fn agency_name(people: &People, id: &str) -> Option<String> {
    let book = people.book();
    book.names
        .get(id)
        .map(|n| n.name.clone())
        .or_else(|| crate::people::code_name(id).map(String::from))
        .or_else(|| book.agency(id).map(|a| a.name.clone()))
}

/// `POST /admin/people/{id}/first-day` `{first?: {path}, email?}`: the link to give the person.
async fn make(
    State(ctx): State<Arc<AppCtx>>,
    who: Who,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(v): Json<Value>,
) -> Response {
    let (people, by, scope) = match scope(&ctx, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let id = match in_scope(people, &scope, &id) {
        Ok(id) => id,
        Err(r) => return *r,
    };
    let b: InviteBody = match body(v) {
        Ok(b) => b,
        Err(r) => return *r,
    };
    let Some(person) = people.book().person(&id).cloned() else {
        return refused(Refusal::NotFound(format!("{id} is not on the list.")));
    };
    let agency = person.agency.clone();
    // the first document must be one of a live job in the person's own agency's workspace, and only an admin of that
    // agency may name one: a present and an absent path answer the same to anyone else
    let first = match b.first {
        None => None,
        Some(f) => {
            if acct(&who).map(|a| a.agency.as_str()) != Some(agency.as_str()) {
                return answer(
                    StatusCode::BAD_REQUEST,
                    "That is not a document on a live job of this agency.",
                );
            }
            match first_ref(&ctx, &agency, f.path.trim()) {
                Ok(r) => Some(r),
                Err(r) => return *r,
            }
        }
    };
    let rec = match people.invite(&by, &id, first) {
        Ok(r) => r,
        Err(e) => return refused(e),
    };
    // the link the admin copies: the studio's own address when it is set, else the address they are using
    let copy_origin = ctx
        .public_origin
        .clone()
        .unwrap_or_else(|| origin_of(&headers));
    let url = link_for(&copy_origin, &id);
    let (mailed, note) = if b.mail {
        send_mail(&ctx, people, &person, &agency)
    } else {
        (false, None)
    };
    let mut out = json!({ "person": rec.person, "link": url, "mailed": mailed });
    if let Some(n) = note {
        out["note"] = json!(n);
    }
    if let Some(f) = &rec.first {
        out["first"] = json!({ "job": f.job, "path": f.path });
    }
    (StatusCode::CREATED, Json(out)).into_response()
}

/// Mail the invite to the address the store holds, if every condition holds; else say plainly why not.
fn send_mail(
    ctx: &AppCtx,
    people: &People,
    person: &crate::people::PersonRec,
    agency: &str,
) -> (bool, Option<String>) {
    let no = |why: &str| (false, Some(why.to_string()));
    if !ctx.mail.enabled() {
        return no("Mail is not set up on this server. Copy the link and send it yourself.");
    }
    let Some(origin) = ctx.public_origin.as_deref() else {
        return no(
            "The studio's public address is not set, so no mail was sent. Copy the link instead.",
        );
    };
    let Some(to) = person.email.as_deref().filter(|e| !e.trim().is_empty()) else {
        return no("No address is held for them, so nothing was mailed. Add one on their row, or copy the link.");
    };
    if people.mailed_today(&person.id) {
        return no("An invite was already mailed to them today. Copy the link instead.");
    }
    let day = (chrono::Utc::now().timestamp().max(0) / 86_400) as u64;
    let m = Message::Invite {
        to: to.to_string(),
        agency: agency_name(people, agency),
        url: link_for(origin, &person.id),
    };
    match ctx.mail.send(TenantId::of_agency(agency).as_str(), day, &m) {
        Ok(()) => {
            let _ = people.note_mailed(&person.id);
            (
                true,
                Some("Mailed to the address held for them.".to_string()),
            )
        }
        Err(_) => no("The mail could not be sent. Copy the link instead."),
    }
}

/// The job and path of a document that is on a job of `agency`; 400 for anything else.
fn first_ref(ctx: &AppCtx, agency: &str, path: &str) -> Result<FirstRef, Box<Response>> {
    let not_one = || {
        Box::new(answer(
            StatusCode::BAD_REQUEST,
            "That is not a document on a live job of this agency.",
        ))
    };
    if path.is_empty() || path.len() > 600 {
        return Err(not_one());
    }
    let ws = ctx.workspace(&TenantId::of_agency(agency));
    let index = crate::api::job_index(&ws).map_err(|_| not_one())?;
    index
        .jobs
        .iter()
        .find(|j| j.documents.iter().any(|d| d.path == path))
        .map(|j| FirstRef {
            job: j.number.clone(),
            path: path.to_string(),
        })
        .ok_or_else(not_one)
}

/// `DELETE /admin/people/{id}/first-day`: withdraw the invite.
async fn withdraw(
    State(ctx): State<Arc<AppCtx>>,
    who: Who,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    let (people, by, scope) = match scope(&ctx, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let id = match in_scope(people, &scope, &id) {
        Ok(id) => id,
        Err(r) => return *r,
    };
    match people.withdraw_first_day(&by, &id) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => refused(e),
    }
}

// ── the person's own routes ─────────────────────────────────────────────────

/// `GET /t/{tenant}/me/first-day`: whether this person's pointers are still to show. Only an invited person who
/// has not seen them reads true; everyone else, and anyone signed out, reads false.
async fn mine(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(_): Tenant,
    user: Option<Extension<Account>>,
) -> Response {
    let show = user
        .zip(ctx.people())
        .and_then(|(Extension(a), p)| p.first_day(&a.username))
        .is_some_and(|f| !f.seen);
    Json(json!({ "show_pointers": show })).into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MarkBody {
    #[serde(default)]
    seen: bool,
    #[serde(default)]
    opened: bool,
}

/// `POST /t/{tenant}/me/first-day` `{seen: true}` or `{opened: true}`: the caller's own mark, on every device.
/// The body names no one: a mark is always the session's person's.
async fn mark(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(_): Tenant,
    user: Option<Extension<Account>>,
    Json(v): Json<Value>,
) -> Response {
    let b: MarkBody = match body(v) {
        Ok(b) => b,
        Err(r) => return *r,
    };
    let Some(Extension(me)) = user else {
        return answer(StatusCode::FORBIDDEN, "Sign in first.");
    };
    let Some(people) = ctx.people() else {
        return answer(
            StatusCode::NOT_FOUND,
            "This server keeps no list of people.",
        );
    };
    if !b.seen && !b.opened {
        return answer(StatusCode::BAD_REQUEST, "Say what was seen or opened.");
    }
    if people.first_day(&me.username).is_none() {
        return answer(StatusCode::NOT_FOUND, "There is no first day to mark.");
    }
    match people.mark_first_day(&me.username, b.seen, b.opened) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => refused(e),
    }
}

// ── the first task ──────────────────────────────────────────────────────────

/// The invited person's first task: the document named on the invite, on a live job, until its button is pressed.
/// Its words are the allow list (the job's number, its client and the document's title). None when there is no
/// record, no document named, the button was pressed, or the document is no longer on a job.
pub fn first_task(ctx_people: &People, index: &JobIndex, user: &Account) -> Option<Need> {
    let day = ctx_people.first_day(&user.username)?;
    if day.opened {
        return None;
    }
    let first = day.rec.first?;
    let job = index
        .jobs
        .iter()
        .find(|j| j.documents.iter().any(|d| d.path == first.path))?;
    let doc = job.documents.iter().find(|d| d.path == first.path)?;
    Some(Need {
        id: format!("first:{}", user.username),
        kind: "first-task",
        stage: String::new(),
        days_late: None,
        job: job.number.clone(),
        client: job.client.name.clone(),
        client_id: job.client.id.clone(),
        text: format!("Start with {}", doc.title),
        action: "Open".into(),
        path: first.path,
        due: job.due.clone(),
        due_source: "job",
        urgent: false,
        can_done: true,
        audience: Audience::Person(user.username.clone()),
    })
}
