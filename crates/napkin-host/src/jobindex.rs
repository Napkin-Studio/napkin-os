// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The job index: what the studio's jobs are doing, read from the decision
//! chains of their documents (v2 sections 4 and 6; features/job-index-dashboard.clan).
//!
//! It is **read-only and disposable**. [`build`] makes it from the job
//! registry (`jobs.rs`) and the documents that name a job in `manifest.job`;
//! nothing writes to it, no tool and no route, and deleting it loses nothing:
//! [`JobIndex::build`] on the same documents gives the same index. A
//! [`IndexCache`] keeps the last one and rebuilds it when any document's
//! version moved, which is how a change shows without anyone telling the index.
//!
//! The **stage** of a job is never stored. It is read from the decisions of
//! the job's Brief documents (the Brief gate: passed, signed, confirmed), so
//! it is always what the chains say. Napkin never scores people: the index
//! holds jobs, stages and what each person is asked to do next. It holds no
//! ranking and no score of anyone, and has no field that could.

use std::collections::BTreeMap;
use std::sync::Mutex;

use chrono::{DateTime, NaiveDate, Utc};
use clan_sdk::{ClanFile, ClientRef};
use serde::Serialize;

use crate::clients;
use crate::document::Document;
use crate::error::HostResult;
use crate::jobs::{self, JobRecord};
use crate::ops::{decisions, gate};
use crate::store::{DocId, DocStore};

/// The eleven steps of a job (v2 section 3), in order: `(id, label)`.
pub const STAGES: [(&str, &str); 11] = [
    ("client-brief", "Client brief"),
    ("brief-check", "Brief check"),
    ("scope-estimate", "Scope and estimate"),
    ("ideas", "Ideas"),
    ("production", "Production"),
    ("decks", "Decks and presentation"),
    ("client-approval", "Client approval"),
    ("delivery", "Delivery"),
    ("timesheets", "Timesheets"),
    ("invoice-ready", "Invoice-ready lines"),
    ("case-study", "Case study"),
];

/// Where a job is, as its documents say it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct StageInfo {
    pub id: &'static str,
    /// 1 to 11.
    pub step: usize,
    pub label: &'static str,
}

fn stage(id: &str) -> StageInfo {
    let i = STAGES.iter().position(|(s, _)| *s == id).unwrap_or(0);
    StageInfo {
        id: STAGES[i].0,
        step: i + 1,
        label: STAGES[i].1,
    }
}

/// One document filed under a job.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct JobDoc {
    pub path: String,
    pub title: String,
    pub app_id: Option<String>,
    /// Things a person must check before this document's lock.
    pub needs_you: usize,
    pub locked: bool,
}

/// One job, as the index has it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct JobEntry {
    pub number: String,
    pub title: String,
    pub client: ClientRef,
    pub owner: String,
    pub opened_on: String,
    pub due: Option<String>,
    pub budget_hours: Option<f64>,
    pub stage: StageInfo,
    /// What the stage means right now, in words.
    pub status: String,
    /// Who the job waits on: `client` or `agency`.
    pub waiting_on: &'static str,
    /// Whole days the signed brief has waited for the client, when it does.
    pub days_waiting_on_client: Option<i64>,
    /// The deadline is past and the job is not finished.
    pub at_risk: bool,
    pub documents: Vec<JobDoc>,
}

/// Who a need is for: one named person, or everyone in a role.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Audience {
    Person(String),
    Role(&'static str),
}

/// One thing a person is asked to do next on a job.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Need {
    pub job: String,
    pub client: String,
    pub client_id: String,
    /// One line on what is waiting.
    pub text: String,
    /// The next action, on its button.
    pub action: String,
    /// The document the action opens.
    pub path: String,
    /// The job's deadline: what the list is ordered by.
    pub due: Option<String>,
    pub audience: Audience,
}

/// The index.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct JobIndex {
    /// In the order the jobs were opened.
    pub jobs: Vec<JobEntry>,
    pub needs: Vec<Need>,
}

/// How far a brief has got: the order the stage is read in.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Progress {
    Drafting,
    Passed,
    Signed,
    Confirmed,
}

struct BriefFacts {
    progress: Progress,
    planner_signed: bool,
    changed: bool,
    missing: usize,
    signed_at: Option<String>,
    planner: Option<String>,
    creative_director: Option<String>,
}

fn brief_facts(doc: &Document) -> Option<BriefFacts> {
    let view = decisions::decisions(doc).ok()?;
    if view.problem.is_some() {
        return None;
    }
    let g = gate::view(doc, &view).ok()?;
    let person = |role: &str| {
        g.signers
            .iter()
            .find(|s| s.role == role)
            .map(|s| s.person.clone())
    };
    let progress = if g.confirmed && g.signed && !g.changed_since_lock {
        Progress::Confirmed
    } else if g.signed && !g.changed_since_lock {
        Progress::Signed
    } else if g.passed {
        Progress::Passed
    } else {
        Progress::Drafting
    };
    Some(BriefFacts {
        progress,
        planner_signed: g.planner_signed,
        changed: g.changed_since_lock,
        missing: g.missing,
        signed_at: gate::signed_at(doc),
        planner: person(gate::PLANNER),
        creative_director: person(gate::CREATIVE_DIRECTOR),
    })
}

fn days_between(from: &str, now: DateTime<Utc>) -> Option<i64> {
    let at = DateTime::parse_from_rfc3339(from).ok()?;
    Some((now - at.with_timezone(&Utc)).num_days().max(0))
}

impl JobIndex {
    /// Build the index from the registry and the documents, as of `now`.
    pub fn build(store: &dyn DocStore, now: DateTime<Utc>) -> HostResult<JobIndex> {
        let records = jobs::list(store)?;
        let names: BTreeMap<String, String> = clients::list(store, true)?
            .into_iter()
            .map(|c| (c.id, c.name))
            .collect();
        let mut docs: BTreeMap<String, Vec<(DocId, ClanFile)>> = BTreeMap::new();
        for id in store.documents() {
            let Ok(bytes) = store.read(&id) else { continue };
            let Ok(clan) = ClanFile::from_bytes(bytes) else {
                continue;
            };
            if let Some(n) = clan.manifest().job.clone() {
                docs.entry(n).or_default().push((id, clan));
            }
        }
        let today = now.date_naive();
        let mut entries = Vec::new();
        let mut needs = Vec::new();
        for rec in records {
            let mut mine = docs.remove(&rec.number).unwrap_or_default();
            // Newest path last is not a meaning: order by path so a rebuild is identical.
            mine.sort_by(|a, b| a.0.as_str().cmp(b.0.as_str()));
            let name = names
                .get(&rec.client_id)
                .cloned()
                .unwrap_or_else(|| rec.client_id.clone());
            let (entry, mut n) = entry_of(&rec, &name, mine, now, today);
            entries.push(entry);
            needs.append(&mut n);
        }
        needs.sort_by(|a, b| {
            // by deadline, a job with none last, then by job and text for a stable list
            (a.due.is_none(), &a.due, &a.job, &a.text).cmp(&(
                b.due.is_none(),
                &b.due,
                &b.job,
                &b.text,
            ))
        });
        Ok(JobIndex {
            jobs: entries,
            needs,
        })
    }

    /// What `person` (with `roles`) is asked to do, by deadline. A person with
    /// no name and no role is unrestricted and sees everything, as before roles
    /// existed; an admin or a demo sees everything too.
    pub fn needs_for(&self, person: Option<&str>, roles: &[String]) -> Vec<Need> {
        let everyone = (person.is_none() && roles.is_empty())
            || roles.iter().any(|r| r == "admin" || r == "demo");
        self.needs
            .iter()
            .filter(|n| {
                everyone
                    || match &n.audience {
                        Audience::Person(p) => person == Some(p.as_str()),
                        Audience::Role(r) => roles.iter().any(|x| x == r),
                    }
            })
            .cloned()
            .collect()
    }

    pub fn job(&self, number: &str) -> Option<&JobEntry> {
        self.jobs.iter().find(|j| j.number == number)
    }
}

fn entry_of(
    rec: &JobRecord,
    client_name: &str,
    docs: Vec<(DocId, ClanFile)>,
    now: DateTime<Utc>,
    today: NaiveDate,
) -> (JobEntry, Vec<Need>) {
    let client = ClientRef {
        id: rec.client_id.clone(),
        name: client_name.to_string(),
    };
    let mut listed = Vec::new();
    let mut needs = Vec::new();
    // The furthest brief of the job sets its stage.
    let mut best: Option<(Progress, BriefFacts, String, String)> = None;
    for (id, clan) in docs {
        let Ok(doc) = Document::from_bytes(id.clone(), clan.raw_bytes().to_vec()) else {
            continue;
        };
        let state = crate::library::recent_state(id.clone(), clan.raw_bytes().to_vec());
        let m = clan.manifest();
        listed.push(JobDoc {
            path: id.to_string(),
            title: m.title.clone(),
            app_id: m.app.as_ref().map(|a| a.app_id.clone()),
            needs_you: state.as_ref().map_or(0, |s| s.needs_you),
            locked: state.as_ref().is_some_and(|s| s.locked),
        });
        if gate::applies(&doc) {
            if let Some(f) = brief_facts(&doc) {
                if best.as_ref().is_none_or(|(p, ..)| f.progress > *p) {
                    best = Some((f.progress, f, id.to_string(), m.title.clone()));
                }
            }
        }
    }

    let (stage_id, status, waiting_on, days) = match &best {
        None => ("client-brief", "No brief yet.".to_string(), "agency", None),
        Some((p, f, path, title)) => {
            let mut push = |audience: Audience, text: String, action: &str| {
                needs.push(Need {
                    job: rec.number.clone(),
                    client: client_name.to_string(),
                    client_id: rec.client_id.clone(),
                    text,
                    action: action.to_string(),
                    path: path.clone(),
                    due: rec.due.clone(),
                    audience,
                });
            };
            let person = |p: &Option<String>, role: &'static str| match p {
                Some(p) => Audience::Person(p.clone()),
                None => Audience::Role(role),
            };
            match p {
                Progress::Drafting => {
                    let n = f.missing;
                    push(
                        person(&f.planner, "planning"),
                        format!(
                            "{title}: {n} gate {} to answer.",
                            if n == 1 { "item" } else { "items" }
                        ),
                        "Check the brief",
                    );
                    (
                        "client-brief",
                        format!(
                            "{n} gate {} missing.",
                            if n == 1 { "item" } else { "items" }
                        ),
                        "agency",
                        None,
                    )
                }
                Progress::Passed => {
                    if f.changed {
                        let text = format!("{title}: changed after it was signed.");
                        push(
                            person(&f.planner, "planning"),
                            text.clone(),
                            "Sign the changed brief",
                        );
                        push(
                            person(&f.creative_director, "creative-director"),
                            text,
                            "Sign the changed brief",
                        );
                        (
                            "brief-check",
                            "Changed after signing. The new version needs signing.".into(),
                            "agency",
                            None,
                        )
                    } else if f.planner_signed {
                        push(
                            person(&f.creative_director, "creative-director"),
                            format!("{title}: the planner has signed. It needs your signature."),
                            "Sign and lock",
                        );
                        (
                            "brief-check",
                            "Passed the gate. The planner has signed.".into(),
                            "agency",
                            None,
                        )
                    } else {
                        push(
                            person(&f.planner, "planning"),
                            format!("{title}: passed the gate. It needs your signature."),
                            "Sign the brief",
                        );
                        (
                            "brief-check",
                            "Passed the gate. Waiting for signatures.".into(),
                            "agency",
                            None,
                        )
                    }
                }
                Progress::Signed => {
                    push(
                        Audience::Role("account-service"),
                        format!("{title}: signed. The client has not confirmed it."),
                        "Open the brief",
                    );
                    (
                        "brief-check",
                        "Signed. Waiting for the client to confirm.".into(),
                        "client",
                        f.signed_at.as_deref().and_then(|t| days_between(t, now)),
                    )
                }
                Progress::Confirmed => (
                    "scope-estimate",
                    "Brief confirmed by the client.".into(),
                    "agency",
                    None,
                ),
            }
        }
    };

    let at_risk = rec
        .due
        .as_deref()
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        .is_some_and(|d| d < today);
    (
        JobEntry {
            number: rec.number.clone(),
            title: rec.title.clone(),
            client,
            owner: rec.owner.clone(),
            opened_on: rec.opened_on.clone(),
            due: rec.due.clone(),
            budget_hours: rec.budget_hours,
            stage: stage(stage_id),
            status,
            waiting_on,
            days_waiting_on_client: days,
            at_risk,
            documents: listed,
        },
        needs,
    )
}

// ── the dashboard ───────────────────────────────────────────────────────────

/// A job named on a tile, with its line.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct JobLine {
    pub number: String,
    pub client: String,
    pub client_id: String,
    pub line: String,
}

/// One group on the stage tile.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct StageCount {
    pub id: &'static str,
    pub label: &'static str,
    pub count: usize,
    /// The jobs at this stage, each with what the stage means for it now.
    pub jobs: Vec<JobLine>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Hours {
    pub budget: f64,
    /// Confirmed hours: none until timesheets confirm them (a later record).
    pub confirmed: Option<f64>,
    pub jobs: Vec<JobLine>,
}

/// The six tiles. Judge scores and results hold no numbers in Phase 1.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Dashboard {
    pub live_jobs: usize,
    pub by_stage: Vec<StageCount>,
    pub at_risk: Vec<JobLine>,
    pub hours: Hours,
    pub waiting_on_client: Vec<JobLine>,
    pub scores: Option<()>,
    pub results: Option<()>,
}

impl JobIndex {
    pub fn dashboard(&self) -> Dashboard {
        let line = |j: &JobEntry, line: String| JobLine {
            number: j.number.clone(),
            client: j.client.name.clone(),
            client_id: j.client.id.clone(),
            line,
        };
        let mut by_stage: Vec<StageCount> = Vec::new();
        for j in &self.jobs {
            let l = line(j, j.status.clone());
            match by_stage.iter_mut().find(|s| s.id == j.stage.id) {
                Some(s) => {
                    s.count += 1;
                    s.jobs.push(l);
                }
                None => by_stage.push(StageCount {
                    id: j.stage.id,
                    label: j.stage.label,
                    count: 1,
                    jobs: vec![l],
                }),
            }
        }
        by_stage.sort_by_key(|s| STAGES.iter().position(|(i, _)| *i == s.id));
        Dashboard {
            live_jobs: self.jobs.len(),
            by_stage,
            at_risk: self
                .jobs
                .iter()
                .filter(|j| j.at_risk)
                .map(|j| line(j, format!("Due {}.", j.due.clone().unwrap_or_default())))
                .collect(),
            hours: Hours {
                budget: self.jobs.iter().filter_map(|j| j.budget_hours).sum(),
                confirmed: None,
                jobs: self
                    .jobs
                    .iter()
                    .filter_map(|j| {
                        j.budget_hours
                            .map(|h| line(j, format!("Budget {h} hours.")))
                    })
                    .collect(),
            },
            waiting_on_client: self
                .jobs
                .iter()
                .filter_map(|j| j.days_waiting_on_client.map(|d| line(j, format!("{d}"))))
                .collect(),
            scores: None,
            results: None,
        }
    }
}

// ── keeping it ──────────────────────────────────────────────────────────────

/// The last index, and what it was built from. One beside each tenant's store.
#[derive(Default)]
pub struct IndexCache {
    last: Mutex<Option<(Vec<(String, String)>, JobIndex)>>,
    builds: std::sync::atomic::AtomicUsize,
}

impl IndexCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// The current index: the last one when no document has moved, else a
    /// rebuild. The stamp is every document's id and version plus the
    /// registry's, so any applied change, to any document, makes a new index.
    /// The date is part of the answer (at risk, days waiting), so a new day does too.
    pub fn get(&self, store: &dyn DocStore, now: DateTime<Utc>) -> HostResult<JobIndex> {
        let mut stamp: Vec<(String, String)> = store
            .documents()
            .into_iter()
            .filter_map(|id| {
                store
                    .version(&id)
                    .ok()
                    .map(|v| (id.to_string(), v.as_str().to_string()))
            })
            .collect();
        if let Ok(reg) = store.home("jobs-v1") {
            if let Ok(v) = store.version(&reg) {
                stamp.push(("jobs-v1".into(), v.as_str().to_string()));
            }
        }
        if let Ok(reg) = store.home("clients-v1") {
            if let Ok(v) = store.version(&reg) {
                stamp.push(("clients-v1".into(), v.as_str().to_string()));
            }
        }
        stamp.push(("day".into(), now.date_naive().to_string()));
        stamp.sort();
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((s, index)) = last.as_ref() {
            if *s == stamp {
                return Ok(index.clone());
            }
        }
        let index = JobIndex::build(store, now)?;
        self.builds
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        *last = Some((stamp, index.clone()));
        Ok(index)
    }

    /// Delete the index: the next [`get`](Self::get) rebuilds it from the documents.
    pub fn delete(&self) {
        *self.last.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// How many times it has been built. (No clock here: this crate builds for the
    /// browser, where `Instant` panics; the web server times a build around [`get`](Self::get).)
    pub fn builds(&self) -> usize {
        self.builds.load(std::sync::atomic::Ordering::Relaxed)
    }
}
