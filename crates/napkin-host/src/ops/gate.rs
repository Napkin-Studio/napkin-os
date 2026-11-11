// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Brief gate (features/brief-gate.clan; docs/napkin-os-build-prompt-v2.md §6).
//!
//! No creative work starts on a brief that has not passed the gate, been signed
//! by the agency and been confirmed by the client. The gate is a view over the
//! brief's own parts, not a second record: six items, each `pass` or `missing`
//! with its evidence, worked out here from the document's data by rules code
//! can apply (what the Judge thinks of the words is the middleware's, and
//! reaches the lock list as a verdict, item 5 of Contract 4 §7.2). A missing
//! item is a lock blocker (`gate_item`), so `/approve` refuses through the one
//! enforcement point there already is, and the brief's two signers are a list
//! on the brief, read here:
//!
//! ```yaml
//! signers:
//!   - { role: planner, person: aoife@wk }
//!   - { role: creative_director, person: dara@wk }
//! ```
//!
//! The planner signs first (`/sign`, one `sign` decision on the content as it
//! stands), the creative director's signature is the `approve` that locks it,
//! and the client's confirmation is a `client_review` that accepts the locked
//! version. Territories open on all of them, read through [`GateView`]; the
//! order matters only to the words on the screen, the state is computed from
//! the decisions in any order.
//!
//! Off by default: only `NAPKIN_BRIEF_GATE=on` makes the host enforce it
//! (the environment is not there in a browser build, so the wasm host never
//! does). The view is always there to read.

use serde::Serialize;
use serde_json::Value;

use clan_sdk::{Decision, DecisionChain};

use crate::ctx::Ctx;
use crate::document::Document;
use crate::error::{HostError, HostResult};

use super::decisions::DecisionsView;
use super::{read, review, Outcome};

/// The one app whose documents the gate reads.
pub const BRIEF_MAKER: &str = "ie.napkin.brief-maker";

/// The decision a planner's signature writes.
pub const SIGN: &str = "sign";

pub const PLANNER: &str = "planner";
pub const CREATIVE_DIRECTOR: &str = "creative_director";

/// The gate is enforced (the lock list holds it) only when this is set.
pub fn enforced() -> bool {
    std::env::var("NAPKIN_BRIEF_GATE").is_ok_and(|v| v.eq_ignore_ascii_case("on"))
}

/// The gate reads this document: a Brief Maker brief.
pub fn applies(doc: &Document) -> bool {
    applies_to(doc.clan())
}

/// [`applies`], for a bare archive.
pub fn applies_to(clan: &clan_sdk::ClanFile) -> bool {
    clan.manifest()
        .app
        .as_ref()
        .is_some_and(|a| a.app_id == BRIEF_MAKER)
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Item {
    pub id: &'static str,
    /// What the screen calls it.
    pub label: &'static str,
    /// `pass` or `missing`.
    pub state: &'static str,
    /// The brief's own words the verdict rests on, when it has any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<String>,
    /// Why it is missing, in a sentence.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Signer {
    pub role: String,
    pub person: String,
    pub signed: bool,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct GateView {
    /// The host holds the lock list to it (`NAPKIN_BRIEF_GATE=on`).
    pub enforced: bool,
    pub items: Vec<Item>,
    pub missing: usize,
    /// All six items pass.
    pub passed: bool,
    pub signers: Vec<Signer>,
    /// The planner has signed this content.
    pub planner_signed: bool,
    /// The creative director's `approve` holds: the brief is locked.
    pub signed: bool,
    /// The client has accepted the locked version.
    pub confirmed: bool,
    /// The brief was edited after it was signed: the signed version stays as
    /// it was and the changed one needs signing again.
    pub changed_since_lock: bool,
    /// Territories may open: passed, signed, confirmed, and not changed since.
    /// Always true while the gate is not enforced.
    pub open: bool,
    /// What still stands between the brief and Territories, in words.
    pub waiting_on: Vec<String>,
}

// ── the six items ───────────────────────────────────────────────────────────

fn text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| text(Some(x)))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("; "),
        Some(Value::Object(o)) => o
            .values()
            .map(|x| text(Some(x)))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

fn sentences(s: &str) -> usize {
    let mut n = 0;
    let chars: Vec<char> = s.trim().chars().collect();
    let mut i = 0;
    let mut open = false;
    while i < chars.len() {
        let c = chars[i];
        if matches!(c, '.' | '!' | '?') {
            let end = i + 1 >= chars.len() || chars[i + 1].is_whitespace();
            if end && open {
                n += 1;
                open = false;
            }
        } else if !c.is_whitespace() {
            open = true;
        }
        i += 1;
    }
    n + usize::from(open)
}

fn has_digit(s: &str) -> bool {
    s.chars().any(|c| c.is_ascii_digit())
}

fn item(id: &'static str, label: &'static str, evidence: String, why: Option<String>) -> Item {
    let evidence = Some(evidence).filter(|e| !e.is_empty());
    Item {
        id,
        label,
        state: if why.is_none() { "pass" } else { "missing" },
        evidence,
        why,
    }
}

/// The six gate items of a brief's data, in the order the screen shows them.
pub fn items(data: &Value) -> Vec<Item> {
    let smp = text(data.get("single_minded_proposition"));
    let proposition = match sentences(&smp) {
        0 => item(
            "proposition",
            "One proposition",
            smp,
            Some("The brief has no single-minded proposition.".into()),
        ),
        1 => item("proposition", "One proposition", smp, None),
        n => item(
            "proposition",
            "One proposition",
            smp,
            Some(format!(
                "The proposition runs to {n} sentences. It should be one."
            )),
        ),
    };

    let ins = text(data.get("insight"));
    let insight = if ins.is_empty() {
        item(
            "insight",
            "One insight",
            ins,
            Some("The brief has no insight.".into()),
        )
    } else {
        item("insight", "One insight", ins, None)
    };

    let obj = text(data.get("objectives"));
    let objective = if obj.is_empty() {
        item(
            "objective",
            "One measurable objective",
            obj,
            Some("The brief has no objective.".into()),
        )
    } else if !has_digit(&obj) {
        item(
            "objective",
            "One measurable objective",
            obj,
            Some("The objective gives no number and no date.".into()),
        )
    } else {
        item("objective", "One measurable objective", obj, None)
    };

    let resp = data.get("desired_response");
    let feel_do = [
        text(resp.and_then(|r| r.get("feel"))),
        text(resp.and_then(|r| r.get("do"))),
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    let feel = if feel_do.is_empty() {
        item(
            "feel_or_do",
            "Feel or do",
            feel_do,
            Some("The brief says nothing of what people should feel or do.".into()),
        )
    } else {
        item("feel_or_do", "Feel or do", feel_do, None)
    };

    let famous_text = text(data.get("famous"));
    let famous = if famous_text.is_empty() {
        item(
            "famous",
            "What would make this famous",
            famous_text,
            Some("Nobody has said what would make this famous.".into()),
        )
    } else {
        item("famous", "What would make this famous", famous_text, None)
    };

    let how = text(data.get("measurement"));
    let low = how.to_lowercase();
    let anchored = [
        "baseline",
        "benchmark",
        "last year",
        "last quarter",
        "last month",
        "last autumn",
        "last spring",
        "last summer",
        "last winter",
        "currently",
        "today",
    ]
    .iter()
    .any(|w| low.contains(w));
    let plan = if how.is_empty() {
        item(
            "baseline",
            "How we will know",
            how,
            Some("The brief has no effectiveness plan.".into()),
        )
    } else if !anchored || !has_digit(&how) {
        item(
            "baseline",
            "How we will know",
            how,
            Some("The plan names no baseline to measure against.".into()),
        )
    } else {
        item("baseline", "How we will know", how, None)
    };

    vec![proposition, insight, objective, feel, famous, plan]
}

// ── the signers ─────────────────────────────────────────────────────────────

fn signer_list(data: &Value) -> Vec<(String, String)> {
    data.get("signers")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|s| {
                    let role = s.get("role")?.as_str()?.trim().to_string();
                    let person = s.get("person")?.as_str()?.trim().to_string();
                    (!role.is_empty() && !person.is_empty()).then_some((role, person))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn person_of(actor: &str) -> &str {
    actor.strip_prefix("human:").unwrap_or(actor)
}

fn role_of(data: &Value, actor: &str) -> Option<String> {
    let who = person_of(actor);
    signer_list(data)
        .into_iter()
        .find(|(_, p)| p == who)
        .map(|(r, _)| r)
}

fn live(d: &Decision) -> bool {
    d.superseded_by.is_none()
}

/// Whether the document was edited after the decision at `at` (the chain is
/// newest first, so newer is a smaller index).
fn edited_since(chain: &DecisionChain, at: usize) -> bool {
    chain.decisions[..at]
        .iter()
        .any(|d| live(d) && d.kind.as_deref() == Some("edit"))
}

/// The planner's `sign` that still holds: nothing edited since, by the planner named on the brief.
fn planner_sign(chain: &DecisionChain, doc_id: &str, planner: &str) -> Option<usize> {
    let i = chain.decisions.iter().position(|d| {
        live(d)
            && d.kind.as_deref() == Some(SIGN)
            && d.targets.iter().any(|t| t == doc_id)
            && person_of(d.actor.as_deref().unwrap_or("")) == planner
    })?;
    (!edited_since(chain, i)).then_some(i)
}

// ── what the lock list says ─────────────────────────────────────────────────

/// The gate's items on the lock list: one text per thing still missing. Empty
/// when the gate is not enforced or the document is not a brief.
pub fn blockers(clan: &clan_sdk::ClanFile, data: &Value, chain: &DecisionChain) -> Vec<String> {
    if !enforced() || !applies_to(clan) {
        return Vec::new();
    }
    let mut out: Vec<String> = items(data)
        .into_iter()
        .filter(|i| i.state == "missing")
        .map(|i| {
            format!(
                "Brief gate, {}: {}",
                i.label.to_lowercase(),
                i.why.unwrap_or_default()
            )
        })
        .collect();
    let list = signer_list(data);
    let planner = list
        .iter()
        .find(|(r, _)| r == PLANNER)
        .map(|(_, p)| p.clone());
    let cd = list.iter().any(|(r, _)| r == CREATIVE_DIRECTOR);
    match (&planner, cd) {
        (None, _) | (_, false) => out.push(
            "Brief gate, who signs: name the planner and the creative director who sign this brief.".into(),
        ),
        (Some(p), true) => {
            if planner_sign(chain, clan.document_id(), p).is_none() {
                out.push(format!("Brief gate, signing: the planner, {p}, has not signed this version."));
            }
        }
    }
    out
}

/// Before `/approve` locks a gated brief: only the creative director named on it signs by locking.
pub fn may_lock(ctx: &Ctx, doc: &Document) -> HostResult<()> {
    if !enforced() || !applies(doc) {
        return Ok(());
    }
    let data = read::data_json(doc);
    let list = signer_list(&data);
    let me = person_of(ctx.actor.as_str());
    if list.iter().any(|(r, p)| r == CREATIVE_DIRECTOR && p != me)
        && role_of(&data, me).as_deref() != Some(CREATIVE_DIRECTOR)
    {
        return Err(HostError::new(
            403,
            "only the creative director named on this brief can sign it into its lock".to_string(),
        ));
    }
    Ok(())
}

// ── the view ────────────────────────────────────────────────────────────────

/// The gate as `GET /gate` answers it, from the document and its decision view.
pub fn view(doc: &Document, decisions: &DecisionsView) -> HostResult<GateView> {
    let data = read::data_json(doc);
    let chain = review::chain_of(doc)?;
    let doc_id = doc.clan().document_id();
    let items = items(&data);
    let missing = items.iter().filter(|i| i.state == "missing").count();
    let passed = missing == 0;

    let lock_at = review::lock_index(&chain, doc_id);
    let signed = lock_at.is_some();
    let changed = lock_at.is_some_and(|i| edited_since(&chain, i));
    let confirmed = decisions
        .client
        .answer
        .as_ref()
        .is_some_and(|a| a.answer == "accepted" && a.current);

    let list = signer_list(&data);
    let planner = list
        .iter()
        .find(|(r, _)| r == PLANNER)
        .map(|(_, p)| p.clone());
    let planner_signed = planner
        .as_deref()
        .is_some_and(|p| planner_sign(&chain, doc_id, p).is_some());
    let signers = list
        .iter()
        .map(|(role, person)| Signer {
            role: role.clone(),
            person: person.clone(),
            signed: match role.as_str() {
                PLANNER => planner_signed,
                CREATIVE_DIRECTOR => signed && !changed,
                _ => false,
            },
        })
        .collect();

    let enforced = enforced();
    let mut waiting = Vec::new();
    if !passed {
        waiting.push(if missing == 1 {
            "One gate item is missing.".to_string()
        } else {
            format!("{missing} gate items are missing.")
        });
    }
    if changed {
        waiting
            .push("The brief changed after it was signed. The new version needs signing.".into());
    } else if !signed {
        waiting.push("The agency has not signed this version.".into());
    }
    if !confirmed || changed {
        waiting.push("The client has not confirmed this version.".into());
    }
    let open = !enforced || (passed && signed && confirmed && !changed);
    Ok(GateView {
        enforced,
        items,
        missing,
        passed,
        signers,
        planner_signed,
        signed,
        confirmed,
        changed_since_lock: changed,
        open,
        waiting_on: if open { Vec::new() } else { waiting },
    })
}

/// `POST /sign`: the signer named on the brief signs this version. The planner
/// writes a `sign` decision; the creative director's signature is the lock, so
/// that is `/approve` itself (one `approve` decision on this version).
pub fn sign(ctx: &Ctx, doc: &Document, rationale: &str) -> HostResult<Outcome> {
    let who = review::person(ctx, "sign the brief")?;
    if !applies(doc) {
        return Err(HostError::bad_request(
            "only a Brief Maker brief has signers",
        ));
    }
    let data = read::data_json(doc);
    let Some(role) = role_of(&data, &who) else {
        return Err(HostError::new(
            403,
            format!("{who} is not named as a signer on this brief"),
        ));
    };
    if role == CREATIVE_DIRECTOR {
        return review::approve(ctx, doc, rationale);
    }
    let chain = review::chain_of(doc)?;
    let doc_id = doc.clan().document_id().to_string();
    if let Some(lock) = review::lock_of(&chain, &doc_id) {
        return Err(HostError::conflict(format!(
            "the brief was locked by {} at {}; a changed brief needs a new version before it is signed",
            lock.actor.as_deref().unwrap_or(&lock.agent),
            lock.timestamp
        )));
    }
    let missing: Vec<String> = items(&data)
        .into_iter()
        .filter(|i| i.state == "missing")
        .map(|i| i.label.to_lowercase())
        .collect();
    if !missing.is_empty() {
        return Err(HostError::conflict(format!(
            "the brief does not pass the gate yet: {}",
            missing.join(", ")
        )));
    }
    let now = review::now();
    let mut d = review::decided(
        ctx,
        &who,
        SIGN,
        "planner_sign",
        vec![doc_id],
        Vec::new(),
        if rationale.is_empty() {
            "Signed as the planner.".to_string()
        } else {
            rationale.to_string()
        },
        &now,
    );
    d.version = Some(doc.version().as_str().to_string());
    let clan = doc.clan();
    review::commit_with(
        doc,
        super::assemble::data_of(clan)?,
        super::assemble::Members::of(clan)?,
        d,
        Vec::new(),
        "signed",
        &now,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn states(v: &Value) -> Vec<(&'static str, &'static str)> {
        items(v).into_iter().map(|i| (i.id, i.state)).collect()
    }

    #[test]
    fn an_empty_brief_misses_all_six() {
        assert!(states(&json!({})).iter().all(|(_, s)| *s == "missing"));
        assert_eq!(items(&json!({})).len(), 6);
    }

    #[test]
    fn a_brief_with_no_baseline_fails_the_sixth_item() {
        let v = json!({
            "single_minded_proposition": "The easy way in.",
            "insight": "People think it is for someone else.",
            "objectives": { "commercial": "Grow sales by 8%." },
            "desired_response": { "feel": "Welcome." },
            "famous": "A bar that closes for one song.",
            "measurement": ["Track consideration monthly."],
        });
        let got = states(&v);
        assert_eq!(got.last(), Some(&("baseline", "missing")));
        assert_eq!(got.iter().filter(|(_, s)| *s == "missing").count(), 1);
        let mut with = v.clone();
        with["measurement"] = json!(["Baseline: 6% of orders. Target: 14% by December."]);
        assert!(states(&with).iter().all(|(_, s)| *s == "pass"));
    }

    #[test]
    fn a_vague_objective_is_missing_its_number() {
        let v =
            json!({ "objectives": { "commercial": "Grow consideration among younger drinkers." } });
        let o = &items(&v)[2];
        assert_eq!(
            (o.state, o.evidence.as_deref()),
            (
                "missing",
                Some("Grow consideration among younger drinkers.")
            )
        );
    }

    #[test]
    fn the_proposition_is_one_sentence() {
        assert_eq!(sentences("The easy way in."), 1);
        assert_eq!(sentences("The easy way in. And the fun one."), 2);
        assert_eq!(sentences("Not a full stop"), 1);
        assert_eq!(sentences(""), 0);
        let two = json!({ "single_minded_proposition": "One. Two." });
        assert_eq!(items(&two)[0].state, "missing");
    }

    #[test]
    fn signers_are_read_from_the_brief() {
        let v = json!({ "signers": [{ "role": "planner", "person": "aoife@wk" }, { "role": "creative_director", "person": "dara@wk" }] });
        assert_eq!(
            role_of(&v, "human:dara@wk").as_deref(),
            Some("creative_director")
        );
        assert_eq!(role_of(&v, "human:cian@wk"), None);
    }
}
