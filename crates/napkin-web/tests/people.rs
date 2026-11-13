// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The People page's routes, driven through the real router on a roster
//! server (features/people-admin.clan): only engineer@napkin may use them, an
//! added person signs in at once, a removed one is signed out, and a new
//! agency's look is served to the shell.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, HeaderMap, Request, StatusCode};
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
    server_with(None)
}

/// A server whose people store already holds `people_json` (else it is seeded from ROSTER).
fn server_with(people_json: Option<&str>) -> Server {
    let dir = tempfile::tempdir().unwrap();
    if let Some(j) = people_json {
        std::fs::create_dir_all(dir.path().join("_people")).unwrap();
        std::fs::write(dir.path().join("_people/people.json"), j).unwrap();
    }
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
        (napkin["people"].as_u64(), napkin["kind"].as_str()),
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

/// A request with a raw body and extra headers; the answer's headers come back too.
async fn raw(
    s: &Server,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    headers: &[(&str, &str)],
    body: Vec<u8>,
) -> (StatusCode, Value, HeaderMap) {
    let mut b = Request::builder().method(method).uri(uri);
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, c);
    }
    for (k, v) in headers {
        b = b.header(*k, *v);
    }
    let resp = s
        .app
        .clone()
        .oneshot(b.body(Body::from(body)).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let h = resp.headers().clone();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        h,
    )
}

fn fixture(name: &str) -> Vec<u8> {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../app/tests/fixtures/svg")
        .join(name);
    std::fs::read(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

async fn put_svg(s: &Server, c: &str, id: &str, svg: Vec<u8>) -> (StatusCode, Value) {
    let (st, v, _) = raw(
        s,
        "PUT",
        &format!("/api/admin/agencies/{id}/draft/wordmark"),
        Some(c),
        &[("content-type", "image/svg+xml")],
        svg,
    )
    .await;
    (st, v)
}

async fn row(s: &Server, c: &str, id: &str) -> Value {
    let (st, all, _) = call(s, "GET", "/api/admin/agencies", Some(c), None).await;
    assert_eq!(st, StatusCode::OK);
    all.as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == id)
        .cloned()
        .unwrap_or(Value::Null)
}

async fn looks(s: &Server) -> Value {
    let (st, v, _) = call(s, "GET", "/api/agency-looks", None, None).await;
    assert_eq!(st, StatusCode::OK);
    v
}

/// Create Rothco as a draft and publish it; its rev after.
async fn published_rothco(s: &Server, c: &str) -> u64 {
    let (st, v, _) = call(
        s,
        "POST",
        "/api/admin/agencies",
        Some(c),
        Some(
            json!({"name": "Rothco", "base": "#0f6b5c", "accent": "#9FE6D8", "aliases": ["Roth"]}),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    let (st, v, _) = call(
        s,
        "POST",
        "/api/admin/agencies/rothco/publish",
        Some(c),
        Some(json!({"rev": v["rev"]})),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    v["rev"].as_u64().unwrap()
}

#[tokio::test]
async fn every_agency_route_is_403_for_anyone_but_engineer_at_napkin() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    published_rothco(&s, &me).await;
    let json_routes: [(&str, &str, Option<Value>); 7] = [
        (
            "PATCH",
            "/api/admin/agencies/rothco/draft",
            Some(json!({"accent": "#FFFFFF", "rev": 2})),
        ),
        ("DELETE", "/api/admin/agencies/rothco/draft", None),
        ("DELETE", "/api/admin/agencies/rothco/draft/wordmark", None),
        (
            "POST",
            "/api/admin/agencies/rothco/publish",
            Some(json!({"rev": 2})),
        ),
        ("DELETE", "/api/admin/agencies/pluto/name", None),
        ("GET", "/api/admin/agencies/rothco/export", None),
        ("GET", "/api/admin/agencies", None),
    ];
    for who in ["ann@napkin", "plu@pluto", "aoife@rothco"] {
        if who == "aoife@rothco" {
            let (st, _, _) = call(
                &s,
                "POST",
                "/api/admin/people",
                Some(&me),
                Some(json!({"name": "Aoife", "agency": "rothco"})),
            )
            .await;
            assert_eq!(st, StatusCode::CREATED);
        }
        let c = sign_in(&s, who).await.unwrap();
        for (m, u, b) in json_routes.iter().cloned() {
            let (st, v, _) = call(&s, m, u, Some(&c), b).await;
            assert_eq!(st, StatusCode::FORBIDDEN, "{who} {m} {u}");
            assert!(v["error"].as_str().unwrap().contains("Ask Shrey"));
        }
        let (st, _) = put_svg(&s, &c, "rothco", fixture("groups.svg")).await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{who} PUT wordmark");
    }
    for (m, u, b) in json_routes.iter().cloned() {
        let (st, _, _) = call(&s, m, u, None, b).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED, "{m} {u}");
    }
    // nothing changed
    let r = row(&s, &me, "rothco").await;
    assert_eq!(
        (r["rev"].as_u64(), &r["draft"], &r["wordmark"]),
        (Some(2), &Value::Null, &Value::Null)
    );
}

#[tokio::test]
async fn a_new_basic_agency_is_a_draft_until_published() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    let (st, v, _) = call(
        &s,
        "POST",
        "/api/admin/agencies",
        Some(&me),
        Some(json!({"name": "Rothco", "base": "#0f6b5c", "accent": "#9FE6D8", "aliases": ["Roth", "ROTH"]})),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    assert_eq!(
        v,
        json!({
            "id": "rothco", "kind": "basic", "name": "Rothco", "aliases": ["roth"],
            "base": "#0F6B5C", "accent": "#9FE6D8", "wordmark": null, "published": false,
            "draft": {"name": "Rothco", "aliases": ["roth"], "base": "#0F6B5C", "accent": "#9FE6D8", "wordmark": null},
            "people": 0, "rev": 1,
            "added_by": "engineer@napkin", "added_at": v["added_at"],
            "changed_by": "engineer@napkin", "changed_at": v["changed_at"],
            "published_by": null, "published_at": null,
        })
    );
    // not on /agency-looks, not offered for new people
    assert_eq!(looks(&s).await, json!([]));
    let (st, err, _) = call(
        &s,
        "POST",
        "/api/admin/people",
        Some(&me),
        Some(json!({"name": "Aoife Byrne", "agency": "Roth"})),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert!(
        err["error"].as_str().unwrap().contains("not published yet"),
        "{err}"
    );

    // refusals on create: taken (code name, code alias, a draft's name), colours, unknown keys, no name
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
            json!({"name": "Kin", "base": "#000000", "accent": "#FFFFFF", "aliases": ["droga5"]}),
            StatusCode::CONFLICT,
        ),
        (
            json!({"name": "Kin", "base": "blue", "accent": "#FFFFFF"}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"name": "Kin", "id": "kin", "base": "#000000", "accent": "#FFFFFF"}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"name": "  ", "base": "#000000", "accent": "#FFFFFF"}),
            StatusCode::BAD_REQUEST,
        ),
        (json!({"name": "Kin"}), StatusCode::BAD_REQUEST),
    ] {
        let (st, v, _) = call(
            &s,
            "POST",
            "/api/admin/agencies",
            Some(&me),
            Some(body.clone()),
        )
        .await;
        assert_eq!(st, want, "{body}: {v}");
        assert!(v["error"].is_string(), "{v}");
    }

    // edit the draft, add a wordmark, still nothing public
    let (st, v, _) = call(
        &s,
        "PATCH",
        "/api/admin/agencies/rothco/draft",
        Some(&me),
        Some(json!({"name": "Rothco Dublin", "rev": 1})),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(
        (
            v["rev"].as_u64(),
            v["draft"]["name"].as_str(),
            v["name"].as_str()
        ),
        (Some(2), Some("Rothco Dublin"), Some("Rothco"))
    );
    let (st, up) = put_svg(&s, &me, "rothco", fixture("illustrator.svg")).await;
    assert_eq!(st, StatusCode::OK, "{up}");
    assert_eq!(up["rev"], 3);
    assert_eq!(looks(&s).await, json!([]));

    // publish: live, logged, people can be added
    let (st, v, _) = call(
        &s,
        "POST",
        "/api/admin/agencies/rothco/publish",
        Some(&me),
        Some(json!({"rev": 3})),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(
        (
            v["published"].as_bool(),
            &v["draft"],
            v["name"].as_str(),
            v["rev"].as_u64()
        ),
        (Some(true), &Value::Null, Some("Rothco Dublin"), Some(4))
    );
    assert_eq!(v["published_by"], "engineer@napkin");
    assert_eq!(v["wordmark"], up["svg"]);
    let clean = String::from_utf8(fixture("illustrator.out.svg")).unwrap();
    assert_eq!(
        looks(&s).await,
        json!([{
            "id": "rothco", "name": "Rothco Dublin", "base": "#0F6B5C", "accent": "#9FE6D8",
            "aliases": ["roth"], "rev": 4,
            "logo": napkin_web::svg_sanitise::svg_uri(clean.trim_end()),
        }])
    );
    let (st, p, _) = call(
        &s,
        "POST",
        "/api/admin/people",
        Some(&me),
        Some(json!({"name": "Aoife Byrne", "agency": "Roth"})),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{p}");
    assert_eq!(p["id"], "aoife@rothco");
    assert!(sign_in(&s, "aoife@rothco").await.is_ok());
    assert_eq!(row(&s, &me, "rothco").await["people"], 1);
    // nothing left to publish
    let (st, _, _) = call(
        &s,
        "POST",
        "/api/admin/agencies/rothco/publish",
        Some(&me),
        Some(json!({"rev": 4})),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);

    // every change is on the log
    let log = std::fs::read_to_string(s._dir.path().join("_people/changes.jsonl")).unwrap();
    let whats: Vec<String> = log
        .lines()
        .map(|l| {
            serde_json::from_str::<Value>(l).unwrap()["what"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(
        &whats[1..5],
        [
            "agency drafted",
            "agency draft changed",
            "agency wordmark drafted",
            "agency published"
        ]
    );
}

#[tokio::test]
async fn a_draft_is_never_on_agency_looks_and_discard_drops_it() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    let rev = published_rothco(&s, &me).await;
    let before = looks(&s).await;
    let (st, v, _) = call(
        &s,
        "PATCH",
        "/api/admin/agencies/rothco/draft",
        Some(&me),
        Some(json!({"accent": "#ffffff", "aliases": ["roth", "rc"], "rev": rev})),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(
        v["draft"],
        json!({"name": "Rothco", "aliases": ["roth", "rc"], "base": "#0F6B5C", "accent": "#FFFFFF", "wordmark": null})
    );
    let (st, up) = put_svg(&s, &me, "rothco", fixture("groups.svg")).await;
    assert_eq!(st, StatusCode::OK);
    let r = row(&s, &me, "rothco").await;
    assert_eq!(r["draft"]["wordmark"], up["svg"]);
    assert_eq!(r["wordmark"], Value::Null);
    assert_eq!(looks(&s).await, before, "the public looks carry no draft");
    // a drafted alias is not recognised for new people yet, but is taken
    let (st, _, _) = call(
        &s,
        "POST",
        "/api/admin/people",
        Some(&me),
        Some(json!({"name": "Rob", "agency": "rc"})),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    let (st, _, _) = call(
        &s,
        "POST",
        "/api/admin/agencies",
        Some(&me),
        Some(json!({"name": "RC", "base": "#000000", "accent": "#FFFFFF"})),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    // take the wordmark out of the draft again, then discard
    let (st, v, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/rothco/draft/wordmark",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(v["draft"]["wordmark"], Value::Null);
    let (st, v, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/rothco/draft",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(
        (&v["draft"], v["accent"].as_str()),
        (&Value::Null, Some("#9FE6D8"))
    );
    let (st, _, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/rothco/draft",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "no draft left");
    let (st, _, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/rothco/draft/wordmark",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "no wordmark to remove");
    // an unpublished agency goes with its draft
    let (st, _, _) = call(
        &s,
        "POST",
        "/api/admin/agencies",
        Some(&me),
        Some(json!({"name": "Kin", "base": "#000000", "accent": "#FFFFFF"})),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    let (st, v, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/kin/draft",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(
        (st, v),
        (StatusCode::OK, json!({"id": "kin", "removed": true}))
    );
    assert_eq!(row(&s, &me, "kin").await, Value::Null);
    let (st, _, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/nobody/draft",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_draft_edit_is_refused_in_plain_words() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    let rev = published_rothco(&s, &me).await;
    for (body, want) in [
        (
            json!({"accent": "white", "rev": rev}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"base": "#12345", "rev": rev}),
            StatusCode::BAD_REQUEST,
        ),
        (json!({"accent": "#FFFFFF"}), StatusCode::BAD_REQUEST),
        (json!({"logo": "x", "rev": rev}), StatusCode::BAD_REQUEST),
        (json!({"name": "", "rev": rev}), StatusCode::BAD_REQUEST),
        (
            json!({"accent": "#FFFFFF", "rev": rev - 1}),
            StatusCode::CONFLICT,
        ),
        (json!({"name": "Ogilvy", "rev": rev}), StatusCode::CONFLICT),
        (
            json!({"aliases": ["w+k"], "rev": rev}),
            StatusCode::CONFLICT,
        ),
    ] {
        let (st, v, _) = call(
            &s,
            "PATCH",
            "/api/admin/agencies/rothco/draft",
            Some(&me),
            Some(body.clone()),
        )
        .await;
        assert_eq!(st, want, "{body}: {v}");
        assert!(v["error"].is_string());
    }
    let (st, _, _) = call(
        &s,
        "PATCH",
        "/api/admin/agencies/nobody/draft",
        Some(&me),
        Some(json!({"name": "X", "rev": 0})),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    // stale publish, missing rev
    call(
        &s,
        "PATCH",
        "/api/admin/agencies/rothco/draft",
        Some(&me),
        Some(json!({"accent": "#FFFFFF", "rev": rev})),
    )
    .await;
    let (st, _, _) = call(
        &s,
        "POST",
        "/api/admin/agencies/rothco/publish",
        Some(&me),
        Some(json!({"rev": rev})),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    let (st, _, _) = call(
        &s,
        "POST",
        "/api/admin/agencies/rothco/publish",
        Some(&me),
        Some(json!({})),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    // the same text twice is no change: the draft tidies away
    let (st, v, _) = call(
        &s,
        "PATCH",
        "/api/admin/agencies/rothco/draft",
        Some(&me),
        Some(json!({"accent": "#9fe6d8", "rev": rev + 1})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["draft"], Value::Null);
}

#[tokio::test]
async fn an_uploaded_wordmark_is_cleaned_or_refused_with_where() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    published_rothco(&s, &me).await;
    // taken: what was dropped, what may look different, the cleaned file inline
    let src = fixture("illustrator.svg");
    let (st, v) = put_svg(&s, &me, "rothco", src.clone()).await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let clean = String::from_utf8(fixture("illustrator.out.svg")).unwrap();
    let clean = clean.trim_end();
    assert_eq!(v["bytes"].as_u64(), Some(src.len() as u64));
    assert_eq!(v["kept_bytes"].as_u64(), Some(clean.len() as u64));
    assert_eq!(v["svg"], napkin_web::svg_sanitise::svg_uri(clean));
    assert!(
        v["dropped"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d == "style"),
        "{v}"
    );
    assert!(
        v["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w.as_str().unwrap().contains("Strokes")),
        "{v}"
    );
    // the kept file is the cleaned one, named by its content
    let dir = s._dir.path().join("_people/logos/rothco");
    let files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    assert_eq!(files.len(), 1);
    assert!(
        files[0].starts_with("wordmark-") && files[0].ends_with(".svg"),
        "{files:?}"
    );
    assert_eq!(std::fs::read_to_string(dir.join(&files[0])).unwrap(), clean);

    // 422: active content, with what and where
    let (st, v) = put_svg(&s, &me, "rothco", fixture("hostile/script.svg")).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(v["found"], json!([{"what": "script", "line": 3}]));
    assert!(v["error"].is_string());
    let (st, v) = put_svg(&s, &me, "rothco", fixture("hostile/mixed.svg")).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    let want: Value = serde_json::from_slice(&fixture("hostile/mixed.found.json")).unwrap();
    assert_eq!(v["found"], want);
    // 422: nothing to draw, or no size
    for f in ["invalid/no-viewbox.svg", "invalid/no-shapes.svg"] {
        let (st, v) = put_svg(&s, &me, "rothco", fixture(f)).await;
        assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{f}: {v}");
        assert_eq!(v["found"], json!([]));
    }
    // 415: not an SVG, by type or by content
    let (st, v) = put_svg(&s, &me, "rothco", fixture("invalid/not-svg.svg")).await;
    assert_eq!(st, StatusCode::UNSUPPORTED_MEDIA_TYPE, "{v}");
    let (st, _) = put_svg(&s, &me, "rothco", vec![0x89, b'P', b'N', b'G', 0xff, 0xfe]).await;
    assert_eq!(st, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    for ct in ["image/png", "application/json"] {
        let (st, _, _) = raw(
            &s,
            "PUT",
            "/api/admin/agencies/rothco/draft/wordmark",
            Some(&me),
            &[("content-type", ct)],
            src.clone(),
        )
        .await;
        assert_eq!(st, StatusCode::UNSUPPORTED_MEDIA_TYPE, "{ct}");
    }
    let (st, _, _) = raw(
        &s,
        "PUT",
        "/api/admin/agencies/rothco/draft/wordmark",
        Some(&me),
        &[],
        src.clone(),
    )
    .await;
    assert_eq!(st, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    // 413: over 200 KB as sent; over 48 KB or 2,000 shapes once cleaned
    let mut big = b"<svg viewBox=\"0 0 10 10\"><rect width=\"1\" height=\"1\"/>".to_vec();
    big.resize(200 * 1024 + 1, b' ');
    big.extend_from_slice(b"</svg>");
    let (st, v) = put_svg(&s, &me, "rothco", big).await;
    assert_eq!(st, StatusCode::PAYLOAD_TOO_LARGE, "{v}");
    let many = |n: usize, shape: &str| {
        let mut x = String::from("<svg viewBox=\"0 0 10 10\">");
        for i in 0..n {
            x.push_str(&shape.replace("{i}", &i.to_string()));
        }
        x.push_str("</svg>");
        x.into_bytes()
    };
    // 2,001 bare rects clean to under 48 KB, so the shape count refuses them
    let (st, v) = put_svg(&s, &me, "rothco", many(2001, "<rect/>")).await;
    assert_eq!(st, StatusCode::PAYLOAD_TOO_LARGE, "{v}");
    assert!(v["error"].as_str().unwrap().contains("shapes"), "{v}");
    let (st, v) = put_svg(
        &s,
        &me,
        "rothco",
        many(1000, "<rect x=\"{i}\" width=\"1.12345\" height=\"1\"/>"),
    )
    .await;
    assert_eq!(st, StatusCode::PAYLOAD_TOO_LARGE, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Cleaned"), "{v}");
    // the draft still has the first, good wordmark
    let r = row(&s, &me, "rothco").await;
    assert_eq!(
        r["draft"]["wordmark"],
        napkin_web::svg_sanitise::svg_uri(clean)
    );
    // 404 for no agency
    let (st, _) = put_svg(&s, &me, "nobody", src).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_agency_in_code_changes_only_its_display_name() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    let r = row(&s, &me, "boysandgirls").await;
    assert_eq!(
        r,
        json!({
            "id": "boysandgirls", "kind": "code", "name": "Boys+Girls", "code_name": "Boys+Girls",
            "aliases": ["bg", "boysgirls", "b+g"], "draft": null, "people": 1, "rev": 0,
            "changed_by": null, "changed_at": null, "published_by": null, "published_at": null,
        })
    );
    // anything but the name is refused; so is a wordmark
    for body in [
        json!({"base": "#000000", "rev": 0}),
        json!({"aliases": ["bgs"], "rev": 0}),
        json!({"accent": "#FFFFFF", "name": "B+G", "rev": 0}),
    ] {
        let (st, v, _) = call(
            &s,
            "PATCH",
            "/api/admin/agencies/boysandgirls/draft",
            Some(&me),
            Some(body.clone()),
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{body}: {v}");
    }
    let (st, _) = put_svg(&s, &me, "boysandgirls", fixture("groups.svg")).await;
    assert_eq!(st, StatusCode::CONFLICT);
    let (st, _, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/boysandgirls/draft/wordmark",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    let (st, _, _) = call(
        &s,
        "PATCH",
        "/api/admin/agencies/boysandgirls/draft",
        Some(&me),
        Some(json!({"name": "Pluto", "rev": 0})),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "another agency's name");
    // draft, then publish
    let (st, v, _) = call(
        &s,
        "PATCH",
        "/api/admin/agencies/boysandgirls/draft",
        Some(&me),
        Some(json!({"name": "Boys + Girls", "rev": 0})),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(
        (v["name"].as_str(), &v["draft"], v["rev"].as_u64()),
        (
            Some("Boys+Girls"),
            &json!({"name": "Boys + Girls"}),
            Some(1)
        )
    );
    assert_eq!(looks(&s).await, json!([]), "a drafted name is not public");
    let (st, _, _) = call(
        &s,
        "PATCH",
        "/api/admin/agencies/boysandgirls/draft",
        Some(&me),
        Some(json!({"name": "B and G", "rev": 0})),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "stale rev");
    let (st, v, _) = call(
        &s,
        "POST",
        "/api/admin/agencies/boysandgirls/publish",
        Some(&me),
        Some(json!({"rev": 1})),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(
        (v["name"].as_str(), &v["draft"], v["published_by"].as_str()),
        (Some("Boys + Girls"), &Value::Null, Some("engineer@napkin"))
    );
    assert_eq!(
        looks(&s).await,
        json!([{"id": "boysandgirls", "name": "Boys + Girls", "rev": 2}])
    );
    // the published name finds the agency for new people; the code's still does
    for (n, a) in [("Bea", "boys + girls"), ("Cal", "Boys+Girls")] {
        let (st, p, _) = call(
            &s,
            "POST",
            "/api/admin/people",
            Some(&me),
            Some(json!({"name": n, "agency": a})),
        )
        .await;
        assert_eq!(
            (st, p["agency"].as_str()),
            (StatusCode::CREATED, Some("boysandgirls"))
        );
    }
    // Copy to code is for basic agencies only
    let (st, _, _) = call(
        &s,
        "GET",
        "/api/admin/agencies/boysandgirls/export",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    // a draft discarded; then Reset back to the code's name
    call(
        &s,
        "PATCH",
        "/api/admin/agencies/boysandgirls/draft",
        Some(&me),
        Some(json!({"name": "BG Dublin", "rev": 2})),
    )
    .await;
    let (st, v, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/boysandgirls/draft",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        (v["name"].as_str(), &v["draft"]),
        (Some("Boys + Girls"), &Value::Null)
    );
    let (st, v, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/boysandgirls/name",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(
        (v["name"].as_str(), v["rev"].as_u64()),
        (Some("Boys+Girls"), Some(0))
    );
    assert_eq!(looks(&s).await, json!([]));
    let (st, _, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/boysandgirls/name",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "already the code's name");
    published_rothco(&s, &me).await;
    let (st, _, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/rothco/name",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "a basic agency has no code name");
    let (st, _, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/nobody/name",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn copy_to_code_gives_the_published_look_as_code() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    let (_, v, _) = call(&s, "POST", "/api/admin/agencies", Some(&me), Some(json!({"name": "O'Neill & Co", "base": "#0f6b5c", "accent": "#9FE6D8", "aliases": ["oneill"]}))).await;
    let id = v["id"].as_str().unwrap().to_string();
    assert_eq!(id, "oneillandco");
    let (st, v, _) = call(
        &s,
        "GET",
        &format!("/api/admin/agencies/{id}/export"),
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "not published yet");
    assert!(v["error"].as_str().unwrap().contains("Publish it first"));
    put_svg(&s, &me, &id, fixture("groups.svg")).await;
    let (st, _, _) = call(
        &s,
        "POST",
        &format!("/api/admin/agencies/{id}/publish"),
        Some(&me),
        Some(json!({"rev": 2})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    // a later draft does not reach the export: it is the published look
    call(
        &s,
        "PATCH",
        &format!("/api/admin/agencies/{id}/draft"),
        Some(&me),
        Some(json!({"accent": "#FFFFFF", "rev": 3})),
    )
    .await;
    let (st, v, _) = call(
        &s,
        "GET",
        &format!("/api/admin/agencies/{id}/export"),
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let clean = String::from_utf8(fixture("groups.out.svg")).unwrap();
    assert_eq!(
        v,
        json!({
            "palette_ts": "// AGENCY_COLOURS\n  oneillandco: {\n    name: 'O\\'Neill & Co', base: '#0F6B5C', accent: '#9FE6D8',\n    logo: svgUri(WORDMARK_SVG.oneillandco),\n    logoOnDark: svgUri(recolourSvg(WORDMARK_SVG.oneillandco, '#FFFFFF')),\n  },\n// AGENCY_ALIASES\n  'oneill': 'oneillandco',",
            "svg": clean.trim_end(),
            "agency_logos_files": "  oneillandco: { logo: 'oneillandco-logo.svg' },",
            "people_rs": "    (\"oneillandco\", \"O'Neill & Co\", \"#0F6B5C\", \"#9FE6D8\"),\n// CODE_ALIASES\n    (\"oneill\", \"oneillandco\"),",
        })
    );
    // without a wordmark or aliases, and an id that is not a plain JS name
    let (_, v, _) = call(
        &s,
        "POST",
        "/api/admin/agencies",
        Some(&me),
        Some(json!({"name": "72 Kin", "base": "#000000", "accent": "#FFFFFF"})),
    )
    .await;
    call(
        &s,
        "POST",
        "/api/admin/agencies/72kin/publish",
        Some(&me),
        Some(json!({"rev": v["rev"]})),
    )
    .await;
    let (st, v, _) = call(
        &s,
        "GET",
        "/api/admin/agencies/72kin/export",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        v,
        json!({
            "palette_ts": "// AGENCY_COLOURS\n  '72kin': {\n    name: '72 Kin', base: '#000000', accent: '#FFFFFF',\n  },",
            "svg": null,
            "agency_logos_files": null,
            "people_rs": "    (\"72kin\", \"72 Kin\", \"#000000\", \"#FFFFFF\"),",
        })
    );
    let (st, _, _) = call(
        &s,
        "GET",
        "/api/admin/agencies/nobody/export",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn agency_looks_is_revalidated_by_etag() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    let (st, _, h) = raw(&s, "GET", "/api/agency-looks", None, &[], vec![]).await;
    assert_eq!(st, StatusCode::OK);
    let tag = h[header::ETAG].to_str().unwrap().to_string();
    assert!(h[header::CACHE_CONTROL]
        .to_str()
        .unwrap()
        .contains("no-cache"));
    let (st, _, h) = raw(
        &s,
        "GET",
        "/api/agency-looks",
        None,
        &[("if-none-match", &tag)],
        vec![],
    )
    .await;
    assert_eq!(st, StatusCode::NOT_MODIFIED);
    assert_eq!(h[header::ETAG].to_str().unwrap(), tag);
    // a draft changes nothing public, so the tag holds
    call(
        &s,
        "POST",
        "/api/admin/agencies",
        Some(&me),
        Some(json!({"name": "Kin", "base": "#000000", "accent": "#FFFFFF"})),
    )
    .await;
    let (st, _, _) = raw(
        &s,
        "GET",
        "/api/agency-looks",
        None,
        &[("if-none-match", &tag)],
        vec![],
    )
    .await;
    assert_eq!(st, StatusCode::NOT_MODIFIED);
    // a publish changes it
    call(
        &s,
        "POST",
        "/api/admin/agencies/kin/publish",
        Some(&me),
        Some(json!({"rev": 1})),
    )
    .await;
    let (st, v, h) = raw(
        &s,
        "GET",
        "/api/agency-looks",
        None,
        &[("if-none-match", &tag)],
        vec![],
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_ne!(h[header::ETAG].to_str().unwrap(), tag);
    assert_eq!(v[0]["id"], "kin");
}

#[tokio::test]
async fn an_agency_kept_before_drafts_reads_as_published() {
    let s = server_with(Some(
        r##"{"people": [
              {"id": "engineer@napkin", "name": "Shrey", "agency": "napkin", "admin": true, "added_by": "roster", "added_at": "2026-11-12T10:00:00Z"},
              {"id": "aoife@rothco", "name": "Aoife", "agency": "rothco", "admin": false, "added_by": "engineer@napkin", "added_at": "2026-11-12T10:05:00Z"}
            ],
            "agencies": [
              {"id": "rothco", "name": "Rothco", "base": "#0F6B5C", "accent": "#9FE6D8", "aliases": ["roth"], "added_by": "engineer@napkin", "added_at": "2026-11-12T10:00:00Z"}
            ]}"##,
    ));
    assert_eq!(
        looks(&s).await,
        json!([{"id": "rothco", "name": "Rothco", "base": "#0F6B5C", "accent": "#9FE6D8", "aliases": ["roth"], "rev": 0}])
    );
    assert!(sign_in(&s, "aoife@rothco").await.is_ok());
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    let r = row(&s, &me, "rothco").await;
    assert_eq!(
        (
            r["published"].as_bool(),
            &r["draft"],
            r["rev"].as_u64(),
            r["people"].as_u64()
        ),
        (Some(true), &Value::Null, Some(0), Some(1))
    );
    let (st, p, _) = call(
        &s,
        "POST",
        "/api/admin/people",
        Some(&me),
        Some(json!({"name": "Bríd", "agency": "roth", "username": "brid@rothco"})),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{p}");
    let (st, _, _) = call(
        &s,
        "GET",
        "/api/admin/agencies/rothco/export",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn another_servers_publish_is_seen_within_recheck() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    assert_eq!(looks(&s).await, json!([]));
    // a second web task on the same volume
    let other = napkin_web::people::People::open(
        s._dir.path().join("_people"),
        &s._dir.path().join("accounts.tsv"),
    )
    .unwrap();
    let a = other
        .add_agency(
            "engineer@napkin",
            &napkin_web::people::NewAgency {
                name: "Kin".into(),
                base: "#000000".into(),
                accent: "#FFFFFF".into(),
                aliases: vec![],
            },
        )
        .unwrap();
    other
        .publish(
            "engineer@napkin",
            &a.id,
            &napkin_web::people::Publish { rev: Some(a.rev) },
        )
        .unwrap();
    tokio::time::sleep(napkin_web::people::RECHECK + std::time::Duration::from_millis(100)).await;
    assert_eq!(looks(&s).await[0]["id"], "kin");
    assert_eq!(row(&s, &me, "kin").await["published"], true);
}

async fn patch_draft(s: &Server, c: &str, id: &str, body: Value) -> (StatusCode, Value) {
    let (st, v, _) = call(
        s,
        "PATCH",
        &format!("/api/admin/agencies/{id}/draft"),
        Some(c),
        Some(body),
    )
    .await;
    (st, v)
}

#[tokio::test]
async fn style_switches_draft_validate_and_clear_back_to_default() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    let rev = published_rothco(&s, &me).await;
    // a published agency without them carries none, on the row and on agency-looks
    let r = row(&s, &me, "rothco").await;
    for k in ["pill", "accent_use", "surface", "accent_ink"] {
        assert!(r.get(k).is_none(), "{k} on {r}");
    }
    assert_eq!(
        looks(&s).await,
        json!([{"id": "rothco", "name": "Rothco", "base": "#0F6B5C", "accent": "#9FE6D8", "aliases": ["roth"], "rev": rev}])
    );
    // bad values are 400, in plain words, and change nothing
    for body in [
        json!({"pill": "outline", "rev": rev}),
        json!({"pill": true, "rev": rev}),
        json!({"accent_use": "Fill", "rev": rev}),
        json!({"accent_use": "stroke", "rev": rev}),
        json!({"surface": "paper", "rev": rev}),
        json!({"accent_ink": "navy", "rev": rev}),
        json!({"accent_ink": "#12345", "rev": rev}),
        json!({"accentInk": "#000047", "rev": rev}),
    ] {
        let (st, v) = patch_draft(&s, &me, "rothco", body.clone()).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{body}: {v}");
        assert!(v["error"].is_string());
    }
    assert_eq!(row(&s, &me, "rothco").await["rev"], rev);
    // each one drafts; the published look is untouched
    let (st, v) = patch_draft(
        &s,
        &me,
        "rothco",
        json!({"pill": "base", "accent_use": "line", "surface": "mono", "accent_ink": "#00004a", "rev": rev}),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(
        (
            &v["draft"]["pill"],
            &v["draft"]["accent_use"],
            &v["draft"]["surface"],
            &v["draft"]["accent_ink"]
        ),
        (
            &json!("base"),
            &json!("line"),
            &json!("mono"),
            &json!("#00004A")
        )
    );
    assert!(v.get("pill").is_none(), "not published yet: {v}");
    assert!(looks(&s).await[0].get("pill").is_none());
    // null clears one back to the default; the default named is the same as null
    let (st, v) = patch_draft(
        &s,
        &me,
        "rothco",
        json!({"accent_ink": null, "surface": "warm", "rev": rev + 1}),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert!(v["draft"].get("accent_ink").is_none(), "{v}");
    assert!(v["draft"].get("surface").is_none(), "{v}");
    assert_eq!(v["draft"]["pill"], "base");
    // all back to the default: no change left, the draft tidies away
    let (st, v) = patch_draft(
        &s,
        &me,
        "rothco",
        json!({"pill": "accent", "accent_use": null, "rev": rev + 2}),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(v["draft"], Value::Null);
    // an agency in code takes none of them
    for body in [
        json!({"pill": "base", "rev": 0}),
        json!({"accent_use": "line", "rev": 0}),
        json!({"surface": "mono", "rev": 0}),
        json!({"accent_ink": "#000000", "rev": 0}),
        json!({"accent_ink": null, "rev": 0}),
        json!({"name": "Pluto Dublin", "pill": "accent", "rev": 0}),
    ] {
        let (st, v) = patch_draft(&s, &me, "pluto", body.clone()).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{body}: {v}");
    }
    assert_eq!(row(&s, &me, "pluto").await["draft"], Value::Null);
}

#[tokio::test]
async fn style_switches_publish_reach_agency_looks_and_copy_to_code() {
    let s = server();
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    // ACNE as made from the page
    let (st, v, _) = call(
        &s,
        "POST",
        "/api/admin/agencies",
        Some(&me),
        Some(json!({"name": "Acne Twin", "base": "#000000", "accent": "#86BC25"})),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    let (st, v) = patch_draft(
        &s,
        &me,
        "acnetwin",
        json!({"pill": "base", "accent_use": "line", "surface": "mono", "rev": v["rev"]}),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let (st, v, _) = call(
        &s,
        "POST",
        "/api/admin/agencies/acnetwin/publish",
        Some(&me),
        Some(json!({"rev": v["rev"]})),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(
        (
            &v["pill"],
            &v["accent_use"],
            &v["surface"],
            v.get("accent_ink"),
            &v["draft"]
        ),
        (
            &json!("base"),
            &json!("line"),
            &json!("mono"),
            None,
            &Value::Null
        )
    );
    let rev = v["rev"].as_u64().unwrap();
    assert_eq!(
        looks(&s).await,
        json!([{"id": "acnetwin", "name": "Acne Twin", "base": "#000000", "accent": "#86BC25",
                "aliases": [], "rev": rev, "pill": "base", "accent_use": "line", "surface": "mono"}])
    );
    let (st, v, _) = call(
        &s,
        "GET",
        "/api/admin/agencies/acnetwin/export",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(
        v["palette_ts"],
        "// AGENCY_COLOURS\n  acnetwin: {\n    name: 'Acne Twin', base: '#000000', accent: '#86BC25', pill: 'base', accentUse: 'line', surface: 'mono',\n  },"
    );
    assert_eq!(
        v["people_rs"], "    (\"acnetwin\", \"Acne Twin\", \"#000000\", \"#86BC25\"),",
        "the Rust mirror stays four fields"
    );
    // a draft that changes them reaches neither until published; discard drops it
    let (st, v) = patch_draft(
        &s,
        &me,
        "acnetwin",
        json!({"pill": null, "accent_ink": "#FFFFFF", "rev": rev}),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(v["pill"], "base");
    assert!(v["draft"].get("pill").is_none());
    assert_eq!(v["draft"]["accent_ink"], "#FFFFFF");
    assert_eq!(looks(&s).await[0]["pill"], "base");
    assert!(looks(&s).await[0].get("accent_ink").is_none());
    let (st, v, _) = call(
        &s,
        "DELETE",
        "/api/admin/agencies/acnetwin/draft",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(
        (&v["draft"], &v["pill"], v.get("accent_ink")),
        (&Value::Null, &json!("base"), None)
    );
    // publishing the text on the accent puts it in the export too
    patch_draft(
        &s,
        &me,
        "acnetwin",
        json!({"accent_ink": "#000047", "rev": rev + 2}),
    )
    .await;
    let (st, _, _) = call(
        &s,
        "POST",
        "/api/admin/agencies/acnetwin/publish",
        Some(&me),
        Some(json!({"rev": rev + 3})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(looks(&s).await[0]["accent_ink"], "#000047");
    let (_, v, _) = call(
        &s,
        "GET",
        "/api/admin/agencies/acnetwin/export",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(
        v["palette_ts"],
        "// AGENCY_COLOURS\n  acnetwin: {\n    name: 'Acne Twin', base: '#000000', accent: '#86BC25', pill: 'base', accentUse: 'line', surface: 'mono', accentInk: '#000047',\n  },"
    );
}

#[tokio::test]
async fn an_agency_kept_without_style_switches_is_stored_as_before() {
    let old = r##"{"people":[{"id":"engineer@napkin","name":"Shrey","agency":"napkin","admin":true,"added_by":"roster","added_at":"2026-11-12T10:00:00Z"}],
        "agencies":[{"id":"rothco","name":"Rothco","base":"#0F6B5C","accent":"#9FE6D8","aliases":["roth"],"wordmark":null,"published":true,"draft":null,"rev":3,"published_rev":3,"added_by":"engineer@napkin","added_at":"2026-11-12T10:00:00Z"}]}"##;
    let s = server_with(Some(old));
    let me = sign_in(&s, "engineer@napkin").await.unwrap();
    assert_eq!(
        looks(&s).await,
        json!([{"id": "rothco", "name": "Rothco", "base": "#0F6B5C", "accent": "#9FE6D8", "aliases": ["roth"], "rev": 3}])
    );
    // a change and its publish without style switches write none to the store
    patch_draft(&s, &me, "rothco", json!({"accent": "#FFFFFF", "rev": 3})).await;
    call(
        &s,
        "POST",
        "/api/admin/agencies/rothco/publish",
        Some(&me),
        Some(json!({"rev": 4})),
    )
    .await;
    let kept: Value =
        serde_json::from_slice(&std::fs::read(s._dir.path().join("_people/people.json")).unwrap())
            .unwrap();
    let a = &kept["agencies"][0];
    assert_eq!(a["accent"], "#FFFFFF");
    for k in ["pill", "accent_use", "surface", "accent_ink"] {
        assert!(a.get(k).is_none(), "{k} kept: {a}");
    }
    let (_, v, _) = call(
        &s,
        "GET",
        "/api/admin/agencies/rothco/export",
        Some(&me),
        None,
    )
    .await;
    assert_eq!(
        v["palette_ts"],
        "// AGENCY_COLOURS\n  rothco: {\n    name: 'Rothco', base: '#0F6B5C', accent: '#FFFFFF',\n  },\n// AGENCY_ALIASES\n  'roth': 'rothco',"
    );
}
