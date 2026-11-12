// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Judge: a piece of work scored out of 30 (features/judge.clan).
//!
//! Judge is gate C1 on the judgement port of `judgement-architecture.clan`, not a service. The rubric
//! (`judge_rubric.json`, a versioned file) holds thirty yes or no tests per kind of work: ten of the
//! idea, ten of the craft of that kind, ten of the effect. The middleware answers each test with pass
//! or fail and one line of evidence. **No model returns a number.** This module adds the passes up
//! ([`tally`]), applies the routing table ([`route_of`]) and writes one verdict decision in the work's
//! own file ([`score_outcome`]). The creative director's overrule is their own verdict that cites it
//! ([`overrule`]).
//!
//! **Judge advises, the creative director decides.** `judgement-architecture.clan` says a threshold may
//! only be compared against a calibrated score, and no calibrated backend exists. So each verdict says
//! its trust state (`none`, `shadow`, `earned`): until a recorded decision marks a Judge version as
//! earned, the route is advice, the team gets the notes, and the work still reaches the creative
//! director marked "Judge is not yet trusted here. Advice only." Nothing here is read by an operation
//! that approves, picks or sends to a client: the grep test at the foot holds that.
//!
//! **Judge reads client work, so what leaves is an allow list.** [`Prepared`] is built from the work's
//! named fields and the brief's named fields, never by removing the ones to hold back. Telemetry
//! ([`telemetry_row`]) holds ids, hashes, numbers, codes and what the creative director then did, and
//! no text of the work, no evidence and no reason.
//!
//! **Napkin never scores people.** A score belongs to a piece of work. Nothing here groups, counts or
//! orders by person, and a verdict holds the author of nothing.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use clan_sdk::{Decision, DecisionChain};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::ctx::Ctx;
use crate::document::Document;
use crate::error::{HostError, HostResult};
use crate::event::HostEvent;
use crate::store::{DocId, DocStore};

use super::assemble::{assemble, data_of, Members};
use super::gate::{SCRIPT_EDITOR, VISUAL_BRIEF};
use super::ideas::IDEA_ROOM;
use super::{read, review, Outcome};

/// The task the middleware answers, and the handler the decision names.
pub const TASK: &str = "judge_work";
pub const HANDLER: &str = "judge_work@1";
/// The agent a score is written under.
pub const AGENT: &str = "judge";
/// The action of a score and of an overrule.
pub const SCORE: &str = "score_work";
pub const OVERRULE: &str = "overrule_score";
/// The reason codes of the routes, and of an overrule.
pub const RETURN: &str = "judge.return";
pub const BRAVE: &str = "judge.brave";
pub const FORWARD: &str = "judge.forward";
pub const OVERRULED: &str = "judge.overruled";
/// The creative director's role on a verdict.
pub const CD_ROLE: &str = "creative-director";

/// Where the rule that 24 acts comes from, and the line the screen says while it does not.
pub const THRESHOLD: u32 = 24;
pub const BRAVE_IDEA: u32 = 9;
pub const NOT_TRUSTED: &str = "Judge is not yet trusted here. Advice only.";
/// What earns trust (the design's proposal): decided pieces, agreement and repeat.
pub const TRUST_DECIDED: usize = 60;
pub const TRUST_AGREEMENT: u32 = 80;
pub const TRUST_REPEAT: u32 = 95;
pub const CALIBRATION_LINE: &str = "The 24 is advice until Judge has earned trust: 60 decided pieces, Judge agreeing with the creative director on 80 percent of them, and the same answer on 95 percent of repeats.";

/// The environment variables a person sets: which backend scores, how far it is trusted, what a run costs.
pub const ENV_BACKEND: &str = "NAPKIN_JUDGE_BACKEND";
pub const ENV_TRUST: &str = "NAPKIN_JUDGE_TRUST";
pub const ENV_PRICE: &str = "NAPKIN_JUDGE_PRICE_EUR";

const RUBRIC_JSON: &str = include_str!("judge_rubric.json");

// ── the rubric ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct Test {
    pub id: String,
    pub dim: String,
    pub kind: Option<String>,
    pub method: String,
    pub question: String,
    #[serde(default)]
    pub reason_code: String,
}

#[derive(Debug, Deserialize)]
pub struct Rubric {
    pub version: String,
    pub tests: Vec<Test>,
}

/// The rubric this build holds. A file that does not parse is a build error, so this never fails at run time.
pub fn rubric() -> &'static Rubric {
    static R: OnceLock<Rubric> = OnceLock::new();
    R.get_or_init(|| serde_json::from_str(RUBRIC_JSON).expect("judge_rubric.json is valid"))
}

impl Rubric {
    /// The thirty tests of one kind of work, in rubric order: idea, then craft, then effect.
    pub fn tests_for(&self, kind: &str) -> Vec<&Test> {
        let mut out = Vec::new();
        for dim in DIMS {
            out.extend(
                self.tests
                    .iter()
                    .filter(|t| t.dim == dim && t.kind.as_deref().is_none_or(|k| k == kind)),
            );
        }
        out
    }
}

pub const DIMS: [&str; 3] = ["idea", "craft", "effect"];

// ── the kinds of work and what leaves ───────────────────────────────────────

/// A kind of work Judge scores: the app that holds it picks the kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Script,
    IdeaRoute,
    VisualBrief,
}

impl Kind {
    pub fn id(self) -> &'static str {
        match self {
            Kind::Script => "script",
            Kind::IdeaRoute => "idea_route",
            Kind::VisualBrief => "visual_brief",
        }
    }

    pub fn of(doc: &Document) -> Option<Kind> {
        match doc.clan().manifest().app.as_ref()?.app_id.as_str() {
            SCRIPT_EDITOR => Some(Kind::Script),
            IDEA_ROOM => Some(Kind::IdeaRoute),
            VISUAL_BRIEF => Some(Kind::VisualBrief),
            _ => None,
        }
    }
}

/// The fields of a script that leave, by name. The proposals (who marked what up), the hand-offs and the
/// carried brief stay.
const SCRIPT_KEYS: &[&str] = &["format", "slot_s", "proposition", "cast"];
const BEAT_KEYS: &[&str] = &[
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
const CHECK_KEYS: &[&str] = &["text", "source"];
const VISUAL_KEYS: &[&str] = &["proposition", "tone", "must_show", "never_show"];
const TERRITORY_KEYS: &[&str] = &["name", "line", "source"];
const FRAME_KEYS: &[&str] = &["caption", "asset"];
const CARD_KEYS: &[&str] = &["text", "kind"];
const LINK_KEYS: &[&str] = &["insight", "proposition"];

/// The brief's fields that leave, by name: the approved wording and nothing of how it was made (the
/// materials, the capture, the review, the passages, the signers, the client's name).
pub const BRIEF_FIELDS: &[&str] = &[
    "background",
    "objectives",
    "audience",
    "competitor_context",
    "insight",
    "single_minded_proposition",
    "job",
    "barrier",
    "objection",
    "reasons_to_believe",
    "desired_response",
    "tone_and_world",
    "measurement",
    "mandatories",
    "media_roles",
    "budget_and_scope",
];

/// `v` with only the named keys.
fn pick(v: &Value, keys: &[&str]) -> Value {
    let mut out = Map::new();
    if let Some(m) = v.as_object() {
        for k in keys {
            if let Some(x) = m.get(*k) {
                out.insert((*k).to_string(), x.clone());
            }
        }
    }
    Value::Object(out)
}

fn pick_each(v: Option<&Value>, keys: &[&str]) -> Value {
    Value::Array(
        v.and_then(Value::as_array)
            .map(|a| a.iter().map(|i| pick(i, keys)).collect())
            .unwrap_or_default(),
    )
}

/// One piece of work in a document: where it is addressed, and the content that leaves.
#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    /// The path part of the target address: `script`, `territory`, or `routes[<id>]`.
    pub key: String,
    pub kind: Kind,
    pub content: Value,
}

/// The pieces of work a document holds that Judge may score, each with its allow-listed content.
/// A script and a visual brief are one piece. An Idea room's pieces are its routes.
pub fn pieces(doc: &Document) -> Vec<Piece> {
    let Some(kind) = Kind::of(doc) else {
        return Vec::new();
    };
    let data = read::data_json(doc);
    match kind {
        Kind::Script => {
            let script = data.get("script").cloned().unwrap_or(Value::Null);
            let mut c = pick(&data, SCRIPT_KEYS);
            c["script"] = json!({ "beats": pick_each(script.get("beats"), BEAT_KEYS) });
            let checks = data.get("checks").cloned().unwrap_or(Value::Null);
            c["checks"] = json!({
                "mandatory": pick_each(checks.get("mandatory"), CHECK_KEYS),
                "banned": pick_each(checks.get("banned"), CHECK_KEYS),
            });
            vec![Piece {
                key: "script".into(),
                kind,
                content: c,
            }]
        }
        Kind::VisualBrief => {
            let mut c = pick(&data, VISUAL_KEYS);
            c["territory"] = pick(
                data.get("territory").unwrap_or(&Value::Null),
                TERRITORY_KEYS,
            );
            let frames = data.get("reference_frames").and_then(Value::as_object);
            let mut kept = Map::new();
            for slot in ["a", "b", "c"] {
                if let Some(f) = frames.and_then(|m| m.get(slot)) {
                    kept.insert(slot.into(), pick(f, FRAME_KEYS));
                }
            }
            c["reference_frames"] = Value::Object(kept);
            vec![Piece {
                key: "territory".into(),
                kind,
                content: c,
            }]
        }
        Kind::IdeaRoute => {
            let cards = data.get("cards").cloned().unwrap_or(Value::Null);
            let routes = data
                .get("routes")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            routes
                .iter()
                .map(|(id, r)| {
                    let listed: Vec<Value> = r
                        .get("cards")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>())
                        .unwrap_or_default()
                        .into_iter()
                        .filter_map(|cid| cards.get(cid))
                        .map(|card| {
                            let mut c = pick(card, CARD_KEYS);
                            c["brief_link"] =
                                pick(card.get("brief_link").unwrap_or(&Value::Null), LINK_KEYS);
                            let banned = card
                                .pointer("/tests/banned_match/banned")
                                .cloned()
                                .unwrap_or(Value::Null);
                            c["tests"] = if banned.is_null() {
                                json!({})
                            } else {
                                json!({ "banned_match": { "banned": banned } })
                            };
                            c
                        })
                        .collect();
                    Piece {
                        key: format!("routes[{id}]"),
                        kind,
                        content: json!({ "route": pick(r, &["name", "bet"]), "cards": listed }),
                    }
                })
                .collect()
        }
    }
}

/// The piece a request names: the script and the visual brief have one; an Idea room's is the route
/// named, else the route the creative director chose.
pub fn piece_for(doc: &Document, target: Option<&str>) -> HostResult<Piece> {
    let all = pieces(doc);
    let Some(kind) = Kind::of(doc) else {
        return Err(HostError::bad_request(
            "this document is not work Judge scores",
        ));
    };
    if kind != Kind::IdeaRoute {
        return all
            .into_iter()
            .next()
            .ok_or_else(|| HostError::bad_request("there is nothing here to score yet"));
    }
    let data = read::data_json(doc);
    let route = target
        .map(|t| {
            t.trim_start_matches("routes[")
                .trim_end_matches(']')
                .to_string()
        })
        .filter(|t| !t.is_empty())
        .or_else(|| {
            data.pointer("/chosen/route")
                .and_then(Value::as_str)
                .map(String::from)
        })
        .ok_or_else(|| {
            HostError::bad_request("choose a route first: Judge scores the chosen route")
        })?;
    let key = format!("routes[{route}]");
    all.into_iter()
        .find(|p| p.key == key)
        .ok_or_else(|| HostError::not_found(format!("{route} is not a route in this room")))
}

/// Whether there is anything written in the piece worth scoring (a script with no words is not).
fn has_words(p: &Piece) -> bool {
    fn any_text(v: &Value) -> bool {
        match v {
            Value::String(s) => !s.trim().is_empty(),
            Value::Array(a) => a.iter().any(any_text),
            Value::Object(m) => m.values().any(any_text),
            _ => false,
        }
    }
    match p.kind {
        Kind::Script => p.content["script"]["beats"]
            .as_array()
            .is_some_and(|b| b.iter().any(|x| any_text(&x["text"]))),
        _ => any_text(&p.content),
    }
}

/// A short hash of a value (sha256, the first 12 hex digits), over its canonical JSON.
fn hash_of(v: &Value) -> String {
    let h = clan_sdk::hash::sha256_prefixed(canonical(v).as_bytes());
    h.trim_start_matches("sha256:").chars().take(12).collect()
}

/// JSON with its keys in order, so the same words always hash the same.
fn canonical(v: &Value) -> String {
    match v {
        Value::Object(m) => {
            let sorted: BTreeMap<&String, &Value> = m.iter().collect();
            let parts: Vec<String> = sorted
                .into_iter()
                .map(|(k, x)| format!("{}:{}", Value::String(k.clone()), canonical(x)))
                .collect();
            format!("{{{}}}", parts.join(","))
        }
        Value::Array(a) => format!(
            "[{}]",
            a.iter().map(canonical).collect::<Vec<_>>().join(",")
        ),
        other => other.to_string(),
    }
}

/// The hash of a piece's work: its version for Judge. A new word is a new version.
pub fn work_hash(p: &Piece) -> String {
    hash_of(&json!({ "kind": p.kind.id(), "content": p.content }))
}

// ── the brief the work answers ──────────────────────────────────────────────

/// The brief behind a piece of work, as far as Judge reads it.
#[derive(Debug, Clone)]
pub struct BriefRef {
    /// Only the allow-listed fields.
    pub fields: Value,
    pub hash: String,
    /// The creative director the brief's signers name.
    pub creative_director: Option<String>,
    /// The brief's approve decision, when it holds one.
    pub lock: Option<String>,
    /// The brief's version number: its approvals, at least 1.
    pub version: usize,
    /// The brief has moved on since the work took it (a carried brief only).
    pub moved: bool,
}

fn signed_cd(brief: &Value) -> Option<String> {
    brief
        .get("signers")?
        .as_array()?
        .iter()
        .find(|s| s.get("role").and_then(Value::as_str) == Some("creative_director"))?
        .get("person")?
        .as_str()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
}

fn brief_ref_of(doc: &Document, data: &Value, moved: bool) -> BriefRef {
    let chain = review::chain_of(doc).unwrap_or_default();
    let id = doc.clan().document_id();
    let approvals = super::versions::approvals(&chain, id);
    let fields = pick(data, BRIEF_FIELDS);
    BriefRef {
        hash: hash_of(&fields),
        fields,
        creative_director: signed_cd(data),
        lock: review::lock_of(&chain, id).and_then(|d| d.id.clone()),
        version: approvals.len().max(1),
        moved,
    }
}

/// The brief a piece of work answers: the one it was made from and carries (the Idea room, the Visual
/// brief), else the job's own brief document in the store (a script written on a job).
pub fn brief_of(store: &dyn DocStore, ctx: &Ctx, doc: &Document) -> Option<BriefRef> {
    let data = read::data_json(doc);
    if let Some(carried) = data
        .get("upstream")
        .and_then(Value::as_object)
        .and_then(|u| u.values().find(|b| b.is_object()))
    {
        let moved = super::ideas::brief_status(store, ctx, doc)["changed"] == true;
        let mut r = brief_ref_of(doc, carried, moved);
        if let Some(cd) = signed_cd(carried) {
            r.creative_director = Some(cd);
        }
        r.lock = None;
        return Some(r);
    }
    let job = doc.clan().manifest().job.clone()?;
    let mut found: Option<Document> = None;
    for id in store.documents() {
        let Ok(bytes) = store.read(&id) else { continue };
        let Ok(d) = Document::from_bytes(id, bytes) else {
            continue;
        };
        if super::gate::applies(&d) && d.clan().manifest().job.as_deref() == Some(job.as_str()) {
            let better = found.as_ref().is_none_or(|f| {
                super::versions::approved_count(&d) >= super::versions::approved_count(f)
            });
            if better {
                found = Some(d);
            }
        }
    }
    let b = found?;
    Some(brief_ref_of(&b, &read::data_json(&b), false))
}

// ── what is asked, and how it is answered ───────────────────────────────────

/// Everything one score needs, built from the document: the request that leaves, and what the verdict
/// will say about what it was scored on.
#[derive(Debug, Clone)]
pub struct Prepared {
    pub piece: Piece,
    pub work_hash: String,
    pub brief: BriefRef,
    pub doc_id: String,
}

/// Whether the document's app declares the `judge_work` task in its `app/pipeline.yaml`: a tool sends
/// work to Judge by declaring it there, and no other document is scored.
pub fn declares(doc: &Document) -> bool {
    doc.clan()
        .read_entry("app/pipeline.yaml")
        .ok()
        .and_then(|b| serde_yaml::from_slice::<serde_yaml::Value>(&b).ok())
        .and_then(|y| y.get("tasks").and_then(|t| t.get(TASK)).cloned())
        .is_some_and(|t| !t.is_null())
}

/// The document's piece and brief, or the reason there is nothing to score.
pub fn prepare(
    store: &dyn DocStore,
    ctx: &Ctx,
    doc: &Document,
    target: Option<&str>,
) -> HostResult<Prepared> {
    if !declares(doc) {
        return Err(HostError::bad_request(
            "this document's app does not send work to Judge",
        ));
    }
    let piece = piece_for(doc, target)?;
    if !has_words(&piece) {
        return Err(HostError::bad_request(
            "there is nothing written to score yet",
        ));
    }
    let brief = brief_of(store, ctx, doc).ok_or_else(|| {
        HostError::conflict("Judge scores work against its brief, and this job has none yet")
    })?;
    Ok(Prepared {
        work_hash: work_hash(&piece),
        piece,
        brief,
        doc_id: doc.clan().document_id().to_string(),
    })
}

impl Prepared {
    /// The body of the middleware request: the work, the approved brief fields and the rubric version.
    /// The `clan` names the document and its version and carries no content.
    pub fn request(&self, doc_version: &str) -> Value {
        json!({
            "request_kind": "middleware",
            "payload": {
                "task": TASK,
                "input": {
                    "work": { "kind": self.piece.kind.id(), "content": self.piece.content },
                    "brief": self.brief.fields,
                    "rubric_version": rubric().version,
                },
            },
            "clan": { "id": self.doc_id, "version": doc_version },
        })
    }
}

/// One test, answered and counted.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TestResult {
    pub id: String,
    pub dim: String,
    pub method: String,
    pub question: String,
    /// `pass` or `fail`.
    pub value: String,
    pub evidence: String,
    pub reason_code: String,
}

/// The passes added up, in code.
#[derive(Debug, Clone, PartialEq)]
pub struct Tally {
    pub total: u32,
    pub idea: u32,
    pub craft: u32,
    pub effect: u32,
    pub tests: Vec<TestResult>,
}

fn malformed(why: impl Into<String>) -> HostError {
    HostError::new(502, format!("judge_malformed: {}", why.into()))
}

/// Count the passes. The reply must hold exactly the rubric's tests for this kind of work, each once,
/// each pass or fail, each with its evidence: a missing, a doubled or an unknown test, or a value that
/// is not pass or fail, is an error and never a pass.
pub fn tally(kind: Kind, answered: &[Value]) -> HostResult<Tally> {
    let want = rubric().tests_for(kind.id());
    let mut by_id: BTreeMap<&str, &Value> = BTreeMap::new();
    for a in answered {
        let Some(id) = a.get("id").and_then(Value::as_str) else {
            return Err(malformed("a test answer has no id"));
        };
        if by_id.insert(id, a).is_some() {
            return Err(malformed(format!("test {id} is answered twice")));
        }
    }
    if let Some(extra) = by_id.keys().find(|id| !want.iter().any(|t| t.id == **id)) {
        return Err(malformed(format!("{extra} is not a test of this rubric")));
    }
    let mut out = Vec::with_capacity(want.len());
    let (mut idea, mut craft, mut effect) = (0, 0, 0);
    for t in want {
        let Some(a) = by_id.get(t.id.as_str()) else {
            return Err(malformed(format!("test {} is missing", t.id)));
        };
        let pass = match a.get("value").and_then(Value::as_str) {
            Some("pass") => true,
            Some("fail") => false,
            _ => return Err(malformed(format!("test {} is neither pass nor fail", t.id))),
        };
        let evidence = a
            .get("evidence")
            .and_then(Value::as_str)
            .map(|e| e.trim().replace(['\n', '\r'], " "))
            .unwrap_or_default();
        if evidence.is_empty() {
            return Err(malformed(format!("test {} has no evidence", t.id)));
        }
        if pass {
            match t.dim.as_str() {
                "idea" => idea += 1,
                "craft" => craft += 1,
                _ => effect += 1,
            }
        }
        out.push(TestResult {
            id: t.id.clone(),
            dim: t.dim.clone(),
            method: t.method.clone(),
            question: t.question.clone(),
            value: if pass { "pass" } else { "fail" }.into(),
            evidence,
            reason_code: if pass {
                "pass".into()
            } else {
                t.reason_code.clone()
            },
        });
    }
    Ok(Tally {
        total: idea + craft + effect,
        idea,
        craft,
        effect,
        tests: out,
    })
}

// ── the routing, in code and nothing else ───────────────────────────────────

/// Where a score advises the work goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// Back to the team with the notes.
    Team,
    /// To the creative director, marked "Brave, fix the craft".
    CdBrave,
    /// To the creative director.
    Cd,
}

impl Route {
    pub fn id(self) -> &'static str {
        match self {
            Route::Team => "team",
            Route::CdBrave => "cd_brave",
            Route::Cd => "cd",
        }
    }

    pub fn parse(s: &str) -> Option<Route> {
        match s {
            "team" => Some(Route::Team),
            "cd_brave" => Some(Route::CdBrave),
            "cd" => Some(Route::Cd),
            _ => None,
        }
    }

    pub fn reason_code(self) -> &'static str {
        match self {
            Route::Team => RETURN,
            Route::CdBrave => BRAVE,
            Route::Cd => FORWARD,
        }
    }
}

/// The routing table: under 24 and idea under 9 returns to the team; under 24 with idea 9 or 10 goes to
/// the creative director, Brave; 24 or more goes to the creative director.
pub fn route_of(total: u32, idea: u32) -> Route {
    if total >= THRESHOLD {
        Route::Cd
    } else if idea >= BRAVE_IDEA {
        Route::CdBrave
    } else {
        Route::Team
    }
}

// ── trust ───────────────────────────────────────────────────────────────────

/// How far Judge's number is trusted for a Judge version: `none` (nothing set), `shadow` (scored and
/// recorded, advice only) or `earned` (a recorded decision marked this version earned).
/// `NAPKIN_JUDGE_TRUST` is `shadow`, or `earned:<judge version>`; a different version starts at shadow.
pub fn trust_for(judge_version: &str) -> &'static str {
    trust_in(
        std::env::var(ENV_TRUST).ok().as_deref().unwrap_or(""),
        judge_version,
    )
}

pub fn trust_in(setting: &str, judge_version: &str) -> &'static str {
    let s = setting.trim();
    if let Some(v) = s.strip_prefix("earned:") {
        return if v.trim() == judge_version {
            "earned"
        } else {
            "shadow"
        };
    }
    if s.eq_ignore_ascii_case("shadow") {
        "shadow"
    } else {
        "none"
    }
}

/// The backend a person set, or none: unset (or `jev`, which is not built) is not set up.
pub fn backend_set() -> Option<String> {
    match std::env::var(ENV_BACKEND)
        .ok()
        .map(|v| v.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some(b @ ("fixture" | "llm-judge")) => Some(b.to_string()),
        _ => None,
    }
}

/// What one run costs, as a person set it (euro), shown before the run.
pub fn price_set() -> Option<f64> {
    std::env::var(ENV_PRICE)
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|p| p.is_finite() && *p >= 0.0)
}

/// What the middleware's refusals mean to the person: the status and the plain line. `None` for an
/// error that is not a refusal.
pub fn refusal(kind: &str) -> Option<(u16, &'static str)> {
    match kind {
        "ai_off" => Some((
            403,
            "ai_off: AI is switched off for this client, so Judge cannot read its work.",
        )),
        "not_eu" => Some((
            403,
            "not_eu: Judge's model route is not pinned to the EU, so it will not read client work.",
        )),
        "not_configured" | "no_middleware" => {
            Some((503, "not_configured: Judge is not set up here."))
        }
        "spend_refused" => Some((
            429,
            "spend_refused: the spend cap stops this run before it starts.",
        )),
        _ => None,
    }
}

// ── the verdict ─────────────────────────────────────────────────────────────

/// What the middleware reported about itself: the Judge version's parts.
#[derive(Debug, Clone, Default)]
pub struct Answered {
    pub handler: String,
    pub backend: String,
    pub model: Option<String>,
    pub prompt_hash: Option<String>,
    pub rubric_version: String,
    pub price_eur: f64,
}

impl Answered {
    /// `rubric-<v>/<backend>/<model or none>/<prompt hash or none>`: the version a trust decision names.
    pub fn judge_version(&self) -> String {
        format!(
            "rubric-{}/{}/{}/{}",
            self.rubric_version,
            self.backend,
            self.model.as_deref().unwrap_or("none"),
            self.prompt_hash.as_deref().unwrap_or("none"),
        )
    }
}

/// Read the middleware's reply (the envelope's `data`): the tests, and who answered.
pub fn read_reply(data: &Value) -> HostResult<(Vec<Value>, Answered)> {
    let result = data
        .get("result")
        .ok_or_else(|| malformed("the reply holds no result"))?;
    let tests = result
        .get("tests")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| malformed("the reply holds no tests"))?;
    let s = |k: &str| result.get(k).and_then(Value::as_str).map(String::from);
    let a = Answered {
        handler: data
            .get("handler")
            .and_then(Value::as_str)
            .unwrap_or("judge_work@1.0")
            .to_string(),
        backend: s("backend").ok_or_else(|| malformed("the reply names no backend"))?,
        model: s("model"),
        prompt_hash: s("prompt_hash"),
        rubric_version: s("rubric_version").unwrap_or_default(),
        price_eur: result
            .get("price_eur")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    };
    if a.rubric_version != rubric().version {
        return Err(malformed(format!(
            "the reply was scored under rubric {:?}; this host holds rubric {}",
            a.rubric_version,
            rubric().version
        )));
    }
    Ok((tests, a))
}

fn doc_address(doc: &Document, path: &str) -> String {
    format!("{}#{}", doc.clan().document_id(), path)
}

/// The notes in one line: the score, then what failed, by name.
fn notes(t: &Tally) -> String {
    let failed: Vec<&str> = t
        .tests
        .iter()
        .filter(|x| x.value == "fail")
        .map(|x| x.question.as_str())
        .collect();
    let head = format!(
        "{} of 30: idea {}, craft {}, effect {}.",
        t.total, t.idea, t.craft, t.effect
    );
    if failed.is_empty() {
        head
    } else {
        format!("{head} Not passed: {}", failed.join(" "))
    }
}

/// The verdict block (`docs/contracts/judge-verdict.schema.json`, `judge`).
fn block(p: &Prepared, t: &Tally, a: &Answered, route: Route, trust: &str) -> Value {
    json!({
        "schema": 1,
        "version": a.judge_version(),
        "rubric_version": a.rubric_version,
        "prompt_hash": a.prompt_hash,
        "backend": a.backend,
        "model": a.model,
        "total": t.total,
        "sub": { "idea": t.idea, "craft": t.craft, "effect": t.effect },
        "tests": t.tests.iter().map(|x| json!({
            "id": x.id, "dim": x.dim, "method": x.method, "question": x.question, "value": x.value,
            "evidence": x.evidence, "reason_code": x.reason_code,
        })).collect::<Vec<_>>(),
        "advised_route": route.id(),
        "trust": trust,
        "brief_version": p.brief.version.to_string(),
        "brief_hash": p.brief.hash,
        "work_kind": p.piece.kind.id(),
        "work_hash": p.work_hash,
        "piece": p.piece.key,
        "price_eur": a.price_eur,
    })
}

fn to_yaml(v: &Value) -> HostResult<serde_yaml::Value> {
    serde_yaml::to_value(v).map_err(|e| HostError::internal(e.to_string()))
}

fn write(doc: &Document, d: Decision, reply: Value, delta: &str) -> HostResult<Outcome> {
    let clan = doc.clan();
    let now = review::now();
    let id = d.id.clone().unwrap_or_default();
    let bytes = assemble(
        clan,
        data_of(clan)?,
        Members::of(clan)?,
        vec![d],
        delta,
        &now,
        false,
    )?;
    let notice = json!({ "ok": true, "source": "judge", "kind": "verdict", "decision": id });
    let change = doc
        .change(bytes)?
        .with_event(HostEvent::DataChanged(notice));
    Ok(Outcome::changed(reply, change))
}

/// Write one score as one verdict decision in the work's own file. The decision's version is the work's
/// hash, so a new word is a new version and an older score stays on its older version. The score field
/// is empty, as the judgement port asks of a backend that explains (it holds no calibrated number).
pub fn score_outcome(
    ctx: &Ctx,
    doc: &Document,
    p: &Prepared,
    t: &Tally,
    a: &Answered,
    trust: &str,
) -> HostResult<Outcome> {
    let route = route_of(t.total, t.idea);
    let now = review::now();
    let mut d = review::decided(
        ctx,
        AGENT,
        "verdict",
        SCORE,
        vec![doc_address(doc, &p.piece.key)],
        p.brief.lock.iter().cloned().collect(),
        notes(t),
        &now,
    );
    d.handler = Some(a.handler.clone());
    d.backend = Some(a.backend.clone());
    d.version = Some(p.work_hash.clone());
    // No polarity: a bad verdict stops a lock (decisions.rs, bad_verdict) and a good one answers someone else's bad one.
    // Judge's route is advice and says so in `reason_code` and the judge block; it never blocks and never answers a person.
    d.reason_code = Some(route.reason_code().into());
    d.taxonomy_version = Some(a.rubric_version.clone());
    d.extra
        .insert("judge".into(), to_yaml(&block(p, t, a, route, trust))?);
    let id = d.id.clone();
    let reply = json!({ "ok": true, "decision": id, "total": t.total, "route": route.id() });
    write(doc, d, reply, "a piece of work scored")
}

// ── reading the scores back ─────────────────────────────────────────────────

/// A score and what came after it, read from a chain.
#[derive(Debug, Clone)]
pub struct ScoreEntry {
    pub id: String,
    pub at: String,
    pub piece: String,
    pub version: String,
    pub block: Value,
    pub overrule: Option<OverruleEntry>,
    /// What the creative director then did: `kept`, `returned`, or nothing yet.
    pub decided: Option<&'static str>,
}

#[derive(Debug, Clone)]
pub struct OverruleEntry {
    pub id: String,
    pub at: String,
    pub route: Route,
    pub reason: String,
}

fn judge_block(d: &Decision) -> Option<Value> {
    d.extra
        .get("judge")
        .and_then(|v| serde_json::to_value(v).ok())
        .filter(Value::is_object)
}

fn is_score(d: &Decision) -> bool {
    d.superseded_by.is_none()
        && d.kind.as_deref() == Some("verdict")
        && d.agent == AGENT
        && d.action == SCORE
}

fn is_overrule(d: &Decision) -> bool {
    d.superseded_by.is_none()
        && d.kind.as_deref() == Some("verdict")
        && d.reason_code.as_deref() == Some(OVERRULED)
}

/// Every score in a chain, newest first, with the overrule that cites it and what the creative director
/// then did. A person's decision after the score: an overrule (its route says kept or returned), or an
/// approve of the document, or the pick of the route, after the score was written.
pub fn scores_in(chain: &DecisionChain, doc_id: &str) -> Vec<ScoreEntry> {
    let mut out = Vec::new();
    for (i, d) in chain.decisions.iter().enumerate() {
        if !is_score(d) {
            continue;
        }
        let (Some(id), Some(block)) = (d.id.clone(), judge_block(d)) else {
            continue;
        };
        let piece = d
            .targets
            .first()
            .and_then(|t| t.split_once('#').map(|(_, p)| p.to_string()))
            .unwrap_or_default();
        let overrule = chain.decisions[..i]
            .iter()
            .rev()
            .find(|o| is_overrule(o) && o.cites.iter().any(|c| *c == id))
            .and_then(|o| {
                let route = o
                    .extra
                    .get("judge")
                    .and_then(|j| j.get("route"))
                    .and_then(|r| r.as_str())
                    .and_then(Route::parse)?;
                Some(OverruleEntry {
                    id: o.id.clone().unwrap_or_default(),
                    at: o.timestamp.clone(),
                    route,
                    reason: o.rationale.clone(),
                })
            });
        let decided = match &overrule {
            Some(o) if o.route == Route::Team => Some("returned"),
            Some(_) => Some("kept"),
            None => chain.decisions[..i]
                .iter()
                .any(|n| {
                    n.superseded_by.is_none()
                        && match n.kind.as_deref() {
                            Some("approve") => n.targets.iter().any(|t| t == doc_id),
                            Some("verdict") => {
                                n.action == "pick_route"
                                    && n.targets.iter().any(|t| t.ends_with(&format!("#{piece}")))
                            }
                            _ => false,
                        }
                })
                .then_some("kept"),
        };
        out.push(ScoreEntry {
            id,
            at: d.timestamp.clone(),
            piece,
            version: d.version.clone().unwrap_or_default(),
            block,
            overrule,
            decided,
        });
    }
    out
}

fn num(v: &Value, ptr: &str) -> u32 {
    v.pointer(ptr).and_then(Value::as_u64).unwrap_or(0) as u32
}

fn text(v: &Value, ptr: &str) -> String {
    v.pointer(ptr)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

impl ScoreEntry {
    pub fn advised(&self) -> Route {
        Route::parse(&text(&self.block, "/advised_route")).unwrap_or(Route::Team)
    }

    /// Where the work goes now: the creative director's overrule, else Judge's advice.
    pub fn effective(&self) -> Route {
        self.overrule.as_ref().map_or(self.advised(), |o| o.route)
    }
}

// ── what the index holds ────────────────────────────────────────────────────

/// The latest score of one piece of work, as the job index holds it. Numbers, ids and codes: no test
/// text, no evidence, no reason, and no field for a person (a test seeds the struct and checks).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PieceScore {
    /// The document it is in (its path) and its title.
    pub doc: String,
    pub title: String,
    pub piece: String,
    pub kind: String,
    pub score: String,
    pub at: String,
    pub total: u32,
    pub idea: u32,
    pub craft: u32,
    pub effect: u32,
    pub advised_route: String,
    /// Where it goes now: the creative director's overrule, else Judge's advice.
    pub route: String,
    pub brave: bool,
    pub trust: String,
    pub overruled: bool,
    /// `kept` or `returned` once the creative director has decided, else none.
    pub decided: Option<String>,
    /// The work is still the version that was scored.
    pub current: bool,
}

/// The latest score of each piece in `doc`, newest piece first as the chain gives them.
pub fn piece_scores(doc: &Document) -> Vec<PieceScore> {
    if Kind::of(doc).is_none() {
        return Vec::new();
    }
    let Ok(chain) = review::chain_of(doc) else {
        return Vec::new();
    };
    let doc_id = doc.clan().document_id().to_string();
    let entries = scores_in(&chain, &doc_id);
    if entries.is_empty() {
        return Vec::new();
    }
    let now: BTreeMap<String, String> = pieces(doc)
        .into_iter()
        .map(|p| {
            let h = work_hash(&p);
            (p.key, h)
        })
        .collect();
    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for e in entries {
        if seen.contains(&e.piece) {
            continue;
        }
        seen.push(e.piece.clone());
        let route = e.effective();
        out.push(PieceScore {
            doc: doc.id().to_string(),
            title: doc.clan().manifest().title.clone(),
            piece: e.piece.clone(),
            kind: text(&e.block, "/work_kind"),
            score: e.id.clone(),
            at: e.at.clone(),
            total: num(&e.block, "/total"),
            idea: num(&e.block, "/sub/idea"),
            craft: num(&e.block, "/sub/craft"),
            effect: num(&e.block, "/sub/effect"),
            advised_route: e.advised().id().into(),
            route: route.id().into(),
            brave: e.advised() == Route::CdBrave,
            trust: text(&e.block, "/trust"),
            overruled: e.overrule.is_some(),
            decided: e.decided.map(String::from),
            current: now.get(&e.piece).is_some_and(|h| *h == e.version),
        });
    }
    out
}

/// The dashboard's Judge tile: counts of pieces, and nothing grouped by person.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ScoreTile {
    pub scored: usize,
    /// The average total of the pieces, one decimal.
    pub average: f64,
    pub under_24: usize,
    pub at_27: usize,
    pub brave: usize,
    pub overruled: usize,
    /// How many more decided pieces the set needs before trust can be earned.
    pub awaiting_set: usize,
    /// The same, job by job.
    pub jobs: Vec<JobScores>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct JobScores {
    pub number: String,
    pub client: String,
    pub client_id: String,
    pub scored: usize,
    pub average: f64,
    pub under_24: usize,
    pub at_27: usize,
    pub brave: usize,
    pub overruled: usize,
}

fn mean(totals: &[u32]) -> f64 {
    if totals.is_empty() {
        return 0.0;
    }
    let s: u32 = totals.iter().sum();
    ((f64::from(s) / totals.len() as f64) * 10.0).round() / 10.0
}

/// The tile from every job's pieces: `(job number, client name, client id, pieces)`.
pub fn tile(jobs: &[(&str, &str, &str, &[PieceScore])]) -> Option<ScoreTile> {
    let all: Vec<&PieceScore> = jobs.iter().flat_map(|j| j.3.iter()).collect();
    if all.is_empty() {
        return None;
    }
    let count =
        |f: &dyn Fn(&PieceScore) -> bool, set: &[&PieceScore]| set.iter().filter(|p| f(p)).count();
    let totals: Vec<u32> = all.iter().map(|p| p.total).collect();
    let decided = count(&|p| p.decided.is_some(), &all);
    let per_job = jobs
        .iter()
        .filter(|j| !j.3.is_empty())
        .map(|j| {
            let set: Vec<&PieceScore> = j.3.iter().collect();
            let t: Vec<u32> = set.iter().map(|p| p.total).collect();
            JobScores {
                number: j.0.into(),
                client: j.1.into(),
                client_id: j.2.into(),
                scored: set.len(),
                average: mean(&t),
                under_24: count(&|p| p.total < THRESHOLD, &set),
                at_27: count(&|p| p.total >= 27, &set),
                brave: count(&|p| p.brave, &set),
                overruled: count(&|p| p.overruled, &set),
            }
        })
        .collect();
    Some(ScoreTile {
        scored: all.len(),
        average: mean(&totals),
        under_24: count(&|p| p.total < THRESHOLD, &all),
        at_27: count(&|p| p.total >= 27, &all),
        brave: count(&|p| p.brave, &all),
        overruled: count(&|p| p.overruled, &all),
        awaiting_set: TRUST_DECIDED.saturating_sub(decided),
        jobs: per_job,
    })
}

// ── the card ────────────────────────────────────────────────────────────────

fn route_line(route: Route, trust: &str, overruled: bool) -> String {
    let base = match route {
        Route::Team => "Back to the team with the notes.",
        Route::CdBrave => "To the creative director: Brave, fix the craft.",
        Route::Cd => "To the creative director.",
    };
    if overruled {
        format!("The creative director overruled Judge. {base}")
    } else if trust == "earned" {
        base.to_string()
    } else {
        format!("Advised: {} {NOT_TRUSTED}", base.to_lowercase_first())
    }
}

trait LowerFirst {
    fn to_lowercase_first(&self) -> String;
}
impl LowerFirst for str {
    fn to_lowercase_first(&self) -> String {
        let mut c = self.chars();
        match c.next() {
            Some(f) => f.to_lowercase().collect::<String>() + c.as_str(),
            None => String::new(),
        }
    }
}

/// Failed tests first (stable inside each), so a person sees why it is a 22 and not a 26.
fn failed_first(tests: &[Value]) -> Vec<Value> {
    let mut v: Vec<Value> = tests.to_vec();
    v.sort_by_key(|t| t.get("value").and_then(Value::as_str) == Some("pass"));
    v
}

fn card_of(e: &ScoreEntry, current: bool, brief_moved: bool) -> Value {
    let trust = text(&e.block, "/trust");
    let route = e.effective();
    json!({
        "id": e.id, "at": e.at, "version": e.version, "current": current,
        "out_of_date": brief_moved,
        "total": num(&e.block, "/total"),
        "sub": { "idea": num(&e.block, "/sub/idea"), "craft": num(&e.block, "/sub/craft"), "effect": num(&e.block, "/sub/effect") },
        "tests": failed_first(e.block.get("tests").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])),
        "advised_route": e.advised().id(),
        "route": route.id(),
        "brave": e.advised() == Route::CdBrave,
        "route_line": route_line(route, &trust, e.overrule.is_some()),
        "trust": trust,
        "judge_version": text(&e.block, "/version"),
        "overruled": e.overrule.as_ref().map(|o| json!({ "route": o.route.id(), "at": o.at, "reason": o.reason })),
        "decided": e.decided,
    })
}

/// The setup, as the screen needs it before a run: the backend, the price, the trust and what earns it.
pub fn setup_view() -> Value {
    let backend = backend_set();
    json!({
        "backend": backend,
        "configured": backend.is_some(),
        "price_eur": price_set(),
        "trust": trust_for("-"),
        "not_trusted": NOT_TRUSTED,
        "calibration": CALIBRATION_LINE,
        "rubric_version": rubric().version,
    })
}

/// `GET /judge`: what the score card draws. The latest score of the piece (and its older ones), whether
/// it is for the version of the work that stands now, whether the brief moved on since, who may overrule.
pub fn card(
    store: &dyn DocStore,
    ctx: &Ctx,
    doc: &Document,
    target: Option<&str>,
) -> HostResult<Value> {
    let Some(kind) = Kind::of(doc) else {
        return Err(HostError::bad_request(
            "this document is not work Judge scores",
        ));
    };
    let all = pieces(doc);
    let piece = piece_for(doc, target).ok();
    let chain = review::chain_of(doc)?;
    let doc_id = doc.clan().document_id().to_string();
    let entries = scores_in(&chain, &doc_id);
    let mine: Vec<&ScoreEntry> = entries
        .iter()
        .filter(|e| piece.as_ref().is_some_and(|p| e.piece == p.key))
        .collect();
    let brief = brief_of(store, ctx, doc);
    let now_hash = piece.as_ref().map(work_hash);
    let latest = mine.first().map(|e| {
        let current = now_hash.as_deref() == Some(e.version.as_str());
        let moved = brief.as_ref().is_some_and(|b| {
            b.moved || (!b.hash.is_empty() && text(&e.block, "/brief_hash") != b.hash)
        });
        card_of(e, current, moved)
    });
    let cd = brief.as_ref().and_then(|b| b.creative_director.clone());
    let me = ctx.actor.as_str().strip_prefix("human:").unwrap_or("");
    let ready = piece.as_ref().is_some_and(has_words);
    let why_not = if !declares(doc) {
        Some("This tool does not send work to Judge.")
    } else if piece.is_none() {
        Some(if kind == Kind::IdeaRoute {
            "Choose a route first. Judge scores the chosen route."
        } else {
            "There is nothing here to score yet."
        })
    } else if !ready {
        Some("Write something first. Judge scores what is on the page.")
    } else if brief.is_none() {
        Some("Judge scores work against its brief, and this job has none yet.")
    } else {
        None
    };
    Ok(json!({
        "ok": true,
        "kind": kind.id(),
        "piece": piece.as_ref().map(|p| p.key.clone()),
        "pieces": all.iter().map(|p| p.key.clone()).collect::<Vec<_>>(),
        "can_score": why_not.is_none(),
        "why_not": why_not,
        "setup": setup_view(),
        "score": latest,
        "older": mine.iter().skip(1).map(|e| json!({
            "id": e.id, "at": e.at, "total": num(&e.block, "/total"), "version": e.version,
            "route": e.effective().id(),
        })).collect::<Vec<_>>(),
        "can_overrule": !me.is_empty() && cd.as_deref() == Some(me),
        "creative_director_named": cd.is_some(),
    }))
}

// ── the creative director's overrule ────────────────────────────────────────

/// `POST /judge/overrule {reason, route?, score?, target?}`: the creative director named on the brief
/// answers a score with their own verdict, which cites Judge's. Judge's verdict stays as it was. A
/// written reason is required. The route defaults to the other one: a score that sent the work to the
/// team is overruled to the creative director, and the reverse.
pub fn overrule(
    store: &dyn DocStore,
    ctx: &Ctx,
    doc: &Document,
    body: &Value,
) -> HostResult<Outcome> {
    let who = review::person(ctx, "overrule Judge")?;
    if Kind::of(doc).is_none() {
        return Err(HostError::bad_request(
            "this document is not work Judge scores",
        ));
    }
    let brief = brief_of(store, ctx, doc);
    let me = who.strip_prefix("human:").unwrap_or(&who);
    match brief.as_ref().and_then(|b| b.creative_director.as_deref()) {
        Some(cd) if cd == me => {}
        Some(cd) => {
            return Err(HostError::new(
                403,
                format!("only {cd}, the creative director named on the brief, can overrule Judge"),
            ))
        }
        None => {
            return Err(HostError::new(
                403,
                "the brief names no creative director, so nobody can overrule Judge",
            ))
        }
    }
    let reason = body
        .get("reason")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if reason.is_empty() {
        return Err(HostError::bad_request(
            "an overrule needs a written reason: say why",
        ));
    }
    if reason.chars().count() > 4000 {
        return Err(HostError::bad_request("the reason is too long"));
    }
    let chain = review::chain_of(doc)?;
    let doc_id = doc.clan().document_id().to_string();
    let entries = scores_in(&chain, &doc_id);
    let wanted = body.get("score").and_then(Value::as_str);
    let piece = body.get("target").and_then(Value::as_str);
    let key = if wanted.is_none() {
        Some(piece_for(doc, piece)?.key)
    } else {
        None
    };
    let score = entries
        .iter()
        .find(|e| match (wanted, &key) {
            (Some(id), _) => e.id == id,
            (None, Some(k)) => &e.piece == k,
            _ => false,
        })
        .ok_or_else(|| HostError::not_found("there is no Judge score here to overrule"))?;
    let route = match body.get("route").and_then(Value::as_str) {
        Some(r) => match Route::parse(r) {
            Some(Route::Team) => Route::Team,
            Some(_) => Route::Cd,
            None => return Err(HostError::bad_request("`route` is team or cd")),
        },
        None => {
            if score.effective() == Route::Team {
                Route::Cd
            } else {
                Route::Team
            }
        }
    };
    let now = review::now();
    let mut d = review::decided(
        ctx,
        &who,
        "verdict",
        OVERRULE,
        vec![doc_address(doc, &score.piece)],
        vec![score.id.clone()],
        reason.to_string(),
        &now,
    );
    d.polarity = Some(if route == Route::Team { "bad" } else { "good" }.into());
    d.reason_code = Some(OVERRULED.into());
    d.reviewer_role = Some(CD_ROLE.into());
    d.version = Some(score.version.clone());
    d.taxonomy_version = Some(rubric().version.clone());
    d.extra
        .insert("judge".into(), to_yaml(&json!({ "route": route.id() }))?);
    let id = d.id.clone();
    write(
        doc,
        d,
        json!({ "ok": true, "decision": id, "route": route.id(), "overrules": score.id }),
        "a Judge score overruled",
    )
}

// ── telemetry: what leaves the vault ────────────────────────────────────────

/// One telemetry row, built from an allow list: ids, hashes, numbers, test ids with pass or fail, codes,
/// the route, the trust state, what the creative director then did, and cost. It holds no evidence line,
/// no reason, no title and no name.
pub fn telemetry_row(doc_id: &str, job: &str, e: &ScoreEntry) -> Value {
    let b = &e.block;
    json!({
        "schema": 1,
        "doc": doc_id,
        "piece": e.piece,
        "job": job,
        "score_id": e.id,
        "at": e.at,
        "rubric_version": text(b, "/rubric_version"),
        "judge_version": text(b, "/version"),
        "backend": text(b, "/backend"),
        "work_kind": text(b, "/work_kind"),
        "work_hash": text(b, "/work_hash"),
        "brief_hash": text(b, "/brief_hash"),
        "total": num(b, "/total"),
        "sub": { "idea": num(b, "/sub/idea"), "craft": num(b, "/sub/craft"), "effect": num(b, "/sub/effect") },
        "tests": b.get("tests").and_then(Value::as_array).map(|a| a.iter().map(|t| json!({
            "id": text(t, "/id"), "value": text(t, "/value"),
            "method": text(t, "/method"), "reason_code": text(t, "/reason_code"),
        })).collect::<Vec<_>>()).unwrap_or_default(),
        "advised_route": text(b, "/advised_route"),
        "trust": text(b, "/trust"),
        "cost_eur": b.pointer("/price_eur").and_then(Value::as_f64).unwrap_or(0.0),
        "then": {
            "decision": e.decided.unwrap_or("none"),
            "overruled": e.overrule.is_some(),
        },
    })
}

/// Every score of every document in the store, as telemetry rows. Computed from the chains; kept nowhere.
pub fn telemetry_rows(store: &dyn DocStore) -> Vec<Value> {
    let mut rows = Vec::new();
    for id in store.documents() {
        rows.extend(telemetry_of(store, &id));
    }
    rows
}

fn telemetry_of(store: &dyn DocStore, id: &DocId) -> Vec<Value> {
    let Ok(bytes) = store.read(id) else {
        return Vec::new();
    };
    let Ok(doc) = Document::from_bytes(id.clone(), bytes) else {
        return Vec::new();
    };
    if Kind::of(&doc).is_none() {
        return Vec::new();
    }
    let Ok(chain) = review::chain_of(&doc) else {
        return Vec::new();
    };
    let doc_id = doc.clan().document_id().to_string();
    let job = doc.clan().manifest().job.clone().unwrap_or_default();
    scores_in(&chain, &doc_id)
        .iter()
        .map(|e| telemetry_row(&doc_id, &job, e))
        .collect()
}

// ── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn answers(kind: Kind, fail: &[&str]) -> Vec<Value> {
        rubric()
            .tests_for(kind.id())
            .iter()
            .map(|t| {
                json!({
                    "id": t.id,
                    "value": if fail.contains(&t.id.as_str()) { "fail" } else { "pass" },
                    "evidence": format!("evidence for {}", t.id),
                })
            })
            .collect()
    }

    #[test]
    fn the_rubric_has_ten_tests_per_dimension_per_kind_with_unique_ids() {
        let r = rubric();
        let mut ids = std::collections::BTreeSet::new();
        for t in &r.tests {
            assert!(ids.insert(t.id.clone()), "{} twice", t.id);
            assert!(t.method == "code" || t.method == "llm", "{}", t.id);
            assert!(DIMS.contains(&t.dim.as_str()));
            assert!(!t.reason_code.is_empty());
        }
        for kind in ["script", "idea_route", "visual_brief"] {
            let set = r.tests_for(kind);
            assert_eq!(set.len(), 30, "{kind}");
            for d in DIMS {
                assert_eq!(set.iter().filter(|t| t.dim == d).count(), 10, "{kind} {d}");
            }
        }
    }

    #[test]
    fn ten_passes_in_each_dimension_is_thirty_and_each_failure_takes_one_off() {
        let t = tally(Kind::Script, &answers(Kind::Script, &[])).unwrap();
        assert_eq!((t.total, t.idea, t.craft, t.effect), (30, 10, 10, 10));
        let t = tally(
            Kind::Script,
            &answers(
                Kind::Script,
                &["idea.headline", "craft.script.no_dash", "effect.tone"],
            ),
        )
        .unwrap();
        assert_eq!((t.total, t.idea, t.craft, t.effect), (27, 9, 9, 9));
        assert_eq!(t.tests.iter().filter(|x| x.value == "fail").count(), 3);
        let failed = t.tests.iter().find(|x| x.id == "idea.headline").unwrap();
        assert_eq!(failed.reason_code, "judge.fail.idea_headline");
        assert_eq!(t.tests[0].reason_code, "pass");
    }

    #[test]
    fn a_missing_a_doubled_an_unknown_or_an_unreadable_answer_is_an_error_and_never_a_pass() {
        let full = answers(Kind::IdeaRoute, &[]);
        let mut missing = full.clone();
        missing.pop();
        let e = tally(Kind::IdeaRoute, &missing).unwrap_err();
        assert_eq!(e.status, 502);
        assert!(e.message.contains("is missing"), "{}", e.message);

        let mut doubled = full.clone();
        doubled.push(full[0].clone());
        assert!(tally(Kind::IdeaRoute, &doubled)
            .unwrap_err()
            .message
            .contains("twice"));

        let mut unknown = full.clone();
        unknown.push(json!({ "id": "idea.made_up", "value": "pass", "evidence": "x" }));
        assert!(tally(Kind::IdeaRoute, &unknown)
            .unwrap_err()
            .message
            .contains("not a test"));

        // a script's craft test is not a test of an idea route
        let mut other = full.clone();
        other.push(json!({ "id": "craft.script.no_dash", "value": "pass", "evidence": "x" }));
        assert!(tally(Kind::IdeaRoute, &other).is_err());

        let mut odd = full.clone();
        odd[3]["value"] = json!(true);
        assert!(tally(Kind::IdeaRoute, &odd)
            .unwrap_err()
            .message
            .contains("neither"));
        let mut score = full.clone();
        score[3]["value"] = json!(7);
        assert!(
            tally(Kind::IdeaRoute, &score).is_err(),
            "a number is not an answer"
        );

        let mut bare = full.clone();
        bare[2]["evidence"] = json!("  ");
        assert!(tally(Kind::IdeaRoute, &bare)
            .unwrap_err()
            .message
            .contains("evidence"));
        assert!(tally(Kind::IdeaRoute, &[]).is_err());
    }

    #[test]
    fn the_routing_table_over_every_total_and_every_idea_score() {
        for total in 0..=30u32 {
            for idea in 0..=10u32 {
                let got = route_of(total, idea);
                let want = if total >= 24 {
                    Route::Cd
                } else if idea >= 9 {
                    Route::CdBrave
                } else {
                    Route::Team
                };
                assert_eq!(got, want, "total {total}, idea {idea}");
            }
        }
        assert_eq!(route_of(22, 7), Route::Team);
        assert_eq!(route_of(22, 9), Route::CdBrave);
        assert_eq!(route_of(24, 8), Route::Cd);
        assert_eq!(route_of(23, 10), Route::CdBrave);
        assert_eq!(route_of(24, 0), Route::Cd);
        assert_eq!(Route::Team.reason_code(), "judge.return");
        assert_eq!(Route::CdBrave.reason_code(), "judge.brave");
        assert_eq!(Route::Cd.reason_code(), "judge.forward");
    }

    #[test]
    fn trust_is_none_until_set_and_a_new_version_starts_at_shadow() {
        let v = "rubric-1/llm-judge/judge-model/ab12cd34";
        assert_eq!(trust_in("", v), "none");
        assert_eq!(trust_in("nonsense", v), "none");
        assert_eq!(trust_in("shadow", v), "shadow");
        assert_eq!(trust_in(&format!("earned:{v}"), v), "earned");
        assert_eq!(
            trust_in("earned:rubric-1/llm-judge/other/ab12cd34", v),
            "shadow"
        );
    }

    #[test]
    fn the_refusals_name_their_codes_and_statuses() {
        for (k, status) in [
            ("ai_off", 403),
            ("not_eu", 403),
            ("not_configured", 503),
            ("spend_refused", 429),
        ] {
            let (s, line) = refusal(k).unwrap();
            assert_eq!(s, status);
            assert!(line.starts_with(k), "{line}");
        }
        assert!(refusal("something_else").is_none());
    }

    #[test]
    fn a_reply_scored_under_another_rubric_is_refused() {
        let ok = json!({ "handler": "judge_work@1.0", "result": { "tests": [], "backend": "fixture", "rubric_version": rubric().version } });
        assert!(read_reply(&ok).is_ok());
        let other = json!({ "result": { "tests": [], "backend": "fixture", "rubric_version": "fixture-1" } });
        assert_eq!(read_reply(&other).unwrap_err().status, 502);
        let no_backend = json!({ "result": { "tests": [], "rubric_version": rubric().version } });
        assert!(read_reply(&no_backend).is_err());
    }

    fn entry(overrule: Option<Route>, decided: Option<&'static str>) -> ScoreEntry {
        ScoreEntry {
            id: "d_score".into(),
            at: "2026-11-12T10:00:00Z".into(),
            piece: "script".into(),
            version: "abc".into(),
            block: json!({
                "version": "rubric-1/fixture/none/none", "rubric_version": "1", "backend": "fixture",
                "total": 22, "sub": { "idea": 9, "craft": 5, "effect": 8 },
                "advised_route": "cd_brave", "trust": "shadow", "work_kind": "script",
                "work_hash": "abc", "brief_hash": "def", "price_eur": 0.0,
                "tests": [
                    { "id": "idea.headline", "dim": "idea", "method": "llm", "value": "fail",
                      "evidence": "CANARY the tractor sings", "reason_code": "judge.fail.idea_headline" },
                    { "id": "idea.one_thought", "dim": "idea", "method": "llm", "value": "pass",
                      "evidence": "CANARY again", "reason_code": "pass" },
                ],
            }),
            overrule: overrule.map(|r| OverruleEntry {
                id: "d_over".into(),
                at: "2026-11-12T11:00:00Z".into(),
                route: r,
                reason: "CANARY the reason".into(),
            }),
            decided,
        }
    }

    #[test]
    fn a_telemetry_row_holds_no_text_of_the_work_the_evidence_or_the_reason() {
        let row = telemetry_row("doc_1", "J001", &entry(Some(Route::Team), Some("returned")));
        let s = row.to_string();
        assert!(!s.contains("CANARY"), "{s}");
        assert!(!s.contains("evidence"), "{s}");
        assert!(!s.contains("reason\""), "{s}");
        assert_eq!(
            row["then"],
            json!({ "decision": "returned", "overruled": true })
        );
        assert_eq!(
            row["tests"][0],
            json!({ "id": "idea.headline", "value": "fail", "method": "llm", "reason_code": "judge.fail.idea_headline" })
        );
        // every key of a row is on the allow list, and none can name a person
        let mut keys: Vec<&str> = row
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "advised_route",
                "at",
                "backend",
                "brief_hash",
                "cost_eur",
                "doc",
                "job",
                "judge_version",
                "piece",
                "rubric_version",
                "schema",
                "score_id",
                "sub",
                "tests",
                "then",
                "total",
                "trust",
                "work_hash",
                "work_kind"
            ]
        );
    }

    #[test]
    fn an_overrule_changes_the_effective_route_and_judges_verdict_stays_as_it_was() {
        let plain = entry(None, None);
        assert_eq!(plain.advised(), Route::CdBrave);
        assert_eq!(plain.effective(), Route::CdBrave);
        let over = entry(Some(Route::Team), Some("returned"));
        assert_eq!(over.advised(), Route::CdBrave);
        assert_eq!(over.effective(), Route::Team);
    }

    #[test]
    fn the_card_puts_failed_tests_first_and_says_advice_only_until_trust_is_earned() {
        let c = card_of(&entry(None, None), true, false);
        assert_eq!(c["tests"][0]["value"], "fail");
        assert_eq!(c["tests"][1]["value"], "pass");
        let line = c["route_line"].as_str().unwrap();
        assert!(line.contains(NOT_TRUSTED), "{line}");
        assert!(line.contains("Brave, fix the craft"), "{line}");
        let mut earned = entry(None, None);
        earned.block["trust"] = json!("earned");
        let c = card_of(&earned, true, false);
        assert!(!c["route_line"].as_str().unwrap().contains("Advice only"));
        assert_eq!(c["out_of_date"], false);
        assert_eq!(card_of(&earned, true, true)["out_of_date"], true);
    }

    fn piece(total: u32, idea: u32, over: bool, decided: bool) -> PieceScore {
        let r = route_of(total, idea);
        PieceScore {
            doc: "d.clan".into(),
            title: "T".into(),
            piece: "script".into(),
            kind: "script".into(),
            score: "d_1".into(),
            at: "t".into(),
            total,
            idea,
            craft: 5,
            effect: 5,
            advised_route: r.id().into(),
            route: r.id().into(),
            brave: r == Route::CdBrave,
            trust: "shadow".into(),
            overruled: over,
            decided: decided.then(|| "kept".into()),
            current: true,
        }
    }

    #[test]
    fn the_tile_counts_pieces_and_nothing_by_person() {
        assert!(
            tile(&[("J001", "Client A", "c1", &[])]).is_none(),
            "no scores: no tile"
        );
        let a = vec![piece(22, 7, false, false), piece(28, 9, false, true)];
        let b = vec![piece(22, 9, true, true)];
        let t = tile(&[
            ("J001", "Client A", "c1", &a),
            ("J002", "Client B", "c2", &b),
        ])
        .unwrap();
        assert_eq!(t.scored, 3);
        assert_eq!(t.average, 24.0);
        assert_eq!((t.under_24, t.at_27, t.brave, t.overruled), (2, 1, 1, 1));
        assert_eq!(t.awaiting_set, 58);
        assert_eq!(t.jobs.len(), 2);
        let s = serde_json::to_string(&t).unwrap().to_lowercase();
        let ps = serde_json::to_string(&a).unwrap().to_lowercase();
        for key in [
            "person", "author", "\"by\"", "actor", "writer", "owner", "who",
        ] {
            assert!(!s.contains(key), "tile has {key}");
            assert!(!ps.contains(key), "piece score has {key}");
        }
    }

    #[test]
    fn a_score_can_be_written_into_a_document_and_read_back() {
        // the whole write path is exercised in crates/napkin-host/tests/judge.rs; this holds the notes line
        let t = tally(Kind::Script, &answers(Kind::Script, &["idea.headline"])).unwrap();
        let n = notes(&t);
        assert!(
            n.starts_with("29 of 30: idea 9, craft 10, effect 10."),
            "{n}"
        );
        assert!(n.contains("Could a journalist headline it"), "{n}");
        assert!(
            !n.contains("evidence for"),
            "the notes line holds no evidence"
        );
    }

    /// Nothing that approves, picks or sends to a client reads a Judge score as a condition.
    #[test]
    fn no_operation_that_decides_names_the_judge_module() {
        for (name, src) in [
            ("review.rs", include_str!("review.rs")),
            ("ideas.rs", include_str!("ideas.rs")),
            ("client_link.rs", include_str!("client_link.rs")),
            ("client_review.rs", include_str!("client_review.rs")),
            ("gate.rs", include_str!("gate.rs")),
        ] {
            assert!(
                !src.contains("judge::") && !src.contains("super::judge"),
                "{name} reads Judge"
            );
        }
    }
}
