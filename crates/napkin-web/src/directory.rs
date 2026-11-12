// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The agency's directory, as the web service reads it (features/agency-setup.clan).
//!
//! [`Directory`] is the one interface to an agency's people: `has`, `person`, `people`. Today it
//! is answered by [`RegistryDirectory`], which reads each agency's registry document
//! (`napkin_host::agency`); a later store (control-plane tables) replaces that one type and
//! nothing that calls the trait changes.
//!
//! The rule is one sentence. If an agency has a directory, it is the only source of who may sign
//! in and with which roles; the roster column and the identity provider's `custom:roles` are
//! ignored for that agency. If it has none, sign-in is exactly as it was.
//!
//! [`live_roles`] is where the rule bites on every request: the session's roles are a hint, and
//! the directory's replace them, so a role change or a removal takes effect without a new
//! sign-in. The registry is read at most once a minute per agency, and again at once when its
//! version has moved.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use napkin_host::agency::{self, Registry};
use napkin_host::Version;

use crate::auth::Account;
use crate::state::AppCtx;
use crate::store::TenantStore;
use crate::tenant::{Identity, TenantId};

pub use napkin_host::agency::{Person, State as PersonState};

/// How long a read of the registry is trusted before its version is looked at again.
pub const CACHE_SECS: i64 = 60;

/// An agency's people. `Send + Sync`, cheap to call on every request.
pub trait Directory: Send + Sync {
    /// Whether the agency has a directory (it names people). Without one, sign-in is as before.
    fn has(&self, agency: &str) -> bool;
    /// One person, whatever their state (a removed person is returned, as removed).
    fn person(&self, agency: &str, username: &str) -> Option<Person>;
    /// Everyone on the list, removed people included, in the order they were named.
    fn people(&self, agency: &str) -> Vec<Person>;
    /// This process just wrote the agency's registry: drop what was read.
    fn changed(&self, _agency: &str) {}
}

struct Cached {
    read_at: i64,
    version: Option<Version>,
    registry: Arc<Registry>,
}

/// The directory read from each agency's registry document, with a short cache.
pub struct RegistryDirectory {
    root: PathBuf,
    clock: Arc<dyn Fn() -> i64 + Send + Sync>,
    cache: Mutex<HashMap<String, Cached>>,
}

impl RegistryDirectory {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            clock: Arc::new(|| chrono::Utc::now().timestamp()),
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// A clock in seconds, so a test moves past the cache window.
    pub fn with_clock(mut self, clock: impl Fn() -> i64 + Send + Sync + 'static) -> Self {
        self.clock = Arc::new(clock);
        self
    }

    fn store(&self, agency: &str) -> TenantStore {
        TenantStore::new(self.root.join(TenantId::of_agency(agency).as_str()))
    }

    /// The registry as of now (at most a minute old). A registry that does not parse is answered
    /// from what was last read, else as no directory, with a warning: a broken file must not lock
    /// everyone out, and writes refuse it instead.
    fn registry(&self, agency: &str) -> Arc<Registry> {
        let now = (self.clock)();
        // An agency nobody has opened has no folder, and asking about it must not make one: the name
        // comes from a sign-in form, so anyone can type any.
        if !self
            .root
            .join(TenantId::of_agency(agency).as_str())
            .is_dir()
        {
            return Arc::new(Registry::default());
        }
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = cache.get(agency) {
            if now - c.read_at < CACHE_SECS {
                return c.registry.clone();
            }
        }
        let store = self.store(agency);
        let current = agency::version(&store);
        if let (Ok(v), Some(c)) = (&current, cache.get_mut(agency)) {
            if *v == c.version {
                c.read_at = now;
                return c.registry.clone();
            }
        }
        match agency::read(&store) {
            Ok((reg, version)) => {
                let reg = Arc::new(reg);
                cache.insert(
                    agency.to_string(),
                    Cached {
                        read_at: now,
                        version,
                        registry: reg.clone(),
                    },
                );
                reg
            }
            Err(e) => {
                tracing::warn!(agency, error = %e, "agency registry unreadable; roles stay as signed");
                match cache.get(agency) {
                    Some(c) => c.registry.clone(),
                    None => Arc::new(Registry::default()),
                }
            }
        }
    }
}

impl Directory for RegistryDirectory {
    fn has(&self, agency: &str) -> bool {
        self.registry(agency).has_directory()
    }

    fn person(&self, agency: &str, username: &str) -> Option<Person> {
        self.registry(agency).person(username).cloned()
    }

    fn people(&self, agency: &str) -> Vec<Person> {
        self.registry(agency).people.clone()
    }

    fn changed(&self, agency: &str) {
        self.cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(agency);
    }
}

/// The 401 a removed person (or one not on the list) gets: the cookie is cleared, and the shell
/// shows the sign-in screen.
fn signed_out(identity: Option<&Arc<Identity>>) -> Response {
    let body = serde_json::json!({
        "ok": false,
        "error": "That name is not on this studio's list. Ask your studio admin to add you.",
        "signin": true,
    })
    .to_string();
    let mut r = Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.into())
        .unwrap();
    if let Some(id) = identity {
        if let Ok(v) = header::HeaderValue::from_str(&id.cookie(crate::auth::SESSION_COOKIE, "", 0))
        {
            r.headers_mut().append(header::SET_COOKIE, v);
        }
    }
    r
}

fn forbidden() -> Response {
    let body =
        serde_json::json!({ "ok": false, "error": "Your role cannot open this." }).to_string();
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.into())
        .unwrap()
}

/// The signed-in person's roles are the directory's, on every request. Sits inside the tenant
/// layer (which names the person) and outside the permission check (which reads the roles).
pub async fn live_roles(
    State(ctx): State<Arc<AppCtx>>,
    mut request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if !(path.starts_with("/auth/") || path == "/healthz") {
        if let Some(account) = request.extensions().get::<Account>().cloned() {
            if ctx.directory.has(&account.agency) {
                match ctx.directory.person(&account.agency, &account.username) {
                    // A listed person whose roles were emptied by hand is refused, not let
                    // through: no roles means every door elsewhere, and never in a directory.
                    Some(p) if p.state != PersonState::Removed && p.roles.is_empty() => {
                        return forbidden();
                    }
                    Some(p) if p.state != PersonState::Removed => {
                        let mut a = account;
                        a.roles = p.roles;
                        request.extensions_mut().insert(a);
                    }
                    _ => {
                        let identity = request.extensions().get::<Arc<Identity>>().cloned();
                        return signed_out(identity.as_ref());
                    }
                }
            }
        }
    }
    next.run(request).await
}
