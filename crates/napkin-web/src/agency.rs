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

use axum::extract::{Path, State};
use axum::http::StatusCode;
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
