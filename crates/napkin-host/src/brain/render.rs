// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The brain as markdown (features/brain-render.clan): `pages/<slug>.md`, `index.md` and `log.md`,
//! rendered when read and never stored.
//!
//! The sentence of a derived line is made here from its rule's template and its slots, so a rule's
//! wording can change without a new ingest, and the words are in no file. Pure and wasm-clean. The
//! source-bound parts (which cited decisions are shown today, through the allow list) come with the safe
//! reader in a later record; this renders what the brain stores.

use super::page::{Brain, Cite, Line, LineKind, LineState, Page, PageType, Slot};
use super::rules::{SlotSpec, RULES};

/// What a line says. A curated line says its own words; a derived line says its rule's template filled
/// from its slots and its date. A rule this build does not know still reads, with the date only.
pub fn sentence(line: &Line) -> String {
    let day = line.at.get(..10).unwrap_or(&line.at);
    if line.kind == LineKind::Curated {
        return line.text.clone().unwrap_or_default();
    }
    let rule = line
        .rule
        .as_deref()
        .and_then(|id| RULES.iter().find(|r| r.id == id));
    let Some(rule) = rule else {
        return format!("A decision was recorded on {day}.");
    };
    let mut out = String::new();
    let mut rest = rule.template;
    while let Some(i) = rest.find('{') {
        out.push_str(&rest[..i]);
        let Some(j) = rest[i..].find('}').map(|j| j + i) else {
            break;
        };
        let name = &rest[i + 1..j];
        if name == "at" {
            out.push_str(day);
        } else {
            let spec = rule.slots.iter().find(|(n, _)| *n == name).map(|(_, s)| s);
            match line.slots.get(name) {
                Some(Slot::Num(n)) if n.fract() == 0.0 => out.push_str(&format!("{}", *n as i64)),
                Some(Slot::Num(n)) => out.push_str(&n.to_string()),
                Some(Slot::Id(v)) if matches!(spec, Some(SlotSpec::Enum(_))) => {
                    out.push_str(&v.replace('_', " "))
                }
                Some(Slot::Id(v)) => out.push_str(v),
                None => {}
            }
        }
        rest = &rest[j + 1..];
    }
    out.push_str(rest);
    out
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

fn plural(t: PageType) -> &'static str {
    match t {
        PageType::Decision => "Decisions",
        PageType::Idea => "Ideas",
        PageType::Outcome => "Outcomes",
        PageType::Lesson => "Lessons",
        PageType::Client => "Clients",
        PageType::Person => "People",
        PageType::Tool => "Tools",
        PageType::Job => "Jobs",
    }
}

const ORDER: [PageType; 8] = [
    PageType::Decision,
    PageType::Idea,
    PageType::Outcome,
    PageType::Lesson,
    PageType::Client,
    PageType::Person,
    PageType::Tool,
    PageType::Job,
];

fn source_of(l: &Line) -> String {
    l.cites
        .iter()
        .map(|c| match c {
            Cite::Decision { doc, decision } => format!("`{doc}` `{decision}`"),
            Cite::Fact { fact } => format!("fact `{fact}`"),
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn line_md(brain: &Brain, l: &Line) -> String {
    let mut out = format!("- <a id=\"line-{}\"></a>", l.id);
    let words = sentence(l);
    match l.state {
        LineState::Current => out.push_str(&words),
        LineState::Superseded => out.push_str(&format!("~~{words}~~")),
    }
    out.push_str(&format!(" (source: {}", source_of(l)));
    if let Some(by) = &l.approved_by {
        out.push_str(&format!("; approved by {by}"));
    }
    out.push(')');
    if l.state == LineState::Superseded {
        if let Some(by) = &l.superseded_by {
            let replaced = brain
                .pages
                .values()
                .flat_map(|p| p.lines.iter())
                .find(|x| &x.id == by)
                .map_or(l.at.as_str(), |x| x.at.as_str());
            let day = replaced.get(..10).unwrap_or(replaced);
            out.push_str(&format!(
                " Superseded on {day} by [the line that replaced it](#line-{by})."
            ));
        }
    }
    out
}

fn page_head(p: &Page) -> String {
    format!(
        "---\ntitle: {}\ntype: {}\nsummary: {}\nowner: {}\n---\n\n# {}\n",
        p.title,
        type_word(p.page_type),
        p.summary,
        p.owner_role,
        p.title
    )
}

/// One page as markdown: front matter, its links both ways, and its lines with their sources. A
/// superseded line is struck through with the date of the line that replaced it and a link to it.
pub fn page_md(brain: &Brain, slug: &str) -> Option<String> {
    let page = brain.pages.get(slug)?;
    let mut out = page_head(page);
    let wiki = |slugs: Vec<&str>| {
        slugs
            .iter()
            .map(|s| format!("[[{s}]]"))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let linked_from: Vec<&str> = brain
        .pages
        .iter()
        .filter(|(s, p)| s.as_str() != slug && p.links.iter().any(|l| l == slug))
        .map(|(s, _)| s.as_str())
        .collect();
    if !page.links.is_empty() || !linked_from.is_empty() {
        out.push('\n');
        if !page.links.is_empty() {
            out.push_str(&format!(
                "Related: {}\n",
                wiki(page.links.iter().map(String::as_str).collect())
            ));
        }
        if !linked_from.is_empty() {
            out.push_str(&format!("Linked from: {}\n", wiki(linked_from)));
        }
    }
    out.push('\n');
    if page.lines.is_empty() {
        out.push_str("No lines yet.\n");
    }
    for l in &page.lines {
        out.push_str(&line_md(brain, l));
        out.push('\n');
    }
    Some(out)
}

/// `index.md`: every page, by type, with its one-line summary. Read from the pages, never stored, so a
/// new page is in it with no second write.
pub fn index_md(brain: &Brain) -> String {
    let mut out = String::from("# Index\n");
    for t in ORDER {
        let of: Vec<(&String, &Page)> = brain
            .pages
            .iter()
            .filter(|(_, p)| p.page_type == t)
            .collect();
        if of.is_empty() {
            continue;
        }
        out.push_str(&format!("\n## {}\n", plural(t)));
        for (slug, p) in of {
            out.push_str(&format!("- [[{slug}]] {}\n", p.summary));
        }
    }
    out
}

/// One entry of the brain document's own decision chain, as the log shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogEntry {
    /// When, `YYYY-MM-DD` or a full timestamp.
    pub at: String,
    pub kind: String,
    pub action: String,
    pub title: String,
}

/// What the log leaves out: what a run cost belongs to the decision tree, not to the agency's brain.
fn is_cost(e: &LogEntry) -> bool {
    ["run_cost", "set_budget", "budget"]
        .iter()
        .any(|c| e.kind == *c || e.action == *c)
}

/// `log.md`: the brain's own chain, one line per entry, in the order they were made (`## [date] action |
/// title`). Entries about what a run cost are left out.
pub fn log_md(entries: &[LogEntry]) -> String {
    let mut out = String::from("# Log\n\n");
    for e in entries.iter().filter(|e| !is_cost(e)) {
        let day = e.at.get(..10).unwrap_or(&e.at);
        out.push_str(&format!("## [{day}] {} | {}\n", e.action, e.title));
    }
    out
}
