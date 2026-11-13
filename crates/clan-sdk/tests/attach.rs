// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Attach links an existing document into another that already exists
//! (`os-layer.md` §5.7): the source frozen under `data.upstream.<id>`, its
//! pins merged, its decisions carried after the document's own, and
//! `lineage.attached` recording what was taken. An app named in
//! `attach.many` may be held more than once; any other is one at a time.
//! And a spin-off target may carry one source app differently from the rest
//! (`spinoff.by_source`).

use std::collections::BTreeMap;

use clan_sdk::{
    attach, create, detach, instantiate, make_template, spinoff, AppHome, AppInfo, AttachSpec,
    AttachVerb, ClanBuilder, ClanFile, CreateOptions, Decision, DecisionChain, FileEntry,
    InstantiateOptions, MakeTemplateOptions, SourceCarry, SpinoffOptions, SpinoffSpec,
    MANIFEST_PATH,
};
use serde_yaml::Value;

const DATA: &str = "shared/data.yaml";
const CHAIN: &str = "agent/decision-chain.yaml";
const FACTS: &str = "shared/facts.yaml";

const RESEARCH_APP: &str = "ie.napkin.campaign-research";
const BRIEF_APP: &str = "ie.napkin.brief-maker";
const BRAND_APP: &str = "ie.napkin.brand";
const FILM_APP: &str = "ie.napkin.film";

fn open(bytes: Vec<u8>) -> ClanFile {
    ClanFile::from_bytes(bytes).unwrap()
}

fn app(name: &str, app_id: &str, noun: &str) -> AppInfo {
    AppInfo {
        home: Some(AppHome {
            noun: vec![noun.into(), format!("{noun}s")],
            ..Default::default()
        }),
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

fn template(info: AppInfo) -> ClanFile {
    let base = open(
        create(CreateOptions {
            title: info.name.clone(),
            brief: format!("{}, for the attach tests", info.name),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    );
    open(make_template(&base, info, MakeTemplateOptions::default()).unwrap())
}

fn instance(tpl: &ClanFile, title: &str) -> ClanFile {
    open(
        instantiate(
            tpl,
            InstantiateOptions {
                title: title.into(),
                fresh_data: true,
                ..Default::default()
            },
        )
        .unwrap(),
    )
}

fn brief_app() -> AppInfo {
    let mut a = app("Brief Maker", BRIEF_APP, "brief");
    a.attach = Some(AttachSpec {
        accepts: vec![RESEARCH_APP.into(), BRAND_APP.into()],
        many: vec![RESEARCH_APP.into()],
        ..Default::default()
    });
    a
}

/// `clan` with its data, chain and facts replaced, one revision on.
fn written(clan: &ClanFile, data: &str, decisions: &[(&str, &str)], facts: &[&str]) -> ClanFile {
    let mut manifest = clan.manifest().clone();
    manifest.next_revision();
    if !manifest.files.iter().any(|f| f.path == FACTS) {
        manifest.files.push(FileEntry {
            id: "pinned-facts".into(),
            path: FACTS.into(),
            role: "pinned-facts".into(),
            content_type: "application/yaml".into(),
            priority: None,
            sha256: None,
        });
    }
    let mut b = ClanBuilder::new(manifest);
    for (p, v) in clan.read_all_entries().unwrap() {
        if p != MANIFEST_PATH && p != DATA && p != CHAIN && p != FACTS {
            b.add_entry(p, v);
        }
    }
    b.add_entry(DATA, data.as_bytes().to_vec());
    let mut chain = DecisionChain::default();
    for (id, action) in decisions {
        let mut d = Decision::new(
            "researcher",
            *action,
            "in the research",
            "2026-11-01T09:00:00Z",
        );
        d.id = Some((*id).into());
        chain.decisions.push(d);
    }
    b.add_entry(CHAIN, chain.to_yaml().unwrap());
    let items: String = facts
        .iter()
        .map(|id| format!("  - id: {id}\n    key: share\n    value: 12\n"))
        .collect();
    b.add_entry(FACTS, format!("facts:\n{items}").into_bytes());
    open(b.build().unwrap())
}

fn data(clan: &ClanFile) -> Value {
    serde_yaml::from_slice(&clan.read_entry(DATA).unwrap()).unwrap()
}

fn chain(clan: &ClanFile) -> DecisionChain {
    DecisionChain::from_yaml(&clan.read_entry(CHAIN).unwrap()).unwrap()
}

#[test]
fn a_research_links_into_an_existing_brief_frozen_with_its_version_and_one_decision() {
    let research_tpl = template(app("Research Tool", RESEARCH_APP, "research"));
    let brief_tpl = template(brief_app());
    let research = written(
        &instance(&research_tpl, "Oat milk in Ireland"),
        "market: oat milk\n",
        &[("d_r1", "verify")],
        &["fa_1"],
    );
    let brief = instance(&brief_tpl, "Spring brief");

    let out = attach(&brief, &research).unwrap();
    assert_eq!(out.verb, AttachVerb::Attached);
    let linked = open(out.bytes);
    let rid = research.manifest().document_id().to_string();
    let d = data(&linked);
    assert_eq!(d["upstream"][rid.as_str()]["market"], "oat milk");
    let rec = &linked.manifest().attached()[0];
    assert_eq!(rec.app_id, RESEARCH_APP);
    assert_eq!(rec.carried.document_id, rid);
    assert_eq!(rec.taken, Some(1));
    assert_eq!(rec.version, Some(1));
    assert_eq!(rec.title.as_deref(), Some("Oat milk in Ireland"));
    assert_eq!(
        rec.revision.as_deref(),
        Some(research.manifest().id.as_str())
    );
    let c = chain(&linked);
    assert_eq!(c.decisions[0].action, "attach");
    assert_eq!(
        c.decisions[0].targets,
        vec![format!("{}#upstream.{rid}", brief.manifest().document_id())]
    );
    // The research's own decision is carried behind the brief's.
    assert!(c.decisions.iter().any(|d| d.id.as_deref() == Some("d_r1")));
    // Its pins are merged into the brief's own.
    let facts = String::from_utf8(linked.read_entry(FACTS).unwrap()).unwrap();
    assert!(facts.contains("fa_1"), "{facts}");
    // The brief is the same document, one revision on.
    assert_eq!(
        linked.manifest().document_id(),
        brief.manifest().document_id()
    );
    assert_ne!(linked.manifest().id, brief.manifest().id);
}

#[test]
fn a_brief_holds_many_research_but_one_of_any_other_app() {
    let research_tpl = template(app("Research Tool", RESEARCH_APP, "research"));
    let brand_tpl = template(app("Brand Clan", BRAND_APP, "brand"));
    let brief = instance(&template(brief_app()), "Spring brief");
    let r1 = written(&instance(&research_tpl, "Market"), "a: 1\n", &[], &[]);
    let r2 = written(&instance(&research_tpl, "Audience"), "b: 2\n", &[], &[]);
    let b1 = written(
        &instance(&brand_tpl, "Lumen"),
        "kit:\n  version: 3\n",
        &[],
        &[],
    );
    let b2 = written(
        &instance(&brand_tpl, "Harbour"),
        "kit:\n  version: 1\n",
        &[],
        &[],
    );

    let one = open(attach(&brief, &r1).unwrap().bytes);
    let two = attach(&one, &r2).unwrap();
    assert_eq!(
        two.verb,
        AttachVerb::Attached,
        "a second research is its own link"
    );
    let two = open(two.bytes);
    assert_eq!(two.manifest().attached().len(), 2);
    let up = data(&two)["upstream"].as_mapping().unwrap().len();
    assert_eq!(up, 2);

    let three = open(attach(&two, &b1).unwrap().bytes);
    assert_eq!(three.manifest().attached().len(), 3);
    assert_eq!(
        three.manifest().attached()[2].version,
        Some(3),
        "a kit's own version wins"
    );
    let four = attach(&three, &b2).unwrap();
    assert_eq!(four.verb, AttachVerb::Replaced, "one brand at a time");
    let four = open(four.bytes);
    let ids: Vec<&str> = four
        .manifest()
        .attached()
        .iter()
        .map(|a| a.carried.document_id.as_str())
        .collect();
    assert!(!ids.contains(&b1.manifest().document_id()));
    assert!(ids.contains(&b2.manifest().document_id()));
    assert_eq!(ids.len(), 3);
    assert_eq!(chain(&four).decisions[0].action, "replace");
}

#[test]
fn one_research_feeds_many_briefs() {
    let research = written(
        &instance(
            &template(app("Research Tool", RESEARCH_APP, "research")),
            "Market",
        ),
        "a: 1\n",
        &[],
        &[],
    );
    let brief_tpl = template(brief_app());
    for title in ["Spring", "Summer"] {
        let b = open(
            attach(&instance(&brief_tpl, title), &research)
                .unwrap()
                .bytes,
        );
        assert_eq!(
            b.manifest().attached()[0].carried.document_id,
            research.manifest().document_id()
        );
    }
}

#[test]
fn taking_a_newer_version_counts_it_and_names_the_noun() {
    let research_tpl = template(app("Research Tool", RESEARCH_APP, "research"));
    let research = written(
        &instance(&research_tpl, "Market"),
        "a: 1\n",
        &[("d_1", "verify")],
        &["fa_1"],
    );
    let brief = open(
        attach(&instance(&template(brief_app()), "Spring"), &research)
            .unwrap()
            .bytes,
    );

    let newer = written(
        &research,
        "a: 2\n",
        &[("d_2", "verify"), ("d_1", "verify")],
        &["fa_1", "fa_2"],
    );
    let out = attach(&brief, &newer).unwrap();
    assert_eq!(out.verb, AttachVerb::Updated);
    assert_eq!(
        out.carried_decisions, 1,
        "only the decision the brief has not seen"
    );
    let updated = open(out.bytes);
    let rid = research.manifest().document_id();
    assert_eq!(data(&updated)["upstream"][rid]["a"], 2);
    let rec = &updated.manifest().attached()[0];
    assert_eq!(rec.taken, Some(2));
    assert_eq!(rec.version, Some(2));
    assert_eq!(rec.revision.as_deref(), Some(newer.manifest().id.as_str()));
    assert_eq!(updated.manifest().attached().len(), 1);
    assert_eq!(chain(&updated).decisions[0].action, "update_from_research");
    let facts = String::from_utf8(updated.read_entry(FACTS).unwrap()).unwrap();
    assert!(facts.contains("fa_2"), "{facts}");
}

#[test]
fn detach_by_document_id_lets_go_of_that_one_only() {
    let research_tpl = template(app("Research Tool", RESEARCH_APP, "research"));
    let r1 = written(&instance(&research_tpl, "Market"), "a: 1\n", &[], &[]);
    let r2 = written(&instance(&research_tpl, "Audience"), "b: 2\n", &[], &[]);
    let brief = instance(&template(brief_app()), "Spring");
    let both = open(
        attach(&open(attach(&brief, &r1).unwrap().bytes), &r2)
            .unwrap()
            .bytes,
    );

    // Two of the app: its id alone does not say which.
    assert!(detach(&both, RESEARCH_APP).is_err());
    let out = detach(&both, r1.manifest().document_id()).unwrap();
    let left = open(out.bytes);
    assert_eq!(left.manifest().attached().len(), 1);
    assert_eq!(
        left.manifest().attached()[0].carried.document_id,
        r2.manifest().document_id()
    );
    let d = data(&left);
    assert!(d["upstream"].get(r1.manifest().document_id()).is_none());
    assert!(d["upstream"].get(r2.manifest().document_id()).is_some());
    assert_eq!(chain(&left).decisions[0].action, "detach");
    // With one left, the app id names it.
    let none = open(detach(&left, RESEARCH_APP).unwrap().bytes);
    assert!(none.manifest().attached().is_empty());
    assert!(data(&none).get("upstream").is_none());
}

#[test]
fn attach_refuses_an_app_not_accepted_and_the_document_itself() {
    let brief_tpl = template(brief_app());
    let brief = instance(&brief_tpl, "Spring");
    let other = instance(&brief_tpl, "Summer");
    assert!(
        attach(&brief, &other).is_err(),
        "a brief does not take a brief"
    );
    let research_tpl = template(app("Research Tool", RESEARCH_APP, "research"));
    let research = instance(&research_tpl, "Market");
    assert!(
        attach(&research, &brief).is_err(),
        "an app declaring no attach takes nothing"
    );
    let brief = written(&brief, "x: 1\n", &[], &[]);
    let mut same = brief.manifest().clone();
    same.app.as_mut().unwrap().attach.as_mut().unwrap().accepts = vec![BRIEF_APP.into()];
    let mut b = ClanBuilder::new(same);
    for (p, v) in brief.read_all_entries().unwrap() {
        if p != MANIFEST_PATH {
            b.add_entry(p, v);
        }
    }
    let same = open(b.build().unwrap());
    assert!(attach(&same, &same).is_err(), "not itself");
}

#[test]
fn a_spinoff_target_carries_one_source_app_by_its_own_rule() {
    // Advertising Studio, as it declares itself on feat/new-ui: a brief
    // grafted at `brief`, a research carried whole with one lift.
    let mut film = app("Advertising Studio", FILM_APP, "production");
    let mut lift = BTreeMap::new();
    lift.insert("project_name".to_string(), "project.name".to_string());
    let mut research_lift = BTreeMap::new();
    research_lift.insert("market".to_string(), "project.market".to_string());
    let mut by_source = BTreeMap::new();
    by_source.insert(
        RESEARCH_APP.to_string(),
        SourceCarry {
            upstream: true,
            lift: research_lift,
            ..Default::default()
        },
    );
    film.spinoff = Some(SpinoffSpec {
        accepts: vec![BRIEF_APP.into()],
        map: Some("brief".into()),
        lift,
        by_source,
        ..Default::default()
    });
    let film_tpl = template(film);

    let research = written(
        &instance(
            &template(app("Research Tool", RESEARCH_APP, "research")),
            "Market",
        ),
        "market: oat milk\n",
        &[("d_r1", "verify")],
        &[],
    );
    let prod = open(spinoff(&film_tpl, &research, SpinoffOptions::default()).unwrap());
    let rid = research.manifest().document_id();
    let d = data(&prod);
    assert_eq!(d["upstream"][rid]["market"], "oat milk");
    assert_eq!(d["project"]["market"], "oat milk");
    assert!(d.get("brief").is_none());
    assert_eq!(prod.manifest().carried().unwrap().document_id, rid);

    let brief = written(
        &instance(&template(brief_app()), "Spring"),
        "project_name: Spring\n",
        &[],
        &[],
    );
    let prod = open(spinoff(&film_tpl, &brief, SpinoffOptions::default()).unwrap());
    let d = data(&prod);
    // Grafted at `brief`, with its declared lift moved out.
    assert!(d["brief"].is_mapping());
    assert_eq!(d["project"]["name"], "Spring");
    assert!(prod.manifest().carried().is_none());

    let deck = instance(&template(app("Deck", "ie.napkin.deck", "deck")), "Deck");
    assert!(spinoff(&film_tpl, &deck, SpinoffOptions::default()).is_err());
}
