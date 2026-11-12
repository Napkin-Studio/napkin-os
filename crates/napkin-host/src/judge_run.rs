// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Send to Judge, the one network half of the scoring route (features/judge.clan).
//!
//! `POST /judge {target?}` reads the open document, builds the request from an allow list
//! ([`crate::ops::judge::prepare`]), sends it to the middleware's `judge_work` task, and writes one
//! verdict from the answer ([`crate::ops::judge::score_outcome`]). The host, not the handler, adds the
//! passes up and routes, so the numbers are the host's arithmetic.
//!
//! It never reaches a model: an unset `NAPKIN_JUDGE_BACKEND` is refused here (`not_configured`) before
//! anything is sent, and the middleware makes its own refusals (`ai_off`, `not_eu`, `spend_refused`).
//! A refusal or a failure writes nothing and returns the credit (the web shell refunds on any non-200).
//! The request carries no clan context: the document's id and version, and nothing else of it.

use serde_json::{json, Value};

use crate::config::HostConfig;
use crate::ctx::{Actor, Ctx};
use crate::error::{HostError, HostResult};
use crate::event::HostEvent;
use crate::ops::{judge, middleware};
use crate::proxy::proxy_call;
use crate::session::Session;

/// What the middleware said when it did not score: a refusal keeps its code and status; anything else
/// is one plain line.
fn failure(reply: &Value) -> HostError {
    let kind = reply
        .pointer("/error/type")
        .and_then(Value::as_str)
        .unwrap_or("");
    if let Some((status, line)) = judge::refusal(kind) {
        return HostError::new(status, line);
    }
    HostError::new(
        502,
        "judge_failed: Judge could not score this just now. Nothing was changed.",
    )
}

pub async fn run(
    ctx: &Ctx,
    session: &Session,
    cfg: &dyn HostConfig,
    body: &str,
) -> HostResult<(Value, Vec<HostEvent>)> {
    let req: Value = if body.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(body)
            .map_err(|e| HostError::bad_request(format!("invalid JSON: {e}")))?
    };
    let target = req
        .get("target")
        .and_then(Value::as_str)
        .map(str::to_string);
    if judge::backend_set().is_none() {
        let (status, line) = judge::refusal("not_configured").unwrap_or((503, "not_configured"));
        return Err(HostError::new(status, line));
    }
    let store = session.store().clone();
    let (prepared, version) = session.read(|d| {
        let p = judge::prepare(&*store, ctx, d, target.as_deref())?;
        Ok((p, d.version().as_str().to_string()))
    })?;
    let reply = proxy_call(
        cfg,
        middleware::REQUEST_KIND,
        prepared.request(&version),
        ctx.scope.agency.as_deref(),
    )
    .await;
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(failure(&reply));
    }
    let data = reply.get("data").cloned().unwrap_or(Value::Null);
    middleware::check_api(&data)?;
    let (tests, answered) = judge::read_reply(&data)?;
    let tally = judge::tally(prepared.piece.kind, &tests)?;
    let trust = judge::trust_for(&answered.judge_version());
    let by = Ctx::new(Actor::process(judge::AGENT)?)
        .with_scope(ctx.scope.clone())
        .with_handler(&answered.handler)
        .with_backend(&answered.backend);
    let done = session.perform(&by, |c, d| {
        judge::score_outcome(c, d, &prepared, &tally, &answered, trust)
    })?;
    let card = session.read(|d| judge::card(&*store, ctx, d, Some(&prepared.piece.key)))?;
    let mut out = card;
    out["scored"] = done.reply;
    out["clan"] = session.document_now().unwrap_or(Value::Null);
    Ok((out, done.events))
}
