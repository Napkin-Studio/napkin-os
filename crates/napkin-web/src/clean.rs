// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! What the client's link shows around the clean copy
//! (features/client-confirm-link.clan, done_when 3): the brief's own words in
//! four short sections, and who signed it. Chosen by name from the allow list
//! [`FIELDS`], never by walking the brief's data: nothing from `agent/` (the context, the state, the
//! decision chain, a field's origin) and no decision is read into the answer.
//! The clean copy itself is the export with provenance off
//! (`Session::compose_export(false, true)`); a test holds both to it.

use napkin_host::ops::client_pieces::{self, Shape, BEAT_KEYS};
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
/// data (the first that has words), and the label on it. Only keys in [`FIELDS`].
const SECTIONS: &[(&str, &[&str])] = &[
    ("What we are solving", &["insight", "background"]),
    ("The one thing to say", &["single_minded_proposition"]),
    ("How we will know it worked", &["measurement", "objectives"]),
    ("Budget and scope", &["budget_and_scope"]),
];

// ── the full brief ──────────────────────────────────────────────────────────

/// The allow list: the only fields of a brief the client's link ever shows, in the order a client
/// reads them, with their labels. Nothing else in `shared/data.yaml` is drawn: not the planner's
/// working notes, the capture, the review, the passages, the materials, the projection, the
/// layout, nor a key a later schema adds. A new key is shown only by being put here, on purpose
/// (`tests/client_link.rs` holds every key of the Brief Maker schema to this list or to a list of
/// those never shown). Each field is read in the shape its schema gives it, see [`shape`].
pub use napkin_host::ops::client_pieces::BRIEF_FIELDS as FIELDS;

/// What the client reads of one field.
enum Body {
    Text(String),
    Lines(Vec<String>),
    Parts(Vec<(&'static str, String)>),
    /// A script's beats: each a list of (label, words).
    Beats(Vec<Vec<(&'static str, String)>>),
}

/// A string, or an envelope holding one; anything else is not words.
fn leaf(v: &Value) -> Option<String> {
    let v = match v {
        Value::Object(o) if o.contains_key("value") && o.contains_key("origin") => &o["value"],
        other => other,
    };
    v.as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// A beat's word: a string, or a number (a duration).
fn beat_leaf(v: &Value) -> Option<String> {
    match v {
        Value::Number(n) => Some(n.to_string()),
        other => leaf(other),
    }
}

/// Parts a person marked Confidential: the whole field (`audience`) or one part of it
/// (`objectives.commercial`). The strict reading of the contract for the link (§7.5.9): the
/// client's own link does not show them.
fn confidential(data: &Value) -> Vec<String> {
    data.get("confidential_fields")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|k| k.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// One allow-listed field as the client reads it: its schema's shape and no more, and none of
/// it if confidential. `None` when there are no words.
fn body_of(app: &str, key: &str, data: &Value, conf: &[String]) -> Option<Body> {
    if conf.iter().any(|c| c == key) {
        return None;
    }
    let v = data.get(key)?;
    let v = match v {
        Value::Object(o) if o.contains_key("value") && o.contains_key("origin") => &o["value"],
        other => other,
    };
    match client_pieces::shape(app, key) {
        Shape::Text => leaf(v).map(Body::Text),
        Shape::Lines => {
            let lines: Vec<String> = match v {
                Value::Array(a) => a.iter().filter_map(leaf).collect(),
                other => leaf(other).into_iter().collect(),
            };
            (!lines.is_empty()).then_some(Body::Lines(lines))
        }
        Shape::Parts(parts) => {
            let o = v.as_object()?;
            let got: Vec<(&'static str, String)> = parts
                .iter()
                .filter(|(sub, _)| !conf.iter().any(|c| *c == format!("{key}.{sub}")))
                .filter_map(|(sub, label)| Some((*label, leaf(o.get(*sub)?)?)))
                .collect();
            (!got.is_empty()).then_some(Body::Parts(got))
        }
        Shape::Beats => {
            let beats = v.get("beats")?.as_array()?;
            let rows: Vec<Vec<(&'static str, String)>> = beats
                .iter()
                .map(|b| {
                    BEAT_KEYS
                        .iter()
                        .filter_map(|(k, label)| Some((*label, beat_leaf(b.get(*k)?)?)))
                        .collect::<Vec<_>>()
                })
                .filter(|r| !r.is_empty())
                .collect();
            (!rows.is_empty()).then_some(Body::Beats(rows))
        }
    }
}

fn text_of(b: &Body) -> String {
    match b {
        Body::Text(t) => t.clone(),
        Body::Lines(l) => l.join(" "),
        Body::Parts(p) => p
            .iter()
            .map(|(_, t)| t.as_str())
            .collect::<Vec<_>>()
            .join(" "),
        Body::Beats(rows) => rows
            .iter()
            .flat_map(|r| r.iter().map(|(_, t)| t.as_str()))
            .collect::<Vec<_>>()
            .join(" "),
    }
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn body_html(b: &Body) -> String {
    match b {
        Body::Text(t) => format!("<p>{}</p>", escape(t)),
        Body::Lines(l) => format!(
            "<ul>{}</ul>",
            l.iter()
                .map(|t| format!("<li>{}</li>", escape(t)))
                .collect::<String>()
        ),
        Body::Parts(p) => p
            .iter()
            .map(|(label, t)| format!("<p><b>{}</b> {}</p>", escape(label), escape(t)))
            .collect(),
        Body::Beats(rows) => format!(
            "<ol>{}</ol>",
            rows.iter()
                .map(|r| format!(
                    "<li>{}</li>",
                    r.iter()
                        .map(|(label, t)| format!("<b>{}</b> {}", escape(label), escape(t)))
                        .collect::<Vec<_>>()
                        .join("<br>")
                ))
                .collect::<String>()
        ),
    }
}

/// The whole brief as one readable page, drawn from the brief's data by the allow list
/// [`FIELDS`] and nothing else, in that order; a field with no words, or a confidential one, is
/// left out. Scripts there are none. (The export of an app's own view is the app's page with its
/// script stripped, which for the Brief Maker is an empty form, so a brief is drawn from its data
/// here.) The heading is the document's own title, not a field of the data.
pub fn sheet(doc: &Document) -> Option<String> {
    let spec = client_pieces::spec_of(doc)?;
    let data = read::data_json(doc);
    data.as_object()?;
    let conf = confidential(&data);
    let title = doc.title().trim().to_string();
    let mut body = String::new();
    for (k, label) in spec.fields {
        let Some(b) = body_of(spec.app_id, k, &data, &conf) else {
            continue;
        };
        body.push_str(&format!(
            "<section><h2>{}</h2>{}</section>",
            escape(label),
            body_html(&b)
        ));
    }
    Some(format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{t}</title><style>\
body{{margin:0;padding:20px 20px 28px;background:#fff;color:#14161b;font:16px/1.55 'Geist','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased}}\
h1{{margin:0 0 6px;font-size:24px;line-height:1.15;letter-spacing:-0.02em}}\
section{{padding:14px 0 4px;border-top:1px solid #e7e9ee}}\
h2{{margin:0 0 6px;font:500 11px/1.4 'Geist Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#737987}}\
p{{margin:0 0 10px;overflow-wrap:anywhere}}b{{font-weight:600}}ul,ol{{margin:0 0 10px;padding-left:20px}}li{{margin:0 0 4px;overflow-wrap:anywhere}}\
</style></head><body><h1>{t}</h1>{body}</body></html>",
        t = escape(&title),
    ))
}

pub fn page_of(doc: &Document) -> Page {
    let data = read::data_json(doc);
    let conf = confidential(&data);
    // the short sections are the brief's own; another document type shows its page in full
    let brief = gate::applies(doc);
    let summary = SECTIONS
        .iter()
        .filter(|_| brief)
        .filter_map(|(label, keys)| {
            keys.iter()
                .filter_map(|k| body_of(gate::BRIEF_MAKER, k, &data, &conf))
                .map(|b| text_of(&b))
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
        assert_eq!(leaf(&v).as_deref(), Some("Younger drinkers pass it by."));
        assert_eq!(leaf(&json!(["a", "b"])), None);
        let data = json!({ "tone_and_world": ["a", { "note": "x" }, "b"], "audience": "x" });
        let tone = body_of(gate::BRIEF_MAKER, "tone_and_world", &data, &[]).unwrap();
        assert_eq!(text_of(&tone), "a b");
        assert!(body_of(
            gate::BRIEF_MAKER,
            "audience",
            &data,
            &["audience".to_string()]
        )
        .is_none());
    }

    #[test]
    fn names_come_from_the_part_before_the_at() {
        assert_eq!(name_of("aoife@wk"), "Aoife");
    }
}
