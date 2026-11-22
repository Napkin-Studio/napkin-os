// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Continue in, Territories (feature territories-spinoff-in). The REAL packed Territories template (`examples/make_territories.rs`,
//! run through `cargo run`) is installed in a library beside a Brief Maker and a Research Tool document, and the host's own
//! `spinoff_targets` and `spinoff_document` do the rest: the targets offered, the source carried whole, what the host builds on top
//! (`data.projection`), and that nothing is pre-approved.
//!
//! The finished spin-off (research to brief to Territories) is also the fixture the engine reader (`engine/territory/carried.py`)
//! and the app (`app/templates/territories/index.html`) are tested against: `app/templates/territories/example/spunoff/`. The test
//! fails when the committed fixture differs from what the host produces; `NAPKIN_UPDATE_FIXTURES=1` rewrites it.

use std::collections::HashMap;
use std::sync::Mutex;

use clan_sdk::{
    create, make_template, spinoff, AppInfo, ClanBuilder, ClanFile, CreateOptions, FileEntry,
    MakeTemplateOptions, SpinoffOptions, SpinoffSpec, MANIFEST_PATH,
};
use napkin_host::library::{install_app, spinoff_document, spinoff_targets};
use napkin_host::{Change, DocId, HostError, HostResult, Library, PartStore, Version};
use serde_json::{json, Value};

const TERRITORIES: &str = "ie.napkin.territories";
const BRIEF_APP: &str = "ie.napkin.brief-maker";
const RESEARCH_APP: &str = "ie.napkin.campaign-research";
const RESEARCH_DOC: &str = "7c1e9a42-5b3d-4f8e-9a6c-2d1f0e8b4a17";
const BRIEF_DOC: &str = "5b0d3a7e-4c1f-4e2a-9a55-1d6c0f2b7e11";
const DATA: &str = "shared/data.yaml";

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
        let mut v: Vec<DocId> = self
            .files
            .lock()
            .unwrap()
            .keys()
            .filter(|k| k.starts_with("apps/"))
            .map(DocId::new)
            .collect();
        v.sort();
        v
    }
    fn app_template(&self, app_id: &str) -> DocId {
        DocId::new(format!("apps/{app_id}/app.clan"))
    }
    fn documents(&self) -> Vec<DocId> {
        self.files
            .lock()
            .unwrap()
            .keys()
            .filter(|k| k.starts_with("docs/"))
            .map(DocId::new)
            .collect()
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

fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The Territories template as the packer writes it (the packer asserts its own contract).
fn packed_territories() -> Vec<u8> {
    // Once per test binary: the tests run in parallel and the packer writes its files under one directory.
    static PACKED: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    PACKED.get_or_init(pack_territories).clone()
}

fn pack_territories() -> Vec<u8> {
    let out = std::env::temp_dir().join(format!("territories-pack-{}", std::process::id()));
    std::fs::create_dir_all(&out).unwrap();
    let (app, ex) = (out.join("t.app.clan"), out.join("t.example.clan"));
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let run = std::process::Command::new(cargo)
        .args([
            "run",
            "-q",
            "--locked",
            "-p",
            "clan-sdk",
            "--example",
            "make_territories",
            "--",
        ])
        .arg(&app)
        .arg(&ex)
        .current_dir(root())
        .output()
        .unwrap();
    assert!(
        run.status.success(),
        "make_territories failed: {}",
        String::from_utf8_lossy(&run.stderr)
    );
    std::fs::read(&app).unwrap()
}

fn app(name: &str, app_id: &str, spinoff: Option<SpinoffSpec>) -> AppInfo {
    AppInfo {
        home: None,
        name: name.into(),
        app_id: app_id.into(),
        version: "0.6.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: Some("agent/output-schema.json".into()),
        prompt_templates: vec![],
        data_seed: None,
        spinoff,
        attach: None,
    }
}

fn blank(title: &str) -> ClanFile {
    ClanFile::from_bytes(
        create(CreateOptions {
            title: title.into(),
            brief: "fixture".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap()
}

fn reg(path: &str, role: &str) -> FileEntry {
    FileEntry {
        id: role.into(),
        path: path.into(),
        role: role.into(),
        content_type: "application/yaml".into(),
        priority: None,
        sha256: None,
    }
}

/// `clan` with these entries written (registered when given a role), the document id and the app set.
fn with(
    clan: &ClanFile,
    doc_id: Option<&str>,
    app_info: Option<AppInfo>,
    add: &[(&str, Vec<u8>, Option<FileEntry>)],
) -> ClanFile {
    let mut m = clan.manifest().clone();
    if let Some(id) = doc_id {
        m.document_id = Some(id.into());
    }
    if app_info.is_some() {
        m.app = app_info;
    }
    for (_, _, r) in add {
        if let Some(r) = r {
            m.files.retain(|f| f.path != r.path);
            m.files.push(r.clone());
        }
    }
    let mut b = ClanBuilder::new(m);
    for (p, v) in clan.read_all_entries().unwrap() {
        if p != MANIFEST_PATH && !add.iter().any(|(a, _, _)| *a == p) {
            b.add_entry(p, v);
        }
    }
    for (p, v, _) in add {
        b.add_entry(*p, v.clone());
    }
    ClanFile::from_bytes(b.build().unwrap()).unwrap()
}

fn example(path: &str) -> Vec<u8> {
    std::fs::read(
        root()
            .join("app/templates/campaign-research/example")
            .join(path),
    )
    .unwrap()
}

/// A Research Tool document: the example's data, pins, findings, chain and client email.
fn research() -> ClanFile {
    with(
        &blank("Lúnasa 0.0 launch"),
        Some(RESEARCH_DOC),
        Some(app("Campaign Research", RESEARCH_APP, None)),
        &[
            (DATA, example("shared/data.yaml"), None),
            (
                "agent/decision-chain.yaml",
                example("agent/decision-chain.yaml"),
                None,
            ),
            (
                "shared/facts.yaml",
                example("shared/facts.yaml"),
                Some(reg("shared/facts.yaml", "pinned-facts")),
            ),
            (
                "shared/findings.yaml",
                example("shared/findings.yaml"),
                Some(reg("shared/findings.yaml", "findings")),
            ),
            (
                "human/assets/client-email.txt",
                example("assets/client-email.txt"),
                Some(FileEntry {
                    content_type: "text/plain".into(),
                    ..reg("human/assets/client-email.txt", "asset")
                }),
            ),
        ],
    )
}

/// Brief Maker's data as Brief Maker keeps it: its own keys, a value bare or with its provenance, a list for the mandatories.
fn brief_data() -> serde_yaml::Value {
    serde_yaml::from_str(
        "project_name: Lúnasa 0.0 launch brief\n\
         background: Lúnasa is launching an alcohol-free version of its cider.\n\
         objectives: Trial among people who cut back on alcohol this year.\n\
         audience:\n  value: Moderate drinkers in their thirties who still go out most weekends.\n  origin: stated\n\
         insight: Nobody wants to be the person with the odd drink in their hand.\n\
         single_minded_proposition: The same round, the same good time.\n\
         tone_and_world: Warm, dry, never worthy.\n\
         mandatories:\n  - 0.0% ABV on the front of pack\n  - No health claims\n\
         locked: true\n",
    )
    .unwrap()
}

/// The brief as Brief Maker holds it: spun off from the research (so it holds the research upstream), then its own fields written.
fn brief(research: &ClanFile) -> ClanFile {
    let spec = SpinoffSpec {
        accepts: vec![RESEARCH_APP.into()],
        upstream: true,
        ..Default::default()
    };
    let tpl = ClanFile::from_bytes(
        make_template(
            &blank("Brief Maker"),
            app("Brief Maker", BRIEF_APP, Some(spec)),
            MakeTemplateOptions::default(),
        )
        .unwrap(),
    )
    .unwrap();
    let made = ClanFile::from_bytes(
        spinoff(
            &tpl,
            research,
            SpinoffOptions {
                instance_id: Some(BRIEF_DOC.into()),
                ..Default::default()
            },
        )
        .unwrap(),
    )
    .unwrap();
    let mut data: serde_yaml::Mapping =
        serde_yaml::from_slice(&made.read_entry(DATA).unwrap()).unwrap();
    for (k, v) in brief_data().as_mapping().unwrap() {
        data.insert(k.clone(), v.clone());
    }
    with(
        &made,
        None,
        None,
        &[(
            DATA,
            serde_yaml::to_string(&data).unwrap().into_bytes(),
            None,
        )],
    )
}

fn put(store: &MemStore, name: &str, clan: &ClanFile) -> DocId {
    let id = DocId::new(format!("docs/{name}.clan"));
    store
        .apply(&Change::create(id.clone(), clan.raw_bytes().to_vec()))
        .unwrap();
    id
}

fn open(store: &MemStore, id: &DocId) -> ClanFile {
    ClanFile::from_bytes(store.read(id).unwrap()).unwrap()
}

fn json_of(clan: &ClanFile, path: &str) -> Value {
    serde_json::to_value(
        serde_yaml::from_slice::<serde_yaml::Value>(&clan.read_entry(path).unwrap()).unwrap(),
    )
    .unwrap()
}

fn ids(v: &Value, key: &str) -> Vec<String> {
    v[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn territories_is_offered_for_a_brief_and_for_research_only_when_installed() {
    let store = MemStore::default();
    let names = |source: &str| -> Vec<String> {
        spinoff_targets(&store, Some(source))
            .into_iter()
            .map(|t| t.name)
            .collect()
    };
    assert!(
        names(BRIEF_APP).is_empty(),
        "nothing installed: nothing offered"
    );
    install_app(&store, packed_territories()).unwrap();
    for source in [BRIEF_APP, RESEARCH_APP] {
        let t = spinoff_targets(&store, Some(source));
        assert_eq!(t.len(), 1, "{source}");
        assert_eq!(
            (t[0].app_id.as_str(), t[0].name.as_str()),
            (TERRITORIES, "Territories")
        );
        assert!(
            t[0].upstream && t[0].map.is_none(),
            "carried whole, nothing mapped"
        );
    }
    assert!(
        names("ie.napkin.film").is_empty(),
        "a tool Territories does not accept is not offered it"
    );
}

#[test]
fn a_target_that_is_not_installed_is_refused_by_name() {
    let store = MemStore::default();
    let source = put(&store, "research", &research());
    let err = spinoff_document(&store, &source, TERRITORIES, None, None)
        .expect_err("not installed is an error");
    assert!(err.message.contains("app not installed"), "{}", err.message);
    assert!(
        err.message.contains("Territories") || err.message.contains(TERRITORIES),
        "the refusal names the tool: {}",
        err.message
    );
}

#[test]
fn a_brief_and_its_research_are_carried_whole_and_nothing_is_approved() {
    let store = MemStore::default();
    install_app(&store, packed_territories()).unwrap();
    let research = research();
    let brief = brief(&research);
    let source = put(&store, "brief", &brief);

    let made = spinoff_document(&store, &source, TERRITORIES, None, None).unwrap();
    let t = open(&store, &made);
    let data = json_of(&t, DATA);

    // The brief, whole: every field it holds, under its own key, value for value (nothing copied out of it into the document's own members).
    let up = data["upstream"].as_object().unwrap();
    assert_eq!(
        up.len(),
        2,
        "the brief and the research, side by side: {:?}",
        up.keys()
    );
    let frozen_brief = &up[BRIEF_DOC];
    for (k, v) in brief_data().as_mapping().unwrap() {
        let k = k.as_str().unwrap();
        assert_eq!(
            frozen_brief[k],
            serde_json::to_value(v).unwrap(),
            "brief field {k} did not arrive whole"
        );
    }
    assert!(frozen_brief.get("upstream").is_none() && frozen_brief.get("projection").is_none());
    // The research, whole: the data as the Research Tool keeps it.
    // (less what the Research Tool's host derived, `projection`, which the new document's host rebuilds from the merged members).
    let mut research_data = json_of(&research, DATA);
    research_data.as_object_mut().unwrap().remove("projection");
    assert_eq!(up[RESEARCH_DOC], research_data);
    // Nothing of either was copied into the document's own members.
    // A spun-off document holds exactly what was carried and what the host derived from it: the engine's own members (crew, routes,
    // the run) arrive with its first write, as in every other Napkin app.
    let mut keys: Vec<&str> = data
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    assert_eq!(keys, ["projection", "upstream"]);

    // The lineage names the brief; the decisions, pins, findings and assets came with it.
    let carried = t.manifest().carried().expect("lineage.carried is set");
    assert_eq!(carried.document_id, BRIEF_DOC);
    let facts = json_of(&t, "shared/facts.yaml");
    let findings = json_of(&t, "shared/findings.yaml");
    for id in ids(&json_of(&research, "shared/facts.yaml"), "facts") {
        assert!(
            ids(&facts, "facts").contains(&id),
            "pin {id} did not arrive"
        );
    }
    for id in ids(&json_of(&research, "shared/findings.yaml"), "findings") {
        assert!(
            ids(&findings, "findings").contains(&id),
            "finding {id} did not arrive"
        );
    }
    let chain = json_of(&t, "agent/decision-chain.yaml");
    assert!(
        chain["decisions"].as_array().unwrap().len()
            >= json_of(&research, "agent/decision-chain.yaml")["decisions"]
                .as_array()
                .unwrap()
                .len(),
        "the research's decisions travel in the chain"
    );
    assert!(
        t.has_entry("human/assets/client-email.txt"),
        "the asset arrived"
    );

    // The host built the projection from the merged members: what the screen counts.
    let proj = &data["projection"];
    assert_eq!(
        proj["pins"].as_object().unwrap().len(),
        ids(&facts, "facts").len()
    );
    assert_eq!(
        proj["findings"].as_object().unwrap().len(),
        ids(&findings, "findings").len()
    );

    // No gate is pre-passed: nothing is approved, however often the same source is carried.
    // (No `run` at all: no gate is open and none has been passed. The engine writes `run.approvals` empty with its first stage.)
    assert!(data.get("run").is_none(), "a spin-off carries no run state");
    let again = open(
        &store,
        &spinoff_document(&store, &source, TERRITORIES, None, None).unwrap(),
    );
    assert!(json_of(&again, DATA).get("run").is_none());

    // The fixture the engine reader and the app are tested against.
    let mut snap = data.clone();
    snap["projection"]["built_from"]["built_at"] = json!("");
    let dir = root().join("app/templates/territories/example/spunoff");
    let files = [
        ("data.json", snap),
        ("facts.json", facts),
        ("findings.json", findings),
    ];
    for (name, v) in files {
        let text = serde_json::to_string_pretty(&v).unwrap() + "\n";
        let path = dir.join(name);
        if std::env::var_os("NAPKIN_UPDATE_FIXTURES").is_some() {
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(&path, text).unwrap();
            continue;
        }
        let have: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_else(|_| {
                panic!(
                    "{} is missing: run with NAPKIN_UPDATE_FIXTURES=1",
                    path.display()
                )
            }))
            .unwrap();
        assert_eq!(
            have,
            serde_json::from_str::<Value>(&text).unwrap(),
            "{name} differs from what the host produces: run with NAPKIN_UPDATE_FIXTURES=1 and commit it"
        );
    }
}

#[test]
fn a_brief_alone_or_research_alone_or_neither_all_work() {
    let store = MemStore::default();
    install_app(&store, packed_territories()).unwrap();

    // Research alone: held under its own id, no brief.
    let r = put(&store, "research", &research());
    let t = open(
        &store,
        &spinoff_document(&store, &r, TERRITORIES, None, None).unwrap(),
    );
    let up = json_of(&t, DATA)["upstream"].clone();
    assert_eq!(up.as_object().unwrap().len(), 1);
    assert!(up.get(RESEARCH_DOC).is_some());
    assert_eq!(t.manifest().carried().unwrap().document_id, RESEARCH_DOC);

    // A brief alone (written by hand, spun off from nothing): held under its own id, no research.
    let alone = with(
        &blank("Solo brief"),
        Some(BRIEF_DOC),
        Some(app("Brief Maker", BRIEF_APP, None)),
        &[(
            DATA,
            serde_yaml::to_string(&brief_data()).unwrap().into_bytes(),
            None,
        )],
    );
    let b = put(&store, "solo", &alone);
    let t = open(
        &store,
        &spinoff_document(&store, &b, TERRITORIES, None, None).unwrap(),
    );
    let data = json_of(&t, DATA);
    assert_eq!(data["upstream"].as_object().unwrap().len(), 1);
    assert_eq!(
        data["upstream"][BRIEF_DOC]["insight"],
        json!("Nobody wants to be the person with the odd drink in their hand.")
    );

    // Neither: a document made straight from the template starts blank and valid.
    let id = napkin_host::library::create_instance(&store, TERRITORIES, None).unwrap();
    let blank_doc = open(&store, &id);
    let data = json_of(&blank_doc, DATA);
    assert!(data.get("upstream").is_none() && data.get("run").is_none());
}
