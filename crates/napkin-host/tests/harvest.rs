// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Harvest (Contract 6 §6): a client-accepted document offers what it made
//! to the Brand Clan attached to it, and a person's ticks become one
//! published version of the kit, validated against the real Brand Clan schema.

use std::sync::Arc;

use clan_sdk::{
    create, instantiate, make_template, AppInfo, AttachSpec, ClanFile, CreateOptions, HarvestRule,
    InstantiateOptions, MakeTemplateOptions,
};
use napkin_host::{handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

const BRAND_APP: &str = "ie.napkin.brand";
const BRIEF_APP: &str = "ie.napkin.brief-maker";
const LUMEN: &str = "5b1f0c3e-2a47-4d9b-8c10-6e7a9d3f1a01";
const SMP: &str = "single_minded_proposition";

fn brand_schema() -> String {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../app/templates/brand/schema.json");
    std::fs::read_to_string(p).unwrap()
}

fn app(name: &str, id: &str, attach: Option<AttachSpec>) -> AppInfo {
    AppInfo {
        home: None,
        name: name.into(),
        app_id: id.into(),
        version: "0.1.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: Some("agent/output-schema.json".into()),
        prompt_templates: vec![],
        data_seed: None,
        attach,
        spinoff: None,
    }
}

/// A valid Brand Clan at v5 whose proposition is already held, as `stated`.
fn brand() -> Vec<u8> {
    let base = ClanFile::from_bytes(
        create(CreateOptions {
            title: "Lumen Water".into(),
            brief: "kit".into(),
            document_type: None,
            no_render: false,
            schema: Some(brand_schema()),
        })
        .unwrap(),
    )
    .unwrap();
    let mut m = base.manifest().clone();
    m.document_id = Some(LUMEN.into());
    m.app = Some(app("Brand Clan", BRAND_APP, None));
    let mut b = clan_sdk::ClanBuilder::new(m);
    for (p, v) in base.read_all_entries().unwrap() {
        if p != clan_sdk::MANIFEST_PATH && p != "shared/data.yaml" {
            b.add_entry(p, v);
        }
    }
    let data = "brand:\n  ref: brand/lumen-water\n  name:\n    value: Lumen Water\n    origin: stated\n    by: human:maya\nkit:\n  version: 5\nstrategy:\n  proposition:\n    value: Water, lit from within.\n    origin: extracted\n    source:\n      material_id: mat_0123456789abcdef\n      locator: p.4\n";
    b.add_entry("shared/data.yaml", data.as_bytes().to_vec());
    b.build().unwrap()
}

fn brief() -> Vec<u8> {
    let spec = AttachSpec {
        accepts: vec![BRAND_APP.into()],
        lift: [("brand.name.value".to_string(), "client".to_string())]
            .into_iter()
            .collect(),
        harvest: vec![
            HarvestRule {
                from: SMP.into(),
                to: "strategy.proposition.value".into(),
            },
            HarvestRule {
                from: "mandatories".into(),
                to: "voice.mandatories.value".into(),
            },
        ],
    };
    let base = ClanFile::from_bytes(
        create(CreateOptions {
            title: "Brief Maker".into(),
            brief: "b".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let tpl = ClanFile::from_bytes(
        make_template(
            &base,
            app("Brief Maker", BRIEF_APP, Some(spec)),
            MakeTemplateOptions::default(),
        )
        .unwrap(),
    )
    .unwrap();
    instantiate(
        &tpl,
        InstantiateOptions {
            title: "First Light".into(),
            ..Default::default()
        },
    )
    .unwrap()
}

struct F {
    dir: tempfile::TempDir,
    session: Session,
    brief: DocId,
}

fn fixture(actor: Actor) -> F {
    let dir = tempfile::tempdir().unwrap();
    let docs = dir.path().join("documents");
    std::fs::create_dir_all(&docs).unwrap();
    std::fs::write(docs.join("lumen.clan"), brand()).unwrap();
    let id = DocId::from(docs.join("brief.clan"));
    std::fs::write(id.as_str(), brief()).unwrap();
    let session = Session::with_ctx(
        Arc::new(FsStore::new(dir.path().to_path_buf())),
        Ctx::new(actor),
    );
    session.open(id.clone()).unwrap();
    F {
        dir,
        session,
        brief: id,
    }
}

impl F {
    fn call(&self, path: &str, body: Value) -> (u16, Value) {
        let r = handle(
            &self.session,
            &NoConfig,
            HostRequest::new(path, "", body.to_string().into_bytes()),
        );
        (
            r.status,
            serde_json::from_slice(&r.body).unwrap_or(Value::Null),
        )
    }
    fn ok(&self, path: &str, body: Value) -> Value {
        let (s, v) = self.call(path, body);
        assert_eq!(s, 200, "{path}: {v}");
        v
    }
    fn kit(&self) -> ClanFile {
        ClanFile::open(self.dir.path().join("documents/lumen.clan")).unwrap()
    }
    fn kit_data(&self) -> serde_yaml::Value {
        serde_yaml::from_slice(&self.kit().read_entry("shared/data.yaml").unwrap()).unwrap()
    }
    /// Attached, filled in, locked, and the client's answer recorded.
    fn accepted(&self, answer: &str, marked: Value) -> Value {
        self.ok("/attach", json!({ "document_id": LUMEN }));
        self.ok(
            "/patch-data",
            json!({ "agent": "human", "patch": {
            SMP: "Water, lit from within, in every glass.",
            "mandatories": ["No health claims", "Show the cap"],
        } }),
        );
        self.ok("/approve", json!({}));
        self.ok("/client-review", json!({ "answer": answer, "client": { "name": "Jane Murphy" },
            "channel": "call", "said": "Mostly lovely.",
            "parts": [ { "address": SMP, "label": "Proposition" }, { "address": "mandatories", "label": "Mandatories" } ],
            "marked": marked }))
    }
}

fn person() -> Actor {
    Actor::human("aoife").unwrap()
}

#[test]
fn nothing_is_offered_until_the_client_has_accepted() {
    let f = fixture(person());
    // No Brand Clan attached.
    assert_eq!(f.call("/harvest", json!({})).0, 409);
    f.ok("/attach", json!({ "document_id": LUMEN }));
    // Attached, but no client answer yet.
    assert_eq!(f.call("/harvest", json!({})).0, 409);
    f.ok(
        "/patch-data",
        json!({ "agent": "human", "patch": { SMP: "x" } }),
    );
    f.ok("/approve", json!({}));
    f.ok(
        "/client-review",
        json!({ "answer": "rejected", "client": { "name": "Jane" }, "channel": "none",
        "reasons": ["off_brief"], "parts": [ { "address": SMP, "label": "Proposition" } ] }),
    );
    let (s, v) = f.call("/harvest", json!({}));
    assert_eq!(s, 409, "{v}");
    assert!(v.to_string().contains("rejected"), "{v}");
}

#[test]
fn an_accepted_document_offers_itself_and_its_declared_fields() {
    let f = fixture(person());
    f.accepted("accepted", json!([]));
    let o = f.ok("/harvest", json!({}));
    assert_eq!(o["brand"]["document_id"], LUMEN);
    assert_eq!(o["brand"]["version"], 5);
    assert_eq!(o["review"]["answer"], "accepted");
    assert_eq!(o["work"]["status"], "new");
    assert_eq!(o["work"]["item"]["title"], "First Light");
    assert_eq!(o["work"]["item"]["kind"], "brief");
    let fields = o["fields"].as_array().unwrap();
    let smp = fields.iter().find(|x| x["from"] == SMP).unwrap();
    assert_eq!(
        smp["status"], "changed",
        "the kit holds another proposition"
    );
    assert_eq!(smp["kit_value"], "Water, lit from within.");
    assert_eq!(smp["selected"], true);
    let man = fields.iter().find(|x| x["from"] == "mandatories").unwrap();
    assert_eq!(man["status"], "new");
}

#[test]
fn a_part_the_client_asked_to_change_is_flagged_and_unticked() {
    let f = fixture(person());
    f.accepted(
        "accepted_with_changes",
        json!([{ "address": SMP, "answer": "accepted_with_changes", "said": "Softer, please." }]),
    );
    let o = f.ok("/harvest", json!({}));
    assert_eq!(o["review"]["answer"], "accepted_with_changes");
    let fields = o["fields"].as_array().unwrap();
    let smp = fields.iter().find(|x| x["from"] == SMP).unwrap();
    assert_eq!(smp["flagged"], true);
    assert_eq!(smp["selected"], false);
    assert!(smp["reason"].as_str().unwrap().contains("change"));
    let man = fields.iter().find(|x| x["from"] == "mandatories").unwrap();
    assert_eq!(man["flagged"], false);
    assert_eq!(man["selected"], true);
}

#[test]
fn ticked_items_become_one_published_version_that_validates() {
    let f = fixture(person());
    f.accepted("accepted", json!([]));
    let r = f.ok(
        "/harvest/apply",
        json!({ "work": true, "fields": [SMP, "mandatories"], "summary": "The launch brief." }),
    );
    assert_eq!(r["published"], 6);
    assert_eq!(r["fields"], json!([SMP, "mandatories"]));

    let d = f.kit_data();
    assert_eq!(d["kit"]["version"], serde_yaml::Value::from(6));
    assert_eq!(
        d["kit"]["published"]["by"],
        serde_yaml::Value::from("human:aoife")
    );
    assert!(d["kit"]["changelog"]["v6"]["summary"]
        .as_str()
        .unwrap()
        .contains("First Light"));
    // The value is the document's, now confirmed by the person; the old span is gone.
    let p = &d["strategy"]["proposition"];
    assert_eq!(
        p["value"],
        serde_yaml::Value::from("Water, lit from within, in every glass.")
    );
    assert_eq!(p["origin"], serde_yaml::Value::from("confirmed"));
    assert_eq!(p["by"], serde_yaml::Value::from("human:aoife"));
    assert_eq!(p["confirmed_from"], serde_yaml::Value::from("extracted"));
    assert!(p.get("source").is_none());
    assert_eq!(
        d["voice"]["mandatories"]["value"][1],
        serde_yaml::Value::from("Show the cap")
    );
    // The approved document is an exemplar.
    let work = d["work"].as_mapping().unwrap().values().next().unwrap();
    assert_eq!(work["title"], serde_yaml::Value::from("First Light"));
    assert_eq!(
        work["summary"],
        serde_yaml::Value::from("The launch brief.")
    );
    assert!(work["client_review"].as_str().unwrap().starts_with("d_"));

    // One pinned publish decision by the person.
    let chain = clan_sdk::DecisionChain::from_yaml(
        &f.kit().read_entry("agent/decision-chain.yaml").unwrap(),
    )
    .unwrap();
    let top = &chain.decisions[0];
    assert!(top.action.starts_with("publish v6"), "{}", top.action);
    assert!(top.pinned);
    assert_eq!(top.actor.as_deref(), Some("human:aoife"));
    assert!(
        top.rationale.contains("client review d_"),
        "{}",
        top.rationale
    );

    // Offered again, the document is the kit's now.
    let o = f.ok("/harvest", json!({}));
    assert_eq!(o["work"]["status"], "same");
    assert_eq!(
        o["fields"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|x| x["status"] == "same")
            .count(),
        2
    );
    assert_eq!(o["brand"]["version"], 6);
    // And the brief itself is untouched: it is sealed.
    assert_eq!(f.call("/harvest/apply", json!({ "work": true })).0, 400);
}

#[test]
fn what_is_not_on_offer_or_not_ticked_is_refused_without_writing() {
    let f = fixture(person());
    f.accepted("accepted", json!([]));
    let before = std::fs::read(f.dir.path().join("documents/lumen.clan")).unwrap();
    for body in [
        json!({}),
        json!({ "fields": ["nope"] }),
        json!({ "work": false, "fields": [] }),
    ] {
        let (s, v) = f.call("/harvest/apply", body.clone());
        assert_eq!(s, 400, "{body}: {v}");
    }
    assert_eq!(
        std::fs::read(f.dir.path().join("documents/lumen.clan")).unwrap(),
        before
    );
}

#[test]
fn a_process_and_a_locked_kit_are_refused() {
    let p = fixture(Actor::process("job-1").unwrap());
    // A process cannot attach either, so set the kit up as a person first.
    let f = fixture(person());
    f.accepted("accepted", json!([]));
    let (s, _) = {
        let proc_session = Session::with_ctx(
            Arc::new(FsStore::new(f.dir.path().to_path_buf())),
            Ctx::new(Actor::process("job-1").unwrap()),
        );
        proc_session.open(f.brief.clone()).unwrap();
        let r = handle(
            &proc_session,
            &NoConfig,
            HostRequest::new(
                "/harvest/apply",
                "",
                json!({ "work": true }).to_string().into_bytes(),
            ),
        );
        (r.status, r.body)
    };
    assert_eq!(s, 403);
    drop(p);

    // Lock the kit: harvest is refused and writes nothing.
    let kit_id = DocId::from(f.dir.path().join("documents/lumen.clan"));
    let ks = Session::with_ctx(
        Arc::new(FsStore::new(f.dir.path().to_path_buf())),
        Ctx::new(person()),
    );
    ks.open(kit_id).unwrap();
    let r = handle(
        &ks,
        &NoConfig,
        HostRequest::new("/approve", "", b"{}".to_vec()),
    );
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let before = std::fs::read(f.dir.path().join("documents/lumen.clan")).unwrap();
    assert_eq!(f.call("/harvest/apply", json!({ "work": true })).0, 409);
    assert_eq!(
        std::fs::read(f.dir.path().join("documents/lumen.clan")).unwrap(),
        before
    );
}
