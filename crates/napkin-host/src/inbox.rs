// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The landing inbox: where a finished job's outcome waits for the tool that
//! owns the document (features/production-jobs-via-host.clan).
//!
//! A Production job runs in the relay (durable, capped, paid). When it finishes
//! while no tab has the document open, the host's library watcher settles it:
//! it reads the job once and keeps its outcome here, keyed by job id, beside the
//! document and never inside it. The tool lands every entry it has not seen when
//! the document is opened (and on the host's event while it is open) through its
//! own idempotent landing, then acknowledges it. The host never writes the
//! document body for a landing, so it cannot race the tool's whole-document save.
//!
//! Once only, in three places: [`InboxStore::put_if_absent`] stores an outcome
//! at most once per job, [`InboxStore::ack`] leaves a marker that keeps it from
//! being stored again, and the tool's landing is idempotent by job id.
//!
//! Pure and wasm32-clean: the bytes are kept by whoever implements
//! [`InboxStore`] (napkin-web: files under the tenant's directory); [`MemInbox`]
//! is the in-memory one.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::HostResult;
use crate::runs::RunTracker;
use crate::store::DocId;

/// One finished job, as the relay told it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub job: String,
    /// The relay's state: `completed`, `failed` or `cancelled`.
    pub state: String,
    /// The relay's job object, untouched: the tool lands it as if it had polled it.
    pub outcome: Value,
    /// When the host stored it (RFC 3339).
    pub at: String,
}

/// What [`InboxStore::put_if_absent`] did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Put {
    Stored,
    /// Stored before, or acknowledged since: nothing was written.
    AlreadyApplied,
}

/// Where entries are kept, per document.
pub trait InboxStore: Send + Sync {
    /// Keep `entry` unless this job has an entry (pending or acknowledged).
    /// Atomic: two callers racing give one `Stored`.
    fn put_if_absent(&self, doc: &DocId, entry: &Entry) -> HostResult<Put>;
    /// The entries not yet acknowledged, oldest first.
    fn pending(&self, doc: &DocId) -> HostResult<Vec<Entry>>;
    /// The tool has landed `job` (or landed it directly while a tab was open):
    /// drop its outcome and keep a marker so it is never stored again. Safe to
    /// call twice, and for a job that has no entry.
    fn ack(&self, doc: &DocId, job: &str) -> HostResult<()>;
}

/// A job id as the relay makes them and a file name can hold.
pub fn valid_job_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The relay's job states that end a job and have something to land.
pub fn lands(state: &str) -> bool {
    matches!(state, "completed" | "failed" | "cancelled")
}

/// The run tracker's word for a relay state, `None` for one it does not know.
/// A finished job is `done` (the document shows what it made); `uncertain` is
/// a failure nobody can settle.
pub fn run_state(relay_state: &str) -> Option<&'static str> {
    match relay_state {
        "queued" | "submitting" | "submitted" | "fetching" | "validating" => Some("running"),
        "needs_input" => Some("needs_input"),
        "completed" | "cancelled" => Some("done"),
        "failed" | "uncertain" => Some("failed"),
        _ => None,
    }
}

/// A `napkin.middleware/1`-shaped reply for the run tracker, from a relay job
/// object. `None` when the object names no job or an unknown state.
pub fn run_reply(job: &Value) -> Option<Value> {
    let id = job.get("jobId").and_then(Value::as_str)?;
    let state = run_state(job.get("state").and_then(Value::as_str)?)?;
    let mut j = json!({"id": id, "state": state});
    if let Some(op) = job.get("op").and_then(Value::as_str) {
        j["stage"] = json!(op);
    }
    if let Some(p) = job.get("progress") {
        if let (Some(step), Some(steps)) = (
            p.get("step").and_then(Value::as_u64),
            p.get("steps").and_then(Value::as_u64),
        ) {
            j["progress"] = json!({"done": step, "total": steps});
        }
    }
    Some(json!({"api": "napkin.middleware/1", "job": j}))
}

/// Tell the tracker what the relay said about a job of `doc`.
pub fn note_run(runs: &RunTracker, doc: &DocId, job: &Value) {
    if let Some(reply) = run_reply(job) {
        runs.record(doc, &reply);
    }
}

/// What settling one job came to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Settled {
    /// Still going: nothing to land yet.
    Running(String),
    /// Finished: its outcome is now in the inbox for the tool.
    Stored(String),
    /// Finished and already in the inbox or landed: nothing was written.
    AlreadyApplied(String),
}

/// Settle one job of `doc` from the relay's current word on it: keep the
/// tracker current and, once the job has finished, put its outcome in the inbox
/// (once). The caller has already read the job from the relay.
pub fn settle(
    inbox: &dyn InboxStore,
    runs: &RunTracker,
    doc: &DocId,
    job: &Value,
    now: &str,
) -> HostResult<Settled> {
    let state = job
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    note_run(runs, doc, job);
    if !lands(&state) {
        return Ok(Settled::Running(state));
    }
    let id = job
        .get("jobId")
        .and_then(Value::as_str)
        .filter(|i| valid_job_id(i))
        .ok_or_else(|| crate::error::HostError::bad_request("the job has no usable id"))?;
    let entry = Entry {
        job: id.to_string(),
        state: state.clone(),
        outcome: job.clone(),
        at: now.to_string(),
    };
    Ok(match inbox.put_if_absent(doc, &entry)? {
        Put::Stored => Settled::Stored(state),
        Put::AlreadyApplied => Settled::AlreadyApplied(state),
    })
}

#[derive(Default)]
struct Slot {
    pending: BTreeMap<String, Entry>,
    acked: std::collections::BTreeSet<String>,
}

/// An inbox in memory (tests, and a host with nowhere to keep files).
#[derive(Default)]
pub struct MemInbox {
    docs: Mutex<HashMap<DocId, Slot>>,
}

impl MemInbox {
    pub fn new() -> Self {
        Self::default()
    }
}

impl InboxStore for MemInbox {
    fn put_if_absent(&self, doc: &DocId, entry: &Entry) -> HostResult<Put> {
        let mut docs = self.docs.lock().unwrap_or_else(|e| e.into_inner());
        let slot = docs.entry(doc.clone()).or_default();
        if slot.acked.contains(&entry.job) || slot.pending.contains_key(&entry.job) {
            return Ok(Put::AlreadyApplied);
        }
        slot.pending.insert(entry.job.clone(), entry.clone());
        Ok(Put::Stored)
    }

    fn pending(&self, doc: &DocId) -> HostResult<Vec<Entry>> {
        let docs = self.docs.lock().unwrap_or_else(|e| e.into_inner());
        let mut v: Vec<Entry> = docs
            .get(doc)
            .map(|s| s.pending.values().cloned().collect())
            .unwrap_or_default();
        v.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.job.cmp(&b.job)));
        Ok(v)
    }

    fn ack(&self, doc: &DocId, job: &str) -> HostResult<()> {
        let mut docs = self.docs.lock().unwrap_or_else(|e| e.into_inner());
        let slot = docs.entry(doc.clone()).or_default();
        slot.pending.remove(job);
        slot.acked.insert(job.to_string());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn doc(n: &str) -> DocId {
        DocId::new(n)
    }
    fn job(id: &str, state: &str) -> Value {
        json!({"jobId": id, "state": state, "op": "clip", "outputs": [{"sha256": "sha256:aa"}]})
    }
    const NOW: &str = "2026-11-23T10:00:00Z";

    #[test]
    fn a_running_job_is_tracked_and_not_stored() {
        let (inbox, runs) = (MemInbox::new(), RunTracker::new());
        let d = doc("d1");
        let s = settle(&inbox, &runs, &d, &job("job_1", "running_x"), NOW).unwrap();
        assert_eq!(s, Settled::Running("running_x".into()));
        let s = settle(&inbox, &runs, &d, &job("job_1", "submitted"), NOW).unwrap();
        assert_eq!(s, Settled::Running("submitted".into()));
        assert_eq!(runs.unsettled(&d), vec!["job_1"]);
        assert!(inbox.pending(&d).unwrap().is_empty());
    }

    #[test]
    fn a_finished_job_is_stored_once_and_leaves_the_tracker() {
        let (inbox, runs) = (MemInbox::new(), RunTracker::new());
        let d = doc("d1");
        settle(&inbox, &runs, &d, &job("job_1", "submitted"), NOW).unwrap();
        let s = settle(&inbox, &runs, &d, &job("job_1", "completed"), NOW).unwrap();
        assert_eq!(s, Settled::Stored("completed".into()));
        assert!(runs.unsettled(&d).is_empty());
        // settling again says so and writes nothing
        let s = settle(&inbox, &runs, &d, &job("job_1", "completed"), "later").unwrap();
        assert_eq!(s, Settled::AlreadyApplied("completed".into()));
        let p = inbox.pending(&d).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].at, NOW, "the first outcome is the one kept");
        assert_eq!(p[0].outcome["outputs"][0]["sha256"], "sha256:aa");
    }

    #[test]
    fn an_acknowledged_job_is_never_stored_again() {
        let (inbox, runs) = (MemInbox::new(), RunTracker::new());
        let d = doc("d1");
        settle(&inbox, &runs, &d, &job("job_1", "completed"), NOW).unwrap();
        inbox.ack(&d, "job_1").unwrap();
        inbox.ack(&d, "job_1").unwrap();
        assert!(inbox.pending(&d).unwrap().is_empty());
        let s = settle(&inbox, &runs, &d, &job("job_1", "completed"), NOW).unwrap();
        assert_eq!(s, Settled::AlreadyApplied("completed".into()));
        assert!(inbox.pending(&d).unwrap().is_empty());
    }

    #[test]
    fn a_job_landed_by_an_open_tab_is_acked_before_any_entry_and_stays_landed() {
        let (inbox, runs) = (MemInbox::new(), RunTracker::new());
        let d = doc("d1");
        inbox.ack(&d, "job_9").unwrap();
        let s = settle(&inbox, &runs, &d, &job("job_9", "completed"), NOW).unwrap();
        assert_eq!(s, Settled::AlreadyApplied("completed".into()));
        assert!(inbox.pending(&d).unwrap().is_empty());
    }

    #[test]
    fn two_settlers_racing_give_one_entry() {
        let inbox = Arc::new(MemInbox::new());
        let d = doc("d1");
        let stored: usize = (0..16)
            .map(|i| {
                let (inbox, d) = (inbox.clone(), d.clone());
                std::thread::spawn(move || {
                    let runs = RunTracker::new();
                    settle(
                        &*inbox,
                        &runs,
                        &d,
                        &job("job_1", "completed"),
                        &format!("t{i}"),
                    )
                    .unwrap()
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap())
            .filter(|s| matches!(s, Settled::Stored(_)))
            .count();
        assert_eq!(stored, 1);
        assert_eq!(inbox.pending(&d).unwrap().len(), 1);
    }

    #[test]
    fn documents_are_kept_apart_and_failed_or_cancelled_land_too() {
        let (inbox, runs) = (MemInbox::new(), RunTracker::new());
        settle(&inbox, &runs, &doc("a"), &job("job_1", "failed"), NOW).unwrap();
        settle(&inbox, &runs, &doc("a"), &job("job_2", "cancelled"), NOW).unwrap();
        assert_eq!(inbox.pending(&doc("a")).unwrap().len(), 2);
        assert!(inbox.pending(&doc("b")).unwrap().is_empty());
        let s = settle(&inbox, &runs, &doc("b"), &job("job_1", "failed"), NOW).unwrap();
        assert_eq!(s, Settled::Stored("failed".into()));
    }

    #[test]
    fn what_the_relay_says_maps_to_the_trackers_words() {
        for (relay, run) in [
            ("queued", "running"),
            ("fetching", "running"),
            ("needs_input", "needs_input"),
            ("completed", "done"),
            ("cancelled", "done"),
            ("failed", "failed"),
            ("uncertain", "failed"),
        ] {
            assert_eq!(run_state(relay), Some(run), "{relay}");
        }
        assert_eq!(run_state("nonsense"), None);
        assert!(run_reply(&json!({"state": "queued"})).is_none());
        assert!(!valid_job_id("../x") && !valid_job_id("") && valid_job_id("job_a-1"));
        let r = run_reply(&json!({"jobId": "j", "state": "queued", "op": "clip", "progress": {"step": 1, "steps": 3}})).unwrap();
        assert_eq!(r["job"]["progress"]["total"], 3);
    }
}
