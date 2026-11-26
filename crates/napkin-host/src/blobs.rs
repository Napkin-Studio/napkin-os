// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Assets as links (features/spinoff-asset-links).
//!
//! In a workspace with a [`BlobStore`] a document does not hold an uploaded
//! file; it holds a link, a manifest file entry with `linked: true` and the
//! file's sha256, and the bytes are stored once in the workspace. This module
//! is the host's half of that: taking embedded files into the store
//! ([`ingest_assets`], [`link_embedded`]), putting the bytes back for anything
//! that leaves the workspace ([`materialise`]), and clearing what no document
//! uses any more ([`sweep`]). It touches no file or socket: the store does.

use std::collections::BTreeSet;

use clan_sdk::hash::{sha256_prefixed, verify_prefixed};
use clan_sdk::{linkable_asset, ClanBuilder, ClanFile, MANIFEST_PATH};

use crate::error::{HostError, HostResult};
use crate::store::{BlobStore, DocStore};

/// Put every embedded, linkable asset of `clan` into `blobs`. The document is
/// not changed: a spin-off reads the source and links the copy.
pub fn ingest_assets(blobs: &dyn BlobStore, clan: &ClanFile) -> HostResult<()> {
    for (path, bytes) in clan.read_all_entries()? {
        if linkable_asset(&path) {
            blobs.put(&bytes)?;
        }
    }
    Ok(())
}

/// `clan`'s bytes with the embedded linkable asset at `only` moved into
/// `blobs` and left as a link (every one when `only` is `None`). A file the
/// manifest does not list gets an entry. Returns the archive unchanged when
/// there is nothing to move.
pub fn link_embedded(
    blobs: &dyn BlobStore,
    clan: &ClanFile,
    only: Option<&str>,
) -> HostResult<Vec<u8>> {
    let wanted = |p: &str| linkable_asset(p) && only.map_or(true, |o| o == p);
    let entries = clan.read_all_entries()?;
    if !entries.iter().any(|(p, _)| wanted(p)) {
        return Ok(clan.raw_bytes().to_vec());
    }
    let mut manifest = clan.manifest().clone();
    let mut b_entries = Vec::new();
    for (path, bytes) in entries {
        if path == MANIFEST_PATH {
            continue;
        }
        if !wanted(&path) {
            b_entries.push((path, bytes));
            continue;
        }
        let sha = blobs.put(&bytes)?;
        match manifest.files.iter_mut().find(|f| f.path == path) {
            Some(f) => {
                f.sha256 = Some(sha);
                f.linked = true;
            }
            None => {
                let name = path.strip_prefix("human/assets/").unwrap_or(&path);
                manifest.files.push(clan_sdk::FileEntry {
                    id: format!("human-asset-{}", name.replace(['/', '.'], "-")),
                    path: path.clone(),
                    role: "human-asset".into(),
                    content_type: crate::ops::content_type_for(name).into(),
                    priority: None,
                    sha256: Some(sha),
                    linked: true,
                });
            }
        }
    }
    let mut b = ClanBuilder::new(manifest);
    for (p, v) in b_entries {
        b.add_entry(p, v);
    }
    Ok(b.build()?)
}

/// The bytes of a linked file, checked against the hash the document names.
pub fn linked_bytes(blobs: &dyn BlobStore, path: &str, sha256: &str) -> HostResult<Vec<u8>> {
    let bytes = blobs.get(sha256).map_err(|_| {
        HostError::not_found(format!(
            "{path} is a link to a file this workspace does not hold ({sha256})"
        ))
    })?;
    if !verify_prefixed(&bytes, sha256) {
        return Err(HostError::internal(format!(
            "the stored file for {path} does not match its hash {sha256}"
        )));
    }
    Ok(bytes)
}

/// `clan`'s bytes with every link turned back into an embedded file, so what
/// leaves the workspace (a download, an export) opens alone. A link whose file
/// is missing refuses, naming it: never a silent hole.
pub fn materialise(clan: &ClanFile, blobs: Option<&dyn BlobStore>) -> HostResult<Vec<u8>> {
    let links: Vec<_> = clan
        .manifest()
        .files
        .iter()
        .filter(|f| f.linked)
        .cloned()
        .collect();
    if links.is_empty() {
        return Ok(clan.raw_bytes().to_vec());
    }
    let Some(blobs) = blobs else {
        return Err(HostError::conflict(format!(
            "{} is a link and this host holds no file store",
            links[0].path
        )));
    };
    let mut manifest = clan.manifest().clone();
    let mut b_entries = Vec::new();
    for f in &links {
        let sha = f.sha256.as_deref().unwrap_or_default();
        b_entries.push((f.path.clone(), linked_bytes(blobs, &f.path, sha)?));
    }
    for f in manifest.files.iter_mut() {
        f.linked = false;
    }
    let mut b = ClanBuilder::new(manifest);
    for (p, v) in clan.read_all_entries()? {
        if p != MANIFEST_PATH {
            b.add_entry(p, v);
        }
    }
    for (p, v) in b_entries {
        b.add_entry(p, v);
    }
    Ok(b.build()?)
}

/// What a [`sweep`] found.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SweepReport {
    /// Files a document (or a pin) still names.
    pub referenced: usize,
    /// Unreferenced files younger than the grace period.
    pub young: usize,
    /// Unreferenced files past it: removed, or what a dry run would remove.
    pub removed: Vec<String>,
    pub dry_run: bool,
}

/// Remove the files no document of the workspace links to, once they are
/// older than `grace_secs`. A document counts whether it is an instance or an
/// installed app; a pinned hash counts too. A file that cannot be read as a
/// document stops the sweep (nothing is removed), because a link it holds
/// could be lost.
pub fn sweep(
    store: &dyn DocStore,
    now: u64,
    grace_secs: u64,
    dry_run: bool,
) -> HostResult<SweepReport> {
    let blobs = store
        .blobs()
        .ok_or_else(|| HostError::conflict("this workspace holds no file store"))?;
    let mut referenced: BTreeSet<String> = blobs.pinned().into_iter().collect();
    let ids = store.documents().into_iter().chain(store.app_candidates());
    for id in ids {
        if !store.exists(&id) {
            continue;
        }
        let clan = ClanFile::from_bytes(store.read(&id)?).map_err(|e| {
            HostError::internal(format!(
                "sweep stopped: {} is unreadable ({e})",
                id.as_str()
            ))
        })?;
        for f in clan.manifest().files.iter().filter(|f| f.linked) {
            if let Some(s) = &f.sha256 {
                referenced.insert(s.clone());
            }
        }
    }
    let mut report = SweepReport {
        dry_run,
        ..Default::default()
    };
    for info in blobs.list() {
        if referenced.contains(&info.sha256) {
            report.referenced += 1;
        } else if now.saturating_sub(info.written_at) < grace_secs {
            report.young += 1;
        } else {
            if !dry_run {
                blobs.remove(&info.sha256)?;
            }
            report.removed.push(info.sha256);
        }
    }
    Ok(report)
}

/// The hash of `bytes` as a link names it.
pub fn link_of(bytes: &[u8]) -> String {
    sha256_prefixed(bytes)
}

/// An in-memory [`BlobStore`] for tests (here and in the web crate's), clocked
/// by hand so a sweep can be aged.
pub mod testing {
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    use super::*;
    use crate::store::BlobInfo;

    #[derive(Default)]
    pub struct MemBlobs {
        files: Mutex<BTreeMap<String, (Vec<u8>, u64)>>,
        pins: Mutex<BTreeSet<String>>,
        pub clock: Mutex<u64>,
    }

    impl MemBlobs {
        pub fn len(&self) -> usize {
            self.files.lock().unwrap().len()
        }
        pub fn is_empty(&self) -> bool {
            self.len() == 0
        }
    }

    impl BlobStore for MemBlobs {
        fn put(&self, bytes: &[u8]) -> HostResult<String> {
            let sha = sha256_prefixed(bytes);
            let now = *self.clock.lock().unwrap();
            self.files
                .lock()
                .unwrap()
                .entry(sha.clone())
                .or_insert((bytes.to_vec(), now));
            Ok(sha)
        }
        fn get(&self, sha256: &str) -> HostResult<Vec<u8>> {
            self.files
                .lock()
                .unwrap()
                .get(sha256)
                .map(|(b, _)| b.clone())
                .ok_or_else(|| HostError::not_found(format!("no stored file {sha256}")))
        }
        fn has(&self, sha256: &str) -> bool {
            self.files.lock().unwrap().contains_key(sha256)
        }
        fn list(&self) -> Vec<BlobInfo> {
            self.files
                .lock()
                .unwrap()
                .iter()
                .map(|(k, (_, t))| BlobInfo {
                    sha256: k.clone(),
                    written_at: *t,
                })
                .collect()
        }
        fn remove(&self, sha256: &str) -> HostResult<()> {
            self.files.lock().unwrap().remove(sha256);
            Ok(())
        }
        fn pin(&self, sha256: &str) -> HostResult<()> {
            self.pins.lock().unwrap().insert(sha256.to_string());
            Ok(())
        }
        fn pinned(&self) -> Vec<String> {
            self.pins.lock().unwrap().iter().cloned().collect()
        }
    }
}
