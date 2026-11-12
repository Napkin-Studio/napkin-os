//! The job record and the job index (features/job-index-dashboard.clan): a job
//! lists its documents, the index is rebuilt from the decision chains and
//! equals the live one, the stage is read from the Brief gate, and Needs you
//! differs by person. One test function, because the gate reads the environment.

use std::sync::Arc;

use chrono::{DateTime, TimeZone, Utc};
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
    assert_eq!(
        jobs::create_job(
            &store,
            &me,
            NewJob {
                number: Some("J001".into()),
                client_id: client.id.clone(),
                ..Default::default()
            }
        )
        .unwrap_err()
        .status,
        409
    );
    assert_eq!(
        jobs::create_job(
            &store,
            &me,
            NewJob {
                number: Some("J01".into()),
                client_id: client.id.clone(),
                ..Default::default()
            }
        )
        .unwrap_err()
        .status,
        400
    );
    assert_eq!(
        jobs::create_job(
            &store,
            &me,
            NewJob {
                client_id: "cli_00000000".into(),
                ..Default::default()
            }
        )
        .unwrap_err()
        .status,
        404
    );
    assert_eq!(
        jobs::create_job(
            &store,
            &me,
            NewJob {
                client_id: client.id.clone(),
                ..Default::default()
            }
        )
        .unwrap()
        .number,
        "J002"
    );

    let c = (client.id.as_str(), "Client A");
    let brief = document(
        dir.path(),
        "brief.clan",
        BRIEF_MAKER,
        "J001 brief",
        c,
        "J001",
    );
    document(
        dir.path(),
        "research.clan",
        "ie.napkin.campaign-research",
        "J001 research",
        c,
        "J001",
    );
    document(
        dir.path(),
        "deck.clan",
        "ie.napkin.deck-maker",
        "J001 pitch deck",
        c,
        "J001",
    );
    // another client's document, and one with no job at all, are not J001's
    document(
        dir.path(),
        "b.clan",
        BRIEF_MAKER,
        "Client B brief",
        (other.id.as_str(), "Client B"),
        "J002",
    );

    let now = Utc.with_ymd_and_hms(2026, 11, 11, 10, 0, 0).unwrap();
    let index = JobIndex::build(&store, now).unwrap();
    let j001 = index.job("J001").unwrap();
    assert_eq!(
        j001.documents.len(),
        3,
        "creating J001 and three documents lists all three"
    );
    assert_eq!(j001.client.name, "Client A");
    assert_eq!(j001.budget_hours, Some(120.0));
    assert_eq!(index.job("J002").unwrap().documents.len(), 1);

    // linking a document of another client is refused
    let stray = document(
        dir.path(),
        "stray.clan",
        BRIEF_MAKER,
        "x",
        (other.id.as_str(), "Client B"),
        "J999",
    );
    assert_eq!(
        jobs::link_document(&store, &stray, "J001")
            .unwrap_err()
            .status,
        400
    );
    assert_eq!(
        jobs::link_document(&store, &stray, "J404")
            .unwrap_err()
            .status,
        404
    );

    // 2. The stage comes from the chain. A brief with nothing in it is still a client brief.
    assert_eq!(j001.stage.id, "client-brief");
    assert!(!j001.at_risk);
    let late =
        JobIndex::build(&store, Utc.with_ymd_and_hms(2026, 11, 21, 9, 0, 0).unwrap()).unwrap();
    assert!(late.job("J001").unwrap().at_risk, "past its deadline");

    let aoife = || at(dir.path(), &brief, "aoife@wk");
    let dara = || at(dir.path(), &brief, "dara@wk");
    let edit = json!({ "agent": "human", "action": "edit", "patch": ready() });
    assert_eq!(post(&aoife(), "/patch-data", edit), 200);
    let index = JobIndex::build(&store, now).unwrap();
    assert_eq!(
        index.job("J001").unwrap().stage.id,
        "brief-check",
        "passed the gate"
    );

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
        index
            .needs_for(None, &["account-service".to_string()])
            .len(),
        1,
        "account service is asked to get the client's answer"
    );
    assert_eq!(
        post(
            &dara(),
            "/client-review",
            json!({ "answer": "accepted", "client": { "name": "Client A contact" }, "channel": "none", "parts": [] })
        ),
        200
    );
    let index = JobIndex::build(&store, now).unwrap();
    assert_eq!(index.job("J001").unwrap().stage.id, "scope-estimate");
    assert!(index.needs.iter().all(|n| n.job != "J001"));

    // An edit after the signature is a changed brief: both signers are asked again.
    let edit = json!({ "agent": "human", "action": "edit", "patch": { "single_minded_proposition": "A new line." } });
    assert_eq!(post(&dara(), "/patch-data", edit), 200);
    let index = JobIndex::build(&store, now).unwrap();
    // each signer has the task, and (needs-you-full) the notice that the brief changed
    assert_eq!(
        people(&index, "aoife@wk"),
        vec!["Sign the changed brief", "Open the brief"]
    );
    assert_eq!(
        people(&index, "dara@wk"),
        vec!["Sign the changed brief", "Open the brief"]
    );
    assert!(matches!(index.needs[0].audience, Audience::Person(_)));

    // 5. Delete the index and rebuild it from the documents: the result is identical,
    // and an unchanged tenant does not rebuild.
    let cache = IndexCache::new();
    let live = cache.get(&store, now).unwrap();
    assert_eq!(cache.get(&store, now).unwrap(), live);
    assert_eq!(cache.builds(), 1);
    cache.delete();
    let rebuilt = cache.get(&store, now).unwrap();
    assert_eq!(
        rebuilt, live,
        "rebuilt from the documents, identical to the live index"
    );
    assert_eq!(cache.builds(), 2);
    assert_eq!(rebuilt, JobIndex::build(&store, now).unwrap());
    // a change to a document is a new index
    let edit = json!({ "agent": "human", "action": "edit", "patch": { "insight": "" } });
    assert_eq!(post(&dara(), "/patch-data", edit), 200);
    assert_ne!(cache.get(&store, now).unwrap(), live);

    // A rebuild after one document moved reads that document again, not every document: its cost grows with
    // what changed, not with how many documents the agency holds. Counted as reads of the store, against a
    // build from nothing, and the cached rebuild still equals that build.
    {
        let counted = Counted::new(&store);
        let cache = IndexCache::new();
        cache.get(&counted, now).unwrap();
        let edit =
            json!({ "agent": "human", "action": "edit", "patch": { "insight": "A third line." } });
        assert_eq!(post(&dara(), "/patch-data", edit), 200);
        let before = counted.reads();
        let moved = cache.get(&counted, now).unwrap();
        let cached = counted.reads() - before;
        let before = counted.reads();
        let fresh = JobIndex::build(&counted, now).unwrap();
        let full = counted.reads() - before;
        assert_eq!(
            moved, fresh,
            "the cached rebuild equals a build from the documents"
        );
        let documents = napkin_host::Library::documents(&store).len();
        assert!(documents > 3, "enough documents to tell the two apart");
        assert_eq!(
            full - cached,
            documents - 1,
            "the rebuild read one document again ({cached} reads), not all {documents} ({full} reads)"
        );
    }

    // The dashboard reads the same index: six tiles' worth of facts, no scores yet.
    let d = rebuilt.dashboard();
    assert_eq!(d.live_jobs, 2);
    assert_eq!(d.hours.budget, 120.0);
    assert!(d.scores.is_none() && d.results.is_none());

    // 6. The approval route (features/approval-route.clan): states, the holder and the reminders are
    // read from the chains and the clock, with nothing stored. J003 is a job with a route.
    {
        use napkin_host::jobs::RouteStep;
        let base = Utc::now();
        let day = |n: i64| {
            (base + chrono::Duration::days(n))
                .format("%Y-%m-%d")
                .to_string()
        };
        let at_day = |n: i64| {
            Utc.from_utc_datetime(
                &(base + chrono::Duration::days(n))
                    .date_naive()
                    .and_hms_opt(12, 0, 0)
                    .unwrap(),
            )
        };
        let step = |role: &str, who: &str, due: String| RouteStep {
            stage: "brief-check".into(),
            party: "agency".into(),
            role: Some(role.into()),
            approver: who.into(),
            contact: None,
            due,
            rounds: None,
        };
        let cian = ctx("cian@wk");
        let route_client = client.id.clone();
        jobs::create_job(
            &store,
            &me,
            NewJob {
                number: Some("J003".into()),
                client_id: route_client.clone(),
                title: Some("J003 brief".into()),
                owner: Some("aoife@wk".into()),
                opened_on: Some(day(0)),
                due: Some(day(30)),
                budget_hours: None,
            },
        )
        .unwrap();
        let b3 = document(
            dir.path(),
            "brief3.clan",
            BRIEF_MAKER,
            "J003 brief",
            (route_client.as_str(), "Client A"),
            "J003",
        );
        let by = |who: &str| at(dir.path(), &b3, who);
        assert_eq!(
            post(
                &by("aoife@wk"),
                "/patch-data",
                json!({ "agent": "human", "action": "edit", "patch": ready() })
            ),
            200
        );
        let (due_p, due_cd, due_client) = (day(1), day(2), day(6));
        jobs::set_route_at(
            &store,
            &cian,
            "J003",
            vec![
                step("planner", "aoife@wk", due_p.clone()),
                step("creative_director", "dara@wk", due_cd.clone()),
                RouteStep {
                    stage: "brief-check".into(),
                    party: "client".into(),
                    role: Some("client".into()),
                    approver: "Client A contact".into(),
                    contact: Some("contact@client-a.example".into()),
                    due: due_client,
                    rounds: Some(2),
                },
            ],
            base,
        )
        .unwrap();
        let kinds = |index: &JobIndex, who: &str| -> Vec<(&'static str, Option<i64>)> {
            index
                .needs_for(Some(who), &[])
                .into_iter()
                .filter(|n| n.job == "J003")
                .map(|n| (n.kind, n.days_late))
                .collect()
        };
        let build = |n: i64| JobIndex::build(&store, at_day(n)).unwrap();

        // the first step is held from the moment the route was set; nobody has approved yet
        let idx = build(0);
        let j = idx.job("J003").unwrap();
        let h = j.holder.clone().unwrap();
        assert_eq!(
            (
                h.party.as_str(),
                h.person.as_str(),
                h.role.as_deref(),
                h.stage.as_str()
            ),
            ("agency", "aoife@wk", Some("planner"), "brief-check")
        );
        assert_eq!((h.due.as_str(), h.days_late), (due_p.as_str(), 0));
        assert_eq!(h.since, jobs::route_history(&store).unwrap()["J003"].at);
        assert_eq!(
            j.route.iter().map(|s| s.state).collect::<Vec<_>>(),
            ["waiting", "not_started", "not_started"]
        );
        assert_eq!(j.waiting_on, "agency");
        assert_eq!(
            j.days_waiting_on_client, None,
            "absent while the agency holds the job"
        );

        // days late at -3, 0, 1 and 2 days around the planner's due date, and the reminder from 48 hours before
        let planner_day = |n: i64| build(1 + n);
        assert_eq!(
            planner_day(-3)
                .job("J003")
                .unwrap()
                .holder
                .as_ref()
                .unwrap()
                .days_late,
            0
        );
        assert_eq!(
            planner_day(0)
                .job("J003")
                .unwrap()
                .holder
                .as_ref()
                .unwrap()
                .days_late,
            0
        );
        assert_eq!(
            planner_day(1)
                .job("J003")
                .unwrap()
                .holder
                .as_ref()
                .unwrap()
                .days_late,
            1
        );
        assert_eq!(
            planner_day(2)
                .job("J003")
                .unwrap()
                .holder
                .as_ref()
                .unwrap()
                .days_late,
            2
        );
        assert_eq!(
            kinds(&planner_day(-3), "aoife@wk"),
            vec![("gate", None)],
            "three days ahead: nothing yet"
        );
        assert_eq!(
            kinds(&planner_day(-2), "aoife@wk"),
            vec![("approval", Some(0))],
            "from 48 hours before: one row, the approval's, for the gate's and the approval's"
        );
        // at one day late only the approver has the item; at two days late the person who set the route has one too
        assert_eq!(kinds(&planner_day(1), "cian@wk"), vec![]);
        assert_eq!(
            kinds(&planner_day(2), "cian@wk"),
            vec![("approval-chase", Some(2))]
        );
        let late = planner_day(2);
        let item = late
            .needs_for(Some("aoife@wk"), &[])
            .into_iter()
            .find(|n| n.kind == "approval")
            .unwrap();
        assert_eq!(
            (item.days_late, item.due.as_deref(), item.stage.as_str()),
            (Some(2), Some(due_p.as_str()), "brief-check")
        );
        assert_eq!(item.id, "J003:brief-check:planner:approval");
        assert!(item.text.contains("2 days late"), "{}", item.text);
        assert!(
            kinds(&late, "dara@wk")
                .iter()
                .all(|(k, _)| *k != "approval"),
            "not the creative director's yet"
        );
        let dash = late.dashboard();
        let line = dash.at_risk.iter().find(|l| l.number == "J003").unwrap();
        assert!(
            line.line.contains("Brief check") && line.line.contains("2 days late"),
            "{}",
            line.line
        );
        // nothing was written for any of that: the day alone made the item
        let cache = IndexCache::new();
        assert!(cache
            .get(&store, at_day(-3 + 1))
            .unwrap()
            .needs_for(Some("aoife@wk"), &[])
            .iter()
            .all(|n| n.kind != "approval"));
        assert!(cache
            .get(&store, at_day(-2 + 1))
            .unwrap()
            .needs_for(Some("aoife@wk"), &[])
            .iter()
            .any(|n| n.kind == "approval"));

        // the planner signs: the holder moves to the creative director and `since` is the signature's own time
        assert_eq!(post(&by("aoife@wk"), "/sign", json!({})), 200);
        let chain_of = |id: &DocId| {
            let clan = ClanFile::from_bytes(std::fs::read(id.as_str()).unwrap()).unwrap();
            clan_sdk::DecisionChain::from_yaml(
                &clan.read_entry("agent/decision-chain.yaml").unwrap(),
            )
            .unwrap()
        };
        let signed = chain_of(&b3)
            .decisions
            .iter()
            .find(|d| d.kind.as_deref() == Some("sign"))
            .unwrap()
            .clone();
        let sign_at = DateTime::parse_from_rfc3339(&signed.timestamp)
            .unwrap()
            .with_timezone(&Utc);
        let idx = JobIndex::build(&store, sign_at + chrono::Duration::days(2)).unwrap();
        let j = idx.job("J003").unwrap();
        let h = j.holder.clone().unwrap();
        assert_eq!(
            (h.person.as_str(), h.role.as_deref()),
            ("dara@wk", Some("creative_director"))
        );
        assert_eq!((h.since.as_str(), h.days), (signed.timestamp.as_str(), 2));
        assert_eq!(j.route[0].state, "approved");
        assert_eq!(
            (
                j.route[0].approved_by.as_deref(),
                j.route[0].version.as_deref()
            ),
            (Some("aoife@wk"), signed.version.as_deref())
        );

        // the creative director's lock approves the next step: who and which exact version, read from the file
        assert_eq!(post(&by("dara@wk"), "/sign", json!({})), 200);
        let lock = chain_of(&b3)
            .decisions
            .iter()
            .find(|d| d.kind.as_deref() == Some("approve"))
            .unwrap()
            .clone();
        let lock_at = DateTime::parse_from_rfc3339(&lock.timestamp)
            .unwrap()
            .with_timezone(&Utc);
        let idx = JobIndex::build(&store, lock_at + chrono::Duration::days(3)).unwrap();
        let j = idx.job("J003").unwrap();
        assert_eq!(j.route[1].state, "approved");
        assert_eq!(
            (
                j.route[1].approved_by.as_deref(),
                j.route[1].version.as_deref(),
                j.route[1].approved_at.as_deref()
            ),
            (
                Some("dara@wk"),
                lock.version.as_deref(),
                Some(lock.timestamp.as_str())
            )
        );
        // the job now waits on the client, counted from the agency's last approval before it
        let h = j.holder.clone().unwrap();
        assert_eq!(
            (h.party.as_str(), h.since.as_str()),
            ("client", lock.timestamp.as_str())
        );
        assert_eq!(
            (j.waiting_on, j.days_waiting_on_client),
            ("client", Some(3))
        );
        assert!(
            kinds(&idx, "dara@wk").iter().all(|(k, _)| *k != "approval"),
            "a client step is not anyone's item"
        );

        // unlocking the brief returns the step to waiting
        assert_eq!(
            post(
                &by("dara@wk"),
                "/unapprove",
                json!({ "rationale": "Reopened to change the proposition." })
            ),
            200
        );
        let idx = JobIndex::build(&store, lock_at + chrono::Duration::days(3)).unwrap();
        let j = idx.job("J003").unwrap();
        assert_eq!(j.route[1].state, "waiting");
        assert_eq!(j.holder.as_ref().unwrap().person, "dara@wk");
        assert_eq!(j.route[1].approved_by, None);
        assert_eq!(j.days_waiting_on_client, None, "the agency holds it again");

        // locked again, and the client accepts: nothing is left to hold
        assert_eq!(post(&by("dara@wk"), "/sign", json!({})), 200);
        assert_eq!(
            post(
                &by("dara@wk"),
                "/client-review",
                json!({ "answer": "accepted", "client": { "name": "Client A contact" }, "channel": "none", "parts": [] })
            ),
            200
        );
        let idx = JobIndex::build(&store, Utc::now() + chrono::Duration::days(1)).unwrap();
        let j = idx.job("J003").unwrap();
        assert!(
            j.route.iter().all(|s| s.state == "approved"),
            "{:?}",
            j.route
        );
        assert_eq!(j.route[2].approved_by.as_deref(), Some("Client A contact"));
        assert!(j.holder.is_none());
        assert!(
            idx.needs
                .iter()
                .all(|n| n.job != "J003" || n.kind == "gate"),
            "the approval items left with the approvals"
        );

        // a job with no route is what it was; a rebuilt index equals the live one
        assert!(
            idx.job("J001").unwrap().route.is_empty() && idx.job("J001").unwrap().holder.is_none()
        );
        let live = cache.get(&store, at_day(0)).unwrap();
        cache.delete();
        assert_eq!(cache.get(&store, at_day(0)).unwrap(), live);

        // nothing here scores a person: no total, average or ordering by person in what the index says
        let wire = serde_json::to_string(&live).unwrap()
            + &serde_json::to_string(&live.dashboard()).unwrap();
        for key in [
            "per_person",
            "by_person",
            "average_days",
            "average",
            "total_days",
        ] {
            assert!(!wire.contains(key), "{key} in {wire}");
        }
    }
    std::env::remove_var("NAPKIN_BRIEF_GATE");
}

/// A store that counts its reads, for the cost of a rebuild. `version` is the inner store's, uncounted, so
/// only the reads a build makes are counted.
struct Counted<'a> {
    inner: &'a FsStore,
    reads: std::sync::atomic::AtomicUsize,
}

impl<'a> Counted<'a> {
    fn new(inner: &'a FsStore) -> Self {
        Self {
            inner,
            reads: Default::default(),
        }
    }
    fn reads(&self) -> usize {
        self.reads.load(std::sync::atomic::Ordering::Relaxed)
    }
}

impl napkin_host::PartStore for Counted<'_> {
    fn read(&self, id: &DocId) -> napkin_host::HostResult<Vec<u8>> {
        self.reads
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        napkin_host::PartStore::read(self.inner, id)
    }
    fn exists(&self, id: &DocId) -> bool {
        napkin_host::PartStore::exists(self.inner, id)
    }
    fn version(&self, id: &DocId) -> napkin_host::HostResult<napkin_host::Version> {
        napkin_host::PartStore::version(self.inner, id)
    }
    fn apply(&self, change: &napkin_host::Change) -> napkin_host::HostResult<napkin_host::Version> {
        napkin_host::PartStore::apply(self.inner, change)
    }
}

impl napkin_host::Library for Counted<'_> {
    fn app_candidates(&self) -> Vec<DocId> {
        napkin_host::Library::app_candidates(self.inner)
    }
    fn app_template(&self, app_id: &str) -> DocId {
        napkin_host::Library::app_template(self.inner, app_id)
    }
    fn documents(&self) -> Vec<DocId> {
        napkin_host::Library::documents(self.inner)
    }
    fn new_document(&self, app_id: &str, id_short: &str) -> napkin_host::HostResult<DocId> {
        napkin_host::Library::new_document(self.inner, app_id, id_short)
    }
    fn home(&self, version_tag: &str) -> napkin_host::HostResult<DocId> {
        napkin_host::Library::home(self.inner, version_tag)
    }
    fn fork_branch(&self, parent: &DocId, agent: &str) -> DocId {
        napkin_host::Library::fork_branch(self.inner, parent, agent)
    }
}
