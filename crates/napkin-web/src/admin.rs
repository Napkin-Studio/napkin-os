// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The People page's routes (features/people-admin.clan): who may sign in,
//! and the agencies they belong to. Every `/admin/*` route answers 403 unless
//! the signed-in person is one of [`PEOPLE_ADMINS`]; the agencies' looks are
//! public, for the shell's look registry.

use std::sync::Arc;

use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch};
use axum::{Extension, Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth::{Account, Provider};
use crate::people::{
    is_admin, AgencyRec, NewAgency, NewPerson, People, Refusal, CODE_AGENCIES, PEOPLE_ADMINS,
};
use crate::state::AppCtx;
use crate::tenant::{Identity, Mode};

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/admin/people", get(list_people).post(add_person))
        .route(
            "/admin/people/{id}",
            patch(rename_person).delete(remove_person),
        )
        .route("/admin/agencies", get(list_agencies).post(add_agency))
        .route("/agency-looks", get(agency_looks))
}

fn answer(status: StatusCode, msg: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "ok": false, "error": msg })),
    )
        .into_response()
}

fn refused(r: Refusal) -> Response {
    match r {
        Refusal::Bad(m) => answer(StatusCode::BAD_REQUEST, &m),
        Refusal::Conflict(m) => answer(StatusCode::CONFLICT, &m),
        Refusal::NotFound(m) => answer(StatusCode::NOT_FOUND, &m),
        Refusal::Io(m) => {
            tracing::error!(target: "napkin_web::people", error = %m, "people store");
            answer(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The people store could not be changed.",
            )
        }
    }
}

fn store(identity: &Identity) -> Option<&People> {
    match &identity.mode {
        Mode::Accounts {
            provider: Provider::Roster(r),
            ..
        } => Some(r.people()),
        _ => None,
    }
}

/// The store and the admin acting on it; 403 for anyone not in PEOPLE_ADMINS,
/// 404 where this server keeps no people store (no roster).
fn admin<'a>(
    identity: &'a Identity,
    account: Option<&Account>,
) -> Result<(&'a People, String), Box<Response>> {
    let who = account.map(|a| a.username.clone()).unwrap_or_default();
    if !is_admin(&who) {
        tracing::warn!(target: "napkin_web::people", account = %who, "refused: not a people admin");
        return Err(Box::new(answer(
            StatusCode::FORBIDDEN,
            "Only a Napkin admin can change who signs in. Ask Shrey or another admin.",
        )));
    }
    let people = store(identity).ok_or_else(|| {
        Box::new(answer(
            StatusCode::NOT_FOUND,
            "This server keeps no list of people.",
        ))
    })?;
    Ok((people, who))
}

type Who = Option<Extension<Account>>;
type Id = Extension<Arc<Identity>>;

fn acct(w: &Who) -> Option<&Account> {
    w.as_ref().map(|Extension(a)| a)
}

/// One agency as the page lists it: its look, where it is kept, how many people are in it.
#[derive(Serialize)]
struct AgencyView {
    id: String,
    name: String,
    base: String,
    accent: String,
    aliases: Vec<String>,
    /// `code`: the shell's registry (with its logo); `added`: added from the People page.
    source: &'static str,
    people: usize,
}

fn agencies_of(people: &People) -> Vec<AgencyView> {
    let book = people.book();
    let count = |id: &str| {
        book.people
            .iter()
            .filter(|p| p.active() && p.agency == id)
            .count()
    };
    let mut out: Vec<AgencyView> = CODE_AGENCIES
        .iter()
        .map(|(id, name, base, accent)| AgencyView {
            id: id.to_string(),
            name: name.to_string(),
            base: base.to_string(),
            accent: accent.to_string(),
            aliases: crate::people::CODE_ALIASES
                .iter()
                .filter(|(_, to)| to == id)
                .map(|(a, _)| a.to_string())
                .collect(),
            source: "code",
            people: count(id),
        })
        .collect();
    out.extend(book.agencies.iter().map(|a| AgencyView {
        id: a.id.clone(),
        name: a.name.clone(),
        base: a.base.clone(),
        accent: a.accent.clone(),
        aliases: a.aliases.clone(),
        source: "added",
        people: count(&a.id),
    }));
    out
}

async fn list_people(Extension(identity): Id, who: Who) -> Response {
    let (people, _) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let book = people.book();
    Json(serde_json::json!({
        "people": book.people,
        "agencies": agencies_of(people),
        "admins": PEOPLE_ADMINS,
    }))
    .into_response()
}

async fn add_person(Extension(identity): Id, who: Who, Json(b): Json<NewPerson>) -> Response {
    let (people, by) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    match people.add(&by, &b) {
        Ok(p) => (StatusCode::CREATED, Json(p)).into_response(),
        Err(e) => refused(e),
    }
}

#[derive(Deserialize)]
struct Rename {
    name: String,
}

async fn rename_person(
    Extension(identity): Id,
    who: Who,
    Path(id): Path<String>,
    Json(b): Json<Rename>,
) -> Response {
    let (people, by) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    match people.rename(&by, &id.trim().to_ascii_lowercase(), &b.name) {
        Ok(p) => Json(p).into_response(),
        Err(e) => refused(e),
    }
}

async fn remove_person(Extension(identity): Id, who: Who, Path(id): Path<String>) -> Response {
    let (people, by) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    match people.remove(&by, &id.trim().to_ascii_lowercase()) {
        Ok(p) => Json(p).into_response(),
        Err(e) => refused(e),
    }
}

async fn list_agencies(Extension(identity): Id, who: Who) -> Response {
    match admin(&identity, acct(&who)) {
        Ok((people, _)) => Json(agencies_of(people)).into_response(),
        Err(r) => *r,
    }
}

async fn add_agency(Extension(identity): Id, who: Who, Json(b): Json<NewAgency>) -> Response {
    let (people, by) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    match people.add_agency(&by, &b) {
        Ok(a) => (StatusCode::CREATED, Json(a)).into_response(),
        Err(e) => refused(e),
    }
}

/// An added agency's look, as the shell's registry takes it: no people, no history.
#[derive(Serialize)]
struct Look {
    id: String,
    name: String,
    base: String,
    accent: String,
    aliases: Vec<String>,
}

/// The looks of the agencies added from the People page (the shell's own
/// registry has the rest). Public: the sign-in card wears them too.
async fn agency_looks(Extension(identity): Id) -> Json<Vec<Look>> {
    let added: Vec<AgencyRec> = store(&identity)
        .map(|p| p.book().agencies)
        .unwrap_or_default();
    Json(
        added
            .into_iter()
            .map(|a| Look {
                id: a.id,
                name: a.name,
                base: a.base,
                accent: a.accent,
                aliases: a.aliases,
            })
            .collect(),
    )
}
