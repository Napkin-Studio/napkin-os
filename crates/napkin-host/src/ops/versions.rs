// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Version history and restore (features/brief-versions-undo.clan; v2 section 4).
//!
//! A document has no second store of its past. Its versions are read from its own
//! decision chain: each live `approve` is a version (the first is v1), and the
//! working draft is whatever stands now. Every attributed `patch-data` records the
//! inverse of what it wrote, `before`: what each patched key held until then. The
//! document as it stood at an approve is the data now with the writes since undone,
//! newest first. Nothing is removed from the chain, which CLAN requires.
//!
//! A write that kept no `before` (an older edit, an agent's applied draft, a write
//! that appends) leaves a gap: the versions before it cannot be rebuilt, and the
//! list says so rather than guessing.
//!
//! Restore writes the old words into the working draft as one new attributed edit,
//! `restore v2`. It never touches an `approve`, an `unlock` or a `sign`: a signed
//! version stays locked as it was, and the restored draft is a new version to sign.

use serde::Serialize;
use serde_json::{json, Map, Value};

use clan_sdk::{Decision, DecisionChain};

use crate::ctx::Ctx;
use crate::document::Document;
use crate::error::{HostError, HostResult};

use super::edit::{PatchData, Unattributed};
use super::{json_merge, read, review, Outcome};

/// The key a write's inverse is kept under on its decision.
pub const BEFORE: &str = "before";

/// The action a restore is recorded as: `restore v2`.
pub const RESTORE_PREFIX: &str = "restore v";

/// Top-level keys that are not the brief's words: the host's own, and the
/// document's records of who signs and what is held. A version holds the rest.
const NOT_CONTENT: &[&str] = &[
    "projection",
    "upstream",
    "signers",
    "locked_fields",
    // A script's record of where a version was sent (features/script-editor.clan).
    "handoffs",
    "film",
];

/// What each of `keys` holds in the stored data now (null when it holds nothing):
/// the inverse of a write that patches exactly these keys.
pub fn before_of(doc: &Document, keys: &[String]) -> Value {
    let stored = stored_data(doc);
    let mut out = Map::new();
    for k in keys {
        out.insert(k.clone(), stored.get(k).cloned().unwrap_or(Value::Null));
    }
    Value::Object(out)
}

fn stored_data(doc: &Document) -> Value {
    doc.clan()
        .read_entry("shared/data.yaml")
        .ok()
        .and_then(|b| serde_yaml::from_slice::<serde_yaml::Value>(&b).ok())
        .and_then(|y| serde_json::to_value(y).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Map::new()))
}

fn content_of(data: &Value) -> Map<String, Value> {
    let mut m = data.as_object().cloned().unwrap_or_default();
    for k in NOT_CONTENT {
        m.remove(*k);
    }
    m
}

fn live(d: &Decision) -> bool {
    d.superseded_by.is_none()
}

/// Chain indices (newest first) of this document's own approvals: its versions.
fn approvals(chain: &DecisionChain, doc_id: &str) -> Vec<usize> {
    chain
        .decisions
        .iter()
        .enumerate()
        .filter(|(_, d)| {
            live(d) && d.kind.as_deref() == Some("approve") && d.targets.iter().any(|t| t == doc_id)
        })
        .map(|(i, _)| i)
        .collect()
}

fn person_of(d: &Decision) -> String {
    let who = d.actor.as_deref().unwrap_or(&d.agent);
    who.strip_prefix("human:").unwrap_or(who).to_string()
}

fn before_in(d: &Decision) -> Option<Value> {
    let v = d.extra.get(BEFORE)?;
    serde_json::to_value(v).ok().filter(Value::is_object)
}

/// Whether the decision changed the data (a write the chain names fields for).
fn wrote_data(d: &Decision) -> bool {
    live(d) && d.kind.as_deref() == Some("edit") && !d.fields_changed.is_empty()
}

/// The data as it stood at the approve at chain index `at`, or `None` when a write
/// since then kept no inverse.
fn rebuilt(doc: &Document, chain: &DecisionChain, at: usize) -> Option<Map<String, Value>> {
    let mut data = stored_data(doc).as_object().cloned().unwrap_or_default();
    for d in &chain.decisions[..at] {
        if !wrote_data(d) {
            continue;
        }
        let before = before_in(d)?;
        for (k, v) in before.as_object()? {
            if v.is_null() {
                data.remove(k);
            } else {
                data.insert(k.clone(), v.clone());
            }
        }
    }
    for k in NOT_CONTENT {
        data.remove(*k);
    }
    Some(data)
}

#[derive(Debug, Serialize, PartialEq)]
pub struct VersionRow {
    /// v1 is the first approve.
    pub n: usize,
    /// The approve decision that made it.
    pub decision: String,
    /// Who signed it, as the brief names them.
    pub signer: String,
    pub at: String,
    pub reason: String,
    /// This is the lock that holds now.
    pub locked: bool,
    /// Its words can be shown and restored.
    pub readable: bool,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Draft {
    /// The words differ from the newest approved version, or nothing is approved yet.
    pub changed: bool,
    /// The newest change to the draft was a restore of this version.
    pub restored_from: Option<usize>,
    pub edited_by: Option<String>,
    pub at: Option<String>,
    /// The newest write to the draft that kept its inverse: what the shell's undo
    /// stack takes for the person's own edit (their name, the keys, what they held).
    pub last_edit: Option<LastEdit>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct LastEdit {
    pub decision: String,
    pub person: String,
    pub keys: Vec<String>,
    pub before: Value,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct VersionsView {
    /// Newest first.
    pub versions: Vec<VersionRow>,
    pub draft: Draft,
}

/// `GET /versions`: each approved version with its signer and date, and the draft.
pub fn list(doc: &Document) -> HostResult<VersionsView> {
    let chain = review::chain_of(doc)?;
    let doc_id = doc.clan().document_id().to_string();
    let at = approvals(&chain, &doc_id);
    let lock = review::lock_index(&chain, &doc_id);
    let total = at.len();
    let versions = at
        .iter()
        .enumerate()
        .map(|(pos, &i)| {
            let d = &chain.decisions[i];
            VersionRow {
                n: total - pos,
                decision: d.id.clone().unwrap_or_default(),
                signer: person_of(d),
                at: d.timestamp.clone(),
                reason: d.rationale.clone(),
                locked: lock == Some(i),
                readable: rebuilt(doc, &chain, i).is_some(),
            }
        })
        .collect();

    let newest = chain.decisions.iter().position(wrote_data);
    let last_write = newest.map(|i| &chain.decisions[i]);
    let restored_from = last_write.and_then(|d| {
        d.action
            .strip_prefix(RESTORE_PREFIX)
            .and_then(|n| n.trim().parse().ok())
    });
    let changed = match at.first() {
        Some(&i) => chain.decisions[..i].iter().any(wrote_data),
        None => last_write.is_some(),
    };
    Ok(VersionsView {
        versions,
        draft: Draft {
            changed,
            restored_from,
            edited_by: last_write.map(person_of),
            at: last_write.map(|d| d.timestamp.clone()),
            last_edit: last_write.and_then(|d| {
                Some(LastEdit {
                    decision: d.id.clone().unwrap_or_default(),
                    person: person_of(d),
                    keys: d.fields_changed.clone(),
                    before: before_in(d)?,
                })
            }),
        },
    })
}

/// `GET /version?n=2` (or `n=draft`): the words of that version, part by part.
/// The brief's own parts only; what the host or the signing list holds is left out.
pub fn read_at(doc: &Document, which: &str) -> HostResult<Value> {
    if which == "draft" {
        return Ok(
            json!({ "n": "draft", "readable": true, "parts": content_of(&read::data_json(doc)) }),
        );
    }
    let n: usize = which
        .parse()
        .map_err(|_| HostError::bad_request("n is a version number, or draft"))?;
    let parts = parts_at(doc, n)?;
    Ok(json!({ "n": n, "readable": true, "parts": parts }))
}

fn parts_at(doc: &Document, n: usize) -> HostResult<Map<String, Value>> {
    let chain = review::chain_of(doc)?;
    let at = approvals(&chain, doc.clan().document_id());
    if n == 0 || n > at.len() {
        return Err(HostError::not_found(format!("this document has no v{n}")));
    }
    let i = at[at.len() - n];
    rebuilt(doc, &chain, i).ok_or_else(|| {
        HostError::conflict(format!(
            "v{n} cannot be shown: a change made after it was not kept in a way that can be undone"
        ))
    })
}

/// The merge patch that turns `from` into `to` (RFC 7396): changed keys set,
/// removed keys null, objects compared part by part.
fn merge_diff(from: &Value, to: &Value) -> Option<Value> {
    match (from, to) {
        (Value::Object(f), Value::Object(t)) => {
            let mut out = Map::new();
            for (k, tv) in t {
                match f.get(k) {
                    Some(fv) => {
                        if let Some(d) = merge_diff(fv, tv) {
                            out.insert(k.clone(), d);
                        }
                    }
                    None => {
                        out.insert(k.clone(), tv.clone());
                    }
                }
            }
            for k in f.keys().filter(|k| !t.contains_key(*k)) {
                out.insert(k.clone(), Value::Null);
            }
            (!out.is_empty()).then_some(Value::Object(out))
        }
        _ => (from != to).then(|| to.clone()),
    }
}

/// `POST /restore {version: 2}`: the working draft takes v2's words, as one new
/// attributed edit by this person. A person only; nothing about a lock changes.
pub fn restore(ctx: &Ctx, doc: &Document, n: usize) -> HostResult<Outcome> {
    review::person(ctx, "restore a version")?;
    let target = Value::Object(parts_at(doc, n)?);
    let now = Value::Object(content_of(&stored_data(doc)));
    let mut patch = Map::new();
    if let Some(Value::Object(p)) = merge_diff(&now, &target) {
        patch = p;
    }
    if patch.is_empty() {
        return Ok(Outcome::unchanged(
            json!({ "ok": true, "noop": true, "keys": [] }),
        ));
    }
    // What the patch would leave must be exactly v(n)'s words.
    debug_assert!({
        let mut check = now.clone();
        json_merge(&mut check, &Value::Object(patch.clone()));
        check == target
    });
    let body = json!({
        "patch": Value::Object(patch),
        "agent": "human",
        "action": format!("{RESTORE_PREFIX}{n}"),
        "rationale": format!("Restored from v{n}"),
    });
    let input = PatchData::parse_with(&body.to_string(), Unattributed::Refuse)?;
    super::edit::patch_data(ctx, doc, input)
}
