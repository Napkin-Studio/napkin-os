// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Production Tool inside napkin-web (features/os-sign-in.clan,
//! features/production-jobs-via-host.clan): the real router in roster mode, in
//! front of a stub relay on an ephemeral port. The tool's calls are napkin-web's
//! own routes; napkin-web calls the relay with a service credential and a claim.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use clan_sdk::{ClanFile, SpinoffSpec};
use hmac::{Hmac, Mac};
use http_body_util::BodyExt;
use napkin_host::{library, NoConfig};
use napkin_web::production::{body_hash, Config, Relay, BODY_MAX};
use napkin_web::state::AppCtx;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tower::ServiceExt;

const KEY: &str = "a-dev-identity-secret-of-32-bytes-or-more";
/// The service key: what napkin-web sends as the bearer and signs the user claim with.
const SKEY: &str = "a-dev-service-key-of-32-bytes-or-more-xx";
const PRODUCTION: &str = "ie.napkin.production";
const BRIEF: &str = "ie.napkin.brief-maker";

/// What the stub relay received.
#[derive(Clone, Debug)]
struct Seen {
    method: String,
    path_and_query: String,
    headers: HeaderMap,
    body: Bytes,
}

type Log = Arc<Mutex<Vec<Seen>>>;

/// The stub relay's state: the state each job is in, and an optional refusal for every call.
#[derive(Default)]
struct Relay_ {
    jobs: Mutex<HashMap<String, String>>,
    refuse: Mutex<Option<(u16, String)>>,
}

type Control = Arc<Relay_>;

fn job_json(id: &str, state: &str) -> String {
    let mut j = serde_json::json!({"jobId": id, "state": state, "op": "clip"});
    if state == "completed" {
        j["outputs"] = serde_json::json!([{"sha256": "sha256:abc", "mime": "video/mp4", "url": "https://cdn.test/a"}]);
    }
    j.to_string()
}

/// A relay that records every call and answers with the headers the tool
/// reads. `POST /api/jobs` makes `job_1`, `job_2` ...; `GET /api/jobs/{id}` says the state
/// in `Control` (a job it never made is a 404); `/api/jobs/slow` sleeps 2 s.
async fn stub_relay() -> (String, Log, Control) {
    let log: Log = Arc::default();
    let control: Control = Arc::default();
    let (seen, ctl) = (log.clone(), control.clone());
    let app = Router::new().fallback(move |req: Request<Body>| {
        let (seen, ctl) = (seen.clone(), ctl.clone());
        async move {
            let (parts, body) = req.into_parts();
            let body = body.collect().await.unwrap().to_bytes();
            seen.lock().unwrap().push(Seen {
                method: parts.method.to_string(),
                path_and_query: parts
                    .uri
                    .path_and_query()
                    .map(|p| p.to_string())
                    .unwrap_or_default(),
                headers: parts.headers.clone(),
                body,
            });
            if let Some((status, body)) = ctl.refuse.lock().unwrap().clone() {
                return axum::response::Response::builder()
                    .status(status)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap();
            }
            let json = |status: u16, body: String| {
                axum::response::Response::builder()
                    .status(status)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::CACHE_CONTROL, "no-store")
                    .body(Body::from(body))
                    .unwrap()
            };
            let path = parts.uri.path().to_string();
            if path == "/api/jobs/slow" {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            if path.starts_with("/api/assets/") {
                return axum::response::Response::builder()
                    .status(302)
                    .header(header::LOCATION, "https://cdn.test/out/w2400/sha256:abc")
                    .header(header::CACHE_CONTROL, "no-store")
                    .body(Body::empty())
                    .unwrap();
            }
            if path == "/api/me" {
                return json(
                    200,
                    r#"{"participantId":"p_1","handle":"visionary","dogfood":{"consented":true}}"#
                        .into(),
                );
            }
            if path == "/api/config" {
                return json(200, r#"{"flags":{"dogfood":true,"x":1}}"#.into());
            }
            if parts.method == "POST" && path == "/api/jobs" {
                let mut jobs = ctl.jobs.lock().unwrap();
                let id = format!("job_{}", jobs.len() + 1);
                jobs.insert(id.clone(), "queued".into());
                return json(201, job_json(&id, "queued"));
            }
            if let Some(id) = path.strip_prefix("/api/jobs/") {
                if !id.contains('/') {
                    return match ctl.jobs.lock().unwrap().get(id) {
                        Some(state) => json(200, job_json(id, state)),
                        None => json(
                            404,
                            r#"{"error":{"code":"not_found","message":"no job"}}"#.into(),
                        ),
                    };
                }
            }
            axum::response::Response::builder()
                .status(201)
                .header(header::CONTENT_TYPE, "application/vnd.clan+zip")
                .header(header::CACHE_CONTROL, "no-store")
                .header(header::ETAG, "\"abc\"")
                .header("x-saved-at", "2026-10-13T00:00:00Z")
                .header(header::SET_COOKIE, "relay=leak")
                .header("x-relay-internal", "1")
                .body(Body::from("relay-bytes"))
                .unwrap()
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), log, control)
}

/// An address nothing listens on.
async fn dead_relay() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    drop(listener);
    format!("http://{addr}")
}

struct Server {
    _dir: tempfile::TempDir,
    ctx: Arc<AppCtx>,
    app: Router,
}

/// A tool build with an index, a hashed asset and a wasm file.
fn tool_build(dir: &std::path::Path) -> std::path::PathBuf {
    let root = dir.join("production");
    std::fs::create_dir_all(root.join("assets")).unwrap();
    std::fs::write(
        root.join("index.html"),
        "<!doctype html><title>Production</title>",
    )
    .unwrap();
    std::fs::write(root.join("assets/x-abc123.js"), "console.log(1)").unwrap();
    std::fs::write(root.join("assets/clan_bg.wasm"), b"\0asm\x01\0\0\0").unwrap();
    root
}

fn shell_build(dir: &std::path::Path) -> std::path::PathBuf {
    let root = dir.join("shell");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("index.html"),
        "<!doctype html><title>Napkin OS</title>",
    )
    .unwrap();
    root
}

fn identity(dir: &std::path::Path) -> napkin_web::tenant::Identity {
    let roster = dir.join("accounts.tsv");
    std::fs::write(
        &roster,
        "visionary@napkin\tLaurance\nengineer@napkin\tShrey\nplanner@javelin\tPia\n",
    )
    .unwrap();
    napkin_web::tenant::Identity {
        mode: napkin_web::tenant::Mode::Accounts {
            provider: napkin_web::auth::Provider::Roster(
                napkin_web::auth::Roster::open(dir.join("_people"), &roster).unwrap(),
            ),
            sessions: napkin_web::auth::Sessions::new(&[9u8; 32]).unwrap(),
        },
        secure: false,
    }
}

fn template(app_id: &str, name: &str) -> Vec<u8> {
    let base = clan_sdk::create(clan_sdk::CreateOptions {
        title: name.into(),
        brief: "test".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    clan_sdk::make_template(
        &ClanFile::from_bytes(base).unwrap(),
        clan_sdk::AppInfo {
            home: None,
            name: name.into(),
            app_id: app_id.into(),
            version: "1.0.0".into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: Some("agent/output-schema.json".into()),
            prompt_templates: vec![],
            data_seed: None,
            spinoff: None::<SpinoffSpec>,
            attach: None,
        },
        clan_sdk::MakeTemplateOptions::default(),
    )
    .unwrap()
}

/// The same, told where pictures live.
fn server_with_media(relay_url: Option<String>, media: Option<String>) -> Server {
    server_in(relay_url, Duration::from_secs(5), media)
}

/// Roster sign-in with the tool mounted in front of `relay_url`.
fn server(relay_url: Option<String>, timeout: Duration) -> Server {
    server_in(relay_url, timeout, None)
}

fn server_in(relay_url: Option<String>, timeout: Duration, media: Option<String>) -> Server {
    let dir = tempfile::tempdir().unwrap();
    let seed = dir.path().join("seed");
    std::fs::create_dir_all(&seed).unwrap();
    std::fs::write(
        seed.join("production.app.clan"),
        template(PRODUCTION, "Production"),
    )
    .unwrap();
    std::fs::write(seed.join("brief.app.clan"), template(BRIEF, "Brief Maker")).unwrap();
    let ctx = Arc::new(
        AppCtx::new(dir.path().join("data"), Arc::new(NoConfig), None, 40).with_seed(Some(seed)),
    );
    let tool = tool_build(dir.path());
    let shell = shell_build(dir.path());
    let production = relay_url.map(|url| {
        let config = Config::from_vars(
            true,
            Some(&url),
            Some(KEY),
            Some(SKEY),
            Some(tool.to_str().unwrap()),
        )
        .unwrap()
        .unwrap();
        Arc::new(Relay::with_timeout(config, timeout).with_media_base(media))
    });
    let app = napkin_web::router_full(
        ctx.clone(),
        Some(&shell),
        Arc::new(identity(dir.path())),
        production,
    );
    Server {
        _dir: dir,
        ctx,
        app,
    }
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| {
            panic!(
                "expected JSON, got {:?}: {e}",
                String::from_utf8_lossy(&self.body)
            )
        })
    }
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

async fn send(s: &Server, req: Request<Body>) -> Reply {
    let resp = s.app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        body,
    }
}

fn get(uri: &str, cookie: Option<&str>) -> Request<Body> {
    let mut b = Request::builder()
        .uri(uri)
        .header(header::HOST, "studio.test");
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, c);
    }
    b.body(Body::empty()).unwrap()
}

async fn sign_in(s: &Server, user: &str) -> String {
    let r = send(
        s,
        Request::builder()
            .method("POST")
            .uri("/api/auth/sign-in")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({"username": user}).to_string(),
            ))
            .unwrap(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    r.headers
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("napkin_session="))
        .map(|v| v.split(';').next().unwrap().to_string())
        .expect("a session cookie")
}

// ── The credential (S3-2, napkin-web's half) ────────────────────────────────

/// The relay's side, written from the contract and not from napkin-web's signer: the bearer is
/// the service key; the user header is `<b64url claims>.<b64url HMAC-SHA256(key, input)>` with
/// `input` = `napkin-user-v1`, METHOD, path and query, hex SHA-256 of the body, the claims, joined
/// with LF. Returns the claims.
fn verify_user(seen: &Seen) -> Value {
    assert_eq!(
        seen.headers[header::AUTHORIZATION].to_str().unwrap(),
        format!("Bearer {SKEY}")
    );
    let user = seen.headers["x-napkin-user"].to_str().unwrap();
    let (claims, sig) = user.split_once('.').expect("claims.signature");
    let input = [
        "napkin-user-v1",
        &seen.method,
        &seen.path_and_query,
        &hex(&Sha256::digest(&seen.body)),
        claims,
    ]
    .join("\n");
    let mut mac = Hmac::<Sha256>::new_from_slice(SKEY.as_bytes()).unwrap();
    mac.update(input.as_bytes());
    mac.verify_slice(&B64.decode(sig).unwrap())
        .expect("signed with the service key, bound to this request");
    serde_json::from_slice(&B64.decode(claims).unwrap()).unwrap()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A signed-in person and a Production project of their workspace.
struct Me {
    cookie: String,
    tenant: String,
    doc: String,
}

async fn me(s: &Server, user: &str) -> Me {
    let cookie = sign_in(s, user).await;
    let session = send(s, get("/api/session", Some(&cookie))).await.json();
    let tenant = session["tenant"].as_str().unwrap().to_string();
    let r = send(
        s,
        Request::builder()
            .method("POST")
            .uri(format!("/api/t/{tenant}/documents"))
            .header(header::HOST, "studio.test")
            .header(header::COOKIE, &cookie)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({"app_id": PRODUCTION, "title": "A film"}).to_string(),
            ))
            .unwrap(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let doc = r.json()["path"].as_str().unwrap().to_string();
    Me {
        cookie,
        tenant,
        doc,
    }
}

impl Me {
    /// `/api/t/{tenant}/d/{doc}/production<rest>` as this person.
    fn bound(&self, rest: &str) -> String {
        format!("/api/t/{}/d/{}/production{rest}", self.tenant, self.doc)
    }
    fn free(&self, rest: &str) -> String {
        format!("/api/t/{}/production{rest}", self.tenant)
    }
    fn req(&self, method: &str, uri: &str, body: Vec<u8>) -> Request<Body> {
        Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, "studio.test")
            .header(header::COOKIE, &self.cookie)
            .body(Body::from(body))
            .unwrap()
    }
}

#[tokio::test]
async fn signed_out_the_routes_answer_sign_in_and_never_call_the_relay() {
    let (url, log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let t = napkin_web::tenant::TenantId::of_agency("napkin");
    for path in [
        format!("/api/t/{t}/production/me"),
        format!("/api/t/{t}/d/doc1/production/jobs"),
        format!("/api/t/{t}/d/doc1/production/inbox"),
    ] {
        let r = send(&s, get(&path, None)).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(r.json()["signin"], true, "{path}");
    }
    assert!(log.lock().unwrap().is_empty(), "the relay was called");
}

#[tokio::test]
async fn a_call_carries_the_service_credential_and_a_claim_and_nothing_the_browser_sent() {
    let (url, log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    let body = br#"{"op":"clip"}"#.to_vec();
    let req = Request::builder()
        .method("POST")
        .uri(p.bound("/jobs?reason=manual&x=%2F"))
        .header(header::HOST, "studio.test")
        .header(header::ORIGIN, "https://studio.test")
        .header(header::COOKIE, format!("{}; other=1", p.cookie))
        // everything a browser could try to pass for a credential or a claim
        .header(header::AUTHORIZATION, "Bearer forged")
        .header("x-napkin-user", "forged.claim")
        .header("x-napkin-identity", "v1.forged.sig")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::IF_MATCH, "\"etag1\"")
        .header("x-clan-reason", "manual")
        .header("x-forwarded-for", "1.2.3.4")
        .header("x-other", "no")
        .body(Body::from(body.clone()))
        .unwrap();
    let r = send(&s, req).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.text());
    // what the tool reads comes back, and nothing else the relay set
    assert_eq!(r.json()["jobId"], "job_1");
    assert_eq!(r.headers[header::CACHE_CONTROL], "no-store");
    assert!(r.headers.get(header::SET_COOKIE).is_none());

    let seen = log.lock().unwrap().clone();
    assert_eq!(seen.len(), 1);
    let call = &seen[0];
    assert_eq!(call.method, "POST");
    assert_eq!(call.path_and_query, "/api/jobs?reason=manual&x=%2F");
    assert_eq!(call.body.as_ref(), body.as_slice());
    assert!(
        call.headers.get(header::COOKIE).is_none(),
        "the cookie leaked"
    );
    for name in ["x-forwarded-for", "x-other", "origin", "x-napkin-identity"] {
        assert!(call.headers.get(name).is_none(), "{name} was forwarded");
    }
    assert_eq!(call.headers["content-type"], "application/json");
    assert_eq!(call.headers["if-match"], "\"etag1\"");
    assert_eq!(call.headers["x-clan-reason"], "manual");
    // one credential and one claim: napkin-web's, not the forged ones
    assert_eq!(
        call.headers.get_all(header::AUTHORIZATION).iter().count(),
        1
    );
    assert_eq!(call.headers.get_all("x-napkin-user").iter().count(), 1);
    let claims = verify_user(call);
    assert_eq!(claims["u"], "visionary@napkin");
    assert_eq!(claims["a"], "napkin");
    assert_eq!(
        claims["t"],
        napkin_web::tenant::TenantId::of_agency("napkin").to_string()
    );
    assert_eq!(claims["n"], "Laurance");
    assert_eq!(claims["doc"], p.doc.as_str());
    assert_eq!(
        claims["exp"].as_u64().unwrap() - claims["iat"].as_u64().unwrap(),
        60
    );
    assert_eq!(body_hash(&call.body).len(), 64);
}

#[tokio::test]
async fn every_outbound_relay_call_carries_both_and_a_get_names_the_bare_path() {
    let (url, log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "engineer@napkin").await;
    let calls = [
        ("GET", p.free("/me")),
        ("GET", p.free("/config")),
        ("GET", p.free("/library/agency")),
        ("POST", p.free("/log")),
        ("POST", p.bound("/jobs")),
        ("GET", p.bound("/jobs/job_1")),
        ("DELETE", p.bound("/jobs/job_1")),
        ("POST", p.bound("/jobs/job_1/answer")),
        ("POST", p.bound("/uploads")),
        ("GET", p.bound("/assets/sha256:abc?w=2400")),
    ];
    for (method, uri) in &calls {
        send(&s, p.req(method, uri, b"{}".to_vec())).await;
    }
    let seen = log.lock().unwrap().clone();
    assert_eq!(seen.len(), calls.len());
    for call in &seen {
        let c = verify_user(call);
        assert_eq!(c["u"], "engineer@napkin", "{}", call.path_and_query);
    }
    let me_call = seen.iter().find(|c| c.path_and_query == "/api/me").unwrap();
    assert!(
        verify_user(me_call).get("doc").is_none(),
        "no document, no doc claim"
    );
    let jobs = seen
        .iter()
        .find(|c| c.path_and_query == "/api/jobs")
        .unwrap();
    assert_eq!(verify_user(jobs)["doc"], p.doc.as_str());
}

#[tokio::test]
async fn a_picture_is_a_redirect_the_browser_follows() {
    // GET /assets/{sha} (features/prod-assets-route.clan): the relay answers 302 to the picture's URL; napkin-web
    // never follows it and passes the Location back, so the browser reads the bytes from the CDN.
    let (url, log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    let r = send(
        &s,
        get(&p.bound("/assets/sha256:abc?w=2400"), Some(&p.cookie)),
    )
    .await;
    assert_eq!(r.status, StatusCode::FOUND);
    assert_eq!(
        r.headers[header::LOCATION],
        "https://cdn.test/out/w2400/sha256:abc"
    );
    let seen = log.lock().unwrap().clone();
    assert_eq!(seen[0].path_and_query, "/api/assets/sha256:abc?w=2400");
    verify_user(&seen[0]);
}

// S2-2 and the typed routes: documents, lists and saves are napkin-web's own; only what the relay answers
// goes there, a document's calls only for a Production document of this workspace.
#[tokio::test]
async fn only_what_the_relay_answers_reaches_it_and_a_document_call_needs_its_document() {
    let (url, log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    for (method, uri) in [
        ("GET", p.free("/clan")),
        ("PUT", p.free("/clan/x")),
        ("GET", p.free("/projects")),
        ("GET", p.free("/documents")),
        ("POST", p.free("/t/x/d/y/save")),
        ("GET", p.free("/library-of-everything")),
        ("GET", p.bound("/clan")),
        ("GET", p.bound("/projects/prj_1")),
        // a document's own calls need a document
        ("POST", p.free("/jobs")),
        ("GET", p.free("/jobs/j1")),
        ("POST", p.free("/uploads")),
        ("GET", p.free("/assets/sha256:abc")),
        // a document that is not there, or is not Production's
        (
            "POST",
            format!("/api/t/{}/d/doc-nope/production/jobs", p.tenant),
        ),
    ] {
        let r = send(&s, p.req(method, &uri, b"{}".to_vec())).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{method} {uri}");
    }
    let ws = s
        .ctx
        .workspace(&napkin_web::tenant::TenantId::of_agency("napkin"));
    let brief = library::create_instance(&*ws.store, BRIEF, Some("A brief".into())).unwrap();
    for rest in ["/jobs", "/inbox"] {
        let uri = format!("/api/t/{}/d/{brief}/production{rest}", p.tenant);
        let r = send(
            &s,
            p.req(
                if rest == "/jobs" { "POST" } else { "GET" },
                &uri,
                b"{}".to_vec(),
            ),
        )
        .await;
        assert_eq!(
            r.status,
            StatusCode::NOT_FOUND,
            "a brief is not a project: {rest}"
        );
    }
    assert!(log.lock().unwrap().is_empty(), "nothing reached the relay");
    // another agency's workspace is not this person's
    let q = sign_in(&s, "planner@javelin").await;
    let r = send(&s, get(&p.bound("/jobs/job_1"), Some(&q))).await;
    assert!(!r.status.is_success(), "{}", r.status);
    assert!(log.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_retired_proxy_is_gone_and_never_reaches_the_relay() {
    let (url, log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    for (method, uri) in [
        ("GET", "/production/api/me"),
        ("POST", "/production/api/jobs"),
        ("GET", "/production/api/assets/sha256:abc"),
        ("GET", "/production/api/clan"),
        ("PUT", "/production/api/projects/prj_1"),
    ] {
        let r = send(&s, p.req(method, uri, Vec::new())).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{method} {uri}");
        assert_eq!(r.json()["error"]["code"], "not_found");
    }
    assert!(log.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_relays_refusals_come_back_in_plain_words() {
    let (url, _log, ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    // the service credential refused: napkin-web's setup, never read as "signed out"
    *ctl.refuse.lock().unwrap() = Some((
        401,
        r#"{"error":{"code":"unauthorised","message":"x"}}"#.into(),
    ));
    let r = send(&s, get(&p.free("/me"), Some(&p.cookie))).await;
    assert_eq!(r.status, StatusCode::BAD_GATEWAY);
    let e = &r.json()["error"];
    assert_eq!(e["code"], "provider_unavailable");
    let words = e["message"].as_str().unwrap();
    assert!(
        words.contains("Nothing is wrong with your account"),
        "{words}"
    );
    assert!(!words.contains("401"), "{words}");
    assert!(r.json().get("signin").is_none());
    // a claim for another workspace
    *ctl.refuse.lock().unwrap() = Some((
        403,
        r#"{"error":{"code":"forbidden","message":"tenant"}}"#.into(),
    ));
    let r = send(&s, get(&p.bound("/jobs/job_1"), Some(&p.cookie))).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.json()["error"]["code"], "unauthorised");
    assert!(r.json()["error"]["message"]
        .as_str()
        .unwrap()
        .contains("workspace"));
    // the agency being off is the relay's own answer, which the tool words itself
    *ctl.refuse.lock().unwrap() = Some((
        403,
        r#"{"error":{"code":"flag_off","message":"off"}}"#.into(),
    ));
    let r = send(&s, get(&p.free("/me"), Some(&p.cookie))).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.json()["error"]["code"], "flag_off");
}

// S3-2 grep guard: the per-user HMAC path is deleted from napkin-web; the assets pass is the one use of an
// X-Napkin-Identity-style signature left.
#[test]
fn the_per_user_assertion_is_deleted_from_napkin_web() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for file in ["production.rs", "relay_client.rs", "sandbox.rs"] {
        let text = std::fs::read_to_string(src.join(file)).unwrap();
        // strip the test modules: they may name what is gone
        let code = text.split("#[cfg(test)]").next().unwrap();
        for gone in [
            "IDENTITY_HEADER",
            "x-napkin-identity",
            "for_request",
            "ASSERTION_TTL_S",
            "aud: \"relay\"",
            "aud: \"relay\".into()",
        ] {
            assert!(!code.contains(gone), "{file} still has {gone}");
        }
    }
}

// ── Jobs, the registry and the inbox (S3-3, napkin-web's half) ───────────────

async fn start_job(s: &Server, p: &Me) -> String {
    let r = send(
        s,
        p.req("POST", &p.bound("/jobs"), br#"{"op":"clip"}"#.to_vec()),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.text());
    r.json()["jobId"].as_str().unwrap().to_string()
}

async fn settle(s: &Server, p: &Me, job: &str) -> Value {
    let r = send(
        s,
        p.req(
            "POST",
            &format!("/api/t/{}/d/{}/jobs/{job}/settle", p.tenant, p.doc),
            Vec::new(),
        ),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    r.json()
}

async fn inbox(s: &Server, p: &Me) -> Vec<Value> {
    let r = send(s, get(&p.bound("/inbox"), Some(&p.cookie))).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    r.json()["entries"].as_array().unwrap().clone()
}

async fn unsettled(s: &Server, p: &Me) -> Vec<String> {
    let r = send(
        s,
        get(&format!("/api/t/{}/library", p.tenant), Some(&p.cookie)),
    )
    .await;
    let v = r.json();
    let item = v["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["path"] == p.doc.as_str())
        .unwrap()
        .clone();
    item["jobs"]
        .as_array()
        .map(|a| a.iter().map(|j| j.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
}

#[tokio::test]
async fn a_job_started_through_napkin_web_is_recorded_against_its_document() {
    let (url, _log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    assert!(unsettled(&s, &p).await.is_empty());
    let job = start_job(&s, &p).await;
    assert_eq!(unsettled(&s, &p).await, vec![job.clone()]);
    // another project of the same person does not carry it
    let other = me_doc(&s, &p, "Second").await;
    let r = send(
        &s,
        get(&format!("/api/t/{}/library", p.tenant), Some(&p.cookie)),
    )
    .await;
    let v = r.json();
    let item = v["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["path"] == other.as_str())
        .unwrap()
        .clone();
    assert!(item["jobs"].as_array().is_none_or(|a| a.is_empty()));
}

async fn me_doc(s: &Server, p: &Me, title: &str) -> String {
    let r = send(
        s,
        Request::builder()
            .method("POST")
            .uri(format!("/api/t/{}/documents", p.tenant))
            .header(header::HOST, "studio.test")
            .header(header::COOKIE, &p.cookie)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({"app_id": PRODUCTION, "title": title}).to_string(),
            ))
            .unwrap(),
    )
    .await;
    r.json()["path"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn a_job_that_finishes_with_the_tab_closed_waits_in_the_inbox_once() {
    let (url, _log, ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    let job = start_job(&s, &p).await;

    // still running: the watcher finds nothing to land and the document is untouched
    let before = send(
        &s,
        get(
            &format!("/api/t/{}/d/{}/download", p.tenant, p.doc),
            Some(&p.cookie),
        ),
    )
    .await
    .body;
    let a = settle(&s, &p, &job).await;
    assert_eq!(a["settled"], "running");
    assert!(inbox(&s, &p).await.is_empty());

    // the relay finishes it while no tab is open
    ctl.jobs
        .lock()
        .unwrap()
        .insert(job.clone(), "completed".into());
    let a = settle(&s, &p, &job).await;
    assert_eq!(
        (a["settled"].as_str(), a["state"].as_str()),
        (Some("stored"), Some("completed"))
    );
    let entries = inbox(&s, &p).await;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["job"], job.as_str());
    assert_eq!(entries[0]["outcome"]["outputs"][0]["sha256"], "sha256:abc");
    assert!(unsettled(&s, &p).await.is_empty(), "the registry let it go");

    // settling twice says so and keeps one entry
    for _ in 0..2 {
        assert_eq!(settle(&s, &p, &job).await["settled"], "already applied");
    }
    assert_eq!(inbox(&s, &p).await.len(), 1);

    // the host never wrote the document for it
    let after = send(
        &s,
        get(
            &format!("/api/t/{}/d/{}/download", p.tenant, p.doc),
            Some(&p.cookie),
        ),
    )
    .await
    .body;
    assert_eq!(before, after, "the document body is the tool's alone");

    // the tool lands it and acknowledges: gone, and settling again does not bring it back
    let r = send(
        &s,
        p.req("POST", &p.bound(&format!("/inbox/{job}/ack")), Vec::new()),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let r = send(
        &s,
        p.req("POST", &p.bound(&format!("/inbox/{job}/ack")), Vec::new()),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "twice is fine");
    assert!(inbox(&s, &p).await.is_empty());
    assert_eq!(settle(&s, &p, &job).await["settled"], "already applied");
    assert!(inbox(&s, &p).await.is_empty());
}

#[tokio::test]
async fn a_job_landed_by_an_open_tab_is_never_offered_again() {
    let (url, _log, ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    let job = start_job(&s, &p).await;
    // the tab polled it, landed it directly and acknowledged it before the watcher came
    ctl.jobs
        .lock()
        .unwrap()
        .insert(job.clone(), "completed".into());
    let r = send(&s, get(&p.bound(&format!("/jobs/{job}")), Some(&p.cookie))).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(
        unsettled(&s, &p).await.is_empty(),
        "a polled, finished job is not left to settle"
    );
    send(
        &s,
        p.req("POST", &p.bound(&format!("/inbox/{job}/ack")), Vec::new()),
    )
    .await;
    assert_eq!(settle(&s, &p, &job).await["settled"], "already applied");
    assert!(inbox(&s, &p).await.is_empty());
}

#[tokio::test]
async fn two_settlers_racing_give_one_entry() {
    let (url, _log, ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = Arc::new(me(&s, "visionary@napkin").await);
    let job = start_job(&s, &p).await;
    ctl.jobs
        .lock()
        .unwrap()
        .insert(job.clone(), "completed".into());
    let mut tasks = Vec::new();
    for _ in 0..8 {
        let (app, p, job) = (s.app.clone(), p.clone(), job.clone());
        tasks.push(tokio::spawn(async move {
            let req = p.req(
                "POST",
                &format!("/api/t/{}/d/{}/jobs/{job}/settle", p.tenant, p.doc),
                Vec::new(),
            );
            let resp = app.oneshot(req).await.unwrap();
            let body = resp.into_body().collect().await.unwrap().to_bytes();
            serde_json::from_slice::<Value>(&body).unwrap()["settled"]
                .as_str()
                .unwrap()
                .to_string()
        }));
    }
    let mut words = Vec::new();
    for t in tasks {
        words.push(t.await.unwrap());
    }
    assert_eq!(
        words.iter().filter(|w| *w == "stored").count(),
        1,
        "{words:?}"
    );
    assert_eq!(
        words.iter().filter(|w| *w == "already applied").count(),
        7,
        "{words:?}"
    );
    assert_eq!(inbox(&s, &p).await.len(), 1);
}

#[tokio::test]
async fn a_relay_restart_in_the_middle_loses_nothing() {
    // The relay's durable jobs resume after a restart (relay-durable-jobs): while it is down a settle is the
    // relay's refusal and changes nothing; when it is back the job, now finished, lands once.
    let (url, _log, ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    let job = start_job(&s, &p).await;
    *ctl.refuse.lock().unwrap() = Some((
        503,
        r#"{"error":{"code":"provider_unavailable","message":"restarting","retryable":true}}"#
            .into(),
    ));
    let r = send(
        &s,
        p.req(
            "POST",
            &format!("/api/t/{}/d/{}/jobs/{job}/settle", p.tenant, p.doc),
            Vec::new(),
        ),
    )
    .await;
    assert_eq!(r.status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(inbox(&s, &p).await.is_empty());
    assert_eq!(
        unsettled(&s, &p).await,
        vec![job.clone()],
        "still to settle"
    );
    *ctl.refuse.lock().unwrap() = None;
    ctl.jobs
        .lock()
        .unwrap()
        .insert(job.clone(), "completed".into());
    assert_eq!(settle(&s, &p, &job).await["settled"], "stored");
    assert_eq!(settle(&s, &p, &job).await["settled"], "already applied");
    assert_eq!(inbox(&s, &p).await.len(), 1);
}

#[tokio::test]
async fn a_job_the_relay_does_not_know_is_forgotten() {
    let (url, _log, ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    let job = start_job(&s, &p).await;
    ctl.jobs.lock().unwrap().clear();
    assert_eq!(settle(&s, &p, &job).await["settled"], "lost");
    assert!(unsettled(&s, &p).await.is_empty());
    assert!(inbox(&s, &p).await.is_empty());
}

#[tokio::test]
async fn the_inbox_belongs_to_one_document_of_one_workspace() {
    let (url, _log, ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    let job = start_job(&s, &p).await;
    ctl.jobs
        .lock()
        .unwrap()
        .insert(job.clone(), "completed".into());
    settle(&s, &p, &job).await;
    let second = Me {
        cookie: p.cookie.clone(),
        tenant: p.tenant.clone(),
        doc: me_doc(&s, &p, "Second").await,
    };
    assert!(
        inbox(&s, &second).await.is_empty(),
        "another project's inbox"
    );
    // a bad job id is refused, never turned into a path
    let r = send(&s, p.req("POST", &p.bound("/inbox/..%2Fx/ack"), Vec::new())).await;
    assert!(r.status.is_client_error());
    // another agency cannot read it
    let q = sign_in(&s, "planner@javelin").await;
    let r = send(&s, get(&p.bound("/inbox"), Some(&q))).await;
    assert!(!r.status.is_success());
    assert!(!r.text().contains("sha256:abc"));
}

// The dogfood record is napkin-web's alone: what the tool is told about it is napkin-web's word.
#[tokio::test]
async fn the_tool_is_told_napkin_webs_dogfood_state_not_the_relays() {
    let (url, _log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    // this build does not record: neither the relay's consent nor its flag is passed on
    let r = send(&s, get(&p.free("/me"), Some(&p.cookie))).await;
    assert!(r.json().get("dogfood").is_none(), "{}", r.text());
    assert_eq!(r.json()["handle"], "visionary");
    let r = send(&s, get(&p.free("/config"), Some(&p.cookie))).await;
    assert_eq!(r.json()["flags"]["dogfood"], false);
    assert_eq!(r.json()["flags"]["x"], 1);
}

#[tokio::test]
async fn a_body_over_four_and_a_half_megabytes_is_refused_in_the_relay_shape() {
    let (url, log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    let r = send(
        &s,
        p.req("POST", &p.bound("/uploads"), vec![b'x'; BODY_MAX]),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "4.5 MB exactly passes");
    let r = send(
        &s,
        p.req("POST", &p.bound("/uploads"), vec![b'x'; BODY_MAX + 1]),
    )
    .await;
    assert_eq!(r.status, StatusCode::PAYLOAD_TOO_LARGE);
    let e = &r.json()["error"];
    assert_eq!(e["code"], "invalid_input");
    assert_eq!(e["retryable"], false);
    assert!(e["message"].as_str().unwrap().contains("4.5 MB"));
    assert_eq!(
        log.lock().unwrap().len(),
        1,
        "only the first reached the relay"
    );
}

#[tokio::test]
async fn a_relay_that_is_down_is_a_502_and_one_too_slow_a_504() {
    // Test adaptation: the 65 s timeout is set to 1 s here, and the stub sleeps 2 s.
    let s = server(Some(dead_relay().await), Duration::from_secs(1));
    let p = me(&s, "visionary@napkin").await;
    let r = send(&s, get(&p.free("/me"), Some(&p.cookie))).await;
    assert_eq!(r.status, StatusCode::BAD_GATEWAY);
    assert_eq!(r.json()["error"]["code"], "provider_unavailable");
    assert_eq!(r.json()["error"]["retryable"], true);

    let (url, _log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(1));
    let p = me(&s, "visionary@napkin").await;
    let r = send(&s, get(&p.bound("/jobs/slow"), Some(&p.cookie))).await;
    assert_eq!(r.status, StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(r.json()["error"]["code"], "timeout");
    assert_eq!(r.json()["error"]["retryable"], true);
}

#[tokio::test]
async fn a_write_from_another_site_is_refused() {
    let (url, log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let p = me(&s, "visionary@napkin").await;
    let r = send(
        &s,
        Request::builder()
            .method("POST")
            .uri(p.bound("/jobs"))
            .header(header::HOST, "studio.test")
            .header(header::ORIGIN, "https://evil.example")
            .header(header::COOKIE, &p.cookie)
            .body(Body::from("{}"))
            .unwrap(),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert!(log.lock().unwrap().is_empty());
    // a read from anywhere is still a read
    let r = send(
        &s,
        Request::builder()
            .uri(p.free("/me"))
            .header(header::HOST, "studio.test")
            .header(header::ORIGIN, "https://evil.example")
            .header(header::COOKIE, &p.cookie)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
}

// S2-5: the old ways in become the page's own address for one release.
#[tokio::test]
async fn the_old_doc_query_redirects_to_the_project_page() {
    let (url, _log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let r = send(&s, get("/production/?doc=doc_01J-x", None)).await;
    assert!(r.status.is_redirection(), "{}", r.status);
    assert_eq!(r.headers[header::LOCATION], "/production/d/doc_01J-x");
    // an id the tool cannot route is not echoed into a Location
    for bad in [
        "/production/?doc=a%2F..%2Fb",
        "/production/?doc=",
        "/production/?doc=x%20y",
    ] {
        let r = send(&s, get(bad, None)).await;
        assert_eq!(r.status, StatusCode::OK, "{bad}");
        assert!(r.text().contains("<title>Production</title>"), "{bad}");
    }
    // the project list stays at /production/
    let r = send(&s, get("/production/", None)).await;
    assert_eq!(r.status, StatusCode::OK);
    // the project page and its sub-routes are the tool's index
    for path in [
        "/production/d/doc1",
        "/production/d/doc1/storyboard",
        "/production/d/doc1/script/s1?shot=x",
    ] {
        let r = send(&s, get(path, None)).await;
        assert_eq!(r.status, StatusCode::OK, "{path}");
        assert!(r.text().contains("<title>Production</title>"), "{path}");
        assert_eq!(r.headers[header::CACHE_CONTROL], "no-cache", "{path}");
    }
}

// S2-3 (host half): one policy, on the tool's pages, report-only, naming the picture origin; reports are logged.
#[tokio::test]
async fn the_tool_pages_carry_one_report_only_policy() {
    let (url, _log, _ctl) = stub_relay().await;
    let s = server_with_media(Some(url), Some("https://cdn.example.com/m".into()));
    for path in [
        "/production/",
        "/production/d/doc1",
        "/production/assets/x-abc123.js",
        "/production/d/doc1/video",
    ] {
        let r = send(&s, get(path, None)).await;
        let all: Vec<_> = r
            .headers
            .get_all("content-security-policy-report-only")
            .iter()
            .collect();
        assert_eq!(all.len(), 1, "{path}");
        let policy = all[0].to_str().unwrap();
        assert!(policy.contains("default-src 'self'"), "{policy}");
        assert!(
            policy.contains("img-src 'self' data: blob: https://cdn.example.com;"),
            "{policy}"
        );
        assert!(
            policy.contains("connect-src 'self' https://cdn.example.com;"),
            "{policy}"
        );
        assert!(
            policy.contains("report-uri /production/csp-report"),
            "{policy}"
        );
        assert!(!policy.contains("script-src 'self' 'unsafe"), "{policy}");
        assert!(
            r.headers.get("content-security-policy").is_none(),
            "{path}: not enforcing yet"
        );
    }
    // the API answers carry none; the shell is untouched
    let r = send(&s, get("/production/api/me", None)).await;
    assert_eq!(
        r.status,
        StatusCode::NOT_FOUND,
        "retired, with no policy header"
    );
    assert!(r
        .headers
        .get("content-security-policy-report-only")
        .is_none());
    let r = send(&s, get("/", None)).await;
    assert!(r
        .headers
        .get("content-security-policy-report-only")
        .is_none());
    // a violation report is taken without a session
    let req = Request::builder()
        .method("POST")
        .uri("/production/csp-report")
        .header(header::CONTENT_TYPE, "application/csp-report")
        .body(Body::from(
            r#"{"csp-report":{"violated-directive":"img-src"}}"#,
        ))
        .unwrap();
    assert_eq!(send(&s, req).await.status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn the_tool_is_served_with_its_own_index_for_its_routes() {
    let (url, _log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    for path in [
        "/production",
        "/production/",
        "/production/p/abc",
        "/production/p/abc/script/s1?shot=x",
    ] {
        let r = send(&s, get(path, None)).await;
        assert_eq!(r.status, StatusCode::OK, "{path}");
        assert!(
            r.text().contains("<title>Production</title>"),
            "{path}: {}",
            r.text()
        );
        assert_eq!(r.headers[header::CACHE_CONTROL], "no-cache", "{path}");
    }
    let r = send(&s, get("/production/assets/x-abc123.js", None)).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(r.headers[header::CONTENT_TYPE]
        .to_str()
        .unwrap()
        .contains("javascript"));
    assert_eq!(
        r.headers[header::CACHE_CONTROL],
        "public, max-age=31536000, immutable"
    );
    let r = send(&s, get("/production/assets/clan_bg.wasm", None)).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.headers[header::CONTENT_TYPE], "application/wasm");
    let r = send(&s, get("/production/assets/missing-123.js", None)).await;
    assert_eq!(
        r.status,
        StatusCode::NOT_FOUND,
        "a missing asset is not the index"
    );
    // the shell is still the shell
    let r = send(&s, get("/", None)).await;
    assert!(r.text().contains("Napkin OS"));
}

#[tokio::test]
async fn the_session_says_whether_the_tool_is_here() {
    let (url, _log, _ctl) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let cookie = sign_in(&s, "visionary@napkin").await;
    let r = send(&s, get("/api/session", Some(&cookie))).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json()["production"], true);

    // not configured: /production is the shell's, and nobody is told otherwise
    let s = server(None, Duration::from_secs(5));
    let cookie = sign_in(&s, "visionary@napkin").await;
    let r = send(&s, get("/api/session", Some(&cookie))).await;
    assert_eq!(r.json()["production"], false);
    let r = send(&s, get("/production/", None)).await;
    assert!(r.text().contains("Napkin OS"), "{}", r.text());
}

#[tokio::test]
async fn anonymous_mode_never_mounts_the_tool() {
    let (url, log, _ctl) = stub_relay().await;
    let dir = tempfile::tempdir().unwrap();
    let ctx = Arc::new(AppCtx::new(
        dir.path().to_path_buf(),
        Arc::new(NoConfig),
        None,
        40,
    ));
    let shell = shell_build(dir.path());
    // Config::from_vars refuses this; the router refuses it too.
    let config = Config {
        relay_url: url,
        key: KEY.as_bytes().to_vec(),
        service_key: SKEY.as_bytes().to_vec(),
        static_dir: tool_build(dir.path()),
    };
    let app = napkin_web::router_full(
        ctx,
        Some(&shell),
        Arc::new(napkin_web::tenant::Identity::anonymous(false)),
        Some(Arc::new(Relay::new(config))),
    );
    let s = Server {
        ctx: Arc::new(AppCtx::new(
            dir.path().join("d2"),
            Arc::new(NoConfig),
            None,
            40,
        )),
        _dir: dir,
        app,
    };
    let r = send(&s, get("/api/session", None)).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json()["production"], false);
    let r = send(&s, get("/production/api/me", None)).await;
    assert!(
        r.text().contains("Napkin OS"),
        "the shell's fallback, not the relay"
    );
    assert!(log.lock().unwrap().is_empty());
}
