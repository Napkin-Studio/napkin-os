// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Brand Clan host (docs/contracts/brand-clan.md), against an in-memory store
//! (so no test touches a real library, and nothing here needs a filesystem:
//! the same code runs in the browser build).

use std::collections::HashMap;
use std::sync::Mutex;

use clan_sdk::{
    create, make_template, AppInfo, AttachSpec, ClanFile, CreateOptions, MakeTemplateOptions,
};
use napkin_host::brand_clan::{call_json, changes};
use napkin_host::clients;
use napkin_host::library::{attach_change, AttachMode};
use napkin_host::{
    create_instance_for, install_app, Actor, Change, Ctx, DocId, Document, HostError, HostResult,
    Library, PartStore, Version,
};
use serde_json::{json, Value};

#[derive(Default)]
struct MemStore {
    files: Mutex<HashMap<String, Vec<u8>>>,
}

impl PartStore for MemStore {
    fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
        self.files
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| HostError::not_found(format!("no such document: {id}")))
    }
    fn exists(&self, id: &DocId) -> bool {
        self.files.lock().unwrap().contains_key(id.as_str())
    }
    fn apply(&self, change: &Change) -> HostResult<Version> {
        self.files
            .lock()
            .unwrap()
            .insert(change.doc.to_string(), change.bytes.clone());
        Ok(change.archive_version())
    }
}

impl Library for MemStore {
    fn app_candidates(&self) -> Vec<DocId> {
        self.keys("apps/")
    }
    fn app_template(&self, app_id: &str) -> DocId {
        DocId::new(format!("apps/{app_id}/app.clan"))
    }
    fn documents(&self) -> Vec<DocId> {
        self.keys("docs/")
    }
    fn new_document(&self, app_id: &str, id_short: &str) -> HostResult<DocId> {
        Ok(DocId::new(format!("docs/{app_id}-{id_short}.clan")))
    }
    fn home(&self, version_tag: &str) -> HostResult<DocId> {
        Ok(DocId::new(format!("home-{version_tag}.clan")))
    }
    fn fork_branch(&self, parent: &DocId, agent: &str) -> DocId {
        DocId::new(format!("{parent}.{agent}.clan"))
    }
}

impl MemStore {
    fn keys(&self, prefix: &str) -> Vec<DocId> {
        let mut v: Vec<DocId> = self
            .files
            .lock()
            .unwrap()
            .keys()
            .filter(|k| k.starts_with(prefix))
            .map(DocId::new)
            .collect();
        v.sort();
        v
    }
}

const BRAND: &str = "ie.napkin.brand";
const BRIEF: &str = "ie.napkin.brief";

fn root() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn vector(name: &str) -> Value {
    let p = root().join("docs/contracts/examples/brand-clan").join(name);
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn brand_template() -> Vec<u8> {
    let schema =
        std::fs::read_to_string(root().join("app/templates/brand-clan/schema.json")).unwrap();
    let base = ClanFile::from_bytes(
        create(CreateOptions {
            title: "Brand Clan".into(),
            brief: "fixture".into(),
            document_type: None,
            no_render: false,
            schema: Some(schema),
        })
        .unwrap(),
    )
    .unwrap();
    make_template(
        &base,
        info(BRAND, "Brand Clan", None),
        MakeTemplateOptions::default(),
    )
    .unwrap()
}

fn info(app_id: &str, name: &str, attach: Option<AttachSpec>) -> AppInfo {
    AppInfo {
        home: None,
        name: name.into(),
        app_id: app_id.into(),
        version: "1.0.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach,
    }
}

fn brief_template() -> Vec<u8> {
    let base = ClanFile::from_bytes(
        create(CreateOptions {
            title: "Brief".into(),
            brief: "fixture".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let attach = AttachSpec {
        accepts: vec![BRAND.into()],
        ..Default::default()
    };
    make_template(
        &base,
        info(BRIEF, "Brief", Some(attach)),
        MakeTemplateOptions::default(),
    )
    .unwrap()
}

fn store() -> MemStore {
    let s = MemStore::default();
    install_app(&s, brand_template()).unwrap();
    install_app(&s, brief_template()).unwrap();
    s
}

fn me() -> Ctx {
    Ctx::new(Actor::human("aoife").unwrap())
}
fn tom() -> Ctx {
    Ctx::new(Actor::human("tom").unwrap())
}
fn job() -> Ctx {
    Ctx::new(Actor::process("brand_build").unwrap())
}

fn run(s: &MemStore, c: &Ctx, op: &str, input: Value) -> HostResult<Value> {
    call_json(s, c, op, &input)
}

fn ok(s: &MemStore, c: &Ctx, op: &str, input: Value) -> Value {
    run(s, c, op, input).unwrap_or_else(|e| panic!("{op}: {e}"))
}

fn status(r: HostResult<Value>) -> u16 {
    r.expect_err("should have been refused").status
}

fn client(s: &MemStore, name: &str) -> clients::ClientRecord {
    clients::create_client(s, &me(), name, None).unwrap()
}

/// Tidewell Zero v1, the vector's bible, made through `create`.
fn zero(s: &MemStore, c: &clients::ClientRecord) -> Value {
    let cand = vector("candidate.zero-draft-v3.json");
    let mut bible = vector("data.zero-v2.json");
    bible.as_object_mut().unwrap().remove("kit");
    let _ = cand;
    ok(
        s,
        &me(),
        "create",
        json!({
            "client_id": c.id, "name": "Zero", "candidate": bible,
            "source": {"file": "Tidewell-brand-book-2026.pdf", "kind": "pdf", "pages": 48},
            "from": {"kind": "build", "file": "Tidewell-brand-book-2026.pdf"},
        }),
    )
}

fn data_bytes(s: &MemStore, path: &str) -> Vec<u8> {
    ClanFile::from_bytes(s.read(&DocId::new(path)).unwrap())
        .unwrap()
        .read_entry("shared/data.yaml")
        .unwrap()
}

fn entry(s: &MemStore, path: &str, e: &str) -> Option<Vec<u8>> {
    ClanFile::from_bytes(s.read(&DocId::new(path)).unwrap())
        .unwrap()
        .read_entry(e)
        .ok()
}

fn draft_with_mint(v: &Value, hex: &str) -> Value {
    let mut cand = v["data"].clone();
    cand.as_object_mut().unwrap().remove("kit");
    cand["visual"]["colours"][1]["hex"] = json!(hex);
    cand
}

#[test]
fn the_first_brand_clan_is_the_default_and_the_second_is_not() {
    let s = store();
    let t = client(&s, "Tidewell");
    let z = zero(&s, &t);
    assert_eq!(z["version"], 1);
    assert_eq!(z["default"], true);
    assert_eq!(z["client"]["id"], t.id);
    let o = ok(
        &s,
        &me(),
        "create",
        json!({"client_id": t.id, "name": "Original"}),
    );
    assert_eq!(o["default"], false);
    assert_eq!(o["version"], 1);
    let l = ok(&s, &me(), "list", json!({"client_id": t.id}));
    assert_eq!(l["default"], z["document_id"]);
    assert_eq!(l["items"].as_array().unwrap().len(), 2);
    assert_eq!(l["items"][0]["name"], "Zero", "the default comes first");
    assert_eq!(l["items"][0]["default"], true);
    assert_eq!(
        clients::get(&s, &t.id)
            .unwrap()
            .default_brand_clan
            .as_deref(),
        z["document_id"].as_str()
    );
    // Make default: one write on the client record.
    ok(
        &s,
        &me(),
        "default.set",
        json!({"client_id": t.id, "document_id": o["document_id"]}),
    );
    let l = ok(&s, &me(), "list", json!({"client_id": t.id}));
    assert_eq!(l["default"], o["document_id"]);
    assert_eq!(l["items"][0]["name"], "Original");
}

#[test]
fn the_list_shape_is_the_vectors() {
    let s = store();
    let t = client(&s, "Tidewell");
    zero(&s, &t);
    let l = ok(&s, &me(), "list", json!({"client_id": t.id}));
    let want = vector("list.reply.json");
    let (g, w) = (&l["items"][0], &want["items"][1]);
    let keys = |v: &Value| {
        let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
        k.sort();
        k
    };
    assert_eq!(keys(g), keys(w));
    assert_eq!(keys(&l), keys(&want));
    assert_eq!(g["palette"], w["palette"]);
    // The view and the history have the vectors' shapes, draft and pending included.
    let z = &l["items"][0];
    let path = z["path"].as_str().unwrap();
    let mut cand = vector("data.zero-v2.json");
    cand.as_object_mut().unwrap().remove("kit");
    cand["voice"]["tone"] = json!("Dry.");
    let v = ok(
        &s,
        &me(),
        "draft.save",
        json!({"path": path, "candidate": cand}),
    );
    let wv = vector("view.reply.json");
    assert_eq!(keys(&v), keys(&wv));
    assert_eq!(keys(&v["draft"]), keys(&wv["draft"]));
    assert_eq!(keys(&v["client"]), keys(&wv["client"]));
    let h = ok(&s, &me(), "history", json!({"path": path}));
    assert_eq!(keys(&h[0]), keys(&vector("history.reply.json")[0]));
    assert_eq!(keys(&v["data"]["kit"]), keys(&wv["data"]["kit"]));
}

#[test]
fn a_default_must_be_a_brand_clan_of_that_client() {
    let s = store();
    let (a, b) = (client(&s, "Tidewell"), client(&s, "Other"));
    let za = zero(&s, &a);
    assert_eq!(
        status(run(
            &s,
            &me(),
            "default.set",
            json!({"client_id": b.id, "document_id": za["document_id"]})
        )),
        422
    );
    assert_eq!(
        status(run(
            &s,
            &me(),
            "default.set",
            json!({"client_id": a.id, "document_id": "nope"})
        )),
        422
    );
    assert_eq!(
        status(run(
            &s,
            &job(),
            "default.set",
            json!({"client_id": a.id, "document_id": za["document_id"]})
        )),
        403
    );
}

#[test]
fn a_bible_the_schema_refuses_makes_nothing() {
    let s = store();
    let t = client(&s, "Tidewell");
    let before = s.documents().len();
    let bad = json!({"visual": {"colours": [{"id": "x", "name": "X", "hex": "red"}]}});
    assert_eq!(
        status(run(
            &s,
            &me(),
            "create",
            json!({"client_id": t.id, "name": "Z", "candidate": bad})
        )),
        422
    );
    assert_eq!(s.documents().len(), before);
    assert!(clients::get(&s, &t.id)
        .unwrap()
        .default_brand_clan
        .is_none());
}

#[test]
fn drafts_are_invisible_to_the_published_data_and_publish_makes_the_next_version() {
    let s = store();
    let t = client(&s, "Tidewell");
    let z = zero(&s, &t);
    let path = z["path"].as_str().unwrap();
    let before = data_bytes(&s, path);
    let cand = draft_with_mint(&z, "#3FC9A0");
    let d = ok(
        &s,
        &tom(),
        "draft.save",
        json!({"path": path, "candidate": cand, "expect_version": 1}),
    );
    assert_eq!(
        d["draft"]["changes"][0]["text"],
        "Mint #7FD6BD becomes #3FC9A0"
    );
    assert_eq!(d["draft"]["edited_by"], json!(["human:tom"]));
    assert_eq!(d["version"], 1, "open work keeps the published version");
    assert_eq!(
        data_bytes(&s, path),
        before,
        "a draft never touches shared/data.yaml"
    );
    let l = ok(&s, &me(), "list", json!({"client_id": t.id}));
    assert_eq!(l["items"][0]["draft"]["changes"], 1);
    assert_eq!(l["items"][0]["draft"]["by"], "human:tom");
    // A second person edits the same draft: last editor last.
    let mut cand2 = cand.clone();
    cand2["voice"]["rules"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id": "can-upright", "text": "Always show the can upright.", "kind": "do"}));
    let d = ok(
        &s,
        &me(),
        "draft.save",
        json!({"path": path, "candidate": cand2}),
    );
    assert_eq!(d["draft"]["edited_by"], json!(["human:tom", "human:aoife"]));
    assert_eq!(d["draft"]["changes"].as_array().unwrap().len(), 2);
    assert_eq!(data_bytes(&s, path), before);
    // Publish: stale first, then the right one.
    assert_eq!(
        status(run(
            &s,
            &me(),
            "publish",
            json!({"path": path, "expect_version": 7})
        )),
        409
    );
    let p = ok(
        &s,
        &me(),
        "publish",
        json!({"path": path, "expect_version": 1}),
    );
    assert_eq!(p["version"], 2);
    assert!(p["draft"].is_null());
    assert_eq!(p["data"]["visual"]["colours"][1]["hex"], "#3FC9A0");
    assert_eq!(p["data"]["kit"]["version"], 2);
    assert_eq!(p["data"]["kit"]["published"]["by"], "human:aoife");
    assert_eq!(p["data"]["kit"]["changelog"].as_array().unwrap().len(), 2);
    assert!(entry(&s, path, "app/brand/versions/v1.yaml").is_some());
    assert!(entry(&s, path, "app/brand/versions/v2.yaml").is_some());
    assert_eq!(
        status(run(
            &s,
            &me(),
            "publish",
            json!({"path": path, "expect_version": 2})
        )),
        409,
        "no draft"
    );
    // The old version opens read-only and is unchanged.
    let v1 = ok(&s, &me(), "get", json!({"path": path, "version": 1}));
    assert_eq!(v1["readonly"], true);
    assert_eq!(v1["data"]["visual"]["colours"][1]["hex"], "#7FD6BD");
    assert_eq!(v1["version"], 2, "the published version is still 2");
    let v2 = ok(&s, &me(), "get", json!({"path": path, "version": 2}));
    assert_eq!(v2["readonly"], false);
    assert_eq!(
        status(run(&s, &me(), "get", json!({"path": path, "version": 9}))),
        404
    );
    // History, newest first: who and what.
    let h = ok(&s, &me(), "history", json!({"path": path}));
    assert_eq!(h[0]["version"], 2);
    assert_eq!(h[0]["by"], "human:aoife");
    assert_eq!(h[1]["version"], 1);
    assert_eq!(h[1]["from"]["kind"], "build");
    // Every edit is a CLAN decision with the person's name.
    let chain = String::from_utf8(entry(&s, path, "agent/decision-chain.yaml").unwrap()).unwrap();
    assert!(chain.contains("brand_clan.publish") && chain.contains("brand_clan.draft"));
    assert!(chain.contains("human:tom") && chain.contains("human:aoife"));
}

#[test]
fn editing_back_to_the_published_clears_the_draft_and_discard_drops_it() {
    let s = store();
    let t = client(&s, "Tidewell");
    let z = zero(&s, &t);
    let path = z["path"].as_str().unwrap();
    let d = ok(
        &s,
        &me(),
        "draft.save",
        json!({"path": path, "candidate": draft_with_mint(&z, "#111111")}),
    );
    assert!(!d["draft"].is_null());
    let d = ok(
        &s,
        &me(),
        "draft.save",
        json!({"path": path, "candidate": draft_with_mint(&z, "#7FD6BD")}),
    );
    assert!(d["draft"].is_null());
    ok(
        &s,
        &me(),
        "draft.save",
        json!({"path": path, "candidate": draft_with_mint(&z, "#222222")}),
    );
    let d = ok(&s, &me(), "draft.discard", json!({"path": path}));
    assert!(d["draft"].is_null());
    assert_eq!(
        status(run(
            &s,
            &job(),
            "draft.save",
            json!({"path": path, "candidate": draft_with_mint(&z, "#333333")})
        )),
        403
    );
}

#[test]
fn an_old_version_comes_back_only_as_a_new_draft() {
    let s = store();
    let t = client(&s, "Tidewell");
    let z = zero(&s, &t);
    let path = z["path"].as_str().unwrap();
    ok(
        &s,
        &me(),
        "draft.save",
        json!({"path": path, "candidate": draft_with_mint(&z, "#3FC9A0")}),
    );
    ok(
        &s,
        &me(),
        "publish",
        json!({"path": path, "expect_version": 1}),
    );
    let d = ok(
        &s,
        &me(),
        "draft.start",
        json!({"path": path, "from_version": 1}),
    );
    assert_eq!(d["draft"]["from"], json!({"kind": "restore", "version": 1}));
    assert_eq!(
        d["draft"]["changes"][0]["text"],
        "Mint #3FC9A0 becomes #7FD6BD"
    );
    assert_eq!(
        status(run(
            &s,
            &me(),
            "draft.start",
            json!({"path": path, "from_version": 1})
        )),
        409,
        "a draft exists"
    );
    let p = ok(
        &s,
        &me(),
        "publish",
        json!({"path": path, "expect_version": 2}),
    );
    assert_eq!(p["version"], 3);
    assert_eq!(p["data"]["kit"]["changelog"][2]["from"]["kind"], "restore");
    // v1 and v2 stay on record, untouched.
    let v2 = ok(&s, &me(), "get", json!({"path": path, "version": 2}));
    assert_eq!(v2["data"]["visual"]["colours"][1]["hex"], "#3FC9A0");
}

#[test]
fn a_new_version_waits_and_a_build_that_misses_a_section_deletes_nothing() {
    let s = store();
    let t = client(&s, "Tidewell");
    let z = zero(&s, &t);
    let path = z["path"].as_str().unwrap();
    let before = data_bytes(&s, path);
    // The build finds a new mint and a new rule list, and no typography at all.
    let colours: Vec<Value> = z["data"]["visual"]["colours"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            let mut c = c.clone();
            if c["id"] == "mint" {
                c["hex"] = json!("#3FC9A0");
            }
            c
        })
        .collect();
    let cand = json!({
        "visual": {"colours": colours},
        "voice": {"tone": "Warm and chatty", "rules": [{"id": "r9", "text": "Cans stay upright.", "kind": "do"}]},
    });
    // A build (a job) may propose; it changes nothing published.
    let p = ok(
        &s,
        &job(),
        "proposal.set",
        json!({"path": path, "candidate": cand, "source": {"file": "Zero-pack-update.pdf", "kind": "pdf"}, "from": {"kind": "upload", "file": "Zero-pack-update.pdf"}}),
    );
    assert_eq!(
        data_bytes(&s, path),
        before,
        "a waiting version never touches shared/data.yaml"
    );
    assert_eq!(p["version"], 1);
    let ids: Vec<&str> = p["pending"]["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        [
            "colour:mint",
            "tone",
            "rule:r9",
            "rule:mint-accent",
            "rule:busy-picture",
            "rule:no-diet",
            "source"
        ]
    );
    assert!(
        !ids.iter().any(|i| i.starts_with("typography")),
        "the missing typography section is kept, not removed"
    );
    let l = ok(&s, &me(), "list", json!({"client_id": t.id}));
    assert_eq!(l["items"][0]["pending"]["changes"], 7);
    assert_eq!(l["items"][0]["pending"]["by"], "process:brand_build");
    // A job cannot accept; a person takes some.
    assert_eq!(
        status(run(
            &s,
            &job(),
            "proposal.accept",
            json!({"path": path, "take": "all", "expect_version": 1})
        )),
        403
    );
    assert_eq!(
        status(run(
            &s,
            &me(),
            "proposal.accept",
            json!({"path": path, "take": ["nope"], "expect_version": 1})
        )),
        400
    );
    let a = ok(
        &s,
        &me(),
        "proposal.accept",
        json!({"path": path, "take": ["colour:mint", "tone"], "expect_version": 1}),
    );
    assert_eq!(a["version"], 2);
    assert!(a["pending"].is_null());
    assert_eq!(a["data"]["visual"]["colours"][1]["hex"], "#3FC9A0");
    assert_eq!(a["data"]["voice"]["tone"], "Warm and chatty");
    assert_eq!(
        a["data"]["voice"]["rules"].as_array().unwrap().len(),
        3,
        "the rules were not taken"
    );
    assert_eq!(a["data"]["source"]["file"], "Tidewell-brand-book-2026.pdf");
    assert_eq!(
        a["data"]["kit"]["changelog"][1]["from"]["file"],
        "Zero-pack-update.pdf"
    );
    assert!(entry(&s, path, "app/brand/versions/v2.yaml").is_some());
    // Keep the old one: pending goes, the version stays.
    let cand = json!({"voice": {"tone": "Loud"}});
    ok(
        &s,
        &job(),
        "proposal.set",
        json!({"path": path, "candidate": cand, "from": {"kind": "build"}}),
    );
    let k = ok(&s, &me(), "proposal.keep", json!({"path": path}));
    assert!(k["pending"].is_null());
    assert_eq!(k["version"], 2);
    // A file that changes nothing is refused.
    assert_eq!(
        status(run(
            &s,
            &job(),
            "proposal.set",
            json!({"path": path, "candidate": {"voice": {"tone": "Warm and chatty"}}, "from": {"kind": "build"}})
        )),
        409
    );
}

#[test]
fn the_diff_equals_the_vectors() {
    let v2 = vector("data.zero-v2.json");
    let cand = vector("candidate.zero-draft-v3.json");
    assert_eq!(
        Value::Array(changes(&v2, &cand)),
        vector("changes.zero-v2-to-draft-v3.json")
    );
}

#[test]
fn the_update_chip_changes_nothing_until_pressed() {
    let s = store();
    let t = client(&s, "Tidewell");
    let z = zero(&s, &t);
    let path = z["path"].as_str().unwrap();
    let brand_id = z["document_id"].as_str().unwrap().to_string();
    // A brief for the client takes the Brand Clan (attach, as it is).
    let brief = create_instance_for(&s, BRIEF, Some("Summer brief".into()), Some(&t)).unwrap();
    let doc = Document::load(&s, brief.clone()).unwrap();
    let (change, _) = attach_change(&s, &me(), &doc, &brand_id, AttachMode::Attach).unwrap();
    s.apply(&change).unwrap();
    let frozen = |s: &MemStore| entry(s, brief.as_str(), "shared/data.yaml").unwrap();
    let held = ClanFile::from_bytes(s.read(&brief).unwrap())
        .unwrap()
        .manifest()
        .attached()[0]
        .version;
    assert_eq!(held, Some(1));
    // Draft, publish: the work has not moved, and it is listed as behind.
    ok(
        &s,
        &me(),
        "draft.save",
        json!({"path": path, "candidate": draft_with_mint(&z, "#3FC9A0")}),
    );
    let work_before = s.read(&brief).unwrap();
    assert_eq!(
        ok(&s, &me(), "list", json!({"client_id": t.id}))["behind"],
        json!([]),
        "a draft is not news to work"
    );
    ok(
        &s,
        &me(),
        "publish",
        json!({"path": path, "expect_version": 1}),
    );
    assert_eq!(
        s.read(&brief).unwrap(),
        work_before,
        "publishing writes nothing into work"
    );
    let l = ok(&s, &me(), "list", json!({"client_id": t.id}));
    assert_eq!(l["behind"][0]["path"], brief.as_str());
    assert_eq!(l["behind"][0]["held"], 1);
    assert_eq!(l["behind"][0]["current"], 2);
    assert_eq!(l["behind"][0]["brand_name"], "Zero");
    let v = ok(&s, &me(), "get", json!({"path": path}));
    assert_eq!(v["used_by"][0]["behind"], true);
    // Pressed: only that document moves, by attach's own update.
    let before_pressed = frozen(&s);
    assert_eq!(
        status(run(
            &s,
            &job(),
            "work.update",
            json!({"path": path, "work": brief.as_str()})
        )),
        403
    );
    assert_eq!(frozen(&s), before_pressed);
    let r = ok(
        &s,
        &me(),
        "work.update",
        json!({"path": path, "work": brief.as_str()}),
    );
    assert_eq!(r["verb"], "updated");
    assert_ne!(frozen(&s), before_pressed);
    let held = ClanFile::from_bytes(s.read(&brief).unwrap())
        .unwrap()
        .manifest()
        .attached()[0]
        .version;
    assert_eq!(held, Some(2));
    assert_eq!(
        ok(&s, &me(), "list", json!({"client_id": t.id}))["behind"],
        json!([])
    );
    // Nothing to update now: attach refuses.
    assert_eq!(
        status(run(
            &s,
            &me(),
            "work.update",
            json!({"path": path, "work": brief.as_str()})
        )),
        409
    );
}

#[test]
fn assets_get_a_content_name_and_never_overwrite() {
    let s = store();
    let t = client(&s, "Tidewell");
    let z = zero(&s, &t);
    let path = z["path"].as_str().unwrap();
    let put = |bytes: &[u8]| match call_json_bytes(
        &s,
        &me(),
        "asset.put",
        json!({"path": path, "name": "logo.svg"}),
        bytes.to_vec(),
    ) {
        Ok(v) => v,
        Err(e) => panic!("{e}"),
    };
    let a = put(b"<svg xmlns='http://www.w3.org/2000/svg'/>");
    let b = put(b"<svg xmlns='http://www.w3.org/2000/svg' width='2'/>");
    assert_ne!(a["name"], b["name"]);
    assert!(a["path"].as_str().unwrap().starts_with("human/assets/"));
    match napkin_host::brand_clan::call(
        &s,
        &me(),
        "asset.get",
        &json!({"path": path, "name": a["name"]}),
        vec![],
    )
    .unwrap()
    {
        napkin_host::brand_clan::Reply::Bytes {
            content_type,
            bytes,
        } => {
            assert_eq!(content_type, "image/svg+xml");
            assert!(bytes.starts_with(b"<svg"));
        }
        _ => panic!("bytes"),
    }
    assert_eq!(
        status(run(
            &s,
            &me(),
            "asset.get",
            json!({"path": path, "name": "../x"})
        )),
        400
    );
}

fn call_json_bytes(
    s: &MemStore,
    c: &Ctx,
    op: &str,
    input: Value,
    body: Vec<u8>,
) -> HostResult<Value> {
    napkin_host::brand_clan::call(s, c, op, &input, body).map(napkin_host::brand_clan::Reply::json)
}

#[test]
fn only_a_brand_clan_is_one() {
    let s = store();
    let t = client(&s, "Tidewell");
    let brief = create_instance_for(&s, BRIEF, Some("Brief".into()), Some(&t)).unwrap();
    assert_eq!(
        status(run(&s, &me(), "get", json!({"path": brief.as_str()}))),
        422
    );
    assert_eq!(
        status(run(&s, &me(), "get", json!({"path": "docs/nope.clan"}))),
        404
    );
    assert_eq!(status(run(&s, &me(), "frobnicate", json!({}))), 400);
}

/// The Brand Clan chip in Brief Maker and Research (phase 2, mocks c1 and c2) reads
/// `/attach-targets`: only the document's own client's Brand Clans, which is the
/// default, the version the work holds, and a newer version after a publish.
#[test]
fn the_chip_offers_only_this_clients_brand_clans_with_default_and_held_version() {
    let s = store();
    let t = client(&s, "Tidewell");
    let other = client(&s, "Harbour Bakes");
    let z = zero(&s, &t);
    let path = z["path"].as_str().unwrap();
    let brand_id = z["document_id"].as_str().unwrap().to_string();
    let _theirs = zero(&s, &other);
    let brief = create_instance_for(&s, BRIEF, Some("Summer brief".into()), Some(&t)).unwrap();
    let targets = |s: &MemStore| {
        let doc = Document::load(s, brief.clone()).unwrap();
        napkin_host::library::attach_targets(s, &me(), &doc)
    };
    let before = targets(&s);
    assert_eq!(before.len(), 1, "only Tidewell's Brand Clan is offered");
    assert_eq!(before[0].document_id, brand_id);
    assert!(
        before[0].default,
        "the first Brand Clan is the client's default"
    );
    assert!(!before[0].attached);
    assert_eq!(before[0].held_version, None);
    let doc = Document::load(&s, brief.clone()).unwrap();
    let (change, _) = attach_change(&s, &me(), &doc, &brand_id, AttachMode::Attach).unwrap();
    s.apply(&change).unwrap();
    let held = targets(&s);
    assert!(held[0].attached);
    assert_eq!(held[0].held_version, Some(1));
    assert_eq!(held[0].version, Some(1));
    ok(
        &s,
        &me(),
        "draft.save",
        json!({"path": path, "candidate": draft_with_mint(&z, "#3FC9A0")}),
    );
    ok(
        &s,
        &me(),
        "publish",
        json!({"path": path, "expect_version": 1}),
    );
    let behind = targets(&s);
    assert_eq!(
        behind[0].held_version,
        Some(1),
        "the work keeps its version"
    );
    assert_eq!(behind[0].version, Some(2), "the chip offers Update to v2");
}

/// Phase 2 (f): competitors found by research reach a Brand Clan only as a person's draft, and the diff names them.
#[test]
fn competitors_found_by_research_are_a_draft_a_person_publishes() {
    let s = store();
    let t = client(&s, "Tidewell");
    let z = zero(&s, &t);
    let path = z["path"].as_str().unwrap();
    let mut cand = z["data"].clone();
    cand.as_object_mut().unwrap().remove("kit");
    cand["competitors"] = json!([
        {"id": "ariel", "name": "Ariel", "from": {"kind": "research", "document_id": "doc-research-1", "title": "Zero research", "fact_ids": ["fa_01"]}},
        {"id": "method", "name": "Method", "from": {"kind": "research", "document_id": "doc-research-1"}}
    ]);
    let before = data_bytes(&s, path);
    let d = ok(
        &s,
        &me(),
        "draft.save",
        json!({"path": path, "candidate": cand}),
    );
    let texts: Vec<&str> = d["draft"]["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["text"].as_str().unwrap())
        .collect();
    assert_eq!(
        texts,
        vec!["Competitor Ariel added", "Competitor Method added"]
    );
    assert_eq!(
        data_bytes(&s, path),
        before,
        "a draft changes nothing published"
    );
    let p = ok(
        &s,
        &me(),
        "publish",
        json!({"path": path, "expect_version": 1}),
    );
    assert_eq!(p["data"]["competitors"][0]["name"], "Ariel");
    assert_eq!(p["version"], 2);
    // a competitor without a name is refused by the schema
    let mut bad = p["data"].clone();
    bad.as_object_mut().unwrap().remove("kit");
    bad["competitors"] = json!([{"id": "x"}]);
    assert_eq!(
        status(run(
            &s,
            &me(),
            "draft.save",
            json!({"path": path, "candidate": bad})
        )),
        400,
        "the schema refuses a competitor with no name"
    );
}
