//! The Brief gate (features/brief-gate.clan): six items, two signers, and the
//! lock list that holds a brief until they are met; then Territories' state.
//! One test function, because the gate is switched on by the environment.

use std::sync::Arc;

use clan_sdk::{ClanBuilder, ClanFile, DecisionChain};
use napkin_host::{handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

const BRIEF_MAKER: &str = "ie.napkin.brief-maker";

struct Rig {
    _dir: tempfile::TempDir,
    id: DocId,
}

fn brief() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("brief.clan"));
    let base = ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "J001 brief".into(),
            brief: "a brief".into(),
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
        name: "Brief Maker".into(),
        app_id: BRIEF_MAKER.into(),
        version: "1.0.0".into(),
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
        if path != clan_sdk::MANIFEST_PATH {
            b.add_entry(path, bytes);
        }
    }
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    Rig { _dir: dir, id }
}

/// A person at the brief now (a session holds the version it opened).
fn session(rig: &Rig, who: &str) -> Session {
    let s = Session::with_ctx(
        Arc::new(FsStore::new(rig._dir.path().to_path_buf())),
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

fn get(s: &Session, path: &str) -> Value {
    let r = handle(s, &NoConfig, HostRequest::new(path, "", Vec::new()));
    assert_eq!(r.status, 200, "{path}");
    serde_json::from_slice(&r.body).unwrap()
}

fn edit(s: &Session, patch: Value) {
    let (status, v) = post(
        s,
        "/patch-data",
        json!({ "agent": "human", "action": "edit", "patch": patch }),
    );
    assert_eq!(status, 200, "{v}");
}

fn chain(rig: &Rig) -> DecisionChain {
    let clan = ClanFile::open(rig.id.as_str()).unwrap();
    DecisionChain::from_yaml(&clan.read_entry("agent/decision-chain.yaml").unwrap()).unwrap()
}

fn ready() -> Value {
    json!({
        "single_minded_proposition": "The easy way into Irish whiskey.",
        "insight": "Younger drinkers think Irish whiskey is for someone else.",
        "objectives": { "commercial": "Grow bar sales by 8% in the autumn quarter." },
        "desired_response": { "feel": "Welcome.", "do": "Order a first pour." },
        "famous": "A bar that closes its doors for one song.",
        "measurement": ["Baseline: 6% of bar orders. Target: 14% by December."],
        "signers": [
            { "role": "planner", "person": "aoife@wk" },
            { "role": "creative_director", "person": "dara@wk" },
        ],
    })
}

#[test]
fn the_gate_holds_a_brief_until_it_passes_is_signed_twice_and_confirmed() {
    std::env::set_var("NAPKIN_BRIEF_GATE", "on");
    let rig = brief();
    let pl = || session(&rig, "aoife@wk");
    let dara = || session(&rig, "dara@wk");

    // A brief with no baseline: the sixth item is missing, and /approve says so.
    let mut thin = ready();
    thin["measurement"] = json!(["Track consideration monthly."]);
    edit(&pl(), thin);
    let g = get(&pl(), "/gate");
    assert_eq!(g["items"].as_array().unwrap().len(), 6);
    assert_eq!(g["missing"], 1);
    assert_eq!(g["items"][5]["id"], "baseline");
    assert_eq!(g["items"][5]["state"], "missing");
    assert_eq!(g["open"], false);
    let (status, v) = post(&pl(), "/sign", json!({}));
    assert_eq!(
        status, 409,
        "the planner cannot sign a brief that has not passed: {v}"
    );
    let (status, v) = post(&dara(), "/approve", json!({}));
    assert_eq!(status, 409, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Brief gate"), "{v}");

    // Fixed: it passes, but nobody has signed. The creative director cannot lock first.
    edit(
        &pl(),
        json!({ "measurement": ["Baseline: 6% of bar orders. Target: 14% by December."] }),
    );
    assert_eq!(get(&pl(), "/gate")["passed"], true);
    let (status, v) = post(&dara(), "/approve", json!({}));
    assert_eq!(status, 409, "the planner signs first: {v}");
    assert!(v["error"].as_str().unwrap().contains("planner"), "{v}");

    // Someone not named cannot sign.
    let other = session(&rig, "cian@wk");
    assert_eq!(post(&other, "/sign", json!({})).0, 403);
    assert_eq!(post(&other, "/approve", json!({})).0, 403);

    // The planner signs; then the creative director's signature is one approve decision.
    let (status, v) = post(&pl(), "/sign", json!({}));
    assert_eq!(status, 200, "{v}");
    let g = get(&pl(), "/gate");
    assert_eq!(g["planner_signed"], true);
    assert_eq!(g["signed"], false);
    assert_eq!(post(&dara(), "/sign", json!({})).0, 200);
    let approvals: Vec<_> = chain(&rig)
        .decisions
        .iter()
        .filter(|d| d.kind.as_deref() == Some("approve"))
        .cloned()
        .collect();
    assert_eq!(approvals.len(), 1);
    assert_eq!(approvals[0].actor.as_deref(), Some("human:dara@wk"));
    let g = get(&dara(), "/gate");
    assert_eq!(
        (
            g["signed"].clone(),
            g["confirmed"].clone(),
            g["open"].clone()
        ),
        (json!(true), json!(false), json!(false))
    );

    // Creative work (a spin-off of the brief) is refused until the client has answered.
    let spin = |rig: &Rig| {
        napkin_host::ops::gate::allow_spinoff(&rig.id, &ClanFile::open(rig.id.as_str()).unwrap())
    };
    let refused = spin(&rig).unwrap_err();
    assert_eq!(refused.status, 409);
    assert!(refused.to_string().contains("confirmed"), "{refused}");

    // The client's answer, recorded by staff, opens Territories.
    let (status, v) = post(
        &dara(),
        "/client-review",
        json!({ "answer": "accepted", "client": { "name": "Client A contact" }, "channel": "none", "parts": [] }),
    );
    assert_eq!(status, 200, "{v}");
    let g = get(&dara(), "/gate");
    assert_eq!(
        (g["confirmed"].clone(), g["open"].clone()),
        (json!(true), json!(true))
    );
    spin(&rig).expect("a confirmed brief spins off");

    // Editing after approval: the signed version stays, the change is flagged, Territories close.
    let signed = chain(&rig)
        .decisions
        .iter()
        .find(|d| d.kind.as_deref() == Some("approve"))
        .unwrap()
        .version
        .clone();
    edit(
        &dara(),
        json!({ "single_minded_proposition": "A new line." }),
    );
    let g = get(&dara(), "/gate");
    assert_eq!(g["changed_since_lock"], true);
    assert_eq!(g["open"], false);
    assert_eq!(
        chain(&rig)
            .decisions
            .iter()
            .find(|d| d.kind.as_deref() == Some("approve"))
            .unwrap()
            .version,
        signed
    );

    // A brief with no signers named cannot lock at all.
    let bare = brief();
    let s = session(&bare, "dara@wk");
    let mut no_signers = ready();
    no_signers.as_object_mut().unwrap().remove("signers");
    edit(&s, no_signers);
    let (status, v) = post(&s, "/approve", json!({}));
    assert_eq!(status, 409, "{v}");
    assert!(v["error"].as_str().unwrap().contains("who signs"), "{v}");

    // With the gate off the same brief locks as it did before.
    std::env::remove_var("NAPKIN_BRIEF_GATE");
    assert_eq!(post(&s, "/approve", json!({})).0, 200);
    assert_eq!(get(&s, "/gate")["open"], true);
}
