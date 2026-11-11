//! The visual brief's approval (features/visual-brief.clan): the creative director named on the brief it
//! answers approves one exact version and it locks; a write after that is refused; a later change is a new
//! version, and the approved one stays in the history as it was. One test function: the gate is switched on
//! by the environment.

use std::sync::Arc;

use clan_sdk::{ClanBuilder, ClanFile, Decision, DecisionChain};
use napkin_host::{handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

const VISUAL_BRIEF: &str = "ie.napkin.visual-brief";

struct Rig {
    dir: tempfile::TempDir,
    id: DocId,
}

/// A visual brief as the spin-off leaves it: the brief frozen under `upstream` (naming its signers) and the
/// page's own fields lifted from it.
fn page() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("visual-brief.clan"));
    let base = ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "Visual brief, Permission to stop".into(),
            brief: "a visual brief".into(),
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
        name: "Visual Brief".into(),
        app_id: VISUAL_BRIEF.into(),
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
        "territory": { "name": "Permission to stop", "line": "The evening starts when the day is over.", "source": "typed" },
        "proposition": "The whiskey that waits for you.",
        "tone": ["Unhurried", "Dry"],
        "must_show": ["The bottle, label forward"],
        "never_show": ["Driving"],
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

fn write(s: &Session, patch: Value) -> (u16, Value) {
    post(
        s,
        "/patch-data",
        json!({ "agent": "human", "action": "edit the proposition", "patch": patch }),
    )
}

fn approvals(rig: &Rig) -> Vec<Decision> {
    let clan = ClanFile::open(rig.id.as_str()).unwrap();
    DecisionChain::from_yaml(&clan.read_entry("agent/decision-chain.yaml").unwrap())
        .unwrap()
        .decisions
        .into_iter()
        .filter(|d| d.kind.as_deref() == Some("approve"))
        .collect()
}

#[test]
fn the_creative_director_approves_one_version_it_locks_and_a_change_is_a_new_version() {
    std::env::set_var("NAPKIN_BRIEF_GATE", "on");
    let rig = page();
    let dara = || session(&rig, "dara@wk");

    // Only the creative director the brief names approves: the planner is refused, and nothing is written.
    let (status, v) = post(&session(&rig, "aoife@wk"), "/approve", json!({}));
    assert_eq!(status, 403, "{v}");
    assert!(v["error"].as_str().unwrap().contains("dara@wk"), "{v}");
    assert!(approvals(&rig).is_empty());

    // One approve decision, and it names the version it locked.
    let (status, v) = post(
        &dara(),
        "/approve",
        json!({ "rationale": "Approved visual brief version 1." }),
    );
    assert_eq!(status, 200, "{v}");
    let first = approvals(&rig);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].actor.as_deref(), Some("human:dara@wk"));
    let locked_version = first[0]
        .version
        .clone()
        .expect("the approve names the version it locked");

    // A write after it is refused.
    let (status, v) = write(&dara(), json!({ "proposition": "Changed after the lock." }));
    assert_eq!(status, 409, "{v}");

    // Reopen, edit, approve: a second version. The first approval is exactly as it was.
    let (status, v) = post(
        &dara(),
        "/unapprove",
        json!({ "rationale": "Starting version 2." }),
    );
    assert_eq!(status, 200, "{v}");
    let (status, v) = write(&dara(), json!({ "proposition": "The whiskey that waits." }));
    assert_eq!(status, 200, "{v}");
    let (status, v) = post(
        &dara(),
        "/approve",
        json!({ "rationale": "Approved visual brief version 2." }),
    );
    assert_eq!(status, 200, "{v}");
    let both = approvals(&rig);
    assert_eq!(both.len(), 2, "both versions are in the history");
    let oldest = both
        .iter()
        .find(|d| d.version.as_deref() == Some(locked_version.as_str()))
        .expect("the first approval stays");
    assert_eq!(
        serde_json::to_value(oldest).unwrap(),
        serde_json::to_value(&first[0]).unwrap(),
        "and it is unchanged"
    );
    assert_ne!(
        both[0].version, both[1].version,
        "the second approval names a different version"
    );
}
