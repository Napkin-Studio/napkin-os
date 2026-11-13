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
    /// The job index, read-only and disposable (napkin-host `jobindex`): rebuilt
    /// from the documents whenever one has moved.
    pub jobs: napkin_host::jobindex::IndexCache,
    /// What the one bar finds, read-only and disposable (napkin-host `searchindex`), kept beside the job
    /// index and rebuilt from the same documents by the same stamps. One per tenant, so a search never
    /// crosses an agency.
    pub search: napkin_host::searchindex::SearchCache,
    /// What the index counts days by: the real time, unless a test moved it.
    clock: JobsClock,
}

/// The clock the job index reads: due dates and days late come from it.
pub type JobsClock = Arc<dyn Fn() -> chrono::DateTime<chrono::Utc> + Send + Sync>;

impl Workspace {
    fn new(store: Arc<dyn DocStore>, ctx: Ctx, clock: JobsClock) -> Self {
        Self {
            store,
            ctx,
            sessions: Mutex::new(SessionCache::default()),
            library: LibraryCache::new(),
            jobs: napkin_host::jobindex::IndexCache::new(),
            search: napkin_host::searchindex::SearchCache::new(),
            clock,
        }
    }

    /// Now, as the job index counts it.
    pub fn now(&self) -> chrono::DateTime<chrono::Utc> {
        (self.clock)()
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
    /// Signs the client's links (`links`); the session secret's child, or a key for this run.
    pub link_key: Vec<u8>,
    pub limiter: crate::links::Limiter,
    /// The pieces served lately (`links::PieceCache`) and the bytes one link may be sent a minute.
    pub pieces: crate::links::PieceCache,
    /// Failed code tries and code mails per link, kept on disk (`links::CodeGuard`), and their limits.
    pub code_guard: crate::links::CodeGuard,
    pub code_failed_max: u32,
    pub code_sends_per_day: u32,
    pub piece_byte_cap: u64,
    /// Signs the emailed code and the cookie that proves it (`links`), under its own label.
    pub code_key: Vec<u8>,
    /// The only way mail leaves the server (`mail`): off unless a sender is configured.
    pub mail: crate::mail::Mail,
    /// Unix seconds, for the code's window; a test sets it.
    pub code_clock: Arc<dyn Fn() -> u64 + Send + Sync>,
    pub events: EventBus,
    pub exports: ExportStore,
    pub meter: Meter,
    /// Origin the app frame loads from. Same-origin until the sandbox gets its
    /// own hostname, at which point this is the only thing that changes here.
    pub sandbox_origin: Option<String>,
    /// The dogfood build's record (`NAPKIN_DOGFOOD=1`); `None` everywhere else.
    pub dogfood: Option<Arc<crate::dogfood::Dogfood>>,
    /// Where an agency's own door table may be served from (`roles/<agency>.json`).
    pub roles_dir: Option<PathBuf>,
    /// Each person's work sessions and days (features/timesheet-sessions.clan).
    pub timesheets: crate::timesheet::Timesheets,
    /// What each person has marked done on Needs you, private to them (features/needs-you-full.clan).
    pub done: Arc<dyn crate::needs::DoneStore>,
    /// Who works in each agency and with which roles (features/agency-setup.clan).
    pub directory: Arc<dyn crate::directory::Directory>,
    /// What no document's chain holds: exports, links, sign-ins and copies of permission changes.
    pub audit: Arc<dyn crate::audit::AuditLog>,
    jobs_clock: JobsClock,
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
            timesheets: crate::timesheet::Timesheets::new(root.clone()),
            done: Arc::new(crate::needs::FileDone::new(root.join("needs-done"))),
            directory: Arc::new(crate::directory::RegistryDirectory::new(root.clone())),
            audit: Arc::new(crate::audit::FileAudit::new(root.clone())),
            code_guard: crate::links::CodeGuard::new(root.join("link-codes")),
            root,
            seed: None,
            config,
            tokens: TokenStore::default(),
            link_key: crate::links::fresh_key(),
            limiter: crate::links::Limiter::default(),
            pieces: crate::links::PieceCache::default(),
            code_failed_max: crate::links::CODE_FAILED_LIFETIME,
            code_sends_per_day: crate::links::CODE_SENDS_PER_DAY,
            piece_byte_cap: crate::links::PIECE_BYTES_PER_MINUTE,
            code_key: crate::links::fresh_key(),
            mail: crate::mail::Mail::off(),
            code_clock: Arc::new(crate::links::unix_now),
            events: EventBus::default(),
            exports: ExportStore::default(),
            meter: Meter::new(agent_cap),
            sandbox_origin,
            dogfood: None,
            roles_dir: None,
            jobs_clock: Arc::new(chrono::Utc::now),
            workspaces: Mutex::new(HashMap::new()),
        }
    }

    /// Sign client links with the session secret's child key, so every server behind one
    /// load balancer reads the same links; without one, or with one under 32 bytes (the
    /// session secret's own floor, a guessable one signs nothing), links last as long as this
    /// process.
    pub fn with_link_secret(mut self, secret: Option<&[u8]>) -> Self {
        if let Some(s) = secret.filter(|s| s.len() >= crate::links::MIN_SECRET) {
            self.link_key = crate::links::key_from(s);
            self.code_key = crate::links::code_key_from(s);
        }
        self
    }

    /// Mail goes through `mailer`, at most `cap` a tenant a day (`mail.rs`).
    pub fn with_mailer(mut self, mailer: Arc<dyn crate::mail::Mailer>, cap: u32) -> Self {
        self.mail = crate::mail::Mail::new(mailer, cap);
        self
    }

    /// The sender `NAPKIN_MAIL`, `NAPKIN_MAIL_OUTBOX` and `NAPKIN_MAIL_DAILY_CAP` ask for; off when unset.
    pub fn with_mailer_from_env(self) -> Self {
        let get = |k: &str| std::env::var(k).ok();
        let (m, cap) = crate::mail::from_env(
            get("NAPKIN_MAIL").as_deref(),
            get("NAPKIN_MAIL_OUTBOX").as_deref(),
            get("NAPKIN_MAIL_DAILY_CAP").as_deref(),
        );
        self.with_mailer(m, cap)
    }

    /// The bytes of pieces one review link may be sent a minute, for a test that wants a small one.
    pub fn with_piece_byte_cap(mut self, cap: u64) -> Self {
        self.piece_byte_cap = cap;
        self
    }

    /// The limits on one link's emailed code: failed tries over its life, and mails a day.
    pub fn with_code_limits(mut self, failed_lifetime: u32, sends_per_day: u32) -> Self {
        self.code_failed_max = failed_lifetime;
        self.code_sends_per_day = sends_per_day;
        self
    }

    /// A clock for the emailed code's window, in Unix seconds, so a test moves past ten minutes.
    pub fn with_code_clock(mut self, clock: impl Fn() -> u64 + Send + Sync + 'static) -> Self {
        self.code_clock = Arc::new(clock);
        self
    }

    /// A clock for the timesheets, so a test sets the time of day.
    pub fn with_timesheet_clock(mut self, clock: impl Fn() -> i64 + Send + Sync + 'static) -> Self {
        self.timesheets = self.timesheets.with_clock(clock);
        self
    }

    /// A clock for the directory's cache, in seconds, so a test moves past its minute.
    pub fn with_directory_clock(mut self, clock: impl Fn() -> i64 + Send + Sync + 'static) -> Self {
        self.directory =
            Arc::new(crate::directory::RegistryDirectory::new(self.root.clone()).with_clock(clock));
        self
    }

    /// A clock for the job index, so a test sets the day an approval is late by.
    pub fn with_jobs_clock(
        mut self,
        clock: impl Fn() -> chrono::DateTime<chrono::Utc> + Send + Sync + 'static,
    ) -> Self {
        self.jobs_clock = Arc::new(clock);
        self
    }

    /// The e2e stack moves the clock by writing an RFC 3339 time to this file (`NAPKIN_TEST_CLOCK_FILE`);
    /// with no file, or one that holds no time, it is the real time. Never set in a deployment.
    pub fn with_jobs_clock_file(self, file: Option<PathBuf>) -> Self {
        match file {
            None => self,
            Some(file) => self.with_jobs_clock(move || {
                std::fs::read_to_string(&file)
                    .ok()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s.trim()).ok())
                    .map_or_else(chrono::Utc::now, |t| t.with_timezone(&chrono::Utc))
            }),
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

    /// The tenant's own directory: where its settings files live.
    pub fn tenant_dir(&self, tenant: &TenantId) -> PathBuf {
        self.root.join(tenant.as_str())
    }

    /// The directory an agency's own door table is read from.
    pub fn with_roles_dir(mut self, dir: Option<PathBuf>) -> Self {
        self.roles_dir = dir;
        self
    }

    /// Give `tenant` a workspace on `store` (tests that count what reaches it).
    #[cfg(test)]
    pub(crate) fn put_workspace(&self, tenant: &TenantId, store: Arc<dyn DocStore>) {
        let ws = Arc::new(Workspace::new(store, tenant.ctx(), self.jobs_clock.clone()));
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
        let workspace = Arc::new(Workspace::new(store, tenant.ctx(), self.jobs_clock.clone()));
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
