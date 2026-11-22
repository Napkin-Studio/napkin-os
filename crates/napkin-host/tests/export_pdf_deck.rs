// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Deck Maker's PDF is printed from the engine's `deck.html` by the same
//! Chromium export a Brief uses (deck-cloud): the app sends the deck's page
//! through `clan.exportDoc('pdf', ...)`, the host writes it to a temp file and
//! `render_pdf` prints it. A stub `chromium` first on PATH stands in for the
//! browser and keeps the page it was asked to print, so the test sees that the
//! deck reached the renderer whole: every slide, the deck's own `@page` size
//! and its script, with the legibility check added before the last `</body>`.
//! One test, its own binary: it changes PATH for the whole process.

#![cfg(all(unix, feature = "native"))]

use std::os::unix::fs::PermissionsExt;

use napkin_host::export::{finish_export, write_temp_html};

const DECK_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Fernley</title>
<style>@media print{@page{size:1920px 1080px;margin:0}.slide{page-break-after:always}}</style></head>
<body><main id="stage"><section class="slide" id="s1"><h1>Fernley tea</h1></section>
<section class="slide" id="s2"><h1>The idea</h1><p>a '</body>' in a string</p></section></main>
<script>addEventListener('beforeprint',()=>document.body.classList.add('still'))</script></body></html>"#;

#[test]
fn the_deck_html_is_what_the_renderer_prints() {
    let bin = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    // The stub writes a PDF whose body is the page it was given (the last argument, file://...).
    let script = r#"#!/bin/sh
for a in "$@"; do
  case "$a" in
    --print-to-pdf=*) dest="${a#--print-to-pdf=}";;
    file://*) src="${a#file://}";;
  esac
done
{ printf '%%PDF-1.4\n'; cat "$src"; } > "$dest"
"#;
    let path = bin.path().join("chromium");
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    let old = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{old}", bin.path().display()));

    let tmp = write_temp_html(DECK_HTML).unwrap();
    let dest = out.path().join("deck.pdf");
    let done = finish_export("pdf", &tmp, dest.to_str().unwrap()).expect("the deck prints");
    assert_eq!(done, dest.to_str().unwrap());
    assert!(
        !std::path::Path::new(&tmp).exists(),
        "the temp page is removed"
    );

    let pdf = std::fs::read_to_string(&dest).unwrap();
    assert!(pdf.starts_with("%PDF-"));
    assert!(
        pdf.contains(r#"id="s1""#) && pdf.contains(r#"id="s2""#),
        "every slide reaches the renderer"
    );
    assert!(
        pdf.contains("@page{size:1920px 1080px;margin:0}"),
        "the deck's own page size is kept"
    );
    assert!(pdf.contains("beforeprint"), "the deck's script is kept");
    let legible = pdf
        .find("data-napkin-legible")
        .expect("the legibility check is added");
    assert!(
        legible > pdf.rfind("</section></main>").unwrap(),
        "the check goes after the slides, before the last </body>, not at the '</body>' inside a slide's text"
    );
}
