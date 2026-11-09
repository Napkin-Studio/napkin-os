// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The source card (`GET /cite`, `POST /cite`; OS-layer contract §8.3): one
//! answer for "where did this come from?" about any ref a page shows — a pin,
//! a finding, a source, a client's material, a passage from the library, a
//! person, an address — whichever app shows it.
//!
//! Each card is the [`Cite`] the decision view resolves, the same resolver,
//! with three things added:
//!
//! - `origin`: where the fact came from — `research`, `client`, `brand`,
//!   `layer`, `person` or `document`. A member entry's own `origin_kind` says
//!   it when the writer recorded it. Without one, only what the kind itself
//!   settles is said (a client's material is the client's, a library passage
//!   is the layer's, a `human:` cite is a person's); everything else is
//!   `document`, never a guess. (`origin` on a pin is already the layer row's
//!   `fact://` address, Contract campaign-clan §4, so the marker has its own
//!   name.)
//! - `from`: for something carried from an upstream document, which one.
//! - `review`: the latest review verdict on it (verified, rejected, set
//!   aside), with every earlier one in `history`, newest first.
//!
//! A read of one snapshot: nothing here writes.

use std::collections::{BTreeMap, BTreeSet};

use clan_sdk::decision::Decision;
use serde::Serialize;
use serde_json::Value;

use super::{clip, members_by_id, read_chain, read_schema, str_of, who, Cite, Lookup};
use crate::document::Document;
use crate::error::HostResult;
use crate::ops::{members, read};

/// Every origin a card can name.
pub const ORIGINS: [&str; 6] = ["research", "client", "brand", "layer", "person", "document"];

/// The member-entry field a writer records the origin in.
pub const ORIGIN_KEY: &str = "origin_kind";

/// What `/cite` answers for one ref.
#[derive(Debug, Serialize, PartialEq)]
pub struct SourceCard {
    #[serde(rename = "ref")]
    pub reference: String,
    #[serde(flatten)]
    pub cite: Cite,
    /// One of [`ORIGINS`].
    pub origin: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<CarriedFrom>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review: Option<Review>,
    /// Every review verdict on it, newest first; `review` is the first that
    /// still stands.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<Review>,
}

/// The upstream document a carried item came from.
#[derive(Debug, Serialize, PartialEq, Clone, Default)]
pub struct CarriedFrom {
    pub document_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    /// The revision it was carried at, for the direct parent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Where the shell opens it (`POST /open {path}`), when the store holds it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// One review verdict.
#[derive(Debug, Serialize, PartialEq, Clone)]
pub struct Review {
    /// `verified`, `rejected` or `set_aside`.
    pub verdict: &'static str,
    /// Who, as a person would say it.
    pub by: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// A later decision replaced it.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub superseded: bool,
}

/// The card for each of `refs`, keyed by the ref as asked. A ref the document
/// does not hold answers `kind: unknown`. `parent` finds an upstream document
/// by its document id, for its title and app (`None` keeps what the frozen
/// copy says); it is asked once per upstream document named.
pub fn source_cards(
    doc: &Document,
    refs: &[String],
    parent: impl Fn(&str) -> Option<Document>,
) -> HostResult<BTreeMap<String, SourceCard>> {
    let clan = doc.clan();
    let doc_id = clan.document_id().to_string();
    // A chain that does not read gives cards without reviews; the decision
    // view is where that problem is said.
    let chain = read_chain(clan).unwrap_or_default();
    let data = read::data_json(doc);
    let schema = read_schema(clan);
    let ctx = Lookup {
        doc_id: &doc_id,
        data: &data,
        schema: &schema,
        facts: members_by_id(clan, members::FACTS),
        findings: members_by_id(clan, members::FINDINGS),
        sources: members_by_id(clan, members::SOURCES),
        chain: &chain,
        carried: super::carried_home(clan, &chain),
    };

    let carried = clan.manifest().carried().cloned();
    let direct = carried
        .as_ref()
        .map(|c| c.document_id.clone())
        .unwrap_or_default();
    let direct_rev = clan
        .manifest()
        .lineage
        .as_ref()
        .map(|l| l.parent_id.clone());

    let mut cards: BTreeMap<String, SourceCard> = BTreeMap::new();
    for r in refs.iter().map(|r| r.trim()).filter(|r| !r.is_empty()) {
        if cards.contains_key(r) {
            continue;
        }
        cards.insert(r.to_string(), ctx.card(r));
    }

    // Ask the store once per upstream document a card names.
    let named: BTreeSet<String> = cards
        .values()
        .filter_map(|c| c.from.as_ref().map(|f| f.document_id.clone()))
        .collect();
    let mut found: BTreeMap<String, CarriedFrom> = BTreeMap::new();
    for id in named {
        let mut f = CarriedFrom {
            document_id: id.clone(),
            title: ctx.data_for(&id).and_then(frozen_title),
            ..Default::default()
        };
        if id == direct {
            f.version = direct_rev.clone();
        }
        if let Some(p) = parent(&id) {
            let pm = p.clan().manifest();
            f.title = Some(pm.title.clone()).filter(|t| !t.is_empty()).or(f.title);
            f.app_id = pm.app.as_ref().map(|a| a.app_id.clone());
            f.path = Some(p.id().to_string());
        }
        found.insert(id, f);
    }
    for c in cards.values_mut() {
        if let Some(f) = c.from.as_mut() {
            if let Some(full) = found.get(&f.document_id) {
                *f = full.clone();
            }
        }
    }
    Ok(cards)
}

/// What a frozen copy calls its document, when it says.
fn frozen_title(data: &Value) -> Option<String> {
    let s = |v: &Value| match v {
        Value::String(s) => Some(s.clone()),
        Value::Object(_) => v.get("value").and_then(Value::as_str).map(String::from),
        _ => None,
    };
    data.get("title")
        .and_then(s)
        .or_else(|| data.get("campaign")?.get("name").and_then(s))
        .or_else(|| data.get("name").and_then(s))
        .filter(|t| !t.trim().is_empty())
}

impl Lookup<'_> {
    fn card(&self, id: &str) -> SourceCard {
        let cite = self.cite(id);
        let (entry, from) = self.entry(id, cite.kind);
        let origin = self.origin(cite.kind, entry);
        let from = from.or_else(|| self.carried_member(id, cite.kind, entry));
        let history = self.reviews(id, cite.kind, entry);
        let review = history.iter().find(|r| !r.superseded).cloned();
        SourceCard {
            reference: id.to_string(),
            cite,
            origin,
            from: from.map(|document_id| CarriedFrom {
                document_id,
                ..Default::default()
            }),
            review,
            history,
        }
    }

    /// The record behind `id`, and — when it is found only in an ancestor's
    /// frozen copy — that ancestor's id.
    fn entry(&self, id: &str, kind: &str) -> (Option<&Value>, Option<String>) {
        match kind {
            "fact" => (self.facts.get(id), None),
            "finding" => (self.findings.get(id), None),
            "source" => (self.sources.get(id), None),
            "material" | "capture" | "passage" => {
                fn at<'v>(d: &'v Value, kind: &str, id: &str) -> Option<&'v Value> {
                    match kind {
                        "material" => d.get("materials")?.get(id),
                        "capture" => d.get("capture")?.get("items")?.get(id),
                        _ => d.get("passages")?.get(id),
                    }
                }
                if let Some(e) = at(self.data, kind, id) {
                    return (Some(e), None);
                }
                for (up, d) in self.upstream() {
                    if let Some(e) = at(d, kind, id) {
                        return (Some(e), Some(up.to_string()));
                    }
                }
                (None, None)
            }
            "address" => {
                let q = self.qualify(id);
                let doc = q.split_once('#').map_or("", |(d, _)| d);
                let from =
                    (doc != self.doc_id && self.data_for(doc).is_some()).then(|| doc.to_string());
                (None, from)
            }
            _ => (None, None),
        }
    }

    fn origin(&self, kind: &str, entry: Option<&Value>) -> &'static str {
        if let Some(o) = entry
            .and_then(|e| str_of(e, ORIGIN_KEY))
            .and_then(|o| ORIGINS.iter().find(|x| **x == o))
        {
            return o;
        }
        let typed = |m: Option<&Value>| m.and_then(|m| str_of(m, "kind")) == Some("prompt");
        match kind {
            // What a person typed into the prompt is theirs; any other
            // material is what the client sent.
            "material" if typed(entry) => "person",
            "material" => "client",
            "capture" => {
                let material = entry
                    .and_then(|c| str_of(c, "material_id"))
                    .and_then(|m| self.every_data().find_map(|d| d.get("materials")?.get(m)));
                if typed(material) {
                    "person"
                } else {
                    "client"
                }
            }
            "passage" => "layer",
            "person" => "person",
            _ => "document",
        }
    }

    /// A pin or finding carried from an ancestor: a decision in the carried
    /// chain names it on that ancestor (`<ancestor>#facts[<id>]`), or its own
    /// writing decision is on that ancestor.
    fn carried_member(&self, id: &str, kind: &str, entry: Option<&Value>) -> Option<String> {
        let path = match kind {
            "fact" => format!("facts[{id}]"),
            "finding" => format!("findings[{id}]"),
            _ => return None,
        };
        let upstream_doc = |address: &str| -> Option<String> {
            let (doc, _) = address.split_once('#')?;
            (doc != self.doc_id && self.data_for(doc).is_some()).then(|| doc.to_string())
        };
        if let Some(d) = entry
            .and_then(|e| str_of(e, "decision"))
            .and_then(|d| self.index_of(d))
            .map(|i| &self.chain.decisions[i])
        {
            if let Some(up) = d.targets.iter().find_map(|t| upstream_doc(t)) {
                return Some(up);
            }
        }
        self.chain.decisions.iter().rev().find_map(|d| {
            d.targets.iter().find_map(|t| {
                let (_, p) = t.split_once('#')?;
                (p == path).then(|| upstream_doc(t)).flatten()
            })
        })
    }

    /// Every review verdict on `id`, newest first, from the chain; without
    /// one, what the record itself says of its review.
    fn reviews(&self, id: &str, kind: &str, entry: Option<&Value>) -> Vec<Review> {
        let names: Box<dyn Fn(&String) -> bool> = match kind {
            "fact" | "finding" => {
                let path = format!(
                    "{}[{id}]",
                    if kind == "fact" { "facts" } else { "findings" }
                );
                // On this document or an ancestor's copy of it.
                Box::new(move |t: &String| t.split_once('#').map_or(t.as_str(), |(_, p)| p) == path)
            }
            "address" => {
                let address = self.qualify(id);
                Box::new(move |t: &String| self.qualify(t) == address)
            }
            _ => return Vec::new(),
        };
        let mut out: Vec<Review> = self
            .chain
            .decisions
            .iter()
            .filter(|d| d.targets.iter().any(|t| names(t)))
            .filter_map(review_of)
            .collect();
        if out.is_empty() {
            if let Some(r) = entry.and_then(recorded_review) {
                out.push(r);
            }
        }
        out
    }
}

/// A decision as a review verdict, when it is one.
fn review_of(d: &Decision) -> Option<Review> {
    let verdict = match (d.kind.as_deref(), d.polarity.as_deref()) {
        (Some("verify"), _) => "verified",
        (Some("verdict"), _) if d.action == crate::ops::review::SET_ASIDE => "set_aside",
        (Some("verdict"), _) if d.action == "looks_right" => return None,
        (Some("verdict"), Some("good")) => "verified",
        (Some("verdict"), Some("bad")) => "rejected",
        _ => return None,
    };
    Some(Review {
        verdict,
        by: who(d).name,
        actor: d.actor.clone(),
        at: Some(d.timestamp.clone()).filter(|t| !t.is_empty()),
        decision: d.id.clone(),
        note: Some(clip(&d.rationale, 280)).filter(|r| !r.is_empty()),
        superseded: d.superseded_by.is_some(),
    })
}

/// A review the record keeps of itself: a pin's `review`, a finding's
/// `verification` or `rejection`.
fn recorded_review(e: &Value) -> Option<Review> {
    let (verdict, r) = if let Some(r) = e.get("review").filter(|r| r.is_object()) {
        let v = match str_of(r, "verdict")? {
            "verified" => "verified",
            "rejected" => "rejected",
            _ => return None,
        };
        (v, r)
    } else if let Some(r) = e.get("verification").filter(|r| r.is_object()) {
        ("verified", r)
    } else if let Some(r) = e.get("rejection").filter(|r| r.is_object()) {
        ("rejected", r)
    } else {
        return None;
    };
    let actor = str_of(r, "by").map(String::from);
    Some(Review {
        verdict,
        by: actor
            .as_deref()
            .map(|a| match a.strip_prefix("human:").unwrap_or(a) {
                "local" => "You".to_string(),
                other => other.to_string(),
            })
            .unwrap_or_else(|| "someone".to_string()),
        actor,
        at: str_of(r, "at").map(String::from),
        decision: str_of(r, "decision").map(String::from),
        note: str_of(r, "reason").map(|s| clip(s, 280)),
        superseded: false,
    })
}
