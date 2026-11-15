// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! History is never rewritten (features/brain-append-only.clan; done_when 8 of features/napkin-brain.clan).
//!
//! A host rule for one app id, as `ops/gate.rs` has for the Brief Maker: a write to a brain document is
//! accepted only if what it leaves is a valid brain and every line that was there is still there,
//! unchanged, except that a current line may become superseded (naming the line that replaced it). New
//! lines and new pages are appends. Sources and proposals are not lines. Restore and undo reach a
//! document only through `patch-data`, so they follow the same rule: a restore or undo that would drop
//! or rewrite a line is refused with 409.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::page::{vault_of, Brain, BRAIN_APP};
use crate::document::Document;
use crate::error::{HostError, HostResult};

/// The one append key a brain takes: the curator's proposals.
const APPEND_KEYS: &[&str] = &["proposals"];

fn conflict(message: impl Into<String>) -> HostError {
    HostError::conflict(message)
}

/// RFC 7396 merge, as `patch-data` applies it.
fn merge(target: &mut Value, patch: &Value) {
    match patch {
        Value::Object(pm) => {
            if !target.is_object() {
                *target = Value::Object(Map::new());
            }
            let tm = target.as_object_mut().expect("made an object above");
            for (k, v) in pm {
                if v.is_null() {
                    tm.remove(k);
                } else {
                    merge(tm.entry(k.clone()).or_insert(Value::Null), v);
                }
            }
        }
        _ => *target = patch.clone(),
    }
}

fn data_of(doc: &Document) -> Value {
    let mut v = doc
        .clan()
        .read_entry("shared/data.yaml")
        .ok()
        .and_then(|b| serde_yaml::from_slice::<Value>(&b).ok())
        .unwrap_or(Value::Null);
    if let Some(o) = v.as_object_mut() {
        o.remove("$schema");
    }
    if v.is_null() {
        v = Value::Object(Map::new());
    }
    v
}

/// The lines of a brain's data by id, with the slug of the page each is on.
fn lines_of(data: &Value) -> BTreeMap<String, (String, Value)> {
    let mut out = BTreeMap::new();
    if let Some(pages) = data.get("pages").and_then(Value::as_object) {
        for (slug, page) in pages {
            for l in page
                .get("lines")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(id) = l.get("id").and_then(Value::as_str) {
                    out.insert(id.to_string(), (slug.clone(), l.clone()));
                }
            }
        }
    }
    out
}

fn without_state(l: &Value) -> Value {
    let mut l = l.clone();
    if let Some(o) = l.as_object_mut() {
        o.remove("state");
        o.remove("superseded_by");
    }
    l
}

/// Every line in `before` is in `after` on the same page, unchanged but for current to superseded.
pub fn check_append(before: &Value, after: &Value) -> HostResult<()> {
    if let Some(pages) = before.get("pages").and_then(Value::as_object) {
        for slug in pages.keys() {
            if after.get("pages").and_then(|p| p.get(slug)).is_none() {
                return Err(conflict(format!(
                    "page {slug} is never deleted: history is not rewritten"
                )));
            }
        }
    }
    let now = lines_of(after);
    for (id, (slug, was)) in lines_of(before) {
        let Some((on, is)) = now.get(&id) else {
            return Err(conflict(format!(
                "line {id} is never deleted: supersede it with a new line"
            )));
        };
        if *on != slug {
            return Err(conflict(format!("line {id} stays on its page")));
        }
        if *is == was {
            continue;
        }
        let was_current = was.get("state").and_then(Value::as_str) == Some("current");
        let now_superseded = is.get("state").and_then(Value::as_str) == Some("superseded");
        if was_current && now_superseded && without_state(&was) == without_state(is) {
            continue;
        }
        return Err(conflict(format!(
            "line {id} is never edited: supersede it with a new line"
        )));
    }
    Ok(())
}

/// The rule `patch_data` applies to a write: for a document of the brain's app, the data the write
/// leaves is a valid brain of this document's own vault and appends to what was there. Any other
/// app's document is not looked at.
pub fn refuse_unless_append(
    doc: &Document,
    patch: &Value,
    append_keys: &[String],
) -> HostResult<()> {
    let is_brain = doc
        .clan()
        .manifest()
        .app
        .as_ref()
        .is_some_and(|a| a.app_id == BRAIN_APP);
    if !is_brain {
        return Ok(());
    }
    if let Some(k) = append_keys
        .iter()
        .find(|k| !APPEND_KEYS.contains(&k.as_str()))
    {
        return Err(conflict(format!(
            "a brain takes appended proposals only, not {k:?}: lines are written whole"
        )));
    }
    let before = data_of(doc);
    let mut after = before.clone();
    merge(&mut after, patch);
    for key in append_keys {
        // An appended array is the old items then the new ones.
        if let Some(new) = patch.get(key) {
            let mut items = before
                .get(key)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            match new {
                Value::Array(more) => items.extend(more.iter().cloned()),
                one => items.push(one.clone()),
            }
            after[key] = Value::Array(items);
        }
    }
    if after == before {
        return Ok(());
    }
    // History first (a delete is a 409 however it is spelled), then the format, then the vault.
    check_append(&before, &after)?;
    let brain = Brain::from_value(after)?;
    if brain.vault != vault_of(doc.clan().manifest()) {
        return Err(HostError::bad_request(
            "the brain's vault is the vault its document is for",
        ));
    }
    Ok(())
}
