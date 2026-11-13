// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Server state: one workspace per tenant, one host session per open document.
//!
//! `Session` models one open document, which on the desktop means one at a
//! time. Here it means one per document per tenant, held in a small cache: two
//! tabs on the same document share a session (so neither can hold a stale
//! archive), and two tenants never share anything at all.

use std::collections::HashMap;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use napkin_host::{
    Ctx, DocId, DocStore, HostConfig, HostResult, LibraryCache, OpenResult, Session,
};

use crate::events::EventBus;
use crate::exports::ExportStore;
use crate::meter::Meter;
use crate::store::TenantStore;
use crate::tenant::TenantId;
use crate::tokens::TokenStore;

/// How many documents one tenant may hold open before the least recently
/// opened is dropped. Only view state is lost — the archive is always on disk.
const SESSION_CACHE: usize = 32;

/// Open documents, plus the order they were opened in, so the cache can shed
/// the least recently opened when it is full.
#[derive(Default)]
struct SessionCache {
    open: HashMap<DocId, Arc<Session>>,
    order: VecDeque<DocId>,
}

pub struct Workspace {
    pub store: Arc<dyn DocStore>,
    /// Who every session of this workspace acts as by default: its tenant.
    ctx: Ctx,
    sessions: Mutex<SessionCache>,
    /// What the library listing worked out per document, so a poll does not
    /// re-read every decision chain (napkin-host `listing`).
    pub library: LibraryCache,
}

impl Workspace {
    fn new(store: Arc<dyn DocStore>, ctx: Ctx) -> Self {
        Self {
            store,
            ctx,
            sessions: Mutex::new(SessionCache::default()),
            library: LibraryCache::new(),
        }
    }

    /// The session for one document, opening it if this is the first request.
    pub fn session(&self, doc: &DocId) -> HostResult<Arc<Session>> {
        Ok(self.cached_or_open(doc)?.0)
    }

    /// The session for one document, with the document read as it stands now
    /// and described. A cached session re-reads it (under its view lock, as
    /// [`Session::open`] always does); a session opened just now has read it
    /// already, and that one read is used, not repeated.
    pub fn open(&self, doc: &DocId) -> HostResult<(Arc<Session>, OpenResult)> {
        let (session, opened) = self.cached_or_open(doc)?;
        let open = match opened {
            Some(open) => open,
            None => crate::timing::open(&session, doc.clone())?,
        };
        Ok((session, open))
    }

    /// The cached session, or a new one with what its open described.
    fn cached_or_open(&self, doc: &DocId) -> HostResult<(Arc<Session>, Option<OpenResult>)> {
        crate::timing::note_doc(doc);
        if let Some(s) = self.sessions.lock().unwrap().open.get(doc) {
            return Ok((s.clone(), None));
        }
        // Open outside the lock: reading and validating an archive is real work
        // and must not block every other document of this tenant.
        let session = Arc::new(
            Session::with_ctx(self.store.clone(), self.ctx.clone()).with_runs(self.library.runs()),
        );
        let opened = crate::timing::open(&session, doc.clone())?;

        let mut cache = self.sessions.lock().unwrap();
        // A concurrent request may have won the race; its session is as good,
        // but what it holds is its own read, so ours does not describe it.
        if let Some(existing) = cache.open.get(doc) {
            return Ok((existing.clone(), None));
        }
        cache.open.insert(doc.clone(), session.clone());
        cache.order.push_back(doc.clone());
        while cache.order.len() > SESSION_CACHE {
            if let Some(oldest) = cache.order.pop_front() {
                cache.open.remove(&oldest);
            }
        }
        Ok((session, Some(opened)))
    }
}

pub struct AppCtx {
    root: PathBuf,
    /// Templates every new workspace starts with. A demo whose launcher is
    /// empty demonstrates nothing; a deployment can leave this unset.
    seed: Option<PathBuf>,
    pub config: Arc<dyn HostConfig>,
    pub tokens: TokenStore,
    pub events: EventBus,
    pub exports: ExportStore,
    pub meter: Meter,
    /// Origin the app frame loads from. Same-origin until the sandbox gets its
    /// own hostname, at which point this is the only thing that changes here.
    pub sandbox_origin: Option<String>,
    /// The dogfood build's record (`NAPKIN_DOGFOOD=1`); `None` everywhere else.
    pub dogfood: Option<Arc<crate::dogfood::Dogfood>>,
    workspaces: Mutex<HashMap<TenantId, Arc<Workspace>>>,
}

impl AppCtx {
    pub fn new(
        root: PathBuf,
        config: Arc<dyn HostConfig>,
        sandbox_origin: Option<String>,
        agent_cap: u32,
    ) -> Self {
        Self {
            root,
            seed: None,
            config,
            tokens: TokenStore::default(),
            events: EventBus::default(),
            exports: ExportStore::default(),
            meter: Meter::new(agent_cap),
            sandbox_origin,
            dogfood: None,
            workspaces: Mutex::new(HashMap::new()),
        }
    }

    /// Templates installed into every new workspace.
    pub fn with_seed(mut self, seed: Option<PathBuf>) -> Self {
        self.seed = seed;
        self
    }

    /// Record everything consenting accounts do (the dogfood build).
    pub fn with_dogfood(mut self, dogfood: Option<Arc<crate::dogfood::Dogfood>>) -> Self {
        self.dogfood = dogfood;
        self
    }

    /// Give `tenant` a workspace on `store` (tests that count what reaches it).
    #[cfg(test)]
    pub(crate) fn put_workspace(&self, tenant: &TenantId, store: Arc<dyn DocStore>) {
        let ws = Arc::new(Workspace::new(store, tenant.ctx()));
        self.workspaces.lock().unwrap().insert(tenant.clone(), ws);
    }

    pub fn workspace(&self, tenant: &TenantId) -> Arc<Workspace> {
        let mut workspaces = self.workspaces.lock().unwrap();
        if let Some(existing) = workspaces.get(tenant) {
            return existing.clone();
        }
        let store: Arc<dyn DocStore> = Arc::new(TenantStore::new(self.root.join(tenant.as_str())));
        if let Some(seed) = &self.seed {
            seed_library(&*store, seed);
        }
        let workspace = Arc::new(Workspace::new(store, tenant.ctx()));
        workspaces.insert(tenant.clone(), workspace.clone());
        workspace
    }
}

/// Install every template in `dir` into a fresh workspace. Best effort: a file
/// that is not a template app is skipped, not fatal — this is convenience, and
/// a broken seed must not stop someone from using the service.
fn seed_library(store: &dyn DocStore, dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        tracing::warn!(dir = %dir.display(), "seed directory is not readable");
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("clan") {
            continue;
        }
        match std::fs::read(&path)
            .map_err(|e| e.to_string())
            .and_then(|bytes| {
                napkin_host::library::install_app(store, bytes).map_err(|e| e.to_string())
            }) {
            Ok(app) => tracing::info!(app = %app.app_id, "seeded"),
            Err(e) => tracing::warn!(file = %path.display(), error = %e, "seed skipped"),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use axum::body::Body;
    use axum::http::{header, Request, StatusCode};
    use napkin_host::{Change, Library, NoConfig, PartStore, Version};
    use tower::ServiceExt;

    use super::*;

    /// A tenant's store that counts the reads of one document, as #220's
    /// `HeldRead` stands between a session and its store.
    struct Counting {
        inner: TenantStore,
        watched: DocId,
        reads: AtomicUsize,
    }

    impl PartStore for Counting {
        fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
            if id == &self.watched {
                self.reads.fetch_add(1, Ordering::SeqCst);
            }
            self.inner.read(id)
        }
        fn exists(&self, id: &DocId) -> bool {
            self.inner.exists(id)
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
    }

    // UAT round 12: on a cache miss, GET /d/<doc> opened the document in
    // `Workspace::session` and then again in `open_view` — two reads, parses
    // and signature checks of the same archive on a 256-unit CPU.
    #[tokio::test]
    async fn a_cold_open_reads_the_archive_once_and_a_warm_one_reads_it_again() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = Arc::new(AppCtx::new(
            dir.path().to_path_buf(),
            Arc::new(NoConfig),
            None,
            0,
        ));
        let app = crate::router(ctx.clone(), None, false);

        let first = app
            .clone()
            .oneshot(Request::get("/api/session").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let cookie = first.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let tenant = TenantId::parse(cookie.split_once('=').unwrap().1).unwrap();

        let doc = DocId::new("doc-cold-open");
        let inner = TenantStore::new(dir.path().join(tenant.as_str()));
        let bytes = clan_sdk::create(clan_sdk::CreateOptions {
            title: "Cold Open".into(),
            brief: "test brief".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap();
        inner.apply(&Change::create(doc.clone(), bytes)).unwrap();
        let store = Arc::new(Counting {
            inner,
            watched: doc.clone(),
            reads: AtomicUsize::new(0),
        });
        ctx.put_workspace(&tenant, store.clone());

        let open = || {
            app.clone().oneshot(
                Request::get(format!("/api/t/{tenant}/d/{}", doc.as_str()))
                    .header(header::COOKIE, &cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
        };
        assert_eq!(open().await.unwrap().status(), StatusCode::OK);
        assert_eq!(
            store.reads.load(Ordering::SeqCst),
            1,
            "a cold open reads the archive once"
        );
        assert_eq!(open().await.unwrap().status(), StatusCode::OK);
        assert_eq!(
            store.reads.load(Ordering::SeqCst),
            2,
            "a warm open re-reads it as it stands now"
        );
    }
}
