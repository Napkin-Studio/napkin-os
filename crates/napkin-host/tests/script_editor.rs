// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The script editor's tracked changes (features/script-editor.clan): a creative director's mark-up and
//! the writer's accept or reject are each one person's attributed write; an accept is refused when the line
//! moved on; an approved version is locked; a restore keeps it. The approve test sets the gate's
//! environment variable, so it is the one test here that does.

use std::sync::Arc;

use clan_sdk::{ClanBuilder, ClanFile, Decision, DecisionChain};
use napkin_host::{handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

const SCRIPT_EDITOR: &str = "ie.napkin.script-editor";

struct Rig {
    dir: tempfile::TempDir,
    id: DocId,
}

/// A script as the spin-off leaves it: the brief frozen under `upstream` (naming its signers) and the
/// page's own fields lifted from it.
fn script() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("script.clan"));
    let base = ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "Script, Permission to stop".into(),
            brief: "a script".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut m = base.manifest().clone();
    m.app = Some(clan_sdk::AppInfo {
        home: None,
        name: "Script editor".into(),
        app_id: SCRIPT_EDITOR.into(),
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
    let data = json!({
        "format": "radio",
        "slot_s": 30,
        "script": {
            "beats": [
                { "id": "b1", "kind": "voice", "role": "FVO", "text": "The room goes quiet." },
                { "id": "b2", "kind": "sfx", "text": "A glass set down on wood." },
                { "id": "b3", "kind": "voice", "role": "MVO", "text": "Take your time. Client A waits." },
            ],
            "proposals": [],
        },
        "checks": { "mandatory": [], "banned": [] },
        "upstream": { "doc_brief": { "signers": [
            { "role": "planner", "person": "aoife@wk" },
            { "role": "creative_director", "person": "dara@wk" },
        ] } },
    });
    b.add_entry(
        "shared/data.yaml",
        serde_yaml::to_string(&data).unwrap().into_bytes(),
    );
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    Rig { dir, id }
}

fn session(rig: &Rig, who: &str) -> Session {
    let s = Session::with_ctx(
        Arc::new(FsStore::new(rig.dir.path().to_path_buf())),
        Ctx::new(Actor::human(who).unwrap()),
    );
    s.open(rig.id.clone()).unwrap();
    s
}

fn post(s: &Session, path: &str, body: Value) -> (u16, Value) {
    let r = handle(
        s,
        &NoConfig,
        HostRequest::new(path, "", body.to_string().into_bytes()),
    );
    (
        r.status,
        serde_json::from_slice(&r.body).unwrap_or(Value::Null),
    )
}

fn get(s: &Session, path: &str, query: &str) -> (u16, Value) {
    let r = handle(s, &NoConfig, HostRequest::new(path, query, Vec::new()));
    (
        r.status,
        serde_json::from_slice(&r.body).unwrap_or(Value::Null),
    )
}

fn data(rig: &Rig) -> Value {
    let clan = ClanFile::open(rig.id.as_str()).unwrap();
    serde_json::to_value(
        serde_yaml::from_slice::<serde_yaml::Value>(&clan.read_entry("shared/data.yaml").unwrap())
            .unwrap(),
    )
    .unwrap()
}

fn chain(rig: &Rig) -> Vec<Decision> {
    let clan = ClanFile::open(rig.id.as_str()).unwrap();
    DecisionChain::from_yaml(&clan.read_entry("agent/decision-chain.yaml").unwrap())
        .unwrap()
        .decisions
}

fn beat_text(rig: &Rig, id: &str) -> String {
    data(rig)["script"]["beats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == id)
        .unwrap()["text"]
        .as_str()
        .unwrap()
        .to_string()
}

fn proposal_status(rig: &Rig, id: &str) -> String {
    data(rig)["script"]["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == id)
        .unwrap()["status"]
        .as_str()
        .unwrap()
        .to_string()
}

/// A decision's actor and action, for the edits made in this test (the document's seed decisions left out).
fn edits(rig: &Rig) -> Vec<(String, String)> {
    // The chain lists the newest first; the test reads in the order things happened.
    chain(rig)
        .into_iter()
        .rev()
        .filter(|d| d.kind.as_deref() == Some("edit"))
        .map(|d| (d.actor.clone().unwrap_or_default(), d.action.clone()))
        .collect()
}

#[test]
fn a_mark_up_and_its_answers_are_human_decisions_by_the_right_names_and_no_handler_writes() {
    let rig = script();
    let dara = || session(&rig, "dara@wk");
    let sam = || session(&rig, "sam@wk");

    // The creative director marks up two beats; neither beat changes.
    let (status, v) = post(
        &dara(),
        "/script/propose",
        json!({ "beat": "b1", "text": "The room goes still.", "note": "Still is the sound we want." }),
    );
    assert_eq!(status, 200, "{v}");
    assert_eq!(v["proposal"], "p1");
    let (status, v) = post(
        &dara(),
        "/script/propose",
        json!({ "beat": "b3", "text": "Take your time." }),
    );
    assert_eq!(status, 200, "{v}");
    assert_eq!(beat_text(&rig, "b1"), "The room goes quiet.");
    assert_eq!(beat_text(&rig, "b3"), "Take your time. Client A waits.");
    let p1 = data(&rig)["script"]["proposals"][0].clone();
    assert_eq!(p1["was"], "The room goes quiet.");
    assert_eq!(
        p1["by"], "human:dara@wk",
        "the author is the session's, not the body's"
    );
    assert_eq!(p1["status"], "open");

    // The writer accepts one and rejects the other.
    let (status, v) = post(
        &sam(),
        "/script/answer",
        json!({ "proposal": "p1", "answer": "accept" }),
    );
    assert_eq!(status, 200, "{v}");
    let (status, v) = post(
        &sam(),
        "/script/answer",
        json!({ "proposal": "p2", "answer": "reject" }),
    );
    assert_eq!(status, 200, "{v}");
    assert_eq!(beat_text(&rig, "b1"), "The room goes still.");
    assert_eq!(
        beat_text(&rig, "b3"),
        "Take your time. Client A waits.",
        "a reject keeps the old words"
    );
    assert_eq!(proposal_status(&rig, "p1"), "accepted");
    assert_eq!(proposal_status(&rig, "p2"), "rejected");
    assert_eq!(
        data(&rig)["script"]["proposals"][0]["answered_by"],
        "human:sam@wk"
    );

    // The chain: two mark-ups by the director, then the writer's two answers. Nothing by a handler.
    let all = edits(&rig);
    let names: Vec<(&str, &str)> = all.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    assert_eq!(
        names,
        vec![
            ("human:dara@wk", "mark up beat b1"),
            ("human:dara@wk", "mark up beat b3"),
            ("human:sam@wk", "accept proposal p1 on beat b1"),
            ("human:sam@wk", "reject proposal p2 on beat b3"),
        ]
    );
    assert!(all.iter().all(|(a, _)| a.starts_with("human:")));

    // An answered mark-up cannot be answered again.
    let (status, _) = post(
        &sam(),
        "/script/answer",
        json!({ "proposal": "p1", "answer": "accept" }),
    );
    assert_eq!(status, 409);
}

#[test]
fn an_accept_is_refused_when_the_line_moved_on_and_the_mark_up_stays_open() {
    let rig = script();
    let (status, _) = post(
        &session(&rig, "dara@wk"),
        "/script/propose",
        json!({ "beat": "b2", "text": "A glass, set down slowly." }),
    );
    assert_eq!(status, 200);

    // The writer rewrites the line before answering.
    let sam = || session(&rig, "sam@wk");
    let (status, v) = post(
        &sam(),
        "/patch-data",
        json!({
            "agent": "human", "action": "edit beat b2",
            "patch": { "script": { "beats": [
                { "id": "b1", "kind": "voice", "role": "FVO", "text": "The room goes quiet." },
                { "id": "b2", "kind": "sfx", "text": "A glass on a bar top." },
                { "id": "b3", "kind": "voice", "role": "MVO", "text": "Take your time. Client A waits." },
            ] } },
        }),
    );
    assert_eq!(status, 200, "{v}");

    let (status, v) = post(
        &sam(),
        "/script/answer",
        json!({ "proposal": "p1", "answer": "accept" }),
    );
    assert_eq!(status, 409, "{v}");
    assert!(
        v["error"]
            .as_str()
            .unwrap()
            .contains("changed after it was marked up"),
        "{v}"
    );
    assert_eq!(
        beat_text(&rig, "b2"),
        "A glass on a bar top.",
        "the writer's line stands"
    );
    assert_eq!(
        proposal_status(&rig, "p1"),
        "open",
        "and the mark-up stays open"
    );
    // It can still be rejected.
    let (status, _) = post(
        &sam(),
        "/script/answer",
        json!({ "proposal": "p1", "answer": "reject" }),
    );
    assert_eq!(status, 200);
}

#[test]
fn only_a_person_marks_up_and_the_beat_and_the_words_must_be_real() {
    let rig = script();
    let handler = Session::with_ctx(
        Arc::new(FsStore::new(rig.dir.path().to_path_buf())),
        Ctx::new(Actor::process("rewrite_line").unwrap()),
    );
    handler.open(rig.id.clone()).unwrap();
    let (status, _) = post(
        &handler,
        "/script/propose",
        json!({ "beat": "b1", "text": "x" }),
    );
    assert_eq!(
        status, 403,
        "a handler does not write mark-up through the person's path"
    );
    let dara = session(&rig, "dara@wk");
    assert_eq!(
        post(
            &dara,
            "/script/propose",
            json!({ "beat": "nope", "text": "x" })
        )
        .0,
        404
    );
    assert_eq!(
        post(
            &dara,
            "/script/propose",
            json!({ "beat": "b1", "text": "  " })
        )
        .0,
        400
    );
    assert_eq!(
        post(
            &dara,
            "/script/propose",
            json!({ "beat": "b1", "text": "The room goes quiet." })
        )
        .0,
        400
    );
    assert!(data(&rig)["script"]["proposals"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn approve_locks_a_version_mark_up_after_it_is_refused_and_a_restore_keeps_both() {
    std::env::set_var("NAPKIN_BRIEF_GATE", "on");
    let rig = script();
    let dara = || session(&rig, "dara@wk");
    let sam = || session(&rig, "sam@wk");

    // The writer edits; the creative director approves it as version 1.
    let (status, v) = post(
        &sam(),
        "/patch-data",
        json!({
            "agent": "human", "action": "edit beat b1",
            "patch": { "script": { "beats": [
                { "id": "b1", "kind": "voice", "role": "FVO", "text": "The room goes still." },
                { "id": "b2", "kind": "sfx", "text": "A glass set down on wood." },
                { "id": "b3", "kind": "voice", "role": "MVO", "text": "Take your time. Client A waits." },
            ] } },
        }),
    );
    assert_eq!(status, 200, "{v}");
    assert_eq!(
        post(&sam(), "/approve", json!({})).0,
        403,
        "only the creative director on the brief approves"
    );
    let (status, v) = post(
        &dara(),
        "/approve",
        json!({ "rationale": "Approved script version 1." }),
    );
    assert_eq!(status, 200, "{v}");

    // A locked version takes neither a write nor a mark-up.
    assert_eq!(
        post(
            &dara(),
            "/script/propose",
            json!({ "beat": "b3", "text": "Take your time." })
        )
        .0,
        409
    );
    // It does take the record of where it was sent, which is not part of what a version says.
    let handoff = |s: &Session, patch: Value| {
        post(
            s,
            "/patch-data",
            json!({ "agent": "human", "action": "send version 1 to Radio", "patch": patch }),
        )
    };
    let (status, v) = handoff(
        &sam(),
        json!({ "handoffs": { "radio": { "kind": "script", "id": "script", "revision": "1", "content_hash": "ab" } } }),
    );
    assert_eq!(status, 200, "{v}");
    assert_eq!(
        handoff(&sam(), json!({ "script": { "beats": [] } })).0,
        409,
        "the words stay locked"
    );
    assert_eq!(data(&rig)["handoffs"]["radio"]["revision"], "1");

    // A new version, an edit, and a restore of version 1: version 1 stays in the list.
    assert_eq!(
        post(
            &dara(),
            "/unapprove",
            json!({ "rationale": "Starting version 2." })
        )
        .0,
        200
    );
    let (status, v) = post(
        &dara(),
        "/script/propose",
        json!({ "beat": "b3", "text": "Take your time." }),
    );
    assert_eq!(status, 200, "{v}");
    // The one who marked it up does not answer it.
    assert_eq!(
        post(
            &dara(),
            "/script/answer",
            json!({ "proposal": "p1", "answer": "accept" })
        )
        .0,
        403
    );
    let (status, v) = post(
        &sam(),
        "/script/answer",
        json!({ "proposal": "p1", "answer": "accept" }),
    );
    assert_eq!(status, 200, "{v}");
    assert_eq!(beat_text(&rig, "b3"), "Take your time.");
    let (status, v) = get(&sam(), "/versions", "");
    assert_eq!(status, 200, "{v}");
    assert_eq!(v["versions"].as_array().unwrap().len(), 1);
    assert_eq!(
        v["versions"][0]["readable"], true,
        "the mark-up writes kept their inverse"
    );
    let (status, v) = post(&sam(), "/restore", json!({ "version": 1 }));
    assert_eq!(status, 200, "{v}");
    assert_eq!(beat_text(&rig, "b3"), "Take your time. Client A waits.");
    assert_eq!(
        get(&sam(), "/versions", "").1["versions"]
            .as_array()
            .unwrap()
            .len(),
        1,
        "the approved version stays"
    );
    assert_eq!(beat_text(&rig, "b1"), "The room goes still.");
}
