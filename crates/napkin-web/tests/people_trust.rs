// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/align-needs-lock-people.clan, stage 3, after its security review: the build's agency registry
//! is a document, so the one-time import treats it as untrusted. An entry is imported only into the agency
//! that owns the registry, only with roles the store defines, never over a person the store already has,
//! and with `admin` only where the registry's own chain shows an admin wrote it. A member cannot open or
//! write the registry, and nothing a member writes there can stop the server's next start.

use std::path::Path;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::agency::{self, NewPerson};
use napkin_host::NoConfig;
use napkin_web::people::People;
use napkin_web::state::AppCtx;
use napkin_web::store::TenantStore;
use napkin_web::tenant::TenantId;
use serde_json::{json, Value};
use tower::ServiceExt;

const ROSTER: &str = "engineer@napkin\tEng\tadmin\n\
ad@wk\tAd\tadmin\n\
aoife@wk\tAoife\tplanning\n\
cian@wk\tCian\taccount-service\n\
sam@wk\tSam\n\
barra@bq\tBarra\tadmin\n\
bria@bq\tBria\tplanning\n";

struct Rig {
    dir: tempfile::TempDir,
    app: Router,
    ctx: Arc<AppCtx>,
}

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Arc::new(AppCtx::new(
        dir.path().to_path_buf(),
        Arc::new(NoConfig),
        None,
        40,
    ));
    let roster = dir.path().join("accounts.tsv");
    std::fs::write(&roster, ROSTER).unwrap();
    let identity = napkin_web::tenant::Identity {
        mode: napkin_web::tenant::Mode::Accounts {
            provider: napkin_web::auth::Provider::Roster(
                napkin_web::auth::Roster::open(dir.path().join("_people"), &roster).unwrap(),
            ),
            sessions: napkin_web::auth::Sessions::new(&[9u8; 32]).unwrap(),
        },
        secure: false,
    };
    Rig {
        app: napkin_web::router_with(ctx.clone(), None, Arc::new(identity)),
        dir,
        ctx,
    }
}

async fn call(
    r: &Rig,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
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
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

struct Who {
    cookie: String,
    tenant: String,
}

async fn try_sign_in(r: &Rig, username: &str) -> Option<Who> {
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/sign-in")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "username": username }).to_string()))
        .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    if resp.status() != StatusCode::OK {
        return None;
    }
    let cookie = resp
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("napkin_session=") && !v.starts_with("napkin_session=;"))
        .map(|v| v.split(';').next().unwrap().to_string())?;
    let (_, me) = call(r, "GET", "/api/session", Some(&cookie), None).await;
    Some(Who {
        cookie,
        tenant: me["tenant"].as_str().unwrap().to_string(),
    })
}

fn known(r: &str) -> bool {
    r != "demo" && napkin_web::roles::Table::default().knows(r)
}

fn store_of(root: &Path, agency: &str) -> TenantStore {
    TenantStore::new(root.join(TenantId::of_agency(agency).as_str()))
}

fn invite(root: &Path, agency: &str, by: &str, username: &str, roles: &[&str]) {
    let ctx = TenantId::of_agency(agency).ctx_for(by);
    agency::invite(
        &store_of(root, agency),
        &ctx,
        NewPerson {
            username: username.into(),
            name: format!("{username} Test"),
            email: format!("{}@mail.example.test", username.split('@').next().unwrap()),
            roles: roles.iter().map(|r| r.to_string()).collect(),
        },
        &known,
    )
    .unwrap();
}

fn open(root: &Path) -> People {
    People::open(root.join("_people"), &root.join("accounts.tsv")).unwrap()
}

fn fresh() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("accounts.tsv"), ROSTER).unwrap();
    dir
}

/// Write `people` into a registry as a member's `patch-data` would, outside the routes: the data changes
/// and the chain gets a decision by `who` that is none of the registry's own actions.
fn member_writes(root: &Path, agency: &str, who: &str, people: Value) {
    let store = store_of(root, agency);
    let id = napkin_host::DocId::new("home-agency-v1");
    let ctx = TenantId::of_agency(agency).ctx_for(who);
    let session = napkin_host::Session::new(Arc::new(store));
    session.open(id).unwrap();
    let req = napkin_host::HostRequest::new(
        "/patch-data".to_string(),
        String::new(),
        json!({ "agent": "human", "action": "edit", "patch": { "people": people } })
            .to_string()
            .into_bytes(),
    )
    .posting();
    let resp = napkin_host::dispatch(&ctx, &session, &NoConfig, req);
    assert_eq!(resp.status, 200, "{}", String::from_utf8_lossy(&resp.body));
}

fn registry_people(root: &Path, agency: &str) -> Value {
    serde_json::to_value(agency::read(&store_of(root, agency)).unwrap().0.people).unwrap()
}

/// What the build's sandbox did for a member before this stage: a host request on the registry document as
/// the session's person, its body the member's own (any agent, any action, any field).
fn member_posts(root: &Path, agency: &str, who: &str, body: Value) {
    let (status, text) = member_posts_status(root, agency, who, body);
    assert_eq!(status, 200, "{text}");
}

/// The same, answering with the host's status and body.
fn member_posts_status(root: &Path, agency: &str, who: &str, body: Value) -> (u16, String) {
    let store = store_of(root, agency);
    let id = napkin_host::DocId::new("home-agency-v1");
    let ctx = TenantId::of_agency(agency).ctx_for(who);
    let session = napkin_host::Session::new(Arc::new(store));
    session.open(id).unwrap();
    let req = napkin_host::HostRequest::new(
        "/patch-data".to_string(),
        String::new(),
        body.to_string().into_bytes(),
    )
    .posting();
    let resp = napkin_host::dispatch(&ctx, &session, &NoConfig, req);
    (
        resp.status,
        String::from_utf8_lossy(&resp.body).into_owned(),
    )
}

fn change_lines(root: &Path) -> String {
    std::fs::read_to_string(root.join("_people/changes.jsonl")).unwrap_or_default()
}

// ── what the import takes from a registry: roles from the roster's column alone ─

#[test]
fn a_person_in_the_roster_only_is_left_as_the_roster_seeded_them() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "hal@bq", &["planning"]);
    let p = open(root);
    let before = p.book().person("bria@bq").cloned();
    napkin_web::people_import::run(&p, root).unwrap();
    assert_eq!(p.book().person("bria@bq").cloned(), before);
    assert_eq!(p.active("bria@bq").unwrap().roles, ["planning"]);
}

#[test]
fn a_person_in_the_registry_only_is_imported_removed_with_no_role_and_one_line() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "hal@bq", &["planning"]);
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    assert!(p.active("hal@bq").is_none());
    let hal = p.book().person("hal@bq").cloned().unwrap();
    assert!(hal.roles.is_empty() && hal.removed_at.is_some());
    assert_eq!(
        hal.name.as_deref(),
        Some("hal@bq Test"),
        "display data is kept"
    );
    let log = change_lines(root);
    let lines: Vec<&str> = log.lines().filter(|l| l.contains("\"hal@bq\"")).collect();
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert!(
        lines[0].contains("not given a role by the roster"),
        "{}",
        lines[0]
    );
}

#[test]
fn a_person_in_both_takes_the_rosters_roles_never_the_registrys() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "gil@bq", &["admin"]);
    invite(root, "bq", "barra@bq", "kit@bq", &["admin"]);
    // the store exists before the roster names gil and kit (a line added for the deploy)
    let p = open(root);
    std::fs::write(
        root.join("accounts.tsv"),
        format!("{ROSTER}gil@bq\tGil\ttraffic\nkit@bq\tKit\twizard,producer\n"),
    )
    .unwrap();
    let p2 = open(root);
    drop(p);
    napkin_web::people_import::run(&p2, root).unwrap();
    assert_eq!(p2.active("gil@bq").unwrap().roles, ["traffic"]);
    // and only the roles the table defines
    assert_eq!(p2.active("kit@bq").unwrap().roles, ["producer"]);
    // someone already in the store, in the registry with other roles: untouched
    assert_eq!(p2.active("barra@bq").unwrap().roles, ["admin"]);
}

#[test]
fn a_roster_line_with_no_role_the_table_defines_imports_the_person_removed() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "kit@bq", &["planning"]);
    let p = open(root);
    std::fs::write(
        root.join("accounts.tsv"),
        format!("{ROSTER}kit@bq\tKit\twizard,napkin-admin,demo\n"),
    )
    .unwrap();
    let p = {
        drop(p);
        open(root)
    };
    napkin_web::people_import::run(&p, root).unwrap();
    assert!(p.active("kit@bq").is_none());
    assert!(p.book().person("kit@bq").unwrap().roles.is_empty());
}

#[test]
fn the_import_never_touches_a_person_of_another_agency() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "bria@bq", &["planning"]);
    invite(root, "bq", "barra@bq", "aoife@wk", &["admin"]);
    invite(root, "bq", "barra@bq", "mallory@wk", &["admin"]);
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    assert_eq!(p.active("aoife@wk").unwrap().roles, ["planning"]);
    assert!(
        p.book().person("mallory@wk").is_none(),
        "bq's registry made a wk sign-in name"
    );
}

#[test]
fn the_import_never_overwrites_or_removes_a_person_the_store_has() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "bria@bq", &["traffic"]);
    invite(root, "bq", "barra@bq", "ad@wk", &["traffic"]);
    invite(root, "bq", "barra@bq", "engineer@napkin", &["traffic"]);
    let ctx = TenantId::of_agency("bq").ctx_for("barra@bq");
    for u in ["ad@wk", "engineer@napkin", "bria@bq", "barra@bq"] {
        let _ = agency::remove_person(&store_of(root, "bq"), &ctx, u);
    }
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    assert!(p.active("ad@wk").is_some(), "wk lost its only admin");
    assert_eq!(p.book().admins_of("wk"), 1);
    assert!(
        p.active("engineer@napkin").is_some(),
        "the Napkin admin was removed"
    );
    assert_eq!(p.active("bria@bq").unwrap().roles, ["planning"]);
    assert_eq!(p.active("barra@bq").unwrap().roles, ["admin"]);
}

#[test]
fn a_registry_entry_reaching_for_admin_gets_nothing() {
    let dir = fresh();
    let root = dir.path();
    // written by the agency's real admin, through the build's own route: still not a role source
    invite(root, "bq", "barra@bq", "gil@bq", &["admin"]);
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    assert!(p.active("gil@bq").is_none());
    assert!(p.book().person("gil@bq").unwrap().roles.is_empty());
}

#[test]
fn an_agency_with_a_registry_and_no_roster_line_gives_nobody_a_role() {
    let dir = fresh();
    let root = dir.path();
    // cz is on no line of the roster; its registry names its own people
    let ctx = TenantId::of_agency("cz").ctx_for("zoe@cz");
    for (u, roles) in [("yan@cz", vec!["planning"]), ("xia@cz", vec!["admin"])] {
        agency::invite(
            &store_of(root, "cz"),
            &ctx,
            NewPerson {
                username: u.into(),
                name: u.into(),
                email: format!("{}@mail.example.test", u.split('@').next().unwrap()),
                roles: roles.into_iter().map(String::from).collect(),
            },
            &known,
        )
        .unwrap();
    }
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    for u in ["zoe@cz", "yan@cz", "xia@cz"] {
        assert!(p.active(u).is_none(), "{u}");
        assert!(p.book().person(u).unwrap().roles.is_empty(), "{u}");
    }
}

#[test]
fn display_data_from_a_registry_is_checked_as_untrusted() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "hal@bq", &["planning"]);
    let mut people = registry_people(root, "bq");
    for x in people.as_array_mut().unwrap() {
        if x["username"] == "hal@bq" {
            x["name"] = json!("<img src=x onerror=alert(1)>");
            x["email"] = json!("\"><script>@x");
        }
    }
    member_writes(root, "bq", "hal@bq", people);
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    let hal = p.book().person("hal@bq").cloned().unwrap();
    assert_eq!(hal.name, None);
    assert_eq!(hal.email, None);
}

/// A member's write naming the admin as its agent and one of the registry's own actions (review b1).
#[test]
fn a_member_forging_the_admins_name_on_a_write_gains_nothing() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "hal@bq", &["planning"]);
    let mut people = registry_people(root, "bq");
    for x in people.as_array_mut().unwrap() {
        if x["username"] == "hal@bq" {
            x["roles"] = json!(["management", "account-service", "producer", "agency-brain"]);
        }
    }
    people.as_array_mut().unwrap().push(json!({
        "username": "pip@bq", "name": "Pip", "email": "p@mail.example.test",
        "roles": ["management", "account-service"], "state": "active",
        "invited_by": "barra@bq", "at": "2026-11-01T00:00:00Z",
    }));
    member_posts(
        root,
        "bq",
        "hal@bq",
        json!({
            "agent": "human:barra@bq", "action": "edit_person", "rationale": "Changed the name or address of hal@bq.",
            "patch": { "people": people },
        }),
    );
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    assert!(p.active("pip@bq").is_none(), "a planted name signs in");
    assert!(p.active("hal@bq").is_none(), "hal is not on the roster");
    assert!(p.book().person("hal@bq").unwrap().roles.is_empty());
}

/// The same, reaching for `admin` with every field a body might carry (review b2).
#[test]
fn a_member_cannot_forge_an_admin_grant() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "hal@bq", &["planning"]);
    let mut people = registry_people(root, "bq");
    for x in people.as_array_mut().unwrap() {
        if x["username"] == "hal@bq" {
            x["roles"] = json!(["admin"]);
        }
    }
    for action in ["set_roles", "add_person"] {
        let forged = json!({
            "agent": "human:barra@bq", "action": action, "rationale": "x",
            "targets": ["hal@bq"], "after": { "roles": ["admin"] }, "before": { "roles": ["planning"] },
            "id": "d-forged", "actor": "human:barra@bq",
            "decision": { "agent": "human:barra@bq", "action": action, "targets": ["hal@bq"], "after": { "roles": ["admin"] } },
            "patch": { "people": people },
        });
        // Since the Production line's merge the host reads `targets` and refuses one that is not an address
        // (ops/edit.rs): this forged write never lands.
        let (status, text) = member_posts_status(root, "bq", "hal@bq", forged.clone());
        assert_eq!(status, 400, "{text}");
        assert!(text.contains("is not an address"), "{text}");
        // Without a top-level `targets` the same forgery lands as data, and still grants nothing.
        let mut landed = forged;
        landed.as_object_mut().unwrap().remove("targets");
        member_posts(root, "bq", "hal@bq", landed);
    }
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    let hal = p.book().person("hal@bq").cloned().unwrap();
    assert!(!hal.roles.iter().any(|r| r == "admin"), "{:?}", hal.roles);
    assert!(p.active("hal@bq").is_none());
}

// ── finding 1: the registry is not a member's to open or write ──────────────

#[tokio::test]
async fn a_member_cannot_open_or_write_the_agency_registry() {
    let r = rig();
    let root = r.dir.path().to_path_buf();
    invite(&root, "bq", "barra@bq", "hal@bq", &["planning"]);
    let bria = try_sign_in(&r, "bria@bq").await.unwrap();
    let (st, v) = call(
        &r,
        "GET",
        &format!("/api/t/{}/d/home-agency-v1", bria.tenant),
        Some(&bria.cookie),
        None,
    )
    .await;
    assert!(
        st == StatusCode::FORBIDDEN || st == StatusCode::NOT_FOUND,
        "a member opens the registry: {st} {v}"
    );
    assert!(v["token"].is_null());
    // nor an admin: the People page is the only way people change
    let barra = try_sign_in(&r, "barra@bq").await.unwrap();
    let (st, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/d/home-agency-v1", barra.tenant),
        Some(&barra.cookie),
        None,
    )
    .await;
    assert!(st == StatusCode::FORBIDDEN || st == StatusCode::NOT_FOUND);
    // and a planted wk admin never signs in
    napkin_web::people_import::run(r.ctx.people().unwrap(), &root).unwrap();
    assert!(try_sign_in(&r, "mallory@wk").await.is_none());
}

// ── finding 2: an untrusted write cannot stop the server ────────────────────

#[test]
fn a_registry_changed_after_the_import_is_ignored_and_the_start_goes_on() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "hal@bq", &["planning"]);
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    let mut people = registry_people(root, "bq");
    people[0]["name"] = json!("Moved");
    people.as_array_mut().unwrap().push(json!({
        "username": "mal@bq", "name": "Mal", "email": "m@mail.example.test",
        "roles": ["admin"], "state": "active", "invited_by": "barra@bq", "at": "2026-11-01T00:00:00Z",
    }));
    member_writes(root, "bq", "hal@bq", people);
    let next = napkin_web::people_import::run(&open(root), root);
    assert!(
        next.is_ok(),
        "a member's edit stops the next start: {next:?}"
    );
    assert!(open(root).book().person("mal@bq").is_none());
}

#[test]
fn a_registry_that_does_not_parse_does_not_stop_the_start() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "hal@bq", &["planning"]);
    member_writes(root, "bq", "hal@bq", json!("not a list"));
    let p = open(root);
    let out = napkin_web::people_import::run(&p, root);
    assert!(out.is_ok(), "{out:?}");
    assert!(p.active("hal@bq").is_none());
}

/// Review c2: a member's own template spun off the registry, then read through the child's token.
#[tokio::test]
async fn a_member_cannot_read_the_registry_through_a_spin_off() {
    let r = rig();
    let root = r.dir.path().to_path_buf();
    invite(&root, "bq", "barra@bq", "hal@bq", &["planning"]);
    let bria = try_sign_in(&r, "bria@bq").await.unwrap();
    let t = &bria.tenant;
    let base = clan_sdk::ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "Child".into(),
            brief: "test brief".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let template = clan_sdk::make_template(
        &base,
        clan_sdk::AppInfo {
            home: None,
            name: "Child".into(),
            app_id: "ie.napkin.child".into(),
            version: "1.0.0".into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: Some("agent/output-schema.json".into()),
            prompt_templates: vec![],
            data_seed: None,
            spinoff: Some(clan_sdk::SpinoffSpec {
                upstream: true,
                ..Default::default()
            }),
            attach: None,
        },
        clan_sdk::MakeTemplateOptions::default(),
    )
    .unwrap();
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/t/{t}/documents/upload"))
        .header(header::COOKIE, &bria.cookie)
        .body(Body::from(template))
        .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    let up: Value =
        serde_json::from_slice(&resp.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let tdoc = up["path"].as_str().unwrap().to_string();
    let (st, _) = call(
        &r,
        "POST",
        &format!("/api/t/{t}/apps/from/{tdoc}"),
        Some(&bria.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "the member's template installs");
    let (st, v) = call(
        &r,
        "POST",
        &format!("/api/t/{t}/d/home-agency-v1/spinoff"),
        Some(&bria.cookie),
        Some(json!({ "app_id": "ie.napkin.child" })),
    )
    .await;
    assert!(!st.is_success(), "the registry was spun off: {st} {v}");
    assert!(v["token"].is_null());
}

/// Every route and sandbox path the review named, against the registry, as a member: none answers its people.
#[tokio::test]
async fn the_registry_is_reached_by_no_route() {
    let r = rig();
    let root = r.dir.path().to_path_buf();
    invite(&root, "bq", "barra@bq", "hal@bq", &["planning"]);
    napkin_web::people_import::run(r.ctx.people().unwrap(), &root).unwrap();
    let before = registry_people(&root, "bq");
    let bria = try_sign_in(&r, "bria@bq").await.unwrap();
    let c = Some(bria.cookie.as_str());
    let t = &bria.tenant;
    let d = "home-agency-v1";
    let send = |m: &'static str, uri: String, body: Option<Value>, cookie: Option<String>| {
        let r = &r;
        async move {
            let mut b = Request::builder().method(m).uri(uri);
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
            let st = resp.status();
            let bytes = resp.into_body().collect().await.unwrap().to_bytes();
            (st, String::from_utf8_lossy(&bytes).to_string())
        }
    };
    let leaks_in = |text: &str| text.contains("mail.example.test") || text.contains("invited_by");
    let mut leaks = Vec::new();
    for (m, uri, body) in [
        ("GET", format!("/api/t/{t}/d/{d}"), None),
        ("GET", format!("/api/t/{t}/d/{d}/human-html"), None),
        ("GET", format!("/api/t/{t}/d/{d}/entry/data"), None),
        (
            "POST",
            format!("/api/t/{t}/d/{d}/edit-mode"),
            Some(json!({ "on": true })),
        ),
        (
            "POST",
            format!("/api/t/{t}/d/{d}/patch"),
            Some(json!({ "id": "x", "content": "y" })),
        ),
        (
            "POST",
            format!("/api/t/{t}/d/{d}/spinoff"),
            Some(json!({ "app_id": "ie.napkin.brief-maker" })),
        ),
        ("GET", format!("/api/t/{t}/d/{d}/download"), None),
        (
            "POST",
            format!("/api/t/{t}/d/{d}/export"),
            Some(json!({ "kind": "html" })),
        ),
        ("POST", format!("/api/t/{t}/apps/from/{d}"), None),
        ("GET", format!("/api/t/{t}/library"), None),
        ("GET", format!("/api/t/{t}/search?q=hal"), None),
        (
            "GET",
            format!("/api/t/{t}/search?q=mail.example.test"),
            None,
        ),
    ] {
        let (st, text) = send(m, uri.clone(), body, c.map(String::from)).await;
        if leaks_in(&text) || (st.is_success() && uri.contains(d)) {
            leaks.push(format!("{m} {uri} {st}"));
        }
    }
    let clan = clan_sdk::create(clan_sdk::CreateOptions {
        title: "A brief".into(),
        brief: "test brief".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/t/{t}/documents/upload"))
        .header(header::COOKIE, &bria.cookie)
        .body(Body::from(clan))
        .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    let doc: Value =
        serde_json::from_slice(&resp.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let token = doc["token"].as_str().unwrap().to_string();
    for (m, path, body) in [
        ("GET", "recent", None),
        ("GET", "related", None),
        ("GET", "upstream", None),
        ("GET", "attach-targets", None),
        ("POST", "open", Some(json!({ "path": d }))),
        (
            "POST",
            "merge",
            Some(json!({ "branches": [d], "agent": "human", "action": "merge" })),
        ),
        ("POST", "cite", Some(json!({ "doc": d, "path": "people" }))),
        (
            "POST",
            "spinoff",
            Some(json!({ "source": d, "app": "brief-maker" })),
        ),
        ("POST", "launch", Some(json!({ "path": d }))),
    ] {
        let (_, text) = send(m, format!("/s/{token}/{path}"), body, None).await;
        if leaks_in(&text) {
            leaks.push(format!("{m} /s/token/{path}"));
        }
    }
    assert_eq!(
        registry_people(&root, "bq"),
        before,
        "the registry was written"
    );
    assert!(leaks.is_empty(), "{leaks:#?}");
}

/// Review g2: a member's write to the registry before the deploy, naming the admin as its agent with a text of
/// their own and a new agency name, reaches neither the audit view nor the agency's name.
#[tokio::test]
async fn a_forged_registry_decision_reaches_neither_the_audit_view_nor_the_agency_name() {
    let r = rig();
    let root = r.dir.path().to_path_buf();
    invite(&root, "bq", "barra@bq", "hal@bq", &["planning"]);
    let mut people = registry_people(&root, "bq");
    people[0]["name"] = json!("B");
    member_posts(
        &root,
        "bq",
        "hal@bq",
        json!({
            "agent": "human:barra@bq", "action": "set_roles",
            "rationale": "Changed the roles of ad@bq from admin to planning. FORGED-BY-HAL",
            "patch": { "people": people, "settings": { "name": "Owned by hal" } },
        }),
    );
    // an older server copied the registry's chain into the log as it was read then
    let ws_store = store_of(&root, "bq");
    for d in agency::history(&ws_store).unwrap() {
        r.ctx
            .audit
            .append(
                &TenantId::of_agency("bq"),
                napkin_web::audit::NewLine {
                    who: d.who,
                    kind: napkin_web::audit::PERMISSION,
                    what: d.what,
                    reference: d.id,
                    ..Default::default()
                },
            )
            .unwrap();
    }
    napkin_web::people_import::run(r.ctx.people().unwrap(), &root).unwrap();
    let barra = try_sign_in(&r, "barra@bq").await.unwrap();
    let (st, audit) = call(
        &r,
        "GET",
        &format!("/api/t/{}/audit", barra.tenant),
        Some(&barra.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert!(!audit.to_string().contains("FORGED-BY-HAL"), "{audit}");
    let (_, verify) = call(
        &r,
        "GET",
        &format!("/api/t/{}/audit/verify", barra.tenant),
        Some(&barra.cookie),
        None,
    )
    .await;
    assert_eq!(
        verify["ok"],
        json!(false),
        "verify vouches for copied lines: {verify}"
    );
    assert_eq!(verify["chain_intact"], json!(true), "{verify}");
    assert!(verify["not_verified"].as_u64().unwrap() > 0, "{verify}");
    for who in ["bria@bq", "barra@bq"] {
        let w = try_sign_in(&r, who).await.unwrap();
        let (_, s) = call(
            &r,
            "GET",
            &format!("/api/t/{}/agency", w.tenant),
            Some(&w.cookie),
            None,
        )
        .await;
        assert!(!s.to_string().contains("Owned by hal"), "{who}: {s}");
    }
}

#[test]
fn an_import_records_at_most_its_cap_of_removed_entries_from_one_registry() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "hal@bq", &["planning"]);
    let mut people = registry_people(root, "bq");
    let cap = napkin_web::people_import::MAX_REMOVED_PER_REGISTRY;
    for i in 0..cap + 50 {
        people.as_array_mut().unwrap().push(json!({
            "username": format!("p{i}@bq"), "name": format!("P {i}"), "email": format!("p{i}@mail.example.test"),
            "roles": ["planning"], "state": "active", "invited_by": "barra@bq", "at": "2026-11-01T00:00:00Z",
        }));
    }
    member_writes(root, "bq", "hal@bq", people);
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    let removed = p
        .book()
        .people
        .iter()
        .filter(|x| x.agency == "bq" && !x.active())
        .count();
    assert_eq!(removed, cap);
}
