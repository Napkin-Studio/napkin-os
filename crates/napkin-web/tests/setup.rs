// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/agency-setup.clan, stage 2, through the real router: the settings (name, monthly credit
//! cap, time zone, the look), the setup flow's progress read from the data, CSV import with a dry
//! run through the API (raw and multipart), the accounts file, and the walls between agencies.

use std::sync::atomic::{AtomicI64, Ordering};
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
        &format!("/api/t/{}/agency/people/invite", admin.tenant),
        Some(&admin.cookie),
        Some(json!({ "username": username, "name": name, "email": format!("{}@mail.example.test", username.split('@').next().unwrap()), "roles": roles })),
    )
    .await;
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
    let (st, s, _) = call(
        &r,
        "PUT",
        &url,
        Some(&cara.cookie),
        Some(json!({ "name": "Agency C", "credit_cap_month_eur": 2500 })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        (s["name"].as_str(), s["credit_cap_month_eur"].as_f64()),
        (Some("Agency C"), Some(2500.0))
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
    assert_eq!(s["name"], json!("Agency C"));
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
async fn an_import_through_the_api_checks_first_then_writes_and_the_flow_reads_its_progress_from_the_data(
) {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    let t = &cara.tenant;
    let status = || async {
        call(
            &r,
            "GET",
            &format!("/api/t/{t}/setup"),
            Some(&cara.cookie),
            None,
        )
        .await
        .1
    };
    let s = status().await;
    assert_eq!(s["next"], json!("logo"), "a new agency starts at the logo");
    // name
    call(
        &r,
        "PUT",
        &format!("/api/t/{t}/agency"),
        Some(&cara.cookie),
        Some(json!({ "name": "Agency C" })),
    )
    .await;
    assert_eq!(
        status().await["next"],
        json!("logo"),
        "a skipped step is picked up later"
    );
    // logo
    let logo = json!({ "logo": "data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E" });
    call(
        &r,
        "PUT",
        &format!("/api/t/{t}/agency/look"),
        Some(&cara.cookie),
        Some(logo),
    )
    .await;
    assert_eq!(status().await["next"], json!("people"));
    // people: a dry run (multipart) writes nothing, then the real one
    let (ctype, body) = multipart(&people_csv(120));
    let (st, dry) = post_file(
        &r,
        &format!("/api/t/{t}/setup/import/people?dry_run=1"),
        &cara,
        &ctype,
        body,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{dry}");
    assert_eq!(dry["ok"], json!(117));
    let lines: Vec<u64> = dry["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["line"].as_u64().unwrap())
        .collect();
    assert_eq!(lines, [8, 40, 70]);
    assert_eq!(
        status().await["has_directory"],
        json!(false),
        "the dry run wrote nothing"
    );
    let (st, done) = post_file(
        &r,
        &format!("/api/t/{t}/setup/import/people"),
        &cara,
        "text/csv",
        people_csv(120).into_bytes(),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(done["created"], json!(117));
    assert_eq!(status().await["next"], json!("clients"));
    // an imported person signs in to the home of their role
    let p1 = sign_in(&r, "person1@cr").await;
    let (_, me, _) = call(&r, "GET", "/api/session", Some(&p1.cookie), None).await;
    assert_eq!(me["roles"], json!(["creative-director"]));
    // clients, then jobs
    let clients: String = "name\n".to_string()
        + &(1..=8)
            .map(|i| format!("Client C{i}\n"))
            .collect::<String>();
    let (st, c) = post_file(
        &r,
        &format!("/api/t/{t}/setup/import/clients"),
        &cara,
        "text/csv",
        clients.into_bytes(),
    )
    .await;
    assert_eq!((st, c["created"].clone()), (StatusCode::OK, json!(8)));
    let jobs: String = "client,title,due\n".to_string()
        + &(1..=30)
            .map(|i| format!("Client C{},Job {i},2026-12-{:02}\n", i % 8 + 1, i % 28 + 1))
            .collect::<String>();
    let (st, j) = post_file(
        &r,
        &format!("/api/t/{t}/setup/import/jobs"),
        &cara,
        "text/csv",
        jobs.into_bytes(),
    )
    .await;
    assert_eq!((st, j["created"].clone()), (StatusCode::OK, json!(30)));
    let s = status().await;
    assert_eq!(s["complete"], json!(true));
    let (_, list, _) = call(
        &r,
        "GET",
        &format!("/api/t/{t}/jobs"),
        Some(&cara.cookie),
        None,
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 30);
    // an unknown kind and a file that is not a table
    let (st, _) = post_file(
        &r,
        &format!("/api/t/{t}/setup/import/pets"),
        &cara,
        "text/csv",
        b"a\n1\n".to_vec(),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, e) = post_file(
        &r,
        &format!("/api/t/{t}/setup/import/people?dry_run=1"),
        &cara,
        "text/csv",
        b"   ".to_vec(),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(e["error"], json!("That file is empty."));
}

#[tokio::test]
async fn setup_import_and_the_accounts_file_are_for_an_admin_of_this_agency_only() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "dan@cr", "=Dan Test", &["management"]).await;
    let dan = sign_in(&r, "dan@cr").await;
    let barra = sign_in(&r, "barra@bq").await;
    let t = &cara.tenant;
    for who in [&dan, &barra] {
        for (m, path) in [
            ("GET", "setup"),
            ("POST", "setup/import/people"),
            ("GET", "agency/accounts.tsv"),
        ] {
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
    // a member of the agency cannot reach its own setup either
    let (st, _, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/setup", dan.tenant),
        Some(&dan.cookie),
        None,
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
    assert!(text.contains("cara@cr\tcara\tadmin\n"), "{text}");
}
