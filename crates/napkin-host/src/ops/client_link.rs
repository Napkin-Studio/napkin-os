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
use super::client_pieces::{self as pieces, Piece};
use super::client_review::{self as cr, extra_json, extra_str, CLIENT_ANSWER, KIND};
use super::edit::attributed;
use super::review::{body, chain_of, lock_index, now, person, required, text, to_json, to_yaml};
use super::Outcome;

pub const ISSUE: &str = "issue_link";
pub const WITHDRAW: &str = "withdraw_link";
/// The channel a link's answer records.
pub const CHANNEL: &str = "link";
/// What a link may do. The token carries it too; Phase 2's review link adds more.
pub const SCOPE_CONFIRM: &str = "confirm";
/// A review link: one reviewer of one round (features/client-review-full.clan).
pub const SCOPE_REVIEW: &str = "review";
/// A reviewer's comment, and its withdrawal.
pub const COMMENT: &str = "client_comment";
pub const COMMENT_WITHDRAW: &str = "client_comment_withdraw";
/// The answer of a reviewer who is not the round's approver: recorded and shown, and read by
/// nothing that decides (the Brief gate, the approval route), because those read `client_answer`.
pub const ADVICE: &str = "client_advice";
/// The routes a client context may reach, and no others. The check is an exact match, before
/// any route is read (`routes::dispatch`).
pub const CLIENT_ROUTES: &[&str] = &[
    "/client-link/state",
    "/client-link/answer",
    "/client-link/comment",
    "/client-link/comment-withdraw",
    "/client-link/piece",
];

/// At most this many comments on one link (withdrawn ones count: the chain does not shrink).
pub const MAX_COMMENTS: usize = 100;
/// The longest a comment may be, in characters.
pub const MAX_COMMENT: usize = 2_000;
/// The most reviewers in one round.
pub const MAX_REVIEWERS: usize = 12;

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
    /// A review link: the round's id, its number, this reviewer's role, the pieces the link was
    /// made for, and whether an emailed code is needed. Empty or false for a confirm link.
    pub review: Option<String>,
    pub round: u32,
    pub approver: bool,
    pub pieces: Vec<Piece>,
    pub code: bool,
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
        review: s("review"),
        round: l.get("round").and_then(Value::as_u64).unwrap_or(0) as u32,
        approver: l.get("role").and_then(Value::as_str) == Some("approver"),
        pieces: l
            .get("pieces")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Piece::from_json).collect())
            .unwrap_or_default(),
        code: l.get("code").and_then(Value::as_bool).unwrap_or(false),
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

/// A client's context reaches its own link and no other: `403` when the actor is a client and the
/// link's issue record names someone else. A link that does not exist is left to the caller's 404,
/// and a person on staff is not confined.
fn confine(ctx: &Ctx, doc: &Document, id: &str) -> HostResult<()> {
    if !ctx.actor.is_client() {
        return Ok(());
    }
    let chain = chain_of(doc)?;
    let here = doc.clan().document_id().to_string();
    if let Some(issued) = find_issue(&chain, &here, id).and_then(issued_of) {
        if ctx.actor.as_str() != format!("client:{}", issued.email) {
            return Err(HostError::new(403, "this link is for someone else"));
        }
    }
    Ok(())
}

/// What the link `id` is worth now, from the chain and the document's data.
pub fn state(doc: &Document, id: &str) -> HostResult<LinkState> {
    let chain = chain_of(doc)?;
    let here = doc.clan().document_id().to_string();
    let hash = data_hash(doc)?;
    Ok(state_in(&chain, &here, &hash, id, &now(), &|| {
        pieces::pieces_of(doc)
    }))
}

/// What the link is worth. `current` gives the document's pieces as they stand, and is called only
/// for a review link, so a confirm link costs what it did.
fn state_in(
    chain: &DecisionChain,
    here: &str,
    hash: &str,
    id: &str,
    at: &str,
    current: &dyn Fn() -> Option<Vec<Piece>>,
) -> LinkState {
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
        .find(|d| (action_is(d, CLIENT_ANSWER) || action_is(d, ADVICE)) && about_link(d, id))
    {
        let answer = extra_str(a, "answer").unwrap_or_default().to_string();
        return LinkState::Answered(issued, answer);
    }
    let lock = lock_index(chain, here).map(|i| &chain.decisions[i]);
    let same_version = lock.is_some_and(|l| l.id.as_deref() == Some(issued.lock.as_str()))
        && hash == issued.doc_hash
        && cr::reopened(chain, here).is_empty();
    // A review link is also for the exact bytes of each piece: an image swapped without a change
    // to the data leaves the link dead, as an edit does.
    let same_pieces = issued.scope != SCOPE_REVIEW
        || current().is_some_and(|now| {
            now.len() == issued.pieces.len()
                && now.iter().zip(&issued.pieces).all(|(a, b)| a.same_as(b))
        });
    if !same_version || !same_pieces {
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

/// An address as two people would call the same mailbox: trimmed, lower case, and with a plus tag
/// dropped from the part before the `@` (`Aoife+client@studio.ie` is `aoife@studio.ie`). What a rule
/// about who an address belongs to compares; nothing stored or sent is changed.
pub fn canonical_email(e: &str) -> String {
    let e = e.trim().to_lowercase();
    match e.split_once('@') {
        Some((local, domain)) => format!("{}@{domain}", local.split('+').next().unwrap_or(local)),
        None => e,
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
    // A client's link is to a signed brief (features/client-confirm-link.clan): the web layer
    // shows the client the brief's own fields, so a document it cannot read that way gets none.
    if !super::gate::applies(doc) {
        return Err(bad(
            "a client's link is for a Brief Maker brief: this document is not one",
        ));
    }
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
    let now_pieces = pieces::pieces_of(doc);
    let rows: Vec<Value> = chain
        .decisions
        .iter()
        .filter(|d| action_is(d, ISSUE) && d.targets.iter().any(|t| t == &here))
        .filter_map(|d| {
            let i = issued_of(d)?;
            let st = state_in(&chain, &here, &hash, &i.id, &at, &|| now_pieces.clone());
            let answer = match &st {
                LinkState::Answered(_, a) => Some(a.clone()),
                _ => None,
            };
            Some(json!({
                "id": i.id, "state": st.word(), "answer": answer, "version": i.version,
                "client": { "name": i.name, "email": i.email },
                "expires": i.expires, "made": d.timestamp,
                "scope": i.scope, "review": i.review, "round": i.round,
                "role": if i.scope == SCOPE_REVIEW { Some(if i.approver { "approver" } else { "reviewer" }) } else { None },
            }))
        })
        .collect();
    Ok(json!({ "ok": true, "links": rows }))
}

// ── the client's own answer ─────────────────────────────────────────────────

/// What a link lets a client say.
pub const CONFIRM: &str = "confirm";
pub const CHANGES: &str = "changes";

/// `POST /client-link/answer`: `{id, answer: confirm | changes, said?, pieces?: [{piece, answer}]}`.
/// `pieces` is for a review link: a reviewer's mark on each piece, `approve` or `changes`.
#[derive(Debug, Clone)]
pub struct Answer {
    pub id: String,
    pub confirm: bool,
    pub said: Option<String>,
    /// (piece number from 1, approved)
    pub pieces: Vec<(usize, bool)>,
}

impl Answer {
    pub fn parse(raw: &str) -> HostResult<Self> {
        let v = body(raw)?;
        for key in [
            "actor",
            "client",
            "recorded_by",
            "version",
            "channel",
            "round",
            "review",
            "role",
        ] {
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
        let mut marks: Vec<(usize, bool)> = Vec::new();
        match v.get("pieces") {
            None | Some(Value::Null) => {}
            Some(Value::Array(a)) if a.len() <= pieces::MAX_PIECES => {
                for m in a {
                    let n = m
                        .get("piece")
                        .and_then(Value::as_u64)
                        .filter(|n| *n >= 1)
                        .ok_or_else(|| bad("a piece mark names its `piece`, from 1"))?
                        as usize;
                    let ok = match m.get("answer").and_then(Value::as_str) {
                        Some("approve") => true,
                        Some("changes") => false,
                        _ => return Err(bad("a piece mark's `answer` is approve or changes")),
                    };
                    if marks.iter().any(|(k, _)| *k == n) {
                        return Err(bad(format!("piece {n} is marked twice")));
                    }
                    marks.push((n, ok));
                }
            }
            Some(_) => return Err(bad("`pieces` is a short list of marks")),
        }
        if confirm && marks.iter().any(|(_, ok)| !ok) {
            return Err(bad(
                "an answer of confirm cannot hold a piece that asks for changes",
            ));
        }
        Ok(Self {
            id,
            confirm,
            said,
            pieces: marks,
        })
    }
}

/// The client's answer, as `client:<email>`: the document answer of a staff
/// record, the client as the actor, on the exact version the link names.
/// `confirm` is `accepted`; `changes` is `accepted_with_changes`, which the
/// Brief gate does not count as a confirmation. Neither unlocks or edits.
///
/// On a review link the round's approver writes `client_answer`, the one the gate and the approval
/// route read; any other reviewer writes `client_advice`, which they do not (recorded, shown, and
/// counted for nothing).
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
    let issued = match state_in(&chain, &here, &hash, &input.id, &now(), &|| {
        pieces::pieces_of(doc)
    }) {
        LinkState::Open(i) => i,
        LinkState::Unknown => return Err(HostError::not_found("no such link")),
        other => {
            return Err(HostError::new(
                410,
                format!("this link is {}", other.word()),
            ))
        }
    };
    if issued.scope != SCOPE_CONFIRM && issued.scope != SCOPE_REVIEW {
        return Err(HostError::new(403, "this link does not carry that action"));
    }
    if ctx.actor.as_str() != format!("client:{}", issued.email) {
        return Err(HostError::new(403, "this link is for someone else"));
    }
    let review = issued.scope == SCOPE_REVIEW;
    if !review && !input.pieces.is_empty() {
        return Err(bad("this link has no pieces to mark"));
    }
    if input.pieces.iter().any(|(n, _)| *n > issued.pieces.len()) {
        return Err(bad("a piece mark names a piece this link does not have"));
    }
    let own = if review {
        comments_of(&chain, &here, &issued.id).len()
    } else {
        0
    };
    if !input.confirm && input.said.is_none() && own == 0 {
        return Err(bad("asking for changes needs words: say what to change"));
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
    d.action = if review && !issued.approver {
        ADVICE.to_string()
    } else {
        CLIENT_ANSWER.to_string()
    };
    d.targets = vec![here.clone()];
    d.cites = vec![issued.lock.clone()];
    d.timestamp = now_s.clone();
    d.version = Some(issued.version.clone());
    d.rationale = format!(
        "{} {} through their link.",
        issued.name,
        match (input.confirm, d.action.as_str()) {
            (true, ADVICE) => "approved, as a reviewer",
            (false, ADVICE) => "asked for changes, as a reviewer",
            (true, _) => "confirmed the brief",
            (false, _) => "asked for changes to the brief",
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
    if review {
        put(&mut d, "review", json!(issued.review))?;
        put(&mut d, "round", json!(issued.round))?;
        let marks: Vec<Value> = input
            .pieces
            .iter()
            .map(|(n, ok)| {
                let p = &issued.pieces[n - 1];
                json!({ "piece": n, "address": p.address, "sha256": p.sha256,
                        "answer": if *ok { "approve" } else { "changes" } })
            })
            .collect();
        put(&mut d, "piece_answers", json!(marks))?;
    }
    let reply = json!({ "ok": true, "kind": KIND, "decision": d.id, "answer": answer, "version": issued.version });
    write(doc, d, "a client's answer by link", &now_s, reply)
}

// ── a round: several reviewers, one locked version ──────────────────────────

/// One reviewer in `POST /client-link/issue-round`.
#[derive(Debug, Clone)]
pub struct Reviewer {
    pub id: String,
    pub name: String,
    pub email: String,
    pub approver: bool,
}

/// `POST /client-link/issue-round`: `{review, reviewers: [{id, name, email, approver}], expires, code}`.
/// The pieces, the lock, the version and the round number are the host's: they are not in the body.
#[derive(Debug, Clone)]
pub struct IssueRound {
    pub review: String,
    pub reviewers: Vec<Reviewer>,
    pub expires: String,
    pub code: bool,
}

impl IssueRound {
    pub fn parse(raw: &str) -> HostResult<Self> {
        let v = body(raw)?;
        for key in [
            "actor",
            "recorded_by",
            "doc_hash",
            "version",
            "lock",
            "round",
            "pieces",
        ] {
            if v.get(key).is_some() {
                return Err(bad(format!("`{key}` is the host's, not the body's")));
            }
        }
        let review = required(&v, "review")?;
        if !valid_id(&review) {
            return Err(bad("`review` is 32 lower-case hex digits"));
        }
        let expires = required(&v, "expires")?;
        let list = v
            .get("reviewers")
            .and_then(Value::as_array)
            .ok_or_else(|| bad("`reviewers` is a list"))?;
        if list.is_empty() || list.len() > MAX_REVIEWERS {
            return Err(bad(format!(
                "a round has from 1 to {MAX_REVIEWERS} reviewers"
            )));
        }
        let mut reviewers: Vec<Reviewer> = Vec::new();
        for r in list {
            let id = required(r, "id")?;
            if !valid_id(&id) {
                return Err(bad("a reviewer's `id` is 32 lower-case hex digits"));
            }
            let name = required(r, "name")?;
            if name.chars().count() > MAX_NAME {
                return Err(bad(format!("`name` is at most {MAX_NAME} characters")));
            }
            let email = required(r, "email")?.to_lowercase();
            if !plain_email(&email) {
                return Err(bad(format!("`email` {email:?} is not an email address")));
            }
            if reviewers.iter().any(|q| q.email == email || q.id == id) {
                return Err(bad("each reviewer has their own address and link"));
            }
            let approver = r.get("approver").and_then(Value::as_bool).unwrap_or(false);
            reviewers.push(Reviewer {
                id,
                name,
                email,
                approver,
            });
        }
        if reviewers.iter().filter(|r| r.approver).count() != 1 {
            return Err(bad("exactly one reviewer in a round is the approver"));
        }
        Ok(Self {
            review,
            reviewers,
            expires,
            code: v.get("code").and_then(Value::as_bool).unwrap_or(false),
        })
    }
}

fn review_of(d: &Decision) -> Option<String> {
    link_of(d)?
        .get("review")
        .and_then(Value::as_str)
        .map(String::from)
}

/// Send the locked version, as it stands, to several named reviewers: one `issue_link` each, all
/// with one review id, the round number counted here from the chain (the number of distinct locks a
/// review was issued for), each reviewer's own link id, and the pieces worked out from the
/// document's clean spec. Refused as a single link is, and `400` for a document type with no spec.
pub fn issue_round(ctx: &Ctx, doc: &Document, input: IssueRound) -> HostResult<Outcome> {
    let who = person(ctx, "send a client's review")?;
    let Some(now_pieces) = pieces::pieces_of(doc) else {
        return Err(bad(
            "a client's review is for a brief, a visual brief or a script: this document is none of them",
        ));
    };
    if now_pieces.len() > pieces::MAX_PIECES {
        return Err(bad("a round has at most 40 pieces"));
    }
    let chain = chain_of(doc)?;
    let here = doc.clan().document_id().to_string();
    let at = lock_index(&chain, &here).ok_or_else(|| {
        HostError::conflict(
            "a client's review is of a locked version: lock it first, so the client reviews the version that was signed",
        )
    })?;
    let lock = &chain.decisions[at];
    if super::gate::edited_since(&chain, at) || !cr::reopened(&chain, &here).is_empty() {
        return Err(HostError::conflict(
            "the document changed after it was locked: sign the new version, then send the review",
        ));
    }
    let lock_id = lock.id.clone().unwrap_or_default();
    let reviews: Vec<&Decision> = chain
        .decisions
        .iter()
        .filter(|d| {
            action_is(d, ISSUE)
                && d.targets.iter().any(|t| t == &here)
                && link_of(d)
                    .and_then(|l| l.get("scope").and_then(Value::as_str).map(String::from))
                    .as_deref()
                    == Some(SCOPE_REVIEW)
        })
        .collect();
    if reviews
        .iter()
        .any(|d| review_of(d).as_deref() == Some(input.review.as_str()))
    {
        return Err(HostError::conflict("that review id is already used"));
    }
    for r in &input.reviewers {
        if find_issue(&chain, &here, &r.id).is_some() {
            return Err(HostError::conflict("a link id is already used"));
        }
    }
    // The round: how many rounds have been sent for this document, this one included. A round is a
    // review id, so sending again on the same lock is round 2, as sending after a new lock is.
    let mut sent: Vec<String> = reviews.iter().filter_map(|d| review_of(d)).collect();
    sent.sort();
    sent.dedup();
    let round = sent.len() as u32 + 1;

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
    let piece_json: Vec<Value> = now_pieces.iter().map(Piece::to_json).collect();
    let mut made: Vec<Decision> = Vec::new();
    let mut links: Vec<Value> = Vec::new();
    // A new round replaces an open one: its links that no one has answered are withdrawn in this same
    // change, by the person sending, so two rounds never take answers on one lock. An answer already
    // given stays where it is.
    for d in &reviews {
        let Some(old) = issued_of(d) else { continue };
        let open = matches!(
            state_in(&chain, &here, &hash, &old.id, &now_s, &|| Some(
                now_pieces.clone()
            )),
            LinkState::Open(_)
        );
        if !open {
            continue;
        }
        let mut w = attributed(ctx, "", KIND);
        w.id = Some(new_decision_id());
        w.agent = who.clone();
        w.action = WITHDRAW.to_string();
        w.targets = vec![here.clone()];
        w.cites = vec![d.id.clone().unwrap_or_default()];
        w.timestamp = now_s.clone();
        w.rationale = format!(
            "{} withdrew {}'s link from round {} when sending round {round}.",
            person_name(&who),
            old.name,
            old.round
        );
        w.extra.insert("link".into(), to_yaml(&json!(old.id))?);
        w.extra
            .insert("replaced_by".into(), to_yaml(&json!(input.review))?);
        made.push(w);
    }
    for r in &input.reviewers {
        let mut d = attributed(ctx, "", KIND);
        d.id = Some(new_decision_id());
        d.agent = who.clone();
        d.action = ISSUE.to_string();
        d.targets = vec![here.clone()];
        d.cites = vec![lock_id.clone()];
        d.timestamp = now_s.clone();
        d.version = Some(version.clone());
        d.rationale = format!(
            "{} sent this locked version to {} for review, round {round}{}.",
            person_name(&who),
            r.name,
            if r.approver { ", as the approver" } else { "" }
        );
        d.extra.insert(
            "link".into(),
            to_yaml(&json!({
                "id": r.id,
                "scope": SCOPE_REVIEW,
                "targets": [here],
                "lock": lock.id,
                "version": version,
                "doc_hash": hash,
                "client": { "name": r.name, "email": r.email },
                "expires": input.expires,
                "review": input.review,
                "round": round,
                "role": if r.approver { "approver" } else { "reviewer" },
                "pieces": piece_json,
                "code": input.code,
            }))?,
        );
        links.push(json!({ "id": r.id, "email": r.email, "name": r.name,
                           "role": if r.approver { "approver" } else { "reviewer" } }));
        made.push(d);
    }
    let reply = json!({
        "ok": true, "kind": KIND, "review": input.review, "round": round, "links": links,
        "lock": lock.id, "version": version, "doc_hash": hash, "scope": SCOPE_REVIEW,
        "targets": [here], "pieces": now_pieces.len(), "code": input.code,
    });
    let clan = doc.clan();
    let bytes = assemble(
        clan,
        data_of(clan)?,
        Members::of(clan)?,
        made,
        "a client review sent",
        &now_s,
        false,
    )?;
    let notice =
        json!({ "ok": true, "source": "client-link", "kind": KIND, "review": input.review });
    let change = doc
        .change(bytes)?
        .with_event(HostEvent::DataChanged(notice));
    Ok(Outcome::changed(reply, change))
}

// ── comments ────────────────────────────────────────────────────────────────

/// A reviewer's comment as a link's own page reads it back.
#[derive(Debug, Clone, PartialEq)]
pub struct CommentRow {
    pub id: String,
    pub piece: usize,
    pub pin: Value,
    pub tag: String,
    pub text: String,
    pub at: String,
}

fn comment_row(d: &Decision) -> Option<CommentRow> {
    let c = d.extra.get("comment").map(to_json)?;
    Some(CommentRow {
        id: d.id.clone()?,
        piece: c.get("piece")?.as_u64()? as usize,
        pin: c.get("pin").cloned().unwrap_or(Value::Null),
        tag: c.get("tag")?.as_str()?.to_string(),
        text: c.get("text")?.as_str()?.to_string(),
        at: d.timestamp.clone(),
    })
}

/// The comments of link `id` that stand: not withdrawn, oldest first.
fn comments_of(chain: &DecisionChain, here: &str, id: &str) -> Vec<CommentRow> {
    let withdrawn: Vec<&str> = chain
        .decisions
        .iter()
        .filter(|d| action_is(d, COMMENT_WITHDRAW) && about_link(d, id))
        .filter_map(|d| d.cites.first().map(String::as_str))
        .collect();
    let mut rows: Vec<CommentRow> = chain
        .decisions
        .iter()
        .filter(|d| {
            action_is(d, COMMENT)
                && about_link(d, id)
                && d.targets.iter().any(|t| t == here)
                && d.id.as_deref().is_some_and(|i| !withdrawn.contains(&i))
        })
        .filter_map(comment_row)
        .collect();
    rows.reverse(); // the chain is newest first
    rows
}

/// `POST /client-link/comment`: `{id, piece, pin?: {x, y} | {t_ms}, tag, text}`. Who, the version, the
/// round and the channel are the link's, never the body's.
#[derive(Debug, Clone)]
pub struct Comment {
    pub id: String,
    pub piece: usize,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub t_ms: Option<u64>,
    pub tag: String,
    pub text: String,
}

impl Comment {
    pub fn parse(raw: &str) -> HostResult<Self> {
        let v = body(raw)?;
        for key in [
            "actor",
            "client",
            "recorded_by",
            "version",
            "channel",
            "round",
            "review",
            "role",
            "link",
        ] {
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
        let piece = v
            .get("piece")
            .and_then(Value::as_u64)
            .filter(|n| *n >= 1 && *n as usize <= pieces::MAX_PIECES)
            .ok_or_else(|| bad("`piece` is the number of a piece, from 1"))?
            as usize;
        let tag = required(&v, "tag")?;
        let text = match v.get("text") {
            Some(Value::String(s)) if !s.trim().is_empty() => s.trim().to_string(),
            _ => return Err(bad("a comment needs words: `text`")),
        };
        if text.chars().count() > MAX_COMMENT {
            return Err(bad(format!("`text` is at most {MAX_COMMENT} characters")));
        }
        let (mut x, mut y, mut t_ms) = (None, None, None);
        match v.get("pin") {
            None | Some(Value::Null) => {}
            Some(Value::Object(p)) => {
                for k in p.keys() {
                    if !matches!(k.as_str(), "x" | "y" | "t_ms") {
                        return Err(bad(format!("`pin.{k}` is not a part of a pin")));
                    }
                }
                let frac = |k: &str| -> HostResult<Option<f64>> {
                    match p.get(k) {
                        None => Ok(None),
                        Some(n) => n
                            .as_f64()
                            .filter(|f| (0.0..=1.0).contains(f))
                            .map(|f| Some((f * 1000.0).round() / 1000.0))
                            .ok_or_else(|| bad(format!("`pin.{k}` is from 0 to 1"))),
                    }
                };
                x = frac("x")?;
                y = frac("y")?;
                if x.is_some() != y.is_some() {
                    return Err(bad("a pin's `x` and `y` come together"));
                }
                if let Some(t) = p.get("t_ms") {
                    t_ms = Some(
                        t.as_u64()
                            .ok_or_else(|| bad("`pin.t_ms` is whole milliseconds"))?,
                    );
                }
                if x.is_none() && t_ms.is_none() {
                    return Err(bad("a pin is `{x, y}` or `{t_ms}`"));
                }
            }
            Some(_) => return Err(bad("`pin` is an object")),
        }
        Ok(Self {
            id,
            piece,
            x,
            y,
            t_ms,
            tag,
            text,
        })
    }
}

/// A film or audio longer than this has no time a comment can be pinned past (six hours).
const LONGEST_MS: u64 = 6 * 60 * 60 * 1000;

/// Write a comment on one piece of the link's version, as the client.
pub fn comment(ctx: &Ctx, doc: &Document, input: Comment) -> HostResult<Outcome> {
    if !ctx.actor.is_client() {
        return Err(HostError::new(
            403,
            "a comment is the client's own: it comes through the link, as the client",
        ));
    }
    let chain = chain_of(doc)?;
    let here = doc.clan().document_id().to_string();
    let hash = data_hash(doc)?;
    let issued = match state_in(&chain, &here, &hash, &input.id, &now(), &|| {
        pieces::pieces_of(doc)
    }) {
        LinkState::Open(i) => i,
        LinkState::Unknown => return Err(HostError::not_found("no such link")),
        other => {
            return Err(HostError::new(
                410,
                format!("this link is {}", other.word()),
            ))
        }
    };
    if issued.scope != SCOPE_REVIEW {
        return Err(HostError::new(403, "this link does not carry comments"));
    }
    if ctx.actor.as_str() != format!("client:{}", issued.email) {
        return Err(HostError::new(403, "this link is for someone else"));
    }
    let Some(piece) = issued.pieces.get(input.piece - 1) else {
        return Err(bad("`piece` is not one of this link's pieces"));
    };
    if input.tag != "preference" && !pieces::point_allowed(doc, &input.tag) {
        return Err(bad(
            "`tag` is `preference` or a point of the brief the client may read",
        ));
    }
    match piece.kind.as_str() {
        "film" | "audio" => {
            if let Some(t) = input.t_ms {
                if t > piece.duration_ms.unwrap_or(LONGEST_MS) {
                    return Err(bad("`pin.t_ms` is past the end of this piece"));
                }
            }
        }
        _ => {
            if input.t_ms.is_some() {
                return Err(bad("a moment in time is for a film or audio"));
            }
        }
    }
    let spent = chain
        .decisions
        .iter()
        .filter(|d| action_is(d, COMMENT) && about_link(d, &issued.id))
        .count();
    if spent >= MAX_COMMENTS {
        return Err(HostError::new(
            429,
            format!("a link holds at most {MAX_COMMENTS} comments"),
        ));
    }
    let now_s = now();
    let mut d = attributed(ctx, "", KIND);
    d.id = Some(new_decision_id());
    d.agent = ctx.actor.to_string();
    d.action = COMMENT.to_string();
    d.targets = vec![here.clone()];
    d.cites = vec![issued.lock.clone()];
    d.timestamp = now_s.clone();
    d.version = Some(issued.version.clone());
    d.rationale = format!("{} commented on {}.", issued.name, piece.label);
    let mut pin = serde_json::Map::new();
    if let (Some(x), Some(y)) = (input.x, input.y) {
        pin.insert("x".into(), json!(x));
        pin.insert("y".into(), json!(y));
    }
    if let Some(t) = input.t_ms {
        pin.insert("t_ms".into(), json!(t));
    }
    let mut c = json!({
        "piece": input.piece, "address": piece.address, "tag": input.tag, "text": input.text,
    });
    if !pin.is_empty() {
        c["pin"] = Value::Object(pin);
    }
    d.extra.insert("comment".into(), to_yaml(&c)?);
    d.extra.insert("link".into(), to_yaml(&json!(issued.id))?);
    d.extra
        .insert("review".into(), to_yaml(&json!(issued.review))?);
    d.extra
        .insert("round".into(), to_yaml(&json!(issued.round))?);
    d.extra.insert("channel".into(), to_yaml(&json!(CHANNEL))?);
    let reply =
        json!({ "ok": true, "comment": d.id, "piece": input.piece, "version": issued.version });
    write(doc, d, "a client's comment by link", &now_s, reply)
}

/// `POST /client-link/comment-withdraw`: `{id, comment}`: take back one's own comment before answering.
pub fn parse_comment_withdraw(raw: &str) -> HostResult<(String, String)> {
    let v = body(raw)?;
    let id = required(&v, "id")?;
    if !valid_id(&id) {
        return Err(bad("`id` is 32 lower-case hex digits"));
    }
    Ok((id, required(&v, "comment")?))
}

pub fn comment_withdraw(ctx: &Ctx, doc: &Document, id: &str, comment: &str) -> HostResult<Outcome> {
    if !ctx.actor.is_client() {
        return Err(HostError::new(
            403,
            "a comment is withdrawn by the client, through the link",
        ));
    }
    let chain = chain_of(doc)?;
    let here = doc.clan().document_id().to_string();
    let hash = data_hash(doc)?;
    let issued = match state_in(&chain, &here, &hash, id, &now(), &|| pieces::pieces_of(doc)) {
        LinkState::Open(i) => i,
        LinkState::Unknown => return Err(HostError::not_found("no such link")),
        other => {
            return Err(HostError::new(
                410,
                format!("this link is {}", other.word()),
            ))
        }
    };
    if issued.scope != SCOPE_REVIEW {
        return Err(HostError::new(403, "this link does not carry comments"));
    }
    if ctx.actor.as_str() != format!("client:{}", issued.email) {
        return Err(HostError::new(403, "this link is for someone else"));
    }
    // only this link's own live comment: another reviewer's id reads as no such comment
    if !comments_of(&chain, &here, id)
        .iter()
        .any(|c| c.id == comment)
    {
        return Err(HostError::not_found("no such comment on this link"));
    }
    let now_s = now();
    let mut d = attributed(ctx, "", KIND);
    d.id = Some(new_decision_id());
    d.agent = ctx.actor.to_string();
    d.action = COMMENT_WITHDRAW.to_string();
    d.targets = vec![here];
    d.cites = vec![comment.to_string()];
    d.timestamp = now_s.clone();
    d.version = Some(issued.version.clone());
    d.rationale = format!("{} took back a comment.", issued.name);
    d.extra.insert("link".into(), to_yaml(&json!(id))?);
    let reply = json!({ "ok": true, "comment": comment });
    write(doc, d, "a client's comment withdrawn", &now_s, reply)
}

// ── a piece's bytes ─────────────────────────────────────────────────────────

/// `POST /client-link/piece`: `{id, n, head?}` (n from 1). With `head` the reply is the piece's
/// content type and hash and no bytes: the link and the piece are checked, nothing is read.
pub fn parse_piece(raw: &str) -> HostResult<(String, usize, bool)> {
    let v = body(raw)?;
    let id = required(&v, "id")?;
    if !valid_id(&id) {
        return Err(bad("`id` is 32 lower-case hex digits"));
    }
    let n = v
        .get("n")
        .and_then(Value::as_u64)
        .ok_or_else(|| bad("`n` is the number of a piece, from 1"))? as usize;
    let head = v.get("head").and_then(Value::as_bool).unwrap_or(false);
    // a piece 0 is no piece: the same answer as any number outside the list
    Ok((id, n, head))
}

/// The piece `n` of an open review link, as the issue recorded it: only when the link is open and
/// the piece is a file the issue named.
fn open_piece(ctx: &Ctx, doc: &Document, id: &str, n: usize) -> HostResult<Piece> {
    confine(ctx, doc, id)?;
    let st = state(doc, id)?;
    let issued = match st {
        LinkState::Open(i) => i,
        LinkState::Unknown => return Err(HostError::not_found("no such link")),
        other => {
            return Err(HostError::new(
                410,
                format!("this link is {}", other.word()),
            ))
        }
    };
    if issued.scope != SCOPE_REVIEW {
        return Err(HostError::not_found("this link has no pieces"));
    }
    let piece = n
        .checked_sub(1)
        .and_then(|i| issued.pieces.get(i))
        .ok_or_else(|| HostError::not_found("no such piece"))?;
    if piece.kind == "text" {
        return Err(HostError::not_found("that piece is words, not a file"));
    }
    Ok(piece.clone())
}

/// What a piece will be served as, and the hash it was recorded with, without reading its bytes.
pub fn piece_head(ctx: &Ctx, doc: &Document, id: &str, n: usize) -> HostResult<(String, String)> {
    let piece = open_piece(ctx, doc, id, n)?;
    let ctype = pieces::content_type_of(&piece)
        .ok_or_else(|| HostError::new(410, "this link is superseded"))?;
    // the same check the bytes get: the piece, as this version hashes it, is what was recorded
    if !pieces::pieces_of(doc).is_some_and(|now| now.iter().any(|p| p.same_as(&piece))) {
        return Err(HostError::new(410, "this link is superseded"));
    }
    Ok((ctype.to_string(), piece.sha256))
}

/// The bytes of piece `n` of an open review link, and its content type: only when the link is open,
/// the piece is one the issue recorded, and the file still is what the issue recorded.
pub fn piece_bytes(ctx: &Ctx, doc: &Document, id: &str, n: usize) -> HostResult<(String, Vec<u8>)> {
    let piece = open_piece(ctx, doc, id, n)?;
    let (ctype, bytes) = pieces::bytes_of(doc, &piece)
        .ok_or_else(|| HostError::new(410, "this link is superseded"))?;
    Ok((ctype.to_string(), bytes))
}

// ── the agency's merged view of a round ─────────────────────────────────────

/// Two pins this close on one piece are likely the same remark: within this fraction of the piece's
/// width and height, or within this many milliseconds of a film.
const SAME_SPOT: f64 = 0.05;
const SAME_MOMENT_MS: u64 = 2_000;

/// `GET /client-review/round`: the round last sent for the locked version (or, with no lock, the
/// last sent), with every reviewer, every comment ordered by piece then position, and the likely
/// contradictions flagged by two fixed rules: `split` (one reviewer approved a piece and another asked
/// for changes) and `same spot` (two reviewers' pins close together). No model is called.
pub fn round_view(doc: &Document) -> HostResult<Value> {
    let chain = chain_of(doc)?;
    let here = doc.clan().document_id().to_string();
    let hash = data_hash(doc)?;
    let at = now();
    let now_pieces = pieces::pieces_of(doc);
    let lock_now = lock_index(&chain, &here).and_then(|i| chain.decisions[i].id.clone());
    let issues: Vec<(&Decision, Issued)> = chain
        .decisions
        .iter()
        .filter(|d| action_is(d, ISSUE) && d.targets.iter().any(|t| t == &here))
        .filter_map(|d| Some((d, issued_of(d)?)))
        .filter(|(_, i)| i.scope == SCOPE_REVIEW)
        .collect();
    // newest first: the round for the lock that holds, else the newest
    let review_id = issues
        .iter()
        .find(|(_, i)| lock_now.as_deref() == Some(i.lock.as_str()))
        .or_else(|| issues.first())
        .and_then(|(_, i)| i.review.clone())
        .ok_or_else(|| HostError::not_found("no review has been sent for this document"))?;
    let mine: Vec<&Issued> = issues
        .iter()
        .filter(|(_, i)| i.review.as_deref() == Some(review_id.as_str()))
        .map(|(_, i)| i)
        .collect();
    let first = mine[0];
    // The rounds before this one, newest first: who was asked, and what each did. Their comments are
    // not merged in: a round's answers stand where they were given.
    let mut earlier: Vec<Value> = Vec::new();
    let mut listed: Vec<&str> = vec![review_id.as_str()];
    for (d, i) in &issues {
        let Some(rid) = i.review.as_deref() else {
            continue;
        };
        if listed.contains(&rid) {
            continue;
        }
        listed.push(rid);
        let people: Vec<Value> = issues
            .iter()
            .filter(|(_, o)| o.review.as_deref() == Some(rid))
            .rev()
            .map(|(_, o)| {
                let st = state_in(&chain, &here, &hash, &o.id, &at, &|| now_pieces.clone());
                let ans = chain.decisions.iter().find(|a| {
                    (action_is(a, CLIENT_ANSWER) || action_is(a, ADVICE)) && about_link(a, &o.id)
                });
                json!({
                    "id": o.id, "name": o.name, "email": o.email,
                    "role": if o.approver { "approver" } else { "reviewer" },
                    "state": st.word(),
                    "answer": ans.and_then(|a| extra_str(a, "answer")),
                    "answered": ans.map(|a| a.timestamp.clone()),
                    "comments": comments_of(&chain, &here, &o.id).len(),
                })
            })
            .collect();
        earlier.push(json!({
            "review": rid, "round": i.round, "version": i.version, "lock": i.lock,
            "sent": d.timestamp, "reviewers": people,
        }));
    }
    let mut reviewers: Vec<Value> = Vec::new();
    let mut comments: Vec<Value> = Vec::new();
    // piece n -> [(reviewer link id, approved)]
    let mut marks: Vec<(usize, String, bool)> = Vec::new();
    let mut who: Vec<(String, String, String)> = Vec::new(); // link id, name, email
    for i in mine.iter().rev() {
        let st = state_in(&chain, &here, &hash, &i.id, &at, &|| now_pieces.clone());
        let ans = chain.decisions.iter().find(|d| {
            (action_is(d, CLIENT_ANSWER) || action_is(d, ADVICE)) && about_link(d, &i.id)
        });
        if let Some(a) = ans {
            for m in extra_json(a, "piece_answers")
                .as_array()
                .into_iter()
                .flatten()
            {
                if let (Some(n), Some(ans)) = (
                    m.get("piece").and_then(Value::as_u64),
                    m.get("answer").and_then(Value::as_str),
                ) {
                    marks.push((n as usize, i.id.clone(), ans == "approve"));
                }
            }
        }
        reviewers.push(json!({
            "id": i.id, "name": i.name, "email": i.email,
            "role": if i.approver { "approver" } else { "reviewer" },
            "state": st.word(),
            "answer": ans.and_then(|a| extra_str(a, "answer")),
            "answered": ans.map(|a| a.timestamp.clone()),
            "counts": ans.is_some_and(|a| action_is(a, CLIENT_ANSWER)),
        }));
        who.push((i.id.clone(), i.name.clone(), i.email.clone()));
        for c in comments_of(&chain, &here, &i.id) {
            comments.push(json!({
                "id": c.id, "link": i.id, "piece": c.piece, "pin": c.pin, "tag": c.tag,
                "text": c.text, "at": c.at,
                "by": { "name": i.name, "email": i.email },
                "role": if i.approver { "approver" } else { "reviewer" },
                "flags": [],
            }));
        }
    }
    let key = |c: &Value| -> (u64, f64, f64) {
        let pin = &c["pin"];
        (
            c["piece"].as_u64().unwrap_or(0),
            pin.get("t_ms")
                .and_then(Value::as_u64)
                .map(|t| t as f64)
                .or_else(|| pin.get("y").and_then(Value::as_f64))
                .unwrap_or(-1.0),
            pin.get("x").and_then(Value::as_f64).unwrap_or(-1.0),
        )
    };
    comments.sort_by(|a, b| {
        let (ka, kb) = (key(a), key(b));
        ka.partial_cmp(&kb).unwrap_or(std::cmp::Ordering::Equal)
    });
    // piece summaries and the two rules
    let mut piece_rows: Vec<Value> = Vec::new();
    let mut split: Vec<usize> = Vec::new();
    for (k, p) in first.pieces.iter().enumerate() {
        let n = k + 1;
        let on: Vec<&(usize, String, bool)> = marks.iter().filter(|m| m.0 == n).collect();
        let yes = on.iter().any(|m| m.2);
        let no = on.iter().any(|m| !m.2);
        if yes && no {
            split.push(n);
        }
        piece_rows.push(json!({
            "n": n, "label": p.label, "kind": p.kind, "ai": p.ai,
            "approved_by": on.iter().filter(|m| m.2).filter_map(|m| who.iter().find(|w| w.0 == m.1).map(|w| w.1.clone())).collect::<Vec<_>>(),
            "changes_by": on.iter().filter(|m| !m.2).filter_map(|m| who.iter().find(|w| w.0 == m.1).map(|w| w.1.clone())).collect::<Vec<_>>(),
            "split": yes && no,
        }));
    }
    let snapshot = comments.clone();
    for c in comments.iter_mut() {
        let mut flags: Vec<&str> = Vec::new();
        let n = c["piece"].as_u64().unwrap_or(0) as usize;
        if split.contains(&n) {
            flags.push("split");
        }
        for o in &snapshot {
            if o["link"] == c["link"] || o["piece"] != c["piece"] {
                continue;
            }
            let (a, b) = (&c["pin"], &o["pin"]);
            let close_t = matches!(
                (a.get("t_ms").and_then(Value::as_u64), b.get("t_ms").and_then(Value::as_u64)),
                (Some(p), Some(q)) if p.abs_diff(q) <= SAME_MOMENT_MS
            );
            let close_xy = matches!(
                (a.get("x").and_then(Value::as_f64), a.get("y").and_then(Value::as_f64),
                 b.get("x").and_then(Value::as_f64), b.get("y").and_then(Value::as_f64)),
                (Some(ax), Some(ay), Some(bx), Some(by))
                    if ((ax - bx).powi(2) + (ay - by).powi(2)).sqrt() <= SAME_SPOT
            );
            if (close_t || close_xy) && !flags.contains(&"same spot") {
                flags.push("same spot");
            }
        }
        c["flags"] = json!(flags);
    }
    let current = lock_now.as_deref() == Some(first.lock.as_str());
    let approver = mine.iter().find(|i| i.approver);
    let approver_answer = approver.and_then(|i| {
        chain
            .decisions
            .iter()
            .find(|d| action_is(d, CLIENT_ANSWER) && about_link(d, &i.id))
            .and_then(|d| extra_str(d, "answer").map(String::from))
    });
    Ok(json!({
        "ok": true, "review": review_id, "round": first.round, "version": first.version,
        "lock": first.lock, "current": current, "code": first.code,
        "pieces": piece_rows, "reviewers": reviewers, "comments": comments,
        "approver_answer": approver_answer, "earlier_rounds": earlier,
    }))
}

/// [`state_reply`] for a request: a client's context is held to its own link first.
pub fn state_reply_as(ctx: &Ctx, doc: &Document, id: &str) -> HostResult<Value> {
    confine(ctx, doc, id)?;
    state_reply(doc, id)
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
            if i.scope == SCOPE_REVIEW {
                // What this reviewer's own page needs, and no one else's: the pieces as they are
                // shown (not their addresses or hashes), their round and role, and their own comments.
                let chain = chain_of(doc)?;
                let here = doc.clan().document_id().to_string();
                v["round"] = json!(i.round);
                // the version as people count it: the lock is the Nth signed version of this document
                let signed = super::versions::approvals(&chain, &here);
                v["version_n"] = signed
                    .iter()
                    .position(|&k| chain.decisions[k].id.as_deref() == Some(i.lock.as_str()))
                    .map(|pos| signed.len() - pos)
                    .into();
                v["approver"] = json!(i.approver);
                v["code"] = json!(i.code);
                v["pieces"] = json!(i
                    .pieces
                    .iter()
                    .enumerate()
                    .map(|(k, p)| json!({
                        "n": k + 1, "label": p.label, "kind": p.kind, "ai": p.ai,
                        "duration_ms": p.duration_ms,
                    }))
                    .collect::<Vec<_>>());
                v["comments"] = json!(comments_of(&chain, &here, &i.id)
                    .into_iter()
                    .map(|c| json!({
                        "id": c.id, "piece": c.piece, "pin": c.pin, "tag": c.tag, "text": c.text,
                    }))
                    .collect::<Vec<_>>());
            }
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
