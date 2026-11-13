// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The document a shell has open, and the thin wrapper that runs the OS
//! layer's operations against it.
//!
//! The store's version is the truth. What a session holds is a [`Document`]:
//! a snapshot of one document at the version it was read or last written at,
//! which another writer may already have moved past. Every operation lives in
//! [`crate::ops`] as a function from a snapshot to the [`Change`]s it implies;
//! this wrapper hands them the snapshot, applies what they return through the
//! store's single write funnel, and moves the snapshot on to the version the
//! store reports. The desktop and browser shells keep calling the same methods
//! they always have; a server calls the operations directly, inside its own
//! transaction, and never needs a `Session` at all.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ctx::Ctx;
use crate::document::{Change, Document, Version};
use crate::error::{HostError, HostResult};
use crate::event::HostEvent;
use crate::library::{self, Backref, BackrefWritten};
use crate::ops::{edit, middleware, read, Outcome};
use crate::store::{DocId, DocStore};
use crate::view::{self, ViewSource};

pub use crate::ops::{attribute, content_type_for, sanitize_asset_name};

/// Napkin's app-signing public key (ed25519, base64). Safe to embed and ship
/// open-source: it can only VERIFY signatures, never forge them. Apps signed by
/// the matching private key are granted scoped host access.
pub const NAPKIN_PUBLIC_KEY: &str = "iE5TL/Am5Tu4jktPTXNp52HhgJWo8eLoDKgjtlyZ4fc=";

/// Scoped capabilities a trusted app may use (the allowlist — extend as needed).
/// Untrusted apps get none of these; they keep only the safe clan:// data/asset
/// /proxy routes.
pub const TRUSTED_CAPABILITIES: &[&str] = &["notify", "set-theme"];

#[derive(Serialize, Deserialize)]
pub struct ManifestInfo {
    pub title: String,
    pub id: String,
    pub version: String,
    pub created_at: String,
    pub updated_at: String,
    pub document_type: Option<String>,
    pub sha256: String,
    pub file_count: usize,
    pub lineage: Option<LineageInfo>,
    pub app: Option<AppMeta>,
    /// Who the document is for, when it has a client (`manifest.client`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client: Option<clan_sdk::ClientRef>,
}

/// App metadata surfaced to the shell (launcher cards, "running an app" chrome).
#[derive(Serialize, Deserialize, Clone)]
pub struct AppMeta {
    pub name: String,
    pub app_id: String,
    pub version: String,
    pub icon: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct LineageInfo {
    pub parent_id: String,
    pub parent_uri: String,
    pub parent_sha256: Option<String>,
    pub delta: String,
}

#[derive(Serialize, Deserialize)]
pub struct OpenResult {
    /// The document's id in its store. On the desktop that is its path, which
    /// is what the shell hands back to `install_app` and `open`.
    pub path: String,
    pub manifest: ManifestInfo,
    pub validation: String,
    pub has_human_view: bool,
    /// `"authored"` for template apps / their instances (view.source == "app"),
    /// else `"legacy"` (AI-generated HTML). Drives which edit bridge the shell
    /// injects and how the view is rendered.
    pub render_model: String,
    /// `true` when this file is a template app (document_type == "template").
    pub is_template: bool,
    /// `true` when the app is validly signed by Napkin's key → scoped host
    /// capabilities are available to it. With a library view this is the
    /// installed template's signature, not the document's (see [`crate::view`]).
    pub trusted: bool,
    /// Where the view is served from: `"library"` — the installed app's
    /// current view, same app id and major — or `"document"`, the copy the
    /// document carries. Absent from a reply that predates it: `"document"`.
    #[serde(default)]
    pub view_source: ViewSource,
    /// The app version of the view served: the installed app's for a library
    /// view, else the document's own. `None` for a document that is not an
    /// instance of an app.
    #[serde(default)]
    pub view_version: Option<String>,
}

/// What a write did, once its changes are in the store: the reply for the
/// caller, and the events to fan out.
#[derive(Debug)]
pub struct Applied {
    pub reply: Value,
    pub events: Vec<HostEvent>,
    /// Nothing needed writing (an unchanged edit). The caller still gets its
    /// reply; the shell may still want telling.
    pub noop: bool,
    /// The version the open document is at once the changes are in — the one
    /// the store reported, not one the operation guessed.
    pub version: Option<Version>,
}

/// What one shell is looking at: the snapshot it has open and how it is
/// showing it.
///
/// Shell-local by design. None of it is document state — two viewers of one
/// document each have their own — and none of it is an operation's input
/// except the snapshot, which an operation borrows and never keeps. A shell
/// that runs the operations itself can hold one of these directly; `Session`
/// holds one behind a lock for the shells that want the old object.
#[derive(Default)]
pub struct ViewState {
    /// The document this view has open, at the version it last read or wrote.
    pub open: Option<Document>,
    /// Whether the edit bridge is live (`clan://edit-mode`).
    pub edit_mode: bool,
}

/// Where [`Session::open_observed`] has got to: each step of an open, as it
/// ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenMark {
    /// The view lock is held (the wait for it is over).
    Locked,
    /// The archive is read from the store.
    Read { bytes: usize },
    /// The archive is parsed and its app signature checked.
    Verified,
    /// The installed app's view is chosen (it may read the template).
    Resolved,
    /// What the shell is told about the document is worked out.
    Described,
}

/// The thin wrapper the desktop and browser shells use: a store, the context
/// they act as, and one [`ViewState`].
pub struct Session {
    store: Arc<dyn DocStore>,
    /// Who this shell acts as when a caller does not say otherwise: the one
    /// local user on the desktop and in the browser. A server passes its own
    /// per-request [`Ctx`] to the `_as` operations instead.
    ctx: Ctx,
    view: Mutex<ViewState>,
    /// Where the jobs a middleware reply names are noted, so the library can say
    /// what is running. Absent for a session nobody lists (tests, one-offs).
    runs: Option<Arc<crate::runs::RunTracker>>,
}

/// Counts the legacy patches that reached the store, so tests can assert that
/// one edit is one write (#9) and an unchanged one is none (F4).
#[cfg(test)]
pub(crate) static SAVE_COUNT: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

impl Session {
    /// A session acting as the local user — what the desktop and browser
    /// shells want, and what every existing caller got before `Ctx` existed.
    pub fn new(store: Arc<dyn DocStore>) -> Self {
        Self::with_ctx(store, Ctx::local())
    }

    pub fn with_ctx(store: Arc<dyn DocStore>, ctx: Ctx) -> Self {
        Self {
            store,
            ctx,
            view: Mutex::new(ViewState::default()),
            runs: None,
        }
    }

    /// Note every middleware job this session sees in `runs` (the tenant's
    /// [`crate::LibraryCache::runs`]).
    pub fn with_runs(mut self, runs: Arc<crate::runs::RunTracker>) -> Self {
        self.runs = Some(runs);
        self
    }

    pub fn store(&self) -> &Arc<dyn DocStore> {
        &self.store
    }

    /// The context this session acts under by default.
    pub fn ctx(&self) -> &Ctx {
        &self.ctx
    }

    /// Run a read against the open snapshot, or fail with "no file open".
    pub fn read<T>(&self, f: impl FnOnce(&Document) -> HostResult<T>) -> HostResult<T> {
        let view = self.view.lock().unwrap();
        f(view.open.as_ref().ok_or_else(HostError::no_file_open)?)
    }

    /// Run a write operation against the open snapshot and apply what it
    /// returns.
    ///
    /// The lock is held from the snapshot the operation sees until the store
    /// has taken its changes, so two writes through one session cannot
    /// interleave. That serialises this process only; another writer to the
    /// same store is what `Change::base` — checked at apply, W2-A4 — is for.
    pub fn perform(
        &self,
        ctx: &Ctx,
        op: impl FnOnce(&Ctx, &Document) -> HostResult<Outcome>,
    ) -> HostResult<Applied> {
        let mut view = self.view.lock().unwrap();
        let doc = view.open.as_ref().ok_or_else(HostError::no_file_open)?;
        let outcome = op(ctx, doc)?;
        let events = outcome.events();
        let noop = outcome.is_noop();
        for change in &outcome.changes {
            self.commit(&mut view.open, change)?;
        }
        Ok(Applied {
            reply: outcome.reply,
            events,
            noop,
            version: view.open.as_ref().map(|d| d.version().clone()),
        })
    }

    /// Apply one change through the store — the only write a session makes —
    /// and, when it is to the open document, move the snapshot on to the
    /// version the store now reports.
    fn commit(&self, current: &mut Option<Document>, change: &Change) -> HostResult<()> {
        let version = self.store.apply(change)?;
        if let Some(open) = current.as_mut() {
            if open.id() == &change.doc {
                *open = open.advance(change, version)?;
            }
        }
        Ok(())
    }

    pub fn is_open(&self) -> bool {
        self.view.lock().unwrap().open.is_some()
    }

    pub fn trusted(&self) -> bool {
        self.view
            .lock()
            .unwrap()
            .open
            .as_ref()
            .map(Document::trusted)
            .unwrap_or(false)
    }

    pub fn current_id(&self) -> Option<DocId> {
        self.view
            .lock()
            .unwrap()
            .open
            .as_ref()
            .map(|d| d.id().clone())
    }

    /// The version the open snapshot is at — what a write from it is based on.
    pub fn current_version(&self) -> Option<Version> {
        self.view
            .lock()
            .unwrap()
            .open
            .as_ref()
            .map(|d| d.version().clone())
    }

    /// The packed archive of the open snapshot as handed out — the single-file
    /// handoff ("save as", the web download). It carries the view the user
    /// sees: with a library view, that view is swapped into the copy
    /// ([`view::served_archive`]). The stored document is not touched; see
    /// [`Self::stored_bytes`] for it exactly as stored.
    pub fn raw_bytes(&self) -> HostResult<Vec<u8>> {
        self.read(|d| Ok(view::served_archive(d)?.into_owned()))
    }

    /// The packed archive of the open snapshot exactly as stored.
    pub fn stored_bytes(&self) -> HostResult<Vec<u8>> {
        self.read(|d| Ok(d.bytes().to_vec()))
    }

    pub fn title(&self) -> HostResult<String> {
        self.read(|d| Ok(d.title().to_string()))
    }

    /// The open document's app id, when it is an instance of one. What decides
    /// which apps will accept it as a spin-off source.
    pub fn app_id(&self) -> Option<String> {
        self.view
            .lock()
            .unwrap()
            .open
            .as_ref()
            .and_then(|d| d.app_id().map(String::from))
    }

    // ── Opening ─────────────────────────────────────────────────────────────

    /// Read `id` as it stands now and make it the open snapshot, shown with
    /// the installed app's view when the library has one of the same major
    /// ([`crate::view`]).
    ///
    /// The view lock is held from the read until the snapshot is in place, as
    /// [`Self::perform`] holds it across a write. Read outside it, a reopen
    /// racing a write could read the bytes from before the write and put them
    /// back over the snapshot the write had moved on: the open document went
    /// back a version, and the reply to the write carried the old data (UAT
    /// round 12: the desk re-read a Research document while its report was
    /// being written, and the page was handed the document without it).
    pub fn open(&self, id: DocId) -> HostResult<OpenResult> {
        self.open_observed(id, &mut |_| {})
    }

    /// [`Self::open`], telling `mark` as each step ends, so a server can time
    /// where an open spends its time. The host keeps no clock (wasm32 has
    /// none it may use); the caller measures between marks.
    pub fn open_observed(
        &self,
        id: DocId,
        mark: &mut dyn FnMut(OpenMark),
    ) -> HostResult<OpenResult> {
        let mut state = self.view.lock().unwrap();
        mark(OpenMark::Locked);
        // One read: the snapshot holds the bytes it was built from (#10).
        let bytes = self.store.parts().read(&id)?;
        mark(OpenMark::Read { bytes: bytes.len() });
        let doc = Document::from_bytes(id, bytes)?;
        mark(OpenMark::Verified);
        let doc = view::resolve(&*self.store, doc, NAPKIN_PUBLIC_KEY);
        mark(OpenMark::Resolved);
        let result = read::describe(&doc);
        mark(OpenMark::Described);
        state.open = Some(doc);
        Ok(result)
    }

    // ── Reading ─────────────────────────────────────────────────────────────

    /// One entry of the open archive, as text. Backs the shell's `get_data` /
    /// `get_chain` / `get_agent_state` / `get_context`.
    pub fn entry_string(&self, path: &str) -> HostResult<String> {
        self.read(|d| read::entry_string(d, path))
    }

    pub fn human_html(&self) -> HostResult<String> {
        self.read(read::human_html)
    }

    /// The page the app frame loads (`clan://document?model=&capture=&theme=`),
    /// composed from the open view for the frame's `reach` ([`crate::frame`]).
    pub fn frame_page(&self, query: &str, reach: crate::frame::Reach) -> HostResult<String> {
        self.read(|d| read::frame_page(d, query, reach))
    }

    /// `GET /assets/<rel>` — serve a binary asset from inside the artifact ZIP.
    pub fn serve_asset(&self, rel: &str) -> HostResult<(String, Vec<u8>)> {
        read::check_asset_path(rel)?;
        self.read(|d| read::serve_asset(d, rel))
    }

    /// `GET /chain` — the decision chain as JSON (lazy fetch for the view).
    pub fn chain_json(&self) -> HostResult<Value> {
        self.read(read::chain_json)
    }

    /// Compose a standalone document from the open `.clan`. Returns
    /// `(html, filename_stem)`.
    pub fn compose_export(&self, provenance: bool, no_brand: bool) -> HostResult<(String, String)> {
        self.read(|d| read::compose_export(d, provenance, no_brand))
    }

    /// Splice each attachment's cached extracted text into `payload`. A no-op
    /// with nothing open.
    pub fn attach_extracted_text(&self, payload: &mut Value) {
        if let Some(d) = self.view.lock().unwrap().open.as_ref() {
            read::attach_extracted_text(d, payload);
        }
    }

    /// The provenance bundle an agent reads; `null` with nothing open.
    pub fn clan_context_for_agent(&self) -> Value {
        self.view
            .lock()
            .unwrap()
            .open
            .as_ref()
            .map(read::clan_context_for_agent)
            .unwrap_or(Value::Null)
    }

    /// `GET /upstream` — what changed in each ancestor the open document
    /// carries (Contract 4 §8.1, item 6), the ancestors as the store holds
    /// them for `ctx`.
    pub fn upstream_as(&self, ctx: &Ctx) -> HostResult<Value> {
        self.read(|d| Ok(library::upstream_status(&*self.store, ctx, d)))
    }

    /// Tell the open document's parents what its decision `decision` did
    /// with something it carried (Contract 4 §7.4), as the person in `ctx`.
    /// Called after the decision is written: the snapshot holds it. Writes
    /// only to the parents, never to the open document.
    pub fn write_backrefs_as(
        &self,
        ctx: &Ctx,
        decision: &str,
        backref: &Backref,
    ) -> Vec<BackrefWritten> {
        self.read(|d| {
            Ok(library::write_backrefs(
                &*self.store,
                ctx,
                d,
                decision,
                backref,
            ))
        })
        .unwrap_or_default()
    }

    // ── Transient view state ────────────────────────────────────────────────

    pub fn set_edit_mode(&self, active: bool) {
        self.view.lock().unwrap().edit_mode = active;
    }

    pub fn edit_mode(&self) -> bool {
        self.view.lock().unwrap().edit_mode
    }

    // ── Writing ─────────────────────────────────────────────────────────────
    //
    // Each write comes twice: as the session's own context (what the desktop
    // and browser shells have always called) and `_as` an explicit one (what
    // the routing table calls with the context the shell resolved).

    pub fn snapshot(&self, rendered_html: &str) -> HostResult<()> {
        self.snapshot_as(&self.ctx, rendered_html).map(|_| ())
    }

    pub fn snapshot_as(&self, ctx: &Ctx, rendered_html: &str) -> HostResult<Applied> {
        let applied = self.perform(ctx, |c, d| edit::snapshot(c, d, rendered_html))?;
        crate::log::log("snapshot: written to human/index.html");
        Ok(applied)
    }

    pub fn save_patch(&self, id: String, content: String) -> HostResult<()> {
        self.save_patch_as(&self.ctx, &id, &content).map(|_| ())
    }

    pub fn save_patch_as(&self, ctx: &Ctx, id: &str, content: &str) -> HostResult<Applied> {
        let applied = self.perform(ctx, |c, d| edit::save_patch(c, d, id, content))?;
        if !applied.noop {
            #[cfg(test)]
            SAVE_COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            crate::log::log(&format!("save_patch: done, file repacked. id={id:?}"));
        }
        Ok(applied)
    }

    /// Handle a `clan://patch` request body. Saves the patch exactly once and
    /// returns the payload for the informational `clan-patch-saved` event.
    /// The frontend listener must treat that event as a notification only and
    /// never call `save_patch` in response — doing so writes the file twice (#9).
    pub fn handle_patch_request(&self, body: &str) -> Option<Value> {
        self.handle_patch_request_as(&self.ctx, body)
            .map(|a| a.reply)
    }

    pub fn handle_patch_request_as(&self, ctx: &Ctx, body: &str) -> Option<Applied> {
        let json = serde_json::from_str::<Value>(body).ok()?;
        let id = json["id"].as_str()?;
        let content = json["content"].as_str()?;
        self.save_patch_as(ctx, id, content).ok()
    }

    /// `POST /patch-data` — structured write to shared/data.yaml with attribution,
    /// recorded in the decision chain (the provenance-native human/AI co-author
    /// write path).
    pub fn patch_data(&self, body: &str) -> HostResult<Value> {
        self.patch_data_as(&self.ctx, body).map(|a| a.reply)
    }

    /// [`Self::patch_data`] under an explicit context — the server's path, where
    /// the actor is whoever authenticated this request.
    pub fn patch_data_as(&self, ctx: &Ctx, body: &str) -> HostResult<Applied> {
        let input = edit::PatchData::parse(body)?;
        self.perform(ctx, |c, d| edit::patch_data(c, d, input))
    }

    /// `POST /patch-schema` — move the document to a newer output schema (ops::edit::patch_schema).
    pub fn patch_schema_as(&self, ctx: &Ctx, body: &str) -> HostResult<Applied> {
        let schema = body.to_string();
        self.perform(ctx, |c, d| edit::patch_schema(c, d, &schema))
    }

    /// `POST /fork` — fork into ≥2 branch siblings written next to the parent.
    /// Does NOT advance the open document.
    pub fn fork(&self, body: &str) -> HostResult<Value> {
        self.fork_as(&self.ctx, body).map(|a| a.reply)
    }

    pub fn fork_as(&self, ctx: &Ctx, body: &str) -> HostResult<Applied> {
        let agents = edit::parse_fork(body)?;
        let store = self.store.clone();
        self.perform(ctx, |c, d| edit::fork(c, d, &*store, &agents))
    }

    /// `POST /upload-asset?name=&agent=` — store a binary asset inside the archive.
    pub fn upload_asset(
        &self,
        name: &str,
        agent: Option<&str>,
        body: Vec<u8>,
    ) -> HostResult<Value> {
        self.upload_asset_as(&self.ctx, name, agent, body)
            .map(|a| a.reply)
    }

    pub fn upload_asset_as(
        &self,
        ctx: &Ctx,
        name: &str,
        agent: Option<&str>,
        body: Vec<u8>,
    ) -> HostResult<Applied> {
        let name = edit::parse_asset_name(name)?;
        self.perform(ctx, |c, d| edit::upload_asset(c, d, &name, agent, body))
    }

    /// Update the open document's title (e.g. to the AI-set brief name).
    pub fn set_title(&self, title: &str) -> HostResult<Value> {
        self.set_title_as(&self.ctx, title).map(|a| a.reply)
    }

    pub fn set_title_as(&self, ctx: &Ctx, title: &str) -> HostResult<Applied> {
        self.perform(ctx, |c, d| edit::set_title(c, d, title))
    }

    /// Replace or append `agent/context.md`.
    pub fn set_context(&self, markdown: &str, append: bool) -> HostResult<Value> {
        self.set_context_as(&self.ctx, markdown, append)
            .map(|a| a.reply)
    }

    pub fn set_context_as(&self, ctx: &Ctx, markdown: &str, append: bool) -> HostResult<Applied> {
        self.perform(ctx, |c, d| edit::set_context(c, d, markdown, append))
    }

    /// Apply the `change` a `napkin.middleware/1` reply carries to the open
    /// document, as `process:middleware` (see [`middleware::apply`]).
    pub fn apply_middleware_as(&self, ctx: &Ctx, reply: &Value) -> HostResult<Applied> {
        self.perform(ctx, |c, d| middleware::apply(c, d, reply))
    }

    /// Settle what the proxy brought back for `request_kind: "middleware"`:
    /// `envelope` is the proxy's `{ok, status, endpoint, data, error}`.
    ///
    /// A reply that is not `napkin.middleware/1` becomes an error the app sees
    /// (M4 — see [`middleware::check_api`]). A reply with a `change` has it
    /// applied here, by the host, and the app gets the envelope back with
    /// `change` replaced by `{applied: true, version, base_stale, applied_fields,
    /// contested_fields, contests}` or
    /// `{applied: false, reason}`. When a change landed, or was `already
    /// applied` by another poll, the envelope also
    /// carries `clan: {id, revision, version, data}` — the document as it now stands —
    /// so the view can refresh without writing anything. The app never writes
    /// middleware output itself; what it is handed is informational. Returns
    /// the events the apply fans out: the same `clan-data-changed` a
    /// patch-data emits.
    pub fn settle_middleware(&self, ctx: &Ctx, mut envelope: Value) -> (Value, Vec<HostEvent>) {
        // The upstream call itself failed: already an error, nothing to settle.
        if envelope.get("ok").and_then(Value::as_bool) != Some(true) {
            return (envelope, Vec::new());
        }
        let data = envelope.get("data").cloned().unwrap_or(Value::Null);
        if let Err(e) = middleware::check_api(&data) {
            return (
                serde_json::json!({
                    "ok": false,
                    "status": envelope.get("status").cloned().unwrap_or(Value::Null),
                    "endpoint": envelope.get("endpoint").cloned().unwrap_or(Value::Null),
                    // Whatever answered is not the middleware; its body is not
                    // passed on as if it were.
                    "data": Value::Null,
                    "error": e.message,
                }),
                Vec::new(),
            );
        }
        // Whatever else it carries, the reply says what the job is doing.
        if let (Some(runs), Some(doc)) = (&self.runs, self.current_id()) {
            runs.record(&doc, &data);
        }
        if data.get("change").map_or(true, Value::is_null) {
            return (envelope, Vec::new());
        }
        let (settled, events) = match self.apply_middleware_as(ctx, &data) {
            Ok(done) => {
                let mut reply = done.reply;
                if reply.get("applied").and_then(Value::as_bool) == Some(true) {
                    if let (Some(obj), Some(v)) = (reply.as_object_mut(), done.version) {
                        obj.insert("version".into(), Value::String(v.to_string()));
                    }
                }
                (reply, done.events)
            }
            Err(e) => (middleware::refused(e.message), Vec::new()),
        };
        let landed = settled.get("applied").and_then(Value::as_bool) == Some(true)
            && settled.get("noop").is_none();
        // Someone else's poll (the shell's job watcher, another tab) applied
        // this change first: the page asking now holds data from before it,
        // so it is handed the document too, or it never redraws.
        let caught_up = settled.get("reason").and_then(Value::as_str) == Some("already applied");
        envelope["data"]["change"] = settled;
        // The view holds its own copy of the data (`window.__CLAN__.data`) and
        // nothing re-reads the archive into it after a host-side write — a
        // patch-data refreshes it from the patch the page itself sent. So the
        // document as it now stands rides back beside the middleware's reply,
        // in the same shape the request's `clan` had, for the bridge to swap
        // in and announce with `clan:dataupdated`. Outside `data`: that is the
        // middleware's body, and this is the host's.
        if landed || caught_up {
            if let Some(clan) = self.document_now() {
                envelope["clan"] = clan;
            }
        }
        (envelope, events)
    }

    /// The open document as it now stands, in the shape a request's `clan`
    /// has — what rides back beside a reply after a host-side write, so the
    /// view can swap it into `window.__CLAN__.data`.
    pub fn document_now(&self) -> Option<Value> {
        self.read(|d| {
            Ok(serde_json::json!({
                "id": d.clan().document_id(),
                "revision": d.clan().manifest().id,
                "version": d.version().as_str(),
                "data": read::data_json(d),
                "edits": crate::ops::members::edits_map(d.clan()),
            }))
        })
        .ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::FsStore;
    use clan_sdk::ClanFile;

    /// Serialises tests that assert on the global SAVE_COUNT, so one test's
    /// saves never land inside another's before/after delta window.
    static SAVE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Create a real .clan file on disk and open it into a fresh session.
    fn open_temp_clan() -> (tempfile::TempDir, Session, DocId) {
        let dir = tempfile::tempdir().unwrap();
        let id = DocId::from(dir.path().join("test.clan"));
        let bytes = clan_sdk::create(clan_sdk::CreateOptions {
            title: "Viewer Test".into(),
            brief: "test brief".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap();
        std::fs::write(id.as_str(), bytes).unwrap();

        let session = Session::new(Arc::new(FsStore::new(dir.path().to_path_buf())));
        session.open(id.clone()).unwrap();
        (dir, session, id)
    }

    fn saves() -> usize {
        SAVE_COUNT.load(std::sync::atomic::Ordering::SeqCst)
    }

    // Regression for #10: opening must not read the file from disk twice.
    // The snapshot's own bytes are the ones that were read, and must match
    // what is on disk at the version it was opened at.
    #[test]
    fn open_populates_state_from_single_read() {
        let (_dir, session, id) = open_temp_clan();

        let view = session.view.lock().unwrap();
        let loaded = view.open.as_ref().expect("state must hold the opened file");
        assert_eq!(loaded.title(), "Viewer Test");
        assert_eq!(
            loaded.bytes(),
            std::fs::read(id.as_str()).unwrap().as_slice(),
            "in-memory archive must match the file on disk"
        );
    }

    // Regression for #9: one clan://patch request must produce exactly one
    // save (one repack + one disk write), with the emitted payload echoing
    // the edit. The frontend listener must never save again.
    #[test]
    fn patch_request_saves_exactly_once() {
        let _guard = SAVE_TEST_LOCK.lock().unwrap();
        let (_dir, session, id) = open_temp_clan();

        let before = saves();
        let payload = session
            .handle_patch_request(r#"{"id":"heading-0","content":"Edited Title"}"#)
            .expect("valid patch body must save and return a payload");
        assert_eq!(saves() - before, 1, "a single edit must save exactly once");
        assert_eq!(payload["id"], "heading-0");
        assert_eq!(payload["content"], "Edited Title");

        // The patch landed on disk exactly once.
        let on_disk = ClanFile::open(id.as_str()).unwrap();
        let patches = on_disk.read_entry_string("human/patches.yaml").unwrap();
        assert_eq!(patches.matches("heading-0").count(), 1);
        assert!(patches.contains("Edited Title"));
    }

    #[test]
    fn patch_request_rejects_malformed_bodies() {
        let _guard = SAVE_TEST_LOCK.lock().unwrap();
        let (_dir, session, _id) = open_temp_clan();
        let before = saves();
        assert!(session.handle_patch_request("not json").is_none());
        assert!(session.handle_patch_request(r#"{"id":"x"}"#).is_none());
        assert_eq!(saves(), before, "malformed bodies must not trigger saves");
    }

    // F4: re-saving identical content for the same id is a no-op — the blur
    // bridge can fire on focus-without-change, and that must not churn the file.
    #[test]
    fn resaving_identical_content_is_a_noop() {
        let _guard = SAVE_TEST_LOCK.lock().unwrap();
        let (_dir, session, id) = open_temp_clan();

        // First save lands.
        session
            .save_patch("heading-0".into(), "Same Title".into())
            .unwrap();
        let after_first = std::fs::read(id.as_str()).unwrap();
        let count_after_first = saves();

        // Identical re-save: no rewrite, no SAVE_COUNT increment, bytes unchanged.
        session
            .save_patch("heading-0".into(), "Same Title".into())
            .unwrap();
        assert_eq!(
            saves(),
            count_after_first,
            "identical re-save must be skipped (F4)"
        );
        assert_eq!(
            after_first,
            std::fs::read(id.as_str()).unwrap(),
            "file must be byte-identical"
        );

        // A genuine change still writes.
        session
            .save_patch("heading-0".into(), "Changed Title".into())
            .unwrap();
        assert!(saves() > count_after_first, "a real edit must still save");
        let on_disk = ClanFile::open(id.as_str()).unwrap();
        assert!(on_disk
            .read_entry_string("human/patches.yaml")
            .unwrap()
            .contains("Changed Title"));
    }

    // --- clan:// API routes ---

    #[test]
    fn patch_schema_moves_a_document_to_a_newer_schema_once() {
        let (_dir, session, id) = open_temp_clan();
        let ctx = session.ctx.clone();
        let schema =
            r#"{"type":"object","properties":{"script":{"type":"string","maxLength":1500}}}"#;
        let first = session
            .patch_schema_as(&ctx, schema)
            .expect("patch-schema should succeed");
        assert_eq!(first.reply["changed"], true);
        let on_disk = ClanFile::open(id.as_str()).unwrap();
        let stored: Value = serde_json::from_str(
            &on_disk
                .read_entry_string("agent/output-schema.json")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(stored, serde_json::from_str::<Value>(schema).unwrap());
        // The same schema again changes nothing.
        let again = session.patch_schema_as(&ctx, schema).unwrap();
        assert_eq!(again.reply["changed"], false);
        // Not JSON: refused.
        assert!(session.patch_schema_as(&ctx, "{not json").is_err());
    }

    #[test]
    fn patch_data_writes_data_and_attributed_decision() {
        let (_dir, session, id) = open_temp_clan();

        let body = r#"{"patch":{"verdict":"HubSpot"},"agent":"human","action":"set verdict","rationale":"best fit","pinned":true}"#;
        let out = session.patch_data(body).expect("patch-data should succeed");
        assert_eq!(out["ok"], true);
        assert_eq!(out["keys"][0], "verdict");

        let on_disk = ClanFile::open(id.as_str()).unwrap();
        let data = on_disk.read_entry_string("shared/data.yaml").unwrap();
        assert!(data.contains("HubSpot"), "data layer updated: {data}");
        let chain = on_disk
            .read_entry_string("agent/decision-chain.yaml")
            .unwrap();
        assert!(
            chain.contains("human"),
            "decision attributed to human: {chain}"
        );
        assert!(
            chain.contains("verdict"),
            "fields_changed records the key: {chain}"
        );
    }

    // The body's `agent` is a claim; the actor is whoever the shell says asked.
    // Both survive in the chain, and the claim cannot displace the actor.
    #[test]
    fn attribution_comes_from_ctx_and_the_body_agent_is_only_a_claim() {
        let (_dir, session, id) = open_temp_clan();
        let ctx = Ctx::new(crate::ctx::Actor::human("u-42").unwrap());
        let body = r#"{"patch":{"tone":"warm"},"agent":"analysis-model","action":"edit","rationale":"drafted"}"#;
        session.patch_data_as(&ctx, body).unwrap();

        let chain = ClanFile::open(id.as_str())
            .unwrap()
            .read_entry("agent/decision-chain.yaml")
            .unwrap();
        let chain = clan_sdk::DecisionChain::from_yaml(&chain).unwrap();
        let newest = &chain.decisions[0];
        assert_eq!(newest.agent, "analysis-model", "the claim is kept");
        assert_eq!(newest.actor.as_deref(), Some("human:u-42"));
        assert_eq!(newest.claimed_agent.as_deref(), Some("analysis-model"));
        assert_eq!(newest.kind.as_deref(), Some("edit"));
        assert_eq!(newest.rationale, "drafted", "the rationale is the caller's");
        assert_eq!(newest.fields_changed, vec!["tone".to_string()]);
        assert!(newest.scope.is_none(), "no tenancy, no scope");
        assert!(newest.id.as_deref().unwrap().starts_with("d_"));

        // A scoped context records its scope; a claim equal to the actor is
        // not recorded twice.
        let ctx = ctx.with_scope(crate::ctx::Scope {
            org: Some("o1".into()),
            brand: Some("b1".into()),
            ..Default::default()
        });
        let body = r#"{"patch":{"tone":"cool"},"agent":"human:u-42","action":"edit"}"#;
        session.patch_data_as(&ctx, body).unwrap();
        let chain = ClanFile::open(id.as_str())
            .unwrap()
            .read_entry("agent/decision-chain.yaml")
            .unwrap();
        let chain = clan_sdk::DecisionChain::from_yaml(&chain).unwrap();
        let newest = &chain.decisions[0];
        let scope = newest.scope.as_ref().unwrap();
        assert_eq!(scope.org.as_deref(), Some("o1"));
        assert_eq!(scope.brand.as_deref(), Some("b1"));
        assert!(newest.claimed_agent.is_none());
        assert_eq!(newest.rationale, "");
    }

    #[test]
    fn patch_data_rejects_non_object_patch() {
        let (_dir, session, _id) = open_temp_clan();
        assert!(session.patch_data(r#"{"patch":"nope"}"#).is_err());
        assert!(session.patch_data("not json").is_err());
    }

    #[test]
    fn patch_data_noop_skips_unchanged_write() {
        let (_dir, session, id) = open_temp_clan();
        let body = r#"{"patch":{"verdict":"HubSpot"},"agent":"human","action":"set"}"#;
        session.patch_data(body).unwrap();
        let chain1 = ClanFile::open(id.as_str())
            .unwrap()
            .read_entry_string("agent/decision-chain.yaml")
            .unwrap();
        // Same value again → no-op: no rewrite, no new decision.
        let res = session.patch_data(body).unwrap();
        assert_eq!(res["noop"], true, "unchanged patch must be a no-op");
        let chain2 = ClanFile::open(id.as_str())
            .unwrap()
            .read_entry_string("agent/decision-chain.yaml")
            .unwrap();
        assert_eq!(chain1, chain2, "no-op must not append a decision");
    }

    #[test]
    fn serve_asset_rejects_traversal() {
        let (_dir, session, _id) = open_temp_clan();
        assert_eq!(
            session.serve_asset("../manifest.yaml").unwrap_err().status,
            400
        );
        assert_eq!(session.serve_asset("/etc/passwd").unwrap_err().status, 400);
        // A missing-but-safe path is a 404, not a 400.
        assert_eq!(session.serve_asset("logo.png").unwrap_err().status, 404);
    }

    #[test]
    fn sanitize_asset_name_blocks_separators() {
        assert!(sanitize_asset_name("logo.png").is_some());
        assert!(sanitize_asset_name("../x").is_none());
        assert!(sanitize_asset_name("a/b.png").is_none());
        assert!(sanitize_asset_name("a\\b.png").is_none());
        assert!(sanitize_asset_name("  ").is_none());
    }

    // A route with nothing open answers 409 "no file open", not a panic.
    #[test]
    fn routes_without_an_open_document_are_a_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let session = Session::new(Arc::new(FsStore::new(dir.path().to_path_buf())));
        let err = session.chain_json().unwrap_err();
        assert_eq!(err.status, 409);
        assert_eq!(err.to_string(), "no file open");
    }

    /// A store that, when armed, holds its next read open after taking the
    /// bytes: it says the read is done and waits (a short while at most) for
    /// a write to land, so a test can put a write between a reopen's read and
    /// its snapshot.
    struct HeldRead {
        inner: FsStore,
        armed: std::sync::atomic::AtomicBool,
        read_done: Mutex<Option<std::sync::mpsc::Sender<()>>>,
        write_done: Mutex<Option<std::sync::mpsc::Receiver<()>>>,
    }

    impl crate::store::PartStore for HeldRead {
        fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
            let bytes = self.inner.read(id)?;
            if self.armed.swap(false, std::sync::atomic::Ordering::SeqCst) {
                if let Some(tx) = self.read_done.lock().unwrap().take() {
                    tx.send(()).unwrap();
                }
                if let Some(rx) = self.write_done.lock().unwrap().take() {
                    let _ = rx.recv_timeout(std::time::Duration::from_millis(300));
                }
            }
            Ok(bytes)
        }
        fn exists(&self, id: &DocId) -> bool {
            self.inner.exists(id)
        }
        fn apply(&self, change: &Change) -> HostResult<Version> {
            self.inner.apply(change)
        }
    }

    impl crate::store::Library for HeldRead {
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
    fn an_observed_open_marks_each_step_in_order() {
        let (_dir, session, id) = open_temp_clan();
        let mut marks = Vec::new();
        session.open_observed(id, &mut |m| marks.push(m)).unwrap();
        assert_eq!(marks.len(), 5);
        assert_eq!(marks[0], OpenMark::Locked);
        assert!(matches!(marks[1], OpenMark::Read { bytes } if bytes > 0));
        assert_eq!(
            &marks[2..],
            &[OpenMark::Verified, OpenMark::Resolved, OpenMark::Described]
        );
    }

    // UAT round 12: the desk reopened a Research document (GET /d/<path>)
    // while the run's last reply was writing the report into it. The reopen
    // read the bytes from before the write and put them back over the
    // snapshot the write had moved on, so the reply carried the document
    // without its report and the page never showed it.
    #[test]
    fn a_reopen_racing_a_write_never_puts_the_old_document_back() {
        use crate::store::PartStore;
        let dir = tempfile::tempdir().unwrap();
        let id = DocId::from(dir.path().join("test.clan"));
        let bytes = clan_sdk::create(clan_sdk::CreateOptions {
            title: "Race Test".into(),
            brief: "test brief".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap();
        std::fs::write(id.as_str(), bytes).unwrap();
        let (read_tx, read_rx) = std::sync::mpsc::channel();
        let (write_tx, write_rx) = std::sync::mpsc::channel();
        let store = Arc::new(HeldRead {
            inner: FsStore::new(dir.path().to_path_buf()),
            armed: std::sync::atomic::AtomicBool::new(false),
            read_done: Mutex::new(Some(read_tx)),
            write_done: Mutex::new(Some(write_rx)),
        });
        let session = Arc::new(Session::new(store.clone()));
        session.open(id.clone()).unwrap();

        // The reopen reads, then waits for the write.
        store.armed.store(true, std::sync::atomic::Ordering::SeqCst);
        let reopen = {
            let (session, id) = (session.clone(), id.clone());
            std::thread::spawn(move || session.open(id).unwrap())
        };
        read_rx.recv().unwrap();
        // The write, while the reopen holds the bytes from before it.
        let write = {
            let session = session.clone();
            std::thread::spawn(move || {
                session.set_context("the report is in", false).unwrap();
                let _ = write_tx.send(());
            })
        };
        reopen.join().unwrap();
        write.join().unwrap();

        let on_disk = store.version(&id).unwrap();
        assert_eq!(
            session.current_version().unwrap(),
            on_disk,
            "the open snapshot is the document as the store holds it"
        );
        assert!(
            session
                .entry_string("agent/context.md")
                .unwrap()
                .contains("the report is in"),
            "the write is in what the session reads back"
        );
    }
}
