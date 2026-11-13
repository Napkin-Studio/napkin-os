// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/timesheet-sessions.clan, through the real router: consent first, one person's own
//! sessions and day, a confirm that sends nothing anywhere, and corrections that stay private.
//! Each sentence of v3.1 section 8 on timesheets has a test here.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::NoConfig;
use napkin_web::state::AppCtx;
use serde_json::{json, Value};
use tower::ServiceExt;

/// 2025-11-11 09:00 UTC.
const T0: i64 = 1_762_851_600_000;
const DATE: &str = "2025-11-11";

struct Rig {
    _dir: tempfile::TempDir,
    app: Router,
    clock: Arc<AtomicI64>,
}

struct Person {
    cookie: String,
    tenant: String,
}

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicI64::new(T0));
    let c = clock.clone();
    let ctx = Arc::new(
        AppCtx::new(dir.path().to_path_buf(), Arc::new(NoConfig), None, 40)
            .with_timesheet_clock(move || c.load(Ordering::SeqCst)),
    );
    let roster = dir.path().join("accounts.tsv");
    std::fs::write(
        &roster,
        "aoife@wk\tAoife\tplanning\nniamh@wk\tNiamh\tmanagement\ncian@wk\tCian\tplanning\n",
    )
    .unwrap();
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

impl Person {
    fn url(&self, tail: &str) -> String {
        format!("/api/t/{}/timesheet/{tail}", self.tenant)
    }
}

/// A job J001 with a brief and a research document filed under it. Returns their ids.
async fn job_with_docs(r: &Rig, p: &Person) -> (String, String) {
    let t = &p.tenant;
    let (_, client, _) = call(
        r,
        "POST",
        &format!("/api/t/{t}/clients"),
        Some(&p.cookie),
        Some(json!({ "name": "Client A" })),
    )
    .await;
    let cid = client["id"].as_str().unwrap().to_string();
    let (st, _, _) = call(
        r,
        "POST",
        &format!("/api/t/{t}/jobs"),
        Some(&p.cookie),
        Some(json!({ "number": "J001", "client_id": cid })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    let mut ids = vec![];
    for title in ["Brief", "Research"] {
        let clan = clan_sdk::create(clan_sdk::CreateOptions {
            title: title.into(),
            brief: "b".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap();
        let base = clan_sdk::ClanFile::from_bytes(clan).unwrap();
        let app_id = format!("ie.napkin.{}", title.to_lowercase());
        let tpl = clan_sdk::make_template(
            &base,
            clan_sdk::AppInfo {
                home: None,
                name: title.into(),
                app_id: app_id.clone(),
                version: "1.0.0".into(),
                icon: None,
                entry: "human/index.html".into(),
                schema: Some("agent/output-schema.json".into()),
                prompt_templates: vec![],
                data_seed: None,
                spinoff: None,
                attach: None,
            },
            clan_sdk::MakeTemplateOptions::default(),
        )
        .unwrap();
        let up = raw(r, &format!("/api/t/{t}/documents/upload"), &p.cookie, tpl).await;
        let doc = up["path"].as_str().unwrap().to_string();
        raw(r, &format!("/api/t/{t}/apps/from/{doc}"), &p.cookie, vec![]).await;
        let (st, made, _) = call(
            r,
            "POST",
            &format!("/api/t/{t}/documents"),
            Some(&p.cookie),
            Some(json!({ "app_id": app_id, "title": title, "client_id": cid, "job": "J001" })),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{made}");
        ids.push(made["path"].as_str().unwrap().to_string());
    }
    (ids[0].clone(), ids[1].clone())
}

async fn raw(r: &Rig, uri: &str, cookie: &str, body: Vec<u8>) -> Value {
    let req = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::COOKIE, cookie)
        .body(Body::from(body))
        .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    serde_json::from_slice(&resp.into_body().collect().await.unwrap().to_bytes())
        .unwrap_or(Value::Null)
}

async fn ev(r: &Rig, p: &Person, event: &str, doc: &str, at: i64) -> Value {
    r.clock.store(at, Ordering::SeqCst);
    call(
        r,
        "POST",
        &p.url("events"),
        Some(&p.cookie),
        Some(json!({ "event": event, "doc": doc })),
    )
    .await
    .1
}

/// What the shell does for `doc`: open, a focus every 30 seconds, close.
async fn work(r: &Rig, p: &Person, doc: &str, from: i64, to: i64) {
    ev(r, p, "open", doc, from).await;
    let mut at = from + 30_000;
    while at < to {
        ev(r, p, "focus", doc, at).await;
        at += 30_000;
    }
    ev(r, p, "close", doc, to).await;
}

async fn say(r: &Rig, p: &Person, yes: bool) {
    let (st, _, _) = call(
        r,
        "POST",
        &p.url("consent"),
        Some(&p.cookie),
        Some(json!({ "consent": yes })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
}

async fn day(r: &Rig, p: &Person) -> Value {
    call(
        r,
        "GET",
        &p.url(&format!("day?date={DATE}")),
        Some(&p.cookie),
        None,
    )
    .await
    .1
}

#[tokio::test]
async fn a_person_who_has_not_consented_has_no_captured_sessions() {
    let r = rig();
    let a = sign_in(&r, "aoife@wk").await;
    let (brief, _) = job_with_docs(&r, &a).await;
    assert_eq!(
        call(&r, "GET", &a.url("consent"), Some(&a.cookie), None)
            .await
            .1["consent"],
        "not_asked"
    );
    work(&r, &a, &brief, T0, T0 + 600_000).await;
    assert_eq!(
        ev(&r, &a, "open", &brief, T0 + 700_000).await["captured"],
        false
    );
    let (st, list, _) = call(&r, "GET", &a.url("sessions"), Some(&a.cookie), None).await;
    assert_eq!((st, list), (StatusCode::OK, json!([])));
    // having said no is the same, and so is the day: nothing drafted
    say(&r, &a, false).await;
    work(&r, &a, &brief, T0, T0 + 600_000).await;
    assert_eq!(
        call(&r, "GET", &a.url("sessions"), Some(&a.cookie), None)
            .await
            .1,
        json!([])
    );
    assert_eq!(day(&r, &a).await["lines"], json!([]));
    // not even a file: nothing was kept
    let dir = r._dir.path().join("timesheets");
    assert!(!dir.join("aoife@wk/sessions.json").exists());
}

#[tokio::test]
async fn with_consent_a_set_time_in_the_brief_is_one_session_of_that_length() {
    let r = rig();
    let a = sign_in(&r, "aoife@wk").await;
    let (brief, _) = job_with_docs(&r, &a).await;
    say(&r, &a, true).await;
    work(&r, &a, &brief, T0, T0 + 1_200_000).await;
    let (_, list, _) = call(
        &r,
        "GET",
        &a.url(&format!("sessions?date={DATE}")),
        Some(&a.cookie),
        None,
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["job"], "J001");
    assert_eq!(
        list[0]["end"].as_i64().unwrap() - list[0]["start"].as_i64().unwrap(),
        1_200_000
    );
    // a document that is no job's is not kept
    assert_eq!(
        ev(&r, &a, "open", "doc-nothing", T0 + 2_000_000).await["captured"],
        true
    );
    assert_eq!(
        call(&r, "GET", &a.url("sessions"), Some(&a.cookie), None)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn the_server_ignores_a_repeat_focus_inside_five_seconds() {
    // the shell's side (at most one event in 30 seconds) is counted in app/src/timesheet; here the server's
    let r = rig();
    let a = sign_in(&r, "aoife@wk").await;
    let (brief, _) = job_with_docs(&r, &a).await;
    say(&r, &a, true).await;
    ev(&r, &a, "open", &brief, T0).await;
    for i in 1..=4 {
        ev(&r, &a, "focus", &brief, T0 + i * 1000).await;
    }
    let list = call(&r, "GET", &a.url("sessions"), Some(&a.cookie), None)
        .await
        .1;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["end"], T0);
}

#[tokio::test]
async fn the_day_is_drafted_with_a_gap_guessed_and_a_confirm_that_links_each_line_to_its_sessions()
{
    let r = rig();
    let a = sign_in(&r, "aoife@wk").await;
    let (brief, research) = job_with_docs(&r, &a).await;
    say(&r, &a, true).await;
    work(&r, &a, &brief, T0, T0 + 3_600_000).await; // 09:00-10:00
    work(
        &r,
        &a,
        &brief,
        T0 + 3_600_000 + 4_500_000,
        T0 + 3_600_000 + 4_500_000 + 1_800_000,
    )
    .await; // 11:15-11:45
    work(
        &r,
        &a,
        &research,
        T0 + 4 * 3_600_000,
        T0 + 4 * 3_600_000 + 1_800_000,
    )
    .await; // 13:00-13:30
    let d = day(&r, &a).await;
    assert_eq!(d["status"], "draft");
    let lines = d["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 2);
    let brief_line = lines.iter().find(|l| l["label"] == "Brief").unwrap();
    assert_eq!(brief_line["minutes"], 90);
    assert_eq!(brief_line["session_ids"].as_array().unwrap().len(), 2);
    // the 75 minutes between the two brief sessions is flagged with J001 as the guess
    let gap = d["gaps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["minutes"] == 75)
        .expect("the gap");
    assert_eq!(gap["guess"]["job"], "J001");
    // accepting the guess adds a line that links to the sessions either side
    let (st, _, _) = call(
        &r,
        "POST",
        &a.url("lines"),
        Some(&a.cookie),
        Some(json!({
        "date": DATE, "job": "J001", "label": gap["guess"]["label"], "minutes": 75,
        "source": "guess", "from": gap["from"], "session_ids": gap["session_ids"] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let d = day(&r, &a).await;
    assert!(d["gaps"]
        .as_array()
        .unwrap()
        .iter()
        .all(|g| g["from"] != gap["from"]));
    // nothing is confirmed until the person says so
    assert_eq!(d["status"], "draft");
    assert!(d["confirmed_at"].is_null());
    let (st, done, _) = call(
        &r,
        "POST",
        &a.url("day/confirm"),
        Some(&a.cookie),
        Some(json!({ "date": DATE })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(done["status"], "confirmed");
    for l in done["lines"].as_array().unwrap() {
        assert!(!l["session_ids"].as_array().unwrap().is_empty(), "{l}");
    }
    // and it stays confirmed on a fresh read
    assert_eq!(day(&r, &a).await["status"], "confirmed");
}

#[tokio::test]
async fn a_person_who_says_no_fills_the_day_by_hand_sees_no_warning_or_score_and_confirms_the_same_way(
) {
    let r = rig();
    let a = sign_in(&r, "aoife@wk").await;
    job_with_docs(&r, &a).await;
    say(&r, &a, false).await;
    let (st, _, _) = call(
        &r,
        "POST",
        &a.url("lines"),
        Some(&a.cookie),
        Some(json!({ "date": DATE, "job": "J001", "label": "Brief", "minutes": 150 })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let d = day(&r, &a).await;
    assert_eq!(
        (d["total_minutes"].clone(), d["status"].clone()),
        (json!(150), json!("draft"))
    );
    let text = d.to_string().to_lowercase();
    for w in [
        "score",
        "rank",
        "rating",
        "warning",
        "penal",
        "behind",
        "productiv",
        "utilis",
    ] {
        assert!(!text.contains(w), "{w}");
    }
    let (st, done, _) = call(
        &r,
        "POST",
        &a.url("day/confirm"),
        Some(&a.cookie),
        Some(json!({ "date": DATE })),
    )
    .await;
    assert_eq!(
        (st, done["status"].clone()),
        (StatusCode::OK, json!("confirmed"))
    );
}

#[tokio::test]
async fn management_asking_for_another_persons_day_gets_403_and_so_does_everyone_else() {
    let r = rig();
    let a = sign_in(&r, "aoife@wk").await;
    let (brief, _) = job_with_docs(&r, &a).await;
    say(&r, &a, true).await;
    work(&r, &a, &brief, T0, T0 + 600_000).await;
    let m = sign_in(&r, "niamh@wk").await;
    assert_eq!(
        m.tenant, a.tenant,
        "one agency, one workspace: the wall is the person, not the tenant"
    );
    for tail in [
        format!("day?date={DATE}&person=aoife@wk"),
        "sessions?person=aoife@wk".to_string(),
        "corrections?person=aoife@wk".to_string(),
        "consent?person=aoife@wk".to_string(),
    ] {
        let (st, body, _) = call(&r, "GET", &m.url(&tail), Some(&m.cookie), None).await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{tail}");
        assert!(!body.to_string().contains("J001"));
    }
    // a colleague in the same role is refused the same; and a confirmed day is no different
    let c = sign_in(&r, "cian@wk").await;
    call(
        &r,
        "POST",
        &a.url("day/confirm"),
        Some(&a.cookie),
        Some(json!({ "date": DATE })),
    )
    .await;
    assert_eq!(
        call(
            &r,
            "GET",
            &c.url(&format!("day?date={DATE}&person=aoife@wk")),
            Some(&c.cookie),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    // without naming anyone, a manager reads their own: empty, not Aoife's
    let mine = day(&r, &m).await;
    assert_eq!(mine["lines"], json!([]));
    assert_eq!(
        call(&r, "GET", &m.url("sessions"), Some(&m.cookie), None)
            .await
            .1,
        json!([])
    );
}

#[tokio::test]
async fn corrections_are_kept_privately_and_read_by_their_person_alone() {
    let r = rig();
    let a = sign_in(&r, "aoife@wk").await;
    let (brief, _) = job_with_docs(&r, &a).await;
    say(&r, &a, true).await;
    work(&r, &a, &brief, T0, T0 + 3_600_000).await;
    let key = day(&r, &a).await["lines"][0]["key"]
        .as_str()
        .unwrap()
        .to_string();
    let (st, _, _) = call(
        &r,
        "PUT",
        &a.url("lines/change"),
        Some(&a.cookie),
        Some(json!({ "date": DATE, "key": key, "minutes": 45 })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let mine = call(&r, "GET", &a.url("corrections"), Some(&a.cookie), None)
        .await
        .1;
    assert_eq!(
        (mine[0]["before"].clone(), mine[0]["after"].clone()),
        (json!(60), json!(45))
    );
    // no manager route returns them, and the day itself carries none
    let m = sign_in(&r, "niamh@wk").await;
    assert_eq!(
        call(&r, "GET", &m.url("corrections"), Some(&m.cookie), None)
            .await
            .1,
        json!([])
    );
    assert!(!day(&r, &m).await.to_string().contains("before"));
    assert!(!day(&r, &a).await.to_string().contains("correction"));
}

#[tokio::test]
async fn napkin_never_submits_time_and_never_scores_people() {
    let r = rig();
    let a = sign_in(&r, "aoife@wk").await;
    let (brief, _) = job_with_docs(&r, &a).await;
    say(&r, &a, true).await;
    work(&r, &a, &brief, T0, T0 + 600_000).await;
    // reading a day, in any way, never confirms it
    day(&r, &a).await;
    call(&r, "GET", &a.url("sessions"), Some(&a.cookie), None).await;
    assert_eq!(day(&r, &a).await["status"], "draft");
    // there is no submit, send, export or approve route, and no route across people
    for tail in [
        "submit",
        "send",
        "export",
        "approve",
        "people",
        "team",
        "totals",
        "leaderboard",
        "scores",
        "all",
    ] {
        for method in ["GET", "POST"] {
            let (st, _, _) = call(&r, method, &a.url(tail), Some(&a.cookie), None).await;
            assert_eq!(st, StatusCode::NOT_FOUND, "{method} {tail}");
        }
    }
    // no answer of any route names a score, rank or rating
    let (brief_day, sessions) = (
        day(&r, &a).await,
        call(&r, "GET", &a.url("sessions"), Some(&a.cookie), None)
            .await
            .1,
    );
    let all = format!("{brief_day}{sessions}").to_lowercase();
    for w in [
        "score",
        "rank",
        "rating",
        "leaderboard",
        "utilis",
        "productiv",
    ] {
        assert!(!all.contains(w), "{w}");
    }
}

#[tokio::test]
async fn consent_is_an_attributed_dated_record_and_a_person_can_have_all_of_it_deleted() {
    let r = rig();
    let a = sign_in(&r, "aoife@wk").await;
    let (brief, _) = job_with_docs(&r, &a).await;
    r.clock.store(T0, Ordering::SeqCst);
    say(&r, &a, true).await;
    work(&r, &a, &brief, T0, T0 + 600_000).await;
    r.clock.store(T0 + 1, Ordering::SeqCst);
    say(&r, &a, false).await;
    let log =
        std::fs::read_to_string(r._dir.path().join("timesheets/aoife@wk/consent.jsonl")).unwrap();
    let rows: Vec<Value> = log
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(
        (
            rows[0]["actor"].clone(),
            rows[0]["action"].clone(),
            rows[0]["at"].clone()
        ),
        (json!("aoife@wk"), json!("consent yes"), json!(T0))
    );
    assert_eq!(rows[1]["action"], "consent no");
    let (st, _, _) = call(&r, "DELETE", &a.url("mine"), Some(&a.cookie), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        call(&r, "GET", &a.url("sessions"), Some(&a.cookie), None)
            .await
            .1,
        json!([])
    );
    assert!(
        std::fs::read_to_string(r._dir.path().join("timesheets/aoife@wk/consent.jsonl")).is_ok(),
        "the record of asking stays"
    );
}
