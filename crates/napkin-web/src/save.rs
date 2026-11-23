// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Saving a whole Production document (features/production-in-library).
//!
//! `PUT /api/t/{tenant}/d/{doc}/save` with `If-Match: "<version>"` replaces
//! the document with the bytes sent, when it is still at that version. The new
//! version is the sha256 of the bytes. A save that started from an older
//! version is a 409 naming the winner's; nothing is overwritten. The same
//! cached session every other route uses is re-read afterwards, so no open tab
//! is left on the old archive, and `clan-data-changed` goes out.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::put;
use axum::{Json, Router};
use napkin_host::{Change, DocId, HostEvent, Version};
use serde_json::json;

use crate::error::{ApiError, ApiResult};
use crate::snapshots::Reason;
use crate::state::AppCtx;
use crate::tenant::Tenant;

/// The Production app's id: the only app this route saves.
pub const PRODUCTION_APP_ID: &str = "ie.napkin.production";
/// The largest save.
pub const SAVE_MAX: usize = 32 * 1024 * 1024;

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route(
        "/t/{tenant}/d/{doc}/save",
        put(save).layer(DefaultBodyLimit::max(SAVE_MAX)),
    )
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// `"sha256:..."` (quotes optional, a weak prefix refused) from `If-Match`.
fn if_match(h: &HeaderMap) -> ApiResult<String> {
    let raw = h
        .get(header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ApiError::new(428, "If-Match is required: name the version you opened."))?;
    Ok(raw.trim().trim_matches('"').to_string())
}

/// A Production instance (not a template) that is `doc`: else a 422.
fn check_instance(clan: &clan_sdk::ClanFile) -> ApiResult<()> {
    let m = clan.manifest();
    let app = m.app.as_ref().map(|a| a.app_id.as_str());
    if m.document_type.as_deref() == Some("template") || app != Some(PRODUCTION_APP_ID) {
        return Err(ApiError::new(
            422,
            "Only a Production project can be saved this way.",
        ));
    }
    Ok(())
}

async fn save(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    Path((_t, doc)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let ws = ctx.workspace(&tenant);
    let id = DocId::new(doc.clone());
    // another tenant's document does not exist in this tenant's tree: 404
    if !ws.store.exists(&id) {
        return Err(ApiError::new(404, "no such project"));
    }
    // an app template (or the home page) is not an instance of anything
    if !id.as_str().starts_with("doc-") {
        return Err(ApiError::new(422, "A template is not a project."));
    }
    let base = if_match(&headers)?;
    let reason = match headers.get("x-clan-reason").and_then(|v| v.to_str().ok()) {
        None => Reason::Interval,
        Some(r) => Reason::parse(r.trim())
            .ok_or_else(|| ApiError::new(400, format!("unknown X-Clan-Reason: {r}")))?,
    };
    // the stored document must itself be a Production instance
    let stored = clan_sdk::ClanFile::from_bytes(ws.store.read(&id)?)
        .map_err(|e| ApiError::new(422, e.to_string()))?;
    check_instance(&stored)?;
    let sent = clan_sdk::ClanFile::from_bytes(body.to_vec())
        .map_err(|e| ApiError::new(400, format!("not a readable .clan: {e}")))?;
    check_instance(&sent)?;
    if sent.document_id() != stored.document_id() {
        return Err(ApiError::new(
            422,
            "These bytes are another project's, not this one's.",
        ));
    }
    drop(stored);

    let version: Version = ws.store.apply(&Change::replace(
        id.clone(),
        Version::new(base),
        body.to_vec(),
    ))?;

    // Every open tab shares this one session: re-read it, so it is on the new
    // archive and the next patch from it is based on the new version.
    if let Err(e) = ws.open(&id) {
        tracing::warn!(doc = %id, error = %e, "saved, but the open session could not be refreshed");
        ws.forget(&id);
    }
    let saved_at = chrono::Utc::now();
    ctx.events.publish(
        &tenant,
        &HostEvent::DataChanged(json!({ "path": doc, "version": version.as_str() })),
    );

    let mut snapshot = false;
    if let Some(ts) = &ws.tenant_store {
        let ring = crate::snapshots::Ring::new(ts.snapshots_dir());
        match ring.record(&doc, reason, &body, now_ms()) {
            Ok(taken) => snapshot = taken,
            // the save already happened; a missing snapshot is logged, not an error
            Err(e) => tracing::warn!(doc = %id, error = %e, "snapshot not taken"),
        }
    }

    let mut resp = (
        StatusCode::OK,
        Json(json!({
            "version": version.as_str(),
            "saved_at": saved_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "snapshot": snapshot,
        })),
    )
        .into_response();
    if let Ok(v) = HeaderValue::from_str(&format!("\"{version}\"")) {
        resp.headers_mut().insert(header::ETAG, v);
    }
    Ok(resp)
}
