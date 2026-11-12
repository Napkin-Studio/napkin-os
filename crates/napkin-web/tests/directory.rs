// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/agency-setup.clan, stage 1, through the real router: the directory decides sign-in and
//! roles for an agency that has one, a role change or a removal reaches the next request after the
//! cache window with no new sign-in, only an admin edits the people, the last admin stays, and the
//! people list is an allow list (emails for admins only).

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::agency;
use napkin_host::{Ctx, NoConfig};
use napkin_web::state::AppCtx;
use napkin_web::tenant::TenantId;
use serde_json::{json, Value};
use tower::ServiceExt;

struct Rig {
    dir: tempfile::TempDir,
    app: Router,
    clock: Arc<AtomicI64>,
}

struct Person {
    cookie: String,
    tenant: String,
}

const ROSTER: &str = "cara@cr\tCara\tadmin\n\
dan@cr\tDan From The File\tmanagement\n\
sam@cr\tSam\tplanning\n\
barra@bq\tBarra\tadmin\n\
niamh@bq\tNiamh\tmanagement\n\
noel@nodir\tNoel\ttraffic\n";

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicI64::new(1_000_000));
    let c = clock.clone();
    let ctx = Arc::new(
        AppCtx::new(dir.path().to_path_buf(), Arc::new(NoConfig), None, 40)
            .with_directory_clock(move || c.load(Ordering::SeqCst)),
    );
    let roster = dir.path().join("accounts.tsv");
    std::fs::write(&roster, ROSTER).unwrap();
    let identity = napkin_web::tenant::Identity {
        mode: napkin_web::tenant::Mode::Accounts {
            provider: napkin_web::auth::Provider::Roster(
                napkin_web::auth::Roster::new(roster).unwrap(),
            ),
            sessions: napkin_web::auth::Sessions::new(&[9u8; 32]).unwrap(),
        },
        secure: false,
    };
    Rig {
        app: napkin_web::router_with(ctx, None, Arc::new(identity)),
        dir,
        clock,
    }
}

async fn call(
    r: &Rig,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value, axum::http::HeaderMap) {
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        headers,
    )
}

async fn try_sign_in(r: &Rig, who: &str) -> (StatusCode, Value, Option<String>) {
    let (st, body, h) = call(
        r,
        "POST",
        "/api/auth/sign-in",
        None,
        Some(json!({ "username": who })),
    )
    .await;
    let cookie = h
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("napkin_session=") && !v.starts_with("napkin_session=;"))
        .map(|v| v.split(';').next().unwrap().to_string());
    (st, body, cookie)
}

async fn sign_in(r: &Rig, who: &str) -> Person {
    let (st, body, cookie) = try_sign_in(r, who).await;
    assert_eq!(st, StatusCode::OK, "{who}: {body}");
    let cookie = cookie.unwrap();
    let (_, me, _) = call(r, "GET", "/api/session", Some(&cookie), None).await;
    Person {
        cookie,
        tenant: me["tenant"].as_str().unwrap().to_string(),
    }
}

/// Every field of a person, through the API as the admin.
async fn invite(r: &Rig, admin: &Person, username: &str, name: &str, roles: &[&str]) {
    let (st, body, _) = call(
        r,
        "POST",
        &format!("/api/t/{}/agency/people/invite", admin.tenant),
        Some(&admin.cookie),
        Some(json!({ "username": username, "name": name, "email": format!("{}@mail.example.test", username.split('@').next().unwrap()), "roles": roles })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{body}");
}

async fn doors(r: &Rig, p: &Person) -> Vec<String> {
    let (st, v, _) = call(
        r,
        "GET",
        &format!("/api/t/{}/doors", p.tenant),
        Some(&p.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    v["doors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["name"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn an_agency_with_no_directory_signs_in_as_before() {
    let r = rig();
    let noel = sign_in(&r, "noel@nodir").await;
    let (_, me, _) = call(&r, "GET", "/api/session", Some(&noel.cookie), None).await;
    assert_eq!(me["roles"], json!(["traffic"]));
    let (_, people, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/agency/people", noel.tenant),
        Some(&noel.cookie),
        None,
    )
    .await;
    assert_eq!(people, json!([]), "a roster is not a directory");
    let (st, _, _) = try_sign_in(&r, "nobody@nodir").await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn with_a_directory_it_is_the_only_source_of_who_signs_in_and_as_what() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "Dan Directory", &["traffic"]).await;
    // the roster line for dan says management; the directory says traffic
    let dan = sign_in(&r, "dan@cr").await;
    let (_, me, _) = call(&r, "GET", "/api/session", Some(&dan.cookie), None).await;
    assert_eq!(me["roles"], json!(["traffic"]));
    assert_eq!(me["user"]["name"], json!("Dan Directory"));
    // sam is on the roster file but not in the directory: refused with the roster's own line
    let (st, body, cookie) = try_sign_in(&r, "sam@cr").await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    assert!(cookie.is_none());
    assert_eq!(
        body["error"],
        json!("That name is not on this studio's list. Ask your studio admin to add you.")
    );
    // another agency's roster is untouched
    sign_in(&r, "niamh@bq").await;
    // a first sign-in made dan active
    let (_, people, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/agency/people", cara.tenant),
        Some(&cara.cookie),
        None,
    )
    .await;
    let dan_row = people
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["username"] == "dan@cr")
        .unwrap()
        .clone();
    assert_eq!(dan_row["state"], json!("active"));
}

#[tokio::test]
async fn the_people_list_is_an_allow_list_and_emails_are_for_admins_only() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "Dan Test", &["management"]).await;
    let dan = sign_in(&r, "dan@cr").await;
    let url = |p: &Person| format!("/api/t/{}/agency/people", p.tenant);
    let (st, admin_view, _) = call(&r, "GET", &url(&cara), Some(&cara.cookie), None).await;
    assert_eq!(st, StatusCode::OK);
    let row = &admin_view
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["username"] == "dan@cr")
        .unwrap();
    for key in [
        "username",
        "name",
        "roles",
        "email",
        "state",
        "invited_by",
        "at",
    ] {
        assert!(row.get(key).is_some(), "an admin sees {key}");
    }
    assert_eq!(row["email"], json!("dan@mail.example.test"));
    let (_, member_view, _) = call(&r, "GET", &url(&dan), Some(&dan.cookie), None).await;
    for p in member_view.as_array().unwrap() {
        let mut keys: Vec<&str> = p.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(keys, ["name", "roles", "username"], "{p}");
    }
    assert!(!member_view.to_string().contains("mail.example.test"));
}

#[tokio::test]
async fn only_an_admin_changes_people_and_the_last_admin_stays() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "Dan Test", &["management"]).await;
    let dan = sign_in(&r, "dan@cr").await;
    let put = |p: &Person, who: &str, body: Value| {
        let uri = format!("/api/t/{}/agency/people/{who}", p.tenant);
        let cookie = p.cookie.clone();
        let r = &r;
        async move { call(r, "PUT", &uri, Some(&cookie), Some(body)).await }
    };
    // management is 403, admin is 200
    assert_eq!(
        put(&dan, "dan@cr", json!({ "roles": ["admin"] })).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        put(&cara, "dan@cr", json!({ "roles": ["planning"] }))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&r, "POST", &format!("/api/t/{}/agency/people/invite", dan.tenant), Some(&dan.cookie),
            Some(json!({ "username": "x@cr", "name": "X", "email": "x@x.test", "roles": ["traffic"] }))).await.0,
        StatusCode::FORBIDDEN
    );
    // the only admin cannot be removed or demoted
    let (st, _, _) = call(
        &r,
        "DELETE",
        &format!("/api/t/{}/agency/people/cara@cr", cara.tenant),
        Some(&cara.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(
        put(&cara, "cara@cr", json!({ "roles": ["planning"] }))
            .await
            .0,
        StatusCode::CONFLICT
    );
    // a role the table does not know, and no role at all, are 400
    assert_eq!(
        put(&cara, "dan@cr", json!({ "roles": ["wizard"] })).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        put(&cara, "dan@cr", json!({ "roles": [] })).await.0,
        StatusCode::BAD_REQUEST
    );
    // another agency's sign-in name is not editable here
    assert_eq!(
        put(&cara, "niamh@bq", json!({ "roles": ["planning"] }))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn an_admin_naming_another_agencys_tenant_gets_403_on_every_route() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "Dan Test", &["management"]).await;
    let barra = sign_in(&r, "barra@bq").await;
    assert_ne!(cara.tenant, barra.tenant);
    let t = &cara.tenant;
    for (m, path, body) in [
        ("GET", "agency/people".to_string(), None),
        (
            "POST",
            "agency/people/invite".to_string(),
            Some(
                json!({ "username": "z@bq", "name": "Z", "email": "z@z.test", "roles": ["traffic"] }),
            ),
        ),
        (
            "PUT",
            "agency/people/dan@cr".to_string(),
            Some(json!({ "roles": ["traffic"] })),
        ),
        ("DELETE", "agency/people/dan@cr".to_string(), None),
    ] {
        let (st, _, _) = call(
            &r,
            m,
            &format!("/api/t/{t}/{path}"),
            Some(&barra.cookie),
            body,
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{m} {path}");
    }
    let (_, people, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/agency/people", barra.tenant),
        Some(&barra.cookie),
        None,
    )
    .await;
    assert_eq!(
        people,
        json!([]),
        "the second agency sees none of the first's people"
    );
}

fn host_edit(r: &Rig, f: impl FnOnce(&dyn napkin_host::DocStore, &Ctx)) {
    let store =
        napkin_web::store::TenantStore::new(r.dir.path().join(TenantId::of_agency("cr").as_str()));
    let ctx = TenantId::of_agency("cr").ctx_for("cara@cr");
    f(&store, &ctx);
}

#[tokio::test]
async fn a_role_change_reaches_the_next_request_after_the_cache_window_with_no_new_sign_in() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "Dan Test", &["management", "planning"]).await;
    let dan = sign_in(&r, "dan@cr").await;
    let (st, _, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/client-brains", dan.tenant),
        Some(&dan.cookie),
        None,
    )
    .await;
    assert_ne!(st, StatusCode::FORBIDDEN, "planning may open client brains");
    assert!(doors(&r, &dan).await.contains(&"Brief".to_string()));
    // changed behind the server's back (another process, a person editing the file): the cache holds
    // for a minute, then the next request reads the new roles
    host_edit(&r, |store, ctx| {
        let known = |_: &str| true;
        agency::edit_person(
            store,
            ctx,
            "dan@cr",
            agency::PersonPatch {
                roles: Some(vec!["management".into()]),
                ..Default::default()
            },
            &known,
        )
        .unwrap();
    });
    assert!(
        doors(&r, &dan).await.contains(&"Brief".to_string()),
        "still inside the window"
    );
    r.clock.fetch_add(61, Ordering::SeqCst);
    let after = doors(&r, &dan).await;
    assert!(!after.contains(&"Brief".to_string()));
    assert!(after.contains(&"Agency dashboard".to_string()));
    let (st, _, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/client-brains", dan.tenant),
        Some(&dan.cookie),
        None,
    )
    .await;
    assert_eq!(
        st,
        StatusCode::FORBIDDEN,
        "planning-only route, after the window"
    );
}

#[tokio::test]
async fn a_change_made_through_the_api_is_seen_at_once_and_a_removed_person_gets_401() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "Dan Test", &["planning"]).await;
    let dan = sign_in(&r, "dan@cr").await;
    let (st, _, _) = call(
        &r,
        "PUT",
        &format!("/api/t/{}/agency/people/dan@cr", cara.tenant),
        Some(&cara.cookie),
        Some(json!({ "roles": ["traffic"] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert!(doors(&r, &dan).await.contains(&"Traffic board".to_string()));
    let (st, _, _) = call(
        &r,
        "DELETE",
        &format!("/api/t/{}/agency/people/dan@cr", cara.tenant),
        Some(&cara.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, body, h) = call(&r, "GET", "/api/session", Some(&dan.cookie), None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    assert_eq!(body["signin"], json!(true));
    let cleared = h
        .get_all(header::SET_COOKIE)
        .iter()
        .any(|v| v.to_str().unwrap().starts_with("napkin_session=;"));
    assert!(cleared, "the cookie is cleared");
    // and cannot sign in again
    assert_eq!(try_sign_in(&r, "dan@cr").await.0, StatusCode::UNAUTHORIZED);
    // a removed person is not in the list a member reads
    let (_, people, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/agency/people", cara.tenant),
        Some(&cara.cookie),
        None,
    )
    .await;
    assert_eq!(
        people
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["username"] == "dan@cr")
            .unwrap()["state"],
        json!("removed")
    );
}

#[tokio::test]
async fn a_listed_person_whose_roles_were_emptied_by_hand_gets_403_not_every_door() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "Dan Test", &["planning"]).await;
    let dan = sign_in(&r, "dan@cr").await;
    // the file edited by hand: dan's roles emptied. Through the host the roles are refused, so write the YAML.
    let store =
        napkin_web::store::TenantStore::new(r.dir.path().join(TenantId::of_agency("cr").as_str()));
    use napkin_host::{Library, PartStore};
    let id = store.home("agency-v1").unwrap();
    let clan = clan_sdk::ClanFile::from_bytes(store.read(&id).unwrap()).unwrap();
    let yaml = String::from_utf8(clan.read_entry("shared/data.yaml").unwrap()).unwrap();
    let edited = yaml
        .replacen("- planning", "[]", 1)
        .replace("roles:\n  []", "roles: []");
    assert_ne!(yaml, edited);
    let mut b = clan_sdk::ClanBuilder::new(clan.manifest().clone());
    for (p, bytes) in clan.read_all_entries().unwrap() {
        if p != "manifest.yaml" && p != "shared/data.yaml" {
            b.add_entry(p, bytes);
        }
    }
    b.add_entry("shared/data.yaml", edited.into_bytes());
    let v = store.version(&id).unwrap();
    store
        .apply(&napkin_host::Change::replace(id, v, b.build().unwrap()))
        .unwrap();
    r.clock.fetch_add(61, Ordering::SeqCst);
    let (st, _, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/doors", dan.tenant),
        Some(&dan.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/library", dan.tenant),
        Some(&dan.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_registry_that_does_not_parse_refuses_changes_not_sign_ins() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "Dan Test", &["planning"]).await;
    // break the document
    let dir = r.dir.path().join(TenantId::of_agency("cr").as_str());
    std::fs::write(dir.join("home-agency-v1.clan"), b"not a clan").unwrap();
    r.clock.fetch_add(61, Ordering::SeqCst);
    // sign-in still works (from the roster, since no directory can be read), and a write is refused
    let cara = sign_in(&r, "cara@cr").await;
    let (st, _, _) = call(
        &r,
        "PUT",
        &format!("/api/t/{}/agency/people/dan@cr", cara.tenant),
        Some(&cara.cookie),
        Some(json!({ "roles": ["traffic"] })),
    )
    .await;
    assert!(
        st.as_u16() >= 400,
        "a write to a registry that cannot be read is refused, not {st}"
    );
}
