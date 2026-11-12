// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The rig and the seed shared by the search tests: a roster server, documents of every kind with every
//! field set, and a search call.
#![allow(dead_code)]

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use clan_sdk::{AppInfo, ClanBuilder, ClanFile, ClientRef, FileEntry};
use http_body_util::BodyExt;
use napkin_host::jobs::{self, NewJob};
use napkin_host::{clients, Actor, Change, Ctx, NoConfig, PartStore};
use napkin_web::state::AppCtx;
use napkin_web::store::{doc_id, TenantStore};
use napkin_web::tenant::TenantId;
use serde_json::{json, Value};
use tower::ServiceExt;

// ── the rig ──────────────────────────────────────────────────────────────────

/// Every role of the nine homes, then an admin. `wk` has no directory, so these are its roster's roles.
pub const ROLES: [&str; 10] = [
    "planning",
    "creative-director",
    "account-service",
    "management",
    "art-director",
    "copywriter",
    "producer",
    "agency-brain",
    "traffic",
    "admin",
];

pub fn roster() -> String {
    let mut s = String::new();
    for r in ROLES {
        s.push_str(&format!("{r}@wk\t{r}\t{r}\n"));
        s.push_str(&format!("{r}@cr\t{r}\t{r}\n"));
    }
    s.push_str("sam@wk\tSam\t\n");
    s.push_str("kai@bq\tKai\tmanagement\n");
    s.push_str("cara@cr\tCara\tadmin\n");
    s
}

pub struct Rig {
    pub dir: tempfile::TempDir,
    pub app: Router,
}

pub struct Who {
    pub cookie: String,
    pub tenant: String,
}

pub fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Arc::new(AppCtx::new(
        dir.path().to_path_buf(),
        Arc::new(NoConfig),
        None,
        40,
    ));
    let file = dir.path().join("accounts.tsv");
    std::fs::write(&file, roster()).unwrap();
    let identity = napkin_web::tenant::Identity {
        mode: napkin_web::tenant::Mode::Accounts {
            provider: napkin_web::auth::Provider::Roster(
                napkin_web::auth::Roster::new(file).unwrap(),
            ),
            sessions: napkin_web::auth::Sessions::new(&[9u8; 32]).unwrap(),
        },
        secure: false,
    };
    Rig {
        app: napkin_web::router_with(ctx, None, Arc::new(identity)),
        dir,
    }
}

pub async fn call(
    r: &Rig,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value, String, axum::http::HeaderMap) {
    let mut b = Request::builder().method(method).uri(uri);
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, c);
    }
    let req = match body {
        Some(v) => b
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(v.to_string())),
        None => b.body(Body::empty()),
    }
    .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    let (status, headers) = (resp.status(), resp.headers().clone());
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).to_string();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        text,
        headers,
    )
}

pub async fn sign_in(r: &Rig, who: &str) -> Who {
    let (st, body, _, h) = call(
        r,
        "POST",
        "/api/auth/sign-in",
        None,
        Some(json!({ "username": who })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{who}: {body}");
    let cookie = h
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("napkin_session=") && !v.starts_with("napkin_session=;"))
        .map(|v| v.split(';').next().unwrap().to_string())
        .unwrap();
    let (_, me, _, _) = call(r, "GET", "/api/session", Some(&cookie), None).await;
    Who {
        cookie,
        tenant: me["tenant"].as_str().unwrap().to_string(),
    }
}

/// The ids a search answers, in order, and its total.
pub async fn search(r: &Rig, p: &Who, q: &str) -> (StatusCode, Vec<String>, usize, Value) {
    let (st, v, _, _) = call(
        r,
        "GET",
        &format!(
            "/api/t/{}/search?q={}&limit=50",
            p.tenant,
            q.replace(' ', "%20")
        ),
        Some(&p.cookie),
        None,
    )
    .await;
    let ids = v["groups"]
        .as_array()
        .map(|g| {
            g.iter()
                .flat_map(|g| g["items"].as_array().unwrap().iter())
                .map(|i| i["id"].as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default();
    (st, ids, v["total"].as_u64().unwrap_or(0) as usize, v)
}

// ── the documents ────────────────────────────────────────────────────────────

pub struct Doc<'a> {
    pub slug: &'a str,
    pub title: &'a str,
    pub app_id: &'a str,
    pub app_name: &'a str,
    pub document_type: Option<&'a str>,
    pub client: &'a str,
    pub job: Option<&'a str>,
    pub updated: &'a str,
    pub editors: &'a [&'a str],
    pub assets: &'a [(&'a str, &'a str)],
    pub data: &'a str,
}

pub fn bytes(d: &Doc) -> Vec<u8> {
    let base = ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: d.title.into(),
            brief: "a document".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut m = base.manifest().clone();
    m.document_type = d.document_type.map(str::to_string);
    m.updated_at = d.updated.into();
    m.app = Some(AppInfo {
        home: None,
        name: d.app_name.into(),
        app_id: d.app_id.into(),
        version: "1.0.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach: None,
    });
    m.client = Some(ClientRef {
        id: d.client.into(),
        name: "Alpha Client".into(),
    });
    m.job = d.job.map(str::to_string);
    for (name, ty) in d.assets {
        m.files.push(FileEntry {
            id: format!("asset-{name}"),
            path: format!("human/assets/{name}"),
            role: "asset".into(),
            content_type: (*ty).into(),
            priority: None,
            sha256: None,
        });
    }
    let mut b = ClanBuilder::new(m);
    for (path, bytes) in base.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH {
            b.add_entry(path, bytes);
        }
    }
    for (name, _) in d.assets {
        b.add_entry(format!("human/assets/{name}"), b"MARKERASSETBYTES".to_vec());
    }
    let mut chain = String::from("decisions:\n");
    for (i, who) in d.editors.iter().enumerate() {
        chain.push_str(&format!(
            "  - id: d_01SEARCH{i:04}\n    kind: edit\n    agent: human\n    actor: human:{who}\n    action: edit the document\n    rationale: MARKERRATIONALE\n    timestamp: 2026-03-0{}T10:00:00Z\n",
            i + 1
        ));
    }
    if d.editors.is_empty() {
        chain = "decisions: []\n".into();
    }
    b.add_entry("agent/decision-chain.yaml", chain.into_bytes());
    b.add_entry("shared/data.yaml", d.data.as_bytes().to_vec());
    b.build().unwrap()
}

pub fn put(store: &TenantStore, d: &Doc) {
    store
        .apply(&Change::create(doc_id(d.slug), bytes(d)))
        .unwrap();
}

pub const MARKERS: [&str; 5] = [
    "MARKERBRIEFWORDS",
    "MARKERRATIONALE",
    "MARKERASSETBYTES",
    "7777.25",
    "MARKERBRAINPAGE",
];

/// One entry of every kind, each with every field set, in the tenant at `dir`. The word "alpha" is in
/// every title, so one query reaches all of them.
pub fn seed(dir: &std::path::Path, agency: &str) -> String {
    let store = TenantStore::new(dir.join(TenantId::of_agency(agency).as_str()));
    let me = Ctx::new(Actor::human(&format!("admin@{agency}")).unwrap());
    let client = clients::create_client(&store, &me, "Alpha Client", None).unwrap();
    jobs::create_job(
        &store,
        &me,
        NewJob {
            number: Some("J001".into()),
            client_id: client.id.clone(),
            title: Some("Alpha launch".into()),
            owner: Some(format!("planning@{agency}")),
            opened_on: Some("2026-03-02".into()),
            due: Some("2026-12-01".into()),
            budget_hours: Some(7777.25),
        },
    )
    .unwrap();
    let c = client.id.as_str();
    let brief_data = "title: MARKERBRIEFWORDS the objective\nobjective: MARKERBRIEFWORDS\naudience: MARKERBRIEFWORDS\nbudget: MARKERBRIEFWORDS\n";
    let docs = [
        Doc { slug: "alpha-brief", title: "Alpha brief", app_id: "ie.napkin.brief-maker", app_name: "Brief Maker", document_type: None, client: c, job: Some("J001"), updated: "2026-03-14T10:00:00Z", editors: &[&format!("planning@{agency}")], assets: &[("logo-alpha.png", "image/png")], data: brief_data },
        Doc { slug: "alpha-radio", title: "Alpha radio script", app_id: "ie.napkin.script-editor", app_name: "Script editor", document_type: None, client: c, job: Some("J001"), updated: "2026-04-02T10:00:00Z", editors: &[&format!("copywriter@{agency}")], assets: &[], data: "script: MARKERBRIEFWORDS\n" },
        Doc { slug: "alpha-ideas", title: "Alpha idea room", app_id: "ie.napkin.idea-room", app_name: "Idea room", document_type: None, client: c, job: Some("J001"), updated: "2026-05-02T10:00:00Z", editors: &[&format!("creative-director@{agency}")], assets: &[], data: "cards: MARKERBRIEFWORDS\n" },
        Doc { slug: "alpha-research", title: "Alpha research", app_id: "ie.napkin.campaign-research", app_name: "Campaign Research", document_type: None, client: c, job: Some("J001"), updated: "2026-05-12T10:00:00Z", editors: &[&format!("planning@{agency}")], assets: &[], data: "findings: MARKERBRIEFWORDS\n" },
        Doc { slug: "alpha-scope", title: "Alpha scope", app_id: "ie.napkin.scope", app_name: "Scope", document_type: None, client: c, job: Some("J001"), updated: "2026-06-02T10:00:00Z", editors: &[&format!("account-service@{agency}")], assets: &[], data: "hours: MARKERBRIEFWORDS\n" },
        Doc { slug: "alpha-client-brain", title: "Alpha client brain", app_id: "ie.napkin.agency-brain", app_name: "Napkin Brain", document_type: None, client: c, job: None, updated: "2026-06-12T10:00:00Z", editors: &[], assets: &[], data: "vault:\n  kind: client\n  client: Alpha Client\npages:\n  a/b:\n    title: MARKERBRAINPAGE\n" },
        Doc { slug: "alpha-agency-brain", title: "Alpha agency brain", app_id: "ie.napkin.agency-brain", app_name: "Napkin Brain", document_type: None, client: c, job: None, updated: "2026-06-22T10:00:00Z", editors: &[], assets: &[], data: "vault:\n  kind: agency\n  client: null\npages:\n  a/b:\n    title: MARKERBRAINPAGE\n" },
    ];
    for d in &docs {
        put(&store, d);
    }
    client.id
}
