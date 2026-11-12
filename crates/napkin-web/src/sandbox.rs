// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The app sandbox: the `clan://` surface, over HTTP.
//!
//! `/s/{token}/patch-data` is `clan://localhost/patch-data`. The path after the
//! token is handed to `napkin_host::handle_async` verbatim, which is why the
//! routing table did not have to be rewritten to get here — and why a route
//! added for one shell appears in the other.
//!
//! Authority is the token, not a cookie. Nothing here reads the session: an app
//! frame is third-party code on (eventually) its own origin, sends no
//! credentials, and can reach exactly the one document its token names.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, RawQuery, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::Router;
use napkin_host::frame::Reach;
use napkin_host::{HostEvent, HostRequest, HostResponse};

use crate::state::AppCtx;

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        // The frame's page is this server's to compose: it knows the URL the
        // frame reaches the host on, which `clan://document` does not.
        .route("/{token}/document", get(document))
        .route("/{token}/{*rest}", any(dispatch))
        // A token with nothing after it addresses no route; answer like the
        // host does for an unknown path rather than 404ing at the router.
        .route("/{token}", any(dispatch_root))
}

async fn dispatch_root(
    state: State<Arc<AppCtx>>,
    Path(token): Path<String>,
    query: RawQuery,
    method: Method,
    body: Bytes,
) -> Response {
    dispatch(state, Path((token, String::new())), query, method, body).await
}

async fn dispatch(
    State(ctx): State<Arc<AppCtx>>,
    Path((token, rest)): Path<(String, String)>,
    RawQuery(query): RawQuery,
    method: Method,
    body: Bytes,
) -> Response {
    // The app frame's cross-origin POSTs are simple requests today (no custom
    // headers), but answer preflight anyway so an app that sets one still works.
    if method == Method::OPTIONS {
        return preflight();
    }

    let Some(grant) = ctx.tokens.resolve(&token) else {
        // Deliberately indistinguishable from an expired one: a caller probing
        // tokens learns nothing about which documents exist.
        return refuse(StatusCode::FORBIDDEN, "invalid or expired sandbox token");
    };

    let path = format!("/{}", rest.trim_start_matches('/'));

    // The one route that spends money is metered before it is dispatched —
    // every call through it but a middleware `job_status` poll, which waits on
    // work already charged (`meter::charged`; an unreadable body is charged).
    if path == "/api-proxy" && crate::meter::charged(&body) {
        if let Err(usage) = ctx.meter.try_spend(&grant.tenant) {
            return refuse(
                StatusCode::TOO_MANY_REQUESTS,
                &format!(
                    "agent quota reached for this session ({}/{})",
                    usage.used, usage.cap
                ),
            );
        }
    }

    let workspace = ctx.workspace(&grant.tenant);
    let session = match workspace.session(&grant.doc) {
        Ok(s) => s,
        Err(e) => return refuse(status_of(e.status), &e.message),
    };

    let started = std::time::Instant::now();
    let req = HostRequest::new(path.clone(), query.unwrap_or_default(), body.to_vec());
    // The grant, not the request, says who this is: an app frame cannot name
    // its own actor or scope.
    let resp = napkin_host::dispatch_async(
        &grant.tenant.ctx_for(&grant.person),
        &session,
        &*ctx.config,
        req,
    )
    .await;
    // An app that builds its own export (`clan://export`) gets back a temp file
    // on this server. The browser cannot fetch a server path, so it is stashed
    // behind a handle. The event goes to every tab of the tenant (in accounts
    // mode, the whole agency), so it names the asking frame, and only that
    // frame's token claims the handle: other tabs neither act on it nor can
    // (features/pdf-export.clan).
    for e in &resp.events {
        match e {
            HostEvent::ExportRequest {
                kind,
                filename,
                tmp_html,
            } => ctx.events.publish_to_frame(
                &grant.tenant,
                &HostEvent::ExportRequest {
                    kind: kind.clone(),
                    filename: filename.clone(),
                    tmp_html: ctx.exports.stash(
                        &grant.tenant,
                        tmp_html.clone(),
                        filename.clone(),
                        Some(&token),
                    ),
                },
                &crate::tokens::frame_id(&token),
            ),
            other => ctx.events.publish(&grant.tenant, other),
        }
    }
    let job = (ctx.dogfood.is_some() && path == "/api-proxy")
        .then(|| crate::dogfood::job_of(&resp.body))
        .flatten();
    let response = into_response(resp);
    // the dogfood build records the call, body and all (a no-op elsewhere)
    if ctx.dogfood.is_some() {
        crate::dogfood::capture_sandbox(
            &ctx,
            crate::dogfood::SandboxCall {
                person: &grant.person,
                doc: grant.doc.as_str(),
                app: session.app_id(),
                path: &path,
                method: method.as_str(),
                body: &body,
                status: response.status(),
                start: started,
                job,
            },
        );
    }
    response
}

/// The page the app frame loads (features/doc-open-direct.clan).
///
/// Composed here, on request, from the session's view: the shell names only
/// what it alone knows — `model`, `capture` and `theme` in the query, and `v`,
/// the document's version, so a changed document is a new address — and sets
/// the frame's src to this. Nothing is posted and nothing is stored.
///
/// The page carries a weak ETag of its bytes and `Cache-Control: private,
/// no-cache`: a re-open asks again and an unchanged page answers `304` with no
/// body. The bytes are a function of the document, its view, the options, the
/// frame's URL and the scripts in this build, so the tag changes with any of
/// them. The compression layer packs the `200`.
async fn document(
    State(ctx): State<Arc<AppCtx>>,
    Path(token): Path<String>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Response {
    let Some(grant) = ctx.tokens.resolve(&token) else {
        return refuse(StatusCode::FORBIDDEN, "invalid or expired sandbox token");
    };
    let session = match ctx.workspace(&grant.tenant).session(&grant.doc) {
        Ok(s) => s,
        Err(e) => return refuse(status_of(e.status), &e.message),
    };
    let started = std::time::Instant::now();
    let origin = frame_origin(ctx.sandbox_origin.as_deref(), &headers, &token);
    let response = match session.frame_page(query.as_deref().unwrap_or(""), Reach::Origin(origin)) {
        Ok(page) => {
            let tag = crate::etag::tag_of(page.as_bytes());
            let held = headers
                .get(header::IF_NONE_MATCH)
                .and_then(|v| v.to_str().ok())
                .is_some_and(|h| crate::etag::matches(h, &tag));
            let tag = HeaderValue::from_str(&tag).expect("base64 and quotes are a valid header");
            let no_cache = HeaderValue::from_static("private, no-cache");
            if held {
                (
                    StatusCode::NOT_MODIFIED,
                    [(header::ETAG, tag), (header::CACHE_CONTROL, no_cache)],
                )
                    .into_response()
            } else {
                (
                    [
                        (
                            header::CONTENT_TYPE,
                            HeaderValue::from_static("text/html; charset=utf-8"),
                        ),
                        (header::ETAG, tag),
                        (header::CACHE_CONTROL, no_cache),
                    ],
                    page,
                )
                    .into_response()
            }
        }
        Err(e) => refuse(status_of(e.status), &e.message),
    };
    // the dogfood build records the call, as it records every sandbox call
    if ctx.dogfood.is_some() {
        crate::dogfood::capture_sandbox(
            &ctx,
            crate::dogfood::SandboxCall {
                person: &grant.person,
                doc: grant.doc.as_str(),
                app: session.app_id(),
                path: "/document",
                method: "GET",
                body: &Bytes::new(),
                status: response.status(),
                start: started,
                job: None,
            },
        );
    }
    response
}

/// The frame's token base, as the shell's `clanOrigin()` names it: the
/// sandbox origin when one is configured, else the origin the frame asked
/// this server on (`Host`, and the scheme the load balancer says it took),
/// then `/s/{token}`. With neither, the bare path, which the frame resolves
/// against its own origin.
fn frame_origin(configured: Option<&str>, headers: &HeaderMap, token: &str) -> String {
    let base = configured.map(str::to_string).or_else(|| {
        let host = headers.get(header::HOST)?.to_str().ok()?;
        let plain = |b: u8| b.is_ascii_alphanumeric() || b"-.:[]".contains(&b);
        if host.is_empty() || !host.bytes().all(plain) {
            return None;
        }
        let scheme = headers
            .get("x-forwarded-proto")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .map(str::trim)
            .filter(|p| *p == "https" || *p == "http")
            .unwrap_or("http");
        Some(format!("{scheme}://{host}"))
    });
    format!("{}/s/{token}", base.unwrap_or_default())
}

fn status_of(code: u16) -> StatusCode {
    StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

fn into_response(resp: HostResponse) -> Response {
    let mut out = Response::builder().status(status_of(resp.status));
    for (k, v) in &resp.headers {
        if let (Ok(name), Ok(value)) = (HeaderName::try_from(k.as_str()), HeaderValue::from_str(v))
        {
            out = out.header(name, value);
        }
    }
    out.body(resp.body.into())
        .unwrap_or_else(|_| refuse(StatusCode::INTERNAL_SERVER_ERROR, "malformed host response"))
}

fn preflight() -> Response {
    (
        StatusCode::NO_CONTENT,
        [
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
            (header::ACCESS_CONTROL_ALLOW_METHODS, "GET, POST, OPTIONS"),
            (header::ACCESS_CONTROL_ALLOW_HEADERS, "Content-Type"),
            (header::ACCESS_CONTROL_MAX_AGE, "600"),
        ],
    )
        .into_response()
}

fn refuse(status: StatusCode, message: &str) -> Response {
    (
        status,
        [
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
            (header::CONTENT_TYPE, "application/json".to_string()),
        ],
        serde_json::json!({ "ok": false, "error": message }).to_string(),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(*k, v.parse().unwrap());
        }
        h
    }

    #[test]
    fn the_frame_origin_is_the_one_the_shell_would_name() {
        let h = headers(&[
            ("host", "uat.napkin.studio"),
            ("x-forwarded-proto", "https"),
        ]);
        assert_eq!(
            frame_origin(None, &h, "tok"),
            "https://uat.napkin.studio/s/tok"
        );
        assert_eq!(
            frame_origin(Some("https://sandbox.example"), &h, "tok"),
            "https://sandbox.example/s/tok"
        );
        let local = headers(&[("host", "localhost:8080")]);
        assert_eq!(frame_origin(None, &local, "t"), "http://localhost:8080/s/t");
        let odd = headers(&[
            ("host", "x\"><script>"),
            ("x-forwarded-proto", "javascript"),
        ]);
        assert_eq!(frame_origin(None, &odd, "t"), "/s/t");
        assert_eq!(frame_origin(None, &HeaderMap::new(), "t"), "/s/t");
    }
}
