//! One Needs you, one Lock (features/align-needs-lock-people.clan, stage 1): the host's attention item
//! carries who it is for, when it is due and which job; the six gate items, the questions the client is
//! owed and the two sign-offs are attention items that block the lock, and the host's `can_lock` agrees.
//! One test function, because the gate is switched on by the environment.

use std::sync::Arc;

use chrono::{DateTime, TimeZone, Utc};
use clan_sdk::{ClanBuilder, ClanFile, DecisionChain};
use napkin_host::jobindex::IndexCache;
use napkin_host::jobs::{self, NewJob, RouteStep};
use napkin_host::{clients, handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

const BRIEF_MAKER: &str = "ie.napkin.brief-maker";

fn ctx(who: &str) -> Ctx {
    Ctx::new(Actor::human(who).unwrap())
}

/// A brief under `job` (or none), in the store's documents folder.
fn brief(dir: &std::path::Path, file: &str, client: (&str, &str), job: Option<&str>) -> DocId {
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
    m.client = Some(clan_sdk::ClientRef {
        id: client.0.into(),
        name: client.1.into(),
    });
    m.job = job.map(Into::into);
    let mut b = ClanBuilder::new(m);
    for (path, bytes) in base.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH {
            b.add_entry(path, bytes);
        }
    }
    let docs = dir.join("documents");
    std::fs::create_dir_all(&docs).unwrap();
    let id = DocId::from(docs.join(file));
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    id
}

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 12, 10, 0, 0).unwrap()
}

/// A person at the brief, with the job index behind the session (the web server's shape).
fn at(dir: &std::path::Path, id: &DocId, who: &str, indexed: bool) -> Session {
    let s = Session::with_ctx(Arc::new(FsStore::new(dir.to_path_buf())), ctx(who));
    let s = if indexed {
        s.with_jobs(Arc::new(IndexCache::new()), Arc::new(now))
    } else {
        s
    };
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

fn decisions(s: &Session) -> Value {
    let r = handle(s, &NoConfig, HostRequest::new("/decisions", "", Vec::new()));
    assert_eq!(r.status, 200);
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

fn item<'a>(v: &'a Value, code: &str) -> &'a Value {
    v["attention"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["code"] == code)
        .unwrap_or_else(|| panic!("no {code} in {}", v["attention"]))
}

fn codes(v: &Value) -> Vec<String> {
    v["attention"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["code"].as_str().unwrap().to_string())
        .collect()
}

fn step(role: &str, approver: &str, due: &str) -> RouteStep {
    RouteStep {
        stage: "brief-check".into(),
        party: "agency".into(),
        role: Some(role.into()),
        approver: approver.into(),
        contact: None,
        due: due.into(),
        rounds: None,
    }
}

#[test]
fn the_gate_and_the_two_sign_offs_are_items_that_block_the_one_lock() {
    std::env::set_var("NAPKIN_BRIEF_GATE", "on");
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let cian = ctx("cian@wk");
    let client = clients::create_client(&store, &cian, "Client A", None).unwrap();
    let c = (client.id.as_str(), "Client A");
    jobs::create_job(
        &store,
        &cian,
        NewJob {
            number: Some("J001".into()),
            client_id: client.id.clone(),
            title: Some("J001 brief".into()),
            owner: Some("aoife@wk".into()),
            opened_on: Some("2026-11-02".into()),
            due: Some("2026-11-30".into()),
            budget_hours: None,
        },
    )
    .unwrap();
    let b = brief(dir.path(), "b1.clan", c, Some("J001"));
    jobs::set_route_at(
        &store,
        &cian,
        "J001",
        vec![
            step("planner", "aoife@wk", "2026-11-13"),
            step("creative_director", "dara@wk", "2026-11-16"),
        ],
        now(),
    )
    .unwrap();
    let aoife = || at(dir.path(), &b, "aoife@wk", true);
    let dara = || at(dir.path(), &b, "dara@wk", true);

    // Part 2: a thin brief (no number in the objective, no baseline) holds the one lock with gate items,
    // each an attention item that blocks, and the host's can_lock says the same.
    let mut thin = ready();
    thin["objectives"] = json!({ "commercial": "Grow consideration." });
    thin["measurement"] = json!(["Track consideration monthly."]);
    edit(&aoife(), thin);
    let v = decisions(&aoife());
    for code in ["gate:objective", "gate:baseline", "signoff:planner"] {
        let a = item(&v, code);
        assert_eq!(a["blocks_lock"], true, "{code}");
    }
    assert!(
        !codes(&v).iter().any(|c| c == "gate:proposition"),
        "a gate item that passes is not an item: {:?}",
        codes(&v)
    );
    assert_eq!(v["lock"]["can_lock"], false);
    let open = v["attention"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["blocks_lock"] == true)
        .count();
    assert_eq!(v["lock"]["blockers"], open, "can_lock agrees with the list");
    // the questions the client is owed are the two items only the client can settle
    for code in ["gate:objective", "gate:baseline"] {
        assert!(
            item(&v, code)["text"]
                .as_str()
                .unwrap()
                .contains("Ask the client"),
            "{code}"
        );
    }
    let (status, refused) = post(&dara(), "/approve", json!({}));
    assert_eq!(status, 409, "{refused}");
    let said = refused["error"].as_str().unwrap();
    assert!(
        said.contains("objective") && said.contains("planner"),
        "the refusal lists what is open: {said}"
    );

    // Part 1: the item says who it is for, when it is due and which job. The planner's sign-off is for the
    // planner named on the brief, due on the route's date for the open step on this document.
    let signoff = item(&v, "signoff:planner");
    assert_eq!(signoff["for"], json!({ "person": "aoife@wk" }));
    assert_eq!(signoff["due"], "2026-11-13");
    assert_eq!(signoff["job"], "J001");
    assert_eq!(
        item(&v, "gate:baseline")["for"],
        json!({ "person": "aoife@wk" })
    );
    assert_eq!(item(&v, "gate:baseline")["due"], "2026-11-13");
    // without the job index behind the session the route is not read: the job is, the person and date are not
    let bare = decisions(&at(dir.path(), &b, "aoife@wk", false));
    assert_eq!(item(&bare, "gate:baseline")["job"], "J001");
    assert!(item(&bare, "gate:baseline").get("due").is_none());

    // Fixed, but the planner has not signed: one item left, the sign-off.
    edit(&aoife(), ready());
    let v = decisions(&aoife());
    assert_eq!(codes(&v), vec!["signoff:planner".to_string()]);
    assert_eq!(v["lock"]["can_lock"], false);
    assert_eq!(post(&dara(), "/approve", json!({})).0, 409);

    // Settled: the planner's one sign decision, then the creative director's lock.
    assert_eq!(post(&aoife(), "/sign", json!({})).0, 200);
    let v = decisions(&aoife());
    assert!(codes(&v).is_empty(), "{:?}", codes(&v));
    assert_eq!(v["lock"]["can_lock"], true);
    // the route's open step is now the creative director's, and no item is waiting on anyone
    assert_eq!(post(&dara(), "/approve", json!({})).0, 200);
    let clan = ClanFile::open(b.as_str()).unwrap();
    let chain =
        DecisionChain::from_yaml(&clan.read_entry("agent/decision-chain.yaml").unwrap()).unwrap();
    let by = |kind: &str| -> Vec<Option<String>> {
        chain
            .decisions
            .iter()
            .filter(|d| d.kind.as_deref() == Some(kind))
            .map(|d| d.actor.clone())
            .collect()
    };
    assert_eq!(by("sign"), vec![Some("human:aoife@wk".to_string())]);
    assert_eq!(by("approve"), vec![Some("human:dara@wk".to_string())]);

    // A brief that names no signers: two sign-off items, for the roles, until they are named.
    let loose = brief(dir.path(), "b2.clan", c, Some("J001"));
    let ls = at(dir.path(), &loose, "aoife@wk", true);
    let mut unsigned = ready();
    unsigned.as_object_mut().unwrap().remove("signers");
    edit(&ls, unsigned);
    let v = decisions(&ls);
    assert_eq!(
        item(&v, "signoff:planner")["for"],
        json!({ "role": "planning" })
    );
    assert_eq!(
        item(&v, "signoff:creative_director")["for"],
        json!({ "role": "creative-director" })
    );

    // Part 1, the other way: a document filed under no job has none of the three fields, on any item, and
    // behaves as before (the item keeps its old code on the old rules: the gate still holds a brief).
    let free = brief(dir.path(), "b3.clan", c, None);
    let fs = at(dir.path(), &free, "aoife@wk", true);
    edit(&fs, json!({ "single_minded_proposition": "One. Two." }));
    let v = decisions(&fs);
    assert!(!v["attention"].as_array().unwrap().is_empty());
    for a in v["attention"].as_array().unwrap() {
        for k in ["for", "due", "job"] {
            assert!(a.get(k).is_none(), "{k} on {a}");
        }
    }
    assert_eq!(v["lock"]["can_lock"], false);
}
