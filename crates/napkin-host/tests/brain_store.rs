// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! A brain is an ordinary document in the store (features/brain-page-model.clan; done_when 1 of
//! features/napkin-brain.clan, the host half): both kinds open through it, and nothing else does.

use clan_sdk::{AppInfo, ClanBuilder, ClanFile, ClientRef};
use napkin_host::brain::{open, VaultKind, BRAIN_APP};
use napkin_host::{DocId, FsStore, Library};
use serde_json::{json, Value};

fn doc(
    dir: &std::path::Path,
    file: &str,
    app: &str,
    client: Option<&str>,
    data: Option<Value>,
) -> DocId {
    let base = ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "a brain".into(),
            brief: "a brain".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut m = base.manifest().clone();
    m.app = Some(AppInfo {
        home: None,
        name: "Napkin Brain".into(),
        app_id: app.into(),
        version: "0.1.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach: None,
    });
    m.client = client.map(|c| ClientRef {
        id: c.into(),
        name: "Client A".into(),
    });
    let mut b = ClanBuilder::new(m);
    for (path, bytes) in base.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH && path != "shared/data.yaml" {
            b.add_entry(path, bytes);
        }
    }
    let data = data.unwrap_or_else(|| json!({}));
    b.add_entry(
        "shared/data.yaml",
        serde_yaml::to_string(&data).unwrap().into_bytes(),
    );
    let id = DocId::from(dir.join(file));
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    id
}

fn line() -> Value {
    json!({
        "id": "0123456789abcdef", "kind": "derived", "rule": "approve.v1",
        "cites": [{ "doc": "doc-a", "decision": "d_1" }],
        "slots": { "stage": "approved" }, "state": "current", "at": "2026-11-02"
    })
}

fn page() -> Value {
    json!({ "type": "decision", "title": "Approved", "summary": "The brief was approved.",
        "owner_role": "planning", "links": [], "lines": [line()] })
}

#[test]
fn the_agencys_brain_and_a_clients_open_through_the_store() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let agency = doc(dir.path(), "agency.clan", BRAIN_APP, None, None);
    let b = open(&store, &agency).unwrap();
    assert_eq!(b.vault.kind, VaultKind::Agency);
    assert_eq!(b.vault.client, None);
    assert!(b.pages.is_empty(), "a new brain is empty");

    let client = doc(
        dir.path(),
        "client.clan",
        BRAIN_APP,
        Some("cli_0a1b2c3d"),
        Some(json!({
            "vault": { "kind": "client", "client": "cli_0a1b2c3d" },
            "pages": { "approved": page() }
        })),
    );
    let b = open(&store, &client).unwrap();
    assert_eq!(b.vault.kind, VaultKind::Client);
    assert_eq!(b.vault.client.as_deref(), Some("cli_0a1b2c3d"));
    assert_eq!(b.pages["approved"].lines.len(), 1);

    // An empty client brain takes its vault from the manifest.
    let fresh = doc(dir.path(), "fresh.clan", BRAIN_APP, Some("cli_0a1b2c3d"), None);
    let b = open(&store, &fresh).unwrap();
    assert_eq!(b.vault.client.as_deref(), Some("cli_0a1b2c3d"));
}

#[test]
fn a_document_that_is_not_a_brain_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let other = doc(dir.path(), "brief.clan", "ie.napkin.brief-maker", None, None);
    assert_eq!(open(&store, &other).unwrap_err().status, 400);
    let missing = DocId::from(dir.path().join("nothing.clan"));
    assert_eq!(open(&store, &missing).unwrap_err().status, 404);
}

#[test]
fn data_that_names_another_vault_than_the_manifest_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    // A client's document whose data says it is the agency's.
    let a = doc(
        dir.path(),
        "a.clan",
        BRAIN_APP,
        Some("cli_0a1b2c3d"),
        Some(json!({ "vault": { "kind": "agency" }, "pages": {} })),
    );
    assert_eq!(open(&store, &a).unwrap_err().status, 409);
    // Another client's data under this client's manifest.
    let b = doc(
        dir.path(),
        "b.clan",
        BRAIN_APP,
        Some("cli_0a1b2c3d"),
        Some(json!({ "vault": { "kind": "client", "client": "cli_ffffffff" }, "pages": {} })),
    );
    assert_eq!(open(&store, &b).unwrap_err().status, 409);
}

#[test]
fn a_brain_with_a_bad_page_does_not_open() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    let mut p = page();
    p["lines"][0]["cites"] = json!([]);
    let id = doc(
        dir.path(),
        "bad.clan",
        BRAIN_APP,
        None,
        Some(json!({ "vault": { "kind": "agency" }, "pages": { "approved": p } })),
    );
    assert_eq!(open(&store, &id).unwrap_err().status, 400);
}

#[test]
fn the_registry_is_never_read_as_a_brain() {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path().to_path_buf());
    // The registry as the store names it, even if someone made it look like a brain.
    let reg = store.home(napkin_host::agency::REGISTRY_TAG).unwrap();
    std::fs::copy(
        doc(dir.path(), "x.clan", BRAIN_APP, None, None).as_str(),
        reg.as_str(),
    )
    .unwrap();
    assert_eq!(open(&store, &reg).unwrap_err().status, 403);
    // And by the build's constant name, whether or not the file exists.
    let named = DocId::new("home-agency-v1");
    assert_eq!(open(&store, &named).unwrap_err().status, 403);
}
