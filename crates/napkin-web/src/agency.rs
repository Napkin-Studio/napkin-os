// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! An agency's people, as the build's setup flow edits them (features/agency-setup.clan), over the
//! one People store (people.rs; features/align-needs-lock-people.clan, stage 3).
//!
//! `GET /api/t/{tenant}/agency/people` lists the signed-in person's own agency (sign-in names, names,
//! roles; emails, state and who named them for admins only). Only an admin of the agency changes it, and
//! the agency is always the session's: a tenant in the path that is not the session's is 403 from the
//! tenant extractor before any of this runs, and a sign-in name of another agency, in the path or the
//! body, gets the answer a name nobody holds gets. These routes go when the People page takes them over
//! (stage 4); until then they write the same store as `/api/admin/people`.
//!
//! Every write is one line on the store's change log and one entry on the agency's audit chain.
//! Nothing here scores or ranks a person.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::http::{header, HeaderMap};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Extension, Json, Router};
use napkin_host::agency;
use serde::{Deserialize, Serialize};

use crate::auth::Account;
use crate::error::{ApiError, ApiResult};
use crate::people::{Member, NewPerson, People, PersonRec, Refusal};
use crate::state::AppCtx;
use crate::tenant::{Acting, Tenant};

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/t/{tenant}/agency", get(get_settings).put(put_settings))
        .route("/t/{tenant}/agency/accounts.tsv", get(accounts_tsv))
        .route("/t/{tenant}/setup", get(setup_status))
        .route("/t/{tenant}/setup/import/{kind}", post(import_csv))
        .route("/t/{tenant}/agency/people", get(list_people))
        .route("/t/{tenant}/agency/people/invite", post(invite))
        .route(
            "/t/{tenant}/agency/people/{username}",
            put(edit_person).delete(remove_person),
        )
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

/// What anyone in the agency sees of a person.
#[derive(Serialize)]
struct PersonView {
    username: String,
    name: String,
    roles: Vec<String>,
}

/// What an admin sees: the same, and the address, where the person is, who named them and when.
#[derive(Serialize)]
struct AdminPersonView {
    username: String,
    name: String,
    roles: Vec<String>,
    email: String,
    state: &'static str,
    invited_by: String,
    at: String,
}

fn shown_name(p: &PersonRec) -> String {
    p.name.clone().unwrap_or_else(|| p.id.clone())
}

fn admin_view(p: PersonRec) -> AdminPersonView {
    AdminPersonView {
        name: shown_name(&p),
        state: if p.active() { "active" } else { "removed" },
        username: p.id,
        roles: p.roles,
        email: p.email.unwrap_or_default(),
        invited_by: p.added_by,
        at: p.added_at,
    }
}

/// The people of the session's agency, an allow list per reader. A removed person is listed to admins only.
async fn list_people(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(_t): Tenant,
    account: Option<Extension<Account>>,
) -> Json<serde_json::Value> {
    let (Some(Extension(me)), Some(people)) = (account, ctx.people()) else {
        return Json(serde_json::json!([]));
    };
    let mine: Vec<PersonRec> = people
        .book()
        .people
        .into_iter()
        .filter(|p| p.agency == me.agency)
        .collect();
    if is_admin(&me) {
        let v: Vec<AdminPersonView> = mine.into_iter().map(admin_view).collect();
        return Json(serde_json::json!(v));
    }
    let v: Vec<PersonView> = mine
        .into_iter()
        .filter(PersonRec::active)
        .map(|p| PersonView {
            name: shown_name(&p),
            username: p.id,
            roles: p.roles,
        })
        .collect();
    Json(serde_json::json!(v))
}

/// A sign-in name of the session's agency. Any other, existing or not, is the same 404 a name nobody
/// holds gets.
fn of_my_agency(people: &People, me: &Account, username: &str) -> ApiResult<String> {
    let u = username.trim().to_ascii_lowercase();
    match Account::parse_username(&u) {
        Some((u, agency))
            if agency == me.agency
                && people.book().person(&u).is_some_and(|p| p.agency == agency) =>
        {
            Ok(u)
        }
        _ => Err(ApiError::new(404, format!("{u} is not on the list."))),
    }
}

/// Roles as an agency's admin gives them: at least one, each known.
fn checked_roles(ctx: &AppCtx, agency: &str, roles: &[String]) -> ApiResult<Vec<String>> {
    let roles = crate::people::clean_roles(roles);
    if roles.is_empty() {
        return Err(ApiError::new(400, "a person needs at least one role"));
    }
    let known = role_known(ctx, agency);
    if let Some(bad) = roles.iter().find(|r| !known(r)) {
        return Err(ApiError::new(400, format!("{bad:?} is not a role")));
    }
    Ok(roles)
}

#[derive(Deserialize)]
struct InviteBody {
    /// The sign-in name; left out, it is the part of the email before the `@`, at this agency.
    #[serde(default)]
    username: Option<String>,
    email: String,
    name: String,
    roles: Vec<String>,
}

async fn invite(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(_tenant): Tenant,
    account: Option<Extension<Account>>,
    Json(b): Json<InviteBody>,
) -> ApiResult<(StatusCode, Json<AdminPersonView>)> {
    let me = admin_of(account)?;
    let people = store(&ctx)?;
    let local = match b
        .username
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
    {
        // a sign-in name of any other agency is refused as one that is not a name here
        Some(u) => match Account::parse_username(u) {
            Some((u, agency)) if agency == me.agency => u,
            _ => {
                return Err(ApiError::new(
                    400,
                    format!("A sign-in name here ends in @{}.", me.agency),
                ))
            }
        },
        None => format!(
            "{}@{}",
            b.email.split('@').next().unwrap_or("").trim(),
            me.agency
        ),
    };
    let email = agency::clean_email(&b.email).map_err(|e| ApiError::new(400, e.message))?;
    let name = agency::clean_person_name(&b.name).map_err(|e| ApiError::new(400, e.message))?;
    let roles = checked_roles(&ctx, &me.agency, &b.roles)?;
    let p = people
        .add_in(
            &me.username,
            &me.agency,
            &NewPerson {
                name,
                agency: me.agency.clone(),
                username: Some(local),
                roles,
                email: Some(email),
            },
        )
        .map_err(refused)?;
    Ok((StatusCode::CREATED, Json(admin_view(p))))
}

/// What an admin may change on a person. A field left out is kept.
#[derive(Deserialize, Default)]
struct PersonPatch {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    roles: Option<Vec<String>>,
}

async fn edit_person(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(_tenant): Tenant,
    account: Option<Extension<Account>>,
    Path((_t, username)): Path<(String, String)>,
    Json(patch): Json<PersonPatch>,
) -> ApiResult<Json<AdminPersonView>> {
    let me = admin_of(account)?;
    let people = store(&ctx)?;
    let username = of_my_agency(people, &me, &username)?;
    let mut p = None;
    if let Some(roles) = &patch.roles {
        let roles = checked_roles(&ctx, &me.agency, roles)?;
        p = Some(
            people
                .set_roles(&me.username, &username, &roles)
                .map_err(refused)?,
        );
    }
    if let Some(name) = &patch.name {
        let name = agency::clean_person_name(name).map_err(|e| ApiError::new(400, e.message))?;
        p = Some(
            people
                .rename(&me.username, &username, &name)
                .map_err(refused)?,
        );
    }
    if let Some(email) = &patch.email {
        let email = agency::clean_email(email).map_err(|e| ApiError::new(400, e.message))?;
        p = Some(
            people
                .set_email(&me.username, &username, Some(&email))
                .map_err(refused)?,
        );
    }
    let p = match p {
        Some(p) => p,
        None => people
            .active(&username)
            .ok_or_else(|| ApiError::new(404, format!("{username} is not on the list.")))?,
    };
    Ok(Json(admin_view(p)))
}

async fn remove_person(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(_tenant): Tenant,
    account: Option<Extension<Account>>,
    Path((_t, username)): Path<(String, String)>,
) -> ApiResult<Json<AdminPersonView>> {
    let me = admin_of(account)?;
    let people = store(&ctx)?;
    let username = of_my_agency(people, &me, &username)?;
    let p = people.remove(&me.username, &username).map_err(refused)?;
    Ok(Json(admin_view(p)))
}

// ── the settings ────────────────────────────────────────────────────────────

/// What `GET /agency` answers. An admin gets all four settings and the look; anyone else gets the
/// agency's name and its look (an allow list: the cap and the time zone are the admin's).
async fn get_settings(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
) -> ApiResult<Json<serde_json::Value>> {
    let (reg, _) = agency::read(&*ctx.workspace(&tenant).store)?;
    let look = crate::look::read(&ctx, &tenant);
    let admin = account.as_ref().is_some_and(|Extension(a)| is_admin(a));
    Ok(Json(if admin {
        serde_json::json!({
            "name": reg.settings.name,
            "credit_cap_month_eur": reg.settings.credit_cap_month_eur,
            "time_zone": reg.settings.time_zone,
            "look": look,
        })
    } else {
        serde_json::json!({ "name": reg.settings.name, "look": look })
    }))
}

/// Change the name, the monthly credit cap or the time zone. A cap that is not a number, or is
/// below zero, is 400. The cap is stored and shown; nothing enforces it yet.
async fn put_settings(
    State(ctx): State<Arc<AppCtx>>,
    Acting(acting): Acting,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResult<Json<serde_json::Value>> {
    admin_of(account)?;
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
    let cap = match obj.get("credit_cap_month_eur") {
        None | Some(serde_json::Value::Null) => None,
        Some(v) => Some(v.as_f64().ok_or_else(|| {
            ApiError::new(
                400,
                "The monthly credit cap is an amount in euros, not below zero.",
            )
        })?),
    };
    let patch = agency::SettingsPatch {
        name: text("name")?,
        credit_cap_month_eur: cap,
        time_zone: text("time_zone")?,
    };
    let s = agency::set_settings(&*ctx.workspace(&tenant).store, &acting, patch)?;
    crate::audit::sync_registry(&ctx, &tenant);
    Ok(Json(serde_json::json!({
        "name": s.name,
        "credit_cap_month_eur": s.credit_cap_month_eur,
        "time_zone": s.time_zone,
        "look": crate::look::read(&ctx, &tenant),
    })))
}

// ── the setup flow's progress ───────────────────────────────────────────────

/// One step of the setup flow. A step is done when its data exists; nothing is stored about the
/// flow itself, so it cannot get out of step with the data.
#[derive(Serialize)]
struct Step {
    id: &'static str,
    done: bool,
}

/// The steps in order and the first one not done. Admin only (`Group::Admin`: `/setup`).
async fn setup_status(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
) -> ApiResult<Json<serde_json::Value>> {
    let me = admin_of(account)?;
    let store = &*ctx.workspace(&tenant).store;
    let (reg, _) = agency::read(store)?;
    let others = others_than(&ctx, &me);
    let steps = vec![
        Step {
            id: "logo",
            done: crate::look::read(&ctx, &tenant).logo.is_some(),
        },
        Step {
            id: "name",
            done: !reg.settings.name.is_empty(),
        },
        Step {
            id: "people",
            done: others > 0,
        },
        Step {
            id: "clients",
            done: !napkin_host::clients::list(store, false)?.is_empty(),
        },
        Step {
            id: "jobs",
            done: !napkin_host::jobs::list(store)?.is_empty(),
        },
    ];
    let next = steps.iter().find(|s| !s.done).map(|s| s.id);
    Ok(Json(serde_json::json!({
        "steps": steps,
        "next": next,
        "complete": next.is_none(),
        "people": others,
        "has_directory": others > 0,
    })))
}

// ── CSV import ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ImportQuery {
    #[serde(default)]
    dry_run: Option<String>,
}

/// The bytes of a file posted either as the raw body or as one `multipart/form-data` part.
fn file_of(headers: &HeaderMap, body: &Bytes) -> ApiResult<Vec<u8>> {
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

/// Import people, clients or jobs from a CSV file, with `?dry_run=1` to check without writing.
/// Admin only. The reply is the report: a result per row, the bad rows by line, and the counts.
#[allow(clippy::too_many_arguments)]
async fn import_csv(
    State(ctx): State<Arc<AppCtx>>,
    Acting(acting): Acting,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
    Path((_t, kind)): Path<(String, String)>,
    Query(q): Query<ImportQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<napkin_host::import::Report>> {
    let me = admin_of(account)?;
    let dry = q
        .dry_run
        .as_deref()
        .is_some_and(|v| v == "1" || v == "true");
    let bytes = file_of(&headers, &body)?;
    let store = &*ctx.workspace(&tenant).store;
    let report = match kind.as_str() {
        "people" => import_people(&ctx, &me, &bytes, dry)?,
        "clients" => napkin_host::import::clients_csv(store, &acting, &bytes, dry)?,
        "jobs" => napkin_host::import::jobs_csv(store, &acting, &bytes, dry)?,
        other => {
            return Err(ApiError::new(
                404,
                format!("Nothing to import called {other}."),
            ))
        }
    };
    Ok(Json(report))
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
