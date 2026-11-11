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

use std::sync::Mutex;

use clan_sdk::{create, ClanBuilder, ClanFile, CreateOptions};
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

fn rebuilt(clan: &ClanFile, data: Vec<u8>) -> HostResult<Vec<u8>> {
    let mut manifest = clan.manifest().clone();
    manifest.next_revision();
    manifest.updated_at = chrono::Utc::now().to_rfc3339();
    let mut b = ClanBuilder::new(manifest);
    for (path, bytes) in clan.read_all_entries()? {
        if path != "manifest.yaml" && path != DATA {
            b.add_entry(path, bytes);
        }
    }
    b.add_entry(DATA, data);
    Ok(b.build()?)
}

fn write_registry(
    store: &dyn DocStore,
    reg: &Registry,
    base: Option<Version>,
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
            Change::create(id, rebuilt(&clan, data)?)
        }
        Some(v) => {
            let clan = ClanFile::from_bytes(store.read(&id)?)?;
            let bytes = rebuilt(&clan, data)?;
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
    if title.as_deref().is_some_and(|t| t.chars().count() > MAX_TITLE) {
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
    };
    reg.jobs.push(record.clone());
    write_registry(store, &reg, base)?;
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
