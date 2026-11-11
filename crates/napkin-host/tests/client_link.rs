// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The client's own link (features/client-confirm-link.clan): made for one
//! locked version by an agency person, answered once by the client as
//! `client:<email>`, and dead when it is wrong, expired, withdrawn, used, or
//! the brief has moved on. A client's context reaches two routes and no more.

use std::sync::Arc;

use clan_sdk::{ClanFile, DecisionChain};
use napkin_host::ops::decisions::decisions;
use napkin_host::{dispatch, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

const ID: &str = "0123456789abcdef0123456789abcdef";
const ID2: &str = "fedcba9876543210fedcba9876543210";
const EMAIL: &str = "pat@client-a.example";

struct Fixture {
    _dir: tempfile::TempDir,
    session: Session,
    id: DocId,
}

fn staff() -> Ctx {
    Ctx::new(Actor::human("aoife").unwrap())
}

fn client(email: &str) -> Ctx {
    Ctx::new(Actor::client(email).unwrap())
}

fn in_days(n: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::days(n))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

/// A new document the Brief gate reads: a Brief Maker brief.
fn open() -> Fixture {
    open_as(true)
}

fn open_as(brief: bool) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("brief.clan"));
    let plain = clan_sdk::create(clan_sdk::CreateOptions {
        title: "Brief".into(),
        brief: "a brief".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    let bytes = if brief {
        let base = ClanFile::from_bytes(plain).unwrap();
        let mut m = base.manifest().clone();
        m.app = Some(clan_sdk::AppInfo {
            home: None,
            name: "Brief Maker".into(),
            app_id: "ie.napkin.brief-maker".into(),
            version: "1.0.0".into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: None,
            prompt_templates: vec![],
            data_seed: None,
            spinoff: None,
            attach: None,
        });
        let mut b = clan_sdk::ClanBuilder::new(m);
        for (path, bytes) in base.read_all_entries().unwrap() {
            if path != clan_sdk::MANIFEST_PATH {
                b.add_entry(path, bytes);
            }
        }
        b.build().unwrap()
    } else {
        plain
    };
    std::fs::write(id.as_str(), bytes).unwrap();
    let session = Session::with_ctx(Arc::new(FsStore::new(dir.path().to_path_buf())), staff());
    session.open(id.clone()).unwrap();
    let f = Fixture {
        _dir: dir,
        session,
        id,
    };
    f.call(
        &staff(),
        "/patch-data",
        json!({ "agent": "human", "action": "edit", "patch": {
        "single_minded_proposition": "Summer tastes better without the hangover.",
        "tone": "Warm, dry, a little wry",
    } }),
    );
    f
}

impl Fixture {
    fn call(&self, ctx: &Ctx, path: &str, body: Value) -> (u16, Value) {
        let r = dispatch(
            ctx,
            &self.session,
            &NoConfig,
            HostRequest::new(path, "", body.to_string().into_bytes()),
        );
        (
            r.status,
            serde_json::from_slice(&r.body).unwrap_or(Value::Null),
        )
    }

    fn locked() -> Fixture {
        let f = open();
        assert_eq!(f.call(&staff(), "/approve", json!({})).0, 200);
        f
    }

    fn issue(&self, id: &str, expires: &str) -> (u16, Value) {
        self.call(
            &staff(),
            "/client-link/issue",
            json!({ "id": id, "name": "Pat", "email": EMAIL, "expires": expires }),
        )
    }

    fn answer(&self, id: &str, answer: &str, said: Option<&str>) -> (u16, Value) {
        let mut b = json!({ "id": id, "answer": answer });
        if let Some(s) = said {
            b["said"] = json!(s);
        }
        self.call(&client(EMAIL), "/client-link/answer", b)
    }

    fn state(&self, id: &str) -> (u16, String) {
        let (s, v) = self.call(&client(EMAIL), "/client-link/state", json!({ "id": id }));
        (s, v["state"].as_str().unwrap_or("").to_string())
    }

    fn chain(&self) -> DecisionChain {
        let clan = ClanFile::open(self.id.as_str()).unwrap();
        DecisionChain::from_yaml(&clan.read_entry("agent/decision-chain.yaml").unwrap()).unwrap()
    }

    /// The brief's content hash (canonical, so a rewrite of the same words does not move it).
    fn data(&self) -> String {
        napkin_host::ops::client_link::content_hash(&ClanFile::open(self.id.as_str()).unwrap())
            .unwrap()
    }

    fn answers(&self) -> Vec<clan_sdk::Decision> {
        self.chain()
            .decisions
            .into_iter()
            .filter(|d| d.kind.as_deref() == Some("client_review") && d.action == "client_answer")
            .collect()
    }
}

#[test]
fn a_link_is_only_for_a_brief_the_gate_reads() {
    // a locked document that is not a Brief Maker brief is refused, and nothing is written
    let f = open_as(false);
    assert_eq!(f.call(&staff(), "/approve", json!({})).0, 200);
    let before = std::fs::read(f.id.as_str()).unwrap();
    let (s, v) = f.issue(ID, &in_days(30));
    assert_eq!(s, 400, "{v}");
    assert!(v["error"].as_str().unwrap().contains("brief"), "{v}");
    assert_eq!(std::fs::read(f.id.as_str()).unwrap(), before);
}

#[test]
fn a_link_is_to_a_locked_version_and_names_its_hash() {
    let f = open();
    // unlocked: refused, and nothing is written
    let before = std::fs::read(f.id.as_str()).unwrap();
    assert_eq!(f.issue(ID, &in_days(30)).0, 409);
    assert_eq!(std::fs::read(f.id.as_str()).unwrap(), before);

    f.call(&staff(), "/approve", json!({}));
    let (s, v) = f.issue(ID, &in_days(30));
    assert_eq!(s, 200, "{v}");
    let lock = f
        .chain()
        .decisions
        .iter()
        .find(|d| d.kind.as_deref() == Some("approve"))
        .cloned()
        .unwrap();
    assert_eq!(v["lock"], json!(lock.id));
    assert_eq!(v["version"], json!(lock.version));
    assert_eq!(v["doc_hash"], json!(f.data()));
    assert_eq!(v["scope"], "confirm");
    assert_eq!(f.state(ID), (200, "open".into()));
}

#[test]
fn writing_other_records_does_not_move_a_links_version() {
    // every decision written re-serialises the data: the link names the content, not those bytes
    let f = Fixture::locked();
    assert_eq!(f.issue(ID, &in_days(30)).0, 200);
    assert_eq!(f.issue(ID2, &in_days(30)).0, 200);
    assert_eq!(
        f.call(&staff(), "/client-link/withdraw", json!({ "id": ID2 }))
            .0,
        200
    );
    assert_eq!(f.state(ID), (200, "open".into()));
}

#[test]
fn a_link_to_an_older_version_is_refused_and_a_moved_on_link_is_dead() {
    let f = Fixture::locked();
    assert_eq!(f.issue(ID, &in_days(30)).0, 200);
    // the brief is edited after the lock: no new link to it ...
    f.call(
        &staff(),
        "/patch-data",
        json!({ "agent": "human", "action": "edit", "patch": { "tone": "Louder" } }),
    );
    assert_eq!(
        f.issue(ID2, &in_days(30)).0,
        409,
        "a link is to the version that was signed"
    );
    // ... and the one already out is for a version that is no longer the brief
    assert_eq!(f.state(ID), (410, "superseded".into()));
    assert_eq!(f.answer(ID, "confirm", None).0, 410);
    assert!(f.answers().is_empty());
}

#[test]
fn the_client_confirms_once_as_themselves_on_that_exact_version() {
    let f = Fixture::locked();
    f.issue(ID, &in_days(30));
    let lock = f
        .chain()
        .decisions
        .iter()
        .find(|d| d.kind.as_deref() == Some("approve"))
        .cloned()
        .unwrap();
    let data = f.data();
    let (s, v) = f.answer(ID, "confirm", None);
    assert_eq!(s, 200, "{v}");
    let a = f.answers();
    assert_eq!(a.len(), 1);
    assert_eq!(
        a[0].actor.as_deref(),
        Some(format!("client:{EMAIL}").as_str())
    );
    assert_eq!(a[0].version, lock.version, "that exact version");
    assert_eq!(
        a[0].extra.get("answer").and_then(|x| x.as_str()),
        Some("accepted")
    );
    assert_eq!(f.data(), data, "an answer edits nothing");
    // the Brief gate reads it like any client confirmation
    let view = f.session.read(decisions).unwrap();
    let ans = view
        .client
        .answer
        .expect("the answer is in the decision view");
    assert!(ans.current && ans.answer == "accepted");
    let gate = f
        .session
        .read(|d| napkin_host::ops::gate::view(d, &decisions(d)?))
        .unwrap();
    assert!(gate.confirmed);
}

#[test]
fn asking_for_changes_never_unlocks_or_edits() {
    let f = Fixture::locked();
    f.issue(ID, &in_days(30));
    let data = f.data();
    // words are needed to ask for a change
    assert_eq!(f.answer(ID, "changes", None).0, 400);
    let (s, v) = f.answer(ID, "changes", Some("The tone is too wry for us."));
    assert_eq!(s, 200, "{v}");
    assert_eq!(f.data(), data, "the content hash is unchanged");
    let chain = f.chain();
    assert!(
        chain
            .decisions
            .iter()
            .any(|d| d.kind.as_deref() == Some("approve") && d.superseded_by.is_none()),
        "still locked"
    );
    assert!(!chain
        .decisions
        .iter()
        .any(|d| d.kind.as_deref() == Some("unlock")));
    let gate = f
        .session
        .read(|d| napkin_host::ops::gate::view(d, &decisions(d)?))
        .unwrap();
    assert!(!gate.confirmed, "asking for changes does not confirm");
    assert!(gate.signed);
}

#[test]
fn a_wrong_link_is_not_found_and_writes_nothing() {
    let f = Fixture::locked();
    f.issue(ID, &in_days(30));
    let before = std::fs::read(f.id.as_str()).unwrap();
    assert_eq!(f.state(ID2), (404, "unknown".into()));
    assert_eq!(f.answer(ID2, "confirm", None).0, 404);
    assert_eq!(
        f.call(
            &client(EMAIL),
            "/client-link/answer",
            json!({ "id": "not-an-id", "answer": "confirm" })
        )
        .0,
        400
    );
    // someone else's email on the right link
    let other = f.call(
        &client("sam@elsewhere.example"),
        "/client-link/answer",
        json!({ "id": ID, "answer": "confirm" }),
    );
    assert_eq!(other.0, 403);
    assert_eq!(std::fs::read(f.id.as_str()).unwrap(), before);
}

#[test]
fn an_expired_link_is_gone() {
    let f = Fixture::locked();
    let soon = (chrono::Utc::now() + chrono::Duration::seconds(2))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    assert_eq!(f.issue(ID, &soon).0, 200);
    assert_eq!(f.state(ID).1, "open");
    std::thread::sleep(std::time::Duration::from_millis(3200));
    assert_eq!(f.state(ID), (410, "expired".into()));
    assert_eq!(f.answer(ID, "confirm", None).0, 410);
    assert!(f.answers().is_empty());
}

#[test]
fn a_link_lasts_at_most_thirty_days_and_not_into_the_past() {
    let f = Fixture::locked();
    assert_eq!(f.issue(ID, &in_days(31)).0, 400);
    assert_eq!(f.issue(ID, &in_days(-1)).0, 400);
    assert_eq!(f.issue(ID, "next week").0, 400);
    assert_eq!(f.issue(ID, &in_days(30)).0, 200);
    assert_eq!(f.issue(ID, &in_days(30)).0, 409, "a link id is used once");
}

#[test]
fn a_withdrawn_link_is_gone() {
    let f = Fixture::locked();
    f.issue(ID, &in_days(30));
    assert_eq!(
        f.call(&staff(), "/client-link/withdraw", json!({ "id": ID }))
            .0,
        200
    );
    assert_eq!(f.state(ID), (410, "withdrawn".into()));
    assert_eq!(f.answer(ID, "confirm", None).0, 410);
    assert!(f.answers().is_empty());
    assert_eq!(
        f.call(&staff(), "/client-link/withdraw", json!({ "id": ID }))
            .0,
        409
    );
    // a client cannot withdraw anything
    assert_eq!(
        f.call(&client(EMAIL), "/client-link/withdraw", json!({ "id": ID }))
            .0,
        403
    );
}

#[test]
fn a_used_link_cannot_answer_again() {
    let f = Fixture::locked();
    f.issue(ID, &in_days(30));
    assert_eq!(f.answer(ID, "changes", Some("Change the tone.")).0, 200);
    assert_eq!(f.state(ID), (410, "answered".into()));
    let (s, _) = f.answer(ID, "confirm", None);
    assert_eq!(s, 410, "a link answers once");
    assert_eq!(f.answers().len(), 1);
    let gate = f
        .session
        .read(|d| napkin_host::ops::gate::view(d, &decisions(d)?))
        .unwrap();
    assert!(!gate.confirmed, "the second answer did not land");
}

#[test]
fn a_person_cannot_answer_through_a_link() {
    let f = Fixture::locked();
    f.issue(ID, &in_days(30));
    assert_eq!(
        f.call(
            &staff(),
            "/client-link/answer",
            json!({ "id": ID, "answer": "confirm" })
        )
        .0,
        403
    );
    assert!(f.answers().is_empty());
}

/// Every route the host answers, read from its own table: a client context is
/// refused all of them but its own two.
#[test]
fn a_client_actor_reaches_client_review_and_nothing_else() {
    let src = include_str!("../src/routes.rs");
    let mut paths: Vec<String> = Vec::new();
    for line in src.lines() {
        let t = line.trim();
        if !t.starts_with("\"/") || !t.contains("=>") {
            continue;
        }
        for part in t.split("=>").next().unwrap().split('|') {
            let p = part.trim().trim_matches('"');
            if p.starts_with('/') && !p.contains(' ') {
                paths.push(p.to_string());
            }
        }
    }
    assert!(
        paths.len() > 40,
        "the route table was read: {} paths",
        paths.len()
    );
    for must in [
        "/approve",
        "/patch-data",
        "/client-review",
        "/client-link/issue",
        "/gate",
        "/decisions",
        "/upload-asset",
    ] {
        assert!(
            paths.iter().any(|p| p == must),
            "{must} is in the table read"
        );
    }
    let f = Fixture::locked();
    f.issue(ID, &in_days(30));
    let before = std::fs::read(f.id.as_str()).unwrap();
    let allowed = napkin_host::ops::client_link::CLIENT_ROUTES;
    for p in &paths {
        let (s, _) = f.call(&client(EMAIL), p, json!({}));
        if allowed.contains(&p.as_str()) {
            assert_ne!(s, 403, "{p} is the client's");
        } else {
            assert_eq!(s, 403, "{p} must refuse a client actor");
        }
    }
    // an unknown path is refused too, not answered as unknown
    assert_eq!(f.call(&client(EMAIL), "/no-such-route", json!({})).0, 403);
    // the only record a client's context could have written is its own answer, and it wrote none
    assert_eq!(std::fs::read(f.id.as_str()).unwrap(), before);
}

/// A write and an open of the same document at once: the open must not put the older bytes back
/// (`Session::open` reads with the view held). The link the open raced with must still be there.
#[test]
fn an_open_racing_a_write_does_not_lose_the_write() {
    let f = Fixture::locked();
    let stop = std::sync::atomic::AtomicBool::new(false);
    let ids: Vec<String> = (0..12).map(|i| format!("{i:032x}")).collect();
    std::thread::scope(|s| {
        s.spawn(|| {
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                f.session.open(f.id.clone()).unwrap();
            }
        });
        for id in &ids {
            assert_eq!(f.issue(id, &in_days(30)).0, 200);
        }
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
    });
    let (_, v) = f.call(&staff(), "/client-link/list", json!({}));
    assert_eq!(
        v["links"].as_array().unwrap().len(),
        ids.len(),
        "every link made is still held"
    );
    let on_disk = f
        .chain()
        .decisions
        .iter()
        .filter(|d| d.action == "issue_link")
        .count();
    assert_eq!(on_disk, ids.len(), "and is in the file");
}
