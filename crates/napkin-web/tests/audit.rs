// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/agency-setup.clan, stage 3, through the real router: the audit view lists every approval,
//! export, link, permission change and sign-in that was refused, for an admin only; its file chains each
//! line to the one before, and verifying fails after one line is edited or the end is cut off; it holds
//! nothing from a timesheet.

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
aoife@cr\tAoife\tplanning\n\
dara@cr\tDara\tcreative-director\n\
cian@cr\tCian\taccount-service\n\
niamh@cr\tNiamh\tmanagement\n\
barra@bq\tBarra\tadmin\n";

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
        &format!("/api/t/{}/agency/people/invite", admin.tenant),
        Some(&admin.cookie),
        Some(json!({ "username": username, "name": name, "email": format!("{}@mail.example.test", username.split('@').next().unwrap()), "roles": roles })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{body}");
}

/// A Brief Maker brief that has passed the gate, with Aoife as its planner and Dara as its creative director.
fn brief_bytes() -> Vec<u8> {
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
    m.app = Some(clan_sdk::AppInfo {
        home: None,
        name: "Brief Maker".into(),
        app_id: "ie.napkin.brief-maker".into(),
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
    let seed = json!({
        "$schema": "spec/schemas/document.schema.json",
        "single_minded_proposition": "The easy way into Irish whiskey.",
        "insight": "Younger drinkers think Irish whiskey is for someone else.",
        "objectives": { "commercial": "Grow bar sales by 8% in the autumn quarter." },
        "desired_response": { "feel": "Welcome.", "do": "Order a first pour." },
        "famous": "A bar that closes its doors for one song.",
        "measurement": ["Baseline: 6% of bar orders. Target: 14% by December."],
        "signers": [
            { "role": "planner", "person": "aoife@cr" },
            { "role": "creative_director", "person": "dara@cr" },
        ],
    });
    b.add_entry("shared/data.yaml", seed.to_string().into_bytes());
    b.build().unwrap()
}

async fn upload(r: &Rig, p: &Person, clan: Vec<u8>) -> (String, String) {
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/t/{}/documents/upload", p.tenant))
        .header(header::COOKIE, &p.cookie)
        .body(Body::from(clan))
        .unwrap();
    let up = r.app.clone().oneshot(req).await.unwrap();
    let v: Value =
        serde_json::from_slice(&up.into_body().collect().await.unwrap().to_bytes()).unwrap();
    (
        v["path"].as_str().unwrap().to_string(),
        v["token"].as_str().unwrap().to_string(),
    )
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

/// The token a person's own open of the document gives them: the host acts as them on it.
async fn token_for(r: &Rig, p: &Person, doc: &str) -> String {
    let (st, v, _) = call(
        r,
        "GET",
        &format!("/api/t/{}/d/{}", p.tenant, enc(doc)),
        Some(&p.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    v["token"].as_str().unwrap().to_string()
}

async fn sandbox(r: &Rig, token: &str, path: &str, body: Value) -> StatusCode {
    let (st, v, _) = call(r, "POST", &format!("/s/{token}{path}"), None, Some(body)).await;
    assert!(st == StatusCode::OK, "{path}: {st} {v}");
    st
}

/// The agency's day: a brief signed, locked and confirmed by the client, exported, a link made, a role changed, a sign-in refused.
async fn a_day(r: &Rig) -> (Person, String) {
    let cara = sign_in(r, "cara@cr").await;
    for (u, n, role) in [
        ("aoife@cr", "Aoife Test", "planning"),
        ("dara@cr", "Dara Test", "creative-director"),
        ("cian@cr", "Cian Test", "account-service"),
        ("niamh@cr", "Niamh Test", "management"),
    ] {
        invite(r, &cara, u, n, &[role]).await;
    }
    let (doc, _) = upload(r, &cara, brief_bytes()).await;
    let aoife = sign_in(r, "aoife@cr").await;
    sandbox(r, &token_for(r, &aoife, &doc).await, "/sign", json!({})).await;
    let dara = sign_in(r, "dara@cr").await;
    let dara_token = token_for(r, &dara, &doc).await;
    sandbox(r, &dara_token, "/sign", json!({})).await;
    sandbox(r, &dara_token, "/client-review", json!({ "answer": "accepted", "client": { "name": "Client A contact" }, "channel": "none", "parts": [] })).await;
    let (st, v, _) = call(
        r,
        "POST",
        &format!("/api/t/{}/d/{}/export", dara.tenant, enc(&doc)),
        Some(&dara.cookie),
        Some(json!({ "kind": "html" })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let cian = sign_in(r, "cian@cr").await;
    let (st, v, _) = call(
        r,
        "POST",
        &format!("/api/t/{}/d/{}/client-link", cian.tenant, enc(&doc)),
        Some(&cian.cookie),
        Some(json!({ "name": "Client A contact", "email": "contact@client-a.example" })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let (st, _, _) = call(
        r,
        "PUT",
        &format!("/api/t/{}/agency/people/niamh@cr", cara.tenant),
        Some(&cara.cookie),
        Some(json!({ "roles": ["management", "traffic"] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(try_sign_in(r, "ghost@cr").await.0, StatusCode::UNAUTHORIZED);
    (cara, doc)
}

async fn audit(r: &Rig, p: &Person, query: &str) -> (StatusCode, Value) {
    let (st, v, _) = call(
        r,
        "GET",
        &format!("/api/t/{}/audit{query}", p.tenant),
        Some(&p.cookie),
        None,
    )
    .await;
    (st, v)
}

#[tokio::test]
async fn the_audit_view_lists_each_approval_export_link_role_change_and_refused_sign_in() {
    let r = rig();
    let (cara, doc) = a_day(&r).await;
    let (st, v) = audit(&r, &cara, "").await;
    assert_eq!(st, StatusCode::OK);
    let lines = v["lines"].as_array().unwrap();
    let of = |kind: &str| {
        lines
            .iter()
            .filter(|l| l["kind"] == kind)
            .collect::<Vec<_>>()
    };
    // approvals, read from the chain: a signature, the lock, the client's answer
    let approvals = of("approval");
    assert_eq!(approvals.len(), 3, "{approvals:?}");
    let by = |who: &str| approvals.iter().filter(|l| l["who"] == who).count();
    assert_eq!(
        (by("aoife@cr"), by("dara@cr")),
        (1, 2),
        "Aoife signed; Dara's signature is the lock, and she recorded the client's answer"
    );
    assert!(approvals
        .iter()
        .any(|l| l["what"].as_str().unwrap().starts_with("Signed")));
    assert!(approvals
        .iter()
        .any(|l| l["what"].as_str().unwrap().starts_with("Locked")));
    assert!(approvals
        .iter()
        .any(|l| l["what"].as_str().unwrap().contains("Client A contact")));
    for l in &approvals {
        assert_eq!(l["doc"], json!(doc));
        assert!(
            l["version"]
                .as_str()
                .is_some_and(|v| v.starts_with("sha256:")),
            "{l}"
        );
        assert!(l["at"].as_str().is_some_and(|t| t.len() == 20));
    }
    // an export and a link, by the person who did them, on this document
    let export = &of("export")[0];
    assert_eq!(
        (export["who"].as_str(), export["doc"].as_str()),
        (Some("dara@cr"), Some(doc.as_str()))
    );
    assert!(export["version"].as_str().is_some());
    let link = &of("link")[0];
    assert_eq!(
        (link["who"].as_str(), link["doc"].as_str()),
        (Some("cian@cr"), Some(doc.as_str()))
    );
    // a permission change: the admin as the actor, with the roles in the sentence
    let roles = of("permission")
        .into_iter()
        .find(|l| l["what"].as_str().unwrap().contains("management, traffic"))
        .expect("the role change");
    assert_eq!(roles["who"], json!("cara@cr"));
    assert_eq!(roles["doc"], json!("niamh@cr"));
    // a sign-in refused, with where it came from
    let refused = of("sign-in")
        .into_iter()
        .find(|l| l["what"].as_str().unwrap().contains("refused"))
        .expect("the refused sign-in");
    assert_eq!(refused["who"], json!("ghost@cr"));
    assert_eq!(refused["ip"], json!("direct"));
    // a copy of the registry's decision is there once, however often the view is read
    let again = audit(&r, &cara, "").await.1;
    assert_eq!(again["total"], v["total"]);
    // newest first, and a kind narrows it
    let times: Vec<&str> = lines.iter().map(|l| l["at"].as_str().unwrap()).collect();
    assert!(times.windows(2).all(|w| w[0] >= w[1]));
    assert!(audit(&r, &cara, "?kind=export").await.1["lines"]
        .as_array()
        .unwrap()
        .iter()
        .all(|l| l["kind"] == "export"));
    // each line is an allow list: nothing but who, what, which document and version, when (and the address)
    for l in lines {
        for k in l.as_object().unwrap().keys() {
            assert!(
                ["at", "who", "kind", "what", "doc", "version", "ip"].contains(&k.as_str()),
                "{k}"
            );
        }
    }
}

#[tokio::test]
async fn only_an_admin_reads_the_audit_view_and_another_agencys_admin_cannot_name_its_tenant() {
    let r = rig();
    let (cara, _) = a_day(&r).await;
    for who in ["aoife@cr", "dara@cr", "cian@cr", "niamh@cr"] {
        let p = sign_in(&r, who).await;
        assert_eq!(audit(&r, &p, "").await.0, StatusCode::FORBIDDEN, "{who}");
        let (st, _, _) = call(
            &r,
            "GET",
            &format!("/api/t/{}/audit/verify", p.tenant),
            Some(&p.cookie),
            None,
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{who}");
    }
    let barra = sign_in(&r, "barra@bq").await;
    for path in ["audit", "audit/verify"] {
        let (st, _, _) = call(
            &r,
            "GET",
            &format!("/api/t/{}/{path}", cara.tenant),
            Some(&barra.cookie),
            None,
        )
        .await;
        assert_eq!(
            st,
            StatusCode::FORBIDDEN,
            "{path}: an admin of another agency"
        );
    }
    assert_eq!(
        audit(&r, &barra, "").await.1["total"],
        json!(0),
        "and their own agency's view holds none of this one's"
    );
    let (st, _, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/audit", cara.tenant),
        None,
        None,
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED, "no session at all");
}

#[tokio::test]
async fn the_log_chains_each_line_to_the_one_before_and_verifying_fails_after_an_edit_or_a_cut() {
    let r = rig();
    let (cara, _) = a_day(&r).await;
    let verify = || async {
        call(
            &r,
            "GET",
            &format!("/api/t/{}/audit/verify", cara.tenant),
            Some(&cara.cookie),
            None,
        )
        .await
    };
    audit(&r, &cara, "").await; // the view copies the registry's decisions in
    let (st, v, _) = verify().await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(v["ok"], json!(true));
    let n = v["lines"].as_u64().unwrap();
    assert!(n >= 8, "{n}");

    let file = r
        .dir
        .path()
        .join(TenantId::of_agency("cr").as_str())
        .join("audit.jsonl");
    let original = std::fs::read_to_string(&file).unwrap();
    let lines: Vec<&str> = original.lines().collect();
    // each line carries the hash of the line before
    let parsed: Vec<Value> = lines
        .iter()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    for w in parsed.windows(2) {
        assert_eq!(w[1]["prev"], w[0]["hash"]);
    }
    // one line edited
    let edited = original.replacen("Sign-in refused.", "Signed in.", 1);
    assert_ne!(edited, original);
    std::fs::write(&file, &edited).unwrap();
    let (st, v, _) = verify().await;
    assert_eq!(
        (st, v["ok"].clone()),
        (StatusCode::CONFLICT, json!(false)),
        "{v}"
    );
    assert!(v["line"].as_u64().unwrap() >= 1);
    assert_eq!(
        v["problem"],
        json!("a line was changed after it was written")
    );
    // restored, then a middle line removed, then the end cut off
    std::fs::write(&file, &original).unwrap();
    assert_eq!(verify().await.0, StatusCode::OK);
    let without: Vec<&str> = lines
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != 2)
        .map(|(_, l)| *l)
        .collect();
    std::fs::write(&file, without.join("\n") + "\n").unwrap();
    assert_eq!(verify().await.0, StatusCode::CONFLICT);
    std::fs::write(&file, lines[..lines.len() - 1].join("\n") + "\n").unwrap();
    let (st, v, _) = verify().await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(v["problem"], json!("the log ends sooner than it should"));
    std::fs::write(&file, &original).unwrap();
    assert_eq!(verify().await.0, StatusCode::OK);
    // a new event after all that continues the chain
    assert_eq!(
        try_sign_in(&r, "ghost2@cr").await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(verify().await.0, StatusCode::OK);
}

#[tokio::test]
async fn nothing_from_a_timesheet_a_correction_or_a_consent_is_in_the_audit_view() {
    let r = rig();
    let (cara, _) = a_day(&r).await;
    let aoife = sign_in(&r, "aoife@cr").await;
    let (st, _, _) = call(
        &r,
        "POST",
        &format!("/api/t/{}/timesheet/consent", aoife.tenant),
        Some(&aoife.cookie),
        Some(json!({ "consent": true })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, v, _) = call(
        &r,
        "POST",
        &format!("/api/t/{}/timesheet/lines", aoife.tenant),
        Some(&aoife.cookie),
        Some(json!({ "date": "2026-11-12", "label": "CANARY-TIMESHEET-LINE", "minutes": 95 })),
    )
    .await;
    assert!(st.is_success(), "{st} {v}");
    let (_, view) = audit(&r, &cara, "").await;
    let text = view.to_string();
    for needle in [
        "CANARY-TIMESHEET-LINE",
        "consent",
        "timesheet",
        "correction",
    ] {
        assert!(
            !text.to_lowercase().contains(&needle.to_lowercase()),
            "the view mentions {needle}: {text}"
        );
    }
    let file = std::fs::read_to_string(
        r.dir
            .path()
            .join(TenantId::of_agency("cr").as_str())
            .join("audit.jsonl"),
    )
    .unwrap();
    assert!(!file.contains("CANARY-TIMESHEET-LINE"));
}

#[tokio::test]
async fn an_agency_with_no_workspace_is_not_given_a_log_by_a_made_up_sign_in() {
    let r = rig();
    assert_eq!(
        try_sign_in(&r, "nobody@nowhere").await.0,
        StatusCode::UNAUTHORIZED
    );
    assert!(!r
        .dir
        .path()
        .join(TenantId::of_agency("nowhere").as_str())
        .exists());
}
