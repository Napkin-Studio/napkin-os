// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The brain's rule table (features/brain-rules.clan): which decisions make a page, and in what shape.
//!
//! A rule turns one decision row into one derived line: an id, the rule, a cite, and slots that are ids,
//! enums, dates and numbers. A slot is taken from the row only if the rule names it and its value fits
//! the rule's type; every other field of the row is dropped, so no word from a source can reach a line
//! (an allow list, never a subtraction). The words of a line are the rule's `template`, filled at read
//! (record 5) from the slots.
//!
//! The rows are [`BrainDecision`]s: plain data. What supplies them is the safe reader (record 6), not
//! this module, which reads no document. Read by the ingest, job-memory and case-study-builder: one
//! table, no second.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::page::{line_id, Cite, Line, LineKind, LineState, Page, PageType, Slot};
use crate::error::HostResult;

/// A decision as the safe reader will hand it over: where it is, what it was, when, for which job, and
/// the allow-listed enum and number slots. Nothing else of the decision is here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrainDecision {
    pub doc: String,
    pub id: String,
    pub kind: String,
    pub action: String,
    /// The day it was made, `YYYY-MM-DD` (a time after it is kept).
    pub at: String,
    #[serde(default)]
    pub job: Option<String>,
    #[serde(default)]
    pub slots: BTreeMap<String, Slot>,
}

/// What a slot may hold.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SlotSpec {
    /// One of these words.
    Enum(&'static [&'static str]),
    /// A whole number in this range.
    Number { min: u32, max: u32 },
    /// An id: no spaces, 64 characters at most.
    Id,
}

#[derive(Debug, Clone, Copy)]
pub struct Rule {
    pub id: &'static str,
    pub kind: &'static str,
    /// The decision's action, or `None` for any action of the kind.
    pub action: Option<&'static str>,
    pub page_type: PageType,
    /// The line's sentence, with `{slot}` and `{at}` where the slots and the date go.
    pub template: &'static str,
    pub slots: &'static [(&'static str, SlotSpec)],
}

const ANSWERS: &[&str] = &["accepted", "accepted_with_changes", "rejected"];
const SIGNERS: &[&str] = &["planner", "creative_director"];

/// The first table: approve, sign, the client's answer, the pick, a Judge score, an overrule, an unlock.
/// Edits and votes are left out as noise, and no kind of cost is read.
pub const RULES: &[Rule] = &[
    Rule {
        id: "approve.v1",
        kind: "approve",
        action: Some("lock"),
        page_type: PageType::Job,
        template: "Version {version} was approved and locked on {at}.",
        slots: &[("version", SlotSpec::Number { min: 1, max: 9999 })],
    },
    Rule {
        id: "sign.v1",
        kind: "sign",
        action: None,
        page_type: PageType::Job,
        template: "The {role} signed on {at}.",
        slots: &[("role", SlotSpec::Enum(SIGNERS))],
    },
    Rule {
        id: "client_answer.v1",
        kind: "client_review",
        action: Some("client_answer"),
        page_type: PageType::Decision,
        template: "The client's answer on version {version} was {answer}, on {at}.",
        slots: &[
            ("answer", SlotSpec::Enum(ANSWERS)),
            ("version", SlotSpec::Number { min: 1, max: 9999 }),
        ],
    },
    Rule {
        id: "pick_route.v1",
        kind: "verdict",
        action: Some("pick_route"),
        page_type: PageType::Idea,
        template: "The creative director chose route {route} on {at}.",
        slots: &[("route", SlotSpec::Id)],
    },
    Rule {
        id: "score_work.v1",
        kind: "verdict",
        action: Some("score_work"),
        page_type: PageType::Outcome,
        template: "Judge scored {target} at {total} of 30 on {at}.",
        slots: &[
            ("total", SlotSpec::Number { min: 0, max: 30 }),
            ("target", SlotSpec::Id),
        ],
    },
    Rule {
        id: "overrule_score.v1",
        kind: "verdict",
        action: Some("overrule_score"),
        page_type: PageType::Decision,
        template: "The creative director overruled the score of {target} on {at}.",
        slots: &[("target", SlotSpec::Id)],
    },
    Rule {
        id: "unlock.v1",
        kind: "unlock",
        action: None,
        page_type: PageType::Job,
        template: "Version {version} was opened again on {at}.",
        slots: &[("version", SlotSpec::Number { min: 1, max: 9999 })],
    },
];

/// The rule that reads a decision of this kind and action, if any.
pub fn rule_for(kind: &str, action: &str) -> Option<&'static Rule> {
    RULES
        .iter()
        .find(|r| r.kind == kind && r.action.is_none_or(|a| a == action))
}

/// The role that answers for pages of a kind: creative owns ideas, planning owns what was learned and
/// what came of it, account service owns the client's history and the jobs.
pub fn owner_role(t: PageType) -> &'static str {
    match t {
        PageType::Idea => "creative-director",
        PageType::Outcome | PageType::Lesson => "planning",
        PageType::Decision
        | PageType::Client
        | PageType::Person
        | PageType::Tool
        | PageType::Job => "account-service",
    }
}

/// The plural a page of this kind is named with.
fn plural(t: PageType) -> &'static str {
    match t {
        PageType::Decision => "Decisions",
        PageType::Idea => "Ideas",
        PageType::Outcome => "Outcomes",
        PageType::Lesson => "Lessons",
        PageType::Client => "Client history",
        PageType::Person => "What they decided",
        PageType::Tool => "Tools",
        PageType::Job => "Job record",
    }
}

fn type_word(t: PageType) -> &'static str {
    match t {
        PageType::Decision => "decision",
        PageType::Idea => "idea",
        PageType::Outcome => "outcome",
        PageType::Lesson => "lesson",
        PageType::Client => "client",
        PageType::Person => "person",
        PageType::Tool => "tool",
        PageType::Job => "job",
    }
}

/// A derived line and the page it belongs on. The page's slug, title and summary are the rule's own
/// words and the job's id: nothing of a source.
#[derive(Debug, Clone, PartialEq)]
pub struct Derived {
    pub slug: String,
    pub page_type: PageType,
    pub title: String,
    pub summary: String,
    pub owner_role: &'static str,
    pub line: Line,
}

/// A row a rule would have read but could not take, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skipped {
    pub doc: String,
    pub decision: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Derivation {
    pub derived: Vec<Derived>,
    pub skipped: Vec<Skipped>,
    /// Rows no rule reads: edits, votes, costs.
    pub ignored: usize,
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[7] == b'-'
        && b[8..].iter().all(u8::is_ascii_digit)
}

fn is_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '-'))
}

fn take(rule: &Rule, row: &BrainDecision) -> Result<BTreeMap<String, Slot>, String> {
    let mut out = BTreeMap::new();
    for (name, spec) in rule.slots {
        let got = row.slots.get(*name);
        let slot = match (spec, got) {
            (SlotSpec::Enum(words), Some(Slot::Id(v))) if words.contains(&v.as_str()) => {
                Slot::Id(v.clone())
            }
            (SlotSpec::Number { min, max }, Some(Slot::Num(n)))
                if n.fract() == 0.0 && *n >= f64::from(*min) && *n <= f64::from(*max) =>
            {
                Slot::Num(*n)
            }
            (SlotSpec::Id, Some(Slot::Id(v))) if is_id(v) => Slot::Id(v.clone()),
            _ => {
                return Err(format!(
                    "{}: {name} is missing or is not what the rule takes",
                    rule.id
                ))
            }
        };
        out.insert((*name).to_string(), slot);
    }
    Ok(out)
}

/// Turn decision rows into derived lines, in the order the decisions were made. A row no rule reads is
/// counted and left alone; a row a rule reads but cannot take (no job, no date, a slot that is not an id,
/// an enum word or a number in range) is skipped with its reason. The same rows in any order give the
/// same result, and a repeated row is one line.
pub fn derive(rows: &[BrainDecision]) -> Derivation {
    let mut sorted: Vec<&BrainDecision> = rows.iter().collect();
    sorted.sort_by(|a, b| (&a.at, &a.doc, &a.id).cmp(&(&b.at, &b.doc, &b.id)));
    sorted.dedup_by(|a, b| a.doc == b.doc && a.id == b.id);
    let mut out = Derivation::default();
    for row in sorted {
        let Some(rule) = rule_for(&row.kind, &row.action) else {
            out.ignored += 1;
            continue;
        };
        let skip = |reason: String| Skipped {
            doc: row.doc.clone(),
            decision: row.id.clone(),
            reason,
        };
        if !is_id(&row.doc) || !is_id(&row.id) {
            out.skipped.push(skip(format!(
                "{}: the document or decision is not an id",
                rule.id
            )));
            continue;
        }
        if !is_date(&row.at) {
            out.skipped
                .push(skip(format!("{}: the date is not YYYY-MM-DD", rule.id)));
            continue;
        }
        let Some(job) = row.job.as_deref().filter(|j| is_id(j)) else {
            out.skipped
                .push(skip(format!("{}: the decision names no job", rule.id)));
            continue;
        };
        let slots = match take(rule, row) {
            Ok(s) => s,
            Err(why) => {
                out.skipped.push(skip(why));
                continue;
            }
        };
        let job_word = job.to_lowercase();
        out.derived.push(Derived {
            slug: format!("{}-{job_word}", type_word(rule.page_type)),
            page_type: rule.page_type,
            title: format!("{} on {job}", plural(rule.page_type)),
            summary: format!(
                "What was {} on {job}, each line with its source.",
                past(rule.page_type)
            ),
            owner_role: owner_role(rule.page_type),
            line: Line {
                id: line_id(&row.doc, &row.id, rule.id),
                kind: LineKind::Derived,
                rule: Some(rule.id.to_string()),
                cites: vec![Cite::Decision {
                    doc: row.doc.clone(),
                    decision: row.id.clone(),
                }],
                slots,
                state: LineState::Current,
                superseded_by: None,
                at: row.at.clone(),
                text: None,
                approved_by: None,
            },
        });
    }
    out
}

fn past(t: PageType) -> &'static str {
    match t {
        PageType::Idea => "chosen",
        PageType::Outcome => "scored",
        PageType::Decision => "decided",
        _ => "recorded",
    }
}

/// Group derived lines into pages by slug, validated against the page format.
pub fn assemble(d: &Derivation) -> HostResult<BTreeMap<String, Page>> {
    let mut pages: BTreeMap<String, Page> = BTreeMap::new();
    for x in &d.derived {
        pages
            .entry(x.slug.clone())
            .or_insert_with(|| Page {
                page_type: x.page_type,
                title: x.title.clone(),
                summary: x.summary.clone(),
                owner_role: x.owner_role.to_string(),
                links: vec![],
                lines: vec![],
            })
            .lines
            .push(x.line.clone());
    }
    for p in pages.values() {
        super::page::validate(p)?;
    }
    Ok(pages)
}
