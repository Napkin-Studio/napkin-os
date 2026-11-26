// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Clearing a workspace's unused files (features/spinoff-asset-links).
//!
//! `POST /api/t/{tenant}/blobs/sweep?dry_run=true&grace_days=7`: removes the
//! stored files no document of the workspace links to, once they are older
//! than the grace period. A dry run (the default) only reports. Napkin admins
//! only; there is no background sweep.
//!
//! `GET /api/t/{tenant}/blobs/{sha256}`: one of the workspace's stored pictures
//! by its hash, for a page that knows a picture only by its hash and is not the
//! document's own view: Production's route nodes draw a Territories frame this
//! way (owner, 2026-11-26: the host stores a frame's bytes when it applies the
//! change). Pictures only (PNG, JPEG, WebP, GIF), by their own bytes; anything
//! else answers 404, as a hash the workspace does not hold does.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use napkin_host::blobs;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::Account;
use crate::error::{ApiError, ApiResult};
use crate::people::is_admin;
use crate::state::AppCtx;
use crate::tenant::Tenant;

/// Unreferenced files younger than this are never removed: a spin-off writes
/// the file first and the document after.
const DEFAULT_GRACE_DAYS: u64 = 7;

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/t/{tenant}/blobs/sweep", post(sweep))
        .route("/t/{tenant}/blobs/{sha}", get(picture))
}

#[derive(Deserialize)]
struct SweepQuery {
    #[serde(default = "yes")]
    dry_run: bool,
    #[serde(default)]
    grace_days: Option<u64>,
}

fn yes() -> bool {
    true
}

async fn sweep(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
    Query(q): Query<SweepQuery>,
) -> ApiResult<Json<Value>> {
    if let Some(Extension(a)) = &account {
        if !is_admin(&a.username) {
            return Err(ApiError::new(
                403,
                "Only a Napkin admin can clear unused files.",
            ));
        }
    }
    let ws = ctx.workspace(&tenant);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let grace = q.grace_days.unwrap_or(DEFAULT_GRACE_DAYS) * 24 * 3600;
    let r = blobs::sweep(&*ws.store, now, grace, q.dry_run)?;
    Ok(Json(json!({
        "ok": true,
        "dry_run": r.dry_run,
        "referenced": r.referenced,
        "young": r.young,
        "removed": r.removed,
    })))
}

/// The picture type of `bytes` by its first bytes, or `None` when it is not a picture.
fn picture_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else {
        None
    }
}

async fn picture(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    Path((_t, sha)): Path<(String, String)>,
) -> ApiResult<Response> {
    let hex = sha.strip_prefix("sha256:").unwrap_or(&sha);
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(ApiError::new(400, "name a picture by its sha256"));
    }
    let ws = ctx.workspace(&tenant);
    let not_here = || ApiError::new(404, "this workspace holds no such picture");
    let store = ws.store.blobs().ok_or_else(not_here)?;
    let bytes = store
        .get(&format!("sha256:{hex}"))
        .map_err(|_| not_here())?;
    let ct = picture_type(&bytes).ok_or_else(not_here)?;
    Ok((
        [
            (header::CONTENT_TYPE, ct),
            (
                header::CACHE_CONTROL,
                "private, max-age=31536000, immutable",
            ),
        ],
        bytes,
    )
        .into_response())
}
