//! The job record and the job index (features/job-index-dashboard.clan): a job
//! lists its documents, the index is rebuilt from the decision chains and
//! equals the live one, the stage is read from the Brief gate, and Needs you
//! differs by person. One test function, because the gate reads the environment.

use std::sync::Arc;

use chrono::{TimeZone, Utc};
use clan_sdk::{ClanBuilder, ClanFile};
use napkin_host::jobindex::{Audience, IndexCache, JobIndex};
use napkin_host::jobs::{self, NewJob};
use napkin_host::{clients, handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

const BRIEF_MAKER: &str = "ie.napkin.brief-maker";

fn ctx(who: &str) -> Ctx {
    Ctx::new(Actor::human(who).unwrap())
}

/// A document of `app` for `client` (id, name), filed under `job`, in the store's documents folder.
fn document(
    dir: &std::path::Path,
    file: &str,
    app: &str,
    title: &str,
    client: (&str, &str),
    job: &str,
) -> DocId {
    let base = ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: title.into(),
            brief: "a document".into(),
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
        name: title.into(),
        app_id: app.into(),
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
    m.job = Some(job.into());
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

fn post(s: &Session, path: &str, body: Value) -> u16 {
    handle(
        s,
        &NoConfig,
        HostRequest::new(path, "", body.to_string().into_bytes()),
    )
    .status
}

fn at(dir: &std::path::Path, id: &DocId, who: &str) -> Session {
    let s = Session::with_ctx(Arc::new(FsStore::new(dir.to_path_buf())), ctx(who));
    s.open(id.clone()).unwrap();
    s
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

fn people(index: &JobIndex, who: &str) -> Vec<String> {
    index
        .needs_for(Some(who), &[])
        .into_iter()
        .map(|n| n.action)
        .collect()
}

#[test]
fn a_job_lists_its_documents_and_the_index_is_read_from_their_chains() {
    std::env::set_var("NAPKIN_BRIEF_GATE", "on");
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let me = ctx("niamh@wk");
    let client = clients::create_client(&store, &me, "Client A", None).unwrap();
    let other = clients::create_client(&store, &me, "Client B", None).unwrap();

    // 1. A job holds its number, client, owner, dates and budget; its documents are linked to it.
    let job = jobs::create_job(
        &store,
        &me,
        NewJob {
            number: Some("J001".into()),
            client_id: client.id.clone(),
            title: Some("J001 brief".into()),
            owner: Some("aoife@wk".into()),
            opened_on: Some("2026-11-02".into()),
            due: Some("2026-11-20".into()),
            budget_hours: Some(120.0),
        },
    )
    .unwrap();
    assert_eq!(job.number, "J001");
    assert_eq!(jobs::create_job(&store, &me, NewJob { number: Some("J001".into()), client_id: client.id.clone(), ..Default::default() }).unwrap_err().status, 409);
    assert_eq!(jobs::create_job(&store, &me, NewJob { number: Some("J01".into()), client_id: client.id.clone(), ..Default::default() }).unwrap_err().status, 400);
    assert_eq!(jobs::create_job(&store, &me, NewJob { client_id: "cli_00000000".into(), ..Default::default() }).unwrap_err().status, 404);
    assert_eq!(jobs::create_job(&store, &me, NewJob { client_id: client.id.clone(), ..Default::default() }).unwrap().number, "J002");

    let c = (client.id.as_str(), "Client A");
    let brief = document(dir.path(), "brief.clan", BRIEF_MAKER, "J001 brief", c, "J001");
    document(dir.path(), "research.clan", "ie.napkin.campaign-research", "J001 research", c, "J001");
    document(dir.path(), "deck.clan", "ie.napkin.deck-maker", "J001 pitch deck", c, "J001");
    // another client's document, and one with no job at all, are not J001's
    document(dir.path(), "b.clan", BRIEF_MAKER, "Client B brief", (other.id.as_str(), "Client B"), "J002");

    let now = Utc.with_ymd_and_hms(2026, 11, 11, 10, 0, 0).unwrap();
    let index = JobIndex::build(&store, now).unwrap();
    let j001 = index.job("J001").unwrap();
    assert_eq!(j001.documents.len(), 3, "creating J001 and three documents lists all three");
    assert_eq!(j001.client.name, "Client A");
    assert_eq!(j001.budget_hours, Some(120.0));
    assert_eq!(index.job("J002").unwrap().documents.len(), 1);

    // linking a document of another client is refused
    let stray = document(dir.path(), "stray.clan", BRIEF_MAKER, "x", (other.id.as_str(), "Client B"), "J999");
    assert_eq!(jobs::link_document(&store, &stray, "J001").unwrap_err().status, 400);
    assert_eq!(jobs::link_document(&store, &stray, "J404").unwrap_err().status, 404);

    // 2. The stage comes from the chain. A brief with nothing in it is still a client brief.
    assert_eq!(j001.stage.id, "client-brief");
    assert!(!j001.at_risk);
    let late = JobIndex::build(&store, Utc.with_ymd_and_hms(2026, 11, 21, 9, 0, 0).unwrap()).unwrap();
    assert!(late.job("J001").unwrap().at_risk, "past its deadline");

    let aoife = || at(dir.path(), &brief, "aoife@wk");
    let dara = || at(dir.path(), &brief, "dara@wk");
    let edit = json!({ "agent": "human", "action": "edit", "patch": ready() });
    assert_eq!(post(&aoife(), "/patch-data", edit), 200);
    let index = JobIndex::build(&store, now).unwrap();
    assert_eq!(index.job("J001").unwrap().stage.id, "brief-check", "passed the gate");

    // 3. Needs you is per person: the planner is asked to sign, the creative director is not yet.
    assert_eq!(people(&index, "aoife@wk"), vec!["Sign the brief"]);
    assert!(people(&index, "dara@wk").is_empty());
    assert!(people(&index, "cian@wk").is_empty());
    assert_eq!(post(&aoife(), "/sign", json!({})), 200);
    let index = JobIndex::build(&store, now).unwrap();
    assert!(people(&index, "aoife@wk").is_empty());
    assert_eq!(people(&index, "dara@wk"), vec!["Sign and lock"]);

    // The index holds jobs and what people are asked to do; it names no score or rank of anyone.
    let wire = serde_json::to_string(&index).unwrap();
    assert!(!wire.contains("score") && !wire.contains("rank"), "{wire}");

    // 4. Signed, then confirmed: the stage and the days the client has waited follow the chain.
    assert_eq!(post(&dara(), "/sign", json!({})), 200);
    let index = JobIndex::build(&store, Utc::now() + chrono::Duration::days(2)).unwrap();
    let j = index.job("J001").unwrap();
    assert_eq!((j.stage.id, j.waiting_on), ("brief-check", "client"));
    assert_eq!(j.days_waiting_on_client, Some(2));
    assert_eq!(
        index.needs_for(None, &["account-service".to_string()]).len(),
        1,
        "account service is asked to get the client's answer"
    );
    assert_eq!(
        post(&dara(), "/client-review", json!({ "answer": "accepted", "client": { "name": "Client A contact" }, "channel": "none", "parts": [] })),
        200
    );
    let index = JobIndex::build(&store, now).unwrap();
    assert_eq!(index.job("J001").unwrap().stage.id, "scope-estimate");
    assert!(index.needs.iter().all(|n| n.job != "J001"));

    // An edit after the signature is a changed brief: both signers are asked again.
    let edit = json!({ "agent": "human", "action": "edit", "patch": { "single_minded_proposition": "A new line." } });
    assert_eq!(post(&dara(), "/patch-data", edit), 200);
    let index = JobIndex::build(&store, now).unwrap();
    assert_eq!(people(&index, "aoife@wk"), vec!["Sign the changed brief"]);
    assert_eq!(people(&index, "dara@wk"), vec!["Sign the changed brief"]);
    assert!(matches!(index.needs[0].audience, Audience::Person(_)));

    // 5. Delete the index and rebuild it from the documents: the result is identical,
    // and an unchanged tenant does not rebuild.
    let cache = IndexCache::new();
    let live = cache.get(&store, now).unwrap();
    assert_eq!(cache.get(&store, now).unwrap(), live);
    assert_eq!(cache.builds(), 1);
    cache.delete();
    let rebuilt = cache.get(&store, now).unwrap();
    assert_eq!(rebuilt, live, "rebuilt from the documents, identical to the live index");
    assert_eq!(cache.builds(), 2);
    assert_eq!(rebuilt, JobIndex::build(&store, now).unwrap());
    // a change to a document is a new index
    let edit = json!({ "agent": "human", "action": "edit", "patch": { "insight": "" } });
    assert_eq!(post(&dara(), "/patch-data", edit), 200);
    assert_ne!(cache.get(&store, now).unwrap(), live);

    // The dashboard reads the same index: six tiles' worth of facts, no scores yet.
    let d = rebuilt.dashboard();
    assert_eq!(d.live_jobs, 2);
    assert_eq!(d.hours.budget, 120.0);
    assert!(d.scores.is_none() && d.results.is_none());
    std::env::remove_var("NAPKIN_BRIEF_GATE");
}
