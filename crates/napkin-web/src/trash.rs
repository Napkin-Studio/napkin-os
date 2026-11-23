// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Delete that can be undone (features/production-in-library, owner decision
//! 2026-11-23): a deleted document moves to the agency's trash and can be
//! restored for 30 days. The library and client listings read only the
//! documents directory, so a trashed document drops out of both.
//!
//! * `DELETE /api/t/{tenant}/d/{doc}`: to the trash. 200
//!   `{"trashed":true,"restorable_until":"<RFC 3339>"}`.
//! * `GET /api/t/{tenant}/trash[?client=<id>]`: `[{"path","trashed_at",
//!   "restorable_until","title","app_id","client_id","by"}]`, newest first. The
//!   last four are what the document said when it was trashed and who trashed
//!   it (null for a document trashed before they were kept).
//! * `POST /api/t/{tenant}/d/{doc}/restore`: back to the library. 200
//!   `{"restored":true,"path":"<doc>"}`; 409 if the id is in use; 404 if not trashed.
//! * `POST /api/t/{tenant}/trash/purge` `{"dry_run":true}` (default): Napkin
//!   admins only. Removes what was trashed more than 30 days ago; a dry run
//!   only lists. 200 `{"dry_run":bool,"older_than_days":30,"purged":[path..]}`.
//!
//! The trash is the tenant's own directory: another agency's delete, restore
//! or purge never reaches it (404).

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use napkin_host::DocId;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::Account;
use crate::error::{ApiError, ApiResult};
use crate::people::is_admin;
use crate::state::AppCtx;
use crate::tenant::Tenant;

/// How long a deleted document can be brought back.
pub const RETAIN_DAYS: u128 = 30;
const DAY_MS: u128 = 24 * 3600 * 1000;

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/t/{tenant}/d/{doc}", delete(trash_document))
        .route("/t/{tenant}/d/{doc}/restore", post(restore_document))
        .route("/t/{tenant}/trash", get(list_trash))
        .route("/t/{tenant}/trash/purge", post(purge))
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

fn rfc3339(ms: u128) -> String {
    chrono::DateTime::from_timestamp_millis(ms as i64)
        .map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default()
}

fn store(ws: &crate::state::Workspace) -> ApiResult<&crate::store::TenantStore> {
    ws.tenant_store
        .as_deref()
        .ok_or_else(|| ApiError::new(500, "this store has no trash"))
}

async fn trash_document(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
    Path((_t, doc)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let ws = ctx.workspace(&tenant);
    let id = DocId::new(doc);
    let at = now_ms();
    let by = account.map(|Extension(a)| {
        a.name
            .filter(|n| !n.trim().is_empty())
            .unwrap_or(a.username)
    });
    store(&ws)?.trash(&id, at, by.as_deref())?;
    ws.forget(&id);
    Ok(Json(json!({
        "trashed": true,
        "restorable_until": rfc3339(at + RETAIN_DAYS * DAY_MS),
    })))
}

async fn restore_document(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    Path((_t, doc)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let ws = ctx.workspace(&tenant);
    let id = DocId::new(doc.clone());
    store(&ws)?.restore(&id)?;
    ws.forget(&id);
    Ok(Json(json!({ "restored": true, "path": doc })))
}

async fn list_trash(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let ws = ctx.workspace(&tenant);
    let st = store(&ws)?;
    let items: Vec<Value> = st
        .trashed()
        .into_iter()
        .map(|(id, ms)| {
            let n = st.trash_note(&id, ms);
            (id, ms, n)
        })
        .filter(|(_, _, n)| {
            q.get("client")
                .map_or(true, |c| n.client_id.as_deref() == Some(c.as_str()))
        })
        .map(|(id, ms, n)| {
            json!({
                "path": id.as_str(),
                "trashed_at": rfc3339(ms),
                "restorable_until": rfc3339(ms + RETAIN_DAYS * DAY_MS),
                "title": n.title,
                "app_id": n.app_id,
                "client_id": n.client_id,
                "by": n.by,
            })
        })
        .collect();
    Ok(Json(Value::Array(items)))
}

#[derive(Deserialize, Default)]
struct PurgeBody {
    #[serde(default = "yes")]
    dry_run: bool,
}

fn yes() -> bool {
    true
}

async fn purge(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
    body: Option<Json<PurgeBody>>,
) -> ApiResult<Json<Value>> {
    if let Some(Extension(a)) = &account {
        if !is_admin(&a.username) {
            return Err(ApiError::new(
                403,
                "Only a Napkin admin can empty the trash.",
            ));
        }
    }
    let dry_run = body.map_or(true, |Json(b)| b.dry_run);
    let ws = ctx.workspace(&tenant);
    let cutoff = now_ms().saturating_sub(RETAIN_DAYS * DAY_MS);
    let gone = store(&ws)?.purge_trash(cutoff, dry_run)?;
    Ok(Json(json!({
        "dry_run": dry_run,
        "older_than_days": RETAIN_DAYS,
        "purged": gone.iter().map(|d| d.as_str()).collect::<Vec<_>>(),
    })))
}
