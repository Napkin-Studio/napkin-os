// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The brain read as markdown (features/brain-render.clan; done_when 4 of features/napkin-brain.clan):
//! `pages/<slug>.md`, `index.md` and `log.md`, rendered, never stored. The sentence of a derived line is
//! made from its rule and slots when it is read. Goldens are in tests/fixtures/brain/. To rewrite them
//! after a deliberate change: `BRAIN_BLESS=1 cargo test -p napkin-host --test brain_render`, then read
//! the diff.

use std::collections::BTreeMap;

use napkin_host::brain::render::{index_md, log_md, page_md, sentence, LogEntry};
use napkin_host::brain::rules::{assemble, derive, BrainDecision, RULES};
use napkin_host::brain::{Brain, Line, LineKind, LineState, Slot};
use serde_json::json;

fn fixtures() -> String {
    format!("{}/tests/fixtures/brain", env!("CARGO_MANIFEST_DIR"))
}

fn golden(name: &str, got: &str) {
    let path = format!("{}/{name}", fixtures());
    if std::env::var_os("BRAIN_BLESS").is_some() {
        std::fs::create_dir_all(std::path::Path::new(&path).parent().unwrap()).unwrap();
        std::fs::write(&path, got).unwrap();
    }
    let want = std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("no golden {path}"));
    assert_eq!(got, want, "{name} differs from its golden");
}

/// J001's brain: the rows of the fixture chain, and the first approval superseded by the second.
fn brain() -> Brain {
    let rows: Vec<BrainDecision> = serde_json::from_str(
        &std::fs::read_to_string(format!("{}/j001_rows.json", fixtures())).unwrap(),
    )
    .unwrap();
    let mut pages = assemble(&derive(&rows)).unwrap();
    let job = pages.get_mut("job-j001").unwrap();
    let second = job
        .lines
        .iter()
        .find(|l| l.cites.iter().any(|c| matches!(c, napkin_host::brain::Cite::Decision { decision, .. } if decision == "d_0007")))
        .unwrap()
        .id
        .clone();
    let first = job
        .lines
        .iter_mut()
        .find(|l| l.cites.iter().any(|c| matches!(c, napkin_host::brain::Cite::Decision { decision, .. } if decision == "d_0002")))
        .unwrap();
    first.state = LineState::Superseded;
    first.superseded_by = Some(second);
    pages.get_mut("job-j001").unwrap().links = vec!["decision-j001".into(), "idea-j001".into()];
    Brain::from_value(json!({ "vault": { "kind": "agency" }, "pages": pages })).unwrap()
}

fn derived(rule: &str, slots: &[(&str, Slot)]) -> Line {
    Line {
        id: "0123456789abcdef".into(),
        kind: LineKind::Derived,
        rule: Some(rule.into()),
        cites: vec![napkin_host::brain::Cite::Fact { fact: "f1".into() }],
        slots: slots
            .iter()
            .map(|(k, v)| ((*k).to_string(), v.clone()))
            .collect::<BTreeMap<_, _>>(),
        state: LineState::Current,
        superseded_by: None,
        at: "2026-11-02".into(),
        text: None,
        approved_by: None,
    }
}

#[test]
fn a_sentence_is_made_from_the_rule_and_the_slots() {
    let s = |rule: &str, slots: &[(&str, Slot)]| sentence(&derived(rule, slots));
    assert_eq!(
        s("approve.v1", &[("version", Slot::Num(2.0))]),
        "Version 2 was approved and locked on 2026-11-02."
    );
    assert_eq!(
        s("sign.v1", &[("role", Slot::Id("creative_director".into()))]),
        "The creative director signed on 2026-11-02."
    );
    assert_eq!(
        s(
            "client_answer.v1",
            &[
                ("answer", Slot::Id("accepted_with_changes".into())),
                ("version", Slot::Num(1.0))
            ]
        ),
        "The client's answer on version 1 was accepted with changes, on 2026-11-02."
    );
    assert_eq!(
        s("pick_route.v1", &[("route", Slot::Id("route_b".into()))]),
        "The creative director chose route route_b on 2026-11-02."
    );
    assert_eq!(
        s(
            "score_work.v1",
            &[
                ("total", Slot::Num(27.0)),
                ("target", Slot::Id("scene_1".into()))
            ]
        ),
        "Judge scored scene_1 at 27 of 30 on 2026-11-02."
    );
    // Every rule in the table can be rendered, and a rule this build does not know still reads.
    for r in RULES {
        let slots: Vec<(&str, Slot)> = r
            .slots
            .iter()
            .map(|(n, spec)| {
                let v = match spec {
                    napkin_host::brain::rules::SlotSpec::Enum(w) => Slot::Id(w[0].into()),
                    napkin_host::brain::rules::SlotSpec::Number { min, .. } => {
                        Slot::Num(f64::from(*min))
                    }
                    napkin_host::brain::rules::SlotSpec::Id => Slot::Id("x1".into()),
                };
                (*n, v)
            })
            .collect();
        let text = s(r.id, &slots);
        assert!(
            !text.contains('{') && text.ends_with('.'),
            "{}: {text}",
            r.id
        );
    }
    assert_eq!(
        s("later_rule.v9", &[]),
        "A decision was recorded on 2026-11-02."
    );
}

#[test]
fn a_curated_line_reads_as_its_own_words() {
    let mut l = derived("approve.v1", &[]);
    l.kind = LineKind::Curated;
    l.text = Some("Written and approved by a person.".into());
    l.approved_by = Some("laurence".into());
    assert_eq!(sentence(&l), "Written and approved by a person.");
}

#[test]
fn the_pages_match_their_goldens() {
    let b = brain();
    for slug in b.pages.keys() {
        golden(
            &format!("pages/{slug}.md"),
            &page_md(&b, slug).expect("a page of the brain"),
        );
    }
    assert!(page_md(&b, "no-such-page").is_none());
}

#[test]
fn a_superseded_line_is_struck_through_with_its_date_and_a_link() {
    let b = brain();
    let md = page_md(&b, "job-j001").unwrap();
    let first = b.pages["job-j001"]
        .lines
        .iter()
        .find(|l| l.state == LineState::Superseded)
        .unwrap();
    let by = first.superseded_by.as_ref().unwrap();
    assert!(
        md.contains("~~Version 1 was approved and locked on 2026-10-21.~~"),
        "{md}"
    );
    assert!(
        md.contains("Superseded on 2026-10-27"),
        "the date of the line that replaced it"
    );
    assert!(md.contains(&format!("](#line-{by})")), "a link to it");
    assert!(
        md.contains(&format!("<a id=\"line-{by}\"></a>")),
        "and the line it links to is there"
    );
    // A current line is not struck through.
    assert!(md.contains("\n- <a id=\"line-") && !md.contains("~~Version 2"));
}

#[test]
fn pages_link_both_ways() {
    let b = brain();
    let job = page_md(&b, "job-j001").unwrap();
    assert!(
        job.contains("Related: [[decision-j001]], [[idea-j001]]"),
        "{job}"
    );
    let dec = page_md(&b, "decision-j001").unwrap();
    assert!(dec.contains("Linked from: [[job-j001]]"), "{dec}");
    let outcome = page_md(&b, "outcome-j001").unwrap();
    assert!(!outcome.contains("Related:") && !outcome.contains("Linked from:"));
}

#[test]
fn the_index_lists_every_page_by_type_with_its_summary() {
    let b = brain();
    golden("index.md", &index_md(&b));
    let idx = index_md(&b);
    for (slug, p) in &b.pages {
        assert!(idx.contains(&format!("[[{slug}]] {}", p.summary)), "{slug}");
    }
    // A new page is in the index with no second write: the index is read from the pages.
    let mut more = serde_json::to_value(&b).unwrap();
    more["pages"]["lesson-j001"] = json!({
        "type": "lesson", "title": "Lessons on J001", "summary": "What was learned.",
        "owner_role": "planning", "links": [], "lines": []
    });
    let more = Brain::from_value(more).unwrap();
    assert!(index_md(&more).contains("## Lessons\n- [[lesson-j001]] What was learned."));
}

#[test]
fn the_log_has_one_line_per_entry_and_leaves_out_what_a_run_cost() {
    let e = |at: &str, kind: &str, action: &str, title: &str| LogEntry {
        at: at.into(),
        kind: kind.into(),
        action: action.into(),
        title: title.into(),
    };
    let entries = vec![
        e(
            "2026-11-01T09:00:00Z",
            "ingest",
            "ingest",
            "Job record on J001",
        ),
        e("2026-11-02T10:00:00Z", "run_cost", "run_cost", "a run"),
        e("2026-11-03T10:00:00Z", "budget", "set_budget", "a cap"),
        e(
            "2026-11-04T08:30:00Z",
            "ingest",
            "ingest",
            "Decisions on J001",
        ),
    ];
    let log = log_md(&entries);
    golden("log.md", &log);
    assert_eq!(
        log.matches("\n## [").count() + usize::from(log.starts_with("## [")),
        2
    );
    assert!(!log.contains("run") && !log.contains("cap"));
    assert!(log.contains("## [2026-11-04] ingest | Decisions on J001"));
}

#[test]
fn the_markdown_holds_no_words_the_brain_did_not_store_and_no_price() {
    let b = brain();
    let stored = serde_json::to_string(&b).unwrap();
    // The sentences are made at read: none of them is in the stored brain.
    assert!(!stored.contains("was approved and locked"));
    assert!(!stored.contains("signed on"));
    let mut all = index_md(&b);
    for slug in b.pages.keys() {
        all.push_str(&page_md(&b, slug).unwrap());
    }
    let low = all.to_lowercase();
    for bad in [
        "price", "cost", "budget", "credit", "cannes", "effie", "warc", "bottle", "cheap",
    ] {
        assert!(!low.contains(bad), "the markdown says {bad}");
    }
    assert!(!all.contains('\u{2014}'));
    // Reading twice is the same.
    assert_eq!(index_md(&b), index_md(&b));
}

#[test]
fn a_person_page_renders_what_someone_decided_and_nothing_scored() {
    let b = Brain::from_value(json!({
        "vault": { "kind": "agency" },
        "pages": { "person-dara": {
            "type": "person", "title": "Dara", "summary": "What Dara decided or owns.",
            "owner_role": "account-service", "links": [],
            "lines": [{ "id": "aaaaaaaaaaaaaaaa", "kind": "derived", "rule": "sign.v1",
                "cites": [{ "doc": "doc-brief-a", "decision": "d_0004" }],
                "slots": { "role": "creative_director" }, "state": "current", "at": "2026-10-22" }]
        } }
    }))
    .unwrap();
    let md = page_md(&b, "person-dara").unwrap();
    assert!(md.contains("The creative director signed on 2026-10-22."));
    let words: Vec<String> = md
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .map(str::to_string)
        .collect();
    for bad in [
        "count", "rank", "ranking", "score", "late", "lateness", "average", "total",
    ] {
        assert!(!words.iter().any(|w| w == bad), "{bad}");
    }
}
