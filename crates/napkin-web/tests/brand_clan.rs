// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Brand Clan's HTTP routes (docs/contracts/brand-clan.md section 5) on the real router.

mod support;

use axum::http::StatusCode;
use clan_sdk::{AppInfo, ClanFile, CreateOptions, MakeTemplateOptions};
use serde_json::{json, Value};
use support::server::*;

fn root() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A server whose seed also holds the real Brand Clan schema.
fn brand_server() -> Server {
    let dir = tempfile::tempdir().unwrap();
    let seed = dir.path().join("seed");
    std::fs::create_dir_all(&seed).unwrap();
    let schema =
        std::fs::read_to_string(root().join("app/templates/brand-clan/schema.json")).unwrap();
    let base = clan_sdk::create(CreateOptions {
        title: "Brand Clan".into(),
        brief: "test".into(),
        document_type: None,
        no_render: false,
        schema: Some(schema),
    })
    .unwrap();
    let app = clan_sdk::make_template(
        &ClanFile::from_bytes(base).unwrap(),
        AppInfo {
            home: None,
            name: "Brand Clan".into(),
            app_id: "ie.napkin.brand".into(),
            version: "1.0.0".into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: None,
            prompt_templates: vec![],
            data_seed: None,
            spinoff: None,
            attach: None,
        },
        MakeTemplateOptions::default(),
    )
    .unwrap();
    std::fs::write(seed.join("brand.app.clan"), app).unwrap();
    server_in(dir, None)
}

fn bible() -> Value {
    let mut v: Value = serde_json::from_str(
        &std::fs::read_to_string(
            root().join("docs/contracts/examples/brand-clan/data.zero-v2.json"),
        )
        .unwrap(),
    )
    .unwrap();
    v.as_object_mut().unwrap().remove("kit");
    v
}

fn ok(r: &Reply) -> Value {
    assert!(
        r.status.is_success(),
        "{} {}",
        r.status,
        String::from_utf8_lossy(&r.body)
    );
    r.json()
}

#[tokio::test]
async fn make_edit_publish_default_and_history_over_http() {
    let s = brand_server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let client = ok(&me
        .json(&s, "POST", "/clients", json!({"name": "Tidewell"}))
        .await)["id"]
        .as_str()
        .unwrap()
        .to_string();
    let made = me
        .json(
            &s,
            "POST",
            &format!("/clients/{client}/brand-clans"),
            json!({"name": "Zero", "candidate": bible(), "from": {"kind": "build"}}),
        )
        .await;
    assert_eq!(made.status, StatusCode::CREATED);
    let made = made.json();
    let path = made["path"].as_str().unwrap().to_string();
    assert_eq!(made["default"], true);
    let list = ok(&me.get(&s, &format!("/clients/{client}/brand-clans")).await);
    assert_eq!(list["items"][0]["name"], "Zero");
    // Edit, publish, read the old one.
    let mut cand = bible();
    cand["voice"]["tone"] = json!("Dry.");
    let d = ok(&me
        .json(
            &s,
            "PUT",
            &format!("/brand-clans/{path}/draft"),
            json!({"candidate": cand}),
        )
        .await);
    assert_eq!(d["draft"]["changes"][0]["id"], "tone");
    let p = ok(&me
        .json(
            &s,
            "POST",
            &format!("/brand-clans/{path}/publish"),
            json!({"expect_version": 1}),
        )
        .await);
    assert_eq!(p["version"], 2);
    let v1 = ok(&me.get(&s, &format!("/brand-clans/{path}?version=1")).await);
    assert_eq!(v1["readonly"], true);
    let h = ok(&me.get(&s, &format!("/brand-clans/{path}/history")).await);
    assert_eq!(h[0]["version"], 2);
    assert_eq!(h[0]["by"], format!("human:{}", "visionary@napkin"));
    // A stale publish is a conflict.
    let stale = me
        .json(
            &s,
            "POST",
            &format!("/brand-clans/{path}/publish"),
            json!({"expect_version": 1}),
        )
        .await;
    assert_eq!(stale.status, StatusCode::CONFLICT);
    // Default.
    let second = ok(&me
        .json(
            &s,
            "POST",
            &format!("/clients/{client}/brand-clans"),
            json!({"name": "Original"}),
        )
        .await);
    let set = ok(&me
        .json(
            &s,
            "PUT",
            &format!("/clients/{client}/default-brand-clan"),
            json!({"document_id": second["document_id"]}),
        )
        .await);
    assert_eq!(set["default_brand_clan"], second["document_id"]);
}

#[tokio::test]
async fn a_logo_is_served_as_a_cleaned_image_and_nothing_crosses_agencies() {
    let s = brand_server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let other = sign_in(&s, "planner", "javelin").await;
    let client = ok(&me
        .json(&s, "POST", "/clients", json!({"name": "Tidewell"}))
        .await)["id"]
        .as_str()
        .unwrap()
        .to_string();
    let made = ok(&me
        .json(
            &s,
            "POST",
            &format!("/clients/{client}/brand-clans"),
            json!({"name": "Zero"}),
        )
        .await);
    let path = made["path"].as_str().unwrap();
    let svg = b"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><script>alert(1)</script><circle r='4'/></svg>";
    let put = call(
        &s,
        Some(&me),
        &me.tenant,
        "POST",
        &format!("/brand-clans/{path}/assets?name=logo.svg"),
        &[],
        svg.to_vec(),
    )
    .await;
    let put = ok(&put);
    let name = put["name"].as_str().unwrap();
    let got = me
        .get(&s, &format!("/brand-clans/{path}/assets/{name}"))
        .await;
    assert_eq!(got.status, StatusCode::OK);
    assert_eq!(got.header("content-type").as_deref(), Some("image/svg+xml"));
    assert!(!String::from_utf8_lossy(&got.body).contains("script"));
    assert!(got
        .header("content-security-policy")
        .unwrap()
        .contains("sandbox"));
    // Another agency's tenant has no such document.
    let theirs = other.get(&s, &format!("/brand-clans/{path}")).await;
    assert_eq!(theirs.status, StatusCode::NOT_FOUND);
    let list = other
        .get(&s, &format!("/clients/{client}/brand-clans"))
        .await;
    assert_eq!(list.status, StatusCode::NOT_FOUND);
}
