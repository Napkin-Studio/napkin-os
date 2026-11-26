// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! One tenant's documents, addressed by opaque ids.
//!
//! The desktop's `FsStore` makes a [`DocId`] a filesystem path, which is right
//! there — the user picks files and the shell hands the path back. On the web a
//! document id travels in URLs and comes from a browser, so a path would be
//! both a traversal hazard and a leak of the server's layout. Here an id is an
//! opaque `<kind>-<name>` token this module alone knows how to resolve, and
//! everything lives under the tenant's own directory:
//!
//! ```text
//! <root>/<tenant>/documents/<slug>.clan     doc-<slug>
//! <root>/<tenant>/apps/<app_id>/app.clan    app-<app_id>
//! <root>/<tenant>/home-<version>.clan       home-<version>
//! ```
//!
//! That the same handlers serve both shapes is the whole point of splitting
//! storage into a `PartStore` and a `Library`.

use std::collections::HashMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use napkin_host::{
    Base, BlobInfo, BlobStore, Change, DocId, HostError, HostResult, Library, PartStore, Version,
};

/// What a trashed document said about itself, and who trashed it.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct TrashNote {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub app_id: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub by: Option<String>,
}

pub struct TenantStore {
    root: PathBuf,
    /// One lock per document path: the version check and the write are one
    /// critical section, so two writers from the same version cannot both win.
    locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}

/// Distinguishes the temp files of concurrent writers within one process.
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

impl TenantStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            locks: Mutex::new(HashMap::new()),
        }
    }

    /// This tenant's directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Where this tenant's snapshots live (never listed in the library).
    pub fn snapshots_dir(&self) -> PathBuf {
        self.root.join("snapshots")
    }

    /// When `id` was last written, as milliseconds since the epoch.
    pub fn saved_at_ms(&self, id: &DocId) -> Option<u128> {
        let m = std::fs::metadata(self.path_for(id).ok()?).ok()?;
        m.modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_millis())
    }

    /// Where deleted documents wait: `<tenant>/trash/<unix-ms>-<slug>.clan`.
    fn trash_dir(&self) -> PathBuf {
        self.root.join("trash")
    }

    /// Move a document to the trash and say when (ms since the epoch).
    /// Only `doc-` documents: an app template or the home page is never trashed.
    /// What the Trash page shows (title, tool, client, who) is read from the
    /// document and kept beside it in `<ms>-<slug>.json`.
    pub fn trash(&self, id: &DocId, now_ms: u128, by: Option<&str>) -> HostResult<()> {
        if !id.as_str().starts_with("doc-") {
            return Err(HostError::bad_request("only a document can be deleted"));
        }
        let path = self.path_for(id)?;
        let lock = self.lock_for(&path);
        let _held = lock.lock().unwrap_or_else(|p| p.into_inner());
        if !path.is_file() {
            return Err(HostError::not_found(format!("{id}: no such document")));
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("doc.clan");
        let dir = self.trash_dir();
        let io = |e: std::io::Error| HostError::internal(e.to_string());
        std::fs::create_dir_all(&dir).map_err(io)?;
        let note = std::fs::read(&path)
            .ok()
            .and_then(|b| clan_sdk::ClanFile::from_bytes(b).ok())
            .map(|c| {
                let m = c.manifest();
                TrashNote {
                    title: Some(m.title.clone()),
                    app_id: m.app.as_ref().map(|a| a.app_id.clone()),
                    client_id: m.client.as_ref().map(|r| r.id.clone()),
                    by: by.map(String::from),
                }
            })
            .unwrap_or(TrashNote {
                by: by.map(String::from),
                ..TrashNote::default()
            });
        // The note first: a trashed document without one still lists (as
        // untitled), a note without a document is never read.
        if let Ok(json) = serde_json::to_vec(&note) {
            let stem = name.strip_suffix(".clan").unwrap_or(name);
            let _ = std::fs::write(dir.join(format!("{now_ms}-{stem}.json")), json);
        }
        std::fs::rename(&path, dir.join(format!("{now_ms}-{name}"))).map_err(io)?;
        sync_dir(&dir);
        if let Some(d) = path.parent() {
            sync_dir(d);
        }
        Ok(())
    }

    /// Every trashed document, as `(id, trashed_at_ms)`, newest first. A
    /// document trashed twice (restored in between) lists once per trashing.
    pub fn trashed(&self) -> Vec<(DocId, u128)> {
        let Ok(rd) = std::fs::read_dir(self.trash_dir()) else {
            return Vec::new();
        };
        let mut out: Vec<(DocId, u128)> = rd
            .flatten()
            .filter_map(|e| {
                let n = e.file_name().into_string().ok()?;
                let stem = n.strip_suffix(".clan")?;
                let (ms, slug) = stem.split_once('-')?;
                Some((doc_id(slug), ms.parse().ok()?))
            })
            .collect();
        out.sort_by_key(|(_, ms)| std::cmp::Reverse(*ms));
        out
    }

    /// What was kept about the copy of `id` trashed at `ms`, if anything.
    pub fn trash_note(&self, id: &DocId, ms: u128) -> TrashNote {
        let slug = id.as_str().trim_start_matches("doc-");
        std::fs::read(self.trash_dir().join(format!("{ms}-{slug}.json")))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    /// Put the newest trashed copy of `id` back. A 409 when a document of that
    /// id is in the library already, a 404 when nothing of it is in the trash.
    pub fn restore(&self, id: &DocId) -> HostResult<()> {
        let path = self.path_for(id)?;
        let lock = self.lock_for(&path);
        let _held = lock.lock().unwrap_or_else(|p| p.into_inner());
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("doc.clan");
        let (_, ms) = self
            .trashed()
            .into_iter()
            .find(|(d, _)| d == id)
            .ok_or_else(|| HostError::not_found(format!("{id}: not in the trash")))?;
        if path.exists() {
            return Err(HostError::conflict(format!(
                "{id} is in the library already"
            )));
        }
        let io = |e: std::io::Error| HostError::internal(e.to_string());
        let dir = path.parent().expect("a document path has a parent");
        std::fs::create_dir_all(dir).map_err(io)?;
        std::fs::rename(self.trash_dir().join(format!("{ms}-{name}")), &path).map_err(io)?;
        let _ = std::fs::remove_file(self.trash_dir().join(format!(
            "{ms}-{}.json",
            name.strip_suffix(".clan").unwrap_or(name)
        )));
        sync_dir(dir);
        sync_dir(&self.trash_dir());
        Ok(())
    }

    /// Remove trashed documents trashed at or before `cutoff_ms`; with
    /// `dry_run` only list them. Returns the files' document ids.
    pub fn purge_trash(&self, cutoff_ms: u128, dry_run: bool) -> HostResult<Vec<DocId>> {
        let mut out = Vec::new();
        for (id, ms) in self.trashed() {
            if ms > cutoff_ms {
                continue;
            }
            if !dry_run {
                let name = format!("{ms}-{}.clan", id.as_str().trim_start_matches("doc-"));
                std::fs::remove_file(self.trash_dir().join(&name))
                    .map_err(|e| HostError::internal(e.to_string()))?;
                let _ = std::fs::remove_file(self.trash_dir().join(name.replace(".clan", ".json")));
            }
            out.push(id);
        }
        Ok(out)
    }

    fn lock_for(&self, path: &Path) -> Arc<Mutex<()>> {
        self.locks
            .lock()
            .unwrap()
            .entry(path.to_path_buf())
            .or_default()
            .clone()
    }

    /// Resolve an id to a path inside this tenant's tree, or refuse it.
    ///
    /// Refusal is the security boundary: ids arrive from the browser, so
    /// anything that is not one of the three known shapes — or that carries a
    /// separator or a `..` — never becomes a path at all.
    fn path_for(&self, id: &DocId) -> HostResult<PathBuf> {
        let raw = id.as_str();
        let (kind, name) = raw
            .split_once('-')
            .ok_or_else(|| HostError::bad_request(format!("malformed document id: {raw}")))?;
        if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err(HostError::bad_request(format!("unsafe document id: {raw}")));
        }
        Ok(match kind {
            "doc" => self.documents_dir().join(format!("{name}.clan")),
            "app" => self.apps_dir().join(name).join("app.clan"),
            "home" => self.root.join(format!("home-{name}.clan")),
            _ => {
                return Err(HostError::bad_request(format!(
                    "unknown document id kind: {raw}"
                )))
            }
        })
    }

    fn documents_dir(&self) -> PathBuf {
        self.root.join("documents")
    }

    fn apps_dir(&self) -> PathBuf {
        self.root.join("apps")
    }
}

/// Keep an id URL- and path-safe: everything outside the allowed set collapses
/// to `-`. Dots survive because app ids are reverse-DNS (`ie.napkin.home`) and
/// fork branches are `<slug>.<agent>`.
fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Temp file, fsync, rename over `target`, fsync the directory. A leftover
/// `*.tmp` from a crash ends in `.tmp`, so no listing takes it for a document.
pub(crate) fn write_durably(dir: &Path, target: &Path, bytes: &[u8]) -> HostResult<()> {
    let io = |e: std::io::Error| HostError::internal(e.to_string());
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("doc");
    let tmp = dir.join(format!(
        ".{name}.{}-{}.tmp",
        std::process::id(),
        TMP_SEQ.fetch_add(1, Ordering::SeqCst)
    ));
    let written = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&tmp, target)
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(io(e));
    }
    // Directory fsync makes the rename itself durable (not available everywhere).
    sync_dir(dir);
    Ok(())
}

fn sync_dir(dir: &Path) {
    if let Ok(d) = std::fs::File::open(dir) {
        let _ = d.sync_all();
    }
}

pub fn doc_id(slug: &str) -> DocId {
    DocId::new(format!("doc-{}", slugify(slug)))
}

pub fn app_id(app: &str) -> DocId {
    DocId::new(format!("app-{}", slugify(app)))
}

impl PartStore for TenantStore {
    fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
        let path = self.path_for(id)?;
        std::fs::read(&path).map_err(|e| HostError::not_found(format!("{id}: {e}")))
    }

    fn exists(&self, id: &DocId) -> bool {
        self.path_for(id).map(|p| p.exists()).unwrap_or(false)
    }

    /// The only write. Under the document's lock it compares `change.base`
    /// with the version on disk (read again here, not remembered from open):
    /// `Base::Absent` over an existing document and `Base::At(v)` when the
    /// document has moved on are both a 409 that names the version now there;
    /// `Base::At` on a missing document is a 404. The bytes go to a temp file
    /// beside the target, are fsynced, renamed over it, and the directory is
    /// fsynced, so an answered write survives a kill and a reader never sees
    /// half a file.
    fn apply(&self, change: &Change) -> HostResult<Version> {
        let path = self.path_for(&change.doc)?;
        let lock = self.lock_for(&path);
        let _held = lock.lock().unwrap_or_else(|p| p.into_inner());
        let current = match std::fs::read(&path) {
            Ok(b) => Some(Version::of_archive(&b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(HostError::internal(e.to_string())),
        };
        match (&change.base, &current) {
            (Base::Absent, Some(latest)) => {
                return Err(HostError::conflict_with_latest(
                    format!("{} already exists", change.doc),
                    latest.as_str(),
                ))
            }
            (Base::At(_), None) => {
                return Err(HostError::not_found(format!(
                    "{}: no such document",
                    change.doc
                )))
            }
            (Base::At(v), Some(latest)) if v != latest => {
                return Err(HostError::conflict_with_latest(
                    "This project was saved from somewhere else since you opened it.",
                    latest.as_str(),
                ))
            }
            _ => {}
        }
        let dir = path.parent().expect("a document path has a parent");
        std::fs::create_dir_all(dir).map_err(|e| HostError::internal(e.to_string()))?;
        write_durably(dir, &path, &change.bytes)?;
        Ok(change.archive_version())
    }

    fn blobs(&self) -> Option<&dyn BlobStore> {
        Some(self)
    }
}

/// The tenant's files, each once, under the sha256 of its bytes:
///
/// ```text
/// <root>/<tenant>/blobs/<aa>/<hex>          the file (aa: first two hex digits)
/// <root>/<tenant>/blobs/.pins/<hex>         held by a document outside the library
/// ```
///
/// The directory is the tenant's own, so a hash another tenant stores does not
/// exist here (features/spinoff-asset-links).
impl TenantStore {
    fn blobs_dir(&self) -> PathBuf {
        self.root.join("blobs")
    }

    /// The path of `sha256` (`sha256:<64 hex>`), or a refusal: the hash comes
    /// from a document and must not become any other path.
    fn blob_path(&self, sha256: &str) -> HostResult<PathBuf> {
        let hex = sha256
            .strip_prefix("sha256:")
            .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(|| HostError::bad_request(format!("not a sha256: {sha256}")))?;
        let hex = hex.to_ascii_lowercase();
        Ok(self.blobs_dir().join(&hex[..2]).join(hex))
    }
}

impl BlobStore for TenantStore {
    fn put(&self, bytes: &[u8]) -> HostResult<String> {
        let sha = clan_sdk::hash::sha256_prefixed(bytes);
        let path = self.blob_path(&sha)?;
        if path.exists() {
            return Ok(sha); // never overwritten
        }
        let dir = path.parent().expect("a blob path has a parent");
        std::fs::create_dir_all(dir).map_err(|e| HostError::internal(e.to_string()))?;
        // Written whole beside it, then renamed: a reader never sees half a file.
        let tmp = dir.join(format!(".tmp-{}-{}", std::process::id(), &sha[7..15]));
        std::fs::write(&tmp, bytes).map_err(|e| HostError::internal(e.to_string()))?;
        std::fs::rename(&tmp, &path).map_err(|e| HostError::internal(e.to_string()))?;
        Ok(sha)
    }

    fn get(&self, sha256: &str) -> HostResult<Vec<u8>> {
        let path = self.blob_path(sha256)?;
        std::fs::read(path).map_err(|_| HostError::not_found(format!("no stored file {sha256}")))
    }

    fn has(&self, sha256: &str) -> bool {
        self.blob_path(sha256).map(|p| p.is_file()).unwrap_or(false)
    }

    fn list(&self) -> Vec<BlobInfo> {
        let mut out = Vec::new();
        let Ok(top) = std::fs::read_dir(self.blobs_dir()) else {
            return out;
        };
        for shard in top.flatten() {
            let name = shard.file_name().to_string_lossy().to_string();
            if name.len() != 2 || !shard.path().is_dir() {
                continue; // .pins and anything else
            }
            let Ok(files) = std::fs::read_dir(shard.path()) else {
                continue;
            };
            for f in files.flatten() {
                let hex = f.file_name().to_string_lossy().to_string();
                if hex.len() != 64 {
                    continue; // a .tmp- file mid-write
                }
                let written_at = f
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_secs());
                out.push(BlobInfo {
                    sha256: format!("sha256:{hex}"),
                    written_at,
                });
            }
        }
        out
    }

    fn remove(&self, sha256: &str) -> HostResult<()> {
        let path = self.blob_path(sha256)?;
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(HostError::internal(e.to_string())),
        }
    }

    fn pin(&self, sha256: &str) -> HostResult<()> {
        let hex = self.blob_path(sha256)?;
        let hex = hex.file_name().expect("a name").to_owned();
        let dir = self.blobs_dir().join(".pins");
        std::fs::create_dir_all(&dir).map_err(|e| HostError::internal(e.to_string()))?;
        std::fs::write(dir.join(hex), b"").map_err(|e| HostError::internal(e.to_string()))
    }

    fn pinned(&self) -> Vec<String> {
        let Ok(rd) = std::fs::read_dir(self.blobs_dir().join(".pins")) else {
            return Vec::new();
        };
        rd.flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .map(|h| format!("sha256:{h}"))
            .collect()
    }
}

impl Library for TenantStore {
    fn app_candidates(&self) -> Vec<DocId> {
        let Ok(rd) = std::fs::read_dir(self.apps_dir()) else {
            return Vec::new();
        };
        rd.flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| e.file_name().into_string().ok())
            .map(|name| app_id(&name))
            .collect()
    }

    fn app_template(&self, app: &str) -> DocId {
        app_id(app)
    }

    fn documents(&self) -> Vec<DocId> {
        let Ok(rd) = std::fs::read_dir(self.documents_dir()) else {
            return Vec::new();
        };
        rd.flatten()
            .filter_map(|e| {
                let p = e.path();
                (p.extension().and_then(|x| x.to_str()) == Some("clan"))
                    .then(|| p.file_stem().and_then(|s| s.to_str()).map(doc_id))
                    .flatten()
            })
            .collect()
    }

    fn new_document(&self, app: &str, id_short: &str) -> HostResult<DocId> {
        std::fs::create_dir_all(self.documents_dir())
            .map_err(|e| HostError::internal(e.to_string()))?;
        Ok(doc_id(&format!("{}-{}", app.replace('.', "-"), id_short)))
    }

    fn home(&self, version_tag: &str) -> HostResult<DocId> {
        std::fs::create_dir_all(&self.root).map_err(|e| HostError::internal(e.to_string()))?;
        Ok(DocId::new(format!("home-{}", slugify(version_tag))))
    }

    fn fork_branch(&self, parent: &DocId, agent: &str) -> DocId {
        // Branches are siblings of the parent, exactly as on disk: the id keeps
        // the parent's slug and gains the agent's name.
        let slug = parent
            .as_str()
            .strip_prefix("doc-")
            .unwrap_or(parent.as_str());
        doc_id(&format!("{slug}.{agent}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, TenantStore, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("tenant-a");
        let store = TenantStore::new(root.clone());
        (dir, store, root)
    }

    #[test]
    fn ids_resolve_inside_the_tenant_tree() {
        let (_d, s, _root) = store();
        assert!(s
            .path_for(&DocId::new("doc-brief-1a2b"))
            .unwrap()
            .ends_with("documents/brief-1a2b.clan"));
        assert!(s
            .path_for(&DocId::new("app-ie.napkin.home"))
            .unwrap()
            .ends_with("apps/ie.napkin.home/app.clan"));
        assert!(s
            .path_for(&DocId::new("home-v6"))
            .unwrap()
            .ends_with("home-v6.clan"));
    }

    // Document ids come from the browser. Anything that is not one of the three
    // known shapes must never reach the filesystem.
    #[test]
    fn hostile_ids_never_become_paths() {
        let (_d, s, _root) = store();
        for bad in [
            "doc-../../etc/passwd",
            "doc-..",
            "app-../../../root/.ssh/id_rsa",
            "home-a/b",
            "doc-a\\b",
            "secret-x",
            "nodash",
            "doc-",
        ] {
            assert!(
                s.path_for(&DocId::new(bad)).is_err(),
                "{bad} must be refused"
            );
        }
    }

    #[test]
    fn two_tenants_cannot_see_each_others_documents() {
        let dir = tempfile::tempdir().unwrap();
        let a = TenantStore::new(dir.path().join("a"));
        let b = TenantStore::new(dir.path().join("b"));
        let id = doc_id("shared-name");

        a.apply(&Change::create(id.clone(), b"tenant a's bytes".to_vec()))
            .unwrap();
        assert!(
            !b.exists(&id),
            "the same id in another tenant must not resolve"
        );
        assert!(b.read(&id).is_err());
        assert_eq!(a.read(&id).unwrap(), b"tenant a's bytes");
    }

    #[test]
    fn a_file_is_stored_once_and_one_tenant_cannot_read_anothers() {
        let dir = tempfile::tempdir().unwrap();
        let a = TenantStore::new(dir.path().join("a"));
        let b = TenantStore::new(dir.path().join("b"));
        let sha = a.put(b"a client pdf").unwrap();
        assert_eq!(a.put(b"a client pdf").unwrap(), sha);
        assert_eq!(a.list().len(), 1);
        assert_eq!(a.get(&sha).unwrap(), b"a client pdf");
        assert!(!b.has(&sha));
        assert_eq!(b.get(&sha).unwrap_err().status, 404);
        // A hash from a document is never a path.
        for bad in ["sha256:../../x", "../x", "sha256:abc", "sha256:"] {
            assert!(a.get(bad).is_err(), "{bad}");
        }
        a.pin(&sha).unwrap();
        assert_eq!(a.pinned(), vec![sha.clone()]);
        assert_eq!(a.list().len(), 1, "a pin is not a file");
        a.remove(&sha).unwrap();
        assert!(a.list().is_empty());
    }

    #[test]
    fn fork_branches_stay_documents_of_the_same_tenant() {
        let (_d, s, root) = store();
        let branch = s.fork_branch(&doc_id("brief-1a2b"), "researcher");
        assert_eq!(branch.as_str(), "doc-brief-1a2b.researcher");
        assert!(s.path_for(&branch).unwrap().starts_with(&root));
    }

    #[test]
    fn listings_round_trip_through_ids() {
        let (_d, s, _root) = store();
        let id = doc_id("brief-1a2b");
        s.apply(&Change::create(id.clone(), b"x".to_vec())).unwrap();
        assert_eq!(s.documents(), vec![id]);

        let app = s.app_template("ie.napkin.home");
        s.apply(&Change::create(app.clone(), b"y".to_vec()))
            .unwrap();
        assert_eq!(s.app_candidates(), vec![app.clone()]);
        assert_eq!(s.read(&app).unwrap(), b"y");
    }
}
