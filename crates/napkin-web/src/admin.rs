// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The People page's routes (features/people-admin.clan): who may sign in,
//! and the agencies they belong to. Every `/admin/*` route answers 403 unless
//! the signed-in person is one of [`PEOPLE_ADMINS`]; the agencies' published
//! looks are public, for the shell's look registry. Agencies come in two tiers
//! (features/agency-looks-admin.clan): basic ones, drafted and published here
//! with a wordmark, and ones in code, whose display name alone changes here.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::Path;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post, put};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{Account, Provider};
use crate::people::{
    code_name, is_admin, Book, DraftEdit, NewAgency, NewPerson, People, Publish, Refusal, Wordmark,
    CODE_AGENCIES, CODE_ALIASES, PEOPLE_ADMINS,
};
use crate::state::AppCtx;
use crate::svg_sanitise::{self, svg_uri, Refused};
use crate::tenant::{Identity, Mode};

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/admin/people", get(list_people).post(add_person))
        .route(
            "/admin/people/{id}",
            patch(rename_person).delete(remove_person),
        )
        .route("/admin/agencies", get(list_agencies).post(add_agency))
        .route(
            "/admin/agencies/{id}/draft",
            patch(edit_draft).delete(discard_draft),
        )
        .route(
            "/admin/agencies/{id}/draft/wordmark",
            put(put_wordmark).delete(delete_wordmark),
        )
        .route("/admin/agencies/{id}/publish", post(publish))
        .route("/admin/agencies/{id}/name", delete(reset_name))
        .route("/admin/agencies/{id}/export", get(export_agency))
        .route(
            "/agency-looks",
            get(agency_looks).layer(axum::middleware::from_fn(crate::etag::revalidate)),
        )
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

/// A kept wordmark as the shell takes it (`data:image/svg+xml,...`); None when the file is missing.
fn wordmark_uri(people: &People, id: &str, w: Option<&Wordmark>) -> Option<String> {
    w.and_then(|w| people.wordmark_svg(id, w))
        .map(|svg| svg_uri(&svg))
}

/// One agency as the page lists it. A basic agency: its published look,
/// whether it is published, its draft merged into a whole look (or null),
/// how many people are in it, its rev and history. An agency in code: only
/// its names (the look is palette.ts's).
fn agency_row(people: &People, book: &Book, id: &str) -> Option<Value> {
    let count = book
        .people
        .iter()
        .filter(|p| p.active() && p.agency == id)
        .count();
    if let Some(code) = code_name(id) {
        let n = book.names.get(id);
        return Some(json!({
            "id": id,
            "kind": "code",
            "name": n.map_or(code, |n| n.name.as_str()),
            "code_name": code,
            "aliases": CODE_ALIASES.iter().filter(|(_, to)| *to == id).map(|(a, _)| *a).collect::<Vec<_>>(),
            "draft": n.and_then(|n| n.draft_name.as_ref()).map(|d| json!({ "name": d })),
            "people": count,
            "rev": n.map_or(0, |n| n.rev),
            "changed_by": n.and_then(|n| n.changed_by.clone()),
            "changed_at": n.and_then(|n| n.changed_at.clone()),
            "published_by": n.and_then(|n| n.published_by.clone()),
            "published_at": n.and_then(|n| n.published_at.clone()),
        }));
    }
    let a = book.agency(id)?;
    let draft = a.drafted().map(|d| {
        json!({
            "name": d.name,
            "aliases": d.aliases,
            "base": d.base,
            "accent": d.accent,
            "wordmark": wordmark_uri(people, id, d.wordmark.as_ref()),
        })
    });
    Some(json!({
        "id": a.id,
        "kind": "basic",
        "name": a.name,
        "aliases": a.aliases,
        "base": a.base,
        "accent": a.accent,
        "wordmark": wordmark_uri(people, id, a.wordmark.as_ref()),
        "published": a.published,
        "draft": draft,
        "people": count,
        "rev": a.rev,
        "added_by": a.added_by,
        "added_at": a.added_at,
        "changed_by": a.changed_by,
        "changed_at": a.changed_at,
        "published_by": a.published_by,
        "published_at": a.published_at,
    }))
}

fn agencies_of(people: &People) -> Vec<Value> {
    let book = people.book();
    CODE_AGENCIES
        .iter()
        .map(|(id, ..)| *id)
        .chain(book.agencies.iter().map(|a| a.id.as_str()))
        .filter_map(|id| agency_row(people, &book, id))
        .collect()
}

/// The agency's row after a change, or 404 when it is not there.
fn row_after(people: &People, id: &str) -> Response {
    match agency_row(people, &people.book(), id) {
        Some(r) => Json(r).into_response(),
        None => answer(StatusCode::NOT_FOUND, &format!("There is no agency {id}.")),
    }
}

/// A JSON body read into `T`, any shape error a `400` in plain words (axum's own would be `422`).
fn body<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, Box<Response>> {
    serde_json::from_value(v).map_err(|e| {
        Box::new(answer(
            StatusCode::BAD_REQUEST,
            &format!("The request is not one this route takes: {e}."),
        ))
    })
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

async fn add_agency(Extension(identity): Id, who: Who, Json(b): Json<Value>) -> Response {
    let (people, by) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let req: NewAgency = match body(b) {
        Ok(r) => r,
        Err(r) => return *r,
    };
    match people.add_agency(&by, &req) {
        Ok(a) => match agency_row(people, &people.book(), &a.id) {
            Some(r) => (StatusCode::CREATED, Json(r)).into_response(),
            None => answer(StatusCode::NOT_FOUND, "The agency was not kept."),
        },
        Err(e) => refused(e),
    }
}

fn agency_id(id: &str) -> String {
    id.trim().to_ascii_lowercase()
}

async fn edit_draft(
    Extension(identity): Id,
    who: Who,
    Path(id): Path<String>,
    Json(b): Json<Value>,
) -> Response {
    let (people, by) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let req: DraftEdit = match body(b) {
        Ok(r) => r,
        Err(r) => return *r,
    };
    let id = agency_id(&id);
    match people.edit_draft(&by, &id, &req) {
        Ok(()) => row_after(people, &id),
        Err(e) => refused(e),
    }
}

async fn discard_draft(Extension(identity): Id, who: Who, Path(id): Path<String>) -> Response {
    let (people, by) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let id = agency_id(&id);
    match people.discard_draft(&by, &id) {
        Ok(()) => match agency_row(people, &people.book(), &id) {
            Some(r) => Json(r).into_response(),
            // never published: the agency went with its draft
            None => Json(json!({ "id": id, "removed": true })).into_response(),
        },
        Err(e) => refused(e),
    }
}

/// Why an upload was refused, as the route answers it.
fn upload_refused(r: Refused) -> Response {
    match r {
        Refused::TooBig(m) => answer(StatusCode::PAYLOAD_TOO_LARGE, &m),
        Refused::Active(found) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({
                "ok": false,
                "error": "The file has things in it that could run or reach out, so it was not kept.",
                "found": found,
            })),
        )
            .into_response(),
        Refused::Unusable(m) if m.starts_with("This is not an SVG") || m.contains("UTF-8") => {
            answer(StatusCode::UNSUPPORTED_MEDIA_TYPE, &m)
        }
        Refused::Unusable(m) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "ok": false, "error": m, "found": [] })),
        )
            .into_response(),
    }
}

async fn put_wordmark(
    Extension(identity): Id,
    who: Who,
    Path(id): Path<String>,
    headers: HeaderMap,
    raw: Body,
) -> Response {
    let (people, by) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let id = agency_id(&id);
    let book = people.book();
    if code_name(&id).is_some() {
        return answer(
            StatusCode::CONFLICT,
            "An agency in code keeps its logos in code; only its display name changes here.",
        );
    }
    if book.agency(&id).is_none() {
        return answer(StatusCode::NOT_FOUND, &format!("There is no agency {id}."));
    }
    let svg_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .is_some_and(|t| t.trim().eq_ignore_ascii_case("image/svg+xml"));
    if !svg_type {
        return answer(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Send the wordmark as an SVG file (image/svg+xml). PNG and other images are not taken.",
        );
    }
    let Ok(bytes) = axum::body::to_bytes(raw, svg_sanitise::RAW_MAX).await else {
        return answer(
            StatusCode::PAYLOAD_TOO_LARGE,
            &format!(
                "The file is bigger than {} KB, the most taken as sent.",
                svg_sanitise::RAW_MAX / 1024
            ),
        );
    };
    let cleaned = match svg_sanitise::clean_upload(&bytes) {
        Ok(c) => c,
        Err(r) => return upload_refused(r),
    };
    if let Err(e) = people.set_wordmark(&by, &id, &cleaned.svg) {
        return refused(e);
    }
    let rev = people.book().agency(&id).map_or(0, |a| a.rev);
    Json(json!({
        "bytes": bytes.len(),
        "kept_bytes": cleaned.svg.len(),
        "dropped": cleaned.dropped,
        "warnings": cleaned.warnings,
        "svg": svg_uri(&cleaned.svg),
        "rev": rev,
    }))
    .into_response()
}

async fn delete_wordmark(Extension(identity): Id, who: Who, Path(id): Path<String>) -> Response {
    let (people, by) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let id = agency_id(&id);
    match people.remove_wordmark(&by, &id) {
        Ok(()) => row_after(people, &id),
        Err(e) => refused(e),
    }
}

async fn publish(
    Extension(identity): Id,
    who: Who,
    Path(id): Path<String>,
    Json(b): Json<Value>,
) -> Response {
    let (people, by) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let req: Publish = match body(b) {
        Ok(r) => r,
        Err(r) => return *r,
    };
    let id = agency_id(&id);
    match people.publish(&by, &id, &req) {
        Ok(()) => row_after(people, &id),
        Err(e) => refused(e),
    }
}

async fn reset_name(Extension(identity): Id, who: Who, Path(id): Path<String>) -> Response {
    let (people, by) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let id = agency_id(&id);
    match people.reset_name(&by, &id) {
        Ok(()) => row_after(people, &id),
        Err(e) => refused(e),
    }
}

/// A string as a single-quoted TypeScript literal.
fn ts_str(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// A string as a Rust string literal's inside.
fn rs_str(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Copy to code: a published basic agency as the code would hold it, for a
/// PR that makes it an agency in code (palette.ts, its logo file, the
/// agency-logos.mjs FILES line, people.rs's mirror).
async fn export_agency(Extension(identity): Id, who: Who, Path(id): Path<String>) -> Response {
    let (people, _) = match admin(&identity, acct(&who)) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let id = agency_id(&id);
    let book = people.book();
    if code_name(&id).is_some() {
        return answer(StatusCode::CONFLICT, &format!("{id} is already in code."));
    }
    let Some(a) = book.agency(&id) else {
        return answer(StatusCode::NOT_FOUND, &format!("There is no agency {id}."));
    };
    if !a.published {
        return answer(
            StatusCode::CONFLICT,
            &format!(
                "{} is not published yet. Publish it first; Copy to code takes the published look.",
                a.name
            ),
        );
    }
    let plain = id
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c == '_')
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    let key = if plain { id.clone() } else { ts_str(&id) };
    let member = if plain {
        format!(".{id}")
    } else {
        format!("[{}]", ts_str(&id))
    };
    let svg = a
        .wordmark
        .as_ref()
        .and_then(|w| people.wordmark_svg(&id, w));
    let mut palette = format!(
        "// AGENCY_COLOURS\n  {key}: {{\n    name: {}, base: {}, accent: {},",
        ts_str(&a.name),
        ts_str(&a.base),
        ts_str(&a.accent)
    );
    if svg.is_some() {
        palette.push_str(&format!(
            "\n    logo: svgUri(WORDMARK_SVG{member}),\n    logoOnDark: svgUri(recolourSvg(WORDMARK_SVG{member}, '#FFFFFF')),"
        ));
    }
    palette.push_str("\n  },");
    if !a.aliases.is_empty() {
        palette.push_str("\n// AGENCY_ALIASES");
        for al in &a.aliases {
            palette.push_str(&format!("\n  {}: {},", ts_str(al), ts_str(&id)));
        }
    }
    let mut rust = format!(
        "    (\"{}\", \"{}\", \"{}\", \"{}\"),",
        rs_str(&id),
        rs_str(&a.name),
        a.base,
        a.accent
    );
    if !a.aliases.is_empty() {
        rust.push_str("\n// CODE_ALIASES");
        for al in &a.aliases {
            rust.push_str(&format!("\n    (\"{}\", \"{}\"),", rs_str(al), rs_str(&id)));
        }
    }
    Json(json!({
        "palette_ts": palette,
        "agency_logos_files": svg.as_ref().map(|_| format!("  {key}: {{ logo: '{id}-logo.svg' }},")),
        "svg": svg,
        "people_rs": rust,
    }))
    .into_response()
}

/// The published looks, for the shell's registry: basic agencies' whole
/// looks (the wordmark inline) and the display names published for agencies
/// in code. Public: the sign-in card wears them too. Never a draft.
async fn agency_looks(Extension(identity): Id) -> Json<Vec<Value>> {
    let Some(people) = store(&identity) else {
        return Json(Vec::new());
    };
    let book = people.book();
    let mut out: Vec<Value> = book
        .agencies
        .iter()
        .filter(|a| a.published)
        .map(|a| {
            let mut look = json!({
                "id": a.id,
                "name": a.name,
                "base": a.base,
                "accent": a.accent,
                "aliases": a.aliases,
                "rev": a.published_rev,
            });
            if let Some(uri) = wordmark_uri(people, &a.id, a.wordmark.as_ref()) {
                look["logo"] = Value::String(uri);
            }
            look
        })
        .collect();
    out.extend(
        book.names
            .iter()
            .filter(|(id, n)| code_name(id) != Some(n.name.as_str()))
            .map(|(id, n)| json!({ "id": id, "name": n.name, "rev": n.published_rev })),
    );
    Json(out)
}
