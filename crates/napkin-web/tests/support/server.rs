// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! A real router on a real `TenantStore` in a temp directory, with sign-in by
//! roster: `visionary@napkin` (not an admin), `engineer@napkin` (admin) and
//! `planner@javelin` (another agency).
#![allow(dead_code)]

use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::{library, NoConfig};
use napkin_web::state::AppCtx;
use napkin_web::tenant::TenantId;
use serde_json::Value;
use tower::ServiceExt;

use super::big_doc;

pub const APPS: &[(&str, &str)] = &[
    ("ie.napkin.brief-maker", "Brief Maker"),
    ("ie.napkin.campaign-research", "Research"),
    ("ie.napkin.deck-maker", "Deck Maker"),
    ("ie.napkin.territories", "Territories"),
    (big_doc::PRODUCTION, "Production"),
];

pub struct Server {
    pub dir: tempfile::TempDir,
    pub ctx: Arc<AppCtx>,
    pub app: Router,
}

pub struct Person {
    pub cookie: String,
    pub tenant: TenantId,
}

pub struct Reply {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Bytes,
}

impl Reply {
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body)
            .unwrap_or_else(|e| panic!("JSON, got {:?}: {e}", String::from_utf8_lossy(&self.body)))
    }
    pub fn header(&self, name: &str) -> Option<String> {
        self.headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(String::from)
    }
}

pub fn server() -> Server {
    server_in(tempfile::tempdir().unwrap(), None)
}

/// `media_base` is what `NAPKIN_PRODUCTION_MEDIA_BASE` would have said.
pub fn server_in(dir: tempfile::TempDir, media_base: Option<&str>) -> Server {
    let seed = dir.path().join("seed");
    std::fs::create_dir_all(&seed).unwrap();
    for (i, (id, name)) in APPS.iter().enumerate() {
        std::fs::write(
            seed.join(format!("a{i}.app.clan")),
            big_doc::template(id, name),
        )
        .unwrap();
    }
    let ctx = Arc::new(
        AppCtx::new(dir.path().join("data"), Arc::new(NoConfig), None, 40)
            .with_seed(Some(seed))
            .with_media_base(media_base.map(String::from)),
    );
    let roster = dir.path().join("accounts.tsv");
    std::fs::write(
        &roster,
        "visionary@napkin\tLaurance\nplanner@javelin\tPia\nengineer@napkin\tEngineer\n",
    )
    .unwrap();
    let identity = napkin_web::tenant::Identity {
        mode: napkin_web::tenant::Mode::Accounts {
            provider: napkin_web::auth::Provider::Roster(
                napkin_web::auth::Roster::open(dir.path().join("_people"), &roster).unwrap(),
            ),
            sessions: napkin_web::auth::Sessions::new(&[9u8; 32]).unwrap(),
        },
        secure: false,
    };
    let app = napkin_web::router_full(ctx.clone(), None, Arc::new(identity), None);
    Server { dir, ctx, app }
}

pub async fn send(s: &Server, req: Request<Body>) -> Reply {
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

pub async fn sign_in(s: &Server, user: &str, agency: &str) -> Person {
    let r = send(
        s,
        Request::builder()
            .method("POST")
            .uri("/api/auth/sign-in")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({ "username": format!("{user}@{agency}") }).to_string(),
            ))
            .unwrap(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let cookie = r
        .headers
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("napkin_session="))
        .map(|v| v.split(';').next().unwrap().to_string())
        .unwrap();
    Person {
        cookie,
        tenant: TenantId::of_agency(agency),
    }
}

/// One call as `p` (or with no cookie when `p` is `None`) to `/api/t/<tenant><path>`.
pub async fn call(
    s: &Server,
    p: Option<&Person>,
    tenant: &TenantId,
    method: &str,
    path: &str,
    headers: &[(&str, String)],
    body: Vec<u8>,
) -> Reply {
    let mut b = Request::builder()
        .method(method)
        .uri(format!("/api/t/{tenant}{path}"))
        .header(header::HOST, "studio.test");
    if let Some(p) = p {
        b = b.header(header::COOKIE, &p.cookie);
    }
    for (k, v) in headers {
        b = b.header(*k, v);
    }
    send(s, b.body(Body::from(body)).unwrap()).await
}

impl Person {
    pub async fn get(&self, s: &Server, path: &str) -> Reply {
        call(s, Some(self), &self.tenant, "GET", path, &[], vec![]).await
    }
    pub async fn json(&self, s: &Server, method: &str, path: &str, body: Value) -> Reply {
        call(
            s,
            Some(self),
            &self.tenant,
            method,
            path,
            &[("content-type", "application/json".into())],
            body.to_string().into_bytes(),
        )
        .await
    }
    pub async fn save(
        &self,
        s: &Server,
        doc: &str,
        base: &str,
        bytes: &[u8],
        reason: Option<&str>,
    ) -> Reply {
        let mut h = vec![
            ("content-type", "application/vnd.clan+zip".to_string()),
            ("if-match", format!("\"{base}\"")),
        ];
        if let Some(r) = reason {
            h.push(("x-clan-reason", r.to_string()));
        }
        call(
            s,
            Some(self),
            &self.tenant,
            "PUT",
            &format!("/d/{doc}/save"),
            &h,
            bytes.to_vec(),
        )
        .await
    }
    /// The stored bytes and the ETag the download names.
    pub async fn download(&self, s: &Server, doc: &str) -> (Vec<u8>, Option<String>) {
        let r = self.get(s, &format!("/d/{doc}/download")).await;
        assert_eq!(r.status, StatusCode::OK);
        (r.body.to_vec(), r.header("etag"))
    }
}

/// A new instance of `app` in `p`'s library; returns its document id.
pub fn instance(s: &Server, p: &Person, app: &str, title: &str) -> String {
    let ws = s.ctx.workspace(&p.tenant);
    library::create_instance(&*ws.store, app, Some(title.into()))
        .unwrap()
        .to_string()
}

pub fn version_of(bytes: &[u8]) -> String {
    clan_sdk::hash::sha256_prefixed(bytes)
}
