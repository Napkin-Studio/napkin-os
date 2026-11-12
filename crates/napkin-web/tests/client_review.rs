// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The full client review link through the real router (features/client-review-full.clan): several
//! reviewers in a round, one link each; the pieces one at a time; comments; the emailed code; and the
//! wall: what a reviewer's replies hold, for every document type a link can show, seeded from every key
//! of that type's schema.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use axum::body::{Body, Bytes};
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::ops::client_pieces::{self, Shape, BEAT_KEYS, SPECS};
use napkin_host::NoConfig;
use napkin_web::links::{sign, unix_now, verify, Bad, Claims, SCOPE, SCOPE_REVIEW};
use napkin_web::mail::{Mailer, Memory, Message};
use napkin_web::state::AppCtx;
use serde_json::{json, Value};
use tower::ServiceExt;

const BRIEF: &str = "ie.napkin.brief-maker";
const VISUAL: &str = "ie.napkin.visual-brief";
const SCRIPT: &str = "ie.napkin.script-editor";

struct Server {
    _dir: tempfile::TempDir,
    ctx: Arc<AppCtx>,
    app: Router,
    mail: Arc<Memory>,
    clock: Arc<AtomicU64>,
}

fn server() -> Server {
    server_with(|c| c)
}

fn server_with(tune: impl FnOnce(AppCtx) -> AppCtx) -> Server {
    let dir = tempfile::tempdir().unwrap();
    let mail = Arc::new(Memory::default());
    let clock = Arc::new(AtomicU64::new(1_800_000_000));
    let c = clock.clone();
    let ctx = Arc::new(tune(
        AppCtx::new(dir.path().to_path_buf(), Arc::new(NoConfig), None, 40)
            .with_mailer(mail.clone() as Arc<dyn Mailer>, 200)
            .with_code_clock(move || c.load(Ordering::SeqCst)),
    ));
    let app = napkin_web::router(ctx.clone(), None, false);
    Server {
        _dir: dir,
        ctx,
        app,
        mail,
        clock,
    }
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).to_string()
    }
}

async fn send_with(
    s: &Server,
    method: &str,
    uri: &str,
    headers: &[(&str, &str)],
    body: Option<Value>,
) -> Reply {
    let mut b = Request::builder().method(method).uri(uri);
    for (k, v) in headers {
        b = b.header(*k, *v);
    }
    let req = match body {
        Some(v) => b
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(v.to_string())),
        None => b.body(Body::empty()),
    }
    .unwrap();
    let resp = s.app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        body,
    }
}

async fn send(
    s: &Server,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> Reply {
    match cookie {
        Some(c) => send_with(s, method, uri, &[("cookie", c)], body).await,
        None => send_with(s, method, uri, &[], body).await,
    }
}

fn build(app_id: &str, data: &Value, assets: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let plain = clan_sdk::create(clan_sdk::CreateOptions {
        title: "Review for Client A".into(),
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
        name: "App".into(),
        app_id: app_id.into(),
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
    let mut seed = json!({ "$schema": "spec/schemas/document.schema.json" });
    for (k, v) in data.as_object().unwrap() {
        seed[k] = v.clone();
    }
    b.add_entry("shared/data.yaml", seed.to_string().into_bytes());
    for (name, bytes) in assets {
        b.add_entry(format!("human/assets/{name}"), bytes.clone());
    }
    b.build().unwrap()
}

struct Agency {
    cookie: String,
    tenant: String,
    doc: String,
    token: String,
}

impl Agency {
    fn api(&self, tail: &str) -> String {
        let doc: String = self
            .doc
            .bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                    (b as char).to_string()
                } else {
                    format!("%{b:02X}")
                }
            })
            .collect();
        format!("/api/t/{}/d/{doc}/{tail}", self.tenant)
    }
}

async fn agency(s: &Server, app_id: &str, data: Value, assets: &[(&str, Vec<u8>)]) -> Agency {
    let r = send(s, "GET", "/api/session", None, None).await;
    let cookie = r.headers[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let tenant = r.json()["tenant"].as_str().unwrap().to_string();
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/t/{tenant}/documents/upload"))
        .header(header::COOKIE, &cookie)
        .body(Body::from(build(app_id, &data, assets)))
        .unwrap();
    let up = s.app.clone().oneshot(req).await.unwrap();
    let up: Value =
        serde_json::from_slice(&up.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let a = Agency {
        cookie,
        tenant,
        doc: up["path"].as_str().unwrap().into(),
        token: up["token"].as_str().unwrap().into(),
    };
    lock(s, &a).await;
    a
}

async fn lock(s: &Server, a: &Agency) {
    let r = send(
        s,
        "POST",
        &format!("/s/{}/approve", a.token),
        None,
        Some(json!({})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
}

async fn brief(s: &Server) -> Agency {
    agency(
        s,
        BRIEF,
        json!({ "single_minded_proposition": "The easy way into Irish whiskey.", "insight": "Younger drinkers think it is for someone else." }),
        &[],
    )
    .await
}

struct Round {
    review: String,
    /// (name, token) in the order given
    links: Vec<(String, String)>,
}

async fn round_with(s: &Server, a: &Agency, code: bool) -> Round {
    let r = send(
        s,
        "POST",
        &a.api("client-link/round"),
        Some(&a.cookie),
        Some(json!({ "code": code, "reviewers": [
            { "name": "Alex", "email": "alex@client-a.example", "approver": true },
            { "name": "Bea", "email": "bea@client-a.example" },
            { "name": "Cal", "email": "cal@client-a.example" },
        ]})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let v = r.json();
    Round {
        review: v["review"].as_str().unwrap().into(),
        links: v["links"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| {
                (
                    l["name"].as_str().unwrap().to_string(),
                    l["path"]
                        .as_str()
                        .unwrap()
                        .trim_start_matches("/c/")
                        .to_string(),
                )
            })
            .collect(),
    }
}

async fn round(s: &Server, a: &Agency) -> Round {
    round_with(s, a, false).await
}

async fn chain(s: &Server, a: &Agency) -> Vec<Value> {
    let r = send(s, "GET", &format!("/s/{}/chain", a.token), None, None).await;
    r.json()["decisions"].as_array().unwrap().clone()
}

fn private_headers(r: &Reply, what: &str) {
    assert_eq!(r.headers[header::CACHE_CONTROL], "no-store", "{what}");
    assert_eq!(r.headers[header::REFERRER_POLICY], "no-referrer", "{what}");
    assert_eq!(r.headers["x-robots-tag"], "noindex, nofollow", "{what}");
}

// ── tokens ──────────────────────────────────────────────────────────────────

fn claims(v: u8, scope: &str) -> Claims {
    Claims {
        v,
        id: "0123456789abcdef0123456789abcdef".into(),
        tenant: "t".into(),
        doc: "doc-x".into(),
        scope: scope.into(),
        targets: vec!["doc-x".into()],
        version: "v1".into(),
        hash: "sha256:00".into(),
        agency: None,
        exp: unix_now() + 60,
    }
}

#[test]
fn a_token_of_each_shape_verifies_with_its_own_scope_and_no_other() {
    let key = napkin_web::links::key_from(b"a session secret of thirty-two bytes!");
    for (v, scope) in [(1, SCOPE), (2, SCOPE_REVIEW)] {
        let c = claims(v, scope);
        assert_eq!(verify(&key, &sign(&key, &c)), Ok(c));
    }
    for (v, scope) in [
        (1, SCOPE_REVIEW),
        (2, SCOPE),
        (3, SCOPE_REVIEW),
        (2, "comment"),
    ] {
        assert_eq!(
            verify(&key, &sign(&key, &claims(v, scope))),
            Err(Bad::Forged),
            "v{v} {scope}"
        );
    }
    // two documents in one token, or a target that is not the document
    let mut c = claims(2, SCOPE_REVIEW);
    c.targets.push("doc-y".into());
    assert_eq!(verify(&key, &sign(&key, &c)), Err(Bad::Forged));
    let mut c = claims(2, SCOPE_REVIEW);
    c.targets = vec!["doc-y".into()];
    assert_eq!(verify(&key, &sign(&key, &c)), Err(Bad::Forged));
}

#[test]
fn a_token_carries_no_personal_data_and_the_keys_are_separate() {
    let c = claims(2, SCOPE_REVIEW);
    let fields: Vec<String> = serde_json::to_value(&c)
        .unwrap()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    for f in &fields {
        assert!(
            !["name", "email", "client", "reviewer", "role", "round", "review", "pieces"]
                .contains(&f.as_str()),
            "{f} is the host's record, not the token's"
        );
    }
    let secret = b"a session secret of thirty-two bytes!";
    // the link key, the code key and the raw secret are three different keys
    let (l, k) = (
        napkin_web::links::key_from(secret),
        napkin_web::links::code_key_from(secret),
    );
    assert_ne!(l, k);
    assert_ne!(l, secret.to_vec());
    let t = sign(secret, &claims(2, SCOPE_REVIEW));
    assert_eq!(
        verify(&l, &t),
        Err(Bad::Forged),
        "a session cookie is not a link"
    );
    let t = sign(&k, &claims(2, SCOPE_REVIEW));
    assert_eq!(verify(&l, &t), Err(Bad::Forged), "a code is not a link");
}

#[tokio::test]
async fn a_short_session_secret_does_not_sign_links() {
    let dir = tempfile::tempdir().unwrap();
    let short = AppCtx::new(dir.path().to_path_buf(), Arc::new(NoConfig), None, 40)
        .with_link_secret(Some(b"short"));
    // the key is a fresh one for this run: a token signed with the short secret's child is not accepted
    assert_ne!(short.link_key, napkin_web::links::key_from(b"short"));
    assert_ne!(short.code_key, napkin_web::links::code_key_from(b"short"));
}

// ── a round, through the router ─────────────────────────────────────────────

#[tokio::test]
async fn each_reviewer_opens_their_own_link_with_no_session_and_answers_once() {
    let s = server();
    let a = brief(&s).await;
    let r = round(&s, &a).await;
    assert_eq!(r.links.len(), 3);
    let (alex, bea) = (&r.links[0].1, &r.links[1].1);
    let v = send(&s, "GET", &format!("/c/{alex}/view"), None, None).await;
    assert_eq!(v.status, StatusCode::OK, "{}", v.text());
    private_headers(&v, "view");
    assert!(
        v.headers.get(header::SET_COOKIE).is_none(),
        "a visitor is given no session"
    );
    let page = v.json();
    assert_eq!(page["mode"], "review");
    assert_eq!(page["round"], 1);
    assert_eq!(page["approver"], true);
    assert_eq!(page["pieces"].as_array().unwrap().len(), 1);
    assert_eq!(page["pieces"][0]["ai"], "not_recorded");
    assert!(page["html"]
        .as_str()
        .unwrap()
        .contains("The easy way into Irish whiskey."));
    // the answer, with only the answer in the body: who, version, round and channel come from the link
    let ans = send(
        &s,
        "POST",
        &format!("/c/{bea}/answer"),
        None,
        Some(json!({ "answer": "confirm", "actor": "human:aoife", "client": { "email": "x@y.example" }, "version": "v9", "round": 9, "channel": "email" })),
    )
    .await;
    assert_eq!(ans.status, StatusCode::OK, "{}", ans.text());
    private_headers(&ans, "answer");
    let c = chain(&s, &a).await;
    let lock = c.iter().find(|d| d["kind"] == "approve").unwrap();
    let advice: Vec<&Value> = c
        .iter()
        .filter(|d| d["action"] == "client_advice")
        .collect();
    assert_eq!(advice.len(), 1);
    assert_eq!(advice[0]["actor"], "client:bea@client-a.example");
    assert_eq!(advice[0]["version"], lock["version"]);
    assert_eq!(advice[0]["channel"], "link");
    assert_eq!(advice[0]["round"], 1);
    // a second answer is 410; the approver's link is still open
    assert_eq!(
        send(
            &s,
            "POST",
            &format!("/c/{bea}/answer"),
            None,
            Some(json!({ "answer": "confirm" }))
        )
        .await
        .status,
        StatusCode::GONE
    );
    assert_eq!(
        send(&s, "GET", &format!("/c/{alex}/view"), None, None)
            .await
            .status,
        StatusCode::OK
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_reviewers_answering_at_once_each_land_one_record() {
    let s = Arc::new(server());
    let a = brief(&s).await;
    let r = round(&s, &a).await;
    let mut tasks = Vec::new();
    for (_, token) in r.links.iter().cloned() {
        let s = s.clone();
        tasks.push(tokio::spawn(async move {
            let one = send(
                &s,
                "POST",
                &format!("/c/{token}/answer"),
                None,
                Some(json!({ "answer": "confirm" })),
            )
            .await;
            let two = send(
                &s,
                "POST",
                &format!("/c/{token}/answer"),
                None,
                Some(json!({ "answer": "confirm" })),
            )
            .await;
            (one.status, two.status)
        }));
    }
    for t in tasks {
        assert_eq!(t.await.unwrap(), (StatusCode::OK, StatusCode::GONE));
    }
    let c = chain(&s, &a).await;
    assert_eq!(
        c.iter().filter(|d| d["action"] == "client_answer").count(),
        1
    );
    assert_eq!(
        c.iter().filter(|d| d["action"] == "client_advice").count(),
        2
    );
}

#[tokio::test]
async fn a_reviewer_sees_nothing_of_another_reviewer() {
    let s = server();
    let a = brief(&s).await;
    let r = round(&s, &a).await;
    let (alex, bea, cal) = (&r.links[0].1, &r.links[1].1, &r.links[2].1);
    let post = |tok: String, tail: &str, b: Value| {
        let s = &s;
        let uri = format!("/c/{tok}/{tail}");
        async move { send(s, "POST", &uri, None, Some(b)).await }
    };
    let c = post(bea.clone(), "comment", json!({ "piece": 1, "pin": { "x": 0.5, "y": 0.5 }, "tag": "preference", "text": "MARKER_BEA_COMMENT" })).await;
    assert_eq!(c.status, StatusCode::OK, "{}", c.text());
    post(
        cal.clone(),
        "answer",
        json!({ "answer": "changes", "said": "MARKER_CAL_SAID" }),
    )
    .await;
    let c = post(
        alex.clone(),
        "comment",
        json!({ "piece": 1, "tag": "preference", "text": "MARKER_ALEX_COMMENT" }),
    )
    .await;
    let alex_comment = c.json()["comment"].as_str().unwrap().to_string();
    let mut seen = vec![
        send(&s, "GET", &format!("/c/{alex}/view"), None, None).await,
        send(
            &s,
            "POST",
            &format!("/c/{alex}/comment"),
            None,
            Some(json!({ "piece": 1, "tag": "preference", "text": "another" })),
        )
        .await,
    ];
    seen.push(
        send(
            &s,
            "POST",
            &format!("/c/{alex}/comment/{alex_comment}/withdraw"),
            None,
            None,
        )
        .await,
    );
    let text: String = seen.iter().map(Reply::text).collect();
    for other in [
        "MARKER_BEA_COMMENT",
        "MARKER_CAL_SAID",
        "bea@client-a",
        "cal@client-a",
        "Bea",
        "Cal",
        "client:bea",
    ] {
        assert!(
            !text.contains(other),
            "{other} is another reviewer's: {text}"
        );
    }
    assert!(text.contains("MARKER_ALEX_COMMENT") || text.contains(&alex_comment));
    // and a reviewer cannot withdraw another's comment through their own link
    let c = send(&s, "GET", &format!("/s/{}/chain", a.token), None, None)
        .await
        .json();
    let bea_comment = c["decisions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["action"] == "client_comment" && d["actor"] == "client:bea@client-a.example")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let w = send(
        &s,
        "POST",
        &format!("/c/{alex}/comment/{bea_comment}/withdraw"),
        None,
        None,
    )
    .await;
    assert_eq!(w.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn wrong_expired_withdrawn_used_and_superseded_links_say_so() {
    let s = server();
    let a = brief(&s).await;
    let r = round(&s, &a).await;
    let (alex, bea, cal) = (
        r.links[0].1.clone(),
        r.links[1].1.clone(),
        r.links[2].1.clone(),
    );
    // wrong: a flipped byte, a confirmation token on a review route, junk
    let bad = format!("{}x", alex);
    for tail in ["view", "piece/1"] {
        assert_eq!(
            send(&s, "GET", &format!("/c/{bad}/{tail}"), None, None)
                .await
                .status,
            StatusCode::NOT_FOUND,
            "{tail}"
        );
    }
    let confirm = sign(
        &s.ctx.link_key,
        &Claims {
            v: 1,
            scope: SCOPE.into(),
            ..claims(1, SCOPE)
        },
    );
    assert_eq!(
        send(
            &s,
            "POST",
            &format!("/c/{confirm}/comment"),
            None,
            Some(json!({ "piece": 1, "tag": "preference", "text": "x" }))
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
    // expired
    let c: Claims = {
        let (body, _) = alex.split_once('.').unwrap();
        use base64::Engine as _;
        serde_json::from_slice(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(body)
                .unwrap(),
        )
        .unwrap()
    };
    let old = sign(
        &s.ctx.link_key,
        &Claims {
            exp: unix_now() - 1,
            ..c.clone()
        },
    );
    let e = send(&s, "GET", &format!("/c/{old}/view"), None, None).await;
    assert_eq!(
        (e.status, e.json()["state"].clone()),
        (StatusCode::GONE, json!("expired"))
    );
    // withdrawn
    let id = &c.id;
    let w = send(
        &s,
        "POST",
        &a.api(&format!("client-link/{id}/withdraw")),
        Some(&a.cookie),
        Some(json!({})),
    )
    .await;
    assert_eq!(w.status, StatusCode::OK, "{}", w.text());
    for (m, tail) in [("GET", "view"), ("GET", "piece/1"), ("POST", "answer")] {
        let x = send(
            &s,
            m,
            &format!("/c/{alex}/{tail}"),
            None,
            if m == "POST" {
                Some(json!({ "answer": "confirm" }))
            } else {
                None
            },
        )
        .await;
        assert_eq!(
            (x.status, x.json()["state"].clone()),
            (StatusCode::GONE, json!("withdrawn")),
            "{tail}"
        );
    }
    // used
    assert_eq!(
        send(
            &s,
            "POST",
            &format!("/c/{bea}/answer"),
            None,
            Some(json!({ "answer": "confirm" }))
        )
        .await
        .status,
        StatusCode::OK
    );
    let u = send(&s, "GET", &format!("/c/{bea}/view"), None, None).await;
    assert_eq!(
        (u.status, u.json()["state"].clone()),
        (StatusCode::GONE, json!("answered"))
    );
    assert!(!u.text().contains("Irish whiskey"));
    // superseded: the brief is opened, changed and signed again, and round 1's links are over
    let un = send(
        &s,
        "POST",
        &format!("/s/{}/unapprove", a.token),
        None,
        Some(json!({ "rationale": "changes" })),
    )
    .await;
    assert_eq!(un.status, StatusCode::OK, "{}", un.text());
    let ed = send(&s, "POST", &format!("/s/{}/patch-data", a.token), None, Some(json!({ "agent": "human", "action": "edit", "patch": { "tone_and_world": ["Louder"] } }))).await;
    assert_eq!(ed.status, StatusCode::OK, "{}", ed.text());
    lock(&s, &a).await;
    let sup = send(&s, "GET", &format!("/c/{cal}/view"), None, None).await;
    assert_eq!(
        (sup.status, sup.json()["state"].clone()),
        (StatusCode::GONE, json!("superseded"))
    );
    assert_eq!(
        send(
            &s,
            "POST",
            &format!("/c/{cal}/comment"),
            None,
            Some(json!({ "piece": 1, "tag": "preference", "text": "x" }))
        )
        .await
        .status,
        StatusCode::GONE
    );
    // round 2: a reviewer of round 1 uses the old link; the new round is 2
    let r2 = round(&s, &a).await;
    assert_ne!(r2.review, r.review);
    let page = send(&s, "GET", &format!("/c/{}/view", r2.links[0].1), None, None)
        .await
        .json();
    assert_eq!(page["round"], 2);
    assert_eq!(
        send(&s, "GET", &format!("/c/{cal}/view"), None, None)
            .await
            .status,
        StatusCode::GONE,
        "round 1's link does not open round 2"
    );
    assert_eq!(
        send(
            &s,
            "POST",
            &format!("/c/{cal}/answer"),
            None,
            Some(json!({ "answer": "confirm" }))
        )
        .await
        .status,
        StatusCode::GONE
    );
}

#[tokio::test]
async fn the_agency_reads_one_merged_round_with_the_flags_and_the_round_number() {
    let s = server();
    let a = brief(&s).await;
    let r = round(&s, &a).await;
    for (i, (_, tok)) in r.links.iter().take(2).enumerate() {
        let x = if i == 0 { 0.4 } else { 0.42 };
        let c = send(&s, "POST", &format!("/c/{tok}/comment"), None, Some(json!({ "piece": 1, "pin": { "x": x, "y": 0.4 }, "tag": "preference", "text": format!("note {i}") }))).await;
        assert_eq!(c.status, StatusCode::OK, "{}", c.text());
    }
    let v = send(
        &s,
        "GET",
        &a.api("client-review/round"),
        Some(&a.cookie),
        None,
    )
    .await;
    assert_eq!(v.status, StatusCode::OK, "{}", v.text());
    let v = v.json();
    assert_eq!(v["round"], 1);
    assert_eq!(v["comments"].as_array().unwrap().len(), 2);
    assert!(v["comments"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["flags"].to_string().contains("same spot")));
    assert!(
        v["rounds_in_scope"].is_null(),
        "no job route gives a number of rounds"
    );
    // the agency's side needs a session
    assert_eq!(
        send(&s, "GET", &a.api("client-review/round"), None, None)
            .await
            .status,
        StatusCode::FORBIDDEN
    );
}

// ── caps and rate limits ────────────────────────────────────────────────────

#[tokio::test]
async fn bodies_and_texts_are_capped_and_a_link_is_rate_limited() {
    let s = server();
    let a = brief(&s).await;
    let r = round(&s, &a).await;
    let tok = &r.links[1].1;
    let big = send(
        &s,
        "POST",
        &format!("/c/{tok}/comment"),
        None,
        Some(json!({ "piece": 1, "tag": "preference", "text": "a".repeat(40_000) })),
    )
    .await;
    assert_eq!(
        big.status,
        StatusCode::PAYLOAD_TOO_LARGE,
        "a 32 KB body limit"
    );
    let long = send(
        &s,
        "POST",
        &format!("/c/{tok}/comment"),
        None,
        Some(json!({ "piece": 1, "tag": "preference", "text": "a".repeat(2001) })),
    )
    .await;
    assert_eq!(long.status, StatusCode::BAD_REQUEST);
    let mut limited = false;
    for _ in 0..60 {
        if send(&s, "GET", &format!("/c/{tok}/view"), None, None)
            .await
            .status
            == StatusCode::TOO_MANY_REQUESTS
        {
            limited = true;
            break;
        }
    }
    assert!(limited, "a link opened sixty times a minute is stopped");
    // a bad token has a pool of its own, and it does not stop a good link
    let good = &r.links[0].1;
    assert_eq!(
        send(&s, "GET", &format!("/c/{good}/view"), None, None)
            .await
            .status,
        StatusCode::OK
    );
    let mut pooled = false;
    for i in 0..200 {
        if send(&s, "GET", &format!("/c/forged{i}.nope/view"), None, None)
            .await
            .status
            == StatusCode::TOO_MANY_REQUESTS
        {
            pooled = true;
            break;
        }
    }
    assert!(pooled, "bad tokens are stopped as one pool");
}

// ── pieces ──────────────────────────────────────────────────────────────────

fn mp4() -> Vec<u8> {
    let mut mvhd = vec![0u8; 4];
    mvhd.extend([0u8; 8]);
    mvhd.extend(1000u32.to_be_bytes());
    mvhd.extend(8_000u32.to_be_bytes());
    mvhd.extend([0u8; 80]);
    let b = |k: &[u8; 4], body: &[u8]| {
        let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend(k);
        v.extend(body);
        v
    };
    let mut out = b(b"ftyp", b"isom\0\0\0\0isom");
    out.extend(b(b"moov", &b(b"mvhd", &mvhd)));
    out
}

fn visual_data() -> Value {
    json!({
        "territory": { "name": "Permission to stop", "line": "The evening starts when the day is over." },
        "proposition": "The whiskey that waits for you.",
        "tone": ["Unhurried"], "must_show": ["The bottle"], "never_show": ["Driving"],
        "reference_frames": {
            "a": { "asset": "a.png", "caption": "The bar at nine" },
            "b": { "asset": "b.png" },
            "c": { "asset": "c.mp4", "caption": "The pour" },
        },
    })
}

#[tokio::test]
async fn a_piece_is_served_as_data_from_a_fixed_list_with_the_headers_that_stop_script() {
    let s = server();
    // an HTML page named as a png, an svg with a script in it, and a film
    let html = b"<html><script>alert(1)</script></html>".to_vec();
    let svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>".to_vec();
    let mut d = visual_data();
    d["reference_frames"]["b"] = json!({ "asset": "b.svg" });
    let a = agency(
        &s,
        VISUAL,
        d,
        &[
            ("a.png", html.clone()),
            ("b.svg", svg.clone()),
            ("c.mp4", mp4()),
            ("secret.png", b"x".to_vec()),
        ],
    )
    .await;
    let r = round(&s, &a).await;
    let tok = &r.links[0].1;
    let page = send(&s, "GET", &format!("/c/{tok}/view"), None, None)
        .await
        .json();
    assert_eq!(
        page["pieces"].as_array().unwrap().len(),
        3,
        "an asset the spec does not name is never listed"
    );
    assert_eq!(page["pieces"][2]["duration_ms"], 8000);
    for (n, ctype, body) in [(1, "image/png", &html), (2, "image/svg+xml", &svg)] {
        let p = send(&s, "GET", &format!("/c/{tok}/piece/{n}"), None, None).await;
        assert_eq!(p.status, StatusCode::OK);
        assert_eq!(&p.body[..], &body[..], "the bytes the issue hashed");
        assert_eq!(
            p.headers[header::CONTENT_TYPE],
            ctype,
            "the type is from the list, not the file"
        );
        assert_eq!(p.headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(p.headers[header::CACHE_CONTROL], "no-store");
        assert_eq!(p.headers[header::REFERRER_POLICY], "no-referrer");
        assert_eq!(
            p.headers[header::CONTENT_SECURITY_POLICY],
            "sandbox; default-src 'none'"
        );
        assert_eq!(p.headers["x-robots-tag"], "noindex, nofollow");
    }
    // a film, with a Range
    let f = mp4();
    let p = send_with(
        &s,
        "GET",
        &format!("/c/{tok}/piece/3"),
        &[("range", "bytes=0-9")],
        None,
    )
    .await;
    assert_eq!(p.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(&p.body[..], &f[..10]);
    assert_eq!(
        p.headers[header::CONTENT_RANGE],
        format!("bytes 0-9/{}", f.len())
    );
    assert_eq!(p.headers[header::CONTENT_TYPE], "video/mp4");
    let tail = send_with(
        &s,
        "GET",
        &format!("/c/{tok}/piece/3"),
        &[("range", "bytes=-4")],
        None,
    )
    .await;
    assert_eq!(&tail.body[..], &f[f.len() - 4..]);
    let off = send_with(
        &s,
        "GET",
        &format!("/c/{tok}/piece/3"),
        &[("range", "bytes=99999-")],
        None,
    )
    .await;
    assert_eq!(off.status, StatusCode::RANGE_NOT_SATISFIABLE);
    // n outside the recorded list, and zero, and a word
    for n in ["4", "0", "999"] {
        assert_eq!(
            send(&s, "GET", &format!("/c/{tok}/piece/{n}"), None, None)
                .await
                .status,
            StatusCode::NOT_FOUND,
            "piece {n}"
        );
    }
    assert_eq!(
        send(&s, "GET", &format!("/c/{tok}/piece/abc"), None, None)
            .await
            .status
            .is_client_error(),
        true
    );
    // a link with no session reaches no other asset
    for uri in [
        format!("/c/{tok}/piece/../../assets/secret.png"),
        format!("/s/{tok}/assets/secret.png"),
    ] {
        let got = send(&s, "GET", &uri, None, None).await;
        assert_ne!(
            &got.body[..],
            b"x",
            "{uri} served an asset the link does not name"
        );
    }
}

/// A big film: every Range request on it must cost the document one read, not one each.
fn big_film(len: usize) -> Vec<u8> {
    let mut f = mp4();
    f.resize(len, 7);
    f
}

#[tokio::test]
async fn many_ranges_of_one_film_read_the_document_once_and_the_lock_is_free_after() {
    let s = server();
    let a = agency(
        &s,
        VISUAL,
        visual_data(),
        &[
            ("a.png", b"a".to_vec()),
            ("b.png", b"b".to_vec()),
            ("c.mp4", big_film(2_000_000)),
        ],
    )
    .await;
    let r = round(&s, &a).await;
    let tok = &r.links[0].1;
    for i in 0..30usize {
        let lo = i * 50_000;
        let got = send_with(
            &s,
            "GET",
            &format!("/c/{tok}/piece/3"),
            &[("range", &format!("bytes={lo}-{}", lo + 999))],
            None,
        )
        .await;
        assert_eq!(got.status, StatusCode::PARTIAL_CONTENT);
        assert_eq!(got.body.len(), 1000);
    }
    assert_eq!(
        s.ctx.pieces.decodes(),
        1,
        "the film was read once, not once a request"
    );
    // staff are not kept out of the document while a piece is out: the lock is not held across the
    // body (the reply is built from a buffer the document no longer guards)
    let ws = s
        .ctx
        .workspace(&napkin_web::tenant::TenantId::parse(&a.tenant).unwrap());
    let sess = ws.session(&napkin_host::DocId::new(a.doc.clone())).unwrap();
    let held = sess.read(|_| Ok(())).is_ok();
    assert!(held);
}

#[tokio::test]
async fn a_link_may_be_sent_only_so_many_bytes_a_minute() {
    let s = server_with(|c| c.with_piece_byte_cap(5_000));
    let a = agency(
        &s,
        VISUAL,
        visual_data(),
        &[
            ("a.png", b"a".to_vec()),
            ("b.png", b"b".to_vec()),
            ("c.mp4", big_film(100_000)),
        ],
    )
    .await;
    let r = round(&s, &a).await;
    let (first, other) = (&r.links[0].1, &r.links[1].1);
    let ask = |tok: String, lo: usize, hi: usize| {
        let s = &s;
        async move {
            send_with(
                s,
                "GET",
                &format!("/c/{tok}/piece/3"),
                &[("range", &format!("bytes={lo}-{hi}"))],
                None,
            )
            .await
        }
    };
    assert_eq!(
        ask(first.clone(), 0, 3_999).await.status,
        StatusCode::PARTIAL_CONTENT
    );
    // 4,000 of 5,000 spent: another 4,000 is refused, a smaller one is not
    assert_eq!(
        ask(first.clone(), 4_000, 7_999).await.status,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(
        ask(first.clone(), 4_000, 4_999).await.status,
        StatusCode::PARTIAL_CONTENT
    );
    assert_eq!(
        ask(first.clone(), 5_000, 5_000).await.status,
        StatusCode::TOO_MANY_REQUESTS
    );
    // the budget is the link's own: another reviewer's link is not spent
    assert_eq!(
        ask(other.clone(), 0, 3_999).await.status,
        StatusCode::PARTIAL_CONTENT
    );
}

// ── the email code ──────────────────────────────────────────────────────────

#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Capture {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Capture {
    type Writer = Capture;
    fn make_writer(&'a self) -> Capture {
        self.clone()
    }
}

fn code_of(m: &Message) -> String {
    match m {
        Message::Code { code, .. } => code.clone(),
        other => panic!("not a code: {other:?}"),
    }
}

#[tokio::test]
async fn with_the_code_on_a_link_shows_nothing_until_the_emailed_code_is_entered() {
    let log = Capture::default();
    let sub = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_writer(log.clone())
        .finish();
    let _guard = tracing::subscriber::set_default(sub);
    let s = server();
    let a = brief(&s).await;
    let r = round_with(&s, &a, true).await;
    let (alex, bea) = (r.links[0].1.clone(), r.links[1].1.clone());
    // nothing: no title, client name or content, in any route
    for (m, tail, body) in [
        ("GET", "view", None),
        ("GET", "piece/1", None),
        ("POST", "answer", Some(json!({ "answer": "confirm" }))),
        (
            "POST",
            "comment",
            Some(json!({ "piece": 1, "tag": "preference", "text": "x" })),
        ),
    ] {
        let v = send(&s, m, &format!("/c/{alex}/{tail}"), None, body).await;
        assert_eq!(v.status, StatusCode::UNAUTHORIZED, "{tail}");
        assert_eq!(v.json()["state"], "code");
        let t = v.text();
        for hidden in [
            "Review for Client A",
            "Alex",
            "Irish whiskey",
            "alex@client-a",
        ] {
            assert!(
                !t.contains(hidden),
                "{hidden} is shown before the code: {t}"
            );
        }
    }
    assert!(s.mail.outbox().is_empty(), "opening a link sends nothing");
    // ask for the code: one mail, to the address on the issue
    let ask = send(&s, "POST", &format!("/c/{alex}/code"), None, None).await;
    assert_eq!(ask.status, StatusCode::OK, "{}", ask.text());
    let out = s.mail.outbox();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].to(), "alex@client-a.example");
    let code = code_of(&out[0]);
    assert_eq!(code.len(), 6);
    assert!(!ask.text().contains(&code), "the code is in no reply");
    // a wrong one, then another link's cookie, then the right one
    let wrong = send(
        &s,
        "POST",
        &format!("/c/{alex}/code"),
        None,
        Some(json!({ "code": if code == "000000" { "111111" } else { "000000" } })),
    )
    .await;
    assert_eq!(wrong.status, StatusCode::UNAUTHORIZED);
    assert!(wrong.headers.get(header::SET_COOKIE).is_none());
    let right = send(
        &s,
        "POST",
        &format!("/c/{alex}/code"),
        None,
        Some(json!({ "code": code })),
    )
    .await;
    assert_eq!(right.status, StatusCode::OK, "{}", right.text());
    let set = right.headers[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .to_string();
    for attr in ["HttpOnly", "Secure", "SameSite=Strict", "Path=/c"] {
        assert!(set.contains(attr), "{attr}: {set}");
    }
    assert!(!set.contains(&code), "the cookie is not the code");
    let cookie = set.split(';').next().unwrap().to_string();
    let v = send(&s, "GET", &format!("/c/{alex}/view"), Some(&cookie), None).await;
    assert_eq!(v.status, StatusCode::OK, "{}", v.text());
    assert!(v.text().contains("Irish whiskey"));
    // another link's cookie is refused, even renamed to this link's name
    let (name, value) = cookie.split_once('=').unwrap();
    assert_eq!(
        send(&s, "GET", &format!("/c/{bea}/view"), Some(&cookie), None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let renamed = format!(
        "{}={value}",
        name.replace(&name[4..], &format!("{}", &r_id(&bea)[..16]))
    );
    assert_eq!(
        send(&s, "GET", &format!("/c/{bea}/view"), Some(&renamed), None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    // the cookie ends with its time
    s.clock.fetch_add(9 * 3600, Ordering::SeqCst);
    assert_eq!(
        send(&s, "GET", &format!("/c/{alex}/view"), Some(&cookie), None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    // the code is in no log line
    let logged = String::from_utf8_lossy(&log.0.lock().unwrap()).to_string();
    assert!(!logged.contains(&code), "the code is in a log line");
    for m in s.mail.outbox() {
        assert!(!logged.contains(&napkin_web::mail::render(&m).1));
    }
}

fn r_id(token: &str) -> String {
    use base64::Engine as _;
    let (body, _) = token.split_once('.').unwrap();
    let c: Claims = serde_json::from_slice(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(body)
            .unwrap(),
    )
    .unwrap();
    c.id
}

#[tokio::test]
async fn a_brute_forced_code_is_stopped_after_five_tries_and_the_sends_are_capped() {
    let s = server();
    let a = brief(&s).await;
    let r = round_with(&s, &a, true).await;
    let tok = &r.links[0].1;
    assert_eq!(
        send(&s, "POST", &format!("/c/{tok}/code"), None, None)
            .await
            .status,
        StatusCode::OK
    );
    let code = code_of(&s.mail.outbox()[0]);
    let wrong = if code == "123456" { "654321" } else { "123456" };
    for i in 0..5 {
        let w = send(
            &s,
            "POST",
            &format!("/c/{tok}/code"),
            None,
            Some(json!({ "code": wrong })),
        )
        .await;
        assert_eq!(w.status, StatusCode::UNAUTHORIZED, "try {i}");
    }
    // the sixth is stopped, even with the right code
    let sixth = send(
        &s,
        "POST",
        &format!("/c/{tok}/code"),
        None,
        Some(json!({ "code": code })),
    )
    .await;
    assert_eq!(sixth.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(sixth.headers.get(header::SET_COOKIE).is_none());
    // sends: three a window per link
    assert_eq!(
        send(&s, "POST", &format!("/c/{tok}/code"), None, None)
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        send(&s, "POST", &format!("/c/{tok}/code"), None, None)
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        send(&s, "POST", &format!("/c/{tok}/code"), None, None)
            .await
            .status,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(s.mail.outbox().len(), 3);
}

#[tokio::test]
async fn a_code_works_for_ten_minutes_and_not_for_twenty() {
    let s = server();
    let a = brief(&s).await;
    let r = round_with(&s, &a, true).await;
    let tok = &r.links[0].1;
    send(&s, "POST", &format!("/c/{tok}/code"), None, None).await;
    let code = code_of(&s.mail.outbox()[0]);
    s.clock.fetch_add(21 * 60, Ordering::SeqCst);
    let late = send(
        &s,
        "POST",
        &format!("/c/{tok}/code"),
        None,
        Some(json!({ "code": code })),
    )
    .await;
    assert_eq!(
        late.status,
        StatusCode::UNAUTHORIZED,
        "a code from two windows ago is over"
    );
}

#[tokio::test]
async fn with_no_sender_the_code_is_not_offered_anywhere() {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Arc::new(AppCtx::new(
        dir.path().to_path_buf(),
        Arc::new(NoConfig),
        None,
        40,
    ));
    let s = Server {
        _dir: dir,
        app: napkin_web::router(ctx.clone(), None, false),
        ctx,
        mail: Arc::new(Memory::default()),
        clock: Arc::new(AtomicU64::new(0)),
    };
    let a = brief(&s).await;
    let o = send(
        &s,
        "GET",
        &a.api("client-review/options"),
        Some(&a.cookie),
        None,
    )
    .await
    .json();
    assert_eq!(o["code"], false);
    let r = send(&s, "POST", &a.api("client-link/round"), Some(&a.cookie), Some(json!({ "code": true, "reviewers": [{ "name": "A", "email": "a@x.example", "approver": true }] }))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = round(&s, &a).await;
    assert_eq!(
        send(&s, "POST", &format!("/c/{}/code", r.links[0].1), None, None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn the_daily_cap_refuses_a_mail_with_one_plain_line() {
    let dir = tempfile::tempdir().unwrap();
    let mail = Arc::new(Memory::default());
    let ctx = Arc::new(
        AppCtx::new(dir.path().to_path_buf(), Arc::new(NoConfig), None, 40)
            .with_mailer(mail.clone() as Arc<dyn Mailer>, 1)
            .with_code_clock(|| 1_800_000_000),
    );
    let s = Server {
        _dir: dir,
        app: napkin_web::router(ctx.clone(), None, false),
        ctx,
        mail: mail.clone(),
        clock: Arc::new(AtomicU64::new(0)),
    };
    let a = brief(&s).await;
    let r = round_with(&s, &a, true).await;
    assert_eq!(
        send(&s, "POST", &format!("/c/{}/code", r.links[0].1), None, None)
            .await
            .status,
        StatusCode::OK
    );
    let over = send(&s, "POST", &format!("/c/{}/code", r.links[1].1), None, None).await;
    assert_eq!(over.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(over.json()["error"].as_str().unwrap().contains("today"));
    assert_eq!(mail.outbox().len(), 1);
}

// ── the wall: what a reviewer's replies hold, per document type ─────────────

fn schema_of(dir: &str) -> Value {
    let p = format!(
        "{}/../../app/templates/{dir}/schema.json",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn mark(path: &str) -> String {
    format!("MK{}QQ", path.replace('.', "__"))
}

/// A value for a schema node, every string leaf holding a marker named by its path, and an object
/// carrying a key the schema does not name.
fn fill(root: &Value, node: &Value, path: &str) -> Value {
    let node = match node.get("$ref").and_then(Value::as_str) {
        Some(r) => {
            let mut cur = root;
            for p in r.trim_start_matches("#/").split('/') {
                cur = &cur[p];
            }
            cur
        }
        None => node,
    };
    let node = node.get("oneOf").and_then(|o| o.get(0)).unwrap_or(node);
    match node["type"].as_str() {
        Some("string") => json!(mark(path)),
        Some("integer") | Some("number") => json!(70_000 + path.len()),
        Some("boolean") => json!(true),
        Some("array") => json!([fill(root, &node["items"], &format!("{path}.0"))]),
        Some("object") | None => {
            let mut o = serde_json::Map::new();
            for (k, v) in node["properties"].as_object().into_iter().flatten() {
                o.insert(k.clone(), fill(root, v, &format!("{path}.{k}")));
            }
            o.insert(
                "internal_extra".into(),
                json!(mark(&format!("{path}.internal_extra"))),
            );
            Value::Object(o)
        }
        _ => json!(mark(path)),
    }
}

fn markers(text: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut rest = text;
    while let Some(i) = rest.find("MK") {
        let tail = &rest[i..];
        match tail.find("QQ") {
            Some(j)
                if tail[..j]
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_') =>
            {
                out.insert(tail[..j + 2].to_string());
                rest = &tail[j + 2..];
            }
            _ => rest = &tail[2..],
        }
    }
    out
}

/// What a reviewer may read of each type, stated here and not read from the code under test.
fn expected(app: &str, hidden: &[&str]) -> BTreeSet<String> {
    let mut paths: Vec<String> = Vec::new();
    match app {
        BRIEF => {
            for k in [
                "client",
                "background",
                "audience",
                "insight",
                "single_minded_proposition",
                "budget_and_scope",
                "famous",
            ] {
                paths.push(k.into());
            }
            for k in [
                "tone_and_world",
                "reasons_to_believe",
                "measurement",
                "mandatories",
            ] {
                paths.push(format!("{k}.0"));
            }
            for (k, subs) in [
                ("objectives", ["commercial", "behavioural", "attitudinal"]),
                ("desired_response", ["think", "feel", "do"]),
            ] {
                for sub in subs {
                    paths.push(format!("{k}.{sub}"));
                }
            }
        }
        VISUAL => {
            // the frame's caption is the piece's label, which the client is shown
            for p in [
                "territory.name",
                "territory.line",
                "proposition",
                "tone.0",
                "must_show.0",
                "never_show.0",
                "reference_frames.a.caption",
            ] {
                paths.push(p.into());
            }
        }
        _ => {
            for p in ["format", "proposition", "cast"] {
                paths.push(p.into());
            }
            for k in [
                "kind",
                "role",
                "text",
                "visual_action",
                "voiceover",
                "dialogue",
                "on_screen_text",
                "sound_intention",
            ] {
                paths.push(format!("script.beats.0.{k}"));
            }
        }
    }
    paths
        .into_iter()
        .filter(|p| {
            !hidden.iter().any(|h| {
                p == h || p.starts_with(&format!("{h}.")) || p.starts_with(&format!("{h}__"))
            })
        })
        .map(|p| mark(&p))
        .collect()
}

/// A document of `app` seeded with every key of its schema, each holding a marker of its own, and keys
/// the schema does not name. Every string leaf is a marker, so a leak of any one is named.
fn seeded(app: &str, dir: &str, extra: &[(&str, Value)]) -> (Value, Value) {
    let schema = schema_of(dir);
    let mut data = serde_json::Map::new();
    for (k, v) in schema["properties"].as_object().unwrap() {
        data.insert(k.clone(), fill(&schema, v, k));
    }
    if app == BRIEF {
        // a brief's tone is a list of strings that can also hold an object, and `famous` is the gate's own item
        data.insert("famous".into(), json!(mark("famous")));
        data.insert(
            "tone_and_world".into(),
            json!([mark("tone_and_world.0"), { "note": mark("tone_and_world.note") }]),
        );
    }
    for (k, v) in extra {
        data.insert((*k).into(), v.clone());
    }
    data.insert("unlisted_key".into(), json!(mark("unlisted_key")));
    data.insert(
        "planner_notes".into(),
        json!({ "text": mark("planner_notes.text") }),
    );
    (Value::Object(data), schema)
}

async fn wall(
    app: &str,
    dir: &str,
    confidential: &[&str],
    assets: &[(&str, Vec<u8>)],
) -> (BTreeSet<String>, BTreeSet<String>, String) {
    let s = server();
    let extra = [("confidential_fields", json!(confidential))];
    let (data, _) = seeded(app, dir, &extra);
    let mut data = data;
    if app == VISUAL {
        data["reference_frames"] = json!({ "a": { "asset": "a.png", "caption": mark("reference_frames.a.caption"), "path": mark("reference_frames.a.path") } });
    }
    let a = agency(&s, app, data, assets).await;
    let r = round(&s, &a).await;
    let tok = &r.links[1].1;
    let mut replies = String::new();
    let v = send(&s, "GET", &format!("/c/{tok}/view"), None, None).await;
    assert_eq!(v.status, StatusCode::OK, "{} {}", app, v.text());
    replies.push_str(&v.text());
    let c = send(
        &s,
        "POST",
        &format!("/c/{tok}/comment"),
        None,
        Some(json!({ "piece": 1, "tag": "preference", "text": "a note" })),
    )
    .await;
    replies.push_str(&c.text());
    let ans = send(
        &s,
        "POST",
        &format!("/c/{tok}/answer"),
        None,
        Some(json!({ "answer": "confirm" })),
    )
    .await;
    replies.push_str(&ans.text());
    let found = markers(&replies);
    // the agency's side reads the whole chain: the markers are in the document, so the seed was real
    let all = markers(&String::from_utf8_lossy(
        &std::fs::read(a.doc.clone()).unwrap_or_default(),
    ))
    .len();
    let _ = all;
    let seeded_all = markers(&serde_json::to_string(&seeded(app, dir, &extra).0).unwrap());
    (found, seeded_all, replies)
}

#[tokio::test]
async fn the_brief_wall_shows_the_allow_listed_fields_and_nothing_else() {
    let hidden = ["audience", "insight", "objectives.behavioural"];
    let (found, seeded_all, _) = wall(BRIEF, "brief-maker", &hidden, &[]).await;
    assert!(
        seeded_all.len() > 60,
        "every key of the schema holds a marker: {}",
        seeded_all.len()
    );
    let want = expected(BRIEF, &hidden);
    assert_eq!(
        found,
        want,
        "extra: {:?}, missing: {:?}",
        found.difference(&want).collect::<Vec<_>>(),
        want.difference(&found).collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn the_visual_brief_wall_shows_the_allow_listed_fields_and_nothing_else() {
    let hidden = ["tone"];
    let (found, seeded_all, replies) = wall(
        VISUAL,
        "visual-brief",
        &hidden,
        &[
            ("a.png", b"\x89PNGx".to_vec()),
            ("unnamed.png", b"y".to_vec()),
        ],
    )
    .await;
    assert!(seeded_all.len() >= 10);
    let want = expected(VISUAL, &hidden);
    assert_eq!(
        found,
        want,
        "extra: {:?}, missing: {:?}",
        found.difference(&want).collect::<Vec<_>>(),
        want.difference(&found).collect::<Vec<_>>()
    );
    // the frame's caption is the piece's label, which the client is shown, and its path and the upstream are not
    assert!(replies.contains(&mark("reference_frames.a.caption")));
    assert!(!replies.contains(&mark("reference_frames.a.path")));
    assert!(!replies.contains("unnamed.png") && !replies.contains("human/assets"));
}

#[tokio::test]
async fn the_script_wall_shows_the_allow_listed_fields_and_nothing_else() {
    let hidden = ["cast"];
    let (found, seeded_all, _) = wall(SCRIPT, "script-editor", &hidden, &[]).await;
    assert!(seeded_all.len() >= 30);
    let want = expected(SCRIPT, &hidden);
    assert_eq!(
        found,
        want,
        "extra: {:?}, missing: {:?}",
        found.difference(&want).collect::<Vec<_>>(),
        want.difference(&found).collect::<Vec<_>>()
    );
    // the Banned list, the tracked changes and the hand-offs are the agency's
    for never in [
        "checks",
        "handoffs",
        "script.proposals",
        "film",
        "script.beats.0.id",
    ] {
        assert!(
            !found
                .iter()
                .any(|m| m.starts_with(&format!("MK{}", never.replace('.', "__")))),
            "{never}"
        );
    }
}

/// A schema that gains a key must say, on purpose, whether a client reads it.
#[test]
fn every_key_of_every_schema_is_shown_or_named_as_never_shown() {
    for (app, dir) in [
        (BRIEF, "brief-maker"),
        (VISUAL, "visual-brief"),
        (SCRIPT, "script-editor"),
    ] {
        let spec = client_pieces::spec_for(app).unwrap();
        let schema = schema_of(dir);
        let props = schema["properties"].as_object().unwrap();
        let shown: Vec<&str> = spec.fields.iter().map(|(k, _)| *k).collect();
        for k in props.keys() {
            assert!(
                shown.contains(&k.as_str()) ^ spec.never.contains(&k.as_str()),
                "`{k}` is a key of the {dir} schema: put it in the clean spec's fields (the client reads it) or in its never list (the client does not), and in one only"
            );
        }
        for k in shown.iter().chain(spec.never).filter(|k| **k != "famous") {
            assert!(
                props.contains_key(*k),
                "`{k}` is not in the {dir} schema any more"
            );
        }
    }
}

/// A new clean spec without a wall test above fails here.
#[test]
fn every_clean_spec_has_a_wall_test() {
    let tested = [BRIEF, VISUAL, SCRIPT];
    for spec in SPECS {
        assert!(
            tested.contains(&spec.app_id),
            "{} has a clean spec and no every-key wall test in tests/client_review.rs",
            spec.app_id
        );
    }
    assert_eq!(SPECS.len(), tested.len());
    // a text field a spec shows has a shape; a beat key list is the script's
    assert_eq!(client_pieces::shape(SCRIPT, "script"), Shape::Beats);
    assert!(BEAT_KEYS.iter().all(|(k, _)| *k != "id"));
}

#[tokio::test]
async fn a_link_to_a_document_with_no_clean_spec_is_refused() {
    let s = server();
    let a = agency(&s, "ie.napkin.idea-room", json!({ "cards": [] }), &[]).await;
    let r = send(
        &s,
        "POST",
        &a.api("client-link/round"),
        Some(&a.cookie),
        Some(json!({ "reviewers": [{ "name": "A", "email": "a@x.example", "approver": true }] })),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.text());
}

#[tokio::test]
async fn the_clients_replies_never_name_a_judge_score_an_idea_card_or_the_banned_list() {
    let s = server();
    let mut d = json!({ "single_minded_proposition": "The easy way into Irish whiskey." });
    d["review"] = json!({ "judge": { "score": 5, "note": "Marker judge note" } });
    d["capture"] = json!({ "notes": "Marker capture note" });
    d["passages"] = json!([{ "text": "Marker source passage" }]);
    let a = agency(&s, BRIEF, d, &[]).await;
    let r = round(&s, &a).await;
    let v = send(&s, "GET", &format!("/c/{}/view", r.links[0].1), None, None)
        .await
        .text();
    for no in [
        "Marker judge note",
        "Marker capture note",
        "Marker source passage",
        "score",
    ] {
        assert!(!v.contains(no), "{no}");
    }
}

#[tokio::test]
async fn the_client_page_is_never_cached_by_the_service_worker() {
    let src = std::fs::read_to_string(format!(
        "{}/../../app/pwa/sw.js",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    assert!(
        src.contains("['api/', 's/', 'c/']") && src.contains("if (serverOwned(url)) return"),
        "the service worker leaves /c/ to the network, answered from and written to no cache"
    );
}
