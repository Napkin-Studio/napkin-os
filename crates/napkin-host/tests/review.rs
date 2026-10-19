// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! A person's review decisions: each records one decision as the person, with
//! what it changes in the same generation — or refuses and writes nothing.

#![recursion_limit = "256"]

use std::sync::Arc;

use clan_sdk::{ClanFile, DecisionChain};
use napkin_host::ops::review::{self, Classify, Resolve, Verdict};
use napkin_host::{handle, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

struct Fixture {
    _dir: tempfile::TempDir,
    session: Session,
    id: DocId,
    doc: String,
}

fn reasoning(decided: &str, cites: &[&str]) -> Value {
    json!({ "decided": decided,
            "because": [{ "point": "the cited material says so", "cites": cites }],
            "rejected": [{ "option": "leave it open", "why": "the material settles it" }],
            "certainty": { "level": "high", "why": "a verbatim quote" },
            "would_change_if": "the client says otherwise" })
}

/// Reasoning an agent flagged for a person to look at.
fn flagged(mut r: Value) -> Value {
    r["attention"] = json!("It rests on one source.");
    r
}

fn pin(id: &str, value: f64, layer: &str) -> Value {
    json!({
        "id": id, "entity": "category/drinks.cider", "key": "market.share_frozen", "value": value,
        "unit": "proportion", "as_of": "2026-06-30", "retrieved_at": "2026-09-12",
        "sources": ["src_4f2a"], "confidence": "high", "licence": "open",
        "status": "active", "version": 2, "supersedes": null,
        "origin": format!("fact://category/drinks.cider/market.share_frozen@{}", 2),
        "decision": "d_01JA0D02PIN", "pinned_at": "2026-09-21T09:00:04Z", "pin_reason": "research",
        "layer": layer, "market": "IE", "method": "report",
    })
}

/// A document with two pins, a proposed finding citing them, and an open
/// contest between the first pin and a newer value the research froze a pin
/// for — seeded the way it arrives: as a middleware change.
fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("campaign.clan"));
    let bytes = clan_sdk::create(clan_sdk::CreateOptions {
        title: "Campaign".into(),
        brief: "a campaign".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    std::fs::write(id.as_str(), bytes).unwrap();
    let session = Session::new(Arc::new(FsStore::new(dir.path().to_path_buf())));
    session.open(id.clone()).unwrap();
    let clan = session.clan_context_for_agent();
    let doc = clan["id"].as_str().unwrap().to_string();

    let mut other = pin("f_01JA0B3P5R", 0.44, "category");
    other["key"] = json!("market.value_growth");
    other["origin"] = json!("fact://category/drinks.cider/market.value_growth@2");
    let mut newer = pin("f_01JA0B9Z9Z", 0.19, "category");
    newer["version"] = json!(3);
    newer["decision"] = json!("d_01JA0D03CON");
    let reply = json!({
        "api": "napkin.middleware/1", "task": "research_lens", "handler": "research_lens@1.0",
        "job": { "id": "job_1", "state": "done" }, "result": {},
        "change": {
            "doc": doc, "base_version": clan["version"],
            "read": { "selection.contested": null },
            "data_patch": { "selection": { "contested": [ {
                "id": "ct_share", "key": "category/drinks.cider:market.share_frozen@IE", "status": "open",
                "opened_by": "d_01JA0D03CON",
                "values": [
                    { "value": 0.23, "fact_id": "f_01JA0B3P4Q", "from": "pinned", "sources": ["src_4f2a"] },
                    { "value": 0.19, "fact_id": "f_01JA0B9Z9Z", "from": "market_structure/IE",
                      "sources": ["src_77aa"], "pin": newer } ] } ] } },
            "facts_append": [ pin("f_01JA0B3P4Q", 0.23, "category"), other ],
            "findings_append": [ {
                "id": "fi_01JA0F2B", "statement": "Frozen is growing fast from a small share",
                "cites": ["f_01JA0B3P4Q", "f_01JA0B3P5R"], "method": "synthesis",
                "status": "proposed", "derived_by": "synthesise_findings@1.0",
                "confidence": "medium", "derived_at": "2026-09-23T10:00:01Z", "decision": "d_01JA0D06SYN" } ],
            "decisions": [
                { "id": "d_01JA0D02PIN", "kind": "pin", "agent": "research_lens@1.0", "action": "research_merge",
                  "rationale": "pinned", "targets": [format!("{doc}#facts[f_01JA0B3P4Q]")],
                  "cites": ["src_4f2a"], "reasoning": flagged(reasoning("Pinned.", &["src_4f2a"])) },
                { "id": "d_01JA0D03CON", "kind": "contest", "agent": "research_lens@1.0", "action": "open_contest",
                  "rationale": "two values", "targets": [format!("{doc}#selection.contested[ct_share]")],
                  "cites": ["src_77aa"], "reasoning": reasoning("Opened a contest.", &["src_77aa"]) },
                { "id": "d_01JA0D06SYN", "kind": "finding", "agent": "research_lens@1.0",
                  "action": "proposed a finding", "rationale": "two pins agree",
                  "targets": [format!("{doc}#findings[fi_01JA0F2B]")],
                  "cites": ["f_01JA0B3P4Q", "f_01JA0B3P5R"],
                  "reasoning": reasoning("Proposed a finding.", &["f_01JA0B3P4Q"]) } ]
        },
        "trace": {}
    });
    let env =
        json!({ "ok": true, "status": 200, "endpoint": "http://m", "data": reply, "error": null });
    let (out, _) = session.settle_middleware(session.ctx(), env);
    assert_eq!(out["data"]["change"]["applied"], true, "{out}");
    Fixture {
        _dir: dir,
        session,
        id,
        doc,
    }
}

fn on_disk(f: &Fixture) -> ClanFile {
    ClanFile::open(f.id.as_str()).unwrap()
}

fn yaml(f: &Fixture, path: &str) -> Value {
    let y: serde_yaml::Value =
        serde_yaml::from_slice(&on_disk(f).read_entry(path).unwrap()).unwrap();
    serde_json::to_value(y).unwrap()
}

fn chain(f: &Fixture) -> DecisionChain {
    DecisionChain::from_yaml(&on_disk(f).read_entry("agent/decision-chain.yaml").unwrap()).unwrap()
}

fn finding(f: &Fixture) -> Value {
    yaml(f, "shared/findings.yaml")["findings"][0].clone()
}

/// `member` as the Research Tool's schema for it has it, or why not.
fn conforms(member: &Value, schema: &str) {
    let path = format!(
        "{}/../../app/templates/campaign-research/{schema}",
        env!("CARGO_MANIFEST_DIR")
    );
    let out = clan_sdk::AgentOutput {
        mode: "data-update".into(),
        structured: member.clone(),
        design: None,
        human: None,
        decision: None,
    };
    if let Err(e) = out.validate_schema(&std::fs::read_to_string(path).unwrap()) {
        panic!("{schema}: {e}");
    }
}

fn verdict(target: &str, polarity: &str, rationale: &str) -> Verdict {
    Verdict::parse(
        &json!({ "target": target, "polarity": polarity, "rationale": rationale }).to_string(),
    )
    .unwrap()
}

/// Run `op` as the session's person; the error status when it refuses.
fn run(
    f: &Fixture,
    op: impl FnOnce(&Ctx, &napkin_host::Document) -> napkin_host::HostResult<napkin_host::Outcome>,
) -> Result<Value, u16> {
    let before = std::fs::read(f.id.as_str()).unwrap();
    match f.session.perform(f.session.ctx(), op) {
        Ok(done) => Ok(done.reply),
        Err(e) => {
            assert_eq!(
                std::fs::read(f.id.as_str()).unwrap(),
                before,
                "a refusal writes nothing"
            );
            Err(e.status)
        }
    }
}

#[test]
fn a_bad_verdict_on_a_finding_rejects_it_with_the_reason() {
    let f = fixture();
    let reply = run(&f, |c, d| {
        review::verdict(
            c,
            d,
            verdict(
                "findings[fi_01JA0F2B]",
                "bad",
                "The growth figure is value, not volume.",
            ),
        )
    })
    .unwrap();

    let fi = finding(&f);
    assert_eq!(fi["status"], "rejected");
    assert_eq!(
        fi["rejection"]["reason"],
        "The growth figure is value, not volume."
    );
    assert_eq!(fi["rejection"]["by"], f.session.ctx().actor.as_str());
    assert_eq!(fi["rejection"]["decision"], reply["decision"]);
    let d = &chain(&f).decisions[0];
    assert_eq!(d.id.as_deref(), reply["decision"].as_str());
    assert_eq!(d.kind.as_deref(), Some("verdict"));
    assert_eq!(d.polarity.as_deref(), Some("bad"));
    assert_eq!(d.actor.as_deref(), Some(f.session.ctx().actor.as_str()));
    assert_eq!(d.targets, vec![format!("{}#findings[fi_01JA0F2B]", f.doc)]);
    // The projection follows the member.
    let data = yaml(&f, "shared/data.yaml");
    assert_eq!(
        data["projection"]["findings"]["fi_01JA0F2B"]["status"],
        "rejected"
    );
    let report = clan_sdk::validate(&on_disk(&f));
    assert!(report.is_valid(), "{}", report.display());

    // Once decided, it is decided.
    assert_eq!(
        run(&f, |c, d| review::verdict(
            c,
            d,
            verdict("findings[fi_01JA0F2B]", "bad", "again")
        )),
        Err(409)
    );
}

#[test]
fn a_finding_is_verified_not_marked_good_and_a_bad_mark_needs_a_reason() {
    let f = fixture();
    assert_eq!(
        run(&f, |c, d| review::verdict(
            c,
            d,
            verdict("findings[fi_01JA0F2B]", "good", "")
        )),
        Err(400)
    );
    let e =
        Verdict::parse(&json!({ "target": "facts[f_01JA0B3P4Q]", "polarity": "bad" }).to_string())
            .unwrap_err();
    assert_eq!(e.status, 400);
    // A good mark on a pin is recorded, and is the pin's review: nothing
    // else of it changes.
    let before = yaml(&f, "shared/facts.yaml");
    run(&f, |c, d| {
        review::verdict(c, d, verdict("facts[f_01JA0B3P4Q]", "good", ""))
    })
    .unwrap();
    let d = &chain(&f).decisions[0];
    assert_eq!(d.polarity.as_deref(), Some("good"));
    assert_eq!(d.targets, vec![format!("{}#facts[f_01JA0B3P4Q]", f.doc)]);
    let mut after = yaml(&f, "shared/facts.yaml");
    let review = after["facts"][0]
        .as_object_mut()
        .unwrap()
        .remove("review")
        .unwrap();
    assert_eq!(review["decision"], d.id.as_deref().unwrap());
    assert_eq!(after, before);
    // Something the document does not hold is not a target.
    assert_eq!(
        run(&f, |c, d| review::verdict(
            c,
            d,
            verdict("facts[f_01NOPE0001]", "good", "")
        )),
        Err(404)
    );
}

#[test]
fn a_confidential_mark_records_where_it_may_travel() {
    let f = fixture();
    let input = Classify::parse(
        &json!({ "target": format!("{}#facts[f_01JA0B3P4Q]", f.doc), "model": true,
                 "export": false, "corpus": false, "rationale": "Pricing is under NDA until launch" })
            .to_string(),
    )
    .unwrap();
    run(&f, |c, d| review::classify(c, d, input)).unwrap();
    let d = &chain(&f).decisions[0];
    assert_eq!(d.kind.as_deref(), Some("classify"));
    let l = d.licence.as_ref().unwrap();
    assert_eq!(
        (l.model, l.export, l.corpus),
        (Some(true), Some(false), Some(false))
    );
    assert_eq!(d.rationale, "Pricing is under NDA until launch");
    // Without a reason, or all three flags, it is not a mark.
    assert!(Classify::parse(
        r#"{"target":"facts[f_01JA0B3P4Q]","model":true,"export":false,"corpus":false}"#
    )
    .is_err());
    assert!(
        Classify::parse(r#"{"target":"facts[f_01JA0B3P4Q]","model":true,"rationale":"x"}"#)
            .is_err()
    );
}

#[test]
fn resolving_a_contest_pins_the_pick_and_marks_the_pin_it_replaces() {
    let f = fixture();
    let input = Resolve::parse(
        r#"{"contest":"ct_share","chosen":"f_01JA0B9Z9Z","rationale":"Retail-only is the market we enter"}"#,
    )
    .unwrap();
    let reply = run(&f, |c, d| review::resolve(c, d, input)).unwrap();

    let data = yaml(&f, "shared/data.yaml");
    let ct = &data["selection"]["contested"][0];
    assert_eq!(ct["status"], "resolved");
    assert_eq!(ct["chosen"], "f_01JA0B9Z9Z");
    assert_eq!(ct["reason"], "Retail-only is the market we enter");
    assert_eq!(ct["decided_by"], reply["decision"]);

    let facts = yaml(&f, "shared/facts.yaml")["facts"].clone();
    let by = |id: &str| {
        facts
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .cloned()
            .unwrap()
    };
    assert_eq!(
        by("f_01JA0B9Z9Z")["value"],
        0.19,
        "the pick is pinned, as frozen"
    );
    assert_eq!(by("f_01JA0B3P4Q")["replaced_by"]["fact_id"], "f_01JA0B9Z9Z");
    assert_eq!(
        by("f_01JA0B3P4Q")["value"],
        0.23,
        "the replaced pin keeps its value"
    );
    assert!(
        by("f_01JA0B3P5R").get("replaced_by").is_none(),
        "another identity is untouched"
    );

    let d = &chain(&f).decisions[0];
    assert_eq!(d.kind.as_deref(), Some("resolve"));
    assert!(d.cites.contains(&"f_01JA0B9Z9Z".to_string()));
    assert!(d.cites.contains(&"d_01JA0D03CON".to_string()));
    let report = clan_sdk::validate(&on_disk(&f));
    assert!(report.is_valid(), "{}", report.display());

    // It is resolved now; and a value that is not one of its own is refused.
    let again = Resolve::parse(r#"{"contest":"ct_share","chosen":"f_01JA0B3P4Q","rationale":"x"}"#)
        .unwrap();
    assert_eq!(run(&f, |c, d| review::resolve(c, d, again)), Err(409));
}

#[test]
fn keeping_the_pinned_value_pins_nothing_new() {
    let f = fixture();
    let before = yaml(&f, "shared/facts.yaml");
    let input = Resolve::parse(
        r#"{"contest":"ct_share","chosen":"f_01JA0B3P4Q","rationale":"The panel is retail value"}"#,
    )
    .unwrap();
    run(&f, |c, d| review::resolve(c, d, input)).unwrap();
    assert_eq!(yaml(&f, "shared/facts.yaml"), before);
    let wrong =
        Resolve::parse(r#"{"contest":"ct_nope","chosen":"f_01JA0B3P4Q","rationale":"x"}"#).unwrap();
    assert_eq!(run(&f, |c, d| review::resolve(c, d, wrong)), Err(404));
}

#[test]
fn verifying_records_who_checked_it_in_the_document_only() {
    let f = fixture();
    let facts_before = yaml(&f, "shared/facts.yaml");
    // No middleware is configured: verifying needs none.
    let r = handle(
        &f.session,
        &NoConfig,
        HostRequest::new(
            "/verify",
            "",
            json!({ "finding": "fi_01JA0F2B", "rationale": "Checked both tables" })
                .to_string()
                .into_bytes(),
        ),
    );
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let reply: Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(reply["backrefs"], json!([]), "no parent to tell");
    let did = reply["decision"].as_str().unwrap().to_string();

    let fi = finding(&f);
    assert_eq!(fi["status"], "verified");
    assert_eq!(
        fi["verification"],
        json!({ "decision": did, "by": f.session.ctx().actor.as_str(),
                "at": fi["verification"]["at"] }),
        "the decision, who and when; nothing else"
    );
    conforms(&yaml(&f, "shared/findings.yaml"), "findings.schema.json");
    assert!(fi["verification"]["at"]
        .as_str()
        .is_some_and(|t| t.ends_with('Z')));
    let d = &chain(&f).decisions[0];
    assert_eq!(d.id.as_deref(), Some(did.as_str()));
    assert_eq!(d.kind.as_deref(), Some("verify"));
    assert_eq!(d.action, "verify_finding");
    assert_eq!(d.rationale, "Checked both tables");
    assert_eq!(d.cites, vec!["f_01JA0B3P4Q", "f_01JA0B3P5R"]);
    assert_eq!(
        yaml(&f, "shared/facts.yaml"),
        facts_before,
        "nothing is pinned for it"
    );
    // A verified finding is not verified again.
    assert_eq!(
        run(&f, |c, d| review::verify(c, d, "fi_01JA0F2B", "")),
        Err(409)
    );
    assert_eq!(
        run(&f, |c, d| review::verify(c, d, "fi_nope00", "")),
        Err(404)
    );
}

#[test]
fn a_mark_on_a_fact_is_its_review() {
    let f = fixture();
    let good = run(&f, |c, d| {
        review::verdict(c, d, verdict("facts[f_01JA0B3P4Q]", "good", ""))
    })
    .unwrap();
    let bad = run(&f, |c, d| {
        review::verdict(
            c,
            d,
            verdict(
                "facts[f_01JA0B3P5R]",
                "bad",
                "The panel is volume, not value",
            ),
        )
    })
    .unwrap();
    let facts = yaml(&f, "shared/facts.yaml")["facts"].clone();
    let by = |id: &str| {
        facts
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == id)
            .cloned()
            .unwrap()
    };
    let me = f.session.ctx().actor.as_str();
    let right = by("f_01JA0B3P4Q")["review"].clone();
    assert_eq!(right["verdict"], "verified");
    assert_eq!(right["by"], me);
    assert_eq!(right["decision"], good["decision"]);
    let wrong = by("f_01JA0B3P5R")["review"].clone();
    assert_eq!(wrong["verdict"], "rejected");
    assert_eq!(wrong["decision"], bad["decision"]);
    assert_eq!(by("f_01JA0B3P5R")["value"], 0.44, "the value is untouched");
    conforms(&yaml(&f, "shared/facts.yaml"), "facts.schema.json");
    // Taking it out is the reconsider job's, not the verdict's.
    assert!(yaml(&f, "shared/data.yaml")
        .pointer("/selection/excluded")
        .is_none());
    let d = &chain(&f).decisions[0];
    assert_eq!(d.action, "mark_bad");
    assert_eq!(d.id.as_deref(), bad["decision"].as_str());
}

#[test]
fn only_a_person_decides() {
    let f = fixture();
    let bot = Ctx::new(Actor::process("job_7").unwrap());
    let before = std::fs::read(f.id.as_str()).unwrap();
    let e = f
        .session
        .perform(&bot, |c, d| {
            review::verdict(c, d, verdict("facts[f_01JA0B3P4Q]", "good", ""))
        })
        .unwrap_err();
    assert_eq!(e.status, 403);
    assert_eq!(std::fs::read(f.id.as_str()).unwrap(), before);
}

#[test]
fn lock_waits_for_everything_open_then_holds() {
    let f = fixture();
    // An unverified finding and an open contest stand in the way.
    let e = f
        .session
        .perform(f.session.ctx(), |c, d| review::approve(c, d, ""))
        .unwrap_err();
    assert_eq!(e.status, 409);
    assert!(
        e.message.contains("2 things still need a person"),
        "{}",
        e.message
    );

    run(&f, |c, d| {
        review::verdict(c, d, verdict("findings[fi_01JA0F2B]", "bad", "Wrong base"))
    })
    .unwrap();
    let input = Resolve::parse(
        r#"{"contest":"ct_share","chosen":"f_01JA0B3P4Q","rationale":"Retail value"}"#,
    )
    .unwrap();
    run(&f, |c, d| review::resolve(c, d, input)).unwrap();

    let version = f.session.current_version().unwrap();
    run(&f, |c, d| review::approve(c, d, "")).unwrap();
    let d = &chain(&f).decisions[0];
    assert_eq!(d.kind.as_deref(), Some("approve"));
    assert_eq!(
        d.version.as_deref(),
        Some(version.as_str()),
        "it names what it accepted"
    );

    // Locked: nothing more is decided on this version.
    assert_eq!(
        run(&f, |c, d| review::verdict(
            c,
            d,
            verdict("facts[f_01JA0B3P4Q]", "good", "")
        )),
        Err(409)
    );
    assert_eq!(run(&f, |c, d| review::approve(c, d, "")), Err(409));
}

#[test]
fn the_routes_carry_the_decisions() {
    let f = fixture();
    let post = |path: &str, body: Value| {
        handle(
            &f.session,
            &NoConfig,
            HostRequest::new(path, "", body.to_string().into_bytes()),
        )
    };
    let r = post(
        "/verdict",
        json!({ "target": "findings[fi_01JA0F2B]", "polarity": "bad", "rationale": "No" }),
    );
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    assert_eq!(finding(&f)["status"], "rejected");
    let r = post(
        "/classify",
        json!({ "target": "facts[f_01JA0B3P4Q]", "model": false, "export": false,
                                      "corpus": false, "rationale": "Client data" }),
    );
    assert_eq!(r.status, 200);
    let r = post(
        "/resolve",
        json!({ "contest": "ct_share", "chosen": "f_01JA0B9Z9Z", "rationale": "Newer" }),
    );
    assert_eq!(r.status, 200);
    let r = post("/approve", json!({}));
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let r = post(
        "/verdict",
        json!({ "target": "facts[f_01JA0B3P4Q]", "polarity": "sideways" }),
    );
    assert_eq!(r.status, 400);
}

#[test]
fn looks_right_clears_an_agents_flag_and_nothing_else() {
    let f = fixture();
    let flagged_on = |f: &Fixture| {
        f.session
            .read(|d| napkin_host::ops::decisions::decisions(d))
            .unwrap()
            .attention
            .iter()
            .any(|a| a.decision.as_deref() == Some("d_01JA0D02PIN") && a.code == "flagged")
    };
    assert!(flagged_on(&f));
    let before_facts = yaml(&f, "shared/facts.yaml");
    run(&f, |c, d| {
        review::acknowledge(c, d, &("d_01JA0D02PIN".into(), String::new()))
    })
    .unwrap();
    assert!(!flagged_on(&f), "a person has looked");
    let d = &chain(&f).decisions[0];
    assert_eq!(d.kind.as_deref(), Some("verdict"));
    assert_eq!(d.polarity.as_deref(), Some("good"));
    assert_eq!(d.cites, vec!["d_01JA0D02PIN".to_string()]);
    assert!(d.rationale.starts_with("Looks right"));
    assert_eq!(
        yaml(&f, "shared/facts.yaml"),
        before_facts,
        "the pin is untouched"
    );
    // A finding is verified, not waved through; an unknown decision is not one.
    assert_eq!(
        run(&f, |c, d| review::acknowledge(
            c,
            d,
            &("d_01JA0D06SYN".into(), String::new())
        )),
        Err(400)
    );
    assert_eq!(
        run(&f, |c, d| review::acknowledge(
            c,
            d,
            &("d_01NOPE0000".into(), String::new())
        )),
        Err(404)
    );
}

#[test]
fn a_person_edits_a_campaign_field_and_it_is_theirs() {
    let f = fixture();
    let edit = |path: &str, value: Value, gate: &str| {
        review::parse_edit(
            &json!({ "path": path, "value": value, "gate": gate, "rationale": "Client said so" })
                .to_string(),
        )
        .unwrap()
    };
    run(&f, |c, d| {
        review::edit(
            c,
            d,
            edit(
                "campaign.problem",
                json!("Frozen is seen as second best"),
                "brief",
            ),
        )
    })
    .unwrap();
    let env = yaml(&f, "shared/data.yaml")["campaign"]["problem"].clone();
    assert_eq!(env["value"], "Frozen is seen as second best");
    assert_eq!(env["origin"], "stated");
    assert_eq!(env["by"], f.session.ctx().actor.as_str());
    let d = &chain(&f).decisions[0];
    assert_eq!(d.kind.as_deref(), Some("edit"));
    assert!(d.pinned, "a person's edit is pinned");
    assert_eq!(
        env["decision"].as_str(),
        d.id.as_deref(),
        "the envelope names the decision that set it"
    );
    assert_eq!(d.fields_changed, vec!["campaign.problem".to_string()]);
    // The same value again is not an edit; facts and the projection are not edited here.
    assert_eq!(
        run(&f, |c, d| review::edit(
            c,
            d,
            edit(
                "campaign.problem",
                json!("Frozen is seen as second best"),
                "brief"
            )
        )),
        Err(409)
    );
    assert_eq!(
        run(&f, |c, d| review::edit(
            c,
            d,
            edit("projection.pins", json!({}), "")
        )),
        Err(400)
    );
    assert_eq!(
        run(&f, |c, d| review::edit(
            c,
            d,
            edit("facts.f_01JA0B3P4Q", json!(1), "")
        )),
        Err(400)
    );
    // An empty field needs to say which gate it belongs to.
    let e = review::parse_edit(
        &json!({ "path": "campaign.objective", "value": "Win trial", "rationale": "Asked" })
            .to_string(),
    )
    .unwrap();
    assert_eq!(run(&f, |c, d| review::edit(c, d, e)), Err(400));
    // And an edit says why.
    assert!(review::parse_edit(
        &json!({ "path": "campaign.objective", "value": "Win trial" }).to_string()
    )
    .is_err());
    // It records what the field said before and after.
    let d = &chain(&f).decisions[0];
    assert_eq!(
        d.extra.get("now").and_then(|v| v.as_str()),
        Some("Frozen is seen as second best")
    );
    assert_eq!(d.rationale, "Client said so");
}

#[test]
fn a_corrected_fact_replaces_the_old_pin_which_stays_on_record() {
    let f = fixture();
    let sources_before = on_disk(&f)
        .read_entry("shared/sources.yaml")
        .map(|b| serde_yaml::from_slice::<serde_yaml::Value>(&b).unwrap())
        .map(|y| serde_json::to_value(y).unwrap()["sources"].clone())
        .unwrap_or(Value::Null);
    // No middleware is configured: correcting needs none.
    let post = |body: Value| {
        handle(
            &f.session,
            &NoConfig,
            HostRequest::new("/correct", "", body.to_string().into_bytes()),
        )
    };
    let r = post(json!({ "fact": "f_01JA0B3P4Q", "value": "31%", "rationale": "The 2026 panel" }));
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let reply: Value = serde_json::from_slice(&r.body).unwrap();
    let did = reply["decision"].as_str().unwrap().to_string();

    let facts = yaml(&f, "shared/facts.yaml")["facts"].clone();
    let by = |id: &str| {
        facts
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == id)
            .cloned()
    };
    let old = by("f_01JA0B3P4Q").unwrap();
    assert_eq!(old["value"], 0.23, "the old value stays on record");
    let new_id = old["replaced_by"]["fact_id"].as_str().unwrap().to_string();
    assert_eq!(old["replaced_by"]["decision"], did);
    assert!(new_id.starts_with("f_01") && new_id.len() == 28, "{new_id}");
    let me = f.session.ctx().actor.as_str();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let pin = by(&new_id).unwrap();
    assert_eq!(pin["value"], 0.31, "a share, read in the pin's unit");
    for k in ["entity", "key", "market", "unit", "layer", "licence"] {
        assert_eq!(pin[k], old[k], "{k} is the old pin's");
    }
    assert_eq!(pin["method"], "report");
    assert_eq!(pin["confidence"], "high");
    assert_eq!(pin["status"], "active");
    assert_eq!(pin["as_of"], today.as_str());
    assert_eq!(pin["retrieved_at"], today.as_str());
    assert_eq!(pin["decision"], did);
    assert!(pin.get("origin").is_none(), "it is in no layer");
    assert_eq!(pin["review"]["verdict"], "verified");
    assert_eq!(pin["review"]["by"], me);
    assert_eq!(pin["review"]["decision"], did);
    let src = pin["sources"][0].as_str().unwrap().to_string();
    assert_eq!(pin["quotes"][&src], "The 2026 panel");

    conforms(&yaml(&f, "shared/facts.yaml"), "facts.schema.json");

    let sources = yaml(&f, "shared/sources.yaml")["sources"].clone();
    let rec = sources
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == src.as_str())
        .unwrap()
        .clone();
    assert!(src.starts_with("src_"));
    assert_eq!(rec["uri"], me);
    assert_eq!(rec["tier"], "reviewer-verified");
    assert_eq!(rec["licence"], old["licence"]);
    assert_eq!(
        sources.as_array().unwrap().len(),
        sources_before.as_array().map_or(0, Vec::len) + 1
    );

    let d = &chain(&f).decisions[0];
    assert_eq!(d.id.as_deref(), Some(did.as_str()));
    assert_eq!(d.kind.as_deref(), Some("edit"));
    assert_eq!(d.action, "correct_fact");
    assert_eq!(d.rationale, "The 2026 panel", "the note is kept");
    assert_eq!(d.cites, vec!["f_01JA0B3P4Q".to_string(), new_id.clone()]);
    assert!(d.pinned);

    // A replaced fact is not corrected again; the same value is no correction.
    let again = post(json!({ "fact": "f_01JA0B3P4Q", "value": "30%", "rationale": "x" }));
    assert_eq!(again.status, 409);
    let same = post(json!({ "fact": "f_01JA0B3P5R", "value": 0.44, "rationale": "x" }));
    assert_eq!(same.status, 409);
    let nonsense = post(json!({ "fact": "f_01JA0B3P5R", "value": "lots", "rationale": "x" }));
    assert_eq!(nonsense.status, 400);

    // A second correction by the same person cites the same source record.
    let r = post(json!({ "fact": "f_01JA0B3P5R", "value": "48 per cent", "rationale": "Kantar" }));
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let facts = yaml(&f, "shared/facts.yaml")["facts"].clone();
    let newer = facts.as_array().unwrap().last().unwrap().clone();
    assert_eq!(newer["value"], 0.48);
    assert_eq!(newer["sources"], json!([src]));
    assert_eq!(
        yaml(&f, "shared/sources.yaml")["sources"]
            .as_array()
            .unwrap()
            .len(),
        sources.as_array().unwrap().len()
    );
}

#[test]
fn a_person_rewrites_the_wording_and_it_travels_with_the_document() {
    let f = fixture();
    let text = |key: &str, html: &str| {
        review::parse_edit_text_full(
            &json!({ "key": key, "html": html, "rationale": "Clearer wording",
                                              "part": "headline", "was": "A growing category" })
            .to_string(),
        )
        .unwrap()
    };
    run(&f, |c, d| {
        review::edit_text(
            c,
            d,
            text("report:ab12:b1", "A growing category, led by own-label"),
        )
    })
    .unwrap();
    let edits = yaml(&f, "shared/edits.yaml")["edits"].clone();
    assert_eq!(edits[0]["key"], "report:ab12:b1");
    assert_eq!(edits[0]["html"], "A growing category, led by own-label");
    assert_eq!(edits[0]["by"], f.session.ctx().actor.as_str());
    let d = &chain(&f).decisions[0];
    assert_eq!(
        (d.kind.as_deref(), d.action.as_str(), d.pinned),
        (Some("edit"), "edit_text", true)
    );
    assert_eq!(edits[0]["decision"].as_str(), d.id.as_deref());
    assert_eq!(
        d.rationale, "Clearer wording",
        "the person's reason is the decision's"
    );
    assert_eq!(
        d.extra.get("part").and_then(|v| v.as_str()),
        Some("headline")
    );
    assert_eq!(
        d.extra.get("was").and_then(|v| v.as_str()),
        Some("A growing category")
    );
    assert_eq!(
        d.extra.get("now").and_then(|v| v.as_str()),
        Some("A growing category, led by own-label")
    );
    // A rewrite without a reason is refused before anything is looked at.
    assert!(review::parse_edit_text_full(r#"{"key":"k1","html":"x"}"#).is_err());
    // The view is handed it; the same text again is not an edit.
    assert_eq!(
        f.session.document_now().unwrap()["edits"]["report:ab12:b1"],
        "A growing category, led by own-label"
    );
    assert_eq!(
        run(&f, |c, d| review::edit_text(
            c,
            d,
            text("report:ab12:b1", "A growing category, led by own-label")
        )),
        Err(409)
    );
    // Empty puts the original back.
    run(&f, |c, d| {
        review::edit_text(c, d, text("report:ab12:b1", ""))
    })
    .unwrap();
    assert_eq!(yaml(&f, "shared/edits.yaml")["edits"], json!([]));
    assert_eq!(chain(&f).decisions[0].action, "restore_text");
    assert!(review::parse_edit_text(r#"{"key":"has space","html":"x"}"#).is_err());
}

// ── A document spun off from another, carrying it (Contract 4 §5, §7, §8.1) ──

/// The id the hand-made child is given.
const CHILD: &str = "9c1e4b7a-2d3f-4e5a-8b6c-1f0e9d8c7b6a";

/// A brief spun off from `parent` the way Contract 4 §5.2 lays it out, made
/// by hand so these tests do not wait on the SDK: the parent's data frozen at
/// `upstream.<parent id>` (without its projection), its members and its whole
/// chain carried, and nothing at the root but what `root` adds. `frozen` and
/// `carried` edit the frozen copy and the carried chain first.
fn child_of(
    parent: &Fixture,
    root: Value,
    frozen: impl FnOnce(&mut Value),
    carried: impl FnOnce(&mut DecisionChain),
) -> Fixture {
    let source = on_disk(parent);
    let mut copy = yaml(parent, "shared/data.yaml");
    copy.as_object_mut().unwrap().remove("projection");
    frozen(&mut copy);
    let mut data = root;
    data["upstream"] = json!({ parent.doc.clone(): copy });
    let mut chain = chain(parent);
    carried(&mut chain);

    let mut manifest = source.manifest().clone();
    manifest.id = CHILD.into();
    manifest.document_id = Some(CHILD.into());
    manifest.title = "Brief".into();
    let mut b = clan_sdk::ClanBuilder::new(manifest);
    for (path, bytes) in source.read_all_entries().unwrap() {
        if matches!(
            path.as_str(),
            clan_sdk::MANIFEST_PATH
                | "shared/data.yaml"
                | "agent/decision-chain.yaml"
                | "human/patches.yaml"
                | "shared/edits.yaml"
        ) {
            continue;
        }
        b.add_entry(path, bytes);
    }
    b.add_entry(
        "shared/data.yaml",
        serde_yaml::to_string(&data).unwrap().into_bytes(),
    );
    b.add_entry("agent/decision-chain.yaml", chain.to_yaml().unwrap());

    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("brief.clan"));
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    let session = Session::new(Arc::new(FsStore::new(dir.path().to_path_buf())));
    session.open(id.clone()).unwrap();
    Fixture {
        _dir: dir,
        session,
        id,
        doc: CHILD.into(),
    }
}

/// A child of the fixture as it stands, nothing added.
fn child(parent: &Fixture) -> Fixture {
    child_of(parent, json!({}), |_| {}, |_| {})
}

fn blockers(f: &Fixture) -> Vec<(String, Option<String>)> {
    f.session
        .read(napkin_host::ops::decisions::decisions)
        .unwrap()
        .attention
        .into_iter()
        .filter(|a| a.blocks_lock)
        .map(|a| (a.code.to_string(), a.address))
        .collect()
}

#[test]
fn a_child_of_a_locked_parent_is_born_open_and_locks_itself() {
    let parent = fixture();
    run(&parent, |c, d| {
        review::verdict(c, d, verdict("findings[fi_01JA0F2B]", "bad", "Wrong base"))
    })
    .unwrap();
    let input = Resolve::parse(
        r#"{"contest":"ct_share","chosen":"f_01JA0B3P4Q","rationale":"Retail value"}"#,
    )
    .unwrap();
    run(&parent, |c, d| review::resolve(c, d, input)).unwrap();
    run(&parent, |c, d| review::approve(c, d, "")).unwrap();

    let brief = child(&parent);
    // The parent's approve travelled; it records that the parent was accepted.
    assert!(chain(&brief)
        .decisions
        .iter()
        .any(|d| d.kind.as_deref() == Some("approve") && d.targets == vec![parent.doc.clone()]));
    // It does not lock the brief: a person still decides here.
    run(&brief, |c, d| {
        review::verdict(c, d, verdict("facts[f_01JA0B3P4Q]", "good", ""))
    })
    .unwrap();
    assert!(blockers(&brief).is_empty(), "{:?}", blockers(&brief));
    run(&brief, |c, d| review::approve(c, d, "")).unwrap();
    let lock = &chain(&brief).decisions[0];
    assert_eq!(lock.kind.as_deref(), Some("approve"));
    assert_eq!(
        lock.targets,
        vec![CHILD.to_string()],
        "the lock names this document"
    );
    // Now the brief is locked, by its own approve.
    assert_eq!(
        run(&brief, |c, d| review::verdict(
            c,
            d,
            verdict("facts[f_01JA0B3P4Q]", "good", "")
        )),
        Err(409)
    );
}

#[test]
fn the_lock_list_counts_every_carried_item() {
    let parent = fixture();
    let brief = child(&parent);
    let b = blockers(&brief);
    let at = |code: &str, address: &str| b.contains(&(code.to_string(), Some(address.to_string())));
    // The research's open contest, carried open, at its upstream address.
    assert!(
        at(
            "open_contest",
            &format!("{}#selection.contested[ct_share]", parent.doc)
        ),
        "{b:?}"
    );
    // The brief's own copy of the unverified finding.
    assert!(
        at(
            "unverified_finding",
            &format!("{CHILD}#findings[fi_01JA0F2B]")
        ),
        "{b:?}"
    );
    assert_eq!(b.len(), 2, "{b:?}");
    let e = brief
        .session
        .perform(brief.session.ctx(), |c, d| review::approve(c, d, ""))
        .unwrap_err();
    assert_eq!(e.status, 409);
    assert!(e.message.contains("carried from upstream"), "{}", e.message);
}

#[test]
fn a_carried_contest_is_resolved_in_the_child_and_the_frozen_copy_stays() {
    let parent = fixture();
    let parent_before = std::fs::read(parent.id.as_str()).unwrap();
    let brief = child(&parent);
    let frozen_before = yaml(&brief, "shared/data.yaml")["upstream"].clone();

    let input = Resolve::parse(r#"{"contest":"ct_share","chosen":"f_01JA0B9Z9Z","rationale":"Retail-only is the market we enter"}"#).unwrap();
    let reply = run(&brief, |c, d| review::resolve(c, d, input)).unwrap();

    // The pick is pinned in the brief's own facts, from the frozen value; the
    // pin of the same identity it replaces is kept, marked.
    let facts = yaml(&brief, "shared/facts.yaml")["facts"].clone();
    let by = |id: &str| {
        facts
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .cloned()
            .unwrap()
    };
    assert_eq!(by("f_01JA0B9Z9Z")["value"], 0.19);
    assert_eq!(by("f_01JA0B3P4Q")["replaced_by"]["fact_id"], "f_01JA0B9Z9Z");
    assert_eq!(
        by("f_01JA0B3P4Q")["replaced_by"]["decision"],
        reply["decision"]
    );

    // The decision targets the upstream contest and the pins it changed here.
    let d = &chain(&brief).decisions[0];
    assert_eq!(d.kind.as_deref(), Some("resolve"));
    assert_eq!(
        d.targets,
        vec![
            format!("{}#selection.contested[ct_share]", parent.doc),
            format!("{CHILD}#facts[f_01JA0B3P4Q]"),
            format!("{CHILD}#facts[f_01JA0B9Z9Z]"),
        ]
    );
    assert!(d.cites.contains(&"d_01JA0D03CON".to_string()));
    // The frozen copy and the parent are exactly as they were.
    assert_eq!(yaml(&brief, "shared/data.yaml")["upstream"], frozen_before);
    assert_eq!(std::fs::read(parent.id.as_str()).unwrap(), parent_before);
    // It is off the lock list, and a second resolve of it is refused.
    assert!(
        !blockers(&brief).iter().any(|(c, _)| c == "open_contest"),
        "{:?}",
        blockers(&brief)
    );
    let again = Resolve::parse(
        &json!({ "contest": format!("{}#selection.contested[ct_share]", parent.doc),
                                        "chosen": "f_01JA0B3P4Q", "rationale": "x" })
        .to_string(),
    )
    .unwrap();
    assert_eq!(run(&brief, |c, d| review::resolve(c, d, again)), Err(409));
    let report = clan_sdk::validate(&on_disk(&brief));
    assert!(report.is_valid(), "{}", report.display());
}

#[test]
fn a_contest_resolved_before_the_hop_is_not_resolved_again() {
    let parent = fixture();
    let input = Resolve::parse(
        r#"{"contest":"ct_share","chosen":"f_01JA0B3P4Q","rationale":"Retail value"}"#,
    )
    .unwrap();
    run(&parent, |c, d| review::resolve(c, d, input)).unwrap();
    let brief = child(&parent);
    let again = Resolve::parse(r#"{"contest":"ct_share","chosen":"f_01JA0B9Z9Z","rationale":"x"}"#)
        .unwrap();
    assert_eq!(run(&brief, |c, d| review::resolve(c, d, again)), Err(409));
    // A document the brief does not carry is not a place to look.
    let elsewhere = Resolve::parse(r#"{"contest":"0d0d0d0d-0000-4000-8000-000000000000#selection.contested[ct_share]","chosen":"f_01JA0B9Z9Z","rationale":"x"}"#).unwrap();
    assert_eq!(
        run(&brief, |c, d| review::resolve(c, d, elsewhere)),
        Err(400)
    );
}

#[test]
fn review_routes_take_ancestor_addresses() {
    let parent = fixture();
    let p = parent.doc.clone();
    let brief = child_of(
        &parent,
        json!({}),
        |data| {
            data["campaign"] = json!({ "problem": { "value": "Frozen is seen as second best", "origin": "stated" } })
        },
        |chain| {
            let bad: clan_sdk::Decision = serde_json::from_value(json!({
                "id": "d_01JA0D09BAD", "kind": "verdict", "agent": "human:ana", "actor": "human:ana",
                "action": "mark_bad", "polarity": "bad", "rationale": "Too vague",
                "targets": [format!("{p}#campaign.problem")], "timestamp": "2026-09-24T10:00:00Z" }))
            .unwrap();
            chain.prepend(bad);
        },
    );
    let frozen_before = yaml(&brief, "shared/data.yaml")["upstream"].clone();
    // The carried bad verdict blocks the brief's lock.
    let problem = format!("{p}#campaign.problem");
    assert!(
        blockers(&brief).contains(&("bad_verdict".into(), Some(problem.clone()))),
        "{:?}",
        blockers(&brief)
    );

    // A finding under the parent's prefix is the brief's copy: that is what
    // changes, so that is what the decision targets.
    run(&brief, |c, d| {
        review::verdict(
            c,
            d,
            verdict(
                &format!("{p}#findings[fi_01JA0F2B]"),
                "bad",
                "Value, not volume",
            ),
        )
    })
    .unwrap();
    assert_eq!(
        chain(&brief).decisions[0].targets,
        vec![format!("{CHILD}#findings[fi_01JA0F2B]")]
    );
    assert_eq!(finding(&brief)["status"], "rejected");
    assert_eq!(
        yaml(&parent, "shared/findings.yaml")["findings"][0]["status"],
        "proposed",
        "the parent's is untouched"
    );

    // A frozen field is marked where it is; overriding the carried bad
    // verdict with a reason answers it. The frozen copy is not written.
    run(&brief, |c, d| {
        review::verdict(
            c,
            d,
            verdict(&problem, "good", "The client's own words; it stands"),
        )
    })
    .unwrap();
    assert_eq!(chain(&brief).decisions[0].targets, vec![problem.clone()]);
    assert!(
        !blockers(&brief).iter().any(|(c, _)| c == "bad_verdict"),
        "{:?}",
        blockers(&brief)
    );
    let input = Classify::parse(&json!({ "target": format!("{p}#selection.contested[ct_share]"), "model": false,
                                         "export": false, "corpus": false, "rationale": "Client panel" }).to_string()).unwrap();
    run(&brief, |c, d| review::classify(c, d, input)).unwrap();
    assert_eq!(
        chain(&brief).decisions[0].targets,
        vec![format!("{p}#selection.contested[ct_share]")]
    );
    assert_eq!(yaml(&brief, "shared/data.yaml")["upstream"], frozen_before);

    // "Looks right" on a carried decision works as on one of its own.
    run(&brief, |c, d| {
        review::acknowledge(c, d, &("d_01JA0D02PIN".into(), String::new()))
    })
    .unwrap();
    assert_eq!(
        chain(&brief).decisions[0].targets,
        vec![format!("{CHILD}#decisions[d_01JA0D02PIN]")]
    );

    // Something the frozen copy does not hold, a document the brief does not
    // carry, and a path into the frozen block by its own name are refused.
    assert_eq!(
        run(&brief, |c, d| review::verdict(
            c,
            d,
            verdict(&format!("{p}#campaign.nope"), "good", "")
        )),
        Err(404)
    );
    assert_eq!(
        run(&brief, |c, d| review::verdict(
            c,
            d,
            verdict(
                "0d0d0d0d-0000-4000-8000-000000000000#campaign.problem",
                "good",
                ""
            )
        )),
        Err(400)
    );
    assert_eq!(
        run(&brief, |c, d| review::verdict(
            c,
            d,
            verdict(&format!("upstream.{p}.campaign.problem"), "good", "")
        )),
        Err(400)
    );
}

#[test]
fn the_frozen_copy_is_read_only() {
    let parent = fixture();
    let brief = child(&parent);
    let before = std::fs::read(brief.id.as_str()).unwrap();
    let p = parent.doc.clone();
    let edit = review::parse_edit(
        &json!({ "path": format!("upstream.{p}.campaign"), "value": "x", "rationale": "tidy" })
            .to_string(),
    )
    .unwrap();
    let e = brief
        .session
        .perform(brief.session.ctx(), |c, d| review::edit(c, d, edit))
        .unwrap_err();
    assert_eq!(e.status, 400);
    assert!(e.message.contains("read-only"), "{}", e.message);
    for patch in [
        json!({ "upstream": { p.clone(): { "campaign": {} } } }),
        json!({ "upstream": null }),
    ] {
        let e = brief
            .session
            .patch_data(&json!({ "patch": patch, "agent": "human" }).to_string())
            .unwrap_err();
        assert_eq!(e.status, 400);
        assert!(
            e.message.contains(&format!("frozen copy of {p}")),
            "{}",
            e.message
        );
    }
    assert_eq!(
        std::fs::read(brief.id.as_str()).unwrap(),
        before,
        "nothing written"
    );
    // Its own fields are still a person's to edit.
    let own = review::parse_edit(
        &json!({ "path": "insight", "value": "Midweek is a habit", "rationale": "Ours" })
            .to_string(),
    )
    .unwrap();
    brief
        .session
        .perform(brief.session.ctx(), |c, d| review::edit(c, d, own))
        .unwrap();
    assert_eq!(
        yaml(&brief, "shared/data.yaml")["insight"],
        "Midweek is a habit"
    );
}

#[test]
fn a_brief_field_citing_a_rejected_finding_blocks_until_it_is_redrafted() {
    let parent = fixture();
    let drafted = |id: &str, cites: &[&str], at: &str| -> clan_sdk::Decision {
        serde_json::from_value(json!({
            "id": id, "kind": "edit", "agent": "draft_brief@1/drafter", "actor": "process:middleware",
            "action": "draft", "rationale": "Drafted.", "targets": [format!("{CHILD}#insight")],
            "cites": cites, "timestamp": at }))
        .unwrap()
    };
    let brief = child_of(
        &parent,
        json!({ "insight": "Frozen is growing fast" }),
        |_| {},
        |chain| {
            chain.prepend(drafted(
                "d_01JB0DRAFT1",
                &["fi_01JA0F2B", "f_01JA0B3P4Q"],
                "2026-09-29T10:00:00Z",
            ))
        },
    );
    run(&brief, |c, d| {
        review::verdict(
            c,
            d,
            verdict("findings[fi_01JA0F2B]", "bad", "Value, not volume"),
        )
    })
    .unwrap();
    let b = blockers(&brief);
    assert!(
        b.contains(&("flagged_field".into(), Some(format!("{CHILD}#insight")))),
        "{b:?}"
    );
}

/// `f`, as the SDK writes a spin-off with its upstream (Contract 4 §5.2,
/// §5.3): the hop recorded in `lineage.carried`, and `extra` entries carried
/// with it — a branch, a merge report beside the frozen copy.
fn spun_off(f: Fixture, parent: &Fixture, extra: &[(&str, &str)]) -> Fixture {
    let clan = on_disk(&f);
    let mut manifest = clan.manifest().clone();
    manifest.lineage = Some(clan_sdk::Lineage {
        parent_id: parent.doc.clone(),
        parent_uri: format!("clan-store:{}", parent.doc),
        parent_sha256: None,
        delta: "spun off".into(),
        parents: Vec::new(),
        merge: false,
        carried: Some(clan_sdk::Carried {
            document_id: parent.doc.clone(),
            data_sha256: "sha256:0".into(),
            facts_sha256: None,
            findings_sha256: None,
            sources_sha256: None,
            last_decision: None,
        }),
    });
    let mut b = clan_sdk::ClanBuilder::new(manifest);
    for (path, bytes) in clan.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH {
            b.add_entry(path, bytes);
        }
    }
    for (path, body) in extra {
        b.add_entry(*path, body.as_bytes().to_vec());
    }
    std::fs::write(f.id.as_str(), b.build().unwrap()).unwrap();
    let session = Session::new(Arc::new(FsStore::new(f._dir.path().to_path_buf())));
    session.open(f.id.clone()).unwrap();
    Fixture { session, ..f }
}

#[test]
fn a_child_sets_aside_what_it_cannot_settle_with_a_reason() {
    let parent = fixture();
    let p = parent.doc.clone();
    let brief = child_of(
        &parent,
        json!({}),
        |data| {
            data["campaign"] =
                json!({ "in_market": { "value": "Retail only", "finding_ids": ["fi_01JA0F2B"] } })
        },
        |_| {},
    );
    let report = "generated_by: test
conflicts:
- key: campaign.objective
  winner: { value: a, agent: drafter }
  losers: [{ value: b, agent: judge }]
unresolved: 1
";
    let merge = format!("upstream/{p}/merge-report.yaml");
    let brief = spun_off(
        brief,
        &parent,
        &[(&merge, report), ("agents/u.drafter.t/data.yaml", "{}")],
    );
    let parent_before = std::fs::read(parent.id.as_str()).unwrap();
    // The brief rejects its copy of the finding the frozen field cites.
    run(&brief, |c, d| {
        review::verdict(
            c,
            d,
            verdict(
                &format!("{p}#findings[fi_01JA0F2B]"),
                "bad",
                "Value, not volume",
            ),
        )
    })
    .unwrap();
    let frozen_before = yaml(&brief, "shared/data.yaml")["upstream"].clone();

    let in_market = format!("{p}#campaign.in_market");
    let branch = format!("{p}#agents[u.drafter.t]");
    let objective = format!("{p}#merge-report[campaign.objective]");
    let contest = format!("{p}#selection.contested[ct_share]");
    let b = blockers(&brief);
    for (code, at) in [
        ("open_contest", &contest),
        ("open_contest", &objective),
        ("unmerged_branch", &branch),
        ("flagged_field", &in_market),
    ] {
        assert!(
            b.contains(&(code.to_string(), Some(at.clone()))),
            "{code} at {at}: {b:?}"
        );
    }
    assert_eq!(b.len(), 4, "{b:?}");

    // A reason is required, however it arrives.
    let ack = |body: Value| review::parse_acknowledge(&body.to_string());
    assert_eq!(ack(json!({ "target": branch })).unwrap_err().status, 400);
    assert_eq!(
        ack(json!({ "target": branch, "rationale": "  " }))
            .unwrap_err()
            .status,
        400
    );
    assert_eq!(
        ack(json!({ "target": branch, "decision": "d_x", "rationale": "y" }))
            .unwrap_err()
            .status,
        400
    );
    assert_eq!(
        ack(json!({ "target": "agents[u.drafter.t]", "rationale": "y" }))
            .unwrap_err()
            .status,
        400
    );
    assert_eq!(ack(json!({ "decision": branch })).unwrap_err().status, 400);
    assert_eq!(ack(json!({})).unwrap_err().status, 400);
    assert_eq!(
        run(&brief, |c, d| review::set_aside(c, d, &branch, " ")),
        Err(400)
    );
    assert_eq!(
        run(&brief, |c, d| review::acknowledge(
            c,
            d,
            &(branch.clone(), String::new())
        )),
        Err(400)
    );

    // What the brief can settle is settled, not set aside: the carried
    // contest is picked with `/resolve`.
    let e = brief
        .session
        .perform(brief.session.ctx(), |c, d| {
            review::set_aside(c, d, &contest, "Not ours")
        })
        .unwrap_err();
    assert_eq!(e.status, 409);
    assert!(e.message.contains("/resolve"), "{}", e.message);
    assert_eq!(
        run(&brief, |c, d| review::set_aside(c, d, &contest, "Not ours")),
        Err(409)
    );
    // Its own things, a document it does not carry, the whole parent, and an
    // address nothing lists are not set aside.
    assert_eq!(
        run(&brief, |c, d| review::set_aside(
            c,
            d,
            &format!("{CHILD}#findings[fi_01JA0F2B]"),
            "x"
        )),
        Err(400)
    );
    assert_eq!(
        run(&brief, |c, d| review::set_aside(
            c,
            d,
            "0d0d0d0d-0000-4000-8000-000000000000#agents[u.drafter.t]",
            "x"
        )),
        Err(400)
    );
    assert_eq!(
        run(&brief, |c, d| review::set_aside(
            c,
            d,
            &format!("{p}#"),
            "x"
        )),
        Err(400)
    );
    assert_eq!(
        run(&brief, |c, d| review::set_aside(
            c,
            d,
            &format!("{p}#agents[nope]"),
            "x"
        )),
        Err(404)
    );
    // Only a person sets something aside.
    let bot = Ctx::new(Actor::process("job_7").unwrap());
    let e = brief
        .session
        .perform(&bot, |c, d| review::set_aside(c, d, &branch, "x"))
        .unwrap_err();
    assert_eq!(e.status, 403);

    // The branch, set aside through `/acknowledge {target, rationale}`.
    let why = "The parent merges its own branch; the brief does not use it";
    run(&brief, |c, d| {
        review::acknowledge(
            c,
            d,
            &ack(json!({ "target": branch, "rationale": why })).unwrap(),
        )
    })
    .unwrap();
    let d = &chain(&brief).decisions[0];
    assert_eq!(d.kind.as_deref(), Some("verdict"));
    assert_eq!(d.action, review::SET_ASIDE);
    assert_eq!(
        d.polarity, None,
        "it says nothing of whether the branch is right"
    );
    assert_eq!(d.targets, vec![branch.clone()]);
    assert_eq!(d.cites, vec![branch.clone()]);
    assert_eq!(d.rationale, why);
    assert!(
        d.actor.as_deref().is_some_and(|a| a.starts_with("human:")),
        "{:?}",
        d.actor
    );
    assert!(!blockers(&brief)
        .iter()
        .any(|(_, a)| a.as_deref() == Some(branch.as_str())));
    assert_eq!(
        run(&brief, |c, d| review::set_aside(c, d, &branch, "Again")),
        Err(409),
        "already set aside"
    );

    // The merge conflict, through the route.
    let r = handle(
        &brief.session,
        &NoConfig,
        HostRequest::new(
            "/acknowledge",
            "",
            json!({ "target": objective, "rationale": "Settled in the research before it locks" })
                .to_string()
                .into_bytes(),
        ),
    );
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let r = handle(
        &brief.session,
        &NoConfig,
        HostRequest::new(
            "/acknowledge",
            "",
            json!({ "target": in_market }).to_string().into_bytes(),
        ),
    );
    assert_eq!(r.status, 400, "no reason, nothing written");

    // The flagged frozen field, citing the finding that flags it.
    run(&brief, |c, d| {
        review::set_aside(
            c,
            d,
            &in_market,
            "The research's wording; the brief does not use it",
        )
    })
    .unwrap();
    assert_eq!(
        chain(&brief).decisions[0].cites,
        vec![in_market.clone(), "fi_01JA0F2B".to_string()]
    );

    // Only what the brief can settle is left; nothing carried was written.
    assert_eq!(
        blockers(&brief),
        vec![("open_contest".to_string(), Some(contest.clone()))]
    );
    assert_eq!(yaml(&brief, "shared/data.yaml")["upstream"], frozen_before);
    let file = on_disk(&brief);
    assert!(file.has_entry("agents/u.drafter.t/data.yaml") && file.has_entry(&merge));
    assert!(
        file.manifest().carried().is_some(),
        "the hop's record survives every write"
    );
    assert_eq!(
        std::fs::read(parent.id.as_str()).unwrap(),
        parent_before,
        "the parent is untouched"
    );

    // Settle the contest, and the brief locks.
    let input = Resolve::parse(
        r#"{"contest":"ct_share","chosen":"f_01JA0B3P4Q","rationale":"Retail value"}"#,
    )
    .unwrap();
    run(&brief, |c, d| review::resolve(c, d, input)).unwrap();
    run(&brief, |c, d| review::approve(c, d, "")).unwrap();
    assert_eq!(
        run(&brief, |c, d| review::set_aside(
            c,
            d,
            &branch,
            "After the lock"
        )),
        Err(409)
    );
    let report = clan_sdk::validate(&on_disk(&brief));
    assert!(report.is_valid(), "{}", report.display());
    assert_eq!(
        std::fs::read(parent.id.as_str()).unwrap(),
        parent_before,
        "the parent is untouched"
    );
}

#[test]
fn a_carried_contest_with_no_value_to_take_can_be_set_aside() {
    // The owner's rule: a spun-off document may dismiss, with a written
    // reason, a carried item it cannot settle. A carried contest none of
    // whose values is held here or carries a frozen pin cannot be resolved
    // here, so it is offered to set aside.
    let parent = fixture();
    let p = parent.doc.clone();
    let brief = child_of(
        &parent,
        json!({}),
        |data| {
            let values = &mut data["selection"]["contested"][0]["values"];
            values[0]["fact_id"] = json!("f_01JANOTHELD");
            values[1].as_object_mut().unwrap().remove("pin");
        },
        |_| {},
    );
    let contest = format!("{p}#selection.contested[ct_share]");
    let view = brief
        .session
        .read(napkin_host::ops::decisions::decisions)
        .unwrap();
    let item = view
        .attention
        .iter()
        .find(|a| a.blocks_lock && a.address.as_deref() == Some(contest.as_str()))
        .expect("the carried contest blocks the lock");
    assert_eq!(item.code, "open_contest");
    assert!(item.can_set_aside, "{}", item.text);
    assert!(
        item.text.contains("cannot be resolved here"),
        "{}",
        item.text
    );

    // /resolve cannot take either value, and says what can be done instead.
    let input = Resolve::parse(r#"{"contest":"ct_share","chosen":"f_01JA0B9Z9Z","rationale":"x"}"#)
        .unwrap();
    let e = brief
        .session
        .perform(brief.session.ctx(), |c, d| review::resolve(c, d, input))
        .unwrap_err();
    assert_eq!(e.status, 409);
    assert!(e.message.contains("set the contest aside"), "{}", e.message);

    // Set aside with a reason, recorded, and it no longer blocks the lock.
    let why = "The brief does not use the frozen share";
    run(&brief, |c, d| review::set_aside(c, d, &contest, why)).unwrap();
    let d = &chain(&brief).decisions[0];
    assert_eq!(
        (d.kind.as_deref(), d.action.as_str()),
        (Some("verdict"), review::SET_ASIDE)
    );
    assert_eq!(d.rationale, why);
    assert!(d.targets.contains(&contest));
    assert!(
        !blockers(&brief)
            .iter()
            .any(|(_, a)| a.as_deref() == Some(contest.as_str())),
        "{:?}",
        blockers(&brief)
    );
    assert_eq!(
        run(&brief, |c, d| review::set_aside(c, d, &contest, why)),
        Err(409),
        "only once"
    );
}

// ── what reconsider writes back: findings updated in place ─────────────────

/// What `reconsider@2` answers with, computed for the document as it is now:
/// `append` and `update` for the findings, having read `read` of it. Its own
/// decision is `d_01JA0D09REC`; a finding appended is proposed under
/// `d_01JA0D0ASYN`.
fn reconsider_reply(f: &Fixture, append: Value, update: Value, read: Value) -> Value {
    let clan = f.session.clan_context_for_agent();
    let doc = &f.doc;
    let mut decisions = vec![json!({
        "id": "d_01JA0D09REC", "kind": "edit", "agent": "reconsider@2", "action": "reconsider",
        "rationale": "Brought in step with a review.",
        "targets": [format!("{doc}#findings[fi_01JA0F2B]")], "cites": ["fi_01JA0F2B"] })];
    if append.as_array().is_some_and(|a| !a.is_empty()) {
        decisions.push(json!({
            "id": "d_01JA0D0ASYN", "kind": "finding", "agent": "reconsider@2",
            "action": "synthesise_finding", "rationale": "worked out again",
            "targets": [format!("{doc}#findings[fi_01JA0F3C]")], "cites": ["f_01JA0B3P5R"],
            "reasoning": reasoning("Worked it out again.", &["f_01JA0B3P5R"]) }));
    }
    json!({
        "api": "napkin.middleware/1", "task": "reconsider", "handler": "reconsider@2",
        "job": { "id": "job_2", "state": "done" }, "result": {},
        "change": { "doc": doc, "base_version": clan["version"], "read": read,
                    "findings_append": append, "findings_update": update, "decisions": decisions },
        "trace": {}
    })
}

fn settle(f: &Fixture, reply: Value) -> Value {
    let env =
        json!({ "ok": true, "status": 200, "endpoint": "http://m", "data": reply, "error": null });
    f.session.settle_middleware(f.session.ctx(), env).0["data"]["change"].clone()
}

/// The finding reconsider works the old one out again as.
fn replacement() -> Value {
    json!([{ "id": "fi_01JA0F3C", "statement": "Frozen is growing in value", "cites": ["f_01JA0B3P5R"],
             "method": "synthesis", "status": "proposed", "derived_by": "reconsider@2",
             "confidence": "medium", "derived_at": "2026-09-24T10:00:01Z", "decision": "d_01JA0D0ASYN" }])
}

fn read_of(f: &Fixture) -> Value {
    json!({ "findings.fi_01JA0F2B": finding(f) })
}

#[test]
fn reconsider_updates_a_finding_in_place_and_supersedes_one_that_fell() {
    let f = fixture();
    run(&f, |c, d| review::verify(c, d, "fi_01JA0F2B", "Checked")).unwrap();
    let verified = finding(&f);

    // A correction left it standing on one pin: it stays verified, its cites
    // and confidence follow, and it says it was checked again.
    let recheck = json!({ "decision": "d_01JA0D09REC",
                          "note": "re-checked against the correction d_01JA0D08COR; still holds" });
    let out = settle(
        &f,
        reconsider_reply(
            &f,
            json!([]),
            json!([{ "id": "fi_01JA0F2B", "confidence": "low", "cites": ["f_01JA0B3P4Q"],
                     "recheck": recheck }]),
            read_of(&f),
        ),
    );
    assert_eq!(out["applied"], true, "{out}");
    let fi = finding(&f);
    assert_eq!(fi["status"], "verified");
    assert_eq!(fi["verification"], verified["verification"], "untouched");
    assert_eq!(fi["statement"], verified["statement"]);
    assert_eq!(fi["cites"], json!(["f_01JA0B3P4Q"]));
    assert_eq!(fi["confidence"], "low");
    assert_eq!(fi["recheck"], recheck);
    assert_eq!(
        yaml(&f, "shared/findings.yaml")["findings"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    conforms(&yaml(&f, "shared/findings.yaml"), "findings.schema.json");
    let p = &yaml(&f, "shared/data.yaml")["projection"]["findings"]["fi_01JA0F2B"];
    assert_eq!(p["recheck"], recheck);
    assert_eq!(p["confidence"], "low");
    assert_eq!(
        chain(&f).decisions[0].actor.as_deref(),
        Some("process:middleware")
    );

    // Later it falls: its replacement is proposed, and it is superseded by it.
    let by = json!({ "finding": "fi_01JA0F3C", "decision": "d_01JA0D09REC" });
    let update = json!([{ "id": "fi_01JA0F2B", "status": "superseded", "superseded_by": by }]);
    let reply = reconsider_reply(&f, replacement(), update.clone(), read_of(&f));
    let out = settle(&f, reply.clone());
    assert_eq!(out["applied"], true, "{out}");
    let all = yaml(&f, "shared/findings.yaml");
    conforms(&all, "findings.schema.json");
    let fi = &all["findings"][0];
    assert_eq!(fi["status"], "superseded");
    assert_eq!(fi["superseded_by"], by);
    assert_eq!(
        fi["verification"], verified["verification"],
        "kept on record"
    );
    assert_eq!(all["findings"][1]["id"], "fi_01JA0F3C");
    let p = &yaml(&f, "shared/data.yaml")["projection"]["findings"];
    assert_eq!(p["fi_01JA0F2B"]["status"], "superseded");
    assert_eq!(p["fi_01JA0F2B"]["superseded_by"], by);

    // The same change again is nothing new.
    assert_eq!(settle(&f, reply)["reason"], "already applied");

    // A superseded finding blocks nothing; its replacement waits for a person.
    let b = blockers(&f);
    let at = |id: &str| Some(format!("{}#findings[{id}]", f.doc));
    assert!(!b.iter().any(|(_, a)| *a == at("fi_01JA0F2B")), "{b:?}");
    assert!(
        b.contains(&("unverified_finding".into(), at("fi_01JA0F3C"))),
        "{b:?}"
    );
}

#[test]
fn a_findings_update_changes_only_what_it_may() {
    let f = fixture();
    let refused = |update: Value, read: Value| -> String {
        let before = std::fs::read(f.id.as_str()).unwrap();
        let out = settle(&f, reconsider_reply(&f, replacement(), update, read));
        assert_eq!(out["applied"], false, "{out}");
        assert_eq!(
            std::fs::read(f.id.as_str()).unwrap(),
            before,
            "nothing written"
        );
        out["reason"].as_str().unwrap().to_string()
    };
    let by = json!({ "finding": "fi_01JA0F3C", "decision": "d_01JA0D09REC" });
    let one = |extra: Value| {
        let mut u = json!({ "id": "fi_01JA0F2B" });
        u.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        json!([u])
    };

    for (update, says) in [
        (
            one(json!({ "statement": "Something else" })),
            "may not change `statement`",
        ),
        (
            one(json!({ "verification": { "decision": "d_01JA0D09REC" } })),
            "may not change `verification`",
        ),
        (one(json!({ "status": "verified" })), "only set the status"),
        (
            one(json!({ "status": "superseded" })),
            "names its superseded_by",
        ),
        (
            one(json!({ "superseded_by": by })),
            "only with status superseded",
        ),
        (
            one(json!({ "status": "superseded",
                     "superseded_by": { "finding": "fi_01JA0F2B", "decision": "d_01JA0D09REC" } })),
            "names another finding",
        ),
        (
            one(json!({ "status": "superseded",
                     "superseded_by": { "finding": "fi_01JA0F3C", "decision": "d_01JA0DNOWHERE" } })),
            "names another finding",
        ),
        (
            one(json!({ "confidence": "certain" })),
            "high, medium or low",
        ),
        (
            one(json!({ "cites": ["f_NOTPINNED1"] })),
            "f_NOTPINNED1, which is not in",
        ),
        (
            one(json!({ "recheck": { "decision": "d_01JA0D09REC", "note": "still holds" } })),
            "only a verified finding",
        ),
        (
            json!([{ "id": "fi_NOTHERE01", "confidence": "low" }]),
            "not in shared/findings.yaml",
        ),
    ] {
        let reason = refused(update, read_of(&f));
        assert!(reason.contains(says), "{says}: {reason}");
    }

    // N2: the change says what it read of each finding it updates, and the
    // document still holds that.
    let update = one(json!({ "confidence": "low" }));
    assert!(refused(update.clone(), json!({})).contains("does not say what the job read"));
    let mut stale = finding(&f);
    stale["confidence"] = json!("high");
    assert!(
        refused(update.clone(), json!({ "findings.fi_01JA0F2B": stale }))
            .contains("fi_01JA0F2B changed since the job read it")
    );

    // A finding a person rejected takes a new confidence, and nothing else.
    run(&f, |c, d| {
        review::verdict(
            c,
            d,
            verdict("findings[fi_01JA0F2B]", "bad", "Value, not volume"),
        )
    })
    .unwrap();
    let supersede = one(json!({ "status": "superseded", "superseded_by": by }));
    assert!(refused(supersede, read_of(&f)).contains("is rejected: only its confidence"));
    let out = settle(&f, reconsider_reply(&f, json!([]), update, read_of(&f)));
    assert_eq!(out["applied"], true, "{out}");
    assert_eq!(finding(&f)["confidence"], "low");
    assert_eq!(finding(&f)["status"], "rejected");
    conforms(&yaml(&f, "shared/findings.yaml"), "findings.schema.json");
}

#[test]
fn a_field_citing_a_superseded_finding_is_flagged_until_it_moves() {
    let f = fixture();
    let cite = |ids: &[&str]| {
        let patch = json!({ "campaign": { "objective": {
            "value": "win midweek", "origin": "stated", "gate": "brief", "by": "human:local",
            "decision": "d_01JA0D09HUM", "finding_ids": ids } } });
        f.session
            .patch_data(&json!({ "patch": patch, "agent": "human" }).to_string())
            .unwrap();
    };
    cite(&["fi_01JA0F2B"]);
    let by = json!({ "finding": "fi_01JA0F3C", "decision": "d_01JA0D09REC" });
    let out = settle(
        &f,
        reconsider_reply(
            &f,
            replacement(),
            json!([{ "id": "fi_01JA0F2B", "status": "superseded", "superseded_by": by }]),
            read_of(&f),
        ),
    );
    assert_eq!(out["applied"], true, "{out}");
    let field = Some(format!("{}#campaign.objective", f.doc));
    let flags = || {
        f.session
            .read(napkin_host::ops::decisions::decisions)
            .unwrap()
            .attention
            .into_iter()
            .filter(|a| a.blocks_lock && a.code == "flagged_field" && a.address == field)
            .map(|a| a.text)
            .collect::<Vec<_>>()
    };
    let t = flags();
    assert_eq!(t.len(), 1, "{t:?}");
    assert!(t[0].contains("superseded with fi_01JA0F3C"), "{}", t[0]);
    // Moved to the replacement: no longer flagged.
    cite(&["fi_01JA0F3C"]);
    assert!(flags().is_empty());
}
