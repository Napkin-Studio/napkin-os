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
//! stamp moved (`PartStore::stamp`), which is how a change shows without anyone telling the index.
//!
//! The **stage** of a job is never stored. It is read from the decisions of
//! the job's Brief documents (the Brief gate: passed, signed, confirmed), so
//! it is always what the chains say. Napkin never scores people: the index
//! holds jobs, stages and what each person is asked to do next. It holds no
//! ranking and no score of anyone, and has no field that could.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use chrono::{DateTime, NaiveDate, Utc};
use clan_sdk::{ClanFile, ClientRef};
use serde::Serialize;

use crate::alerts;
use crate::clients;
use crate::document::Document;
use crate::error::HostResult;
use crate::jobs::{self, JobRecord, RouteSet, RouteStep};
use crate::ops::{decisions, gate, review};
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

/// Which stage each tool's approvals belong to: `(app id, stage an agency
/// approval counts for, stage a client approval counts for)`. One table; a new
/// tool adds one line. A tool not listed here has no approval step.
pub const APP_STAGES: [(&str, &str, &str); 3] = [
    ("ie.napkin.brief-maker", "brief-check", "brief-check"),
    ("ie.napkin.visual-brief", "ideas", "client-approval"),
    ("ie.napkin.deck-maker", "decks", "client-approval"),
];

/// The stage an approval of `app_id`'s documents counts for, by `party`.
pub fn stage_of_app(app_id: &str, party: &str) -> Option<&'static str> {
    APP_STAGES
        .iter()
        .find(|(a, ..)| *a == app_id)
        .map(|(_, agency, client)| {
            if party == jobs::CLIENT {
                *client
            } else {
                *agency
            }
        })
}

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
    /// A gated brief only: the number of its newest signed version, and whether the draft has moved on
    /// since it was signed (the job page's Changed brief). `None` and `false` for any other document.
    pub version: Option<usize>,
    pub changed_since_lock: bool,
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
    /// The approval route, each step with its state read from the documents'
    /// own decisions. Empty when the job has no route.
    pub route: Vec<RouteStepState>,
    /// Who the job waits on now: the first step not approved.
    pub holder: Option<Holder>,
    /// The people on the job: its owner, the signers of its brief, the approvers of its route, and anyone
    /// who has written a decision in one of its documents (sign-in names, sorted). What the on-the-job
    /// filter of Needs you reads; sent to nobody (`jobview.rs` does not list it).
    pub people: Vec<String>,
}

/// One step of the route, as the documents' decisions have it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RouteStepState {
    pub stage: String,
    pub label: &'static str,
    pub party: String,
    pub role: Option<String>,
    /// The route's approver; the brief's own signer when the brief names one.
    pub approver: String,
    /// A client step's contact email and rounds, as the route has them (so an editor can send them back).
    pub contact: Option<String>,
    pub rounds: Option<u32>,
    pub due: String,
    /// `not_started`, `waiting` or `approved`.
    pub state: &'static str,
    /// Read from the approving decision, never typed in.
    pub approved_by: Option<String>,
    pub approved_at: Option<String>,
    /// The exact version the approval is for.
    pub version: Option<String>,
    /// The document the step looks at (its path).
    pub document: Option<String>,
    /// A waiting step only: since when it has waited, the days, and the days late.
    pub held_since: Option<String>,
    pub days_held: Option<i64>,
    pub days_late: Option<i64>,
}

/// Who a job waits on, and for how long: a fact about one job.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Holder {
    pub party: String,
    pub person: String,
    pub role: Option<String>,
    pub stage: String,
    pub since: String,
    pub days: i64,
    pub due: String,
    /// 0 until the day after the due date.
    pub days_late: i64,
}

/// Who a need is for: one named person, or everyone in a role.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Audience {
    Person(String),
    Role(&'static str),
    /// Everyone on the job (`JobEntry::people`).
    Job,
}

/// One thing a person is asked to do next on a job.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Need {
    /// Stable: `{job}:{stage}:{role}:{kind}`, so a later record can key on it.
    pub id: String,
    /// `gate`, `approval`, `approval-chase`, or a notice: `brief-changed`, `client-change`, `deadline`, `timesheet`.
    pub kind: &'static str,
    /// The stage the need is about.
    pub stage: String,
    /// An approval need: whole days past the step's due date (0 until the day after).
    pub days_late: Option<i64>,
    pub job: String,
    pub client: String,
    pub client_id: String,
    /// One line on what is waiting.
    pub text: String,
    /// The next action, on its button.
    pub action: String,
    /// The document the action opens.
    pub path: String,
    /// The job's deadline: what the list is ordered by. An approval need carries
    /// its step's own due date.
    pub due: Option<String>,
    /// Where `due` came from: `stage` (the approval route's deadline for the stage), `job` (the job's)
    /// or `day` (a day's own reminder).
    pub due_source: &'static str,
    /// Due within 48 hours, or past.
    pub urgent: bool,
    /// A notice the person may mark done; a task leaves when the work is done.
    pub can_done: bool,
    pub audience: Audience,
}

/// The soonest deadline on a person's jobs: what an empty Needs you names.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct NextDeadline {
    pub job: String,
    pub client: String,
    pub client_id: String,
    pub due: String,
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

#[derive(Clone)]
struct BriefFacts {
    progress: Progress,
    planner_signed: bool,
    changed: bool,
    missing: usize,
    signed_at: Option<String>,
    planner: Option<String>,
    creative_director: Option<String>,
    /// The newest edit made after the lock, when the brief changed since it was signed: what a
    /// Brief-changes-version notice is caused by.
    edit_cause: Option<String>,
}

/// A document's decision chain, newest first; empty when it has none or cannot be read.
fn chain_of_doc(doc: &Document) -> clan_sdk::DecisionChain {
    let clan = doc.clan();
    if clan.has_entry("agent/decision-chain.yaml") {
        clan.read_entry("agent/decision-chain.yaml")
            .ok()
            .and_then(|b| clan_sdk::DecisionChain::from_yaml(&b).ok())
            .unwrap_or_default()
    } else {
        clan_sdk::DecisionChain::default()
    }
}

/// The newest edit after the document's lock: its decision id (else its time), `None` when nothing was
/// edited since the lock or there is no lock.
fn edit_cause_of(doc: &Document) -> Option<String> {
    let chain = chain_of_doc(doc);
    let at = review::lock_index(&chain, doc.clan().document_id())?;
    chain.decisions[..at]
        .iter()
        .find(|d| d.superseded_by.is_none() && d.kind.as_deref() == Some("edit"))
        .map(|d| d.id.clone().unwrap_or_else(|| d.timestamp.clone()))
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
        edit_cause: if g.changed_since_lock {
            edit_cause_of(doc)
        } else {
            None
        },
    })
}

fn days_between(from: &str, now: DateTime<Utc>) -> Option<i64> {
    let at = DateTime::parse_from_rfc3339(from).ok()?;
    Some((now - at.with_timezone(&Utc)).num_days().max(0))
}

impl JobIndex {
    /// Build the index from the registry and the documents, as of `now`.
    pub fn build(store: &dyn DocStore, now: DateTime<Utc>) -> HostResult<JobIndex> {
        Self::build_from(store, now, |id| {
            store.read(id).ok().and_then(|b| facts_of(id, b))
        })
    }

    /// [`build`](Self::build), with each document's facts from `facts`: read
    /// afresh by `build`, or kept per stamp by [`IndexCache`]. The answer is
    /// the same either way, because the facts are read from a document's bytes alone.
    fn build_from(
        store: &dyn DocStore,
        now: DateTime<Utc>,
        mut facts: impl FnMut(&DocId) -> Option<DocFacts>,
    ) -> HostResult<JobIndex> {
        let records = jobs::list(store)?;
        let names: BTreeMap<String, String> = clients::list(store, true)?
            .into_iter()
            .map(|c| (c.id, c.name))
            .collect();
        let mut docs: BTreeMap<String, Vec<DocFacts>> = BTreeMap::new();
        for id in store.documents() {
            if let Some(f) = facts(&id) {
                docs.entry(f.job.clone()).or_default().push(f);
            }
        }
        let history = jobs::route_history(store)?;
        let today = now.date_naive();
        let mut entries = Vec::new();
        let mut needs = Vec::new();
        for rec in records {
            let mut mine = docs.remove(&rec.number).unwrap_or_default();
            // Newest path last is not a meaning: order by path so a rebuild is identical.
            mine.sort_by(|a, b| a.listed.path.cmp(&b.listed.path));
            let name = names
                .get(&rec.client_id)
                .cloned()
                .unwrap_or_else(|| rec.client_id.clone());
            let (entry, mut n) = entry_of(&rec, &name, mine, history.get(&rec.number), now, today);
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
    /// existed; an admin or a demo sees everything too. For anyone else it is
    /// the items of the jobs they are on, addressed to them by name or to a role
    /// they hold; see [`needs_visible`](Self::needs_visible) for the one rule
    /// about a role nobody on the job holds. Here no one's roles are known but
    /// the caller's own, so that rule treats every role as unheld.
    pub fn needs_for(&self, person: Option<&str>, roles: &[String]) -> Vec<Need> {
        self.needs_visible(person, roles, &|_| Vec::new())
    }

    /// [`needs_for`](Self::needs_for) with `roles_of`, which gives the roles of
    /// a person on a job (the agency's directory, when it has one). A role's item
    /// on a job reaches a person who holds the role and is on the job; and, when
    /// nobody on the job holds the role (or no one's roles are known), everyone
    /// with the role: the item is never orphaned. An item for the job's people
    /// ([`Audience::Job`]) reaches exactly them.
    pub fn needs_visible(
        &self,
        person: Option<&str>,
        roles: &[String],
        roles_of: &dyn Fn(&str) -> Vec<String>,
    ) -> Vec<Need> {
        let everyone = Self::sees_everything(person, roles);
        self.needs
            .iter()
            .filter(|n| {
                if everyone {
                    return true;
                }
                let on_job = person.is_some_and(|p| self.is_on(&n.job, p));
                match &n.audience {
                    Audience::Person(p) => person == Some(p.as_str()),
                    Audience::Job => {
                        on_job
                            || (self.job(&n.job).is_some_and(|j| j.people.is_empty())
                                && roles.iter().any(|r| r == "account-service"))
                    }
                    Audience::Role(r) => {
                        roles.iter().any(|x| x == r)
                            && (on_job
                                || !self.job(&n.job).is_some_and(|j| {
                                    j.people.iter().any(|p| roles_of(p).iter().any(|x| x == r))
                                }))
                    }
                }
            })
            .cloned()
            .collect()
    }

    fn sees_everything(person: Option<&str>, roles: &[String]) -> bool {
        (person.is_none() && roles.is_empty()) || roles.iter().any(|r| r == "admin" || r == "demo")
    }

    /// Whether `person` is on the job: its owner, a signer of its brief, an approver on its route, or
    /// someone who has written a decision in one of its documents.
    pub fn is_on(&self, job: &str, person: &str) -> bool {
        self.job(job)
            .is_some_and(|j| j.people.iter().any(|p| p == person))
    }

    /// The next deadline on the jobs `person` is on (every job for a person who sees everything): the
    /// soonest job deadline that is today or later, ties by job number.
    pub fn next_deadline(
        &self,
        person: Option<&str>,
        roles: &[String],
        today: NaiveDate,
    ) -> Option<NextDeadline> {
        let everyone = Self::sees_everything(person, roles);
        self.jobs
            .iter()
            .filter(|j| everyone || person.is_some_and(|p| j.people.iter().any(|x| x == p)))
            .filter_map(|j| {
                let due = j.due.as_deref()?;
                (alerts::days_until(due, today)? >= 0).then(|| (due.to_string(), j))
            })
            .min_by(|a, b| (&a.0, &a.1.number).cmp(&(&b.0, &b.1.number)))
            .map(|(due, j)| NextDeadline {
                job: j.number.clone(),
                client: j.client.name.clone(),
                client_id: j.client.id.clone(),
                due,
            })
    }

    pub fn job(&self, number: &str) -> Option<&JobEntry> {
        self.jobs.iter().find(|j| j.number == number)
    }
}

/// What one document gives the index, read from its bytes alone (never from
/// another document, the registry or the clock), so it can be kept per
/// document version and a rebuild re-reads only the documents that moved.
#[derive(Clone)]
struct DocFacts {
    /// `manifest.job`: a document with none is not in the index.
    job: String,
    listed: JobDoc,
    /// A tool with an approval step (`APP_STAGES`): what its chain says. The
    /// client's answer is always read; a job with no client step drops it.
    evidence: Option<Evidence>,
    /// A gated brief: how far it has got.
    brief: Option<BriefFacts>,
    /// The people who have written a decision in this document (sign-in names, sorted): who is on the job.
    writers: Vec<String>,
}

/// The facts of the document `id` holding `bytes`; `None` for a document that
/// names no job or cannot be read, which the index leaves out.
fn facts_of(id: &DocId, bytes: Vec<u8>) -> Option<DocFacts> {
    let clan = ClanFile::from_bytes(bytes).ok()?;
    let job = clan.manifest().job.clone()?;
    let doc = Document::from_bytes(id.clone(), clan.raw_bytes().to_vec()).ok()?;
    let state = crate::library::recent_state(id.clone(), clan.raw_bytes().to_vec());
    let m = clan.manifest();
    let listed = JobDoc {
        path: id.to_string(),
        title: m.title.clone(),
        app_id: m.app.as_ref().map(|a| a.app_id.clone()),
        needs_you: state.as_ref().map_or(0, |s| s.needs_you),
        locked: state.as_ref().is_some_and(|s| s.locked),
        version: state
            .as_ref()
            .is_some_and(|s| s.gate.is_some())
            .then(|| crate::ops::versions::approved_count(&doc))
            .filter(|n| *n > 0),
        changed_since_lock: state
            .as_ref()
            .and_then(|s| s.gate.as_ref())
            .is_some_and(|g| g.changed_since_lock),
    };
    let evidence = m
        .app
        .as_ref()
        .map(|a| a.app_id.as_str())
        .filter(|app| APP_STAGES.iter().any(|(a, ..)| a == app))
        .map(|app| evidence_of(&doc, id, app, true));
    let brief = gate::applies(&doc).then(|| brief_facts(&doc)).flatten();
    let mut writers: Vec<String> = chain_of_doc(&doc)
        .decisions
        .iter()
        .filter(|d| d.actor.as_deref().is_some_and(|a| a.starts_with("human:")))
        .map(person_name)
        .collect();
    writers.sort();
    writers.dedup();
    Some(DocFacts {
        job,
        listed,
        evidence,
        brief,
        writers,
    })
}

fn entry_of(
    rec: &JobRecord,
    client_name: &str,
    docs: Vec<DocFacts>,
    route_set: Option<&RouteSet>,
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
    let mut evidence: Vec<Evidence> = Vec::new();
    let client_step = rec.route.iter().any(|st| st.party == jobs::CLIENT);
    let mut people: Vec<String> = vec![rec.owner.clone()];
    people.extend(
        rec.route
            .iter()
            .filter(|st| st.party == jobs::AGENCY)
            .map(|st| st.approver.clone()),
    );
    for f in docs {
        people.extend(f.writers.iter().cloned());
        if let Some(mut e) = f.evidence {
            if !client_step {
                e.client = None;
            }
            people.extend(e.signers.iter().map(|(_, p)| p.clone()));
            evidence.push(e);
        }
        if let Some(b) = f.brief {
            if best.as_ref().is_none_or(|(p, ..)| b.progress > *p) {
                best = Some((b.progress, b, f.listed.path.clone(), f.listed.title.clone()));
            }
        }
        listed.push(f.listed);
    }

    let (stage_id, status, waiting_on, days) = match &best {
        None => ("client-brief", "No brief yet.".to_string(), "agency", None),
        Some((p, f, path, title)) => {
            let gate_stage = match p {
                Progress::Drafting => "client-brief",
                Progress::Passed | Progress::Signed => "brief-check",
                Progress::Confirmed => "scope-estimate",
            };
            let (gate_due, gate_due_source) = alerts::due_of(rec, gate_stage);
            let mut push = |audience: Audience, role: &str, text: String, action: &str| {
                needs.push(Need {
                    id: format!("{}:{gate_stage}:{role}:gate", rec.number),
                    kind: "gate",
                    stage: gate_stage.to_string(),
                    days_late: None,
                    job: rec.number.clone(),
                    client: client_name.to_string(),
                    client_id: rec.client_id.clone(),
                    text,
                    action: action.to_string(),
                    path: path.clone(),
                    due: gate_due.clone(),
                    due_source: gate_due_source,
                    urgent: false,
                    can_done: false,
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
                        "planner",
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
                            "planner",
                            text.clone(),
                            "Sign the changed brief",
                        );
                        push(
                            person(&f.creative_director, "creative-director"),
                            "creative_director",
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
                            "creative_director",
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
                            "planner",
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
                        "account_service",
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

    // The approval route: its states and its holder are read from the same
    // chains, from the clock alone. A job with no route is as it always was.
    let (route, holder) = derive_route(rec, route_set, &evidence, now, today);
    let (waiting_on, days) = match (&holder, rec.route.iter().any(|s| s.party == jobs::CLIENT)) {
        // a client step on the route: the client's wait counts from when the agency handed it over
        (Some(h), true) if h.party == jobs::CLIENT => ("client", Some(h.days)),
        (Some(_), true) => ("agency", None),
        _ => (waiting_on, days),
    };
    route_needs(
        rec,
        client_name,
        &holder,
        &evidence,
        &route,
        route_set,
        today,
        &mut needs,
    );

    // The notices (features/needs-you-full.clan): each is a rule of `alerts.rs` over facts the cache holds.
    let subject = alerts::Subject { rec, client_name };
    if let Some((_, f, path, title)) = &best {
        if let (true, Some(cause)) = (f.changed, f.edit_cause.as_deref()) {
            needs.push(alerts::brief_changed(&subject, title, path, cause));
        }
        people.extend(f.planner.iter().chain(f.creative_director.iter()).cloned());
    }
    for e in &evidence {
        if let Some(answer) = &e.client_change {
            let stage = stage_of_app(e.app, jobs::CLIENT).unwrap_or("client-approval");
            needs.push(alerts::client_change(
                &subject, stage, &e.title, &e.path, answer,
            ));
        }
    }
    needs.extend(alerts::deadline_soon(&subject, today));
    fold_approvals(&mut needs);
    for n in &mut needs {
        alerts::finish(n, today);
    }
    people.retain(|p| !p.is_empty());
    people.sort();
    people.dedup();

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
            route,
            holder,
            people,
        },
        needs,
    )
}

/// An approver on a stage the Brief gate also asks about sees one row, not two: the approval's (it
/// carries the route's deadline and how late it is, and its id is the one a later record keys on), and
/// the gate's row for the same person on the same stage goes.
fn fold_approvals(needs: &mut Vec<Need>) {
    let approvals: Vec<(String, Audience)> = needs
        .iter()
        .filter(|n| n.kind == "approval")
        .map(|n| (n.stage.clone(), n.audience.clone()))
        .collect();
    needs.retain(|n| {
        n.kind != "gate"
            || !approvals
                .iter()
                .any(|(stage, who)| *stage == n.stage && *who == n.audience)
    });
}

// ── the approval route (features/approval-route.clan) ───────────────────────

/// What a document's own chain says about approvals: read, never typed.
#[derive(Clone)]
struct Evidence {
    path: String,
    title: String,
    app: &'static str,
    /// A brief's signers, when it names any: `(role, person)`.
    signers: Vec<(String, String)>,
    /// The lock that holds on the current content.
    lock: Option<Mark>,
    /// The `sign` decisions that hold on the current content.
    signs: Vec<Mark>,
    /// The client's accepted answer to the locked version.
    client: Option<Mark>,
    /// The client's newest answer to the locked version when it asks for changes or turns it down:
    /// the decision's id. Its words are never read into the index.
    client_change: Option<String>,
}

/// One approving decision: who, when, and the exact version.
#[derive(Clone)]
struct Mark {
    person: String,
    at: String,
    version: Option<String>,
}

fn person_name(d: &clan_sdk::Decision) -> String {
    let a = d.actor.as_deref().unwrap_or(&d.agent);
    a.strip_prefix("human:").unwrap_or(a).to_string()
}

fn mark_of(d: &clan_sdk::Decision) -> Mark {
    Mark {
        person: person_name(d),
        at: d.timestamp.clone(),
        version: d.version.clone(),
    }
}

fn evidence_of(doc: &Document, id: &DocId, app: &str, client_step: bool) -> Evidence {
    let clan = doc.clan();
    let app = APP_STAGES
        .iter()
        .find(|(a, ..)| *a == app)
        .map_or("", |(a, ..)| *a);
    let chain = if clan.has_entry("agent/decision-chain.yaml") {
        clan.read_entry("agent/decision-chain.yaml")
            .ok()
            .and_then(|b| clan_sdk::DecisionChain::from_yaml(&b).ok())
            .unwrap_or_default()
    } else {
        clan_sdk::DecisionChain::default()
    };
    let doc_id = clan.document_id();
    let lock_at = review::lock_index(&chain, doc_id).filter(|i| !gate::edited_since(&chain, *i));
    let lock = lock_at.map(|i| mark_of(&chain.decisions[i]));
    let signs = chain
        .decisions
        .iter()
        .enumerate()
        .filter(|(i, d)| {
            d.superseded_by.is_none()
                && d.kind.as_deref() == Some(gate::SIGN)
                && d.targets.iter().any(|t| t == doc_id)
                && !gate::edited_since(&chain, *i)
        })
        .map(|(_, d)| mark_of(d))
        .collect();
    let view = client_step
        .then(|| {
            decisions::decisions(doc)
                .ok()
                .filter(|v| v.problem.is_none())
        })
        .flatten();
    let client_change = view
        .as_ref()
        .and_then(|v| v.client.answer.as_ref())
        .filter(|a| a.answer != "accepted" && a.current)
        .map(|a| a.decision.clone());
    let client = if client_step {
        view.and_then(|v| v.client.answer)
            .filter(|a| a.answer == "accepted" && a.current)
            .map(|a| Mark {
                person: a
                    .client
                    .get("name")
                    .and_then(|n| n.as_str())
                    .map(str::to_string)
                    .unwrap_or(a.recorded_by.name),
                at: a.at,
                version: lock.as_ref().and_then(|l| l.version.clone()),
            })
    } else {
        None
    };
    let signers = if gate::applies(doc) {
        decisions::decisions(doc)
            .ok()
            .and_then(|v| gate::view(doc, &v).ok())
            .map(|g| g.signers.into_iter().map(|s| (s.role, s.person)).collect())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    Evidence {
        path: id.to_string(),
        title: clan.manifest().title.clone(),
        app,
        signers,
        lock,
        signs,
        client,
        client_change,
    }
}

/// The days between two dates, 0 when `due` is today or ahead: late from the
/// day after it, counted by the index's own `today`.
fn days_late(due: &str, today: NaiveDate) -> i64 {
    NaiveDate::parse_from_str(due, "%Y-%m-%d")
        .map(|d| (today - d).num_days().max(0))
        .unwrap_or(0)
}

/// The approver a step answers to: the brief's own signer when a brief names
/// one for the role (one truth per brief), else the route's.
fn approver_of(step: &RouteStep, evs: &[Evidence]) -> String {
    if step.stage == "brief-check" && step.party == jobs::AGENCY {
        if let Some(role) = step.role.as_deref() {
            for e in evs.iter().filter(|e| e.app == gate::BRIEF_MAKER) {
                if let Some((_, p)) = e.signers.iter().find(|(r, _)| r == role) {
                    return p.clone();
                }
            }
        }
    }
    step.approver.clone()
}

/// The decision that satisfies a step, and the document it is on: a planner's
/// `sign` on the brief, an `approve` by the approver on the current lock for an
/// agency step, an accepted client answer for a client step. The newest wins.
fn approval_of<'e>(
    step: &RouteStep,
    approver: &str,
    evs: &'e [Evidence],
) -> Option<(Mark, &'e Evidence)> {
    let mut found: Vec<(Mark, &Evidence)> = Vec::new();
    for e in evs
        .iter()
        .filter(|e| stage_of_app(e.app, &step.party) == Some(step.stage.as_str()))
    {
        let mark = if step.party == jobs::CLIENT {
            e.client.clone()
        } else if e.app == gate::BRIEF_MAKER && step.role.as_deref() == Some(gate::PLANNER) {
            e.signs.iter().find(|m| m.person == approver).cloned()
        } else {
            e.lock.clone().filter(|m| m.person == approver)
        };
        if let Some(m) = mark {
            found.push((m, e));
        }
    }
    found.into_iter().max_by(|a, b| a.0.at.cmp(&b.0.at))
}

fn stage_label(id: &str) -> &'static str {
    STAGES
        .iter()
        .find(|(s, _)| *s == id)
        .map_or("", |(_, l)| *l)
}

fn derive_route(
    rec: &JobRecord,
    set: Option<&RouteSet>,
    evs: &[Evidence],
    now: DateTime<Utc>,
    today: NaiveDate,
) -> (Vec<RouteStepState>, Option<Holder>) {
    if rec.route.is_empty() {
        return (Vec::new(), None);
    }
    let approvers: Vec<String> = rec.route.iter().map(|s| approver_of(s, evs)).collect();
    let approvals: Vec<Option<(Mark, &Evidence)>> = rec
        .route
        .iter()
        .zip(&approvers)
        .map(|(s, a)| approval_of(s, a, evs))
        .collect();
    let holder_at = approvals.iter().position(Option::is_none);
    let mut states = Vec::with_capacity(rec.route.len());
    let mut holder = None;
    for (i, step) in rec.route.iter().enumerate() {
        let approver = approvers[i].clone();
        let pending = holder_at == Some(i);
        let state = match (&approvals[i], pending) {
            (Some(_), _) => "approved",
            (None, true) => "waiting",
            (None, false) => "not_started",
        };
        // where the step is looked at: the document that approved it, else the first of its stage
        let document = approvals[i]
            .as_ref()
            .map(|(_, e)| e.path.clone())
            .or_else(|| {
                evs.iter()
                    .find(|e| stage_of_app(e.app, &step.party) == Some(step.stage.as_str()))
                    .map(|e| e.path.clone())
            });
        // held since: the decision that satisfied the step before it, or the route's own time for the first
        let since = pending.then(|| {
            if i == 0 {
                set.map_or_else(|| rec.created_at.clone(), |s| s.at.clone())
            } else {
                approvals[i - 1]
                    .as_ref()
                    .map_or_else(|| rec.created_at.clone(), |(m, _)| m.at.clone())
            }
        });
        let days_held = since.as_deref().and_then(|t| days_between(t, now));
        let late = pending.then(|| days_late(&step.due, today));
        if pending {
            holder = Some(Holder {
                party: step.party.clone(),
                person: approver.clone(),
                role: step.role.clone(),
                stage: step.stage.clone(),
                since: since.clone().unwrap_or_default(),
                days: days_held.unwrap_or(0),
                due: step.due.clone(),
                days_late: late.unwrap_or(0),
            });
        }
        states.push(RouteStepState {
            stage: step.stage.clone(),
            label: stage_label(&step.stage),
            party: step.party.clone(),
            role: step.role.clone(),
            approver,
            contact: step.contact.clone(),
            rounds: step.rounds,
            due: step.due.clone(),
            state,
            approved_by: approvals[i].as_ref().map(|(m, _)| m.person.clone()),
            approved_at: approvals[i].as_ref().map(|(m, _)| m.at.clone()),
            version: approvals[i].as_ref().and_then(|(m, _)| m.version.clone()),
            document,
            held_since: since,
            days_held,
            days_late: late,
        });
    }
    (states, holder)
}

/// An approval is asked for from 48 hours before it is due.
const REMIND_DAYS: i64 = 2;
/// From this many days late, the person who set the route is told as well.
const CHASE_DAYS: i64 = 2;

fn days_word(n: i64) -> String {
    format!("{n} day{}", if n == 1 { "" } else { "s" })
}

/// The needs the route gives, from the clock alone: the approver's own item
/// from 48 hours before the due date, and, two days late, the person who set
/// the route is asked to chase it. Nothing is stored; the item leaves when the
/// step is approved.
fn route_needs(
    rec: &JobRecord,
    client_name: &str,
    holder: &Option<Holder>,
    docs: &[Evidence],
    route: &[RouteStepState],
    set: Option<&RouteSet>,
    today: NaiveDate,
    needs: &mut Vec<Need>,
) {
    let (Some(h), Some(step)) = (holder, route.iter().find(|s| s.state == "waiting")) else {
        return;
    };
    let until_due =
        NaiveDate::parse_from_str(&h.due, "%Y-%m-%d").map_or(i64::MAX, |d| (d - today).num_days());
    let role = h.role.clone().unwrap_or_else(|| "any".to_string());
    let path = step.document.clone().unwrap_or_default();
    let what = docs.iter().find(|e| e.path == path).map_or_else(
        || step.label.to_string(),
        |e| format!("{}: {}", step.label, e.title),
    );
    let mut push = |kind: &'static str, audience: Audience, text: String, action: &str| {
        needs.push(Need {
            id: format!("{}:{}:{role}:{kind}", rec.number, h.stage),
            kind,
            stage: h.stage.clone(),
            days_late: Some(h.days_late),
            job: rec.number.clone(),
            client: client_name.to_string(),
            client_id: rec.client_id.clone(),
            text,
            action: action.to_string(),
            path: path.clone(),
            due: Some(h.due.clone()),
            due_source: "stage",
            urgent: false,
            can_done: false,
            audience,
        });
    };
    if h.party == jobs::AGENCY && until_due <= REMIND_DAYS {
        let when = if h.days_late > 0 {
            format!("{} late, due {}", days_word(h.days_late), h.due)
        } else {
            format!("due {}", h.due)
        };
        push(
            "approval",
            Audience::Person(h.person.clone()),
            format!("{what}: your approval is {when}."),
            "Review and approve",
        );
    }
    if h.days_late >= CHASE_DAYS {
        let text = if h.party == jobs::CLIENT {
            format!(
                "{what}: the client's approval is {} late, due {}.",
                days_word(h.days_late),
                h.due
            )
        } else {
            format!(
                "{what}: {} is {} late with an approval, due {}.",
                h.person,
                days_word(h.days_late),
                h.due
            )
        };
        let audience = match set {
            Some(s) if s.by != h.person => Some(Audience::Person(s.by.clone())),
            Some(_) => None,
            None => Some(Audience::Role("account-service")),
        };
        if let Some(audience) = audience {
            push("approval-chase", audience, text, "Chase the approval");
        }
    }
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
                .filter_map(|j| {
                    let late = j.holder.as_ref().filter(|h| h.days_late > 0).map(|h| {
                        format!(
                            "{} approval is {} late.",
                            stage_label(&h.stage),
                            days_word(h.days_late)
                        )
                    });
                    let due = j
                        .at_risk
                        .then(|| format!("Due {}.", j.due.clone().unwrap_or_default()));
                    let text = [due, late]
                        .into_iter()
                        .flatten()
                        .collect::<Vec<_>>()
                        .join(" ");
                    (!text.is_empty()).then(|| line(j, text))
                })
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

/// Each document's facts by its id: the stamp they were read at, and the facts.
type KeptFacts = HashMap<String, (String, Option<DocFacts>)>;

/// The last index, and what it was built from. One beside each tenant's store.
#[derive(Default)]
pub struct IndexCache {
    last: Mutex<Option<(Vec<(String, String)>, JobIndex)>>,
    /// Each document's facts, by the stamp they were read at: a rebuild
    /// reads again only a document whose stamp moved, so its cost grows with
    /// what changed, not with how many documents the agency holds.
    facts: Mutex<KeptFacts>,
    builds: std::sync::atomic::AtomicUsize,
}

impl IndexCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// The current index: the last one when no document has moved, else a
    /// rebuild. What "moved" means is the store's [`stamp`](crate::store::PartStore::stamp)
    /// of every document and of the two registries: on the web's file store a
    /// stat (size, modified time, inode), so an index read on an unchanged
    /// tenant reads no document and hashes none, and a write by any handle on
    /// the same disk (another web task) is seen on the next read. The date is
    /// part of the answer (at risk, days waiting), so a new day makes a new
    /// index too. A rebuild reads again only the documents whose stamp moved,
    /// and the first read after start (an empty cache) is one full build.
    ///
    /// What a missed stamp change would cost: if a filesystem ever reported the
    /// same stamp for different bytes, the index would show that document as it
    /// last read it until the next write to it. Nothing is written from the
    /// index, so nothing is lost; [`delete`](Self::delete) or a restart of the
    /// server (a new cache) clears it. There is no route for it today.
    pub fn get(&self, store: &dyn DocStore, now: DateTime<Utc>) -> HostResult<JobIndex> {
        let stamps: HashMap<String, String> = store
            .documents()
            .into_iter()
            .filter_map(|id| {
                store
                    .stamp(&id)
                    .ok()
                    .map(|v| (id.to_string(), v.as_str().to_string()))
            })
            .collect();
        let mut stamp: Vec<(String, String)> =
            stamps.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for reg in ["jobs-v1", "clients-v1"] {
            if let Ok(id) = store.home(reg) {
                if let Ok(v) = store.stamp(&id) {
                    stamp.push((reg.into(), v.as_str().to_string()));
                }
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
        let mut kept = self.facts.lock().unwrap_or_else(|e| e.into_inner());
        // a document that is gone is forgotten
        kept.retain(|id, _| stamps.contains_key(id));
        let index = JobIndex::build_from(store, now, |id| {
            let key = id.to_string();
            let now_at = stamps.get(&key);
            if let Some((at, f)) = kept.get(&key) {
                if Some(at) == now_at {
                    return f.clone();
                }
            }
            let bytes = store.read(id).ok()?;
            let f = facts_of(id, bytes);
            // Kept under the stamp taken above. A write between the stamp and the read only costs a second
            // read: the next stamp is the newer one, which matches nothing kept.
            if let Some(at) = now_at {
                kept.insert(key, (at.clone(), f.clone()));
            }
            f
        })?;
        self.builds
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        *last = Some((stamp, index.clone()));
        Ok(index)
    }

    /// Delete the index: the next [`get`](Self::get) rebuilds it from the documents,
    /// every one read again.
    pub fn delete(&self) {
        *self.last.lock().unwrap_or_else(|e| e.into_inner()) = None;
        self.facts.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    /// How many times it has been built. (No clock here: this crate builds for the
    /// browser, where `Instant` panics; the web server times a build around [`get`](Self::get).)
    pub fn builds(&self) -> usize {
        self.builds.load(std::sync::atomic::Ordering::Relaxed)
    }
}
