// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Attach carries a source document into one that already exists
//! (Contract 6 §4): the source frozen under `data.upstream.<id>`, its pins and
//! sources merged, its assets copied, its decisions carried after the
//! document's own, and `lineage.attached` recording what was taken. Seeds
//! never overwrite a person's work.

use clan_sdk::hash::sha256_prefixed;
use clan_sdk::{
    attach, create, detach, instantiate, make_template, spinoff, validate, AppInfo, AttachSpec,
    AttachVerb, ClanBuilder, ClanFile, CreateOptions, Decision, DecisionChain, FileEntry,
    InstantiateOptions, MakeTemplateOptions, SpinoffOptions, SpinoffSpec, MANIFEST_PATH,
};
use serde_yaml::Value;

const DATA: &str = "shared/data.yaml";
const CHAIN: &str = "agent/decision-chain.yaml";
const FACTS: &str = "shared/facts.yaml";
const SOURCES: &str = "shared/sources.yaml";
const LOGO: &str = "human/assets/lumen-logo.svg";

const BRAND_APP: &str = "ie.napkin.brand";
const BRIEF_APP: &str = "ie.napkin.brief-maker";
const PRODUCTION_APP: &str = "ie.napkin.production";
const LUMEN: &str = "5b1f0c3e-2a47-4d9b-8c10-6e7a9d3f1a01";
const HARBOUR: &str = "9e2d7a14-6c58-4b03-a1f9-0d4b8c2e7f02";

fn open(bytes: Vec<u8>) -> ClanFile {
    ClanFile::from_bytes(bytes).unwrap()
}

fn doc(title: &str) -> ClanFile {
    open(
        create(CreateOptions {
            title: title.into(),
            brief: format!("{title}, for the attach tests"),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
}

fn app(name: &str, app_id: &str) -> AppInfo {
    AppInfo {
        home: None,
        name: name.into(),
        app_id: app_id.into(),
        version: "0.1.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: Some("agent/output-schema.json".into()),
        prompt_templates: vec![],
        data_seed: None,
        attach: None,
        spinoff: None,
    }
}

fn entry(path: &str, role: &str) -> FileEntry {
    FileEntry {
        id: role.into(),
        path: path.into(),
        role: role.into(),
        content_type: "application/yaml".into(),
        priority: None,
        sha256: None,
    }
}

/// `clan` with `add` written, as the same revision; `reg` registers a path.
fn with(
    clan: &ClanFile,
    document_id: Option<&str>,
    add: &[(&str, Vec<u8>, Option<FileEntry>)],
    app_info: Option<AppInfo>,
) -> ClanFile {
    let mut manifest = clan.manifest().clone();
    if let Some(id) = document_id {
        manifest.document_id = Some(id.into());
    }
    if app_info.is_some() {
        manifest.app = app_info;
    }
    for (_, _, reg) in add {
        if let Some(reg) = reg {
            manifest.files.retain(|f| f.path != reg.path);
            manifest.files.push(reg.clone());
        }
    }
    let mut b = ClanBuilder::new(manifest);
    for (p, v) in clan.read_all_entries().unwrap() {
        if p != MANIFEST_PATH && !add.iter().any(|(a, _, _)| *a == p) {
            b.add_entry(p, v);
        }
    }
    for (p, v, _) in add {
        b.add_entry(*p, v.clone());
    }
    open(b.build().unwrap())
}

fn decision(id: &str, action: &str) -> Decision {
    let mut d = Decision::new(
        "brand-person",
        action,
        format!("{action}, in the kit"),
        "2026-10-01T09:00:00Z",
    );
    d.id = Some(id.into());
    d
}

fn chain_of(decisions: Vec<Decision>) -> Vec<u8> {
    let mut c = DecisionChain::default();
    c.decisions = decisions;
    c.to_yaml().unwrap()
}

fn facts(ids: &[&str]) -> Vec<u8> {
    let items: Vec<String> = ids
        .iter()
        .map(|id| format!("  - id: {id}\n    entity: brand/lumen-water\n    key: awareness.prompted\n    value: 41\n"))
        .collect();
    format!("facts:\n{}", items.join("")).into_bytes()
}

const SOURCES_YAML: &[u8] =
    b"sources:\n  - id: src_roster\n    uri: https://example.com/roster\n    tier: primary\n";

/// A Brand Clan at `version`, named `name`, with pins, a source, a logo and a
/// chain of the given decisions.
fn brand(
    document_id: &str,
    name: &str,
    version: u64,
    logo: &[u8],
    decisions: Vec<Decision>,
    pins: &[&str],
) -> ClanFile {
    let data = format!(
        "brand:\n  ref: brand/lumen-water\n  name: {name}\nkit:\n  version: {version}\nvoice:\n  tone: warm and plain\nprojection:\n  built_from: x\n"
    );
    with(
        &doc(name),
        Some(document_id),
        &[
            (DATA, data.into_bytes(), None),
            (CHAIN, chain_of(decisions), None),
            (FACTS, facts(pins), Some(entry(FACTS, "pinned-facts"))),
            (
                SOURCES,
                SOURCES_YAML.to_vec(),
                Some(entry(SOURCES, "sources")),
            ),
            (
                LOGO,
                logo.to_vec(),
                Some(FileEntry {
                    content_type: "image/svg+xml".into(),
                    ..entry(LOGO, "asset")
                }),
            ),
        ],
        Some(app("Brand Clan", BRAND_APP)),
    )
}

fn lumen() -> ClanFile {
    brand(
        LUMEN,
        "Lumen Water",
        5,
        b"<svg>v1</svg>",
        vec![
            decision("d_3", "confirm palette"),
            decision("d_2", "read brand book"),
            decision("d_1", "open kit"),
        ],
        &["f_a", "f_b"],
    )
}

fn attach_spec(accepts: &str) -> AttachSpec {
    AttachSpec {
        accepts: vec![accepts.into()],
        lift: [
            ("brand.name".to_string(), "client".to_string()),
            ("voice.tone".to_string(), "tone_and_world".to_string()),
        ]
        .into_iter()
        .collect(),
        harvest: vec![],
    }
}

/// A brief document of an app that attaches `accepts`, born from a template.
fn brief(accepts: &str) -> ClanFile {
    let mut a = app("Brief Maker", BRIEF_APP);
    a.attach = Some(attach_spec(accepts));
    let tpl = open(make_template(&doc("Brief Maker"), a, MakeTemplateOptions::default()).unwrap());
    let inst = open(instantiate(&tpl, InstantiateOptions::default()).unwrap());
    // One decision of its own, so the order of the chain can be read.
    with(
        &inst,
        None,
        &[(
            CHAIN,
            chain_of(vec![decision("d_brief", "write the problem")]),
            None,
        )],
        None,
    )
}

fn yaml(clan: &ClanFile, path: &str) -> Value {
    serde_yaml::from_slice(&clan.read_entry(path).unwrap()).unwrap()
}

fn chain(clan: &ClanFile) -> Vec<Decision> {
    DecisionChain::from_yaml(&clan.read_entry(CHAIN).unwrap())
        .unwrap()
        .decisions
}

fn ids(clan: &ClanFile) -> Vec<String> {
    chain(clan).iter().filter_map(|d| d.id.clone()).collect()
}

fn attached_once(brief: &ClanFile, brand: &ClanFile) -> ClanFile {
    open(attach(brief, brand).unwrap().bytes)
}

#[test]
fn attach_carries_the_source_in_beside_the_documents_own_work() {
    let (brief, brand) = (brief(BRAND_APP), lumen());
    let out = attach(&brief, &brand).unwrap();
    assert_eq!(out.verb, AttachVerb::Attached);
    let got = open(out.bytes.clone());

    // The data: frozen under the source's document id, less its projection.
    let data = yaml(&got, DATA);
    let frozen = &data["upstream"][LUMEN];
    assert_eq!(frozen["brand"]["name"], Value::from("Lumen Water"));
    assert!(frozen.get("projection").is_none());

    // Seeds landed in empty fields, one decision each, above everything.
    assert_eq!(data["client"], Value::from("Lumen Water"));
    assert_eq!(data["tone_and_world"], Value::from("warm and plain"));
    assert_eq!(out.seeded, ["client", "tone_and_world"]);
    let top: Vec<_> = chain(&got).into_iter().take(3).collect();
    assert_eq!(top.iter().filter(|d| d.action == "seed").count(), 2);
    assert_eq!(top[2].action, "attach \"Lumen Water\"");
    assert!(top[2].pinned);

    // The record, with the hashes a host compares later.
    let rec = &got.manifest().attached()[0];
    assert_eq!(rec.app_id, BRAND_APP);
    assert_eq!(rec.version, Some(5));
    assert_eq!(rec.carried.document_id, LUMEN);
    assert_eq!(
        rec.carried.data_sha256,
        sha256_prefixed(&brand.read_entry(DATA).unwrap())
    );
    assert_eq!(
        rec.carried.facts_sha256.as_deref(),
        Some(sha256_prefixed(&brand.read_entry(FACTS).unwrap()).as_str())
    );
    assert_eq!(rec.carried.last_decision.as_deref(), Some("d_3"));
    assert_eq!(out.record, *rec);

    // Members merged into a target that had none: the source's bytes.
    assert_eq!(
        got.read_entry(FACTS).unwrap(),
        brand.read_entry(FACTS).unwrap()
    );
    assert_eq!(
        got.manifest().file_by_path(FACTS).unwrap().role,
        "pinned-facts"
    );
    assert_eq!(
        got.read_entry(SOURCES).unwrap(),
        brand.read_entry(SOURCES).unwrap()
    );
    assert_eq!(got.read_entry(LOGO).unwrap(), b"<svg>v1</svg>");

    // The chain: the document's own decision first, then a boundary, then the
    // kit's decisions exactly as it wrote them, none force-pinned.
    assert_eq!(out.carried_decisions, 3);
    let known = |c: &ClanFile| -> Vec<String> {
        ids(c)
            .into_iter()
            .filter(|i| !i.starts_with("d_0"))
            .collect()
    };
    assert_eq!(known(&got), ["d_brief", "d_3", "d_2", "d_1"]);
    let order: Vec<_> = chain(&got).into_iter().map(|d| d.action).collect();
    let boundary = order
        .iter()
        .position(|a| a == "carried from \"Lumen Water\"")
        .unwrap();
    assert!(order.iter().position(|a| a == "write the problem").unwrap() < boundary);
    assert!(chain(&got)
        .iter()
        .filter(|d| matches!(d.id.as_deref(), Some("d_1" | "d_2" | "d_3")))
        .all(|d| !d.pinned));

    // The document is a new revision of itself, and valid.
    assert_eq!(got.manifest().document_id(), brief.manifest().document_id());
    assert_ne!(got.manifest().id, brief.manifest().id);
    assert!(validate(&got).is_valid(), "{}", validate(&got).display());
}

#[test]
fn a_seed_never_overwrites_what_a_person_wrote() {
    let brief = brief(BRAND_APP);
    let own = with(
        &brief,
        None,
        &[(DATA, b"client: Our Own Words\n".to_vec(), None)],
        None,
    );
    let out = attach(&own, &lumen()).unwrap();
    let data = yaml(&open(out.bytes), DATA);
    assert_eq!(data["client"], Value::from("Our Own Words"));
    assert_eq!(data["tone_and_world"], Value::from("warm and plain"));
    assert_eq!(out.kept, ["client"]);
    assert_eq!(out.seeded, ["tone_and_world"]);
}

#[test]
fn update_replaces_the_copy_and_adds_only_what_is_new() {
    let attached = attached_once(&brief(BRAND_APP), &lumen());
    // The kit moves on: v6, a rename, a new pin, a new logo file, one more decision.
    let v6 = brand(
        LUMEN,
        "Lumen Water Co",
        6,
        b"<svg>v2</svg>",
        vec![
            decision("d_4", "publish v6"),
            decision("d_3", "confirm palette"),
            decision("d_2", "read brand book"),
            decision("d_1", "open kit"),
        ],
        &["f_a", "f_b", "f_c"],
    );
    let out = attach(&attached, &v6).unwrap();
    assert_eq!(out.verb, AttachVerb::Updated);
    assert_eq!(out.carried_decisions, 1);
    let got = open(out.bytes);
    let data = yaml(&got, DATA);

    // The frozen copy is the new one; the seed that still held the old value moved.
    assert_eq!(data["upstream"][LUMEN]["kit"]["version"], Value::from(6));
    assert_eq!(data["client"], Value::from("Lumen Water Co"));
    assert_eq!(got.manifest().attached().len(), 1);
    assert_eq!(got.manifest().attached()[0].version, Some(6));

    // Pins by id, the document's first; the new logo wins over the old copy.
    let pins = yaml(&got, FACTS);
    let pin_ids: Vec<_> = pins["facts"]
        .as_sequence()
        .unwrap()
        .iter()
        .filter_map(|f| f["id"].as_str())
        .collect();
    assert_eq!(pin_ids, ["f_a", "f_b", "f_c"]);
    assert_eq!(got.read_entry(LOGO).unwrap(), b"<svg>v2</svg>");

    // No decision twice.
    let all = ids(&got);
    assert_eq!(all.iter().filter(|i| *i == "d_3").count(), 1);
    assert!(all.contains(&"d_4".to_string()));
    assert!(validate(&got).is_valid(), "{}", validate(&got).display());
}

#[test]
fn an_update_keeps_a_seed_a_person_has_since_edited() {
    let attached = attached_once(&brief(BRAND_APP), &lumen());
    let edited = with(
        &attached,
        None,
        &[(
            DATA,
            {
                let mut d = yaml(&attached, DATA);
                d["client"] = Value::from("Lumen, our client");
                serde_yaml::to_string(&d).unwrap().into_bytes()
            },
            None,
        )],
        None,
    );
    let v6 = brand(
        LUMEN,
        "Lumen Water Co",
        6,
        b"<svg>v2</svg>",
        vec![decision("d_3", "x")],
        &["f_a"],
    );
    let out = attach(&edited, &v6).unwrap();
    assert_eq!(out.kept, ["client"]);
    assert_eq!(
        yaml(&open(out.bytes), DATA)["client"],
        Value::from("Lumen, our client")
    );
}

#[test]
fn another_source_of_the_same_app_replaces_the_first() {
    let attached = attached_once(&brief(BRAND_APP), &lumen());
    let harbour = brand(
        HARBOUR,
        "Harbour Bank",
        2,
        b"<svg>h</svg>",
        vec![decision("d_h", "open")],
        &["f_h"],
    );
    let out = attach(&attached, &harbour).unwrap();
    assert_eq!(out.verb, AttachVerb::Replaced);
    let got = open(out.bytes);
    let data = yaml(&got, DATA);
    assert!(data["upstream"].get(LUMEN).is_none());
    assert!(data["upstream"].get(HARBOUR).is_some());
    assert_eq!(got.manifest().attached().len(), 1);
    assert_eq!(got.manifest().attached()[0].carried.document_id, HARBOUR);
    // The seed still held the first brand's name, so it moved to the second's.
    assert_eq!(data["client"], Value::from("Harbour Bank"));
    // Pins already merged stay the document's own.
    assert!(yaml(&got, FACTS)["facts"]
        .as_sequence()
        .unwrap()
        .iter()
        .any(|f| f["id"] == Value::from("f_a")));
}

#[test]
fn attach_is_refused_where_the_app_does_not_take_it() {
    let brand = lumen();
    // Accepts a different app.
    let e = attach(&brief("ie.napkin.something-else"), &brand)
        .unwrap_err()
        .to_string();
    assert!(e.contains("attaches"), "{e}");
    // Declares nothing.
    let mut a = app("Brief Maker", BRIEF_APP);
    a.attach = None;
    let tpl = open(make_template(&doc("Brief Maker"), a, MakeTemplateOptions::default()).unwrap());
    let none = open(instantiate(&tpl, InstantiateOptions::default()).unwrap());
    assert!(attach(&none, &brand).is_err());
    // Itself.
    let mut a = app("Brand Clan", BRAND_APP);
    a.attach = Some(attach_spec(BRAND_APP));
    let tpl = open(make_template(&doc("Brand Clan"), a, MakeTemplateOptions::default()).unwrap());
    let kit = open(instantiate(&tpl, InstantiateOptions::default()).unwrap());
    assert!(attach(&kit, &kit)
        .unwrap_err()
        .to_string()
        .contains("itself"));
}

#[test]
fn detach_removes_the_copy_and_unedited_seeds_and_keeps_the_pins() {
    let attached = attached_once(&brief(BRAND_APP), &lumen());
    let edited = with(
        &attached,
        None,
        &[(
            DATA,
            {
                let mut d = yaml(&attached, DATA);
                d["tone_and_world"] = Value::from("our own tone");
                serde_yaml::to_string(&d).unwrap().into_bytes()
            },
            None,
        )],
        None,
    );
    let out = detach(&edited, BRAND_APP).unwrap();
    let got = open(out.bytes);
    let data = yaml(&got, DATA);
    assert!(data.get("upstream").is_none());
    assert!(data.get("client").is_none(), "the unedited seed went");
    assert_eq!(data["tone_and_world"], Value::from("our own tone"));
    assert_eq!(out.unseeded, ["client"]);
    assert!(got.manifest().attached().is_empty());
    assert!(yaml(&got, FACTS)["facts"].as_sequence().unwrap().len() == 2);
    assert_eq!(chain(&got)[0].action, "detach");
    assert!(detach(&got, BRAND_APP).is_err());
    assert!(validate(&got).is_valid(), "{}", validate(&got).display());
}

#[test]
fn a_brief_with_a_brand_hoists_it_into_the_production() {
    let with_brand = attached_once(&brief(BRAND_APP), &lumen());
    // A production project that takes a brief whole.
    let mut a = app("Production", PRODUCTION_APP);
    a.spinoff = Some(SpinoffSpec {
        accepts: vec![BRIEF_APP.into()],
        upstream: true,
        ..Default::default()
    });
    let tpl = open(make_template(&doc("Production"), a, MakeTemplateOptions::default()).unwrap());
    let project = open(spinoff(&tpl, &with_brand, SpinoffOptions::default()).unwrap());

    let data = yaml(&project, DATA);
    let brief_id = with_brand.manifest().document_id().to_string();
    assert!(data["upstream"].get(&brief_id).is_some(), "the brief");
    assert!(data["upstream"].get(LUMEN).is_some(), "the brand, hoisted");
    assert!(
        data["upstream"][&brief_id].get("upstream").is_none(),
        "the brief's copy holds none"
    );
    // The record comes along so the project can tell the kit has moved.
    assert_eq!(project.manifest().attached().len(), 1);
    assert_eq!(project.manifest().attached()[0].carried.document_id, LUMEN);
    // And the pins merged into the brief reach the project's own.
    assert!(yaml(&project, FACTS)["facts"]
        .as_sequence()
        .unwrap()
        .iter()
        .any(|f| f["id"] == Value::from("f_a")));
    assert!(
        validate(&project).is_valid(),
        "{}",
        validate(&project).display()
    );
}

#[test]
fn a_long_chain_is_carried_whole_and_never_force_pinned() {
    let many: Vec<Decision> = (0..500)
        .rev()
        .map(|n| decision(&format!("d_{n:04}"), "publish"))
        .collect();
    let big = brand(LUMEN, "Lumen Water", 5, b"<svg/>", many, &["f_a"]);
    let out = attach(&brief(BRAND_APP), &big).unwrap();
    assert_eq!(out.carried_decisions, 500);
    let got = open(out.bytes);
    assert!(chain(&got)
        .iter()
        .filter(|d| d.action == "publish")
        .all(|d| !d.pinned));
}
