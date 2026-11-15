//! Writes are never lost and old bytes are never put back (features/store-scan-under-lock.clan, review
//! of 15 Nov): interleavings of an open with writes that do not go through the session (a backref from a
//! child, a job link, another web task on the same disk), and of the writers that read one document and
//! write it outside a session with a session's write.
//! Channels order every step; the one timeout only lets the same driver run on the old code, where
//! the open holds the view lock across its read and the second actor cannot enter.

use std::collections::VecDeque;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use napkin_host::{Change, DocId, FsStore, HostResult, Library, PartStore, Session, Version};

/// Where a gated read parks: before it takes the bytes, or after.
#[derive(Clone, Copy, PartialEq)]
enum At {
    Before,
    After,
}

struct Gate {
    at: At,
    entered: Sender<()>,
    release: Receiver<()>,
}

/// A store whose reads of documents can be parked one at a time, in the order gates were queued.
struct Gated {
    inner: FsStore,
    doc: DocId,
    gates: Mutex<VecDeque<Gate>>,
}

impl Gated {
    fn gate(&self, at: At) -> (Receiver<()>, Sender<()>) {
        let (entered_tx, entered_rx) = channel();
        let (release_tx, release_rx) = channel();
        self.gates.lock().unwrap().push_back(Gate {
            at,
            entered: entered_tx,
            release: release_rx,
        });
        (entered_rx, release_tx)
    }
}

impl PartStore for Gated {
    fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
        let gate = if id == &self.doc {
            self.gates.lock().unwrap().pop_front()
        } else {
            None
        };
        match gate {
            Some(g) if g.at == At::Before => {
                let _ = g.entered.send(());
                let _ = g.release.recv();
                self.inner.read(id)
            }
            Some(g) => {
                let bytes = self.inner.read(id)?;
                let _ = g.entered.send(());
                let _ = g.release.recv();
                Ok(bytes)
            }
            None => self.inner.read(id),
        }
    }
    fn exists(&self, id: &DocId) -> bool {
        self.inner.exists(id)
    }
    fn apply(&self, change: &Change) -> HostResult<Version> {
        self.inner.apply(change)
    }
}

impl Library for Gated {
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

fn fixture() -> (tempfile::TempDir, Arc<Gated>, Arc<Session>, DocId) {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("test.clan"));
    let bytes = clan_sdk::create(clan_sdk::CreateOptions {
        title: "Race".into(),
        brief: "b".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    std::fs::write(id.as_str(), bytes).unwrap();
    let store = Arc::new(Gated {
        inner: FsStore::new(dir.path().to_path_buf()),
        doc: id.clone(),
        gates: Mutex::new(VecDeque::new()),
    });
    let session = Arc::new(Session::new(store.clone()));
    session.open(id.clone()).unwrap();
    (dir, store, session, id)
}

/// A write to `id` that does not go through `session`: its own session on the same store, as a
/// second web task on the same disk makes it (write_backrefs and jobs::link_document write the
/// store directly in the same way).
fn outside_write(store: &Arc<Gated>, id: &DocId, text: &str) {
    let other = Session::new(store.clone());
    other.open(id.clone()).unwrap();
    other.set_context(text, true).unwrap();
}

fn context_on_disk(store: &Gated, id: &DocId) -> String {
    let clan = clan_sdk::ClanFile::from_bytes(store.read(id).unwrap()).unwrap();
    String::from_utf8(clan.read_entry("agent/context.md").unwrap_or_default()).unwrap()
}

// Two opens of one document overlap (the desk sends several GET /d for one document). The first
// read the bytes from before an outside write, the second read the bytes after it. The first puts
// its read in; the second finds the install count moved and keeps what stands: the OLDER read.
#[test]
fn a_later_open_that_read_newer_bytes_is_not_dropped_for_an_older_open() {
    let (_dir, store, session, id) = fixture();

    let (a_entered, a_release) = store.gate(At::After);
    let a = {
        let (s, id) = (session.clone(), id.clone());
        std::thread::spawn(move || s.open(id).unwrap())
    };
    a_entered.recv().unwrap(); // A holds the bytes from before the outside write

    outside_write(&store, &id, "OUTSIDE-WRITE");

    let (b_entered, b_release) = store.gate(At::After);
    let b = {
        let (s, id) = (session.clone(), id.clone());
        std::thread::spawn(move || s.open(id).unwrap())
    };
    // New code: B has read the newer bytes. Old code: B waits for the view lock A holds.
    let _ = b_entered.recv_timeout(Duration::from_secs(3)).is_ok();

    a_release.send(()).unwrap();
    a.join().unwrap(); // A's (older) read is in
    b_release.send(()).unwrap();
    b.join().unwrap();

    let on_disk = store.version(&id).unwrap();
    let snapshot = session.current_version().unwrap();

    // What it costs: the next write through the session is built on the old snapshot, and the
    // store does not check Change::base, so the outside write is gone from the store.
    session.set_context("SESSION-WRITE", true).unwrap();
    let ctx = context_on_disk(&store, &id);
    assert_eq!(
        snapshot, on_disk,
        "after an open that began after the outside write, the snapshot is the store's version"
    );
    assert!(
        ctx.contains("OUTSIDE-WRITE") && ctx.contains("SESSION-WRITE"),
        "a write was lost from the store: {ctx:?}"
    );
}

// One open, its install count taken, has not read yet. A write through the session lands (the
// count moves), then an outside write. The open now reads the newest bytes and throws them away,
// because "a write's snapshot is newer than anything this open could have read".
#[test]
fn an_open_that_read_after_a_session_write_and_an_outside_write_keeps_the_newest() {
    let (_dir, store, session, id) = fixture();

    let (a_entered, a_release) = store.gate(At::Before);
    let a = {
        let (s, id) = (session.clone(), id.clone());
        std::thread::spawn(move || s.open(id).unwrap())
    };
    a_entered.recv().unwrap(); // A is about to read

    let (w_done_tx, w_done_rx) = channel();
    let w = {
        let s = session.clone();
        std::thread::spawn(move || {
            s.set_context("SESSION-WRITE-1", true).unwrap();
            let _ = w_done_tx.send(());
        })
    };
    // New code: the write completes. Old code: it waits for the view lock A holds.
    let _ = w_done_rx.recv_timeout(Duration::from_secs(3)).is_ok();

    outside_write(&store, &id, "OUTSIDE-WRITE");

    a_release.send(()).unwrap();
    a.join().unwrap();
    w.join().unwrap();

    let on_disk = store.version(&id).unwrap();
    let snapshot = session.current_version().unwrap();
    session.set_context("SESSION-WRITE-2", true).unwrap();
    let ctx = context_on_disk(&store, &id);
    assert_eq!(
        snapshot, on_disk,
        "the open read the newest bytes and kept them"
    );
    assert!(
        ctx.contains("OUTSIDE-WRITE")
            && ctx.contains("SESSION-WRITE-1")
            && ctx.contains("SESSION-WRITE-2"),
        "a write was lost from the store: {ctx:?}"
    );
}

/// A document of client `client` in the store's documents folder, with a store gated on it.
fn client_doc(client: &str) -> (tempfile::TempDir, Arc<Gated>, DocId) {
    let dir = tempfile::tempdir().unwrap();
    let base = clan_sdk::ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "Race".into(),
            brief: "b".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut m = base.manifest().clone();
    m.client = Some(clan_sdk::ClientRef {
        id: client.into(),
        name: "Client A".into(),
    });
    let mut b = clan_sdk::ClanBuilder::new(m);
    for (p, bytes) in base.read_all_entries().unwrap() {
        if p != clan_sdk::MANIFEST_PATH {
            b.add_entry(p, bytes);
        }
    }
    let docs = dir.path().join("documents");
    std::fs::create_dir_all(&docs).unwrap();
    let id = DocId::from(docs.join("brief.clan"));
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    let store = Arc::new(Gated {
        inner: FsStore::new(dir.path().to_path_buf()),
        doc: id.clone(),
        gates: Mutex::new(VecDeque::new()),
    });
    (dir, store, id)
}

// `jobs::link_document` reads a document and writes it back outside any session. A session's write to the
// same document while the link is parked between its read and its write must not be lost, and the link
// must land too.
#[test]
fn a_job_link_racing_a_session_write_loses_neither() {
    let ctx = napkin_host::Ctx::new(napkin_host::Actor::human("cian@wk").unwrap());
    let (_dir, store, id) = client_doc("cli_placeholder");
    // the client in this store's registry, and the document filed under it
    let client = napkin_host::clients::create_client(&*store, &ctx, "Client A", None)
        .unwrap()
        .id;
    let clan = clan_sdk::ClanFile::from_bytes(store.read(&id).unwrap()).unwrap();
    let out = clan_sdk::with_client(
        &clan,
        Some(clan_sdk::ClientRef {
            id: client.clone(),
            name: "Client A".into(),
        }),
    )
    .unwrap();
    std::fs::write(id.as_str(), out).unwrap();
    napkin_host::jobs::create_job(
        &*store,
        &ctx,
        napkin_host::jobs::NewJob {
            number: Some("J001".into()),
            client_id: client,
            title: Some("J001".into()),
            owner: None,
            opened_on: None,
            due: None,
            budget_hours: None,
        },
    )
    .unwrap();
    let session = Arc::new(Session::new(store.clone()));
    session.open(id.clone()).unwrap();

    // the link reads the document, then waits
    let (l_entered, l_release) = store.gate(At::After);
    let link = {
        let (store, id) = (store.clone(), id.clone());
        std::thread::spawn(move || napkin_host::jobs::link_document(&*store, &id, "J001"))
    };
    l_entered.recv().unwrap();
    let (w_done_tx, w_done_rx) = channel();
    let w = {
        let s = session.clone();
        std::thread::spawn(move || {
            s.set_context("SESSION-WRITE", true).unwrap();
            let _ = w_done_tx.send(());
        })
    };
    // the session's write waits for the link (or, without a lock, lands now and is then overwritten)
    let _ = w_done_rx.recv_timeout(Duration::from_millis(500));
    l_release.send(()).unwrap();
    link.join().unwrap().unwrap();
    w.join().unwrap();

    let clan = clan_sdk::ClanFile::from_bytes(store.read(&id).unwrap()).unwrap();
    assert_eq!(
        clan.manifest().job.as_deref(),
        Some("J001"),
        "the link landed"
    );
    assert!(
        context_on_disk(&store, &id).contains("SESSION-WRITE"),
        "the session's write was lost"
    );
}

// The store refuses a change whose base is not the document as it stands (W2-A4): a stale snapshot is
// refused, never written over a newer one.
#[test]
fn the_store_refuses_a_change_built_on_an_older_version() {
    let (_dir, store, _session, id) = fixture();
    let old = napkin_host::Document::load(&*store, id.clone()).unwrap();
    outside_write(&store, &id, "NEWER");
    let stale = old.change(old.bytes().to_vec()).unwrap();
    let e = store.apply(&stale).unwrap_err();
    assert_eq!(e.status, 409, "{e:?}");
    assert!(context_on_disk(&store, &id).contains("NEWER"));
}
