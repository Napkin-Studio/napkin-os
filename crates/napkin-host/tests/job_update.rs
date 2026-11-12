// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/job-page.clan: opening and changing a job are attributed decisions on the registry's
//! chain (who, what, when), a bad value is refused before anything is written, and a write with no
//! person is refused.

use clan_sdk::{ClanFile, DecisionChain};
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

    // several fields in one save are one entry; a title, an owner and a budget
    let all = jobs::update_job(
        &store,
        &ctx("niamh@wk"),
        "J001",
        JobPatch {
            title: Some("  Autumn   launch two ".into()),
            owner: Some("dara@wk".into()),
            due: Some(None),
            budget_hours: Some(80.0),
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
        ("Autumn launch two", "dara@wk", None, Some(80.0))
    );
    let c = chain(&store);
    assert_eq!(c.decisions.len(), 3);
    assert_eq!(c.decisions[0].action, "update_job");
    assert_eq!(
        c.decisions[0].fields_changed,
        ["J001/title,owner,due,budget_hours"]
    );

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
