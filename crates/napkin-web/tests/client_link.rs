// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The client's own link, through the real router (features/client-confirm-link.clan):
//! made by a signed-in person for one locked version, opened with no session at all,
//! answered once, and dead when wrong, expired, withdrawn or used.

use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::NoConfig;
use napkin_web::links::{sign, Claims, SCOPE};
use napkin_web::state::AppCtx;
use serde_json::{json, Value};
use tower::ServiceExt;

struct Server {
    _dir: tempfile::TempDir,
    ctx: Arc<AppCtx>,
    app: Router,
}

fn server() -> Server {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Arc::new(AppCtx::new(
        dir.path().to_path_buf(),
        Arc::new(NoConfig),
        None,
        40,
    ));
    let app = napkin_web::router(ctx.clone(), None, false);
    Server {
        _dir: dir,
        ctx,
        app,
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

async fn send(
    s: &Server,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> Reply {
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

/// The agency's side: a session, and a locked document in it.
struct Agency {
    cookie: String,
    tenant: String,
    doc: String,
    token: String,
}

/// A Brief Maker brief: the Brief gate and the client's sheet read only these.
fn brief_bytes(data: &Value) -> Vec<u8> {
    let plain = clan_sdk::create(clan_sdk::CreateOptions {
        title: "Brief for Client A".into(),
        brief: "an Irish whiskey, for under 35s".into(),
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
    // the brief's data as it stands when it is first opened (JSON is YAML)
    let mut seed = json!({ "$schema": "spec/schemas/document.schema.json" });
    for (k, v) in data.as_object().unwrap() {
        seed[k] = v.clone();
    }
    b.add_entry("shared/data.yaml", seed.to_string().into_bytes());
    b.build().unwrap()
}

async fn agency(s: &Server) -> Agency {
    agency_with(
        s,
        json!({ "single_minded_proposition": "The easy way into Irish whiskey.", "insight": "Younger drinkers think it is for someone else." }),
    )
    .await
}

async fn agency_with(s: &Server, patch: Value) -> Agency {
    let r = send(s, "GET", "/api/session", None, None).await;
    let cookie = r.headers[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let tenant = r.json()["tenant"].as_str().unwrap().to_string();
    let clan = brief_bytes(&patch);
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/t/{tenant}/documents/upload"))
        .header(header::COOKIE, &cookie)
        .body(Body::from(clan))
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
    let lock = send(
        s,
        "POST",
        &format!("/s/{}/approve", a.token),
        None,
        Some(json!({})),
    )
    .await;
    assert_eq!(lock.status, StatusCode::OK, "{}", lock.text());
    a
}

impl Agency {
    fn api(&self, tail: &str) -> String {
        let doc: String = url_encode(&self.doc);
        format!("/api/t/{}/d/{doc}/{tail}", self.tenant)
    }
}

fn url_encode(s: &str) -> String {
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

async fn make_link(s: &Server, a: &Agency) -> (String, String) {
    let r = send(
        s,
        "POST",
        &a.api("client-link"),
        Some(&a.cookie),
        Some(json!({ "name": "Pat", "email": "Pat@Client-A.example" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let v = r.json();
    let path = v["path"].as_str().unwrap();
    assert!(
        path.starts_with("/c/"),
        "the link is a page of the shell: {path}"
    );
    (
        v["id"].as_str().unwrap().to_string(),
        path.trim_start_matches("/c/").to_string(),
    )
}

async fn chain(s: &Server, a: &Agency) -> Vec<Value> {
    let r = send(s, "GET", &format!("/s/{}/chain", a.token), None, None).await;
    r.json()["decisions"].as_array().unwrap().clone()
}

#[tokio::test]
async fn the_client_opens_the_link_with_no_session_and_confirms_once() {
    let s = server();
    let a = agency(&s).await;
    let (_id, token) = make_link(&s, &a).await;
    assert!(
        send(&s, "GET", &a.api("entry/chain"), Some(&a.cookie), None)
            .await
            .text()
            .contains("issue_link"),
        "the open document holds the link at once"
    );

    // no cookie, no account: the page's data
    let v = send(&s, "GET", &format!("/c/{token}/view"), None, None).await;
    assert_eq!(v.status, StatusCode::OK, "{}", v.text());
    assert!(
        v.headers.get(header::SET_COOKIE).is_none(),
        "a visitor is given no session and no workspace"
    );
    assert_eq!(v.headers[header::CACHE_CONTROL], "no-store");
    assert_eq!(v.headers[header::REFERRER_POLICY], "no-referrer");
    let page = v.json();
    assert_eq!(page["client"]["name"], "Pat");
    assert_eq!(page["title"], "Brief for Client A");
    assert!(page["summary"]
        .to_string()
        .contains("The easy way into Irish whiskey."));

    let r = send(
        &s,
        "POST",
        &format!("/c/{token}/answer"),
        None,
        Some(json!({ "answer": "confirm" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json()["answer"], "accepted");

    // one client_review decision, the client as the actor, on the exact version
    let c = chain(&s, &a).await;
    let lock = c.iter().find(|d| d["kind"] == "approve").unwrap();
    let reviews: Vec<&Value> = c
        .iter()
        .filter(|d| d["kind"] == "client_review" && d["action"] == "client_answer")
        .collect();
    assert_eq!(reviews.len(), 1);
    assert_eq!(reviews[0]["actor"], "client:pat@client-a.example");
    assert_eq!(reviews[0]["version"], lock["version"]);

    // the link is used up
    let again = send(
        &s,
        "POST",
        &format!("/c/{token}/answer"),
        None,
        Some(json!({ "answer": "confirm" })),
    )
    .await;
    assert_eq!(again.status, StatusCode::GONE);
    let view = send(&s, "GET", &format!("/c/{token}/view"), None, None).await;
    assert_eq!(view.status, StatusCode::GONE);
    assert_eq!(view.json()["state"], "answered");
    assert!(
        !view.text().contains("Irish whiskey"),
        "a used link shows no brief"
    );
    let c = chain(&s, &a).await;
    assert_eq!(
        c.iter().filter(|d| d["action"] == "client_answer").count(),
        1
    );
}

#[tokio::test]
async fn the_clean_copy_holds_nothing_from_agent_and_no_decision() {
    let s = server();
    let a = agency(&s).await;
    let (_id, token) = make_link(&s, &a).await;
    let v = send(&s, "GET", &format!("/c/{token}/view"), None, None).await;
    let body = v.text();
    let keys: Vec<String> = v.json().as_object().unwrap().keys().cloned().collect();
    for k in &keys {
        assert!(
            [
                "ok",
                "state",
                "title",
                "client",
                "agency",
                "version",
                "expires",
                "summary",
                "signed_by",
                "html"
            ]
            .contains(&k.as_str()),
            "{k} is not something the client is shown"
        );
    }
    // what is in agent/: the context, the state, and every decision's id, rationale and actor
    for entry in ["context", "state", "chain"] {
        let r = send(
            &s,
            "GET",
            &a.api(&format!("entry/{entry}")),
            Some(&a.cookie),
            None,
        )
        .await;
        for line in r
            .text()
            .lines()
            .map(str::trim)
            .filter(|l| l.len() > 14 && !l.starts_with('#'))
        {
            assert!(
                !body.contains(line),
                "agent/{entry} line {line:?} reached the client"
            );
        }
    }
    for d in chain(&s, &a).await {
        for k in ["id", "rationale", "actor"] {
            if let Some(t) = d[k].as_str().filter(|t| t.len() > 6) {
                assert!(
                    !body.contains(t),
                    "the decision {k} {t:?} reached the client"
                );
            }
        }
    }
    // the clean copy is the export with provenance off
    let html = v.json()["html"].as_str().unwrap().to_string();
    assert!(!html.contains("<script"));
    assert!(!html.to_lowercase().contains("provenance"));
}

#[tokio::test]
async fn asking_for_changes_leaves_the_brief_as_it_was() {
    let s = server();
    let a = agency(&s).await;
    let (_id, token) = make_link(&s, &a).await;
    let before = send(&s, "GET", &a.api("entry/data"), Some(&a.cookie), None)
        .await
        .text();
    let none = send(
        &s,
        "POST",
        &format!("/c/{token}/answer"),
        None,
        Some(json!({ "answer": "changes" })),
    )
    .await;
    assert_eq!(none.status, StatusCode::BAD_REQUEST, "changes need words");
    let r = send(
        &s,
        "POST",
        &format!("/c/{token}/answer"),
        None,
        Some(json!({ "answer": "changes", "said": "Say it warmer." })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(
        send(&s, "GET", &a.api("entry/data"), Some(&a.cookie), None)
            .await
            .text(),
        before,
        "the content hash is unchanged"
    );
    let c = chain(&s, &a).await;
    assert!(c.iter().any(|d| d["kind"] == "approve"));
    assert!(!c.iter().any(|d| d["kind"] == "unlock"), "still locked");
}

#[tokio::test]
async fn a_wrong_link_is_404_and_says_nothing() {
    let s = server();
    let a = agency(&s).await;
    let (_id, token) = make_link(&s, &a).await;
    let other_key = napkin_web::links::key_from(b"some other server's secret, 32 bytes+");
    let claims = |exp: u64| Claims {
        v: 1,
        id: "0123456789abcdef0123456789abcdef".into(),
        tenant: a.tenant.clone(),
        doc: a.doc.clone(),
        scope: SCOPE.into(),
        targets: vec![a.doc.clone()],
        version: "v".into(),
        hash: "h".into(),
        agency: None,
        exp,
    };
    let in_a_day = chrono::Utc::now().timestamp() as u64 + 86_400;
    let forged = sign(&other_key, &claims(in_a_day));
    // right key and shape, but a link id the document never issued
    let unissued = sign(&s.ctx.link_key, &claims(in_a_day));
    for bad in [
        "nonsense".to_string(),
        format!("{token}x"),
        forged,
        unissued,
        token.split_once('.').unwrap().0.to_string(),
    ] {
        let v = send(&s, "GET", &format!("/c/{bad}/view"), None, None).await;
        assert_eq!(v.status, StatusCode::NOT_FOUND, "{bad}");
        assert_eq!(v.json()["state"], "unknown");
        let r = send(
            &s,
            "POST",
            &format!("/c/{bad}/answer"),
            None,
            Some(json!({ "answer": "confirm" })),
        )
        .await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{bad}");
    }
    assert!(!chain(&s, &a)
        .await
        .iter()
        .any(|d| d["action"] == "client_answer"));
}

#[tokio::test]
async fn an_expired_link_is_410() {
    let s = server();
    let a = agency(&s).await;
    let (id, _) = make_link(&s, &a).await;
    let expired = sign(
        &s.ctx.link_key,
        &Claims {
            v: 1,
            id,
            tenant: a.tenant.clone(),
            doc: a.doc.clone(),
            scope: SCOPE.into(),
            targets: vec![a.doc.clone()],
            version: "v".into(),
            hash: "h".into(),
            agency: None,
            exp: chrono::Utc::now().timestamp() as u64 - 1,
        },
    );
    let v = send(&s, "GET", &format!("/c/{expired}/view"), None, None).await;
    assert_eq!(v.status, StatusCode::GONE);
    assert_eq!(v.json()["state"], "expired");
    let r = send(
        &s,
        "POST",
        &format!("/c/{expired}/answer"),
        None,
        Some(json!({ "answer": "confirm" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::GONE);
    assert!(!chain(&s, &a)
        .await
        .iter()
        .any(|d| d["action"] == "client_answer"));
}

#[tokio::test]
async fn a_withdrawn_link_is_410() {
    let s = server();
    let a = agency(&s).await;
    let (id, token) = make_link(&s, &a).await;
    let list = send(&s, "GET", &a.api("client-links"), Some(&a.cookie), None)
        .await
        .json();
    assert_eq!(list["links"][0]["state"], "open");
    let w = send(
        &s,
        "POST",
        &a.api(&format!("client-link/{id}/withdraw")),
        Some(&a.cookie),
        Some(json!({})),
    )
    .await;
    assert_eq!(w.status, StatusCode::OK, "{}", w.text());
    let v = send(&s, "GET", &format!("/c/{token}/view"), None, None).await;
    assert_eq!(v.status, StatusCode::GONE);
    assert_eq!(v.json()["state"], "withdrawn");
    let r = send(
        &s,
        "POST",
        &format!("/c/{token}/answer"),
        None,
        Some(json!({ "answer": "confirm" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::GONE);
    assert!(!chain(&s, &a)
        .await
        .iter()
        .any(|d| d["action"] == "client_answer"));
    // withdrawing needs the agency's session
    let anon = send(
        &s,
        "POST",
        &a.api(&format!("client-link/{id}/withdraw")),
        None,
        Some(json!({})),
    )
    .await;
    assert_ne!(anon.status, StatusCode::OK);
}

#[tokio::test]
async fn a_brief_changed_after_the_link_was_made_kills_the_link() {
    let s = server();
    let a = agency(&s).await;
    let (_id, token) = make_link(&s, &a).await;
    let edit = send(&s, "POST", &format!("/s/{}/patch-data", a.token), None, Some(json!({
        "agent": "human", "action": "edit the proposition", "patch": { "single_minded_proposition": "A new line." },
    }))).await;
    assert_eq!(edit.status, StatusCode::OK);
    let v = send(&s, "GET", &format!("/c/{token}/view"), None, None).await;
    assert_eq!(v.status, StatusCode::GONE);
    assert_eq!(v.json()["state"], "superseded");
    assert!(
        !v.text().contains("A new line."),
        "an old link never shows a newer brief"
    );
    // and no new link to an edited, unsigned version
    let again = send(
        &s,
        "POST",
        &a.api("client-link"),
        Some(&a.cookie),
        Some(json!({ "name": "Pat", "email": "pat@client-a.example" })),
    )
    .await;
    assert_eq!(again.status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn a_link_to_an_unlocked_brief_is_not_made_and_a_link_needs_a_session() {
    let s = server();
    let a = agency(&s).await;
    // a second document, never locked
    let clan = brief_bytes(&json!({}));
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/t/{}/documents/upload", a.tenant))
        .header(header::COOKIE, &a.cookie)
        .body(Body::from(clan))
        .unwrap();
    let up = s.app.clone().oneshot(req).await.unwrap();
    let up: Value =
        serde_json::from_slice(&up.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let doc = url_encode(up["path"].as_str().unwrap());
    let r = send(
        &s,
        "POST",
        &format!("/api/t/{}/d/{doc}/client-link", a.tenant),
        Some(&a.cookie),
        Some(json!({ "name": "Pat", "email": "pat@client-a.example" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{}", r.text());
    // someone else's session cannot make a link on this workspace
    let other = send(&s, "GET", "/api/session", None, None).await;
    let other_cookie = other.headers[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let r = send(
        &s,
        "POST",
        &a.api("client-link"),
        Some(&other_cookie),
        Some(json!({ "name": "Pat", "email": "pat@client-a.example" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_link_is_rate_limited() {
    let s = server();
    let a = agency(&s).await;
    let (_id, token) = make_link(&s, &a).await;
    let mut limited = false;
    for _ in 0..60 {
        if send(&s, "GET", &format!("/c/{token}/view"), None, None)
            .await
            .status
            == StatusCode::TOO_MANY_REQUESTS
        {
            limited = true;
            break;
        }
    }
    assert!(limited, "a link opened sixty times a minute is stopped");
}

#[tokio::test]
async fn a_visitor_cannot_reach_anything_else_with_a_link() {
    let s = server();
    let a = agency(&s).await;
    let (_id, token) = make_link(&s, &a).await;
    // the link is not a sandbox token and not a session
    for uri in [format!("/s/{token}/gate"), format!("/s/{token}/chain")] {
        assert_eq!(
            send(&s, "GET", &uri, None, None).await.status,
            StatusCode::FORBIDDEN,
            "{uri}"
        );
    }
    let r = send(
        &s,
        "GET",
        &format!("/api/t/{}/library", a.tenant),
        Some(&format!("napkin_session={token}")),
        None,
    )
    .await;
    assert_ne!(r.status, StatusCode::OK);
}

// ── what the client's full brief may hold ───────────────────────────────────

/// Keys of the Brief Maker schema that the client is never shown. A new key in the schema
/// must be put here, or in `clean::FIELDS`, on purpose: the test below fails until it is.
const NEVER: &[&str] = &[
    "project_name",
    "competitor_context",
    "job",
    "barrier",
    "objection",
    "media_roles",
    "open_questions",
    "reference_assets",
    "brief_input",
    "brief_style",
    "theme",
    "field_styles",
    "layout",
    "logos",
    "locked_fields",
    "confidential_fields",
    "locked",
    "materials",
    "capture",
    "review",
    "passages",
    "projection",
    "upstream",
];

fn brief_schema() -> Value {
    let p = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../app/templates/brief-maker/schema.json"
    );
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

#[test]
fn every_key_of_the_brief_schema_is_shown_or_named_as_never_shown() {
    let schema = brief_schema();
    let props = schema["properties"].as_object().unwrap();
    let shown: Vec<&str> = napkin_web::clean::FIELDS.iter().map(|(k, _)| *k).collect();
    for k in props.keys() {
        assert!(
            shown.contains(&k.as_str()) ^ NEVER.contains(&k.as_str()),
            "`{k}` is a key of the Brief Maker schema: put it in clean::FIELDS (the client reads it) or in NEVER (the client does not), and in one only"
        );
    }
    // `famous` is the Brief gate's own item (a string), not yet a schema key
    for k in shown.iter().chain(NEVER).filter(|k| **k != "famous") {
        assert!(
            props.contains_key(*k),
            "`{k}` is not in the schema any more"
        );
    }
}

/// Every key of the schema filled with a marker of its own, and some keys the schema does not name.
fn marked_brief() -> Value {
    let schema = brief_schema();
    let mut out = serde_json::Map::new();
    for (k, v) in schema["properties"].as_object().unwrap() {
        let m = format!("MK_{k}");
        let value = match v["type"].as_str() {
            Some("string") => json!(m),
            Some("array") if v["items"]["type"] == "string" => json!([format!("{m}_0")]),
            Some("array") => {
                json!([{ "name": format!("{m}_name"), "path": format!("{m}_path"), "slot": "client", "ref": { "asset": format!("{m}_asset") } }])
            }
            Some("object") => {
                let mut o = serde_json::Map::new();
                for sub in v["properties"].as_object().into_iter().flatten() {
                    if sub.1["type"] == "string" {
                        o.insert(sub.0.clone(), json!(format!("{m}_{}", sub.0)));
                    }
                }
                o.insert("internal_extra".into(), json!(format!("{m}_extra")));
                Value::Object(o)
            }
            Some("boolean") => continue,
            _ => {
                json!({ "note": m, "deep": { "text": format!("{m}_deep") }, "list": [format!("{m}_item")] })
            }
        };
        out.insert(k.clone(), value);
    }
    // a list of strings can hold an object, and the brief can hold keys no schema names
    out.insert(
        "tone_and_world".into(),
        json!(["MK_tone_and_world_0", { "note": "MK_tone_object" }]),
    );
    out.insert("famous".into(), json!("MK_famous"));
    out.insert("unlisted_key".into(), json!("MK_unlisted"));
    out.insert("planner_notes".into(), json!({ "text": "MK_planner" }));
    out.insert(
        "confidential_fields".into(),
        json!(["audience", "insight", "objectives.behavioural"]),
    );
    Value::Object(out)
}

/// Every `MK_…` marker in some text.
fn markers(text: &str) -> std::collections::BTreeSet<String> {
    let mut out = std::collections::BTreeSet::new();
    let mut rest = text;
    while let Some(i) = rest.find("MK_") {
        let tail = &rest[i..];
        let end = tail
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(tail.len());
        out.insert(tail[..end].to_string());
        rest = &tail[end..];
    }
    out
}

#[tokio::test]
async fn the_clients_brief_holds_the_allow_listed_fields_and_nothing_the_brief_also_keeps() {
    let s = server();
    let a = agency_with(&s, marked_brief()).await;
    let (_id, token) = make_link(&s, &a).await;
    let v = send(&s, "GET", &format!("/c/{token}/view"), None, None).await;
    assert_eq!(v.status, StatusCode::OK, "{}", v.text());
    let page = v.json();
    let want: std::collections::BTreeSet<String> = [
        "client",
        "background",
        "single_minded_proposition",
        "budget_and_scope",
        "famous",
    ]
    .iter()
    .map(|k| format!("MK_{k}"))
    .chain(
        [
            "tone_and_world",
            "reasons_to_believe",
            "measurement",
            "mandatories",
        ]
        .iter()
        .map(|k| format!("MK_{k}_0")),
    )
    .chain(
        [
            "objectives_commercial",
            "objectives_attitudinal",
            "desired_response_think",
            "desired_response_feel",
            "desired_response_do",
        ]
        .iter()
        .map(|k| format!("MK_{k}")),
    )
    .collect();
    // the confidential parts (audience, insight, objectives.behavioural) are not here
    let got = markers(&v.text());
    assert_eq!(
        got,
        want,
        "shown but not allowed: {:?}; allowed but missing: {:?}",
        got.difference(&want).collect::<Vec<_>>(),
        want.difference(&got).collect::<Vec<_>>()
    );
    // the summary the client reads first draws on the same fields
    assert!(markers(&page["summary"].to_string()).is_subset(&want));
    assert!(page["summary"].to_string().contains("MK_background"));
    assert!(!page["summary"].to_string().contains("MK_insight"));
    // and nothing from the brief's own drawing of itself
    let html = page["html"].as_str().unwrap();
    assert!(!html.contains("internal_extra") && !html.contains("planner"));
}

#[tokio::test]
async fn the_token_in_the_url_does_not_carry_the_clients_name_or_email() {
    let s = server();
    let a = agency(&s).await;
    let (_id, token) = make_link(&s, &a).await;
    use base64::Engine as _;
    let body = token.split_once('.').unwrap().0;
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(body)
        .unwrap();
    let claims: Value = serde_json::from_slice(&raw).unwrap();
    let keys: Vec<&str> = claims
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    for k in keys {
        assert!(
            ["v", "id", "tenant", "doc", "scope", "targets", "version", "hash", "agency", "exp"]
                .contains(&k),
            "the token carries `{k}`: the chain holds that, the URL need not"
        );
    }
    let text = String::from_utf8_lossy(&raw).to_lowercase();
    assert!(!text.contains("pat@client-a.example") && !text.contains("\"pat\""));
    // the page and the record still know who the link is for
    let v = send(&s, "GET", &format!("/c/{token}/view"), None, None).await;
    assert_eq!(v.json()["client"]["name"], "Pat");
    let r = send(
        &s,
        "POST",
        &format!("/c/{token}/answer"),
        None,
        Some(json!({ "answer": "confirm" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let c = chain(&s, &a).await;
    assert!(c
        .iter()
        .any(|d| d["actor"] == "client:pat@client-a.example"));
}

#[test]
fn a_short_link_secret_is_not_used_to_sign() {
    let ctx = |secret: Option<&[u8]>| {
        AppCtx::new(
            tempfile::tempdir().unwrap().keep(),
            Arc::new(NoConfig),
            None,
            40,
        )
        .with_link_secret(secret)
    };
    let short = ctx(Some(b"short"));
    assert_ne!(
        short.link_key,
        napkin_web::links::key_from(b"short"),
        "a guessable secret must not sign links"
    );
    let long = b"a session secret of thirty-two bytes!";
    assert_eq!(ctx(Some(long)).link_key, napkin_web::links::key_from(long));
}
