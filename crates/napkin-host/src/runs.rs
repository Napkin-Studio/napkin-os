// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! What is running, as far as the host has been told.
//!
//! Brief and Research jobs live in the middleware's memory (`server/napkin/jobs.py`)
//! and the document records nothing about them until a change lands. The one
//! place the host sees them is [`crate::Session::settle_middleware`]: every
//! `napkin.middleware/1` reply carries `job {id, state, stage, progress, ...}`.
//! This tracker keeps the last word the host heard about each job, per document,
//! so the library listing can say "working" or "waiting for you" without a
//! second job store and without a middleware change.
//!
//! What it knows is only what the app's own polling brought back, so it has two
//! honest limits, both on purpose:
//!
//! * A `queued`/`running`/`needs_input` job nobody has polled for
//!   [`STALE_AFTER_SECS`] (the person closed the document) is not reported: the
//!   listing would otherwise say "running" for a job it can no longer see.
//! * A `failed` job is reported for [`FAILED_FOR_SECS`], or until the document's
//!   next job starts, whichever is first.
//!
//! A `done` job is dropped: the document itself shows what it made.
//! It never starts, cancels or polls anything, and restarts empty.
//!
//! Pure and wasm32-clean: no filesystem, no clock of its own (the caller gives
//! `now`; [`RunTracker::record`] and [`RunTracker::run_for`] read the wall clock).

use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;

use crate::listing::RunInfo;
use crate::store::DocId;

/// A job that has not been heard from for this long is not reported as running.
pub const STALE_AFTER_SECS: i64 = 10 * 60;
/// How long an unfinished job is offered for settling after it was last heard.
pub const SETTLE_FOR_SECS: i64 = 24 * 60 * 60;
/// How long a failure stays on the landing.
pub const FAILED_FOR_SECS: i64 = 24 * 60 * 60;
/// Documents the tracker remembers before it sheds the least recently heard.
const MAX_DOCS: usize = 512;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Working,
    Waiting,
    Failed,
}

#[derive(Clone, Debug)]
struct Job {
    phase: Phase,
    stage: Option<String>,
    progress: Option<(u64, u64)>,
    since: Option<String>,
    heard: DateTime<Utc>,
}

/// Per-tenant memory of the jobs the host has seen, by document and job id.
#[derive(Default)]
pub struct RunTracker {
    docs: Mutex<HashMap<DocId, HashMap<String, Job>>>,
}

impl RunTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Note a `napkin.middleware/1` reply for `doc`. A reply with no `job`
    /// (or one that names no id or an unknown state) is ignored.
    pub fn record(&self, doc: &DocId, reply: &Value) {
        self.record_at(doc, reply, Utc::now());
    }

    pub fn record_at(&self, doc: &DocId, reply: &Value, now: DateTime<Utc>) {
        let Some(job) = reply.get("job").filter(|j| j.is_object()) else {
            return;
        };
        let Some(id) = job
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        else {
            return;
        };
        let phase = match job.get("state").and_then(Value::as_str) {
            Some("queued" | "running") => Some(Phase::Working),
            Some("needs_input") => Some(Phase::Waiting),
            Some("failed") => Some(Phase::Failed),
            // Finished: the document shows the result. Drop this job.
            Some("done") => None,
            _ => return,
        };
        let mut docs = self.docs.lock().unwrap_or_else(|e| e.into_inner());
        let Some(phase) = phase else {
            if let Some(jobs) = docs.get_mut(doc) {
                jobs.remove(id);
                if jobs.is_empty() {
                    docs.remove(doc);
                }
            }
            return;
        };
        let entry = docs.entry(doc.clone()).or_default();
        if !entry.contains_key(id) && phase != Phase::Failed {
            // A new job on this document: yesterday's failure is history.
            entry.retain(|_, j| j.phase != Phase::Failed);
        }
        let progress = job
            .get("progress")
            .and_then(|p| Some((p.get("done")?.as_u64()?, p.get("total")?.as_u64()?)));
        let before = entry.get(id);
        entry.insert(
            id.to_string(),
            Job {
                phase,
                stage: job
                    .get("stage")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .or_else(|| before.and_then(|b| b.stage.clone())),
                progress: progress.or_else(|| before.and_then(|b| b.progress)),
                since: job
                    .get("started_at")
                    .and_then(Value::as_str)
                    .map(String::from)
                    .or_else(|| before.and_then(|b| b.since.clone())),
                heard: now,
            },
        );
        // Bounded: shed the document heard from least recently.
        while docs.len() > MAX_DOCS {
            let oldest = docs
                .iter()
                .map(|(d, jobs)| (d.clone(), jobs.values().map(|j| j.heard).max()))
                .min_by_key(|(_, h)| *h)
                .map(|(d, _)| d);
            match oldest {
                Some(d) => docs.remove(&d),
                None => break,
            };
        }
    }

    /// The document's run as of the wall clock, or `None`.
    pub fn run_for(&self, doc: &DocId) -> Option<RunInfo> {
        self.run_at(doc, Utc::now())
    }

    /// What the host believes is happening on `doc` at `now`: waiting on a
    /// person first, then failed, then working. `None` when nothing live is known.
    pub fn run_at(&self, doc: &DocId, now: DateTime<Utc>) -> Option<RunInfo> {
        let docs = self.docs.lock().unwrap_or_else(|e| e.into_inner());
        let jobs = docs.get(doc)?;
        let live = |j: &&Job| {
            let age = now - j.heard;
            match j.phase {
                Phase::Failed => age < Duration::seconds(FAILED_FOR_SECS),
                _ => age < Duration::seconds(STALE_AFTER_SECS),
            }
        };
        // Deterministic when several jobs share a phase: the newest heard.
        let pick = |p: Phase| {
            jobs.values()
                .filter(live)
                .filter(|j| j.phase == p)
                .max_by_key(|j| j.heard)
        };
        let (job, state) = if let Some(j) = pick(Phase::Waiting) {
            (j, "waiting")
        } else if let Some(j) = pick(Phase::Failed) {
            (j, "failed")
        } else if let Some(j) = pick(Phase::Working) {
            (j, "working")
        } else {
            return None;
        };
        let stage = job.stage.clone();
        let label = match state {
            "waiting" => "Waiting for you".to_string(),
            "failed" => stage
                .as_deref()
                .map_or("Failed".into(), |s| format!("Failed: {s}")),
            _ => {
                let mut l = stage
                    .as_deref()
                    .map_or("Working".into(), |s| format!("Working: {s}"));
                if let Some((d, t)) = job.progress.filter(|(_, t)| *t > 0) {
                    l.push_str(&format!(" ({} of {t})", d.min(t)));
                }
                l
            }
        };
        Some(RunInfo {
            state: state.into(),
            label,
            stage,
            since: job.since.clone(),
            progress: job
                .progress
                .filter(|(_, t)| *t > 0)
                .map(|(d, t)| [d.min(t), t]),
        })
    }

    /// The ids of `doc`'s jobs that have not been seen to finish: queued,
    /// running or waiting, heard within [`SETTLE_FOR_SECS`], sorted. Unlike
    /// [`Self::run_at`] a job nobody has polled lately is still here: whoever
    /// polls it next (the shell's watcher) lands its change.
    pub fn unsettled(&self, doc: &DocId) -> Vec<String> {
        self.unsettled_at(doc, Utc::now())
    }

    pub fn unsettled_at(&self, doc: &DocId, now: DateTime<Utc>) -> Vec<String> {
        let docs = self.docs.lock().unwrap_or_else(|e| e.into_inner());
        let mut ids: Vec<String> = docs
            .get(doc)
            .into_iter()
            .flat_map(|jobs| jobs.iter())
            .filter(|(_, j)| {
                j.phase != Phase::Failed && now - j.heard < Duration::seconds(SETTLE_FOR_SECS)
            })
            .map(|(id, _)| id.clone())
            .collect();
        ids.sort();
        ids
    }

    /// Forget one job: the middleware no longer knows it (a restart lost
    /// it), so nobody can land it.
    pub fn forget_job(&self, doc: &DocId, id: &str) {
        let mut docs = self.docs.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(jobs) = docs.get_mut(doc) {
            jobs.remove(id);
            if jobs.is_empty() {
                docs.remove(doc);
            }
        }
    }

    /// Forget a document (it was deleted). Nothing else needs to.
    pub fn forget(&self, doc: &DocId) {
        self.docs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(doc);
    }

    /// How many documents are remembered: what a test reads.
    pub fn len(&self) -> usize {
        self.docs.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc(n: &str) -> DocId {
        DocId::from(std::path::PathBuf::from(n))
    }
    fn t(secs: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(1_800_000_000 + secs, 0).unwrap()
    }
    fn reply(id: &str, state: &str, stage: Option<&str>, progress: Option<(u64, u64)>) -> Value {
        let mut job = json!({"id": id, "state": state, "started_at": "2026-11-04T09:00:00Z"});
        if let Some(s) = stage {
            job["stage"] = json!(s);
        }
        if let Some((d, n)) = progress {
            job["progress"] = json!({"done": d, "total": n});
        }
        json!({"api": "napkin.middleware/1", "job": job, "change": null})
    }

    #[test]
    fn an_unfinished_job_stays_unsettled_after_it_goes_stale_until_it_is_done() {
        let r = RunTracker::new();
        let d = doc("a.clan");
        assert!(r.unsettled_at(&d, t(0)).is_empty());
        r.record_at(&d, &reply("job_2", "running", Some("ask"), None), t(0));
        r.record_at(&d, &reply("job_1", "needs_input", None, None), t(0));
        assert_eq!(r.unsettled_at(&d, t(1)), vec!["job_1", "job_2"]);
        // Nobody polled for longer than STALE_AFTER_SECS: no longer shown as
        // running, but still there to settle.
        let later = t(STALE_AFTER_SECS + 5);
        assert!(r.run_at(&d, later).is_none());
        assert_eq!(r.unsettled_at(&d, later), vec!["job_1", "job_2"]);
        // Done: gone. Failed: not something to land.
        r.record_at(&d, &reply("job_2", "done", None, None), t(2));
        r.record_at(&d, &reply("job_1", "failed", None, None), t(2));
        assert!(r.unsettled_at(&d, t(3)).is_empty());
        // A day later an unheard job is let go.
        r.record_at(&d, &reply("job_3", "running", None, None), t(0));
        assert!(r.unsettled_at(&d, t(SETTLE_FOR_SECS + 1)).is_empty());
        // A job the middleware lost is forgotten.
        r.forget_job(&d, "job_3");
        assert!(r.unsettled_at(&d, t(1)).is_empty());
    }

    #[test]
    fn a_queued_then_running_job_is_working_with_its_stage_and_progress() {
        let r = RunTracker::new();
        let d = doc("a.clan");
        assert!(r.run_at(&d, t(0)).is_none());
        r.record_at(
            &d,
            &reply("job_1", "queued", Some("extract"), Some((0, 6))),
            t(0),
        );
        let run = r.run_at(&d, t(1)).unwrap();
        assert_eq!(
            (run.state.as_str(), run.label.as_str()),
            ("working", "Working: extract (0 of 6)")
        );
        assert_eq!(run.stage.as_deref(), Some("extract"));
        assert_eq!(run.since.as_deref(), Some("2026-11-04T09:00:00Z"));
        r.record_at(
            &d,
            &reply("job_1", "running", Some("research"), Some((3, 6))),
            t(5),
        );
        assert_eq!(
            r.run_at(&d, t(6)).unwrap().label,
            "Working: research (3 of 6)"
        );
        // The steps travel as numbers too: the medallion's arc is done / total.
        assert_eq!(r.run_at(&d, t(6)).unwrap().progress, Some([3, 6]));
    }

    #[test]
    fn done_drops_the_job_and_a_repeated_done_is_harmless() {
        let r = RunTracker::new();
        let d = doc("a.clan");
        r.record_at(&d, &reply("job_1", "running", None, None), t(0));
        r.record_at(&d, &reply("job_1", "done", None, None), t(2));
        assert!(r.run_at(&d, t(3)).is_none());
        assert!(r.is_empty(), "nothing left to remember");
        r.record_at(&d, &reply("job_1", "done", None, None), t(4));
        assert!(r.is_empty());
    }

    #[test]
    fn needs_input_is_waiting_and_beats_failed_and_working() {
        let r = RunTracker::new();
        let d = doc("a.clan");
        r.record_at(&d, &reply("job_w", "running", None, None), t(0));
        r.record_at(&d, &reply("job_f", "failed", Some("select"), None), t(1));
        assert_eq!(r.run_at(&d, t(2)).unwrap().state, "failed");
        r.record_at(
            &d,
            &reply("job_q", "needs_input", Some("select"), None),
            t(3),
        );
        let run = r.run_at(&d, t(4)).unwrap();
        assert_eq!(
            (run.state.as_str(), run.label.as_str()),
            ("waiting", "Waiting for you")
        );
    }

    #[test]
    fn done_of_an_old_job_does_not_clear_a_newer_one() {
        let r = RunTracker::new();
        let d = doc("a.clan");
        r.record_at(&d, &reply("job_old", "running", None, None), t(0));
        r.record_at(&d, &reply("job_new", "running", None, None), t(1));
        r.record_at(&d, &reply("job_old", "done", None, None), t(2));
        assert_eq!(r.run_at(&d, t(3)).unwrap().state, "working");
    }

    #[test]
    fn a_job_nobody_polls_goes_stale_and_failure_outlasts_it() {
        let r = RunTracker::new();
        let d = doc("a.clan");
        r.record_at(&d, &reply("job_1", "running", None, None), t(0));
        assert!(r.run_at(&d, t(STALE_AFTER_SECS - 1)).is_some());
        assert!(
            r.run_at(&d, t(STALE_AFTER_SECS)).is_none(),
            "the document was closed: not 'running'"
        );
        r.record_at(&d, &reply("job_2", "failed", None, None), t(0));
        assert_eq!(
            r.run_at(&d, t(STALE_AFTER_SECS + 1)).unwrap().label,
            "Failed"
        );
        assert!(r.run_at(&d, t(FAILED_FOR_SECS)).is_none());
    }

    #[test]
    fn a_new_job_clears_that_documents_old_failure() {
        let r = RunTracker::new();
        let d = doc("a.clan");
        r.record_at(&d, &reply("job_1", "failed", None, None), t(0));
        r.record_at(&d, &reply("job_2", "queued", None, None), t(1));
        assert_eq!(r.run_at(&d, t(2)).unwrap().state, "working");
        r.record_at(&d, &reply("job_2", "done", None, None), t(3));
        assert!(
            r.run_at(&d, t(4)).is_none(),
            "the failure did not come back"
        );
    }

    #[test]
    fn replies_with_no_job_or_a_strange_one_change_nothing() {
        let r = RunTracker::new();
        let d = doc("a.clan");
        r.record_at(
            &d,
            &json!({"api": "napkin.middleware/1", "change": null}),
            t(0),
        );
        r.record_at(&d, &json!({"job": "nope"}), t(0));
        r.record_at(&d, &json!({"job": {"state": "running"}}), t(0));
        r.record_at(&d, &json!({"job": {"id": "j", "state": "cancelled"}}), t(0));
        assert!(r.is_empty());
    }

    #[test]
    fn a_reply_without_stage_or_progress_keeps_what_was_known() {
        let r = RunTracker::new();
        let d = doc("a.clan");
        r.record_at(
            &d,
            &reply("job_1", "running", Some("research"), Some((2, 8))),
            t(0),
        );
        r.record_at(&d, &reply("job_1", "running", None, None), t(1));
        assert_eq!(
            r.run_at(&d, t(2)).unwrap().label,
            "Working: research (2 of 8)"
        );
    }

    #[test]
    fn documents_are_kept_apart_and_the_memory_is_bounded() {
        let r = RunTracker::new();
        r.record_at(&doc("a.clan"), &reply("j", "running", None, None), t(0));
        assert!(r.run_at(&doc("b.clan"), t(1)).is_none());
        for i in 0..(MAX_DOCS + 20) {
            r.record_at(
                &doc(&format!("d{i}.clan")),
                &reply("j", "running", None, None),
                t(i as i64),
            );
        }
        assert_eq!(r.len(), MAX_DOCS);
        assert!(
            r.run_at(&doc("a.clan"), t(1)).is_none(),
            "the oldest was shed"
        );
        r.forget(&doc(&format!("d{}.clan", MAX_DOCS + 19)));
        assert_eq!(r.len(), MAX_DOCS - 1);
    }
}
