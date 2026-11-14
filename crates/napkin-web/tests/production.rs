// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Production Tool inside napkin-web (features/os-sign-in.clan): the real
//! router in roster mode, in front of a stub relay on an ephemeral port.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use http_body_util::BodyExt;
use napkin_host::NoConfig;
use napkin_web::production::{body_hash, Config, Relay, BODY_MAX};
use napkin_web::state::AppCtx;
use serde_json::Value;
use sha2::Sha256;
use tower::ServiceExt;

const KEY: &str = "a-dev-identity-secret-of-32-bytes-or-more";

/// What the stub relay received.
#[derive(Clone, Debug)]
struct Seen {
    method: String,
    path_and_query: String,
    headers: HeaderMap,
    body: Bytes,
}

type Log = Arc<Mutex<Vec<Seen>>>;

/// A relay that records every call and answers with the headers the tool
/// reads. `/api/slow` sleeps 2 s.
async fn stub_relay() -> (String, Log) {
    let log: Log = Arc::default();
    let seen = log.clone();
    let app = Router::new().fallback(move |req: Request<Body>| {
        let seen = seen.clone();
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
            if parts.uri.path() == "/api/slow" {
                tokio::time::sleep(Duration::from_secs(2)).await;
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
    (format!("http://{addr}"), log)
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
        "visionary@napkin\tLaurance\nengineer@napkin\tShrey\n",
    )
    .unwrap();
    napkin_web::tenant::Identity {
        mode: napkin_web::tenant::Mode::Accounts {
            provider: napkin_web::auth::Provider::Roster(
                napkin_web::auth::Roster::new(roster).unwrap(),
            ),
            sessions: napkin_web::auth::Sessions::new(&[9u8; 32]).unwrap(),
        },
        secure: false,
    }
}

/// Roster sign-in with the tool mounted in front of `relay_url`.
fn server(relay_url: Option<String>, timeout: Duration) -> Server {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Arc::new(AppCtx::new(
        dir.path().to_path_buf(),
        Arc::new(NoConfig),
        None,
        40,
    ));
    let tool = tool_build(dir.path());
    let shell = shell_build(dir.path());
    let production = relay_url.map(|url| {
        let config = Config::from_vars(true, Some(&url), Some(KEY), Some(tool.to_str().unwrap()))
            .unwrap()
            .unwrap();
        Arc::new(Relay::with_timeout(config, timeout))
    });
    let app = napkin_web::router_full(
        ctx,
        Some(&shell),
        Arc::new(identity(dir.path())),
        production,
    );
    Server { _dir: dir, app }
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

/// The relay's side: check the signature and return the claims.
fn verify(assertion: &str) -> Value {
    let (head, sig) = assertion.rsplit_once('.').unwrap();
    let mut mac = Hmac::<Sha256>::new_from_slice(KEY.as_bytes()).unwrap();
    mac.update(head.as_bytes());
    mac.verify_slice(&B64.decode(sig).unwrap())
        .expect("signed with the shared key");
    let claims = head.strip_prefix("v1.").unwrap();
    serde_json::from_slice(&B64.decode(claims).unwrap()).unwrap()
}

#[tokio::test]
async fn signed_out_the_proxy_answers_sign_in_and_never_calls_the_relay() {
    let (url, log) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    // /auth/* and /healthz pass the session layer signed out: the proxy
    // itself still refuses them.
    for path in [
        "/production/api/me",
        "/production/api/auth/x",
        "/production/api/healthz",
    ] {
        let r = send(&s, get(path, None)).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(r.json()["signin"], true, "{path}");
        assert_eq!(r.json()["password"], false, "{path}");
    }
    let r = send(
        &s,
        Request::builder()
            .method("POST")
            .uri("/production/api/auth/sign-in")
            .body(Body::from("{}"))
            .unwrap(),
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert!(log.lock().unwrap().is_empty(), "the relay was called");
}

#[tokio::test]
async fn signed_in_a_call_reaches_the_relay_with_a_valid_assertion_and_nothing_else() {
    let (url, log) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let cookie = sign_in(&s, "visionary@napkin").await;
    let body = b"PK\x03\x04 a project".to_vec();
    let req = Request::builder()
        .method("POST")
        .uri("/production/api/clan?reason=manual&x=%2F")
        .header(header::HOST, "studio.test")
        .header(header::ORIGIN, "https://studio.test")
        .header(header::COOKIE, format!("{cookie}; other=1"))
        .header(header::AUTHORIZATION, "Bearer secret")
        .header(header::CONTENT_TYPE, "application/vnd.clan+zip")
        .header(header::IF_MATCH, "\"etag1\"")
        .header("x-clan-reason", "manual")
        .header("x-project-id", "prj_01J00000000000000000000000")
        .header("x-project-name", "Lumen%20Water")
        .header("x-napkin-identity", "v1.forged.sig")
        .header("x-forwarded-for", "1.2.3.4")
        .header(header::CONNECTION, "keep-alive")
        .header("te", "trailers")
        .header("x-other", "no")
        .body(Body::from(body.clone()))
        .unwrap();
    let r = send(&s, req).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.text());
    assert_eq!(r.text(), "relay-bytes");
    // what the tool reads comes back, and nothing else the relay set
    assert_eq!(r.headers[header::ETAG], "\"abc\"");
    assert_eq!(r.headers["x-saved-at"], "2026-10-13T00:00:00Z");
    assert_eq!(r.headers[header::CONTENT_TYPE], "application/vnd.clan+zip");
    assert_eq!(r.headers[header::CACHE_CONTROL], "no-store");
    assert!(r.headers.get(header::SET_COOKIE).is_none());
    assert!(r.headers.get("x-relay-internal").is_none());

    let seen = log.lock().unwrap().clone();
    assert_eq!(seen.len(), 1);
    let call = &seen[0];
    assert_eq!(call.method, "POST");
    assert_eq!(call.path_and_query, "/api/clan?reason=manual&x=%2F");
    assert_eq!(call.body.as_ref(), body.as_slice());
    assert!(
        call.headers.get(header::COOKIE).is_none(),
        "the cookie leaked"
    );
    assert!(call.headers.get(header::AUTHORIZATION).is_none());
    for name in ["x-forwarded-for", "te", "x-other", "origin"] {
        assert!(call.headers.get(name).is_none(), "{name} was forwarded");
    }
    assert_eq!(call.headers["content-type"], "application/vnd.clan+zip");
    assert_eq!(call.headers["if-match"], "\"etag1\"");
    assert_eq!(call.headers["x-clan-reason"], "manual");
    assert_eq!(
        call.headers["x-project-id"],
        "prj_01J00000000000000000000000"
    );
    assert_eq!(call.headers["x-project-name"], "Lumen%20Water");
    // one identity header: ours, not the forged one
    let ids: Vec<_> = call.headers.get_all("x-napkin-identity").iter().collect();
    assert_eq!(ids.len(), 1);
    let claims = verify(ids[0].to_str().unwrap());
    assert_eq!(claims["u"], "visionary@napkin");
    assert_eq!(claims["a"], "napkin");
    assert_eq!(
        claims["t"],
        napkin_web::tenant::TenantId::of_agency("napkin").to_string()
    );
    assert_eq!(claims["n"], "Laurance");
    assert_eq!(claims["aud"], "relay");
    assert_eq!(claims["m"], "POST");
    assert_eq!(claims["p"], call.path_and_query.as_str());
    // the body hash covers exactly the bytes the relay received
    assert_eq!(claims["bh"], body_hash(&call.body));
    assert_eq!(
        claims["exp"].as_u64().unwrap() - claims["iat"].as_u64().unwrap(),
        60
    );
}

#[tokio::test]
async fn a_get_without_a_query_names_the_bare_path() {
    let (url, log) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let cookie = sign_in(&s, "engineer@napkin").await;
    let r = send(&s, get("/production/api/me", Some(&cookie))).await;
    assert_eq!(r.status, StatusCode::CREATED);
    let seen = log.lock().unwrap().clone();
    let claims = verify(seen[0].headers["x-napkin-identity"].to_str().unwrap());
    assert_eq!(seen[0].path_and_query, "/api/me");
    assert_eq!(claims["p"], "/api/me");
    assert_eq!(claims["m"], "GET");
    assert_eq!(claims["bh"], body_hash(b""));
    assert_eq!(claims["u"], "engineer@napkin");
}

#[tokio::test]
async fn a_body_over_four_and_a_half_megabytes_is_refused_in_the_relay_shape() {
    let (url, log) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let cookie = sign_in(&s, "visionary@napkin").await;
    let post = |n: usize| {
        Request::builder()
            .method("POST")
            .uri("/production/api/clan")
            .header(header::COOKIE, &cookie)
            .body(Body::from(vec![b'x'; n]))
            .unwrap()
    };
    let r = send(&s, post(BODY_MAX)).await;
    assert_eq!(r.status, StatusCode::CREATED, "4.5 MB exactly passes");
    let r = send(&s, post(BODY_MAX + 1)).await;
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
    // Test adaptation: the proxy's 65 s timeout is set to 1 s here, and the
    // stub sleeps 2 s, instead of a 70 s sleep against 65 s.
    let s = server(Some(dead_relay().await), Duration::from_secs(1));
    let cookie = sign_in(&s, "visionary@napkin").await;
    let r = send(&s, get("/production/api/me", Some(&cookie))).await;
    assert_eq!(r.status, StatusCode::BAD_GATEWAY);
    assert_eq!(r.json()["error"]["code"], "provider_unavailable");
    assert_eq!(r.json()["error"]["retryable"], true);

    let (url, _log) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(1));
    let cookie = sign_in(&s, "visionary@napkin").await;
    let r = send(&s, get("/production/api/slow", Some(&cookie))).await;
    assert_eq!(r.status, StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(r.json()["error"]["code"], "timeout");
    assert_eq!(r.json()["error"]["retryable"], true);
}

#[tokio::test]
async fn a_write_from_another_site_is_refused() {
    let (url, log) = stub_relay().await;
    let s = server(Some(url), Duration::from_secs(5));
    let cookie = sign_in(&s, "visionary@napkin").await;
    let r = send(
        &s,
        Request::builder()
            .method("POST")
            .uri("/production/api/jobs")
            .header(header::HOST, "studio.test")
            .header(header::ORIGIN, "https://evil.example")
            .header(header::COOKIE, &cookie)
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
            .uri("/production/api/me")
            .header(header::HOST, "studio.test")
            .header(header::ORIGIN, "https://evil.example")
            .header(header::COOKIE, &cookie)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED);
}

#[tokio::test]
async fn the_tool_is_served_with_its_own_index_for_its_routes() {
    let (url, _log) = stub_relay().await;
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
    let (url, _log) = stub_relay().await;
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
    let (url, log) = stub_relay().await;
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
        static_dir: tool_build(dir.path()),
    };
    let app = napkin_web::router_full(
        ctx,
        Some(&shell),
        Arc::new(napkin_web::tenant::Identity::anonymous(false)),
        Some(Arc::new(Relay::new(config))),
    );
    let s = Server { _dir: dir, app };
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
