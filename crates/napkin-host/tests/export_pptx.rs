// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Deck Maker's PowerPoint leaves the app frame through the host's export
//! (the frame's sandbox has no `allow-downloads`, so its own blob link saved
//! nothing in a browser): `clan.exportDoc('pptx', ...)` sends the bytes in
//! base64, the host keeps them in a temp file, and `finish_export` copies them
//! byte for byte to where the shell saves them.

#![cfg(feature = "native")]

use base64::Engine as _;
use napkin_host::export::{finish_export, write_temp_bytes_b64};

#[test]
fn the_file_comes_out_byte_for_byte() {
    // a zip's local-file-header magic and some bytes that are not valid UTF-8
    let bytes: Vec<u8> = vec![0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x81, 0x7f];
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let tmp = write_temp_bytes_b64(&b64, ".pptx").expect("kept");
    assert!(tmp.ends_with(".pptx"));
    let out = tempfile::tempdir().unwrap();
    let dest = out.path().join("deck.pptx");
    let done = finish_export("pptx", &tmp, dest.to_str().unwrap()).expect("saved");
    assert_eq!(done, dest.to_str().unwrap());
    assert_eq!(std::fs::read(&dest).unwrap(), bytes);
    assert!(
        !std::path::Path::new(&tmp).exists(),
        "the temp file is removed"
    );
}

#[test]
fn a_file_that_is_not_base64_or_is_empty_is_refused() {
    assert!(write_temp_bytes_b64("not base64 !!", ".pptx").is_err());
    assert!(write_temp_bytes_b64("", ".pptx").is_err());
}
