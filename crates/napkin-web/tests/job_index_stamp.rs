// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The job index's change signal on the web's file store (features/job-index-dashboard.clan, decision of
//! 2026-11-12; docs/contracts/os-layer.md 13.2): the index reads a document again only when its stamp moved,
//! and the stamp of a `TenantStore` document is what a stat gives, never its bytes. So an unchanged tenant
//! costs no read and no hash, and a write by any handle on the same directory (another web task on the same
//! disk) is seen on the next read.

use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::{TimeZone, Utc};
use clan_sdk::{ClanBuilder, ClanFile};
use napkin_host::jobindex::{IndexCache, JobIndex};
use napkin_host::jobs::{self, NewJob};
use napkin_host::{
    clients, Actor, Change, Ctx, DocId, HostResult, Library, PartStore, Stamp, Version,
};
use napkin_web::store::{doc_id, TenantStore};

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 12, 10, 0, 0).unwrap()
}

/// A Brief Maker document titled `title`, filed under `job` for `client`.
fn bytes(title: &str, client: &str, job: &str) -> Vec<u8> {
    let base = ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: title.into(),
            brief: "a document".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut m = base.manifest().clone();
    m.app = Some(clan_sdk::AppInfo {
        home: None,
        name: "Brief Maker".into(),
        app_id: "ie.napkin.brief-maker".into(),
        version: "1.0.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach: None,
    });
    m.client = Some(clan_sdk::ClientRef {
        id: client.into(),
        name: "Client A".into(),
    });
    m.job = Some(job.into());
    let mut b = ClanBuilder::new(m);
    for (path, bytes) in base.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH {
            b.add_entry(path, bytes);
        }
    }
    b.build().unwrap()
}

/// A tenant with one client, the job J001 and `n` documents filed under it.
fn tenant(dir: &std::path::Path, n: usize) -> (TenantStore, String) {
    let store = TenantStore::new(dir.to_path_buf());
    let me = Ctx::new(Actor::human("niamh@wk").unwrap());
    let client = clients::create_client(&store, &me, "Client A", None).unwrap();
    jobs::create_job(
        &store,
        &me,
        NewJob {
            number: Some("J001".into()),
            client_id: client.id.clone(),
            title: Some("J001".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let one = bytes("J001 document", &client.id, "J001");
    for i in 0..n {
        store
            .apply(&Change::create(doc_id(&format!("d{i:04}")), one.clone()))
            .unwrap();
    }
    (store, client.id)
}

fn titles(index: &JobIndex) -> Vec<(String, String)> {
    index
        .job("J001")
        .map(|j| {
            j.documents
                .iter()
                .map(|d| (d.path.clone(), d.title.clone()))
                .collect()
        })
        .unwrap_or_default()
}

/// Another web task: its own store handle on the same directory, writing as `apply` does.
fn write_from_another_task(dir: &std::path::Path, id: &DocId, body: Vec<u8>) {
    let other = TenantStore::new(dir.to_path_buf());
    let base = other.version(id).unwrap();
    other
        .apply(&Change::replace(id.clone(), base, body))
        .unwrap();
}

/// The store, counting what reads a document's bytes: `read`, and `version` (a hash of the bytes).
struct Counted<'a> {
    inner: &'a TenantStore,
    reads: AtomicUsize,
    hashes: AtomicUsize,
}

impl PartStore for Counted<'_> {
    fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
        self.reads.fetch_add(1, Ordering::Relaxed);
        self.inner.read(id)
    }
    fn exists(&self, id: &DocId) -> bool {
        self.inner.exists(id)
    }
    fn version(&self, id: &DocId) -> HostResult<Version> {
        self.hashes.fetch_add(1, Ordering::Relaxed);
        self.inner.version(id)
    }
    fn stamp(&self, id: &DocId) -> HostResult<Stamp> {
        self.inner.stamp(id)
    }
    fn apply(&self, change: &Change) -> HostResult<Version> {
        self.inner.apply(change)
    }
}

impl Library for Counted<'_> {
    fn app_candidates(&self) -> Vec<DocId> {
        self.inner.app_candidates()
    }
    fn app_template(&self, app_id: &str) -> DocId {
        self.inner.app_template(app_id)
    }
    fn documents(&self) -> Vec<DocId> {
        self.inner.documents()
    }
    fn new_document(&self, app_id: &str, id_short: &str) -> HostResult<DocId> {
        self.inner.new_document(app_id, id_short)
    }
    fn home(&self, version_tag: &str) -> HostResult<DocId> {
        self.inner.home(version_tag)
    }
    fn fork_branch(&self, parent: &DocId, agent: &str) -> DocId {
        self.inner.fork_branch(parent, agent)
    }
}

#[test]
fn an_unchanged_tenant_of_three_hundred_documents_reads_and_hashes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (store, _) = tenant(dir.path(), 300);
    let counted = Counted {
        inner: &store,
        reads: AtomicUsize::new(0),
        hashes: AtomicUsize::new(0),
    };
    let cache = IndexCache::new();
    // the first read after start is one full build: every document is read
    let first = cache.get(&counted, now()).unwrap();
    assert_eq!(first.job("J001").unwrap().documents.len(), 300);
    assert!(counted.reads.load(Ordering::Relaxed) >= 300);
    counted.reads.store(0, Ordering::Relaxed);
    counted.hashes.store(0, Ordering::Relaxed);
    for _ in 0..3 {
        assert_eq!(cache.get(&counted, now()).unwrap(), first);
    }
    assert_eq!(
        (
            counted.reads.load(Ordering::Relaxed),
            counted.hashes.load(Ordering::Relaxed)
        ),
        (0, 0),
        "an index read on an unchanged tenant reads no document and hashes none"
    );
    assert_eq!(first, JobIndex::build(&store, now()).unwrap());
}

#[test]
fn a_write_by_another_task_on_the_same_disk_is_seen_and_the_cache_equals_a_fresh_build() {
    let dir = tempfile::tempdir().unwrap();
    let (store, client) = tenant(dir.path(), 5);
    let cache = IndexCache::new();
    cache.get(&store, now()).unwrap();
    let id = doc_id("d0002");
    write_from_another_task(
        dir.path(),
        &id,
        bytes("Renamed by task two", &client, "J001"),
    );
    let index = cache.get(&store, now()).unwrap();
    assert!(titles(&index).contains(&(id.to_string(), "Renamed by task two".into())));
    assert_eq!(
        index,
        JobIndex::build(&store, now()).unwrap(),
        "the cached index equals a fresh build"
    );
}

#[test]
fn two_writes_of_equal_size_in_quick_succession_are_both_seen() {
    let dir = tempfile::tempdir().unwrap();
    let (store, client) = tenant(dir.path(), 3);
    let id = doc_id("d0001");
    let a = bytes("Version AAAA", &client, "J001");
    // a second title whose packed document is exactly as long as the first (compression varies with the words)
    let (title_b, b) = (0..1000)
        .map(|i| format!("Version B{i:03}"))
        .map(|t| {
            let b = bytes(&t, &client, "J001");
            (t, b)
        })
        .find(|(_, b)| b.len() == a.len())
        .expect("a title of the same packed size");
    assert_eq!(
        a.len(),
        b.len(),
        "the two bodies are the same size, so size alone cannot tell them apart"
    );
    let cache = IndexCache::new();
    cache.get(&store, now()).unwrap();
    write_from_another_task(dir.path(), &id, a);
    let seen_a = titles(&cache.get(&store, now()).unwrap());
    write_from_another_task(dir.path(), &id, b); // at once: likely inside one tick of a coarse clock
    let seen_b = titles(&cache.get(&store, now()).unwrap());
    assert!(seen_a.contains(&(id.to_string(), "Version AAAA".into())));
    assert!(seen_b.contains(&(id.to_string(), title_b)));
}

#[test]
fn a_document_removed_or_added_is_seen() {
    let dir = tempfile::tempdir().unwrap();
    let (store, client) = tenant(dir.path(), 4);
    let cache = IndexCache::new();
    assert_eq!(titles(&cache.get(&store, now()).unwrap()).len(), 4);
    std::fs::remove_file(dir.path().join("documents/d0003.clan")).unwrap();
    assert_eq!(titles(&cache.get(&store, now()).unwrap()).len(), 3);
    let other = TenantStore::new(dir.path().to_path_buf());
    other
        .apply(&Change::create(
            doc_id("new"),
            bytes("Added by task two", &client, "J001"),
        ))
        .unwrap();
    let index = cache.get(&store, now()).unwrap();
    assert!(titles(&index).contains(&("doc-new".into(), "Added by task two".into())));
    assert_eq!(index, JobIndex::build(&store, now()).unwrap());
}
