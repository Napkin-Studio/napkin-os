// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Territories' JSON file leaves through the host's export, as a Brief's PDF
//! does (territories-exports): the app posts it to `clan://export` with
//! `kind: "json"`, the host keeps it byte for byte (no legibility script, no
//! rendering) and `finish_export` hands it over at the destination. An app's
//! frame cannot download by itself (no `allow-downloads`), so this is the path.

#![cfg(feature = "native")]

use std::sync::Arc;

use napkin_host::export::finish_export;
use napkin_host::{handle, DocId, FsStore, HostEvent, HostRequest, NoConfig, Session};

const JSON: &str = "{\n  \"title\": \"Linea: Weekend by Rail\",\n  \"routes\": [\"</body>\"]\n}\n";

#[test]
fn a_json_export_is_kept_as_it_is_and_delivered_as_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("t.clan"));
    let bytes = clan_sdk::create(clan_sdk::CreateOptions {
        title: "Territories".into(),
        brief: "b".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    std::fs::write(id.as_str(), bytes).unwrap();
    let session = Session::new(Arc::new(FsStore::new(dir.path().to_path_buf())));
    session.open(id).unwrap();

    let body =
        serde_json::json!({ "kind": "json", "filename": "linea-routes", "html": JSON }).to_string();
    let resp = handle(
        &session,
        &NoConfig,
        HostRequest::new("/export", "", body.into_bytes()),
    );
    assert_eq!(resp.status, 200);
    let (kind, filename, tmp) = resp
        .events
        .iter()
        .find_map(|e| match e {
            HostEvent::ExportRequest {
                kind,
                filename,
                tmp_html,
            } => Some((kind.clone(), filename.clone(), tmp_html.clone())),
            _ => None,
        })
        .expect("the shell is asked to deliver it");
    assert_eq!((kind.as_str(), filename.as_str()), ("json", "linea-routes"));
    assert_eq!(
        std::fs::read_to_string(&tmp).unwrap(),
        JSON,
        "nothing added to the data file"
    );

    let dest = dir.path().join("out.json");
    finish_export("json", &tmp, dest.to_str().unwrap()).expect("the file is delivered");
    assert_eq!(std::fs::read_to_string(&dest).unwrap(), JSON);
    assert!(
        !std::path::Path::new(&tmp).exists(),
        "the temp file is removed"
    );
}
