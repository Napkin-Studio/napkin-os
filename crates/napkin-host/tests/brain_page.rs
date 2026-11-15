// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Napkin Brain's page format (features/brain-page-model.clan; done_when 2 and 3 of
//! features/napkin-brain.clan): fixed and checked, every refusal a 400.

use napkin_host::brain::{line_id, Brain, Page};
use serde_json::{json, Value};

fn line() -> Value {
    json!({
        "id": line_id("doc-a", "d_0007", "client_review.accepted.v1"),
        "kind": "derived",
        "rule": "client_review.accepted.v1",
        "cites": [{ "doc": "doc-a", "decision": "d_0007" }],
        "slots": { "answer": "accepted", "version": 3, "on": "2026-11-02" },
        "state": "current",
        "at": "2026-11-02T09:30:00Z"
    })
}

fn page_json(ty: &str, lines: Vec<Value>) -> Value {
    json!({
        "type": ty,
        "title": "Client A accepted the brief",
        "summary": "The client accepted version three of the brief.",
        "owner_role": "account-service",
        "links": [],
        "lines": lines
    })
}

fn parse(v: Value) -> Result<Page, napkin_host::HostError> {
    let p: Page = serde_json::from_value(v)
        .map_err(|e| napkin_host::HostError::bad_request(e.to_string()))?;
    napkin_host::brain::page::validate(&p)?;
    Ok(p)
}

fn refused(v: Value) -> u16 {
    parse(v).expect_err("the page should be refused").status
}

#[test]
fn a_good_page_of_each_type_passes() {
    for ty in ["decision", "idea", "outcome", "lesson", "client", "tool", "job"] {
        parse(page_json(ty, vec![line()])).unwrap_or_else(|e| panic!("{ty}: {e:?}"));
    }
}

#[test]
fn a_page_type_outside_the_eight_is_refused() {
    assert_eq!(refused(page_json("insight", vec![line()])), 400);
}

#[test]
fn a_line_with_no_cite_is_refused_with_400() {
    let mut l = line();
    l["cites"] = json!([]);
    assert_eq!(refused(page_json("decision", vec![l])), 400);
    let mut l = line();
    l.as_object_mut().unwrap().remove("cites");
    assert_eq!(refused(page_json("decision", vec![l])), 400);
    let mut l = line();
    l["cites"] = json!([{ "doc": "", "decision": "d_1" }]);
    assert_eq!(refused(page_json("decision", vec![l])), 400);
}

#[test]
fn a_summary_is_twenty_words_or_fewer() {
    let mut p = page_json("decision", vec![line()]);
    p["summary"] = json!(vec!["word"; 20].join(" "));
    parse(p).unwrap();
    let mut p = page_json("decision", vec![line()]);
    p["summary"] = json!(vec!["word"; 21].join(" "));
    assert_eq!(refused(p), 400);
    let mut p = page_json("decision", vec![line()]);
    p["summary"] = json!("   ");
    assert_eq!(refused(p), 400);
}

#[test]
fn a_page_needs_its_owner_role_title_and_lines() {
    for key in ["title", "summary", "owner_role", "lines", "type"] {
        let mut p = page_json("decision", vec![line()]);
        p.as_object_mut().unwrap().remove(key);
        assert_eq!(refused(p), 400, "no {key}");
    }
}

#[test]
fn a_derived_line_holds_no_free_text() {
    // A sentence in a slot.
    let mut l = line();
    l["slots"]["reason"] = json!("the bottle looked cheap");
    assert_eq!(refused(page_json("decision", vec![l])), 400);
    // A string slot longer than an id.
    let mut l = line();
    l["slots"]["reason"] = json!("a".repeat(65));
    assert_eq!(refused(page_json("decision", vec![l])), 400);
    // An id of 64 is the longest.
    let mut l = line();
    l["slots"]["ref"] = json!("a".repeat(64));
    parse(page_json("decision", vec![l])).unwrap();
    // Text on a derived line, and any other key.
    let mut l = line();
    l["text"] = json!("The client said it looked cheap");
    assert_eq!(refused(page_json("decision", vec![l])), 400);
    let mut l = line();
    l["note"] = json!("x");
    assert_eq!(refused(page_json("decision", vec![l])), 400);
    // A slot that is not a scalar.
    let mut l = line();
    l["slots"]["nested"] = json!({ "a": "b" });
    assert_eq!(refused(page_json("decision", vec![l])), 400);
    let mut l = line();
    l["slots"]["list"] = json!(["a", "b"]);
    assert_eq!(refused(page_json("decision", vec![l])), 400);
    // A derived line with no rule.
    let mut l = line();
    l.as_object_mut().unwrap().remove("rule");
    assert_eq!(refused(page_json("decision", vec![l])), 400);
}

#[test]
fn a_curated_line_has_its_text_and_an_approver() {
    let mut l = line();
    l["kind"] = json!("curated");
    l["text"] = json!("A person wrote this and approved it.");
    l["approved_by"] = json!("laurence");
    parse(page_json("lesson", vec![l.clone()])).unwrap();
    l.as_object_mut().unwrap().remove("approved_by");
    assert_eq!(refused(page_json("lesson", vec![l])), 400);
}

#[test]
fn supersession_is_stated_both_ways() {
    let mut l = line();
    l["state"] = json!("superseded");
    assert_eq!(refused(page_json("decision", vec![l.clone()])), 400, "no replacement named");
    l["superseded_by"] = json!("fedcba9876543210");
    parse(page_json("decision", vec![l])).unwrap();
    let mut l = line();
    l["superseded_by"] = json!("fedcba9876543210");
    assert_eq!(refused(page_json("decision", vec![l])), 400, "current but replaced");
}

#[test]
fn a_line_id_is_sixteen_hex_digits_and_stable() {
    let a = line_id("doc-a", "d_0007", "r1");
    assert_eq!(a.len(), 16);
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(a, line_id("doc-a", "d_0007", "r1"));
    assert_ne!(a, line_id("doc-a", "d_0007", "r2"));
    assert_ne!(a, line_id("doc-a", "d_0008", "r1"));
    assert_ne!(a, line_id("doc-b", "d_0007", "r1"));
    // The parts are joined with a separator, so they cannot slide into one another.
    assert_ne!(line_id("ab", "c", "r"), line_id("a", "bc", "r"));
}

#[test]
fn two_lines_may_not_share_an_id() {
    assert_eq!(refused(page_json("decision", vec![line(), line()])), 400);
}

#[test]
fn a_person_page_never_scores_a_person() {
    // What someone decided or owns is fine.
    let mut ok = line();
    ok["rule"] = json!("approve.decided.v1");
    ok["slots"] = json!({ "role": "creative-director", "on": "2026-11-02" });
    parse(page_json("person", vec![ok])).unwrap();
    // Counts, lateness, rankings: by rule, slot name, slot value, number or words.
    for (what, edit) in [
        ("a rule", json!({ "rule": "approvals.count.v1" })),
        ("a slot name", json!({ "slots": { "late_days": "x" } })),
        ("a slot value", json!({ "slots": { "kind": "ranking" } })),
        ("a number", json!({ "slots": { "approved": 12 } })),
        ("a score", json!({ "slots": { "score": "high" } })),
    ] {
        let mut l = line();
        for (k, v) in edit.as_object().unwrap() {
            l[k] = v.clone();
        }
        assert_eq!(refused(page_json("person", vec![l])), 400, "{what}");
    }
    // A curated line's own words too.
    let mut l = line();
    l["kind"] = json!("curated");
    l["text"] = json!("Always late with the first draft");
    l["approved_by"] = json!("laurence");
    assert_eq!(refused(page_json("person", vec![l])), 400, "words");
    let mut p = page_json("person", vec![line()]);
    p["title"] = json!("Top performer of the year");
    assert_eq!(refused(p), 400, "title");
    // The same slots are fine on a decision page: the check is for people.
    let mut l = line();
    l["slots"]["approved"] = json!(12);
    parse(page_json("decision", vec![l])).unwrap();
}

#[test]
fn a_brain_is_checked_as_a_whole() {
    let brain = |v: Value| Brain::from_value(v);
    let ok = json!({
        "vault": { "kind": "client", "client": "cli_0a1b2c3d" },
        "pages": {
            "j001": page_json("job", vec![line()]),
        }
    });
    brain(ok.clone()).unwrap();
    // The agency's brain names no client; a client's names its own.
    let mut v = ok.clone();
    v["vault"] = json!({ "kind": "agency", "client": "cli_0a1b2c3d" });
    assert_eq!(brain(v).unwrap_err().status, 400);
    let mut v = ok.clone();
    v["vault"] = json!({ "kind": "client" });
    assert_eq!(brain(v).unwrap_err().status, 400);
    // A link to a page that is not there; a slug that is not one.
    let mut v = ok.clone();
    v["pages"]["j001"]["links"] = json!(["nowhere"]);
    assert_eq!(brain(v).unwrap_err().status, 400);
    let mut v = ok.clone();
    v["pages"]["Bad Slug"] = page_json("job", vec![]);
    assert_eq!(brain(v).unwrap_err().status, 400);
    // One line id on two pages.
    let mut v = ok;
    v["pages"]["j002"] = page_json("job", vec![line()]);
    assert_eq!(brain(v).unwrap_err().status, 400);
}
