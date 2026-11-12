// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The People page's routes, driven through the real router on a roster
//! server (features/people-admin.clan): only engineer@napkin may use them, an
//! added person signs in at once, a removed one is signed out, and a new
//! agency's look is served to the shell.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::NoConfig;
use napkin_web::state::AppCtx;
use serde_json::{json, Value};
use tower::ServiceExt;

const ROSTER: &str = "# the studio\nengineer@napkin\tShrey\nann@napkin\tAnn Murphy\nsai@napkin\tSai Eeshwar\nplu@pluto\tPluto Test\nmock@boysandgirls\n";

struct Server {
    _dir: tempfile::TempDir,
    app: Router,
}

fn server() -> Server {
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
    let app = napkin_web::router_with(ctx, None, Arc::new(identity));
    Server { _dir: dir, app }
}

async fn call(
    s: &Server,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value, Option<String>) {
    let mut b = Request::builder().method(method).uri(uri);
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, c);
    }
    let req = match body {
        Some(v) => b
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(v.to_string()))
            .unwrap(),
        None => b.body(Body::empty()).unwrap(),
    };
    let resp = s.app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let cookie = resp
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("napkin_session="))
        .map(|v| v.split(';').next().unwrap().to_string());
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        cookie,
    )
}

async fn sign_in(s: &Server, username: &str) -> Result<String, StatusCode> {
    let (st, _, c) = call(
        s,
        "POST",
        "/api/auth/sign-in",
        None,
        Some(json!({ "username": username })),
    )
    .await;
    if st == StatusCode::OK {
        Ok(c.expect("a session cookie"))
    } else {
        Err(st)
    }
}

#[tokio::test]
async fn every_admin_route_is_403_for_anyone_but_engineer_at_napkin() {
    let s = server();
    assert_eq!(napkin_web::people::PEOPLE_ADMINS, &["engineer@napkin"]);
    let routes: [(&str, &str, Option<Value>); 6] = [
        ("GET", "/api/admin/people", None),
        (
            "POST",
            "/api/admin/people",
            Some(json!({"name": "X Y", "agency": "napkin"})),
        ),
        (
            "PATCH",
            "/api/admin/people/sai@napkin",
            Some(json!({"name": "Sai"})),
        ),
        ("DELETE", "/api/admin/people/sai@napkin", None),
        ("GET", "/api/admin/agencies", None),
        (
            "POST",
            "/api/admin/agencies",
            Some(json!({"name": "Rothco", "base": "#0F6B5C", "accent": "#9FE6D8"})),
        ),
    ];
    for who in ["ann@napkin", "plu@pluto", "mock@boysandgirls"] {
        let c = sign_in(&s, who).await.unwrap();
        for (m, u, b) in routes.iter().cloned() {
            let (st, v, _) = call(&s, m, u, Some(&c), b).await;
            assert_eq!(st, StatusCode::FORBIDDEN, "{who} {m} {u}");
            assert!(v["error"].as_str().unwrap().contains("Ask Shrey"));
        }
    }
    // nobody signed in: the session layer answers first
    for (m, u, b) in routes.iter().cloned() {
        let (st, _, _) = call(&s, m, u, None, b).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED, "{m} {u}");
    }
    // nothing changed
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    let (st, v, _) = call(&s, "GET", "/api/admin/people", Some(&me), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["people"].as_array().unwrap().len(), 5);
    assert!(v["people"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["removed_at"].is_null()));
}

#[tokio::test]
async fn the_seed_imports_every_roster_line() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    let (_, v, _) = call(&s, "GET", "/api/admin/people", Some(&me), None).await;
    let ids: Vec<&str> = v["people"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        [
            "engineer@napkin",
            "ann@napkin",
            "sai@napkin",
            "plu@pluto",
            "mock@boysandgirls"
        ]
    );
    for id in ids {
        assert!(sign_in(&s, id).await.is_ok(), "{id} keeps access");
    }
    let agencies = v["agencies"].as_array().unwrap();
    let napkin = agencies.iter().find(|a| a["id"] == "napkin").unwrap();
    assert_eq!(
        (napkin["people"].as_u64(), napkin["source"].as_str()),
        (Some(3), Some("code"))
    );
}

#[tokio::test]
async fn an_added_person_signs_in_at_once_and_a_removed_one_cannot() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    assert_eq!(
        sign_in(&s, "shaunagh@napkin").await,
        Err(StatusCode::UNAUTHORIZED)
    );

    let (st, v, _) = call(
        &s,
        "POST",
        "/api/admin/people",
        Some(&me),
        Some(json!({"name": "Shaunagh Kelly", "agency": "Napkin"})),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    assert_eq!(v["id"], "shaunagh@napkin");
    assert_eq!(v["added_by"], "engineer@napkin");

    // no restart: the next sign-in finds them
    let theirs = sign_in(&s, "shaunagh@napkin").await.unwrap();
    let (_, who, _) = call(&s, "GET", "/api/session", Some(&theirs), None).await;
    assert_eq!(who["user"]["name"], "Shaunagh Kelly");

    // the same person twice is a conflict
    let (st, _, _) = call(
        &s,
        "POST",
        "/api/admin/people",
        Some(&me),
        Some(json!({"name": "Shaunagh", "agency": "napkin"})),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);

    // rename: the name people see changes, the sign-in name stays
    let (st, v, _) = call(
        &s,
        "PATCH",
        "/api/admin/people/shaunagh@napkin",
        Some(&me),
        Some(json!({"name": "Shaunagh K."})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["name"], "Shaunagh K.");
    let again = sign_in(&s, "shaunagh@napkin").await.unwrap();
    let (_, who, _) = call(&s, "GET", "/api/session", Some(&again), None).await;
    assert_eq!(who["user"]["name"], "Shaunagh K.");

    // remove: they cannot sign in, and the session they had stops working
    let (st, v, _) = call(
        &s,
        "DELETE",
        "/api/admin/people/shaunagh@napkin",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert!(v["removed_at"].is_string());
    assert_eq!(
        sign_in(&s, "shaunagh@napkin").await,
        Err(StatusCode::UNAUTHORIZED)
    );
    let (st, _, _) = call(&s, "GET", "/api/session", Some(&theirs), None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    // they stay on the list, removed, with their history
    let (_, v, _) = call(&s, "GET", "/api/admin/people", Some(&me), None).await;
    let p = v["people"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "shaunagh@napkin")
        .unwrap()
        .clone();
    assert!(p["removed_at"].is_string());
    // an admin cannot remove themselves
    let (st, _, _) = call(
        &s,
        "DELETE",
        "/api/admin/people/engineer@napkin",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
}

#[tokio::test]
async fn an_agency_is_recognised_by_its_id_name_or_alias() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    for (name, agency, want) in [
        ("Ann Two", "napkin", "ann.two@napkin"),
        ("Bea Byrne", "Boys+Girls", "bea@boysandgirls"),
        ("Cal Cole", "bg", "cal@boysandgirls"),
        ("Dee Doyle", "PLUTO", "dee@pluto"),
        ("Eve Earls", "Wieden+Kennedy", "eve@wk"),
    ] {
        let username = (want == "ann.two@napkin").then_some(want);
        let (st, v, _) = call(
            &s,
            "POST",
            "/api/admin/people",
            Some(&me),
            Some(json!({"name": name, "agency": agency, "username": username})),
        )
        .await;
        assert_eq!(st, StatusCode::CREATED, "{agency}: {v}");
        assert_eq!(v["id"], want, "{agency}");
    }
    // an agency nobody has added is refused, with what to do
    let (st, v, _) = call(
        &s,
        "POST",
        "/api/admin/people",
        Some(&me),
        Some(json!({"name": "Aoife Byrne", "agency": "Rothco"})),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert!(v["error"].as_str().unwrap().contains("new agency"));
}

#[tokio::test]
async fn a_new_agency_is_created_with_its_look_and_served_to_the_shell() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    let (st, v, _) = call(
        &s,
        "POST",
        "/api/admin/agencies",
        Some(&me),
        Some(json!({"name": "Rothco", "base": "#0f6b5c", "accent": "#9FE6D8"})),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    assert_eq!(
        (v["id"].as_str(), v["base"].as_str()),
        (Some("rothco"), Some("#0F6B5C"))
    );
    for (body, want) in [
        (
            json!({"name": "Rothco", "base": "#000000", "accent": "#FFFFFF"}),
            StatusCode::CONFLICT,
        ),
        (
            json!({"name": "bg", "base": "#000000", "accent": "#FFFFFF"}),
            StatusCode::CONFLICT,
        ),
        (
            json!({"name": "Kin", "base": "blue", "accent": "#FFFFFF"}),
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let (st, _, _) = call(
            &s,
            "POST",
            "/api/admin/agencies",
            Some(&me),
            Some(body.clone()),
        )
        .await;
        assert_eq!(st, want, "{body}");
    }
    let (st, v, _) = call(
        &s,
        "POST",
        "/api/admin/people",
        Some(&me),
        Some(json!({"name": "Aoife Byrne", "agency": "rothco"})),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(v["id"], "aoife@rothco");
    let aoife = sign_in(&s, "aoife@rothco").await.unwrap();

    // the looks are public: the sign-in card reads them before anyone signs in
    let (st, looks, _) = call(&s, "GET", "/api/agency-looks", None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        looks,
        json!([{"id": "rothco", "name": "Rothco", "base": "#0F6B5C", "accent": "#9FE6D8", "aliases": []}])
    );
    let (st, _, _) = call(&s, "GET", "/api/agency-looks", Some(&aoife), None).await;
    assert_eq!(st, StatusCode::OK);
    // the admin list counts them in it
    let (_, all, _) = call(&s, "GET", "/api/admin/agencies", Some(&me), None).await;
    let r = all
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == "rothco")
        .unwrap()
        .clone();
    assert_eq!(
        (r["source"].as_str(), r["people"].as_u64()),
        (Some("added"), Some(1))
    );
}
