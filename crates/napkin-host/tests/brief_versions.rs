//! Version history and restore (features/brief-versions-undo.clan): each approve is
//! a version read from the chain, restore writes a new attributed edit into the
//! draft, and a signed version stays locked and in the history.

use std::sync::Arc;

use clan_sdk::{ClanFile, DecisionChain};
use napkin_host::{handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

struct Rig {
    dir: tempfile::TempDir,
    id: DocId,
}

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("brief.clan"));
    let bytes = clan_sdk::create(clan_sdk::CreateOptions {
        title: "J001 brief".into(),
        brief: "a brief".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    std::fs::write(id.as_str(), bytes).unwrap();
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

fn call(s: &Session, path: &str, query: &str, body: Value) -> (u16, Value) {
    let r = handle(
        s,
        &NoConfig,
        HostRequest::new(path, query, body.to_string().into_bytes()),
    );
    (
        r.status,
        serde_json::from_slice(&r.body).unwrap_or(Value::Null),
    )
}

fn chain(rig: &Rig) -> DecisionChain {
    let clan = ClanFile::open(rig.id.as_str()).unwrap();
    DecisionChain::from_yaml(&clan.read_entry("agent/decision-chain.yaml").unwrap()).unwrap()
}

fn edit(rig: &Rig, audience: &str) {
    let (status, v) = call(
        &session(rig, "dara@wk"),
        "/patch-data",
        "",
        json!({ "agent": "human", "action": "edit audience", "patch": { "audience": audience } }),
    );
    assert_eq!(status, 200, "{v}");
}

fn data_of(rig: &Rig) -> Value {
    let clan = ClanFile::open(rig.id.as_str()).unwrap();
    serde_yaml::from_slice::<serde_json::Value>(&clan.read_entry("shared/data.yaml").unwrap())
        .unwrap()
}

#[test]
fn restoring_an_old_version_keeps_the_newer_one_and_its_lock() {
    let rig = rig();
    let dara = || session(&rig, "dara@wk");
    for (i, words) in ["First words.", "Second words.", "Third words."]
        .iter()
        .enumerate()
    {
        edit(&rig, words);
        assert_eq!(
            call(&dara(), "/approve", "", json!({})).0,
            200,
            "approve {i}"
        );
        if i < 2 {
            assert_eq!(
                call(&dara(), "/unapprove", "", json!({ "rationale": "again" })).0,
                200
            );
        }
    }

    let (_, list) = call(&dara(), "/versions", "", Value::Null);
    let rows = list["versions"].as_array().unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0]["n"], 3);
    assert_eq!(rows[0]["locked"], true);
    assert_eq!(rows[1]["locked"], false);
    assert_eq!(rows[0]["signer"], "dara@wk");
    assert!(rows.iter().all(|r| r["readable"] == true));
    let v2 = call(&dara(), "/version", "n=2", Value::Null).1;
    assert_eq!(v2["parts"]["audience"], "Second words.");
    assert_eq!(
        call(&dara(), "/version", "n=1", Value::Null).1["parts"]["audience"],
        "First words."
    );

    let lock_before = rows[0]["decision"].clone();
    let approvals_before = chain(&rig)
        .decisions
        .iter()
        .filter(|d| d.kind.as_deref() == Some("approve"))
        .count();

    // Restore v2: a new edit in the draft; v3 and its lock stand.
    let (status, v) = call(&dara(), "/restore", "", json!({ "version": 2 }));
    assert_eq!(status, 200, "{v}");
    // The kept inverses do not make the file invalid.
    let report = clan_sdk::validate(&ClanFile::open(rig.id.as_str()).unwrap());
    assert_eq!(report.display(), "OK");
    assert_eq!(data_of(&rig)["audience"], "Second words.");
    let (_, list) = call(&dara(), "/versions", "", Value::Null);
    let rows = list["versions"].as_array().unwrap();
    assert_eq!(rows.len(), 3, "v3 is still in the history");
    assert_eq!(rows[0]["decision"], lock_before);
    assert_eq!(rows[0]["locked"], true, "the approved version stays locked");
    assert_eq!(list["draft"]["restored_from"], 2);
    assert_eq!(list["draft"]["changed"], true);
    assert_eq!(
        call(&dara(), "/version", "n=3", Value::Null).1["parts"]["audience"],
        "Third words."
    );
    assert_eq!(
        call(&dara(), "/version", "n=1", Value::Null).1["parts"]["audience"],
        "First words."
    );
    let c = chain(&rig);
    assert_eq!(
        c.decisions
            .iter()
            .filter(|d| d.kind.as_deref() == Some("approve"))
            .count(),
        approvals_before
    );
    let newest = &c.decisions[0];
    assert_eq!(newest.action, "restore v2");
    assert_eq!(
        newest.actor.as_deref(),
        Some("human:dara@wk"),
        "undo is attributed, not a missing entry"
    );

    // Restoring what the draft already says changes nothing; an unknown version is 404.
    assert_eq!(
        call(&dara(), "/restore", "", json!({ "version": 2 })).1["noop"],
        true
    );
    assert_eq!(
        call(&dara(), "/restore", "", json!({ "version": 9 })).0,
        404
    );
}

#[test]
fn a_write_that_kept_no_inverse_makes_older_versions_unreadable() {
    let rig = rig();
    let dara = || session(&rig, "dara@wk");
    edit(&rig, "One.");
    assert_eq!(call(&dara(), "/approve", "", json!({})).0, 200);
    let (_, list) = call(&dara(), "/versions", "", Value::Null);
    assert_eq!(list["versions"][0]["readable"], true);
    // An appending write has no simple inverse, so it keeps none.
    let (status, v) = call(
        &dara(),
        "/patch-data",
        "",
        json!({ "agent": "human", "action": "add a note", "patch": { "notes": ["x"] }, "append_keys": ["notes"] }),
    );
    assert_eq!(status, 200, "{v}");
    let (_, list) = call(&dara(), "/versions", "", Value::Null);
    assert_eq!(list["versions"][0]["readable"], false);
    assert_eq!(call(&dara(), "/version", "n=1", Value::Null).0, 409);
    assert_eq!(
        call(&dara(), "/restore", "", json!({ "version": 1 })).0,
        409
    );
    // The draft can always be read.
    assert_eq!(
        call(&dara(), "/version", "n=draft", Value::Null).1["parts"]["audience"],
        "One."
    );
}

// review probe (throwaway): a part marked Confidential after v1, then Restore v1.
#[test]
fn review_probe_restore_keeps_a_confidential_mark() {
    let rig = rig();
    let dara = || session(&rig, "dara@wk");
    edit(&rig, "First words.");
    assert_eq!(call(&dara(), "/approve", "", json!({})).0, 200);
    assert_eq!(
        call(&dara(), "/unapprove", "", json!({ "rationale": "again" })).0,
        200
    );
    let (s, v) = call(
        &dara(),
        "/patch-data",
        "",
        json!({ "agent": "human", "action": "mark audience confidential", "patch": { "confidential_fields": ["audience"] } }),
    );
    assert_eq!(s, 200, "{v}");
    edit(&rig, "Second words, not for the client.");
    assert_eq!(data_of(&rig)["confidential_fields"], json!(["audience"]));
    let (s, v) = call(&dara(), "/restore", "", json!({ "version": 1 }));
    assert_eq!(s, 200, "{v}");
    assert_eq!(
        data_of(&rig)["confidential_fields"],
        json!(["audience"]),
        "the part is still marked Confidential after the restore"
    );
}

// A mark a person put on a part is about the part, not about one version's
// words: a restore changes the words and leaves every mark as it stands now.

fn patch(rig: &Rig, action: &str, patch: Value) {
    let (s, v) = call(
        &session(rig, "dara@wk"),
        "/patch-data",
        "",
        json!({ "agent": "human", "action": action, "patch": patch }),
    );
    assert_eq!(s, 200, "{v}");
}

/// v1 holds "First words."; it is approved, then unlocked so the draft can change.
fn v1_then_unlocked(rig: &Rig) {
    let dara = || session(rig, "dara@wk");
    edit(rig, "First words.");
    assert_eq!(call(&dara(), "/approve", "", json!({})).0, 200);
    assert_eq!(
        call(&dara(), "/unapprove", "", json!({ "rationale": "again" })).0,
        200
    );
}

fn restore_v1(rig: &Rig) {
    let (s, v) = call(
        &session(rig, "dara@wk"),
        "/restore",
        "",
        json!({ "version": 1 }),
    );
    assert_eq!(s, 200, "{v}");
    assert_eq!(
        data_of(rig)["audience"],
        "First words.",
        "the words are v1's"
    );
}

#[test]
fn restore_keeps_a_confidential_mark_on_one_part_of_a_field() {
    let rig = rig();
    v1_then_unlocked(&rig);
    patch(
        &rig,
        "mark objectives.commercial confidential",
        json!({ "confidential_fields": ["audience", "objectives.commercial"] }),
    );
    edit(&rig, "Second words.");
    restore_v1(&rig);
    assert_eq!(
        data_of(&rig)["confidential_fields"],
        json!(["audience", "objectives.commercial"])
    );
}

#[test]
fn a_mark_removed_after_a_version_is_not_brought_back_by_restoring_it() {
    let rig = rig();
    let dara = || session(&rig, "dara@wk");
    patch(
        &rig,
        "mark audience confidential",
        json!({ "confidential_fields": ["audience"] }),
    );
    v1_then_unlocked(&rig);
    patch(
        &rig,
        "unmark audience confidential",
        json!({ "confidential_fields": [] }),
    );
    edit(&rig, "Second words.");
    restore_v1(&rig);
    assert_eq!(
        data_of(&rig)["confidential_fields"],
        json!([]),
        "restore changes only the words; the person's later unmark stands"
    );
    // A restore that changes no words writes nothing.
    assert_eq!(
        call(&dara(), "/restore", "", json!({ "version": 1 })).1["noop"],
        true
    );
}

#[test]
fn restore_keeps_a_lock_and_signers_set_after_the_version() {
    let rig = rig();
    v1_then_unlocked(&rig);
    let signers = json!([{ "role": "planner", "person": "aoife@wk" }]);
    patch(
        &rig,
        "lock audience",
        json!({ "locked_fields": ["audience"], "locked": true, "signers": signers }),
    );
    edit(&rig, "Second words.");
    restore_v1(&rig);
    let data = data_of(&rig);
    assert_eq!(data["locked_fields"], json!(["audience"]));
    assert_eq!(data["locked"], true, "an older brief's lock flag stands");
    assert_eq!(data["signers"], signers);
}

#[test]
fn restore_keeps_a_classify_mark_made_after_the_version() {
    let rig = rig();
    v1_then_unlocked(&rig);
    let (s, v) = call(
        &session(&rig, "dara@wk"),
        "/classify",
        "",
        json!({ "target": "audience", "model": false, "export": true, "corpus": false,
                "rationale": "Client data" }),
    );
    assert_eq!(s, 200, "{v}");
    edit(&rig, "Second words.");
    restore_v1(&rig);
    let c = chain(&rig);
    let mark = c
        .decisions
        .iter()
        .find(|d| d.kind.as_deref() == Some("classify"))
        .expect("the classify mark is still in the chain");
    assert!(mark.superseded_by.is_none(), "and still live");
    let l = mark.licence.as_ref().unwrap();
    assert_eq!((l.model, l.corpus), (Some(false), Some(false)));
}

#[test]
fn restore_keeps_material_received_after_the_version_and_its_licence() {
    let rig = rig();
    v1_then_unlocked(&rig);
    let materials = json!({ "mat_1": { "kind": "deck", "name": "Client deck",
        "sha256": "sha256:00", "received_at": "2026-11-14T09:00:00Z",
        "licence": "client-confidential" } });
    patch(&rig, "receive a deck", json!({ "materials": materials }));
    edit(&rig, "Second words.");
    restore_v1(&rig);
    assert_eq!(data_of(&rig)["materials"], materials);
}

#[test]
fn compare_shows_words_not_marks() {
    let rig = rig();
    let dara = || session(&rig, "dara@wk");
    v1_then_unlocked(&rig);
    patch(
        &rig,
        "mark audience confidential",
        json!({ "confidential_fields": ["audience"], "locked": true,
                "materials": { "mat_1": { "licence": "client-confidential" } } }),
    );
    let (_, list) = call(&dara(), "/versions", "", Value::Null);
    assert_eq!(
        list["draft"]["changed"], false,
        "a mark is not a change in the words"
    );
    for n in ["1", "draft"] {
        let parts = call(&dara(), "/version", &format!("n={n}"), Value::Null).1["parts"].clone();
        assert_eq!(parts["audience"], "First words.", "v{n}");
        for mark in ["confidential_fields", "locked", "materials"] {
            assert!(parts.get(mark).is_none(), "v{n} shows {mark} as a part");
        }
    }
}
