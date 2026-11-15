// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! First day (features/first-day.clan): an admin invites a person who is already on the People page, and the
//! person's first sign-in is explained once.
//!
//! An invite is a [`FirstDayRec`] on a person in the one People store (people.rs): the date it was made, an
//! optional first document on a live job of the person's own agency, and three booleans (signed in, saw the
//! pointers, pressed the first task). It is made and withdrawn through the store's own change path, so each
//! change is on `changes.jsonl` and the agency's audit chain before the store takes it; the three booleans
//! are marks the person makes on themselves and write no line, so no time of first use is kept anywhere.
//!
//! The link carries the sign-in name and nothing else: `/?welcome=<name>`. It holds no token, no signature and
//! no session and grants nothing. Who a person is and what they may do comes from the People store at sign-in,
//! as for anyone (live.rs). Inviting never adds a person or a role: a name that is not on the list is not found.
//!
//! Who may call: [`crate::admin::scope`], from the session alone. A Napkin admin invites anyone; an admin of an
//! agency invites their own people; anyone else gets 403. For an agency's admin a person of another agency, a
//! person nobody holds and an agency nobody holds all answer alike.
//!
//! The first task is a web-level need built as the timesheet reminder is (needs.rs): from the caller's own
//! record, in the answer of `GET /needs`, for the invited person alone.

use std::sync::Arc;

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Json, Router};
use napkin_host::jobindex::{Audience, JobIndex, Need};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::admin::{acct, answer, body, in_scope, refused, scope, Who};
use crate::auth::Account;
use crate::mail::Message;
use crate::people::{FirstDayRec, FirstRef, People, Refusal};
use crate::state::AppCtx;
use crate::tenant::TenantId;

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route(
            "/admin/people/{id}/first-day",
            axum::routing::post(make).delete(withdraw),
        )
        .route("/admin/first-days", get(list))
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

// ── the store's side: methods on the one People store ───────────────────────

impl People {
    /// The first-day record of `person`, when one was made and the person is still on the list.
    pub fn first_day(&self, person: &str) -> Option<FirstDayRec> {
        let book = self.book();
        book.person(person).filter(|p| p.active())?;
        book.first_days.iter().find(|f| f.person == person).cloned()
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
                made_on: chrono::Utc::now().format("%Y-%m-%d").to_string(),
                first,
                signed_in: false,
                seen: false,
                opened: false,
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

    /// The person's own mark: signed in, saw the pointers, pressed the first task. A mark only: it changes
    /// nobody's access and writes no line, so no time of use is kept. Not found when there is no record.
    pub fn mark_first_day(
        &self,
        person: &str,
        signed_in: bool,
        seen: bool,
        opened: bool,
    ) -> Result<(), Refusal> {
        self.change(person, "first day marked", |book| {
            let Some(rec) = book.first_days.iter_mut().find(|f| f.person == person) else {
                return Err(Refusal::NotFound("There is no first day to mark.".into()));
            };
            rec.signed_in |= signed_in;
            rec.seen |= seen;
            rec.opened |= opened;
            Ok(((), Value::Array(Vec::new())))
        })
    }
}

/// A sign-in succeeded for `username`: an invited person is marked as signed in (a yes, no date).
pub fn note_sign_in(ctx: &AppCtx, username: &str) {
    let Some(people) = ctx.people() else { return };
    let waiting = people
        .book()
        .first_days
        .iter()
        .any(|f| f.person == username && !f.signed_in);
    if waiting {
        let _ = people.mark_first_day(username, true, false, false);
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
    /// Where to also mail the link, when mail is on. Checked as an address and kept nowhere.
    #[serde(default)]
    email: Option<String>,
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
    let Some(agency) = people.book().person(&id).map(|p| p.agency.clone()) else {
        return refused(Refusal::NotFound(format!("{id} is not on the list.")));
    };
    let email = match b.email.as_deref().map(str::trim).filter(|e| !e.is_empty()) {
        Some(e) => match napkin_host::agency::clean_email(e) {
            Ok(e) => Some(e),
            Err(_) => return answer(StatusCode::BAD_REQUEST, "An address looks like name@place."),
        },
        None => None,
    };
    // the first document must be one of a live job in the person's own agency's workspace, whoever asks
    let first = match b.first {
        None => None,
        Some(f) => match first_ref(&ctx, &agency, f.path.trim()) {
            Ok(r) => Some(r),
            Err(r) => return *r,
        },
    };
    let rec = match people.invite(&by, &id, first) {
        Ok(r) => r,
        Err(e) => return refused(e),
    };
    let url = link_for(&origin_of(&headers), &id);
    let mailed = match &email {
        Some(to) if ctx.mail.enabled() => {
            let day = (chrono::Utc::now().timestamp().max(0) / 86_400) as u64;
            let m = Message::Invite {
                to: to.clone(),
                agency: agency_name(people, &agency),
                url: url.clone(),
            };
            ctx.mail
                .send(TenantId::of_agency(&agency).as_str(), day, &m)
                .is_ok()
        }
        _ => false,
    };
    let mut out = json!({ "person": rec.person, "link": url, "mailed": mailed });
    if let Some(f) = &rec.first {
        out["first"] = json!({ "job": f.job, "path": f.path });
    }
    (StatusCode::CREATED, Json(out)).into_response()
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

/// `GET /admin/first-days`: who was invited, when it was made (a date) and whether they have signed in. No
/// other field, and nobody is listed by how long anything took.
async fn list(State(ctx): State<Arc<AppCtx>>, who: Who) -> Response {
    let (people, _, scope) = match scope(&ctx, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let rows: Vec<Value> = people
        .book()
        .first_days
        .iter()
        .filter(|f| scope.covers(&f.agency))
        .map(|f| json!({ "person": f.person, "made_on": f.made_on, "signed_in": f.signed_in }))
        .collect();
    Json(rows).into_response()
}

// ── the person's own routes ─────────────────────────────────────────────────

/// `GET /t/{tenant}/me/first-day`: whether this person's pointers are still to show. Only an invited person who
/// has not seen them reads true; everyone else, and anyone signed out, reads false.
async fn mine(State(ctx): State<Arc<AppCtx>>, user: Option<Extension<Account>>) -> Response {
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
    match people.mark_first_day(&me.username, false, b.seen, b.opened) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => refused(e),
    }
}

// ── the first task ──────────────────────────────────────────────────────────

/// The invited person's first task: the document named on the invite, on a live job, until its button is pressed.
/// Its words are the allow list (the job's number, its client and the document's title). None when there is no
/// record, no document named, the button was pressed, or the document is no longer on a job.
pub fn first_task(ctx_people: &People, index: &JobIndex, user: &Account) -> Option<Need> {
    let rec = ctx_people.first_day(&user.username)?;
    if rec.opened {
        return None;
    }
    let first = rec.first?;
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
