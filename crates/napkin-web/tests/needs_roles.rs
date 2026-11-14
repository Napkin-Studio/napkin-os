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
        "cian@wk\tCian\taccount-service\naoife@wk\tAoife\tplanning\ndara@wk\tDara\tcreative-director\nniamh@wk\tNiamh\tmanagement\nmaeve@wk\tMaeve\tadmin\nad@wk\tAd\tadmin\npat@wk\tPat\tplanning\n",
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

async fn setup(r: &Rig, owner: &str) -> (Person, Person, String) {
    let cian = sign_in(r, "cian@wk").await;
    let aoife = sign_in(r, "aoife@wk").await;
    let t = aoife.tenant.clone();
    let (_, client, _) = call(
        r,
        "POST",
        &format!("/api/t/{t}/clients"),
        Some(&aoife.cookie),
        Some(json!({ "name": "Client A" })),
    )
    .await;
    let (st, _, _) = call(r, "POST", &format!("/api/t/{t}/jobs"), Some(&cian.cookie),
        Some(json!({ "number": "J001", "client_id": client["id"], "due": "2026-11-30", "owner": owner }))).await;
    assert_eq!(st, StatusCode::CREATED);
    brief(r, &t, client["id"].as_str().unwrap());
    (cian, aoife, t)
}

async fn route(r: &Rig, cian: &Person, t: &str) {
    let (st, _, _) = call(
        r,
        "PUT",
        &format!("/api/t/{t}/jobs/J001/route"),
        Some(&cian.cookie),
        Some(json!({ "route": [step("brief-check", Some("planner"), "aoife@wk", "2026-11-13")] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
}

/// R1: an admin's Me row counts another person's notice as the admin's own.
#[tokio::test]
async fn review_an_admin_is_not_told_anothers_notice_is_theirs() {
    let r = rig();
    let (cian, _aoife, t) = setup(&r, "aoife@wk").await;
    route(&r, &cian, &t).await;
    let ad = sign_in(&r, "ad@wk").await;
    let v = decisions(&r, &ad, "doc-b1").await;
    let notes: Vec<&Value> = v["attention"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["code"].as_str().unwrap().starts_with("notice:"))
        .collect();
    eprintln!("ADMIN DECISION VIEW NOTICES: {}", json!(notes));
    let d = get(&r, &ad, "").await;
    eprintln!("ADMIN NEEDS: {d}");
    assert_eq!(
        d["documents"][0]["mine"], 0,
        "the notice is for aoife, not for the admin: {d}"
    );
}

/// R2: a person demoted from admin after signing in still gets every person's notices through the sandbox.
#[tokio::test]
async fn review_a_demoted_admin_stops_seeing_others_notices() {
    let r = rig();
    let (cian, _aoife, t) = setup(&r, "aoife@wk").await;
    route(&r, &cian, &t).await;
    let ad = sign_in(&r, "ad@wk").await;
    for (u, roles) in [
        ("ad@wk", vec!["admin"]),
        ("aoife@wk", vec!["planning"]),
        ("cian@wk", vec!["account-service"]),
        ("maeve@wk", vec!["admin"]),
    ] {
        let (st, body, _) = call(&r, "POST", &format!("/api/t/{t}/agency/people/invite"), Some(&ad.cookie),
            Some(json!({ "username": u, "name": u, "email": format!("{}@mail.example.test", u.split('@').next().unwrap()), "roles": roles }))).await;
        eprintln!("invite {u}: {st} {body}");
    }
    let maeve = sign_in(&r, "maeve@wk").await;
    let (st, body, _) = call(
        &r,
        "PUT",
        &format!("/api/t/{t}/agency/people/maeve@wk"),
        Some(&ad.cookie),
        Some(json!({ "roles": ["copywriter"] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{body}");
    let (_, me, _) = call(&r, "GET", "/api/session", Some(&maeve.cookie), None).await;
    eprintln!("MAEVE SESSION: {me}");
    let d = get(&r, &maeve, "").await;
    eprintln!("MAEVE NEEDS (live roles): {d}");
    let v = decisions(&r, &maeve, "doc-b1").await;
    let notes: Vec<&Value> = v["attention"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["code"].as_str().unwrap().starts_with("notice:"))
        .collect();
    eprintln!("MAEVE DECISION VIEW NOTICES: {}", json!(notes));
    assert!(
        notes.is_empty(),
        "a copywriter off the job is shown aoife's notice: {}",
        json!(notes)
    );
}

/// R3: a role's lock item on a job where nobody holds the role reaches no planner's Me rows.
#[tokio::test]
async fn review_a_roles_gate_item_is_not_orphaned_from_me_rows() {
    std::env::set_var("NAPKIN_BRIEF_GATE", "on");
    let r = rig();
    let (_cian, aoife, _t) = setup(&r, "cian@wk").await;
    let v = decisions(&r, &aoife, "doc-b1").await;
    let mine: Vec<&Value> = v["attention"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["for"]["role"] == "planning")
        .collect();
    eprintln!(
        "AOIFE DRAWER ITEMS FOR ROLE planning: {} blockers={}",
        mine.len(),
        v["lock"]["blockers"]
    );
    let d = get(&r, &aoife, "").await;
    eprintln!("AOIFE NEEDS: {d}");
    assert!(
        !mine.is_empty(),
        "the brief holds items for the planning role"
    );
    assert!(
        d["documents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["mine"].as_u64().unwrap_or(0) > 0),
        "Me rows hold nothing for the planner: {d}"
    );
}

/// R4: a deadline within 48 hours on a job with no document yet reaches its owner nowhere.
#[tokio::test]
async fn review_a_deadline_on_a_job_with_no_document_still_reaches_its_owner() {
    let r = rig();
    let aoife = sign_in(&r, "aoife@wk").await;
    let t = aoife.tenant.clone();
    let (_, client, _) = call(
        &r,
        "POST",
        &format!("/api/t/{t}/clients"),
        Some(&aoife.cookie),
        Some(json!({ "name": "Client A" })),
    )
    .await;
    let (st, _, _) = call(&r, "POST", &format!("/api/t/{t}/jobs"), Some(&aoife.cookie),
        Some(json!({ "number": "J001", "client_id": client["id"], "due": "2026-11-13", "owner": "aoife@wk" }))).await;
    assert_eq!(st, StatusCode::CREATED);
    let (_, job, _) = call(
        &r,
        "GET",
        &format!("/api/t/{t}/jobs/J001"),
        Some(&aoife.cookie),
        None,
    )
    .await;
    eprintln!("JOB NEEDS (the index has it): {}", job["needs"]);
    let d = get(&r, &aoife, "").await;
    eprintln!("AOIFE NEEDS: {d}");
    assert!(
        job["needs"]
            .as_array()
            .is_some_and(|a| a.iter().any(|n| n["kind"] == "deadline")),
        "the index holds the deadline alert"
    );
    // An alert is an item on a document: a job with none has no document to hold it. The owner still has it as the
    // desk's next deadline, and the job's answer no longer offers a Done that nothing keeps.
    assert!(d["documents"].as_array().unwrap().is_empty(), "{d}");
    assert_eq!(d["next_deadline"]["job"], "J001", "{d}");
    assert_eq!(d["next_deadline"]["due"], "2026-11-13", "{d}");
    assert!(
        job["needs"]
            .as_array()
            .unwrap()
            .iter()
            .all(|n| n.get("can_done").is_none()),
        "{}",
        job["needs"]
    );
}

/// Stage 3 of features/align-needs-lock-people.clan: in an agency that never had a directory, a document token
/// minted while a person was an admin does not keep the role once they are demoted. The sandbox reads the
/// People store, not the token.
#[tokio::test]
async fn a_token_minted_before_a_demotion_carries_no_role_in_a_roster_only_agency() {
    let r = rig();
    let (cian, _aoife, t) = setup(&r, "aoife@wk").await;
    route(&r, &cian, &t).await;
    let maeve = sign_in(&r, "maeve@wk").await;
    let (_, open, _) = call(
        &r,
        "GET",
        &format!("/api/t/{t}/d/doc-b1"),
        Some(&maeve.cookie),
        None,
    )
    .await;
    let token = open["token"].as_str().expect("a token").to_string();
    let ad = sign_in(&r, "ad@wk").await;
    let (st, body, _) = call(
        &r,
        "PUT",
        "/api/admin/people/maeve@wk/roles",
        Some(&ad.cookie),
        Some(json!({ "roles": ["copywriter"] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{body}");
    let v = call(&r, "GET", &format!("/s/{token}/decisions"), None, None)
        .await
        .1;
    let notes: Vec<&Value> = v["attention"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["code"].as_str().unwrap().starts_with("notice:"))
        .collect();
    assert!(
        notes.is_empty(),
        "the old token still reads as an admin: {}",
        json!(notes)
    );
    let (_, doors, _) = call(&r, "GET", &format!("/api/t/{t}/doors"), Some(&maeve.cookie), None).await;
    assert_eq!(doors["roles"], json!(["copywriter"]), "{doors}");
}
