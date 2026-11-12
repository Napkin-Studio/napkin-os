// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/approval-route.clan, through the real router: only account service and management name a
//! route (200, 403, 400, 405), a late approval reaches the approver and then whoever set the route, and
//! nothing the job replies carry scores a person.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use chrono::{TimeZone, Utc};
use http_body_util::BodyExt;
use napkin_host::NoConfig;
use napkin_web::state::AppCtx;
use serde_json::{json, Value};
use tower::ServiceExt;

struct Rig {
    _dir: tempfile::TempDir,
    app: Router,
    clock: Arc<AtomicI64>,
}

struct Person {
    cookie: String,
    tenant: String,
}

fn at(date: &str) -> i64 {
    let d = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap();
    Utc.from_utc_datetime(&d.and_hms_opt(12, 0, 0).unwrap())
        .timestamp()
}

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicI64::new(at("2026-11-12")));
    let c = clock.clone();
    let ctx = Arc::new(
        AppCtx::new(dir.path().to_path_buf(), Arc::new(NoConfig), None, 40)
            .with_jobs_clock(move || Utc.timestamp_opt(c.load(Ordering::SeqCst), 0).unwrap()),
    );
    let roster = dir.path().join("accounts.tsv");
    std::fs::write(
        &roster,
        "cian@wk\tCian\taccount-service\naoife@wk\tAoife\tplanning\ndara@wk\tDara\tcreative-director\nniamh@wk\tNiamh\tmanagement\n",
    )
    .unwrap();
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
        _dir: dir,
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

async fn sign_in(r: &Rig, who: &str) -> Person {
    let (st, _, h) = call(
        r,
        "POST",
        "/api/auth/sign-in",
        None,
        Some(json!({ "username": who })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let cookie = h
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("napkin_session="))
        .map(|v| v.split(';').next().unwrap().to_string())
        .unwrap();
    let (_, me, _) = call(r, "GET", "/api/session", Some(&cookie), None).await;
    Person {
        cookie,
        tenant: me["tenant"].as_str().unwrap().to_string(),
    }
}

fn step(stage: &str, role: Option<&str>, approver: &str, due: &str) -> Value {
    json!({ "stage": stage, "party": "agency", "role": role, "approver": approver, "due": due })
}

async fn put_route(r: &Rig, p: &Person, steps: Vec<Value>) -> (StatusCode, Value) {
    let (s, v, _) = call(
        r,
        "PUT",
        &format!("/api/t/{}/jobs/J001/route", p.tenant),
        Some(&p.cookie),
        Some(json!({ "route": steps })),
    )
    .await;
    (s, v)
}

/// Client A and J001, opened by account service.
async fn open_job(r: &Rig, p: &Person) {
    let t = &p.tenant;
    let (_, client, _) = call(
        r,
        "POST",
        &format!("/api/t/{t}/clients"),
        Some(&p.cookie),
        Some(json!({ "name": "Client A" })),
    )
    .await;
    let (st, _, _) = call(
        r,
        "POST",
        &format!("/api/t/{t}/jobs"),
        Some(&p.cookie),
        Some(json!({ "number": "J001", "client_id": client["id"], "due": "2026-12-18" })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
}

fn keys(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(m) => {
            for (k, v) in m {
                out.push(k.clone());
                keys(v, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|v| keys(v, out)),
        _ => {}
    }
}

#[tokio::test]
async fn only_account_service_and_management_name_a_route_and_a_bad_one_is_refused() {
    let r = rig();
    let cian = sign_in(&r, "cian@wk").await;
    let aoife = sign_in(&r, "aoife@wk").await;
    let dara = sign_in(&r, "dara@wk").await;
    let niamh = sign_in(&r, "niamh@wk").await;
    assert_eq!(cian.tenant, aoife.tenant, "one agency, one workspace");
    open_job(&r, &cian).await;

    let good = vec![
        step("brief-check", Some("planner"), "aoife@wk", "2026-11-13"),
        step(
            "brief-check",
            Some("creative_director"),
            "dara@wk",
            "2026-11-14",
        ),
        json!({ "stage": "client-approval", "party": "client", "role": "client", "approver": "Client A contact",
                "contact": "contact@client-a.example", "due": "2026-11-20", "rounds": 2 }),
    ];
    let (st, job) = put_route(&r, &cian, good.clone()).await;
    assert_eq!(st, StatusCode::OK, "{job}");
    assert_eq!(job["route"].as_array().unwrap().len(), 3);

    // the registry holds the steps, and the job says who holds it
    let (_, answer, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/jobs/J001", cian.tenant),
        Some(&cian.cookie),
        None,
    )
    .await;
    let entry = &answer["job"]; // the job page's answer: { job, needs, can }
    assert_eq!(entry["route"].as_array().unwrap().len(), 3);
    assert_eq!(entry["holder"]["person"], "aoife@wk");
    assert_eq!(entry["route"][0]["state"], "waiting");
    assert_eq!(entry["route"][1]["state"], "not_started");

    // management may too; nobody else may
    assert_eq!(put_route(&r, &niamh, good.clone()).await.0, StatusCode::OK);
    assert_eq!(
        put_route(&r, &aoife, good.clone()).await.0,
        StatusCode::FORBIDDEN,
        "planning"
    );
    assert_eq!(
        put_route(&r, &dara, good.clone()).await.0,
        StatusCode::FORBIDDEN,
        "creative director"
    );

    // a bad step is a 400 and writes nothing
    for (why, bad) in [
        (
            "an unknown stage",
            vec![step("nonsense", None, "dara@wk", "2026-11-14")],
        ),
        (
            "a date that is not YYYY-MM-DD",
            vec![step("decks", None, "dara@wk", "14 Nov 2026")],
        ),
        (
            "two approvers for one stage and role",
            vec![
                step("decks", Some("creative_director"), "dara@wk", "2026-11-14"),
                step("decks", Some("creative_director"), "tadhg@wk", "2026-11-14"),
            ],
        ),
    ] {
        assert_eq!(
            put_route(&r, &cian, bad).await.0,
            StatusCode::BAD_REQUEST,
            "{why}"
        );
    }
    let (_, answer, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/jobs/J001", cian.tenant),
        Some(&cian.cookie),
        None,
    )
    .await;
    let entry = &answer["job"]; // the job page's answer: { job, needs, can }
    assert_eq!(
        entry["route"].as_array().unwrap().len(),
        3,
        "the refused writes left the route as it was"
    );

    // an unknown job is a 404, and the route takes a PUT and nothing else
    let (st, _, _) = call(
        &r,
        "PUT",
        &format!("/api/t/{}/jobs/J404/route", cian.tenant),
        Some(&cian.cookie),
        Some(json!({ "route": [] })),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    for method in ["GET", "POST", "DELETE", "PATCH"] {
        let (st, _, _) = call(
            &r,
            method,
            &format!("/api/t/{}/jobs/J001/route", cian.tenant),
            Some(&cian.cookie),
            Some(json!({ "route": [] })),
        )
        .await;
        assert_eq!(st, StatusCode::METHOD_NOT_ALLOWED, "{method}");
    }
}

#[tokio::test]
async fn a_late_approval_reaches_the_approver_then_account_service_and_the_dashboard() {
    let r = rig();
    let cian = sign_in(&r, "cian@wk").await;
    let aoife = sign_in(&r, "aoife@wk").await;
    let dara = sign_in(&r, "dara@wk").await;
    let niamh = sign_in(&r, "niamh@wk").await;
    open_job(&r, &cian).await;
    let t = cian.tenant.clone();
    let (st, _) = put_route(
        &r,
        &cian,
        vec![step(
            "decks",
            Some("creative_director"),
            "dara@wk",
            "2026-11-14",
        )],
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let needs = |p: &Person| {
        let (uri, cookie) = (format!("/api/t/{t}/needs"), p.cookie.clone());
        let r = &r;
        async move {
            call(r, "GET", &uri, Some(&cookie), None).await.1["items"]
                .as_array()
                .unwrap()
                .clone()
        }
    };
    let approvals = |items: &[Value]| {
        items
            .iter()
            .filter(|n| {
                n["kind"]
                    .as_str()
                    .is_some_and(|k| k.starts_with("approval"))
            })
            .cloned()
            .collect::<Vec<_>>()
    };

    // two days late (the clock is 2026-11-16, the step was due 2026-11-14)
    r.clock.store(at("2026-11-16"), Ordering::SeqCst);
    let mine = approvals(&needs(&dara).await);
    assert_eq!(mine.len(), 1, "{mine:?}");
    assert_eq!(
        (
            mine[0]["kind"].as_str(),
            mine[0]["days_late"].as_i64(),
            mine[0]["due"].as_str()
        ),
        (Some("approval"), Some(2), Some("2026-11-14"))
    );
    assert_eq!(mine[0]["stage"], "decks");
    assert!(
        approvals(&needs(&aoife).await).is_empty(),
        "not anyone else on the job"
    );
    let chase = approvals(&needs(&cian).await);
    assert_eq!(chase.len(), 1, "the person who set the route is told too");
    assert_eq!(chase[0]["kind"], "approval-chase");
    let (st, dash, _) = call(
        &r,
        "GET",
        &format!("/api/t/{t}/dashboard"),
        Some(&niamh.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let line = dash["at_risk"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["number"] == "J001")
        .unwrap();
    let text = line["line"].as_str().unwrap();
    assert!(
        text.contains("Decks and presentation") && text.contains("2 days late"),
        "{text}"
    );

    // one day late: only the approver has it
    r.clock.store(at("2026-11-15"), Ordering::SeqCst);
    assert_eq!(approvals(&needs(&dara).await).len(), 1);
    assert!(approvals(&needs(&cian).await).is_empty());
    // well before the date there is nothing at all, and no write was needed to make it so
    r.clock.store(at("2026-11-10"), Ordering::SeqCst);
    assert!(approvals(&needs(&dara).await).is_empty());
    r.clock.store(at("2026-11-12"), Ordering::SeqCst);
    assert_eq!(
        approvals(&needs(&dara).await).len(),
        1,
        "from 48 hours before"
    );
}

#[tokio::test]
async fn nothing_the_job_replies_hold_scores_a_person() {
    let r = rig();
    let cian = sign_in(&r, "cian@wk").await;
    let niamh = sign_in(&r, "niamh@wk").await;
    open_job(&r, &cian).await;
    let t = cian.tenant.clone();
    // every field of a route step set, a client contact included
    let (st, _) = put_route(
        &r,
        &cian,
        vec![
            step("brief-check", Some("planner"), "aoife@wk", "2026-11-10"),
            step("brief-check", Some("creative_director"), "dara@wk", "2026-11-11"),
            json!({ "stage": "client-approval", "party": "client", "role": "client", "approver": "Client A contact",
                    "contact": "contact@client-a.example", "due": "2026-11-20", "rounds": 2 }),
        ],
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    r.clock.store(at("2026-11-16"), Ordering::SeqCst);
    let mut all = Vec::new();
    for (who, tail) in [
        (&cian, "jobs"),
        (&cian, "jobs/J001"),
        (&cian, "needs"),
        (&niamh, "dashboard"),
    ] {
        let (st, v, _) = call(
            &r,
            "GET",
            &format!("/api/t/{t}/{tail}"),
            Some(&who.cookie),
            None,
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{tail}");
        keys(&v, &mut all);
    }
    assert!(!all.is_empty());
    for k in &all {
        let bad = [
            "per_person",
            "by_person",
            "average_days",
            "average",
            "league",
        ];
        assert!(
            !bad.iter().any(|b| k.contains(b)),
            "a key that scores a person: {k}"
        );
    }
}
