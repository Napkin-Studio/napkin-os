// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The library listing: every piece of work in a tenant, by client.
//!
//! `scan_recent` (the Launcher's twelve) is not touched. This is the same scan
//! without the cap, carrying what the landing needs: who a document is for,
//! what needs a person, and whether a tool is running on it.
//!
//! The scan opens every document, so a [`LibraryCache`] keeps what it worked
//! out per document, keyed on the document's id, its `updated_at` and its size.
//! A write changes `updated_at` (every write mints a new revision), so a
//! changed document is a different key and the cache needs no invalidation
//! hook; what it saves is the decision-chain and data parsing, which is the
//! cost. The client's name is never cached: it is resolved from the registry
//! on every call, so a rename shows at once.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use clan_sdk::{ClanFile, ClientRef};
use serde::Serialize;

use crate::clients::{self, ClientRecord};
use crate::library::{is_blank_in, recent_state, RecentState};
use crate::runs::RunTracker;
use crate::store::{DocId, DocStore};

const DATA: &str = "shared/data.yaml";

/// What the library route can narrow to.
#[derive(Default, Debug, Clone, PartialEq)]
pub struct LibraryFilter {
    /// A client id (`cli_…`).
    pub client: Option<String>,
    /// An app id (`ie.napkin.brief`).
    pub app: Option<String>,
}

impl LibraryFilter {
    /// From a query string (`client=cli_ab12cd34&app=ie.napkin.brief`).
    /// Unknown keys and empty values are ignored; values are percent-decoded.
    pub fn from_query(query: &str) -> Self {
        let pick = |k| crate::routes::query_param(query, k).filter(|v| !v.is_empty());
        Self {
            client: pick("client"),
            app: pick("app"),
        }
    }
}

/// A tool running on a document, as the landing says it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RunInfo {
    /// `idle`, `working`, `waiting` (on a person), `failed` or `done`.
    pub state: String,
    /// What it is doing, in words: "Building", "Waiting at gate".
    pub label: String,
    /// The stage it is at, when it says (`research`, `gate`): the shell turns it
    /// into what the circle's ring shows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    /// When that began, when the document says.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
}

/// One document in the library listing.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct LibraryItem {
    pub path: String,
    pub app_id: Option<String>,
    pub title: String,
    pub updated_at: String,
    /// Who it is for: the registry's id and name; the manifest's own name for
    /// an id the registry does not know. `null` when it has no client.
    pub client: Option<ClientRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<RecentState>,
    pub run: Option<RunInfo>,
}

/// The library route's answer.
#[derive(Serialize, Debug, PartialEq)]
pub struct LibraryListing {
    /// Newest first, uncapped, after the filter.
    pub items: Vec<LibraryItem>,
    /// Documents with no client at all, whatever the filter: what "Adopt
    /// clients" would be about.
    pub clients_unassigned: usize,
    /// Set when the client registry could not be read: the items then carry the
    /// client names their own documents hold, and `/clients` will say why. Absent when all is well.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry_error: Option<String>,
}

/// What one scan worked out about one document.
#[derive(Clone)]
struct Core {
    title: String,
    app_id: Option<String>,
    updated_at: String,
    client: Option<ClientRef>,
    state: Option<RecentState>,
    run: Option<RunInfo>,
}

type Key = (String, usize);

/// Per-tenant memory of [`scan_library`]; hold one beside the store.
/// `None` for a document that is blank (not work yet) or unreadable.
#[derive(Default)]
pub struct LibraryCache {
    seen: Mutex<HashMap<DocId, (Key, Option<Core>)>>,
    hits: AtomicUsize,
    misses: AtomicUsize,
    /// Jobs the host has heard of (middleware replies), told apart from the
    /// per-document cache: it is live state and is never keyed on a revision.
    runs: Arc<RunTracker>,
}

impl LibraryCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// The tracker a [`crate::Session`] of this tenant records into
    /// ([`crate::Session::with_runs`]); the listing reads it.
    pub fn runs(&self) -> Arc<RunTracker> {
        self.runs.clone()
    }

    /// `(hits, misses)` since this cache was made: what a test or a log reads
    /// to know the cache is doing its job.
    pub fn stats(&self) -> (usize, usize) {
        (
            self.hits.load(Ordering::Relaxed),
            self.misses.load(Ordering::Relaxed),
        )
    }
}

/// Every piece of work in the library, newest first, narrowed by `filter`.
pub fn scan_library(
    store: &dyn DocStore,
    cache: &LibraryCache,
    filter: &LibraryFilter,
) -> LibraryListing {
    let (registry, registry_error): (HashMap<String, ClientRecord>, Option<String>) =
        match clients::list(store, true) {
            Ok(list) => (list.into_iter().map(|c| (c.id.clone(), c)).collect(), None),
            Err(e) => (HashMap::new(), Some(e.to_string())),
        };

    let docs = store.documents();
    let mut items = Vec::new();
    let mut unassigned = 0;
    let mut live: Vec<DocId> = Vec::with_capacity(docs.len());
    for id in docs {
        let Ok(bytes) = store.read(&id) else { continue };
        live.push(id.clone());
        let core = {
            // Parse the manifest only to make the key; the rest is cached.
            let Ok(clan) = ClanFile::from_bytes(bytes) else {
                continue;
            };
            let key: Key = (clan.manifest().updated_at.clone(), clan.raw_bytes().len());
            let cached = cache
                .seen
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(&id)
                .filter(|(k, _)| *k == key)
                .map(|(_, c)| c.clone());
            match cached {
                Some(c) => {
                    cache.hits.fetch_add(1, Ordering::Relaxed);
                    c
                }
                None => {
                    cache.misses.fetch_add(1, Ordering::Relaxed);
                    let c = work_out(store, &id, &clan);
                    cache
                        .seen
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(id.clone(), (key, c.clone()));
                    c
                }
            }
        };
        let Some(core) = core else { continue };
        if core.client.is_none() {
            unassigned += 1;
        }
        if filter
            .client
            .as_deref()
            .is_some_and(|c| core.client.as_ref().map(|r| r.id.as_str()) != Some(c))
        {
            continue;
        }
        if filter
            .app
            .as_deref()
            .is_some_and(|a| core.app_id.as_deref() != Some(a))
        {
            continue;
        }
        let client = core.client.map(|r| match registry.get(&r.id) {
            Some(rec) => rec.as_ref(),
            None => r,
        });
        items.push(LibraryItem {
            path: id.to_string(),
            app_id: core.app_id,
            title: core.title,
            updated_at: core.updated_at,
            client,
            state: core.state,
            // What the host heard of a job first, else what the document records.
            run: cache.runs.run_for(&id).or(core.run),
        });
    }
    // A document that is gone must not be remembered.
    cache
        .seen
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|k, _| live.contains(k));
    items.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.path.cmp(&b.path))
    });
    LibraryListing {
        items,
        clients_unassigned: unassigned,
        registry_error,
    }
}

fn work_out(store: &dyn DocStore, id: &DocId, clan: &ClanFile) -> Option<Core> {
    // Opening a tool makes its document at once; until someone works in it,
    // it is not work (the same rule as the Launcher's recent list).
    let m = clan.manifest();
    // An installed app's template is kept as a document too; it is not work.
    if m.document_type.as_deref() == Some("template") || is_blank_in(store, clan) {
        return None;
    }
    Some(Core {
        title: m.title.clone(),
        app_id: m.app.as_ref().map(|a| a.app_id.clone()),
        updated_at: m.updated_at.clone(),
        client: m.client.clone(),
        state: recent_state(id.clone(), clan.raw_bytes().to_vec()),
        run: run_of(clan),
    })
}

/// A run the document itself records: Deck Maker's `data.run` (schema
/// `run.state` draft|building|gate|done|failed, `run.stage`, `run.since`).
/// Anything else is not a run: `None`.
fn run_of(clan: &ClanFile) -> Option<RunInfo> {
    let data: serde_yaml::Value = serde_yaml::from_slice(&clan.read_entry(DATA).ok()?).ok()?;
    let run = data.get("run")?;
    let state = run.get("state")?.as_str()?;
    let stage = run.get("stage").and_then(serde_yaml::Value::as_str);
    let (state, label) = match state {
        "building" => (
            "working",
            stage.map_or("Building".into(), |s| format!("Building: {s}")),
        ),
        "gate" => ("waiting", "Waiting at the gate".into()),
        "failed" => ("failed", "Failed".into()),
        "done" => ("done", "Done".into()),
        "draft" => ("idle", "Draft".into()),
        _ => return None,
    };
    Some(RunInfo {
        state: state.into(),
        label,
        stage: stage.map(String::from),
        since: run
            .get("since")
            .and_then(serde_yaml::Value::as_str)
            .map(String::from),
    })
}
