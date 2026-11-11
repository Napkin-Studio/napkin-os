// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! What the client's link shows around the clean copy
//! (features/client-confirm-link.clan, done_when 3): the brief's own words in
//! four short sections, and who signed it. Chosen by name from the brief's data,
//! never by walking it: nothing from `agent/` (the context, the state, the
//! decision chain, a field's origin) and no decision is read into the answer.
//! The clean copy itself is the export with provenance off
//! (`Session::compose_export(false, true)`); a test holds both to it.

use napkin_host::ops::{decisions, gate, read};
use napkin_host::Document;
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Default, Debug, PartialEq, Eq)]
pub struct Section {
    pub label: &'static str,
    pub text: String,
}

#[derive(Default)]
pub struct Page {
    pub title: String,
    pub summary: Vec<Section>,
    pub signed_by: Vec<String>,
}

/// The sections, in the order the client reads them: the key in the brief's
/// data (the first that has words), and the label on it.
const SECTIONS: &[(&str, &[&str])] = &[
    ("What we are solving", &["insight", "problem", "background"]),
    (
        "The one thing to say",
        &["single_minded_proposition", "proposition"],
    ),
    ("How we will know it worked", &["measurement", "objectives"]),
    ("Budget and scope", &["budget_and_scope", "budget"]),
];

/// A field's words as the client reads them: an envelope is its value, a
/// list is its lines, an object its parts, in order.
pub fn words(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| words(Some(x)))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
        Some(Value::Object(o)) => match (o.get("value"), o.get("origin")) {
            (Some(inner), Some(_)) => words(Some(inner)),
            _ => o
                .values()
                .map(|x| words(Some(x)))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" "),
        },
        _ => String::new(),
    }
}

// ── the full brief ──────────────────────────────────────────────────────────

/// What the full brief says for each field, in the order a client reads them. Anything the brief
/// has that is not here is shown under its own name, except the keys in [`HIDDEN`].
const FIELDS: &[(&str, &str)] = &[
    ("client", "Client"),
    ("background", "Background"),
    ("audience", "Audience"),
    ("insight", "Insight"),
    ("single_minded_proposition", "The one thing to say"),
    ("tone_and_world", "Tone and world"),
    ("objectives", "Objectives"),
    ("desired_response", "What people should think, feel and do"),
    ("famous", "What would make it famous"),
    ("reasons_to_believe", "Reasons to believe"),
    ("measurement", "How we will know it worked"),
    ("budget_and_scope", "Budget and scope"),
    ("mandatories", "Mandatories"),
];

/// The planner's working notes, the host's own members and the people who sign: not the client's to read.
const HIDDEN: &[&str] = &[
    "brief_input",
    "open_questions",
    "signers",
    "facts",
    "findings",
    "sources",
    "title",
];

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn label_of(key: &str) -> String {
    let words = key.replace('_', " ");
    let mut c = words.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// One field's value as HTML: words, a list, or labelled parts.
fn value_html(v: &Value) -> String {
    match v {
        Value::Object(o) if o.contains_key("value") && o.contains_key("origin") => {
            value_html(&o["value"])
        }
        Value::Object(o) => o
            .iter()
            .filter(|(_, x)| !words(Some(x)).is_empty())
            .map(|(k, x)| {
                format!(
                    "<p><b>{}</b> {}</p>",
                    escape(&label_of(k)),
                    escape(&words(Some(x)))
                )
            })
            .collect(),
        Value::Array(a) => {
            let items: String = a
                .iter()
                .map(|x| words(Some(x)))
                .filter(|t| !t.is_empty())
                .map(|t| format!("<li>{}</li>", escape(&t)))
                .collect();
            format!("<ul>{items}</ul>")
        }
        other => format!("<p>{}</p>", escape(&words(Some(other)))),
    }
}

/// The whole brief as one readable page, built from its data and nothing else: the fields in
/// [`FIELDS`] first, any others after, a field with no words left out. Scripts there are none.
/// (The export of an app's own view is the app's page with its script stripped, which for the
/// Brief Maker is an empty form, so a brief is drawn from its data here.)
pub fn sheet(doc: &Document) -> Option<String> {
    if !gate::applies(doc) {
        return None;
    }
    let data = read::data_json(doc);
    let obj = data.as_object()?;
    let mut keys: Vec<&str> = FIELDS.iter().map(|(k, _)| *k).collect();
    let more: Vec<&str> = obj
        .keys()
        .map(String::as_str)
        .filter(|k| {
            !k.starts_with('_')
                && !HIDDEN.contains(k)
                && *k != "project_name"
                && !FIELDS.iter().any(|(f, _)| f == k)
        })
        .collect();
    keys.extend(more);
    let title = words(obj.get("project_name"));
    let mut body = String::new();
    for k in keys {
        let Some(v) = obj.get(k) else { continue };
        if words(Some(v)).is_empty() {
            continue;
        }
        let label = FIELDS
            .iter()
            .find(|(f, _)| *f == k)
            .map_or_else(|| label_of(k), |(_, l)| (*l).to_string());
        body.push_str(&format!(
            "<section><h2>{}</h2>{}</section>",
            escape(&label),
            value_html(v)
        ));
    }
    Some(format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{t}</title><style>\
body{{margin:0;padding:20px 20px 28px;background:#fff;color:#14161b;font:16px/1.55 'Geist','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased}}\
h1{{margin:0 0 6px;font-size:24px;line-height:1.15;letter-spacing:-0.02em}}\
section{{padding:14px 0 4px;border-top:1px solid #e7e9ee}}\
h2{{margin:0 0 6px;font:500 11px/1.4 'Geist Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#737987}}\
p{{margin:0 0 10px;overflow-wrap:anywhere}}b{{font-weight:600}}ul{{margin:0 0 10px;padding-left:20px}}li{{margin:0 0 4px;overflow-wrap:anywhere}}\
</style></head><body><h1>{t}</h1>{body}</body></html>",
        t = escape(if title.is_empty() { doc.title().trim() } else { &title }),
    ))
}

pub fn page_of(doc: &Document) -> Page {
    let data = read::data_json(doc);
    let summary = SECTIONS
        .iter()
        .filter_map(|(label, keys)| {
            keys.iter()
                .map(|k| words(data.get(*k)))
                .find(|t| !t.is_empty())
                .map(|text| Section { label, text })
        })
        .collect();
    let signed_by = if gate::applies(doc) {
        decisions::decisions(doc)
            .and_then(|v| gate::view(doc, &v))
            .map(|g| {
                g.signers
                    .into_iter()
                    .filter(|s| s.signed)
                    .map(|s| name_of(&s.person))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    Page {
        title: doc.title().trim().to_string(),
        summary,
        signed_by,
    }
}

/// `aoife@wk` as a first name: `Aoife`.
fn name_of(person: &str) -> String {
    let local = person.split('@').next().unwrap_or(person);
    let mut c = local.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_envelope_is_its_value_and_its_origin_is_not_shown() {
        let v = json!({ "value": "Younger drinkers pass it by.", "origin": "agent", "by": "x" });
        assert_eq!(words(Some(&v)), "Younger drinkers pass it by.");
        assert_eq!(words(Some(&json!(["a", "b"]))), "a b");
        assert_eq!(words(None), "");
    }

    #[test]
    fn names_come_from_the_part_before_the_at() {
        assert_eq!(name_of("aoife@wk"), "Aoife");
    }
}
