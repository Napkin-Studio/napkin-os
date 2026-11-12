//! The day-one spike for features/idea-room.clan: do the host's fork and the SDK's merge carry routes
//! worked on by several people? Each assertion below is a fact the design needed settled.

use std::sync::Arc;

use clan_sdk::{
    merge::{merge, MergeOptions},
    patch_data_namespaced, patch_decision, ClanBuilder, ClanFile, Decision, DecisionChain,
    DecisionEntry,
};
use napkin_host::{handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

fn room(dir: &std::path::Path) -> DocId {
    let id = DocId::from(dir.join("room.clan"));
    let base = ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "Idea room".into(),
            brief: "idea room".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut b = ClanBuilder::new(base.manifest().clone());
    for (p, bytes) in base.read_all_entries().unwrap() {
        if p != clan_sdk::MANIFEST_PATH && p != "shared/data.yaml" {
            b.add_entry(p, bytes);
        }
    }
    b.add_entry(
        "shared/data.yaml",
        serde_yaml::to_string(&json!({ "cards": { "c1": { "text": "One song of silence" } } }))
            .unwrap()
            .into_bytes(),
    );
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    id
}

fn session(dir: &std::path::Path, id: &DocId, who: &str) -> Session {
    let s = Session::with_ctx(
        Arc::new(FsStore::new(dir.to_path_buf())),
        Ctx::new(Actor::human(who).unwrap()),
    );
    s.open(id.clone()).unwrap();
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

fn person_decision(branch: &ClanFile, who: &str, action: &str) -> Vec<u8> {
    let mut d = Decision::default();
    d.actor = Some(format!("human:{who}"));
    d.kind = Some("edit".into());
    patch_decision(
        branch,
        DecisionEntry {
            agent_name: format!("human:{who}"),
            action: action.into(),
            rationale: "worked on the route".into(),
            pinned: false,
            fields_changed: Some(vec![]),
            typed: Some(d),
        },
        None,
    )
    .unwrap()
}

#[test]
fn routes_as_forks_the_spike() {
    let dir = tempfile::tempdir().unwrap();
    let id = room(dir.path());
    let s = session(dir.path(), &id, "dara@wk");

    // The host's /fork makes one branch document per route, next to the parent.
    let (status, v) = post(
        &s,
        "/fork",
        json!({ "agents": ["route_1", "route_2", "route_3"] }),
    );
    assert_eq!(status, 200, "{v}");
    let branch = |n: u8| dir.path().join(format!("room.route_{n}.clan"));
    for n in 1..=3 {
        assert!(branch(n).exists(), "branch {n}");
    }

    // UNKNOWN 1: the host's patch-data on a branch document.
    let bs = session(dir.path(), &DocId::from(branch(1)), "maeve@wk");
    let (status, v) = post(
        &bs,
        "/patch-data",
        json!({ "agent": "human", "action": "edit", "patch": { "route_1": { "name": "One song" } } }),
    );
    eprintln!("SPIKE host patch-data on a branch -> {status} {v}");
    assert_ne!(
        status, 200,
        "if this passes the host already writes branches"
    );

    // Two people write one route's namespace (the SDK's own call), each with a decision of their own.
    let mut clan = ClanFile::open(branch(1).to_str().unwrap()).unwrap();
    for (who, patch) in [
        (
            "maeve@wk",
            json!({ "route_1": { "name": "One song", "bet": "A bar goes quiet." } }),
        ),
        (
            "oisin@wk",
            json!({ "route_1": { "notes": ["The film is the pour."] } }),
        ),
    ] {
        clan = ClanFile::from_bytes(patch_data_namespaced(&clan, &patch).unwrap()).unwrap();
        clan = ClanFile::from_bytes(person_decision(&clan, who, "edit route")).unwrap();
    }
    let mut r2 = ClanFile::open(branch(2).to_str().unwrap()).unwrap();
    r2 = ClanFile::from_bytes(
        patch_data_namespaced(
            &r2,
            &json!({ "route_2": { "name": "The long pour" }, "shared_hook": "A" }),
        )
        .unwrap(),
    )
    .unwrap();
    let mut r3 = ClanFile::open(branch(3).to_str().unwrap()).unwrap();
    r3 = ClanFile::from_bytes(
        patch_data_namespaced(
            &r3,
            &json!({ "route_3": { "name": "Last orders" }, "shared_hook": "B" }),
        )
        .unwrap(),
    )
    .unwrap();

    // UNKNOWN 2: the SDK merge over those branches.
    let out = merge(&[clan, r2, r3], MergeOptions::default()).unwrap();
    let merged = ClanFile::from_bytes(out.bytes).unwrap();
    let data: Value = serde_yaml::from_str::<serde_yaml::Value>(
        &merged.read_entry_string("shared/data.yaml").unwrap(),
    )
    .map(|y| serde_json::to_value(y).unwrap())
    .unwrap();
    eprintln!("SPIKE merged data {data}");
    eprintln!(
        "SPIKE conflicts {:?}",
        out.report
            .conflicts
            .iter()
            .map(|c| &c.key)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        data["cards"]["c1"]["text"], "One song of silence",
        "the parent's data stays"
    );
    assert_eq!(data["route_1"]["notes"][0], "The film is the pour.");
    assert_eq!(
        data["route_1"]["bet"], "A bar goes quiet.",
        "two people's writes to one namespace both land"
    );
    assert!(data["route_2"].is_object() && data["route_3"].is_object());
    assert_eq!(out.report.conflicts.len(), 1, "only the planted clash");
    assert_eq!(out.report.conflicts[0].key, "shared_hook");
    let chain =
        DecisionChain::from_yaml(&merged.read_entry("agent/decision-chain.yaml").unwrap()).unwrap();
    let who: Vec<_> = chain
        .decisions
        .iter()
        .filter_map(|d| d.actor.clone())
        .collect();
    assert!(
        who.contains(&"human:maeve@wk".to_string()) && who.contains(&"human:oisin@wk".to_string())
    );
    assert_eq!(chain.decisions[0].agent, "clan-merge");
    assert_eq!(
        merged.document_id(),
        ClanFile::open(id.as_str()).unwrap().document_id(),
        "the merged file is the same document"
    );
}
