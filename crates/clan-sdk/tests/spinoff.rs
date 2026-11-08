// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! A spin-off into an app that declares `app.spinoff.upstream` carries the
//! source whole (Contract 4 §5): the data frozen under the source's document
//! id, the members merged, the chain, branches, merge report and assets byte
//! for byte, and not one address rewritten. An app that does not declare it
//! grafts as it always did.

use clan_sdk::hash::sha256_prefixed;
use clan_sdk::{
    create, make_template, patch_data, spinoff, validate, AppInfo, ClanBuilder, ClanFile,
    CreateOptions, DecisionChain, FileEntry, MakeTemplateOptions, SpinoffOptions, SpinoffSpec,
    MANIFEST_PATH, MERGE_REPORT_PATH,
};
use serde_json::json;
use serde_yaml::Value;

const DATA: &str = "shared/data.yaml";
const CHAIN: &str = "agent/decision-chain.yaml";
const FACTS: &str = "shared/facts.yaml";
const FINDINGS: &str = "shared/findings.yaml";
const SOURCES: &str = "shared/sources.yaml";

const RESEARCH_APP: &str = "ie.napkin.campaign-research";
const BRIEF_APP: &str = "ie.napkin.brief-maker";
/// The document id the example's addresses are written against.
const RESEARCH_DOC: &str = "7c1e9a42-5b3d-4f8e-9a6c-2d1f0e8b4a17";

const EXAMPLE: &str = "../../app/templates/campaign-research/example";

fn example(path: &str) -> Vec<u8> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(EXAMPLE);
    std::fs::read(dir.join(path)).unwrap()
}

const SOURCES_YAML: &str = "\
# Sources, frozen on first delivery.
sources:
  - id: src_r0st
    uri: https://example.com/roster
    title: Brand roster
    tier: primary
  - id: src_tr4d
    uri: https://example.com/trade
    title: Trade press
    tier: secondary
";

const BRANCH_DATA: &str = "report:\n  draft: a lens the scout has not merged\n";
const BRANCH_DECISIONS: &str = "decisions: []\n";
const MERGE_REPORT: &str = "\
generated_by: clan merge
conflicts:
  - key: report
    winner: { value: a, agent: scout }
    losers: [ { value: b, agent: planner } ]
unresolved: 1
";

fn open(bytes: Vec<u8>) -> ClanFile {
    ClanFile::from_bytes(bytes).unwrap()
}

fn doc(title: &str) -> ClanFile {
    open(
        create(CreateOptions {
            title: title.into(),
            brief: format!("{title}, for the spin-off tests"),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
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

/// `clan` with `add` written (and registered where a role is given) and
/// `app` set, as the same revision.
fn with(
    clan: &ClanFile,
    app: Option<AppInfo>,
    add: &[(&str, &[u8], Option<FileEntry>)],
) -> ClanFile {
    let mut manifest = clan.manifest().clone();
    if app.is_some() {
        manifest.app = app;
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
        b.add_entry(*p, v.to_vec());
    }
    open(b.build().unwrap())
}

/// A research document partway through: the example's data, pins, findings
/// and chain (open contests, bad verdicts, classify marks and all), a sources
/// member, an unmerged branch, a merge report, the client's email with its
/// extracted text, and the view-only files that must stay behind.
fn research() -> ClanFile {
    let base = doc("Lúnasa 0.0 launch");
    let mut manifest = base.manifest().clone();
    manifest.document_id = Some(RESEARCH_DOC.into());
    let base = with(
        &open({
            let mut b = ClanBuilder::new(manifest);
            for (p, v) in base.read_all_entries().unwrap() {
                if p != MANIFEST_PATH {
                    b.add_entry(p, v);
                }
            }
            b.build().unwrap()
        }),
        Some(app("Campaign Research", RESEARCH_APP, None)),
        &[],
    );
    let asset = FileEntry {
        content_type: "text/plain".into(),
        ..entry("human/assets/client-email.txt", "asset")
    };
    with(
        &base,
        None,
        &[
            (DATA, &example("shared/data.yaml"), None),
            (CHAIN, &example("agent/decision-chain.yaml"), None),
            (
                FACTS,
                &example("shared/facts.yaml"),
                Some(entry(FACTS, "pinned-facts")),
            ),
            (
                FINDINGS,
                &example("shared/findings.yaml"),
                Some(entry(FINDINGS, "findings")),
            ),
            (
                SOURCES,
                SOURCES_YAML.as_bytes(),
                Some(entry(SOURCES, "sources")),
            ),
            (
                "agents/scout/data.yaml",
                BRANCH_DATA.as_bytes(),
                Some(FileEntry {
                    id: "branch-data-scout".into(),
                    ..entry("agents/scout/data.yaml", "branch-data")
                }),
            ),
            (
                "agents/scout/decisions.yaml",
                BRANCH_DECISIONS.as_bytes(),
                Some(FileEntry {
                    id: "branch-decisions-scout".into(),
                    ..entry("agents/scout/decisions.yaml", "branch-decisions")
                }),
            ),
            (
                MERGE_REPORT_PATH,
                MERGE_REPORT.as_bytes(),
                Some(entry(MERGE_REPORT_PATH, "merge-report")),
            ),
            (
                "human/assets/client-email.txt",
                &example("assets/client-email.txt"),
                Some(asset),
            ),
            (
                "human/assets/.extracted/client-email.txt.txt",
                b"Hi team, the 0.0 launch...",
                None,
            ),
            ("human/patches.yaml", b"patches: []\n", None),
            (
                "shared/edits.yaml",
                b"edits:\n  - key: hero\n    html: Ours\n",
                None,
            ),
        ],
    )
}

fn upstream_spec(accepts: &str) -> SpinoffSpec {
    SpinoffSpec {
        accepts: vec![accepts.into()],
        upstream: true,
        ..Default::default()
    }
}

fn template(
    name: &str,
    app_id: &str,
    spec: SpinoffSpec,
    add: &[(&str, &[u8], Option<FileEntry>)],
) -> ClanFile {
    let scaffold = with(&doc(name), None, add);
    open(
        make_template(
            &scaffold,
            app(name, app_id, Some(spec)),
            MakeTemplateOptions::default(),
        )
        .unwrap(),
    )
}

fn brief_maker() -> ClanFile {
    template("Brief Maker", BRIEF_APP, upstream_spec(RESEARCH_APP), &[])
}

fn spin(template: &ClanFile, source: &ClanFile) -> ClanFile {
    open(spinoff(template, source, SpinoffOptions::default()).unwrap())
}

fn yaml(clan: &ClanFile, path: &str) -> Value {
    serde_yaml::from_slice(&clan.read_entry(path).unwrap()).unwrap()
}

fn chain(clan: &ClanFile) -> DecisionChain {
    DecisionChain::from_yaml(&clan.read_entry(CHAIN).unwrap()).unwrap()
}

/// The chain's entries as the file holds them, every field.
fn raw_decisions(clan: &ClanFile) -> Vec<Value> {
    yaml(clan, CHAIN)["decisions"]
        .as_sequence()
        .unwrap()
        .clone()
}

/// The source's data as it is frozen: less its projection and its upstream.
fn frozen(clan: &ClanFile) -> Value {
    let mut data = yaml(clan, DATA);
    let m = data.as_mapping_mut().unwrap();
    m.remove("projection");
    m.remove("upstream");
    data
}

#[test]
fn an_upstream_spinoff_carries_the_source_whole() {
    let source = research();
    let brief = spin(&brief_maker(), &source);

    // The data: frozen under the source's document id, without its
    // projection, and nothing else at the root.
    let data = yaml(&brief, DATA);
    let root: Vec<&str> = data
        .as_mapping()
        .unwrap()
        .keys()
        .filter_map(Value::as_str)
        .collect();
    assert_eq!(root, ["upstream"]);
    assert_eq!(data["upstream"][RESEARCH_DOC], frozen(&source));
    assert!(
        yaml(&source, DATA).get("projection").is_some(),
        "the example has one to drop"
    );
    assert!(data["upstream"][RESEARCH_DOC].get("projection").is_none());

    // The members, byte for byte into a target that had none, registered
    // under the source's roles.
    for (path, role) in [
        (FACTS, "pinned-facts"),
        (FINDINGS, "findings"),
        (SOURCES, "sources"),
    ] {
        assert_eq!(
            brief.read_entry(path).unwrap(),
            source.read_entry(path).unwrap(),
            "{path}"
        );
        assert_eq!(brief.manifest().file_by_path(path).unwrap().role, role);
    }

    // The unmerged branch and the assets keep their paths and their bytes.
    for path in [
        "agents/scout/data.yaml",
        "agents/scout/decisions.yaml",
        "human/assets/client-email.txt",
        "human/assets/.extracted/client-email.txt.txt",
    ] {
        assert_eq!(
            brief.read_entry(path).unwrap(),
            source.read_entry(path).unwrap(),
            "{path}"
        );
    }
    let m = brief.manifest();
    assert_eq!(
        m.file_by_path("agents/scout/data.yaml").unwrap().role,
        "branch-data"
    );
    assert_eq!(
        m.file_by_path("human/assets/client-email.txt")
            .unwrap()
            .role,
        "asset"
    );

    // The merge report sits beside the frozen copy, not at the root.
    let carried_report = format!("upstream/{RESEARCH_DOC}/merge-report.yaml");
    assert!(!brief.has_entry(MERGE_REPORT_PATH));
    assert_eq!(
        brief.read_entry(&carried_report).unwrap(),
        MERGE_REPORT.as_bytes()
    );
    assert_eq!(
        m.file_by_path(&carried_report).unwrap().role,
        "upstream-merge-report"
    );

    // What belongs to the source's view does not travel.
    assert!(!brief.has_entry("human/patches.yaml"));
    assert!(!brief.has_entry("shared/edits.yaml"));
    assert_ne!(
        brief.read_entry("human/index.html").unwrap(),
        source.read_entry("human/index.html").unwrap_or_default(),
        "the target's view, not the source's"
    );

    // The chain: the marker, then every source decision field for field —
    // open contests, bad verdicts and classify marks included — pinned.
    let src = raw_decisions(&source);
    let got = raw_decisions(&brief);
    assert_eq!(got[0]["agent"], Value::from("napkin-spinoff"));
    assert_eq!(
        got.len(),
        1 + src.len() + chain(&brief_maker()).decisions.len()
    );
    for (s, g) in src.iter().zip(&got[1..]) {
        let mut want = s.clone();
        want.as_mapping_mut()
            .unwrap()
            .insert("pinned".into(), true.into());
        assert_eq!(*g, want);
    }
    for kind in [
        "contest", "verdict", "classify", "finding", "verify", "resolve",
    ] {
        assert!(
            got.iter().any(|d| d["kind"].as_str() == Some(kind)),
            "{kind} carried"
        );
    }

    // What was carried, checkable against the parent later.
    let lineage = m.lineage.as_ref().unwrap();
    let carried = lineage.carried.as_ref().expect("lineage.carried");
    assert_eq!(carried.document_id, RESEARCH_DOC);
    assert_ne!(lineage.parent_id, RESEARCH_DOC, "parent_id is the revision");
    assert_eq!(
        carried.data_sha256,
        sha256_prefixed(&source.read_entry(DATA).unwrap())
    );
    assert_eq!(
        carried.facts_sha256,
        Some(sha256_prefixed(&source.read_entry(FACTS).unwrap()))
    );
    assert_eq!(
        carried.findings_sha256,
        Some(sha256_prefixed(&source.read_entry(FINDINGS).unwrap()))
    );
    assert_eq!(
        carried.sources_sha256,
        Some(sha256_prefixed(SOURCES_YAML.as_bytes()))
    );
    assert_eq!(carried.last_decision.as_deref(), Some("d_01JA0D12RPT"));
    assert_eq!(lineage.parents.len(), 2);
}

#[test]
fn no_address_is_rewritten() {
    let source = research();
    let brief = spin(&brief_maker(), &source);
    let refs = |c: &DecisionChain| -> Vec<String> {
        c.decisions
            .iter()
            .flat_map(|d| {
                d.targets
                    .iter()
                    .chain(&d.cites)
                    .chain(&d.superseded_by)
                    .cloned()
            })
            .collect()
    };
    let src = refs(&chain(&source));
    let got = refs(&chain(&brief));
    assert!(src
        .iter()
        .any(|r| r.starts_with(&format!("{RESEARCH_DOC}#"))));
    assert!(
        src.iter().all(|r| got.contains(r)),
        "every upstream address is still there"
    );
    assert!(
        !got.iter()
            .any(|r| r.starts_with(&format!("{}#", brief.manifest().document_id()))),
        "nothing was moved onto the new document"
    );

    // An address into the source still resolves, now under upstream: the
    // open contest is there, still open.
    let data = yaml(&brief, DATA);
    let contested = data["upstream"][RESEARCH_DOC]["selection"]["contested"]
        .as_sequence()
        .unwrap();
    let ct = contested
        .iter()
        .find(|c| c["id"].as_str() == Some("ct_orchard_hill_abv"))
        .unwrap();
    assert_eq!(ct["status"], Value::from("open"));

    // Findings stay as the source left them — a proposed one is proposed.
    assert_eq!(yaml(&brief, FINDINGS), yaml(&source, FINDINGS));
    assert!(yaml(&brief, FINDINGS)["findings"]
        .as_sequence()
        .unwrap()
        .iter()
        .any(|f| f["status"].as_str() == Some("proposed")));
}

#[test]
fn members_merge_by_id_the_targets_own_first() {
    let own = "\
facts:
  - id: f_OWN0000001
    key: own.fact
    value: 1
  - id: f_01JA0B1C2D
    key: roster.categories.primary
    value: the target's copy wins
";
    let tpl = template(
        "Brief Maker",
        BRIEF_APP,
        upstream_spec(RESEARCH_APP),
        &[(FACTS, own.as_bytes(), Some(entry(FACTS, "pinned-facts")))],
    );
    let brief = spin(&tpl, &research());
    let facts = yaml(&brief, FACTS)["facts"].as_sequence().unwrap().clone();
    let ids: Vec<&str> = facts.iter().filter_map(|f| f["id"].as_str()).collect();
    let src = yaml(&research(), FACTS)["facts"]
        .as_sequence()
        .unwrap()
        .clone();

    assert_eq!(ids[0], "f_OWN0000001");
    assert_eq!(ids[1], "f_01JA0B1C2D");
    assert_eq!(facts[1]["value"], Value::from("the target's copy wins"));
    assert_eq!(ids.len(), 2 + src.len() - 1, "the shared id is not doubled");
    // The source's own, in the source's order, field for field.
    assert_eq!(facts[2..], src[1..]);
    assert_eq!(brief.manifest().files_with_role("pinned-facts").count(), 1);
    assert!(
        validate(&brief).is_valid(),
        "{}",
        validate(&brief).display()
    );
}

#[test]
fn a_lift_copies_and_records_a_seed() {
    let spec = SpinoffSpec {
        lift: [
            ("campaign.name".to_string(), "project_name".to_string()),
            ("campaign.nothing_here".to_string(), "missing".to_string()),
        ]
        .into_iter()
        .collect(),
        ..upstream_spec(RESEARCH_APP)
    };
    let source = research();
    let brief = spin(&template("Brief Maker", BRIEF_APP, spec, &[]), &source);
    let data = yaml(&brief, DATA);
    let doc = brief.manifest().document_id().to_string();

    // Copied, not moved: the frozen copy is whole.
    assert_eq!(
        data["project_name"],
        yaml(&source, DATA)["campaign"]["name"]
    );
    assert_eq!(data["upstream"][RESEARCH_DOC], frozen(&source));
    // A lift from nothing seeds nothing.
    assert!(data.get("missing").is_none());

    let c = chain(&brief);
    let seed = &c.decisions[0];
    assert_eq!(seed.kind.as_deref(), Some("edit"));
    assert_eq!(seed.action, "seed");
    assert_eq!(seed.agent, "napkin-spinoff");
    assert_eq!(seed.actor.as_deref(), Some("process:spinoff"));
    assert_eq!(seed.targets, [format!("{doc}#project_name")]);
    assert_eq!(seed.cites, [format!("{RESEARCH_DOC}#campaign.name")]);
    assert_eq!(seed.fields_changed, ["project_name"]);
    assert!(seed.pinned);
    assert!(seed.id.as_deref().is_some_and(|id| id.starts_with("d_")));
    let r = seed.reasoning.as_ref().unwrap();
    assert!(r.problems().is_empty(), "{:?}", r.problems());
    assert_eq!(r.certainty.level, "high");
    assert_eq!(
        seed.rationale,
        "Seeded project_name from campaign.name in \"Lúnasa 0.0 launch\"."
    );
    // Newest first: the one seed, then the marker, then the source's chain.
    assert_eq!(
        c.decisions[1].action,
        "spin off \"Lúnasa 0.0 launch\" into Brief Maker"
    );
    assert_eq!(c.decisions[2].id.as_deref(), Some("d_01JA0D12RPT"));
    assert!(!c
        .decisions
        .iter()
        .any(|d| d.targets.iter().any(|t| t.ends_with("#missing"))));
}

#[test]
fn upstream_takes_no_map_and_no_lift_into_upstream() {
    let source = research();
    let declared = SpinoffSpec {
        map: Some("research".into()),
        ..upstream_spec(RESEARCH_APP)
    };
    let err = spinoff(
        &template("Brief Maker", BRIEF_APP, declared, &[]),
        &source,
        SpinoffOptions::default(),
    )
    .unwrap_err();
    assert!(err.to_string().contains("no map"), "{err}");

    let err = spinoff(
        &brief_maker(),
        &source,
        SpinoffOptions {
            map: Some("research".into()),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("no map"), "{err}");

    let into_upstream = SpinoffSpec {
        lift: [("campaign.name".to_string(), "upstream.x".to_string())]
            .into_iter()
            .collect(),
        ..upstream_spec(RESEARCH_APP)
    };
    let err = spinoff(
        &template("Brief Maker", BRIEF_APP, into_upstream, &[]),
        &source,
        SpinoffOptions::default(),
    )
    .unwrap_err();
    assert!(err.to_string().contains("read-only"), "{err}");
}

#[test]
fn without_upstream_the_root_fold_is_unchanged() {
    let source = research();
    let spec = SpinoffSpec {
        accepts: vec![RESEARCH_APP.into()],
        ..Default::default()
    };
    assert!(!spec.upstream, "off by default");
    let out = spin(&template("Brief Maker", BRIEF_APP, spec, &[]), &source);

    // The older graft: the source's data at the root, projection and all.
    assert_eq!(yaml(&out, DATA), yaml(&source, DATA));
    assert!(yaml(&out, DATA).get("upstream").is_none());
    // Only the assets travel besides the chain; nothing records a carry.
    assert!(out.has_entry("human/assets/client-email.txt"));
    for path in [
        FACTS,
        FINDINGS,
        SOURCES,
        "agents/scout/data.yaml",
        MERGE_REPORT_PATH,
    ] {
        assert!(!out.has_entry(path), "{path}");
    }
    assert!(out.manifest().lineage.as_ref().unwrap().carried.is_none());
    assert_eq!(
        chain(&out).decisions.len(),
        1 + chain(&source).decisions.len() + chain(&brief_maker()).decisions.len()
    );

    // And a declared `upstream: false` never reaches the manifest.
    let yaml = serde_yaml::to_string(&out.manifest().app.as_ref().unwrap().spinoff).unwrap();
    assert!(!yaml.contains("upstream"), "{yaml}");
}

#[test]
fn research_to_brief_to_deck_keeps_both_upstreams() {
    let research = research();
    let brief = spin(&brief_maker(), &research);
    let brief_doc = brief.manifest().document_id().to_string();
    let deck = spin(
        &template("Deck", "ie.napkin.deck", upstream_spec(BRIEF_APP), &[]),
        &brief,
    );

    let data = yaml(&deck, DATA);
    let up = data["upstream"].as_mapping().unwrap();
    assert_eq!(up.len(), 2);
    // The campaign, hoisted as the brief held it; the brief, without the
    // upstream it held.
    assert_eq!(data["upstream"][RESEARCH_DOC], frozen(&research));
    assert_eq!(data["upstream"][brief_doc.as_str()], frozen(&brief));
    assert!(data["upstream"][brief_doc.as_str()]
        .get("upstream")
        .is_none());

    // `carried` names the direct parent only.
    let carried = deck.manifest().carried().unwrap();
    assert_eq!(carried.document_id, brief_doc);
    assert_eq!(
        carried.data_sha256,
        sha256_prefixed(&brief.read_entry(DATA).unwrap())
    );

    // Everything the brief carried travels on: the members, the campaign's
    // merge report at its own path, the whole chain with both markers.
    assert_eq!(
        deck.read_entry(FINDINGS).unwrap(),
        research.read_entry(FINDINGS).unwrap()
    );
    let report = format!("upstream/{RESEARCH_DOC}/merge-report.yaml");
    assert_eq!(deck.read_entry(&report).unwrap(), MERGE_REPORT.as_bytes());
    assert!(deck.manifest().file_by_path(&report).is_some());
    let c = chain(&deck);
    assert_eq!(
        c.decisions
            .iter()
            .filter(|d| d.agent == "napkin-spinoff")
            .count(),
        2
    );
    let ids = c.ids();
    for id in chain(&research).ids() {
        assert!(ids.contains(id), "{id} reaches the deck");
    }
    assert!(validate(&deck).is_valid(), "{}", validate(&deck).display());
}

#[test]
fn the_spun_off_brief_validates_and_keeps_carried_on_its_next_write() {
    let brief = spin(&brief_maker(), &research());
    let report = validate(&brief);
    assert!(report.is_valid(), "{}", report.display());
    assert!(report.content.is_empty(), "{}", report.display());

    // `carried` describes the document, not the last write: a data patch
    // keeps it.
    let before = brief.manifest().carried().cloned();
    let next = open(patch_data(&brief, &json!({ "project_name": "Lúnasa" }), None).unwrap());
    assert_ne!(next.manifest().id, brief.manifest().id);
    assert_eq!(next.manifest().carried().cloned(), before);
    assert!(yaml(&next, DATA)["upstream"].get(RESEARCH_DOC).is_some());
}

/// The Deck template's contract: accepts a brief or a research document and
/// carries the source whole, with no map and no lift.
fn deck_template() -> ClanFile {
    let spec = SpinoffSpec {
        accepts: vec![BRIEF_APP.into(), RESEARCH_APP.into()],
        upstream: true,
        ..Default::default()
    };
    template("Deck Maker", "ie.napkin.deck-maker", spec, &[])
}

/// The id of the finding the example's research rejected.
const REJECTED_FINDING: &str = "fi_01JA0F5E";

#[test]
fn research_to_brief_to_deck_holds_both_as_siblings_and_keeps_the_rejection() {
    let research = research();
    let brief = spin(&brief_maker(), &research);
    let brief_doc = brief.manifest().document_id().to_string();
    let deck = spin(&deck_template(), &brief);

    let data = yaml(&deck, DATA);
    let up = data["upstream"].as_mapping().unwrap();
    assert_eq!(up.len(), 2, "research and brief, side by side");
    assert_eq!(data["upstream"][RESEARCH_DOC], frozen(&research));
    assert_eq!(data["upstream"][brief_doc.as_str()], frozen(&brief));
    assert!(
        data["upstream"][brief_doc.as_str()]
            .get("upstream")
            .is_none(),
        "the brief copy holds no upstream of its own"
    );

    // lineage.carried names the brief, the direct parent.
    let carried = deck.manifest().carried().expect("lineage.carried");
    assert_eq!(carried.document_id, brief_doc);
    assert_eq!(
        carried.data_sha256,
        sha256_prefixed(&brief.read_entry(DATA).unwrap())
    );

    // A finding the person rejected is still rejected, in the findings member
    // and in the carried chain.
    let findings = yaml(&deck, FINDINGS);
    let rejected = findings["findings"]
        .as_sequence()
        .unwrap()
        .iter()
        .find(|f| f["id"].as_str() == Some(REJECTED_FINDING))
        .expect("the rejected finding travels");
    assert_eq!(rejected["status"], Value::from("rejected"));
    let verdict = raw_decisions(&deck)
        .into_iter()
        .find(|d| d["action"].as_str() == Some("reject_finding"))
        .expect("the rejection stays in the chain");
    assert_eq!(verdict["polarity"], Value::from("bad"));
    assert!(verdict["cites"]
        .as_sequence()
        .unwrap()
        .iter()
        .any(|c| c.as_str() == Some(REJECTED_FINDING)));
    assert!(validate(&deck).is_valid(), "{}", validate(&deck).display());
}

#[test]
fn research_to_deck_directly_holds_the_research_alone() {
    let research = research();
    let deck = spin(&deck_template(), &research);

    let data = yaml(&deck, DATA);
    let up = data["upstream"].as_mapping().unwrap();
    assert_eq!(up.len(), 1);
    assert_eq!(data["upstream"][RESEARCH_DOC], frozen(&research));
    let carried = deck.manifest().carried().expect("lineage.carried");
    assert_eq!(carried.document_id, RESEARCH_DOC);
    assert!(validate(&deck).is_valid(), "{}", validate(&deck).display());
}

/// Runs the real packer (`examples/make_deck_maker.rs`, through `cargo run`, which
/// builds it when it is not built yet: CI starts from an empty target directory)
/// and checks the packed template's spin-off contract and version, so a
/// regression in the packer is caught here and not only in a hand-built twin.
#[test]
fn the_packed_deck_maker_declares_its_spinoff_contract() {
    let out = std::env::temp_dir().join(format!("deck-maker-pack-{}", std::process::id()));
    std::fs::create_dir_all(&out).unwrap();
    let app_path = out.join("deck-maker.app.clan");
    let example_path = out.join("deck-maker.example.clan");
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let run = std::process::Command::new(cargo)
        .args([
            "run",
            "-q",
            "--locked",
            "-p",
            "clan-sdk",
            "--example",
            "make_deck_maker",
            "--",
        ])
        .arg(&app_path)
        .arg(&example_path)
        .output()
        .unwrap();
    assert!(
        run.status.success(),
        "packer failed: {}",
        String::from_utf8_lossy(&run.stderr)
    );
    let packed = open(std::fs::read(&app_path).unwrap());
    let _ = std::fs::remove_dir_all(&out);
    let app = packed.manifest().app.as_ref().expect("app block");
    assert_eq!(app.app_id, "ie.napkin.deck-maker");
    assert_eq!(app.version, "0.2.0");
    let spec = app.spinoff.as_ref().expect("app.spinoff");
    assert_eq!(
        spec.accepts,
        vec![BRIEF_APP.to_string(), RESEARCH_APP.to_string()]
    );
    assert!(spec.upstream);
}

// ── Taking the parent's newer version (§5.5, reversed for spin-offs) ─────────

/// The research moved on after the brief was spun off: a field changed, one
/// more pin, one more decision.
fn research_moved_on(research: &ClanFile) -> ClanFile {
    let mut data = yaml(research, DATA);
    data["report"] = serde_yaml::from_str("headline: the newer answer").unwrap();
    let mut facts = yaml(research, FACTS);
    facts["facts"].as_sequence_mut().unwrap().push(
        serde_yaml::from_str(
            "id: f_01NEWPIN01\nentity: brand/lunasa\nkey: price.rrp\nvalue: 2.5\nstatus: active",
        )
        .unwrap(),
    );
    let chain_text = String::from_utf8(research.read_entry(CHAIN).unwrap()).unwrap();
    let chain_text = chain_text.replacen(
        "decisions:\n",
        "decisions:\n  - id: d_01NEWDEC01\n    kind: edit\n    agent: drafter\n    action: redraft the report\n    rationale: The newer answer.\n    timestamp: 2026-11-01T10:00:00Z\n",
        1,
    );
    let mut manifest = research.manifest().clone();
    manifest.next_revision();
    let next = open({
        let mut b = ClanBuilder::new(manifest);
        for (p, v) in research.read_all_entries().unwrap() {
            if p != MANIFEST_PATH && p != DATA && p != FACTS && p != CHAIN {
                b.add_entry(p, v);
            }
        }
        b.add_entry(DATA, serde_yaml::to_string(&data).unwrap().into_bytes());
        b.add_entry(FACTS, serde_yaml::to_string(&facts).unwrap().into_bytes());
        b.add_entry(CHAIN, chain_text.into_bytes());
        b.build().unwrap()
    });
    assert!(chain(&next).decisions[0].id.as_deref() == Some("d_01NEWDEC01"));
    next
}

fn update_marker() -> clan_sdk::Decision {
    let mut d = clan_sdk::Decision::new(
        "napkin-host",
        "update_from_research",
        "Took the newer research.",
        "2026-11-09T10:00:00Z",
    );
    d.id = Some("d_01UPDATE001".into());
    d
}

#[test]
fn taking_the_newer_parent_replaces_the_frozen_copy_and_keeps_the_childs_own() {
    let research = research();
    let brief = spin(&brief_maker(), &research);
    let brief = open(patch_data(&brief, &json!({ "project_name": "Lúnasa" }), None).unwrap());
    let before = chain(&brief).decisions.len();
    let newer = research_moved_on(&research);

    let taken = clan_sdk::take_upstream(&brief, &newer, update_marker()).unwrap();
    assert_eq!(taken.decisions_taken, 1);
    let next = open(taken.bytes);

    // The child's own field stays; the frozen copy is the parent now.
    let data = yaml(&next, DATA);
    assert_eq!(data["project_name"], Value::from("Lúnasa"));
    assert_eq!(data["upstream"][RESEARCH_DOC], frozen(&newer));
    // The same document, its next revision.
    assert_eq!(
        next.manifest().document_id(),
        brief.manifest().document_id()
    );
    assert_ne!(next.manifest().id, brief.manifest().id);

    // Marker on top, then the one new parent decision, pinned, then the rest.
    let c = chain(&next);
    assert_eq!(c.decisions.len(), before + 2);
    assert_eq!(c.decisions[0].action, "update_from_research");
    assert_eq!(c.decisions[1].id.as_deref(), Some("d_01NEWDEC01"));
    assert!(c.decisions[1].pinned);

    // The new pin is merged in; carried moved on to what was taken.
    let facts = yaml(&next, FACTS);
    assert!(facts["facts"]
        .as_sequence()
        .unwrap()
        .iter()
        .any(|f| f["id"] == Value::from("f_01NEWPIN01")));
    let carried = next.manifest().carried().unwrap();
    assert_eq!(
        carried.data_sha256,
        sha256_prefixed(&newer.read_entry(DATA).unwrap())
    );
    assert_eq!(
        carried.facts_sha256.as_deref(),
        Some(sha256_prefixed(&newer.read_entry(FACTS).unwrap()).as_str())
    );
    assert_eq!(carried.last_decision.as_deref(), Some("d_01NEWDEC01"));
    let report = validate(&next);
    assert!(report.is_valid(), "{}", report.display());

    // Taking it again finds nothing new to carry.
    let again = clan_sdk::take_upstream(&next, &newer, update_marker()).unwrap();
    assert_eq!(again.decisions_taken, 0);
}

#[test]
fn taking_upstream_refuses_a_document_with_no_parent_or_the_wrong_one() {
    let research = research();
    let plain = doc("Not a spin-off");
    let err = clan_sdk::take_upstream(&plain, &research, update_marker()).unwrap_err();
    assert!(err.to_string().contains("not spun off"), "{err}");

    let brief = spin(&brief_maker(), &research);
    let err = clan_sdk::take_upstream(&brief, &doc("Someone else"), update_marker()).unwrap_err();
    assert!(err.to_string().contains("carries"), "{err}");
}

/// The Research Tool's contract: a brief starts a research, carried whole
/// (features/spinoff-and-links.clan), and the spun-off research validates
/// against the research's own schema with the brief frozen under upstream.
#[test]
fn the_packed_research_tool_takes_a_brief_carried_whole() {
    let out = std::env::temp_dir().join(format!("research-pack-{}", std::process::id()));
    std::fs::create_dir_all(&out).unwrap();
    let app_path = out.join("campaign-research.app.clan");
    let example_path = out.join("campaign-research.example.clan");
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let run = std::process::Command::new(cargo)
        .args([
            "run",
            "-q",
            "--locked",
            "-p",
            "clan-sdk",
            "--example",
            "make_campaign_research",
            "--",
        ])
        .arg(&app_path)
        .arg(&example_path)
        .output()
        .unwrap();
    assert!(
        run.status.success(),
        "packer failed: {}",
        String::from_utf8_lossy(&run.stderr)
    );
    let packed = open(std::fs::read(&app_path).unwrap());
    let _ = std::fs::remove_dir_all(&out);
    let app = packed.manifest().app.as_ref().expect("app block").clone();
    assert_eq!(app.app_id, RESEARCH_APP);
    assert_eq!(app.version, "0.5.0");
    let spec = app.spinoff.as_ref().expect("app.spinoff");
    assert_eq!(spec.accepts, vec![BRIEF_APP.to_string()]);
    assert!(spec.upstream && spec.map.is_none() && spec.lift.is_empty());

    let brief = with(
        &doc("Lúnasa brief"),
        Some(app_info_brief()),
        &[(
            DATA,
            b"client: Orchard Hill Cider\naudience: Irish adults\nsingle_minded_proposition: Drafted\n",
            None,
        )],
    );
    let research = spin(&packed, &brief);
    let data = yaml(&research, DATA);
    let brief_id = brief.manifest().document_id().to_string();
    assert_eq!(
        data["upstream"][brief_id.as_str()]["client"],
        Value::from("Orchard Hill Cider")
    );
    assert!(
        data.get("campaign").is_none(),
        "no lift: extract_ask proposes"
    );
    let report = validate(&research);
    assert!(report.is_valid(), "{}", report.display());
}

fn app_info_brief() -> AppInfo {
    app("Brief Maker", BRIEF_APP, None)
}
