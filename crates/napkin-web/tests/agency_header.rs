// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! ADR-004 (features/client-wall.clan): the middleware takes its scope from
//! the signed-in person's agency on every request. The host sends it in the
//! `x-napkin-agency` header, and only to the middleware.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;

use napkin_host::config::ProxyConfig;
use napkin_host::proxy::proxy_call;
use napkin_host::{HostConfig, WorkspaceConfig};

struct Cfg(String);

impl HostConfig for Cfg {
    fn workspace(&self) -> Option<WorkspaceConfig> {
        let mut proxies = HashMap::new();
        for kind in ["middleware", "agent"] {
            proxies.insert(
                kind.to_string(),
                ProxyConfig {
                    endpoint: self.0.clone(),
                    auth_kind: None,
                    secret_ref: None,
                },
            );
        }
        Some(WorkspaceConfig {
            proxies,
            agent_url: None,
        })
    }
    fn secret(&self, _: &str) -> Option<String> {
        None
    }
}

/// One request's raw head, as a server saw it.
fn serve_once() -> (String, std::thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1/tasks", listener.local_addr().unwrap());
    let t = std::thread::spawn(move || {
        let (mut s, _) = listener.accept().unwrap();
        let mut buf = vec![0u8; 8192];
        let n = s.read(&mut buf).unwrap();
        let _ = s.write_all(
            b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}",
        );
        String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase()
    });
    (url, t)
}

#[tokio::test]
async fn a_middleware_request_carries_the_signed_in_persons_agency() {
    let (url, seen) = serve_once();
    let body = serde_json::json!({"request_kind": "middleware", "payload": {}});
    proxy_call(&Cfg(url), "middleware", body, Some("javelin")).await;
    assert!(seen.join().unwrap().contains("x-napkin-agency: javelin"));
}

#[tokio::test]
async fn no_agency_no_header_and_no_other_kind_gets_one() {
    let (url, seen) = serve_once();
    let body = serde_json::json!({"request_kind": "middleware", "payload": {}});
    proxy_call(&Cfg(url), "middleware", body, None).await;
    assert!(!seen.join().unwrap().contains("x-napkin-agency"));

    // The agent endpoint is not the middleware: it never learns the agency.
    let (url, seen) = serve_once();
    proxy_call(&Cfg(url), "agent", serde_json::json!({}), Some("javelin")).await;
    assert!(!seen.join().unwrap().contains("x-napkin-agency"));
}
