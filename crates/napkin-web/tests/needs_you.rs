// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/needs-you-full.clan, through the real router: Done and Undo are one person's own and private,
//! a task refuses Done, an id that is not yours is 404, the index takes no write (405), the timesheet
//! reminder is the caller's own and only after the question was asked, and the next deadline is read off
//! the person's own jobs.

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
    #[allow(dead_code)]
    clock: Arc<AtomicI64>,
    /// The timesheet clock, in epoch milliseconds.
    sheet: Arc<AtomicI64>,
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
    let sheet = Arc::new(AtomicI64::new(at("2026-11-12") * 1000));
    let s = sheet.clone();
    let ctx = Arc::new(
        AppCtx::new(dir.path().to_path_buf(), Arc::new(NoConfig), None, 40)
            .with_jobs_clock(move || Utc.timestamp_opt(c.load(Ordering::SeqCst), 0).unwrap())
            .with_timesheet_clock(move || s.load(Ordering::SeqCst)),
    );
    let roster = dir.path().join("accounts.tsv");
    std::fs::write(
        &roster,
        "cian@wk\tCian\taccount-service\naoife@wk\tAoife\tplanning\ndara@wk\tDara\tcreative-director\nniamh@wk\tNiamh\tmanagement\nmaeve@wk\tMaeve\tcopywriter\n",
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
        sheet,
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

/// Client A and J001 (due 14 Nov, so inside 48 hours of the clock), opened by `p`, who is then its owner.
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
        Some(json!({ "number": "J001", "client_id": client["id"], "due": "2026-11-14", "owner": "aoife@wk" })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
}

async fn list(r: &Rig, p: &Person, query: &str) -> Value {
    call(
        r,
        "GET",
        &format!("/api/t/{}/needs{query}", p.tenant),
        Some(&p.cookie),
        None,
    )
    .await
    .1
}

fn kinds(v: &Value) -> Vec<String> {
    v["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["kind"].as_str().unwrap().to_string())
        .collect()
}

fn id_of(v: &Value, kind: &str) -> String {
    v["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["kind"] == kind)
        .unwrap_or_else(|| panic!("no {kind} in {v}"))["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn done(r: &Rig, p: &Person, id: &str, method: &str) -> StatusCode {
    call(
        r,
        method,
        &format!("/api/t/{}/needs/{id}/done", p.tenant),
        Some(&p.cookie),
        None,
    )
    .await
    .0
}

#[tokio::test]
async fn done_is_a_persons_own_and_private_a_task_refuses_it_and_undo_takes_it_back() {
    let r = rig();
    let cian = sign_in(&r, "cian@wk").await;
    let aoife = sign_in(&r, "aoife@wk").await;
    let niamh = sign_in(&r, "niamh@wk").await;
    open_job(&r, &aoife).await;
    // a route: aoife approves the brief by 13 Nov, so she has a task as well as the deadline notice
    let (st, _, _) = call(
        &r,
        "PUT",
        &format!("/api/t/{}/jobs/J001/route", cian.tenant),
        Some(&cian.cookie),
        Some(json!({ "route": [step("brief-check", Some("planner"), "aoife@wk", "2026-11-13")] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let mine = list(&r, &aoife, "").await;
    assert_eq!(
        kinds(&mine),
        vec!["approval".to_string(), "deadline".to_string()],
        "{mine}"
    );
    assert_eq!(mine["total"], 2);
    assert_eq!(mine["next_deadline"]["job"], "J001");
    assert_eq!(mine["next_deadline"]["due"], "2026-11-14");
    let notice = id_of(&mine, "deadline");
    let task = id_of(&mine, "approval");
    // a need is sent by an allow list: no audience, whoever else it was for
    assert!(mine["items"][0].get("audience").is_none());
    assert_eq!(mine["items"][0]["can_done"], false);
    assert_eq!(mine["items"][1]["can_done"], true);

    // nobody else on the agency has aoife's items, or her next deadline
    assert!(kinds(&list(&r, &niamh, "").await).is_empty());
    assert!(list(&r, &niamh, "").await["next_deadline"].is_null());
    assert!(!kinds(&list(&r, &cian, "").await).contains(&"deadline".to_string()));

    // Done: the notice leaves, the task refuses (409), another person's id is 404 and changes nothing
    assert_eq!(done(&r, &aoife, &notice, "POST").await, StatusCode::OK);
    assert_eq!(
        done(&r, &aoife, &notice, "POST").await,
        StatusCode::OK,
        "twice is once"
    );
    assert_eq!(
        kinds(&list(&r, &aoife, "").await),
        vec!["approval".to_string()]
    );
    assert_eq!(
        list(&r, &aoife, "").await["total"],
        1,
        "the total counts what is left"
    );
    assert_eq!(done(&r, &aoife, &task, "POST").await, StatusCode::CONFLICT);
    assert_eq!(
        done(&r, &niamh, &notice, "POST").await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        done(&r, &cian, &notice, "POST").await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        done(&r, &aoife, "J001:nothing:x:y", "POST").await,
        StatusCode::NOT_FOUND
    );
    // another person's Undo takes back nothing of aoife's
    assert_eq!(done(&r, &niamh, &notice, "DELETE").await, StatusCode::OK);
    assert_eq!(
        kinds(&list(&r, &aoife, "").await),
        vec!["approval".to_string()]
    );
    // the job page's own list leaves it out too
    let (_, page, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/jobs/J001", aoife.tenant),
        Some(&aoife.cookie),
        None,
    )
    .await;
    assert_eq!(page["needs"].as_array().unwrap().len(), 1);
    // Undo: the item is back, with the id it had
    assert_eq!(done(&r, &aoife, &notice, "DELETE").await, StatusCode::OK);
    assert_eq!(id_of(&list(&r, &aoife, "").await, "deadline"), notice);

    // the deadline moves: a new notice, a new id, so a Done on the old date hides nothing new
    assert_eq!(done(&r, &aoife, &notice, "POST").await, StatusCode::OK);
    let (st, _, _) = call(
        &r,
        "PATCH",
        &format!("/api/t/{}/jobs/J001", aoife.tenant),
        Some(&aoife.cookie),
        Some(json!({ "due": "2026-11-13" })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_ne!(id_of(&list(&r, &aoife, "").await, "deadline"), notice);

    // the index takes no write
    for method in ["POST", "PUT", "PATCH", "DELETE"] {
        let (st, _, _) = call(
            &r,
            method,
            &format!("/api/t/{}/needs", aoife.tenant),
            Some(&aoife.cookie),
            Some(json!({})),
        )
        .await;
        assert_eq!(st, StatusCode::METHOD_NOT_ALLOWED, "{method}");
    }
}

#[tokio::test]
async fn the_timesheet_reminder_is_the_callers_own_after_the_question_and_from_four() {
    let r = rig();
    let aoife = sign_in(&r, "aoife@wk").await;
    let niamh = sign_in(&r, "niamh@wk").await;
    let maeve = sign_in(&r, "maeve@wk").await;
    let ms = |h: i64| at("2026-11-12") * 1000 - 12 * 3_600_000 + h * 3_600_000;
    r.sheet.store(ms(17), Ordering::SeqCst);
    // nobody has been asked: nobody has a reminder
    for p in [&aoife, &niamh, &maeve] {
        assert!(!kinds(&list(&r, p, "").await).contains(&"timesheet".to_string()));
    }
    // aoife says yes, maeve says no: both are reminded (maeve to fill the day by hand); niamh was never asked
    for (p, yes) in [(&aoife, true), (&maeve, false)] {
        let (st, _, _) = call(
            &r,
            "POST",
            &format!("/api/t/{}/timesheet/consent", p.tenant),
            Some(&p.cookie),
            Some(json!({ "consent": yes })),
        )
        .await;
        assert_eq!(st, StatusCode::OK);
    }
    for p in [&aoife, &maeve] {
        let v = list(&r, p, "").await;
        assert!(kinds(&v).contains(&"timesheet".to_string()), "{v}");
    }
    assert!(
        kinds(&list(&r, &niamh, "").await).is_empty(),
        "management has no timesheet item about anyone"
    );
    // before 16:00 local time there is none: 15:00 UTC is 16:00 in UTC+1
    r.sheet.store(ms(15), Ordering::SeqCst);
    assert!(!kinds(&list(&r, &aoife, "").await).contains(&"timesheet".to_string()));
    assert!(kinds(&list(&r, &aoife, "?tz=60").await).contains(&"timesheet".to_string()));
    // the reminder is a notice: Done leaves it for the day, and nobody else can mark it
    r.sheet.store(ms(17), Ordering::SeqCst);
    let id = id_of(&list(&r, &aoife, "").await, "timesheet");
    assert_eq!(done(&r, &niamh, &id, "POST").await, StatusCode::NOT_FOUND);
    assert_eq!(done(&r, &aoife, &id, "POST").await, StatusCode::OK);
    assert!(!kinds(&list(&r, &aoife, "").await).contains(&"timesheet".to_string()));
    // tomorrow is a new day: a new reminder
    r.sheet.store(ms(17) + 86_400_000, Ordering::SeqCst);
    assert_ne!(id_of(&list(&r, &aoife, "").await, "timesheet"), id);
}
