// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Where a person's roles come from, on every path (features/align-needs-lock-people.clan, stage 3).
//!
//! One rule: the People store (people.rs) is the only source of who may sign in and with which roles. The
//! session cookie names a person and nothing more (the tenant layer drops any roles it claims); a
//! document's token names a person and a document, no roles; an identity provider says who someone is,
//! never what they may do. So a role change holds on the person's next request, and a removed person is
//! signed out at their next request and their document tokens stop answering, however recently minted.
//!
//! - [`live_roles`]: the API's middleware, inside the tenant layer and outside the permission check.
//! - [`decide`]: a sign-in, whichever provider proved who it was.
//! - [`roles_of`] and [`listed`]: the app sandbox's reads, for a token's person.
//!
//! A server with no People store (anonymous, or local accounts with none) gives nobody a role.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::Response;

use crate::auth::{Account, SignIn};
use crate::state::AppCtx;
use crate::tenant::{Identity, Roles};

pub const NOT_ON_THE_LIST: &str =
    "That name is not on this studio's list. Ask your studio admin to add you.";

/// The 401 a removed person (or one not on the list) gets: the cookie is cleared, and the shell
/// shows the sign-in screen.
fn signed_out(identity: Option<&Arc<Identity>>) -> Response {
    let body =
        serde_json::json!({ "ok": false, "error": NOT_ON_THE_LIST, "signin": true }).to_string();
    let mut r = Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.into())
        .unwrap();
    if let Some(id) = identity {
        if let Ok(v) = header::HeaderValue::from_str(&id.cookie(crate::auth::SESSION_COOKIE, "", 0))
        {
            r.headers_mut().append(header::SET_COOKIE, v);
        }
    }
    r
}

/// The signed-in person's roles and name are the People store's, on every request.
pub async fn live_roles(
    State(ctx): State<Arc<AppCtx>>,
    mut request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();
    let open = path.starts_with("/auth/") || path == "/healthz";
    if let Some(mut account) = request.extensions().get::<Account>().cloned() {
        match ctx.people() {
            Some(people) => match people.active(&account.username) {
                Some(p) => {
                    account.roles = p.roles;
                    if p.name.is_some() {
                        account.name = p.name;
                    }
                    request
                        .extensions_mut()
                        .insert(Roles(account.roles.clone()));
                    request.extensions_mut().insert(account);
                }
                None if open => {
                    request.extensions_mut().remove::<Account>();
                }
                None => {
                    let identity = request.extensions().get::<Arc<Identity>>().cloned();
                    return signed_out(identity.as_ref());
                }
            },
            None => {
                account.roles.clear();
                request.extensions_mut().insert(Roles::default());
                request.extensions_mut().insert(account);
            }
        }
    }
    next.run(request).await
}

/// A provider said who someone is: the People store says whether they may sign in, and as what.
pub fn decide(ctx: &AppCtx, out: SignIn) -> SignIn {
    match out {
        SignIn::Done(mut a) => match ctx.people() {
            Some(people) => match people.active(&a.username) {
                Some(p) => {
                    a.roles = p.roles;
                    a.name = p.name.or(a.name);
                    SignIn::Done(a)
                }
                None => SignIn::Refused(NOT_ON_THE_LIST.into()),
            },
            None => {
                a.roles.clear();
                SignIn::Done(a)
            }
        },
        other => other,
    }
}

/// Whether `person` (a token's) may still act: on the People store's list, or there is no store.
pub fn listed(ctx: &AppCtx, person: &str) -> bool {
    match ctx.people() {
        Some(people) => people.active(person).is_some(),
        None => true,
    }
}

/// The roles of `person` now; None when they are no longer on the list.
pub fn roles_of(ctx: &AppCtx, person: &str) -> Option<Vec<String>> {
    match ctx.people() {
        Some(people) => people.active(person).map(|p| p.roles),
        None => Some(Vec::new()),
    }
}
