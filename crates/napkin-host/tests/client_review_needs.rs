//! A client's comment or request for changes, through the review link, is account service's need
//! (features/client-review-full.clan with features/needs-you-full.clan): the job, the piece and that a
//! client commented, and never the comment's words. One test function, because the gate reads the environment.

use std::sync::Arc;

use chrono::{TimeZone, Utc};
use clan_sdk::{ClanBuilder, ClanFile};
use napkin_host::jobindex::{Audience, IndexCache, JobIndex, Need};
use napkin_host::jobs::{self, NewJob};
use napkin_host::{
    clients, dispatch, handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session,
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

const A: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const B: &str = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
const MARK: &str = "MARK-COMMENT-5e3a";

fn as_client(s: &Session, email: &str, path: &str, body: Value) -> (u16, Value) {
    let r = dispatch(
        &Ctx::new(Actor::client(email).unwrap()),
        s,
        &NoConfig,
        HostRequest::new(path, "", body.to_string().into_bytes()),
    );
    (
        r.status,
        serde_json::from_slice(&r.body).unwrap_or(Value::Null),
    )
}

fn changes(index: &JobIndex) -> Vec<Need> {
    index
        .needs
        .iter()
        .filter(|n| n.job == "J001" && n.kind == "client-change")
        .cloned()
        .collect()
}

#[test]
fn a_comment_or_a_request_for_changes_through_the_review_link_is_account_services_need() {
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
    let aoife = || at(dir.path(), &brief, "aoife@wk");
    let dara = || at(dir.path(), &brief, "dara@wk");
    assert_eq!(
        post(
            &aoife(),
            "/patch-data",
            json!({ "agent": "human", "action": "edit", "patch": ready() })
        ),
        200
    );
    assert_eq!(post(&aoife(), "/sign", json!({})), 200);
    assert_eq!(post(&dara(), "/sign", json!({})), 200);
    let s = aoife();
    let issued = dispatch(
        &ctx("aoife@wk"),
        &s,
        &NoConfig,
        HostRequest::new(
            "/client-link/issue-round",
            "",
            json!({ "review": "cccccccccccccccccccccccccccccccc", "expires": (now + chrono::Duration::days(20)).format("%Y-%m-%dT%H:%M:%SZ").to_string(),
                    "reviewers": [
                        { "id": A, "name": "Alex", "email": "approver@client-a.example", "approver": true },
                        { "id": B, "name": "Bea", "email": "second@client-a.example" },
                    ] })
            .to_string()
            .into_bytes(),
        ),
    );
    assert_eq!(
        issued.status,
        200,
        "{}",
        String::from_utf8_lossy(&issued.body)
    );
    assert!(
        changes(&JobIndex::build(&store, now).unwrap()).is_empty(),
        "nothing yet"
    );

    // a reviewer comments: the notice, for account service, with none of the words
    let (st, v) = as_client(
        &s,
        "second@client-a.example",
        "/client-link/comment",
        json!({ "id": B, "piece": 1, "tag": "preference", "text": MARK }),
    );
    assert_eq!(st, 200, "{v}");
    let index = JobIndex::build(&store, now).unwrap();
    let first = changes(&index);
    assert_eq!(first.len(), 1, "{:?}", index.needs);
    assert_eq!(first[0].audience, Audience::Role("account-service"));
    assert!(first[0].can_done && !first[0].urgent);
    assert!(first[0].text.contains("commented"), "{}", first[0].text);
    // the same comment, the same notice
    assert_eq!(
        changes(&JobIndex::build(&store, now).unwrap())[0].id,
        first[0].id
    );

    // a second comment is a new notice
    let (st, _) = as_client(
        &s,
        "second@client-a.example",
        "/client-link/comment",
        json!({ "id": B, "piece": 1, "tag": "preference", "text": "another" }),
    );
    assert_eq!(st, 200);
    let second = changes(&JobIndex::build(&store, now).unwrap());
    assert_eq!(second.len(), 1);
    assert_ne!(second[0].id, first[0].id);

    // the approver asks for changes: the notice reads as a request for changes
    let (st, v) = as_client(
        &s,
        "approver@client-a.example",
        "/client-link/answer",
        json!({ "id": A, "answer": "changes", "said": MARK }),
    );
    assert_eq!(st, 200, "{v}");
    let after = JobIndex::build(&store, now).unwrap();
    let asked = changes(&after);
    assert_eq!(
        asked.len(),
        1,
        "one item, not a comment and a request: {asked:?}"
    );
    assert!(
        asked[0].text.contains("the client has asked for changes"),
        "{}",
        asked[0].text
    );

    // no need holds the client's words
    let wire = serde_json::to_string(&after.needs).unwrap();
    assert!(!wire.contains(MARK) && !wire.contains("another"), "{wire}");
}
