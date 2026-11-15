// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The brain's page format, fixed and checked (features/brain-page-model.clan).
//!
//! A page has a type, a title, a summary of 20 words or fewer, an owner role and lines. Every line has
//! an id, at least one cite and a state. A derived line holds no words from a source: it stores
//! `{id, rule, cites, slots, state, superseded_by, at}` where a slot is an id, an enum word, a date or a
//! number. Every refusal is a `400`, so a write that breaks the format is refused the way any bad
//! request is. The same checks mirror `app/templates/agency-brain/schema.json`.
//!
//! Nothing scores a person: a person page says what someone decided or owns, never counts, lateness
//! or rankings.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agency::REGISTRY_TAG;
use crate::error::{HostError, HostResult};
use crate::store::{DocId, DocStore};

/// The tool whose documents are brains.
pub const BRAIN_APP: &str = crate::searchindex::BRAIN_APP;

/// The brain's data in a document.
const DATA: &str = "shared/data.yaml";
/// The registry document's id as the build names it. The brain never reads it.
const REGISTRY_DOC: &str = "home-agency-v1";

/// The longest id: a document, decision, line, rule or client id.
pub const MAX_ID: usize = 64;
/// The longest summary, in words.
pub const MAX_SUMMARY_WORDS: usize = 20;
const MAX_TITLE: usize = 120;
const MAX_TEXT: usize = 600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VaultKind {
    Agency,
    Client,
}

/// Whose brain this is. A client's brain names its client; the agency's names none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Vault {
    pub kind: VaultKind,
    #[serde(default)]
    pub client: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PageType {
    Decision,
    Idea,
    Outcome,
    Lesson,
    Client,
    Person,
    Tool,
    Job,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineKind {
    Derived,
    Curated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineState {
    Current,
    Superseded,
}

/// What a line points at: a decision in a document, or a layer fact pin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum Cite {
    Decision { doc: String, decision: String },
    Fact { fact: String },
}

/// A slot value: an id (or enum word, or date: a string with no spaces, at most 64 characters) or a
/// number. Never a sentence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Slot {
    Id(String),
    Num(f64),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Line {
    pub id: String,
    pub kind: LineKind,
    /// The rule that made a derived line. Absent on a curated line a person wrote outright.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
    pub cites: Vec<Cite>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub slots: BTreeMap<String, Slot>,
    pub state: LineState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub superseded_by: Option<String>,
    pub at: String,
    /// A curated line's words, a person's own. A derived line has none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    #[serde(rename = "type")]
    pub page_type: PageType,
    pub title: String,
    pub summary: String,
    pub owner_role: String,
    #[serde(default)]
    pub links: Vec<String>,
    pub lines: Vec<Line>,
}

/// Where the ingest read a source document up to, so it can resume.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub head: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Brain {
    pub vault: Vault,
    #[serde(default)]
    pub pages: BTreeMap<String, Page>,
    #[serde(default)]
    pub sources: BTreeMap<String, Source>,
    #[serde(default)]
    pub proposals: Vec<Value>,
}

fn bad(message: impl Into<String>) -> HostError {
    HostError::bad_request(message)
}

/// The id of a derived line: the first 16 hex digits of the sha256 of its document, decision and rule.
/// Stable, so a rebuild into a fresh brain gives the same ids.
pub fn line_id(doc: &str, decision: &str, rule: &str) -> String {
    let joined = format!("{doc}\u{0}{decision}\u{0}{rule}");
    clan_sdk::hash::sha256_hex(joined.as_bytes())[..16].to_string()
}

/// An id: 1 to 64 of letters, digits and `_ . : -`. No space, so no sentence.
fn is_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_ID
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '-'))
}

fn is_slug(s: &str) -> bool {
    let mut cs = s.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && s.len() <= 80
        && cs.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// `YYYY-MM-DD`, then optionally `T` and a time ending in `Z`.
fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 10
        || !(b[..4].iter().all(u8::is_ascii_digit)
            && b[4] == b'-'
            && b[5..7].iter().all(u8::is_ascii_digit)
            && b[7] == b'-'
            && b[8..10].iter().all(u8::is_ascii_digit))
    {
        return false;
    }
    let rest = &s[10..];
    rest.is_empty()
        || (rest.starts_with('T')
            && rest.ends_with('Z')
            && rest[1..rest.len() - 1]
                .chars()
                .all(|c| c.is_ascii_digit() || c == ':' || c == '.'))
}

/// Words that count, time or rank a person. A person page may carry none of them as a rule, a slot
/// name or a word of a curated line, and no number as a slot value (a count is a number).
const SCORING: &[&str] = &[
    "count",
    "counts",
    "counted",
    "score",
    "scores",
    "scored",
    "scoring",
    "rank",
    "ranks",
    "ranked",
    "ranking",
    "rankings",
    "late",
    "lateness",
    "overdue",
    "delay",
    "delayed",
    "delays",
    "missed",
    "rating",
    "ratings",
    "rated",
    "average",
    "averages",
    "avg",
    "total",
    "totals",
    "percent",
    "percentage",
    "pct",
    "streak",
    "leaderboard",
    "performance",
    "speed",
    "sla",
    "tally",
    "quota",
    "ontime",
    "deadline",
    "deadlines",
];

fn scoring_words(s: &str) -> Option<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .find(|w| SCORING.contains(w))
        .map(str::to_string)
}

fn check_line(page_type: PageType, l: &Line) -> HostResult<()> {
    let at = format!("line {}", l.id);
    if !is_id(&l.id) {
        return Err(bad(format!(
            "a line's id is an id of at most {MAX_ID} characters"
        )));
    }
    if l.cites.is_empty() {
        return Err(bad(format!("{at} has no cite: no source, no line")));
    }
    for c in &l.cites {
        let ok = match c {
            Cite::Decision { doc, decision } => is_id(doc) && is_id(decision),
            Cite::Fact { fact } => is_id(fact),
        };
        if !ok {
            return Err(bad(format!("{at} has a cite that is not an id")));
        }
    }
    if !is_date(&l.at) {
        return Err(bad(format!("{at} has no valid date")));
    }
    match (l.state, &l.superseded_by) {
        (LineState::Current, Some(_)) => {
            return Err(bad(format!(
                "{at} is current but names a line that replaced it"
            )))
        }
        (LineState::Superseded, None) => {
            return Err(bad(format!(
                "{at} is superseded but names no line that replaced it"
            )))
        }
        (LineState::Superseded, Some(by)) if !is_id(by) => {
            return Err(bad(format!("{at} names a replacement that is not an id")))
        }
        _ => {}
    }
    for (key, slot) in &l.slots {
        if !is_id(key) {
            return Err(bad(format!("{at}: slot name {key:?} is not an id")));
        }
        match slot {
            Slot::Id(v) if !is_id(v) => {
                return Err(bad(format!(
                    "{at}: slot {key} is not an id, an enum word or a date (a derived line holds no free text)"
                )))
            }
            Slot::Num(n) if !n.is_finite() => {
                return Err(bad(format!("{at}: slot {key} is not a number")))
            }
            _ => {}
        }
    }
    match l.kind {
        LineKind::Derived => {
            if l.text.is_some() || l.approved_by.is_some() {
                return Err(bad(format!(
                    "{at} is derived and holds no text: its sentence is made when the page is read"
                )));
            }
            match &l.rule {
                Some(r) if is_id(r) => {}
                _ => return Err(bad(format!("{at} is derived and names no rule"))),
            }
        }
        LineKind::Curated => {
            match &l.text {
                Some(t) if !t.trim().is_empty() && t.chars().count() <= MAX_TEXT => {}
                _ => {
                    return Err(bad(format!(
                        "{at} is curated and needs its text, at most {MAX_TEXT} characters"
                    )))
                }
            }
            match &l.approved_by {
                Some(a) if is_id(a) => {}
                _ => return Err(bad(format!("{at} is curated and names no approver"))),
            }
        }
    }
    if page_type == PageType::Person {
        let refuse = |what: &str| {
            bad(format!(
                "{at}: a person page says what someone decided or owns, never counts, lateness or rankings ({what})"
            ))
        };
        if let Some(r) = &l.rule {
            if let Some(w) = scoring_words(r) {
                return Err(refuse(&format!("rule {r:?} says {w:?}")));
            }
        }
        for (key, slot) in &l.slots {
            if let Some(w) = scoring_words(key) {
                return Err(refuse(&format!("slot {key:?} says {w:?}")));
            }
            if matches!(slot, Slot::Num(_)) {
                return Err(refuse(&format!("slot {key:?} is a number")));
            }
            if let Slot::Id(v) = slot {
                if let Some(w) = scoring_words(v) {
                    return Err(refuse(&format!("slot {key:?} says {w:?}")));
                }
            }
        }
        if let Some(t) = &l.text {
            if let Some(w) = scoring_words(t) {
                return Err(refuse(&format!("the text says {w:?}")));
            }
        }
    }
    Ok(())
}

/// Check one page against the format. `400` on the first breach.
pub fn validate(page: &Page) -> HostResult<()> {
    let title = page.title.trim();
    if title.is_empty() || page.title.chars().count() > MAX_TITLE {
        return Err(bad(format!(
            "a page's title is 1 to {MAX_TITLE} characters"
        )));
    }
    let words = page.summary.split_whitespace().count();
    if words == 0 || words > MAX_SUMMARY_WORDS {
        return Err(bad(format!(
            "a page's summary is 1 to {MAX_SUMMARY_WORDS} words, this one has {words}"
        )));
    }
    if !is_id(&page.owner_role) {
        return Err(bad("a page names an owner role"));
    }
    if page.links.iter().any(|l| !is_slug(l)) {
        return Err(bad("a page's links are page slugs"));
    }
    let mut seen = BTreeSet::new();
    for l in &page.lines {
        check_line(page.page_type, l)?;
        if !seen.insert(l.id.as_str()) {
            return Err(bad(format!("two lines on one page share the id {}", l.id)));
        }
    }
    if page.page_type == PageType::Person {
        if let Some(w) = scoring_words(&page.title).or_else(|| scoring_words(&page.summary)) {
            return Err(bad(format!(
                "a person page says what someone decided or owns, never counts, lateness or rankings (it says {w:?})"
            )));
        }
    }
    Ok(())
}

impl Brain {
    /// An empty brain of this vault.
    pub fn empty(vault: Vault) -> Self {
        Self {
            vault,
            pages: BTreeMap::new(),
            sources: BTreeMap::new(),
            proposals: vec![],
        }
    }

    /// Check the brain: its vault, every page slug and page, every link, and the line ids across the
    /// brain (one id names one line).
    pub fn validate(&self) -> HostResult<()> {
        match (&self.vault.kind, &self.vault.client) {
            (VaultKind::Agency, Some(_)) => return Err(bad("the agency's brain names no client")),
            (VaultKind::Client, None) => return Err(bad("a client's brain names its client")),
            (VaultKind::Client, Some(c)) if !is_client_id(c) => {
                return Err(bad("a client's id is cli_ and eight hex digits"))
            }
            _ => {}
        }
        let mut ids = BTreeSet::new();
        for (slug, page) in &self.pages {
            if !is_slug(slug) {
                return Err(bad(format!("{slug:?} is not a page slug")));
            }
            validate(page)?;
            for l in &page.links {
                if !self.pages.contains_key(l) {
                    return Err(bad(format!(
                        "page {slug} links to {l}, which is not a page"
                    )));
                }
            }
            for l in &page.lines {
                if !ids.insert(l.id.as_str()) {
                    return Err(bad(format!("the line id {} is on two pages", l.id)));
                }
            }
        }
        for page in self.pages.values() {
            for l in &page.lines {
                if let Some(by) = &l.superseded_by {
                    if by == &l.id || !ids.contains(by.as_str()) {
                        return Err(bad(format!(
                            "line {} names {by} as its replacement, which is not another line of the brain",
                            l.id
                        )));
                    }
                }
            }
        }
        for (doc, s) in &self.sources {
            if !is_id(doc) || !is_id(&s.head) {
                return Err(bad("a source is named by ids"));
            }
        }
        Ok(())
    }

    /// Read a brain from a document's data and check it. A bad shape (a derived line with a `text`, a
    /// page type outside the eight, a key nobody declared) is a `400`, like any other breach.
    pub fn from_value(data: Value) -> HostResult<Self> {
        let brain: Brain =
            serde_json::from_value(data).map_err(|e| bad(format!("not a brain: {e}")))?;
        brain.validate()?;
        Ok(brain)
    }
}

fn is_client_id(s: &str) -> bool {
    s.len() == 12
        && s.starts_with("cli_")
        && s[4..].chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

/// The vault a document is for, by its manifest: the client's if it names one, the agency's if not.
pub fn vault_of(manifest: &clan_sdk::Manifest) -> Vault {
    Vault {
        kind: if manifest.client.is_some() {
            VaultKind::Client
        } else {
            VaultKind::Agency
        },
        client: manifest.client.as_ref().map(|c| c.id.clone()),
    }
}

/// Open a brain through the store. Refuses the agency's registry document without reading it, and
/// any document that is not a brain. A brain with no data yet is empty: its vault is the manifest's,
/// the client's if the manifest names one and the agency's if it does not. A document whose data
/// names another vault than its manifest does is refused.
pub fn open(store: &dyn DocStore, id: &DocId) -> HostResult<Brain> {
    let is_registry =
        id.as_str() == REGISTRY_DOC || store.home(REGISTRY_TAG).map(|r| &r == id).unwrap_or(false);
    if is_registry {
        return Err(HostError::new(
            403,
            "the agency's registry is not a brain and is never read as one",
        ));
    }
    let clan = clan_sdk::ClanFile::from_bytes(store.read(id)?)
        .map_err(|e| bad(format!("not a document: {e}")))?;
    let manifest = clan.manifest();
    if manifest.app.as_ref().map(|a| a.app_id.as_str()) != Some(BRAIN_APP) {
        return Err(bad(format!("{id} is not a brain")));
    }
    let vault = vault_of(manifest);
    let raw = clan.read_entry(DATA).unwrap_or_default();
    let data: Value = serde_yaml::from_slice(&raw).unwrap_or(Value::Null);
    let mut obj = match data {
        Value::Object(o) => o,
        _ => serde_json::Map::new(),
    };
    obj.remove("$schema");
    if obj.is_empty() {
        return Ok(Brain::empty(vault));
    }
    let brain = Brain::from_value(Value::Object(obj))?;
    if brain.vault != vault {
        return Err(HostError::conflict(
            "the brain's data names another vault than its manifest does",
        ));
    }
    Ok(brain)
}
