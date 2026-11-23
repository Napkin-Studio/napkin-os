// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Clearing a workspace's unused files (features/spinoff-asset-links).
//!
//! `POST /api/t/{tenant}/blobs/sweep?dry_run=true&grace_days=7`: removes the
//! stored files no document of the workspace links to, once they are older
//! than the grace period. A dry run (the default) only reports. Napkin admins
//! only; there is no background sweep.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::post;
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
    Router::new().route("/t/{tenant}/blobs/sweep", post(sweep))
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
