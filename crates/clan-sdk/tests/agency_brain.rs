// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Napkin Brain's template (features/brain-template.clan, done_when 1 of features/napkin-brain.clan):
//! one brain per client and one for the agency, made from the real packer's template. The schema is the line
//! format: a derived line holds ids, a rule and typed slots, never words from a source.

use clan_sdk::{instantiate, ClanBuilder, ClanFile, ClientRef, InstantiateOptions, MANIFEST_PATH};
use serde_json::{json, Value};

const APP_ID: &str = "ie.napkin.agency-brain";

fn packed() -> ClanFile {
    let out = std::env::temp_dir().join(format!("agency-brain-pack-{}", std::process::id()));
    std::fs::create_dir_all(&out).unwrap();
    let app_path = out.join("agency-brain.app.clan");
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let run = std::process::Command::new(cargo)
        .args([
            "run",
            "-q",
            "--locked",
            "-p",
            "clan-sdk",
            "--example",
            "make_agency_brain",
            "--",
        ])
        .arg(&app_path)
        .output()
        .unwrap();
    assert!(
        run.status.success(),
        "packer failed: {}",
        String::from_utf8_lossy(&run.stderr)
    );
    let t = ClanFile::from_bytes(std::fs::read(&app_path).unwrap()).unwrap();
    let _ = std::fs::remove_dir_all(&out);
    t
}

fn schema(t: &ClanFile) -> Value {
    serde_json::from_str(&t.read_entry_string("agent/output-schema.json").unwrap()).unwrap()
}

fn valid(schema: &Value, data: &Value) -> bool {
    jsonschema::validator_for(schema).unwrap().is_valid(data)
}

fn derived() -> Value {
    json!({
        "id": "0123456789abcdef",
        "kind": "derived",
        "rule": "client_review.accepted.v1",
        "cites": [{ "doc": "5b2c9a3e-0000-4000-8000-00000000a001", "decision": "d_0007" }],
        "slots": { "answer": "accepted", "version": 3, "on": "2026-11-02" },
        "state": "current",
        "superseded_by": null,
        "at": "2026-11-02T09:30:00Z"
    })
}

fn brain(line: Value) -> Value {
    json!({
        "vault": { "kind": "agency", "client": null },
        "pages": { "j001-accepted": {
            "type": "decision",
            "title": "Client A accepted the brief",
            "summary": "The client accepted version three of the brief.",
            "owner_role": "account-service",
            "links": [],
            "lines": [line]
        } },
        "sources": {},
        "proposals": []
    })
}

#[test]
fn the_packed_template_is_the_agency_brain_app() {
    let t = packed();
    let app = t.manifest().app.as_ref().expect("app block");
    assert_eq!(app.app_id, APP_ID);
    assert_eq!(app.version, "0.1.0");
    assert_eq!(t.manifest().document_type, "template");
    assert!(app.spinoff.is_none(), "a brain is not spun off from a document");
    assert!(t.has_entry("agent/context.md"));
    assert!(t.has_entry("agent/output-schema.json"));
    assert!(t.has_entry("human/index.html"));
}

#[test]
fn a_brain_per_client_and_one_for_the_agency_both_come_from_it() {
    let t = packed();
    let agency = ClanFile::from_bytes(
        instantiate(
            &t,
            InstantiateOptions {
                title: "Agency brain".into(),
                ..Default::default()
            },
        )
        .unwrap(),
    )
    .unwrap();
    assert!(agency.manifest().client.is_none(), "the agency's brain names no client");
    assert_eq!(agency.manifest().app.as_ref().unwrap().app_id, APP_ID);

    let client = ClanFile::from_bytes(
        instantiate(
            &t,
            InstantiateOptions {
                title: "Client A brain".into(),
                ..Default::default()
            },
        )
        .unwrap(),
    )
    .unwrap();
    let mut m = client.manifest().clone();
    m.client = Some(ClientRef {
        id: "cli_0a1b2c3d".into(),
        name: "Client A".into(),
    });
    let mut b = ClanBuilder::new(m);
    for (path, bytes) in client.read_all_entries().unwrap() {
        if path != MANIFEST_PATH {
            b.add_entry(path, bytes);
        }
    }
    let client = ClanFile::from_bytes(b.build().unwrap()).unwrap();
    assert_eq!(client.manifest().client.as_ref().unwrap().id, "cli_0a1b2c3d");
    assert_eq!(client.manifest().app.as_ref().unwrap().app_id, APP_ID);
    // Both start with an empty brain, so the first ingest makes the pages.
    assert!(clan_sdk::validate(&client).is_valid());
}

#[test]
fn a_derived_line_in_the_schema_is_valid() {
    let s = schema(&packed());
    assert!(valid(&s, &brain(derived())));
    let mut client = brain(derived());
    client["vault"] = json!({ "kind": "client", "client": "cli_0a1b2c3d" });
    assert!(valid(&s, &client));
}

#[test]
fn a_line_with_no_cite_is_refused() {
    let s = schema(&packed());
    let mut l = derived();
    l["cites"] = json!([]);
    assert!(!valid(&s, &brain(l)), "no source, no line");
    let mut l = derived();
    l.as_object_mut().unwrap().remove("cites");
    assert!(!valid(&s, &brain(l)));
}

#[test]
fn a_derived_line_holds_no_words_from_a_source() {
    let s = schema(&packed());
    // Free text on a derived line, under any name.
    let mut l = derived();
    l["text"] = json!("The client said the bottle looked cheap");
    assert!(!valid(&s, &brain(l)), "a derived line has no text");
    let mut l = derived();
    l["note"] = json!("x");
    assert!(!valid(&s, &brain(l)), "a derived line has no other key");
    // A string slot is an id or an enum: no spaces, no longer than an id.
    let mut l = derived();
    l["slots"]["reason"] = json!("the bottle looked cheap");
    assert!(!valid(&s, &brain(l)), "a sentence in a slot");
    let mut l = derived();
    l["slots"]["reason"] = json!("a".repeat(65));
    assert!(!valid(&s, &brain(l)), "a string slot longer than an id");
    let mut l = derived();
    l["slots"]["nested"] = json!({ "a": "b" });
    assert!(!valid(&s, &brain(l)), "a slot is a scalar");
    // Ids, enums, dates and numbers are fine.
    let mut l = derived();
    l["slots"] = json!({ "stage": "approved", "on": "2026-11-02", "total": 27, "doc": "5b2c9a3e-0000-4000-8000-00000000a001" });
    assert!(valid(&s, &brain(l)));
}

#[test]
fn the_page_format_is_fixed() {
    let s = schema(&packed());
    for ty in [
        "decision", "idea", "outcome", "lesson", "client", "person", "tool", "job",
    ] {
        let mut b = brain(derived());
        b["pages"]["j001-accepted"]["type"] = json!(ty);
        assert!(valid(&s, &b), "{ty}");
    }
    let mut b = brain(derived());
    b["pages"]["j001-accepted"]["type"] = json!("insight");
    assert!(!valid(&s, &b), "a page type outside the eight");

    let mut b = brain(derived());
    b["pages"]["j001-accepted"]["summary"] = json!(vec!["word"; 21].join(" "));
    assert!(!valid(&s, &b), "a summary of 21 words");
    let mut b = brain(derived());
    b["pages"]["j001-accepted"]["summary"] = json!(vec!["word"; 20].join(" "));
    assert!(valid(&s, &b), "a summary of 20 words");

    for key in ["type", "title", "summary", "owner_role", "lines"] {
        let mut b = brain(derived());
        b["pages"]["j001-accepted"].as_object_mut().unwrap().remove(key);
        assert!(!valid(&s, &b), "a page with no {key}");
    }
    let mut l = derived();
    l["state"] = json!("deleted");
    assert!(!valid(&s, &brain(l)), "a state is current or superseded");
}

#[test]
fn a_curated_line_adds_text_and_an_approver() {
    let s = schema(&packed());
    let mut l = derived();
    l["kind"] = json!("curated");
    l["text"] = json!("A person wrote this and approved it.");
    l["approved_by"] = json!("laurence");
    assert!(valid(&s, &brain(l)));
    let mut l = derived();
    l["kind"] = json!("curated");
    l["text"] = json!("No approver");
    assert!(!valid(&s, &brain(l)), "a curated line names who approved it");
}

#[test]
fn the_template_holds_no_price_and_no_borrowed_material() {
    let t = packed();
    let mut all = String::new();
    for p in [
        "agent/context.md",
        "agent/output-schema.json",
        "human/index.html",
    ] {
        all.push_str(&t.read_entry_string(p).unwrap());
    }
    let low = all.to_lowercase();
    for bad in [
        "price", "cost", "credit", "budget", "€", "$", "cannes", "effie", "warc", "fable", "brain/raw",
    ] {
        assert!(!low.contains(bad), "the template mentions {bad:?}");
    }
    assert!(!all.contains('\u{2014}'), "no em dash");
}

#[test]
fn the_page_is_static_and_builds_no_panel_of_its_own() {
    let t = packed();
    let html = t.read_entry_string("human/index.html").unwrap();
    assert!(!html.contains("<script"), "record 1's page is static");
    assert!(!html.contains("@napkin:booth"), "the Booth is spliced in a later record");
    for bad in ["drawer", "chat", "side-panel", "sidebar"] {
        assert!(!html.to_lowercase().contains(bad), "the page builds a {bad}");
    }
}
