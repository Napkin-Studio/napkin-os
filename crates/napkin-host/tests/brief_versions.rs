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
