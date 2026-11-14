// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/align-needs-lock-people.clan, stage 3, through the real router: one store of who may sign in
//! and with which roles (people.rs's). An agency's admin manages only their own agency and a Napkin admin
//! manages all; every people route takes its agency from the session, and a foreign agency in the path or
//! the body is refused with the answer a missing one gets. A role comes from the People store on every
//! request, never from the cookie, a document's token or the identity provider, so a demotion or a removal
//! holds on the next request. No People response scores a person.

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

/// Two agencies with an admin each, a Napkin admin, and people with roles. `wk` is a roster-only agency
/// (no directory ever existed for it).
const ROSTER: &str = "engineer@napkin\tEng\tadmin\n\
ad@wk\tAd\tadmin\n\
aoife@wk\tAoife\tplanning\n\
cian@wk\tCian\taccount-service\n\
sam@wk\tSam\n\
barra@bq\tBarra\tadmin\n\
bria@bq\tBria\tplanning\n";

const KEY: [u8; 32] = [9u8; 32];

struct Rig {
    dir: tempfile::TempDir,
    app: Router,
    ctx: Arc<AppCtx>,
}

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
                napkin_web::auth::Roster::open(dir.path().join("_people"), &roster).unwrap(),
            ),
            sessions: napkin_web::auth::Sessions::new(&KEY).unwrap(),
        },
        secure: false,
    };
    Rig {
        app: napkin_web::router_with(ctx.clone(), None, Arc::new(identity)),
        dir,
        ctx,
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

async fn csv(r: &Rig, uri: &str, cookie: &str, text: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, "text/csv")
        .body(Body::from(text.to_string()))
        .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

struct Who {
    cookie: String,
    tenant: String,
}

async fn sign_in(r: &Rig, username: &str) -> Who {
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/sign-in")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "username": username }).to_string()))
        .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "{username} signs in");
    let cookie = resp
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("napkin_session=") && !v.starts_with("napkin_session=;"))
        .map(|v| v.split(';').next().unwrap().to_string())
        .unwrap();
    let (_, me) = call(r, "GET", "/api/session", Some(&cookie), None).await;
    Who {
        cookie,
        tenant: me["tenant"].as_str().unwrap().to_string(),
    }
}

async fn doors(r: &Rig, w: &Who) -> (StatusCode, Value) {
    call(
        r,
        "GET",
        &format!("/api/t/{}/doors", w.tenant),
        Some(&w.cookie),
        None,
    )
    .await
}

fn usernames(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|p| {
            p["id"]
                .as_str()
                .or(p["username"].as_str())
                .unwrap()
                .to_string()
        })
        .collect()
}

// ── line 10: one store, the change line, the last admin ─────────────────────

#[tokio::test]
async fn the_roster_seeds_roles_into_the_store_and_sign_in_reads_them_from_there() {
    let r = rig();
    let book: Value =
        serde_json::from_slice(&std::fs::read(r.dir.path().join("_people/people.json")).unwrap())
            .unwrap();
    let aoife = book["people"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "aoife@wk")
        .unwrap()
        .clone();
    assert_eq!(aoife["roles"], json!(["planning"]));
    // the roster file is only the seed: once the store holds the roles, editing the file changes nothing
    std::fs::write(
        r.dir.path().join("accounts.tsv"),
        ROSTER.replace("aoife@wk\tAoife\tplanning", "aoife@wk\tAoife\tadmin"),
    )
    .unwrap();
    let a = sign_in(&r, "aoife@wk").await;
    let (_, me) = call(&r, "GET", "/api/session", Some(&a.cookie), None).await;
    assert_eq!(me["roles"], json!(["planning"]), "{me}");
    assert_eq!(
        call(
            &r,
            "GET",
            &format!("/api/t/{}/audit", a.tenant),
            Some(&a.cookie),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn a_role_change_holds_on_the_next_request_and_is_one_change_line_and_one_audit_line() {
    let r = rig();
    let ad = sign_in(&r, "ad@wk").await;
    let aoife = sign_in(&r, "aoife@wk").await;
    let pages = |v: &Value| -> Vec<String> {
        v["pages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["name"].as_str().unwrap().to_string())
            .collect()
    };
    assert!(!pages(&doors(&r, &aoife).await.1).contains(&"Traffic board".to_string()));
    let (st, v) = call(
        &r,
        "PUT",
        "/api/admin/people/aoife@wk/roles",
        Some(&ad.cookie),
        Some(json!({ "roles": ["traffic"] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(v["roles"], json!(["traffic"]));
    // the same cookie, the next request: the new role
    assert!(pages(&doors(&r, &aoife).await.1).contains(&"Traffic board".to_string()));
    // one line on changes.jsonl: when, who, what, before, after
    let log = std::fs::read_to_string(r.dir.path().join("_people/changes.jsonl")).unwrap();
    let last: Value = serde_json::from_str(log.lines().last().unwrap()).unwrap();
    assert!(last["at"].is_string(), "{last}");
    assert_eq!(last["by"], "ad@wk");
    assert_eq!(last["what"], "roles changed");
    assert_eq!(last["person"], "aoife@wk");
    assert_eq!(last["before"]["roles"], json!(["planning"]));
    assert_eq!(last["after"]["roles"], json!(["traffic"]));
    // one entry on the agency's audit chain, by the admin, and the chain holds
    let (_, view) = call(
        &r,
        "GET",
        &format!("/api/t/{}/audit?kind=permission", ad.tenant),
        Some(&ad.cookie),
        None,
    )
    .await;
    let lines: Vec<&Value> = view["lines"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|l| l["who"] == "ad@wk" && l["what"].as_str().unwrap().contains("traffic"))
        .collect();
    assert_eq!(lines.len(), 1, "{view}");
    let (st, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/audit/verify", ad.tenant),
        Some(&ad.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn the_last_admin_of_an_agency_cannot_be_removed_or_demoted() {
    let r = rig();
    let eng = sign_in(&r, "engineer@napkin").await;
    let ad = sign_in(&r, "ad@wk").await;
    for who in [&eng, &ad] {
        let (st, v) = call(
            &r,
            "DELETE",
            "/api/admin/people/ad@wk",
            Some(&who.cookie),
            None,
        )
        .await;
        assert_eq!(st, StatusCode::CONFLICT, "{v}");
        let (st, v) = call(
            &r,
            "PUT",
            "/api/admin/people/ad@wk/roles",
            Some(&who.cookie),
            Some(json!({ "roles": ["planning"] })),
        )
        .await;
        assert_eq!(st, StatusCode::CONFLICT, "{v}");
    }
    // the build's route says the same
    let (st, _) = call(
        &r,
        "DELETE",
        &format!("/api/t/{}/agency/people/ad@wk", ad.tenant),
        Some(&ad.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    // with a second admin, the first may go
    let (st, _) = call(
        &r,
        "PUT",
        "/api/admin/people/cian@wk/roles",
        Some(&ad.cookie),
        Some(json!({ "roles": ["account-service", "admin"] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(
        &r,
        "DELETE",
        "/api/admin/people/ad@wk",
        Some(&eng.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn a_role_not_in_the_table_is_refused() {
    let r = rig();
    let ad = sign_in(&r, "ad@wk").await;
    for bad in [json!(["wizard"]), json!(["demo"])] {
        let (st, _) = call(
            &r,
            "PUT",
            "/api/admin/people/aoife@wk/roles",
            Some(&ad.cookie),
            Some(json!({ "roles": bad })),
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{bad}");
    }
}

// ── stale roles: the cookie, the token, the identity provider ───────────────

#[tokio::test]
async fn a_cookie_that_claims_a_role_the_store_does_not_give_opens_nothing_more() {
    let r = rig();
    let aoife = sign_in(&r, "aoife@wk").await;
    // a session signed with the server's own key, claiming admin: the store says planning
    let forged = napkin_web::auth::Sessions::new(&KEY)
        .unwrap()
        .issue(&napkin_web::auth::Account {
            username: "aoife@wk".into(),
            agency: "wk".into(),
            name: None,
            roles: vec!["admin".into()],
        });
    let cookie = format!("napkin_session={forged}");
    let (_, me) = call(&r, "GET", "/api/session", Some(&cookie), None).await;
    assert_eq!(me["roles"], json!(["planning"]), "{me}");
    for uri in [
        format!("/api/t/{}/audit", aoife.tenant),
        "/api/admin/people".to_string(),
    ] {
        let (st, _) = call(&r, "GET", &uri, Some(&cookie), None).await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{uri}");
    }
    // a person with no roles in the store is not made one by the cookie either
    let sam = napkin_web::auth::Sessions::new(&KEY)
        .unwrap()
        .issue(&napkin_web::auth::Account {
            username: "sam@wk".into(),
            agency: "wk".into(),
            name: None,
            roles: vec!["admin".into()],
        });
    let (_, me) = call(
        &r,
        "GET",
        "/api/session",
        Some(&format!("napkin_session={sam}")),
        None,
    )
    .await;
    assert_eq!(me["roles"], json!([]), "{me}");
}

#[tokio::test]
async fn a_removed_person_is_signed_out_and_their_document_token_stops_working() {
    let r = rig();
    let ad = sign_in(&r, "ad@wk").await;
    let aoife = sign_in(&r, "aoife@wk").await;
    let t = aoife.tenant.clone();
    let clan = clan_sdk::create(clan_sdk::CreateOptions {
        title: "A brief".into(),
        brief: "test brief".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/t/{t}/documents/upload"))
        .header(header::COOKIE, &aoife.cookie)
        .body(Body::from(clan))
        .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let doc: Value =
        serde_json::from_slice(&resp.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let token = doc["token"].as_str().expect("a token").to_string();
    assert_eq!(
        call(&r, "GET", &format!("/s/{token}/decisions"), None, None)
            .await
            .0,
        StatusCode::OK
    );
    let (st, _) = call(
        &r,
        "DELETE",
        "/api/admin/people/aoife@wk",
        Some(&ad.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    // the next request: signed out, and the token minted before the removal is refused
    assert_eq!(doors(&r, &aoife).await.0, StatusCode::UNAUTHORIZED);
    let (st, _) = call(&r, "GET", &format!("/s/{token}/decisions"), None, None).await;
    assert!(
        st == StatusCode::UNAUTHORIZED || st == StatusCode::FORBIDDEN || st == StatusCode::GONE,
        "a removed person's token still answers: {st}"
    );
    let (st, _) = call(&r, "GET", &format!("/s/{token}/document"), None, None).await;
    assert!(
        st == StatusCode::UNAUTHORIZED || st == StatusCode::FORBIDDEN || st == StatusCode::GONE,
        "a removed person's token still opens the page: {st}"
    );
}

#[test]
fn a_document_token_carries_no_roles() {
    // a grant names the tenant, the person and the document; roles are read from the People store
    let store = napkin_web::tokens::TokenStore::default();
    let t = TenantId::of_agency("wk");
    let tok = store.mint(&t, "aoife@wk", &napkin_host::DocId::new("doc-x"));
    let g = store.resolve(&tok).unwrap();
    assert_eq!(g.person, "aoife@wk");
}

// ── line 9: scope from the session; a foreign agency reveals nothing ────────

#[tokio::test]
async fn an_agency_admin_lists_and_manages_only_their_own_agency() {
    let r = rig();
    let ad = sign_in(&r, "ad@wk").await;
    let (st, v) = call(&r, "GET", "/api/admin/people", Some(&ad.cookie), None).await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let ids = usernames(&v["people"]);
    assert!(ids.iter().all(|u| u.ends_with("@wk")), "{ids:?}");
    assert!(ids.contains(&"aoife@wk".to_string()));
    let text = v.to_string();
    for foreign in ["@bq", "@napkin", "Barra", "Bria"] {
        assert!(
            !text.contains(foreign),
            "{foreign} in an agency admin's list: {text}"
        );
    }
    // the agencies list holds only their own
    let (st, v) = call(&r, "GET", "/api/admin/agencies", Some(&ad.cookie), None).await;
    assert_eq!(st, StatusCode::OK);
    assert!(v.as_array().unwrap().iter().all(|a| a["id"] == "wk"), "{v}");
    // adds a person to their own agency, with roles
    let (st, p) = call(
        &r,
        "POST",
        "/api/admin/people",
        Some(&ad.cookie),
        Some(json!({ "name": "Dara Test", "roles": ["creative-director"] })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{p}");
    assert_eq!(p["id"], "dara@wk");
    assert_eq!(p["roles"], json!(["creative-director"]));
    // a Napkin admin lists everyone
    let eng = sign_in(&r, "engineer@napkin").await;
    let (_, v) = call(&r, "GET", "/api/admin/people", Some(&eng.cookie), None).await;
    let ids = usernames(&v["people"]);
    assert!(ids.contains(&"bria@bq".to_string()) && ids.contains(&"aoife@wk".to_string()));
}

#[tokio::test]
async fn only_a_napkin_admin_adds_an_agency() {
    let r = rig();
    let ad = sign_in(&r, "ad@wk").await;
    let body = json!({ "name": "Rothco", "base": "#0F6B5C", "accent": "#9FE6D8" });
    let (st, _) = call(
        &r,
        "POST",
        "/api/admin/agencies",
        Some(&ad.cookie),
        Some(body.clone()),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let eng = sign_in(&r, "engineer@napkin").await;
    let (st, _) = call(
        &r,
        "POST",
        "/api/admin/agencies",
        Some(&eng.cookie),
        Some(body),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
}

/// The answer for `foreign` (a person or agency that exists, in another agency) and for `missing` (one that
/// does not exist) must be the same, the name aside: no "exists" oracle.
fn same_answer(a: &(StatusCode, Value), b: &(StatusCode, Value), foreign: &str, missing: &str) {
    assert_eq!(a.0, b.0, "{} vs {}", a.1, b.1);
    assert!(
        !a.0.is_success(),
        "a foreign agency was served: {} {}",
        a.0,
        a.1
    );
    let norm = |v: &Value, id: &str| v.to_string().replace(id, "ID");
    assert_eq!(norm(&a.1, foreign), norm(&b.1, missing));
}

#[tokio::test]
async fn every_people_route_refuses_a_foreign_agency_in_the_path_as_if_it_did_not_exist() {
    let r = rig();
    let barra = sign_in(&r, "barra@bq").await;
    let c = Some(barra.cookie.as_str());
    let pairs = [("aoife@wk", "nobody@wk"), ("ad@wk", "ghost@zz")];
    for (foreign, missing) in pairs {
        for (m, uri, body) in [
            (
                "PATCH",
                "/api/admin/people/{}",
                Some(json!({ "name": "X" })),
            ),
            ("DELETE", "/api/admin/people/{}", None),
            (
                "PUT",
                "/api/admin/people/{}/roles",
                Some(json!({ "roles": ["traffic"] })),
            ),
        ] {
            let a = call(&r, m, &uri.replace("{}", foreign), c, body.clone()).await;
            let b = call(&r, m, &uri.replace("{}", missing), c, body.clone()).await;
            same_answer(&a, &b, foreign, missing);
        }
        // the build's routes: a sign-in name of another agency, in the path
        for (m, body) in [
            ("PUT", Some(json!({ "roles": ["traffic"] }))),
            ("DELETE", None),
        ] {
            let uri = |u: &str| format!("/api/t/{}/agency/people/{u}", barra.tenant);
            let a = call(&r, m, &uri(foreign), c, body.clone()).await;
            let b = call(&r, m, &uri(missing), c, body.clone()).await;
            same_answer(&a, &b, foreign, missing);
        }
    }
    // an agency id of another agency, in the path
    for (m, tail, body) in [
        ("PATCH", "draft", Some(json!({ "name": "X", "rev": 0 }))),
        ("DELETE", "draft", None),
        ("POST", "publish", Some(json!({ "rev": 0 }))),
        ("DELETE", "name", None),
        ("GET", "export", None),
        ("DELETE", "draft/wordmark", None),
    ] {
        let a = call(
            &r,
            m,
            &format!("/api/admin/agencies/wk/{tail}"),
            c,
            body.clone(),
        )
        .await;
        let b = call(
            &r,
            m,
            &format!("/api/admin/agencies/zzq/{tail}"),
            c,
            body.clone(),
        )
        .await;
        same_answer(&a, &b, "wk", "zzq");
    }
    // another agency's tenant in the path: refused before anything is read
    let wk = TenantId::of_agency("wk");
    let missing = TenantId::of_agency("nowhere");
    for (m, tail, body) in [
        ("GET", "agency/people", None),
        (
            "POST",
            "agency/people/invite",
            Some(json!({ "email": "x@x.test", "name": "X", "roles": ["planning"] })),
        ),
        (
            "PUT",
            "agency/people/aoife@wk",
            Some(json!({ "roles": ["traffic"] })),
        ),
        ("DELETE", "agency/people/aoife@wk", None),
        ("GET", "agency/accounts.tsv", None),
        ("GET", "setup", None),
    ] {
        let a = call(&r, m, &format!("/api/t/{wk}/{tail}"), c, body.clone()).await;
        let b = call(&r, m, &format!("/api/t/{missing}/{tail}"), c, body.clone()).await;
        same_answer(&a, &b, wk.as_str(), missing.as_str());
    }
    let a = csv(
        &r,
        &format!("/api/t/{wk}/setup/import/people"),
        &barra.cookie,
        "email,name,roles\nx@wk,X,planning\n",
    )
    .await;
    let b = csv(
        &r,
        &format!("/api/t/{missing}/setup/import/people"),
        &barra.cookie,
        "email,name,roles\nx@wk,X,planning\n",
    )
    .await;
    same_answer(&a, &b, wk.as_str(), missing.as_str());
    // and nothing of wk changed
    let ad = sign_in(&r, "ad@wk").await;
    let (_, v) = call(&r, "GET", "/api/admin/people", Some(&ad.cookie), None).await;
    let aoife = v["people"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "aoife@wk")
        .unwrap()
        .clone();
    assert_eq!(aoife["roles"], json!(["planning"]));
    assert_eq!(aoife["name"], "Aoife");
    assert!(aoife["removed_at"].is_null());
}

#[tokio::test]
async fn every_people_route_refuses_a_foreign_agency_in_the_body_as_if_it_did_not_exist() {
    let r = rig();
    let barra = sign_in(&r, "barra@bq").await;
    let c = Some(barra.cookie.as_str());
    // adding a person to another agency, by agency name or by sign-in name
    let a = call(
        &r,
        "POST",
        "/api/admin/people",
        c,
        Some(json!({ "name": "X Y", "agency": "wk" })),
    )
    .await;
    let b = call(
        &r,
        "POST",
        "/api/admin/people",
        c,
        Some(json!({ "name": "X Y", "agency": "zzq" })),
    )
    .await;
    same_answer(&a, &b, "wk", "zzq");
    let a = call(
        &r,
        "POST",
        "/api/admin/people",
        c,
        Some(json!({ "name": "X Y", "username": "xy@wk" })),
    )
    .await;
    let b = call(
        &r,
        "POST",
        "/api/admin/people",
        c,
        Some(json!({ "name": "X Y", "username": "xy@zzq" })),
    )
    .await;
    same_answer(&a, &b, "wk", "zzq");
    // the build's invite: a sign-in name at another agency
    let inv = |u: &str| json!({ "username": u, "email": "x@mail.example.test", "name": "X", "roles": ["planning"] });
    let uri = format!("/api/t/{}/agency/people/invite", barra.tenant);
    let a = call(&r, "POST", &uri, c, Some(inv("aoife@wk"))).await;
    let b = call(&r, "POST", &uri, c, Some(inv("aoife@zzq"))).await;
    same_answer(&a, &b, "wk", "zzq");
    // a CSV row naming a person of another agency joins the importer's own agency, never the other
    let (st, rep) = csv(
        &r,
        &format!("/api/t/{}/setup/import/people", barra.tenant),
        &barra.cookie,
        "username,email,name,roles\naoife@wk,aoife@wk,Aoife Bq,traffic\n",
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{rep}");
    let (_, v) = call(&r, "GET", "/api/admin/people", c, None).await;
    assert!(usernames(&v["people"]).contains(&"aoife@bq".to_string()));
    let ad = sign_in(&r, "ad@wk").await;
    let (_, v) = call(&r, "GET", "/api/admin/people", Some(&ad.cookie), None).await;
    let aoife = v["people"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "aoife@wk")
        .unwrap()
        .clone();
    assert_eq!(aoife["roles"], json!(["planning"]), "wk's aoife untouched");
    assert_eq!(aoife["name"], "Aoife");
}

#[tokio::test]
async fn people_routes_are_for_admins_only() {
    let r = rig();
    let aoife = sign_in(&r, "aoife@wk").await;
    let sam = sign_in(&r, "sam@wk").await; // no role at all: unrestricted elsewhere, never an admin
    for w in [&aoife, &sam] {
        for (m, uri, body) in [
            ("GET", "/api/admin/people".to_string(), None),
            (
                "POST",
                "/api/admin/people".to_string(),
                Some(json!({ "name": "X Y" })),
            ),
            (
                "PUT",
                "/api/admin/people/cian@wk/roles".to_string(),
                Some(json!({ "roles": ["traffic"] })),
            ),
            ("DELETE", "/api/admin/people/cian@wk".to_string(), None),
            (
                "PUT",
                format!("/api/t/{}/agency/people/cian@wk", w.tenant),
                Some(json!({ "roles": ["traffic"] })),
            ),
        ] {
            let (st, _) = call(&r, m, &uri, Some(&w.cookie), body).await;
            assert_eq!(st, StatusCode::FORBIDDEN, "{m} {uri}");
        }
    }
}

// ── line 11: nothing scores a person ────────────────────────────────────────

/// What a person row in any People response may hold: an allow list.
const PERSON_KEYS: &[&str] = &[
    "id",
    "username",
    "name",
    "agency",
    "admin",
    "roles",
    "email",
    "state",
    "added_by",
    "added_at",
    "invited_by",
    "at",
    "removed_at",
];

fn person_rows(v: &Value) -> Vec<&serde_json::Map<String, Value>> {
    let list = v
        .get("people")
        .and_then(Value::as_array)
        .or(v.as_array())
        .unwrap();
    list.iter().filter_map(Value::as_object).collect()
}

#[tokio::test]
async fn no_people_response_scores_a_person() {
    let r = rig();
    let ad = sign_in(&r, "ad@wk").await;
    let eng = sign_in(&r, "engineer@napkin").await;
    let mut seen = Vec::new();
    for (who, uri) in [
        (&ad, "/api/admin/people".to_string()),
        (&eng, "/api/admin/people".to_string()),
        (&ad, format!("/api/t/{}/agency/people", ad.tenant)),
        (&eng, format!("/api/t/{}/agency/people", eng.tenant)),
    ] {
        let (st, v) = call(&r, "GET", &uri, Some(&who.cookie), None).await;
        assert_eq!(st, StatusCode::OK, "{uri}");
        for row in person_rows(&v) {
            for k in row.keys() {
                assert!(PERSON_KEYS.contains(&k.as_str()), "{uri}: {k} on a person");
            }
        }
        seen.push(v);
    }
    let (_, p) = call(
        &r,
        "PUT",
        "/api/admin/people/aoife@wk/roles",
        Some(&ad.cookie),
        Some(json!({ "roles": ["traffic"] })),
    )
    .await;
    for k in p.as_object().unwrap().keys() {
        assert!(PERSON_KEYS.contains(&k.as_str()), "PUT roles: {k}");
    }
    // the agencies' rows count people per agency, never anything per person
    for v in &seen {
        if let Some(ags) = v.get("agencies").and_then(Value::as_array) {
            for a in ags {
                for k in a.as_object().unwrap().keys() {
                    assert!(
                        !["items", "aside", "late", "score", "count_by_person", "done"]
                            .contains(&k.as_str()),
                        "{k}"
                    );
                }
            }
        }
    }
}

// ── after the security review: empty roles, a change with no line, Cognito, the event stream ──

#[tokio::test]
async fn an_empty_role_list_grants_nothing_and_is_refused() {
    let r = rig();
    let ad = sign_in(&r, "ad@wk").await;
    let (st, _) = call(
        &r,
        "PUT",
        "/api/admin/people/aoife@wk/roles",
        Some(&ad.cookie),
        Some(json!({ "roles": [] })),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::BAD_REQUEST,
        "the build's route refuses the same"
    );
    // a person the store holds with no role (sam, from a roster line with none) opens no role's routes
    let sam = sign_in(&r, "sam@wk").await;
    for route in [
        "time-money",
        "dashboard",
        "jobs/J001/scope",
        "client-brains",
    ] {
        let (st, _) = call(
            &r,
            "GET",
            &format!("/api/t/{}/{route}", sam.tenant),
            Some(&sam.cookie),
            None,
        )
        .await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{route}");
    }
    let (_, d) = doors(&r, &sam).await;
    assert_eq!(d["restricted"], json!(true), "{d}");
    assert_eq!(d["tools"], json!([]), "{d}");
    assert_eq!(d["jobs"]["manage"], json!(false), "{d}");
}

#[tokio::test]
async fn a_change_that_cannot_be_recorded_does_not_happen() {
    let r = rig();
    let ad = sign_in(&r, "ad@wk").await;
    let log = r.dir.path().join("_people").join("changes.jsonl");
    let _ = std::fs::remove_file(&log);
    std::fs::create_dir_all(&log).unwrap(); // the change log cannot be appended to
    let (st, _) = call(
        &r,
        "PUT",
        "/api/admin/people/aoife@wk/roles",
        Some(&ad.cookie),
        Some(json!({ "roles": ["admin"] })),
    )
    .await;
    assert!(!st.is_success(), "{st}");
    assert_eq!(
        r.ctx.people().unwrap().active("aoife@wk").unwrap().roles,
        ["planning"]
    );
}

#[tokio::test]
async fn the_people_routes_use_the_store_under_cognito() {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Arc::new(AppCtx::new(
        dir.path().to_path_buf(),
        Arc::new(NoConfig),
        None,
        40,
    ));
    let roster = dir.path().join("accounts.tsv");
    std::fs::write(&roster, ROSTER).unwrap();
    let people = napkin_web::people::People::open_if_any(dir.path().join("_people"), Some(&roster))
        .unwrap()
        .unwrap();
    ctx.set_people(Arc::new(people));
    let sessions = napkin_web::auth::Sessions::new(&KEY).unwrap();
    let cookie_of = |u: &str| {
        let (username, agency) = napkin_web::auth::Account::parse_username(u).unwrap();
        format!(
            "napkin_session={}",
            sessions.issue(&napkin_web::auth::Account {
                username,
                agency,
                name: None,
                roles: Vec::new(),
            })
        )
    };
    let identity = napkin_web::tenant::Identity {
        mode: napkin_web::tenant::Mode::Accounts {
            provider: napkin_web::auth::Provider::Cognito(napkin_web::auth::Cognito::new(
                "eu-west-1",
                "client",
            )),
            sessions: napkin_web::auth::Sessions::new(&KEY).unwrap(),
        },
        secure: false,
    };
    let r = Rig {
        app: napkin_web::router_with(ctx.clone(), None, Arc::new(identity)),
        dir,
        ctx,
    };
    let (eng, ad) = (cookie_of("engineer@napkin"), cookie_of("ad@wk"));
    let (st, v) = call(&r, "GET", "/api/admin/people", Some(&eng), None).await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let (st, v) = call(
        &r,
        "PUT",
        "/api/admin/people/aoife@wk/roles",
        Some(&ad),
        Some(json!({ "roles": ["traffic"] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let (st, v) = call(&r, "DELETE", "/api/admin/people/cian@wk", Some(&eng), None).await;
    assert_eq!(st, StatusCode::OK, "{v}");
    let (st, _) = call(&r, "GET", "/api/agency-looks", None, None).await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn a_removed_persons_event_stream_ends_at_the_next_event() {
    let r = rig();
    let ad = sign_in(&r, "ad@wk").await;
    let aoife = sign_in(&r, "aoife@wk").await;
    let req = Request::builder()
        .uri(format!("/api/t/{}/events", aoife.tenant))
        .header(header::COOKIE, &aoife.cookie)
        .body(Body::empty())
        .unwrap();
    let resp = r.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let mut body = resp.into_body();
    let tenant = TenantId::of_agency("wk");
    // first, an event reaches her
    r.ctx
        .events
        .publish(&tenant, &napkin_host::HostEvent::TitleChanged("one".into()));
    let first = tokio::time::timeout(std::time::Duration::from_secs(5), body.frame())
        .await
        .expect("an event")
        .expect("a frame")
        .unwrap();
    assert!(String::from_utf8_lossy(first.data_ref().unwrap()).contains("one"));
    let (st, _) = call(
        &r,
        "DELETE",
        "/api/admin/people/aoife@wk",
        Some(&ad.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    r.ctx
        .events
        .publish(&tenant, &napkin_host::HostEvent::TitleChanged("two".into()));
    let next = tokio::time::timeout(std::time::Duration::from_secs(5), body.frame())
        .await
        .expect("the stream answers");
    let leaked = next
        .and_then(|f| f.ok())
        .and_then(|f| f.into_data().ok())
        .is_some_and(|d| String::from_utf8_lossy(&d).contains("two"));
    assert!(
        !leaked,
        "a removed person still receives the agency's events"
    );
}

#[tokio::test]
async fn adding_a_person_with_no_role_is_refused_as_a_role_change_to_none_is() {
    let r = rig();
    for who in ["ad@wk", "engineer@napkin"] {
        let w = sign_in(&r, who).await;
        let (st, v) = call(
            &r,
            "POST",
            "/api/admin/people",
            Some(&w.cookie),
            Some(json!({ "name": "Nora Test", "agency": "wk" })),
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{who}: {v}");
        let (st, _) = call(
            &r,
            "POST",
            "/api/admin/people",
            Some(&w.cookie),
            Some(json!({ "name": "Nora Test", "agency": "wk", "roles": [] })),
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{who}");
    }
    assert!(r.ctx.people().unwrap().active("nora@wk").is_none());
}

#[test]
fn a_change_recorded_but_never_written_is_marked_not_applied_at_the_next_start() {
    let dir = tempfile::tempdir().unwrap();
    let roster = dir.path().join("accounts.tsv");
    std::fs::write(&roster, ROSTER).unwrap();
    let people = napkin_web::people::People::open(dir.path().join("_people"), &roster).unwrap();
    // a server stopped after recording aoife's change and before writing people.json
    let line = json!({ "at": "2026-11-14T10:00:00Z", "by": "ad@wk", "what": "roles changed",
        "person": "aoife@wk", "agency": "wk",
        "before": { "name": "Aoife", "roles": ["planning"], "removed_at": null },
        "after": { "name": "Aoife", "roles": ["admin"], "removed_at": null } });
    std::fs::write(
        dir.path().join("_people/changes.jsonl"),
        format!(
            "{}{line}\n",
            std::fs::read_to_string(dir.path().join("_people/changes.jsonl")).unwrap_or_default()
        ),
    )
    .unwrap();
    let ctx = AppCtx::new(dir.path().to_path_buf(), Arc::new(NoConfig), None, 40);
    ctx.set_people(Arc::new(people));
    let log = std::fs::read_to_string(dir.path().join("_people/changes.jsonl")).unwrap();
    let last: Value = serde_json::from_str(log.lines().last().unwrap()).unwrap();
    assert_eq!(last["what"], "not applied", "{log}");
    assert_eq!(last["was"], "roles changed");
    assert_eq!(last["person"], "aoife@wk");
    let audit = std::fs::read_to_string(
        dir.path()
            .join(TenantId::of_agency("wk").as_str())
            .join("audit.jsonl"),
    )
    .unwrap();
    assert!(audit.contains("Not applied:"), "{audit}");
    // a second start finds nothing to mark
    let again = napkin_web::people::People::open(dir.path().join("_people"), &roster).unwrap();
    assert_eq!(again.reconcile(), 0);
}
