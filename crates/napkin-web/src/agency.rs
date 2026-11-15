// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! An agency's own settings and its accounts file, and the helpers the People page's routes (admin.rs) share:
//! who is an agency's admin, which roles exist, and the CSV import of people into the People store
//! (features/align-needs-lock-people.clan). The build's own people routes (`/agency/people`, `/setup`,
//! `/setup/import`) went with its setup flow in stage 4: the People page is the one screen, `/api/admin/*`
//! the one set of routes.
//!
//! Nothing here scores or ranks a person.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Json, Router};
use napkin_host::agency;

use crate::auth::Account;
use crate::error::{ApiError, ApiResult};
use crate::people::{Member, People, PersonRec, Refusal};
use crate::state::AppCtx;
use crate::tenant::{Acting, Tenant};

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/t/{tenant}/agency", get(get_settings).put(put_settings))
        .route("/t/{tenant}/agency/accounts.tsv", get(accounts_tsv))
}

/// Whether the signed-in person is an admin of their agency (their roles, the People store's).
pub fn is_admin(account: &Account) -> bool {
    account.roles.iter().any(|r| r == agency::ADMIN)
}

/// The signed-in admin of an agency, or the reason there is none.
pub fn admin_of(account: Option<Extension<Account>>) -> ApiResult<Account> {
    match account {
        Some(Extension(a)) if is_admin(&a) => Ok(a),
        Some(_) => Err(ApiError::new(
            403,
            "Only an admin of the agency can do this.",
        )),
        None => Err(ApiError::new(
            403,
            "Sign in as an admin of the agency to do this.",
        )),
    }
}

/// The roles a person may be given: every role the agency's door table knows, and `admin`. `demo`
/// is for demo accounts and is not a role anyone is given.
pub fn role_known(ctx: &AppCtx, agency: &str) -> impl Fn(&str) -> bool {
    let table = crate::roles::Table::for_agency(ctx.roles_dir.as_deref(), Some(agency));
    move |r: &str| r != crate::roles::DEMO && table.knows(r)
}

/// The People store, or 404 where this server keeps none.
pub fn store(ctx: &AppCtx) -> ApiResult<&Arc<People>> {
    ctx.people()
        .ok_or_else(|| ApiError::new(404, "This server keeps no list of people."))
}

/// A refusal of the People store, as these routes answer it.
pub fn refused(r: Refusal) -> ApiError {
    match r {
        Refusal::Bad(m) => ApiError::new(400, m),
        Refusal::Conflict(m) => ApiError::new(409, m),
        Refusal::NotFound(m) => ApiError::new(404, m),
        Refusal::Io(m) => {
            tracing::error!(target: "napkin_web::people", error = %m, "people store");
            ApiError::new(500, "The people store could not be changed.")
        }
    }
}

/// The name a person is shown by: theirs, or their sign-in name.
fn shown_name(p: &PersonRec) -> String {
    p.name.clone().unwrap_or_else(|| p.id.clone())
}

// ── the settings ────────────────────────────────────────────────────────────

/// What `GET /agency` answers. An admin gets all four settings and the look; anyone else gets the
/// agency's name and its look (an allow list: the cap and the time zone are the admin's).
async fn get_settings(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
) -> ApiResult<Json<serde_json::Value>> {
    let look = crate::look::read(&ctx, &tenant);
    // The name is the agency record's in the People store (a code agency's published display name, a
    // basic agency's published name), which only an admin changes there; never the old registry, which any
    // member could write (features/align-needs-lock-people.clan). An agency with no record has no name here.
    let name = account
        .as_ref()
        .and_then(|Extension(a)| agency_name(&ctx, &a.agency))
        .unwrap_or_default();
    let admin = account.as_ref().is_some_and(|Extension(a)| is_admin(a));
    if !admin {
        return Ok(Json(serde_json::json!({ "name": name, "look": look })));
    }
    // The time zone has no home in the agency record yet: still read from the registry, for this agency's
    // admin only, and marked as not an authority (an open question). No monthly credit cap: no price is a
    // setting (features/align-confidential-prices.clan).
    let (reg, _) = agency::read(ctx.workspace(&tenant).agency_store())?;
    Ok(Json(serde_json::json!({
        "name": name,
        "time_zone": reg.settings.time_zone,
        "unverified": ["time_zone"],
        "look": look,
    })))
}

/// The agency's name as its record in the People store has it: a code agency's published display name (or
/// the code's), a basic agency's published name; None for an agency with no record.
pub fn agency_name(ctx: &AppCtx, agency: &str) -> Option<String> {
    let book = ctx.people()?.book();
    if let Some(code) = crate::people::code_name(agency) {
        return Some(
            book.names
                .get(agency)
                .map_or(code.to_string(), |n| n.name.clone()),
        );
    }
    book.agency(agency)
        .filter(|a| a.published)
        .map(|a| a.name.clone())
}

/// Change the time zone (the name is the People store's). A monthly credit cap is no setting: it is refused
/// with a 400 that says where the spend cap is kept (features/align-confidential-prices.clan).
async fn put_settings(
    State(ctx): State<Arc<AppCtx>>,
    Acting(acting): Acting,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResult<Json<serde_json::Value>> {
    let me = admin_of(account)?;
    let obj = body
        .as_object()
        .ok_or_else(|| ApiError::new(400, "Send the settings as an object."))?;
    let text = |k: &str| -> ApiResult<Option<String>> {
        match obj.get(k) {
            None | Some(serde_json::Value::Null) => Ok(None),
            Some(serde_json::Value::String(s)) => Ok(Some(s.clone())),
            Some(_) => Err(ApiError::new(400, format!("{k} is text"))),
        }
    };
    if obj.contains_key("credit_cap_month_eur") {
        return Err(ApiError::new(
            400,
            "There is no monthly credit cap here: the spend cap is set where Napkin runs.",
        ));
    }
    // the name is the agency record's, changed on the People page's Agencies tab by an admin there
    if text("name")?.is_some() {
        return Err(ApiError::new(
            400,
            "An agency's name is changed on the People page, in its Agencies tab.",
        ));
    }
    let patch = agency::SettingsPatch {
        name: None,
        time_zone: text("time_zone")?,
    };
    let who = acting
        .actor
        .as_str()
        .trim_start_matches("human:")
        .to_string();
    let s = agency::set_settings(ctx.workspace(&tenant).agency_store(), &acting, patch)?;
    // the audit line is the server's own, naming the session's person (never a document's agent)
    crate::audit::note(
        &ctx,
        &tenant,
        crate::audit::NewLine {
            who,
            kind: crate::audit::SETTINGS,
            what: "Changed the agency's settings.".into(),
            ..Default::default()
        },
    );
    let name = agency_name(&ctx, &me.agency).unwrap_or_default();
    Ok(Json(serde_json::json!({
        "name": name,
        "time_zone": s.time_zone,
        "look": crate::look::read(&ctx, &tenant),
    })))
}

// ── CSV import ──────────────────────────────────────────────────────────────

/// The bytes of a file posted either as the raw body or as one `multipart/form-data` part.
pub fn file_of(headers: &HeaderMap, body: &Bytes) -> ApiResult<Vec<u8>> {
    let ctype = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let Some(boundary) = ctype
        .split(';')
        .filter_map(|p| p.trim().strip_prefix("boundary="))
        .next()
        .map(|b| b.trim_matches('"').to_string())
        .filter(|_| ctype.starts_with("multipart/"))
    else {
        return Ok(body.to_vec());
    };
    let marker = format!("--{boundary}").into_bytes();
    let find = |hay: &[u8], needle: &[u8], from: usize| {
        hay.get(from..)?
            .windows(needle.len())
            .position(|w| w == needle)
            .map(|i| i + from)
    };
    let mut at = 0;
    while let Some(start) = find(body, &marker, at) {
        let part = start + marker.len();
        let Some(head_end) = find(body, b"\r\n\r\n", part) else {
            break;
        };
        let end = find(body, &marker, head_end).unwrap_or(body.len());
        let head = String::from_utf8_lossy(&body[part..head_end]).to_ascii_lowercase();
        if head.contains("filename=") || head.contains("name=\"file\"") {
            let data = &body[head_end + 4..end];
            return Ok(data.strip_suffix(b"\r\n").unwrap_or(data).to_vec());
        }
        at = end;
    }
    Err(ApiError::new(400, "No file came with that request."))
}

/// The active people of `me`'s agency other than `me`.
fn others_than(ctx: &AppCtx, me: &Account) -> usize {
    ctx.people().map_or(0, |p| {
        p.book()
            .people
            .iter()
            .filter(|x| x.agency == me.agency && x.active() && x.id != me.username)
            .count()
    })
}

/// A people file into the session's agency, checked by the build's rules (`napkin_host::import`) and
/// written to the People store in one change. Every row joins the importer's agency, whatever it names.
pub fn import_people(
    ctx: &AppCtx,
    me: &Account,
    bytes: &[u8],
    dry: bool,
) -> ApiResult<napkin_host::import::Report> {
    let people = store(ctx)?;
    let book = people.book();
    let existing = |u: &str| {
        book.person(u).filter(|p| p.active()).map(|p| {
            (
                p.name.clone().unwrap_or_default(),
                p.email.clone().unwrap_or_default(),
                p.roles.clone(),
            )
        })
    };
    let known = role_known(ctx, &me.agency);
    let (mut report, good) =
        napkin_host::import::check_people(&me.agency, &me.username, bytes, dry, &known, &existing)?;
    report.starts_directory = others_than(ctx, me) == 0;
    if dry || good.is_empty() {
        return Ok(report);
    }
    let members: Vec<Member> = good
        .into_iter()
        .map(|p| Member {
            id: p.username,
            name: p.name,
            email: Some(p.email),
            roles: p.roles,
        })
        .collect();
    let out = people
        .import(&me.username, &me.agency, &members, Some(&me.username))
        .map_err(refused)?;
    report.created = out.created;
    report.updated = out.updated;
    report.unchanged = out.unchanged;
    report.committed = out.created + out.updated > 0 || report.starts_directory;
    Ok(report)
}

// ── the accounts file ───────────────────────────────────────────────────────

/// The people as `infra/scripts/create-users.sh` reads them: `user@agency`, a name and the roles,
/// tab-separated. A cell a spreadsheet would run as a formula is quoted. Admin only.
async fn accounts_tsv(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(_t): Tenant,
    account: Option<Extension<Account>>,
) -> ApiResult<Response> {
    let me = admin_of(account)?;
    let mut out = String::new();
    let book = store(&ctx)?.book();
    for p in book
        .people
        .iter()
        .filter(|p| p.agency == me.agency && p.active())
    {
        let cell = |s: &str| napkin_host::import::export_cell(&s.replace(['\t', '\n', '\r'], " "));
        out.push_str(&format!(
            "{}\t{}\t{}\n",
            p.id,
            cell(&shown_name(p)),
            p.roles.join(",")
        ));
    }
    Ok((
        [
            (
                header::CONTENT_TYPE,
                "text/tab-separated-values; charset=utf-8",
            ),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"accounts.tsv\"",
            ),
        ],
        out,
    )
        .into_response())
}
