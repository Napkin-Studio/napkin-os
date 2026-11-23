// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Brand Bible diff (`docs/contracts/brand-clan.md` section 4).
//!
//! One deterministic function over two bibles (a bible is `shared/data.yaml`
//! without `kit`), used for the draft's "changed" marks, the publish confirm,
//! the what-changed review of a new version, and the changelog. List items are
//! matched by their stable `id`, never by position.

use serde_json::{json, Map, Value};

/// A scalar section: `(area, path, label)`.
const SCALARS: [(&str, &[&str], &str); 6] = [
    ("name", &["name"], "Name"),
    ("note", &["note"], "Note"),
    ("logo_note", &["visual", "logo_note"], "Logo note"),
    ("tone", &["voice", "tone"], "Tone"),
    ("imagery_style", &["imagery", "style"], "Imagery style"),
    ("source", &["source"], "Source"),
];

/// A list of objects with an `id`: `(area, path)`.
const LISTS: [(&str, &[&str]); 5] = [
    ("logo", &["visual", "logos"]),
    ("colour", &["visual", "colours"]),
    ("typography", &["visual", "typography"]),
    ("rule", &["voice", "rules"]),
    ("example", &["imagery", "examples"]),
];

/// The order changes are listed in (stable, see the vectors).
const ORDER: [&str; 12] = [
    "name",
    "note",
    "logo",
    "logo_note",
    "colour",
    "typography",
    "tone",
    "rule",
    "imagery_style",
    "imagery_ban",
    "example",
    "source",
];

const BANS: &[&str] = &["imagery", "bans"];

fn at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter().try_fold(v, |v, k| v.get(*k))
}

fn at_mut<'a>(v: &'a mut Value, path: &[&str]) -> &'a mut Value {
    let mut cur = v;
    for k in path {
        if !cur.is_object() {
            *cur = Value::Object(Map::new());
        }
        cur = cur
            .as_object_mut()
            .expect("an object")
            .entry((*k).to_string())
            .or_insert(Value::Null);
    }
    cur
}

fn items<'a>(v: &'a Value, path: &[&str]) -> Vec<&'a Value> {
    at(v, path)
        .and_then(Value::as_array)
        .map(|a| a.iter().collect())
        .unwrap_or_default()
}

fn id_of(item: &Value) -> &str {
    item.get("id").and_then(Value::as_str).unwrap_or("")
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

/// Scalars compare as text; `source` compares by its file and asset.
fn scalar_text(area: &str, v: Option<&Value>) -> String {
    match (area, v) {
        (_, None) | (_, Some(Value::Null)) => String::new(),
        ("source", Some(o)) => format!("{}|{}", s(o, "file"), s(o, "asset")),
        (_, Some(Value::String(t))) => t.trim().to_string(),
        (_, Some(other)) => other.to_string(),
    }
}

fn weight_use(t: &Value) -> String {
    [s(t, "weight"), s(t, "use")]
        .iter()
        .filter(|p| !p.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(" ")
}

fn label_of(area: &str, item: &Value) -> String {
    let pick = |k: &str| {
        let v = s(item, k);
        if v.is_empty() {
            id_of(item).to_string()
        } else {
            v.to_string()
        }
    };
    match area {
        "logo" => pick("label"),
        "colour" => pick("name"),
        "typography" => pick("family"),
        "rule" => pick("text"),
        "example" => {
            let n = s(item, "note");
            if n.is_empty() {
                id_of(item).to_string()
            } else {
                n.to_string()
            }
        }
        _ => id_of(item).to_string(),
    }
}

fn list_text(area: &str, kind: &str, old: Option<&Value>, new: Option<&Value>) -> String {
    let label = label_of(area, new.or(old).expect("one side"));
    match (area, kind) {
        ("logo", "added") => format!("Logo {label} added"),
        ("logo", "removed") => format!("Logo {label} removed"),
        ("logo", _) => {
            if s(old.unwrap(), "asset") != s(new.unwrap(), "asset") {
                format!("Logo {label} replaced")
            } else {
                format!("Logo {label} changed")
            }
        }
        ("colour", "added") => format!("Colour {label} {} added", s(new.unwrap(), "hex")),
        ("colour", "removed") => format!("Colour {label} removed"),
        ("colour", _) => {
            let (o, n) = (old.unwrap(), new.unwrap());
            if s(o, "hex") != s(n, "hex") {
                format!("{} {} becomes {}", s(n, "name"), s(o, "hex"), s(n, "hex"))
            } else if s(o, "name") != s(n, "name") {
                format!("{} renamed {}", s(o, "name"), s(n, "name"))
            } else if s(o, "role") != s(n, "role") {
                format!(
                    "{} role {} becomes {}",
                    s(n, "name"),
                    s(o, "role"),
                    s(n, "role")
                )
            } else {
                format!("{label} changed")
            }
        }
        ("typography", "added") => format!("Typeface {label} added"),
        ("typography", "removed") => format!("Typeface {label} removed"),
        ("typography", _) => {
            let (o, n) = (old.unwrap(), new.unwrap());
            if s(o, "family") != s(n, "family") {
                format!("Typeface {} becomes {}", s(o, "family"), s(n, "family"))
            } else {
                format!(
                    "{}: {} becomes {}",
                    s(n, "family"),
                    weight_use(o),
                    weight_use(n)
                )
            }
        }
        ("rule", "added") => format!("Rule added: “{label}”"),
        ("rule", "removed") => format!("Rule removed: “{label}”"),
        ("rule", _) => format!(
            "Rule changed: “{}” becomes “{}”",
            s(old.unwrap(), "text"),
            s(new.unwrap(), "text")
        ),
        ("example", "added") => "Example picture added".into(),
        ("example", "removed") => "Example picture removed".into(),
        ("example", _) => "Example picture replaced".into(),
        _ => format!("{label} {kind}"),
    }
}

fn scalar_change(
    area: &str,
    label: &str,
    old: Option<&Value>,
    new: Option<&Value>,
) -> Option<Value> {
    let (ot, nt) = (scalar_text(area, old), scalar_text(area, new));
    if ot == nt {
        return None;
    }
    let kind = if ot.is_empty() {
        "added"
    } else if nt.is_empty() {
        "removed"
    } else {
        "changed"
    };
    let text = if kind == "removed" {
        format!("{label} cleared")
    } else if area == "source" {
        format!("Source is now {}", new.map(|n| s(n, "file")).unwrap_or(""))
    } else {
        format!("{label} becomes “{nt}”")
    };
    Some(json!({
        "id": area, "area": area, "kind": kind, "label": label,
        "old": old.cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null),
        "new": new.cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null),
        "text": text,
    }))
}

/// The changes that turn bible `old` into bible `new`. A list item missing
/// from `new` is `removed`. (A proposal is merged first: [`merge_proposal`].)
pub fn changes(old: &Value, new: &Value) -> Vec<Value> {
    let mut by_area: Vec<(usize, Value)> = Vec::new();
    let rank = |a: &str| ORDER.iter().position(|x| *x == a).unwrap_or(ORDER.len());
    for (area, path, label) in SCALARS {
        if let Some(c) = scalar_change(area, label, at(old, path), at(new, path)) {
            by_area.push((rank(area), c));
        }
    }
    for (area, path) in LISTS {
        let (o, n) = (items(old, path), items(new, path));
        // Items of `new` in their order (added and changed), then what vanished.
        for item in &n {
            let id = id_of(item);
            match o.iter().find(|x| id_of(x) == id) {
                None => by_area.push((
                    rank(area),
                    json!({"id": format!("{area}:{id}"), "area": area, "kind": "added",
                        "label": label_of(area, item), "old": null, "new": item,
                        "text": list_text(area, "added", None, Some(item))}),
                )),
                Some(prev) if *prev != *item => by_area.push((
                    rank(area),
                    json!({"id": format!("{area}:{id}"), "area": area, "kind": "changed",
                        "label": label_of(area, item), "old": prev, "new": item,
                        "text": list_text(area, "changed", Some(prev), Some(item))}),
                )),
                Some(_) => {}
            }
        }
        for prev in &o {
            let id = id_of(prev);
            if !n.iter().any(|x| id_of(x) == id) {
                by_area.push((
                    rank(area),
                    json!({"id": format!("{area}:{id}"), "area": area, "kind": "removed",
                        "label": label_of(area, prev), "old": prev, "new": null,
                        "text": list_text(area, "removed", Some(prev), None)}),
                ));
            }
        }
    }
    let (ob, nb) = (strings(old), strings(new));
    for b in &nb {
        if !ob.contains(b) {
            by_area.push((
                rank("imagery_ban"),
                json!({"id": format!("imagery_ban:{b}"), "area": "imagery_ban", "kind": "added", "label": b,
                    "old": null, "new": b, "text": format!("Imagery ban added: “{b}”")}),
            ));
        }
    }
    for b in &ob {
        if !nb.contains(b) {
            by_area.push((
                rank("imagery_ban"),
                json!({"id": format!("imagery_ban:{b}"), "area": "imagery_ban", "kind": "removed", "label": b,
                    "old": b, "new": null, "text": format!("Imagery ban removed: “{b}”")}),
            ));
        }
    }
    // A stable sort keeps each area's own order.
    by_area.sort_by_key(|(r, _)| *r);
    by_area.into_iter().map(|(_, c)| c).collect()
}

fn strings(v: &Value) -> Vec<String> {
    at(v, BANS)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// A proposal over the published bible: each section the candidate has
/// (a non-empty text, a non-empty list) replaces the published one; a section
/// it leaves out is kept. A build that did not find a section deletes nothing.
pub fn merge_proposal(published: &Value, candidate: &Value) -> Value {
    let mut out = published.clone();
    for (_, path, _) in SCALARS {
        if let Some(v) = at(candidate, path).filter(|v| !is_empty(v)) {
            *at_mut(&mut out, path) = v.clone();
        }
    }
    for (_, path) in LISTS.iter().chain([&("ban", BANS)]) {
        if let Some(v) = at(candidate, path).filter(|v| !is_empty(v)) {
            *at_mut(&mut out, path) = v.clone();
        }
    }
    for key in [
        "gaps",
        "previous_work",
        "categories_explored",
        "likes_dislikes",
        "preferences",
    ] {
        if let Some(v) = candidate.get(key).filter(|v| !is_empty(v)) {
            out[key] = v.clone();
        }
    }
    out
}

fn is_empty(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(t) => t.trim().is_empty(),
        Value::Array(a) => a.is_empty(),
        Value::Object(o) => o.is_empty(),
        _ => false,
    }
}

/// `base` with only the changes whose id is in `take` applied (the rest of
/// the candidate is left behind).
pub fn apply_taken(base: &Value, changes: &[Value], take: &dyn Fn(&str) -> bool) -> Value {
    let mut out = base.clone();
    for c in changes {
        let id = s(c, "id");
        if !take(id) {
            continue;
        }
        let area = s(c, "area");
        let kind = s(c, "kind");
        if let Some((_, path, _)) = SCALARS.iter().find(|(a, _, _)| *a == area) {
            let slot = at_mut(&mut out, path);
            *slot = if kind == "removed" {
                Value::Null
            } else {
                c["new"].clone()
            };
            if slot.is_null() {
                remove_key(&mut out, path);
            }
        } else if let Some((_, path)) = LISTS.iter().find(|(a, _)| *a == area) {
            let item_id = id.split_once(':').map(|x| x.1).unwrap_or("");
            let slot = at_mut(&mut out, path);
            if !slot.is_array() {
                *slot = Value::Array(vec![]);
            }
            let arr = slot.as_array_mut().expect("an array");
            let pos = arr.iter().position(|x| id_of(x) == item_id);
            match (kind, pos) {
                ("removed", Some(p)) => {
                    arr.remove(p);
                }
                ("removed", None) => {}
                (_, Some(p)) => arr[p] = c["new"].clone(),
                (_, None) => arr.push(c["new"].clone()),
            }
        } else if area == "imagery_ban" {
            let slot = at_mut(&mut out, BANS);
            if !slot.is_array() {
                *slot = Value::Array(vec![]);
            }
            let arr = slot.as_array_mut().expect("an array");
            let ban = &c["new"];
            if kind == "removed" {
                let old = &c["old"];
                arr.retain(|x| x != old);
            } else if !arr.contains(ban) {
                arr.push(ban.clone());
            }
        }
    }
    out
}

fn remove_key(v: &mut Value, path: &[&str]) {
    let Some((last, parents)) = path.split_last() else {
        return;
    };
    let mut cur = v;
    for k in parents {
        match cur.get_mut(*k) {
            Some(n) => cur = n,
            None => return,
        }
    }
    if let Some(o) = cur.as_object_mut() {
        o.remove(*last);
    }
}

/// "Logo, colour and rule changed": the areas a list of changes touches.
pub fn summary(changes: &[Value]) -> String {
    fn word(a: &str) -> &str {
        match a {
            "name" | "note" => "name",
            "logo" | "logo_note" => "logo",
            "colour" => "colour",
            "typography" => "typography",
            "tone" => "tone",
            "rule" => "rule",
            "imagery_style" | "imagery_ban" | "example" => "imagery",
            "source" => "source",
            other => other,
        }
    }
    let mut words: Vec<&str> = Vec::new();
    for c in changes {
        let w = word(s(c, "area"));
        if !words.contains(&w) {
            words.push(w);
        }
    }
    let list = match words.as_slice() {
        [] => return "No changes".to_string(),
        [one] => (*one).to_string(),
        [rest @ .., last] => format!("{} and {}", rest.join(", "), last),
    };
    let mut c = list.chars();
    let head = c
        .next()
        .map(|f| f.to_uppercase().collect::<String>())
        .unwrap_or_default();
    format!("{head}{} changed", c.as_str())
}
