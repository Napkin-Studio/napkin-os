// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! A tenant's catalogue of manifests, kept by stamp
//! (features/store-scan-under-lock.clan, stage B).
//!
//! The reads that look another document up — a parent by its id
//! ([`crate::library::find_upstream`]), a source to link
//! ([`crate::library::find_source`]), what may be linked
//! ([`crate::library::attach_targets`]), what was made from a document
//! ([`crate::library::related`]) and a job's brief
//! ([`crate::ops::judge::brief_of`]) — used to open every document of the
//! tenant to find the few they want: O(documents) per request, which at a
//! thousand documents took seconds. They ask this catalogue for candidates
//! instead and load only those, each still checked as it always was
//! (`foreign()` on the loaded document, the fork and template rules).
//!
//! What it holds per document is read from its manifest only (no hash, no
//! signature, no data): ids, app, lineage, job. It is refreshed as the job
//! index is ([`crate::jobindex::IndexCache::get`]): every call stamps every
//! document ([`crate::store::PartStore::stamp`], a stat on the web's file
//! store) and reads again only the manifests whose stamp moved, under its own
//! lock, never a document's. Nothing is written from it, so a stale entry
//! (a filesystem giving the same stamp to different bytes, the risk the job
//! index already accepts) can hide a candidate until the next write, never
//! lose anything; and a lookup it answers with no candidate at all falls back
//! to the scan it replaced, logged.
//!
//! It is fed only by the store it is asked with — on the web, the tenant's
//! guarded store, which lists and reads no agency registry — and it holds ids
//! and manifest facts, never bytes. A store says it keeps one through
//! [`crate::store::Library::catalog`]; one that does not is scanned as before.
//! wasm32-clean: a mutex and a counter, no clock, no file system of its own.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use clan_sdk::ClanFile;

use crate::store::{DocId, DocStore};

/// What the catalogue knows of one document: its manifest's facts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// Where the store keeps it.
    pub id: DocId,
    /// `manifest.document_id`: what a spin-off records as its parent.
    pub document_id: String,
    pub app_id: Option<String>,
    /// A fork branch: shares its parent's id and is never the parent.
    pub fork: bool,
    /// An app template, never a document anyone made.
    pub template: bool,
    /// The parent it was spun off from (`lineage.carried.document_id`).
    pub carried: Option<String>,
    /// What is linked into it (`lineage.attached[].carried.document_id`).
    pub attached: Vec<String>,
    /// The job it is filed under.
    pub job: Option<String>,
}

impl Entry {
    fn of(id: &DocId, clan: &ClanFile) -> Self {
        let m = clan.manifest();
        Self {
            id: id.clone(),
            document_id: m.document_id().to_string(),
            app_id: m.app.as_ref().map(|a| a.app_id.clone()),
            fork: m.fork.is_some(),
            template: m.document_type.as_deref() == Some("template"),
            carried: m.carried().map(|c| c.document_id.clone()),
            attached: m
                .attached()
                .iter()
                .map(|a| a.carried.document_id.clone())
                .collect(),
            job: m.job.clone(),
        }
    }

    /// A document someone made: not a fork branch, not a template.
    pub fn is_document(&self) -> bool {
        !self.fork && !self.template
    }
}

/// Per document id, the stamp its manifest was read at and what it said
/// (`None`: not a CLAN file anyone can parse).
type Kept = HashMap<String, (String, Option<Arc<Entry>>)>;

/// One tenant's catalogue. Cheap to keep: about a kilobyte a document.
#[derive(Default)]
pub struct StoreCatalog {
    kept: Mutex<Kept>,
    /// How many manifests have been read: what a test counts.
    manifests: AtomicUsize,
}

impl StoreCatalog {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every document of `store` as its manifest says now: each one stamped,
    /// and the manifest of each whose stamp moved since the last call read
    /// again. A document gone from the store is forgotten; one whose stamp
    /// cannot be taken (refused, or gone meanwhile) is left out.
    pub fn entries(&self, store: &dyn DocStore) -> Vec<Arc<Entry>> {
        let stamps: Vec<(DocId, String)> = store
            .documents()
            .into_iter()
            .filter_map(|id| {
                let at = store.stamp(&id).ok()?.as_str().to_string();
                Some((id, at))
            })
            .collect();
        let mut kept = self.kept.lock().unwrap_or_else(|e| e.into_inner());
        let listed: std::collections::HashSet<&str> =
            stamps.iter().map(|(id, _)| id.as_str()).collect();
        kept.retain(|id, _| listed.contains(id.as_str()));
        let mut out = Vec::with_capacity(stamps.len());
        for (id, at) in &stamps {
            if let Some((was, entry)) = kept.get(id.as_str()) {
                if was == at {
                    out.extend(entry.clone());
                    continue;
                }
            }
            // Read under the stamp taken above: a write between the stamp and
            // the read costs one more read next time, never a stale entry kept.
            self.manifests.fetch_add(1, Ordering::Relaxed);
            let entry = store
                .read(id)
                .ok()
                .and_then(|bytes| ClanFile::from_bytes(bytes).ok())
                .map(|clan| Arc::new(Entry::of(id, &clan)));
            kept.insert(id.to_string(), (at.clone(), entry.clone()));
            out.extend(entry);
        }
        out
    }

    /// The documents whose entry `pick` keeps, in the store's order.
    pub fn find(&self, store: &dyn DocStore, pick: impl Fn(&Entry) -> bool) -> Vec<DocId> {
        self.entries(store)
            .into_iter()
            .filter(|e| pick(e))
            .map(|e| e.id.clone())
            .collect()
    }

    /// How many manifests this catalogue has read since it was made.
    pub fn manifests_read(&self) -> usize {
        self.manifests.load(Ordering::Relaxed)
    }

    /// Forget everything: the next call reads every manifest again.
    pub fn clear(&self) {
        self.kept.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }
}

impl StoreCatalog {
    /// The documents whose manifest could not be read at the last refresh: the only ones the catalogue
    /// cannot vouch for.
    pub fn unreadable(&self) -> Vec<DocId> {
        self.kept
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|(_, (_, e))| e.is_none())
            .map(|(id, _)| DocId::new(id.clone()))
            .collect()
    }
}

/// The candidates `store`'s catalogue gives for `pick`, or `None` when the
/// store keeps no catalogue (the caller scans, as before).
pub fn candidates(store: &dyn DocStore, pick: impl Fn(&Entry) -> bool) -> Option<Vec<DocId>> {
    store.catalog().map(|c| c.find(store, pick))
}

/// For a lookup of one document: the catalogue's candidates, just refreshed (every document stamped). When
/// it names none, the document is not in the store, unless it is one of the few whose manifest the
/// catalogue could not read: only those are handed back to be opened (logged). Never the whole tenant, so
/// a caller naming an id that is not there cannot make a request read every document. `None` without a
/// catalogue.
pub fn lookup(
    store: &dyn DocStore,
    what: &str,
    pick: impl Fn(&Entry) -> bool,
) -> Option<Vec<DocId>> {
    let catalog = store.catalog()?;
    let hits = catalog.find(store, pick);
    if !hits.is_empty() {
        return Some(hits);
    }
    let unreadable = catalog.unreadable();
    if !unreadable.is_empty() {
        crate::log::log(&format!(
            "catalog: no candidate in {what}; opening the {} document(s) whose manifest it could not read",
            unreadable.len()
        ));
    }
    Some(unreadable)
}
