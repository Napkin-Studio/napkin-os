// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Attach on the host (Contract 6 §4.5): which documents are on offer, the
//! attach / update / detach routes and their refusals, the attribution the
//! chain records, and what `GET /upstream` says about a source that moved on.

use std::path::Path;
use std::sync::Arc;

use clan_sdk::decision::DecisionScope;
use clan_sdk::{
    create, instantiate, make_template, AppInfo, AttachSpec, ClanBuilder, ClanFile, CreateOptions,
    Decision, DecisionChain, FileEntry, InstantiateOptions, MakeTemplateOptions, MANIFEST_PATH,
};
use napkin_host::{handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Scope, Session};
use serde_json::{json, Value};

const BRAND_APP: &str = "ie.napkin.brand";
const BRIEF_APP: &str = "ie.napkin.brief-maker";
const LUMEN: &str = "5b1f0c3e-2a47-4d9b-8c10-6e7a9d3f1a01";
const FACTS: &str = "shared/facts.yaml";

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

fn base(title: &str) -> ClanFile {
    ClanFile::from_bytes(
        create(CreateOptions {
            title: title.into(),
            brief: format!("{title}, for the attach tests"),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap()
}

/// A Brand Clan at `version`, optionally written under another tenant.
fn brand(version: u64, name: &str, org: Option<&str>) -> Vec<u8> {
    let c = base(name);
    let mut m = c.manifest().clone();
    m.document_id = Some(LUMEN.into());
    m.app = Some(app("Brand Clan", BRAND_APP, None));
    m.files.push(FileEntry {
        id: "pinned-facts".into(),
        path: FACTS.into(),
        role: "pinned-facts".into(),
        content_type: "application/yaml".into(),
        priority: None,
        sha256: None,
    });
    let mut chain = DecisionChain::default();
    let mut d = Decision::new("brand-person", "open kit", "opened", "2026-10-01T09:00:00Z");
    d.id = Some("d_1".into());
    if let Some(org) = org {
        d.scope = Some(DecisionScope {
            org: Some(org.into()),
            ..Default::default()
        });
    }
    chain.decisions.push(d);
    let mut b = ClanBuilder::new(m);
    for (p, v) in c.read_all_entries().unwrap() {
        if !matches!(
            p.as_str(),
            MANIFEST_PATH | "shared/data.yaml" | "agent/decision-chain.yaml"
        ) {
            b.add_entry(p, v);
        }
    }
    b.add_entry(
        "shared/data.yaml",
        format!("brand:\n  name: {name}\nkit:\n  version: {version}\nvoice:\n  tone: plain\n")
            .into_bytes(),
    );
    b.add_entry("agent/decision-chain.yaml", chain.to_yaml().unwrap());
    b.add_entry(
        FACTS,
        b"facts:\n  - id: f_a\n    entity: brand/lumen-water\n    key: awareness.prompted\n    value: 41\n"
            .to_vec(),
    );
    b.build().unwrap()
}

fn brief(accepts: &str) -> Vec<u8> {
    let spec = AttachSpec {
        accepts: vec![accepts.into()],
        lift: [
            ("brand.name".to_string(), "client".to_string()),
            ("voice.tone".to_string(), "tone".to_string()),
        ]
        .into_iter()
        .collect(),
        harvest: vec![],
    };
    let tpl = ClanFile::from_bytes(
        make_template(
            &base("Brief Maker"),
            app("Brief Maker", BRIEF_APP, Some(spec)),
            MakeTemplateOptions::default(),
        )
        .unwrap(),
    )
    .unwrap();
    instantiate(&tpl, InstantiateOptions::default()).unwrap()
}

struct Fixture {
    dir: tempfile::TempDir,
    session: Session,
    brief: DocId,
}

fn fixture(accepts: &str, actor: Actor, org: Option<&str>, brand_org: Option<&str>) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let docs = dir.path().join("documents");
    std::fs::create_dir_all(&docs).unwrap();
    std::fs::write(docs.join("lumen.clan"), brand(5, "Lumen Water", brand_org)).unwrap();
    let brief_id = DocId::from(docs.join("brief.clan"));
    std::fs::write(brief_id.as_str(), brief(accepts)).unwrap();
    let mut ctx = Ctx::new(actor);
    ctx.scope = Scope {
        org: org.map(String::from),
        brand: None,
    };
    let session = Session::with_ctx(Arc::new(FsStore::new(dir.path().to_path_buf())), ctx);
    session.open(brief_id.clone()).unwrap();
    Fixture {
        dir,
        session,
        brief: brief_id,
    }
}

fn person() -> Actor {
    Actor::human("aoife").unwrap()
}

impl Fixture {
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

    /// The status a refused request answers with, having written nothing.
    fn refused(&self, path: &str, body: Value) -> u16 {
        let before = std::fs::read(self.brief.as_str()).unwrap();
        let (s, v) = self.call(path, body);
        assert_ne!(s, 200, "{path} should be refused: {v}");
        assert_eq!(
            std::fs::read(self.brief.as_str()).unwrap(),
            before,
            "a refusal writes nothing"
        );
        s
    }

    fn clan(&self) -> ClanFile {
        ClanFile::open(self.brief.as_str()).unwrap()
    }

    fn data(&self) -> serde_yaml::Value {
        serde_yaml::from_slice(&self.clan().read_entry("shared/data.yaml").unwrap()).unwrap()
    }

    fn chain(&self) -> Vec<Decision> {
        DecisionChain::from_yaml(&self.clan().read_entry("agent/decision-chain.yaml").unwrap())
            .unwrap()
            .decisions
    }

    fn move_the_kit_on(&self) {
        let p: &Path = self.dir.path();
        std::fs::write(
            p.join("documents/lumen.clan"),
            brand(6, "Lumen Water Co", None),
        )
        .unwrap();
    }
}

#[test]
fn a_document_lists_what_it_could_attach_and_attaches_it() {
    let f = fixture(BRAND_APP, person(), None, None);
    let targets = f.ok("/attach-targets", json!({}));
    let t = targets.as_array().unwrap();
    assert_eq!(t.len(), 1);
    assert_eq!(t[0]["document_id"], LUMEN);
    assert_eq!(t[0]["title"], "Lumen Water");
    assert_eq!(t[0]["version"], 5);
    assert_eq!(t[0]["attached"], false);

    let r = f.ok("/attach", json!({ "document_id": LUMEN }));
    assert_eq!(r["verb"], "attached");
    assert_eq!(r["seeded"], json!(["client", "tone"]));
    assert_eq!(r["attached"]["version"], 5);

    let data = f.data();
    assert_eq!(data["client"], serde_yaml::Value::from("Lumen Water"));
    assert!(data["upstream"].get(LUMEN).is_some());
    assert_eq!(f.clan().manifest().attached()[0].carried.document_id, LUMEN);
    // The host owns the projection of the merged pins.
    assert!(data.get("projection").is_some());
    // Now it is the attached one.
    assert_eq!(f.ok("/attach-targets", json!({}))[0]["attached"], true);
}

#[test]
fn the_chain_says_who_attached_and_for_which_org() {
    let f = fixture(BRAND_APP, person(), Some("agency-one"), None);
    f.ok("/attach", json!({ "document_id": LUMEN }));
    let chain = f.chain();
    let marker = chain
        .iter()
        .find(|d| d.action.starts_with("attach "))
        .unwrap();
    assert_eq!(marker.actor.as_deref(), Some("human:aoife"));
    assert_eq!(marker.kind.as_deref(), Some("edit"));
    assert_eq!(
        marker.scope.as_ref().and_then(|s| s.org.as_deref()),
        Some("agency-one")
    );
    assert!(marker.pinned);
    let seed = chain.iter().find(|d| d.action == "seed").unwrap();
    assert_eq!(seed.actor.as_deref(), Some("process:attach"));
    assert_eq!(
        seed.scope.as_ref().and_then(|s| s.org.as_deref()),
        Some("agency-one")
    );
    // The kit's own decision came along, as it wrote it.
    let carried = chain
        .iter()
        .find(|d| d.id.as_deref() == Some("d_1"))
        .unwrap();
    assert_eq!(carried.agent, "brand-person");
    assert!(carried.scope.is_none());
}

#[test]
fn a_verb_that_does_not_fit_the_state_is_refused_without_writing() {
    let f = fixture(BRAND_APP, person(), None, None);
    // Update before attach, then attach twice.
    assert_eq!(
        f.refused("/attach/update", json!({ "document_id": LUMEN })),
        409
    );
    f.ok("/attach", json!({ "document_id": LUMEN }));
    assert_eq!(f.refused("/attach", json!({ "document_id": LUMEN })), 409);
    // Update when nothing moved.
    assert_eq!(
        f.refused("/attach/update", json!({ "document_id": LUMEN })),
        409
    );
    assert_eq!(f.refused("/attach", json!({})), 400);
    assert_eq!(
        f.refused("/attach", json!({ "document_id": "no-such-id" })),
        404
    );
    assert_eq!(
        f.refused("/attach/detach", json!({ "app_id": "ie.napkin.nothing" })),
        409
    );
}

#[test]
fn upstream_says_when_the_kit_moved_on_and_update_takes_it() {
    let f = fixture(BRAND_APP, person(), None, None);
    f.ok("/attach", json!({ "document_id": LUMEN }));
    let (_, up) = f.call("/upstream", json!({}));
    assert_eq!(up["attached"][0]["status"], "current");
    assert_eq!(up["attached"][0]["version"], 5);

    f.move_the_kit_on();
    let (_, up) = f.call("/upstream", json!({}));
    let a = &up["attached"][0];
    assert_eq!(a["status"], "changed");
    assert_eq!(a["version"], 5);
    assert_eq!(a["version_now"], 6);
    assert_eq!(a["changed"]["data"], true);

    let r = f.ok("/attach/update", json!({ "document_id": LUMEN }));
    assert_eq!(r["verb"], "updated");
    assert_eq!(
        f.data()["client"],
        serde_yaml::Value::from("Lumen Water Co")
    );
    let (_, up) = f.call("/upstream", json!({}));
    assert_eq!(up["attached"][0]["status"], "current");
    assert_eq!(up["attached"][0]["version"], 6);
}

#[test]
fn a_locked_document_a_process_and_another_workspace_are_refused() {
    // Locked.
    let f = fixture(BRAND_APP, person(), None, None);
    f.ok("/approve", json!({}));
    assert_eq!(f.refused("/attach", json!({ "document_id": LUMEN })), 409);

    // A process is not a person.
    let p = fixture(BRAND_APP, Actor::process("job-1").unwrap(), None, None);
    assert_eq!(p.refused("/attach", json!({ "document_id": LUMEN })), 403);

    // The source says it is another tenant's.
    let x = fixture(BRAND_APP, person(), Some("mine"), Some("theirs"));
    assert_eq!(x.refused("/attach", json!({ "document_id": LUMEN })), 403);
    // And it is not offered.
    assert_eq!(x.ok("/attach-targets", json!({})), json!([]));
}

#[test]
fn an_app_that_does_not_accept_the_source_attaches_nothing() {
    let f = fixture("ie.napkin.something-else", person(), None, None);
    assert_eq!(f.ok("/attach-targets", json!({})), json!([]));
    assert_eq!(f.refused("/attach", json!({ "document_id": LUMEN })), 422);
}

#[test]
fn detach_lets_go_and_leaves_the_pins() {
    let f = fixture(BRAND_APP, person(), None, None);
    f.ok("/attach", json!({ "document_id": LUMEN }));
    let r = f.ok("/attach/detach", json!({ "app_id": BRAND_APP }));
    assert_eq!(r["unseeded"], json!(["client", "tone"]));
    let data = f.data();
    assert!(data.get("upstream").is_none());
    assert!(data.get("client").is_none());
    assert!(f.clan().manifest().attached().is_empty());
    assert!(String::from_utf8(f.clan().read_entry(FACTS).unwrap())
        .unwrap()
        .contains("f_a"));
    let top = &f.chain()[0];
    assert_eq!(top.action, "detach");
    assert_eq!(top.actor.as_deref(), Some("human:aoife"));
    assert_eq!(f.ok("/attach-targets", json!({}))[0]["attached"], false);
}
