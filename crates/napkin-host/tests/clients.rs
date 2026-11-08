// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The client registry and the library listing, against an in-memory store
//! (so no test touches a real library, and nothing here needs a filesystem:
//! the same code runs in the browser build).

use std::collections::HashMap;
use std::sync::Mutex;

use clan_sdk::{
    create, make_template, AppInfo, ClanBuilder, ClanFile, CreateOptions, MakeTemplateOptions,
    SpinoffSpec,
};
use napkin_host::clients::{self, ClientPatch};
use napkin_host::{
    create_instance, create_instance_for, install_app, scan_library, spinoff_document, Change, Ctx,
    DocId, HostError, HostResult, Library, LibraryCache, LibraryFilter, PartStore, Version,
};

#[derive(Default)]
struct MemStore {
    files: Mutex<HashMap<String, Vec<u8>>>,
}

impl PartStore for MemStore {
    fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
        self.files
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| HostError::not_found(format!("no such document: {id}")))
    }
    fn exists(&self, id: &DocId) -> bool {
        self.files.lock().unwrap().contains_key(id.as_str())
    }
    fn apply(&self, change: &Change) -> HostResult<Version> {
        self.files
            .lock()
            .unwrap()
            .insert(change.doc.to_string(), change.bytes.clone());
        Ok(change.archive_version())
    }
}

impl Library for MemStore {
    fn app_candidates(&self) -> Vec<DocId> {
        self.keys("apps/")
    }
    fn app_template(&self, app_id: &str) -> DocId {
        DocId::new(format!("apps/{app_id}/app.clan"))
    }
    fn documents(&self) -> Vec<DocId> {
        self.keys("docs/")
    }
    fn new_document(&self, app_id: &str, id_short: &str) -> HostResult<DocId> {
        Ok(DocId::new(format!("docs/{app_id}-{id_short}.clan")))
    }
    fn home(&self, version_tag: &str) -> HostResult<DocId> {
        Ok(DocId::new(format!("home-{version_tag}.clan")))
    }
    fn fork_branch(&self, parent: &DocId, agent: &str) -> DocId {
        DocId::new(format!("{parent}.{agent}.clan"))
    }
}

impl MemStore {
    fn keys(&self, prefix: &str) -> Vec<DocId> {
        let mut v: Vec<DocId> = self
            .files
            .lock()
            .unwrap()
            .keys()
            .filter(|k| k.starts_with(prefix))
            .map(DocId::new)
            .collect();
        v.sort();
        v
    }
}

const BRIEF: &str = "ie.napkin.brief";
const DECK: &str = "ie.napkin.deck-maker";

fn template(app_id: &str, name: &str, spinoff: Option<SpinoffSpec>) -> Vec<u8> {
    let base = ClanFile::from_bytes(
        create(CreateOptions {
            title: name.into(),
            brief: "fixture".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    make_template(
        &base,
        AppInfo {
            home: None,
            name: name.into(),
            app_id: app_id.into(),
            version: "1.0.0".into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: None,
            prompt_templates: vec![],
            data_seed: None,
            spinoff,
            attach: None,
        },
        MakeTemplateOptions::default(),
    )
    .unwrap()
}

fn store_with_apps() -> MemStore {
    let s = MemStore::default();
    install_app(&s, template(BRIEF, "Brief Maker", None)).unwrap();
    install_app(
        &s,
        template(
            DECK,
            "Deck Maker",
            Some(SpinoffSpec {
                accepts: vec![BRIEF.into()],
                map: Some("brief".into()),
                ..Default::default()
            }),
        ),
    )
    .unwrap();
    s
}

/// Rewrite `doc`'s data layer, as a tool would have by working in it.
fn set_data(s: &MemStore, doc: &DocId, yaml: &str) {
    let clan = ClanFile::from_bytes(s.read(doc).unwrap()).unwrap();
    let mut m = clan.manifest().clone();
    m.next_revision();
    m.updated_at = format!("2026-11-04T10:00:{:02}Z", doc.as_str().len() % 60);
    let mut b = ClanBuilder::new(m);
    for (p, by) in clan.read_all_entries().unwrap() {
        if p != "manifest.yaml" && p != "shared/data.yaml" {
            b.add_entry(p, by);
        }
    }
    b.add_entry("shared/data.yaml", yaml.as_bytes().to_vec());
    s.files
        .lock()
        .unwrap()
        .insert(doc.to_string(), b.build().unwrap());
}

/// A worked document: it has its own title, so it is not blank.
fn work(s: &MemStore, app: &str, title: &str, client: Option<&clients::ClientRecord>) -> DocId {
    create_instance_for(s, app, Some(title.into()), client).unwrap()
}

fn ctx() -> Ctx {
    Ctx::local()
}

fn list(s: &MemStore, f: &LibraryFilter) -> napkin_host::LibraryListing {
    scan_library(s, &LibraryCache::new(), f)
}

#[test]
fn an_empty_store_has_no_clients_and_reading_does_not_create_the_registry() {
    let s = MemStore::default();
    assert!(clients::list(&s, true).unwrap().is_empty());
    assert!(
        s.files.lock().unwrap().is_empty(),
        "a read writes nothing: the registry is made by the first client"
    );
    assert_eq!(clients::get(&s, "cli_00000000").unwrap_err().status, 404);
}

#[test]
fn the_registry_is_one_valid_clan_document_outside_the_library() {
    let s = store_with_apps();
    let a = clients::create_client(&s, &ctx(), "Client A", None).unwrap();
    let home = s.home("clients-v1").unwrap();
    let bytes = s.read(&home).unwrap();
    let clan = ClanFile::from_bytes(bytes).unwrap();
    assert_eq!(
        clan.manifest().document_type.as_deref(),
        Some("client-registry")
    );
    assert!(clan_sdk::validate(&clan).is_valid());
    assert!(!s.documents().contains(&home), "never in documents()");
    // A second client is a write on top of it, not a second file.
    clients::create_client(&s, &ctx(), "Client B", None).unwrap();
    let again = ClanFile::from_bytes(s.read(&home).unwrap()).unwrap();
    assert_ne!(clan.manifest().id, again.manifest().id, "a new revision");
    assert_eq!(
        clan.manifest().document_id(),
        again.manifest().document_id(),
        "the same document"
    );
    assert_eq!(clients::list(&s, false).unwrap().len(), 2);
    assert_eq!(a.owner, "human:local");
}

#[test]
fn names_are_cleaned_and_compared_without_case_or_spacing() {
    let s = MemStore::default();
    let a = clients::create_client(&s, &ctx(), "  Client\t  A ", None).unwrap();
    assert_eq!(a.name, "Client A");
    assert_eq!(
        clients::create_client(&s, &ctx(), "CLIENT a", None)
            .unwrap_err()
            .status,
        409
    );
    for bad in ["", "  ", "a\u{7}b", &"x".repeat(61)] {
        assert_eq!(
            clients::create_client(&s, &ctx(), bad, None)
                .unwrap_err()
                .status,
            400,
            "{bad:?}"
        );
    }
    // Non-ASCII names are fine: ids, not names, are the links.
    let c = clients::create_client(&s, &ctx(), "Ólafsson & Daughters", None).unwrap();
    assert!(clan_sdk::is_client_id(&c.id));
    assert_eq!(c.initials, "Ó&".to_string().to_uppercase());
    assert_eq!(clients::initials_of("Client A"), "CA");
    assert_eq!(clients::initials_of("jameson"), "JA");
    assert_eq!(clients::initials_of("a b c"), "AB");
}

#[test]
fn rename_archive_and_restore_keep_the_id_and_the_documents() {
    let s = store_with_apps();
    let a = clients::create_client(&s, &ctx(), "Client A", None).unwrap();
    let doc = work(&s, BRIEF, "A's brief", Some(&a));

    let r = clients::update_client(
        &s,
        &ctx(),
        &a.id,
        ClientPatch {
            name: Some("Client Alpha".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        (r.id.as_str(), r.name.as_str()),
        (a.id.as_str(), "Client Alpha")
    );
    assert_eq!(r.initials, "CA");
    // Hand-set initials survive a later rename.
    clients::update_client(
        &s,
        &ctx(),
        &a.id,
        ClientPatch {
            initials: Some("alp".into()),
            material: Some("stone".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let r = clients::update_client(
        &s,
        &ctx(),
        &a.id,
        ClientPatch {
            name: Some("Alpha Co".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!((r.initials.as_str(), r.material.as_str()), ("ALP", "stone"));
    assert_eq!(
        clients::update_client(
            &s,
            &ctx(),
            &a.id,
            ClientPatch {
                material: Some("glass".into()),
                ..Default::default()
            },
        )
        .unwrap_err()
        .status,
        400
    );

    let ar = clients::set_archived(&s, &ctx(), &a.id, true).unwrap();
    assert!(ar.is_archived());
    assert!(clients::list(&s, false).unwrap().is_empty());
    assert_eq!(clients::list(&s, true).unwrap().len(), 1);
    // The documents still resolve to it, under its current name.
    let lib = list(
        &s,
        &LibraryFilter {
            client: Some(a.id.clone()),
            app: None,
        },
    );
    assert_eq!(lib.items.len(), 1);
    assert_eq!(lib.items[0].path, doc.to_string());
    assert_eq!(lib.items[0].client.as_ref().unwrap().name, "Alpha Co");
    assert!(!clients::set_archived(&s, &ctx(), &a.id, false)
        .unwrap()
        .is_archived());
    assert_eq!(
        clients::set_archived(&s, &ctx(), "cli_00000000", true)
            .unwrap_err()
            .status,
        404
    );
}

#[test]
fn a_document_made_for_a_client_carries_it_and_a_spinoff_keeps_it() {
    let s = store_with_apps();
    let a = clients::create_client(&s, &ctx(), "Client A", None).unwrap();
    let doc = work(&s, BRIEF, "Brief for A", Some(&a));
    let clan = ClanFile::from_bytes(s.read(&doc).unwrap()).unwrap();
    let c = clan.manifest().client.as_ref().expect("born with a client");
    assert_eq!(
        (c.id.as_str(), c.name.as_str()),
        (a.id.as_str(), "Client A")
    );
    assert!(clan_sdk::validate(&clan).is_valid());

    let deck = spinoff_document(&s, &doc, DECK, Some("Deck for A".into()), None).unwrap();
    let spun = ClanFile::from_bytes(s.read(&deck).unwrap()).unwrap();
    assert_eq!(spun.manifest().client.as_ref().unwrap().id, a.id);
    assert_eq!(spun.manifest().app.as_ref().unwrap().app_id, DECK);

    // A document with no client spins off to one with none.
    let plain = work(&s, BRIEF, "Plain", None);
    let deck2 = spinoff_document(&s, &plain, DECK, Some("Deck".into()), None).unwrap();
    assert!(ClanFile::from_bytes(s.read(&deck2).unwrap())
        .unwrap()
        .manifest()
        .client
        .is_none());
}

#[test]
fn a_blank_for_one_client_is_never_handed_to_another() {
    let s = store_with_apps();
    let a = clients::create_client(&s, &ctx(), "Client A", None).unwrap();
    let b = clients::create_client(&s, &ctx(), "Client B", None).unwrap();
    let for_a = create_instance_for(&s, BRIEF, None, Some(&a)).unwrap();
    assert_eq!(
        create_instance_for(&s, BRIEF, None, Some(&a)).unwrap(),
        for_a,
        "reused for the same client"
    );
    let for_b = create_instance_for(&s, BRIEF, None, Some(&b)).unwrap();
    let for_none = create_instance(&s, BRIEF, None).unwrap();
    assert_ne!(for_a, for_b);
    assert_ne!(for_a, for_none);
    assert_ne!(for_b, for_none);
    assert!(list(&s, &LibraryFilter::default()).items.is_empty());
}

#[test]
fn an_archived_client_takes_no_new_work() {
    let s = store_with_apps();
    let a = clients::create_client(&s, &ctx(), "Client A", None).unwrap();
    let a = clients::set_archived(&s, &ctx(), &a.id, true).unwrap();
    assert_eq!(
        create_instance_for(&s, BRIEF, Some("x".into()), Some(&a))
            .unwrap_err()
            .status,
        409
    );
}

#[test]
fn the_library_is_uncapped_newest_first_and_leaves_out_what_is_not_work() {
    let s = store_with_apps();
    let a = clients::create_client(&s, &ctx(), "Client A", None).unwrap();
    for i in 0..30 {
        let d = work(
            &s,
            BRIEF,
            &format!("Doc {i:02}"),
            (i % 3 == 0).then_some(&a),
        );
        // Spread the times so the order is checkable.
        set_data(&s, &d, &format!("n: {i}\n"));
    }
    create_instance(&s, DECK, None).unwrap(); // blank: not work
    let all = list(&s, &LibraryFilter::default());
    assert_eq!(all.items.len(), 30, "no cap, and the blank is left out");
    assert_eq!(all.clients_unassigned, 20);
    assert!(all
        .items
        .windows(2)
        .all(|w| w[0].updated_at >= w[1].updated_at));
    // The installed apps are documents of their own kind, never work.
    assert!(all.items.iter().all(|i| i.app_id.as_deref() == Some(BRIEF)));
}

#[test]
fn an_id_the_registry_does_not_know_keeps_the_name_its_document_carries() {
    let s = store_with_apps();
    let ghost = clients::ClientRecord {
        id: clan_sdk::new_client_id(),
        name: "Client Z".into(),
        initials: "CZ".into(),
        material: "pearl".into(),
        owner: "human:x".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        archived_at: None,
    };
    work(&s, BRIEF, "Orphan", Some(&ghost));
    let lib = list(&s, &LibraryFilter::default());
    let c = lib.items[0].client.as_ref().unwrap();
    assert_eq!(
        (c.id.as_str(), c.name.as_str()),
        (ghost.id.as_str(), "Client Z")
    );
    assert_eq!(lib.clients_unassigned, 0);
}

#[test]
fn a_deck_run_is_read_from_the_document_and_nothing_else_is_a_run() {
    let s = store_with_apps();
    let building = work(&s, DECK, "Building", None);
    set_data(
        &s,
        &building,
        "run:\n  state: building\n  stage: Layout\n  since: \"2026-11-04T09:00:00Z\"\n",
    );
    let gate = work(&s, DECK, "At gate", None);
    set_data(&s, &gate, "run:\n  state: gate\n");
    let failed = work(&s, DECK, "Failed", None);
    set_data(&s, &failed, "run:\n  state: failed\n");
    let junk = work(&s, DECK, "Junk", None);
    set_data(&s, &junk, "run:\n  state: exploding\n");
    let none = work(&s, DECK, "None", None);
    set_data(&s, &none, "n: 1\n");

    let lib = list(&s, &LibraryFilter::default());
    let run = |t: &str| lib.items.iter().find(|i| i.title == t).unwrap().run.clone();
    let b = run("Building").unwrap();
    assert_eq!(b.state, "working");
    assert_eq!(b.label, "Building: Layout");
    assert_eq!(b.since.as_deref(), Some("2026-11-04T09:00:00Z"));
    assert_eq!(run("At gate").unwrap().state, "waiting");
    assert_eq!(run("Failed").unwrap().state, "failed");
    assert!(run("Junk").is_none());
    assert!(run("None").is_none());
}

#[test]
fn the_cache_works_each_document_out_once_and_a_write_is_one_miss() {
    let s = store_with_apps();
    let docs: Vec<DocId> = (0..5)
        .map(|i| work(&s, BRIEF, &format!("Doc {i}"), None))
        .collect();
    let cache = LibraryCache::new();
    let f = LibraryFilter::default();
    // Two apps' templates are in the store but not in documents().
    let first = scan_library(&s, &cache, &f);
    assert_eq!(cache.stats(), (0, 5));
    assert_eq!(scan_library(&s, &cache, &f), first);
    assert_eq!(cache.stats(), (5, 5));
    set_data(&s, &docs[2], "touched: yes\n");
    scan_library(&s, &cache, &f);
    assert_eq!(cache.stats(), (9, 6), "one document changed, one miss");
}

#[test]
fn adopt_makes_clients_from_chosen_names_and_links_only_their_documents() {
    let s = store_with_apps();
    let one = work(&s, BRIEF, "Brief one", None);
    set_data(&s, &one, "client: Client  A\n");
    let two = work(&s, BRIEF, "Brief two", None);
    set_data(&s, &two, "client: client a\n");
    let three = work(&s, DECK, "Research", None);
    set_data(&s, &three, "campaign:\n  brand: Client B\n");
    let other = work(&s, BRIEF, "Not chosen", None);
    set_data(&s, &other, "client: Client C\n");

    // What is on offer: free-text names with no client yet, by how many name them.
    let offer = clients::legacy_names(&s).unwrap();
    assert_eq!(offer[0], ("Client A".to_string(), 2));
    assert_eq!(offer.len(), 3);

    let out = clients::adopt(&s, &ctx(), &["Client A".into(), "Client B".into()]).unwrap();
    assert_eq!(out.created.len(), 2);
    assert_eq!(out.linked, 3);
    let lib = list(&s, &LibraryFilter::default());
    let client_of = |t: &str| {
        lib.items
            .iter()
            .find(|i| i.title == t)
            .unwrap()
            .client
            .as_ref()
            .map(|c| c.name.clone())
    };
    assert_eq!(client_of("Brief one").as_deref(), Some("Client A"));
    assert_eq!(client_of("Brief two").as_deref(), Some("Client A"));
    assert_eq!(client_of("Research").as_deref(), Some("Client B"));
    assert_eq!(
        client_of("Not chosen"),
        None,
        "only what was chosen is linked"
    );
    assert_eq!(lib.clients_unassigned, 1);

    // Adopting again changes nothing and makes nothing.
    let again = clients::adopt(&s, &ctx(), &["CLIENT A".into()]).unwrap();
    assert_eq!((again.created.len(), again.linked), (0, 0));
    assert_eq!(clients::list(&s, true).unwrap().len(), 2);
    // A document that already has a client is never re-linked.
    let linked = ClanFile::from_bytes(s.read(&one).unwrap()).unwrap();
    assert!(clan_sdk::validate(&linked).is_valid());
    assert_eq!(
        linked.manifest().updated_at,
        "2026-11-04T10:00:".to_string() + &format!("{:02}Z", one.as_str().len() % 60),
        "linking is not work: updated_at does not move"
    );
}

#[test]
fn filters_come_from_the_query_string() {
    let f = LibraryFilter::from_query("client=cli_0a1b2c3d&app=ie.napkin.brief&x=1");
    assert_eq!(f.client.as_deref(), Some("cli_0a1b2c3d"));
    assert_eq!(f.app.as_deref(), Some("ie.napkin.brief"));
    assert_eq!(LibraryFilter::from_query(""), LibraryFilter::default());
    assert_eq!(
        LibraryFilter::from_query("client=&app=ie%2Enapkin"),
        LibraryFilter {
            client: None,
            app: Some("ie.napkin".into())
        }
    );
}

#[test]
fn an_empty_or_absent_client_id_is_no_client_and_an_unknown_one_is_404() {
    let s = store_with_apps();
    let a = clients::create_client(&s, &ctx(), "Client A", None).unwrap();
    assert!(clients::get_named(&s, None).unwrap().is_none());
    assert!(clients::get_named(&s, Some("")).unwrap().is_none());
    assert!(clients::get_named(&s, Some("  ")).unwrap().is_none());
    assert_eq!(
        clients::get_named(&s, Some(&a.id)).unwrap().unwrap().id,
        a.id
    );
    assert_eq!(
        clients::get_named(&s, Some("cli_00000000"))
            .unwrap_err()
            .status,
        404
    );
}

#[test]
fn an_unreadable_registry_is_said_in_the_listing_and_not_taken_for_empty() {
    let s = store_with_apps();
    let a = clients::create_client(&s, &ctx(), "Client A", None).unwrap();
    work(&s, BRIEF, "Spring brief", Some(&a));
    let ok = list(&s, &LibraryFilter::default());
    assert!(ok.registry_error.is_none());
    // Overwrite the registry with something that is not a clan.
    s.files
        .lock()
        .unwrap()
        .insert("home-clients-v1.clan".into(), b"not a clan".to_vec());
    let bad = list(&s, &LibraryFilter::default());
    assert!(bad.registry_error.is_some());
    assert_eq!(bad.items.len(), 1, "the work is still listed");
}

// ── What is running (feature landing-circles, phase 3) ──────────────────────

use napkin_host::Session;
use std::sync::Arc;

fn job_reply(id: &str, state: &str, stage: &str) -> serde_json::Value {
    serde_json::json!({ "ok": true, "status": 200, "endpoint": "http://middleware.test/v1/tasks",
        "error": null,
        "data": { "api": "napkin.middleware/1", "task": "start_campaign",
                  "handler": "start_campaign@1.0",
                  "job": { "id": id, "state": state, "stage": stage,
                           "progress": { "done": 2, "total": 6 },
                           "started_at": "2026-11-04T09:00:00Z" },
                  "result": { "summary": "x" }, "change": null, "trace": {} } })
}

fn tracked_session(s: &Arc<MemStore>, cache: &LibraryCache, doc: &DocId) -> Session {
    let session = Session::new(s.clone()).with_runs(cache.runs());
    session.open(doc.clone()).unwrap();
    session
}

#[test]
fn a_middleware_reply_puts_the_job_on_the_library_and_done_takes_it_off() {
    let s = Arc::new(store_with_apps());
    let a = clients::create_client(&*s, &ctx(), "Client A", None).unwrap();
    let doc = work(&*s, BRIEF, "Spring brief", Some(&a));
    let other = work(&*s, BRIEF, "Quiet brief", Some(&a));
    let cache = LibraryCache::new();
    let session = tracked_session(&s, &cache, &doc);
    let f = LibraryFilter::default();
    let run = |t: &str| {
        scan_library(&*s, &cache, &f)
            .items
            .into_iter()
            .find(|i| i.title == t)
            .unwrap()
            .run
    };
    assert!(run("Spring brief").is_none());

    session.settle_middleware(session.ctx(), job_reply("job_1", "queued", "extract"));
    let r = run("Spring brief").expect("a queued job is working");
    assert_eq!(r.state, "working");
    assert_eq!(r.stage.as_deref(), Some("extract"));
    assert_eq!(r.label, "Working: extract (2 of 6)");
    assert!(
        run("Quiet brief").is_none(),
        "only the document the job is on"
    );

    session.settle_middleware(session.ctx(), job_reply("job_1", "needs_input", "select"));
    assert_eq!(run("Spring brief").unwrap().state, "waiting");

    session.settle_middleware(session.ctx(), job_reply("job_1", "running", "research"));
    assert_eq!(run("Spring brief").unwrap().state, "working");

    session.settle_middleware(session.ctx(), job_reply("job_1", "failed", "research"));
    assert_eq!(run("Spring brief").unwrap().state, "failed");

    session.settle_middleware(session.ctx(), job_reply("job_2", "running", "extract"));
    session.settle_middleware(session.ctx(), job_reply("job_2", "done", "report"));
    assert!(run("Spring brief").is_none());
    let _ = other;
}

#[test]
fn a_reply_that_is_not_the_middleware_is_never_a_run() {
    let s = Arc::new(store_with_apps());
    let doc = work(&*s, BRIEF, "Spring brief", None);
    let cache = LibraryCache::new();
    let session = tracked_session(&s, &cache, &doc);
    let mut reply = job_reply("job_1", "running", "extract");
    reply["data"]["api"] = serde_json::json!("somebody.else/9");
    session.settle_middleware(session.ctx(), reply);
    let mut failed = job_reply("job_1", "running", "extract");
    failed["ok"] = serde_json::json!(false);
    session.settle_middleware(session.ctx(), failed);
    assert!(cache.runs().is_empty());
    assert!(
        scan_library(&*s, &cache, &LibraryFilter::default()).items[0]
            .run
            .is_none()
    );
}

#[test]
fn the_tracker_wins_over_a_decks_own_run_and_a_deck_run_stands_alone() {
    let s = Arc::new(store_with_apps());
    let deck = work(&*s, DECK, "Deck", None);
    set_data(&*s, &deck, "run:\n  state: building\n  stage: Layout\n");
    let cache = LibraryCache::new();
    let f = LibraryFilter::default();
    let lib = scan_library(&*s, &cache, &f);
    assert_eq!(lib.items[0].run.as_ref().unwrap().label, "Building: Layout");
    let session = tracked_session(&s, &cache, &deck);
    session.settle_middleware(session.ctx(), job_reply("job_1", "needs_input", "select"));
    assert_eq!(
        scan_library(&*s, &cache, &f).items[0]
            .run
            .as_ref()
            .unwrap()
            .state,
        "waiting"
    );
    session.settle_middleware(session.ctx(), job_reply("job_1", "done", "report"));
    assert_eq!(
        scan_library(&*s, &cache, &f).items[0]
            .run
            .as_ref()
            .unwrap()
            .label,
        "Building: Layout",
        "with no job, the document's own run is what is said"
    );
}

#[test]
fn an_open_contest_is_needs_you_in_the_listing() {
    let s = store_with_apps();
    let doc = work(&s, BRIEF, "Contested", None);
    let calm = work(&s, BRIEF, "Calm", None);
    set_data(&s, &calm, "n: 1\n");
    set_data(
        &s,
        &doc,
        "selection:\n  contested:\n  - id: c1\n    key: tone\n    status: open\n    values:\n    - fact_id: f1\n    - fact_id: f2\n",
    );
    let lib = list(&s, &LibraryFilter::default());
    let state = |t: &str| {
        lib.items
            .iter()
            .find(|i| i.title == t)
            .unwrap()
            .state
            .clone()
    };
    assert_eq!(state("Contested").unwrap().needs_you, 1);
    assert_eq!(state("Calm").unwrap().needs_you, 0);
}

#[test]
fn legacy_offer_names_the_documents_for_the_shell() {
    let s = store_with_apps();
    let one = work(&s, BRIEF, "Brief one", None);
    set_data(&s, &one, "client: Client A\n");
    let two = work(&s, BRIEF, "Brief two", None);
    set_data(&s, &two, "client: client  a\n");
    let offer = clients::legacy_offer(&s).unwrap();
    assert_eq!(
        serde_json::to_value(&offer).unwrap(),
        serde_json::json!([{ "name": "Client A", "documents": 2 }])
    );
    // Once adopted, the name is no longer on offer.
    clients::adopt(&s, &ctx(), &["Client A".into()]).unwrap();
    assert!(clients::legacy_offer(&s).unwrap().is_empty());
}
