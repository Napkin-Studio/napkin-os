// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Tracked changes on a script (features/script-editor.clan).
//!
//! A script is a list of beats with stable ids, and `script.proposals` holds every suggested change to
//! one beat. A creative director's mark-up is a proposal; the writer's answer to it is `accept` or
//! `reject`. Each is an ordinary attributed `patch-data` whose actor the host takes from the session,
//! never from the body, so the decision chain reads "human:<cd> marked up", "human:<writer> accepted".
//!
//! Only a person writes here, and only the writer's accept puts a proposal's words on the page. A
//! proposal carries `was`, the words it replaces: an accept is refused `409` when the beat has moved on
//! since, and the proposal stays open. A proposal is written as a plain patch of `script` (not an
//! appending write), so each keeps its inverse and the document's versions stay readable (os-layer 7.8).

use serde_json::{json, Map, Value};

use crate::ctx::Ctx;
use crate::document::Document;
use crate::error::{HostError, HostResult};

use super::edit::{PatchData, Unattributed};
use super::gate::SCRIPT_EDITOR;
use super::{read, review, Outcome};

/// The longest a proposal's words or note may be.
const MAX_TEXT: usize = 4000;

fn is_script(doc: &Document) -> bool {
    doc.clan()
        .manifest()
        .app
        .as_ref()
        .is_some_and(|a| a.app_id == SCRIPT_EDITOR)
}

fn list(script: &Value, key: &str) -> Vec<Value> {
    script
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn text_of(v: &Value) -> &str {
    v.get("text").and_then(Value::as_str).unwrap_or("")
}

fn id_of(v: &Value) -> &str {
    v.get("id").and_then(Value::as_str).unwrap_or("")
}

fn str_in<'a>(body: &'a Value, key: &str) -> &'a str {
    body.get(key).and_then(Value::as_str).unwrap_or("")
}

/// The next proposal id: `p1`, `p2`, ... one past the largest in use.
fn next_id(proposals: &[Value]) -> String {
    let top = proposals
        .iter()
        .filter_map(|p| id_of(p).strip_prefix('p')?.parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    format!("p{}", top + 1)
}

fn write(
    ctx: &Ctx,
    doc: &Document,
    patch: Value,
    action: String,
    rationale: &str,
) -> HostResult<Outcome> {
    let body =
        json!({ "patch": patch, "agent": "human", "action": action, "rationale": rationale });
    let input = PatchData::parse_with(&body.to_string(), Unattributed::Refuse)?;
    super::edit::patch_data(ctx, doc, input)
}

/// `POST /script/propose {beat, text, note?}`: a person suggests new words for one beat. The beat is
/// not changed. The proposal records the words it would replace.
pub fn propose(ctx: &Ctx, doc: &Document, body: &Value) -> HostResult<Outcome> {
    let me = review::person(ctx, "mark up a script")?;
    if !is_script(doc) {
        return Err(HostError::bad_request("this document is not a script"));
    }
    let beat = str_in(body, "beat");
    let text = str_in(body, "text").trim();
    let note = str_in(body, "note").trim();
    if text.is_empty() {
        return Err(HostError::bad_request(
            "a mark-up needs the words it suggests",
        ));
    }
    if text.chars().count() > MAX_TEXT || note.chars().count() > MAX_TEXT {
        return Err(HostError::bad_request("a mark-up is too long"));
    }
    let data = read::data_json(doc);
    let script = data.get("script").cloned().unwrap_or(Value::Null);
    let beats = list(&script, "beats");
    let Some(target) = beats.iter().find(|b| id_of(b) == beat) else {
        return Err(HostError::not_found(format!(
            "there is no beat {beat:?} in this script"
        )));
    };
    let was = text_of(target);
    if was == text {
        return Err(HostError::bad_request(
            "that is the line as it stands, so there is nothing to suggest",
        ));
    }
    let mut proposals = list(&script, "proposals");
    let id = next_id(&proposals);
    let mut p = Map::new();
    p.insert("id".into(), json!(id));
    p.insert("beat".into(), json!(beat));
    p.insert("was".into(), json!(was));
    p.insert("text".into(), json!(text));
    p.insert("kind".into(), json!("markup"));
    if !note.is_empty() {
        p.insert("note".into(), json!(note));
    }
    p.insert("by".into(), json!(me));
    p.insert("at".into(), json!(chrono::Utc::now().to_rfc3339()));
    p.insert("status".into(), json!("open"));
    proposals.push(Value::Object(p));
    let mut out = write(
        ctx,
        doc,
        json!({ "script": { "proposals": proposals } }),
        format!("mark up beat {beat}"),
        if note.is_empty() {
            "Suggested new words for a beat."
        } else {
            note
        },
    )?;
    out.reply["proposal"] = json!(id);
    Ok(out)
}

/// `POST /script/answer {proposal, answer: "accept" | "reject"}`: the writer's answer. An accept writes
/// the proposal's words into its beat and marks it accepted, in one write; a reject keeps the beat and
/// marks the proposal rejected. Either names the proposal in its action.
pub fn answer(ctx: &Ctx, doc: &Document, body: &Value) -> HostResult<Outcome> {
    let me = review::person(ctx, "answer a mark-up")?;
    if !is_script(doc) {
        return Err(HostError::bad_request("this document is not a script"));
    }
    let id = str_in(body, "proposal");
    let accept = match str_in(body, "answer") {
        "accept" => true,
        "reject" => false,
        _ => return Err(HostError::bad_request("answer with accept or reject")),
    };
    let data = read::data_json(doc);
    let script = data.get("script").cloned().unwrap_or(Value::Null);
    let mut proposals = list(&script, "proposals");
    let Some(at) = proposals.iter().position(|p| id_of(p) == id) else {
        return Err(HostError::not_found(format!(
            "there is no mark-up {id:?} in this script"
        )));
    };
    if proposals[at].get("status").and_then(Value::as_str) != Some("open") {
        return Err(HostError::conflict(
            "that mark-up has already been answered",
        ));
    }
    if str_in(&proposals[at], "by") == me {
        return Err(HostError::new(
            403,
            "you marked this up yourself; the writer answers it",
        ));
    }
    let beat = str_in(&proposals[at], "beat").to_string();
    let mut patch = Map::new();
    if accept {
        let mut beats = list(&script, "beats");
        let Some(b) = beats.iter_mut().find(|b| id_of(b) == beat) else {
            return Err(HostError::conflict(
                "the beat this mark-up was for is no longer in the script",
            ));
        };
        if text_of(b) != str_in(&proposals[at], "was") {
            return Err(HostError::conflict(
                "that line changed after it was marked up, so the change was not made; the mark-up stays open",
            ));
        }
        b["text"] = json!(str_in(&proposals[at], "text"));
        patch.insert("beats".into(), Value::Array(beats));
    }
    proposals[at]["status"] = json!(if accept { "accepted" } else { "rejected" });
    proposals[at]["answered_by"] = json!(me);
    proposals[at]["answered_at"] = json!(chrono::Utc::now().to_rfc3339());
    patch.insert("proposals".into(), Value::Array(proposals));
    let verb = if accept { "accept" } else { "reject" };
    write(
        ctx,
        doc,
        json!({ "script": Value::Object(patch) }),
        format!("{verb} proposal {id} on beat {beat}"),
        &format!(
            "{} the mark-up on beat {beat}.",
            if accept { "Took" } else { "Left out" }
        ),
    )
}
