// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The extract's `deck_inputs` printer (features/deck-maker-spinoff-inputs.clan): the example
//! research, spun into a Brief that holds a brief's fields, spun into a Deck, printed as the Deck
//! engine's `inputs.from_upstream` takes it. A `model: false` value is left out of the field or row
//! that holds it and replaced wherever it appears in another; only an allowlist of the brief is
//! printed; only the verdicts of the chain; and nothing here halts a deck.

use clan_sdk::extract::{self, DECK_BRIEF_KEYS, MARKED};
use clan_sdk::{
    create, make_template, spinoff, AppInfo, ClanBuilder, ClanFile, CreateOptions, Decision,
    DecisionChain, FileEntry, MakeTemplateOptions, SpinoffOptions, SpinoffSpec, MANIFEST_PATH,
};
use serde_json::Value;

const DATA: &str = "shared/data.yaml";
const CHAIN: &str = "agent/decision-chain.yaml";
const FACTS: &str = "shared/facts.yaml";
const FINDINGS: &str = "shared/findings.yaml";
const SOURCES: &str = "shared/sources.yaml";

const RESEARCH_APP: &str = "ie.napkin.campaign-research";
const BRIEF_APP: &str = "ie.napkin.brief-maker";
const DECK_APP: &str = "ie.napkin.deck-maker";
/// The research document id the example's addresses are written against.
const R: &str = "7c1e9a42-5b3d-4f8e-9a6c-2d1f0e8b4a17";
/// The brief's own document id in these tests.
const B: &str = "b1e5b1e5-0000-4000-8000-000000000b01";

const EXAMPLE: &str = "../../app/templates/campaign-research/example";
/// A value that appears only in the brief's audience field, and again in a brief field and a decision.
const AUDIENCE: &str = "Lapsed weeknight drinkers in Cork";

const BRIEF_DATA: &str = "\
background: Harbour Tonic is losing midweek drinkers.
objectives: Grow midweek volume by eight percent.
audience: Lapsed weeknight drinkers in Cork
insight: A weeknight drink has to earn its place, and lapsed weeknight drinkers in Cork say so.
single_minded_proposition: The weeknight tonic.
client_secret: this key is not a brief field the engine reads
open_questions:
  - How will the work be judged?
capture:
  how_to_win:
    - kind: criteria
      point: They score on midweek volume.
      evidence: the brief
";

const SOURCES_YAML: &str = "sources:\n  - id: src_r0st\n    uri: https://example.com/roster\n    title: Brand roster\n    tier: primary\n";

fn example(path: &str) -> Vec<u8> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(EXAMPLE);
    std::fs::read(dir.join(path)).unwrap()
}

fn open(bytes: Vec<u8>) -> ClanFile {
    ClanFile::from_bytes(bytes).unwrap()
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

fn rebuild(
    clan: &ClanFile,
    edit: impl FnOnce(&mut clan_sdk::Manifest),
    add: &[(&str, Vec<u8>, Option<FileEntry>)],
) -> ClanFile {
    let mut manifest = clan.manifest().clone();
    edit(&mut manifest);
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

fn scaffold(title: &str) -> ClanFile {
    open(
        create(CreateOptions {
            title: title.into(),
            brief: "a test document".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
}

fn research() -> ClanFile {
    rebuild(
        &scaffold("Lúnasa 0.0 launch"),
        |m| {
            m.document_id = Some(R.into());
            m.app = Some(app("Campaign Research", RESEARCH_APP, None));
        },
        &[
            (DATA, example("shared/data.yaml"), None),
            (CHAIN, example("agent/decision-chain.yaml"), None),
            (
                FACTS,
                example("shared/facts.yaml"),
                Some(entry(FACTS, "pinned-facts")),
            ),
            (
                FINDINGS,
                example("shared/findings.yaml"),
                Some(entry(FINDINGS, "findings")),
            ),
            (
                SOURCES,
                SOURCES_YAML.as_bytes().to_vec(),
                Some(entry(SOURCES, "sources")),
            ),
        ],
    )
}

fn template(name: &str, id: &str, accepts: Vec<String>) -> ClanFile {
    let spec = SpinoffSpec {
        accepts,
        upstream: true,
        pin_source_decisions: true,
        ..Default::default()
    };
    open(
        make_template(
            &scaffold(name),
            app(name, id, Some(spec)),
            MakeTemplateOptions::default(),
        )
        .unwrap(),
    )
}

/// The brief: research spun into a Brief Maker, then given its own fields.
fn brief() -> ClanFile {
    let spun = open(
        spinoff(
            &template("Brief Maker", BRIEF_APP, vec![RESEARCH_APP.into()]),
            &research(),
            SpinoffOptions::default(),
        )
        .unwrap(),
    );
    // The brief's fields are added to its data: the research it carries (data.upstream) stays.
    let mut data: serde_yaml::Value =
        serde_yaml::from_slice(&spun.read_entry(DATA).unwrap()).unwrap();
    let extra: serde_yaml::Value = serde_yaml::from_str(BRIEF_DATA).unwrap();
    for (k, v) in extra.as_mapping().unwrap() {
        data.as_mapping_mut().unwrap().insert(k.clone(), v.clone());
    }
    rebuild(
        &spun,
        |m| m.document_id = Some(B.into()),
        &[(
            DATA,
            serde_yaml::to_string(&data).unwrap().into_bytes(),
            None,
        )],
    )
}

/// The Deck: the brief spun into a Deck Maker, which carries the brief and, hoisted, the research.
fn deck() -> ClanFile {
    open(
        spinoff(
            &template(
                "Deck Maker",
                DECK_APP,
                vec![BRIEF_APP.into(), RESEARCH_APP.into()],
            ),
            &brief(),
            SpinoffOptions::default(),
        )
        .unwrap(),
    )
}

fn with_decisions(clan: &ClanFile, decisions: Vec<Decision>) -> ClanFile {
    let mut chain = DecisionChain::from_yaml(&clan.read_entry(CHAIN).unwrap()).unwrap();
    for d in decisions.into_iter().rev() {
        chain.prepend(d);
    }
    rebuild(clan, |_| {}, &[(CHAIN, chain.to_yaml().unwrap(), None)])
}

fn person(id: &str, kind: &str, action: &str, targets: &[&str], rationale: &str) -> Decision {
    let mut d = Decision::new("human", action, rationale, "2026-09-25T10:00:00Z");
    d.id = Some(id.into());
    d.kind = Some(kind.into());
    d.actor = Some("human:u_aoife".into());
    d.targets = targets.iter().map(|t| t.to_string()).collect();
    d
}

fn not_for_agents(id: &str, target: &str) -> Decision {
    let mut d = person(id, "classify", "classify", &[target], "Not for any model.");
    d.licence = Some(clan_sdk::decision::Licence {
        model: Some(false),
        export: Some(false),
        corpus: Some(false),
        ..Default::default()
    });
    d
}

fn print(clan: &ClanFile) -> (Value, Vec<String>) {
    let out = extract::deck_inputs(clan).expect("the deck carries a brief and research");
    (
        out.payload,
        out.skipped
            .into_iter()
            .map(|s| format!("{}: {}", s.what, s.why))
            .collect(),
    )
}

fn text(v: &Value) -> String {
    serde_json::to_string(v).unwrap()
}

fn upstream_of(p: &Value) -> &serde_json::Map<String, Value> {
    p["data"]["upstream"].as_object().unwrap()
}

#[test]
fn a_deck_carrying_a_brief_and_research_prints_both_in_the_shape_from_upstream_takes() {
    let (p, skipped) = print(&deck());
    assert!(skipped.is_empty(), "{skipped:?}");
    let up = upstream_of(&p);
    assert_eq!(
        up.len(),
        2,
        "the brief and the research, hoisted: {:?}",
        up.keys().collect::<Vec<_>>()
    );
    let b = &up[B];
    assert_eq!(b["background"], "Harbour Tonic is losing midweek drinkers.");
    assert_eq!(
        b["capture"]["how_to_win"][0]["point"],
        "They score on midweek volume."
    );
    assert_eq!(b["open_questions"][0], "How will the work be judged?");
    assert!(
        up[R]["campaign"]["name"].is_string(),
        "the research's name is printed"
    );
    for k in ["facts", "findings", "sources"] {
        assert!(
            !p["members"][k].as_array().unwrap().is_empty(),
            "{k} are printed"
        );
    }
}

#[test]
fn only_the_allowlist_of_the_brief_is_printed() {
    let (p, _) = print(&deck());
    let b = upstream_of(&p)[B].as_object().unwrap();
    for k in b.keys() {
        assert!(
            DECK_BRIEF_KEYS.contains(&k.as_str()) || k == "capture",
            "{k} is not a field the engine reads"
        );
    }
    assert!(!text(&p).contains("client_secret") && !text(&p).contains("not a brief field"));
}

#[test]
fn a_brief_field_marked_not_for_agents_is_left_out_and_its_value_is_replaced_everywhere() {
    let marked = with_decisions(
        &deck(),
        vec![not_for_agents("d_nb1", &format!("{B}#audience"))],
    );
    let (p, skipped) = print(&marked);
    let b = upstream_of(&p)[B].as_object().unwrap();
    assert!(
        !b.contains_key("audience"),
        "the marked field is not printed"
    );
    assert!(
        skipped
            .iter()
            .any(|s| s.starts_with(&format!("{B}#audience"))),
        "{skipped:?}"
    );
    let all = text(&p);
    assert!(
        !all.contains(AUDIENCE),
        "the value is nowhere in the payload"
    );
    assert!(
        b["insight"].as_str().unwrap().contains(MARKED),
        "and where it appeared in another field it reads {MARKED}: {}",
        b["insight"]
    );
}

#[test]
fn a_pin_marked_not_for_agents_is_left_out_and_its_value_is_replaced_where_it_appears() {
    let plain = print(&deck()).0;
    let fact = plain["members"]["facts"][0].clone();
    let id = fact["id"].as_str().unwrap().to_string();
    let marked = with_decisions(
        &deck(),
        vec![not_for_agents("d_nf1", &format!("{R}#facts[{id}]"))],
    );
    let (p, skipped) = print(&marked);
    let ids: Vec<&str> = p["members"]["facts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["id"].as_str().unwrap())
        .collect();
    assert!(!ids.contains(&id.as_str()), "the marked pin is not printed");
    assert!(skipped.iter().any(|s| s.starts_with(&id)), "{skipped:?}");
    assert_eq!(
        p["members"]["facts"].as_array().unwrap().len(),
        plain["members"]["facts"].as_array().unwrap().len() - 1
    );
}

#[test]
fn a_mark_on_the_whole_research_or_the_whole_brief_leaves_it_out() {
    let (p, skipped) = print(&with_decisions(&deck(), vec![not_for_agents("d_nr", R)]));
    assert!(!upstream_of(&p).contains_key(R) && upstream_of(&p).contains_key(B));
    assert!(
        p["members"]["facts"].as_array().unwrap().is_empty()
            && p["members"]["findings"].as_array().unwrap().is_empty()
    );
    assert!(skipped.iter().any(|s| s.starts_with(R)), "{skipped:?}");
    let (p, skipped) = print(&with_decisions(&deck(), vec![not_for_agents("d_nbb", B)]));
    assert!(!upstream_of(&p).contains_key(B) && upstream_of(&p).contains_key(R));
    assert!(skipped.iter().any(|s| s.starts_with(B)), "{skipped:?}");
}

#[test]
fn only_verdicts_of_the_chain_are_printed_and_a_rejection_keeps_its_words() {
    let finding = print(&deck()).0["members"]["findings"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let mut v = person(
        "d_v1",
        "verdict",
        "verdict",
        &[&format!("findings[{finding}]")],
        "The source is out of date.",
    );
    v.polarity = Some("bad".into());
    let (p, _) = print(&with_decisions(
        &deck(),
        vec![
            v,
            person(
                "d_e1",
                "edit",
                "edit",
                &["campaign.problem"],
                "An edit that is nobody's business here.",
            ),
        ],
    ));
    let kinds: Vec<&str> = p["members"]["decisions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["kind"].as_str().unwrap())
        .collect();
    assert!(
        !kinds.is_empty() && kinds.iter().all(|k| *k == "verdict"),
        "{kinds:?}"
    );
    let mine = p["members"]["decisions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["id"] == "d_v1")
        .unwrap();
    assert_eq!(mine["polarity"], "bad");
    assert_eq!(mine["reason"], "The source is out of date.");
    assert!(!text(&p).contains("nobody's business"));
    assert!(!text(&p).contains("classify"));
}

#[test]
fn the_same_bytes_print_the_same_json_and_a_deck_with_no_upstream_prints_nothing() {
    assert_eq!(print(&deck()).0, print(&deck()).0);
    assert!(extract::deck_inputs(&scaffold("A plain deck")).is_none());
}

#[test]
fn a_deck_carrying_only_research_prints_the_research_and_no_brief() {
    let deck_of_research = open(
        spinoff(
            &template("Deck Maker", DECK_APP, vec![RESEARCH_APP.into()]),
            &research(),
            SpinoffOptions::default(),
        )
        .unwrap(),
    );
    let (p, _) = print(&deck_of_research);
    assert_eq!(upstream_of(&p).keys().collect::<Vec<_>>(), vec![R]);
    assert!(!p["members"]["facts"].as_array().unwrap().is_empty());
}
