// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! History is never rewritten (features/brain-append-only.clan; done_when 5 and 8 of
//! features/napkin-brain.clan): a brain takes appended lines and a line's move from current to
//! superseded, and nothing else to a line. Every write is one attributed patch-data. The rule is for the
//! brain's app only: another tool's write is what it was.

use std::sync::Arc;

use clan_sdk::{AppInfo, ClanBuilder, ClanFile, DecisionChain};
use napkin_host::{handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

const BRAIN: &str = "ie.napkin.agency-brain";

struct Rig {
    dir: tempfile::TempDir,
    id: DocId,
}

fn line(id: &str, decision: &str) -> Value {
    json!({
        "id": id, "kind": "derived", "rule": "approve.v1",
        "cites": [{ "doc": "doc-a", "decision": decision }],
        "slots": { "stage": "approved" }, "state": "current", "at": "2026-11-02"
    })
}

fn page(lines: Vec<Value>) -> Value {
    json!({ "type": "decision", "title": "Approved", "summary": "The brief was approved.",
        "owner_role": "planning", "links": [], "lines": lines })
}

fn rig_for(app: &str, data: Value) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("doc.clan"));
    let base = ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "a document".into(),
            brief: "a document".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut m = base.manifest().clone();
    m.app = Some(AppInfo {
        home: None,
        name: "App".into(),
        app_id: app.into(),
        version: "0.1.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach: None,
    });
    let mut b = ClanBuilder::new(m);
    for (path, bytes) in base.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH && path != "shared/data.yaml" {
            b.add_entry(path, bytes);
        }
    }
    b.add_entry(
        "shared/data.yaml",
        serde_yaml::to_string(&data).unwrap().into_bytes(),
    );
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    Rig { dir, id }
}

/// An agency brain with one page of two lines.
fn brain() -> Rig {
    rig_for(
        BRAIN,
        json!({
            "vault": { "kind": "agency" },
            "pages": { "approved": page(vec![line("aaaaaaaaaaaaaaaa", "d_1"), line("bbbbbbbbbbbbbbbb", "d_2")]) },
            "sources": {}, "proposals": []
        }),
    )
}

fn call(rig: &Rig, path: &str, body: Value) -> (u16, Value) {
    let s = Session::with_ctx(
        Arc::new(FsStore::new(rig.dir.path().to_path_buf())),
        Ctx::new(Actor::human("laurence").unwrap()),
    );
    s.open(rig.id.clone()).unwrap();
    let r = handle(
        &s,
        &NoConfig,
        HostRequest::new(path, "", body.to_string().into_bytes()),
    );
    (
        r.status,
        serde_json::from_slice(&r.body).unwrap_or(Value::Null),
    )
}

fn write(rig: &Rig, patch: Value) -> u16 {
    call(
        rig,
        "/patch-data",
        json!({ "agent": "ingest", "action": "brain write", "patch": patch }),
    )
    .0
}

fn data(rig: &Rig) -> Value {
    let c = ClanFile::open(rig.id.as_str()).unwrap();
    serde_yaml::from_slice(&c.read_entry("shared/data.yaml").unwrap()).unwrap()
}

fn decisions(rig: &Rig) -> usize {
    let c = ClanFile::open(rig.id.as_str()).unwrap();
    DecisionChain::from_yaml(&c.read_entry("agent/decision-chain.yaml").unwrap())
        .unwrap()
        .decisions
        .len()
}

fn lines(rig: &Rig) -> Vec<Value> {
    data(rig)["pages"]["approved"]["lines"]
        .as_array()
        .unwrap()
        .clone()
}

#[test]
fn a_new_line_is_one_attributed_write() {
    let rig = brain();
    let before = decisions(&rig);
    let mut all = lines(&rig);
    all.push(line("cccccccccccccccc", "d_3"));
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        200
    );
    assert_eq!(lines(&rig).len(), 3);
    assert_eq!(decisions(&rig), before + 1, "one write, one decision");
    let c = ClanFile::open(rig.id.as_str()).unwrap();
    let chain =
        DecisionChain::from_yaml(&c.read_entry("agent/decision-chain.yaml").unwrap()).unwrap();
    let last = chain.decisions.last().unwrap();
    assert_eq!(
        last.claimed_agent.as_deref().unwrap_or(&last.agent),
        "ingest"
    );
    assert_eq!(last.action, "brain write");
}

#[test]
fn a_write_names_an_agent_and_an_action_like_any_write() {
    let rig = brain();
    let mut all = lines(&rig);
    all.push(line("cccccccccccccccc", "d_3"));
    let patch = json!({ "pages": { "approved": { "lines": all } } });
    assert_eq!(call(&rig, "/patch-data", json!({ "patch": patch })).0, 400);
    assert_eq!(
        call(
            &rig,
            "/patch-data",
            json!({ "agent": "ingest", "patch": patch })
        )
        .0,
        400
    );
    assert_eq!(lines(&rig).len(), 2);
}

#[test]
fn a_line_cannot_be_edited() {
    let rig = brain();
    let mut all = lines(&rig);
    all[0]["slots"]["stage"] = json!("signed");
    assert_eq!(
        write(
            &rig,
            json!({ "pages": { "approved": { "lines": all.clone() } } })
        ),
        409
    );
    all = lines(&rig);
    all[0]["rule"] = json!("sign.v1");
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        409
    );
    let mut all = lines(&rig);
    all[1]["cites"] = json!([{ "doc": "doc-z", "decision": "d_9" }]);
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        409
    );
    let mut all = lines(&rig);
    all[0]["at"] = json!("2026-12-01");
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        409
    );
    assert_eq!(lines(&rig)[0]["slots"]["stage"], "approved");
}

#[test]
fn a_line_cannot_be_deleted() {
    let rig = brain();
    let one = vec![lines(&rig)[0].clone()];
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": one } } })),
        409
    );
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": [] } } })),
        409
    );
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": null } } })),
        409
    );
    assert_eq!(write(&rig, json!({ "pages": { "approved": null } })), 409);
    assert_eq!(write(&rig, json!({ "pages": null })), 409);
    // A line moved to another page is gone from its own.
    let moved = lines(&rig)[0].clone();
    assert_eq!(
        write(
            &rig,
            json!({ "pages": { "approved": { "lines": [lines(&rig)[1].clone()] }, "other": page(vec![moved]) } })
        ),
        409
    );
    assert_eq!(lines(&rig).len(), 2);
}

#[test]
fn a_line_is_superseded_never_rewritten() {
    let rig = brain();
    let mut all = lines(&rig);
    all.push(line("cccccccccccccccc", "d_3"));
    all[0]["state"] = json!("superseded");
    all[0]["superseded_by"] = json!("cccccccccccccccc");
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        200
    );
    assert_eq!(lines(&rig)[0]["state"], "superseded");
    // It cannot come back, or be pointed elsewhere, or have its words changed in passing.
    let mut all = lines(&rig);
    all[0]["state"] = json!("current");
    all[0]["superseded_by"] = json!(null);
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        409
    );
    let mut all = lines(&rig);
    all[0]["superseded_by"] = json!("bbbbbbbbbbbbbbbb");
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        409
    );
    let mut all = lines(&rig);
    all[1]["state"] = json!("superseded");
    all[1]["superseded_by"] = json!("cccccccccccccccc");
    all[1]["slots"]["stage"] = json!("signed");
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        409
    );
}

#[test]
fn a_superseded_line_names_a_line_that_is_there() {
    let rig = brain();
    let mut all = lines(&rig);
    all[0]["state"] = json!("superseded");
    all[0]["superseded_by"] = json!("ffffffffffffffff");
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        400
    );
    let mut all = lines(&rig);
    all[0]["state"] = json!("superseded");
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        400
    );
}

#[test]
fn the_page_format_still_holds_on_every_write() {
    let rig = brain();
    let mut all = lines(&rig);
    let mut bad = line("cccccccccccccccc", "d_3");
    bad["cites"] = json!([]);
    all.push(bad);
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        400
    );
    let mut text = line("cccccccccccccccc", "d_3");
    text["text"] = json!("words from a source");
    let mut all = lines(&rig);
    all.push(text);
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        400
    );
    // The vault is the document's own.
    assert_eq!(
        write(
            &rig,
            json!({ "vault": { "kind": "client", "client": "cli_0a1b2c3d" } })
        ),
        400
    );
}

#[test]
fn a_page_header_and_a_new_page_are_appends() {
    let rig = brain();
    assert_eq!(
        write(
            &rig,
            json!({ "pages": { "approved": { "title": "Approved briefs" } } })
        ),
        200
    );
    assert_eq!(data(&rig)["pages"]["approved"]["title"], "Approved briefs");
    assert_eq!(lines(&rig).len(), 2);
    assert_eq!(
        write(
            &rig,
            json!({ "pages": { "second": page(vec![line("dddddddddddddddd", "d_4")]) } })
        ),
        200
    );
    // Sources and proposals are not lines: an ingest resumes, an owner approves or rejects.
    assert_eq!(
        write(&rig, json!({ "sources": { "doc-a": { "head": "d_2" } } })),
        200
    );
    assert_eq!(write(&rig, json!({ "proposals": [{ "id": "p1" }] })), 200);
    assert_eq!(write(&rig, json!({ "proposals": [] })), 200);
}

#[test]
fn an_append_key_other_than_proposals_is_refused() {
    let rig = brain();
    let (s, _) = call(
        &rig,
        "/patch-data",
        json!({ "agent": "a", "action": "b", "append_keys": ["pages"], "patch": { "pages": {} } }),
    );
    assert_eq!(s, 409);
    let (s, _) = call(
        &rig,
        "/patch-data",
        json!({ "agent": "a", "action": "b", "append_keys": ["proposals"], "patch": { "proposals": [{ "id": "p2" }] } }),
    );
    assert_eq!(s, 200);
}

#[test]
fn a_new_brain_takes_its_first_pages() {
    let rig = rig_for(BRAIN, json!({}));
    assert_eq!(
        write(
            &rig,
            json!({ "vault": { "kind": "agency" }, "pages": { "approved": page(vec![line("aaaaaaaaaaaaaaaa", "d_1")]) } })
        ),
        200
    );
}

#[test]
fn undo_and_restore_follow_the_same_rule() {
    let rig = brain();
    let mut all = lines(&rig);
    all.push(line("cccccccccccccccc", "d_3"));
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": all } } })),
        200
    );
    // An undo is a patch that puts back what the key held before: removing the new line is refused.
    let back = vec![lines(&rig)[0].clone(), lines(&rig)[1].clone()];
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": back } } })),
        409
    );
    assert_eq!(lines(&rig).len(), 3);
    // A brain has no approved versions, so a restore finds nothing to restore, and cannot rewrite either.
    let (s, _) = call(&rig, "/restore", json!({ "version": 1 }));
    assert_ne!(s, 200);
    assert_eq!(lines(&rig).len(), 3);
}

#[test]
fn another_tools_write_is_unchanged() {
    // The same destructive patch on a document of another app is accepted, as it always was.
    let rig = rig_for(
        "ie.napkin.brief-maker",
        json!({ "pages": { "approved": page(vec![line("aaaaaaaaaaaaaaaa", "d_1")]) } }),
    );
    assert_eq!(
        write(&rig, json!({ "pages": { "approved": { "lines": [] } } })),
        200
    );
    assert_eq!(write(&rig, json!({ "pages": null })), 200);
    assert!(data(&rig).get("pages").is_none());
}
