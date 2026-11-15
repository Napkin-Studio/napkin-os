// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/align-confidential-prices.clan, the price half (done_when lines 11 and 12, and the reviews' finding a):
//! a run's cost is one `run_cost` decision in the document's chain, by the task's agent, with numbers and ids only;
//! and neither a `run_cost` nor a `set_budget` decision, nor the price a verdict was given, ever reaches an agent:
//! the context the host sends (`Session::clan_context_for_agent`, which `POST /api-proxy` sends as `clan`) leaves
//! them out.

use std::sync::Arc;

use clan_sdk::{ClanBuilder, ClanFile, DecisionChain};
use napkin_host::ops::judge::{self, RunCost};
use napkin_host::{Actor, Ctx, DocId, FsStore, Session};
use serde_json::{json, Value};

/// A chain as an older document holds it: a person's edit, a verdict that kept the price it was given, a budget.
const CHAIN: &str = "decisions:
- id: d_budget0001
  kind: set_budget
  agent: human:cian@wk
  action: set_budget
  targets: [J001]
  rationale: Recorded the budget of J001.
  timestamp: 2026-11-14T09:00:00Z
  set_budget: { job: J001, hours: 80.0 }
- id: d_verdict001
  kind: verdict
  agent: judge
  action: score
  targets: [script]
  rationale: Judge scored the script.
  timestamp: 2026-11-14T08:00:00Z
  judge: { total: 22, price_eur: 0.04, advised_route: team }
- id: d_edit000001
  kind: edit
  agent: human:maeve@wk
  action: edit_field
  targets: [script]
  rationale: Wrote the first line.
  timestamp: 2026-11-14T07:00:00Z
";

fn fixture() -> (tempfile::TempDir, Session, DocId) {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("script.clan"));
    let bytes = clan_sdk::create(clan_sdk::CreateOptions {
        title: "J001 radio script".into(),
        brief: "a script".into(),
        document_type: None,
        no_render: true,
        schema: None,
    })
    .unwrap();
    let clan = ClanFile::from_bytes(bytes).unwrap();
    let mut b = ClanBuilder::new(clan.manifest().clone());
    for (path, entry) in clan.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH && path != "agent/decision-chain.yaml" {
            b.add_entry(path, entry);
        }
    }
    b.add_entry("agent/decision-chain.yaml", CHAIN.as_bytes().to_vec());
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    let session = Session::with_ctx(
        Arc::new(FsStore::new(dir.path().to_path_buf())),
        Ctx::new(Actor::human("maeve@wk").unwrap()),
    );
    session.open(id.clone()).unwrap();
    (dir, session, id)
}

fn chain(id: &DocId) -> DecisionChain {
    let c = ClanFile::open(id.as_str()).unwrap();
    DecisionChain::from_yaml(&c.read_entry("agent/decision-chain.yaml").unwrap()).unwrap()
}

fn by_judge() -> Ctx {
    Ctx::new(Actor::process(judge::AGENT).unwrap()).with_handler(judge::HANDLER)
}

#[test]
fn a_runs_cost_is_one_run_cost_decision_by_the_tasks_agent_with_numbers_and_ids_only() {
    let (_dir, session, id) = fixture();
    let usage = json!({ "estimate_eur": 0.05, "charged_eur": 0.02, "route": "eu-small" });
    let cost = RunCost::from_usage(&usage).expect("a usage block is a cost");
    let version = session.current_version().unwrap();
    session
        .perform(&by_judge(), |c, d| judge::run_cost_outcome(c, d, &cost))
        .unwrap();
    let c = chain(&id);
    let d = &c.decisions[0];
    assert_eq!(
        (d.kind.as_deref(), d.action.as_str(), d.agent.as_str()),
        (Some("run_cost"), "run_cost", "judge")
    );
    assert!(d.kind_is_known());
    let block = serde_json::to_value(d.extra.get("run_cost").unwrap()).unwrap();
    let mut keys: Vec<&str> = block
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "at",
            "charged_eur",
            "document",
            "estimate_eur",
            "guard",
            "route",
            "task",
            "version"
        ]
    );
    assert_eq!(block["charged_eur"], json!(0.02));
    assert_eq!(block["estimate_eur"], json!(0.05));
    assert_eq!(block["route"], "eu-small");
    assert_eq!(block["guard"], "allowed");
    assert_eq!(block["task"], "judge_work");
    assert_eq!(block["version"], version.as_str());
    assert_eq!(
        block["document"],
        ClanFile::open(id.as_str()).unwrap().document_id()
    );
    // the words carry no figure: the figure is read from the block, in the Decisions drawer only
    assert!(
        !d.rationale.chars().any(|ch| ch.is_ascii_digit()),
        "{}",
        d.rationale
    );

    // a run the guard refused costs nothing and says so
    let refused = RunCost::refused();
    session
        .perform(&by_judge(), |c, d| judge::run_cost_outcome(c, d, &refused))
        .unwrap();
    let c = chain(&id);
    let block = serde_json::to_value(c.decisions[0].extra.get("run_cost").unwrap()).unwrap();
    assert_eq!(
        (block["guard"].clone(), block["charged_eur"].clone()),
        (json!("refused"), json!(0.0))
    );

    // a usage block that is not numbers is no cost: nothing is invented
    assert!(RunCost::from_usage(&json!({ "charged_eur": "a lot" })).is_none());
    assert!(RunCost::from_usage(&json!(null)).is_none());
    assert!(RunCost::from_usage(&json!({ "charged_eur": -1.0, "estimate_eur": 0.0 })).is_none());
}

// Review finding (a): the decision chain is sent to agents with every request (`clan.decision_chain`); a run's
// cost, a budget and the price a verdict was given are left out of it, and nothing else is.
#[test]
fn no_run_cost_no_budget_and_no_verdict_price_reaches_an_agent() {
    let (_dir, session, _id) = fixture();
    let cost = RunCost::from_usage(
        &json!({ "estimate_eur": 0.05, "charged_eur": 0.02, "route": "eu-small" }),
    )
    .unwrap();
    session
        .perform(&by_judge(), |c, d| judge::run_cost_outcome(c, d, &cost))
        .unwrap();
    let sent = session.clan_context_for_agent();
    let list = sent["decision_chain"]["decisions"].as_array().unwrap();
    let kinds: Vec<&str> = list
        .iter()
        .map(|d| d["kind"].as_str().unwrap_or(""))
        .collect();
    assert_eq!(
        kinds,
        ["verdict", "edit"],
        "the cost and the budget are left out, and nothing else"
    );
    let text = sent.to_string();
    for word in [
        "run_cost",
        "set_budget",
        "charged_eur",
        "estimate_eur",
        "price_eur",
        "0.02",
        "0.04",
    ] {
        assert!(!text.contains(word), "{word} reached an agent");
    }
    // the verdict itself still travels, its score kept
    let verdict: &Value = &list[0];
    assert_eq!(verdict["judge"]["total"], 22);
}
