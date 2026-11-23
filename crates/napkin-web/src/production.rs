// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Production Tool inside Napkin OS (features/os-sign-in.clan).
//!
//! * `/production` and `/production/*`: the tool's static build, with its
//!   `index.html` for any path that has no file (the tool owns its routes).
//!   A project is a page of its own, `/production/d/{doc}` (the library
//!   document's id); `/production/?doc={doc}` redirects there for one release
//!   (features/production-app-page.clan).
//! * Every page of the tool carries one Content-Security-Policy, report-only
//!   for now; violations come to `POST /production/csp-report` and the log.
//! * The tool's calls to the relay are napkin-web's own routes under the shell
//!   API, `/api/t/{tenant}/production/…` and `/api/t/{tenant}/d/{doc}/production/…`
//!   ([`api_router`], features/production-jobs-via-host.clan). napkin-web calls
//!   the relay itself with a service credential and a claim it mints from the
//!   session ([`crate::relay_client`]); nothing the browser sends is a credential
//!   and the browser never reaches the relay. `/production/api/*` is gone.
//! * A job's outcome waits in the document's inbox until the tool lands it
//!   ([`napkin_host::inbox`]); the shell's library watcher settles a job whose
//!   tab was closed ([`settle`]).
//!
//! Mounted only when `NAPKIN_PRODUCTION_RELAY_URL` is set in accounts mode.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::body::Bytes;
use axum::extract::{Path as UrlPath, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{any, get, post};
use axum::{Extension, Router};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use napkin_host::inbox::{self, Entry, InboxStore, Put, Settled};
use napkin_host::DocId;
use serde::Serialize;
use sha2::Sha256;
use tower_http::services::{ServeDir, ServeFile};

use crate::auth::Account;
use crate::relay_client::{now_s, Answer, RelayClient};
use crate::state::AppCtx;
use crate::tenant::TenantId;

pub use crate::relay_client::body_hash;
/// The largest body the proxy forwards: a Function URL takes 6 MB, and binary
/// bodies arrive base64-encoded (4.5 MB becomes 6 MB).
pub const BODY_MAX: usize = 4_500_000;
/// Above the relay Lambda's 60 s timeout (infra/envs/hackathon/lambda.tf).
pub const TIMEOUT: Duration = Duration::from_secs(65);
/// How long an assets pass is good for: a deck build's picture step, with room
/// (docs/contracts/production-tool-identity.md, "The assets pass"). The relay
/// refuses any pass that lives past an hour.
pub const ASSETS_TTL_S: u64 = 1800;
/// The shortest signing key accepted, as for the session cookies.
pub const MIN_SECRET: usize = 32;
/// Where the image puts the tool's build.
pub const DEFAULT_STATIC: &str = "/srv/napkin/production";

/// The proxy's settings, from the environment (`main.rs`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    /// The relay's base URL, without a trailing slash.
    pub relay_url: String,
    /// The assets pass's signing key: the first of the comma-separated keys in the secret.
    pub key: Vec<u8>,
    /// The service key napkin-web calls the relay with (the first of `new,old`).
    pub service_key: Vec<u8>,
    /// The tool's build.
    pub static_dir: PathBuf,
}

impl Config {
    /// `NAPKIN_PRODUCTION_RELAY_URL`, `NAPKIN_PRODUCTION_RELAY_SECRET` (the
    /// assets pass), `NAPKIN_PRODUCTION_SERVICE_KEY` (every other call) and
    /// `NAPKIN_PRODUCTION_STATIC`. `None` when the URL is unset (no
    /// `/production`). Refused: a URL with anonymous sign-in (anyone could
    /// spend), or a key under 32 bytes.
    pub fn from_vars(
        accounts: bool,
        url: Option<&str>,
        secret: Option<&str>,
        service_key: Option<&str>,
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
        let service = service_key
            .unwrap_or_default()
            .split(',')
            .next()
            .unwrap_or_default()
            .trim();
        if service.len() < MIN_SECRET {
            return Err(format!(
                "NAPKIN_PRODUCTION_SERVICE_KEY must be at least {MIN_SECRET} bytes"
            ));
        }
        Ok(Some(Self {
            relay_url: url.trim_end_matches('/').to_string(),
            key: key.as_bytes().to_vec(),
            service_key: service.as_bytes().to_vec(),
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
    /// The https base pictures come from (NAPKIN_PRODUCTION_MEDIA_BASE): the CSP names its origin.
    pub media_base: Option<String>,
    /// Where the browser PUTs upload bytes (NAPKIN_PRODUCTION_UPLOAD_ORIGIN): the S3 origin of the
    /// relay's presigned links. The CSP's connect-src names it beside the media base.
    pub upload_origin: Option<String>,
    /// How napkin-web calls the relay (service credential and user claim).
    pub client: RelayClient,
}

impl Relay {
    pub fn new(config: Config) -> Self {
        Self::with_timeout(config, TIMEOUT)
    }

    /// The same proxy with another timeout (tests).
    pub fn with_timeout(config: Config, timeout: Duration) -> Self {
        let client = RelayClient::new(&config.relay_url, &config.service_key, timeout);
        Self {
            config,
            timeout,
            media_base: None,
            upload_origin: None,
            client,
        }
    }

    /// The same proxy, told where pictures live (for the CSP).
    pub fn with_media_base(mut self, base: Option<String>) -> Self {
        self.media_base = base;
        self
    }

    /// The same proxy, told where uploads go (for the CSP's connect-src).
    pub fn with_upload_origin(mut self, origin: Option<String>) -> Self {
        self.upload_origin = origin;
        self
    }
}

// ── The assertion ────────────────────────────────────────────────────────────

/// What an assets pass says, in the order the contract writes it (the per-user
/// `relay` assertion is gone: napkin-web's other calls use the service credential).
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
    /// The claims of a read-only assets pass for `username` of `agency`, made
    /// at `now`: `aud: "assets"`, good for `GET /assets/{sha256}` of that
    /// agency's tenant and nothing else. `m`, `p` and `bh` are fixed and are
    /// not matched against any one request.
    pub fn assets_pass(username: &str, agency: &str, now: u64) -> Self {
        Self {
            u: username.to_string(),
            a: agency.to_string(),
            t: TenantId::of_agency(agency).to_string(),
            n: None,
            aud: "assets".into(),
            iat: now,
            exp: now + ASSETS_TTL_S,
            m: "GET".into(),
            p: "/api/assets/*".into(),
            bh: body_hash(b""),
        }
    }
}

impl Relay {
    /// `{base, pass}` for a deck build run by `username` of `agency`: where the
    /// engine reads pictures (`<relay>/api`) and the signed assets pass. Handed
    /// only to the middleware's `build_deck` (`crate::sandbox`).
    pub fn production_assets(&self, username: &str, agency: &str) -> serde_json::Value {
        let pass = sign(
            &self.config.key,
            &Claims::assets_pass(username, agency, now_s()),
        );
        serde_json::json!({ "base": format!("{}/api", self.config.relay_url), "pass": pass })
    }
}

/// `v1.<b64url claims>.<b64url HMAC-SHA256(key, "v1." + b64url claims)>`.
pub fn sign(key: &[u8], claims: &Claims) -> String {
    let json = serde_json::to_vec(claims).expect("claims serialise");
    let head = format!("v1.{}", B64.encode(json));
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("any key length");
    mac.update(head.as_bytes());
    format!("{head}.{}", B64.encode(mac.finalize().into_bytes()))
}

// ── The routes ───────────────────────────────────────────────────────────────

/// `/production` and everything under it (merged by `router_full`): the tool's
/// build, and a 404 for the retired `/production/api/*`.
pub fn router<S: Clone + Send + Sync + 'static>(relay: Arc<Relay>) -> Router<S> {
    let dir = &relay.config.static_dir;
    let index = dir.join("index.html");
    let policy = Arc::new(csp(
        relay.media_base.as_deref(),
        relay.upload_origin.as_deref(),
    ));
    let tool = Router::new()
        // the tool's calls are the shell API's now (api_router); an old page asking here is told so
        .route("/api", any(gone))
        .route("/api/{*rest}", any(gone))
        .route("/csp-report", post(csp_report))
        // a project is a page: the library document's id; its sub-routes (/d/{doc}/video ...) fall through
        .route_service("/d/{doc}", ServeFile::new(&index))
        .fallback_service(static_files(dir));
    Router::new()
        // a nest does not match its own path with a trailing slash; `?doc=` is the old way in
        .route(
            "/production/",
            get(move |Query(q): Query<RootQuery>| {
                let index = index.clone();
                async move {
                    match q.doc.filter(|d| valid_doc(d)) {
                        Some(d) => Redirect::to(&format!("/production/d/{d}")).into_response(),
                        None => match tokio::fs::read(&index).await {
                            Ok(bytes) => {
                                ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], bytes)
                                    .into_response()
                            }
                            Err(_) => StatusCode::NOT_FOUND.into_response(),
                        },
                    }
                }
            }),
        )
        .nest("/production", tool)
        .layer(axum::middleware::from_fn(cache_headers))
        .layer(axum::middleware::from_fn_with_state(policy, csp_header))
}

#[derive(serde::Deserialize)]
struct RootQuery {
    doc: Option<String>,
}

/// A library document id as the tool's routes take it.
fn valid_doc(d: &str) -> bool {
    !d.is_empty()
        && d.len() <= 80
        && d.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The one policy for the tool's pages (features/production-app-page.clan, folding in production-csp):
/// its own build and API on this origin, the pictures' CDN, the fonts the page links, and the store
/// Worker and wasm it starts. Reported only, until the walk and UAT show no violation.
/// connect-src also names the upload origin: the browser PUTs bytes straight to S3 on the
/// relay's presigned link (owner, 2026-11-23), and nothing else leaves this origin.
pub fn csp(media_base: Option<&str>, upload_origin: Option<&str>) -> String {
    let media_origin = media_base.and_then(|b| {
        let (scheme, rest) = b.split_once("://")?;
        Some(format!("{scheme}://{}", rest.split('/').next()?))
    });
    let media = media_origin
        .as_deref()
        .map(|o| format!(" {o}"))
        .unwrap_or_default();
    let upload = upload_origin
        .filter(|u| Some(*u) != media_origin.as_deref())
        .map(|o| format!(" {o}"))
        .unwrap_or_default();
    format!(
        "default-src 'self'; \
         script-src 'self' 'wasm-unsafe-eval'; \
         style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; \
         font-src 'self' data: https://fonts.gstatic.com; \
         img-src 'self' data: blob:{media}; \
         media-src 'self' blob:{media}; \
         connect-src 'self'{media}{upload}; \
         worker-src 'self' blob:; \
         object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; \
         report-uri /production/csp-report"
    )
}

const CSP_HEADER: &str = "content-security-policy-report-only";

/// The policy on the tool's pages (not on the API's answers).
async fn csp_header(State(policy): State<Arc<String>>, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let mut response = next.run(request).await;
    if !(path.starts_with("/production/api/") || path == "/production/api") {
        if let Ok(v) = HeaderValue::from_str(&policy) {
            response
                .headers_mut()
                .insert(HeaderName::from_static(CSP_HEADER), v);
        }
    }
    response
}

/// A browser's violation report: logged, nothing more. No session needed (browsers send it bare).
async fn csp_report(body: axum::body::Bytes) -> StatusCode {
    let text = String::from_utf8_lossy(&body[..body.len().min(4096)]).replace('\n', " ");
    tracing::warn!(target: "napkin_web::csp", report = %text, "csp violation (report-only)");
    StatusCode::NO_CONTENT
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

fn answer(a: Answer) -> Response {
    let mut response = Response::builder()
        .status(a.status)
        .body(Body::from(a.body))
        .unwrap();
    *response.headers_mut() = a.headers;
    response
}

/// The relay's error shape (common.schema.json).
fn relay_error(status: StatusCode, code: &str, message: &str, retryable: bool) -> Response {
    answer(Answer::error(status, code, message, retryable))
}

/// `/production/api/*`, retired: a stale page learns to reload.
async fn gone() -> Response {
    relay_error(
        StatusCode::NOT_FOUND,
        "not_found",
        "Reload the page: Production now talks to Napkin Studio, not to a separate address.",
        false,
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

fn under(rest: &str, prefixes: &[&str]) -> bool {
    prefixes
        .iter()
        .any(|p| rest == *p || rest.strip_prefix(p).is_some_and(|r| r.starts_with('/')))
}

/// What the person's workspace asks of the relay with no document: who they are, the
/// config, the agency's shelves and the tool's log. Documents, lists and saves are
/// napkin-web's own (the library); they never reach the relay (TEST-PLAN S2-2).
const FREE: [&str; 5] = ["/me", "/config", "/health", "/library", "/log"];
/// What belongs to one document: its jobs, its uploads and its pictures.
const BOUND: [&str; 3] = ["/jobs", "/uploads", "/assets"];

// ── The typed routes ─────────────────────────────────────────────────────────

/// The Production routes of the shell API (merged into `api::router`):
///
/// ```text
/// ANY  /t/{t}/production/{me,config,health,library/..,log}          no document
/// ANY  /t/{t}/d/{doc}/production/{jobs/..,uploads,assets/..}        the document's own calls
/// GET  /t/{t}/d/{doc}/production/inbox                              outcomes waiting to land
/// POST /t/{t}/d/{doc}/production/inbox/{job}/ack                    the tool has landed one
/// ```
///
/// A document route answers only for a Production document of the caller's workspace
/// and puts its id in the relay claim.
pub fn api_router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/t/{tenant}/production/{*rest}", any(free_call))
        .route("/t/{tenant}/d/{doc}/production/inbox", get(inbox_list))
        .route(
            "/t/{tenant}/d/{doc}/production/inbox/{job}/ack",
            post(inbox_ack),
        )
        .route("/t/{tenant}/d/{doc}/production/{*rest}", any(doc_call))
}

type Who = Option<Extension<Account>>;
type Tool = Option<Extension<Arc<Relay>>>;

fn not_here() -> Response {
    relay_error(
        StatusCode::NOT_FOUND,
        "not_found",
        "Production is not set up on this server.",
        false,
    )
}

fn sign_in() -> Response {
    relay_error(
        StatusCode::UNAUTHORIZED,
        "unauthorised",
        "Sign in to Napkin Studio to use Production.",
        false,
    )
}

async fn free_call(
    State(ctx): State<Arc<AppCtx>>,
    crate::tenant::Tenant(tenant): crate::tenant::Tenant,
    relay: Tool,
    account: Who,
    UrlPath((_t, rest)): UrlPath<(String, String)>,
    request: Request,
) -> Response {
    call(&ctx, &tenant, relay, account, None, &rest, request).await
}

async fn doc_call(
    State(ctx): State<Arc<AppCtx>>,
    crate::tenant::Tenant(tenant): crate::tenant::Tenant,
    relay: Tool,
    account: Who,
    UrlPath((_t, doc, rest)): UrlPath<(String, String, String)>,
    request: Request,
) -> Response {
    call(&ctx, &tenant, relay, account, Some(doc), &rest, request).await
}

/// `doc` is a Production document of this tenant's library, or a 404 in the relay's shape.
fn production_doc(ctx: &AppCtx, tenant: &TenantId, doc: &str) -> Result<DocId, Response> {
    let missing = || {
        relay_error(
            StatusCode::NOT_FOUND,
            "not_found",
            "This project is not in your library.",
            false,
        )
    };
    let (_ws, session, id) = crate::api::doc_session(ctx, tenant, doc).map_err(|_| missing())?;
    if session.app_id().as_deref() != Some(crate::save::PRODUCTION_APP_ID) {
        return Err(missing());
    }
    Ok(id)
}

async fn call(
    ctx: &AppCtx,
    tenant: &TenantId,
    relay: Tool,
    account: Who,
    doc: Option<String>,
    rest: &str,
    request: Request,
) -> Response {
    let Some(Extension(relay)) = relay else {
        return not_here();
    };
    let Some(Extension(account)) = account else {
        return sign_in();
    };
    let (parts, body) = request.into_parts();
    if parts.method != Method::GET && parts.method != Method::HEAD && foreign_origin(&parts.headers)
    {
        return relay_error(
            StatusCode::FORBIDDEN,
            "unauthorised",
            "This request came from another site.",
            false,
        );
    }
    let rest = format!("/{rest}");
    let allowed = under(&rest, &FREE) || (doc.is_some() && under(&rest, &BOUND));
    if !allowed {
        return relay_error(
            StatusCode::NOT_FOUND,
            "not_found",
            if under(&rest, &BOUND) {
                "Open a project first: that call belongs to one."
            } else {
                "That is not a Production Tool route."
            },
            false,
        );
    }
    let doc_id = match &doc {
        Some(d) => match production_doc(ctx, tenant, d) {
            Ok(id) => Some(id),
            Err(r) => return r,
        },
        None => None,
    };
    let body = match axum::body::to_bytes(body, BODY_MAX).await {
        Ok(b) => b,
        Err(_) => {
            return relay_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "invalid_input",
                "This is too big to send (over 4.5 MB).",
                false,
            )
        }
    };
    // What the relay receives: /api plus the rest, with the query as sent.
    let path_and_query = match parts.uri.query() {
        Some(q) => format!("/api{rest}?{q}"),
        None => format!("/api{rest}"),
    };
    let mut a = relay
        .client
        .call(
            &account,
            doc.as_deref(),
            parts.method.clone(),
            &path_and_query,
            &parts.headers,
            body,
        )
        .await;
    if a.status.is_success() {
        let method = parts.method.as_str();
        if under(&rest, &["/jobs"]) {
            // Every job the tool starts or reads is known to the host's registry, so the
            // library says "working" and the watcher settles it if the tab closes.
            if let (Some(id), Some(job)) = (&doc_id, a.json()) {
                if job.get("jobId").is_some() {
                    inbox::note_run(&ctx.workspace(tenant).library.runs(), id, &job);
                }
            }
        } else if method == "GET" && rest == "/me" {
            a = fold_me(ctx, &account, a);
        } else if method == "GET" && rest == "/config" {
            a = fold_config(ctx, a);
        }
    }
    answer(a)
}

/// The dogfood record is napkin-web's alone (dogfood.rs): the tool's `me.dogfood` says
/// whether this person has read the notice there, and only on a build that records.
fn fold_me(ctx: &AppCtx, account: &Account, mut a: Answer) -> Answer {
    if let Some(mut me) = a.json() {
        match &ctx.dogfood {
            Some(d) => {
                me["dogfood"] = serde_json::json!({"consented": d.consented(&account.username)})
            }
            None => {
                if let Some(o) = me.as_object_mut() {
                    o.remove("dogfood");
                }
            }
        }
        a.body = Bytes::from(me.to_string());
    }
    a
}

/// `flags.dogfood` is whether napkin-web records, not what the relay's file says.
fn fold_config(ctx: &AppCtx, mut a: Answer) -> Answer {
    if let Some(mut cfg) = a.json() {
        if let Some(flags) = cfg.get_mut("flags").and_then(|f| f.as_object_mut()) {
            flags.insert("dogfood".into(), ctx.dogfood.is_some().into());
            a.body = Bytes::from(cfg.to_string());
        }
    }
    a
}

// ── The inbox ────────────────────────────────────────────────────────────────

/// The inbox as files: `<tenant>/inbox/<doc>/<job>.json` while an outcome waits and
/// `<job>.acked` once the tool has landed it (a marker, kept so a later settle of the
/// same job writes nothing). Beside the documents, never inside one, and never listed
/// in the library.
pub struct FsInbox {
    dir: PathBuf,
}

/// An acknowledged marker is let go after this long: the host stops settling a job a day on.
const MARKER_KEEP_S: u64 = 30 * 24 * 60 * 60;

impl FsInbox {
    pub fn new(tenant_root: &Path) -> Self {
        Self {
            dir: tenant_root.join("inbox"),
        }
    }

    fn doc_dir(&self, doc: &DocId) -> PathBuf {
        let safe: String = doc
            .as_str()
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        self.dir.join(safe)
    }

    fn io(e: std::io::Error) -> napkin_host::HostError {
        napkin_host::HostError::internal(format!("the inbox could not be written: {e}"))
    }
}

impl InboxStore for FsInbox {
    fn put_if_absent(&self, doc: &DocId, entry: &Entry) -> napkin_host::HostResult<Put> {
        if !inbox::valid_job_id(&entry.job) {
            return Err(napkin_host::HostError::bad_request("not a job id"));
        }
        let dir = self.doc_dir(doc);
        std::fs::create_dir_all(&dir).map_err(Self::io)?;
        let acked = dir.join(format!("{}.acked", entry.job));
        let file = dir.join(format!("{}.json", entry.job));
        if acked.exists() {
            return Ok(Put::AlreadyApplied);
        }
        // Written whole, then linked into place: the link fails if the entry exists, so of
        // two racing settlers one wins, and a reader never sees half an entry.
        let tmp = dir.join(format!(
            ".{}.{}.{}.tmp",
            entry.job,
            std::process::id(),
            TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::write(&tmp, serde_json::to_vec(entry).expect("entry serialises"))
            .map_err(Self::io)?;
        let linked = std::fs::hard_link(&tmp, &file);
        let _ = std::fs::remove_file(&tmp);
        match linked {
            Ok(()) => {
                // The tool acknowledged it while this was being stored: it is landed.
                if acked.exists() {
                    let _ = std::fs::remove_file(&file);
                    return Ok(Put::AlreadyApplied);
                }
                Ok(Put::Stored)
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(Put::AlreadyApplied),
            Err(e) => Err(Self::io(e)),
        }
    }

    fn pending(&self, doc: &DocId) -> napkin_host::HostResult<Vec<Entry>> {
        let dir = self.doc_dir(doc);
        let Ok(read) = std::fs::read_dir(&dir) else {
            return Ok(Vec::new());
        };
        let mut out = Vec::new();
        for e in read.flatten() {
            let path = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if name.ends_with(".acked") {
                let old = e
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|m| m.elapsed().ok())
                    .is_some_and(|age| age.as_secs() > MARKER_KEEP_S);
                if old {
                    let _ = std::fs::remove_file(&path);
                }
                continue;
            }
            let Some(job) = name.strip_suffix(".json") else {
                continue;
            };
            if dir.join(format!("{job}.acked")).exists() {
                continue;
            }
            if let Some(entry) = std::fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice::<Entry>(&b).ok())
            {
                out.push(entry);
            }
        }
        out.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.job.cmp(&b.job)));
        Ok(out)
    }

    fn ack(&self, doc: &DocId, job: &str) -> napkin_host::HostResult<()> {
        if !inbox::valid_job_id(job) {
            return Err(napkin_host::HostError::bad_request("not a job id"));
        }
        let dir = self.doc_dir(doc);
        std::fs::create_dir_all(&dir).map_err(Self::io)?;
        // The marker first, then the outcome goes: a settler that finds either says "already applied".
        std::fs::write(dir.join(format!("{job}.acked")), b"").map_err(Self::io)?;
        match std::fs::remove_file(dir.join(format!("{job}.json"))) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(Self::io(e)),
        }
    }
}

static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn inbox_of(ctx: &AppCtx, tenant: &TenantId) -> Result<FsInbox, Response> {
    ctx.workspace(tenant)
        .tenant_store
        .as_ref()
        .map(|t| FsInbox::new(t.root()))
        .ok_or_else(|| {
            relay_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                "This workspace keeps no inbox.",
                false,
            )
        })
}

fn ok_json(v: serde_json::Value) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        v.to_string(),
    )
        .into_response()
}

fn host_failed(e: napkin_host::HostError) -> Response {
    relay_error(
        StatusCode::from_u16(e.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        "internal",
        &e.message,
        false,
    )
}

/// `GET .../production/inbox`: the outcomes waiting for this document's tool.
async fn inbox_list(
    State(ctx): State<Arc<AppCtx>>,
    crate::tenant::Tenant(tenant): crate::tenant::Tenant,
    UrlPath((_t, doc)): UrlPath<(String, String)>,
) -> Response {
    let id = match production_doc(&ctx, &tenant, &doc) {
        Ok(i) => i,
        Err(r) => return r,
    };
    let inbox = match inbox_of(&ctx, &tenant) {
        Ok(i) => i,
        Err(r) => return r,
    };
    match tokio::task::spawn_blocking(move || inbox.pending(&id)).await {
        Ok(Ok(entries)) => ok_json(serde_json::json!({ "entries": entries })),
        Ok(Err(e)) => host_failed(e),
        Err(_) => host_failed(napkin_host::HostError::internal(
            "the inbox could not be read",
        )),
    }
}

/// `POST .../production/inbox/{job}/ack`: the tool has landed this job (from the inbox,
/// or directly while its tab was open). Twice, or for a job with no entry, is fine.
async fn inbox_ack(
    State(ctx): State<Arc<AppCtx>>,
    crate::tenant::Tenant(tenant): crate::tenant::Tenant,
    UrlPath((_t, doc, job)): UrlPath<(String, String, String)>,
) -> Response {
    let id = match production_doc(&ctx, &tenant, &doc) {
        Ok(i) => i,
        Err(r) => return r,
    };
    if !inbox::valid_job_id(&job) {
        return relay_error(
            StatusCode::BAD_REQUEST,
            "invalid_input",
            "That is not a job id.",
            false,
        );
    }
    let inbox = match inbox_of(&ctx, &tenant) {
        Ok(i) => i,
        Err(r) => return r,
    };
    let runs = ctx.workspace(&tenant).library.runs();
    let j = job.clone();
    let i = id.clone();
    match tokio::task::spawn_blocking(move || inbox.ack(&i, &j)).await {
        Ok(Ok(())) => {
            runs.forget_job(&id, &job);
            ok_json(serde_json::json!({ "ok": true }))
        }
        Ok(Err(e)) => host_failed(e),
        Err(_) => host_failed(napkin_host::HostError::internal(
            "the inbox could not be written",
        )),
    }
}

/// Settle one job of a Production document for the library watcher
/// (`POST /t/{t}/d/{doc}/jobs/{job}/settle`, `api::settle_job`): read the job from the
/// relay as the person who runs it, tell the registry, and once it has finished keep its
/// outcome in the inbox, once. The document is not touched.
pub async fn settle(
    ctx: &AppCtx,
    tenant: &TenantId,
    relay: &Relay,
    account: &Account,
    doc: &str,
    job: &str,
) -> Response {
    let id = match production_doc(ctx, tenant, doc) {
        Ok(i) => i,
        Err(r) => return r,
    };
    let runs = ctx.workspace(tenant).library.runs();
    let a = relay
        .client
        .call(
            account,
            Some(doc),
            Method::GET,
            &format!("/api/jobs/{job}"),
            &HeaderMap::new(),
            Bytes::new(),
        )
        .await;
    if a.status == StatusCode::NOT_FOUND {
        // The relay never had it, or no longer does: nobody can land it.
        runs.forget_job(&id, job);
        return ok_json(serde_json::json!({ "ok": true, "job": job, "settled": "lost" }));
    }
    let Some(j) = a.json().filter(|_| a.status.is_success()) else {
        return answer(a);
    };
    if j.get("jobId").and_then(|v| v.as_str()) != Some(job) {
        return relay_error(
            StatusCode::BAD_GATEWAY,
            "internal",
            "The relay answered about another job.",
            true,
        );
    }
    let inbox = match inbox_of(ctx, tenant) {
        Ok(i) => i,
        Err(r) => return r,
    };
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let (i, j2, r2) = (id.clone(), j.clone(), runs.clone());
    let settled =
        tokio::task::spawn_blocking(move || inbox::settle(&inbox, &r2, &i, &j2, &now)).await;
    match settled {
        Ok(Ok(s)) => {
            let (word, state) = match &s {
                Settled::Running(st) => ("running", st.clone()),
                Settled::Stored(st) => ("stored", st.clone()),
                Settled::AlreadyApplied(st) => ("already applied", st.clone()),
            };
            if matches!(s, Settled::Stored(_)) {
                ctx.events.publish(
                    tenant,
                    &napkin_host::HostEvent::JobSettled(
                        serde_json::json!({ "doc": doc, "job": job, "state": state }),
                    ),
                );
            }
            ok_json(serde_json::json!({ "ok": true, "job": job, "state": state, "settled": word }))
        }
        Ok(Err(e)) => host_failed(e),
        Err(_) => host_failed(napkin_host::HostError::internal(
            "the job could not be settled",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vector() -> serde_json::Value {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../production-tool/contracts/examples/identity-assertion.vector.json");
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    /// The claims of the vector, as the assets pass writes them.
    fn vector_claims(v: &serde_json::Value) -> Claims {
        let c = &v["claims"];
        Claims {
            u: c["u"].as_str().unwrap().into(),
            a: c["a"].as_str().unwrap().into(),
            t: c["t"].as_str().unwrap().into(),
            n: c["n"].as_str().map(str::to_string),
            aud: c["aud"].as_str().unwrap().into(),
            iat: c["iat"].as_u64().unwrap(),
            exp: c["exp"].as_u64().unwrap(),
            m: c["m"].as_str().unwrap().into(),
            p: c["p"].as_str().unwrap().into(),
            bh: c["bh"].as_str().unwrap().into(),
        }
    }

    #[test]
    fn the_assets_pass_signer_still_produces_the_shared_vector_exactly() {
        let v = vector();
        let claims = vector_claims(&v);
        assert_eq!(
            serde_json::to_string(&claims).unwrap(),
            v["claimsJson"].as_str().unwrap()
        );
        assert_eq!(body_hash(v["body"].as_str().unwrap().as_bytes()), claims.bh);
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
    fn an_assets_pass_is_read_only_and_lives_half_an_hour() {
        let c = Claims::assets_pass("visionary@napkin", "napkin", 1000);
        let d = decode(&sign(&[7u8; 32], &c));
        assert_eq!(d["aud"], "assets");
        assert_eq!(
            (d["iat"].as_u64(), d["exp"].as_u64()),
            (Some(1000), Some(2800))
        );
        assert_eq!(d["m"], "GET");
        assert!(d.get("n").is_none());
        assert_ne!(sign(&[1u8; 32], &c), sign(&[2u8; 32], &c));
    }

    const KEY: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn no_relay_url_means_no_production() {
        assert_eq!(
            Config::from_vars(true, None, Some(KEY), Some(KEY), None),
            Ok(None)
        );
        assert_eq!(
            Config::from_vars(false, Some("  "), None, None, None),
            Ok(None)
        );
    }

    #[test]
    fn a_relay_without_sign_in_is_refused() {
        let e =
            Config::from_vars(false, Some("http://relay"), Some(KEY), Some(KEY), None).unwrap_err();
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
            let e =
                Config::from_vars(true, Some("http://relay"), secret, Some(KEY), None).unwrap_err();
            assert!(e.contains("32 bytes"), "{secret:?}: {e}");
        }
    }

    #[test]
    fn a_short_or_missing_service_key_is_refused() {
        for key in [None, Some(""), Some("short")] {
            let e =
                Config::from_vars(true, Some("http://relay"), Some(KEY), key, None).unwrap_err();
            assert!(e.contains("NAPKIN_PRODUCTION_SERVICE_KEY"), "{key:?}: {e}");
        }
    }

    #[test]
    fn the_first_key_signs_and_the_url_loses_its_slash() {
        let c = Config::from_vars(
            true,
            Some("https://relay.example/"),
            Some(&format!("{KEY}, old-key-old-key-old-key-old-key-old")),
            Some(&format!("{KEY}x, old-key-old-key-old-key-old-key-old")),
            None,
        )
        .unwrap()
        .unwrap();
        assert_eq!(c.relay_url, "https://relay.example");
        assert_eq!(c.key, KEY.as_bytes());
        assert_eq!(c.service_key, format!("{KEY}x").as_bytes());
        assert_eq!(c.static_dir, PathBuf::from(DEFAULT_STATIC));
        let c = Config::from_vars(true, Some("http://r"), Some(KEY), Some(KEY), Some("/tmp/x"))
            .unwrap()
            .unwrap();
        assert_eq!(c.static_dir, PathBuf::from("/tmp/x"));
        assert!(Config::from_vars(true, Some("relay:8787"), Some(KEY), Some(KEY), None).is_err());
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

    #[test]
    fn connect_src_names_the_upload_origin_beside_the_media_base() {
        let p = csp(
            Some("https://cdn.example.com/m"),
            Some("https://napkin-hackathon-1.s3.eu-west-1.amazonaws.com"),
        );
        assert!(
            p.contains("connect-src 'self' https://cdn.example.com https://napkin-hackathon-1.s3.eu-west-1.amazonaws.com;"),
            "{p}"
        );
        // only connect-src: pictures still come from the media base alone
        assert!(
            p.contains("img-src 'self' data: blob: https://cdn.example.com;"),
            "{p}"
        );
        // one origin serving both (the local relay) is named once
        let local = csp(
            Some("http://localhost:20431"),
            Some("http://localhost:20431"),
        );
        assert!(
            local.contains("connect-src 'self' http://localhost:20431;"),
            "{local}"
        );
        // no upload origin: as before
        assert!(csp(Some("https://cdn.example.com"), None)
            .contains("connect-src 'self' https://cdn.example.com;"));
    }
}
