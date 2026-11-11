// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Per-tenant agent quota.
//!
//! The keys are the server's, so the bill is too: a draft is roughly $0.30–0.40.
//! An uncapped demo link is a real invoice, so every call through the inference
//! proxy passes here first. The counter is in-process and resets on restart —
//! deliberately the simplest thing that makes the seam exist; a hosted
//! deployment swaps the body for a durable counter without moving the call site.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use crate::tenant::TenantId;

pub struct Meter {
    cap: u32,
    used: Mutex<HashMap<TenantId, u32>>,
    /// The jobs each tenant has paid for and that have not failed or been
    /// refunded: a failed job gives its charge back once, and only to the
    /// tenant that paid for it.
    paid: Mutex<HashMap<TenantId, HashSet<String>>>,
}

/// More paid-for jobs than this per tenant and the oldest bookkeeping is
/// dropped (a refund is then lost, never invented).
const PAID_JOBS_KEPT: usize = 256;

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct Usage {
    pub used: u32,
    pub cap: u32,
}

impl Meter {
    pub fn new(cap: u32) -> Self {
        Self {
            cap,
            used: Mutex::new(HashMap::new()),
            paid: Mutex::new(HashMap::new()),
        }
    }

    /// Give one charge back. Never below zero.
    pub fn refund(&self, tenant: &TenantId) {
        if let Some(n) = self.used.lock().unwrap().get_mut(tenant) {
            *n = n.saturating_sub(1);
        }
    }

    /// Settle the charge against what an `/api-proxy` reply says happened.
    ///
    /// `charged` is whether this call was charged (a `job_status` poll is not).
    /// The charge comes back, once, when a job this tenant paid for reports
    /// `failed` (the middleware's word for a provider error), in the reply to
    /// the submission or to a later poll.
    ///
    /// A person cancelling a job (`cancel_job`) is not a failure and a
    /// cancelled run keeps its charge, as does a finished one. A reply that
    /// is not a successful middleware answer (no endpoint, a refusal, a body
    /// that is not JSON) changes nothing.
    pub fn settle(&self, tenant: &TenantId, charged: bool, reply: &[u8]) {
        let Ok(reply) = serde_json::from_slice::<serde_json::Value>(reply) else {
            return;
        };
        if reply.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            return; // nothing ran that this meter can say failed: the charge stands
        }
        let Some(job) = reply.get("data").and_then(|d| d.get("job")) else {
            return;
        };
        let Some(id) = job.get("id").and_then(|v| v.as_str()) else {
            return;
        };
        let mut paid = self.paid.lock().unwrap();
        let set = paid.entry(tenant.clone()).or_default();
        if charged {
            if set.len() >= PAID_JOBS_KEPT {
                set.clear();
            }
            set.insert(id.to_string());
        }
        if job.get("state").and_then(|v| v.as_str()) == Some("failed") && set.remove(id) {
            drop(paid);
            self.refund(tenant);
        }
    }

    /// Charge one call, or refuse. Refusal is a 429 the shell can show.
    pub fn try_spend(&self, tenant: &TenantId) -> Result<Usage, Usage> {
        let mut used = self.used.lock().unwrap();
        let n = used.entry(tenant.clone()).or_insert(0);
        if *n >= self.cap {
            return Err(Usage {
                used: *n,
                cap: self.cap,
            });
        }
        *n += 1;
        Ok(Usage {
            used: *n,
            cap: self.cap,
        })
    }

    pub fn usage(&self, tenant: &TenantId) -> Usage {
        Usage {
            used: self.used.lock().unwrap().get(tenant).copied().unwrap_or(0),
            cap: self.cap,
        }
    }
}

/// Whether an `/api-proxy` body is charged to the quota.
///
/// Only work is charged: every call is, except a `request_kind: middleware`
/// call whose `payload.task` is `job_status` — the poll of a job already
/// paid for when it was submitted (owner decision, chat intake) — or
/// `cancel_job`, which stops one and starts nothing. A long job
/// such as `start_campaign` is polled for minutes; charging each poll would
/// spend a session's budget on waiting. `start_campaign`, `answer_question`,
/// `compose_report` and every other task are submissions and are charged.
///
/// The body is peeked the way the host will read it (`serde_json` over the
/// same bytes), and anything short of an unambiguous poll is charged: a body
/// that is not JSON, not an object, names no kind or another kind, or has no
/// `payload.task`. A malformed request is never free.
pub fn charged(body: &[u8]) -> bool {
    let Ok(req) = serde_json::from_slice::<serde_json::Value>(body) else {
        return true;
    };
    let kind = req.get("request_kind").and_then(|v| v.as_str());
    let task = req
        .get("payload")
        .and_then(|p| p.get("task"))
        .and_then(|v| v.as_str());
    !(kind == Some(napkin_host::ops::middleware::REQUEST_KIND)
        && (task == Some(napkin_host::ops::middleware::JOB_STATUS)
            || task == Some(napkin_host::ops::middleware::CANCEL_JOB)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tenant_spends_its_own_budget_only() {
        let meter = Meter::new(2);
        let a = TenantId::mint();
        let b = TenantId::mint();

        assert!(meter.try_spend(&a).is_ok());
        assert!(meter.try_spend(&a).is_ok());
        assert!(meter.try_spend(&a).is_err(), "the cap must bite");
        assert!(meter.try_spend(&b).is_ok(), "another tenant is unaffected");
        assert_eq!(meter.usage(&a).used, 2);
    }

    fn reply(state: &str) -> Vec<u8> {
        format!(r#"{{"ok":true,"status":200,"data":{{"job":{{"id":"job_1","state":"{state}"}}}}}}"#)
            .into_bytes()
    }

    #[test]
    fn a_failed_job_gives_its_charge_back_once() {
        let meter = Meter::new(3);
        let a = TenantId::mint();
        meter.try_spend(&a).unwrap();
        meter.settle(&a, true, &reply("running"));
        assert_eq!(meter.usage(&a).used, 1, "a running job keeps its charge");
        meter.settle(&a, false, &reply("failed"));
        assert_eq!(meter.usage(&a).used, 0, "the failed poll refunds");
        meter.settle(&a, false, &reply("failed"));
        meter.settle(&a, false, &reply("failed"));
        assert_eq!(meter.usage(&a).used, 0, "polling again never refunds twice");
    }

    #[test]
    fn a_failure_in_the_submission_reply_refunds_and_a_retry_is_charged_again() {
        let meter = Meter::new(3);
        let a = TenantId::mint();
        meter.try_spend(&a).unwrap();
        meter.settle(&a, true, &reply("failed"));
        assert_eq!(meter.usage(&a).used, 0);
        meter.try_spend(&a).unwrap();
        meter.settle(&a, true, &reply("done"));
        assert_eq!(meter.usage(&a).used, 1, "the retry that works is paid for");
    }

    #[test]
    fn a_cancelled_or_finished_run_keeps_its_charge() {
        let meter = Meter::new(3);
        let a = TenantId::mint();
        meter.try_spend(&a).unwrap();
        meter.settle(&a, true, &reply("running"));
        // the person cancels: the job is reported as it ended, never `failed`
        meter.settle(&a, false, &reply("done"));
        meter.settle(&a, false, &reply("cancelled"));
        assert_eq!(meter.usage(&a).used, 1);
    }

    #[test]
    fn a_tenant_is_never_refunded_for_a_job_it_did_not_pay_for() {
        let meter = Meter::new(3);
        let (a, b) = (TenantId::mint(), TenantId::mint());
        meter.try_spend(&a).unwrap();
        meter.try_spend(&b).unwrap();
        meter.settle(&a, true, &reply("running"));
        meter.settle(&b, false, &reply("failed"));
        assert_eq!(meter.usage(&b).used, 1, "b polled a job a paid for");
        meter.settle(&a, false, &reply("failed"));
        assert_eq!(meter.usage(&a).used, 0);
    }

    #[test]
    fn a_refund_never_goes_below_zero_and_other_replies_change_nothing() {
        let meter = Meter::new(3);
        let a = TenantId::mint();
        meter.refund(&a);
        assert_eq!(meter.usage(&a).used, 0, "never below zero");
        meter.try_spend(&a).unwrap();
        for body in [
            &br#"{"ok":false,"status":0,"endpoint":"http://m","error":"could not reach http://m"}"#
                [..],
            br#"{"ok":false,"status":0,"endpoint":null,"error":{"type":"no_middleware"}}"#,
            br#"{"ok":false,"status":409,"error":{"type":"job_state"}}"#,
            b"not json",
        ] {
            meter.settle(&a, true, body);
        }
        assert_eq!(meter.usage(&a).used, 1);
        meter.settle(&a, true, &reply("failed"));
        meter.settle(&a, true, &reply("failed"));
        assert_eq!(
            meter.usage(&a).used,
            0,
            "a repeated failure refunds one charge, not two"
        );
    }

    #[test]
    fn only_a_job_status_poll_or_a_cancel_is_free() {
        let free = br#"{"request_kind":"middleware","payload":{"task":"job_status","input":{"job_id":"job_1"}}}"#;
        assert!(!charged(free));
        let cancel = br#"{"request_kind":"middleware","payload":{"task":"cancel_job","input":{"job_id":"job_1"}}}"#;
        assert!(!charged(cancel));
        for body in [
            &br#"{"request_kind":"middleware","payload":{"task":"start_campaign","input":{}}}"#[..],
            br#"{"request_kind":"middleware","payload":{"task":"answer_question","input":{}}}"#,
            br#"{"request_kind":"middleware","payload":{"task":"compose_report","input":{}}}"#,
            br#"{"request_kind":"agent","payload":{"task":"job_status"}}"#,
            br#"{"payload":{"task":"job_status"}}"#,
            br#"{"request_kind":"middleware","payload":{}}"#,
            br#"{"request_kind":"middleware","payload":{"task":["job_status"]}}"#,
            br#"{"request_kind":"middleware","task":"job_status"}"#,
            br#"["job_status"]"#,
            br#"{"request_kind":"middleware","payload":{"task":"job_status"}"#,
            b"",
        ] {
            assert!(charged(body), "{}", String::from_utf8_lossy(body));
        }
    }
}
