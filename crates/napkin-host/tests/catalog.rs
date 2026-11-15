//! The tenant's catalogue of manifests (features/store-scan-under-lock.clan, stage B): the reads that look
//! another document up read only the documents they want, not the whole tenant, and a write to one document
//! costs the next read one manifest, not a pass over every document.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use clan_sdk::{AttachSpec, Carried, ClanBuilder, ClanFile, Lineage};
use napkin_host::catalog::StoreCatalog;
use napkin_host::{
    handle, Actor, Change, Ctx, DocId, FsStore, HostRequest, HostResult, Library, NoConfig,
    PartStore, Session, Stamp, Version,
};
use serde_json::{json, Value};

const BRIEF_MAKER: &str = "ie.napkin.brief-maker";
const IDEA_ROOM: &str = "ie.napkin.idea-room";
const DECK_MAKER: &str = "ie.napkin.deck-maker";
const RESEARCH: &str = "ie.napkin.campaign-research";

/// A tenant's store that keeps a catalogue and counts every read of a document's archive.
struct Counting {
    inner: FsStore,
    dir: std::path::PathBuf,
    catalog: Option<StoreCatalog>,
    reads: AtomicUsize,
}

impl PartStore for Counting {
    fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
        if std::path::Path::new(id.as_str()).starts_with(self.dir.join("documents")) {
            self.reads.fetch_add(1, Ordering::SeqCst);
        }
        self.inner.read(id)
    }
    fn exists(&self, id: &DocId) -> bool {
        self.inner.exists(id)
    }
    /// A stat, as the web's tenant store stamps: no read.
    fn stamp(&self, id: &DocId) -> HostResult<Stamp> {
        let m = std::fs::metadata(id.as_str())
            .map_err(|e| napkin_host::HostError::not_found(e.to_string()))?;
        Ok(Stamp::new(format!("{}:{:?}", m.len(), m.modified().ok())))
    }
    fn apply(&self, change: &Change) -> HostResult<Version> {
        self.inner.apply(change)
    }
}

impl Library for Counting {
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
    fn catalog(&self) -> Option<&StoreCatalog> {
        self.catalog.as_ref()
    }
}

struct Doc<'a> {
    file: &'a str,
    document_id: &'a str,
    app_id: &'a str,
    job: Option<&'a str>,
    carried: Option<&'a str>,
    data: Value,
    accepts: &'a [&'a str],
}

/// One base for every document of every tenant here, so two tenants built alike are alike to the byte.
fn base() -> ClanFile {
    static BASE: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    let bytes = BASE.get_or_init(|| {
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "Base".into(),
            brief: "a document".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap()
    });
    ClanFile::from_bytes(bytes.clone()).unwrap()
}

fn write(dir: &std::path::Path, base: &ClanFile, d: Doc) -> DocId {
    let mut m = base.manifest().clone();
    m.id = format!("rev-{}", d.document_id);
    m.document_id = Some(d.document_id.into());
    m.title = d.file.into();
    m.app = Some(clan_sdk::AppInfo {
        home: None,
        name: d.app_id.into(),
        app_id: d.app_id.into(),
        version: "0.1.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach: (!d.accepts.is_empty()).then(|| AttachSpec {
            accepts: d.accepts.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }),
    });
    m.job = d.job.map(Into::into);
    // a spin-off whose lineage a write has moved on: the parent is found by its id, not where it was
    m.lineage = d.carried.map(|parent| Lineage {
        parent_id: format!("rev-{parent}"),
        parent_uri: format!("clan:rev-{parent}"),
        parent_sha256: None,
        delta: "spinoff".into(),
        parents: vec![],
        merge: false,
        carried: Some(Carried {
            document_id: parent.into(),
            data_sha256: "sha256:0".into(),
            facts_sha256: None,
            findings_sha256: None,
            sources_sha256: None,
            last_decision: None,
        }),
        attached: vec![],
    });
    let mut b = ClanBuilder::new(m);
    for (p, bytes) in base.read_all_entries().unwrap() {
        if p != clan_sdk::MANIFEST_PATH && p != "shared/data.yaml" {
            b.add_entry(p, bytes);
        }
    }
    b.add_entry(
        "shared/data.yaml",
        serde_yaml::to_string(&d.data).unwrap().into_bytes(),
    );
    let docs = dir.join("documents");
    std::fs::create_dir_all(&docs).unwrap();
    let id = DocId::from(docs.join(format!("{}.clan", d.file)));
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    id
}

/// 200 documents: a brief, an Idea room spun off it (which lets a deck be linked), two decks, and 196
/// research documents that nothing here wants.
fn tenant(catalogued: bool) -> (tempfile::TempDir, Arc<Counting>, DocId, DocId) {
    let dir = tempfile::tempdir().unwrap();
    let base = base();
    let brief = write(
        dir.path(),
        &base,
        Doc {
            file: "brief",
            document_id: "doc-brief",
            app_id: BRIEF_MAKER,
            job: Some("J001"),
            carried: None,
            data: json!({ "insight": "Younger drinkers think it is for someone else." }),
            accepts: &[],
        },
    );
    let room = write(
        dir.path(),
        &base,
        Doc {
            file: "room",
            document_id: "doc-room",
            app_id: IDEA_ROOM,
            job: Some("J001"),
            carried: Some("doc-brief"),
            data: json!({ "upstream": { "doc-brief": { "insight": "Younger drinkers think it is for someone else." } } }),
            accepts: &[DECK_MAKER],
        },
    );
    for i in 1..=2 {
        write(
            dir.path(),
            &base,
            Doc {
                file: &format!("deck-{i}"),
                document_id: &format!("doc-deck-{i}"),
                app_id: DECK_MAKER,
                job: Some("J001"),
                carried: None,
                data: json!({}),
                accepts: &[],
            },
        );
    }
    for i in 0..196 {
        write(
            dir.path(),
            &base,
            Doc {
                file: &format!("research-{i}"),
                document_id: &format!("doc-research-{i}"),
                app_id: RESEARCH,
                job: Some(&format!("J{i:03}")),
                carried: None,
                data: json!({}),
                accepts: &[],
            },
        );
    }
    let store = Arc::new(Counting {
        inner: FsStore::new(dir.path().to_path_buf()),
        dir: dir.path().to_path_buf(),
        catalog: catalogued.then(StoreCatalog::new),
        reads: AtomicUsize::new(0),
    });
    assert_eq!(store.documents().len(), 200);
    (dir, store, brief, room)
}

fn get(s: &Session, path: &str) -> Value {
    let r = handle(s, &NoConfig, HostRequest::new(path, "", Vec::new()));
    assert_eq!(
        r.status,
        200,
        "{path}: {}",
        String::from_utf8_lossy(&r.body)
    );
    serde_json::from_slice(&r.body).unwrap()
}

/// What each read route answers on the room, and how many archives it read to answer.
fn answers(store: &Counting, session: &Session) -> Vec<(&'static str, Value, usize)> {
    ["/related", "/attach-targets", "/upstream", "/judge"]
        .into_iter()
        .map(|path| {
            let before = store.reads.load(Ordering::SeqCst);
            let v = get(session, path);
            (path, v, store.reads.load(Ordering::SeqCst) - before)
        })
        .collect()
}

fn open(store: &Arc<Counting>, room: &DocId) -> Session {
    let s = Session::with_ctx(store.clone(), Ctx::new(Actor::human("aoife@wk").unwrap()));
    s.open(room.clone()).unwrap();
    s
}

// The design's test 3: a warm read reads only its hits' archives (here one parent, two decks), and a
// write to one document makes the next read re-read exactly one manifest.
#[test]
fn a_warm_read_reads_only_its_hits_and_a_write_costs_one_manifest() {
    let (_dir, store, _brief, room) = tenant(true);
    let session = open(&store, &room);
    answers(&store, &session); // cold: the catalogue reads every manifest once
    let catalog = store.catalog().unwrap();
    let cold = catalog.manifests_read();
    assert_eq!(cold, 200, "one read of each manifest");

    for (path, v, reads) in answers(&store, &session) {
        assert!(reads <= 3, "{path} read {reads} archives of 200: {v}");
    }
    assert_eq!(
        catalog.manifests_read(),
        cold,
        "warm: no manifest read again"
    );

    // a write to one research document
    let one = store
        .documents()
        .into_iter()
        .find(|d| d.as_str().contains("research-7"))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    let bytes = std::fs::read(one.as_str()).unwrap();
    let clan = ClanFile::from_bytes(bytes).unwrap();
    let mut m = clan.manifest().clone();
    m.title = "Research, renamed".into();
    let mut b = ClanBuilder::new(m);
    for (p, bytes) in clan.read_all_entries().unwrap() {
        if p != clan_sdk::MANIFEST_PATH {
            b.add_entry(p, bytes);
        }
    }
    std::fs::write(one.as_str(), b.build().unwrap()).unwrap();
    get(&session, "/related");
    assert_eq!(
        catalog.manifests_read(),
        cold + 1,
        "a write to one document costs one manifest"
    );
}

// The catalogue changes how many documents are read, never the answer: the same tenant with and without
// one answers every route the same.
#[test]
fn the_catalogue_gives_the_answers_the_scan_gave() {
    let (_d1, with, _, room1) = tenant(true);
    let (_d2, without, _, room2) = tenant(false);
    let a = answers(&with, &open(&with, &room1));
    let b = answers(&without, &open(&without, &room2));
    let scrub = |v: &Value, dir: &str| v.to_string().replace(dir, "<dir>");
    for ((path, va, _), (_, vb, reads)) in a.iter().zip(b.iter()) {
        assert_eq!(
            scrub(va, with.dir.to_str().unwrap()),
            scrub(vb, without.dir.to_str().unwrap()),
            "{path}"
        );
        // without a catalogue a lookup still reads the tenant (what the catalogue saves)
        if *path != "/attach-targets" {
            assert!(*reads >= 1, "{path}");
        }
    }
    let targets = a.iter().find(|(p, _, _)| *p == "/attach-targets").unwrap();
    assert_eq!(targets.1.as_array().unwrap().len(), 2, "the two decks");
    let up = a.iter().find(|(p, _, _)| *p == "/upstream").unwrap();
    assert_eq!(up.1["upstream"][0]["document_id"], "doc-brief", "{}", up.1);
}

// Review of 15 Nov, item 4: an id the tenant does not hold is answered from the catalogue's fresh stat
// pass, never by reading every document. A person's POST /attach naming such an id runs inside a write
// (the document's locks held); it must not be a way to make a request read the whole tenant.
#[test]
fn a_lookup_of_an_id_that_is_not_there_reads_no_document() {
    let (_dir, store, _brief, room) = tenant(true);
    let session = open(&store, &room);
    answers(&store, &session); // warm
    let before = store.reads.load(Ordering::SeqCst);
    let r = handle(
        &session,
        &NoConfig,
        HostRequest::new(
            "/attach",
            "",
            json!({ "document_id": "doc-nowhere" })
                .to_string()
                .into_bytes(),
        )
        .posting(),
    );
    assert_eq!(r.status, 404, "{}", String::from_utf8_lossy(&r.body));
    let child = napkin_host::Document::load(&*store, room.clone()).unwrap();
    let after_load = store.reads.load(Ordering::SeqCst);
    assert!(napkin_host::library::find_upstream(
        &*store,
        &Ctx::new(Actor::human("aoife@wk").unwrap()),
        &child,
        "doc-gone"
    )
    .is_none());
    assert_eq!(
        store.reads.load(Ordering::SeqCst) - after_load,
        0,
        "a missing parent read no archive"
    );
    // the attach read at most the room itself (its write path), never the tenant
    assert!(
        after_load - before <= 3,
        "a missing source read {} archives of 200",
        after_load - before
    );
}
