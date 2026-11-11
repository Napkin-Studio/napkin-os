// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! ADR-004 (features/client-wall.clan), pilot test 8: a key the server holds
//! never reaches the browser. A canary is set as the middleware's key and in
//! every environment variable a server key lives in; the shell's API, the
//! sandbox and the static shell are driven, and the canary is in no response
//! (body or header). The same test shows the key is live: the middleware saw it.
//! The bundle half is app/tests/canary.test.ts.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request};
use http_body_util::BodyExt;
use napkin_host::config::ProxyConfig;
use napkin_host::{HostConfig, WorkspaceConfig};
use napkin_web::state::AppCtx;
use tower::ServiceExt;

const CANARY: &str = "canary-key-7f3a9c1e5b2d4086-DO-NOT-LEAK";

struct Cfg(String);

impl HostConfig for Cfg {
    fn workspace(&self) -> Option<WorkspaceConfig> {
        let mut proxies = HashMap::new();
        proxies.insert(
            "middleware".to_string(),
            ProxyConfig {
                endpoint: self.0.clone(),
                auth_kind: None,
                secret_ref: Some("middleware-key".into()),
            },
        );
        Some(WorkspaceConfig {
            proxies,
            agent_url: None,
        })
    }
    fn secret(&self, name: &str) -> Option<String> {
        (name == "middleware-key").then(|| CANARY.to_string())
    }
}

#[tokio::test]
async fn a_canary_key_set_on_the_server_is_in_no_response_the_browser_gets() {
    for k in [
        "NAPKIN_MODEL_API_KEY",
        "NAPKIN_TAVILY_API_KEY",
        "NAPKIN_JEV_API_KEY",
        "NAPKIN_TOKEN",
        "NAPKIN_SESSION_SECRET",
        "ANTHROPIC_API_KEY",
    ] {
        std::env::set_var(k, CANARY);
    }

    // A middleware that records the head of the one request it gets.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1/tasks", listener.local_addr().unwrap());
    let upstream = std::thread::spawn(move || {
        let (mut s, _) = listener.accept().unwrap();
        let mut buf = vec![0u8; 65536];
        let n = s.read(&mut buf).unwrap();
        let reply = r#"{"error":{"type":"invalid_input","message":"nothing to do here"}}"#;
        let _ = s.write_all(
            format!(
                "HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                reply.len()
            )
            .as_bytes(),
        );
        String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase()
    });

    let dir = tempfile::tempdir().unwrap();
    let shell = tempfile::tempdir().unwrap();
    std::fs::write(
        shell.path().join("index.html"),
        "<!doctype html><title>shell</title>",
    )
    .unwrap();
    let ctx = Arc::new(AppCtx::new(
        dir.path().to_path_buf(),
        Arc::new(Cfg(url)),
        None,
        40,
    ));
    let app = napkin_web::router(ctx, Some(shell.path()), false);

    let mut seen: Vec<(String, String)> = Vec::new();
    let call = |method: &'static str, uri: String, cookie: Option<String>, body: Vec<u8>| {
        let app = app.clone();
        async move {
            let mut b = Request::builder().method(method).uri(&uri);
            if let Some(c) = &cookie {
                b = b.header(header::COOKIE, c.as_str());
            }
            let resp = app
                .oneshot(b.body(Body::from(body)).unwrap())
                .await
                .unwrap();
            let heads = format!("{:?}", resp.headers());
            let status = resp.status();
            let text =
                String::from_utf8_lossy(&resp.into_body().collect().await.unwrap().to_bytes())
                    .to_string();
            (uri, status, heads, text)
        }
    };

    let mut record = |r: (String, axum::http::StatusCode, String, String)| {
        seen.push((r.0.clone(), format!("{}\n{}", r.2, r.3)));
        r
    };

    let (_, _, heads, text) = record(call("GET", "/api/session".into(), None, vec![]).await);
    let cookie = heads
        .split("set-cookie")
        .nth(1)
        .map(|s| {
            s.trim_start_matches(['"', ':', ' '])
                .split(';')
                .next()
                .unwrap()
                .to_string()
        })
        .expect("a session cookie");
    let tenant = serde_json::from_str::<serde_json::Value>(&text).unwrap()["tenant"]
        .as_str()
        .unwrap()
        .to_string();

    let clan = clan_sdk::create(clan_sdk::CreateOptions {
        title: "Canary".into(),
        brief: "test brief".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    let (_, st, _, text) = record(
        call(
            "POST",
            format!("/api/t/{tenant}/documents/upload"),
            Some(cookie.clone()),
            clan,
        )
        .await,
    );
    assert_eq!(st, 200, "{text}");
    let up: serde_json::Value = serde_json::from_str(&text).unwrap();
    let (token, path) = (
        up["token"].as_str().unwrap().to_string(),
        up["path"].as_str().unwrap().to_string(),
    );

    for uri in [
        "/healthz".to_string(),
        "/api/healthz".to_string(),
        "/".to_string(),
        "/view".to_string(),
        "/assets/app.js".to_string(),
        format!("/api/t/{tenant}/apps"),
        format!("/api/t/{tenant}/recent"),
        format!("/api/t/{tenant}/library"),
        format!("/api/t/{tenant}/home"),
        format!("/api/t/{tenant}/d/{path}"),
        format!("/s/{token}/chain"),
        format!("/s/{token}/document"),
        format!("/s/{token}/decisions"),
    ] {
        record(call("GET", uri, Some(cookie.clone()), vec![]).await);
    }

    // The app's own call to the middleware: the host adds the key on the way out.
    let body = br#"{"request_kind":"middleware","payload":{"task":"job_status","input":{"job_id":"job_1"}}}"#;
    let (_, st, _, text) =
        record(call("POST", format!("/s/{token}/api-proxy"), None, body.to_vec()).await);
    assert_eq!(st, 200);
    assert!(
        text.contains("nothing to do here"),
        "the middleware's reply came back: {text}"
    );

    let saw = upstream.join().unwrap();
    assert!(
        saw.contains(&format!("x-api-key: {}", CANARY.to_ascii_lowercase())),
        "the key is live: the middleware got it from the host: {saw}"
    );
    assert!(seen.len() > 10);
    for (uri, whole) in &seen {
        assert!(
            !whole.contains(CANARY),
            "the canary reached the browser through {uri}"
        );
    }
}
