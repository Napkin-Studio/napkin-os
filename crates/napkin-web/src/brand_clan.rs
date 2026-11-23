// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Brand Clan's tenant routes (`docs/contracts/brand-clan.md` section 5).
//! Each is one `napkin_host::brand_clan::call`: the logic lives in the host,
//! shared with the desktop and the browser build.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use napkin_host::brand_clan::{call, Reply};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};
use crate::state::AppCtx;
use crate::tenant::{Acting, Tenant};

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route(
            "/t/{tenant}/clients/{client}/brand-clans",
            get(list).post(create),
        )
        .route(
            "/t/{tenant}/clients/{client}/default-brand-clan",
            put(set_default),
        )
        .route("/t/{tenant}/brand-clans/{doc}", get(get_one))
        .route("/t/{tenant}/brand-clans/{doc}/history", get(history))
        .route(
            "/t/{tenant}/brand-clans/{doc}/draft",
            put(draft_save).delete(draft_discard),
        )
        .route(
            "/t/{tenant}/brand-clans/{doc}/draft/start",
            post(draft_start),
        )
        .route("/t/{tenant}/brand-clans/{doc}/publish", post(publish))
        .route("/t/{tenant}/brand-clans/{doc}/proposal", post(proposal_set))
        .route(
            "/t/{tenant}/brand-clans/{doc}/proposal/accept",
            post(proposal_accept),
        )
        .route(
            "/t/{tenant}/brand-clans/{doc}/proposal/keep",
            post(proposal_keep),
        )
        .route(
            "/t/{tenant}/brand-clans/{doc}/update-work",
            post(update_work),
        )
        .route("/t/{tenant}/brand-clans/{doc}/assets", post(asset_put))
        .route(
            "/t/{tenant}/brand-clans/{doc}/assets/{name}",
            get(asset_get),
        )
}

fn with(mut body: Value, key: &str, v: &str) -> Value {
    if !body.is_object() {
        body = json!({});
    }
    body[key] = json!(v);
    body
}

async fn run(
    ctx: &AppCtx,
    tenant: &crate::tenant::TenantId,
    acting: &napkin_host::Ctx,
    op: &str,
    input: Value,
    body: Vec<u8>,
) -> ApiResult<Reply> {
    let ws = ctx.workspace(tenant);
    Ok(call(&*ws.store, acting, op, &input, body)?)
}

async fn json_op(
    ctx: &AppCtx,
    tenant: &crate::tenant::TenantId,
    acting: &napkin_host::Ctx,
    op: &str,
    input: Value,
) -> ApiResult<Json<Value>> {
    Ok(Json(
        run(ctx, tenant, acting, op, input, Vec::new())
            .await?
            .json(),
    ))
}

type Ctx = State<Arc<AppCtx>>;

async fn list(
    State(ctx): Ctx,
    Tenant(t): Tenant,
    Acting(a): Acting,
    Path((_t, client)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    json_op(&ctx, &t, &a, "list", json!({ "client_id": client })).await
}

async fn create(
    State(ctx): Ctx,
    Tenant(t): Tenant,
    Acting(a): Acting,
    Path((_t, client)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let v = json_op(&ctx, &t, &a, "create", with(body, "client_id", &client)).await?;
    Ok((StatusCode::CREATED, v))
}

async fn set_default(
    State(ctx): Ctx,
    Tenant(t): Tenant,
    Acting(a): Acting,
    Path((_t, client)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    json_op(
        &ctx,
        &t,
        &a,
        "default.set",
        with(body, "client_id", &client),
    )
    .await
}

#[derive(Deserialize)]
struct VersionQuery {
    version: Option<u64>,
}

async fn get_one(
    State(ctx): Ctx,
    Tenant(t): Tenant,
    Acting(a): Acting,
    Path((_t, doc)): Path<(String, String)>,
    Query(q): Query<VersionQuery>,
) -> ApiResult<Json<Value>> {
    let mut input = json!({ "path": doc });
    if let Some(v) = q.version {
        input["version"] = json!(v);
    }
    json_op(&ctx, &t, &a, "get", input).await
}

async fn history(
    State(ctx): Ctx,
    Tenant(t): Tenant,
    Acting(a): Acting,
    Path((_t, doc)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    json_op(&ctx, &t, &a, "history", json!({ "path": doc })).await
}

macro_rules! doc_post {
    ($name:ident, $op:expr) => {
        async fn $name(
            State(ctx): Ctx,
            Tenant(t): Tenant,
            Acting(a): Acting,
            Path((_t, doc)): Path<(String, String)>,
            body: Option<Json<Value>>,
        ) -> ApiResult<Json<Value>> {
            let body = body.map(|b| b.0).unwrap_or_else(|| json!({}));
            json_op(&ctx, &t, &a, $op, with(body, "path", &doc)).await
        }
    };
}

doc_post!(draft_save, "draft.save");
doc_post!(draft_start, "draft.start");
doc_post!(publish, "publish");
doc_post!(proposal_set, "proposal.set");
doc_post!(proposal_accept, "proposal.accept");
doc_post!(update_work, "work.update");

async fn draft_discard(
    State(ctx): Ctx,
    Tenant(t): Tenant,
    Acting(a): Acting,
    Path((_t, doc)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    json_op(&ctx, &t, &a, "draft.discard", json!({ "path": doc })).await
}

async fn proposal_keep(
    State(ctx): Ctx,
    Tenant(t): Tenant,
    Acting(a): Acting,
    Path((_t, doc)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    json_op(&ctx, &t, &a, "proposal.keep", json!({ "path": doc })).await
}

#[derive(Deserialize)]
struct NameQuery {
    name: String,
}

async fn asset_put(
    State(ctx): Ctx,
    Tenant(t): Tenant,
    Acting(a): Acting,
    Path((_t, doc)): Path<(String, String)>,
    Query(q): Query<NameQuery>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    let input = json!({ "path": doc, "name": q.name });
    Ok(Json(
        run(&ctx, &t, &a, "asset.put", input, body.to_vec())
            .await?
            .json(),
    ))
}

async fn asset_get(
    State(ctx): Ctx,
    Tenant(t): Tenant,
    Acting(a): Acting,
    Path((_t, doc, name)): Path<(String, String, String)>,
) -> ApiResult<Response> {
    let input = json!({ "path": doc, "name": name });
    match run(&ctx, &t, &a, "asset.get", input, Vec::new()).await? {
        Reply::Bytes {
            content_type,
            bytes,
        } => {
            // A logo is shown as a picture, never as a page: an SVG is cleaned
            // and sent as an image, and nothing here may run script.
            let bytes = if content_type == "image/svg+xml" {
                let text = String::from_utf8_lossy(&bytes);
                crate::svg_sanitise::sanitise_svg(&text)
                    .map_err(|_| ApiError::new(422, "that picture cannot be shown safely"))?
                    .into_bytes()
            } else {
                bytes
            };
            Ok((
                [
                    (header::CONTENT_TYPE, content_type),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
                    (
                        header::CONTENT_SECURITY_POLICY,
                        "default-src 'none'; style-src 'unsafe-inline'; sandbox".to_string(),
                    ),
                    (
                        header::CACHE_CONTROL,
                        "private, max-age=31536000, immutable".to_string(),
                    ),
                ],
                bytes,
            )
                .into_response())
        }
        Reply::Json(v) => Ok(Json(v).into_response()),
    }
}
