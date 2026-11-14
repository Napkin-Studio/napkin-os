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
/// document's records of who signs, what is held and what may be read. A
/// version holds the rest; the compare view shows only that. Keep `NOT_WORDS`
/// in app/src/shell/versions/useBriefUndo.ts the same.
///
/// A restore writes the words of the version and never leaves a part less
/// protected than it is now, or than it was when those words were current (the
/// lead's decision on the security review of this file): the marks below are
/// kept as they are now, except [`MARKS`] and [`LICENSED`], which take the
/// protective side of the two. Classify marks and locks live in the chain,
/// which a restore never touches.
const NOT_CONTENT: &[&str] = &[
    "projection",
    "upstream",
    "signers",
    "locked_fields",
    // An older brief's lock flag (os-layer.md 7.1: the lock is the approve).
    "locked",
    MARKS,
    // What was received, and what was retrieved, each entry under its own
    // `licence` (the nested mark).
    "materials",
    "passages",
    // A script's record of where a version was sent (features/script-editor.clan).
    "handoffs",
    "film",
];

/// The parts a person marked Confidential (os-layer.md, Confidential). After a
/// restore, a part is marked if it is marked now or was in the version.
const MARKS: &str = "confidential_fields";

/// Records whose entries carry a `licence`. A restore brings back the version's
/// entries (so the words' evidence, `capture`, finds what it cites), keeps the
/// entries received since, and gives each the stricter licence of the two.
const LICENSED: &[&str] = &["materials", "passages"];

/// How far a licence keeps a thing in (the schema's `licence`); a value it does
/// not know keeps it in furthest.
fn strictness(licence: &str) -> u8 {
    match licence {
        "open" => 0,
        "licensed-internal" => 1,
        "client-confidential" => 2,
        _ => 3,
    }
}

/// The marks after a restore: those that stand now, then those the version had.
fn kept_marks(now: Option<&Value>, then: Option<&Value>) -> Option<Value> {
    let list = |v: Option<&Value>| -> Vec<Value> {
        v.and_then(Value::as_array).cloned().unwrap_or_default()
    };
    let mut out = list(now);
    let before = out.len();
    for m in list(then) {
        if !out.contains(&m) {
            out.push(m);
        }
    }
    (out.len() > before).then_some(Value::Array(out))
}

fn licence_of(entry: Option<&Value>) -> Option<&str> {
    entry?.get("licence")?.as_str()
}

/// One licensed record after a restore (see [`LICENSED`]), as the merge patch
/// from what it holds now; `None` when nothing changes.
fn kept_entries(now: Option<&Value>, then: Option<&Value>) -> Option<Value> {
    let empty = Map::new();
    let now_map = now.and_then(Value::as_object).unwrap_or(&empty);
    let then_map = then.and_then(Value::as_object)?;
    let mut merged = now_map.clone();
    for (id, entry) in then_map {
        let mut entry = entry.clone();
        let stricter = match (licence_of(now_map.get(id)), licence_of(Some(&entry))) {
            (Some(a), Some(b)) => Some(if strictness(a) >= strictness(b) { a } else { b }),
            (a, b) => a.or(b),
        }
        .map(str::to_string);
        if let (Some(l), Some(o)) = (stricter, entry.as_object_mut()) {
            o.insert("licence".into(), Value::String(l));
        }
        merged.insert(id.clone(), entry);
    }
    match now {
        Some(v) if v.is_object() => merge_diff(v, &Value::Object(merged)),
        _ => (!merged.is_empty()).then_some(Value::Object(merged)),
    }
}

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
pub(super) fn approvals(chain: &DecisionChain, doc_id: &str) -> Vec<usize> {
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

/// How many versions of this document have been approved: the number of the newest (0 before the first).
pub fn approved_count(doc: &Document) -> usize {
    review::chain_of(doc)
        .map(|chain| approvals(&chain, &doc.clan().document_id().to_string()).len())
        .unwrap_or(0)
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

/// The data as it stood at the approve at chain index `at`, marks and all, or
/// `None` when a write since then kept no inverse.
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
    /// Edited since the newest approved version (as the gate reads it), or
    /// nothing is approved yet.
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
        // The one answer the gate gives too (gate.rs): any edit since.
        Some(&i) => super::gate::edited_since(&chain, i),
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
    let parts = content_of(&Value::Object(full_at(doc, n)?));
    Ok(json!({ "n": n, "readable": true, "parts": parts }))
}

/// The whole data at v`n`, marks and all.
fn full_at(doc: &Document, n: usize) -> HostResult<Map<String, Value>> {
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
/// No part comes out less protected than it is now or was in v2 ([`NOT_CONTENT`]).
pub fn restore(ctx: &Ctx, doc: &Document, n: usize) -> HostResult<Outcome> {
    review::person(ctx, "restore a version")?;
    let then = full_at(doc, n)?;
    let target = Value::Object(content_of(&Value::Object(then.clone())));
    let stored = stored_data(doc);
    let now = Value::Object(content_of(&stored));
    let mut patch = Map::new();
    if let Some(Value::Object(p)) = merge_diff(&now, &target) {
        patch = p;
    }
    if let Some(m) = kept_marks(stored.get(MARKS), then.get(MARKS)) {
        patch.insert(MARKS.into(), m);
    }
    for k in LICENSED {
        if let Some(d) = kept_entries(stored.get(*k), then.get(*k)) {
            patch.insert((*k).into(), d);
        }
    }
    if patch.is_empty() {
        return Ok(Outcome::unchanged(
            json!({ "ok": true, "noop": true, "keys": [] }),
        ));
    }
    // What the patch would leave must hold exactly v(n)'s words.
    debug_assert!({
        let mut check = stored.clone();
        json_merge(&mut check, &Value::Object(patch.clone()));
        Value::Object(content_of(&check)) == target
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
