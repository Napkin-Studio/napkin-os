// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! An agency's look (features/agency-look.clan): its logo, and the accent the
//! browser sampled from it, one lightness per mode.
//!
//! The browser reads the logo's pixels and sends the result; the server does
//! not decode images (napkin-host must stay wasm32-clean, and no decoder is
//! worth carrying for a value that is saved either way). It checks the shape
//! of what it is given, stores it as one settings file per tenant, and names
//! who wrote it and what they did. Phase 1 keeps it here; when the agency
//! database lands, only the shell's `getAgencyLook()` and this file change.

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

/// The accent in each mode, `#rrggbb`: lightness set so text in it reads there.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Accents {
    pub white: String,
    pub grey: String,
    pub black: String,
}

/// What the shell reads and writes. `accent` is absent for a logo with no
/// colour of its own (black, white and grey only): then there is no accent.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct Look {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<Accents>,
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

fn is_hex(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
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
    if let Some(a) = &look.accent {
        if ![&a.white, &a.grey, &a.black].iter().all(|c| is_hex(c)) {
            return Err("an accent must be #rrggbb in every mode");
        }
        if look.logo.is_none() {
            return Err("an accent comes from a logo");
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
    Path(_t): Path<String>,
    Json(look): Json<Look>,
) -> ApiResult<Json<Look>> {
    check(&look).map_err(|m| ApiError::new(400, m))?;
    let agent = person
        .map(|Extension(p)| p.0)
        .unwrap_or_else(|| tenant.to_string());
    let action = match (&look.logo, &look.accent) {
        (None, _) => "agency look: removed the logo",
        (Some(_), Some(_)) => "agency look: set the logo and its accent",
        (Some(_), None) => "agency look: set the logo, no accent",
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

    fn look(logo: Option<&str>, accent: Option<[&str; 3]>) -> Look {
        Look {
            logo: logo.map(String::from),
            accent: accent.map(|[w, g, b]| Accents {
                white: w.into(),
                grey: g.into(),
                black: b.into(),
            }),
        }
    }

    #[test]
    fn a_png_or_svg_with_three_hex_accents_is_accepted() {
        assert!(check(&look(
            Some("data:image/png;base64,AAAA"),
            Some(["#112233", "#223344", "#aabbcc"])
        ))
        .is_ok());
        assert!(check(&look(Some("data:image/svg+xml,%3Csvg%3E"), None)).is_ok());
        assert!(check(&look(None, None)).is_ok());
    }

    #[test]
    fn anything_else_is_refused() {
        assert!(check(&look(Some("https://elsewhere/x.png"), None)).is_err());
        assert!(check(&look(Some("data:text/html,<script>"), None)).is_err());
        assert!(check(&look(
            Some("data:image/png;base64,AAAA"),
            Some(["red", "#223344", "#aabbcc"])
        ))
        .is_err());
        assert!(check(&look(None, Some(["#112233", "#223344", "#aabbcc"]))).is_err());
        let big = format!("data:image/png;base64,{}", "A".repeat(MAX_LOGO));
        assert!(check(&look(Some(&big), None)).is_err());
    }
}
