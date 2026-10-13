// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Production Tool inside Napkin OS (features/os-sign-in.clan).
//!
//! * `/production` and `/production/*`: the tool's static build, with its
//!   `index.html` for any path that has no file (the tool owns its routes).
//! * `/production/api/*`: a proxy to the relay, `{relay}/api/<rest>?<query>`.
//!   It answers only for a signed-in account and adds one signed, short-lived
//!   statement of who is asking (`X-Napkin-Identity`, see
//!   docs/contracts/production-tool-identity.md). The session cookie never
//!   leaves this server.
//!
//! Mounted only when `NAPKIN_PRODUCTION_RELAY_URL` is set in accounts mode.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tower_http::services::{ServeDir, ServeFile};

use crate::auth::Account;
use crate::tenant::{Identity, Mode, TenantId};

/// The header the relay reads.
pub const IDENTITY_HEADER: &str = "x-napkin-identity";
/// The largest body the proxy forwards: a Function URL takes 6 MB, and binary
/// bodies arrive base64-encoded (4.5 MB becomes 6 MB).
pub const BODY_MAX: usize = 4_500_000;
/// Above the relay Lambda's 60 s timeout (infra/envs/hackathon/lambda.tf).
pub const TIMEOUT: Duration = Duration::from_secs(65);
/// How long an assertion is good for.
pub const ASSERTION_TTL_S: u64 = 60;
/// The shortest signing key accepted, as for the session cookies.
pub const MIN_SECRET: usize = 32;
/// Where the image puts the tool's build.
pub const DEFAULT_STATIC: &str = "/srv/napkin/production";

/// Request headers the relay is given, and nothing else (projects/server.ts,
/// relay service.py).
const FORWARD: [&str; 5] = [
    "content-type",
    "if-match",
    "x-clan-reason",
    "x-project-id",
    "x-project-name",
];
/// Response headers passed back to the tool.
const PASS_BACK: [&str; 4] = ["content-type", "cache-control", "etag", "x-saved-at"];

/// The proxy's settings, from the environment (`main.rs`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    /// The relay's base URL, without a trailing slash.
    pub relay_url: String,
    /// The signing key: the first of the comma-separated keys in the secret.
    pub key: Vec<u8>,
    /// The tool's build.
    pub static_dir: PathBuf,
}

impl Config {
    /// `NAPKIN_PRODUCTION_RELAY_URL`, `NAPKIN_PRODUCTION_RELAY_SECRET` and
    /// `NAPKIN_PRODUCTION_STATIC`. `None` when the URL is unset (no
    /// `/production`). Refused: a URL with anonymous sign-in (anyone could
    /// spend), or a key under 32 bytes.
    pub fn from_vars(
        accounts: bool,
        url: Option<&str>,
        secret: Option<&str>,
        static_dir: Option<&str>,
    ) -> Result<Option<Self>, String> {
        let Some(url) = url.map(str::trim).filter(|u| !u.is_empty()) else {
            return Ok(None);
        };
        if !accounts {
            return Err("NAPKIN_PRODUCTION_RELAY_URL needs sign-in: set NAPKIN_AUTH to local, cognito or roster".into());
        }
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err(format!(
                "NAPKIN_PRODUCTION_RELAY_URL must be an http(s) URL (got {url:?})"
            ));
        }
        let key = secret
            .unwrap_or_default()
            .split(',')
            .next()
            .unwrap_or_default()
            .trim();
        if key.len() < MIN_SECRET {
            return Err(format!(
                "NAPKIN_PRODUCTION_RELAY_SECRET must be at least {MIN_SECRET} bytes"
            ));
        }
        Ok(Some(Self {
            relay_url: url.trim_end_matches('/').to_string(),
            key: key.as_bytes().to_vec(),
            static_dir: PathBuf::from(
                static_dir
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or(DEFAULT_STATIC),
            ),
        }))
    }
}

/// Marks the shell API when the tool is mounted: `/api/session` says so.
#[derive(Clone, Copy, Debug)]
pub struct Enabled;

/// The proxy: where the relay is, how to sign, how long to wait.
pub struct Relay {
    pub config: Config,
    pub timeout: Duration,
    client: reqwest::Client,
}

impl Relay {
    pub fn new(config: Config) -> Self {
        Self::with_timeout(config, TIMEOUT)
    }

    /// The same proxy with another timeout (tests).
    pub fn with_timeout(config: Config, timeout: Duration) -> Self {
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("the HTTP client builds");
        Self {
            config,
            timeout,
            client,
        }
    }
}

// ── The assertion ────────────────────────────────────────────────────────────

/// What the relay is told, in the order the contract writes it.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Claims {
    pub u: String,
    pub a: String,
    pub t: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<String>,
    pub aud: String,
    pub iat: u64,
    pub exp: u64,
    pub m: String,
    pub p: String,
    pub bh: String,
}

impl Claims {
    /// The claims for one relay call by `account`, made at `now`.
    pub fn for_request(
        account: &Account,
        method: &str,
        path_and_query: &str,
        body: &[u8],
        now: u64,
    ) -> Self {
        Self {
            u: account.username.clone(),
            a: account.agency.clone(),
            t: TenantId::of_agency(&account.agency).to_string(),
            n: account.name.clone(),
            aud: "relay".into(),
            iat: now,
            exp: now + ASSERTION_TTL_S,
            m: method.to_ascii_uppercase(),
            p: path_and_query.to_string(),
            bh: body_hash(body),
        }
    }
}

/// SHA-256 of the body, lower-case hex.
pub fn body_hash(body: &[u8]) -> String {
    Sha256::digest(body)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// `v1.<b64url claims>.<b64url HMAC-SHA256(key, "v1." + b64url claims)>`.
pub fn sign(key: &[u8], claims: &Claims) -> String {
    let json = serde_json::to_vec(claims).expect("claims serialise");
    let head = format!("v1.{}", B64.encode(json));
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("any key length");
    mac.update(head.as_bytes());
    format!("{head}.{}", B64.encode(mac.finalize().into_bytes()))
}

fn now_s() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ── The routes ───────────────────────────────────────────────────────────────

/// `/production` and everything under it (merged by `router_full`): the API
/// proxy behind the session layer, and the tool's build for everything else.
pub fn router<S: Clone + Send + Sync + 'static>(
    relay: Arc<Relay>,
    identity: Arc<Identity>,
) -> Router<S> {
    let api = Router::new()
        .fallback(proxy)
        .with_state(relay.clone())
        .layer(axum::middleware::from_fn_with_state(
            identity.clone(),
            crate::tenant::layer,
        ))
        .layer(axum::Extension(identity));
    let dir = &relay.config.static_dir;
    let tool = Router::new()
        .nest("/api", api)
        .fallback_service(static_files(dir));
    Router::new()
        // a nest does not match its own path with a trailing slash
        .route_service("/production/", ServeFile::new(dir.join("index.html")))
        .nest("/production", tool)
        .layer(axum::middleware::from_fn(cache_headers))
}

fn static_files(dir: &Path) -> ServeDir<ServeFile> {
    // a 200, not the 404 of not_found_service: these are the tool's own routes
    ServeDir::new(dir).fallback(ServeFile::new(dir.join("index.html")))
}

/// Hashed assets never change; everything else (index.html and its fallback)
/// is checked every time, so a deploy reaches people at once.
async fn cache_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let mut response = next.run(request).await;
    if path.starts_with("/production/api/") || path == "/production/api" {
        return response;
    }
    let is_html = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/html"));
    let asset = path.starts_with("/production/assets/");
    if asset && is_html {
        // a missing hashed file is a 404, never the index cached for a year
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::empty())
            .unwrap();
    }
    let value = if asset && response.status().is_success() {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    response
}

fn json(status: StatusCode, body: serde_json::Value) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body.to_string()))
        .unwrap()
}

/// The relay's error shape (common.schema.json).
fn relay_error(status: StatusCode, code: &str, message: &str, retryable: bool) -> Response {
    json(
        status,
        serde_json::json!({"error": {"code": code, "message": message, "retryable": retryable}}),
    )
}

/// The same 401 the session layer gives, so the tool reads one shape.
fn sign_in_first(identity: &Identity) -> Response {
    let password = match &identity.mode {
        Mode::Accounts { provider, .. } => provider.uses_passwords(),
        Mode::Anonymous => false,
    };
    json(
        StatusCode::UNAUTHORIZED,
        serde_json::json!({"ok": false, "error": "sign in", "signin": true, "password": password}),
    )
}

/// A write from another site: its Origin is not this host.
fn foreign_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return false; // not a browser: the session cookie is still required
    };
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default();
    let origin = origin.to_str().unwrap_or_default();
    let origin_host = origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"));
    match origin_host {
        Some(o) => host.is_empty() || !o.eq_ignore_ascii_case(host),
        None => true, // "null" and anything else
    }
}

async fn proxy(State(relay): State<Arc<Relay>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let identity = parts.extensions.get::<Arc<Identity>>().cloned();
    // The session layer lets /auth/* and /healthz through signed out; the
    // relay is never reached without an account.
    let Some(account) = parts.extensions.get::<Account>().cloned() else {
        return match identity {
            Some(i) => sign_in_first(&i),
            None => sign_in_first(&Identity::anonymous(false)),
        };
    };
    if parts.method != Method::GET && parts.method != Method::HEAD && foreign_origin(&parts.headers)
    {
        return relay_error(
            StatusCode::FORBIDDEN,
            "unauthorised",
            "This request came from another site.",
            false,
        );
    }
    let body = match axum::body::to_bytes(body, BODY_MAX).await {
        Ok(b) => b,
        Err(_) => {
            return relay_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "invalid_input",
                "This project is too big to save online (over 4.5 MB). Export it instead.",
                false,
            )
        }
    };
    // What the relay receives: /api plus the rest, with the query as sent.
    let rest = parts.uri.path();
    let path_and_query = match parts.uri.query() {
        Some(q) => format!("/api{rest}?{q}"),
        None => format!("/api{rest}"),
    };
    let claims = Claims::for_request(
        &account,
        parts.method.as_str(),
        &path_and_query,
        &body,
        now_s(),
    );
    let assertion = sign(&relay.config.key, &claims);

    let url = format!("{}{path_and_query}", relay.config.relay_url);
    let mut out = relay.client.request(parts.method.clone(), url);
    for name in FORWARD {
        for value in parts.headers.get_all(name) {
            out = out.header(name, value.clone());
        }
    }
    out = out.header(IDENTITY_HEADER, assertion).body(body);

    let answer = match out.send().await {
        Ok(r) => r,
        Err(e) if e.is_timeout() => {
            tracing::warn!(target: "napkin_web::production", error = %e, "relay timed out");
            return relay_error(
                StatusCode::GATEWAY_TIMEOUT,
                "timeout",
                "The Production Tool took too long to answer. Try again.",
                true,
            );
        }
        Err(e) => {
            tracing::warn!(target: "napkin_web::production", error = %e, "relay unreachable");
            return relay_error(
                StatusCode::BAD_GATEWAY,
                "provider_unavailable",
                "The Production Tool could not be reached. Try again in a moment.",
                true,
            );
        }
    };
    let status = answer.status();
    let mut headers = HeaderMap::new();
    for name in PASS_BACK {
        if let Some(v) = answer.headers().get(name) {
            headers.insert(HeaderName::from_static(name), v.clone());
        }
    }
    let bytes = match answer.bytes().await {
        Ok(b) => b,
        Err(e) if e.is_timeout() => {
            return relay_error(
                StatusCode::GATEWAY_TIMEOUT,
                "timeout",
                "The Production Tool took too long to answer. Try again.",
                true,
            )
        }
        Err(_) => {
            return relay_error(
                StatusCode::BAD_GATEWAY,
                "provider_unavailable",
                "The Production Tool could not be reached. Try again in a moment.",
                true,
            )
        }
    };
    let mut response = Response::builder()
        .status(status)
        .body(Body::from(bytes))
        .unwrap();
    *response.headers_mut() = headers;
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vector() -> serde_json::Value {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../production-tool/contracts/examples/identity-assertion.vector.json");
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn laurance() -> Account {
        Account {
            username: "visionary@napkin".into(),
            agency: "napkin".into(),
            name: Some("Laurance".into()),
        }
    }

    #[test]
    fn the_signer_produces_the_shared_vector_exactly() {
        let v = vector();
        let c = &v["claims"];
        let claims = Claims::for_request(
            &laurance(),
            v["method"].as_str().unwrap(),
            v["pathAndQuery"].as_str().unwrap(),
            v["body"].as_str().unwrap().as_bytes(),
            c["iat"].as_u64().unwrap(),
        );
        assert_eq!(
            serde_json::to_string(&claims).unwrap(),
            v["claimsJson"].as_str().unwrap()
        );
        assert_eq!(claims.t, c["t"].as_str().unwrap());
        assert_eq!(claims.bh, c["bh"].as_str().unwrap());
        assert_eq!(
            sign(v["key"].as_str().unwrap().as_bytes(), &claims),
            v["assertion"].as_str().unwrap()
        );
    }

    fn decode(assertion: &str) -> serde_json::Value {
        let mut parts = assertion.split('.');
        assert_eq!(parts.next(), Some("v1"));
        let claims = B64.decode(parts.next().unwrap()).unwrap();
        assert!(parts.next().is_some() && parts.next().is_none());
        serde_json::from_slice(&claims).unwrap()
    }

    #[test]
    fn an_assertion_is_for_the_relay_and_lives_a_minute() {
        let c = Claims::for_request(&laurance(), "get", "/api/me", b"", 1000);
        let d = decode(&sign(&[7u8; 32], &c));
        assert_eq!(d["aud"], "relay");
        assert_eq!(d["iat"], 1000);
        assert_eq!(d["exp"], 1060);
        assert_eq!(d["m"], "GET");
    }

    #[test]
    fn an_assertion_names_the_path_with_its_query_and_hashes_the_body() {
        let c = Claims::for_request(&laurance(), "POST", "/api/clan?x=1&y=2", b"PK\x03\x04", 1);
        assert_eq!(c.p, "/api/clan?x=1&y=2");
        assert_eq!(c.bh, body_hash(b"PK\x03\x04"));
        assert_ne!(c.bh, body_hash(b""));
        // the empty body hashes too
        assert_eq!(
            body_hash(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // no display name: no `n`
        let nameless = Account {
            name: None,
            ..laurance()
        };
        let d = decode(&sign(
            &[7u8; 32],
            &Claims::for_request(&nameless, "GET", "/api/me", b"", 1),
        ));
        assert!(d.get("n").is_none());
    }

    #[test]
    fn a_different_key_signs_differently() {
        let c = Claims::for_request(&laurance(), "GET", "/api/me", b"", 1);
        assert_ne!(sign(&[1u8; 32], &c), sign(&[2u8; 32], &c));
    }

    const KEY: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn no_relay_url_means_no_production() {
        assert_eq!(Config::from_vars(true, None, Some(KEY), None), Ok(None));
        assert_eq!(Config::from_vars(false, Some("  "), None, None), Ok(None));
    }

    #[test]
    fn a_relay_without_sign_in_is_refused() {
        let e = Config::from_vars(false, Some("http://relay"), Some(KEY), None).unwrap_err();
        assert!(e.contains("NAPKIN_AUTH"), "{e}");
    }

    #[test]
    fn a_short_or_missing_secret_is_refused() {
        for secret in [
            None,
            Some(""),
            Some("short"),
            Some("short,0123456789abcdef0123456789abcdef"),
        ] {
            let e = Config::from_vars(true, Some("http://relay"), secret, None).unwrap_err();
            assert!(e.contains("32 bytes"), "{secret:?}: {e}");
        }
    }

    #[test]
    fn the_first_key_signs_and_the_url_loses_its_slash() {
        let c = Config::from_vars(
            true,
            Some("https://relay.example/"),
            Some(&format!("{KEY}, old-key-old-key-old-key-old-key-old")),
            None,
        )
        .unwrap()
        .unwrap();
        assert_eq!(c.relay_url, "https://relay.example");
        assert_eq!(c.key, KEY.as_bytes());
        assert_eq!(c.static_dir, PathBuf::from(DEFAULT_STATIC));
        let c = Config::from_vars(true, Some("http://r"), Some(KEY), Some("/tmp/x"))
            .unwrap()
            .unwrap();
        assert_eq!(c.static_dir, PathBuf::from("/tmp/x"));
        assert!(Config::from_vars(true, Some("relay:8787"), Some(KEY), None).is_err());
    }

    #[test]
    fn only_a_write_from_another_site_is_foreign() {
        let h = |origin: Option<&str>| {
            let mut m = HeaderMap::new();
            m.insert(header::HOST, HeaderValue::from_static("studio.napkin.ie"));
            if let Some(o) = origin {
                m.insert(header::ORIGIN, HeaderValue::from_str(o).unwrap());
            }
            m
        };
        assert!(!foreign_origin(&h(None)));
        assert!(!foreign_origin(&h(Some("https://studio.napkin.ie"))));
        assert!(foreign_origin(&h(Some("https://evil.example"))));
        assert!(foreign_origin(&h(Some("null"))));
        assert!(foreign_origin(&h(Some(
            "https://studio.napkin.ie.evil.example"
        ))));
    }
}
