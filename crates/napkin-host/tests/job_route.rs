//! The approval route's write (features/approval-route.clan): who may name it, how it is checked,
//! that every write is attributed on the registry's chain, that a registry written before routes
//! still reads, and that the brief's signers are filled from it once and never on a locked brief.

use std::sync::Arc;

use clan_sdk::{ClanBuilder, ClanFile, DecisionChain};
use napkin_host::jobs::{self, JobRecord, NewJob, RouteStep};
use napkin_host::{
    clients, handle, Actor, Ctx, DocId, DocStore, FsStore, HostRequest, Library, NoConfig,
    PartStore, Session,
};
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

fn step(stage: &str, role: Option<&str>, approver: &str, due: &str) -> RouteStep {
    RouteStep {
        stage: stage.into(),
        party: "agency".into(),
        role: role.map(Into::into),
        approver: approver.into(),
        contact: None,
        due: due.into(),
        rounds: None,
    }
}

fn client_step(stage: &str, name: &str, due: &str) -> RouteStep {
    RouteStep {
        stage: stage.into(),
        party: "client".into(),
        role: Some("client".into()),
        approver: name.into(),
        contact: Some("contact@client-a.example".into()),
        due: due.into(),
        rounds: Some(2),
    }
}

fn registry_chain(store: &FsStore) -> DecisionChain {
    let id = store.home("jobs-v1").unwrap();
    let clan = ClanFile::from_bytes(store.read(&id).unwrap()).unwrap();
    DecisionChain::from_yaml(&clan.read_entry("agent/decision-chain.yaml").unwrap()).unwrap()
}

fn open_job(store: &FsStore, me: &Ctx) -> (String, JobRecord) {
    let client = clients::create_client(store, me, "Client A", None).unwrap();
    let job = jobs::create_job(
        store,
        me,
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
    (client.id, job)
}

#[test]
fn a_route_is_checked_before_it_is_kept() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let me = ctx("cian@wk");
    open_job(&store, &me);
    let bad = |steps: Vec<RouteStep>| {
        jobs::set_route(&store, &me, "J001", steps)
            .unwrap_err()
            .status
    };

    assert_eq!(
        bad(vec![step("not-a-stage", None, "dara@wk", "2026-11-14")]),
        400
    );
    assert_eq!(
        bad(vec![step("brief-check", None, "dara@wk", "14/11/2026")]),
        400
    );
    assert_eq!(
        bad(vec![step("brief-check", None, "dara@wk", "2026-02-30")]),
        400
    );
    assert_eq!(
        bad(vec![step("brief-check", None, "dara", "2026-11-14")]),
        400,
        "an agency approver is a sign-in name"
    );
    assert_eq!(bad(vec![step("brief-check", None, "", "2026-11-14")]), 400);
    // two approvers for one (stage, role)
    assert_eq!(
        bad(vec![
            step(
                "brief-check",
                Some("creative_director"),
                "dara@wk",
                "2026-11-14"
            ),
            step(
                "brief-check",
                Some("creative_director"),
                "tadhg@wk",
                "2026-11-14"
            ),
        ]),
        400
    );
    // the same stage with two roles is fine
    let mut agency_with_contact = step("decks", Some("creative_director"), "dara@wk", "2026-11-18");
    agency_with_contact.contact = Some("x@y.example".into());
    assert_eq!(
        bad(vec![agency_with_contact]),
        400,
        "a contact belongs to a client step"
    );
    let mut zero = client_step("client-approval", "Client A contact", "2026-11-19");
    zero.rounds = Some(0);
    assert_eq!(bad(vec![zero]), 400);
    let mut no_email = client_step("client-approval", "Client A contact", "2026-11-19");
    no_email.contact = Some("not an email".into());
    assert_eq!(bad(vec![no_email]), 400);
    assert_eq!(
        jobs::set_route(&store, &me, "J404", vec![])
            .unwrap_err()
            .status,
        404
    );
    // none of that wrote anything
    assert!(jobs::get(&store, "J001").unwrap().route.is_empty());

    // a good route is kept in stage order, with every field
    let kept = jobs::set_route(
        &store,
        &me,
        "J001",
        vec![
            client_step("client-approval", "Client A contact", "2026-11-19"),
            step(
                "brief-check",
                Some("creative_director"),
                "dara@wk",
                "2026-11-14",
            ),
            step("brief-check", Some("planner"), "aoife@wk", "2026-11-13"),
        ],
    )
    .unwrap();
    let stages: Vec<_> = kept
        .route
        .iter()
        .map(|s| (s.stage.as_str(), s.role.as_deref()))
        .collect();
    assert_eq!(
        stages,
        [
            ("brief-check", Some("creative_director")),
            ("brief-check", Some("planner")),
            ("client-approval", Some("client"))
        ]
    );
    assert_eq!(jobs::get(&store, "J001").unwrap(), kept);
    assert_eq!(
        kept.route[2].contact.as_deref(),
        Some("contact@client-a.example")
    );
    assert_eq!(kept.route[2].rounds, Some(2));
    // an empty route clears it
    assert!(jobs::set_route(&store, &me, "J001", vec![])
        .unwrap()
        .route
        .is_empty());
}

#[test]
fn every_route_write_is_attributed_on_the_registrys_chain() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let me = ctx("cian@wk");
    open_job(&store, &me);
    assert!(
        !store
            .home("jobs-v1")
            .map(|id| {
                let clan = ClanFile::from_bytes(store.read(&id).unwrap()).unwrap();
                clan.has_entry("agent/decision-chain.yaml")
            })
            .unwrap(),
        "opening a job records nothing, as before"
    );

    jobs::set_route(
        &store,
        &me,
        "J001",
        vec![step(
            "brief-check",
            Some("planner"),
            "aoife@wk",
            "2026-11-13",
        )],
    )
    .unwrap();
    let chain = registry_chain(&store);
    assert_eq!(chain.decisions.len(), 1);
    let d = &chain.decisions[0];
    assert_eq!(
        (d.agent.as_str(), d.action.as_str()),
        ("human:cian@wk", "set_route")
    );
    assert_eq!(d.actor.as_deref(), Some("human:cian@wk"));
    assert_eq!(d.targets, ["J001"]);

    let moved =
        jobs::move_deadline(&store, &ctx("niamh@wk"), "J001", Some("2026-11-27".into())).unwrap();
    assert_eq!(moved.due.as_deref(), Some("2026-11-27"));
    let chain = registry_chain(&store);
    assert_eq!(chain.decisions.len(), 2, "one entry each");
    assert_eq!(
        (
            chain.decisions[0].agent.as_str(),
            chain.decisions[0].action.as_str()
        ),
        ("human:niamh@wk", "move_deadline")
    );
    assert_eq!(chain.decisions[1].action, "set_route");
    assert_eq!(
        jobs::move_deadline(&store, &me, "J001", Some("soon".into()))
            .unwrap_err()
            .status,
        400
    );

    // who set the route, and when, is read back from the chain
    let set = jobs::route_history(&store).unwrap();
    assert_eq!(set["J001"].by, "cian@wk");

    // a write with no actor is refused: a tool, a client and a process are not people
    for who in [
        Actor::producer("agent", "1.0").unwrap(),
        Actor::process("job1").unwrap(),
        Actor::client("a@b.example").unwrap(),
    ] {
        let c = Ctx::new(who);
        assert_eq!(
            jobs::set_route(&store, &c, "J001", vec![])
                .unwrap_err()
                .status,
            403
        );
        assert_eq!(
            jobs::move_deadline(&store, &c, "J001", None)
                .unwrap_err()
                .status,
            403
        );
    }
    assert_eq!(
        registry_chain(&store).decisions.len(),
        2,
        "the refusals wrote nothing"
    );
}

#[test]
fn a_registry_written_before_routes_still_reads_and_unknown_fields_are_ignored() {
    let old = "number: J001\nclient_id: cli_1\ntitle: T\nowner: o@wk\nopened_on: 2026-11-02\ncreated_at: 2026-11-02T09:00:00Z\n";
    let job: JobRecord = serde_yaml::from_str(old).unwrap();
    assert!(job.route.is_empty());
    assert!(
        !serde_yaml::to_string(&job).unwrap().contains("route"),
        "an empty route is not written"
    );
    // a registry a newer build wrote, read by this one: the field it does not know is ignored
    let newer = format!("{old}route:\n  - {{ stage: brief-check, party: agency, approver: dara@wk, due: 2026-11-14, escalate_to: x@wk }}\nsomething_new: 1\n");
    let job: JobRecord = serde_yaml::from_str(&newer).unwrap();
    assert_eq!(job.route.len(), 1);
}

#[test]
fn the_briefs_signers_are_filled_from_the_route_once_and_never_on_a_locked_brief() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let me = ctx("cian@wk");
    let (client_id, _) = open_job(&store, &me);
    let c = (client_id.as_str(), "Client A");
    let sessions = |id: &DocId| -> napkin_host::HostResult<Arc<Session>> {
        let s = Session::with_ctx(
            Arc::new(FsStore::new(dir.path().to_path_buf())),
            ctx("cian@wk"),
        );
        s.open(id.clone())?;
        Ok(Arc::new(s))
    };
    let post = |id: &DocId, who: &str, path: &str, body: Value| {
        let s = Session::with_ctx(Arc::new(FsStore::new(dir.path().to_path_buf())), ctx(who));
        s.open(id.clone()).unwrap();
        handle(
            &s,
            &NoConfig,
            HostRequest::new(path, "", body.to_string().into_bytes()),
        )
        .status
    };
    let mut plain = ready();
    plain.as_object_mut().unwrap().remove("signers");
    let free = document(
        dir.path(),
        "free.clan",
        BRIEF_MAKER,
        "free brief",
        c,
        "J001",
    );
    let locked = document(
        dir.path(),
        "locked.clan",
        BRIEF_MAKER,
        "locked brief",
        c,
        "J001",
    );
    let named = document(
        dir.path(),
        "named.clan",
        BRIEF_MAKER,
        "named brief",
        c,
        "J001",
    );
    for (id, patch) in [
        (&free, plain.clone()),
        (&locked, plain.clone()),
        (&named, ready()),
    ] {
        assert_eq!(
            post(
                id,
                "aoife@wk",
                "/patch-data",
                json!({ "agent": "human", "action": "edit", "patch": patch })
            ),
            200
        );
    }
    assert_eq!(
        post(&locked, "dara@wk", "/approve", json!({})),
        200,
        "locked with no signers named"
    );

    // a route without both roles fills nothing
    jobs::set_route(
        &store,
        &me,
        "J001",
        vec![step(
            "brief-check",
            Some("planner"),
            "aoife@wk",
            "2026-11-13",
        )],
    )
    .unwrap();
    assert!(jobs::fill_signers(&store, &me, "J001", &sessions)
        .unwrap()
        .is_empty());

    jobs::set_route(
        &store,
        &me,
        "J001",
        vec![
            step("brief-check", Some("planner"), "aoife@wk", "2026-11-13"),
            step(
                "brief-check",
                Some("creative_director"),
                "dara@wk",
                "2026-11-14",
            ),
        ],
    )
    .unwrap();
    let filled = jobs::fill_signers(&store, &me, "J001", &sessions).unwrap();
    assert_eq!(
        filled,
        vec![free.clone()],
        "only the open brief with no signers"
    );
    let signers_of = |id: &DocId| {
        let clan = ClanFile::from_bytes(store.read(id).unwrap()).unwrap();
        let data: Value =
            serde_yaml::from_slice(&clan.read_entry("shared/data.yaml").unwrap()).unwrap();
        data.get("signers").cloned()
    };
    assert_eq!(
        signers_of(&free),
        Some(
            json!([{ "role": "planner", "person": "aoife@wk" }, { "role": "creative_director", "person": "dara@wk" }])
        )
    );
    assert_eq!(signers_of(&locked), None, "a locked brief is untouched");
    assert_eq!(
        signers_of(&named),
        ready().get("signers").cloned(),
        "a brief with signers is untouched"
    );
    // filled once: a second call writes nothing
    assert!(jobs::fill_signers(&store, &me, "J001", &sessions)
        .unwrap()
        .is_empty());
}
