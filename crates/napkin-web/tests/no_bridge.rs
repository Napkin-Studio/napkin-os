// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Production bridge is gone and stays gone (features/production-in-library.clan, S1-21): a Production
//! project is a library document, spun off by the one plain route. A source named `production:<project>@<etag>`,
//! a `bridge()` to the relay or a `brief_to_production` route would bring the second path back.

use std::path::{Path, PathBuf};

const BANNED: &[&str] = &[
    "brief_to_production",
    "production_to_app",
    "fn bridge",
    "production:<",
    "\"production:\"",
];
const ROOTS: &[&str] = &[
    "crates",
    "app/src",
    "production-tool/web/src",
    "server",
    "engine/deck",
];
const TEXT: &[&str] = &["rs", "ts", "tsx", "py", "js", "mjs"];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            if !matches!(
                name.as_str(),
                "node_modules" | "target" | ".venv" | "__pycache__" | "dist"
            ) {
                walk(&p, out);
            }
        } else if p
            .extension()
            .is_some_and(|x| TEXT.contains(&x.to_string_lossy().as_ref()))
        {
            out.push(p);
        }
    }
}

#[test]
fn nothing_names_the_bridge() {
    let me = Path::new(file!()).file_name().unwrap().to_owned();
    let mut files = Vec::new();
    for root in ROOTS {
        walk(&repo().join(root), &mut files);
    }
    assert!(
        files.len() > 200,
        "the scan found the tree: {}",
        files.len()
    );
    let mut hits = Vec::new();
    for f in files {
        if f.file_name() == Some(&me) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&f) else {
            continue;
        };
        for (n, line) in text.lines().enumerate() {
            for b in BANNED {
                if line.contains(b) {
                    hits.push(format!("{}:{}: {b}", f.display(), n + 1));
                }
            }
        }
    }
    assert!(hits.is_empty(), "the bridge is back:\n{}", hits.join("\n"));
}

#[test]
fn the_bridge_module_is_deleted() {
    assert!(!repo().join("crates/napkin-web/src/spinoff.rs").exists());
}
