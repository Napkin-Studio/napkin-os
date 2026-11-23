// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Earlier copies of a saved document (features/production-in-library).
//!
//! ```text
//! <tenant>/snapshots/<doc-slug>/<unix-ms>-<reason>-<hex12>.clan
//! ```
//!
//! A snapshot of the saved bytes is taken when the save's reason is `accept`,
//! `handoff` or `export`, and for `interval`, `manual` and `landing` when the
//! newest snapshot is ten minutes old or more. The newest [`KEEP`] are kept and
//! the newest is never removed. The ring lives inside the tenant's directory,
//! beside `documents/`, so the library never lists it and another tenant never
//! reaches it. Restoring is a documented copy.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// How many snapshots one document keeps.
pub const KEEP: usize = 50;
/// The least time between two snapshots for the reasons that are not "always".
pub const MIN_GAP_MS: u128 = 10 * 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    Interval,
    Accept,
    Manual,
    Handoff,
    Export,
    Landing,
}

impl Reason {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "interval" => Self::Interval,
            "accept" => Self::Accept,
            "manual" => Self::Manual,
            "handoff" => Self::Handoff,
            "export" => Self::Export,
            "landing" => Self::Landing,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Interval => "interval",
            Self::Accept => "accept",
            Self::Manual => "manual",
            Self::Handoff => "handoff",
            Self::Export => "export",
            Self::Landing => "landing",
        }
    }

    /// A snapshot is taken whatever the clock says.
    pub fn always(self) -> bool {
        matches!(self, Self::Accept | Self::Handoff | Self::Export)
    }
}

/// One tenant's snapshot directory.
#[derive(Clone, Debug)]
pub struct Ring {
    dir: PathBuf,
}

impl Ring {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn doc_dir(&self, slug: &str) -> PathBuf {
        let safe: String = slug
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        self.dir.join(safe)
    }

    /// The snapshots of `slug`, oldest first, as `(unix_ms, path)`.
    pub fn list(&self, slug: &str) -> Vec<(u128, PathBuf)> {
        let Ok(rd) = std::fs::read_dir(self.doc_dir(slug)) else {
            return Vec::new();
        };
        let mut out: Vec<(u128, PathBuf)> = rd
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) != Some("clan") {
                    return None; // a half-written .tmp
                }
                let ms = p
                    .file_name()?
                    .to_str()?
                    .split('-')
                    .next()?
                    .parse::<u128>()
                    .ok()?;
                Some((ms, p))
            })
            .collect();
        out.sort();
        out
    }

    /// Take a snapshot of `bytes` if the rules say so, then prune. Returns
    /// whether one was taken. `now_ms` is the caller's clock, so a test can
    /// drive time.
    pub fn record(
        &self,
        slug: &str,
        reason: Reason,
        bytes: &[u8],
        now_ms: u128,
    ) -> std::io::Result<bool> {
        let existing = self.list(slug);
        let newest = existing.last().map(|(ms, _)| *ms);
        let due = reason.always() || newest.is_none_or(|n| now_ms.saturating_sub(n) >= MIN_GAP_MS);
        if !due {
            return Ok(false);
        }
        let dir = self.doc_dir(slug);
        std::fs::create_dir_all(&dir)?;
        let hex: String = Sha256::digest(bytes)
            .iter()
            .take(6)
            .map(|b| format!("{b:02x}"))
            .collect();
        let target = dir.join(format!("{now_ms}-{}-{hex}.clan", reason.as_str()));
        write_file(&dir, &target, bytes)?;
        self.prune(slug);
        Ok(true)
    }

    /// Keep the newest [`KEEP`]; the newest is never removed.
    fn prune(&self, slug: &str) {
        let all = self.list(slug);
        let excess = all.len().saturating_sub(KEEP.max(1));
        for (_, p) in all.into_iter().take(excess) {
            let _ = std::fs::remove_file(p);
        }
    }
}

fn write_file(dir: &Path, target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;
    let tmp = dir.join(format!(".snap-{}.tmp", std::process::id()));
    let mut f = std::fs::File::create(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    std::fs::rename(&tmp, target)
}
