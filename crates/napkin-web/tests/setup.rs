// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/agency-setup.clan, stage 2, through the real router, as features/align-needs-lock-people.clan
//! left it (stage 4: the setup flow went; the People page's routes import people): the settings (monthly
//! credit cap, time zone, the look; the name is the agency record's), CSV import of people with a dry
//! run through the API (raw and multipart), the accounts file, and the walls between agencies.

use std::sync::atomic::AtomicI64;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::NoConfig;
use napkin_web::state::AppCtx;
use napkin_web::tenant::TenantId;
use serde_json::{json, Value};
use tower::ServiceExt;

struct Rig {
    dir: tempfile::TempDir,
    app: Router,
    _clock: Arc<AtomicI64>,
}

struct Person {
    cookie: String,
    tenant: String,
}

// cr's admin alone: a new agency, whose people come by its setup (one People store, so a roster line for anyone
// else of cr would already be one of its people: features/align-needs-lock-people.clan)
const ROSTER: &str = "cara@cr\tCara\tadmin\n\
barra@bq\tBarra\tadmin\n\
niamh@bq\tNiamh\tmanagement\n\
noel@nodir\tNoel\ttraffic\n";

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicI64::new(1_000_000));
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
        dir,
        _clock: clock,
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
    if st == StatusCode::CONFLICT {
        // on the roster, so already in the People store (features/align-needs-lock-people.clan)
        let (st, body, _) = call(
            r,
            "PATCH",
            &format!("/api/admin/people/{username}"),
            Some(&admin.cookie),
            Some(json!({ "name": name, "email": format!("{}@mail.example.test", username.split('@').next().unwrap()), "roles": roles })),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{body}");
        return;
    }
    assert_eq!(st, StatusCode::CREATED, "{body}");
}

fn people_csv(n: usize) -> String {
    let roles = [
        "planning",
        "creative-director",
        "account-service",
        "management",
        "art-director",
        "copywriter",
        "producer",
        "traffic",
    ];
    let mut rows = vec!["email,name,roles".to_string()];
    for i in 1..=n {
        let line = i + 1;
        let mut email = format!("person{i}@cr");
        let mut role = roles[i % roles.len()].to_string();
        if line == 8 {
            email.clear();
        }
        if line == 40 {
            role = "wizard".into();
        }
        if line == 70 {
            email = "person3@cr".into();
        }
        rows.push(format!("{email},Person {i} Test,{role}"));
    }
    rows.join("\n") + "\n"
}

fn multipart(file: &str) -> (String, Vec<u8>) {
    let b = "----napkinBoundary7MA4YWxk";
    let body = format!(
        "--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"people.csv\"\r\nContent-Type: text/csv\r\n\r\n{file}\r\n--{b}--\r\n"
    );
    (
        format!("multipart/form-data; boundary={b}"),
        body.into_bytes(),
    )
}

async fn post_file(
    r: &Rig,
    uri: &str,
    p: &Person,
    ctype: &str,
    body: Vec<u8>,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::COOKIE, &p.cookie)
        .header(header::CONTENT_TYPE, ctype)
        .body(Body::from(body))
        .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    let st = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (st, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn the_settings_hold_a_name_a_cap_and_a_zone_and_an_admin_changes_them() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    let url = format!("/api/t/{}/agency", cara.tenant);
    let (st, s, _) = call(&r, "GET", &url, Some(&cara.cookie), None).await;
    assert_eq!(st, StatusCode::OK);
    for k in ["name", "credit_cap_month_eur", "time_zone", "look"] {
        assert!(s.get(k).is_some(), "{k}");
    }
    // the name is the agency record's in the People store (features/align-needs-lock-people.clan): not here
    let (st, _, _) = call(
        &r,
        "PUT",
        &url,
        Some(&cara.cookie),
        Some(json!({ "name": "Agency C" })),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    let (st, s, _) = call(
        &r,
        "PUT",
        &url,
        Some(&cara.cookie),
        Some(json!({ "credit_cap_month_eur": 2500 })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        (s["name"].as_str(), s["credit_cap_month_eur"].as_f64()),
        (Some(""), Some(2500.0))
    );
    for bad in [
        json!({ "credit_cap_month_eur": -5 }),
        json!({ "credit_cap_month_eur": "lots" }),
        json!({ "credit_cap_month_eur": null, "time_zone": "no way" }),
    ] {
        let (st, _, _) = call(&r, "PUT", &url, Some(&cara.cookie), Some(bad)).await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
    }
    // the change is a decision on the registry's chain
    let store =
        napkin_web::store::TenantStore::new(r.dir.path().join(TenantId::of_agency("cr").as_str()));
    let h = napkin_host::agency::history(&store).unwrap();
    assert_eq!(h.len(), 1);
    assert_eq!(
        (h[0].action.as_str(), h[0].who.as_str()),
        ("set_settings", "cara@cr")
    );
    // a member reads the name and the look, not the cap; and cannot change anything
    invite(&r, &cara, "dan@cr", "Dan Test", &["management"]).await;
    let dan = sign_in(&r, "dan@cr").await;
    let (_, s, _) = call(&r, "GET", &url, Some(&dan.cookie), None).await;
    assert_eq!(s["name"], json!(""), "cr has no agency record, so no name");
    assert!(s.get("credit_cap_month_eur").is_none() && s.get("time_zone").is_none());
    let (st, _, _) = call(
        &r,
        "PUT",
        &url,
        Some(&dan.cookie),
        Some(json!({ "name": "Mine now" })),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    // the look is the admin's once the agency has a directory
    let (st, _, _) = call(
        &r,
        "PUT",
        &format!("/api/t/{}/agency/look", dan.tenant),
        Some(&dan.cookie),
        Some(json!({})),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _, _) = call(
        &r,
        "PUT",
        &format!("/api/t/{}/agency/look", cara.tenant),
        Some(&cara.cookie),
        Some(json!({})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn an_import_on_the_people_route_checks_first_then_writes() {
    // the setup flow and its progress went in stage 4 of features/align-needs-lock-people.clan: the People
    // page imports people (its clients and jobs files went with the flow, as the record's non-goals say)
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    async fn others(r: &Rig, cookie: &str) -> usize {
        call(r, "GET", "/api/admin/people", Some(cookie), None)
            .await
            .1["people"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["id"] != "cara@cr" && p["agency"] == "cr")
            .count()
    }
    // people: a dry run (multipart) writes nothing, then the real one
    let (ctype, body) = multipart(&people_csv(120));
    let (st, dry) = post_file(
        &r,
        "/api/admin/people/import?dry_run=1",
        &cara,
        &ctype,
        body,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{dry}");
    assert_eq!(dry["ok"], json!(117));
    assert_eq!(dry["starts_directory"], json!(true), "cr's first people");
    let lines: Vec<u64> = dry["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["line"].as_u64().unwrap())
        .collect();
    assert_eq!(lines, [8, 40, 70]);
    assert_eq!(
        others(&r, &cara.cookie).await,
        0,
        "the dry run wrote nothing"
    );
    let (st, done) = post_file(
        &r,
        "/api/admin/people/import",
        &cara,
        "text/csv",
        people_csv(120).into_bytes(),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(done["created"], json!(117));
    assert_eq!(others(&r, &cara.cookie).await, 117);
    // an imported person signs in to the home of their role
    let p1 = sign_in(&r, "person1@cr").await;
    let (_, me, _) = call(&r, "GET", "/api/session", Some(&p1.cookie), None).await;
    assert_eq!(me["roles"], json!(["creative-director"]));
    // the same file again changes nothing
    let (_, again) = post_file(
        &r,
        "/api/admin/people/import",
        &cara,
        "text/csv",
        people_csv(120).into_bytes(),
    )
    .await;
    assert_eq!(
        (again["created"].clone(), again["unchanged"].clone()),
        (json!(0), json!(117))
    );
    // a file that is not a table
    let (st, e) = post_file(
        &r,
        "/api/admin/people/import?dry_run=1",
        &cara,
        "text/csv",
        b"   ".to_vec(),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(e["error"], json!("That file is empty."));
}

#[tokio::test]
async fn the_import_and_the_accounts_file_are_for_an_admin_of_this_agency_only() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "=Dan Test", &["management"]).await;
    let dan = sign_in(&r, "dan@cr").await;
    let barra = sign_in(&r, "barra@bq").await;
    let t = &cara.tenant;
    for who in [&dan, &barra] {
        for (m, path) in [("GET", "agency/accounts.tsv"), ("GET", "audit")] {
            let (st, _, _) = call(
                &r,
                m,
                &format!("/api/t/{t}/{path}"),
                Some(&who.cookie),
                None,
            )
            .await;
            assert_eq!(st, StatusCode::FORBIDDEN, "{m} {path}");
        }
    }
    // a member of the agency cannot import people either
    let (st, _) = post_file(
        &r,
        "/api/admin/people/import?dry_run=1",
        &dan,
        "text/csv",
        people_csv(3).into_bytes(),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    // the accounts file: three columns, a formula in a name quoted
    let req = Request::builder()
        .uri(format!("/api/t/{t}/agency/accounts.tsv"))
        .header(header::COOKIE, &cara.cookie)
        .body(Body::empty())
        .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let text = String::from_utf8(
        resp.into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(text.contains("dan@cr\t'=Dan Test\tmanagement\n"), "{text}");
    assert!(text.contains("cara@cr\tCara\tadmin\n"), "{text}");
}
