// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/job-page.clan: opening and changing a job are attributed decisions on the registry's
//! chain (who, what, when), a bad value is refused before anything is written, and a write with no
//! person is refused.

use clan_sdk::{ClanFile, Decision, DecisionChain};
use napkin_host::jobs::{self, JobPatch, NewJob};
use napkin_host::{clients, Actor, Ctx, FsStore, Library, PartStore};

fn ctx(who: &str) -> Ctx {
    Ctx::new(Actor::human(who).unwrap())
}

fn chain(store: &FsStore) -> DecisionChain {
    let id = store.home("jobs-v1").unwrap();
    let clan = ClanFile::from_bytes(store.read(&id).unwrap()).unwrap();
    DecisionChain::from_yaml(&clan.read_entry("agent/decision-chain.yaml").unwrap()).unwrap()
}

fn open(store: &FsStore, who: &Ctx) -> String {
    let client = clients::create_client(store, who, "Client A", None).unwrap();
    jobs::create_job(
        store,
        who,
        NewJob {
            number: Some("J001".into()),
            client_id: client.id.clone(),
            title: Some("Autumn launch".into()),
            owner: Some("aoife@wk".into()),
            opened_on: Some("2026-11-02".into()),
            due: Some("2026-11-20".into()),
            budget_hours: None,
        },
    )
    .unwrap();
    client.id
}

#[test]
fn opening_and_changing_a_job_are_attributed_decisions() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let me = ctx("aoife@wk");
    open(&store, &me);
    let c = chain(&store);
    assert_eq!(c.decisions.len(), 1);
    assert_eq!(
        (
            c.decisions[0].agent.as_str(),
            c.decisions[0].action.as_str()
        ),
        ("human:aoife@wk", "open_job")
    );

    // the deadline alone: the entry names the person and says what moved, from and to
    let moved = jobs::update_job(
        &store,
        &ctx("cian@wk"),
        "J001",
        JobPatch {
            due: Some(Some("2026-11-27".into())),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(moved.due.as_deref(), Some("2026-11-27"));
    let c = chain(&store);
    assert_eq!(c.decisions.len(), 2, "one entry for the change");
    let d = &c.decisions[0];
    assert_eq!(
        (d.agent.as_str(), d.action.as_str()),
        ("human:cian@wk", "move_deadline")
    );
    assert_eq!(d.targets, ["J001"]);
    assert!(
        d.rationale.contains("from 2026-11-20 to 2026-11-27"),
        "{}",
        d.rationale
    );
    assert!(!d.timestamp.is_empty());

    // several fields in one save are one entry; a title, an owner and the deadline cleared
    let all = jobs::update_job(
        &store,
        &ctx("niamh@wk"),
        "J001",
        JobPatch {
            title: Some("  Autumn   launch two ".into()),
            owner: Some("dara@wk".into()),
            due: Some(None),
            budget_hours: None,
        },
    )
    .unwrap();
    assert_eq!(
        (
            all.title.as_str(),
            all.owner.as_str(),
            all.due.clone(),
            all.budget_hours
        ),
        ("Autumn launch two", "dara@wk", None, None)
    );
    let c = chain(&store);
    assert_eq!(c.decisions.len(), 3);
    assert_eq!(c.decisions[0].action, "update_job");
    assert_eq!(c.decisions[0].fields_changed, ["J001/title,owner,due"]);

    // a budget is never changed by a patch, for anyone: it is a set_budget decision (features/align-confidential-prices.clan)
    let refused = jobs::update_job(
        &store,
        &ctx("niamh@wk"),
        "J001",
        JobPatch {
            budget_hours: Some(80.0),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert_eq!(refused.status, 400);
    assert_eq!(chain(&store).decisions.len(), 3, "nothing was written");

    // a change that changes nothing writes nothing
    jobs::update_job(
        &store,
        &me,
        "J001",
        JobPatch {
            owner: Some("dara@wk".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(chain(&store).decisions.len(), 3);

    // a deadline left out stays; the registry still reads
    let kept = jobs::update_job(
        &store,
        &me,
        "J001",
        JobPatch {
            title: Some("Kept".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(kept.due, None);
    assert_eq!(jobs::get(&store, "J001").unwrap().title, "Kept");
}

#[test]
fn a_bad_value_or_a_missing_person_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let me = ctx("aoife@wk");
    let client = open(&store, &me);
    let bad = |p: JobPatch| jobs::update_job(&store, &me, "J001", p).unwrap_err().status;
    assert_eq!(
        bad(JobPatch {
            due: Some(Some("soon".into())),
            ..Default::default()
        }),
        400
    );
    assert_eq!(
        bad(JobPatch {
            title: Some("  ".into()),
            ..Default::default()
        }),
        400
    );
    assert_eq!(
        bad(JobPatch {
            title: Some("x".repeat(81)),
            ..Default::default()
        }),
        400
    );
    assert_eq!(
        bad(JobPatch {
            budget_hours: Some(-1.0),
            ..Default::default()
        }),
        400
    );
    assert_eq!(
        jobs::update_job(&store, &me, "J404", JobPatch::default())
            .unwrap_err()
            .status,
        404
    );
    for who in [
        Actor::producer("agent", "1.0").unwrap(),
        Actor::process("job1").unwrap(),
        Actor::client("a@b.example").unwrap(),
    ] {
        let c = Ctx::new(who);
        assert_eq!(
            jobs::update_job(
                &store,
                &c,
                "J001",
                JobPatch {
                    title: Some("Hijack".into()),
                    ..Default::default()
                }
            )
            .unwrap_err()
            .status,
            403
        );
        let new = NewJob {
            number: Some("J002".into()),
            client_id: client.clone(),
            ..Default::default()
        };
        assert_eq!(jobs::create_job(&store, &c, new).unwrap_err().status, 403);
    }
    assert_eq!(chain(&store).decisions.len(), 1, "nothing was written");
    assert_eq!(jobs::get(&store, "J001").unwrap().title, "Autumn launch");
}

#[test]
fn the_deadline_clear_and_the_absent_deadline_read_differently_from_json() {
    let p: JobPatch = serde_json::from_str(r#"{"due":null}"#).unwrap();
    assert_eq!(p.due, Some(None));
    let p: JobPatch = serde_json::from_str(r#"{"title":"x"}"#).unwrap();
    assert_eq!(p.due, None);
    let p: JobPatch = serde_json::from_str(r#"{"due":"2026-11-27"}"#).unwrap();
    assert_eq!(p.due, Some(Some("2026-11-27".into())));
}

/// The `set_budget` block of a decision: `{job, hours}`.
fn budget_of(d: &Decision) -> serde_json::Value {
    serde_json::to_value(d.extra.get("set_budget").expect("a set_budget block")).unwrap()
}

// features/align-confidential-prices.clan, done_when line 12: a job's budget is kept as data and set as one
// `set_budget` decision in the job's chain, by a person, with numbers and ids only; never by a patch.
#[test]
fn a_budget_is_one_set_budget_decision_by_a_person_in_the_jobs_chain() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let me = ctx("aoife@wk");
    open(&store, &me);
    let cian = ctx("cian@wk");
    let job = jobs::set_budget(&store, &cian, "J001", 80.0).unwrap();
    assert_eq!(
        job.budget_hours,
        Some(80.0),
        "the job keeps the figure as data"
    );
    assert_eq!(jobs::get(&store, "J001").unwrap().budget_hours, Some(80.0));
    let c = chain(&store);
    assert_eq!(c.decisions.len(), 2, "one entry for the budget");
    let d = &c.decisions[0];
    assert_eq!(
        (d.kind.as_deref(), d.action.as_str(), d.agent.as_str()),
        (Some("set_budget"), "set_budget", "human:cian@wk")
    );
    assert_eq!(d.targets, ["J001"]);
    assert!(d.kind_is_known(), "set_budget is a known kind");
    assert_eq!(
        budget_of(d),
        serde_json::json!({ "job": "J001", "hours": 80.0 })
    );
    // the words name no figure: the figure is read from the block, in the Decisions drawer, by the Money roles
    assert!(!d.rationale.contains("80"), "{}", d.rationale);

    // a bad figure, an unknown job, or no person writes nothing
    for h in [-1.0, f64::NAN, f64::INFINITY] {
        assert_eq!(
            jobs::set_budget(&store, &cian, "J001", h)
                .unwrap_err()
                .status,
            400,
            "{h}"
        );
    }
    assert_eq!(
        jobs::set_budget(&store, &cian, "J404", 10.0)
            .unwrap_err()
            .status,
        404
    );
    let agent = Ctx::new(Actor::process("job1").unwrap());
    assert_eq!(
        jobs::set_budget(&store, &agent, "J001", 10.0)
            .unwrap_err()
            .status,
        403
    );
    assert_eq!(chain(&store).decisions.len(), 2, "nothing was written");

    // the job's own decisions, newest first, and nothing of another job
    let mine = jobs::decisions_of(&store, "J001").unwrap();
    assert_eq!(
        mine.iter().map(|d| d.action.as_str()).collect::<Vec<_>>(),
        ["set_budget", "open_job"]
    );
    assert!(jobs::decisions_of(&store, "J002").unwrap().is_empty());
}

// Review finding (c): opening a job with a budget writes the budget as a set_budget decision too, after
// the open_job one, so the chain holds every budget a job was ever given.
#[test]
fn opening_a_job_with_a_budget_writes_a_set_budget_decision_after_the_open() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let me = ctx("cian@wk");
    let client = clients::create_client(&store, &me, "Client A", None).unwrap();
    let job = jobs::create_job(
        &store,
        &me,
        NewJob {
            number: Some("J001".into()),
            client_id: client.id.clone(),
            budget_hours: Some(40.0),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(job.budget_hours, Some(40.0));
    let c = chain(&store);
    assert_eq!(
        c.decisions
            .iter()
            .map(|d| (d.kind.as_deref().unwrap_or("edit"), d.action.as_str()))
            .collect::<Vec<_>>(),
        [("set_budget", "set_budget"), ("edit", "open_job")],
        "newest first: the budget after the open"
    );
    assert_eq!(
        budget_of(&c.decisions[0]),
        serde_json::json!({ "job": "J001", "hours": 40.0 })
    );
    assert_eq!(c.decisions[0].agent, "human:cian@wk");
    // a job opened with no budget writes no set_budget
    jobs::create_job(
        &store,
        &me,
        NewJob {
            number: Some("J002".into()),
            client_id: client.id,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(chain(&store).decisions.len(), 3);
}
