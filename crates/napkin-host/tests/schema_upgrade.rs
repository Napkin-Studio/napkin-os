//! A document made before its app widened its schema moves to the newer schema before it
//! writes, when that is safe; a breaking change leaves its copy alone (owner decision
//! 2026-11-25, `ops::upgrade`). The case behind it: a Territories document made before its
//! sources list went from 80 to 1000 refused every result.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use clan_sdk::{create, make_template, AppInfo, ClanFile, CreateOptions, MakeTemplateOptions};
use napkin_host::ops::upgrade::{plan, SchemaUpgrade};
use napkin_host::view::resolve;
use napkin_host::{
    create_instance, install_app, Change, DocId, DocStore, Document, HostError, HostResult,
    Library, PartStore, Session, Version,
};

const APP: &str = "ie.napkin.territories";

#[derive(Default)]
struct MemStore {
    files: Mutex<HashMap<String, Vec<u8>>>,
}

impl PartStore for MemStore {
    fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
        self.files
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| HostError::not_found(format!("no such document: {id}")))
    }
    fn exists(&self, id: &DocId) -> bool {
        self.files.lock().unwrap().contains_key(id.as_str())
    }
    fn apply(&self, change: &Change) -> HostResult<Version> {
        self.files
            .lock()
            .unwrap()
            .insert(change.doc.to_string(), change.bytes.clone());
        Ok(change.archive_version())
    }
}

impl Library for MemStore {
    fn app_candidates(&self) -> Vec<DocId> {
        let mut v: Vec<DocId> = self
            .files
            .lock()
            .unwrap()
            .keys()
            .filter(|k| k.starts_with("apps/"))
            .map(DocId::new)
            .collect();
        v.sort();
        v
    }
    fn app_template(&self, app_id: &str) -> DocId {
        DocId::new(format!("apps/{app_id}/app.clan"))
    }
    fn documents(&self) -> Vec<DocId> {
        self.files
            .lock()
            .unwrap()
            .keys()
            .filter(|k| k.starts_with("docs/"))
            .map(DocId::new)
            .collect()
    }
    fn new_document(&self, app_id: &str, id_short: &str) -> HostResult<DocId> {
        Ok(DocId::new(format!("docs/{app_id}-{id_short}.clan")))
    }
    fn home(&self, version_tag: &str) -> HostResult<DocId> {
        Ok(DocId::new(format!("home-{version_tag}.clan")))
    }
    fn fork_branch(&self, parent: &DocId, agent: &str) -> DocId {
        DocId::new(format!("{parent}.{agent}.clan"))
    }
}

/// The app's schema, its `focus.sources` list capped at `cap` (Territories' shape, trimmed).
fn schema(cap: u32) -> String {
    serde_json::json!({
        "type": "object",
        "properties": { "focus": { "$ref": "#/definitions/focus" } },
        "definitions": { "focus": {
            "type": "object", "additionalProperties": false,
            "properties": { "sources": { "type": "array", "maxItems": cap, "items": { "type": "string" } } }
        } }
    })
    .to_string()
}

fn template(version: &str, cap: u32) -> Vec<u8> {
    let base = create(CreateOptions {
        title: "Territories".into(),
        brief: "fixture".into(),
        document_type: None,
        no_render: false,
        schema: Some(schema(cap)),
    })
    .unwrap();
    make_template(
        &ClanFile::from_bytes(base).unwrap(),
        AppInfo {
            home: None,
            name: "Territories".into(),
            app_id: APP.into(),
            version: version.into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: Some("agent/output-schema.json".into()),
            prompt_templates: vec![],
            data_seed: None,
            spinoff: None,
            attach: None,
        },
        MakeTemplateOptions::default(),
    )
    .unwrap()
}

/// A document made under `old`, with `now` installed over it.
fn fixture(old: Vec<u8>, now: Vec<u8>) -> (Arc<MemStore>, Session, DocId) {
    let store = Arc::new(MemStore::default());
    install_app(&*store, old).unwrap();
    let doc = create_instance(&*store, APP, Some("Acme".into())).unwrap();
    install_app(&*store, now).unwrap();
    let session = Session::new(store.clone() as Arc<dyn DocStore>);
    session.open(doc.clone()).unwrap();
    (store, session, doc)
}

fn sources(n: usize) -> String {
    let list: Vec<String> = (0..n).map(|i| format!("\"s{i}\"")).collect();
    format!(
        r#"{{"patch":{{"focus":{{"sources":[{}]}}}},"agent":"human"}}"#,
        list.join(",")
    )
}

fn stored_cap(store: &MemStore, doc: &DocId) -> u64 {
    let clan = ClanFile::from_bytes(store.read(doc).unwrap()).unwrap();
    let s: serde_json::Value =
        serde_json::from_str(&clan.read_entry_string("agent/output-schema.json").unwrap()).unwrap();
    s["definitions"]["focus"]["properties"]["sources"]["maxItems"]
        .as_u64()
        .unwrap()
}

#[test]
fn a_widened_app_schema_reaches_an_older_document_before_it_writes() {
    let (store, session, doc) = fixture(template("1.0.0", 3), template("1.1.0", 10));
    assert_eq!(stored_cap(&store, &doc), 3, "made under the old cap");
    // Five sources: the old copy refuses this; the app's schema accepts it.
    session
        .patch_data(&sources(5))
        .expect("the write lands under the app's schema");
    assert_eq!(
        stored_cap(&store, &doc),
        10,
        "the copy moved to the app's schema"
    );
    let clan = ClanFile::from_bytes(store.read(&doc).unwrap()).unwrap();
    let chain = clan.read_entry_string("agent/decision-chain.yaml").unwrap();
    assert!(chain.contains("schema upgraded"), "{chain}");
    assert!(
        chain.contains("maxItems 3 → 10"),
        "the decision says what loosened: {chain}"
    );
    assert!(
        chain.contains("v1.1.0"),
        "and from which app version: {chain}"
    );
    // A second write does not upgrade again.
    session.patch_data(&sources(6)).unwrap();
    let chain = ClanFile::from_bytes(store.read(&doc).unwrap())
        .unwrap()
        .read_entry_string("agent/decision-chain.yaml")
        .unwrap();
    assert_eq!(chain.matches("schema upgraded").count(), 1, "{chain}");
}

#[test]
fn a_breaking_app_schema_leaves_the_documents_copy_and_says_why() {
    let (store, session, doc) = fixture(template("1.0.0", 5), template("1.1.0", 2));
    // Three sources: fine under the document's own copy (5), not under the app's (2).
    session
        .patch_data(&sources(3))
        .expect("the document keeps its own contract");
    assert_eq!(stored_cap(&store, &doc), 5, "not moved");
    // Too many for the copy: refused, as before.
    assert!(session.patch_data(&sources(6)).is_err());
    // The plan names the reason, which a refused middleware change carries.
    let public = clan_sdk::generate_keypair().1;
    let d = resolve(
        &*store,
        Document::from_bytes(doc.clone(), store.read(&doc).unwrap()).unwrap(),
        &public,
    );
    match plan(&d) {
        SchemaUpgrade::Breaking {
            reasons,
            app_version,
        } => {
            assert_eq!(app_version, "1.1.0");
            assert!(
                reasons.iter().any(|r| r.contains("maxItems lowered 5 → 2")),
                "{reasons:?}"
            );
        }
        other => panic!("{other:?}"),
    }
    let note = napkin_host::ops::upgrade::older_contract_note(&d).unwrap();
    assert!(note.contains("older contract"), "{note}");
}

#[test]
fn the_same_schema_changes_nothing() {
    let (store, session, doc) = fixture(template("1.0.0", 4), template("1.0.1", 4));
    session.patch_data(&sources(2)).unwrap();
    let chain = ClanFile::from_bytes(store.read(&doc).unwrap())
        .unwrap()
        .read_entry_string("agent/decision-chain.yaml")
        .unwrap();
    assert!(!chain.contains("schema upgraded"), "{chain}");
}
