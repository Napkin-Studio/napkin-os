// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The one network primitive the sandbox may reach: a host-authenticated POST
//! to whatever endpoint a logical `request_kind` resolves to.

use serde_json::Value;

use crate::config::{configured, resolve_proxy, HostConfig};
use crate::ctx::Ctx;
use crate::error::{HostError, HostResult};
use crate::event::HostEvent;
use crate::ops::{judge, middleware};
use crate::session::Session;

/// POST `payload` verbatim to the endpoint resolved for `request_kind`, add
/// host-side auth, return a structured envelope. RAG, model choice, prompt
/// assembly — all backend concerns behind the endpoint.
///
/// `agency` is the signed-in person's agency; a middleware request carries it
/// in the `x-napkin-agency` header, and the middleware takes its scope from
/// it, never from the body (ADR-004, M3).
pub async fn proxy_call(
    cfg: &dyn HostConfig,
    request_kind: &str,
    payload: Value,
    agency: Option<&str>,
) -> Value {
    // The middleware never falls back to the agent URL: that endpoint does not
    // speak napkin.middleware/1, and sending it the request (and the document)
    // to refuse its answer afterwards is the fall-through M4 forbids. The app
    // is told plainly that none is configured.
    if let Some(refused) = unconfigured(cfg, request_kind) {
        return refused;
    }
    let (url, auth_kind, key) = resolve_proxy(cfg, request_kind);
    if url.trim().is_empty() {
        return serde_json::json!({ "ok": false, "status": 0, "error": format!("no endpoint configured for kind '{request_kind}'") });
    }
    let client = reqwest::Client::new();
    let mut rb = client.post(&url).json(&payload);
    if let Some(a) = agency.filter(|_| request_kind == middleware::REQUEST_KIND) {
        rb = rb.header(middleware::AGENCY_HEADER, a);
    }
    if let Some(k) = &key {
        rb = match auth_kind.as_deref() {
            Some("bearer") => rb.bearer_auth(k),
            _ => rb.header("x-api-key", k),
        };
    }
    match rb.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            reply_envelope(request_kind, &url, status, body)
        }
        Err(e) => serde_json::json!({
            "ok": false, "status": 0, "endpoint": url,
            "error": format!("could not reach {url}: {e}"),
        }),
    }
}

/// The envelope for a request this host will not send: a middleware request
/// with no middleware configured.
pub fn unconfigured(cfg: &dyn HostConfig, request_kind: &str) -> Option<Value> {
    (request_kind == middleware::REQUEST_KIND && !configured(cfg, request_kind))
        .then(middleware::no_middleware)
}

/// The envelope the app gets for an upstream answer with `status` and `body`.
///
/// Upstream error bodies are not surfaced verbatim to the sandbox: on a
/// non-2xx the app sees the status and `upstream returned <status>`. The one
/// exception is `request_kind: "middleware"`, whose error bodies are part of
/// `napkin.middleware/1` (§4) and carry no request content: its
/// `{error: {type, message}}` is passed through as the envelope's `error`,
/// those two strings and nothing else, so the app can tell `invalid_input`
/// from `unknown_job`. A middleware error body that is not that shape falls
/// back to the generic message.
pub fn reply_envelope(request_kind: &str, url: &str, status: u16, body: String) -> Value {
    let ok = (200..300).contains(&status);
    let data: Value = serde_json::from_str(&body).unwrap_or(Value::String(body));
    let error = if ok {
        Value::Null
    } else {
        (request_kind == middleware::REQUEST_KIND)
            .then(|| middleware_error(&data))
            .flatten()
            .unwrap_or_else(|| Value::String(format!("upstream returned {status}")))
    };
    serde_json::json!({
        "ok": ok,
        "status": status,
        "endpoint": url,
        "data": if ok { data } else { Value::Null },
        "error": error,
    })
}

/// `{type, message}` out of a middleware error body, when it is one, and its `usage` when a run was charged before
/// it failed (features/align-confidential-prices.clan): only the two figures and the route, so the host can record
/// what the run cost. Nothing else of the body is kept.
fn middleware_error(body: &Value) -> Option<Value> {
    let e = body.get("error")?;
    let kind = e.get("type")?.as_str()?;
    let message = e.get("message").and_then(Value::as_str).unwrap_or("");
    let mut out = serde_json::json!({ "type": kind, "message": message });
    if let Some(u) = e.get("usage") {
        let n = |k: &str| u.get(k).and_then(Value::as_f64);
        if let (Some(estimate), Some(charged)) = (n("estimate_eur"), n("charged_eur")) {
            out["usage"] = serde_json::json!({
                "estimate_eur": estimate,
                "charged_eur": charged,
                "route": u.get("route").and_then(Value::as_str),
            });
        }
    }
    Some(out)
}

/// `POST /api-proxy {request_kind, payload}` — the single, uniform network
/// route. Keys stay host-side; `payload` is forwarded verbatim, enriched with
/// the open artifact's intelligence layer so lineage, decisions, schema and
/// context travel to the agent — not just what the iframe sent.
///
/// `request_kind: "middleware"` is the one kind whose reply the host acts on:
/// see [`Session::settle_middleware`]. Every other kind comes back to the app
/// exactly as the endpoint answered, with no events.
pub async fn api_proxy(
    ctx: &Ctx,
    session: &Session,
    cfg: &dyn HostConfig,
    body: &str,
) -> HostResult<(Value, Vec<HostEvent>)> {
    let req: Value = serde_json::from_str(body)
        .map_err(|e| HostError::bad_request(format!("invalid JSON: {e}")))?;
    let kind = req
        .get("request_kind")
        .and_then(|v| v.as_str())
        .unwrap_or("agent")
        .to_string();
    let mut payload = req.get("payload").cloned().unwrap_or(Value::Null);
    // Humans first (features/idea-room.clan): an Idea room model task is not proxied until the team's cards
    // (or the creative director) have opened the room. Checked here, where the call is made, never in the page.
    if kind == middleware::REQUEST_KIND {
        if let Some(task) = payload.get("task").and_then(Value::as_str) {
            if crate::ops::ideas::MODEL_TASKS.contains(&task) {
                // The team goes first, whatever else is switched on or off.
                session.read(crate::ops::ideas::allow_model_task)?;
                if !crate::ops::ideas::ai_switch_on() {
                    return Err(HostError::new(
                        403,
                        "ai_off: the Idea room's AI methods are switched off",
                    ));
                }
            }
        }
    }
    // Splice each attachment's cached extracted text (the `.extracted/` sidecar)
    // into the payload so the agent reads document contents, not just filenames.
    session.attach_extracted_text(&mut payload);
    let clan_ctx = session.clan_context_for_agent();
    let outgoing =
        serde_json::json!({ "request_kind": kind, "payload": payload, "clan": clan_ctx });
    let reply = proxy_call(cfg, &kind, outgoing, ctx.scope.agency.as_deref()).await;
    if kind == middleware::REQUEST_KIND {
        // What the call cost is read before the frame is answered, and the frame never gets it (review of 15 Nov,
        // item 1): the frame gets the answer, not the price.
        let task = reply
            .pointer("/data/task")
            .and_then(Value::as_str)
            .or_else(|| payload.get("task").and_then(Value::as_str))
            .unwrap_or("")
            .to_string();
        let cost = crate::judge_run::cost_of(&reply, &task);
        let (mut out, mut events) = session.settle_middleware(ctx, reply);
        if let Some(cost) = cost {
            events.extend(record_cost(ctx, session, &cost));
        }
        without_price(&mut out);
        return Ok((out, events));
    }
    Ok((reply, Vec::new()))
}

/// Record a middleware call's cost where the money was spent (features/align-confidential-prices.clan; review of
/// 15 Nov, item 1): one `run_cost` decision on the open document, written by the host as the task's agent
/// ([`judge::RunCost::agent`]), whoever sent the call and whatever the body said. A job whose cost is already in the
/// chain (a poll that answers it again) is not recorded twice; with no document open there is nowhere to record it,
/// and the middleware's own run log stays the record. A write that fails does not fail the answer.
fn record_cost(ctx: &Ctx, session: &Session, cost: &judge::RunCost) -> Vec<HostEvent> {
    if let Some(job) = &cost.job {
        if session
            .read(|d| Ok(judge::cost_recorded(d, job)))
            .unwrap_or(true)
        {
            return Vec::new();
        }
    }
    let Ok(actor) = crate::ctx::Actor::process(cost.agent()) else {
        return Vec::new();
    };
    let by = Ctx::new(actor).with_scope(ctx.scope.clone());
    session
        .perform(&by, |c, d| judge::run_cost_outcome(c, d, cost))
        .map(|done| done.events)
        .unwrap_or_default()
}

/// Take every figure of money out of what goes back to a frame: the envelope's and the error's `usage`, and a
/// result's `price_eur` (Judge's, and its quote's). The figure is the job's, read in the Decisions drawer.
pub fn without_price(envelope: &mut Value) {
    for p in ["/data", "/error"] {
        if let Some(o) = envelope.pointer_mut(p).and_then(Value::as_object_mut) {
            o.remove("usage");
        }
    }
    for p in ["/data/result", "/data/result/quote"] {
        if let Some(o) = envelope.pointer_mut(p).and_then(Value::as_object_mut) {
            o.remove("price_eur");
        }
    }
}

/// Home-screen prompt → the unified proxy with `request_kind = "agent"`.
pub async fn agent_prompt(cfg: &dyn HostConfig, text: &str) -> Value {
    proxy_call(cfg, "agent", serde_json::json!({ "input": text }), None).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::NoConfig;

    #[test]
    fn a_middleware_request_never_falls_back_to_the_agent_url() {
        assert!(unconfigured(&NoConfig, "agent").is_none());
        let env = unconfigured(&NoConfig, "middleware").unwrap();
        assert_eq!(env["ok"], false);
        assert_eq!(env["error"]["type"], middleware::NO_MIDDLEWARE);
        assert_eq!(env["endpoint"], Value::Null, "nothing was sent anywhere");
    }

    #[test]
    fn a_middleware_error_body_reaches_the_app() {
        let body = r#"{"error":{"type":"unknown_job","message":"no such job","detail":"x"}}"#;
        let env = reply_envelope("middleware", "http://m/v1/tasks", 404, body.into());
        assert_eq!(env["ok"], false);
        assert_eq!(env["status"], 404);
        assert_eq!(
            env["error"],
            serde_json::json!({ "type": "unknown_job", "message": "no such job" }),
            "type and message only"
        );
        assert_eq!(env["data"], Value::Null);
    }

    #[test]
    fn other_kinds_and_other_bodies_stay_hidden() {
        let body = r#"{"error":{"type":"invalid_input","message":"secret prompt text"}}"#;
        let env = reply_envelope("agent", "http://a", 400, body.into());
        assert_eq!(env["error"], "upstream returned 400");
        assert_eq!(env["data"], Value::Null);

        let env = reply_envelope("middleware", "http://m", 502, "<html>bad gateway".into());
        assert_eq!(env["error"], "upstream returned 502");

        let ok = reply_envelope("middleware", "http://m", 200, r#"{"api":"x"}"#.into());
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["error"], Value::Null);
        assert_eq!(ok["data"]["api"], "x");
    }
}
