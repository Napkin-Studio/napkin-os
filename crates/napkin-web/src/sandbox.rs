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
use axum::Extension;
use axum::Router;
use napkin_host::frame::Reach;
use napkin_host::{HostEvent, HostRequest, HostResponse};

use crate::production::Relay;
use crate::state::AppCtx;
use crate::tokens::Grant;

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
    relay: Option<Extension<Arc<Relay>>>,
    body: Bytes,
) -> Response {
    dispatch(
        state,
        Path((token, String::new())),
        query,
        method,
        relay,
        body,
    )
    .await
}

async fn dispatch(
    State(ctx): State<Arc<AppCtx>>,
    Path((token, rest)): Path<(String, String)>,
    RawQuery(query): RawQuery,
    method: Method,
    relay: Option<Extension<Arc<Relay>>>,
    body: Bytes,
) -> Response {
    // The app frame's cross-origin POSTs are simple requests today (no custom
    // headers), but answer preflight anyway so an app that sets one still works.
    if method == Method::OPTIONS {
        return preflight();
    }

    let Some(grant) = ctx.tokens.resolve(&token) else {
        return stale_token();
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

    crate::timing::note_who(grant.tenant.as_str(), &grant.person);
    crate::timing::note_op(&path);
    let workspace = ctx.workspace(&grant.tenant);
    let session = match crate::timing::phase("session", || workspace.session(&grant.doc)) {
        Ok(s) => s,
        Err(e) => return refuse(status_of(e.status), &e.message),
    };

    let started = std::time::Instant::now();
    let sent = if path == "/api-proxy" {
        Bytes::from(with_production_assets(
            &body,
            relay.as_deref().map(|r| &**r),
            &grant,
        ))
    } else {
        body.clone()
    };
    let req = HostRequest::new(path.clone(), query.unwrap_or_default(), sent.to_vec());
    // The grant, not the request, says who this is: an app frame cannot name
    // its own actor or scope.
    let resp = napkin_host::dispatch_async(
        &grant.tenant.ctx_for(&grant.person),
        &session,
        &*ctx.config,
        req,
    )
    .await;
    crate::timing::add_ms("dispatch", started);
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

/// The key napkin-web sets on a middleware `build_deck` payload, and the only
/// writer of it: `{base, pass}` (docs/contracts/production-tool-identity.md,
/// "The assets pass").
pub const PRODUCTION_ASSETS: &str = "production_assets";

/// An `/api-proxy` body with `payload.production_assets` decided by the
/// server alone: any value the app frame sent is dropped from every call (the
/// browser must not inject one), and a middleware `build_deck` gets a freshly
/// signed read-only pass for the grant's agency when the Production relay is
/// configured. Least privilege: the pass names no picture and reads nothing but
/// `GET /assets`; it goes to `build_deck` only (the middleware forwards it to the
/// engine only for a document that carries a Production project). Without a
/// relay, or for a grant that is not a signed-in account of its tenant, the
/// field is simply absent. A body that is not a JSON object is returned as it came.
fn with_production_assets(body: &[u8], relay: Option<&Relay>, grant: &Grant) -> Vec<u8> {
    let Ok(mut req) = serde_json::from_slice::<serde_json::Value>(body) else {
        return body.to_vec();
    };
    let Some(payload) = req.get_mut("payload").and_then(|p| p.as_object_mut()) else {
        return body.to_vec();
    };
    let had = payload.remove(PRODUCTION_ASSETS).is_some();
    let build = req.get("request_kind").and_then(|v| v.as_str()) == Some("middleware")
        && req["payload"].get("task").and_then(|v| v.as_str()) == Some("build_deck");
    let pass = relay.filter(|_| build).and_then(|r| {
        let (_, agency) = crate::auth::Account::parse_username(&grant.person)?;
        (crate::tenant::TenantId::of_agency(&agency) == grant.tenant)
            .then(|| r.production_assets(&grant.person, &agency))
    });
    if pass.is_none() && !had {
        return body.to_vec();
    }
    if let Some(pass) = pass {
        req["payload"][PRODUCTION_ASSETS] = pass;
    }
    serde_json::to_vec(&req).unwrap_or_else(|_| body.to_vec())
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
        return stale_token();
    };
    crate::timing::note_who(grant.tenant.as_str(), &grant.person);
    let ws = ctx.workspace(&grant.tenant);
    let session = match crate::timing::phase("session", || ws.session(&grant.doc)) {
        Ok(s) => s,
        Err(e) => return refuse(status_of(e.status), &e.message),
    };
    let started = std::time::Instant::now();
    let origin = frame_origin(ctx.sandbox_origin.as_deref(), &headers, &token);
    let page = crate::timing::phase("compose", || {
        session.frame_page(query.as_deref().unwrap_or(""), Reach::Origin(origin))
    });
    let response = match page {
        Ok(page) => {
            crate::timing::note_bytes(page.len());
            let tag = crate::timing::phase("etag", || crate::etag::tag_of(page.as_bytes()));
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

/// What `code` says on a refusal of the token itself, and on nothing else.
pub const STALE_TOKEN: &str = "sandbox_token";

/// A token this server does not hold: never minted, past its TTL, or minted
/// by a process that has since restarted (a deploy) — tokens live in memory.
///
/// Deliberately the same answer for each: a caller probing tokens learns
/// nothing about which documents exist. It carries `code` so the page that
/// held the token can tell it from every other refusal, ask the shell to open
/// the document again for a fresh one, and retry the call once
/// (`app/src/shell/bridge/webShim.js`, `app/src/host/http.ts`).
fn stale_token() -> Response {
    (
        StatusCode::FORBIDDEN,
        [
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
            (header::CONTENT_TYPE, "application/json".to_string()),
        ],
        serde_json::json!({
            "ok": false,
            "error": "invalid or expired sandbox token",
            "code": STALE_TOKEN,
        })
        .to_string(),
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

    const KEY: &str = "0123456789abcdef0123456789abcdef";

    fn relay() -> Relay {
        let cfg = crate::production::Config::from_vars(
            true,
            Some("https://relay.example/"),
            Some(KEY),
            None,
        )
        .unwrap()
        .unwrap();
        Relay::new(cfg)
    }

    fn grant(person: &str, agency: &str) -> Grant {
        Grant {
            tenant: crate::tenant::TenantId::of_agency(agency),
            person: person.into(),
            doc: napkin_host::DocId::new("doc"),
        }
    }

    fn body(task: &str, extra: serde_json::Value) -> Vec<u8> {
        let mut payload = serde_json::json!({ "task": task, "input": {} });
        if let Some(e) = extra.as_object() {
            payload.as_object_mut().unwrap().extend(e.clone());
        }
        serde_json::to_vec(&serde_json::json!({
            "request_kind": "middleware", "payload": payload }))
        .unwrap()
    }

    fn claims_of(pass: &str) -> serde_json::Value {
        use base64::Engine as _;
        let part = pass.split('.').nth(1).unwrap();
        serde_json::from_slice(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(part)
                .unwrap(),
        )
        .unwrap()
    }

    fn assets_of(out: &[u8]) -> serde_json::Value {
        let v: serde_json::Value = serde_json::from_slice(out).unwrap();
        v["payload"]["production_assets"].clone()
    }

    #[test]
    fn a_build_deck_gets_an_assets_pass_for_the_callers_tenant() {
        let r = relay();
        let g = grant("visionary@napkin", "napkin");
        let out = with_production_assets(&body("build_deck", serde_json::json!({})), Some(&r), &g);
        let a = assets_of(&out);
        assert_eq!(a["base"], "https://relay.example/api");
        let pass = a["pass"].as_str().unwrap();
        let c = claims_of(pass);
        assert_eq!(c["aud"], "assets");
        assert_eq!(c["a"], "napkin");
        assert_eq!(c["u"], "visionary@napkin");
        assert_eq!(c["t"], g.tenant.to_string());
        assert_eq!(
            c["exp"].as_u64().unwrap() - c["iat"].as_u64().unwrap(),
            1800
        );
        assert_eq!(c["m"], "GET");
        // signed with the relay's key
        let want = crate::production::sign(
            KEY.as_bytes(),
            &crate::production::Claims::assets_pass(
                "visionary@napkin",
                "napkin",
                c["iat"].as_u64().unwrap(),
            ),
        );
        assert_eq!(pass, want);
        // the rest of the body is untouched
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["payload"]["task"], "build_deck");
    }

    #[test]
    fn a_value_the_browser_sends_is_stripped_on_every_call() {
        let r = relay();
        let g = grant("visionary@napkin", "napkin");
        let planted =
            serde_json::json!({ "production_assets": { "base": "https://evil", "pass": "x" } });
        // on build_deck it is replaced by the server's own
        let out = with_production_assets(&body("build_deck", planted.clone()), Some(&r), &g);
        let a = assets_of(&out);
        assert_eq!(a["base"], "https://relay.example/api");
        assert_ne!(a["pass"], "x");
        // on any other task, and with no relay, it is dropped, not forwarded
        for task in ["draft_brief", "job_status"] {
            let out = with_production_assets(&body(task, planted.clone()), Some(&r), &g);
            assert!(assets_of(&out).is_null(), "{task}");
        }
        let out = with_production_assets(&body("build_deck", planted), None, &g);
        assert!(assets_of(&out).is_null());
    }

    #[test]
    fn no_relay_or_no_account_means_no_pass() {
        let g = grant("visionary@napkin", "napkin");
        let plain = body("build_deck", serde_json::json!({}));
        assert_eq!(with_production_assets(&plain, None, &g), plain);
        let r = relay();
        // an anonymous visitor's person is the tenant id: not an account
        let anon = grant("0a1b2c", "napkin");
        assert_eq!(with_production_assets(&plain, Some(&r), &anon), plain);
        // an account whose agency is not the grant's tenant
        let mismatch = Grant {
            tenant: crate::tenant::TenantId::of_agency("other"),
            ..g.clone()
        };
        assert_eq!(with_production_assets(&plain, Some(&r), &mismatch), plain);
        // only build_deck is given a pass
        let other = body("draft_brief", serde_json::json!({}));
        assert_eq!(with_production_assets(&other, Some(&r), &g), other);
        // a body that is not JSON passes through as it came
        assert_eq!(
            with_production_assets(b"nope", Some(&r), &g),
            b"nope".to_vec()
        );
    }

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
