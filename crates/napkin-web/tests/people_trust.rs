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

// ── finding 1: what the import takes from a registry ────────────────────────

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
fn the_import_keeps_only_roles_the_store_defines() {
    let dir = fresh();
    let root = dir.path();
    let any = |_: &str| true;
    let ctx = TenantId::of_agency("bq").ctx_for("barra@bq");
    for (u, roles) in [
        ("dee@bq", vec!["napkin-admin", "planning"]),
        ("eli@bq", vec!["demo"]),
        ("fox@bq", vec!["wizard"]),
    ] {
        agency::invite(
            &store_of(root, "bq"),
            &ctx,
            NewPerson {
                username: u.into(),
                name: u.into(),
                email: format!("{}@mail.example.test", u.split('@').next().unwrap()),
                roles: roles.into_iter().map(String::from).collect(),
            },
            &any,
        )
        .unwrap();
    }
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    assert_eq!(p.active("dee@bq").unwrap().roles, ["planning"]);
    // left with no role the store defines: kept for the record, and cannot sign in
    for u in ["eli@bq", "fox@bq"] {
        assert!(p.active(u).is_none(), "{u}");
        assert!(p.book().person(u).unwrap().roles.is_empty(), "{u}");
    }
    for u in ["dee@bq", "eli@bq", "fox@bq"] {
        let roles = p.book().person(u).unwrap().roles.clone();
        assert!(
            !napkin_web::roles::allowed(&roles, "/control/agencies", None),
            "{u}"
        );
    }
}

#[test]
fn the_import_never_overwrites_or_removes_a_person_the_store_has() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "bria@bq", &["traffic"]);
    invite(root, "bq", "barra@bq", "ad@wk", &["traffic"]);
    invite(root, "bq", "barra@bq", "engineer@napkin", &["traffic"]);
    let ctx = TenantId::of_agency("bq").ctx_for("barra@bq");
    agency::remove_person(&store_of(root, "bq"), &ctx, "ad@wk").unwrap();
    agency::remove_person(&store_of(root, "bq"), &ctx, "engineer@napkin").unwrap();
    agency::remove_person(&store_of(root, "bq"), &ctx, "bria@bq").unwrap();
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    assert!(
        p.active("ad@wk").is_some(),
        "wk lost its only admin to bq's registry"
    );
    assert_eq!(p.book().admins_of("wk"), 1);
    assert!(
        p.active("engineer@napkin").is_some(),
        "the Napkin admin was removed"
    );
    // bria is in the store already: the registry's removal and its role do not reach her
    assert_eq!(p.active("bria@bq").unwrap().roles, ["planning"]);
}

#[test]
fn an_admin_role_is_imported_only_where_the_chain_shows_an_admin_wrote_it() {
    let dir = fresh();
    let root = dir.path();
    // barra (bq's first admin) names gil an admin and hal a planner: both written by an admin
    invite(root, "bq", "barra@bq", "gil@bq", &["admin"]);
    invite(root, "bq", "barra@bq", "hal@bq", &["planning"]);
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    assert_eq!(p.active("gil@bq").unwrap().roles, ["admin"]);
    assert_eq!(p.active("hal@bq").unwrap().roles, ["planning"]);
}

#[test]
fn a_registry_a_member_wrote_is_imported_with_no_one_new_able_to_sign_in() {
    let dir = fresh();
    let root = dir.path();
    invite(root, "bq", "barra@bq", "hal@bq", &["planning"]);
    // a member (hal) rewrites the people: himself an admin, a stranger an admin, a planner planted
    let mut people = registry_people(root, "bq");
    for x in people.as_array_mut().unwrap() {
        if x["username"] == "hal@bq" {
            x["roles"] = json!(["admin"]);
        }
    }
    people.as_array_mut().unwrap().push(json!({
        "username": "mal@bq", "name": "Mal", "email": "m@mail.example.test",
        "roles": ["admin"], "state": "active", "invited_by": "barra@bq", "at": "2026-11-01T00:00:00Z",
    }));
    people.as_array_mut().unwrap().push(json!({
        "username": "pip@bq", "name": "Pip", "email": "p@mail.example.test",
        "roles": ["planning"], "state": "active", "invited_by": "barra@bq", "at": "2026-11-01T00:00:00Z",
    }));
    member_writes(root, "bq", "hal@bq", people);
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    // nobody the registry names after a member's write can sign in from it: kept as removed, no roles
    for u in ["hal@bq", "mal@bq", "pip@bq"] {
        assert!(p.active(u).is_none(), "{u} signs in from a member's write");
        assert!(
            p.book().person(u).unwrap().roles.is_empty(),
            "{u} kept a role from a member's write"
        );
    }
    // the store's own people are untouched
    assert_eq!(p.active("barra@bq").unwrap().roles, ["admin"]);
    assert_eq!(p.active("bria@bq").unwrap().roles, ["planning"]);
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
