// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/first-day.clan through the real router, on the one People store: an admin invites a person who
//! is already on the list, and the link carries the sign-in name and nothing else (no token, no session,
//! nothing it grants). The mark is the server's, per person; the first task is a web-level need for the
//! invited person only; nothing about how long a person took is kept; a member writes nothing here; a
//! foreign or missing agency or person answers alike.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use napkin_host::NoConfig;
use napkin_web::mail::{Memory, Message};
use napkin_web::state::AppCtx;
use serde_json::{json, Value};
use tower::ServiceExt;

struct Rig {
    dir: tempfile::TempDir,
    app: Router,
    mail: Arc<Memory>,
}

struct Person {
    cookie: String,
    tenant: String,
}

const ROSTER: &str = "maeve@wk\tMaeve\tadmin\n\
aoife@wk\tAoife\tplanning\n\
dara@wk\tDara\tcopywriter\n\
barra@bq\tBarra\tadmin\n\
niamh@bq\tNiamh\tmanagement\n";

const ORIGIN: &str = "https://studio.example.test";

/// A rig on `roster`, mailing to memory, with the studio's public address set (or not).
fn build(roster_text: &str, origin: Option<&str>, mailing: bool) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let mem: Arc<Memory> = Arc::default();
    let mut ctx = AppCtx::new(dir.path().to_path_buf(), Arc::new(NoConfig), None, 40);
    if mailing {
        ctx = ctx.with_mailer(mem.clone(), 50);
    }
    if let Some(o) = origin {
        ctx = ctx.with_public_origin(o);
    }
    let roster = dir.path().join("accounts.tsv");
    std::fs::write(&roster, roster_text).unwrap();
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
        app: napkin_web::router_with(Arc::new(ctx), None, Arc::new(identity)),
        dir,
        mail: mem,
    }
}

fn rig() -> Rig {
    build(ROSTER, Some(ORIGIN), true)
}

async fn call(
    r: &Rig,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value, axum::http::HeaderMap) {
    let mut b = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, "studio.example.test");
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

fn session_cookie(h: &axum::http::HeaderMap) -> Option<String> {
    h.get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("napkin_session=") && !v.starts_with("napkin_session=;"))
        .map(|v| v.split(';').next().unwrap().to_string())
}

async fn sign_in(r: &Rig, who: &str) -> Person {
    let (st, body, h) = call(
        r,
        "POST",
        "/api/auth/sign-in",
        None,
        Some(json!({ "username": who })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{who}: {body}");
    let cookie = session_cookie(&h).unwrap();
    let (_, me, _) = call(r, "GET", "/api/session", Some(&cookie), None).await;
    Person {
        cookie,
        tenant: me["tenant"].as_str().unwrap().to_string(),
    }
}

/// A person added the one way there is: the People page's route, as an agency's admin.
async fn add(r: &Rig, admin: &Person, username: &str, name: &str, roles: &[&str]) {
    let (st, body, _) = call(
        r,
        "POST",
        "/api/admin/people",
        Some(&admin.cookie),
        Some(json!({ "username": username, "name": name, "roles": roles })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{body}");
}

const BRIEF_MAKER: &str = "ie.napkin.brief-maker";

/// J001 for Client A, opened by `admin` in their agency's workspace, with a Brief Maker brief named "J001 brief" filed
/// under it; its path is `doc-b1`.
async fn live_job(r: &Rig, admin: &Person) {
    let t = &admin.tenant;
    let (_, client, _) = call(
        r,
        "POST",
        &format!("/api/t/{t}/clients"),
        Some(&admin.cookie),
        Some(json!({ "name": "Client A" })),
    )
    .await;
    let (st, v, _) = call(
        r,
        "POST",
        &format!("/api/t/{t}/jobs"),
        Some(&admin.cookie),
        Some(json!({ "number": "J001", "client_id": client["id"], "due": "2026-12-18" })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    brief(r, t, client["id"].as_str().unwrap());
}

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
    let docs = r.dir.path().join(tenant).join("documents");
    std::fs::create_dir_all(&docs).unwrap();
    std::fs::write(docs.join("b1.clan"), b.build().unwrap()).unwrap();
}

async fn invite(r: &Rig, by: &Person, id: &str, body: Value) -> (StatusCode, Value) {
    let (st, v, _) = call(
        r,
        "POST",
        &format!("/api/admin/people/{id}/first-day"),
        Some(&by.cookie),
        Some(body),
    )
    .await;
    (st, v)
}

async fn mine(r: &Rig, p: &Person) -> Value {
    call(
        r,
        "GET",
        &format!("/api/t/{}/me/first-day", p.tenant),
        Some(&p.cookie),
        None,
    )
    .await
    .1
}

async fn mark(r: &Rig, p: &Person, body: Value) -> StatusCode {
    call(
        r,
        "POST",
        &format!("/api/t/{}/me/first-day", p.tenant),
        Some(&p.cookie),
        Some(body),
    )
    .await
    .0
}

async fn needs(r: &Rig, p: &Person) -> Value {
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

#[tokio::test]
async fn an_admin_invites_a_person_on_the_list_and_gets_a_name_link() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    live_job(&r, &maeve).await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    let (st, v) = invite(
        &r,
        &maeve,
        "newcomer@wk",
        json!({ "first": { "path": "doc-b1" } }),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    assert_eq!(v["person"], json!("newcomer@wk"));
    assert_eq!(v["first"]["job"], json!("J001"));
    assert_eq!(v["first"]["path"], json!("doc-b1"));
    assert_eq!(v["mailed"], json!(false));
    // the link is the address and the name, nothing more
    assert_eq!(
        v["link"],
        json!("http://studio.example.test/?welcome=newcomer@wk")
    );
    // a first thing to open is optional
    add(&r, &maeve, "plain@wk", "Plain Test", &["copywriter"]).await;
    let (st, v) = invite(&r, &maeve, "plain@wk", json!({})).await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    assert!(v.get("first").is_none() || v["first"].is_null());
}

#[tokio::test]
async fn the_link_carries_no_credential_and_grants_nothing() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    let (_, v) = invite(&r, &maeve, "newcomer@wk", json!({})).await;
    let link = v["link"].as_str().unwrap().to_string();
    // the whole query is one name: no token, signature, expiry or session in the text
    let query = link.split_once('?').unwrap().1;
    assert_eq!(query, "welcome=newcomer@wk");
    for marker in ["token", "sig", "exp", "session", "napkin_session", "code"] {
        assert!(!link.contains(marker), "the link names {marker}: {link}");
    }
    // opening it, with no press, signs nobody in and sets no cookie
    let path = format!("/?{query}");
    let (st, _, h) = call(&r, "GET", &path, None, None).await;
    assert!(st.is_success() || st.is_redirection() || st == StatusCode::NOT_FOUND);
    assert!(
        h.get_all(header::SET_COOKIE).iter().all(|c| !c
            .to_str()
            .unwrap()
            .starts_with("napkin_session=")
            || c.to_str().unwrap().starts_with("napkin_session=;")),
        "opening the link must not sign anyone in"
    );
    let (st, _, _) = call(&r, "GET", "/api/session", None, None).await;
    assert_ne!(st, StatusCode::OK, "no session without a sign-in");
    // the person signs in as anyone does, and their roles are the store's
    let (_, _) = (0, 0);
    let n = sign_in(&r, "newcomer@wk").await;
    let (_, me, _) = call(&r, "GET", "/api/session", Some(&n.cookie), None).await;
    assert_eq!(me["roles"], json!(["copywriter"]));
    assert_eq!(me["user"]["name"], json!("Newcomer Test"));
    // a name that is not on the list does not become signable by being named in a link
    let (st, _, h) = call(
        &r,
        "POST",
        "/api/auth/sign-in",
        None,
        Some(json!({ "username": "stranger@wk" })),
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    assert!(session_cookie(&h).is_none());
}

#[tokio::test]
async fn inviting_never_adds_a_person_or_a_role() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    // a name nobody added: not found, and still not on the list afterwards
    let (st, _) = invite(&r, &maeve, "ghost@wk", json!({})).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _, _) = call(
        &r,
        "POST",
        "/api/auth/sign-in",
        None,
        Some(json!({ "username": "ghost@wk" })),
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    // the body takes a first thing and an address, no roles, no name
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    let (st, _) = invite(&r, &maeve, "newcomer@wk", json!({ "roles": ["admin"] })).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    let (_, people, _) = call(&r, "GET", "/api/admin/people", Some(&maeve.cookie), None).await;
    let row = people["people"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "newcomer@wk")
        .unwrap();
    assert_eq!(row["roles"], json!(["copywriter"]));
}

#[tokio::test]
async fn a_member_writes_nothing_and_a_foreign_or_missing_person_answers_alike() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    live_job(&r, &maeve).await;
    let aoife = sign_in(&r, "aoife@wk").await;
    let barra = sign_in(&r, "barra@bq").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    // a member (not an admin) cannot make, withdraw or list first-day records, for anyone or for themselves
    for who in ["newcomer@wk", "aoife@wk", "ghost@wk"] {
        let (st, _) = invite(&r, &aoife, who, json!({})).await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{who}");
        let (st, _, _) = call(
            &r,
            "DELETE",
            &format!("/api/admin/people/{who}/first-day"),
            Some(&aoife.cookie),
            None,
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN);
    }
    // a signed-out visitor is refused too
    let (st, _, _) = call(
        &r,
        "POST",
        "/api/admin/people/newcomer@wk/first-day",
        None,
        Some(json!({})),
    )
    .await;
    assert!(st == StatusCode::FORBIDDEN || st == StatusCode::UNAUTHORIZED);
    // another agency's admin: the person, a person nobody has and an agency nobody has answer the same
    let a = invite(&r, &barra, "newcomer@wk", json!({})).await;
    let b = invite(&r, &barra, "ghost@wk", json!({})).await;
    let c = invite(&r, &barra, "ghost@nowhere", json!({})).await;
    assert_eq!(a.0, StatusCode::NOT_FOUND);
    assert_eq!(b.0, c.0);
    // the same words but for the name asked about: nothing says whether the person exists
    let words =
        |v: &(StatusCode, Value), who: &str| v.1["error"].as_str().unwrap().replace(who, "X");
    assert_eq!(words(&a, "newcomer@wk"), words(&b, "ghost@wk"));
    assert_eq!(words(&b, "ghost@wk"), words(&c, "ghost@nowhere"));
    // withdrawing a record that is not there, from another agency, answers like one that is not there
    let (st, _, _) = call(
        &r,
        "DELETE",
        "/api/admin/people/newcomer@wk/first-day",
        Some(&barra.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_first_thing_to_open_is_a_document_on_a_live_job_of_that_agency() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    let barra = sign_in(&r, "barra@bq").await;
    live_job(&r, &maeve).await;
    live_job(&r, &barra).await; // another agency's J001, with the same path
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    // not a document at all, and a path that climbs out of the folder
    for bad in ["doc-nope", "../bq/doc-b1", "", "doc-b1/../../x"] {
        let (st, v) = invite(
            &r,
            &maeve,
            "newcomer@wk",
            json!({ "first": { "path": bad } }),
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{bad:?}: {v}");
    }
    // the same path in the agency that owns it is fine, and the answer names no title
    let (st, v) = invite(
        &r,
        &maeve,
        "newcomer@wk",
        json!({ "first": { "path": "doc-b1" } }),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    assert!(!v.to_string().contains("J001 brief"));
}

#[tokio::test]
async fn where_no_people_store_is_kept_there_is_no_invite() {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Arc::new(AppCtx::new(
        dir.path().to_path_buf(),
        Arc::new(NoConfig),
        None,
        40,
    ));
    let app = napkin_web::router_with(
        ctx,
        None,
        Arc::new(napkin_web::tenant::Identity {
            mode: napkin_web::tenant::Mode::Anonymous,
            secure: false,
        }),
    );
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/admin/people/a@wk/first-day")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        resp.status() == StatusCode::NOT_FOUND || resp.status() == StatusCode::FORBIDDEN,
        "{}",
        resp.status()
    );
}

#[tokio::test]
async fn the_mark_is_the_servers_per_person_and_only_an_invited_person_has_pointers() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    let dara = sign_in(&r, "dara@wk").await;
    // everyone who exists today reads as seen
    assert_eq!(mine(&r, &maeve).await, json!({ "show_pointers": false }));
    assert_eq!(mine(&r, &dara).await, json!({ "show_pointers": false }));
    // a person nobody invited cannot make a record by marking
    assert_ne!(
        mark(&r, &dara, json!({ "seen": true })).await,
        StatusCode::OK
    );

    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    invite(&r, &maeve, "newcomer@wk", json!({})).await;
    let n = sign_in(&r, "newcomer@wk").await;
    assert_eq!(mine(&r, &n).await, json!({ "show_pointers": true }));
    // reading is not marking: again, still true, and on a second device (a second sign-in) too
    let n2 = sign_in(&r, "newcomer@wk").await;
    assert_eq!(mine(&r, &n2).await, json!({ "show_pointers": true }));
    // another person can neither read nor set it
    assert_eq!(mine(&r, &dara).await, json!({ "show_pointers": false }));
    assert_ne!(
        mark(&r, &dara, json!({ "seen": true })).await,
        StatusCode::OK
    );
    // a body that names another person is refused, whoever sends it
    assert_eq!(
        mark(&r, &dara, json!({ "seen": true, "person": "newcomer@wk" })).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(mine(&r, &n).await, json!({ "show_pointers": true }));
    // the person's own press ends it, on every device
    assert_eq!(mark(&r, &n, json!({ "seen": true })).await, StatusCode::OK);
    assert_eq!(mine(&r, &n).await, json!({ "show_pointers": false }));
    assert_eq!(mine(&r, &n2).await, json!({ "show_pointers": false }));
    // a new invite starts again
    invite(&r, &maeve, "newcomer@wk", json!({})).await;
    assert_eq!(mine(&r, &n).await, json!({ "show_pointers": true }));
}

#[tokio::test]
async fn the_first_task_is_a_need_for_the_invited_person_only_and_leaves_when_pressed() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    live_job(&r, &maeve).await;
    let dara = sign_in(&r, "dara@wk").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    invite(
        &r,
        &maeve,
        "newcomer@wk",
        json!({ "first": { "path": "doc-b1" } }),
    )
    .await;
    let n = sign_in(&r, "newcomer@wk").await;
    let v = needs(&r, &n).await;
    let t = &v["first_task"];
    assert_eq!(t["kind"], json!("first-task"));
    assert_eq!(t["id"], json!("first:newcomer@wk"));
    assert_eq!(t["job"], json!("J001"));
    assert_eq!(t["path"], json!("doc-b1"));
    assert_eq!(t["action"], json!("Open"));
    // the words are the allow list: the job number, the client and the document's title
    let text = t["text"].as_str().unwrap();
    assert!(text.contains("J001 brief"), "{text}");
    assert!(!text.contains('\u{2014}'));
    // nobody else has one, the inviter included
    for p in [&maeve, &dara] {
        assert!(needs(&r, p).await["first_task"].is_null());
    }
    // pressing its button marks it, and it does not come back
    assert_eq!(
        mark(&r, &n, json!({ "opened": true })).await,
        StatusCode::OK
    );
    assert!(needs(&r, &n).await["first_task"].is_null());
    assert!(needs(&r, &n).await["first_task"].is_null());
    // an invite with no first thing has no first task
    invite(&r, &maeve, "newcomer@wk", json!({})).await;
    assert!(needs(&r, &n).await["first_task"].is_null());
}

#[tokio::test]
async fn inviting_and_withdrawing_are_on_the_change_log_and_the_audit_chain() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    invite(&r, &maeve, "newcomer@wk", json!({})).await;
    let (st, _, _) = call(
        &r,
        "DELETE",
        "/api/admin/people/newcomer@wk/first-day",
        Some(&maeve.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let log = std::fs::read_to_string(r.dir.path().join("_people").join("changes.jsonl")).unwrap();
    assert!(
        log.contains("first day invited") && log.contains("first day withdrawn"),
        "{log}"
    );
    let (st, audit, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/audit", maeve.tenant),
        Some(&maeve.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{audit}");
    let text = audit.to_string();
    assert!(
        text.contains("newcomer@wk") && text.to_lowercase().contains("first day"),
        "{text}"
    );
    // the record is gone, so the person has no pointers
    let n = sign_in(&r, "newcomer@wk").await;
    assert_eq!(mine(&r, &n).await, json!({ "show_pointers": false }));
    // a second withdrawal finds nothing
    let (st, _, _) = call(
        &r,
        "DELETE",
        "/api/admin/people/newcomer@wk/first-day",
        Some(&maeve.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn removing_a_person_withdraws_their_first_day_and_they_cannot_sign_in() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    live_job(&r, &maeve).await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    invite(
        &r,
        &maeve,
        "newcomer@wk",
        json!({ "first": { "path": "doc-b1" } }),
    )
    .await;
    let (st, _, _) = call(
        &r,
        "DELETE",
        "/api/admin/people/newcomer@wk",
        Some(&maeve.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _, h) = call(
        &r,
        "POST",
        "/api/auth/sign-in",
        None,
        Some(json!({ "username": "newcomer@wk" })),
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    assert!(session_cookie(&h).is_none());
}

fn stored(r: &Rig) -> Value {
    let file = std::fs::read_to_string(r.dir.path().join("_people").join("people.json")).unwrap();
    serde_json::from_str(&file).unwrap()
}

/// Review of 15 Nov: no route tells an admin what a newcomer has done since (no list, no signed-in flag).
#[tokio::test]
async fn no_route_tells_an_admin_what_a_newcomer_has_done_since() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    let (_, made) = invite(&r, &maeve, "newcomer@wk", json!({})).await;
    let n = sign_in(&r, "newcomer@wk").await;
    mark(&r, &n, json!({ "seen": true })).await;
    let (st, _, _) = call(
        &r,
        "GET",
        "/api/admin/first-days",
        Some(&maeve.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND, "the list of first days is gone");
    // what the invite answers and what the store keeps for the admin's side: set up, by whom, for which document
    let mut keys: Vec<&str> = made
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    assert_eq!(keys, ["link", "mailed", "person"]);
    let book = stored(&r);
    let rec = &book["first_days"][0];
    let mut keys: Vec<&str> = rec
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    assert_eq!(keys, ["agency", "made_by", "made_on", "person", "rev"]);
    let people = call(&r, "GET", "/api/admin/people", Some(&maeve.cookie), None)
        .await
        .1;
    for banned in ["seen", "opened", "signed_in", "first_day"] {
        assert!(
            !people.to_string().contains(banned),
            "the People list shows {banned}"
        );
    }
}

/// R1: a mark that changes nothing writes nothing; the marks are in their own small file, not in people.json.
#[tokio::test]
async fn a_repeated_mark_writes_nothing_and_the_marks_live_beside_the_store() {
    use std::os::unix::fs::MetadataExt;
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    invite(&r, &maeve, "newcomer@wk", json!({})).await;
    let n = sign_in(&r, "newcomer@wk").await;
    let people = r.dir.path().join("_people");
    let ino = |f: &str| {
        std::fs::metadata(people.join(f))
            .map(|m| m.ino())
            .unwrap_or(0)
    };
    let before_store = std::fs::read(people.join("people.json")).unwrap();
    assert_eq!(mark(&r, &n, json!({ "seen": true })).await, StatusCode::OK);
    let (marks, store) = (ino("first-day-marks.json"), ino("people.json"));
    assert_ne!(marks, 0, "the marks file is written");
    for _ in 0..3 {
        assert_eq!(mark(&r, &n, json!({ "seen": true })).await, StatusCode::OK);
    }
    assert_eq!(
        marks,
        ino("first-day-marks.json"),
        "a repeat rewrote the marks"
    );
    assert_eq!(store, ino("people.json"), "a mark rewrote people.json");
    assert_eq!(
        before_store,
        std::fs::read(people.join("people.json")).unwrap()
    );
    // a mark never touches the log either
    let log = std::fs::read_to_string(people.join("changes.jsonl")).unwrap();
    assert!(!log.contains("marked"), "{log}");
}

/// R7: the marks route is the session's: another agency's tenant in the path is refused.
#[tokio::test]
async fn the_marks_route_checks_the_path_tenant_against_the_session() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    invite(&r, &maeve, "newcomer@wk", json!({})).await;
    let n = sign_in(&r, "newcomer@wk").await;
    let barra = sign_in(&r, "barra@bq").await;
    for method in ["GET", "POST"] {
        let (st, v, _) = call(
            &r,
            method,
            &format!("/api/t/{}/me/first-day", barra.tenant),
            Some(&n.cookie),
            (method == "POST").then(|| json!({ "seen": true })),
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{method}: {v}");
    }
    for bad in [
        json!({ "signed_in": true }),
        json!({ "seen": true, "first": { "path": "x" } }),
    ] {
        assert_eq!(mark(&r, &n, bad).await, StatusCode::BAD_REQUEST);
    }
}

/// R6: a person removed and added again has no old first day, and the old marks do not carry over.
#[tokio::test]
async fn a_person_brought_back_has_no_old_first_day() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    invite(&r, &maeve, "dara@wk", json!({})).await;
    let dara = sign_in(&r, "dara@wk").await;
    mark(&r, &dara, json!({ "seen": true })).await;
    let (st, _, _) = call(
        &r,
        "DELETE",
        "/api/admin/people/dara@wk",
        Some(&maeve.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    add(&r, &maeve, "dara@wk", "Dara", &["copywriter"]).await;
    let dara = sign_in(&r, "dara@wk").await;
    assert_eq!(mine(&r, &dara).await["show_pointers"], json!(false));
    // and a fresh invite starts again, whatever was marked before
    invite(&r, &maeve, "dara@wk", json!({})).await;
    assert_eq!(mine(&r, &dara).await["show_pointers"], json!(true));
}

async fn set_email(r: &Rig, admin: &Person, id: &str, email: &str) {
    let (st, v, _) = call(
        r,
        "PATCH",
        &format!("/api/admin/people/{id}"),
        Some(&admin.cookie),
        Some(json!({ "email": email })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
}

/// Mail: the address is the person's own, from the People store; the link's origin is the server's configured one.
#[tokio::test]
async fn the_mail_goes_to_the_stored_address_with_the_configured_origin_and_keeps_no_address() {
    let r = rig();
    live_job(&r, &sign_in(&r, "maeve@wk").await).await;
    let maeve = sign_in(&r, "maeve@wk").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    set_email(&r, &maeve, "newcomer@wk", "newcomer@mail.example.test").await;
    // the address is never taken from the request
    let (st, _) = invite(
        &r,
        &maeve,
        "newcomer@wk",
        json!({ "email": "victim@outside.example.test" }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert!(r.mail.outbox().is_empty());
    // the Host header is not the origin: the mail carries the configured one
    let (st, v) = {
        let req = Request::builder()
            .method("POST")
            .uri("/api/admin/people/newcomer@wk/first-day")
            .header(header::HOST, "evil.example.test")
            .header(header::COOKIE, &maeve.cookie)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({ "first": { "path": "doc-b1" }, "mail": true }).to_string(),
            ))
            .unwrap();
        let resp = r.app.clone().oneshot(req).await.unwrap();
        let st = resp.status();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        (st, serde_json::from_slice::<Value>(&bytes).unwrap())
    };
    assert_eq!(st, StatusCode::CREATED, "{v}");
    assert_eq!(v["mailed"], json!(true));
    let out = r.mail.outbox();
    assert_eq!(out.len(), 1);
    let Message::Invite { to, url, .. } = &out[0] else {
        panic!("{:?}", out[0])
    };
    assert_eq!(to, "newcomer@mail.example.test");
    assert_eq!(url, &format!("{ORIGIN}/?welcome=newcomer@wk"));
    assert!(!url.contains("evil"));
    let (subject, body) = napkin_web::mail::render(&out[0]);
    for marker in ["Client A", "J001", "brief", "Newcomer"] {
        assert!(
            !subject.contains(marker) && !body.contains(marker),
            "{marker} in the mail"
        );
    }
    // the address is the store's own field and is written nowhere else: not the change log, not the audit chain
    let log = std::fs::read_to_string(r.dir.path().join("_people").join("changes.jsonl")).unwrap();
    let invited: Vec<&str> = log.lines().filter(|l| l.contains("first day")).collect();
    assert!(!invited.is_empty());
    assert!(
        invited.iter().all(|l| !l.contains("mail.example.test")),
        "{invited:?}"
    );
    let (_, audit, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/audit", maeve.tenant),
        Some(&maeve.cookie),
        None,
    )
    .await;
    let first_day_lines: Vec<String> = audit["lines"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l.to_string())
        .filter(|l| l.to_lowercase().contains("first day"))
        .collect();
    assert!(!first_day_lines.is_empty());
    assert!(first_day_lines
        .iter()
        .all(|l| !l.contains("mail.example.test")));
    let marks = std::fs::read_to_string(r.dir.path().join("_people").join("first-day-marks.json"))
        .unwrap_or_default();
    assert!(!marks.contains("mail.example.test"));
}

#[tokio::test]
async fn one_invite_mail_a_person_a_day_and_a_plain_line_when_it_is_refused() {
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    set_email(&r, &maeve, "newcomer@wk", "newcomer@mail.example.test").await;
    let mut last = Value::Null;
    for i in 0..10 {
        let (st, v) = invite(&r, &maeve, "newcomer@wk", json!({ "mail": true })).await;
        assert_eq!(st, StatusCode::CREATED, "{v}");
        assert_eq!(v["mailed"], json!(i == 0), "{i}: {v}");
        last = v;
    }
    assert_eq!(r.mail.outbox().len(), 1);
    assert!(last["note"].as_str().unwrap().contains("already"), "{last}");
    // another person is mailed on their own count
    add(&r, &maeve, "plain@wk", "Plain Test", &["copywriter"]).await;
    set_email(&r, &maeve, "plain@wk", "plain@mail.example.test").await;
    invite(&r, &maeve, "plain@wk", json!({ "mail": true })).await;
    assert_eq!(r.mail.outbox().len(), 2);
}

#[tokio::test]
async fn no_mail_without_a_stored_address_a_public_origin_or_a_mailer_and_the_answer_says_why() {
    // no address held for the person
    let r = rig();
    let maeve = sign_in(&r, "maeve@wk").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    let (_, v) = invite(&r, &maeve, "newcomer@wk", json!({ "mail": true })).await;
    assert_eq!(v["mailed"], json!(false));
    assert!(v["note"].as_str().unwrap().contains("address"), "{v}");
    assert!(
        v["link"].as_str().unwrap().contains("welcome=newcomer@wk"),
        "the link is still given to copy"
    );
    // no public origin configured
    let r = build(ROSTER, None, true);
    let maeve = sign_in(&r, "maeve@wk").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    set_email(&r, &maeve, "newcomer@wk", "newcomer@mail.example.test").await;
    let (st, v) = invite(&r, &maeve, "newcomer@wk", json!({ "mail": true })).await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    assert_eq!(v["mailed"], json!(false));
    assert!(
        v["note"].as_str().unwrap().contains("public address"),
        "{v}"
    );
    assert!(r.mail.outbox().is_empty());
    // mail off
    let r = build(ROSTER, Some(ORIGIN), false);
    let maeve = sign_in(&r, "maeve@wk").await;
    add(&r, &maeve, "newcomer@wk", "Newcomer Test", &["copywriter"]).await;
    set_email(&r, &maeve, "newcomer@wk", "newcomer@mail.example.test").await;
    let (_, v) = invite(&r, &maeve, "newcomer@wk", json!({ "mail": true })).await;
    assert_eq!(v["mailed"], json!(false));
    assert!(v["note"].as_str().unwrap().contains("Mail"), "{v}");
    // and without asking for mail there is no note
    let (_, v) = invite(&r, &maeve, "newcomer@wk", json!({})).await;
    assert!(v.get("note").is_none());
}

#[test]
fn the_development_outbox_keeps_no_address_of_an_invite() {
    use napkin_web::mail::{Mailer, Outbox};
    let dir = tempfile::tempdir().unwrap();
    let out = Outbox(dir.path().join("outbox.jsonl"));
    out.send(&Message::Invite {
        to: "newcomer@mail.example.test".into(),
        agency: None,
        url: "https://studio.example.test/?welcome=a@wk".into(),
    })
    .unwrap();
    let text = std::fs::read_to_string(dir.path().join("outbox.jsonl")).unwrap();
    assert!(text.contains("welcome=a@wk"));
    assert!(!text.contains("mail.example.test"), "{text}");
}

/// A Napkin admin learns nothing of another agency's documents from the invite route.
#[tokio::test]
async fn a_napkin_admin_learns_nothing_of_another_agencys_documents() {
    let r = build(
        &format!("{ROSTER}engineer@napkin\tEngineer\tadmin\n"),
        Some(ORIGIN),
        true,
    );
    let barra = sign_in(&r, "barra@bq").await;
    live_job(&r, &barra).await;
    let eng = sign_in(&r, "engineer@napkin").await;
    let (miss, a) = invite(
        &r,
        &eng,
        "niamh@bq",
        json!({ "first": { "path": "doc-nope" } }),
    )
    .await;
    let (hit, b) = invite(
        &r,
        &eng,
        "niamh@bq",
        json!({ "first": { "path": "doc-b1" } }),
    )
    .await;
    assert_eq!(miss, hit, "{a} / {b}");
    assert_eq!(a, b);
    // they can still invite without naming a document
    let (st, v) = invite(&r, &eng, "niamh@bq", json!({})).await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
}
