//! Needs you in full (features/needs-you-full.clan): the alerts table's live rules over real documents,
//! stable ids, the on-the-job filter and the orphan rule, deadlines in order, the allow list, and the
//! rebuild-equals-live rule. One test function, because the gate reads the environment.

use std::sync::Arc;

use chrono::{TimeZone, Utc};
use clan_sdk::{ClanBuilder, ClanFile};
use napkin_host::jobindex::{Audience, IndexCache, JobIndex, Need};
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

fn roles(r: &[&str]) -> Vec<String> {
    r.iter().map(|s| s.to_string()).collect()
}

fn kinds(index: &JobIndex, who: &str, rs: &[&str], job: &str) -> Vec<&'static str> {
    index
        .needs_for(Some(who), &roles(rs))
        .into_iter()
        .filter(|n| n.job == job)
        .map(|n| n.kind)
        .collect()
}

fn find<'a>(index: &'a JobIndex, job: &str, kind: &str) -> &'a Need {
    index
        .needs
        .iter()
        .find(|n| n.job == job && n.kind == kind)
        .unwrap_or_else(|| panic!("no {kind} on {job}: {:?}", index.needs))
}

const MARK_BRIEF: &str = "MARK-BRIEF-9f2c";
const MARK_CLIENT: &str = "MARK-CLIENT-7d1e";

#[test]
fn the_alerts_table_makes_its_needs_for_the_right_people_and_nobody_else() {
    std::env::set_var("NAPKIN_BRIEF_GATE", "on");
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let me = ctx("niamh@wk");
    let client = clients::create_client(&store, &me, "Client A", None).unwrap();
    let c = (client.id.as_str(), "Client A");
    let now = Utc.with_ymd_and_hms(2026, 11, 12, 10, 0, 0).unwrap();
    // three jobs: a deadline in 40 days, one in 2 days, one with none
    let open = |number: &str, owner: &str, due: Option<&str>| {
        jobs::create_job(
            &store,
            &me,
            NewJob {
                number: Some(number.into()),
                client_id: client.id.clone(),
                title: Some(format!("{number} brief")),
                owner: Some(owner.into()),
                opened_on: Some("2026-11-02".into()),
                due: due.map(str::to_string),
                budget_hours: None,
            },
        )
        .unwrap();
    };
    open("J001", "aoife@wk", Some("2026-12-22"));
    open("J002", "tom@wk", Some("2026-11-14"));
    open("J003", "tom@wk", None);
    let mut data = ready();
    data["insight"] = json!(format!(
        "Younger drinkers think Irish whiskey is for someone else {MARK_BRIEF}."
    ));
    let brief = document(dir.path(), "b1.clan", BRIEF_MAKER, "J001 brief", c, "J001");
    document(dir.path(), "b2.clan", BRIEF_MAKER, "J002 brief", c, "J002");
    document(dir.path(), "b3.clan", BRIEF_MAKER, "J003 brief", c, "J003");
    let aoife = || at(dir.path(), &brief, "aoife@wk");
    let dara = || at(dir.path(), &brief, "dara@wk");
    let edit = |text: &str| json!({ "agent": "human", "action": "edit", "patch": { "single_minded_proposition": text } });
    assert_eq!(
        post(
            &aoife(),
            "/patch-data",
            json!({ "agent": "human", "action": "edit", "patch": data })
        ),
        200
    );

    // The deadline notice: J002 is due in two days, for its owner alone; the clock is the index's own.
    let index = JobIndex::build(&store, now).unwrap();
    let d = find(&index, "J002", "deadline");
    assert_eq!(d.audience, Audience::Person("tom@wk".into()));
    assert!(d.urgent && d.can_done && d.due_source == "job");
    assert_eq!(d.due.as_deref(), Some("2026-11-14"));
    assert!(
        index
            .needs
            .iter()
            .all(|n| n.job != "J001" || n.kind != "deadline"),
        "40 days off"
    );
    // the clock moved across the line: J001 is inside 48 hours on 20 Dec, and not on 19 Dec
    let near = |day: u32| {
        JobIndex::build(
            &store,
            Utc.with_ymd_and_hms(2026, 12, day, 9, 0, 0).unwrap(),
        )
        .unwrap()
    };
    assert!(near(19)
        .needs
        .iter()
        .all(|n| !(n.job == "J001" && n.kind == "deadline")));
    assert!(near(20)
        .needs
        .iter()
        .any(|n| n.job == "J001" && n.kind == "deadline"));

    // Ordered by each item's own deadline, soonest first, none last; ties by job and text.
    let all = index.needs_for(None, &[]);
    let order: Vec<(&str, Option<&str>)> = all
        .iter()
        .map(|n| (n.job.as_str(), n.due.as_deref()))
        .collect();
    let mut sorted = order.clone();
    sorted.sort_by_key(|(j, d)| (d.is_none(), *d, *j));
    assert_eq!(
        order.iter().map(|o| o.1).collect::<Vec<_>>(),
        sorted.iter().map(|o| o.1).collect::<Vec<_>>()
    );
    assert_eq!(order.first().map(|o| o.0), Some("J002"));
    assert_eq!(
        order.last().map(|o| o.1),
        Some(None),
        "a job with no deadline is last"
    );

    // Sign and lock, then the client asks for changes: account service has the notice, with no words of the client's in it.
    assert_eq!(post(&aoife(), "/sign", json!({})), 200);
    assert_eq!(post(&dara(), "/sign", json!({})), 200);
    assert_eq!(
        post(
            &dara(),
            "/client-review",
            json!({
                "answer": "accepted_with_changes",
                "client": { "name": "Client A contact" },
                "channel": "call",
                "parts": [],
                "said": MARK_CLIENT,
            })
        ),
        200
    );
    let index = JobIndex::build(&store, now).unwrap();
    let change = find(&index, "J001", "client-change").clone();
    assert_eq!(change.audience, Audience::Role("account-service"));
    assert!(change.can_done && !change.urgent);
    // the orphan rule: nobody on J001 is known to hold account service, so every account service person has it
    assert!(kinds(&index, "cian@wk", &["account-service"], "J001").contains(&"client-change"));
    // with the directory saying aoife (on the job) is account service, the job's own account service has it and cian does not
    let covered = |p: &str| {
        if p == "aoife@wk" {
            roles(&["account-service"])
        } else {
            vec![]
        }
    };
    let for_cian = index.needs_visible(Some("cian@wk"), &roles(&["account-service"]), &covered);
    assert!(for_cian.iter().all(|n| n.job != "J001"), "{for_cian:?}");
    let for_aoife = index.needs_visible(Some("aoife@wk"), &roles(&["account-service"]), &covered);
    assert!(for_aoife.iter().any(|n| n.kind == "client-change"));
    // a copywriter, a planner who is not on the job, and a creative director who is not on it see nothing of it
    assert!(kinds(&index, "maeve@wk", &["copywriter"], "J001").is_empty());
    assert!(kinds(&index, "tom@wk", &["planning"], "J001").is_empty());
    // the same notice, again and again, keeps its id; a second answer is a new notice
    let again = JobIndex::build(&store, now).unwrap();
    assert_eq!(find(&again, "J001", "client-change").id, change.id);

    // An edit after the signature: the brief-changed notice is for everyone on the job, and only for them.
    assert_eq!(
        post(
            &dara(),
            "/patch-data",
            edit(&format!("A new line. {MARK_BRIEF}"))
        ),
        200
    );
    let index = JobIndex::build(&store, now).unwrap();
    let changed = find(&index, "J001", "brief-changed").clone();
    assert_eq!(changed.audience, Audience::Job);
    assert!(changed
        .id
        .starts_with("J001:brief-check:everyone:brief-changed:"));
    for who in ["aoife@wk", "dara@wk"] {
        assert!(
            kinds(&index, who, &["planning"], "J001").contains(&"brief-changed"),
            "{who}"
        );
    }
    assert!(!kinds(&index, "maeve@wk", &["copywriter"], "J001").contains(&"brief-changed"));
    assert!(!kinds(&index, "tom@wk", &["planning"], "J001").contains(&"brief-changed"));
    // still the same notice on a rebuild, and a new one when the brief is edited again
    assert_eq!(
        find(
            &JobIndex::build(&store, now).unwrap(),
            "J001",
            "brief-changed"
        )
        .id,
        changed.id
    );
    assert_eq!(post(&dara(), "/patch-data", edit("A third line.")), 200);
    let third = JobIndex::build(&store, now).unwrap();
    assert_ne!(find(&third, "J001", "brief-changed").id, changed.id);
    // the tasks to sign are not notices
    for n in third.needs.iter().filter(|n| n.kind == "gate") {
        assert!(!n.can_done, "a task has no Done: {}", n.id);
    }

    // The allow list: no need, for anyone, holds a word of the brief, the client's answer or a call.
    let wire = serde_json::to_string(&third.needs).unwrap();
    let wire = format!("{wire}{}", serde_json::to_string(&index.needs).unwrap());
    for marker in [MARK_BRIEF, MARK_CLIENT, "A new line", "A third line"] {
        assert!(!wire.contains(marker), "a need quotes a document: {marker}");
    }

    // Rebuild equals live: delete it and it comes back identical, needs included.
    let cache = IndexCache::new();
    let live = cache.get(&store, now).unwrap();
    cache.delete();
    assert_eq!(cache.get(&store, now).unwrap(), live);
    assert_eq!(live, JobIndex::build(&store, now).unwrap());

    // The on-the-job filter: a person sees the jobs they are on and no others.
    assert!(live.is_on("J001", "aoife@wk") && live.is_on("J001", "dara@wk"));
    assert!(!live.is_on("J001", "tom@wk") && live.is_on("J002", "tom@wk"));
    let tom: Vec<_> = live
        .needs_for(Some("tom@wk"), &roles(&["planning"]))
        .into_iter()
        .map(|n| n.job)
        .collect();
    assert!(tom.iter().all(|j| j != "J001"), "{tom:?}");
    // the next deadline is on the person's own jobs
    let today = now.date_naive();
    assert_eq!(
        live.next_deadline(Some("aoife@wk"), &roles(&["planning"]), today)
            .unwrap()
            .job,
        "J001"
    );
    assert_eq!(
        live.next_deadline(Some("tom@wk"), &roles(&["planning"]), today)
            .unwrap()
            .job,
        "J002"
    );
    assert!(live
        .next_deadline(Some("maeve@wk"), &roles(&["copywriter"]), today)
        .is_none());
    // an admin and a person with no role see every item, as before
    assert_eq!(
        live.needs_for(Some("ann@napkin"), &roles(&["admin"])).len(),
        live.needs.len()
    );
    assert_eq!(live.needs_for(None, &[]).len(), live.needs.len());
}

/// The same rules over a job with a route of three stage owners and deadlines: the stage's date beats the
/// job's, and the approver on the brief-check stage sees one row, not two.
#[test]
fn with_a_route_a_stage_deadline_orders_the_item_and_the_gate_and_the_approval_are_one_row() {
    std::env::set_var("NAPKIN_BRIEF_GATE", "on");
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let me = ctx("niamh@wk");
    let client = clients::create_client(&store, &me, "Client A", None).unwrap();
    let c = (client.id.as_str(), "Client A");
    let now = Utc.with_ymd_and_hms(2026, 11, 12, 10, 0, 0).unwrap();
    jobs::create_job(
        &store,
        &me,
        NewJob {
            number: Some("J001".into()),
            client_id: client.id.clone(),
            title: Some("J001 brief".into()),
            owner: Some("aoife@wk".into()),
            opened_on: Some("2026-11-02".into()),
            due: Some("2026-12-22".into()),
            budget_hours: None,
        },
    )
    .unwrap();
    let brief = document(dir.path(), "b1.clan", BRIEF_MAKER, "J001 brief", c, "J001");
    let aoife = at(dir.path(), &brief, "aoife@wk");
    assert_eq!(
        post(
            &aoife,
            "/patch-data",
            json!({ "agent": "human", "action": "edit", "patch": ready() })
        ),
        200
    );
    let step = |stage: &str, role: &str, who: &str, due: &str| jobs::RouteStep {
        stage: stage.into(),
        party: "agency".into(),
        role: Some(role.into()),
        approver: who.into(),
        contact: None,
        due: due.into(),
        rounds: None,
    };
    jobs::set_route_at(
        &store,
        &ctx("cian@wk"),
        "J001",
        vec![
            step("brief-check", "planner", "aoife@wk", "2026-11-14"),
            step("brief-check", "creative_director", "dara@wk", "2026-11-18"),
            step("decks", "planner", "tom@wk", "2026-12-01"),
        ],
        now,
    )
    .unwrap();
    let index = JobIndex::build(&store, now).unwrap();
    let mine = index.needs_for(Some("aoife@wk"), &roles(&["planning"]));
    assert_eq!(
        mine.len(),
        1,
        "the gate's row and the approval's are one: {mine:?}"
    );
    assert_eq!(mine[0].kind, "approval");
    assert_eq!(
        (mine[0].due.as_deref(), mine[0].due_source),
        (Some("2026-11-14"), "stage")
    );
    assert!(mine[0].urgent && !mine[0].can_done);
    // before the 48 hours the gate row stands alone, with the stage's date, not the job's
    let early = JobIndex::build(&store, now - chrono::Duration::days(3)).unwrap();
    let g = early.needs_for(Some("aoife@wk"), &roles(&["planning"]));
    assert_eq!((g.len(), g[0].kind), (1, "gate"));
    assert_eq!(
        (g[0].due.as_deref(), g[0].due_source),
        (Some("2026-11-14"), "stage")
    );
    // the people on the job include the route's approvers
    assert!(index.is_on("J001", "tom@wk") && index.is_on("J001", "dara@wk"));
}
