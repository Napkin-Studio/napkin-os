// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The spin-off routes to and from Production (src/spinoff.rs,
//! features/production-spinoff.clan), against a stand-in relay that keeps
//! projects per workspace the way the real one does: by the tenant the signed
//! identity names. Every call it takes is checked for its signature.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::Request as AxumRequest;
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use clan_sdk::{ClanBuilder, ClanFile, SpinoffSpec};
use hmac::{Hmac, Mac};
use http_body_util::BodyExt;
use napkin_host::{library, NoConfig};
use napkin_web::production::{body_hash, Config, Relay};
use napkin_web::state::AppCtx;
use napkin_web::tenant::TenantId;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tower::ServiceExt;

const KEY: &str = "a-dev-identity-secret-of-32-bytes-or-more";
const BRIEF: &str = "ie.napkin.brief-maker";
const PRODUCTION: &str = "ie.napkin.production";
const DECK: &str = "ie.napkin.deck-maker";
const CHECKPOINT: &str = "human/assets/canvas.ybin.zst";

// ── The stand-in relay ───────────────────────────────────────────────────────

/// One saved project, as the relay holds it.
#[derive(Clone)]
struct Saved {
    bytes: Vec<u8>,
    etag: String,
}

#[derive(Default)]
struct RelayState {
    /// tenant -> project -> newest save. The real relay keeps them under `tenants/<t>/projects/`.
    projects: HashMap<String, HashMap<String, Saved>>,
    /// Every call: method, path, project header.
    calls: Vec<(String, String, Option<String>)>,
    /// A relay that forgot to check the tenant: it answers for any project of any workspace.
    leaky: bool,
}

type State = Arc<Mutex<RelayState>>;

fn claims_of(headers: &HeaderMap, method: &str, path: &str, body: &[u8]) -> Value {
    let assertion = headers
        .get("x-napkin-identity")
        .expect("every call carries the signed identity")
        .to_str()
        .unwrap();
    let (head, sig) = assertion.rsplit_once('.').unwrap();
    let mut mac = Hmac::<Sha256>::new_from_slice(KEY.as_bytes()).unwrap();
    mac.update(head.as_bytes());
    mac.verify_slice(&B64.decode(sig).unwrap())
        .expect("signed with the shared key");
    let c: Value =
        serde_json::from_slice(&B64.decode(head.strip_prefix("v1.").unwrap()).unwrap()).unwrap();
    assert_eq!(c["aud"], "relay");
    assert_eq!(c["m"], method);
    assert_eq!(c["p"], path);
    assert_eq!(c["bh"], body_hash(body));
    c
}

async fn relay() -> (String, State) {
    let state: State = Arc::default();
    let st = state.clone();
    let app = Router::new().fallback(move |req: AxumRequest| {
        let st = st.clone();
        async move {
            let (parts, body) = req.into_parts();
            let body = body.collect().await.unwrap().to_bytes();
            let path = parts.uri.path().to_string();
            let claims = claims_of(&parts.headers, parts.method.as_str(), &path, &body);
            let tenant = claims["t"].as_str().unwrap().to_string();
            let project = parts
                .headers
                .get("x-project-id")
                .map(|v| v.to_str().unwrap().to_string());
            let mut s = st.lock().unwrap();
            s.calls
                .push((parts.method.to_string(), path.clone(), project.clone()));
            let reply = |status: u16| {
                axum::response::Response::builder()
                    .status(status)
                    .body(Body::empty())
                    .unwrap()
            };
            if parts.method == "POST" && path == "/api/clan" {
                let project = project.expect("a saved project names its id");
                assert!(body.starts_with(b"PK\x03\x04"), "a .clan");
                let etag = format!("{:x}", Sha256::digest(&body));
                s.projects.entry(tenant).or_default().insert(
                    project,
                    Saved {
                        bytes: body.to_vec(),
                        etag: etag.clone(),
                    },
                );
                return axum::response::Response::builder()
                    .status(200)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({"project": {"etag": etag}}).to_string(),
                    ))
                    .unwrap();
            }
            if let Some(id) = path.strip_prefix("/api/clan/") {
                let found = if s.leaky {
                    s.projects.values().find_map(|m| m.get(id)).cloned()
                } else {
                    s.projects.get(&tenant).and_then(|m| m.get(id)).cloned()
                };
                return match found {
                    Some(p) => axum::response::Response::builder()
                        .status(200)
                        .header(header::CONTENT_TYPE, "application/vnd.clan+zip")
                        .header(header::ETAG, format!("\"{}\"", p.etag))
                        .body(Body::from(p.bytes))
                        .unwrap(),
                    None => reply(404),
                };
            }
            reply(404)
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), state)
}

// ── The server ───────────────────────────────────────────────────────────────

fn template(app_id: &str, name: &str, spinoff: Option<SpinoffSpec>) -> Vec<u8> {
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
            spinoff,
            attach: None,
        },
        clan_sdk::MakeTemplateOptions::default(),
    )
    .unwrap()
}

struct Server {
    _dir: tempfile::TempDir,
    ctx: Arc<AppCtx>,
    app: Router,
}

impl Server {
    fn _dir_path(&self) -> &std::path::Path {
        self._dir.path()
    }
}

fn server(relay_url: Option<String>) -> Server {
    server_with(relay_url, Arc::new(NoConfig))
}

fn server_with(relay_url: Option<String>, config: Arc<dyn napkin_host::HostConfig>) -> Server {
    let dir = tempfile::tempdir().unwrap();
    let seed = dir.path().join("seed");
    std::fs::create_dir_all(&seed).unwrap();
    let upstream = |from: &str| SpinoffSpec {
        accepts: vec![from.into()],
        upstream: true,
        ..Default::default()
    };
    std::fs::write(
        seed.join("brief.app.clan"),
        template(BRIEF, "Brief Maker", None),
    )
    .unwrap();
    std::fs::write(
        seed.join("production.app.clan"),
        template(PRODUCTION, "Production", Some(upstream(BRIEF))),
    )
    .unwrap();
    std::fs::write(
        seed.join("deck.app.clan"),
        template(DECK, "Deck Maker", Some(upstream(PRODUCTION))),
    )
    .unwrap();
    let ctx =
        Arc::new(AppCtx::new(dir.path().join("data"), config, None, 40).with_seed(Some(seed)));
    let tool = dir.path().join("production");
    std::fs::create_dir_all(&tool).unwrap();
    std::fs::write(tool.join("index.html"), "<!doctype html>").unwrap();
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
    let production = relay_url.map(|url| {
        let config = Config::from_vars(true, Some(&url), Some(KEY), Some(tool.to_str().unwrap()))
            .unwrap()
            .unwrap();
        Arc::new(Relay::with_timeout(config, Duration::from_secs(5)))
    });
    let app = napkin_web::router_full(ctx.clone(), None, Arc::new(identity), production);
    Server {
        _dir: dir,
        ctx,
        app,
    }
}

struct Reply {
    status: StatusCode,
    body: Bytes,
    headers: HeaderMap,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| {
            panic!(
                "JSON expected, got {:?}: {e}",
                String::from_utf8_lossy(&self.body)
            )
        })
    }
}

async fn send(s: &Server, req: Request<Body>) -> Reply {
    let resp = s.app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        body,
        headers,
    }
}

/// A signed-in person: the cookie, and the workspace their agency is.
struct Person {
    cookie: String,
    tenant: TenantId,
}

async fn sign_in(s: &Server, user: &str, agency: &str) -> Person {
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

async fn post_json(s: &Server, p: &Person, path: &str, body: Value) -> Reply {
    send(
        s,
        Request::builder()
            .method("POST")
            .uri(format!("/api/t/{}{path}", p.tenant))
            .header(header::HOST, "studio.test")
            .header(header::COOKIE, &p.cookie)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
}

async fn get(s: &Server, p: &Person, path: &str) -> Reply {
    send(
        s,
        Request::builder()
            .uri(format!("/api/t/{}{path}", p.tenant))
            .header(header::HOST, "studio.test")
            .header(header::COOKIE, &p.cookie)
            .body(Body::empty())
            .unwrap(),
    )
    .await
}

/// How many documents of `app` the person's library holds.
async fn documents_of(s: &Server, p: &Person, app: &str) -> usize {
    let v = get(s, p, "/library").await.json();
    v["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| i["app_id"] == app)
        .count()
}

/// A brief in the library of `p`'s workspace, with some data. Returns its library id.
fn a_brief(s: &Server, p: &Person, title: &str) -> String {
    let ws = s.ctx.workspace(&p.tenant);
    library::create_instance(&*ws.store, BRIEF, Some(title.into()))
        .unwrap()
        .to_string()
}

fn clan_of(bytes: &[u8]) -> ClanFile {
    ClanFile::from_bytes(bytes.to_vec()).unwrap()
}

fn yaml(clan: &ClanFile, path: &str) -> serde_yaml::Value {
    serde_yaml::from_slice(&clan.read_entry(path).unwrap()).unwrap()
}

/// What the project would be in the relay when the tool had saved it: the spun-off
/// document, with a canvas checkpoint and a picture added, the way the tool leaves it.
fn with_checkpoint(bytes: &[u8]) -> Vec<u8> {
    let clan = clan_of(bytes);
    let mut b = ClanBuilder::new(clan.manifest().clone());
    for (path, entry) in clan.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH {
            b.add_entry(path, entry);
        }
    }
    b.add_entry(CHECKPOINT, vec![7u8; 4096]);
    b.build().unwrap()
}

// ── Brief to Production ──────────────────────────────────────────────────────

#[tokio::test]
async fn a_brief_continues_in_production_as_one_relay_project_and_no_document() {
    let (url, rs) = relay().await;
    let s = server(Some(url));
    let me = sign_in(&s, "visionary", "napkin").await;
    let brief = a_brief(&s, &me, "Lumen Water");
    let in_library_before = get(&s, &me, "/library").await.json()["items"]
        .as_array()
        .unwrap()
        .len();

    let r = post_json(
        &s,
        &me,
        "/spinoff/production",
        serde_json::json!({ "doc": brief }),
    )
    .await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    let v = r.json();
    let project = v["project"].as_str().unwrap();
    // the id is one the relay accepts, and the answer says where the tool opens it
    assert!(regex_like_project_id(project), "{project}");
    assert_eq!(v["path"], format!("/production/p/{project}"));

    // exactly one write to the relay, under that id, and nothing else
    {
        let st = rs.lock().unwrap();
        assert_eq!(
            st.calls,
            vec![(
                "POST".to_string(),
                "/api/clan".to_string(),
                Some(project.to_string())
            )]
        );
        let saved = &st.projects[me.tenant.as_str()][project];
        let clan = clan_of(&saved.bytes);
        // the brief, whole, and where it came from
        let carried = clan.manifest().carried().expect("lineage.carried");
        let brief_doc = clan_of(
            &s.ctx
                .workspace(&me.tenant)
                .store
                .read(&napkin_host::DocId::new(brief.clone()))
                .unwrap(),
        );
        assert_eq!(carried.document_id, brief_doc.manifest().document_id());
        assert!(yaml(&clan, "shared/data.yaml")["upstream"][&carried.document_id].is_mapping());
        assert_eq!(
            clan.manifest().lineage.as_ref().unwrap().parent_uri,
            format!("clan-store:{brief}")
        );
        assert_eq!(clan.manifest().app.as_ref().unwrap().app_id, PRODUCTION);
        // stamped with the workspace it was made in
        let chain = yaml(&clan, "agent/decision-chain.yaml");
        assert_eq!(
            chain["decisions"][0]["scope"]["org"],
            me.tenant.as_str(),
            "the spin-off's own entry names the workspace"
        );
    }

    // no Production document was written to the library
    assert_eq!(documents_of(&s, &me, PRODUCTION).await, 0);
    let after = get(&s, &me, "/library").await.json()["items"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(after, in_library_before);
}

fn regex_like_project_id(s: &str) -> bool {
    s.len() == 30
        && s.starts_with("prj_")
        && s[4..]
            .bytes()
            .all(|b| b"0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(&b))
}

#[tokio::test]
async fn the_generic_route_never_writes_a_production_document_to_the_library() {
    let (url, _rs) = relay().await;
    let s = server(Some(url));
    let me = sign_in(&s, "visionary", "napkin").await;
    let brief = a_brief(&s, &me, "Lumen Water");
    let r = post_json(
        &s,
        &me,
        &format!("/d/{brief}/spinoff"),
        serde_json::json!({ "app_id": PRODUCTION }),
    )
    .await;
    assert_eq!(r.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(documents_of(&s, &me, PRODUCTION).await, 0);
}

#[tokio::test]
async fn a_brief_of_another_workspace_is_not_continued() {
    let (url, rs) = relay().await;
    let s = server(Some(url));
    let me = sign_in(&s, "visionary", "napkin").await;
    let them = sign_in(&s, "planner", "javelin").await;
    let theirs = a_brief(&s, &them, "Theirs");
    // not in my library at all: 404, and nothing reaches the relay
    let r = post_json(
        &s,
        &me,
        "/spinoff/production",
        serde_json::json!({ "doc": theirs }),
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert!(rs.lock().unwrap().calls.is_empty());
}

#[tokio::test]
async fn without_a_relay_there_is_no_bridge() {
    let s = server(None);
    let me = sign_in(&s, "visionary", "napkin").await;
    let brief = a_brief(&s, &me, "Lumen Water");
    let r = post_json(
        &s,
        &me,
        "/spinoff/production",
        serde_json::json!({ "doc": brief }),
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
}

// ── Production to an app ─────────────────────────────────────────────────────

/// A project the tool saved: a brief continued in Production, then given its canvas checkpoint.
async fn a_saved_project(s: &Server, rs: &State, p: &Person) -> (String, String) {
    let brief = a_brief(s, p, "Lumen Water");
    let made = post_json(
        s,
        p,
        "/spinoff/production",
        serde_json::json!({ "doc": brief }),
    )
    .await;
    assert_eq!(made.status, StatusCode::OK);
    let project = made.json()["project"].as_str().unwrap().to_string();
    let mut st = rs.lock().unwrap();
    let saved = st
        .projects
        .get_mut(p.tenant.as_str())
        .unwrap()
        .get_mut(&project)
        .unwrap();
    saved.bytes = with_checkpoint(&saved.bytes);
    saved.etag = format!("{:x}", Sha256::digest(&saved.bytes));
    let etag = saved.etag.clone();
    st.calls.clear();
    (project, etag)
}

#[tokio::test]
async fn a_project_continues_in_a_deck_without_its_canvas_and_names_its_source() {
    let (url, rs) = relay().await;
    let s = server(Some(url));
    let me = sign_in(&s, "visionary", "napkin").await;
    let (project, etag) = a_saved_project(&s, &rs, &me).await;
    let source = clan_of(&rs.lock().unwrap().projects[me.tenant.as_str()][&project].bytes);
    assert!(
        source.has_entry(CHECKPOINT),
        "the project in the relay holds its canvas"
    );

    let r = post_json(
        &s,
        &me,
        &format!("/production/{project}/spinoff"),
        serde_json::json!({ "target_app_id": DECK, "title": "Lumen deck" }),
    )
    .await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    let v = r.json();
    let uri = format!("production:{project}@{etag}");
    assert_eq!(v["source_uri"], uri.as_str());
    let doc = v["path"].as_str().unwrap();

    // read once from the relay, through the caller's signed identity; written nowhere in it
    assert_eq!(
        rs.lock().unwrap().calls,
        vec![("GET".to_string(), format!("/api/clan/{project}"), None)]
    );

    // the deck is in the library: the project whole under upstream, no canvas, the source named
    let deck = get(&s, &me, &format!("/d/{doc}/download")).await;
    assert_eq!(deck.status, StatusCode::OK);
    let deck = clan_of(&deck.body);
    assert_eq!(deck.manifest().app.as_ref().unwrap().app_id, DECK);
    assert_eq!(deck.manifest().title, "Lumen deck");
    assert!(
        !deck.has_entry(CHECKPOINT),
        "the canvas checkpoint is not carried"
    );
    assert!(deck
        .read_all_entries()
        .unwrap()
        .iter()
        .all(|(p, _)| !p.ends_with("canvas.ybin.zst")));
    let lineage = deck.manifest().lineage.as_ref().unwrap();
    assert_eq!(lineage.parent_uri, uri);
    let carried = deck.manifest().carried().expect("lineage.carried");
    assert_eq!(carried.document_id, source.manifest().document_id());
    assert!(yaml(&deck, "shared/data.yaml")["upstream"][&carried.document_id].is_mapping());
    // the brief the project carried reaches the deck, hoisted beside it
    let brief_id = source.manifest().carried().unwrap().document_id.clone();
    assert!(yaml(&deck, "shared/data.yaml")["upstream"][&brief_id].is_mapping());
    assert_eq!(documents_of(&s, &me, DECK).await, 1);
}

#[tokio::test]
async fn another_agencys_project_is_refused_and_no_document_is_written() {
    let (url, rs) = relay().await;
    let s = server(Some(url));
    let me = sign_in(&s, "visionary", "napkin").await;
    let them = sign_in(&s, "planner", "javelin").await;
    let (theirs, _) = a_saved_project(&s, &rs, &them).await;

    // the relay keeps workspaces apart: it does not find it under my identity
    let r = post_json(
        &s,
        &me,
        &format!("/production/{theirs}/spinoff"),
        serde_json::json!({ "target_app_id": DECK }),
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(documents_of(&s, &me, DECK).await, 0);

    // and when a relay forgets to, the project's own stamp does: 403 from the host
    rs.lock().unwrap().leaky = true;
    let r = post_json(
        &s,
        &me,
        &format!("/production/{theirs}/spinoff"),
        serde_json::json!({ "target_app_id": DECK }),
    )
    .await;
    assert_eq!(
        r.status,
        StatusCode::FORBIDDEN,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    assert_eq!(documents_of(&s, &me, DECK).await, 0);
    assert_eq!(documents_of(&s, &them, DECK).await, 0);
}

#[tokio::test]
async fn a_project_is_not_continued_into_production_or_by_a_bad_id() {
    let (url, rs) = relay().await;
    let s = server(Some(url));
    let me = sign_in(&s, "visionary", "napkin").await;
    let (project, _) = a_saved_project(&s, &rs, &me).await;
    let r = post_json(
        &s,
        &me,
        &format!("/production/{project}/spinoff"),
        serde_json::json!({ "target_app_id": PRODUCTION }),
    )
    .await;
    assert_eq!(r.status, StatusCode::UNPROCESSABLE_ENTITY);
    let r = post_json(
        &s,
        &me,
        "/production/not-a-project/spinoff",
        serde_json::json!({ "target_app_id": DECK }),
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    // a target that is not installed: the host's own 404
    let r = post_json(
        &s,
        &me,
        &format!("/production/{project}/spinoff"),
        serde_json::json!({ "target_app_id": "ie.napkin.nothing" }),
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
}

// ── The assets pass for a deck build (src/sandbox.rs, docs/contracts/production-tool-identity.md) ──

/// A middleware that keeps the body of every task it is sent.
struct Capture(String);

impl napkin_host::HostConfig for Capture {
    fn workspace(&self) -> Option<napkin_host::WorkspaceConfig> {
        serde_json::from_value(
            serde_json::json!({ "proxies": {"middleware": {"endpoint": self.0}} }),
        )
        .ok()
    }
    fn secret(&self, _: &str) -> Option<String> {
        None
    }
}

async fn capturing_middleware() -> (String, Arc<Mutex<Vec<Value>>>) {
    let seen: Arc<Mutex<Vec<Value>>> = Arc::default();
    let keep = seen.clone();
    let app = Router::new().route(
        "/v1/tasks",
        axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
            let keep = keep.clone();
            async move {
                keep.lock().unwrap().push(body);
                axum::Json(serde_json::json!({
                    "api": "napkin.middleware/1", "task": "build_deck", "handler": "build_deck@1",
                    "job": {"id": "job_0123abcd", "state": "queued"},
                    "result": {"summary": "queued"}, "change": null, "trace": {},
                }))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}/v1/tasks"), seen)
}

async fn proxy(s: &Server, token: &str, task: &str, extra: Value) -> Reply {
    let mut payload = serde_json::json!({ "task": task, "input": {} });
    payload
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    send(
        s,
        Request::builder()
            .method("POST")
            .uri(format!("/s/{token}/api-proxy"))
            .body(Body::from(
                serde_json::json!({ "request_kind": "middleware", "payload": payload }).to_string(),
            ))
            .unwrap(),
    )
    .await
}

#[tokio::test]
async fn a_forwarded_build_deck_carries_the_callers_assets_pass_and_no_planted_one() {
    let (url, rs) = relay().await;
    let (mw, seen) = capturing_middleware().await;
    let s = server_with(Some(url), Arc::new(Capture(mw)));
    let me = sign_in(&s, "visionary", "napkin").await;
    let _ = rs;
    let doc = napkin_host::DocId::new(a_brief(&s, &me, "Deck"));
    let token = s.ctx.tokens.mint(&me.tenant, "visionary@napkin", &doc);
    let planted =
        serde_json::json!({ "production_assets": { "base": "https://evil.example", "pass": "x" } });

    let r = proxy(&s, &token, "build_deck", planted.clone()).await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    let r = proxy(&s, &token, "draft_brief", planted).await;
    assert_eq!(r.status, StatusCode::OK);

    let bodies = seen.lock().unwrap().clone();
    let assets = &bodies[0]["payload"]["production_assets"];
    assert!(assets["base"].as_str().unwrap().ends_with("/api"));
    assert_ne!(assets["base"], "https://evil.example");
    let part = assets["pass"].as_str().unwrap().split('.').nth(1).unwrap();
    let c: Value = serde_json::from_slice(&B64.decode(part).unwrap()).unwrap();
    assert_eq!(
        (c["aud"].as_str(), c["a"].as_str()),
        (Some("assets"), Some("napkin"))
    );
    assert_eq!(c["t"], me.tenant.to_string());
    assert!(
        bodies[1]["payload"].get("production_assets").is_none(),
        "not on another task"
    );
}

#[tokio::test]
async fn without_a_relay_a_build_deck_has_no_assets_field_and_a_planted_one_is_gone() {
    let (mw, seen) = capturing_middleware().await;
    let s = server_with(None, Arc::new(Capture(mw)));
    let me = sign_in(&s, "visionary", "napkin").await;
    let doc = napkin_host::DocId::new(a_brief(&s, &me, "Deck"));
    let token = s.ctx.tokens.mint(&me.tenant, "visionary@napkin", &doc);
    let planted =
        serde_json::json!({ "production_assets": { "base": "https://evil.example", "pass": "x" } });
    let r = proxy(&s, &token, "build_deck", planted).await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    assert!(seen.lock().unwrap()[0]["payload"]
        .get("production_assets")
        .is_none());
}

// ── Assets as links (features/spinoff-asset-links) ───────────────────────────

const PDF: &[u8] = b"%PDF-1.4 the client's own brief, stored once per agency";

/// A brief that holds the PDF, uploaded through the host the way a person does.
fn a_brief_with_pdf(s: &Server, p: &Person) -> String {
    let id = a_brief(s, p, "Hollow Oak");
    let ws = s.ctx.workspace(&p.tenant);
    let session = napkin_host::Session::with_ctx(ws.store.clone(), p.tenant.ctx());
    session.open(napkin_host::DocId::new(id.clone())).unwrap();
    session
        .upload_asset("client.pdf", None, PDF.to_vec())
        .unwrap();
    id
}

fn blob_files(s: &Server, p: &Person) -> usize {
    use napkin_host::BlobStore as _;
    napkin_web::store::TenantStore::new(s._dir_path().join("data").join(p.tenant.as_str()))
        .list()
        .len()
}

#[tokio::test]
async fn a_chain_brief_production_deck_stores_one_file_and_survives_the_source() {
    let (url, rs) = relay().await;
    let s = server(Some(url));
    let me = sign_in(&s, "visionary", "napkin").await;
    let brief = a_brief_with_pdf(&s, &me);
    let want = clan_sdk::hash::sha256_prefixed(PDF);

    // The upload is a link already: no bytes in the brief, one file in the workspace.
    let stored = clan_of(
        &s.ctx
            .workspace(&me.tenant)
            .store
            .read(&napkin_host::DocId::new(brief.clone()))
            .unwrap(),
    );
    assert!(!stored.has_entry("human/assets/client.pdf"));
    assert!(
        stored
            .manifest()
            .file_by_path("human/assets/client.pdf")
            .unwrap()
            .linked
    );
    assert_eq!(blob_files(&s, &me), 1);

    // Brief to Production: the project in the relay holds the link, not the bytes.
    let made = post_json(
        &s,
        &me,
        "/spinoff/production",
        serde_json::json!({ "doc": brief }),
    )
    .await;
    assert_eq!(
        made.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&made.body)
    );
    let project = made.json()["project"].as_str().unwrap().to_string();
    let saved = clan_of(&rs.lock().unwrap().projects[me.tenant.as_str()][&project].bytes);
    assert!(!saved.has_entry("human/assets/client.pdf"));
    let f = saved
        .manifest()
        .file_by_path("human/assets/client.pdf")
        .unwrap();
    assert!(f.linked);
    assert_eq!(f.sha256.as_deref(), Some(want.as_str()));

    // Production to Deck: the same link, and still one file.
    let r = post_json(
        &s,
        &me,
        &format!("/production/{project}/spinoff"),
        serde_json::json!({ "target_app_id": DECK }),
    )
    .await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    let doc = r.json()["path"].as_str().unwrap().to_string();
    assert_eq!(
        blob_files(&s, &me),
        1,
        "one stored file for the whole chain"
    );

    // The source is deleted; the deck still opens and serves the file.
    std::fs::remove_file(
        s._dir_path()
            .join("data")
            .join(me.tenant.as_str())
            .join("documents")
            .read_dir()
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains(&brief["doc-".len()..])
            })
            .unwrap(),
    )
    .unwrap();
    let ws = s.ctx.workspace(&me.tenant);
    let session = napkin_host::Session::with_ctx(ws.store.clone(), me.tenant.ctx());
    session
        .open(napkin_host::DocId::new(
            doc.rsplit('/').next().unwrap().to_string(),
        ))
        .unwrap_or_else(|e| panic!("{e:?}"));
    let (_, bytes) = session.serve_asset("client.pdf").unwrap();
    assert_eq!(bytes, PDF);

    // The download leaves with the bytes: it opens on its own.
    let dl = get(
        &s,
        &me,
        &format!("/d/{}/download", doc.rsplit('/').next().unwrap()),
    )
    .await;
    assert_eq!(dl.status, StatusCode::OK);
    let whole = clan_of(&dl.body);
    assert_eq!(whole.read_entry("human/assets/client.pdf").unwrap(), PDF);
    assert!(clan_sdk::validate(&whole).is_valid());

    // Another agency's workspace holds no such file.
    let other = sign_in(&s, "planner", "javelin").await;
    assert_eq!(blob_files(&s, &other), 0);
    use napkin_host::BlobStore as _;
    let theirs =
        napkin_web::store::TenantStore::new(s._dir_path().join("data").join(other.tenant.as_str()));
    assert!(!theirs.has(&want));
}

#[tokio::test]
async fn the_sweep_is_for_admins_and_keeps_what_a_relay_project_links() {
    let (url, _rs) = relay().await;
    let s = server(Some(url));
    let me = sign_in(&s, "visionary", "napkin").await;
    let brief = a_brief_with_pdf(&s, &me);
    let made = post_json(
        &s,
        &me,
        "/spinoff/production",
        serde_json::json!({ "doc": brief }),
    )
    .await;
    assert_eq!(made.status, StatusCode::OK);
    // The brief is gone, only the relay project names the file: it is pinned.
    let docs = s
        ._dir_path()
        .join("data")
        .join(me.tenant.as_str())
        .join("documents");
    for e in docs.read_dir().unwrap().flatten() {
        std::fs::remove_file(e.path()).unwrap();
    }
    let admin = sign_in(&s, "engineer", "napkin").await;
    let r = post_json(
        &s,
        &admin,
        "/blobs/sweep?dry_run=false&grace_days=0",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    assert_eq!(r.json()["removed"].as_array().unwrap().len(), 0);
    assert_eq!(blob_files(&s, &me), 1);

    // A person who is not a Napkin admin may not sweep.
    let r = post_json(&s, &me, "/blobs/sweep", serde_json::json!({})).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
}
