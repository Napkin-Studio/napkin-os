// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! An agency's logo, kept as one settings file per tenant (features/agency-look.clan).
//!
//! The agency's colours are not here: they come from the shell's palette.ts, set by an admin
//! (features/align-landing-look.clan). A sampled accent is no longer accepted or served: an
//! old file that still holds one is read for its logo and the accent is left unread. This file
//! stays until align-needs-lock-people moves the logo onto the People page's agency form.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::{Extension, Json};
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::state::AppCtx;
use crate::tenant::{Person, Tenant};

/// The most a logo may weigh, as the data URI the shell keeps it in.
const MAX_LOGO: usize = 256 * 1024;
const FILE: &str = "agency-look.json";

/// What the shell reads and writes: the logo only.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct Look {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
}

/// The file on disk: the look, and who set it, and what they did.
#[derive(Serialize, Deserialize)]
struct Saved {
    #[serde(flatten)]
    look: Look,
    agent: String,
    action: String,
    at: String,
}

/// Refuse anything the shell would not have made. The logo is only ever shown
/// in an `<img>`, but a data URI of any other kind has no business here.
fn check(look: &Look) -> Result<(), &'static str> {
    if let Some(logo) = &look.logo {
        if logo.len() > MAX_LOGO {
            return Err("the logo is too large");
        }
        let ok = logo.starts_with("data:image/svg+xml,")
            || logo.starts_with("data:image/png;base64,")
            || logo.starts_with("data:image/svg+xml;base64,");
        if !ok {
            return Err("the logo must be an SVG or a PNG");
        }
    }
    Ok(())
}

fn path(ctx: &AppCtx, tenant: &crate::tenant::TenantId) -> std::path::PathBuf {
    ctx.tenant_dir(tenant).join(FILE)
}

/// The tenant's saved look, for a page that has no session (the client's link).
pub fn read(ctx: &AppCtx, tenant: &crate::tenant::TenantId) -> Look {
    match std::fs::read(path(ctx, tenant)) {
        Ok(bytes) => serde_json::from_slice::<Saved>(&bytes)
            .map(|s| s.look)
            .unwrap_or_default(),
        Err(_) => Look::default(),
    }
}

/// The tenant's saved look; an empty one when nothing is saved yet.
pub async fn get_look(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    Path(_t): Path<String>,
) -> ApiResult<Json<Look>> {
    let look = match std::fs::read(path(&ctx, &tenant)) {
        Ok(bytes) => serde_json::from_slice::<Saved>(&bytes)
            .map(|s| s.look)
            .unwrap_or_default(),
        Err(_) => Look::default(),
    };
    Ok(Json(look))
}

/// Save the look. Every write says who made it and what it was.
pub async fn put_look(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    person: Option<Extension<Person>>,
    account: Option<Extension<crate::auth::Account>>,
    Path(_t): Path<String>,
    Json(look): Json<Look>,
) -> ApiResult<Json<Look>> {
    // Once an agency has a directory its look is its admin's to change.
    if let Some(Extension(a)) = &account {
        if ctx.directory.has(&a.agency) && !crate::agency::is_admin(a) {
            return Err(ApiError::new(
                403,
                "Only an admin of the agency can change its look.",
            ));
        }
    }
    check(&look).map_err(|m| ApiError::new(400, m))?;
    let agent = person
        .map(|Extension(p)| p.0)
        .unwrap_or_else(|| tenant.to_string());
    let action = match &look.logo {
        None => "agency look: removed the logo",
        Some(_) => "agency look: set the logo",
    };
    let saved = Saved {
        look: look.clone(),
        agent,
        action: action.to_string(),
        at: chrono::Utc::now().to_rfc3339(),
    };
    let p = path(&ctx, &tenant);
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| ApiError::new(500, e.to_string()))?;
    }
    let bytes = serde_json::to_vec_pretty(&saved).map_err(|e| ApiError::new(500, e.to_string()))?;
    std::fs::write(&p, bytes).map_err(|e| ApiError::new(500, e.to_string()))?;
    Ok(Json(look))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn look(logo: Option<&str>) -> Look {
        Look {
            logo: logo.map(String::from),
        }
    }

    #[test]
    fn a_png_or_svg_is_accepted() {
        assert!(check(&look(Some("data:image/png;base64,AAAA"))).is_ok());
        assert!(check(&look(Some("data:image/svg+xml,%3Csvg%3E"))).is_ok());
        assert!(check(&look(None)).is_ok());
    }

    #[test]
    fn anything_else_is_refused_and_an_accent_is_never_kept() {
        assert!(check(&look(Some("https://elsewhere/x.png"))).is_err());
        assert!(check(&look(Some("data:text/html,<script>"))).is_err());
        let big = format!("data:image/png;base64,{}", "A".repeat(MAX_LOGO));
        assert!(check(&look(Some(&big))).is_err());
        // an old body that carries an accent is read for its logo; the accent is dropped
        let old: Look = serde_json::from_str(
            r##"{"logo":"data:image/png;base64,AAAA","accent":{"white":"#112233","grey":"#223344","black":"#aabbcc"}}"##,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&old).unwrap(),
            serde_json::json!({"logo":"data:image/png;base64,AAAA"})
        );
    }
}
