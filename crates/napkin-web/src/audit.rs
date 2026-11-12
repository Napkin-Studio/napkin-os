// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The audit view (features/agency-setup.clan; v2 section 9): every approval, export and permission
//! change of an agency, for its admins, and nobody can quietly change it.
//!
//! Three sources, none of them copied where a document already says it:
//!
//! - **approvals** (a signature, a lock, a client's answer) are read from the documents' decision
//!   chains each time (`napkin_host::audit::approvals`);
//! - **permission and settings changes** are the agency registry's own decisions, copied into the file
//!   below once each (a line says which decision it copies), so they stay readable if the registry is
//!   ever replaced;
//! - **what no chain holds** (an export, a link issued, a sign-in, a sign-in refused) is an
//!   append-only file per tenant, `audit.jsonl`: [`AuditLog`], with [`FileAudit`] as its store today.
//!
//! The file's lines are hashed, each with the hash of the one before, and the newest line's hash is
//! kept beside it (`audit.head`). An edited, inserted or removed line breaks the chain, and a file cut
//! short no longer matches its head: `GET /audit/verify` says so. This is tamper-evident, not
//! tamper-proof: someone who can rewrite both files and every hash after the edit could hide it, which
//! the foundation's own store (S1) closes by anchoring the head elsewhere.
//!
//! It never holds timesheet days, corrections or signal consents, and what it holds is who, what, which
//! document and version, and when (for a sign-in, the source address, as the sign-in log does). It
//! never counts or ranks a person. Admin only (`Group::Admin`: `/audit`).

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Extension, Json, Router};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::auth::Account;
use crate::error::ApiResult;
use crate::state::AppCtx;
use crate::tenant::{Tenant, TenantId};

const FILE: &str = "audit.jsonl";
const HEAD: &str = "audit.head";
const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// What the view says a line is.
pub const APPROVAL: &str = "approval";
pub const EXPORT: &str = "export";
pub const LINK: &str = "link";
pub const SIGN_IN: &str = "sign-in";
pub const PERMISSION: &str = "permission";
pub const SETTINGS: &str = "settings";

/// What a caller gives; the log adds the sequence, the time and the hashes.
#[derive(Clone, Debug, Default)]
pub struct NewLine {
    pub who: String,
    pub kind: &'static str,
    pub what: String,
    pub doc: Option<String>,
    pub version: Option<String>,
    pub ip: Option<String>,
    /// The registry decision this line copies, when it copies one.
    pub reference: Option<String>,
}

/// A line as the file holds it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Line {
    pub seq: u64,
    pub at: String,
    pub who: String,
    pub kind: String,
    pub what: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "ref")]
    pub reference: Option<String>,
    pub prev: String,
    pub hash: String,
}

fn hash_of(l: &Line) -> String {
    // an array, so no field can run into the next
    let body = serde_json::json!([
        l.prev,
        l.seq,
        l.at,
        l.who,
        l.kind,
        l.what,
        l.doc,
        l.version,
        l.ip,
        l.reference
    ]);
    format!("{:x}", Sha256::digest(body.to_string().as_bytes()))
}

/// What `GET /audit/verify` answers.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Verified {
    pub ok: bool,
    pub lines: usize,
    /// Where the chain first breaks (a 1-based line), when it does.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
}

/// An append-only log per tenant. The file store is the only one today; the agency database can
/// replace it without a route changing.
pub trait AuditLog: Send + Sync {
    fn append(&self, tenant: &TenantId, line: NewLine) -> Result<(), String>;
    fn lines(&self, tenant: &TenantId) -> Vec<Line>;
    fn verify(&self, tenant: &TenantId) -> Verified;
}

/// `audit.jsonl` and `audit.head` in the tenant's own directory. One writer at a time within a process.
pub struct FileAudit {
    root: PathBuf,
    write: Mutex<()>,
}

impl FileAudit {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            write: Mutex::new(()),
        }
    }

    fn dir(&self, tenant: &TenantId) -> PathBuf {
        self.root.join(tenant.as_str())
    }

    fn read(&self, tenant: &TenantId) -> Vec<Result<Line, String>> {
        let Ok(text) = std::fs::read_to_string(self.dir(tenant).join(FILE)) else {
            return Vec::new();
        };
        text.lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str::<Line>(l).map_err(|e| e.to_string()))
            .collect()
    }
}

impl AuditLog for FileAudit {
    fn append(&self, tenant: &TenantId, new: NewLine) -> Result<(), String> {
        let _g = self.write.lock().unwrap_or_else(|e| e.into_inner());
        let last = self.read(tenant).into_iter().rev().find_map(Result::ok);
        let mut line = Line {
            seq: last.as_ref().map_or(1, |l| l.seq + 1),
            at: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            who: new.who,
            kind: new.kind.to_string(),
            what: new.what,
            doc: new.doc,
            version: new.version,
            ip: new.ip,
            reference: new.reference,
            prev: last.map_or_else(|| GENESIS.to_string(), |l| l.hash),
            hash: String::new(),
        };
        line.hash = hash_of(&line);
        let dir = self.dir(tenant);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(FILE))
            .map_err(|e| e.to_string())?;
        let mut text = serde_json::to_string(&line).map_err(|e| e.to_string())?;
        text.push('\n');
        f.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        let head = serde_json::json!({ "seq": line.seq, "hash": line.hash });
        let tmp = dir.join(format!("{HEAD}.tmp"));
        std::fs::write(&tmp, head.to_string()).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, dir.join(HEAD)).map_err(|e| e.to_string())
    }

    fn lines(&self, tenant: &TenantId) -> Vec<Line> {
        self.read(tenant)
            .into_iter()
            .filter_map(Result::ok)
            .collect()
    }

    fn verify(&self, tenant: &TenantId) -> Verified {
        let read = self.read(tenant);
        let n = read.len();
        let broken = |line: usize, why: String| Verified {
            ok: false,
            lines: n,
            line: Some(line),
            problem: Some(why),
        };
        let mut prev = GENESIS.to_string();
        let mut last: Option<(u64, String)> = None;
        for (i, r) in read.into_iter().enumerate() {
            let Ok(l) = r else {
                return broken(i + 1, "a line cannot be read".into());
            };
            if l.seq != i as u64 + 1 {
                return broken(i + 1, "a line is missing or out of order".into());
            }
            if l.prev != prev {
                return broken(i + 1, "a line does not follow the one before it".into());
            }
            if hash_of(&l) != l.hash {
                return broken(i + 1, "a line was changed after it was written".into());
            }
            prev = l.hash.clone();
            last = Some((l.seq, l.hash));
        }
        let head = std::fs::read_to_string(self.dir(tenant).join(HEAD))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
        match (head, last) {
            (None, None) => {}
            (Some(h), Some((seq, hash))) => {
                if h["seq"].as_u64() != Some(seq) || h["hash"].as_str() != Some(hash.as_str()) {
                    return broken(n, "the log ends sooner than it should".into());
                }
            }
            (Some(_), None) => return broken(0, "the log is missing".into()),
            (None, Some(_)) => return broken(n, "the log has no record of where it ends".into()),
        }
        Verified {
            ok: true,
            lines: n,
            line: None,
            problem: None,
        }
    }
}

// ── writing the lines nobody else keeps ─────────────────────────────────────

/// How many refused sign-ins one agency's log takes in ten minutes: anyone can type a name, and the
/// log is not a place to fill.
const REFUSED_PER_WINDOW: u32 = 30;
const WINDOW_SECS: i64 = 600;

fn refused_budget(tenant: &TenantId) -> bool {
    static SEEN: Mutex<Option<HashMap<TenantId, (i64, u32)>>> = Mutex::new(None);
    let now = chrono::Utc::now().timestamp();
    let mut guard = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    let e = map.entry(tenant.clone()).or_insert((now, 0));
    if now - e.0 >= WINDOW_SECS {
        *e = (now, 0);
    }
    e.1 += 1;
    e.1 <= REFUSED_PER_WINDOW
}

/// Note one thing the log keeps. A failure is logged and never stops what it notes.
pub fn note(ctx: &AppCtx, tenant: &TenantId, line: NewLine) {
    if let Err(e) = ctx.audit.append(tenant, line) {
        tracing::warn!(error = %e, "audit line not written");
    }
}

/// A sign-in, or a refused one, for the agency named in the account name. Only an agency that
/// already has a workspace here is written to, so a made-up name leaves nothing behind.
pub fn note_sign_in(ctx: &AppCtx, name: &str, ip: &str, refused: bool) {
    let Some((who, agency)) = crate::auth::Account::parse_username(name) else {
        return;
    };
    let tenant = TenantId::of_agency(&agency);
    if !ctx.tenant_dir(&tenant).is_dir() {
        return;
    }
    if refused && !refused_budget(&tenant) {
        return;
    }
    note(
        ctx,
        &tenant,
        NewLine {
            who,
            kind: SIGN_IN,
            what: if refused {
                "Sign-in refused."
            } else {
                "Signed in."
            }
            .into(),
            ip: Some(ip.to_string()),
            ..Default::default()
        },
    );
}

/// Copy the registry's permission and settings decisions that the log has not copied yet, oldest
/// first, each once. Called after every write to the registry and before the view reads.
pub fn sync_registry(ctx: &AppCtx, tenant: &TenantId) {
    let store = &*ctx.workspace(tenant).store;
    let Ok(history) = napkin_host::agency::history(store) else {
        return;
    };
    let known: HashSet<String> = ctx
        .audit
        .lines(tenant)
        .into_iter()
        .filter_map(|l| l.reference)
        .collect();
    for d in history.into_iter().rev() {
        let Some(id) = d.id.clone() else { continue };
        if known.contains(&id) || d.action == napkin_host::agency::ACTIVATE {
            continue;
        }
        note(
            ctx,
            tenant,
            NewLine {
                who: d.who,
                kind: if d.action == napkin_host::agency::SET_SETTINGS {
                    SETTINGS
                } else {
                    PERMISSION
                },
                what: d.what,
                doc: Some(d.target).filter(|t| !t.is_empty()),
                reference: Some(id),
                ..Default::default()
            },
        );
    }
}

// ── the view ────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/t/{tenant}/audit", get(view))
        .route("/t/{tenant}/audit/verify", get(verify))
}

/// What the view lists of a line: an allow list. The hashes and the copy's reference stay in the file.
#[derive(Serialize, Debug, PartialEq)]
pub struct Entry {
    pub at: String,
    pub who: String,
    pub kind: String,
    pub what: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip: Option<String>,
}

#[derive(Deserialize)]
struct ViewQuery {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

/// The agency's audit view, newest first. `?kind=approval` (or export, link, sign-in, permission,
/// settings) narrows it; `?limit=` caps it (500 by default).
async fn view(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
    Query(q): Query<ViewQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    crate::agency::admin_of(account)?;
    sync_registry(&ctx, &tenant);
    let store = &*ctx.workspace(&tenant).store;
    let mut entries: Vec<Entry> = napkin_host::audit::approvals(store)?
        .into_iter()
        .map(|a| Entry {
            at: a.at,
            who: a.who,
            kind: APPROVAL.into(),
            what: a.what,
            doc: Some(a.doc),
            version: a.version,
            ip: None,
        })
        .collect();
    entries.extend(ctx.audit.lines(&tenant).into_iter().map(|l| Entry {
        at: l.at,
        who: l.who,
        kind: l.kind,
        what: l.what,
        doc: l.doc,
        version: l.version,
        ip: l.ip,
    }));
    if let Some(k) = q.kind.as_deref().filter(|k| !k.is_empty()) {
        entries.retain(|e| e.kind == k);
    }
    entries.sort_by(|a, b| b.at.cmp(&a.at));
    let total = entries.len();
    entries.truncate(q.limit.unwrap_or(500).clamp(1, 5000));
    Ok(Json(
        serde_json::json!({ "total": total, "lines": entries }),
    ))
}

/// Whether the log's chain holds: 200 when it does, 409 and the first line that breaks it when not.
async fn verify(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
) -> ApiResult<(StatusCode, Json<Verified>)> {
    crate::agency::admin_of(account)?;
    let v = ctx.audit.verify(&tenant);
    Ok((
        if v.ok {
            StatusCode::OK
        } else {
            StatusCode::CONFLICT
        },
        Json(v),
    ))
}
