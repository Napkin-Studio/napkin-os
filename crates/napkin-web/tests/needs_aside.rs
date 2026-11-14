// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/align-needs-lock-people.clan, stage 1: what a person has set aside (a notice leaves, Undo,
//! stays gone after a reload, Bring back) is theirs alone, kept by the server under the key of needs.ts
//! needKey; and `GET /needs` answers, per document, {path, count, mine, earliest_due, next_deadline}.

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

async fn get(r: &Rig, p: &Person) -> Value {
    call(
        r,
        "GET",
        &format!("/api/t/{}/needs", p.tenant),
        Some(&p.cookie),
        None,
    )
    .await
    .1
}

async fn aside(r: &Rig, p: Option<&Person>, path: &str, key: &str, method: &str) -> StatusCode {
    let tenant = p.map_or("x", |p| p.tenant.as_str());
    call(
        r,
        method,
        &format!("/api/t/{tenant}/needs/{key}/aside?path={path}"),
        p.map(|p| p.cookie.as_str()),
        None,
    )
    .await
    .0
}

fn marked(v: &Value, path: &str) -> Vec<String> {
    v["aside"][path]
        .as_array()
        .map(|a| a.iter().map(|k| k.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
}

#[tokio::test]
async fn needs_are_counted_per_document_and_a_set_aside_mark_is_the_persons_own() {
    std::env::set_var("NAPKIN_BRIEF_GATE", "on");
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
    let (st, _, _) = call(
        &r,
        "PUT",
        &format!("/api/t/{t}/jobs/J001/route"),
        Some(&cian.cookie),
        Some(json!({ "route": [step("brief-check", Some("planner"), "aoife@wk", "2026-11-13")] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    // per document: the approval waiting on aoife is on the brief, mine, due 13 Nov
    let v = get(&r, &aoife).await;
    let docs = v["documents"].as_array().expect("per-document facts");
    assert_eq!(docs.len(), 1, "{v}");
    let d = &docs[0];
    let path = d["path"].as_str().unwrap().to_string();
    assert!(d["mine"].as_u64().unwrap() >= 1);
    // one count: the document's own Needs you, the number its library state and job page show
    let (_, page, _) = call(
        &r,
        "GET",
        &format!("/api/t/{t}/jobs/J001"),
        Some(&aoife.cookie),
        None,
    )
    .await;
    let own = page["job"]["documents"][0]["needs_you"].as_u64().unwrap();
    assert!(own >= 2, "a blank gated brief holds several items: {page}");
    assert_eq!(d["count"].as_u64().unwrap(), own, "{v}");
    assert_eq!(d["earliest_due"], "2026-11-13");
    assert!(d.get("next_deadline").is_some());
    // the people on no job see no document of it, and a person with no item of their own sees none as mine
    assert!(get(&r, &niamh).await["documents"]
        .as_array()
        .unwrap()
        .is_empty());
    let mine_cian = get(&r, &cian).await;
    assert!(mine_cian["documents"]
        .as_array()
        .unwrap()
        .iter()
        .all(|d| d["mine"] == 0));
    // the old answer is still there for the surfaces that read it
    assert!(v["items"].is_array() && v["total"].is_number());

    // set aside: the key is needs.ts needKey, so it holds a colon, a space and a slash
    let key = "flagged%3Atenth%20finding%2Fa";
    let plain = "flagged:tenth finding/a";
    assert_eq!(
        aside(&r, Some(&aoife), &path, key, "POST").await,
        StatusCode::OK
    );
    assert_eq!(
        aside(&r, Some(&aoife), &path, key, "POST").await,
        StatusCode::OK,
        "twice is once"
    );
    // it stays gone after a reload: the answer for the person holds it
    assert_eq!(
        marked(&get(&r, &aoife).await, &path),
        vec![plain.to_string()]
    );
    // it is theirs alone: nobody else reads it, and nobody else's Bring back touches it
    assert!(marked(&get(&r, &niamh).await, &path).is_empty());
    assert!(marked(&get(&r, &cian).await, &path).is_empty());
    assert_eq!(
        aside(&r, Some(&niamh), &path, key, "DELETE").await,
        StatusCode::OK
    );
    assert_eq!(marked(&get(&r, &aoife).await, &path).len(), 1);
    // nobody counts them: no response carries a mark for anyone but the caller
    let wire = get(&r, &niamh).await.to_string();
    assert!(!wire.contains("tenth finding"), "{wire}");
    // Bring back
    assert_eq!(
        aside(&r, Some(&aoife), &path, key, "DELETE").await,
        StatusCode::OK
    );
    assert!(marked(&get(&r, &aoife).await, &path).is_empty());
    // a person who is not signed in has nobody to keep a mark for
    let anon = aside(&r, None, &path, key, "POST").await;
    assert!(
        anon == StatusCode::FORBIDDEN || anon == StatusCode::UNAUTHORIZED,
        "{anon}"
    );
    // the index takes no write
    for method in ["POST", "PUT", "PATCH", "DELETE"] {
        let (st, _, _) = call(
            &r,
            method,
            &format!("/api/t/{t}/needs"),
            Some(&aoife.cookie),
            Some(json!({})),
        )
        .await;
        assert_eq!(st, StatusCode::METHOD_NOT_ALLOWED, "{method}");
    }
}

#[tokio::test]
async fn aside_routes_keep_to_the_session_tenant_and_to_documents_of_it() {
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
    brief(&r, &t, client["id"].as_str().unwrap());
    let call_aside = |tenant: String, path: String, method: &'static str| {
        let (r, c) = (&r, aoife.cookie.clone());
        async move {
            call(
                r,
                method,
                &format!("/api/t/{tenant}/needs/k1/aside?path={path}"),
                Some(&c),
                None,
            )
            .await
            .0
        }
    };
    let other = "11111111-2222-3333-4444-555555555555".to_string();
    for method in ["POST", "DELETE"] {
        for tenant in [other.clone(), "not-a-tenant".to_string()] {
            assert_eq!(
                call_aside(tenant.clone(), "doc-b1".into(), method).await,
                StatusCode::FORBIDDEN,
                "{method} {tenant}"
            );
        }
    }
    // a path that is not a document of this tenant is refused, and never kept
    for path in ["..%2F..%2Fetc%2Fpasswd", "doc-nothing", "not%20a%20doc"] {
        let st = call_aside(t.clone(), path.into(), "POST").await;
        assert!(
            st == StatusCode::NOT_FOUND || st == StatusCode::BAD_REQUEST,
            "{path}: {st}"
        );
    }
    assert_eq!(
        call_aside(t.clone(), "doc-b1".into(), "POST").await,
        StatusCode::OK
    );
    let (_, v, _) = call(
        &r,
        "GET",
        &format!("/api/t/{t}/needs"),
        Some(&aoife.cookie),
        None,
    )
    .await;
    assert_eq!(v["aside"].as_object().unwrap().len(), 1, "{v}");
}
