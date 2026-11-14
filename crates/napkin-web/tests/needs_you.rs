// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/needs-you-full.clan and features/align-needs-lock-people.clan, through the real router: the
//! timesheet reminder is the caller's own and only after the question was asked; an alert of the job index
//! reaches the document's own decision view as a notice for the person it is for, and for nobody else.

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
    #[allow(dead_code)]
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

const BRIEF_MAKER: &str = "ie.napkin.brief-maker";

fn step(stage: &str, role: Option<&str>, approver: &str, due: &str) -> Value {
    json!({ "stage": stage, "party": "agency", "role": role, "approver": approver, "due": due })
}

/// A Brief Maker brief filed under J001, in the tenant's documents folder.
fn brief(r: &Rig, tenant: &str, client: &str) {
    let base = clan_sdk::ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "J001 brief".into(),
            brief: "a brief".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut m = base.manifest().clone();
    m.app = Some(clan_sdk::AppInfo {
        home: None,
        name: "Brief Maker".into(),
        app_id: BRIEF_MAKER.into(),
        version: "1.0.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach: None,
    });
    m.client = Some(clan_sdk::ClientRef {
        id: client.into(),
        name: "Client A".into(),
    });
    m.job = Some("J001".into());
    let mut b = clan_sdk::ClanBuilder::new(m);
    for (path, bytes) in base.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH {
            b.add_entry(path, bytes);
        }
    }
    let docs = r._dir.path().join(tenant).join("documents");
    std::fs::create_dir_all(&docs).unwrap();
    std::fs::write(docs.join("b1.clan"), b.build().unwrap()).unwrap();
}

async fn get(r: &Rig, p: &Person, query: &str) -> Value {
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

/// The decision view of `doc` as `p` gets it from the app sandbox.
async fn decisions(r: &Rig, p: &Person, doc: &str) -> Value {
    let (_, open, _) = call(
        r,
        "GET",
        &format!("/api/t/{}/d/{doc}", p.tenant),
        Some(&p.cookie),
        None,
    )
    .await;
    let token = open["token"].as_str().expect("a token").to_string();
    call(r, "GET", &format!("/s/{token}/decisions"), None, None)
        .await
        .1
}

fn codes(v: &Value) -> Vec<String> {
    v["attention"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["code"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn an_alert_is_a_notice_on_its_document_for_the_person_it_is_for_only() {
    let r = rig();
    let cian = sign_in(&r, "cian@wk").await;
    let aoife = sign_in(&r, "aoife@wk").await;
    let niamh = sign_in(&r, "niamh@wk").await;
    let t = aoife.tenant.clone();
    let (_, client, _) = call(
        &r,
        "POST",
        &format!("/api/t/{t}/clients"),
        Some(&aoife.cookie),
        Some(json!({ "name": "Client A" })),
    )
    .await;
    let (st, _, _) = call(
        &r,
        "POST",
        &format!("/api/t/{t}/jobs"),
        Some(&aoife.cookie),
        Some(json!({ "number": "J001", "client_id": client["id"], "due": "2026-11-30", "owner": "aoife@wk" })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    brief(&r, &t, client["id"].as_str().unwrap());
    // aoife approves the brief by 13 Nov: inside 48 hours of the clock, so it is hers to see
    let (st, _, _) = call(
        &r,
        "PUT",
        &format!("/api/t/{t}/jobs/J001/route"),
        Some(&cian.cookie),
        Some(json!({ "route": [step("brief-check", Some("planner"), "aoife@wk", "2026-11-13")] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let mine = decisions(&r, &aoife, "doc-b1").await;
    assert!(
        codes(&mine).contains(&"notice:approval".to_string()),
        "{mine}"
    );
    let n = mine["attention"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["code"] == "notice:approval")
        .unwrap();
    assert_eq!(n["blocks_lock"], false);
    assert_eq!(n["for"], json!({ "person": "aoife@wk" }));
    assert_eq!(n["due"], "2026-11-13");
    assert_eq!(n["job"], "J001");
    assert_eq!(mine["lock"]["blockers"], 0, "a notice never holds the lock");
    // nobody else has it: not the one who set the route, not management
    for p in [&cian, &niamh] {
        let v = decisions(&r, p, "doc-b1").await;
        assert!(!codes(&v).iter().any(|c| c.starts_with("notice:")), "{v}");
    }
    // the desk counts it for her alone
    let d = get(&r, &aoife, "").await;
    assert_eq!(d["documents"][0]["notices"], 1, "{d}");
    assert_eq!(d["documents"][0]["mine"], 1);
    assert_eq!(
        get(&r, &niamh, "").await["documents"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    // set aside takes it out of what is hers
    let key = format!(
        "notice%3Aapproval%3A{}",
        n["text"]
            .as_str()
            .unwrap()
            .replace(' ', "%20")
            .replace(':', "%3A")
            .replace(',', "%2C")
            .replace('.', "%2E")
    );
    let st = call(
        &r,
        "POST",
        &format!("/api/t/{t}/needs/{key}/aside?path=doc-b1"),
        Some(&aoife.cookie),
        None,
    )
    .await
    .0;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(get(&r, &aoife, "").await["documents"][0]["mine"], 0);
}

#[tokio::test]
async fn the_timesheet_reminder_is_the_callers_own_after_the_question_and_from_four() {
    let r = rig();
    let aoife = sign_in(&r, "aoife@wk").await;
    let niamh = sign_in(&r, "niamh@wk").await;
    let maeve = sign_in(&r, "maeve@wk").await;
    let ms = |h: i64| at("2026-11-12") * 1000 - 12 * 3_600_000 + h * 3_600_000;
    r.sheet.store(ms(17), Ordering::SeqCst);
    let has = |v: &Value| !v["timesheet"].is_null();
    // nobody has been asked: nobody has a reminder
    for p in [&aoife, &niamh, &maeve] {
        assert!(!has(&get(&r, p, "").await));
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
        assert!(has(&get(&r, p, "").await));
    }
    assert!(!has(&get(&r, &niamh, "").await));
    // before 16:00 local time there is none: 15:00 UTC is 16:00 in UTC+1
    r.sheet.store(ms(15), Ordering::SeqCst);
    assert!(!has(&get(&r, &aoife, "").await));
    assert!(has(&get(&r, &aoife, "?tz=60").await));
    // tomorrow is a new day: a new reminder
    r.sheet.store(ms(17), Ordering::SeqCst);
    let id = get(&r, &aoife, "").await["timesheet"]["id"].clone();
    r.sheet.store(ms(17) + 86_400_000, Ordering::SeqCst);
    assert_ne!(get(&r, &aoife, "").await["timesheet"]["id"], id);
}
