// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/job-page.clan, through the real router: who may open and change a job (and set its budget),
//! which fields of a job each role is sent (an allow list, checked role by role), and that a job of
//! another agency is a 404.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::NoConfig;
use napkin_web::state::AppCtx;
use serde_json::{json, Value};
use tower::ServiceExt;

struct Rig {
    _dir: tempfile::TempDir,
    app: Router,
}

struct Person {
    cookie: String,
    tenant: String,
}

const ROLES: &[(&str, &str)] = &[
    ("aoife@wk", "planning"),
    ("dara@wk", "creative-director"),
    ("cian@wk", "account-service"),
    ("niamh@wk", "management"),
    ("oisin@wk", "art-director"),
    ("maeve@wk", "copywriter"),
    ("ruairi@wk", "producer"),
    ("sinead@wk", "agency-brain"),
    ("fionn@wk", "traffic"),
    ("ann@wk", "admin"),
    ("sam@wk", ""),
    ("kai@other", "management"),
];

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Arc::new(AppCtx::new(
        dir.path().to_path_buf(),
        Arc::new(NoConfig),
        None,
        40,
    ));
    let roster = dir.path().join("accounts.tsv");
    let lines: String = ROLES
        .iter()
        .map(|(u, r)| format!("{u}\t{u}\t{r}\n"))
        .collect();
    std::fs::write(&roster, lines).unwrap();
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

async fn open_client(r: &Rig, p: &Person) -> Value {
    let (_, client, _) = call(
        r,
        "POST",
        &format!("/api/t/{}/clients", p.tenant),
        Some(&p.cookie),
        Some(json!({ "name": "Client A" })),
    )
    .await;
    client["id"].clone()
}

async fn jobs(
    r: &Rig,
    p: &Person,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let (s, v, _) = call(
        r,
        method,
        &format!("/api/t/{}/jobs{path}", p.tenant),
        Some(&p.cookie),
        body,
    )
    .await;
    (s, v)
}

fn key_set(v: &Value) -> Vec<String> {
    let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
    k.sort();
    k
}

fn expect(keys: &[&str]) -> Vec<String> {
    let mut k: Vec<String> = keys.iter().map(|s| s.to_string()).collect();
    k.sort();
    k
}

/// Written out here, apart from `jobview.rs`, so the lists are held to a second copy.
const EVERYONE: &[&str] = &[
    "number",
    "title",
    "client",
    "owner",
    "opened_on",
    "due",
    "stage",
    "status",
    "waiting_on",
    "days_waiting_on_client",
    "at_risk",
    "documents",
    "route",
    "holder",
];
const STEP: &[&str] = &[
    "stage",
    "label",
    "party",
    "role",
    "approver",
    "due",
    "state",
    "approved_by",
    "approved_at",
    "version",
    "document",
    "held_since",
    "days_held",
    "days_late",
];

#[tokio::test]
async fn who_may_open_and_change_a_job_and_who_may_set_its_budget() {
    let r = rig();
    let mut who = std::collections::BTreeMap::new();
    for (u, role) in ROLES {
        if !who.contains_key(role) {
            who.insert(*role, sign_in(&r, u).await);
        }
    }
    let cian = &who["account-service"];
    let client = open_client(&r, cian).await;
    let new = |n: &str, extra: Value| {
        let mut b = json!({ "number": n, "client_id": client, "title": "Autumn launch", "due": "2026-11-20" });
        b.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        b
    };

    // opening: the creative roles, the Agency Brain and traffic are refused; the rest open
    for role in [
        "creative-director",
        "art-director",
        "copywriter",
        "agency-brain",
        "traffic",
    ] {
        let (s, v) = jobs(&r, &who[role], "POST", "", Some(new("J090", json!({})))).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{role} {v}");
    }
    for (i, role) in [
        "planning",
        "account-service",
        "management",
        "producer",
        "admin",
        "",
    ]
    .iter()
    .enumerate()
    {
        let (s, v) = jobs(
            &r,
            &who[role],
            "POST",
            "",
            Some(new(&format!("J10{i}"), json!({}))),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{role} {v}");
    }

    // the budget in hours is money: set with the job only by the Money roles that manage jobs
    let (s, _) = jobs(
        &r,
        &who["planning"],
        "POST",
        "",
        Some(new("J200", json!({ "budget_hours": 80 }))),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "a planner cannot set a budget");
    let (s, v) = jobs(
        &r,
        &who["producer"],
        "POST",
        "",
        Some(new("J201", json!({ "budget_hours": 80 }))),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    // changing: J001 stands for the first job (the one the account service person opened first)
    let (s, v) = jobs(&r, cian, "POST", "", Some(new("J001", json!({})))).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    for role in [
        "creative-director",
        "art-director",
        "copywriter",
        "agency-brain",
        "traffic",
    ] {
        let (s, _) = jobs(
            &r,
            &who[role],
            "PATCH",
            "/J001",
            Some(json!({ "title": "x" })),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{role}");
    }
    let (s, v) = jobs(
        &r,
        &who["planning"],
        "PATCH",
        "/J001",
        Some(json!({ "due": "2026-11-27" })),
    )
    .await;
    assert_eq!(
        (s, v["due"].clone()),
        (StatusCode::OK, json!("2026-11-27")),
        "{v}"
    );
    let (s, _) = jobs(
        &r,
        &who["planning"],
        "PATCH",
        "/J001",
        Some(json!({ "budget_hours": 90 })),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::FORBIDDEN,
        "a planner's budget change is refused"
    );
    let (s, v) = jobs(
        &r,
        cian,
        "PATCH",
        "/J001",
        Some(json!({ "budget_hours": 90, "owner": "dara@wk" })),
    )
    .await;
    assert_eq!(
        (s, v["budget_hours"].clone()),
        (StatusCode::OK, json!(90.0)),
        "{v}"
    );
    let (s, v) = jobs(&r, cian, "PATCH", "/J001", Some(json!({ "due": null }))).await;
    assert_eq!((s, v["due"].clone()), (StatusCode::OK, Value::Null), "{v}");
    let (s, _) = jobs(
        &r,
        cian,
        "PATCH",
        "/J001",
        Some(json!({ "due": "tomorrow" })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = jobs(&r, cian, "PATCH", "/J404", Some(json!({ "title": "x" }))).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn each_role_is_sent_exactly_the_fields_it_may_see_and_another_agency_sees_nothing() {
    let r = rig();
    let mut who = std::collections::BTreeMap::new();
    for (u, role) in ROLES {
        if !who.contains_key(role) {
            who.insert(*role, sign_in(&r, u).await);
        }
    }
    let cian = &who["account-service"];
    let client = open_client(&r, cian).await;
    let (s, v) = jobs(
        &r, cian, "POST", "",
        Some(json!({ "number": "J001", "client_id": client, "title": "Autumn launch", "due": "2026-12-18", "budget_hours": 120 })),
    ).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    // every route field set: an agency step and a client step with a contact and rounds
    let (s, v) = jobs(
        &r, cian, "PUT", "/J001/route",
        Some(json!({ "route": [
            { "stage": "brief-check", "party": "agency", "role": "planner", "approver": "aoife@wk", "due": "2026-11-13" },
            { "stage": "client-approval", "party": "client", "role": "client", "approver": "Client A contact",
              "contact": "contact@client-a.example", "due": "2026-11-20", "rounds": 2 },
        ] })),
    ).await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let money = ["budget_hours"];
    let approver = ["contact", "rounds"];
    // (role, sees budget, sees client contact and rounds)
    for (role, has_money, has_approver) in [
        ("planning", false, false),
        ("creative-director", false, false),
        ("art-director", false, false),
        ("copywriter", false, false),
        ("agency-brain", false, false),
        ("producer", true, false),
        ("traffic", true, false),
        ("account-service", true, true),
        ("management", true, true),
        ("admin", true, true),
        ("", true, true),
    ] {
        let p = &who[role];
        let mut top: Vec<&str> = EVERYONE.to_vec();
        let mut step: Vec<&str> = STEP.to_vec();
        if has_money {
            top.extend(money);
        }
        if has_approver {
            step.extend(approver);
        }
        let (s, list) = jobs(&r, p, "GET", "", None).await;
        assert_eq!(s, StatusCode::OK);
        let list = list.as_array().unwrap();
        assert_eq!(list.len(), 1, "{role}");
        assert_eq!(key_set(&list[0]), expect(&top), "list as {role:?}");
        assert_eq!(
            key_set(&list[0]["route"][0]),
            expect(&step),
            "list step as {role:?}"
        );
        assert_eq!(
            key_set(&list[0]["route"][1]),
            expect(&step),
            "list client step as {role:?}"
        );
        let (s, one) = jobs(&r, p, "GET", "/J001", None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(key_set(&one), expect(&["job", "needs", "can"]));
        assert_eq!(
            one["can"]["budget"],
            json!(has_money && role != "traffic"),
            "{role}"
        );
        assert_eq!(key_set(&one["job"]), expect(&top), "one as {role:?}");
        assert_eq!(
            key_set(&one["job"]["route"][1]),
            expect(&step),
            "one step as {role:?}"
        );
        assert_eq!(
            one["job"]["budget_hours"] == json!(120.0),
            has_money,
            "{role}"
        );
        assert!(one["needs"].is_array());
        // the text of the answer carries no budget and no contact for a role that may not see them
        let text = one.to_string();
        assert_eq!(
            text.contains("contact@client-a.example"),
            has_approver,
            "{role}"
        );
    }

    // another agency: the same number is a 404, and the list is empty
    let other = sign_in(&r, "kai@other").await;
    assert_ne!(other.tenant, cian.tenant);
    let (s, _) = jobs(&r, &other, "GET", "/J001", None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, list) = jobs(&r, &other, "GET", "", None).await;
    assert_eq!((s, list), (StatusCode::OK, json!([])));
    let (s, _) = jobs(&r, &other, "PATCH", "/J001", Some(json!({ "title": "x" }))).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
