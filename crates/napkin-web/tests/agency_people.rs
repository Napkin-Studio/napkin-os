// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/agency-setup.clan, stage 1, through the real router, on the one People store that replaced
//! the agency directory (features/align-needs-lock-people.clan, stage 3): an agency's admin names people
//! and they sign in as what the store says, a removal reaches the next request, only an admin edits the
//! people, the last admin stays, and the people list is an allow list (emails for admins only). The
//! directory's own cases (its cache window, a registry edited by hand) went with it.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::NoConfig;
use napkin_web::state::AppCtx;
use serde_json::{json, Value};
use tower::ServiceExt;

struct Rig {
    _dir: tempfile::TempDir,
    app: Router,
}

struct Person {
    cookie: String,
    tenant: String,
}

const ROSTER: &str = "cara@cr\tCara\tadmin\n\
barra@bq\tBarra\tadmin\n\
niamh@bq\tNiamh\tmanagement\n\
noel@nodir\tNoel\ttraffic\n";

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
        app: napkin_web::router_with(ctx, None, Arc::new(identity)),
        _dir: dir,
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
        "/api/admin/people",
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
    v["pages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["name"].as_str().unwrap().to_string())
        .collect()
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
    let (_, people, _) = call(&r, "GET", "/api/admin/people", Some(&cara.cookie), None).await;
    let dan_row = people["people"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "dan@cr")
        .unwrap()
        .clone();
    assert!(dan_row["removed_at"].is_null());
}

#[tokio::test]
async fn the_people_list_is_an_allow_list_and_emails_are_for_admins_only() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "Dan Test", &["management"]).await;
    let dan = sign_in(&r, "dan@cr").await;
    // the People page's list: the admin sees every field of their own agency's people; a member gets nothing
    let url = "/api/admin/people";
    let (st, admin_view, _) = call(&r, "GET", url, Some(&cara.cookie), None).await;
    assert_eq!(st, StatusCode::OK);
    let row = &admin_view["people"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "dan@cr")
        .unwrap();
    for key in [
        "id", "name", "roles", "email", "agency", "added_by", "added_at",
    ] {
        assert!(row.get(key).is_some(), "an admin sees {key}");
    }
    assert_eq!(row["email"], json!("dan@mail.example.test"));
    let (st, member_view, _) = call(&r, "GET", url, Some(&dan.cookie), None).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    assert!(!member_view.to_string().contains("mail.example.test"));
}

#[tokio::test]
async fn only_an_admin_changes_people_and_the_last_admin_stays() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "Dan Test", &["management"]).await;
    let dan = sign_in(&r, "dan@cr").await;
    let put = |p: &Person, who: &str, body: Value| {
        let uri = format!("/api/admin/people/{who}");
        let cookie = p.cookie.clone();
        let r = &r;
        async move { call(r, "PATCH", &uri, Some(&cookie), Some(body)).await }
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
        call(&r, "POST", "/api/admin/people", Some(&dan.cookie),
            Some(json!({ "username": "x@cr", "name": "X", "email": "x@x.test", "roles": ["traffic"] }))).await.0,
        StatusCode::FORBIDDEN
    );
    // the only admin cannot be removed or demoted
    let (st, _, _) = call(
        &r,
        "DELETE",
        &format!("/api/admin/people/cara@cr"),
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
    // another agency's sign-in name is not editable here, and is answered as one nobody holds
    assert_eq!(
        put(&cara, "niamh@bq", json!({ "roles": ["planning"] }))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn an_admin_naming_another_agencys_tenant_gets_403_on_every_route_and_lists_only_their_own() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "Dan Test", &["management"]).await;
    let barra = sign_in(&r, "barra@bq").await;
    assert_ne!(cara.tenant, barra.tenant);
    let t = &cara.tenant;
    for (m, path, body) in [
        ("GET", "agency".to_string(), None),
        ("GET", "agency/accounts.tsv".to_string(), None),
        ("GET", "audit".to_string(), None),
        ("GET", "audit/verify".to_string(), None),
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
    let (_, people, _) = call(&r, "GET", "/api/admin/people", Some(&barra.cookie), None).await;
    assert!(
        people["people"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["id"].as_str().unwrap().ends_with("@bq")),
        "the second agency sees none of the first's people: {people}"
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
        "PATCH",
        &format!("/api/admin/people/dan@cr"),
        Some(&cara.cookie),
        Some(json!({ "roles": ["traffic"] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert!(doors(&r, &dan).await.contains(&"Traffic board".to_string()));
    let (st, _, _) = call(
        &r,
        "DELETE",
        &format!("/api/admin/people/dan@cr"),
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
    // the admin's list keeps them, as removed
    let (_, people, _) = call(&r, "GET", "/api/admin/people", Some(&cara.cookie), None).await;
    assert!(people["people"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "dan@cr")
        .unwrap()["removed_at"]
        .is_string());
}
