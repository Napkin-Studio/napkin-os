//! Lock order (features/store-scan-under-lock.clan, review of 15 Nov): a document's write lock before the
//! session's view lock, on every path. One Session (the desktop keeps one for every document): a perform on X whose
//! outcome also writes existing document Y (as ideas::route_edit writes a route's branch from the room) holds
//! X's view lock and then wants Y's write lock; an open of Y on the same session holds Y's write lock and
//! then wants the view lock.
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use napkin_host::{
    Change, Ctx, DocId, FsStore, HostResult, Library, Outcome, PartStore, Session, Stamp, Version,
};

struct Watch {
    inner: FsStore,
    y: DocId,
    stamps_of_y: AtomicUsize,
    second_stamp: Mutex<Option<Sender<()>>>,
}
impl PartStore for Watch {
    fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
        self.inner.read(id)
    }
    fn exists(&self, id: &DocId) -> bool {
        self.inner.exists(id)
    }
    fn stamp(&self, id: &DocId) -> HostResult<Stamp> {
        let s = self.inner.stamp(id);
        // an open stamps twice: before its read, and again under the document's write lock
        if id == &self.y && self.stamps_of_y.fetch_add(1, Ordering::SeqCst) == 1 {
            if let Some(tx) = self.second_stamp.lock().unwrap().take() {
                let _ = tx.send(());
            }
        }
        s
    }
    fn apply(&self, change: &Change) -> HostResult<Version> {
        self.inner.apply(change)
    }
}
impl Library for Watch {
    fn app_candidates(&self) -> Vec<DocId> {
        self.inner.app_candidates()
    }
    fn app_template(&self, a: &str) -> DocId {
        self.inner.app_template(a)
    }
    fn documents(&self) -> Vec<DocId> {
        self.inner.documents()
    }
    fn new_document(&self, a: &str, s: &str) -> HostResult<DocId> {
        self.inner.new_document(a, s)
    }
    fn home(&self, t: &str) -> HostResult<DocId> {
        self.inner.home(t)
    }
    fn fork_branch(&self, p: &DocId, a: &str) -> DocId {
        self.inner.fork_branch(p, a)
    }
}

fn doc(dir: &std::path::Path, name: &str) -> DocId {
    let id = DocId::from(dir.join(name));
    let bytes = clan_sdk::create(clan_sdk::CreateOptions {
        title: name.into(),
        brief: "b".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    std::fs::write(id.as_str(), bytes).unwrap();
    id
}

#[test]
fn a_perform_that_writes_another_document_and_an_open_of_it_do_not_deadlock() {
    let dir = tempfile::tempdir().unwrap();
    let (x, y) = (doc(dir.path(), "x.clan"), doc(dir.path(), "y.clan"));
    let (stamped_tx, stamped_rx) = channel();
    let store = Arc::new(Watch {
        inner: FsStore::new(dir.path().to_path_buf()),
        y: y.clone(),
        stamps_of_y: AtomicUsize::new(0),
        second_stamp: Mutex::new(Some(stamped_tx)),
    });
    let session = Arc::new(Session::new(store.clone()));
    session.open(x.clone()).unwrap();

    // T1: a perform on X, parked inside its op (X's write lock and the view lock held); it will write Y.
    let (in_op_tx, in_op_rx) = channel();
    let (go_tx, go_rx) = channel::<()>();
    let (done1_tx, done1_rx) = channel();
    let t1 = {
        let (session, store, y) = (session.clone(), store.clone(), y.clone());
        std::thread::spawn(move || {
            let r = session.perform(&Ctx::local(), |_, _| {
                let old = store.read(&y)?;
                in_op_tx.send(()).unwrap();
                go_rx.recv().unwrap();
                Ok(Outcome::changed(
                    serde_json::json!({ "ok": true }),
                    Change::replace(y.clone(), Version::of_archive(&old), old),
                ))
            });
            let _ = done1_tx.send(r.map(|_| ()).map_err(|e| e.to_string()));
        })
    };
    in_op_rx.recv().unwrap();

    // T2: an open of Y on the same session: it takes Y's write lock, stamps, then waits for the view lock.
    let (done2_tx, done2_rx) = channel();
    let t2 = {
        let (session, y) = (session.clone(), y.clone());
        std::thread::spawn(move || {
            let r = session.open(y).map(|_| ()).map_err(|e| e.to_string());
            let _ = done2_tx.send(r);
        })
    };
    stamped_rx.recv().unwrap(); // T2 holds Y's write lock

    go_tx.send(()).unwrap(); // T1 goes on to apply its change to Y
    let one = done1_rx.recv_timeout(Duration::from_secs(5));
    let two = done2_rx.recv_timeout(Duration::from_secs(1));
    assert!(
        one.is_ok() && two.is_ok(),
        "deadlock: perform {one:?}, open {two:?}"
    );
    t1.join().unwrap();
    t2.join().unwrap();
}

/// Two stores that name a document alike (`home-*`, the registries in every tenant) do not share its write
/// lock: holding one tenant's leaves the other's free.
#[test]
fn same_named_documents_in_two_stores_have_their_own_write_locks() {
    struct Scoped(&'static str);
    impl PartStore for Scoped {
        fn read(&self, _: &DocId) -> HostResult<Vec<u8>> {
            Ok(Vec::new())
        }
        fn exists(&self, _: &DocId) -> bool {
            false
        }
        fn apply(&self, change: &Change) -> HostResult<Version> {
            Ok(change.archive_version())
        }
        fn lock_scope(&self) -> String {
            self.0.into()
        }
    }
    let id = DocId::new("home-jobs-v1");
    let _a = napkin_host::store::write_lock(&Scoped("tenant-a"), &id);
    let (tx, rx) = channel();
    let t = std::thread::spawn(move || {
        let _b = napkin_host::store::write_lock(&Scoped("tenant-b"), &DocId::new("home-jobs-v1"));
        let _ = tx.send(());
    });
    assert!(
        rx.recv_timeout(Duration::from_secs(5)).is_ok(),
        "tenant b waited for tenant a's lock"
    );
    t.join().unwrap();
}

/// A `/snapshot` or `/patch` the store refuses (a stale write, 409) says so instead of answering as if it
/// was saved.
#[test]
fn a_refused_snapshot_or_patch_is_not_silent() {
    struct Refuses(FsStore);
    impl PartStore for Refuses {
        fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
            self.0.read(id)
        }
        fn exists(&self, id: &DocId) -> bool {
            self.0.exists(id)
        }
        fn apply(&self, change: &Change) -> HostResult<Version> {
            Err(napkin_host::HostError::conflict(format!(
                "{} changed",
                change.doc
            )))
        }
    }
    impl Library for Refuses {
        fn app_candidates(&self) -> Vec<DocId> {
            self.0.app_candidates()
        }
        fn app_template(&self, a: &str) -> DocId {
            self.0.app_template(a)
        }
        fn documents(&self) -> Vec<DocId> {
            self.0.documents()
        }
        fn new_document(&self, a: &str, s: &str) -> HostResult<DocId> {
            self.0.new_document(a, s)
        }
        fn home(&self, t: &str) -> HostResult<DocId> {
            self.0.home(t)
        }
        fn fork_branch(&self, p: &DocId, a: &str) -> DocId {
            self.0.fork_branch(p, a)
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let x = doc(dir.path(), "x.clan");
    let session = Session::new(Arc::new(Refuses(FsStore::new(dir.path().to_path_buf()))));
    session.open(x).unwrap();
    let call = |path: &str, body: &str| {
        napkin_host::handle(
            &session,
            &napkin_host::NoConfig,
            napkin_host::HostRequest::new(path, "", body.as_bytes().to_vec()).posting(),
        )
        .status
    };
    assert_eq!(call("/snapshot", "<html><body>new</body></html>"), 409);
    assert_eq!(
        call("/patch", r#"{"id":"heading-0","content":"Edited"}"#),
        409
    );
}
