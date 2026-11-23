// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Production in the spin-off chain (features/production-in-library.clan, stage 1): a brief, research or
//! territories become a Production project, and a project a deck, through the one plain route
//! `POST /t/{tenant}/d/{doc}/spinoff`. A Production project is a library document like any other: it lists
//! under its client, carries the whole upstream, and there is no bridge to the relay.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use clan_sdk::{ClanBuilder, ClanFile, SpinoffSpec};
use http_body_util::BodyExt;
use napkin_host::{library, DocId, NoConfig};
use napkin_web::production::{Config, Relay};
use napkin_web::state::AppCtx;
use napkin_web::tenant::TenantId;
use serde_json::Value;
use tower::ServiceExt;

const KEY: &str = "a-dev-identity-secret-of-32-bytes-or-more";
const BRIEF: &str = "ie.napkin.brief-maker";
const RESEARCH: &str = "ie.napkin.campaign-research";
const TERRITORIES: &str = "ie.napkin.territories";
const PRODUCTION: &str = "ie.napkin.production";
const DECK: &str = "ie.napkin.deck-maker";
const CHECKPOINT: &str = "human/assets/canvas.ybin.zst";
/// A real brief's data (Hollow Oak 'Still', carried upstream in the project export of 2026-11-22).
const HOLLOW_OAK: &str = include_str!("fixtures/hollow-oak-brief.yaml");

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
    server_apps(relay_url, config, true)
}

/// `deck`: whether Deck Maker is installed (a seed without it is the "app not installed" case).
fn server_apps(
    relay_url: Option<String>,
    config: Arc<dyn napkin_host::HostConfig>,
    deck: bool,
) -> Server {
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
        seed.join("research.app.clan"),
        template(RESEARCH, "Research Tool", None),
    )
    .unwrap();
    std::fs::write(
        seed.join("territories.app.clan"),
        template(TERRITORIES, "Territories", None),
    )
    .unwrap();
    std::fs::write(
        seed.join("production.app.clan"),
        template(
            PRODUCTION,
            "Production",
            Some(SpinoffSpec {
                accepts: vec![BRIEF.into(), RESEARCH.into(), TERRITORIES.into()],
                upstream: true,
                ..Default::default()
            }),
        ),
    )
    .unwrap();
    if deck {
        std::fs::write(
            seed.join("deck.app.clan"),
            template(DECK, "Deck Maker", Some(upstream(PRODUCTION))),
        )
        .unwrap();
    }
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
/// The relay is never called by these tests (the proxy needs only a configured address).
const RELAY_URL: &str = "http://127.0.0.1:9";

// ── Helpers ──────────────────────────────────────────────────────────────────

/// A document of `app` in the library, its data set to `data`. Returns its library id.
fn a_document(s: &Server, p: &Person, app: &str, title: &str, data: &str) -> String {
    let ws = s.ctx.workspace(&p.tenant);
    let id = library::create_instance(&*ws.store, app, Some(title.into())).unwrap();
    set_data(s, p, &id, data);
    id.to_string()
}

fn set_data(s: &Server, p: &Person, id: &DocId, data: &str) {
    let ws = s.ctx.workspace(&p.tenant);
    let clan = clan_of(&ws.store.read(id).unwrap());
    let mut b = ClanBuilder::new(clan.manifest().clone());
    for (path, bytes) in clan.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH && path != "shared/data.yaml" {
            b.add_entry(path, bytes);
        }
    }
    b.add_entry("shared/data.yaml", data.as_bytes().to_vec());
    let base = ws.store.version(id).unwrap();
    ws.store
        .apply(&napkin_host::Change::replace(
            id.clone(),
            base,
            b.build().unwrap(),
        ))
        .unwrap();
}

fn stored(s: &Server, p: &Person, doc: &str) -> ClanFile {
    clan_of(
        &s.ctx
            .workspace(&p.tenant)
            .store
            .read(&DocId::new(doc))
            .unwrap(),
    )
}

async fn spinoff(s: &Server, p: &Person, doc: &str, app: &str) -> Reply {
    post_json(
        s,
        p,
        &format!("/d/{doc}/spinoff"),
        serde_json::json!({ "app_id": app }),
    )
    .await
}

/// The file name a library id has on disk (`doc-<name>` is `<name>.clan`).
fn stem(doc: &str) -> &str {
    doc.strip_prefix("doc-").unwrap_or(doc)
}

fn path_of(r: &Reply) -> String {
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    r.json()["path"].as_str().unwrap().to_string()
}

async fn library_item(s: &Server, p: &Person, doc: &str) -> Value {
    let v = get(s, p, "/library").await.json();
    v["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["path"] == doc)
        .unwrap_or_else(|| panic!("{doc} is not listed: {v}"))
        .clone()
}

async fn a_client(s: &Server, p: &Person, name: &str) -> String {
    let r = post_json(s, p, "/clients", serde_json::json!({ "name": name })).await;
    assert_eq!(
        r.status,
        StatusCode::CREATED,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    r.json()["id"].as_str().unwrap().to_string()
}

// ── Production in the library (S1-1) ─────────────────────────────────────────

#[tokio::test]
async fn a_production_project_lists_under_its_client_or_under_none() {
    let s = server(None);
    let me = sign_in(&s, "visionary", "napkin").await;
    let client = a_client(&s, &me, "Hollow Oak Cider").await;
    let with = post_json(
        &s,
        &me,
        "/documents",
        serde_json::json!({ "app_id": PRODUCTION, "title": "Still", "client_id": client }),
    )
    .await;
    let with = with.json()["path"].as_str().unwrap().to_string();
    let item = library_item(&s, &me, &with).await;
    assert_eq!(item["app_id"], PRODUCTION);
    assert_eq!(item["client"]["id"], client);
    assert_eq!(item["client"]["name"], "Hollow Oak Cider");

    let none = post_json(
        &s,
        &me,
        "/documents",
        serde_json::json!({ "app_id": PRODUCTION, "title": "Loose" }),
    )
    .await;
    let none = none.json()["path"].as_str().unwrap().to_string();
    assert!(library_item(&s, &me, &none).await["client"].is_null());
}

// ── Brief, research, territories to Production (S1-2, S1-3, S1-5, S1-20, S1-21) ──

#[tokio::test]
async fn a_brief_continues_in_production_under_its_client_and_carries_every_field() {
    let s = server(None);
    let me = sign_in(&s, "visionary", "napkin").await;
    let client = a_client(&s, &me, "Hollow Oak Cider").await;
    let made = post_json(
        &s,
        &me,
        "/documents",
        serde_json::json!({ "app_id": BRIEF, "title": "Still", "client_id": client }),
    )
    .await;
    let brief = made.json()["path"].as_str().unwrap().to_string();
    set_data(&s, &me, &DocId::new(brief.clone()), HOLLOW_OAK);
    let source = stored(&s, &me, &brief);
    let want: serde_yaml::Value = serde_yaml::from_str(HOLLOW_OAK).unwrap();

    let r = spinoff(&s, &me, &brief, PRODUCTION).await;
    let prod = path_of(&r);

    // In the library, under the brief's client.
    let item = library_item(&s, &me, &prod).await;
    assert_eq!(item["app_id"], PRODUCTION);
    assert_eq!(item["client"]["id"], client);

    // The whole brief, key for key and field for field: nothing summarised.
    let clan = stored(&s, &me, &prod);
    let data = yaml(&clan, "shared/data.yaml");
    let carried = &data["upstream"][source.document_id()];
    let keys = |v: &serde_yaml::Value| -> Vec<String> {
        let mut k: Vec<String> = v
            .as_mapping()
            .unwrap()
            .keys()
            .map(|k| k.as_str().unwrap().to_string())
            .collect();
        k.sort();
        k
    };
    assert_eq!(keys(carried), keys(&want));
    for (k, v) in want.as_mapping().unwrap() {
        assert_eq!(&carried[k], v, "{k:?} arrived whole");
    }
    assert!(!carried["objectives"].is_null() && !carried["audience"].is_null());
    assert!(clan.manifest().carried().is_some());
    // The source is named by id and version, the address the save route's ETag carries.
    let uri = &clan.manifest().lineage.as_ref().unwrap().parent_uri;
    assert_eq!(
        uri,
        &format!(
            "doc:{brief}@{}",
            clan_sdk::hash::sha256_prefixed(source.raw_bytes())
        )
    );
}

#[tokio::test]
async fn production_is_a_target_for_brief_research_and_territories_and_never_for_itself() {
    let s = server(None);
    let me = sign_in(&s, "visionary", "napkin").await;
    for app in [BRIEF, RESEARCH, TERRITORIES] {
        let doc = a_document(&s, &me, app, "Source", "note: x\n");
        let t = get(&s, &me, &format!("/d/{doc}/spinoff-targets")).await;
        assert_eq!(t.status, StatusCode::OK);
        let ids: Vec<String> = t
            .json()
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["app_id"].as_str().unwrap().to_string())
            .collect();
        assert!(ids.contains(&PRODUCTION.to_string()), "{app}: {ids:?}");
        assert!(
            !ids.contains(&DECK.to_string()),
            "{app} does not feed the deck"
        );
    }
    let prod = a_document(&s, &me, PRODUCTION, "Project", "note: x\n");
    let t = get(&s, &me, &format!("/d/{prod}/spinoff-targets")).await;
    let ids: Vec<String> = t
        .json()
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["app_id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids, vec![DECK.to_string()]);
}

#[tokio::test]
async fn territories_continue_in_production_through_the_plain_spinoff() {
    let s = server(None);
    let me = sign_in(&s, "visionary", "napkin").await;
    let data =
        "territories:\n- name: The quiet orchard\n  idea: Still, in every glass\nchosen: 0\n";
    let terr = a_document(&s, &me, TERRITORIES, "Hollow Oak territories", data);
    let source = stored(&s, &me, &terr);
    let prod = path_of(&spinoff(&s, &me, &terr, PRODUCTION).await);
    let data = yaml(&stored(&s, &me, &prod), "shared/data.yaml");
    let carried = &data["upstream"][source.document_id()];
    assert_eq!(carried, &yaml(&source, "shared/data.yaml"));
    assert_eq!(carried["territories"][0]["name"], "The quiet orchard");
}

/// Picture bytes a Territories route holds as a frame: the heavy media a spin-off links, never copies.
const FRAME: &[u8] = b"\x89PNG a generated frame the route holds, stored once per agency";

/// A Territories document as the example holds it (greenlit routes, worlds, checks, sources), plus one picture by link: a
/// frame with the hash of `FRAME` and its stated rights, and one whose rights nobody stated.
fn territories_with_frames() -> String {
    let mut d: Value = serde_json::from_str(include_str!(
        "../../../app/templates/territories/example/data.json"
    ))
    .unwrap();
    let want = clan_sdk::hash::sha256_prefixed(FRAME);
    let hex = want.trim_start_matches("sha256:");
    let t = d["territories"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|t| t["id"] == "t_started")
        .unwrap();
    t["pictures"] = serde_json::json!([
        {"id": "pic_started_f1", "touchpoint": "tv", "kind": "frame", "sha256": hex, "rights": "generated", "final": true},
        {"id": "pic_started_f2", "touchpoint": "poster", "kind": "frame", "sha256": "ab".repeat(32)}
    ]);
    serde_json::to_string(&d).unwrap()
}

#[tokio::test]
async fn greenlit_routes_continue_in_production_whole_under_their_client_with_pictures_as_links() {
    let s = server(None);
    let me = sign_in(&s, "visionary", "napkin").await;
    let client = a_client(&s, &me, "Hollow Oak Cider").await;
    let made = post_json(
        &s,
        &me,
        "/documents",
        serde_json::json!({ "app_id": TERRITORIES, "title": "Rail territories", "client_id": client }),
    )
    .await;
    let terr = made.json()["path"].as_str().unwrap().to_string();
    let data = territories_with_frames();
    set_data(&s, &me, &DocId::new(terr.clone()), &data);
    // The picture the frame links to is uploaded through the host the way the Territories page does it.
    let ws = s.ctx.workspace(&me.tenant);
    let session = napkin_host::Session::with_ctx(ws.store.clone(), me.tenant.ctx());
    session.open(DocId::new(terr.clone())).unwrap();
    session
        .upload_asset("frame-started.png", None, FRAME.to_vec())
        .unwrap();
    let source = stored(&s, &me, &terr);
    let want: Value = serde_json::from_str(&data).unwrap();
    assert_eq!(blob_files(&s, &me), 1);

    let prod = path_of(&spinoff(&s, &me, &terr, PRODUCTION).await);

    // In the library, a Production project under the same client.
    let item = library_item(&s, &me, &prod).await;
    assert_eq!(item["app_id"], PRODUCTION);
    assert_eq!(item["client"]["id"], client);

    // The whole document, every route with its world, words, checks, sources and rights, and who greenlit which.
    let clan = stored(&s, &me, &prod);
    let carried =
        serde_json::to_value(&yaml(&clan, "shared/data.yaml")["upstream"][source.document_id()])
            .unwrap();
    let ids = |v: &Value, key: &str, field: &str| -> Vec<String> {
        v[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r[field].as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(
        ids(&carried, "territories", "id"),
        ids(&want, "territories", "id")
    );
    assert_eq!(
        ids(&carried, "greenlit", "territory_id"),
        ids(&want, "greenlit", "territory_id")
    );
    assert!(!ids(&carried, "greenlit", "by").is_empty());
    for key in ["territories", "greenlit", "crew", "sends", "run", "review"] {
        assert_eq!(carried[key], want[key], "{key} arrived whole");
    }
    // What the Territories document had carried (its brief and research) is hoisted beside it, not lost.
    let all = serde_json::to_value(&yaml(&clan, "shared/data.yaml")["upstream"]).unwrap();
    for (id, held) in want["upstream"].as_object().unwrap() {
        assert_eq!(&all[id], held, "{id} stays in the project's upstream");
    }
    let t = carried["territories"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == "t_started")
        .unwrap();
    assert!(t["world"]["palette"]["bg"].is_string() && !t["checks"].as_array().unwrap().is_empty());
    assert_eq!(t["pictures"][0]["rights"], "generated");

    // Pictures are links: the project holds the hash, the file is not in its archive, and nothing was stored twice.
    assert_eq!(
        t["pictures"][0]["sha256"],
        clan_sdk::hash::sha256_prefixed(FRAME).trim_start_matches("sha256:")
    );
    assert!(!clan.has_entry("human/assets/frame-started.png"));
    let f = clan
        .manifest()
        .file_by_path("human/assets/frame-started.png")
        .unwrap();
    assert!(f.linked);
    assert_eq!(
        f.sha256.as_deref(),
        Some(clan_sdk::hash::sha256_prefixed(FRAME).as_str())
    );
    assert_eq!(blob_files(&s, &me), 1, "one stored file");
    // The source is named by id and version.
    let uri = &clan.manifest().lineage.as_ref().unwrap().parent_uri;
    assert_eq!(
        uri,
        &format!(
            "doc:{terr}@{}",
            clan_sdk::hash::sha256_prefixed(source.raw_bytes())
        )
    );
}

#[tokio::test]
async fn the_old_special_routes_are_gone() {
    let s = server(None);
    let me = sign_in(&s, "visionary", "napkin").await;
    let brief = a_document(&s, &me, BRIEF, "Still", "note: x\n");
    // No API route answers either path: whatever the shell's fallback says, no document is made.
    for (path, body) in [
        ("/spinoff/production", serde_json::json!({ "doc": brief })),
        (
            "/production/prj_01K7A000000000000000000012/spinoff",
            serde_json::json!({ "target_app_id": DECK }),
        ),
    ] {
        let r = post_json(&s, &me, path, body).await;
        let is_json = r
            .headers
            .get(header::CONTENT_TYPE)
            .is_some_and(|v| v.to_str().unwrap_or("").contains("json"));
        assert!(!is_json, "{path} answered with JSON: {:?}", r.body);
        assert_eq!(documents_of(&s, &me, PRODUCTION).await, 0, "{path}");
    }
    // And the generic route no longer refuses Production (the old 422 guard).
    assert_eq!(
        spinoff(&s, &me, &brief, PRODUCTION).await.status,
        StatusCode::OK
    );
    assert_eq!(documents_of(&s, &me, PRODUCTION).await, 1);
}

#[tokio::test]
async fn a_spinoff_from_another_workspace_is_not_made() {
    let s = server(None);
    let mine = sign_in(&s, "visionary", "napkin").await;
    let brief = a_document(&s, &mine, BRIEF, "Still", "note: x\n");
    let other = sign_in(&s, "planner", "javelin").await;
    // Their own workspace has no such document.
    let r = spinoff(&s, &other, &brief, PRODUCTION).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    // Another tenant's path with their cookie is refused outright.
    let r = send(
        &s,
        Request::builder()
            .method("POST")
            .uri(format!("/api/t/{}/d/{brief}/spinoff", mine.tenant))
            .header(header::HOST, "studio.test")
            .header(header::COOKIE, &other.cookie)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({ "app_id": PRODUCTION }).to_string(),
            ))
            .unwrap(),
    )
    .await;
    assert!(
        r.status == StatusCode::FORBIDDEN || r.status == StatusCode::NOT_FOUND,
        "{}",
        r.status
    );
}

// ── Production to Deck (S1-4, S1-5) ──────────────────────────────────────────

#[tokio::test]
async fn a_project_continues_in_a_deck_without_its_canvas_and_with_the_whole_brief() {
    let s = server(None);
    let me = sign_in(&s, "visionary", "napkin").await;
    let client = a_client(&s, &me, "Hollow Oak Cider").await;
    let made = post_json(
        &s,
        &me,
        "/documents",
        serde_json::json!({ "app_id": BRIEF, "title": "Still", "client_id": client }),
    )
    .await;
    let brief = made.json()["path"].as_str().unwrap().to_string();
    set_data(&s, &me, &DocId::new(brief.clone()), HOLLOW_OAK);
    let brief_doc = stored(&s, &me, &brief).document_id().to_string();
    let prod = path_of(&spinoff(&s, &me, &brief, PRODUCTION).await);

    // The tool's save leaves a canvas checkpoint in the project.
    {
        let ws = s.ctx.workspace(&me.tenant);
        let id = DocId::new(prod.clone());
        let clan = stored(&s, &me, &prod);
        let mut b = ClanBuilder::new(clan.manifest().clone());
        for (path, bytes) in clan.read_all_entries().unwrap() {
            if path != clan_sdk::MANIFEST_PATH {
                b.add_entry(path, bytes);
            }
        }
        b.add_entry(CHECKPOINT, vec![7u8; 4096]);
        let base = ws.store.version(&id).unwrap();
        ws.store
            .apply(&napkin_host::Change::replace(id, base, b.build().unwrap()))
            .unwrap();
    }
    let project = stored(&s, &me, &prod);
    assert!(project.has_entry(CHECKPOINT));

    let deck = path_of(&spinoff(&s, &me, &prod, DECK).await);
    let clan = stored(&s, &me, &deck);
    assert!(!clan.has_entry(CHECKPOINT));
    assert_eq!(library_item(&s, &me, &deck).await["client"]["id"], client);
    let data = yaml(&clan, "shared/data.yaml");
    // The project is carried whole, and so is the brief it carried: objectives are there, not null.
    let want: serde_yaml::Value = serde_yaml::from_str(HOLLOW_OAK).unwrap();
    assert_eq!(data["upstream"][&brief_doc], want);
    assert!(data["upstream"][project.document_id()].is_mapping());
    assert!(!data["upstream"][&brief_doc]["objectives"].is_null());
    assert_eq!(
        clan.manifest().lineage.as_ref().unwrap().parent_uri,
        format!(
            "doc:{prod}@{}",
            clan_sdk::hash::sha256_prefixed(project.raw_bytes())
        )
    );
}

#[tokio::test]
async fn a_missing_app_is_named_in_plain_words() {
    let s = server_apps(None, Arc::new(NoConfig), false);
    let me = sign_in(&s, "visionary", "napkin").await;
    let prod = a_document(&s, &me, PRODUCTION, "Project", "note: x\n");
    let r = spinoff(&s, &me, &prod, DECK).await;
    assert!(!r.status.is_success());
    let why = r.json()["error"].as_str().unwrap().to_string();
    assert!(why.contains("app not installed"), "{why}");
    assert!(!why.contains("saved project"));
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
    let (mw, seen) = capturing_middleware().await;
    let s = server_with(Some(RELAY_URL.into()), Arc::new(Capture(mw)));
    let me = sign_in(&s, "visionary", "napkin").await;
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
    let s = server(None);
    let me = sign_in(&s, "visionary", "napkin").await;
    let brief = a_brief_with_pdf(&s, &me);
    let want = clan_sdk::hash::sha256_prefixed(PDF);
    assert_eq!(blob_files(&s, &me), 1);

    // Brief to Production: the project holds the link, not the bytes.
    let prod = path_of(&spinoff(&s, &me, &brief, PRODUCTION).await);
    let saved = stored(&s, &me, &prod);
    assert!(!saved.has_entry("human/assets/client.pdf"));
    let f = saved
        .manifest()
        .file_by_path("human/assets/client.pdf")
        .unwrap();
    assert!(f.linked);
    assert_eq!(f.sha256.as_deref(), Some(want.as_str()));

    // Production to Deck: the same link, and still one file.
    let doc = path_of(&spinoff(&s, &me, &prod, DECK).await);
    assert_eq!(
        blob_files(&s, &me),
        1,
        "one stored file for the whole chain"
    );

    // The source and the project are deleted; the deck still opens and serves the file.
    let docs = s
        ._dir_path()
        .join("data")
        .join(me.tenant.as_str())
        .join("documents");
    for e in docs.read_dir().unwrap().flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.contains(stem(&brief)) || name.contains(stem(&prod)) {
            std::fs::remove_file(e.path()).unwrap();
        }
    }
    let ws = s.ctx.workspace(&me.tenant);
    let session = napkin_host::Session::with_ctx(ws.store.clone(), me.tenant.ctx());
    session
        .open(napkin_host::DocId::new(doc.clone()))
        .unwrap_or_else(|e| panic!("{e:?}"));
    let (_, bytes) = session.serve_asset("client.pdf").unwrap();
    assert_eq!(bytes, PDF);

    // The download leaves with the bytes: it opens on its own.
    let dl = get(&s, &me, &format!("/d/{doc}/download")).await;
    assert_eq!(dl.status, StatusCode::OK);
    let whole = clan_of(&dl.body);
    assert_eq!(whole.read_entry("human/assets/client.pdf").unwrap(), PDF);
    assert!(clan_sdk::validate(&whole).is_valid());

    // Another agency's workspace holds no such file.
    let other = sign_in(&s, "planner", "javelin").await;
    assert_eq!(blob_files(&s, &other), 0);
}

#[tokio::test]
async fn the_sweep_is_for_admins_and_keeps_what_a_project_links() {
    let s = server(None);
    let me = sign_in(&s, "visionary", "napkin").await;
    let brief = a_brief_with_pdf(&s, &me);
    let prod = path_of(&spinoff(&s, &me, &brief, PRODUCTION).await);
    // The brief is gone; only the project names the file.
    let docs = s
        ._dir_path()
        .join("data")
        .join(me.tenant.as_str())
        .join("documents");
    for e in docs.read_dir().unwrap().flatten() {
        if !e.file_name().to_string_lossy().contains(stem(&prod)) {
            std::fs::remove_file(e.path()).unwrap();
        }
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
