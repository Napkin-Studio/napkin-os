// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The client's own link (features/client-confirm-link.clan): a signed token in
//! a URL that opens one locked version of one brief on a phone, with no
//! account, and takes one answer.
//!
//! What the token grants, and no more:
//!
//! - **One document, one version.** It names a tenant, a document and the hash
//!   of the version a person signed. The host checks the version again on every
//!   use against the chain, so a brief edited, unlocked or locked again after
//!   the link was made makes it `410`.
//! - **One action.** `scope: "confirm"` with a list of one target. The public
//!   routes read the clean copy and write one `client_review`, through a
//!   `client:<email>` context the host confines to those two routes
//!   (`napkin_host::ops::client_link`).
//! - **Once.** The first answer, a confirmation or a request for changes, uses
//!   the link up: the host refuses a second with `410`.
//! - **Thirty days at most**, and an agency person can withdraw it (`410`).
//!
//! A second shape of token, `v: 2` with `scope: "review"`, is one reviewer's link in one round
//! (features/client-review-full.clan): the same properties, one link per reviewer and per round, so each
//! holds for each reviewer alone. It adds routes (pieces, comments, an optional emailed code) and the
//! host's `client_comment` action; who the reviewer is, which round, and which role come from the
//! issue record on the chain, never from the token or the request.
//!
//! The key is the session secret (`NAPKIN_SESSION_SECRET`), under its own
//! label so a session cookie is never a link; without one (the anonymous demo)
//! the server makes a key for its own lifetime. A wrong token is `404` and
//! says nothing else; a right one that has run out is `410`.
//!
//! Nothing here reads a cookie: the routes sit outside the session layer, like
//! the sandbox's. They are rate limited per link and, for tokens that do not
//! verify, as one pool.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use napkin_host::ops::client_link;
use napkin_host::{Actor, Ctx, DocId, HostEvent, HostRequest, Scope};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;

use crate::state::AppCtx;
use crate::tenant::{agency_of, TenantId};

/// The one thing a Phase 1 link lets a client do.
pub const SCOPE: &str = "confirm";
/// What a reviewer's link in a round lets them do: look, comment and answer once.
pub const SCOPE_REVIEW: &str = "review";
/// The shortest secret a link is signed with, as the session secret's.
pub const MIN_SECRET: usize = 32;
/// A link's life, at most.
pub const LIFE_DAYS: i64 = 30;

/// What the token says, signed. The host holds the facts the token must agree with, and who the
/// link is for (the issue record on the chain): the client's name and email are not in a URL.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Claims {
    /// Token shape: 1.
    pub v: u8,
    /// The link's id (32 hex digits); the chain's `issue_link` decision has the same.
    pub id: String,
    pub tenant: String,
    pub doc: String,
    /// What the link may do, and to what: today `confirm`, one target.
    pub scope: String,
    pub targets: Vec<String>,
    /// The version the link is for: the lock's version and the hash of its data.
    pub version: String,
    pub hash: String,
    /// The agency that sent it (what the client sees as the sender).
    pub agency: Option<String>,
    /// Unix seconds.
    pub exp: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Bad {
    /// Not a token we signed.
    Forged,
    /// Ours, and over.
    Expired,
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The key links are signed with: the session secret, separated by a label.
pub fn key_from(secret: &[u8]) -> Vec<u8> {
    let mut m = Hmac::<Sha256>::new_from_slice(secret).expect("any key length");
    m.update(b"napkin:client-link:v1");
    m.finalize().into_bytes().to_vec()
}

/// The key the emailed code and the cookie that proves it are made with: the session secret,
/// under a label of their own, so neither is ever a link or a session.
pub fn code_key_from(secret: &[u8]) -> Vec<u8> {
    let mut m = Hmac::<Sha256>::new_from_slice(secret).expect("any key length");
    m.update(b"napkin:client-code:v1");
    m.finalize().into_bytes().to_vec()
}

/// A key for this server's lifetime, when there is no session secret.
pub fn fresh_key() -> Vec<u8> {
    let mut k = uuid::Uuid::new_v4().as_bytes().to_vec();
    k.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    k
}

fn mac(key: &[u8], body: &str) -> Hmac<Sha256> {
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("any key length");
    m.update(body.as_bytes());
    m
}

pub fn sign(key: &[u8], claims: &Claims) -> String {
    let body = B64.encode(serde_json::to_vec(claims).unwrap_or_default());
    let sig = B64.encode(mac(key, &body).finalize().into_bytes());
    format!("{body}.{sig}")
}

pub fn verify(key: &[u8], token: &str) -> Result<Claims, Bad> {
    let (body, sig) = token.split_once('.').ok_or(Bad::Forged)?;
    let sig = B64.decode(sig).map_err(|_| Bad::Forged)?;
    mac(key, body).verify_slice(&sig).map_err(|_| Bad::Forged)?;
    let claims: Claims = serde_json::from_slice(&B64.decode(body).map_err(|_| Bad::Forged)?)
        .map_err(|_| Bad::Forged)?;
    // Shape 1 is a confirmation link, shape 2 a review link: each is accepted with its own scope and
    // no other, and each names exactly one document.
    let shaped = matches!(
        (claims.v, claims.scope.as_str()),
        (1, SCOPE) | (2, SCOPE_REVIEW)
    );
    if !shaped || claims.targets.len() != 1 || claims.targets[0] != claims.doc {
        return Err(Bad::Forged);
    }
    if claims.exp <= unix_now() {
        return Err(Bad::Expired);
    }
    Ok(claims)
}

/// When a link made now ends, as the host wants it, and in Unix seconds.
pub fn ends() -> (String, u64) {
    let end = chrono::Utc::now() + chrono::Duration::days(LIFE_DAYS);
    (
        end.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        end.timestamp().max(0) as u64,
    )
}

// ── rate limit ──────────────────────────────────────────────────────────────

/// A fixed window per key: so many uses a minute.
#[derive(Default)]
pub struct Limiter {
    seen: Mutex<HashMap<String, (Instant, u32)>>,
}

const WINDOW: Duration = Duration::from_secs(60);
/// Reads and answers of one valid link, a minute.
const PER_LINK: u32 = 40;
/// Tokens that do not verify, all together, a minute.
const PER_FORGERY: u32 = 120;

impl Limiter {
    pub fn allow(&self, key: &str, cap: u32) -> bool {
        self.allow_in(key, cap, WINDOW)
    }

    /// [`allow`](Self::allow) over a window of your own (the emailed code's ten minutes).
    pub fn allow_in(&self, key: &str, cap: u32, window: Duration) -> bool {
        let mut seen = self.seen.lock().unwrap();
        let now = Instant::now();
        if seen.len() > 10_000 {
            seen.retain(|_, (at, _)| now.duration_since(*at) < Duration::from_secs(3600));
        }
        let e = seen.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(e.0) >= window {
            *e = (now, 0);
        }
        e.1 += 1;
        e.1 <= cap
    }
}

// ── the public routes ───────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/{token}/view", get(view))
        .route("/{token}/answer", post(answer))
        // a review link's own routes (features/client-review-full.clan)
        .route("/{token}/piece/{n}", get(piece))
        .route("/{token}/comment", post(comment))
        .route("/{token}/comment/{cid}/withdraw", post(comment_withdraw))
        .route("/{token}/code", post(code))
}

/// Every answer here is private to the holder of the link and says so.
fn plain(status: StatusCode, value: Value) -> Response {
    let mut r = (status, axum::Json(value)).into_response();
    let h = r.headers_mut();
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::HeaderName::from_static("x-robots-tag"),
        HeaderValue::from_static("noindex, nofollow"),
    );
    r
}

fn gone(state: &str) -> Response {
    plain(
        StatusCode::GONE,
        json!({ "ok": false, "state": state, "error": "this link no longer works" }),
    )
}

fn not_found() -> Response {
    plain(
        StatusCode::NOT_FOUND,
        json!({ "ok": false, "state": "unknown", "error": "no such link" }),
    )
}

fn too_many() -> Response {
    plain(
        StatusCode::TOO_MANY_REQUESTS,
        json!({ "ok": false, "error": "too many tries: wait a minute" }),
    )
}

/// The token, checked and rate limited: its claims, or the response to send.
fn open(ctx: &AppCtx, token: &str) -> Result<Claims, Response> {
    match verify(&ctx.link_key, token) {
        Ok(c) => {
            if ctx.limiter.allow(&c.id, PER_LINK) {
                Ok(c)
            } else {
                Err(too_many())
            }
        }
        Err(bad) => {
            if !ctx.limiter.allow("forged", PER_FORGERY) {
                return Err(too_many());
            }
            Err(match bad {
                Bad::Forged => not_found(),
                Bad::Expired => gone("expired"),
            })
        }
    }
}

/// The client, as the host sees them: their email (from the link's issue record), in the
/// agency's workspace.
fn client_ctx(c: &Claims, email: &str) -> Option<Ctx> {
    let actor = Actor::client(email).ok()?;
    Some(Ctx::new(actor).with_scope(Scope {
        org: Some(c.tenant.clone()),
        brand: None,
        agency: c.agency.clone(),
    }))
}

fn status_of(code: u16) -> StatusCode {
    StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

/// What the client reads and may do: the version, in a clean copy.
async fn view(
    State(ctx): State<Arc<AppCtx>>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> Response {
    let claims = match open(&ctx, &token) {
        Ok(c) => c,
        Err(r) => return r,
    };
    if claims.v == 2 {
        return review_view(ctx, claims, headers).await;
    }
    let Some(tenant) = TenantId::parse(&claims.tenant) else {
        return not_found();
    };
    let ws = ctx.workspace(&tenant);
    let Ok(session) = ws.session(&DocId::new(claims.doc.clone())) else {
        return gone("superseded");
    };
    // The link's state and the words the client is shown come from one read of the document, so
    // an edit cannot land between "this version is open" and what is drawn: the host says whether
    // the link is open (unknown, withdrawn, answered, for an older version, out of time), and in
    // that same read the brief is drawn from its allow list (clean::sheet).
    let seen = session.read(|d| {
        let st = client_link::state_reply(d, &claims.id)?;
        let drawn = (st["ok"] == true).then(|| (crate::clean::sheet(d), crate::clean::page_of(d)));
        Ok((st, drawn))
    });
    let Ok((state_v, drawn)) = seen else {
        return gone("superseded");
    };
    let Some((html, page)) = drawn else {
        return match state_v["state"].as_str() {
            Some("unknown") | None => not_found(),
            Some(word) => gone(word),
        };
    };
    // A link answers for the version it names, and the version the host found
    // open must be the one the token was made for.
    if state_v["version"].as_str() != Some(claims.version.as_str())
        || state_v["doc_hash"].as_str() != Some(claims.hash.as_str())
        || state_v["scope"] != SCOPE
    {
        return gone("superseded");
    }
    // Only a Brief Maker brief is drawn for a client; a link to anything else shows nothing.
    let Some(html) = html else {
        return not_found();
    };
    let look = crate::look::read(&ctx, &tenant);
    plain(
        StatusCode::OK,
        json!({
            "ok": true,
            "state": "open",
            "title": page.title,
            "client": { "name": state_v["client"]["name"] },
            "agency": { "name": claims.agency, "logo": look.logo, "accent": look.accent },
            "version": claims.version,
            "expires": state_v["expires"],
            "summary": page.summary,
            "signed_by": page.signed_by,
            "html": html,
        }),
    )
}

/// The client's one answer: `{answer: "confirm" | "changes", said?}`.
async fn answer(
    State(ctx): State<Arc<AppCtx>>,
    Path(token): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let claims = match open(&ctx, &token) {
        Ok(c) => c,
        Err(r) => return r,
    };
    if body.len() > 16 * 1024 {
        return plain(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({ "ok": false, "error": "too long" }),
        );
    }
    let Ok(sent) = serde_json::from_slice::<Value>(&body) else {
        return plain(
            StatusCode::BAD_REQUEST,
            json!({ "ok": false, "error": "invalid JSON" }),
        );
    };
    let Some(tenant) = TenantId::parse(&claims.tenant) else {
        return not_found();
    };
    let ws = ctx.workspace(&tenant);
    let Ok(session) = ws.session(&DocId::new(claims.doc.clone())) else {
        return gone("superseded");
    };
    // Who the link is for is in its issue record, not in the token. A link the host does not
    // find, or that is over, ends here with its word.
    let Ok(state_v) = session.read(|d| client_link::state_reply(d, &claims.id)) else {
        return gone("superseded");
    };
    // a link answers in its own shape: a review token to a review link and a confirmation token to a
    // confirmation link, and a review link on the emailed code only once the code is entered
    let want = if claims.v == 2 { SCOPE_REVIEW } else { SCOPE };
    if state_v["ok"] == true && state_v["scope"] != want {
        return not_found();
    }
    if state_v["ok"] == true && state_v["code"] == true && !cookie_ok(&ctx, &headers, &claims.id) {
        return need_code();
    }
    let email = state_v["client"]["email"].as_str().unwrap_or_default();
    let who = match client_ctx(&claims, email) {
        Some(w) if state_v["ok"] == true => w,
        _ => {
            return match state_v["state"].as_str() {
                Some("unknown") | None => not_found(),
                Some(word) => gone(word),
            }
        }
    };
    // The client says which answer and in what words, and nothing else: the
    // link supplies who, which version and how.
    let mut asked = json!({ "id": claims.id, "answer": sent.get("answer") });
    if let Some(said) = sent.get("said") {
        asked["said"] = said.clone();
    }
    if let Some(marks) = sent.get("pieces") {
        asked["pieces"] = marks.clone();
    }
    let resp = napkin_host::dispatch(
        &who,
        &session,
        &*ctx.config,
        HostRequest::new("/client-link/answer", "", asked.to_string().into_bytes()),
    );
    for e in &resp.events {
        let e: &HostEvent = e;
        ctx.events.publish(&tenant, e);
    }
    let v: Value = serde_json::from_slice(&resp.body).unwrap_or(Value::Null);
    if resp.status == 200 {
        // The answer is known to whoever holds the link; the decision's id and the rest stay in the chain.
        return plain(
            StatusCode::OK,
            json!({ "ok": true, "answer": v["answer"], "version": v["version"] }),
        );
    }
    let state = v["error"]
        .as_str()
        .and_then(|e| e.strip_prefix("this link is "))
        .unwrap_or("gone")
        .to_string();
    match resp.status {
        404 => not_found(),
        410 => gone(&state),
        s => plain(
            status_of(s),
            json!({ "ok": false, "error": v["error"].as_str().unwrap_or("not accepted") }),
        ),
    }
}

// ── review links (features/client-review-full.clan) ─────────────────────────

/// Reads of a piece's bytes, a minute (a film is fetched in several ranges).
const PER_PIECE: u32 = 240;
/// Tries at the emailed code, per link, in one window.
const CODE_TRIES: u32 = 5;
/// Mails of the code, per link, in one window.
const CODE_SENDS: u32 = 3;
/// The code's window, and how long it works for (this one and the one before it).
pub const CODE_WINDOW_S: u64 = 600;
const CODE_WINDOW: Duration = Duration::from_secs(CODE_WINDOW_S);
/// How long the cookie that proves the code lasts.
const CODE_COOKIE_S: u64 = 8 * 3600;
/// The biggest comment request, a little over the host's 2,000 characters.
const COMMENT_BODY: usize = 16 * 1024;

fn need_code() -> Response {
    plain(
        StatusCode::UNAUTHORIZED,
        json!({ "ok": false, "state": "code", "error": "enter the code we emailed you" }),
    )
}

/// The six digits for link `id` in the window `w`: a keyed hash, so nothing is stored.
pub fn code_for(key: &[u8], id: &str, w: u64) -> String {
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("any key length");
    m.update(format!("code|{id}|{w}").as_bytes());
    let d = m.finalize().into_bytes();
    let n = u32::from_be_bytes([d[0], d[1], d[2], d[3]]) % 1_000_000;
    format!("{n:06}")
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn cookie_name(id: &str) -> String {
    format!("ncr_{}", &id[..id.len().min(16)])
}

fn cookie_mac(key: &[u8], id: &str, exp: u64) -> String {
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("any key length");
    m.update(format!("cookie|{id}|{exp}").as_bytes());
    B64.encode(m.finalize().into_bytes())
}

/// Does this request carry the cookie the code earned for this link (and no other's)?
fn cookie_ok(ctx: &AppCtx, headers: &HeaderMap, id: &str) -> bool {
    let want = cookie_name(id);
    let Some(jar) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let Some(value) = jar
        .split(';')
        .filter_map(|c| c.trim().split_once('='))
        .find(|(k, _)| *k == want)
        .map(|(_, v)| v)
    else {
        return false;
    };
    let Some((exp, mac)) = value.split_once('.') else {
        return false;
    };
    let Ok(exp) = exp.parse::<u64>() else {
        return false;
    };
    exp > (ctx.code_clock)() && same(mac, &cookie_mac(&ctx.code_key, id, exp))
}

/// The host's refusal of a client's call, as the client's page is told: its word and nothing more.
fn refused(status: u16, v: &Value) -> Response {
    let state = v["error"]
        .as_str()
        .and_then(|e| e.strip_prefix("this link is "))
        .unwrap_or("gone")
        .to_string();
    match status {
        404 => not_found(),
        410 => gone(&state),
        429 => too_many(),
        403 => plain(
            StatusCode::FORBIDDEN,
            json!({ "ok": false, "error": "this link cannot do that" }),
        ),
        s => plain(
            status_of(s),
            json!({ "ok": false, "error": v["error"].as_str().unwrap_or("not accepted") }),
        ),
    }
}

/// A review token, checked and rate limited under `suffix`: shape 2 only. A confirmation link is
/// not a review link, whatever it is signed with.
fn open_review(ctx: &AppCtx, token: &str, suffix: &str, cap: u32) -> Result<Claims, Response> {
    let c = match verify(&ctx.link_key, token) {
        Ok(c) => c,
        Err(bad) => {
            if !ctx.limiter.allow("forged", PER_FORGERY) {
                return Err(too_many());
            }
            return Err(match bad {
                Bad::Forged => not_found(),
                Bad::Expired => gone("expired"),
            });
        }
    };
    if c.v != 2 {
        return Err(not_found());
    }
    if !ctx.limiter.allow(&format!("{}{suffix}", c.id), cap) {
        return Err(too_many());
    }
    Ok(c)
}

/// What a review link's host call needs: the open state of the link (and, when the link is on the
/// emailed code, proof that it was entered), and the client as the actor. `Err` is the response
/// to send.
fn review_ctx(
    ctx: &AppCtx,
    claims: &Claims,
    headers: &HeaderMap,
) -> Result<(TenantId, Arc<napkin_host::Session>, Ctx), Response> {
    let Some(tenant) = TenantId::parse(&claims.tenant) else {
        return Err(not_found());
    };
    let ws = ctx.workspace(&tenant);
    let Ok(session) = ws.session(&DocId::new(claims.doc.clone())) else {
        return Err(gone("superseded"));
    };
    let Ok(st) = session.read(|d| client_link::state_reply(d, &claims.id)) else {
        return Err(gone("superseded"));
    };
    if st["ok"] != true {
        return Err(match st["state"].as_str() {
            Some("unknown") | None => not_found(),
            Some(word) => gone(word),
        });
    }
    if st["code"] == true && !cookie_ok(ctx, headers, &claims.id) {
        return Err(need_code());
    }
    let email = st["client"]["email"].as_str().unwrap_or_default();
    let Some(who) = client_ctx(claims, email) else {
        return Err(not_found());
    };
    Ok((tenant, session, who))
}

fn call(
    ctx: &AppCtx,
    tenant: &TenantId,
    session: &napkin_host::Session,
    who: &Ctx,
    path: &str,
    asked: Value,
) -> napkin_host::HostResponse {
    let resp = napkin_host::dispatch(
        who,
        session,
        &*ctx.config,
        HostRequest::new(path, "", asked.to_string().into_bytes()),
    );
    for e in &resp.events {
        let e: &HostEvent = e;
        ctx.events.publish(tenant, e);
    }
    resp
}

fn json_body(body: &Bytes, cap: usize) -> Result<Value, Response> {
    if body.len() > cap {
        return Err(plain(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({ "ok": false, "error": "too long" }),
        ));
    }
    serde_json::from_slice::<Value>(body).map_err(|_| {
        plain(
            StatusCode::BAD_REQUEST,
            json!({ "ok": false, "error": "invalid JSON" }),
        )
    })
}

/// How many rounds the job's route gives this document's job, when it says (the client step's `rounds`).
pub fn rounds_in_scope(
    ctx: &AppCtx,
    tenant: &TenantId,
    session: &napkin_host::Session,
) -> Option<u32> {
    let job = session
        .read(|d| Ok(d.clan().manifest().job.clone()))
        .ok()
        .flatten()?;
    let ws = ctx.workspace(tenant);
    napkin_host::jobs::list(&*ws.store)
        .ok()?
        .into_iter()
        .find(|r| r.number == job)?
        .route
        .iter()
        .find(|st| st.party == napkin_host::jobs::CLIENT)
        .and_then(|st| st.rounds)
}

/// The page of a review link: the pieces one at a time, this reviewer's own comments, and the words
/// of the version. Nothing of another reviewer's, and no state of any record but this link's.
async fn review_view(ctx: Arc<AppCtx>, claims: Claims, headers: HeaderMap) -> Response {
    let (tenant, session, _who) = match review_ctx(&ctx, &claims, &headers) {
        Ok(r) => r,
        Err(r) => {
            // a link on the code still shows its agency's look and nothing of the document
            if r.status() == StatusCode::UNAUTHORIZED {
                let t = TenantId::parse(&claims.tenant);
                let look = t.map(|t| crate::look::read(&ctx, &t));
                return plain(
                    StatusCode::UNAUTHORIZED,
                    json!({
                        "ok": false, "state": "code",
                        "agency": { "name": claims.agency,
                                    "logo": look.as_ref().and_then(|l| l.logo.clone()),
                                    "accent": look.as_ref().and_then(|l| l.accent.clone()) },
                    }),
                );
            }
            return r;
        }
    };
    let seen = session.read(|d| {
        let st = client_link::state_reply(d, &claims.id)?;
        let drawn = (st["ok"] == true).then(|| (crate::clean::sheet(d), crate::clean::page_of(d)));
        // the brief's points a remark may be tagged to: the spec's fields the document has not hidden
        let points: Vec<Value> = napkin_host::ops::client_pieces::spec_of(d)
            .map(|sp| {
                sp.fields
                    .iter()
                    .filter(|(k, _)| napkin_host::ops::client_pieces::point_allowed(d, k))
                    .map(|(k, l)| json!({ "key": k, "label": l }))
                    .collect()
            })
            .unwrap_or_default();
        Ok((st, drawn, points))
    });
    let Ok((st, Some((Some(html), page)), points)) = seen else {
        return gone("superseded");
    };
    if st["version"].as_str() != Some(claims.version.as_str())
        || st["doc_hash"].as_str() != Some(claims.hash.as_str())
        || st["scope"] != SCOPE_REVIEW
    {
        return gone("superseded");
    }
    let look = crate::look::read(&ctx, &tenant);
    let rounds = rounds_in_scope(&ctx, &tenant, &session);
    plain(
        StatusCode::OK,
        json!({
            "ok": true, "state": "open", "mode": "review",
            "title": page.title,
            "client": { "name": st["client"]["name"] },
            "agency": { "name": claims.agency, "logo": look.logo, "accent": look.accent },
            "version": claims.version, "version_n": st["version_n"],
            "expires": st["expires"],
            "round": st["round"], "rounds_in_scope": rounds,
            "approver": st["approver"],
            "pieces": st["pieces"],
            "comments": st["comments"],
            "points": points,
            "html": html,
        }),
    )
}

/// One piece's bytes: only from an open review link, only a piece the issue recorded, only the bytes
/// it hashed, with a type chosen from a fixed list and headers that stop a browser running anything.
async fn piece(
    State(ctx): State<Arc<AppCtx>>,
    Path((token, n)): Path<(String, usize)>,
    headers: HeaderMap,
) -> Response {
    let claims = match open_review(&ctx, &token, ":piece", PER_PIECE) {
        Ok(c) => c,
        Err(r) => return r,
    };
    let (tenant, session, who) = match review_ctx(&ctx, &claims, &headers) {
        Ok(r) => r,
        Err(r) => return r,
    };
    let resp = call(
        &ctx,
        &tenant,
        &session,
        &who,
        "/client-link/piece",
        json!({ "id": claims.id, "n": n }),
    );
    if resp.status != 200 {
        let v: Value = serde_json::from_slice(&resp.body).unwrap_or(Value::Null);
        return refused(resp.status, &v);
    }
    let ctype = resp
        .headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| "application/octet-stream".into());
    let total = resp.body.len();
    // Range: one range, as a video element asks for it
    let (status, lo, hi) = match headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|r| byte_range(r, total))
    {
        None => (StatusCode::OK, 0, total.saturating_sub(1)),
        Some(Some((lo, hi))) => (StatusCode::PARTIAL_CONTENT, lo, hi),
        Some(None) => {
            let mut r = plain(
                StatusCode::RANGE_NOT_SATISFIABLE,
                json!({ "ok": false, "error": "that range is not in the file" }),
            );
            if let Ok(v) = HeaderValue::from_str(&format!("bytes */{total}")) {
                r.headers_mut().insert(header::CONTENT_RANGE, v);
            }
            return r;
        }
    };
    let body = if total == 0 {
        Vec::new()
    } else {
        resp.body[lo..=hi].to_vec()
    };
    let mut r = (status, body).into_response();
    let h = r.headers_mut();
    if let Ok(v) = HeaderValue::from_str(&ctype) {
        h.insert(header::CONTENT_TYPE, v);
    }
    if status == StatusCode::PARTIAL_CONTENT {
        if let Ok(v) = HeaderValue::from_str(&format!("bytes {lo}-{hi}/{total}")) {
            h.insert(header::CONTENT_RANGE, v);
        }
    }
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    // an asset is data: a page named .png, or an SVG, is shown as an image and never run
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'"),
    );
    h.insert(
        header::HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("same-origin"),
    );
    h.insert(
        header::HeaderName::from_static("x-robots-tag"),
        HeaderValue::from_static("noindex, nofollow"),
    );
    r
}

/// `bytes=a-b`, `bytes=a-` or `bytes=-n` of a file of `total` bytes, as (first, last); `None` when it
/// is not a single satisfiable range.
fn byte_range(spec: &str, total: usize) -> Option<(usize, usize)> {
    let r = spec.trim().strip_prefix("bytes=")?;
    if r.contains(',') || total == 0 {
        return None;
    }
    let (a, b) = r.split_once('-')?;
    let (lo, hi) = match (a.trim(), b.trim()) {
        ("", n) => {
            let n: usize = n.parse().ok().filter(|n| *n > 0)?;
            (total.saturating_sub(n), total - 1)
        }
        (a, "") => (a.parse().ok()?, total - 1),
        (a, b) => (a.parse().ok()?, b.parse::<usize>().ok()?.min(total - 1)),
    };
    (lo <= hi && lo < total).then_some((lo, hi))
}

/// A comment: `{piece, pin?, tag, text}`. The link supplies who, which version, the round and the channel.
async fn comment(
    State(ctx): State<Arc<AppCtx>>,
    Path(token): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let claims = match open_review(&ctx, &token, "", PER_LINK) {
        Ok(c) => c,
        Err(r) => return r,
    };
    let sent = match json_body(&body, COMMENT_BODY) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let (tenant, session, who) = match review_ctx(&ctx, &claims, &headers) {
        Ok(r) => r,
        Err(r) => return r,
    };
    let mut asked = json!({ "id": claims.id });
    for k in ["piece", "pin", "tag", "text"] {
        if let Some(v) = sent.get(k) {
            asked[k] = v.clone();
        }
    }
    let resp = call(&ctx, &tenant, &session, &who, "/client-link/comment", asked);
    let v: Value = serde_json::from_slice(&resp.body).unwrap_or(Value::Null);
    if resp.status == 200 {
        return plain(
            StatusCode::OK,
            json!({ "ok": true, "comment": v["comment"], "piece": v["piece"] }),
        );
    }
    refused(resp.status, &v)
}

async fn comment_withdraw(
    State(ctx): State<Arc<AppCtx>>,
    Path((token, cid)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let claims = match open_review(&ctx, &token, "", PER_LINK) {
        Ok(c) => c,
        Err(r) => return r,
    };
    let (tenant, session, who) = match review_ctx(&ctx, &claims, &headers) {
        Ok(r) => r,
        Err(r) => return r,
    };
    let resp = call(
        &ctx,
        &tenant,
        &session,
        &who,
        "/client-link/comment-withdraw",
        json!({ "id": claims.id, "comment": cid }),
    );
    let v: Value = serde_json::from_slice(&resp.body).unwrap_or(Value::Null);
    if resp.status == 200 {
        return plain(StatusCode::OK, json!({ "ok": true }));
    }
    refused(resp.status, &v)
}

/// The emailed code: an empty body asks for it to be mailed to the address the link was sent to;
/// `{code}` enters it. The code is never in a reply, a URL or a log line; five tries and three mails
/// a ten-minute window per link; a right one sets a cookie that is this link's alone.
async fn code(State(ctx): State<Arc<AppCtx>>, Path(token): Path<String>, body: Bytes) -> Response {
    let claims = match open_review(&ctx, &token, "", PER_LINK) {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Some(tenant) = TenantId::parse(&claims.tenant) else {
        return not_found();
    };
    let ws = ctx.workspace(&tenant);
    let Ok(session) = ws.session(&DocId::new(claims.doc.clone())) else {
        return gone("superseded");
    };
    let Ok(st) = session.read(|d| client_link::state_reply(d, &claims.id)) else {
        return gone("superseded");
    };
    if st["ok"] != true {
        return match st["state"].as_str() {
            Some("unknown") | None => not_found(),
            Some(word) => gone(word),
        };
    }
    // a link not made for a code, or a server that cannot mail one, has no code to give
    if st["code"] != true || !ctx.mail.enabled() {
        return not_found();
    }
    let sent = match json_body(&body, 1024) {
        Ok(v) => v,
        Err(_) if body.is_empty() => json!({}),
        Err(r) => return r,
    };
    let now = (ctx.code_clock)();
    let w = now / CODE_WINDOW_S;
    let Some(entered) = sent.get("code").and_then(Value::as_str) else {
        // send
        if !ctx
            .limiter
            .allow_in(&format!("{}:send", claims.id), CODE_SENDS, CODE_WINDOW)
        {
            return too_many();
        }
        let to = st["client"]["email"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let msg = crate::mail::Message::Code {
            to,
            code: code_for(&ctx.code_key, &claims.id, w),
            agency: claims.agency.clone(),
        };
        return match ctx.mail.send(&claims.tenant, now / 86_400, &msg) {
            Ok(()) => plain(StatusCode::OK, json!({ "ok": true, "sent": true })),
            Err(crate::mail::MailError::OverCap) => plain(
                StatusCode::TOO_MANY_REQUESTS,
                json!({ "ok": false, "error": "the agency cannot send more codes today" }),
            ),
            Err(_) => plain(
                StatusCode::SERVICE_UNAVAILABLE,
                json!({ "ok": false, "error": "the code could not be sent just now" }),
            ),
        };
    };
    // enter
    if !ctx
        .limiter
        .allow_in(&format!("{}:try", claims.id), CODE_TRIES, CODE_WINDOW)
    {
        return too_many();
    }
    let right = same(entered, &code_for(&ctx.code_key, &claims.id, w))
        | (w > 0 && same(entered, &code_for(&ctx.code_key, &claims.id, w - 1)));
    if !right {
        return plain(
            StatusCode::UNAUTHORIZED,
            json!({ "ok": false, "state": "code", "error": "that code is not right" }),
        );
    }
    let exp = now + CODE_COOKIE_S;
    let mut r = plain(StatusCode::OK, json!({ "ok": true }));
    let cookie = format!(
        "{}={exp}.{}; HttpOnly; Secure; SameSite=Strict; Path=/c; Max-Age={CODE_COOKIE_S}",
        cookie_name(&claims.id),
        cookie_mac(&ctx.code_key, &claims.id, exp)
    );
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        r.headers_mut().append(header::SET_COOKIE, v);
    }
    r
}

/// The person who made the link, as a link's agency: the part after `@`.
pub fn agency_of_person(person: &str) -> Option<String> {
    agency_of(person)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims(exp: u64) -> Claims {
        Claims {
            v: 1,
            id: "0123456789abcdef0123456789abcdef".into(),
            tenant: TenantId::mint().to_string(),
            doc: "doc-x".into(),
            scope: SCOPE.into(),
            targets: vec!["doc-x".into()],
            version: "v1".into(),
            hash: "sha256:00".into(),
            agency: Some("wk".into()),
            exp,
        }
    }

    #[test]
    fn a_signed_token_reads_back_and_a_changed_one_does_not() {
        let key = key_from(b"a session secret of thirty-two bytes!!");
        let c = claims(unix_now() + 60);
        let t = sign(&key, &c);
        assert_eq!(verify(&key, &t), Ok(c.clone()));

        // another server's key, a flipped byte, a swapped body, junk
        assert_eq!(
            verify(&key_from(b"another secret of thirty-two bytes!"), &t),
            Err(Bad::Forged)
        );
        let (body, sig) = t.split_once('.').unwrap();
        let mut other = claims(unix_now() + 60);
        other.doc = "doc-y".into();
        let swapped = format!("{}.{sig}", B64.encode(serde_json::to_vec(&other).unwrap()));
        assert_eq!(verify(&key, &swapped), Err(Bad::Forged));
        assert_eq!(verify(&key, &format!("{body}x.{sig}")), Err(Bad::Forged));
        assert_eq!(verify(&key, "nonsense"), Err(Bad::Forged));
        assert_eq!(verify(&key, ""), Err(Bad::Forged));
    }

    #[test]
    fn an_expired_token_is_expired_not_forged() {
        let key = key_from(b"a session secret of thirty-two bytes!");
        let t = sign(&key, &claims(unix_now().saturating_sub(1)));
        assert_eq!(verify(&key, &t), Err(Bad::Expired));
    }

    #[test]
    fn a_session_cookie_is_not_a_link() {
        // the cookie is signed with the raw secret; a link with the labelled key
        let secret = b"a session secret of thirty-two bytes!";
        let t = sign(secret, &claims(unix_now() + 60));
        assert_eq!(verify(&key_from(secret), &t), Err(Bad::Forged));
    }

    #[test]
    fn a_token_that_asks_for_more_than_one_target_or_another_scope_is_refused() {
        let key = key_from(b"a session secret of thirty-two bytes!");
        let mut c = claims(unix_now() + 60);
        c.targets.push("doc-y".into());
        assert_eq!(verify(&key, &sign(&key, &c)), Err(Bad::Forged));
        let mut c = claims(unix_now() + 60);
        c.scope = "comment".into();
        assert_eq!(verify(&key, &sign(&key, &c)), Err(Bad::Forged));
    }

    #[test]
    fn the_limiter_stops_a_key_and_not_another() {
        let l = Limiter::default();
        for _ in 0..3 {
            assert!(l.allow("a", 3));
        }
        assert!(!l.allow("a", 3));
        assert!(l.allow("b", 3));
    }
}
