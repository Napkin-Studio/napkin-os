// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Idea room (features/idea-room.clan; docs/napkin-os-build-prompt-v2.md section 3, step 4).
//!
//! The team posts its own ideas first. Everything that makes that true is here, in the host, where a
//! page cannot skip it:
//!
//! * **Cards are written by a person, here.** A card's author and its kind come from the request's
//!   context, never from its body, and `patch-data` refuses the keys this module owns (`cards`,
//!   `routes`, `routes_out`, `chosen`, `ai_open`). The count of "team cards" is read from the decision
//!   chain: a card counts when a `idea_card` decision by a `human:` actor made it, so a card a handler
//!   wrote does not count.
//! * **Humans first.** No Idea room model task is proxied until the chain holds the declared number
//!   of team cards (`humans_first.cards` in the template's `app/pipeline.yaml`, five when it says
//!   nothing), or the creative director opened it early with one attributed decision and a reason.
//! * **Routes are forks.** `routes_start` forks the room into one branch document per route; people
//!   write a route through `route_edit`, which patches the branch's own namespace (the host's
//!   `patch-data` refuses a branch); `merge` folds the branches back with the SDK's deterministic
//!   merge, no model. While routes are out the room itself takes no write: the merge starts from the
//!   branches, so a card written meanwhile would be lost.
//! * **The pick is a verdict** by the creative director the brief names, on one exact route version,
//!   written only here; reopening it needs a reason and leaves the first pick in the history.
//!
//! The room's data, one document:
//!
//! ```yaml
//! cards:  { c1: { text, by, kind: team, at, brief_link: { insight, proposition }, votes: [], comments: [], tests: {} } }
//! ai_open: { state: early, by, decision, at, reason }
//! routes_out: [route_1, route_2]            # branches that are not merged yet
//! routes: { route_1: { name, bet, cards: [c1], notes: [], version: 3, branch } }
//! chosen: { route, version, decision, by, at }
//! ```

use serde::Serialize;
use serde_json::{json, Value};

use clan_sdk::{
    fork as sdk_fork,
    merge::{merge as sdk_merge, MergeOptions, MergeReport, MERGE_REPORT_PATH},
    patch_data_namespaced, patch_decision, ClanBuilder, ClanFile, Decision, DecisionChain,
    DecisionEntry,
};

use crate::ctx::Ctx;
use crate::document::{Change, Document, Version};
use crate::error::{HostError, HostResult};
use crate::event::HostEvent;
use crate::store::{DocId, DocStore};

use super::assemble::{assemble, data_of, Members};
use super::{gate, review, versions, Outcome};

/// The one app whose documents this module reads.
pub const IDEA_ROOM: &str = "ie.napkin.idea-room";

/// The three model tasks the Idea room's later slices add (features/idea-room.clan, slice 2). Named
/// here so the host refuses them until the room is open.
pub const MODEL_TASKS: [&str; 3] = ["ban_default", "swap_test", "fame_test"];

/// Team cards before the AI may show an idea, when the template declares no other number.
pub const DEFAULT_CARDS: usize = 5;

const CARD: &str = "idea_card";
const VOTE: &str = "idea_vote";
const COMMENT: &str = "idea_comment";
const OPEN_EARLY: &str = "open_early";
const ROUTES_START: &str = "routes_start";
const ROUTE_EDIT: &str = "route_edit";
const MERGE_ROUTES: &str = "merge_routes";
const PICK: &str = "pick_route";
const REOPEN: &str = "reopen_choice";
/// The verdict's reason code and the reviewer role it is written under.
pub const ROUTE_CHOSEN: &str = "route.chosen";
pub const CREATIVE_DIRECTOR_ROLE: &str = "creative-director";

/// The top-level data keys only this module writes. `patch-data` refuses every one of them on an Idea room.
pub const HOST_KEYS: [&str; 5] = ["cards", "routes", "routes_out", "chosen", "ai_open"];

const MAX_CARD: usize = 600;
const MAX_NAME: usize = 80;
const MAX_BET: usize = 400;
const MAX_NOTE: usize = 600;
const MAX_ROUTES: usize = 5;

/// The document is an Idea room.
pub fn applies(doc: &Document) -> bool {
    doc.clan()
        .manifest()
        .app
        .as_ref()
        .is_some_and(|a| a.app_id == IDEA_ROOM)
}

fn require_room(doc: &Document) -> HostResult<()> {
    if applies(doc) {
        Ok(())
    } else {
        Err(HostError::bad_request("this is not an Idea room"))
    }
}

// ── the shared reads ────────────────────────────────────────────────────────

fn text_of(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn body(raw: &str) -> HostResult<Value> {
    let v: Value = serde_json::from_str(raw)
        .map_err(|e| HostError::bad_request(format!("invalid JSON: {e}")))?;
    if v.is_object() {
        Ok(v)
    } else {
        Err(HostError::bad_request("the body must be a JSON object"))
    }
}

fn clipped(s: &str, n: usize) -> String {
    if s.chars().count() > n {
        format!("{}…", s.chars().take(n - 1).collect::<String>())
    } else {
        s.to_string()
    }
}

fn person_of(actor: &str) -> &str {
    actor.strip_prefix("human:").unwrap_or(actor)
}

fn obj<'a>(data: &'a Value, key: &str) -> Option<&'a serde_json::Map<String, Value>> {
    data.get(key).and_then(Value::as_object)
}

/// How many team cards the room needs before the AI opens: the template's declaration, else five.
pub fn needed(doc: &Document) -> usize {
    doc.clan()
        .read_entry_string("app/pipeline.yaml")
        .ok()
        .and_then(|y| serde_yaml::from_str::<serde_yaml::Value>(&y).ok())
        .and_then(|y| y.get("humans_first")?.get("cards")?.as_u64())
        .map(|n| n as usize)
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_CARDS)
}

/// The ids of the team cards a person made: a live `idea_card` decision by a `human:` actor, for a card
/// that is still in the data as `kind: team`. Read from the chain, not from the card's own `by`.
pub fn team_card_ids(data: &Value, chain: &DecisionChain) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for d in &chain.decisions {
        if d.action != CARD || !d.actor.as_deref().is_some_and(|a| a.starts_with("human:")) {
            continue;
        }
        for t in &d.targets {
            let Some(id) = t
                .split_once("#cards[")
                .and_then(|(_, r)| r.strip_suffix(']'))
            else {
                continue;
            };
            let is_team = obj(data, "cards")
                .and_then(|c| c.get(id))
                .and_then(|c| c.get("kind"))
                .and_then(Value::as_str)
                == Some("team");
            if is_team && !out.iter().any(|x| x == id) {
                out.push(id.to_string());
            }
        }
    }
    out
}

/// The creative director the brief names: the one on the signers list of the brief this room carries.
pub fn creative_director(data: &Value) -> Option<String> {
    gate::visual_brief_approver(data)
}

fn routes_out(data: &Value) -> Vec<String> {
    data.get("routes_out")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn refuse_while_routes_out(data: &Value) -> HostResult<()> {
    let out = routes_out(data);
    if out.is_empty() {
        return Ok(());
    }
    Err(HostError::conflict(format!(
        "routes are out ({}); merge them before changing the room",
        out.join(", ")
    )))
}

// ── the gate ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, PartialEq)]
pub struct GateView {
    /// Team cards written by a person.
    pub team_cards: usize,
    pub needed: usize,
    /// Cards still to come before the AI may show an idea (0 once open).
    pub to_go: usize,
    /// A model task may be proxied.
    pub open: bool,
    /// `cards` once the team's own cards opened it, `early` when the creative director did, else null.
    pub opened_via: Option<&'static str>,
    /// The person who opened it early.
    pub opened_by: Option<String>,
    /// Who may open it early and pick: the creative director the brief names.
    pub creative_director: Option<String>,
    /// Branches not merged yet.
    pub routes_out: Vec<String>,
    /// The pick that holds, if one does.
    pub chosen: Option<Value>,
}

/// `GET /ideas/gate`.
pub fn gate_view(doc: &Document) -> HostResult<GateView> {
    require_room(doc)?;
    let data = data_of(doc.clan())?;
    let chain = review::chain_of(doc)?;
    let needed = needed(doc);
    let team = team_card_ids(&data, &chain).len();
    let early = data
        .get("ai_open")
        .filter(|a| a.get("state").and_then(Value::as_str) == Some("early"))
        .and_then(|a| a.get("by").and_then(Value::as_str))
        .map(|b| person_of(b).to_string());
    let via = if early.is_some() {
        Some("early")
    } else if team >= needed {
        Some("cards")
    } else {
        None
    };
    Ok(GateView {
        team_cards: team,
        needed,
        to_go: if via.is_some() { 0 } else { needed - team },
        open: via.is_some(),
        opened_via: via,
        opened_by: early,
        creative_director: creative_director(&data),
        routes_out: routes_out(&data),
        chosen: data.get("chosen").filter(|c| c.is_object()).cloned(),
    })
}

/// The host's check in front of the proxy: no Idea room model task runs until the room is open. Refused
/// `409` with `ideas_closed`. A task for any other document is refused too.
pub fn allow_model_task(doc: &Document) -> HostResult<()> {
    if !applies(doc) {
        return Err(HostError::bad_request(
            "this task belongs to an Idea room, and this document is not one",
        ));
    }
    let g = gate_view(doc)?;
    if g.open {
        return Ok(());
    }
    Err(HostError::conflict(format!(
        "ideas_closed: the team goes first. {} more team {} before the AI shows an idea, or the creative director opens it early.",
        g.to_go,
        if g.to_go == 1 { "card" } else { "cards" },
    )))
}

/// Whether the AI switch for the Idea room's model tasks is on (slice 2). Off unless the environment says on.
pub fn ai_switch_on() -> bool {
    std::env::var("NAPKIN_IDEA_ROOM_AI").is_ok_and(|v| v.eq_ignore_ascii_case("on"))
}

/// The brief this room answers, for the page: its title, where it opens, whether it moved on since the room
/// took it, and the two version numbers the Changed brief state names (`from` the room carries, `to` it
/// stands at now). A brief's versions are its approvals, the first is v1, and an edit after the last one
/// is the next number (ops/versions.rs).
pub fn brief_status(store: &dyn DocStore, ctx: &Ctx, doc: &Document) -> Value {
    let status = crate::library::upstream_status(store, ctx, doc);
    let Some(direct) = status["upstream"]
        .as_array()
        .and_then(|a| a.iter().find(|u| u["how"] == "made_from"))
        .cloned()
    else {
        return Value::Null;
    };
    let mut out = json!({
        "title": direct["title"], "path": direct["path"],
        "changed": direct["status"] == "changed", "locked": direct["locked"],
    });
    let (Some(path), Some(carried)) = (direct["path"].as_str(), doc.clan().manifest().carried())
    else {
        return out;
    };
    let id = DocId::new(path);
    let Ok(parent) = store.read(&id).and_then(|b| Document::from_bytes(id, b)) else {
        return out;
    };
    let Ok(chain) = review::chain_of(&parent) else {
        return out;
    };
    let approvals = versions::approvals(&chain, parent.clan().document_id());
    let edited = approvals
        .first()
        .is_some_and(|i| gate::edited_since(&chain, *i));
    let to = approvals.len() + usize::from(edited || approvals.is_empty());
    let at = carried.last_decision.as_ref().and_then(|l| {
        chain
            .decisions
            .iter()
            .position(|d| d.id.as_deref() == Some(l.as_str()))
    });
    let from = at
        .map(|p| approvals.iter().filter(|i| **i >= p).count())
        .unwrap_or(0)
        .max(1);
    out["from"] = json!(from);
    out["to"] = json!(to.max(from));
    out
}

/// `GET /ideas/routes`: each route that is out, as its branch holds it now (name, bet, cards, notes, version).
pub fn routes_view(store: &dyn DocStore, doc: &Document) -> HostResult<Value> {
    require_room(doc)?;
    let data = data_of(doc.clan())?;
    let mut routes = serde_json::Map::new();
    for r in routes_out(&data) {
        let (_, bytes) = branch_of(store, doc, &r)?;
        let branch = ClanFile::from_bytes(bytes)?;
        let Some(ns) = branch.manifest().fork_namespace() else {
            continue;
        };
        let own: Value = branch
            .read_entry_string(&format!("{ns}data.yaml"))
            .ok()
            .and_then(|y| serde_yaml::from_str::<serde_yaml::Value>(&y).ok())
            .and_then(|y| serde_json::to_value(y).ok())
            .unwrap_or(Value::Null);
        routes.insert(r.clone(), own.get(&r).cloned().unwrap_or(Value::Null));
    }
    Ok(json!({ "routes": routes }))
}

/// `GET /ideas/room`: the room's data as the host holds it now, the gate, and the brief's state.
pub fn room_view(store: &dyn DocStore, ctx: &Ctx, doc: &Document) -> HostResult<Value> {
    Ok(json!({
        "data": data_of(doc.clan())?,
        "gate": gate_view(doc)?,
        "brief": brief_status(store, ctx, doc),
    }))
}

// ── writing the room ────────────────────────────────────────────────────────

fn doc_address(doc: &Document, path: &str) -> String {
    format!("{}#{}", doc.clan().document_id(), path)
}

fn entry_of(d: &Decision) -> DecisionEntry {
    DecisionEntry {
        agent_name: d.agent.clone(),
        action: d.action.clone(),
        rationale: d.rationale.clone(),
        pinned: false,
        fields_changed: Some(Vec::new()),
        typed: Some(d.clone()),
    }
}

/// One generation of the room: `data`, with `decisions` (the last ends up newest), and the pick
/// decisions in `supersede` marked as replaced by `by`.
fn commit(
    doc: &Document,
    data: Value,
    decisions: Vec<Decision>,
    supersede: &[String],
    delta: &str,
    reply: Value,
) -> HostResult<Outcome> {
    let clan = doc.clan();
    let now = review::now();
    let newest = decisions.last().and_then(|d| d.id.clone());
    let mut bytes = assemble(
        clan,
        data,
        Members::of(clan)?,
        decisions,
        delta,
        &now,
        false,
    )?;
    if let (false, Some(by)) = (supersede.is_empty(), newest) {
        bytes = supersede_picks(&bytes, supersede, &by)?;
    }
    let notice = json!({ "ok": true, "source": "ideas" });
    let change = doc
        .change(bytes)?
        .with_event(HostEvent::DataChanged(notice));
    Ok(Outcome::changed(reply, change))
}

fn supersede_picks(bytes: &[u8], ids: &[String], by: &str) -> HostResult<Vec<u8>> {
    const CHAIN: &str = "agent/decision-chain.yaml";
    let clan = ClanFile::from_bytes(bytes.to_vec())?;
    let mut chain = DecisionChain::from_yaml(&clan.read_entry(CHAIN)?)?;
    for d in chain.decisions.iter_mut() {
        if d.superseded_by.is_none()
            && d.id
                .as_deref()
                .is_some_and(|id| ids.iter().any(|x| x == id))
        {
            d.superseded_by = Some(by.to_string());
        }
    }
    let mut b = ClanBuilder::new(clan.manifest().clone());
    for (path, data) in clan.read_all_entries()? {
        if path != clan_sdk::MANIFEST_PATH && path != CHAIN {
            b.add_entry(path, data);
        }
    }
    b.add_entry(CHAIN, chain.to_yaml()?);
    Ok(b.build()?)
}

fn card_ids(data: &Value) -> Vec<String> {
    obj(data, "cards")
        .map(|c| c.keys().cloned().collect())
        .unwrap_or_default()
}

fn next_id(existing: &[String], prefix: &str) -> String {
    let max = existing
        .iter()
        .filter_map(|k| k.strip_prefix(prefix)?.parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    format!("{prefix}{}", max + 1)
}

/// The brief's own words the room answers, lifted from the copy it carries under `upstream`.
fn brief_link(data: &Value) -> Value {
    let mut insight = String::new();
    let mut proposition = String::new();
    if let Some(ups) = obj(data, "upstream") {
        for b in ups.values() {
            if insight.is_empty() {
                insight = text_of(b, "insight");
            }
            if proposition.is_empty() {
                proposition = text_of(b, "single_minded_proposition");
            }
        }
    }
    json!({ "insight": insight, "proposition": proposition })
}

/// `POST /ideas/card {text}`: a team card, written by the person in the context.
pub fn card(ctx: &Ctx, doc: &Document, raw: &str) -> HostResult<Outcome> {
    require_room(doc)?;
    let who = review::person(ctx, "write a team card")?;
    let text = text_of(&body(raw)?, "text");
    if text.is_empty() {
        return Err(HostError::bad_request("a card needs some words"));
    }
    if text.chars().count() > MAX_CARD {
        return Err(HostError::bad_request(format!(
            "a card is at most {MAX_CARD} characters"
        )));
    }
    let mut data = data_of(doc.clan())?;
    refuse_while_routes_out(&data)?;
    let id = next_id(&card_ids(&data), "c");
    let now = review::now();
    let link = brief_link(&data);
    data["cards"][&id] = json!({
        "text": text, "by": person_of(&who), "kind": "team", "at": now,
        "brief_link": link, "votes": [], "comments": [], "tests": {},
    });
    let mut d = review::decided(
        ctx,
        &who,
        "edit",
        CARD,
        vec![doc_address(doc, &format!("cards[{id}]"))],
        Vec::new(),
        clipped(&text, 160),
        &now,
    );
    d.fields_changed = vec!["cards".into()];
    commit(
        doc,
        data,
        vec![d],
        &[],
        "a team card",
        json!({ "ok": true, "card": id }),
    )
}

fn card_of<'d>(data: &'d Value, id: &str) -> HostResult<&'d Value> {
    obj(data, "cards")
        .and_then(|c| c.get(id))
        .ok_or_else(|| HostError::not_found(format!("card {id} is not in this room")))
}

/// `POST /ideas/vote {card}`: the signed-in person's vote on a card, on or off. Votes are counted per card.
pub fn vote(ctx: &Ctx, doc: &Document, raw: &str) -> HostResult<Outcome> {
    require_room(doc)?;
    let who = review::person(ctx, "vote on a card")?;
    let id = text_of(&body(raw)?, "card");
    let mut data = data_of(doc.clan())?;
    refuse_while_routes_out(&data)?;
    let kind = text_of(card_of(&data, &id)?, "kind");
    if kind == "banned" {
        return Err(HostError::conflict(
            "a Banned card is the default idea; it takes no vote",
        ));
    }
    let me = person_of(&who).to_string();
    let mut votes: Vec<Value> = data["cards"][&id]["votes"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let on = !votes.iter().any(|v| v.as_str() == Some(me.as_str()));
    if on {
        votes.push(Value::String(me));
    } else {
        votes.retain(|v| v.as_str() != Some(me.as_str()));
    }
    let n = votes.len();
    data["cards"][&id]["votes"] = Value::Array(votes);
    let now = review::now();
    let mut d = review::decided(
        ctx,
        &who,
        "edit",
        VOTE,
        vec![doc_address(doc, &format!("cards[{id}]"))],
        Vec::new(),
        if on {
            "Voted for this card."
        } else {
            "Took the vote back."
        }
        .to_string(),
        &now,
    );
    d.fields_changed = vec!["cards".into()];
    commit(
        doc,
        data,
        vec![d],
        &[],
        "a vote",
        json!({ "ok": true, "card": id, "votes": n, "voted": on }),
    )
}

/// `POST /ideas/comment {card, text}`.
pub fn comment(ctx: &Ctx, doc: &Document, raw: &str) -> HostResult<Outcome> {
    require_room(doc)?;
    let who = review::person(ctx, "comment on a card")?;
    let b = body(raw)?;
    let id = text_of(&b, "card");
    let text = text_of(&b, "text");
    if text.is_empty() || text.chars().count() > MAX_NOTE {
        return Err(HostError::bad_request(format!(
            "a comment is between 1 and {MAX_NOTE} characters"
        )));
    }
    let mut data = data_of(doc.clan())?;
    refuse_while_routes_out(&data)?;
    card_of(&data, &id)?;
    let now = review::now();
    let mut list: Vec<Value> = data["cards"][&id]["comments"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    list.push(json!({ "by": person_of(&who), "text": text, "at": now }));
    data["cards"][&id]["comments"] = Value::Array(list);
    let mut d = review::decided(
        ctx,
        &who,
        "edit",
        COMMENT,
        vec![doc_address(doc, &format!("cards[{id}]"))],
        Vec::new(),
        clipped(&text, 160),
        &now,
    );
    d.fields_changed = vec!["cards".into()];
    commit(
        doc,
        data,
        vec![d],
        &[],
        "a comment",
        json!({ "ok": true, "card": id }),
    )
}

/// `POST /ideas/open-early {rationale}`: the creative director opens the AI before the team's cards
/// do. One attributed decision, with the reason written down.
pub fn open_early(ctx: &Ctx, doc: &Document, raw: &str) -> HostResult<Outcome> {
    require_room(doc)?;
    let who = review::person(ctx, "open the Idea room early")?;
    let reason = text_of(&body(raw)?, "rationale");
    let mut data = data_of(doc.clan())?;
    let Some(cd) = creative_director(&data) else {
        return Err(HostError::new(
            403,
            "the brief names no creative director, so nobody can open this room early",
        ));
    };
    if cd != person_of(&who) {
        return Err(HostError::new(
            403,
            format!("only {cd}, the creative director named on the brief, can open the AI early"),
        ));
    }
    if reason.is_empty() {
        return Err(HostError::bad_request(
            "opening early needs a reason, written down",
        ));
    }
    if gate_view(doc)?.open {
        return Err(HostError::conflict("the AI is already open"));
    }
    let now = review::now();
    let d = review::decided(
        ctx,
        &who,
        "edit",
        OPEN_EARLY,
        vec![doc_address(doc, "ai_open")],
        Vec::new(),
        reason.clone(),
        &now,
    );
    data["ai_open"] = json!({
        "state": "early", "by": person_of(&who), "decision": d.id, "at": now, "reason": reason,
    });
    let mut d = d;
    d.fields_changed = vec!["ai_open".into()];
    let id = d.id.clone();
    commit(
        doc,
        data,
        vec![d],
        &[],
        "opened early",
        json!({ "ok": true, "decision": id }),
    )
}

// ── routes are forks ────────────────────────────────────────────────────────

fn route_number(id: &str) -> Option<u64> {
    id.strip_prefix("route_")?.parse().ok()
}

fn existing_route_ids(data: &Value) -> Vec<String> {
    let mut v: Vec<String> = obj(data, "routes")
        .map(|r| r.keys().cloned().collect())
        .unwrap_or_default();
    v.extend(routes_out(data));
    v
}

/// The cards a route names, each one in the room and not a Banned card.
fn route_cards(data: &Value, wanted: &Value) -> HostResult<Vec<String>> {
    let list: Vec<String> = wanted
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    for id in &list {
        let c = card_of(data, id)?;
        if text_of(c, "kind") == "banned" {
            return Err(HostError::conflict(format!(
                "card {id} is a Banned card; it cannot be part of a route"
            )));
        }
    }
    Ok(list)
}

/// `POST /ideas/routes/start {routes: [{name, bet, cards}]}`: one branch document per route. The room
/// itself takes no write until they are merged.
pub fn routes_start(
    ctx: &Ctx,
    doc: &Document,
    store: &dyn DocStore,
    raw: &str,
) -> HostResult<Outcome> {
    require_room(doc)?;
    let who = review::person(ctx, "start routes")?;
    let b = body(raw)?;
    let asked = b
        .get("routes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if asked.len() < 2 || asked.len() > MAX_ROUTES {
        return Err(HostError::bad_request(format!(
            "start between 2 and {MAX_ROUTES} routes at once"
        )));
    }
    let mut data = data_of(doc.clan())?;
    refuse_while_routes_out(&data)?;
    if !gate_view(doc)?.open {
        return Err(HostError::conflict(
            "ideas_closed: routes are made from the team's cards; the room is not open yet",
        ));
    }
    let existing = existing_route_ids(&data);
    let first = existing
        .iter()
        .filter_map(|k| route_number(k))
        .max()
        .unwrap_or(0)
        + 1;
    let ids: Vec<String> = (0..asked.len() as u64)
        .map(|i| format!("route_{}", first + i))
        .collect();
    let mut seeds = Vec::new();
    for r in &asked {
        let name = text_of(r, "name");
        let bet = text_of(r, "bet");
        if name.is_empty() || name.chars().count() > MAX_NAME {
            return Err(HostError::bad_request(format!(
                "a route needs a name of at most {MAX_NAME} characters"
            )));
        }
        if bet.chars().count() > MAX_BET {
            return Err(HostError::bad_request(format!(
                "a route's bet is at most {MAX_BET} characters"
            )));
        }
        let cards = route_cards(&data, r.get("cards").unwrap_or(&Value::Null))?;
        seeds.push((name, bet, cards));
    }

    // The room first: it records that routes are out and who started them. The branches are forked
    // from this version, so the merge starts from a room that already says so.
    let now = review::now();
    data["routes_out"] = json!(ids);
    let mut started = review::decided(
        ctx,
        &who,
        "edit",
        ROUTES_START,
        ids.iter()
            .map(|i| doc_address(doc, &format!("routes[{i}]")))
            .collect(),
        Vec::new(),
        format!(
            "Started {} routes: {}.",
            ids.len(),
            seeds
                .iter()
                .map(|s| s.0.clone())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        &now,
    );
    started.fields_changed = vec!["routes_out".into()];
    let clan = doc.clan();
    let parent_bytes = assemble(
        clan,
        data,
        Members::of(clan)?,
        vec![started],
        "routes started",
        &now,
        false,
    )?;
    let parent = ClanFile::from_bytes(parent_bytes.clone())?;

    let mut changes = Vec::new();
    let mut made = Vec::new();
    for ((agent, bytes), (name, bet, cards)) in sdk_fork(&parent, &ids)?.into_iter().zip(&seeds) {
        let branch_id = store.fork_branch(doc.id(), &agent);
        if store.exists(&branch_id) {
            return Err(HostError::conflict(format!(
                "refusing to overwrite {branch_id}"
            )));
        }
        let branch = ClanFile::from_bytes(bytes)?;
        let seed = json!({ agent.clone(): {
            "name": name, "bet": bet, "cards": cards, "notes": [], "version": 1,
            "started_by": person_of(&who), "branch": branch_id.as_str(),
        } });
        let with_data = ClanFile::from_bytes(patch_data_namespaced(&branch, &seed)?)?;
        let mut d = review::decided(
            ctx,
            &who,
            "edit",
            ROUTE_EDIT,
            vec![doc_address(doc, &format!("routes[{agent}]"))],
            Vec::new(),
            format!("Started the route {name}."),
            &now,
        );
        d.fields_changed = vec![agent.clone()];
        let bytes = patch_decision(&with_data, entry_of(&d), None)?;
        made.push(json!({ "route": agent, "path": branch_id.as_str() }));
        changes.push(Change::create(branch_id, bytes));
    }
    let mut changes_all = vec![doc.change(parent_bytes)?.with_event(HostEvent::DataChanged(
        json!({ "ok": true, "source": "ideas" }),
    ))];
    changes_all.extend(changes);
    Ok(Outcome {
        reply: json!({ "ok": true, "routes": made }),
        changes: changes_all,
    })
}

fn branch_of(store: &dyn DocStore, doc: &Document, route: &str) -> HostResult<(DocId, Vec<u8>)> {
    let id = store.fork_branch(doc.id(), route);
    let bytes = store.read(&id)?;
    Ok((id, bytes))
}

/// `POST /ideas/routes/edit {route, name?, bet?, cards?, note?}`: a person works on a route. Written into
/// the route's own branch namespace, as the person, with a decision in the branch. Anyone signed in may.
pub fn route_edit(
    ctx: &Ctx,
    doc: &Document,
    store: &dyn DocStore,
    raw: &str,
) -> HostResult<Outcome> {
    require_room(doc)?;
    let who = review::person(ctx, "work on a route")?;
    let b = body(raw)?;
    let route = text_of(&b, "route");
    let data = data_of(doc.clan())?;
    if !routes_out(&data).iter().any(|r| *r == route) {
        return Err(HostError::conflict(format!(
            "{route} is not out as a branch; routes can be worked on only between Start routes and Merge routes"
        )));
    }
    let (branch_id, old) = branch_of(store, doc, &route)?;
    let branch = ClanFile::from_bytes(old.clone())?;
    let ns = branch
        .manifest()
        .fork_namespace()
        .ok_or_else(|| HostError::conflict(format!("{branch_id} is not a fork branch")))?
        .to_string();
    let current: Value = branch
        .read_entry_string(&format!("{ns}data.yaml"))
        .ok()
        .and_then(|y| serde_yaml::from_str::<serde_yaml::Value>(&y).ok())
        .and_then(|y| serde_json::to_value(y).ok())
        .unwrap_or(Value::Null);
    let mine = current.get(&route).cloned().unwrap_or(Value::Null);

    let mut patch = serde_json::Map::new();
    let mut said = Vec::new();
    if b.get("name").is_some() {
        let name = text_of(&b, "name");
        if name.is_empty() || name.chars().count() > MAX_NAME {
            return Err(HostError::bad_request(format!(
                "a route's name is between 1 and {MAX_NAME} characters"
            )));
        }
        patch.insert("name".into(), json!(name));
        said.push("the name");
    }
    if b.get("bet").is_some() {
        let bet = text_of(&b, "bet");
        if bet.chars().count() > MAX_BET {
            return Err(HostError::bad_request(format!(
                "a route's bet is at most {MAX_BET} characters"
            )));
        }
        patch.insert("bet".into(), json!(bet));
        said.push("the bet");
    }
    if let Some(c) = b.get("cards") {
        patch.insert("cards".into(), json!(route_cards(&data, c)?));
        said.push("the cards");
    }
    let note = text_of(&b, "note");
    if !note.is_empty() {
        if note.chars().count() > MAX_NOTE {
            return Err(HostError::bad_request(format!(
                "a note is at most {MAX_NOTE} characters"
            )));
        }
        let now = review::now();
        let mut notes: Vec<Value> = mine
            .get("notes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        notes.push(json!({ "by": person_of(&who), "text": note, "at": now }));
        patch.insert("notes".into(), Value::Array(notes));
        said.push("a note");
    }
    if patch.is_empty() {
        return Err(HostError::bad_request(
            "nothing to change: give a name, a bet, cards or a note",
        ));
    }
    let version = mine.get("version").and_then(Value::as_u64).unwrap_or(1) + 1;
    patch.insert("version".into(), json!(version));
    let with_data = ClanFile::from_bytes(patch_data_namespaced(
        &branch,
        &json!({ route.clone(): Value::Object(patch) }),
    )?)?;
    let now = review::now();
    let mut d = review::decided(
        ctx,
        &who,
        "edit",
        ROUTE_EDIT,
        vec![doc_address(doc, &format!("routes[{route}]"))],
        Vec::new(),
        format!("Changed {}.", said.join(", ")),
        &now,
    );
    d.fields_changed = vec![route.clone()];
    let bytes = patch_decision(&with_data, entry_of(&d), None)?;
    let change = Change::replace(branch_id, Version::of_archive(&old), bytes);
    Ok(Outcome {
        reply: json!({ "ok": true, "route": route, "version": version }),
        changes: vec![change],
    })
}

/// A clash the merge listed: both sides, and nothing silently picked.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Clash {
    pub key: String,
    pub left: Value,
    pub right: Value,
    pub others: Vec<Value>,
}

fn clashes_of(report: &MergeReport) -> Vec<Clash> {
    report
        .conflicts
        .iter()
        .map(|c| {
            let side = |agent: &str, value: &Value| json!({ "agent": agent, "value": value });
            Clash {
                key: c.key.clone(),
                left: side(&c.winner.agent, &c.winner.value),
                right: c
                    .losers
                    .first()
                    .map(|l| side(&l.agent, &l.value))
                    .unwrap_or(Value::Null),
                others: c
                    .losers
                    .iter()
                    .skip(1)
                    .map(|l| side(&l.agent, &l.value))
                    .collect(),
            }
        })
        .collect()
}

/// `POST /merge {branches?}`: fold every route that is out back into the room, with the SDK's
/// deterministic merge and no model. The reply holds the routes and the clashes.
pub fn merge(ctx: &Ctx, doc: &Document, store: &dyn DocStore, raw: &str) -> HostResult<Outcome> {
    require_room(doc)?;
    let who = review::person(ctx, "merge routes")?;
    let asked = if raw.trim().is_empty() {
        Value::Null
    } else {
        body(raw)?
    };
    let data = data_of(doc.clan())?;
    let out = routes_out(&data);
    if out.len() < 2 {
        return Err(HostError::conflict("no routes are out to merge"));
    }
    if let Some(list) = asked.get("branches").and_then(Value::as_array) {
        let named: Vec<String> = list
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.replace('-', "_")))
            .collect();
        if named.len() != out.len() || !out.iter().all(|o| named.contains(o)) {
            return Err(HostError::conflict(format!(
                "merge every route that is out together: {}",
                out.join(", ")
            )));
        }
    }
    let mut branches = Vec::new();
    for r in &out {
        let (_, bytes) = branch_of(store, doc, r)?;
        branches.push(ClanFile::from_bytes(bytes)?);
    }
    let merged = sdk_merge(&branches, MergeOptions::default())?;
    let clan = ClanFile::from_bytes(merged.bytes)?;

    // The branches each wrote one key, their route's id. Those become `routes`; the marker goes.
    let mut data = data_of(&clan)?;
    let mut routes = obj(&data, "routes").cloned().unwrap_or_default();
    for r in &out {
        if let Some(mut v) = data.as_object_mut().and_then(|o| o.remove(r)) {
            if let Some(o) = v.as_object_mut() {
                o.entry("version").or_insert(json!(1));
                o.insert(
                    "branch".into(),
                    json!(store.fork_branch(doc.id(), r).as_str()),
                );
            }
            routes.insert(r.clone(), v);
        }
    }
    if let Some(o) = data.as_object_mut() {
        o.remove("routes_out");
        o.insert("routes".into(), Value::Object(routes));
    }
    let now = review::now();
    let mut d = review::decided(
        ctx,
        &who,
        "edit",
        MERGE_ROUTES,
        out.iter()
            .map(|i| doc_address(doc, &format!("routes[{i}]")))
            .collect(),
        Vec::new(),
        format!(
            "Merged {} routes. {} clash(es) listed.",
            out.len(),
            merged.report.conflicts.len()
        ),
        &now,
    );
    d.fields_changed = vec!["routes".into(), "routes_out".into()];
    let bytes = assemble(
        &clan,
        data.clone(),
        Members::of(&clan)?,
        vec![d],
        "routes merged",
        &now,
        false,
    )?;
    let clashes = clashes_of(&merged.report);
    let change = doc.change(bytes)?.with_event(HostEvent::DataChanged(
        json!({ "ok": true, "source": "ideas" }),
    ));
    Ok(Outcome::changed(
        json!({
            "ok": true,
            "routes": data["routes"],
            "clashes": clashes,
            "branches": out,
        }),
        change,
    ))
}

// ── the pick ────────────────────────────────────────────────────────────────

/// Merge clashes nobody has settled, from the report the merge left in the room.
fn unsettled(doc: &Document) -> Vec<String> {
    doc.clan()
        .read_entry(MERGE_REPORT_PATH)
        .ok()
        .and_then(|b| MergeReport::from_yaml(&b).ok())
        .map(|r| r.conflicts.iter().map(|c| c.key.clone()).collect())
        .unwrap_or_default()
}

/// The live pick decision ids (a pick nothing has replaced).
fn live_picks(chain: &DecisionChain) -> Vec<String> {
    chain
        .decisions
        .iter()
        .filter(|d| d.action == PICK && d.superseded_by.is_none())
        .filter_map(|d| d.id.clone())
        .collect()
}

fn require_creative_director(ctx: &Ctx, data: &Value, what: &str) -> HostResult<String> {
    let who = review::person(ctx, what)?;
    match creative_director(data) {
        Some(cd) if cd == person_of(&who) => Ok(who),
        Some(cd) => Err(HostError::new(
            403,
            format!("only {cd}, the creative director named on the brief, can {what}"),
        )),
        None => Err(HostError::new(
            403,
            format!("the brief names no creative director, so nobody can {what}"),
        )),
    }
}

/// `POST /ideas/pick {route, rationale}`: the creative director's pick, one verdict decision on the
/// route's exact version. A second pick replaces the first and says why; the first stays in the history.
pub fn pick(ctx: &Ctx, doc: &Document, raw: &str) -> HostResult<Outcome> {
    require_room(doc)?;
    let mut data = data_of(doc.clan())?;
    let who = require_creative_director(ctx, &data, "pick the route")?;
    let b = body(raw)?;
    let route = text_of(&b, "route");
    let reason = text_of(&b, "rationale");
    refuse_while_routes_out(&data)?;
    let held = obj(&data, "routes")
        .and_then(|r| r.get(&route))
        .cloned()
        .ok_or_else(|| HostError::not_found(format!("{route} is not a route in this room")))?;
    let clashes = unsettled(doc);
    if !clashes.is_empty() {
        return Err(HostError::conflict(format!(
            "the merge listed clashes nobody has settled ({}); settle them before picking",
            clashes.join(", ")
        )));
    }
    let chain = review::chain_of(doc)?;
    let replacing = live_picks(&chain);
    if !replacing.is_empty() && reason.is_empty() {
        return Err(HostError::bad_request(
            "a route is already chosen; choosing again needs a reason",
        ));
    }
    let version = held
        .get("version")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .to_string();
    let name = text_of(&held, "name");
    let now = review::now();
    let mut d = review::decided(
        ctx,
        &who,
        "verdict",
        PICK,
        vec![doc_address(doc, &format!("routes[{route}]"))],
        Vec::new(),
        if reason.is_empty() {
            format!("Chose the route {name}.")
        } else {
            reason
        },
        &now,
    );
    d.polarity = Some("good".into());
    d.reason_code = Some(ROUTE_CHOSEN.into());
    d.reviewer_role = Some(CREATIVE_DIRECTOR_ROLE.into());
    d.version = Some(version.clone());
    d.fields_changed = vec!["chosen".into()];
    data["chosen"] = json!({
        "route": route, "version": version, "decision": d.id, "by": person_of(&who), "at": now,
    });
    let id = d.id.clone();
    commit(
        doc,
        data,
        vec![d],
        &replacing,
        "route chosen",
        json!({ "ok": true, "decision": id, "route": route, "version": version }),
    )
}

/// `POST /ideas/reopen {rationale}`: the creative director reopens the choice. The pick that held stays
/// in the history, marked as replaced; no route is chosen until the next pick.
pub fn reopen(ctx: &Ctx, doc: &Document, raw: &str) -> HostResult<Outcome> {
    require_room(doc)?;
    let mut data = data_of(doc.clan())?;
    let who = require_creative_director(ctx, &data, "reopen the choice")?;
    let reason = text_of(&body(raw)?, "rationale");
    if reason.is_empty() {
        return Err(HostError::bad_request(
            "reopening the choice needs a reason",
        ));
    }
    let chain = review::chain_of(doc)?;
    let replacing = live_picks(&chain);
    if replacing.is_empty() {
        return Err(HostError::conflict(
            "no route is chosen, so there is nothing to reopen",
        ));
    }
    let now = review::now();
    let mut d = review::decided(
        ctx,
        &who,
        "edit",
        REOPEN,
        vec![doc_address(doc, "chosen")],
        replacing.clone(),
        reason,
        &now,
    );
    d.fields_changed = vec!["chosen".into()];
    if let Some(o) = data.as_object_mut() {
        o.remove("chosen");
    }
    let id = d.id.clone();
    commit(
        doc,
        data,
        vec![d],
        &replacing,
        "choice reopened",
        json!({ "ok": true, "decision": id }),
    )
}

// ── the patch-data guard ────────────────────────────────────────────────────

/// A `patch-data` on an Idea room may not name a key this module owns: cards, routes, the pick and the
/// opening are written by the operations above, as the person asking.
pub fn refuse_host_keys(doc: &Document, keys: &[String]) -> HostResult<()> {
    if !applies(doc) {
        return Ok(());
    }
    if let Some(k) = keys.iter().find(|k| HOST_KEYS.contains(&k.as_str())) {
        return Err(HostError::new(
            403,
            format!("`{k}` is written by the Idea room's own operations, never by a patch"),
        ));
    }
    Ok(())
}

/// The room takes no `patch-data` while routes are out: the merge starts from the branches.
pub fn refuse_writes_while_routes_out(doc: &Document) -> HostResult<()> {
    refuse_while_routes_out(&data_of(doc.clan())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_ids_count_on() {
        assert_eq!(route_number("route_3"), Some(3));
        assert_eq!(route_number("route_x"), None);
        assert_eq!(next_id(&["c1".into(), "c7".into()], "c"), "c8");
        assert_eq!(next_id(&[], "c"), "c1");
    }

    #[test]
    fn only_a_humans_card_counts() {
        let data = json!({ "cards": { "c1": { "kind": "team" }, "c2": { "kind": "team" }, "c3": { "kind": "banned" } } });
        let mk = |actor: &str, id: &str| {
            let mut d = Decision::new("x", CARD, "r", "t");
            d.actor = Some(actor.into());
            d.targets = vec![format!("doc#cards[{id}]")];
            d
        };
        let chain = DecisionChain {
            decisions: vec![
                mk("human:a@wk", "c1"),
                mk("process:job_1", "c2"),
                mk("human:b@wk", "c3"),
            ],
        };
        assert_eq!(team_card_ids(&data, &chain), vec!["c1".to_string()]);
    }
}
