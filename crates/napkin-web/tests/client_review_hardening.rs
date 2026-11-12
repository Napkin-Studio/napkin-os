// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Who may be a client's reviewer or approver (features/client-review-full.clan, review finding 2):
//! nobody from the agency, and the job's client contact when its route names one. Through the real
//! router, with a roster, an agency directory and a signed brief.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::NoConfig;
use napkin_web::state::AppCtx;
use serde_json::{json, Value};
use tower::ServiceExt;

const BRIEF: &str = "ie.napkin.brief-maker";

struct Rig {
    _dir: tempfile::TempDir,
    app: Router,
}

struct Person {
    cookie: String,
    tenant: String,
}

const ROSTER: &str = "cara@cr\tCara\tadmin\n\
sam@cr\tSam\tplanning\n\
nodir1@nd\tNo Dir\tplanning\n";

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
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
) -> (StatusCode, Value) {
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
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn sign_in(r: &Rig, who: &str) -> Person {
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/sign-in")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "username": who }).to_string()))
        .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "{who}");
    let cookie = resp
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("napkin_session=") && !v.starts_with("napkin_session=;"))
        .map(|v| v.split(';').next().unwrap().to_string())
        .unwrap();
    let (_, me) = call(r, "GET", "/api/session", Some(&cookie), None).await;
    Person {
        cookie,
        tenant: me["tenant"].as_str().unwrap().to_string(),
    }
}

async fn invite(r: &Rig, admin: &Person, username: &str, email: &str, roles: &[&str]) {
    let (st, body) = call(
        r,
        "POST",
        &format!("/api/t/{}/agency/people/invite", admin.tenant),
        Some(&admin.cookie),
        Some(json!({ "username": username, "name": username, "email": email, "roles": roles })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{body}");
}

fn build(job: Option<&str>) -> Vec<u8> {
    let plain = clan_sdk::create(clan_sdk::CreateOptions {
        title: "Brief for Client A".into(),
        brief: "an Irish whiskey".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    let base = clan_sdk::ClanFile::from_bytes(plain).unwrap();
    let mut m = base.manifest().clone();
    m.job = job.map(String::from);
    m.app = Some(clan_sdk::AppInfo {
        home: None,
        name: "App".into(),
        app_id: BRIEF.into(),
        version: "1.0.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach: None,
    });
    let mut b = clan_sdk::ClanBuilder::new(m);
    for (path, bytes) in base.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH && path != "shared/data.yaml" {
            b.add_entry(path, bytes);
        }
    }
    let seed = json!({ "$schema": "spec/schemas/document.schema.json",
        "single_minded_proposition": "The easy way into Irish whiskey.", "insight": "Younger drinkers think it is for someone else." });
    b.add_entry("shared/data.yaml", seed.to_string().into_bytes());
    b.build().unwrap()
}

struct Doc {
    api: String,
    token: String,
}

/// A locked brief, uploaded by `p`.
async fn locked(r: &Rig, p: &Person) -> Doc {
    locked_in(r, p, None).await
}

async fn locked_in(r: &Rig, p: &Person, job: Option<&str>) -> Doc {
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/t/{}/documents/upload", p.tenant))
        .header(header::COOKIE, &p.cookie)
        .body(Body::from(build(job)))
        .unwrap();
    let up = r.app.clone().oneshot(req).await.unwrap();
    let up: Value =
        serde_json::from_slice(&up.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let path = up["path"].as_str().unwrap();
    let enc: String = path
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    let token = up["token"].as_str().unwrap().to_string();
    let (st, _) = call(
        r,
        "POST",
        &format!("/s/{token}/approve"),
        None,
        Some(json!({})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    Doc {
        api: format!("/api/t/{}/d/{enc}", p.tenant),
        token,
    }
}

async fn sendr(r: &Rig, p: &Person, d: &Doc, who: &[(&str, bool)]) -> (StatusCode, Value) {
    call(
        r,
        "POST",
        &format!("{}/client-link/round", d.api),
        Some(&p.cookie),
        Some(reviewers(who)),
    )
    .await
}

fn reviewers(list: &[(&str, bool)]) -> Value {
    json!({ "reviewers": list.iter().map(|(e, a)| json!({ "name": "R", "email": e, "approver": a })).collect::<Vec<_>>() })
}

#[tokio::test]
async fn an_agency_address_is_refused_as_a_reviewer_however_it_is_written() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "ada@cr", "ada@studio.example", &["planning"]).await;
    invite(
        &r,
        &cara,
        "sam@cr",
        "Sam.Planner@Studio.example",
        &["planning"],
    )
    .await;
    invite(&r, &cara, "gone@cr", "gone@studio.example", &["planning"]).await;
    let (st, _) = call(
        &r,
        "DELETE",
        &format!("/api/t/{}/agency/people/gone@cr", cara.tenant),
        Some(&cara.cookie),
        None,
    )
    .await;
    let _ = st; // a removed person stays on the list as removed; the rule counts them too
    let sam = sign_in(&r, "sam@cr").await;
    let doc = locked(&r, &sam).await;
    for (why, email) in [
        ("a colleague", "ada@studio.example"),
        (
            "the maker's own address, other case",
            "SAM.PLANNER@STUDIO.EXAMPLE",
        ),
        (
            "the maker's own address, spaces",
            "  sam.planner@studio.example  ",
        ),
        (
            "a plus address of the maker",
            "sam.planner+client@studio.example",
        ),
        ("a plus address of a colleague", "Ada+Alex@Studio.Example"),
        ("a removed colleague", "gone@studio.example"),
    ] {
        let (st, v) = sendr(&r, &sam, &doc, &[(email, true)]).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{why}: {v}");
        // and as a reviewer who is not the approver
        let (st, v) = sendr(
            &r,
            &sam,
            &doc,
            &[("outside@client-a.example", true), (email, false)],
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{why} as a reviewer: {v}");
    }
    // the Phase 1 single link has the same rule
    for email in ["ada@studio.example", "sam.planner+x@studio.example"] {
        let (st, v) = call(
            &r,
            "POST",
            &format!("{}/client-link", doc.api),
            Some(&sam.cookie),
            Some(json!({ "name": "Alex", "email": email })),
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "single link to {email}: {v}");
    }
    // nothing was written for any of them, and someone outside the agency is let through
    let (st, v) = sendr(&r, &sam, &doc, &[("approver@client-a.example", true)]).await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let (st, v) = call(
        &r,
        "POST",
        &format!("{}/client-link", doc.api),
        Some(&sam.cookie),
        Some(json!({ "name": "Alex", "email": "other@client-a.example" })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let (_, links) = call(
        &r,
        "GET",
        &format!("{}/client-links", doc.api),
        Some(&sam.cookie),
        None,
    )
    .await;
    assert_eq!(links["links"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn the_sandbox_cannot_make_a_link_around_the_check() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(&r, &cara, "sam@cr", "sam@studio.example", &["planning"]).await;
    let sam = sign_in(&r, "sam@cr").await;
    let doc = locked(&r, &sam).await;
    let id = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
    for (path, body) in [
        (
            "client-link/issue",
            json!({ "id": id, "name": "Me", "email": "sam@studio.example", "expires": "2099-01-01T00:00:00Z" }),
        ),
        (
            "client-link/issue-round",
            json!({ "review": id, "reviewers": [{ "id": id, "name": "Me", "email": "sam@studio.example", "approver": true }], "expires": "2099-01-01T00:00:00Z" }),
        ),
    ] {
        let (st, _) = call(
            &r,
            "POST",
            &format!("/s/{}/{path}", doc.token),
            None,
            Some(body),
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{path}");
    }
}

#[tokio::test]
async fn the_approver_is_the_routes_client_contact_when_it_names_one() {
    let r = rig();
    let cara = sign_in(&r, "cara@cr").await;
    invite(
        &r,
        &cara,
        "sam@cr",
        "sam@studio.example",
        &["planning", "account-service"],
    )
    .await;
    let sam = sign_in(&r, "sam@cr").await;
    let t = &sam.tenant;
    let (_, client) = call(
        &r,
        "POST",
        &format!("/api/t/{t}/clients"),
        Some(&sam.cookie),
        Some(json!({ "name": "Client A" })),
    )
    .await;
    let (st, _) = call(
        &r,
        "POST",
        &format!("/api/t/{t}/jobs"),
        Some(&sam.cookie),
        Some(json!({ "number": "J001", "client_id": client["id"], "due": "2026-12-18" })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    let (st, v) = call(
        &r,
        "PUT",
        &format!("/api/t/{t}/jobs/J001/route"),
        Some(&sam.cookie),
        Some(json!({ "route": [
            { "stage": "client-approval", "party": "client", "role": "client", "approver": "Client A contact",
              "contact": "Contact@Client-A.example", "due": "2026-11-20", "rounds": 2 } ] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let doc = locked_in(&r, &sam, Some("J001")).await;
    // an approver who is not the contact is refused, a reviewer who is not the approver is free
    let (st, v) = sendr(&r, &sam, &doc, &[("someone.else@client-a.example", true)]).await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{v}");
    assert!(
        v["error"]
            .as_str()
            .unwrap()
            .contains("contact@client-a.example"),
        "{v}"
    );
    let (st, v) = sendr(
        &r,
        &sam,
        &doc,
        &[
            ("someone.else@client-a.example", false),
            ("contact@client-a.example", true),
        ],
    )
    .await;
    assert_eq!(st, StatusCode::OK, "the contact is the approver: {v}");
    let (st, v) = sendr(
        &r,
        &sam,
        &doc,
        &[
            ("someone.else@client-a.example", true),
            ("contact@client-a.example", false),
        ],
    )
    .await;
    assert_eq!(
        st,
        StatusCode::BAD_REQUEST,
        "the approver is the wrong one: {v}"
    );
    let (st, v) = sendr(
        &r,
        &sam,
        &doc,
        &[
            ("  CONTACT+x@Client-A.example ", true),
            ("someone.else@client-a.example", false),
        ],
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    // the single link's client is its approver
    let (st, _) = call(
        &r,
        "POST",
        &format!("{}/client-link", doc.api),
        Some(&sam.cookie),
        Some(json!({ "name": "X", "email": "someone.else@client-a.example" })),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn an_agency_with_no_directory_refuses_only_the_makers_own_address() {
    let r = rig();
    let p = sign_in(&r, "nodir1@nd").await;
    let doc = locked(&r, &p).await;
    // nobody is on a list to match: an address that is nobody's is let through, and the sign-in
    // name (the one address the maker is known by) is not an address at all
    let (st, v) = call(
        &r,
        "POST",
        &format!("{}/client-link/round", doc.api),
        Some(&p.cookie),
        Some(reviewers(&[("approver@client-a.example", true)])),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let (st, _) = call(
        &r,
        "POST",
        &format!("{}/client-link/round", doc.api),
        Some(&p.cookie),
        Some(reviewers(&[("nodir1@nd", true)])),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}
