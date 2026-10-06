// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! A PDF render always ends: a renderer that hangs is stopped at the deadline,
//! and one whose children outlive it (Chrome's crashpad handler keeps stderr
//! open) does not hold the export. On GitHub's runners Chrome did both, and
//! every Rust job ran for six hours (features/pdf-export.clan).
//!
//! The renderer is found on PATH, so a fake `chromium` placed first stands in
//! for it. One test, its own binary: it changes PATH for the whole process.

#![cfg(all(unix, feature = "native"))]

use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

use napkin_host::export::{render_pdf, write_temp_html};

fn fake_renderer(dir: &std::path::Path, script: &str) {
    let path = dir.join("chromium");
    std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn a_render_ends_whatever_the_renderer_does() {
    let bin = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{path}", bin.path().display()));
    std::env::set_var("NAPKIN_PDF_TIMEOUT_SECS", "2");
    let html = || write_temp_html("<p>x</p>").unwrap();

    // 1. It writes the PDF and exits, but a child it left holds stderr open,
    //    as Chrome's crashpad handler does: the render is done when it exits.
    fake_renderer(
        bin.path(),
        r#"for a in "$@"; do case "$a" in --print-to-pdf=*) printf '%%PDF-1.4\n' > "${a#--print-to-pdf=}";; esac; done
(sleep 600) &
exit 0"#,
    );
    let dest = out.path().join("one.pdf");
    let t = Instant::now();
    render_pdf(&html(), dest.to_str().unwrap()).expect("the PDF it wrote is the result");
    assert!(std::fs::read(&dest).unwrap().starts_with(b"%PDF-"));
    assert!(
        t.elapsed() < Duration::from_secs(5),
        "a child holding stderr must not hold the render ({:?})",
        t.elapsed()
    );

    // 2. It never exits: the deadline stops it, and the error says so.
    fake_renderer(bin.path(), "echo 'stuck on something' >&2\nexec sleep 600");
    let dest = out.path().join("two.pdf");
    let t = Instant::now();
    let err = render_pdf(&html(), dest.to_str().unwrap()).unwrap_err();
    assert!(
        t.elapsed() < Duration::from_secs(10),
        "stopped at the deadline ({:?})",
        t.elapsed()
    );
    assert!(
        err.message.contains("did not finish") && err.message.contains("stuck on something"),
        "the error says it was stopped, and what the renderer said: {}",
        err.message
    );
}
