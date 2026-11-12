// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Judge (features/judge.clan), at the host: what leaves is an allow list (a document seeded with every key of the work's
//! schema and the brief's, each holding a marker), a score is one verdict in the work's file that validates against
//! `docs/contracts/judge-verdict.schema.json` and `clan validate`, the creative director's overrule is their own verdict with a
//! written reason, a new version gets a new score and a new brief marks the old one out of date, and approving never reads a score.
//! The model-free half: the answers are the test values a fixture backend would give, built from the rubric.

use std::sync::Arc;

use clan_sdk::{ClanBuilder, ClanFile, Decision, DecisionChain};
use napkin_host::ops::judge::{self, Kind};
use napkin_host::{handle, Actor, Ctx, DocId, Document, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Map, Value};

const SCRIPT_EDITOR: &str = "ie.napkin.script-editor";
const BRIEF_MAKER: &str = "ie.napkin.brief-maker";
const PIPELINE: &[u8] = b"pipeline: napkin-script-editor\nversion: 1\nrequest_kind: middleware\ntasks:\n  judge_work:\n    handler: judge_work@1\n    kind: script\n";

fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn schema_of(app: &str) -> Value {
    serde_json::from_slice(
        &std::fs::read(root().join(format!("app/templates/{app}/schema.json"))).unwrap(),
    )
    .unwrap()
}

/// A value for every property of a schema: an object, a one-item list, or a marker string named by its path. Every leaf is a string
/// (the test documents are not validated), so every marker can be looked for in a request.
fn seeded(root_schema: &Value, node: &Value, path: &str, depth: usize) -> Value {
    let mut node = node;
    if let Some(r) = node.get("$ref").and_then(Value::as_str) {
        node = root_schema
            .pointer(r.trim_start_matches('#'))
            .unwrap_or(node);
    }
    if depth > 6 {
        return json!(format!("MK<{path}>"));
    }
    if let Some(props) = node.get("properties").and_then(Value::as_object) {
        let mut m = Map::new();
        for (k, v) in props {
            m.insert(
                k.clone(),
                seeded(root_schema, v, &format!("{path}.{k}"), depth + 1),
            );
        }
        return Value::Object(m);
    }
    if let Some(items) = node.get("items") {
        return json!([seeded(root_schema, items, &format!("{path}[]"), depth + 1)]);
    }
    if let Some(extra) = node.get("additionalProperties").filter(|v| v.is_object()) {
        return json!({ "k1": seeded(root_schema, extra, &format!("{path}.k1"), depth + 1) });
    }
    json!(format!("MK<{path}>"))
}

fn leaves(v: &Value, path: &str, out: &mut Vec<(String, String)>) {
    match v {
        Value::Object(m) => m
            .iter()
            .for_each(|(k, x)| leaves(x, &format!("{path}.{k}"), out)),
        Value::Array(a) => a.iter().for_each(|x| leaves(x, &format!("{path}[]"), out)),
        Value::String(s) if s.starts_with("MK<") => out.push((path.to_string(), s.clone())),
        _ => {}
    }
}

struct Rig {
    dir: tempfile::TempDir,
}

fn clan(title: &str, app: &str, job: Option<&str>, data: &Value, pipeline: bool) -> Vec<u8> {
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
    m.job = job.map(String::from);
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

impl Rig {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().unwrap(),
        }
    }
    fn id(&self, file: &str) -> DocId {
        DocId::from(self.dir.path().join("documents").join(file))
    }
    fn write(&self, file: &str, bytes: Vec<u8>) -> DocId {
        std::fs::create_dir_all(self.dir.path().join("documents")).unwrap();
        let id = self.id(file);
        std::fs::write(id.as_str(), bytes).unwrap();
        id
    }
    fn store(&self) -> Arc<FsStore> {
        Arc::new(FsStore::new(self.dir.path().to_path_buf()))
    }
    fn session(&self, id: &DocId, who: &str) -> Session {
        let s = Session::with_ctx(self.store(), Ctx::new(Actor::human(who).unwrap()));
        s.open(id.clone()).unwrap();
        s
    }
    fn process(&self, id: &DocId) -> Session {
        let s = Session::with_ctx(self.store(), Ctx::new(Actor::process("judge").unwrap()));
        s.open(id.clone()).unwrap();
        s
    }
    fn doc(&self, id: &DocId) -> Document {
        Document::from_bytes(id.clone(), std::fs::read(id.as_str()).unwrap()).unwrap()
    }
    fn chain(&self, id: &DocId) -> Vec<Decision> {
        let c = ClanFile::open(id.as_str()).unwrap();
        DecisionChain::from_yaml(&c.read_entry("agent/decision-chain.yaml").unwrap())
            .unwrap()
            .decisions
    }
}

fn brief() -> Value {
    json!({
        "single_minded_proposition": "The easy way into Irish whiskey.",
        "insight": "Younger drinkers think Irish whiskey is for someone else.",
        "objectives": { "commercial": "Grow bar sales by 8%." },
        "audience": "People who drink at bars.",
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

/// A script and the job's brief, in one store.
fn job_rig(text: &str) -> (Rig, DocId, DocId) {
    let rig = Rig::new();
    let b = rig.write(
        "brief.clan",
        clan("Brief", BRIEF_MAKER, Some("J001"), &brief(), false),
    );
    let s = rig.write(
        "script.clan",
        clan("Script", SCRIPT_EDITOR, Some("J001"), &script(text), true),
    );
    (rig, s, b)
}

fn answers(kind: Kind, fail: &[&str]) -> Vec<Value> {
    judge::rubric()
        .tests_for(kind.id())
        .iter()
        .map(|t| json!({ "id": t.id, "value": if fail.contains(&t.id.as_str()) { "fail" } else { "pass" }, "evidence": format!("Evidence for {}.", t.id) }))
        .collect()
}

fn answered() -> judge::Answered {
    judge::Answered {
        handler: "judge_work@1.0".into(),
        backend: "fixture".into(),
        model: None,
        prompt_hash: None,
        rubric_version: judge::rubric().version.clone(),
        price_eur: 0.0,
    }
}

/// Score the script as the fixture backend would (`fail` names the tests that fail), and write the verdict.
fn score(rig: &Rig, id: &DocId, fail: &[&str], trust: &str) -> Value {
    let s = rig.session(id, "maeve@wk");
    let store = rig.store();
    let ctx = Ctx::new(Actor::human("maeve@wk").unwrap());
    let p = s.read(|d| judge::prepare(&*store, &ctx, d, None)).unwrap();
    let t = judge::tally(p.piece.kind, &answers(p.piece.kind, fail)).unwrap();
    let a = answered();
    let by = Ctx::new(Actor::process("judge").unwrap())
        .with_handler(&a.handler)
        .with_backend(&a.backend);
    s.perform(&by, |c, d| judge::score_outcome(c, d, &p, &t, &a, trust))
        .unwrap()
        .reply
}

fn get(s: &Session, path: &str) -> (u16, Value) {
    let r = handle(s, &NoConfig, HostRequest::new(path, "", Vec::new()));
    (
        r.status,
        serde_json::from_slice(&r.body).unwrap_or(Value::Null),
    )
}

fn post(s: &Session, path: &str, body: Value) -> (u16, Value) {
    let r = handle(
        s,
        &NoConfig,
        HostRequest::new(path, "", body.to_string().into_bytes()).posting(),
    );
    (
        r.status,
        serde_json::from_slice(&r.body).unwrap_or(Value::Null),
    )
}

// ── what leaves ─────────────────────────────────────────────────────────────

#[test]
fn the_request_holds_the_works_allow_list_and_the_briefs_approved_fields_and_nothing_else() {
    let rig = Rig::new();
    let mut work = seeded(
        &schema_of("script-editor"),
        &schema_of("script-editor"),
        "w",
        0,
    );
    let mut brief = seeded(&schema_of("brief-maker"), &schema_of("brief-maker"), "b", 0);
    brief["signers"] = json!([{ "role": "creative_director", "person": "dara@wk" }]);
    work["upstream"] = json!({ "doc_brief": brief });
    let id = rig.write(
        "script.clan",
        clan("Script", SCRIPT_EDITOR, Some("J001"), &work, true),
    );
    let store = rig.store();
    let ctx = Ctx::new(Actor::human("maeve@wk").unwrap());
    let doc = rig.doc(&id);
    let p = judge::prepare(&*store, &ctx, &doc, None).unwrap();
    let request = p.request(doc.version().as_str()).to_string();

    let mut markers = Vec::new();
    leaves(&work, "w", &mut markers);
    assert!(
        markers.len() > 40,
        "the seed holds every key: {} markers",
        markers.len()
    );
    let beat = [
        "id",
        "kind",
        "role",
        "text",
        "visual_action",
        "voiceover",
        "dialogue",
        "on_screen_text",
        "sound_intention",
        "duration_s",
    ];
    let allowed = |path: &str| -> bool {
        let p = path.strip_prefix("w.").unwrap_or(path);
        if let Some(rest) = p.strip_prefix("upstream.doc_brief.") {
            let top = rest.split(['.', '[']).next().unwrap();
            return judge::BRIEF_FIELDS.contains(&top);
        }
        if let Some(k) = p.strip_prefix("script.beats[].") {
            return beat.contains(&k);
        }
        if let Some(k) = p
            .strip_prefix("checks.mandatory[].")
            .or_else(|| p.strip_prefix("checks.banned[]."))
        {
            return k == "text" || k == "source";
        }
        matches!(p, "format" | "slot_s" | "proposition" | "cast")
    };
    let mut seen = 0;
    for (path, marker) in &markers {
        // the brief's markers sit under upstream; the request carries them under `brief`
        let in_request = request.contains(marker.as_str());
        assert_eq!(
            in_request,
            allowed(path),
            "{path}: {marker} {}",
            if in_request {
                "left and should not have"
            } else {
                "stayed and should have left"
            }
        );
        seen += usize::from(in_request);
    }
    assert!(
        seen >= 14,
        "the allow list sends the work and the brief fields: {seen}"
    );
    // none of what makes a person's name or a drafter's prompt rides along
    for no in [
        "answered_by",
        "proposals",
        "handoffs",
        "\"by\"",
        "different_thought",
    ] {
        assert!(!request.contains(no), "{no} left");
    }
    // the clan holds the id and version of the document and nothing of it
    let v: Value = serde_json::from_str(&request).unwrap();
    assert_eq!(
        v["clan"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        ["id", "version"]
    );
    assert_eq!(
        v["payload"]["input"]["rubric_version"],
        judge::rubric().version
    );
}

#[test]
fn an_app_that_does_not_declare_the_task_is_not_scored_and_a_blank_script_is_not_either() {
    let rig = Rig::new();
    rig.write(
        "brief.clan",
        clan("Brief", BRIEF_MAKER, Some("J001"), &brief(), false),
    );
    let none = rig.write(
        "a.clan",
        clan(
            "Script",
            SCRIPT_EDITOR,
            Some("J001"),
            &script("A line."),
            false,
        ),
    );
    let store = rig.store();
    let ctx = Ctx::new(Actor::human("maeve@wk").unwrap());
    let e = judge::prepare(&*store, &ctx, &rig.doc(&none), None).unwrap_err();
    assert_eq!(e.status, 400, "{}", e.message);
    assert!(e.message.contains("does not send work to Judge"));
    let blank = rig.write(
        "b.clan",
        clan("Script", SCRIPT_EDITOR, Some("J001"), &script("  "), true),
    );
    assert_eq!(
        judge::prepare(&*store, &ctx, &rig.doc(&blank), None)
            .unwrap_err()
            .status,
        400
    );
    let nobrief = Rig::new();
    let lone = nobrief.write(
        "s.clan",
        clan(
            "Script",
            SCRIPT_EDITOR,
            Some("J009"),
            &script("A line."),
            true,
        ),
    );
    let e = judge::prepare(&*nobrief.store(), &ctx, &nobrief.doc(&lone), None).unwrap_err();
    assert_eq!(e.status, 409, "work is scored against its brief");
}

// ── the verdict ─────────────────────────────────────────────────────────────

#[test]
fn a_score_is_one_verdict_in_the_file_that_validates_and_round_trips() {
    let (rig, s, _) = job_rig("Tonight, try something new.");
    let reply = score(
        &rig,
        &s,
        &[
            "idea.headline",
            "idea.surprise",
            "idea.audience_would_say",
            "craft.script.first_line",
            "effect.tone",
        ],
        "none",
    );
    assert_eq!(reply["total"], 25);
    let chain = rig.chain(&s);
    let verdicts: Vec<&Decision> = chain.iter().filter(|d| d.agent == "judge").collect();
    assert_eq!(verdicts.len(), 1);
    let d = verdicts[0];
    let v = serde_json::to_value(d).unwrap();
    let schema: Value = serde_json::from_slice(
        &std::fs::read(root().join("docs/contracts/judge-verdict.schema.json")).unwrap(),
    )
    .unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    let problems: Vec<String> = validator.iter_errors(&v).map(|e| e.to_string()).collect();
    assert!(problems.is_empty(), "{problems:?}\n{v}");
    assert_eq!(v["kind"], "verdict");
    assert_eq!(v["handler"], "judge_work@1.0");
    assert_eq!(v["backend"], "fixture");
    assert_eq!(
        v["reason_code"], "judge.forward",
        "25 of 30 goes to the creative director"
    );
    assert_eq!(v["taxonomy_version"], judge::rubric().version);
    assert!(
        v.get("score").is_none(),
        "a backend that explains holds no number in score"
    );
    assert!(
        v.get("polarity").is_none(),
        "a bad verdict would stop a lock: Judge's score carries none"
    );
    assert_eq!(v["judge"]["total"], 25);
    assert_eq!(
        v["judge"]["sub"],
        json!({ "idea": 7, "craft": 9, "effect": 9 })
    );
    assert_eq!(v["judge"]["trust"], "none");
    assert_eq!(v["judge"]["tests"].as_array().unwrap().len(), 30);
    assert_eq!(
        d.version.as_deref().unwrap().len(),
        12,
        "the version is the work's hash"
    );
    // the clan validates, and the decision survives a read-modify-write with its judge block
    let report = clan_sdk::validate(&ClanFile::open(rig.id("script.clan").as_str()).unwrap());
    assert!(report.is_valid(), "{}", report.display());
    let again: Decision = serde_yaml::from_str(&serde_yaml::to_string(d).unwrap()).unwrap();
    assert_eq!(&again, d);
    // the score card reads it back, failed tests first
    let (status, card) = get(&rig.session(&s, "maeve@wk"), "/judge");
    assert_eq!(status, 200, "{card}");
    assert_eq!(card["score"]["total"], 25);
    assert_eq!(card["score"]["tests"][0]["value"], "fail");
    assert_eq!(card["score"]["current"], true);
    assert_eq!(card["score"]["out_of_date"], false);
    assert!(card["score"]["route_line"]
        .as_str()
        .unwrap()
        .contains(judge::NOT_TRUSTED));
    assert_eq!(card["can_overrule"], false, "the writer cannot overrule");
}

#[test]
fn a_new_version_of_the_work_gets_a_new_score_and_a_new_brief_marks_the_old_one_out_of_date() {
    let (rig, s, b) = job_rig("Tonight, try something new.");
    score(&rig, &s, &[], "none");
    let first = rig
        .chain(&s)
        .into_iter()
        .find(|d| d.agent == "judge")
        .unwrap();
    // a new line is a new version: it gets its own verdict and the old one stays on the old version
    let me = rig.session(&s, "maeve@wk");
    let (status, _) = post(
        &me,
        "/patch-data",
        json!({ "patch": { "script": { "beats": [{ "id": "b1", "kind": "voice", "role": "FVO", "text": "A new first line." }] } }, "agent": "human", "action": "edit a line" }),
    );
    assert_eq!(status, 200);
    let (_, card) = get(&rig.session(&s, "maeve@wk"), "/judge");
    assert_eq!(
        card["score"]["current"], false,
        "the old score is for the old words"
    );
    score(&rig, &s, &["idea.headline"], "none");
    let scores: Vec<Decision> = rig
        .chain(&s)
        .into_iter()
        .filter(|d| d.agent == "judge")
        .collect();
    assert_eq!(scores.len(), 2);
    assert_ne!(scores[0].version, scores[1].version);
    assert_eq!(scores[1].id, first.id, "the first score stays as it was");
    // a new brief version marks the earlier score out of date, and offers Score again
    let (_, card) = get(&rig.session(&s, "maeve@wk"), "/judge");
    assert_eq!(card["score"]["out_of_date"], false);
    let brief_session = rig.session(&b, "aoife@wk");
    let (status, v) = post(
        &brief_session,
        "/patch-data",
        json!({ "patch": { "single_minded_proposition": "A newer line." }, "agent": "human", "action": "edit the proposition" }),
    );
    assert_eq!(status, 200, "{v}");
    let (_, card) = get(&rig.session(&s, "maeve@wk"), "/judge");
    assert_eq!(card["score"]["out_of_date"], true);
    assert_eq!(card["older"].as_array().unwrap().len(), 1);
}

// ── the creative director's overrule ────────────────────────────────────────

#[test]
fn only_the_creative_director_overrules_with_a_written_reason_and_judges_verdict_stays() {
    let (rig, s, _) = job_rig("Tonight, try something new.");
    let fail: Vec<String> = judge::rubric()
        .tests_for("script")
        .iter()
        .filter(|t| t.method == "llm")
        .take(8)
        .map(|t| t.id.clone())
        .collect();
    let fail: Vec<&str> = fail.iter().map(String::as_str).collect();
    score(&rig, &s, &fail, "shadow");
    let before = rig
        .chain(&s)
        .into_iter()
        .find(|d| d.agent == "judge")
        .unwrap();
    assert_eq!(before.reason_code.as_deref(), Some("judge.return"));
    let body = json!({ "reason": "The line is rough but the thought is the one we want." });

    // a copywriter, another person on the job, a process: refused
    assert_eq!(
        post(
            &rig.session(&s, "maeve@wk"),
            "/judge/overrule",
            body.clone()
        )
        .0,
        403
    );
    assert_eq!(
        post(
            &rig.session(&s, "aoife@wk"),
            "/judge/overrule",
            body.clone()
        )
        .0,
        403
    );
    assert_eq!(
        post(&rig.process(&s), "/judge/overrule", body.clone()).0,
        403
    );
    // the creative director with no written reason, or a blank one: refused
    let cd = || rig.session(&s, "dara@wk");
    assert_eq!(post(&cd(), "/judge/overrule", json!({})).0, 400);
    assert_eq!(
        post(&cd(), "/judge/overrule", json!({ "reason": "   " })).0,
        400
    );
    assert_eq!(
        rig.chain(&s).iter().filter(|d| d.agent == "judge").count(),
        1,
        "nothing was written"
    );

    // the card offers the creative director the overrule and nobody else
    assert_eq!(get(&cd(), "/judge").1["can_overrule"], true);
    let (status, v) = post(&cd(), "/judge/overrule", body);
    assert_eq!(status, 200, "{v}");
    assert_eq!(
        v["route"], "cd",
        "a score that sent the work to the team is overruled to the creative director"
    );

    let chain = rig.chain(&s);
    let verdicts: Vec<&Decision> = chain
        .iter()
        .filter(|d| d.kind.as_deref() == Some("verdict"))
        .collect();
    assert_eq!(verdicts.len(), 2);
    let over = verdicts[0];
    assert_eq!(over.actor.as_deref(), Some("human:dara@wk"));
    assert_eq!(over.reason_code.as_deref(), Some("judge.overruled"));
    assert_eq!(over.reviewer_role.as_deref(), Some("creative-director"));
    assert_eq!(over.cites, vec![before.id.clone().unwrap()]);
    assert_eq!(
        over.rationale,
        "The line is rough but the thought is the one we want."
    );
    let v = serde_json::to_value(over).unwrap();
    let schema: Value = serde_json::from_slice(
        &std::fs::read(root().join("docs/contracts/judge-verdict.schema.json")).unwrap(),
    )
    .unwrap();
    assert!(
        jsonschema::validator_for(&schema).unwrap().is_valid(&v),
        "{v}"
    );
    assert_eq!(verdicts[1], &before, "Judge's verdict stays as it was");

    // the effective route is the creative director's, said on the card; a second overrule of the same score is not offered
    let (_, card) = get(&cd(), "/judge");
    assert_eq!(card["score"]["advised_route"], "team");
    assert_eq!(card["score"]["route"], "cd");
    assert!(card["score"]["overruled"]["reason"]
        .as_str()
        .unwrap()
        .contains("rough"));
    assert_eq!(card["score"]["decided"], "kept");
}

// ── Judge advises and never decides ─────────────────────────────────────────

#[test]
fn approving_works_on_unscored_and_low_scored_work_and_a_score_reads_after_an_approve() {
    let (rig, s, _) = job_rig("Tonight, try something new.");
    // unscored: the creative director approves
    let (status, v) = post(
        &rig.session(&s, "dara@wk"),
        "/approve",
        json!({ "rationale": "Approved without a score." }),
    );
    assert_eq!(status, 200, "{v}");
    // a locked version still takes a score (a verdict is a decision, not an edit), and the approve it sits beside is untouched
    let (rig2, s2, _) = job_rig("Tonight, try something new.");
    let all_fail: Vec<String> = judge::rubric()
        .tests_for("script")
        .iter()
        .filter(|t| t.method == "llm")
        .map(|t| t.id.clone())
        .collect();
    let all_fail: Vec<&str> = all_fail.iter().map(String::as_str).collect();
    let low = score(&rig2, &s2, &all_fail, "none");
    assert!(low["total"].as_u64().unwrap() < 24);
    let (status, v) = post(
        &rig2.session(&s2, "dara@wk"),
        "/approve",
        json!({ "rationale": "Approved with a low score." }),
    );
    assert_eq!(status, 200, "a low score does not stop an approve: {v}");
    let reply = score(&rig, &s, &[], "shadow");
    assert_eq!(reply["total"], 30);
    let (_, card) = get(&rig.session(&s, "dara@wk"), "/judge");
    assert!(
        card["score"]["decided"].is_null(),
        "the approve came before this score: it decided nothing about it"
    );
    let (_, card) = get(&rig2.session(&s2, "dara@wk"), "/judge");
    assert_eq!(
        card["score"]["decided"], "kept",
        "the creative director approved it after the low score, and that is what they then did"
    );
}
