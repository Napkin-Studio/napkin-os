// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The job registry: the jobs the studio is running (v2 section 3).
//!
//! One CLAN document per tenant (`document_type: job-registry`) whose
//! `shared/data.yaml` holds `jobs`, kept the way the client registry is
//! (`clients.rs`): written through [`Change`] and [`DocStore::apply`], so the
//! version check and the seal check have one place to live, it works on every
//! store, and this module never touches `std::fs`. It lives beside the home
//! app (`Library::home`), not in `documents()`, so it never shows as work.
//!
//! A job holds what a person decides: its number, client, owner, title, dates
//! and budget in hours. It does not hold its **stage**. The stage is read from
//! the decisions of the job's documents (`jobindex.rs`), so it cannot be typed
//! in and drift from the truth. A document is linked to a job by
//! `manifest.job` (the job number); the registry never lists documents.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use clan_sdk::{create, ClanBuilder, ClanFile, CreateOptions, Decision, DecisionChain};
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

use crate::clients::{self, ClientRecord};
use crate::ctx::Ctx;
use crate::error::{HostError, HostResult};
use crate::store::{Change, DocId, DocStore, Version};

/// The registry's tag in `Library::home`.
const REGISTRY_TAG: &str = "jobs-v1";
const DATA: &str = "shared/data.yaml";
const DOCUMENT_TYPE: &str = "job-registry";
const MAX_TITLE: usize = 80;
const MAX_HOURS: f64 = 100_000.0;
/// The registry's decision chain, as every CLAN document keeps its own.
const CHAIN: &str = "agent/decision-chain.yaml";
/// The most steps one route holds: eleven stages, a few roles each.
const MAX_STEPS: usize = 40;
/// A step's approver and role, in characters.
const MAX_NAME: usize = 120;
/// The most rounds a client step may carry.
const MAX_ROUNDS: u32 = 20;

/// The action a route write records on the registry's chain.
pub const SET_ROUTE: &str = "set_route";
/// The action a moved deadline records.
pub const MOVE_DEADLINE: &str = "move_deadline";
/// The action opening a job records.
pub const OPEN_JOB: &str = "open_job";
/// The action a change to a job's title, owner or budget records (a deadline alone is `move_deadline`).
pub const UPDATE_JOB: &str = "update_job";

/// The two parties of a step.
pub const AGENCY: &str = "agency";
pub const CLIENT: &str = "client";

/// One stage's approval on a job: who approves it and by when
/// (features/approval-route.clan). The route is facts about the job; whether
/// a step is approved is never stored here, it is read from the documents'
/// own decisions (`jobindex.rs`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RouteStep {
    /// One of `jobindex::STAGES`.
    pub stage: String,
    /// `agency` or `client`.
    pub party: String,
    /// `planner`, `creative_director`, or a free label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// An agency step: a sign-in name, `user@agency`. A client step: a name.
    pub approver: String,
    /// A client step: the approver's email.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contact: Option<String>,
    /// `YYYY-MM-DD`.
    pub due: String,
    /// A client step: the rounds of changes the client may ask for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rounds: Option<u32>,
}

/// One job of the studio.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct JobRecord {
    /// `J` and three or more digits: `J001`.
    pub number: String,
    /// The registry's client id (`cli_…`).
    pub client_id: String,
    pub title: String,
    /// Who runs the job: informational, never a permission and never a score.
    pub owner: String,
    /// `YYYY-MM-DD`.
    pub opened_on: String,
    /// The job's deadline, `YYYY-MM-DD`, when it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
    /// Hours the job may take, when agreed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget_hours: Option<f64>,
    pub created_at: String,
    /// Who approves each stage and by when, in stage order. Empty for a job
    /// with no route (and for every registry written before routes existed).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub route: Vec<RouteStep>,
}

/// What a person gives to open a job.
#[derive(Deserialize, Default, Debug)]
pub struct NewJob {
    /// Left out, the next free number is used.
    pub number: Option<String>,
    pub client_id: String,
    pub title: Option<String>,
    pub owner: Option<String>,
    pub opened_on: Option<String>,
    pub due: Option<String>,
    pub budget_hours: Option<f64>,
}

#[derive(Serialize, Deserialize, Default)]
struct Registry {
    #[serde(default)]
    jobs: Vec<JobRecord>,
}

/// Read-modify-write on a registry is one critical section, as for clients.
static WRITE: Mutex<()> = Mutex::new(());

fn registry_id(store: &dyn DocStore) -> HostResult<DocId> {
    store.home(REGISTRY_TAG)
}

fn read_registry(store: &dyn DocStore) -> HostResult<(Registry, Option<Version>)> {
    let id = registry_id(store)?;
    if !store.exists(&id) {
        return Ok((Registry::default(), None));
    }
    let bytes = store.read(&id)?;
    let version = Version::of_archive(&bytes);
    let clan = ClanFile::from_bytes(bytes)?;
    let data = clan.read_entry(DATA)?;
    let reg: Registry = serde_yaml::from_slice(&data)
        .map_err(|e| HostError::internal(format!("the job registry is unreadable: {e}")))?;
    Ok((reg, Some(version)))
}

fn data_yaml(reg: &Registry) -> HostResult<Vec<u8>> {
    let mut m = Mapping::new();
    m.insert(
        Value::from("$schema"),
        Value::from("spec/schemas/document.schema.json"),
    );
    m.insert(
        Value::from("jobs"),
        serde_yaml::to_value(&reg.jobs).map_err(|e| HostError::internal(e.to_string()))?,
    );
    serde_yaml::to_string(&Value::Mapping(m))
        .map(String::into_bytes)
        .map_err(|e| HostError::internal(e.to_string()))
}

fn rebuilt(clan: &ClanFile, data: Vec<u8>, decision: Option<Decision>) -> HostResult<Vec<u8>> {
    let mut manifest = clan.manifest().clone();
    manifest.next_revision();
    manifest.updated_at = chrono::Utc::now().to_rfc3339();
    let mut chain = chain_of(clan)?;
    if let Some(d) = decision {
        chain.prepend(d);
    }
    let mut b = ClanBuilder::new(manifest);
    for (path, bytes) in clan.read_all_entries()? {
        if path != "manifest.yaml" && path != DATA && path != CHAIN {
            b.add_entry(path, bytes);
        }
    }
    b.add_entry(DATA, data);
    if !chain.decisions.is_empty() {
        b.add_entry(CHAIN, chain.to_yaml()?);
    }
    Ok(b.build()?)
}

fn chain_of(clan: &ClanFile) -> HostResult<DecisionChain> {
    Ok(if clan.has_entry(CHAIN) {
        DecisionChain::from_yaml(&clan.read_entry(CHAIN)?)?
    } else {
        DecisionChain::default()
    })
}

fn write_registry(
    store: &dyn DocStore,
    reg: &Registry,
    base: Option<Version>,
    decision: Option<Decision>,
) -> HostResult<()> {
    let id = registry_id(store)?;
    let data = data_yaml(reg)?;
    let change = match base {
        None => {
            let bytes = create(CreateOptions {
                title: "Jobs".into(),
                brief: "The studio's job registry".into(),
                document_type: Some(DOCUMENT_TYPE.into()),
                no_render: true,
                schema: None,
            })?;
            let clan = ClanFile::from_bytes(bytes)?;
            Change::create(id, rebuilt(&clan, data, decision)?)
        }
        Some(v) => {
            let clan = ClanFile::from_bytes(store.read(&id)?)?;
            let bytes = rebuilt(&clan, data, decision)?;
            if store.version(&id)? != v {
                return Err(HostError::conflict(
                    "the job list changed while you were saving; try again",
                ));
            }
            Change::replace(id, v, bytes)
        }
    };
    store.apply(&change)?;
    Ok(())
}

/// A job number as the registry keeps it: `J` and three to six digits.
pub fn is_job_number(s: &str) -> bool {
    s.strip_prefix('J')
        .is_some_and(|d| (3..=6).contains(&d.len()) && d.bytes().all(|b| b.is_ascii_digit()))
}

fn is_date(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

/// Every job, in the order they were opened.
pub fn list(store: &dyn DocStore) -> HostResult<Vec<JobRecord>> {
    Ok(read_registry(store)?.0.jobs)
}

/// One job by number.
pub fn get(store: &dyn DocStore, number: &str) -> HostResult<JobRecord> {
    list(store)?
        .into_iter()
        .find(|j| j.number == number)
        .ok_or_else(|| HostError::not_found(format!("no such job: {number}")))
}

/// Open a job for a client. A number already in the registry is a `409`; an
/// unknown or archived client is a `404` or `409` as for new work.
pub fn create_job(store: &dyn DocStore, ctx: &Ctx, new: NewJob) -> HostResult<JobRecord> {
    let who = person_of(ctx)?;
    let client: ClientRecord = clients::get(store, new.client_id.trim())?;
    if client.is_archived() {
        return Err(HostError::conflict(format!(
            "\"{}\" is archived; restore it to open a job",
            client.name
        )));
    }
    let title = new
        .title
        .as_deref()
        .map(|t| t.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|t| !t.is_empty());
    if title
        .as_deref()
        .is_some_and(|t| t.chars().count() > MAX_TITLE)
    {
        return Err(HostError::bad_request(format!(
            "a job's title is at most {MAX_TITLE} characters"
        )));
    }
    for (what, d) in [("opened_on", &new.opened_on), ("due", &new.due)] {
        if d.as_deref().is_some_and(|d| !is_date(d)) {
            return Err(HostError::bad_request(format!(
                "{what} is a date, YYYY-MM-DD"
            )));
        }
    }
    if new
        .budget_hours
        .is_some_and(|h| !h.is_finite() || !(0.0..=MAX_HOURS).contains(&h))
    {
        return Err(HostError::bad_request(
            "budget_hours is a number of hours, not below zero",
        ));
    }
    if new.number.as_deref().is_some_and(|n| !is_job_number(n)) {
        return Err(HostError::bad_request(
            "a job number is J and three to six digits, like J001",
        ));
    }
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read_registry(store)?;
    let number = match new.number {
        Some(n) => n,
        None => format!("J{:03}", next_ordinal(&reg)),
    };
    if reg.jobs.iter().any(|j| j.number == number) {
        return Err(HostError::conflict(format!(
            "there is already a job {number}"
        )));
    }
    let now = chrono::Utc::now();
    let record = JobRecord {
        title: title.unwrap_or_else(|| format!("{number} {}", client.name)),
        number,
        client_id: client.id,
        owner: new
            .owner
            .filter(|o| !o.trim().is_empty())
            .unwrap_or_else(|| {
                let a = ctx.actor.as_str();
                a.strip_prefix("human:").unwrap_or(a).to_string()
            }),
        opened_on: new
            .opened_on
            .unwrap_or_else(|| now.format("%Y-%m-%d").to_string()),
        due: new.due,
        budget_hours: new.budget_hours,
        created_at: now.to_rfc3339(),
        route: Vec::new(),
    };
    reg.jobs.push(record.clone());
    let decision = registry_decision(
        ctx,
        &who,
        OPEN_JOB,
        &record.number,
        "number",
        format!(
            "Opened {} for {}{}.",
            record.number,
            client.name,
            record
                .due
                .as_deref()
                .map(|d| format!(", due {d}"))
                .unwrap_or_default()
        ),
        now,
    );
    write_registry(store, &reg, base, Some(decision))?;
    Ok(record)
}

/// What a person may change on a job after it is opened. A field left out is not touched.
#[derive(Deserialize, Default, Debug)]
pub struct JobPatch {
    pub title: Option<String>,
    pub owner: Option<String>,
    /// `null` clears the deadline; absent leaves it.
    #[serde(default, deserialize_with = "some_or_null")]
    pub due: Option<Option<String>>,
    pub budget_hours: Option<f64>,
}

fn some_or_null<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

/// Change a job's title, owner, deadline or budget in hours, as a person, recording one decision on the
/// registry's chain: who, what (`Moved the deadline of J001 from 2026-11-20 to 2026-11-27.`), when. A bad
/// value is a `400`, an unknown job a `404`, a registry that moved under the write a `409`, no person a `403`.
pub fn update_job(
    store: &dyn DocStore,
    ctx: &Ctx,
    number: &str,
    patch: JobPatch,
) -> HostResult<JobRecord> {
    let who = person_of(ctx)?;
    let title = match patch.title {
        Some(t) => {
            let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
            if t.is_empty() || t.chars().count() > MAX_TITLE {
                return Err(HostError::bad_request(format!(
                    "a job's title is one to {MAX_TITLE} characters"
                )));
            }
            Some(t)
        }
        None => None,
    };
    let owner = match patch.owner {
        Some(o) => {
            let o = o.split_whitespace().collect::<Vec<_>>().join(" ");
            if o.is_empty() || o.chars().count() > MAX_NAME {
                return Err(HostError::bad_request(format!(
                    "an owner is one to {MAX_NAME} characters"
                )));
            }
            Some(o)
        }
        None => None,
    };
    if let Some(Some(d)) = &patch.due {
        if !is_date(d) {
            return Err(HostError::bad_request("due is a date, YYYY-MM-DD"));
        }
    }
    if patch
        .budget_hours
        .is_some_and(|h| !h.is_finite() || !(0.0..=MAX_HOURS).contains(&h))
    {
        return Err(HostError::bad_request(
            "budget_hours is a number of hours, not below zero",
        ));
    }
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read_registry(store)?;
    let job = reg
        .jobs
        .iter_mut()
        .find(|j| j.number == number)
        .ok_or_else(|| HostError::not_found(format!("no such job: {number}")))?;
    let mut said: Vec<String> = Vec::new();
    let mut fields: Vec<&str> = Vec::new();
    if let Some(t) = title.filter(|t| *t != job.title) {
        said.push(format!(
            "Renamed {number} from \"{}\" to \"{t}\".",
            job.title
        ));
        job.title = t;
        fields.push("title");
    }
    if let Some(o) = owner.filter(|o| *o != job.owner) {
        said.push(format!("Moved {number} from {} to {o}.", job.owner));
        job.owner = o;
        fields.push("owner");
    }
    if let Some(due) = patch.due.filter(|d| *d != job.due) {
        said.push(format!(
            "Moved the deadline of {number} from {} to {}.",
            job.due.as_deref().unwrap_or("none"),
            due.as_deref().unwrap_or("none")
        ));
        job.due = due;
        fields.push("due");
    }
    if let Some(h) = patch.budget_hours.filter(|h| Some(*h) != job.budget_hours) {
        said.push(format!(
            "Set the budget of {number} from {} to {h} hours.",
            job.budget_hours
                .map(|b| format!("{b} hours"))
                .unwrap_or_else(|| "none".into())
        ));
        job.budget_hours = Some(h);
        fields.push("budget_hours");
    }
    let record = job.clone();
    if fields.is_empty() {
        return Ok(record);
    }
    let action = if fields == ["due"] {
        MOVE_DEADLINE
    } else {
        UPDATE_JOB
    };
    let decision = registry_decision(
        ctx,
        &who,
        action,
        number,
        &fields.join(","),
        said.join(" "),
        chrono::Utc::now(),
    );
    write_registry(store, &reg, base, Some(decision))?;
    Ok(record)
}

fn next_ordinal(reg: &Registry) -> u32 {
    reg.jobs
        .iter()
        .filter_map(|j| j.number.strip_prefix('J')?.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
        + 1
}

/// File the document `doc` under job `number`: `manifest.job` is set, nothing
/// else changes. The job and the document must belong to one client (`400`
/// otherwise), so a job never holds another client's work.
pub fn link_document(store: &dyn DocStore, doc: &DocId, number: &str) -> HostResult<()> {
    let job = get(store, number)?;
    let bytes = store.read(doc)?;
    let version = Version::of_archive(&bytes);
    let clan = ClanFile::from_bytes(bytes)?;
    let owner = clan.manifest().client.as_ref().map(|c| c.id.as_str());
    if owner != Some(job.client_id.as_str()) {
        return Err(HostError::bad_request(format!(
            "job {number} is for another client than this document"
        )));
    }
    let out = clan_sdk::with_job(&clan, Some(number.to_string()))?;
    store.apply(&Change::replace(doc.clone(), version, out))?;
    Ok(())
}

/// The job a request names, when it names one: absent or empty is "no job",
/// an unknown number is a `404`. Used by every host that makes a document.
pub fn get_named(store: &dyn DocStore, number: Option<&str>) -> HostResult<Option<JobRecord>> {
    match number.map(str::trim).filter(|s| !s.is_empty()) {
        Some(n) => get(store, n).map(Some),
        None => Ok(None),
    }
}

// ── the approval route ──────────────────────────────────────────────────────

fn person_of(ctx: &Ctx) -> HostResult<String> {
    if !ctx.actor.is_human() {
        return Err(HostError::new(
            403,
            format!(
                "only a person can open or change a job; {} is not one",
                ctx.actor
            ),
        ));
    }
    Ok(ctx.actor.to_string())
}

/// The route as the host keeps it: checked, trimmed, and in stage order (a
/// stable sort, so steps of one stage keep the order they were given in).
fn checked_route(steps: Vec<RouteStep>) -> HostResult<Vec<RouteStep>> {
    if steps.len() > MAX_STEPS {
        return Err(HostError::bad_request(format!(
            "a route has at most {MAX_STEPS} steps"
        )));
    }
    let mut out: Vec<RouteStep> = Vec::with_capacity(steps.len());
    for mut s in steps {
        s.stage = s.stage.trim().to_string();
        s.party = s.party.trim().to_lowercase();
        s.approver = s.approver.split_whitespace().collect::<Vec<_>>().join(" ");
        s.role = s
            .role
            .map(|r| r.trim().to_lowercase())
            .filter(|r| !r.is_empty());
        s.contact = s
            .contact
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty());
        if !crate::jobindex::STAGES.iter().any(|(id, _)| *id == s.stage) {
            return Err(HostError::bad_request(format!(
                "{:?} is not a stage of a job",
                s.stage
            )));
        }
        if s.party != AGENCY && s.party != CLIENT {
            return Err(HostError::bad_request("a step's party is agency or client"));
        }
        if s.approver.is_empty() || s.approver.chars().count() > MAX_NAME {
            return Err(HostError::bad_request(format!(
                "every step names an approver, in at most {MAX_NAME} characters"
            )));
        }
        if s.party == AGENCY && !is_sign_in_name(&s.approver) {
            return Err(HostError::bad_request(
                "an agency step is approved by a sign-in name, like dara@wk",
            ));
        }
        if s.role
            .as_deref()
            .is_some_and(|r| r.chars().count() > MAX_NAME)
        {
            return Err(HostError::bad_request(format!(
                "a role is at most {MAX_NAME} characters"
            )));
        }
        if !is_date(&s.due) {
            return Err(HostError::bad_request(format!(
                "a step's due is a date, YYYY-MM-DD, not {:?}",
                s.due
            )));
        }
        if s.party == AGENCY && (s.contact.is_some() || s.rounds.is_some()) {
            return Err(HostError::bad_request(
                "a contact and rounds belong to a client step",
            ));
        }
        if s.contact.as_deref().is_some_and(|c| !is_email(c)) {
            return Err(HostError::bad_request(
                "a client contact is an email address",
            ));
        }
        if s.rounds.is_some_and(|r| r == 0 || r > MAX_ROUNDS) {
            return Err(HostError::bad_request(format!(
                "rounds is a number from 1 to {MAX_ROUNDS}"
            )));
        }
        if let Some(twin) = out.iter().find(|o| o.stage == s.stage && o.role == s.role) {
            if twin.approver != s.approver || twin.party != s.party {
                return Err(HostError::bad_request(format!(
                    "stage {} has two approvers for {}; name one",
                    s.stage,
                    s.role.as_deref().unwrap_or("one role")
                )));
            }
            return Err(HostError::bad_request(format!(
                "stage {} names {} twice",
                s.stage,
                s.role.as_deref().unwrap_or("one role")
            )));
        }
        out.push(s);
    }
    out.sort_by_key(|s| {
        crate::jobindex::STAGES
            .iter()
            .position(|(id, _)| *id == s.stage)
    });
    Ok(out)
}

fn is_sign_in_name(s: &str) -> bool {
    matches!(s.split_once('@'), Some((l, r)) if !l.is_empty() && !r.is_empty() && !r.contains('@'))
        && !s.chars().any(|c| c.is_whitespace() || c.is_control())
}

fn is_email(s: &str) -> bool {
    is_sign_in_name(s) && s.split_once('@').is_some_and(|(_, r)| r.contains('.'))
}

/// One registry decision about one job, by the person who made it.
fn registry_decision(
    ctx: &Ctx,
    who: &str,
    action: &str,
    number: &str,
    changed: &str,
    rationale: String,
    now: chrono::DateTime<chrono::Utc>,
) -> Decision {
    let mut d = crate::ops::attributed(ctx, "", "edit");
    d.id = Some(clan_sdk::decision::new_decision_id());
    d.agent = who.to_string();
    d.action = action.to_string();
    d.targets = vec![number.to_string()];
    d.fields_changed = vec![format!("{number}/{changed}")];
    d.rationale = rationale;
    d.timestamp = now.format("%Y-%m-%dT%H:%M:%SZ").to_string();
    d
}

/// Set a job's approval route: who approves each stage and by when. Replaces
/// the route whole, and records one `set_route` decision, by the person, on the
/// registry's chain. A person is needed (`403` otherwise); a bad step is a
/// `400`, an unknown job a `404`.
pub fn set_route(
    store: &dyn DocStore,
    ctx: &Ctx,
    number: &str,
    steps: Vec<RouteStep>,
) -> HostResult<JobRecord> {
    set_route_at(store, ctx, number, steps, chrono::Utc::now())
}

/// [`set_route`], as of `now` (a test sets the clock).
pub fn set_route_at(
    store: &dyn DocStore,
    ctx: &Ctx,
    number: &str,
    steps: Vec<RouteStep>,
    now: chrono::DateTime<chrono::Utc>,
) -> HostResult<JobRecord> {
    let who = person_of(ctx)?;
    let route = checked_route(steps)?;
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read_registry(store)?;
    let job = reg
        .jobs
        .iter_mut()
        .find(|j| j.number == number)
        .ok_or_else(|| HostError::not_found(format!("no such job: {number}")))?;
    let n = route.len();
    job.route = route;
    let record = job.clone();
    let decision = registry_decision(
        ctx,
        &who,
        SET_ROUTE,
        number,
        "route",
        format!(
            "Set the approval route of {number}: {n} step{}.",
            if n == 1 { "" } else { "s" }
        ),
        now,
    );
    write_registry(store, &reg, base, Some(decision))?;
    Ok(record)
}

/// Move a job's deadline (or clear it), recording one `move_deadline` decision.
pub fn move_deadline(
    store: &dyn DocStore,
    ctx: &Ctx,
    number: &str,
    due: Option<String>,
) -> HostResult<JobRecord> {
    let who = person_of(ctx)?;
    if due.as_deref().is_some_and(|d| !is_date(d)) {
        return Err(HostError::bad_request("due is a date, YYYY-MM-DD"));
    }
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read_registry(store)?;
    let job = reg
        .jobs
        .iter_mut()
        .find(|j| j.number == number)
        .ok_or_else(|| HostError::not_found(format!("no such job: {number}")))?;
    let before = job.due.clone();
    job.due = due.clone();
    let record = job.clone();
    let decision = registry_decision(
        ctx,
        &who,
        MOVE_DEADLINE,
        number,
        "due",
        format!(
            "Moved the deadline of {number} from {} to {}.",
            before.as_deref().unwrap_or("none"),
            due.as_deref().unwrap_or("none")
        ),
        chrono::Utc::now(),
    );
    write_registry(store, &reg, base, Some(decision))?;
    Ok(record)
}

/// Who set a job's route, and when: the newest `set_route` decision on the
/// registry's chain.
#[derive(Clone, Debug, PartialEq)]
pub struct RouteSet {
    /// A sign-in name, without the `human:` prefix.
    pub by: String,
    /// RFC 3339.
    pub at: String,
}

/// The newest `set_route` of each job, read from the registry's chain.
pub fn route_history(store: &dyn DocStore) -> HostResult<BTreeMap<String, RouteSet>> {
    let id = registry_id(store)?;
    let mut out = BTreeMap::new();
    if !store.exists(&id) {
        return Ok(out);
    }
    let clan = ClanFile::from_bytes(store.read(&id)?)?;
    for d in chain_of(&clan)?.decisions {
        if d.action != SET_ROUTE {
            continue;
        }
        let Some(number) = d.targets.first() else {
            continue;
        };
        let by = d
            .actor
            .as_deref()
            .unwrap_or(&d.agent)
            .strip_prefix("human:")
            .unwrap_or(d.actor.as_deref().unwrap_or(&d.agent))
            .to_string();
        out.entry(number.clone()).or_insert(RouteSet {
            by,
            at: d.timestamp,
        });
    }
    Ok(out)
}

/// The brief-check steps that name the brief's two signers: the planner and
/// the creative director, as the route has them.
fn brief_signers(route: &[RouteStep]) -> Option<[(String, String); 2]> {
    let pick = |role: &str| {
        route
            .iter()
            .find(|s| {
                s.stage == "brief-check" && s.party == AGENCY && s.role.as_deref() == Some(role)
            })
            .map(|s| (role.to_string(), s.approver.clone()))
    };
    Some([pick("planner")?, pick("creative_director")?])
}

/// Fill the signers of the briefs filed under job `number` from its route:
/// only a brief that names none and is not locked, by one attributed patch
/// through the document's own session (so an open tab is not left stale).
/// Returns the documents filled. A route without both a planner and a creative
/// director fills nothing.
pub fn fill_signers(
    store: &dyn DocStore,
    ctx: &Ctx,
    number: &str,
    session_of: &dyn Fn(&DocId) -> HostResult<Arc<crate::Session>>,
) -> HostResult<Vec<DocId>> {
    let job = get(store, number)?;
    let Some(signers) = brief_signers(&job.route) else {
        return Ok(Vec::new());
    };
    let patch = serde_json::json!({
        "patch": { "signers": signers.iter()
            .map(|(role, person)| serde_json::json!({ "role": role, "person": person }))
            .collect::<Vec<_>>() },
        "agent": "approval-route",
        "action": "fill signers from the job's route",
    })
    .to_string();
    let mut filled = Vec::new();
    for id in store.documents() {
        let Ok(bytes) = store.read(&id) else { continue };
        let Ok(clan) = ClanFile::from_bytes(bytes) else {
            continue;
        };
        if clan.manifest().job.as_deref() != Some(number) || !crate::ops::gate::applies_to(&clan) {
            continue;
        }
        let session = session_of(&id)?;
        let open = session.read(|doc| {
            let data = crate::ops::read::data_json(doc);
            let named = data
                .get("signers")
                .and_then(|s| s.as_array())
                .is_some_and(|a| !a.is_empty());
            let locked =
                crate::ops::gate::view(doc, &crate::ops::decisions::decisions(doc)?)?.signed;
            Ok(!named && !locked)
        })?;
        if open {
            session.patch_data_as(ctx, &patch)?;
            filled.push(id);
        }
    }
    Ok(filled)
}
