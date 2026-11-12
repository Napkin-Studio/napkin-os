// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The request log holds no secret a path carries: the token of a client's link (`/c/{token}`, its page and
//! its calls) and of a document's session (`/s/{token}/…`) is logged as `{token}`, and a query string is never
//! logged (features/one-bar-search.clan found the whole URI in the span). Alone in its own test binary, so no
//! other test's tracing callsites decide what this one's subscriber hears.

use std::io::Write;
use std::sync::{Arc, Mutex};

mod search_support;
use search_support::*;

#[derive(Clone)]
struct Sink(Arc<Mutex<Vec<u8>>>);

impl Write for Sink {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn a_token_in_the_path_and_a_query_never_reach_the_log() {
    let log = Sink(Arc::new(Mutex::new(Vec::new())));
    let sink = log.clone();
    let _guard = tracing::subscriber::set_default(
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_ansi(false)
            .with_writer(move || sink.clone())
            .finish(),
    );
    let r = rig();
    for (method, uri) in [
        ("GET", "/c/LINKTOKENQX1"),
        ("GET", "/c/LINKTOKENQX2/view"),
        ("GET", "/c/LINKTOKENQX3/piece/2"),
        ("POST", "/c/LINKTOKENQX4/comment"),
        ("GET", "/s/SESSIONTOKENQX5/chain"),
        ("POST", "/s/SESSIONTOKENQX6/patch-data"),
        ("GET", "/s/SESSIONTOKENQX7"),
        ("GET", "/api/healthz?q=QUERYWORDQX8"),
    ] {
        call(&r, method, uri, None, None).await;
    }
    let text = String::from_utf8(log.0.lock().unwrap().clone()).unwrap();
    for route in [
        "/c/{token}",
        "/c/{token}/view",
        "/c/{token}/piece/2",
        "/s/{token}/chain",
        "/api/healthz",
    ] {
        assert!(text.contains(route), "{route} is logged: {text}");
    }
    for secret in ["TOKENQX", "QUERYWORDQX8"] {
        assert!(!text.contains(secret), "the log holds {secret}: {text}");
    }
}

#[test]
fn logged_path_keeps_the_route_and_drops_the_token() {
    use napkin_web::logged_path;
    assert_eq!(logged_path("/c/abc"), "/c/{token}");
    assert_eq!(logged_path("/c/abc/view"), "/c/{token}/view");
    assert_eq!(logged_path("/s/abc/a/b"), "/s/{token}/a/b");
    assert_eq!(logged_path("/api/t/x/search"), "/api/t/x/search");
    assert_eq!(logged_path("/"), "/");
}
