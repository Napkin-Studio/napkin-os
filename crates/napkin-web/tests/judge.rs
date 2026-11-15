// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Judge (features/judge.clan) through the web's own pieces: the scoring route against a stand-in middleware (each refusal keeps
//! its code and writes nothing, a malformed reply is never a pass, an unset backend sends nothing), the job index's scores (read
//! from the stamp-keyed cache, so an unchanged tenant reads and hashes nothing; no field names a person), the telemetry export
//! (a canary sentence in every text field is in no row), the client wall (no score in any shown list) and who may read what.
//! One test function reads the environment (`NAPKIN_JUDGE_BACKEND`), so the route cases run in order inside one.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{TimeZone, Utc};
use clan_sdk::{ClanBuilder, ClanFile, Decision, DecisionChain};
use napkin_host::config::ProxyConfig;
use napkin_host::jobindex::{Audience, IndexCache, JobIndex};
use napkin_host::jobs::{self, NewJob};
use napkin_host::ops::judge::{self, Kind};
use napkin_host::{
    clients, dispatch_async, Actor, Change, Ctx, DocId, Document, HostConfig, HostRequest,
    HostResult, Library, PartStore, Session, Stamp, Version, WorkspaceConfig,
};
use napkin_web::store::{doc_id, TenantStore};
use serde_json::{json, Value};

const SCRIPT_EDITOR: &str = "ie.napkin.script-editor";
const BRIEF_MAKER: &str = "ie.napkin.brief-maker";
const CANARY: &str = "Canary: the tractor sings at midnight.";
const PIPELINE: &[u8] = b"pipeline: napkin-script-editor\nversion: 1\nrequest_kind: middleware\ntasks:\n  judge_work:\n    handler: judge_work@1\n    kind: script\n";

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 12, 10, 0, 0).unwrap()
}

fn clan(title: &str, app: &str, client: &str, data: &Value, pipeline: bool) -> Vec<u8> {
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
        version: "0.1.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach: None,
    });
    m.client = Some(clan_sdk::ClientRef {
        id: client.into(),
        name: "Client A".into(),
    });
    m.job = Some("J001".into());
    let mut b = ClanBuilder::new(m);
    for (path, bytes) in base.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH && path != "shared/data.yaml" {
            b.add_entry(path, bytes);
        }
    }
    b.add_entry(
        "shared/data.yaml",
        serde_yaml::to_string(data).unwrap().into_bytes(),
    );
    if pipeline {
        b.add_entry("app/pipeline.yaml", PIPELINE.to_vec());
    }
    b.build().unwrap()
}

fn brief() -> Value {
    json!({
        "single_minded_proposition": "The easy way into Irish whiskey.",
        "insight": "Younger drinkers think Irish whiskey is for someone else.",
        "signers": [{ "role": "planner", "person": "aoife@wk" }, { "role": "creative_director", "person": "dara@wk" }],
    })
}

fn script(text: &str) -> Value {
    json!({
        "format": "radio", "slot_s": 30, "proposition": "The easy way in.",
        "script": { "beats": [{ "id": "b1", "kind": "voice", "role": "FVO", "text": text }], "proposals": [], "seq": 1 },
        "checks": { "mandatory": [], "banned": [] }, "handoffs": { "radio": null, "film": null, "judge": null },
    })
}

/// A tenant with Client A, the job J001, its brief and one script.
fn tenant(dir: &std::path::Path, text: &str) -> (TenantStore, String, DocId) {
    let store = TenantStore::new(dir.to_path_buf());
    let me = Ctx::new(Actor::human("niamh@wk").unwrap());
    let client = clients::create_client(&store, &me, "Client A", None).unwrap();
    jobs::create_job(
        &store,
        &me,
        NewJob {
            number: Some("J001".into()),
            client_id: client.id.clone(),
            title: Some("J001".into()),
            ..Default::default()
        },
    )
    .unwrap();
    store
        .apply(&Change::create(
            doc_id("brief"),
            clan("J001 brief", BRIEF_MAKER, &client.id, &brief(), false),
        ))
        .unwrap();
    let s = doc_id("script");
    store
        .apply(&Change::create(
            s.clone(),
            clan(
                "J001 radio script",
                SCRIPT_EDITOR,
                &client.id,
                &script(text),
                true,
            ),
        ))
        .unwrap();
    (store, client.id, s)
}

fn tests_for(kind: Kind, fail: &[&str]) -> Vec<Value> {
    judge::rubric().tests_for(kind.id()).iter()
        .map(|t| json!({ "id": t.id, "value": if fail.contains(&t.id.as_str()) { "fail" } else { "pass" }, "evidence": format!("Evidence for {}.", t.id) }))
        .collect()
}

fn reply(tests: Vec<Value>) -> String {
    json!({
        "api": "napkin.middleware/1", "task": "judge_work", "handler": "judge_work@1.0",
        "job": { "id": "job_1", "state": "done", "progress": { "done": 1, "total": 1 } },
        "result": { "tests": tests, "backend": "fixture", "model": null, "rubric_version": judge::rubric().version, "prompt_hash": null, "price_eur": 0 },
        "change": null, "trace": {},
    })
    .to_string()
}

/// What the spend guard reports it let through for a charged run (the envelope's `usage`, middleware-api.md).
fn usage() -> Value {
    json!({ "estimate_eur": 0.05, "charged_eur": 0.02, "route": "eu-small" })
}

/// [`reply`], from a run that was charged.
fn charged(tests: Vec<Value>) -> String {
    let mut v: Value = serde_json::from_str(&reply(tests)).unwrap();
    v["usage"] = usage();
    v.to_string()
}

/// The `run_cost` blocks of a chain, newest first.
fn costs(path: &std::path::Path) -> Vec<Value> {
    chain(path)
        .iter()
        .filter(|d| d.kind.as_deref() == Some("run_cost"))
        .map(|d| {
            assert_eq!(d.agent, "judge", "a run's cost is the task's agent's");
            serde_json::to_value(d.extra.get("run_cost").unwrap()).unwrap()
        })
        .collect()
}

struct Cfg(String);
impl HostConfig for Cfg {
    fn workspace(&self) -> Option<WorkspaceConfig> {
        let mut proxies = HashMap::new();
        proxies.insert(
            "middleware".to_string(),
            ProxyConfig {
                endpoint: self.0.clone(),
                auth_kind: None,
                secret_ref: None,
            },
        );
        Some(WorkspaceConfig {
            proxies,
            agent_url: None,
        })
    }
    fn secret(&self, _: &str) -> Option<String> {
        None
    }
}

/// A stand-in middleware: it answers each request with the next of `answers` (status, body) and keeps what it was sent.
fn mock(answers: Vec<(u16, String)>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1/tasks", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        for (status, body) in answers {
            let Ok((mut s, _)) = listener.accept() else {
                return;
            };
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let n = s.read(&mut chunk).unwrap_or(0);
                buf.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&buf).to_string();
                if let Some((head, rest)) = text.split_once("\r\n\r\n") {
                    let len = head
                        .to_ascii_lowercase()
                        .lines()
                        .find_map(|l| {
                            l.strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    if rest.len() >= len || n == 0 {
                        break;
                    }
                } else if n == 0 {
                    break;
                }
            }
            log.lock()
                .unwrap()
                .push(String::from_utf8_lossy(&buf).to_string());
            let _ = s.write_all(format!("HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len()).as_bytes());
        }
    });
    (url, seen)
}

fn chain(path: &std::path::Path) -> Vec<Decision> {
    let c = ClanFile::open(path).unwrap();
    DecisionChain::from_yaml(&c.read_entry("agent/decision-chain.yaml").unwrap())
        .unwrap()
        .decisions
}

async fn run(session: &Session, ctx: &Ctx, cfg: &dyn HostConfig, body: Value) -> (u16, String) {
    let r = dispatch_async(
        ctx,
        session,
        cfg,
        HostRequest::new("/judge", "", body.to_string().into_bytes()).posting(),
    )
    .await;
    (r.status, String::from_utf8_lossy(&r.body).to_string())
}

#[tokio::test]
async fn the_scoring_route_keeps_each_refusal_writes_nothing_on_a_failure_and_never_counts_a_malformed_answer_as_a_pass(
) {
    let dir = tempfile::tempdir().unwrap();
    let (store, _, s) = tenant(dir.path(), "Tonight, try something new.");
    let file = dir.path().join("documents").join("script.clan");
    let maeve = Ctx::new(Actor::human("maeve@wk").unwrap());
    let session = Session::with_ctx(
        Arc::new(TenantStore::new(dir.path().to_path_buf())),
        maeve.clone(),
    );
    session.open(s.clone()).unwrap();
    let judged = || {
        chain(&file)
            .iter()
            .filter(|d| d.agent == "judge" && d.kind.as_deref() == Some("verdict"))
            .count()
    };

    // unset: Judge says it is not set up, and nothing is sent anywhere
    std::env::remove_var("NAPKIN_JUDGE_BACKEND");
    let (url, seen) = mock(vec![(200, reply(tests_for(Kind::Script, &[])))]);
    let (status, text) = run(
        &session,
        &maeve,
        &Cfg(url.clone()),
        json!({ "target": "script" }),
    )
    .await;
    assert_eq!(status, 503, "{text}");
    assert!(text.contains("not_configured"), "{text}");
    assert!(seen.lock().unwrap().is_empty(), "nothing left");
    std::env::set_var("NAPKIN_JUDGE_BACKEND", "jev");
    assert_eq!(
        run(&session, &maeve, &Cfg(url), json!({})).await.0,
        503,
        "a backend that is not built is not set up either"
    );

    std::env::set_var("NAPKIN_JUDGE_BACKEND", "fixture");
    // a client and a process never send work to Judge
    let client = Ctx::new(Actor::client("someone@client-a.example").unwrap());
    let r = dispatch_async(
        &client,
        &session,
        &Cfg("http://127.0.0.1:1".into()),
        HostRequest::new("/judge", "", b"{}".to_vec()).posting(),
    )
    .await;
    assert_eq!(r.status, 403);
    let process = Ctx::new(Actor::process("judge").unwrap());
    let r = dispatch_async(
        &process,
        &session,
        &Cfg("http://127.0.0.1:1".into()),
        HostRequest::new("/judge", "", b"{}".to_vec()).posting(),
    )
    .await;
    assert_eq!(r.status, 403);

    // the middleware's refusals keep their codes and statuses, and nothing is written
    let refusals = [
        ("ai_off", 403),
        ("not_eu", 403),
        ("not_configured", 503),
        ("spend_refused", 429),
    ];
    let answers = refusals
        .iter()
        .map(|(t, st)| {
            (
                *st,
                json!({ "error": { "type": t, "message": "refused" } }).to_string(),
            )
        })
        .chain([(
            502,
            json!({ "error": { "type": "provider_error", "message": "x" } }).to_string(),
        )])
        .collect();
    let (url, seen) = mock(answers);
    for (code, status) in refusals {
        let (got, text) = run(
            &session,
            &maeve,
            &Cfg(url.clone()),
            json!({ "target": "script" }),
        )
        .await;
        assert_eq!(got, status, "{code}: {text}");
        assert!(text.contains(code), "{code}: {text}");
    }
    let (got, text) = run(&session, &maeve, &Cfg(url), json!({})).await;
    assert_eq!(got, 502);
    // a run that did not run says so in one plain line, with no figure (done_when line 9)
    assert!(
        text.contains("judge_failed") && text.contains("That did not run. Nothing was changed."),
        "{text}"
    );
    assert!(
        !text.chars().any(|c| c.is_ascii_digit()),
        "no digit: {text}"
    );
    assert_eq!(judged(), 0, "a refusal and a failure write no verdict");
    assert_eq!(seen.lock().unwrap().len(), 5);
    // the spend guard refuses in the same place, in the same words, with no figure (done_when line 10); a refusal
    // writes nothing and charges nothing: no run_cost for a call that was not sent (review of 15 Nov, item 2)
    assert!(costs(&file).is_empty(), "{:?}", costs(&file));
    let (url, _) = mock(vec![(
        429,
        json!({ "error": { "type": "spend_refused", "message": "over the cap of 12.50" } })
            .to_string(),
    )]);
    let (got, text) = run(&session, &maeve, &Cfg(url), json!({})).await;
    assert_eq!(got, 429);
    assert!(
        text.contains("spend_refused")
            && text.contains("Paid runs are off here. Nothing was sent."),
        "{text}"
    );
    assert!(
        !text.chars().any(|c| c.is_ascii_digit()),
        "the middleware's figure is not passed on: {text}"
    );
    assert!(costs(&file).is_empty(), "each refused click writes nothing");

    // a malformed answer is an error and never a pass: a test missing, doubled, unknown, a number for a value, a rubric of another version
    let full = tests_for(Kind::Script, &[]);
    let mut missing = full.clone();
    missing.pop();
    let mut doubled = full.clone();
    doubled.push(full[0].clone());
    let mut unknown = full.clone();
    unknown.push(json!({ "id": "idea.made_up", "value": "pass", "evidence": "x" }));
    let mut number = full.clone();
    number[0]["value"] = json!(9);
    let wrong_rubric = reply(full.clone()).replace(
        &format!("\"rubric_version\":\"{}\"", judge::rubric().version),
        "\"rubric_version\":\"fixture-1\"",
    );
    let answers = [
        reply(missing),
        reply(doubled),
        reply(unknown),
        reply(number),
        wrong_rubric,
    ]
    .map(|b| (200, b))
    .to_vec();
    let (url, _) = mock(answers);
    for case in ["missing", "doubled", "unknown", "number", "rubric"] {
        let (got, text) = run(&session, &maeve, &Cfg(url.clone()), json!({})).await;
        assert_eq!(got, 502, "{case}: {text}");
        assert!(text.contains("judge_malformed"), "{case}: {text}");
    }
    assert_eq!(judged(), 0);
    assert!(
        costs(&file).is_empty(),
        "an answer that reported no cost writes none"
    );
    // a call that reported a usage block but charged nothing (the model-level guard stopped it) writes none either
    let mut free: Value = serde_json::from_str(&reply(full.clone())).unwrap();
    free["usage"] = json!({ "estimate_eur": 0.05, "charged_eur": 0.0, "route": "eu-small" });
    let mut free_bad = free.clone();
    free_bad["result"]["tests"] = json!([]);
    let (url, _) = mock(vec![(200, free_bad.to_string())]);
    let (got, _) = run(&session, &maeve, &Cfg(url), json!({})).await;
    assert_eq!(got, 502);
    assert!(costs(&file).is_empty(), "nothing charged, nothing recorded");

    // Review finding (d): a charged run whose answer is malformed still writes its cost; so does a charged run the
    // middleware itself failed after the charge (its error carries the usage block), and the cost holds no words
    let mut bad = full.clone();
    bad.pop();
    let failed_after =
        json!({ "error": { "type": "judge_malformed", "message": "x", "usage": usage() } })
            .to_string();
    let (url, _) = mock(vec![(200, charged(bad)), (502, failed_after)]);
    for case in ["malformed", "failed after the charge"] {
        let (got, text) = run(&session, &maeve, &Cfg(url.clone()), json!({})).await;
        assert_eq!(got, 502, "{case}: {text}");
    }
    assert_eq!(judged(), 0, "a malformed answer is still never a pass");
    let paid = costs(&file);
    assert_eq!(paid.len(), 2);
    for c in &paid[..2] {
        assert_eq!(
            (
                c["charged_eur"].clone(),
                c["estimate_eur"].clone(),
                c["route"].clone(),
                c["guard"].clone()
            ),
            (
                json!(0.02),
                json!(0.05),
                json!("eu-small"),
                json!("allowed")
            )
        );
        assert_eq!(c["task"], "judge_work");
    }

    // a good answer: one verdict, and the card in the reply; the request held the id and version of the document and the allow-listed work
    let (url, seen) = mock(vec![(
        200,
        charged(tests_for(Kind::Script, &["idea.headline", "effect.tone"])),
    )]);
    let (got, text) = run(&session, &maeve, &Cfg(url), json!({ "target": "script" })).await;
    assert_eq!(got, 200, "{text}");
    let card: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(card["score"]["total"], 28);
    assert_eq!(judged(), 1);
    // one run_cost line for the run (done_when line 11), numbers and ids only, and the card names no price
    let paid = costs(&file);
    assert_eq!(paid.len(), 3);
    assert_eq!(paid[0]["charged_eur"], json!(0.02));
    assert!(!paid[0].to_string().contains("Tonight"));
    assert!(
        card["setup"].get("price_eur").is_none(),
        "the card carries no price: {}",
        card["setup"]
    );
    let sent = seen.lock().unwrap()[0].clone();
    assert!(sent.contains("\"judge_work\""));
    assert!(
        sent.contains("Tonight, try something new."),
        "the work left, inside the vault's own route"
    );
    assert!(
        !sent.contains("niamh") && !sent.contains("maeve") && !sent.contains("Client A"),
        "no name left: {sent}"
    );
    std::env::remove_var("NAPKIN_JUDGE_BACKEND");
    drop(store);
}

/// The store, counting what reads a document's bytes (a read, and a version, which hashes them).
struct Counted<'a> {
    inner: &'a TenantStore,
    reads: AtomicUsize,
    hashes: AtomicUsize,
}
impl PartStore for Counted<'_> {
    fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
        self.reads.fetch_add(1, Ordering::Relaxed);
        self.inner.read(id)
    }
    fn exists(&self, id: &DocId) -> bool {
        self.inner.exists(id)
    }
    fn version(&self, id: &DocId) -> HostResult<Version> {
        self.hashes.fetch_add(1, Ordering::Relaxed);
        self.inner.version(id)
    }
    fn stamp(&self, id: &DocId) -> HostResult<Stamp> {
        self.inner.stamp(id)
    }
    fn apply(&self, change: &Change) -> HostResult<Version> {
        self.inner.apply(change)
    }
}
impl Library for Counted<'_> {
    fn app_candidates(&self) -> Vec<DocId> {
        self.inner.app_candidates()
    }
    fn app_template(&self, app_id: &str) -> DocId {
        self.inner.app_template(app_id)
    }
    fn documents(&self) -> Vec<DocId> {
        self.inner.documents()
    }
    fn new_document(&self, app_id: &str, id_short: &str) -> HostResult<DocId> {
        self.inner.new_document(app_id, id_short)
    }
    fn home(&self, version_tag: &str) -> HostResult<DocId> {
        self.inner.home(version_tag)
    }
    fn fork_branch(&self, parent: &DocId, agent: &str) -> DocId {
        self.inner.fork_branch(parent, agent)
    }
}

/// Write a score for the script, as the host's scoring route does after the middleware answers.
fn score(dir: &std::path::Path, s: &DocId, fail: &[&str], trust: &str) {
    let store = Arc::new(TenantStore::new(dir.to_path_buf()));
    let maeve = Ctx::new(Actor::human("maeve@wk").unwrap());
    let session = Session::with_ctx(store.clone(), maeve.clone());
    session.open(s.clone()).unwrap();
    let p = session
        .read(|d| judge::prepare(&*store, &maeve, d, None))
        .unwrap();
    let t = judge::tally(p.piece.kind, &tests_for(p.piece.kind, fail)).unwrap();
    let a = judge::Answered {
        handler: "judge_work@1.0".into(),
        backend: "fixture".into(),
        model: None,
        prompt_hash: None,
        rubric_version: judge::rubric().version.clone(),
        price_eur: 0.0,
    };
    let by = Ctx::new(Actor::process("judge").unwrap());
    session
        .perform(&by, |c, d| judge::score_outcome(c, d, &p, &t, &a, trust))
        .unwrap();
}

fn keys(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(m) => m.iter().for_each(|(k, x)| {
            out.push(k.clone());
            keys(x, out)
        }),
        Value::Array(a) => a.iter().for_each(|x| keys(x, out)),
        _ => {}
    }
}

#[test]
fn the_index_holds_each_pieces_latest_score_from_the_cache_reads_nothing_when_unchanged_and_names_no_person(
) {
    let dir = tempfile::tempdir().unwrap();
    let (store, _, s) = tenant(dir.path(), "Tonight, try something new.");
    let all_llm: Vec<String> = judge::rubric()
        .tests_for("script")
        .iter()
        .filter(|t| t.method == "llm")
        .map(|t| t.id.clone())
        .collect();
    let fail: Vec<&str> = all_llm.iter().take(8).map(String::as_str).collect();
    score(dir.path(), &s, &fail, "shadow");

    let counted = Counted {
        inner: &store,
        reads: AtomicUsize::new(0),
        hashes: AtomicUsize::new(0),
    };
    let cache = IndexCache::new();
    let first = cache.get(&counted, now()).unwrap();
    let job = first.job("J001").unwrap();
    assert_eq!(job.scores.len(), 1);
    let p = &job.scores[0];
    assert!(p.total < 24 && p.current && !p.overruled && p.decided.is_none());
    assert_eq!((p.route.as_str(), p.trust.as_str()), ("team", "shadow"));
    let tile = first.dashboard().scores.unwrap();
    assert_eq!(
        (tile.scored, tile.under_24, tile.at_27, tile.overruled),
        (1, 1, 0, 0)
    );
    assert_eq!(tile.awaiting_set, 60);
    // an unchanged tenant is read again without reading or hashing a document
    counted.reads.store(0, Ordering::Relaxed);
    counted.hashes.store(0, Ordering::Relaxed);
    for _ in 0..3 {
        let again = cache.get(&counted, now()).unwrap();
        assert_eq!(again.job("J001").unwrap().scores, job.scores);
        assert_eq!(again.dashboard().scores.unwrap().scored, 1);
    }
    assert_eq!(
        (
            counted.reads.load(Ordering::Relaxed),
            counted.hashes.load(Ordering::Relaxed)
        ),
        (0, 0),
        "an index read on an unchanged tenant reads and hashes nothing"
    );
    assert_eq!(
        first,
        JobIndex::build(&store, now()).unwrap(),
        "the cached index equals a fresh build"
    );

    // no key anywhere in the scores, the tile or a need names a person
    let mut all = Vec::new();
    keys(&serde_json::to_value(&job.scores).unwrap(), &mut all);
    keys(
        &serde_json::to_value(first.dashboard().scores.unwrap()).unwrap(),
        &mut all,
    );
    assert!(!all.is_empty());
    for k in &all {
        for bad in [
            "person",
            "author",
            "by",
            "actor",
            "writer",
            "owner",
            "per_person",
            "by_person",
            "per_writer",
            "by_author",
            "league",
            "rank",
        ] {
            assert!(
                k != bad && !k.contains("per_") && !k.starts_with("by_"),
                "a key that scores a person: {k} ({bad})"
            );
        }
    }

    // the scored piece asks the team (by role) and, until Judge is trusted, the creative director named on the brief
    let needs = &first.needs;
    assert!(needs
        .iter()
        .any(|n| n.kind == "judge-return" && n.audience == Audience::Role("copywriter")));
    let cd: Vec<_> = first
        .needs_for(Some("dara@wk"), &[])
        .into_iter()
        .filter(|n| n.kind == "judge-review")
        .collect();
    assert_eq!(cd.len(), 1);
    assert!(cd[0]
        .text
        .contains("Judge is not yet trusted here. Advice only."));
    // a person with neither role nor the job's creative director is not asked to review
    assert!(first
        .needs_visible(Some("fionn@wk"), &["traffic".to_string()], &|_| vec![])
        .iter()
        .all(|n| n.kind != "judge-review"));
    // and the creative director's overrule changes the tile and the effective route
    let store2 = Arc::new(TenantStore::new(dir.path().to_path_buf()));
    let dara = Ctx::new(Actor::human("dara@wk").unwrap());
    let session = Session::with_ctx(store2.clone(), dara.clone());
    session.open(s.clone()).unwrap();
    session
        .perform(&dara, |c, d| {
            judge::overrule(
                &*store2,
                c,
                d,
                &json!({ "reason": "The thought is the one we want." }),
            )
        })
        .unwrap();
    let after = cache.get(&counted, now()).unwrap();
    assert_eq!(after.job("J001").unwrap().scores[0].route, "cd");
    assert_eq!(after.dashboard().scores.unwrap().overruled, 1);
    assert!(
        after
            .needs
            .iter()
            .all(|n| n.kind != "judge-return" && n.kind != "judge-review"),
        "overruled to the creative director: nothing more is asked"
    );
}

#[test]
fn what_leaves_the_vault_holds_no_text_of_the_work_and_the_client_never_sees_a_score() {
    let dir = tempfile::tempdir().unwrap();
    // a canary sentence in every text field a verdict could carry
    let (store, _, s) = tenant(dir.path(), CANARY);
    score(dir.path(), &s, &["idea.headline"], "none");
    let rows = judge::telemetry_rows(&store);
    assert_eq!(rows.len(), 1);
    let text = serde_json::to_string(&rows).unwrap();
    assert!(
        !text.contains("Canary") && !text.contains("tractor"),
        "{text}"
    );
    assert!(!text.contains("Evidence for"), "no evidence line leaves");
    assert!(
        !text.contains("J001 radio script")
            && !text.contains("Client A")
            && !text.contains("maeve")
            && !text.contains("dara"),
        "no title and no name: {text}"
    );
    assert_eq!(
        rows[0]["then"],
        json!({ "decision": "none", "overruled": false })
    );

    // the file itself does hold them (the chain is the vault); the export is the only door and it is an allow list
    let file = dir.path().join("documents").join("script.clan");
    let raw = serde_json::to_string(&chain(&file)).unwrap();
    assert!(
        raw.contains("Evidence for"),
        "the evidence is kept in the vault"
    );

    // the client's link: no allow list of clean.rs names a score, and a brief carrying one shows none
    for (key, _) in napkin_web::clean::FIELDS {
        assert!(!key.contains("judge") && !key.contains("score"), "{key}");
    }
    let planted = clan(
        "J001 brief",
        BRIEF_MAKER,
        "cli_x",
        &json!({
            "single_minded_proposition": "The easy way in.",
            "judge": { "total": 22, "tests": [{ "evidence": CANARY }] }, "score": 22, "scores": [22],
            "signers": [{ "role": "creative_director", "person": "dara@wk" }],
        }),
        false,
    );
    let doc = Document::from_bytes(DocId::new("documents/b.clan"), planted).unwrap();
    let page = napkin_web::clean::page_of(&doc);
    let shown =
        serde_json::to_string(&page.summary).unwrap() + &page.title + &page.signed_by.join(",");
    assert!(
        !shown.contains("22") && !shown.contains("Canary"),
        "{shown}"
    );
}

#[test]
fn who_may_read_scores_a_job_view_carries_them_by_name_and_telemetry_is_for_management_and_admin() {
    use napkin_web::roles::{allowed, group_of, Group};
    let r = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    assert_eq!(group_of("/t/x/judge/telemetry"), Group::Management);
    assert!(allowed(&r(&["management"]), "/t/x/judge/telemetry", None));
    assert!(allowed(&r(&["admin"]), "/t/x/judge/telemetry", None));
    for role in [
        "copywriter",
        "art-director",
        "creative-director",
        "planning",
        "agency-brain",
        "account-service",
        "producer",
        "traffic",
    ] {
        assert!(
            !allowed(&r(&[role]), "/t/x/judge/telemetry", None),
            "{role}"
        );
    }
    // the dashboard stays management's and the scores ride in the job view of every agency role
    assert!(!allowed(&r(&["copywriter"]), "/t/x/dashboard", None));
    let dir = tempfile::tempdir().unwrap();
    let (store, _, s) = tenant(dir.path(), "Tonight, try something new.");
    score(dir.path(), &s, &[], "none");
    let index = JobIndex::build(&store, now()).unwrap();
    for roles in [
        r(&["agency-brain"]),
        r(&["creative-director"]),
        r(&["copywriter"]),
        r(&["management"]),
    ] {
        let v = napkin_web::jobview::job_view(index.job("J001").unwrap(), &roles);
        let mut all = Vec::new();
        keys(&v["scores"], &mut all);
        assert_eq!(v["scores"][0]["total"], 30, "{roles:?}");
        for k in &all {
            assert!(
                !["person", "author", "by", "actor", "writer", "owner"].contains(&k.as_str()),
                "{k}"
            );
        }
        assert!(
            v["scores"][0].get("tests").is_none() && v["scores"][0].get("evidence").is_none(),
            "no test text in the index"
        );
    }
}

/// What `POST /api-proxy` hands the frame for a middleware call.
async fn proxy(session: &Session, ctx: &Ctx, url: &str, task: &str) -> Value {
    let body = json!({ "request_kind": "middleware", "payload": { "api": "napkin.middleware/1", "task": task, "input": { "work": { "kind": "script" } } } });
    let r = dispatch_async(
        ctx,
        session,
        &Cfg(url.to_string()),
        HostRequest::new("/api-proxy", "", body.to_string().into_bytes()).posting(),
    )
    .await;
    serde_json::from_slice(&r.body).unwrap_or(Value::Null)
}

/// Every `run_cost` decision of a chain, newest first, whole.
fn cost_decisions(path: &std::path::Path) -> Vec<Decision> {
    chain(path)
        .into_iter()
        .filter(|d| d.kind.as_deref() == Some("run_cost"))
        .collect()
}

// Review of 15 Nov, item 1: a cost is recorded where the money is spent. A middleware call a frame sends through
// `POST /api-proxy` that comes back charged is one run_cost decision on the open document, written by the host
// (its agent and action are the server's, never the body's), whatever the task; the frame gets the answer and never
// the figure. A poll that repeats a job already recorded writes nothing more; a charged failure that says what it
// cost is recorded; a failure that says nothing (a timeout, a 500 with no usage) records nothing.
#[tokio::test]
async fn a_charged_middleware_call_through_the_proxy_is_recorded_and_the_frame_never_sees_the_figure(
) {
    let dir = tempfile::tempdir().unwrap();
    let (_store, _, s) = tenant(dir.path(), "Tonight, try something new.");
    let file = dir.path().join("documents").join("script.clan");
    let maeve = Ctx::new(Actor::human("maeve@wk").unwrap());
    let session = Session::with_ctx(
        Arc::new(TenantStore::new(dir.path().to_path_buf())),
        maeve.clone(),
    );
    session.open(s.clone()).unwrap();

    // a Judge answer, sent by the frame itself: recorded, by Judge, and the frame reads no usage and no price
    let (url, seen) = mock(vec![(200, charged(tests_for(Kind::Script, &[])))]);
    let v = proxy(&session, &maeve, &url, "judge_work").await;
    assert_eq!(seen.lock().unwrap().len(), 1);
    assert_eq!(v["ok"], json!(true), "{v}");
    let text = v.to_string();
    for word in [
        "usage\"",
        "charged_eur",
        "estimate_eur",
        "price_eur",
        "0.02",
    ] {
        assert!(!text.contains(word), "the frame got {word}: {text}");
    }
    let paid = cost_decisions(&file);
    assert_eq!(paid.len(), 1);
    assert_eq!(
        (paid[0].agent.as_str(), paid[0].action.as_str()),
        ("judge", "run_cost")
    );
    let block = serde_json::to_value(paid[0].extra.get("run_cost").unwrap()).unwrap();
    assert_eq!(block["charged_eur"], json!(0.02));
    assert_eq!(block["task"], "judge_work");
    assert_eq!(block["job"], "job_1");

    // any other task is recorded too, by the middleware; a poll that answers the same job again writes nothing more;
    // a body that names its own agent does not change who wrote it
    let mut brief: Value = serde_json::from_str(&charged(vec![])).unwrap();
    brief["task"] = json!("draft_brief");
    brief["handler"] = json!("draft_brief@1.0");
    brief["job"]["id"] = json!("job_brief_7");
    brief["result"] = json!({ "summary": "drafted" });
    let (url, _) = mock(vec![(200, brief.to_string()), (200, brief.to_string())]);
    let v = proxy(&session, &maeve, &url, "draft_brief").await;
    assert!(!v.to_string().contains("charged_eur"), "{v}");
    proxy(&session, &maeve, &url, "job_status").await;
    let paid = cost_decisions(&file);
    assert_eq!(paid.len(), 2, "one per job, not one per poll");
    assert_eq!(
        (paid[0].agent.as_str(), paid[0].action.as_str()),
        ("middleware", "run_cost")
    );
    assert_eq!(
        serde_json::to_value(paid[0].extra.get("run_cost").unwrap()).unwrap()["task"],
        "draft_brief"
    );

    // a failure after the charge that says what it cost is recorded, and the frame's error carries no figure; a 500
    // that says nothing, and an answer that charged nothing, record nothing
    let charged_error =
        json!({ "error": { "type": "judge_malformed", "message": "x", "usage": usage() } })
            .to_string();
    let silent =
        json!({ "error": { "type": "internal", "message": "the middleware failed" } }).to_string();
    let mut free: Value = serde_json::from_str(&reply(vec![])).unwrap();
    free["usage"] = json!({ "estimate_eur": 0.05, "charged_eur": 0.0, "route": "eu-small" });
    free["job"]["id"] = json!("job_free");
    let (url, _) = mock(vec![
        (502, charged_error),
        (500, silent),
        (200, free.to_string()),
    ]);
    let v = proxy(&session, &maeve, &url, "judge_work").await;
    assert_eq!(v["ok"], json!(false));
    assert!(!v.to_string().contains("charged_eur"), "{v}");
    proxy(&session, &maeve, &url, "judge_work").await;
    proxy(&session, &maeve, &url, "judge_work").await;
    assert_eq!(
        cost_decisions(&file).len(),
        3,
        "only the charged failure is added"
    );
}
