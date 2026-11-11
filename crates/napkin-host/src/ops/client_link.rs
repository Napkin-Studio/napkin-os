// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The client's own link (features/client-confirm-link.clan; Contract 4 §7.5,
//! item 5 as amended): one locked version of a brief, one answer, no account.
//!
//! The web shell signs a token, and this module holds what the token may not:
//! the facts. Three records on the document's chain, all `kind:
//! client_review`, told apart by `action` and tied together by the link's id:
//!
//! - `issue_link`, by the agency person who made the link: which version (its
//!   lock, its version and the hash of its data), who it is for, when it ends.
//! - `withdraw_link`, by an agency person: the link is dead.
//! - `client_answer`, by `client:<email>`, the first time the link is used and
//!   the only time. It is the same document answer staff record
//!   (`CLIENT_ANSWER`), so the Brief gate and the decision view read it as
//!   they read any other; its `channel` is `link`.
//!
//! The client actor is accepted here and nowhere else: [`CLIENT_ROUTES`] are
//! the only host routes a client context reaches (`routes::dispatch` refuses
//! the rest `403`), and every other operation wants a person.
//!
//! What a link is worth is worked out from the chain each time, never stored:
//! [`state`] says whether it is open, and why not when it is not.

use clan_sdk::decision::new_decision_id;
use clan_sdk::{Decision, DecisionChain};
use serde_json::{json, Value};

use crate::ctx::Ctx;
use crate::document::Document;
use crate::error::{HostError, HostResult};
use crate::event::HostEvent;

use super::assemble::{assemble, data_of, Members};
use super::client_review::{self as cr, extra_str, CLIENT_ANSWER, KIND};
use super::edit::attributed;
use super::review::{body, chain_of, lock_index, now, person, required, text, to_json, to_yaml};
use super::Outcome;

pub const ISSUE: &str = "issue_link";
pub const WITHDRAW: &str = "withdraw_link";
/// The channel a link's answer records.
pub const CHANNEL: &str = "link";
/// What a link may do. The token carries it too; Phase 2's review link adds more.
pub const SCOPE_CONFIRM: &str = "confirm";
/// The routes a client context may reach, and no others.
pub const CLIENT_ROUTES: &[&str] = &["/client-link/state", "/client-link/answer"];

/// How long a link may live, at most (the design's default, and the strictest
/// a caller may ask for).
pub const MAX_DAYS: i64 = 30;

const MAX_NAME: usize = 120;
const MAX_SAID: usize = 5_000;

fn bad(msg: impl Into<String>) -> HostError {
    HostError::bad_request(msg)
}

/// A link id as the web shell mints it: 32 lower-case hex digits.
pub fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

fn parse_time(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|t| t.with_timezone(&chrono::Utc))
}

// ── what a link was issued for ──────────────────────────────────────────────

/// An issued link, as its `issue_link` decision recorded it.
#[derive(Debug, Clone, PartialEq)]
pub struct Issued {
    pub id: String,
    pub decision: String,
    /// The lock (`approve` decision) the link is for.
    pub lock: String,
    /// The lock's version.
    pub version: String,
    /// The hash of `shared/data.yaml` as the client is shown it.
    pub doc_hash: String,
    pub name: String,
    pub email: String,
    pub expires: String,
    pub scope: String,
}

/// Why a link is not open.
#[derive(Debug, Clone, PartialEq)]
pub enum LinkState {
    /// No such link on this document.
    Unknown,
    Open(Issued),
    Withdrawn,
    /// Used: a link answers once.
    Answered(Issued, String),
    /// The document moved on (edited, unlocked, locked again, a part reopened).
    Superseded,
    Expired,
}

impl LinkState {
    pub fn status(&self) -> u16 {
        match self {
            LinkState::Open(_) => 200,
            LinkState::Unknown => 404,
            _ => 410,
        }
    }

    pub fn word(&self) -> &'static str {
        match self {
            LinkState::Open(_) => "open",
            LinkState::Unknown => "unknown",
            LinkState::Withdrawn => "withdrawn",
            LinkState::Answered(..) => "answered",
            LinkState::Superseded => "superseded",
            LinkState::Expired => "expired",
        }
    }
}

fn link_of(d: &Decision) -> Option<Value> {
    d.extra.get("link").map(to_json)
}

fn issued_of(d: &Decision) -> Option<Issued> {
    let l = link_of(d)?;
    let s = |k: &str| l.get(k).and_then(Value::as_str).map(String::from);
    Some(Issued {
        id: s("id")?,
        decision: d.id.clone()?,
        lock: s("lock")?,
        version: s("version")?,
        doc_hash: s("doc_hash")?,
        name: l.get("client")?.get("name")?.as_str()?.to_string(),
        email: l.get("client")?.get("email")?.as_str()?.to_string(),
        expires: s("expires")?,
        scope: s("scope")?,
    })
}

fn action_is(d: &Decision, action: &str) -> bool {
    d.kind.as_deref() == Some(KIND) && d.action == action
}

fn about_link(d: &Decision, id: &str) -> bool {
    extra_str(d, "link") == Some(id)
}

fn find_issue<'c>(chain: &'c DecisionChain, here: &str, id: &str) -> Option<&'c Decision> {
    chain.decisions.iter().find(|d| {
        action_is(d, ISSUE)
            && d.targets.iter().any(|t| t == here)
            && link_of(d)
                .as_ref()
                .and_then(|l| l.get("id"))
                .and_then(Value::as_str)
                == Some(id)
    })
}

/// What the link `id` is worth now, from the chain and the document's data.
pub fn state(doc: &Document, id: &str) -> HostResult<LinkState> {
    let chain = chain_of(doc)?;
    let here = doc.clan().document_id().to_string();
    let hash = data_hash(doc)?;
    Ok(state_in(&chain, &here, &hash, id, &now()))
}

fn state_in(chain: &DecisionChain, here: &str, hash: &str, id: &str, at: &str) -> LinkState {
    let Some(issue) = find_issue(chain, here, id) else {
        return LinkState::Unknown;
    };
    let Some(issued) = issued_of(issue) else {
        return LinkState::Unknown;
    };
    if chain
        .decisions
        .iter()
        .any(|d| action_is(d, WITHDRAW) && about_link(d, id))
    {
        return LinkState::Withdrawn;
    }
    if let Some(a) = chain
        .decisions
        .iter()
        .find(|d| action_is(d, CLIENT_ANSWER) && about_link(d, id))
    {
        let answer = extra_str(a, "answer").unwrap_or_default().to_string();
        return LinkState::Answered(issued, answer);
    }
    let lock = lock_index(chain, here).map(|i| &chain.decisions[i]);
    let same_version = lock.is_some_and(|l| l.id.as_deref() == Some(issued.lock.as_str()))
        && hash == issued.doc_hash
        && cr::reopened(chain, here).is_empty();
    if !same_version {
        return LinkState::Superseded;
    }
    let alive = parse_time(&issued.expires)
        .zip(parse_time(at))
        .is_some_and(|(end, now)| now < end);
    if !alive {
        return LinkState::Expired;
    }
    LinkState::Open(issued)
}

/// The hash of the brief's content as the client is shown it: canonical JSON of its data, so the
/// same words always hash the same, however the YAML was last written.
pub fn content_hash(clan: &clan_sdk::ClanFile) -> HostResult<String> {
    Ok(cr::content_hash(&data_of(clan)?))
}

fn data_hash(doc: &Document) -> HostResult<String> {
    content_hash(doc.clan())
}

// ── issuing and withdrawing: an agency person ───────────────────────────────

/// `POST /client-link/issue`: `{id, name, email, expires}`.
#[derive(Debug, Clone)]
pub struct Issue {
    pub id: String,
    pub name: String,
    pub email: String,
    pub expires: String,
}

impl Issue {
    pub fn parse(raw: &str) -> HostResult<Self> {
        let v = body(raw)?;
        for key in ["actor", "recorded_by", "doc_hash", "version", "lock"] {
            if v.get(key).is_some() {
                return Err(bad(format!("`{key}` is the host's, not the body's")));
            }
        }
        let id = required(&v, "id")?;
        if !valid_id(&id) {
            return Err(bad("`id` is 32 lower-case hex digits"));
        }
        let name = required(&v, "name")?;
        if name.chars().count() > MAX_NAME {
            return Err(bad(format!("`name` is at most {MAX_NAME} characters")));
        }
        let email = required(&v, "email")?.to_lowercase();
        if !plain_email(&email) {
            return Err(bad(format!("`email` {email:?} is not an email address")));
        }
        let expires = required(&v, "expires")?;
        Ok(Self {
            id,
            name,
            email,
            expires,
        })
    }
}

fn plain_email(e: &str) -> bool {
    matches!(e.split_once('@'), Some((l, r)) if !l.is_empty() && r.contains('.') && !r.contains('@') && !r.starts_with('.') && !r.ends_with('.'))
        && !e.chars().any(|c| c.is_whitespace() || c.is_control())
}

fn write(doc: &Document, d: Decision, delta: &str, now: &str, reply: Value) -> HostResult<Outcome> {
    let clan = doc.clan();
    let first = d.id.clone().unwrap_or_default();
    let bytes = assemble(
        clan,
        data_of(clan)?,
        Members::of(clan)?,
        vec![d],
        delta,
        now,
        false,
    )?;
    let notice = json!({ "ok": true, "source": "client-link", "kind": KIND, "decision": first });
    let change = doc
        .change(bytes)?
        .with_event(HostEvent::DataChanged(notice));
    Ok(Outcome::changed(reply, change))
}

/// Make a link to the locked version as it stands. Refused `409` when the
/// document is not locked, has been edited since the lock, or has a part
/// reopened: a link names exactly the version a person signed.
pub fn issue(ctx: &Ctx, doc: &Document, input: Issue) -> HostResult<Outcome> {
    let who = person(ctx, "make a client's link")?;
    let chain = chain_of(doc)?;
    let here = doc.clan().document_id().to_string();
    let at = lock_index(&chain, &here).ok_or_else(|| {
        HostError::conflict(
            "a client's link is to a locked version: lock the brief first, so the client confirms the version that was signed",
        )
    })?;
    let lock = &chain.decisions[at];
    if super::gate::edited_since(&chain, at) || !cr::reopened(&chain, &here).is_empty() {
        return Err(HostError::conflict(
            "the document changed after it was locked: sign the new version, then make the link",
        ));
    }
    if find_issue(&chain, &here, &input.id).is_some() {
        return Err(HostError::conflict("that link id is already used"));
    }
    let now_s = now();
    let end = parse_time(&input.expires)
        .ok_or_else(|| bad("`expires` is a UTC time such as 2026-12-11T09:00:00Z"))?;
    let start = parse_time(&now_s).unwrap_or_else(chrono::Utc::now);
    if end <= start {
        return Err(bad("`expires` is in the past"));
    }
    if end > start + chrono::Duration::days(MAX_DAYS) + chrono::Duration::minutes(5) {
        return Err(bad(format!("a link lasts at most {MAX_DAYS} days")));
    }
    let hash = data_hash(doc)?;
    let version = lock.version.clone().unwrap_or_default();
    let mut d = attributed(ctx, "", KIND);
    d.id = Some(new_decision_id());
    d.agent = who.clone();
    d.action = ISSUE.to_string();
    d.targets = vec![here.clone()];
    d.cites = vec![lock.id.clone().unwrap_or_default()];
    d.timestamp = now_s.clone();
    d.version = Some(version.clone());
    d.rationale = format!(
        "{} made a one-use confirmation link for {} to this locked version.",
        person_name(&who),
        input.name
    );
    d.extra.insert(
        "link".into(),
        to_yaml(&json!({
            "id": input.id,
            "scope": SCOPE_CONFIRM,
            "targets": [here],
            "lock": lock.id,
            "version": version,
            "doc_hash": hash,
            "client": { "name": input.name, "email": input.email },
            "expires": input.expires,
        }))?,
    );
    let reply = json!({
        "ok": true, "kind": KIND, "decision": d.id, "link": input.id,
        "lock": lock.id, "version": version, "doc_hash": hash,
        "scope": SCOPE_CONFIRM, "targets": [here],
    });
    write(doc, d, "a client link made", &now_s, reply)
}

/// `POST /client-link/withdraw`: `{id}`.
pub fn parse_withdraw(raw: &str) -> HostResult<String> {
    let v = body(raw)?;
    let id = required(&v, "id")?;
    if !valid_id(&id) {
        return Err(bad("`id` is 32 lower-case hex digits"));
    }
    Ok(id)
}

/// Kill a link. Answered links are already dead; withdrawing twice is a `409`.
pub fn withdraw(ctx: &Ctx, doc: &Document, id: &str) -> HostResult<Outcome> {
    let who = person(ctx, "withdraw a client's link")?;
    let chain = chain_of(doc)?;
    let here = doc.clan().document_id().to_string();
    let issue = find_issue(&chain, &here, id)
        .ok_or_else(|| HostError::not_found("no such link on this document"))?;
    if chain
        .decisions
        .iter()
        .any(|d| action_is(d, WITHDRAW) && about_link(d, id))
    {
        return Err(HostError::conflict("that link is withdrawn already"));
    }
    let now_s = now();
    let mut d = attributed(ctx, "", KIND);
    d.id = Some(new_decision_id());
    d.agent = who.clone();
    d.action = WITHDRAW.to_string();
    d.targets = vec![here];
    d.cites = vec![issue.id.clone().unwrap_or_default()];
    d.timestamp = now_s.clone();
    d.rationale = format!("{} withdrew the client's link.", person_name(&who));
    d.extra.insert("link".into(), to_yaml(&json!(id))?);
    let reply = json!({ "ok": true, "kind": KIND, "decision": d.id, "link": id });
    write(doc, d, "a client link withdrawn", &now_s, reply)
}

fn person_name(who: &str) -> &str {
    who.strip_prefix("human:").unwrap_or(who)
}

// ── the links of a document, for the agency's screen ────────────────────────

/// Every link this document has had, newest first, with what it is worth now.
pub fn list(doc: &Document) -> HostResult<Value> {
    let chain = chain_of(doc)?;
    let here = doc.clan().document_id().to_string();
    let hash = data_hash(doc)?;
    let at = now();
    let rows: Vec<Value> = chain
        .decisions
        .iter()
        .filter(|d| action_is(d, ISSUE) && d.targets.iter().any(|t| t == &here))
        .filter_map(|d| {
            let i = issued_of(d)?;
            let st = state_in(&chain, &here, &hash, &i.id, &at);
            let answer = match &st {
                LinkState::Answered(_, a) => Some(a.clone()),
                _ => None,
            };
            Some(json!({
                "id": i.id, "state": st.word(), "answer": answer, "version": i.version,
                "client": { "name": i.name, "email": i.email },
                "expires": i.expires, "made": d.timestamp,
            }))
        })
        .collect();
    Ok(json!({ "ok": true, "links": rows }))
}

// ── the client's own answer ─────────────────────────────────────────────────

/// What a link lets a client say.
pub const CONFIRM: &str = "confirm";
pub const CHANGES: &str = "changes";

/// `POST /client-link/answer`: `{id, answer: confirm | changes, said?}`.
#[derive(Debug, Clone)]
pub struct Answer {
    pub id: String,
    pub confirm: bool,
    pub said: Option<String>,
}

impl Answer {
    pub fn parse(raw: &str) -> HostResult<Self> {
        let v = body(raw)?;
        for key in ["actor", "client", "recorded_by", "version", "channel"] {
            if v.get(key).is_some() {
                return Err(bad(format!(
                    "`{key}` is not the client's to say: the link knows it"
                )));
            }
        }
        let id = required(&v, "id")?;
        if !valid_id(&id) {
            return Err(bad("`id` is 32 lower-case hex digits"));
        }
        let confirm = match required(&v, "answer")?.as_str() {
            CONFIRM => true,
            CHANGES => false,
            _ => return Err(bad("`answer` is confirm or changes")),
        };
        let said = match v.get("said") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) if s.trim().is_empty() => None,
            Some(Value::String(s)) if s.chars().count() > MAX_SAID => {
                return Err(bad(format!("`said` is at most {MAX_SAID} characters")))
            }
            Some(Value::String(s)) => Some(s.clone()),
            Some(_) => return Err(bad("`said` is text")),
        };
        if !confirm && said.is_none() {
            return Err(bad("asking for changes needs words: say what to change"));
        }
        Ok(Self { id, confirm, said })
    }
}

/// The client's answer, as `client:<email>`: the document answer of a staff
/// record, the client as the actor, on the exact version the link names.
/// `confirm` is `accepted`; `changes` is `accepted_with_changes`, which the
/// Brief gate does not count as a confirmation. Neither unlocks or edits.
pub fn answer(ctx: &Ctx, doc: &Document, input: Answer) -> HostResult<Outcome> {
    if !ctx.actor.is_client() {
        return Err(HostError::new(
            403,
            "a link's answer is the client's own: it comes through the link, as the client",
        ));
    }
    let who = ctx.actor.to_string();
    let chain = chain_of(doc)?;
    let here = doc.clan().document_id().to_string();
    let hash = data_hash(doc)?;
    let issued = match state_in(&chain, &here, &hash, &input.id, &now()) {
        LinkState::Open(i) => i,
        LinkState::Unknown => return Err(HostError::not_found("no such link")),
        other => {
            return Err(HostError::new(
                410,
                format!("this link is {}", other.word()),
            ))
        }
    };
    if issued.scope != SCOPE_CONFIRM {
        return Err(HostError::new(403, "this link does not carry that action"));
    }
    if ctx.actor.as_str() != format!("client:{}", issued.email) {
        return Err(HostError::new(403, "this link is for someone else"));
    }
    let answer = if input.confirm {
        "accepted"
    } else {
        "accepted_with_changes"
    };
    let now_s = now();
    let mut d = attributed(ctx, "", KIND);
    d.id = Some(new_decision_id());
    d.agent = who.clone();
    d.action = CLIENT_ANSWER.to_string();
    d.targets = vec![here.clone()];
    d.cites = vec![issued.lock.clone()];
    d.timestamp = now_s.clone();
    d.version = Some(issued.version.clone());
    d.rationale = format!(
        "{} {} through their link.",
        issued.name,
        if input.confirm {
            "confirmed the brief"
        } else {
            "asked for changes to the brief"
        }
    );
    let put = |d: &mut Decision, k: &str, v: Value| -> HostResult<()> {
        d.extra.insert(k.to_string(), to_yaml(&v)?);
        Ok(())
    };
    put(&mut d, "covers", json!("document"))?;
    put(&mut d, "answer", json!(answer))?;
    if let Some(said) = &input.said {
        put(&mut d, "said", json!(said))?;
    }
    put(
        &mut d,
        "client",
        json!({ "name": issued.name, "email": issued.email }),
    )?;
    put(&mut d, "channel", json!(CHANNEL))?;
    put(
        &mut d,
        "evidence",
        json!({ "link": issued.id, "strength": "strong" }),
    )?;
    put(&mut d, "link", json!(issued.id))?;
    put(
        &mut d,
        "seen",
        json!({ "version": issued.version, "doc_hash": issued.doc_hash, "parts": [] }),
    )?;
    let reply = json!({ "ok": true, "kind": KIND, "decision": d.id, "answer": answer, "version": issued.version });
    write(doc, d, "a client's answer by link", &now_s, reply)
}

/// `POST /client-link/state`: `{id}`. A read, for the client or an agency person.
pub fn state_reply(doc: &Document, id: &str) -> HostResult<Value> {
    let st = state(doc, id)?;
    let mut v = json!({ "ok": st.status() == 200, "state": st.word() });
    match &st {
        LinkState::Open(i) => {
            v["client"] = json!({ "name": i.name, "email": i.email });
            v["version"] = json!(i.version);
            v["doc_hash"] = json!(i.doc_hash);
            v["expires"] = json!(i.expires);
            v["scope"] = json!(i.scope);
        }
        LinkState::Answered(i, a) => {
            v["client"] = json!({ "name": i.name, "email": i.email });
            v["answer"] = json!(a);
        }
        _ => {}
    }
    Ok(v)
}

/// `text` of a body key: re-exported for the routes.
pub fn id_of(raw: &str) -> HostResult<String> {
    let v = body(raw)?;
    let id = text(&v, "id");
    if !valid_id(&id) {
        return Err(bad("`id` is 32 lower-case hex digits"));
    }
    Ok(id)
}
