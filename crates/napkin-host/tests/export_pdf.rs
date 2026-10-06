// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! PDF export renders whatever HOME the server runs with.
//!
//! The studio's image runs as a user with no home directory, and headless
//! Chromium refuses to start without one: every PDF export failed on staging
//! (features/pdf-export.clan). Its own binary, because it changes HOME for
//! the whole process.

#![cfg(feature = "native")]

use napkin_host::export::{find_pdf_renderer, finish_export, write_temp_html};

/// These start a real browser, so they run where one is known to render:
/// `NAPKIN_PDF_RENDER_TESTS=1`, which scripts/check.sh (and so the pre-push
/// hook) sets when Chromium or Chrome is installed. On GitHub's runners the
/// installed Chromium never finished a render (features/pdf-export.clan, an
/// open question), so CI leaves them out; tests/export_pdf_timeout.rs proves
/// on every machine that a render cannot hang.
fn real_render_tests() -> bool {
    if std::env::var("NAPKIN_PDF_RENDER_TESTS").as_deref() != Ok("1") {
        eprintln!("skipped: real PDF renders run with NAPKIN_PDF_RENDER_TESTS=1 (scripts/check.sh sets it)");
        return false;
    }
    if find_pdf_renderer().is_none() {
        eprintln!("skipped: no Chromium or Chrome on this machine");
        return false;
    }
    true
}

#[test]
fn a_pdf_renders_when_home_does_not_exist() {
    if !real_render_tests() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    // as the image's `napkin` user has it: a HOME that is not there and cannot
    // be made (its parent is a file, as /home is root's for that user)
    let blocker = dir.path().join("not-a-dir");
    std::fs::write(&blocker, b"").unwrap();
    std::env::set_var("HOME", blocker.join("home"));
    std::env::remove_var("XDG_CONFIG_HOME");
    std::env::remove_var("XDG_CACHE_HOME");

    let tmp = write_temp_html("<!DOCTYPE html><html><body><h1>Probe</h1></body></html>").unwrap();
    let dest = dir.path().join("out.pdf");
    finish_export("pdf", &tmp, dest.to_str().unwrap()).expect("the PDF renders");
    let bytes = std::fs::read(&dest).unwrap();
    assert!(
        bytes.starts_with(b"%PDF-"),
        "a PDF, not {} bytes of something else",
        bytes.len()
    );
}

#[test]
fn a_failed_render_says_why() {
    if !real_render_tests() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    // a destination Chromium cannot write: the renderer's own words come back
    let dest = dir.path().join("missing-dir").join("out.pdf");
    let tmp = write_temp_html("<p>x</p>").unwrap();
    let err = finish_export("pdf", &tmp, dest.to_str().unwrap()).unwrap_err();
    assert!(
        err.message.contains("PDF") && err.message.contains("renderer said:"),
        "the error carries the renderer's own output: {}",
        err.message
    );
}
