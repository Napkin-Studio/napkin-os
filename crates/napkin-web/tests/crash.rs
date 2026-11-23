// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! S0-8, live half: a save answered 200 survives `kill -9` of the real
//! napkin-web binary. The server runs on lane A's port (20410) with its data
//! under this worktree's target/, and is always stopped.

mod support;

use std::process::{Child, Command, Stdio};
use std::time::Duration;

use support::big_doc::{self, PRODUCTION};

const PORT: u16 = 20410;

struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn start(data: &std::path::Path, seed: &std::path::Path) -> Server {
    let child = Command::new(env!("CARGO_BIN_EXE_napkin-web"))
        .env("NAPKIN_WEB_ADDR", format!("127.0.0.1:{PORT}"))
        .env("NAPKIN_WEB_DATA", data)
        .env("NAPKIN_WEB_SEED", seed)
        .env_remove("PORT")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let server = Server(child);
    let http = reqwest::Client::new();
    for _ in 0..100 {
        if http
            .get(format!("http://127.0.0.1:{PORT}/api/healthz"))
            .send()
            .await
            .is_ok()
        {
            return server;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("napkin-web did not start");
}

#[tokio::test]
async fn s0_8_an_answered_save_survives_kill_9() {
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/crash-test");
    let _ = std::fs::remove_dir_all(&base);
    let (data, seed) = (base.join("data"), base.join("seed"));
    std::fs::create_dir_all(&seed).unwrap();
    std::fs::write(
        seed.join("p.app.clan"),
        big_doc::template(PRODUCTION, "Production"),
    )
    .unwrap();

    let http = reqwest::Client::new();
    let url = |p: &str| format!("http://127.0.0.1:{PORT}{p}");
    let mut server = start(&data, &seed).await;

    // anonymous mode: the first visit mints the session (and the tenant)
    let r = http.get(url("/api/session")).send().await.unwrap();
    let cookie = r
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let tenant = r.json::<serde_json::Value>().await.unwrap()["tenant"]
        .as_str()
        .unwrap()
        .to_string();
    let made: serde_json::Value = http
        .post(url(&format!("/api/t/{tenant}/documents")))
        .header("cookie", &cookie)
        .json(&serde_json::json!({ "app_id": PRODUCTION, "title": "Crash" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let doc = made["path"].as_str().unwrap().to_string();

    let dl = |cookie: String| {
        let (http, u) = (
            http.clone(),
            url(&format!("/api/t/{tenant}/d/{doc}/download")),
        );
        async move {
            let r = http.get(u).header("cookie", cookie).send().await.unwrap();
            assert_eq!(r.status(), 200);
            let etag = r.headers()["etag"].to_str().unwrap().to_string();
            (r.bytes().await.unwrap().to_vec(), etag)
        }
    };
    let (mut bytes, mut etag) = dl(cookie.clone()).await;
    for i in 0..5 {
        bytes = big_doc::with_entry(&bytes, "shared/data.yaml", format!("n: {i}\n").into_bytes());
        let r = http
            .put(url(&format!("/api/t/{tenant}/d/{doc}/save")))
            .header("cookie", &cookie)
            .header("if-match", &etag)
            .body(bytes.clone())
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200, "{}", r.text().await.unwrap());
        // killed the instant the 200 is in hand
        server.0.kill().unwrap();
        server.0.wait().unwrap();
        server = start(&data, &seed).await;
        let (got, tag) = dl(cookie.clone()).await;
        assert!(got == bytes, "save {i} was lost across kill -9");
        etag = tag;
    }
    drop(server);
    let _ = std::fs::remove_dir_all(&base);
}
