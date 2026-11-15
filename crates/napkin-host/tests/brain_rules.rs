// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The brain's rule table (features/brain-rules.clan; done_when 6 and 8 of features/napkin-brain.clan,
//! the part that needs no reader): decision rows in, derived lines of ids, enums, dates and numbers out,
//! over a de-identified J001 chain (Client A, an Irish whiskey brand). The rows stand in for what the safe
//! reader will supply; nothing here reads a document.

use napkin_host::brain::rules::{assemble, derive, owner_role, BrainDecision, RULES};
use napkin_host::brain::{line_id, Brain, LineKind, LineState, PageType, Slot};
use serde_json::{json, Value};

fn rows(file: &str) -> Vec<BrainDecision> {
    let path = format!("{}/tests/fixtures/brain/{file}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn the_first_table_holds_the_seven_rules() {
    let mut ids: Vec<&str> = RULES.iter().map(|r| r.id).collect();
    let n = ids.len();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), n, "a rule id is used once");
    for r in RULES {
        assert!(r.id.ends_with(".v1"), "{} is versioned", r.id);
    }
    let has = |kind: &str, action: Option<&str>| {
        RULES.iter().any(|r| r.kind == kind && r.action == action)
    };
    assert!(has("approve", Some("lock")));
    assert!(has("sign", None));
    assert!(has("client_review", Some("client_answer")));
    assert!(has("verdict", Some("pick_route")));
    assert!(has("verdict", Some("score_work")));
    assert!(has("verdict", Some("overrule_score")));
    assert!(has("unlock", None));
    assert_eq!(RULES.len(), 7, "edits and votes are left out");
}

#[test]
fn no_rule_reads_a_cost_or_makes_a_person_page() {
    for r in RULES {
        assert_ne!(
            r.page_type,
            PageType::Person,
            "{} makes a person page",
            r.id
        );
        for bad in [
            "run_cost",
            "set_budget",
            "budget",
            "cost",
            "price",
            "credit",
        ] {
            assert!(
                !r.kind.contains(bad) && !r.action.unwrap_or("").contains(bad),
                "{} reads {bad}",
                r.id
            );
            assert!(
                !r.template.to_lowercase().contains(bad),
                "{} says {bad}",
                r.id
            );
            assert!(
                r.slots.iter().all(|(n, _)| !n.contains(bad)),
                "{} slot {bad}",
                r.id
            );
        }
        assert!(!r.template.contains('\u{2014}'), "no em dash");
        // The template names only its slots and the date.
        let mut rest = r.template;
        while let Some(i) = rest.find('{') {
            let j = rest[i..].find('}').expect("a closed placeholder") + i;
            let name = &rest[i + 1..j];
            assert!(
                name == "at" || r.slots.iter().any(|(n, _)| *n == name),
                "{} names {name}, which is not a slot",
                r.id
            );
            rest = &rest[j + 1..];
        }
    }
}

#[test]
fn the_j001_chain_becomes_cited_lines_of_ids_enums_dates_and_numbers() {
    let d = derive(&rows("j001_rows.json"));
    // Edits, votes and cost rows are not read at all.
    assert_eq!(d.ignored, 4, "edit, vote, run_cost, set_budget");
    assert!(d.skipped.is_empty(), "{:?}", d.skipped);
    assert_eq!(d.derived.len(), 11);
    for x in &d.derived {
        let l = &x.line;
        assert_eq!(l.kind, LineKind::Derived);
        assert_eq!(l.state, LineState::Current);
        assert!(l.text.is_none() && l.approved_by.is_none());
        assert_eq!(l.cites.len(), 1);
        let rule = l.rule.as_deref().unwrap();
        assert!(RULES.iter().any(|r| r.id == rule));
        match &l.cites[0] {
            napkin_host::brain::Cite::Decision { doc, decision } => {
                assert_eq!(l.id, line_id(doc, decision, rule));
            }
            c => panic!("a fact cite {c:?}"),
        }
        for (k, v) in &l.slots {
            match v {
                Slot::Num(n) => assert!(n.is_finite(), "{k}"),
                Slot::Id(s) => assert!(s.len() <= 64 && !s.contains(' '), "{k}"),
            }
        }
    }
    // The client's answer keeps its enum and drops the typed reason.
    let ans = d
        .derived
        .iter()
        .find(|x| x.line.cites.iter().any(|c| matches!(c, napkin_host::brain::Cite::Decision { decision, .. } if decision == "d_0005")))
        .unwrap();
    assert_eq!(
        ans.line.slots["answer"],
        Slot::Id("accepted_with_changes".into())
    );
    assert!(!ans.line.slots.contains_key("reason"));
    assert_eq!(ans.line.at, "2026-10-23");
    let all =
        serde_json::to_string(&d.derived.iter().map(|x| &x.line).collect::<Vec<_>>()).unwrap();
    assert!(
        !all.contains("bottle") && !all.contains("cheap"),
        "no words from a source"
    );
}

#[test]
fn a_row_that_would_carry_words_is_skipped_with_its_reason() {
    let d = derive(&rows("j001_hostile_rows.json"));
    assert!(
        d.derived.is_empty(),
        "{:?}",
        d.derived.iter().map(|x| &x.line.id).collect::<Vec<_>>()
    );
    assert_eq!(d.skipped.len(), 7);
    let why = |id: &str| {
        d.skipped
            .iter()
            .find(|s| s.decision == id)
            .unwrap()
            .reason
            .clone()
    };
    assert!(
        why("d_9001").contains("answer"),
        "a sentence is not an answer"
    );
    assert!(
        why("d_9002").contains("answer"),
        "an answer outside the three"
    );
    assert!(why("d_9003").contains("total"), "31 is over 30");
    assert!(why("d_9004").contains("total"), "a missing number");
    assert!(why("d_9005").contains("date"));
    assert!(why("d_9006").contains("job"));
    assert!(why("d_9007").contains("route"));
}

#[test]
fn the_rows_make_pages_per_job_that_pass_the_page_format() {
    let d = derive(&rows("j001_rows.json"));
    let pages = assemble(&d).unwrap();
    let slugs: Vec<&str> = pages.keys().map(String::as_str).collect();
    assert_eq!(
        slugs,
        [
            "decision-j001",
            "idea-j001",
            "job-j001",
            "job-j002",
            "outcome-j001"
        ]
    );
    for (slug, p) in &pages {
        napkin_host::brain::page::validate(p).unwrap_or_else(|e| panic!("{slug}: {e:?}"));
        assert!(p.title.contains("J00"), "{}", p.title);
        assert_eq!(p.owner_role, owner_role(p.page_type));
        assert!(p.summary.split_whitespace().count() <= 20);
    }
    // Lines sit in the order the decisions were made.
    let j = &pages["decision-j001"];
    let ats: Vec<&str> = j.lines.iter().map(|l| l.at.as_str()).collect();
    let mut sorted = ats.clone();
    sorted.sort();
    assert_eq!(ats, sorted);
    // Together they are a valid agency brain.
    let brain = json!({ "vault": { "kind": "agency" }, "pages": pages });
    Brain::from_value(brain).unwrap();
}

#[test]
fn derivation_is_deterministic_and_does_not_depend_on_the_order_of_rows() {
    let a = rows("j001_rows.json");
    let mut b = a.clone();
    b.reverse();
    let one = serde_json::to_value(assemble(&derive(&a)).unwrap()).unwrap();
    let two = serde_json::to_value(assemble(&derive(&b)).unwrap()).unwrap();
    assert_eq!(one, two);
    assert_eq!(
        one,
        serde_json::to_value(assemble(&derive(&a)).unwrap()).unwrap()
    );
    // A repeated row is one line.
    let mut c = a.clone();
    c.extend(a.clone());
    assert_eq!(
        serde_json::to_value(assemble(&derive(&c)).unwrap()).unwrap(),
        one
    );
}

#[test]
fn owners_follow_the_kind_of_page() {
    assert_eq!(owner_role(PageType::Idea), "creative-director");
    assert_eq!(owner_role(PageType::Decision), "account-service");
    assert_eq!(owner_role(PageType::Client), "account-service");
    assert_eq!(owner_role(PageType::Job), "account-service");
    assert_eq!(owner_role(PageType::Outcome), "planning");
    assert_eq!(owner_role(PageType::Lesson), "planning");
    let roles: Value = json!(["planning", "creative-director", "account-service"]);
    for t in [
        PageType::Decision,
        PageType::Idea,
        PageType::Outcome,
        PageType::Lesson,
        PageType::Client,
        PageType::Person,
        PageType::Tool,
        PageType::Job,
    ] {
        assert!(roles.as_array().unwrap().iter().any(|r| r == owner_role(t)));
    }
}
