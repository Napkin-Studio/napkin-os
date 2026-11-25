//! Is a newer output schema safe to give a document made under an older one?
//!
//! A document carries its own copy of its app's schema (`agent/output-schema.json`), and every
//! write is checked against that copy. When the app later widens its schema (a list may now hold
//! 1000 items instead of 80), documents made before keep the old limit for good. The host may
//! move such a document to the newer schema, but only when the newer one accepts everything the
//! older one did ([`compare`] says [`Compat::Widens`]): a limit raised, a minimum lowered, a new
//! optional field where none was allowed, an enum value added, a field no longer required.
//! Anything else — a field removed or renamed, a limit tightened, a new required field, a changed
//! type or pattern — is [`Compat::Breaks`]: the copy stays, and moving it is a deliberate
//! migration (owner decision, 2026-11-25).
//!
//! The comparison is conservative: it reads the JSON Schema keywords the apps use, compares the
//! two schemas structurally (by path, with `$ref`s compared as strings and their `definitions`
//! compared by name), and calls any keyword it does not understand a break unless both sides
//! agree on it. Annotations (`title`, `description`, `examples`, `default`, `$comment`, `x-*`)
//! never count either way.

use serde_json::{Map, Value};

/// How a newer schema relates to an older one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Compat {
    /// The two validate the same documents.
    Same,
    /// The newer accepts everything the older did, and more. Each line says what loosened,
    /// as `<path>: <what>` (e.g. `/definitions/focus/properties/sources: maxItems 80 → 1000`).
    Widens(Vec<String>),
    /// The newer refuses something the older accepted, or the comparison could not prove it
    /// does not. Each line says why.
    Breaks(Vec<String>),
}

/// Compare an older schema with a newer one. See the module notes.
pub fn compare(old: &Value, new: &Value) -> Compat {
    let mut w = Walk::default();
    w.schema("", old, new);
    if !w.breaks.is_empty() {
        Compat::Breaks(w.breaks)
    } else if !w.widens.is_empty() {
        Compat::Widens(w.widens)
    } else {
        Compat::Same
    }
}

#[derive(Default)]
struct Walk {
    widens: Vec<String>,
    breaks: Vec<String>,
}

const UPPER: &[&str] = &[
    "maxItems",
    "maxLength",
    "maxProperties",
    "maximum",
    "exclusiveMaximum",
];
const LOWER: &[&str] = &[
    "minItems",
    "minLength",
    "minProperties",
    "minimum",
    "exclusiveMinimum",
];
/// Keywords handled by name below (all others must be equal on both sides).
const HANDLED: &[&str] = &[
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum",
    "definitions",
    "$defs",
    "oneOf",
    "anyOf",
    "allOf",
];

fn annotation(k: &str) -> bool {
    matches!(
        k,
        "title" | "description" | "examples" | "default" | "$comment" | "$schema" | "$id"
    ) || k.starts_with("x-")
}

fn at(path: &str) -> &str {
    if path.is_empty() {
        "/"
    } else {
        path
    }
}

fn types(v: Option<&Value>) -> Option<Vec<String>> {
    match v? {
        Value::String(s) => Some(vec![s.clone()]),
        Value::Array(a) => Some(
            a.iter()
                .filter_map(|t| t.as_str().map(String::from))
                .collect(),
        ),
        _ => None,
    }
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

fn show(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

impl Walk {
    fn widen(&mut self, path: &str, what: String) {
        self.widens.push(format!("{}: {what}", at(path)));
    }
    fn brk(&mut self, path: &str, what: String) {
        self.breaks.push(format!("{}: {what}", at(path)));
    }

    fn schema(&mut self, path: &str, old: &Value, new: &Value) {
        if old == new {
            return;
        }
        match (old, new) {
            (Value::Bool(false), _) => self.widen(path, "now accepts values".into()),
            (_, Value::Bool(true)) => self.widen(path, "now accepts any value".into()),
            (Value::Object(o), Value::Object(n)) => self.object(path, o, n),
            (Value::Bool(true), Value::Object(n)) if n.keys().all(|k| annotation(k)) => {}
            _ => self.brk(
                path,
                "the schema changed in a way that is not a widening".into(),
            ),
        }
    }

    fn object(&mut self, path: &str, o: &Map<String, Value>, n: &Map<String, Value>) {
        // $ref: the same target, or nothing to compare.
        if o.get("$ref") != n.get("$ref") {
            self.brk(path, "points at a different definition".into());
            return;
        }
        // type: the newer may allow more types, never fewer.
        match (types(o.get("type")), types(n.get("type"))) {
            (Some(ot), Some(nt)) => {
                if let Some(gone) = ot.iter().find(|t| !nt.contains(t)) {
                    self.brk(path, format!("no longer allows type {gone}"));
                } else if nt.len() > ot.len() {
                    self.widen(path, format!("type {} → {}", ot.join("|"), nt.join("|")));
                }
            }
            (None, Some(nt)) => self.brk(path, format!("now restricted to type {}", nt.join("|"))),
            (Some(ot), None) => {
                self.widen(path, format!("type {} no longer restricted", ot.join("|")))
            }
            (None, None) => {}
        }
        for k in UPPER {
            match (num(o.get(*k)), num(n.get(*k))) {
                (Some(a), Some(b)) if b > a => {
                    self.widen(path, format!("{k} {} → {}", show(a), show(b)))
                }
                (Some(a), Some(b)) if b < a => {
                    self.brk(path, format!("{k} lowered {} → {}", show(a), show(b)))
                }
                (Some(a), None) => self.widen(path, format!("{k} {} removed", show(a))),
                (None, Some(b)) => self.brk(path, format!("{k} {} added", show(b))),
                _ => {}
            }
        }
        for k in LOWER {
            match (num(o.get(*k)), num(n.get(*k))) {
                (Some(a), Some(b)) if b < a => {
                    self.widen(path, format!("{k} {} → {}", show(a), show(b)))
                }
                (Some(a), Some(b)) if b > a => {
                    self.brk(path, format!("{k} raised {} → {}", show(a), show(b)))
                }
                (Some(a), None) => self.widen(path, format!("{k} {} removed", show(a))),
                (None, Some(b)) => self.brk(path, format!("{k} {} added", show(b))),
                _ => {}
            }
        }
        self.required(path, o.get("required"), n.get("required"));
        self.enumeration(path, o.get("enum"), n.get("enum"));
        self.properties(path, o, n);
        match (o.get("items"), n.get("items")) {
            (Some(a), Some(b)) => self.schema(&format!("{path}/items"), a, b),
            (Some(_), None) => self.widen(path, "items no longer constrained".into()),
            (None, Some(_)) => self.brk(path, "items now constrained".into()),
            (None, None) => {}
        }
        for key in ["definitions", "$defs"] {
            self.definitions(path, key, o.get(key), n.get(key));
        }
        for key in ["oneOf", "anyOf", "allOf"] {
            match (
                o.get(key).and_then(Value::as_array),
                n.get(key).and_then(Value::as_array),
            ) {
                (Some(a), Some(b)) if a.len() == b.len() => {
                    for (i, (x, y)) in a.iter().zip(b).enumerate() {
                        self.schema(&format!("{path}/{key}/{i}"), x, y);
                    }
                }
                (None, None) => {}
                _ => self.brk(path, format!("{key} changed")),
            }
        }
        // Every other keyword (pattern, format, const, …) must be the same on both sides.
        for k in o.keys().chain(n.keys()) {
            if annotation(k)
                || HANDLED.contains(&k.as_str())
                || UPPER.contains(&k.as_str())
                || LOWER.contains(&k.as_str())
                || k == "$ref"
            {
                continue;
            }
            if o.get(k) != n.get(k) {
                self.brk(path, format!("{k} changed"));
            }
        }
    }

    fn required(&mut self, path: &str, o: Option<&Value>, n: Option<&Value>) {
        let set = |v: Option<&Value>| -> Vec<String> {
            v.and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default()
        };
        let (o, n) = (set(o), set(n));
        for f in &n {
            if !o.contains(f) {
                self.brk(path, format!("{f} is now required"));
            }
        }
        for f in &o {
            if !n.contains(f) {
                self.widen(path, format!("{f} no longer required"));
            }
        }
    }

    fn enumeration(&mut self, path: &str, o: Option<&Value>, n: Option<&Value>) {
        match (o.and_then(Value::as_array), n.and_then(Value::as_array)) {
            (Some(a), Some(b)) => {
                if let Some(gone) = a.iter().find(|v| !b.contains(v)) {
                    self.brk(path, format!("enum value {gone} removed"));
                } else if b.len() > a.len() {
                    self.widen(path, format!("enum grew {} → {}", a.len(), b.len()));
                }
            }
            (Some(_), None) => self.widen(path, "enum removed".into()),
            (None, Some(_)) => self.brk(path, "enum added".into()),
            (None, None) => {}
        }
    }

    fn properties(&mut self, path: &str, o: &Map<String, Value>, n: &Map<String, Value>) {
        let empty = Map::new();
        let op = o
            .get("properties")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let np = n
            .get("properties")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let closed =
            |m: &Map<String, Value>| m.get("additionalProperties") == Some(&Value::Bool(false));
        for (k, ov) in op {
            let p = format!("{path}/properties/{k}");
            match np.get(k) {
                Some(nv) => self.schema(&p, ov, nv),
                None if closed(n) => self.brk(&p, "field removed".into()),
                None => match n.get("additionalProperties") {
                    // Now covered by the open default: it accepts what the old field did.
                    None | Some(Value::Bool(true)) => {
                        self.widen(&p, "field no longer constrained".into())
                    }
                    Some(extra) => self.schema(&p, ov, extra),
                },
            }
        }
        for (k, nv) in np {
            if op.contains_key(k) {
                continue;
            }
            let p = format!("{path}/properties/{k}");
            if closed(o) {
                self.widen(&p, "new optional field".into());
            } else {
                // The older schema let any value through under this key; the newer constrains it.
                match o.get("additionalProperties") {
                    Some(extra) if extra.is_object() => self.schema(&p, extra, nv),
                    _ if nv == &Value::Bool(true)
                        || nv
                            .as_object()
                            .is_some_and(|m| m.keys().all(|k| annotation(k))) => {}
                    _ => self.brk(
                        &p,
                        "a field the old schema left open is now constrained".into(),
                    ),
                }
            }
        }
        match (o.get("additionalProperties"), n.get("additionalProperties")) {
            (a, b) if a == b => {}
            (Some(Value::Bool(false)), _) => self.widen(path, "accepts extra fields".into()),
            (Some(a @ Value::Object(_)), Some(b @ Value::Object(_))) => {
                self.schema(&format!("{path}/additionalProperties"), a, b)
            }
            (Some(Value::Object(_)), None | Some(Value::Bool(true))) => {
                self.widen(path, "extra fields no longer constrained".into())
            }
            _ => self.brk(path, "extra fields now restricted".into()),
        }
    }

    fn definitions(&mut self, path: &str, key: &str, o: Option<&Value>, n: Option<&Value>) {
        let (Some(o), n) = (o.and_then(Value::as_object), n.and_then(Value::as_object)) else {
            return; // none before: new definitions only matter through a $ref, compared above
        };
        let empty = Map::new();
        let n = n.unwrap_or(&empty);
        for (name, ov) in o {
            let p = format!("{path}/{key}/{name}");
            match n.get(name) {
                Some(nv) => self.schema(&p, ov, nv),
                None => self.brk(&p, "definition removed".into()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn widens(c: &Compat) -> bool {
        matches!(c, Compat::Widens(_))
    }
    fn breaks(c: &Compat) -> bool {
        matches!(c, Compat::Breaks(_))
    }

    /// The case that started it: Territories' focus.sources from 80 to 1000 (2026-11-25).
    #[test]
    fn a_raised_list_cap_under_a_definition_is_a_widening() {
        let old = json!({"type":"object","properties":{"focus":{"$ref":"#/definitions/focus"}},
            "definitions":{"focus":{"type":"object","additionalProperties":false,
                "properties":{"sources":{"type":"array","maxItems":80,"items":{"type":"object"}}}}}});
        let mut new = old.clone();
        new["definitions"]["focus"]["properties"]["sources"]["maxItems"] = json!(1000);
        match compare(&old, &new) {
            Compat::Widens(w) => assert_eq!(
                w,
                vec!["/definitions/focus/properties/sources: maxItems 80 → 1000"]
            ),
            other => panic!("{other:?}"),
        }
        // and the other way is a break
        assert!(breaks(&compare(&new, &old)));
    }

    #[test]
    fn identical_and_annotation_only_changes_are_the_same() {
        let a = json!({"type":"string","maxLength":10});
        assert_eq!(compare(&a, &a), Compat::Same);
        let b =
            json!({"type":"string","maxLength":10,"description":"words","x-clan-appearance":true});
        assert_eq!(compare(&a, &b), Compat::Same);
    }

    #[test]
    fn each_safe_kind_widens() {
        // limits up / removed, minimums down
        assert!(widens(&compare(
            &json!({"maxLength":10}),
            &json!({"maxLength":20})
        )));
        assert!(widens(&compare(&json!({"maxItems":3}), &json!({}))));
        assert!(widens(&compare(
            &json!({"minItems":2}),
            &json!({"minItems":1})
        )));
        assert!(widens(&compare(
            &json!({"maximum":5}),
            &json!({"maximum":9})
        )));
        // a new optional field where none was allowed
        let o = json!({"type":"object","additionalProperties":false,"properties":{"a":{"type":"string"}}});
        let n = json!({"type":"object","additionalProperties":false,"properties":{"a":{"type":"string"},"b":{"type":"number"}}});
        assert!(widens(&compare(&o, &n)));
        // enum grows; a field no longer required; more types
        assert!(widens(&compare(
            &json!({"enum":["a","b"]}),
            &json!({"enum":["a","b","c"]})
        )));
        assert!(widens(&compare(
            &json!({"required":["a","b"]}),
            &json!({"required":["a"]})
        )));
        assert!(widens(&compare(
            &json!({"type":"string"}),
            &json!({"type":["string","null"]})
        )));
    }

    #[test]
    fn each_breaking_kind_breaks() {
        assert!(breaks(&compare(
            &json!({"maxLength":20}),
            &json!({"maxLength":10})
        )));
        assert!(breaks(&compare(&json!({}), &json!({"maxItems":10}))));
        assert!(breaks(&compare(
            &json!({"minItems":1}),
            &json!({"minItems":2})
        )));
        assert!(breaks(&compare(
            &json!({"required":["a"]}),
            &json!({"required":["a","b"]})
        )));
        assert!(breaks(&compare(
            &json!({"enum":["a","b"]}),
            &json!({"enum":["a"]})
        )));
        assert!(breaks(&compare(
            &json!({"type":["string","null"]}),
            &json!({"type":"string"})
        )));
        assert!(breaks(&compare(
            &json!({"pattern":"^a"}),
            &json!({"pattern":"^b"})
        )));
        assert!(breaks(&compare(
            &json!({"$ref":"#/definitions/a"}),
            &json!({"$ref":"#/definitions/b"})
        )));
        // a field removed from a closed object (renames look like this too)
        let o = json!({"type":"object","additionalProperties":false,"properties":{"a":{},"b":{}}});
        let n = json!({"type":"object","additionalProperties":false,"properties":{"a":{},"c":{}}});
        assert!(breaks(&compare(&o, &n)));
        // a definition removed
        assert!(breaks(&compare(
            &json!({"definitions":{"x":{}}}),
            &json!({"definitions":{}})
        )));
        // an open object closed
        assert!(breaks(&compare(
            &json!({"type":"object"}),
            &json!({"type":"object","additionalProperties":false})
        )));
        // an unknown keyword that differs
        assert!(breaks(&compare(
            &json!({"format":"date"}),
            &json!({"format":"email"})
        )));
    }

    #[test]
    fn a_widening_and_a_break_together_is_a_break() {
        let o = json!({"properties":{"a":{"maxLength":5},"b":{"maxLength":5}},"additionalProperties":false});
        let n = json!({"properties":{"a":{"maxLength":9},"b":{"maxLength":2}},"additionalProperties":false});
        match compare(&o, &n) {
            Compat::Breaks(b) => assert_eq!(b, vec!["/properties/b: maxLength lowered 5 → 2"]),
            other => panic!("{other:?}"),
        }
    }
}
