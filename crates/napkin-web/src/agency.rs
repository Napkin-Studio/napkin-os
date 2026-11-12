// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! An agency's people, as the shell edits them (features/agency-setup.clan).
//!
//! `GET /api/t/{tenant}/agency/people` is the one list of people every other feature reads
//! (sign-in names, names, roles; emails, state and who named them for admins only). Only an
//! admin of the agency changes it, and the tenant is always the signed-in person's own: an admin
//! naming another agency's tenant gets 403 from the tenant extractor before any of this runs.
//!
//! Every write goes through `napkin_host::agency`, which records one attributed decision per
//! change. Nothing here scores or ranks a person.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::http::{header, HeaderMap};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Extension, Json, Router};
use napkin_host::agency::{self, NewPerson, PersonPatch};
use serde::{Deserialize, Serialize};

use crate::auth::{Account, SignIn};
use crate::directory::{Person, PersonState};
use crate::error::{ApiError, ApiResult};
use crate::state::AppCtx;
use crate::tenant::{Acting, Tenant, TenantId};

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

/// What the agency's admin role is called in a session.
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

/// The roles a directory may hold: every role the agency's door table knows, and `admin`. `demo`
/// is for demo accounts and is not a role anyone is given.
pub fn role_known(ctx: &AppCtx, agency: &str) -> impl Fn(&str) -> bool {
    let table = crate::roles::Table::for_agency(ctx.roles_dir.as_deref(), Some(agency));
    move |r: &str| r != crate::roles::DEMO && table.knows(r)
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
    state: PersonState,
    invited_by: String,
    at: String,
}

fn admin_view(p: Person) -> AdminPersonView {
    AdminPersonView {
        username: p.username,
        name: p.name,
        roles: p.roles,
        email: p.email,
        state: p.state,
        invited_by: p.invited_by,
        at: p.at,
    }
}

/// The people of the agency, an allow list per reader. An agency with no directory answers an
/// empty list (its roster is not a directory). A removed person is listed to admins only.
async fn list_people(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(_t): Tenant,
    account: Option<Extension<Account>>,
) -> Json<serde_json::Value> {
    let Some(Extension(me)) = account else {
        return Json(serde_json::json!([]));
    };
    let people = ctx.directory.people(&me.agency);
    if is_admin(&me) {
        let v: Vec<AdminPersonView> = people.into_iter().map(admin_view).collect();
        return Json(serde_json::json!(v));
    }
    let v: Vec<PersonView> = people
        .into_iter()
        .filter(|p| p.state != PersonState::Removed)
        .map(|p| PersonView {
            username: p.username,
            name: p.name,
            roles: p.roles,
        })
        .collect();
    Json(serde_json::json!(v))
}

fn of_my_agency(me: &Account, username: &str) -> ApiResult<String> {
    let u = username.trim().to_ascii_lowercase();
    match Account::parse_username(&u) {
        Some((u, agency)) if agency == me.agency => Ok(u),
        _ => Err(ApiError::new(
            400,
            format!("A sign-in name here ends in @{}.", me.agency),
        )),
    }
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
    Acting(acting): Acting,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
    Json(b): Json<InviteBody>,
) -> ApiResult<(StatusCode, Json<AdminPersonView>)> {
    let me = admin_of(account)?;
    let username = match b.username.as_deref().filter(|u| !u.trim().is_empty()) {
        Some(u) => of_my_agency(&me, u)?,
        None => {
            let local = b.email.split('@').next().unwrap_or("");
            of_my_agency(&me, &format!("{local}@{}", me.agency))?
        }
    };
    let known = role_known(&ctx, &me.agency);
    let p = agency::invite(
        &*ctx.workspace(&tenant).store,
        &acting,
        NewPerson {
            username,
            name: b.name,
            email: b.email,
            roles: b.roles,
        },
        &known,
    )?;
    ctx.directory.changed(&me.agency);
    crate::audit::sync_registry(&ctx, &tenant);
    Ok((StatusCode::CREATED, Json(admin_view(p))))
}

async fn edit_person(
    State(ctx): State<Arc<AppCtx>>,
    Acting(acting): Acting,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
    Path((_t, username)): Path<(String, String)>,
    Json(patch): Json<PersonPatch>,
) -> ApiResult<Json<AdminPersonView>> {
    let me = admin_of(account)?;
    let username = of_my_agency(&me, &username)?;
    let known = role_known(&ctx, &me.agency);
    let p = agency::edit_person(
        &*ctx.workspace(&tenant).store,
        &acting,
        &username,
        patch,
        &known,
    )?;
    ctx.directory.changed(&me.agency);
    crate::audit::sync_registry(&ctx, &tenant);
    Ok(Json(admin_view(p)))
}

async fn remove_person(
    State(ctx): State<Arc<AppCtx>>,
    Acting(acting): Acting,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
    Path((_t, username)): Path<(String, String)>,
) -> ApiResult<Json<AdminPersonView>> {
    let me = admin_of(account)?;
    let username = of_my_agency(&me, &username)?;
    let p = agency::remove_person(&*ctx.workspace(&tenant).store, &acting, &username)?;
    ctx.directory.changed(&me.agency);
    crate::audit::sync_registry(&ctx, &tenant);
    Ok(Json(admin_view(p)))
}

// ── signing in ──────────────────────────────────────────────────────────────

const NOT_ON_THE_LIST: &str =
    "That name is not on this studio's list. Ask your studio admin to add you.";

/// The directory decides a sign-in for an agency that has one. A roster has no passwords, so the
/// name alone proves nothing more than it did, and the directory is the list; with a password
/// provider the provider proves who it is and the directory says whether they may and as what.
/// An agency with no directory is the provider's, as before.
pub async fn sign_in(
    ctx: &Arc<AppCtx>,
    provider: &crate::auth::Provider,
    name: &str,
    password: &str,
) -> SignIn {
    let Some((username, agency)) = Account::parse_username(name) else {
        return provider.sign_in(name, password).await;
    };
    if !ctx.directory.has(&agency) {
        return provider.sign_in(name, password).await;
    }
    if !provider.uses_passwords() {
        return directory_account(ctx, &username, &agency);
    }
    decide(ctx, provider.sign_in(name, password).await)
}

fn directory_account(ctx: &Arc<AppCtx>, username: &str, agency: &str) -> SignIn {
    match ctx.directory.person(agency, username) {
        Some(p) if p.state != PersonState::Removed => {
            let account = Account {
                username: username.to_string(),
                agency: agency.to_string(),
                name: Some(p.name.clone()),
                roles: p.roles.clone(),
            };
            activate(ctx, &account, p.state);
            SignIn::Done(account)
        }
        _ => SignIn::Refused(NOT_ON_THE_LIST.into()),
    }
}

/// A password provider said `Done`: the directory, when the agency has one, has the last word.
pub fn decide(ctx: &Arc<AppCtx>, out: SignIn) -> SignIn {
    match out {
        SignIn::Done(a) if ctx.directory.has(&a.agency) => {
            directory_account(ctx, &a.username, &a.agency)
        }
        other => other,
    }
}

/// A first sign-in turns `invited` into `active`, as a decision by the person. A failure to
/// record it is logged and never stops the sign-in.
fn activate(ctx: &Arc<AppCtx>, account: &Account, state: PersonState) {
    if state != PersonState::Invited {
        return;
    }
    let tenant = TenantId::of_agency(&account.agency);
    let acting = tenant.ctx_for(&account.username);
    match agency::activate(&*ctx.workspace(&tenant).store, &acting, &account.username) {
        Ok(()) => ctx.directory.changed(&account.agency),
        Err(e) => tracing::warn!(error = %e, "could not mark a first sign-in"),
    }
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
    ctx.directory.changed(&me.agency);
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
    let others = reg
        .people
        .iter()
        .filter(|p| p.state != PersonState::Removed && p.username != me.username)
        .count();
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
        "has_directory": reg.has_directory(),
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
        "people" => {
            let known = role_known(&ctx, &me.agency);
            napkin_host::import::people(store, &acting, &me.agency, &bytes, dry, &known)?
        }
        "clients" => napkin_host::import::clients_csv(store, &acting, &bytes, dry)?,
        "jobs" => napkin_host::import::jobs_csv(store, &acting, &bytes, dry)?,
        other => {
            return Err(ApiError::new(
                404,
                format!("Nothing to import called {other}."),
            ))
        }
    };
    if !dry {
        ctx.directory.changed(&me.agency);
        crate::audit::sync_registry(&ctx, &tenant);
    }
    Ok(Json(report))
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
    for p in ctx.directory.people(&me.agency) {
        if p.state == PersonState::Removed {
            continue;
        }
        let cell = |s: &str| napkin_host::import::export_cell(&s.replace(['\t', '\n', '\r'], " "));
        out.push_str(&format!(
            "{}\t{}\t{}\n",
            p.username,
            cell(&p.name),
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
