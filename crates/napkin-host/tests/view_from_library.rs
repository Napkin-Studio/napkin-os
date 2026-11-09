// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! "Latest app, same major": a document of an installed app is shown with the
//! library's current view of that app when the majors match, and with its own
//! copy otherwise — and nothing about showing or exporting it writes to it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use clan_sdk::{
    create, make_template, sign_app, AppInfo, ClanBuilder, ClanFile, CreateOptions, FileEntry,
    MakeTemplateOptions,
};
use napkin_host::view::{resolve, served_archive};
use napkin_host::{
    create_instance, install_app, Change, DocId, DocStore, Document, HostError, HostResult,
    Library, PartStore, Session, Version, ViewSource,
};

const APP: &str = "ie.napkin.brief";

/// An in-memory library, so no test touches a real `NAPKIN_APPS_DIR`.
#[derive(Default)]
struct MemStore {
    files: Mutex<HashMap<String, Vec<u8>>>,
}

impl MemStore {
    fn remove(&self, id: &DocId) {
        self.files.lock().unwrap().remove(id.as_str());
    }
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

/// The view a template of `version` carries: its version is in the markup, the
/// stylesheet and an asset, so a test can tell which one it is looking at.
fn template(version: &str, assets: &[(&str, &[u8])]) -> Vec<u8> {
    template_with(version, assets, None)
}

/// [`template`], declaring `spinoff`.
fn template_with(
    version: &str,
    assets: &[(&str, &[u8])],
    spinoff: Option<clan_sdk::SpinoffSpec>,
) -> Vec<u8> {
    template_full(version, assets, spinoff, None)
}

/// [`template`], with `schema` as its output schema.
fn template_schema(version: &str, schema: &str) -> Vec<u8> {
    template_full(version, &[], None, Some(schema))
}

fn template_full(
    version: &str,
    assets: &[(&str, &[u8])],
    spinoff: Option<clan_sdk::SpinoffSpec>,
    schema: Option<&str>,
) -> Vec<u8> {
    let base = create(CreateOptions {
        title: "Brief Maker".into(),
        brief: "fixture".into(),
        document_type: None,
        no_render: false,
        schema: schema.map(String::from),
    })
    .unwrap();
    let clan = ClanFile::from_bytes(base).unwrap();
    let mut b = ClanBuilder::new(clan.manifest().clone());
    for (p, by) in clan.read_all_entries().unwrap() {
        if p == "manifest.yaml" || p == "human/index.html" || p == "human/styles.css" {
            continue;
        }
        b.add_entry(p, by);
    }
    b.add_entry(
        "human/index.html",
        format!(
            "<!doctype html><html><head><title>t</title></head>\
             <body><h1>VIEW {version}</h1></body></html>"
        )
        .into_bytes(),
    );
    b.add_entry(
        "human/styles.css",
        format!("h1::after {{ content: 'STYLE {version}'; }}").into_bytes(),
    );
    for (name, bytes) in assets {
        let path = format!("human/assets/{name}");
        b.add_entry(path.clone(), bytes.to_vec());
        // Registered, as `pack` registers the assets it adds.
        b.manifest_mut().files.push(FileEntry {
            id: format!("human-asset-{}", name.replace('.', "-")),
            path,
            role: "human-asset".into(),
            content_type: "image/svg+xml".into(),
            priority: None,
            sha256: None,
        });
    }
    let with_view = ClanFile::from_bytes(b.build().unwrap()).unwrap();
    make_template(
        &with_view,
        AppInfo {
            home: None,
            name: "Brief Maker".into(),
            app_id: APP.into(),
            version: version.into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: Some("agent/output-schema.json".into()),
            prompt_templates: vec![],
            data_seed: None,
            spinoff,
            attach: None,
        },
        MakeTemplateOptions::default(),
    )
    .unwrap()
}

struct Fixture {
    store: Arc<MemStore>,
    session: Session,
    doc: DocId,
}

impl Fixture {
    /// A document instantiated from `from` (`1.0.0` unless said otherwise),
    /// with `now` installed over it by the time it is opened (`None`: nothing
    /// installed any more).
    fn new(from: Vec<u8>, now: Option<Vec<u8>>) -> Self {
        let store = Arc::new(MemStore::default());
        install_app(&*store, from).unwrap();
        let doc = create_instance(&*store, APP, Some("Acme".into())).unwrap();
        match now {
            Some(bytes) => {
                install_app(&*store, bytes).unwrap();
            }
            None => store.remove(&store.app_template(APP)),
        }
        let session = Session::new(store.clone() as Arc<dyn DocStore>);
        Fixture {
            store,
            session,
            doc,
        }
    }

    fn stored(&self) -> Vec<u8> {
        self.store.read(&self.doc).unwrap()
    }
}

fn v1() -> Vec<u8> {
    template("1.0.0", &[])
}

#[test]
fn a_newer_template_of_the_same_major_serves_its_view() {
    let f = Fixture::new(v1(), Some(template("1.2.0", &[])));
    let open = f.session.open(f.doc.clone()).unwrap();
    assert_eq!(open.view_source, ViewSource::Library);
    assert_eq!(open.view_version.as_deref(), Some("1.2.0"));
    assert!(open.has_human_view);
    // The manifest is still the document's: it was made with 1.0.0.
    assert_eq!(open.manifest.app.as_ref().unwrap().version, "1.0.0");

    let html = f.session.human_html().unwrap();
    assert!(html.contains("VIEW 1.2.0"), "{html}");
    assert!(
        html.contains("STYLE 1.2.0"),
        "the stylesheet is the view's too"
    );
    assert!(!html.contains("VIEW 1.0.0"), "no trace of the frozen view");
    assert!(
        html.contains("window.__CLAN__"),
        "the context is still injected"
    );

    let json = serde_json::to_value(&open).unwrap();
    assert_eq!(json["view_source"], "library");
    assert_eq!(json["view_version"], "1.2.0");
}

#[test]
fn a_different_major_keeps_the_documents_own_view() {
    let f = Fixture::new(v1(), Some(template("2.0.0", &[])));
    let open = f.session.open(f.doc.clone()).unwrap();
    assert_eq!(open.view_source, ViewSource::Document);
    assert_eq!(open.view_version.as_deref(), Some("1.0.0"));
    assert!(f.session.human_html().unwrap().contains("VIEW 1.0.0"));
}

#[test]
fn an_older_install_of_the_same_major_keeps_the_documents_own_view() {
    let f = Fixture::new(template("1.3.0", &[]), Some(template("1.2.0", &[])));
    let open = f.session.open(f.doc.clone()).unwrap();
    assert_eq!(open.view_source, ViewSource::Document);
    assert!(f.session.human_html().unwrap().contains("VIEW 1.3.0"));
}

#[test]
fn an_app_that_is_not_installed_keeps_the_documents_own_view() {
    let f = Fixture::new(v1(), None);
    let open = f.session.open(f.doc.clone()).unwrap();
    assert_eq!(open.view_source, ViewSource::Document);
    assert!(f.session.human_html().unwrap().contains("VIEW 1.0.0"));
}

#[test]
fn a_version_that_does_not_parse_keeps_the_documents_own_view() {
    let f = Fixture::new(v1(), Some(template("1.2.0-beta", &[])));
    let open = f.session.open(f.doc.clone()).unwrap();
    assert_eq!(open.view_source, ViewSource::Document);
    assert!(f.session.human_html().unwrap().contains("VIEW 1.0.0"));
}

#[test]
fn a_document_with_no_app_block_keeps_its_own_view() {
    let f = Fixture::new(v1(), Some(template("1.2.0", &[])));
    // The same instance, its app block gone: nothing to match on.
    let clan = ClanFile::from_bytes(f.stored()).unwrap();
    let mut m = clan.manifest().clone();
    m.app = None;
    let mut b = ClanBuilder::new(m);
    for (p, by) in clan.read_all_entries().unwrap() {
        if p != "manifest.yaml" {
            b.add_entry(p, by);
        }
    }
    let base = f.store.version(&f.doc).unwrap();
    f.store
        .apply(&Change::replace(f.doc.clone(), base, b.build().unwrap()))
        .unwrap();

    let open = f.session.open(f.doc.clone()).unwrap();
    assert_eq!(open.view_source, ViewSource::Document);
    assert_eq!(open.view_version, None);
    assert!(f.session.human_html().unwrap().contains("VIEW 1.0.0"));
}

#[test]
fn a_legacy_document_and_a_template_keep_their_own_view() {
    let f = Fixture::new(v1(), Some(template("1.2.0", &[])));

    let legacy = DocId::new("docs/legacy.clan");
    let bytes = create(CreateOptions {
        title: "Legacy".into(),
        brief: "agent html".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    f.store
        .apply(&Change::create(legacy.clone(), bytes))
        .unwrap();
    let open = f.session.open(legacy).unwrap();
    assert_eq!(open.view_source, ViewSource::Document);
    assert_eq!(open.render_model, "legacy");

    // Opening a template file shows that file, even one of an installed app.
    let other = DocId::new("elsewhere/brief-1.1.0.clan");
    f.store
        .apply(&Change::create(other.clone(), template("1.1.0", &[])))
        .unwrap();
    let open = f.session.open(other).unwrap();
    assert!(open.is_template);
    assert_eq!(open.view_source, ViewSource::Document);
    assert!(f.session.human_html().unwrap().contains("VIEW 1.1.0"));
}

#[test]
fn trust_comes_from_the_template_when_its_view_is_served() {
    let (private, public) = clan_sdk::generate_keypair();
    let sign = |bytes: Vec<u8>| sign_app(&ClanFile::from_bytes(bytes).unwrap(), &private, None);

    // An unsigned document shown with a signed library view is trusted: the
    // code that runs is the library's, and it verifies.
    let f = Fixture::new(v1(), Some(sign(template("1.2.0", &[])).unwrap()));
    let doc = Document::from_bytes_with_key(f.doc.clone(), f.stored(), &public).unwrap();
    assert!(!doc.trusted(), "the document's own copy is unsigned");
    let doc = resolve(&*f.store, doc, &public);
    assert_eq!(doc.view_source(), ViewSource::Library);
    assert!(!doc.document_trusted());
    assert!(doc.trusted(), "trust is the template's");

    // A document signed at 1.0.0 shown with an unsigned 1.1.0 is not: its
    // signature covers code that no longer runs.
    let f = Fixture::new(sign(v1()).unwrap(), Some(template("1.1.0", &[])));
    let doc = Document::from_bytes_with_key(f.doc.clone(), f.stored(), &public).unwrap();
    assert!(
        doc.trusted(),
        "the instance carries 1.0.0's valid signature"
    );
    let doc = resolve(&*f.store, doc, &public);
    assert_eq!(doc.view_source(), ViewSource::Library);
    assert!(doc.document_trusted());
    assert!(!doc.trusted(), "the served view is unsigned");

    // And where the document's own view is served, its own trust stands.
    let f = Fixture::new(sign(v1()).unwrap(), Some(template("2.0.0", &[])));
    let doc = Document::from_bytes_with_key(f.doc.clone(), f.stored(), &public).unwrap();
    let doc = resolve(&*f.store, doc, &public);
    assert_eq!(doc.view_source(), ViewSource::Document);
    assert!(doc.trusted());

    // The session reports it the same way (Napkin's key: nothing here is
    // signed with it, so both are untrusted — but through the template).
    let f = Fixture::new(v1(), Some(template("1.2.0", &[])));
    assert!(!f.session.open(f.doc.clone()).unwrap().trusted);
    assert!(!f.session.trusted());
}

#[test]
fn export_and_handoff_carry_the_served_view() {
    let f = Fixture::new(v1(), Some(template("1.2.0", &[])));
    f.session.open(f.doc.clone()).unwrap();

    let (html, _) = f.session.compose_export(false, true).unwrap();
    assert!(html.contains("VIEW 1.2.0"), "{html}");
    assert!(!html.contains("VIEW 1.0.0"));

    let handed = ClanFile::from_bytes(f.session.raw_bytes().unwrap()).unwrap();
    let stored = ClanFile::from_bytes(f.stored()).unwrap();
    assert!(handed
        .read_entry_string("human/index.html")
        .unwrap()
        .contains("VIEW 1.2.0"));
    assert!(handed
        .read_entry_string("human/styles.css")
        .unwrap()
        .contains("STYLE 1.2.0"));
    assert!(
        clan_sdk::validate(&handed).is_valid(),
        "{}",
        clan_sdk::validate(&handed).display()
    );
    // Only the view changed: the identity, data and chain are the document's.
    assert_eq!(handed.manifest().id, stored.manifest().id);
    assert_eq!(handed.document_id(), stored.document_id());
    assert_eq!(handed.manifest().updated_at, stored.manifest().updated_at);
    for p in ["shared/data.yaml", "agent/decision-chain.yaml"] {
        assert_eq!(handed.read_entry(p).unwrap(), stored.read_entry(p).unwrap());
    }

    // With its own view served, the handoff is the stored archive, byte for byte.
    let f = Fixture::new(v1(), Some(template("2.0.0", &[])));
    f.session.open(f.doc.clone()).unwrap();
    assert_eq!(f.session.raw_bytes().unwrap(), f.stored());
    let (html, _) = f.session.compose_export(false, true).unwrap();
    assert!(html.contains("VIEW 1.0.0"));
}

#[test]
fn opening_and_exporting_never_write_the_document() {
    let f = Fixture::new(v1(), Some(template("1.2.0", &[("new.svg", b"<svg/>")])));
    let before = f.stored();
    let open = f.session.open(f.doc.clone()).unwrap();
    assert_eq!(open.view_source, ViewSource::Library);
    f.session.human_html().unwrap();
    f.session.compose_export(true, false).unwrap();
    let handed = f.session.raw_bytes().unwrap();
    assert_ne!(handed, before, "the handoff carries the library view");
    assert_eq!(f.stored(), before, "the stored document is untouched");
    assert_eq!(f.session.stored_bytes().unwrap(), before);
    assert_eq!(
        f.session.current_version(),
        Some(Version::of_archive(&before)),
        "the open snapshot is still the stored version"
    );
}

#[test]
fn a_library_view_resolves_assets_it_added_but_never_shadows_the_documents() {
    let f = Fixture::new(
        template("1.0.0", &[("logo.svg", b"old-logo")]),
        Some(template(
            "1.2.0",
            &[("logo.svg", b"new-logo"), ("badge.svg", b"badge")],
        )),
    );
    f.session.open(f.doc.clone()).unwrap();
    // A name only the newer view has resolves from the template…
    assert_eq!(f.session.serve_asset("badge.svg").unwrap().1, b"badge");
    // …and one the document holds is the document's, as an upload would be.
    assert_eq!(f.session.serve_asset("logo.svg").unwrap().1, b"old-logo");
    let html = f.session.human_html().unwrap();
    assert!(
        html.contains("\"badge.svg\":\"/assets/badge.svg\""),
        "{html}"
    );

    let handed = ClanFile::from_bytes(f.session.raw_bytes().unwrap()).unwrap();
    assert_eq!(
        handed.read_entry("human/assets/badge.svg").unwrap(),
        b"badge"
    );
    assert_eq!(
        handed.read_entry("human/assets/logo.svg").unwrap(),
        b"old-logo"
    );
    assert!(clan_sdk::validate(&handed).is_valid());
}

#[test]
fn a_write_keeps_the_library_view() {
    let f = Fixture::new(v1(), Some(template("1.2.0", &[])));
    f.session.open(f.doc.clone()).unwrap();
    f.session
        .patch_data(r#"{"patch":{"tone":"warm"},"agent":"human"}"#)
        .unwrap();
    assert!(f.session.human_html().unwrap().contains("VIEW 1.2.0"));
    // The write landed on the document, which now carries 1.2.0 itself.
    let stored = ClanFile::from_bytes(f.stored()).unwrap();
    assert!(stored
        .read_entry_string("shared/data.yaml")
        .unwrap()
        .contains("warm"));
    assert!(stored
        .read_entry_string("human/index.html")
        .unwrap()
        .contains("VIEW 1.2.0"));
    // served_archive of a snapshot is the same transform the session uses:
    // with the app caught up it hands out the stored page as it is.
    let doc = Document::from_bytes(f.doc.clone(), f.stored()).unwrap();
    assert_eq!(&*served_archive(&doc).unwrap(), f.stored().as_slice());
}

/// A research document installed and filled, and a Brief Maker `version`
/// that carries it whole (Contract 4 §5.1).
fn spun_off_brief(version: &str) -> (Arc<MemStore>, DocId, DocId) {
    const RESEARCH: &str = "ie.napkin.campaign-research";
    let store = Arc::new(MemStore::default());
    let base = ClanFile::from_bytes(
        create(CreateOptions {
            title: "Campaign Research".into(),
            brief: "fixture".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let research = make_template(
        &base,
        AppInfo {
            home: None,
            name: "Campaign Research".into(),
            app_id: RESEARCH.into(),
            version: "1.0.0".into(),
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
    .unwrap();
    install_app(&*store, research).unwrap();
    let source = create_instance(&*store, RESEARCH, Some("Lúnasa".into())).unwrap();
    let s = Session::new(store.clone() as Arc<dyn DocStore>);
    s.open(source.clone()).unwrap();
    s.patch_data(r#"{"patch":{"campaign":{"name":"Lúnasa 0.0"}},"agent":"human"}"#)
        .unwrap();

    let carries = clan_sdk::SpinoffSpec {
        accepts: vec![RESEARCH.into()],
        upstream: true,
        ..Default::default()
    };
    install_app(&*store, template_with(version, &[], Some(carries))).unwrap();
    let brief = napkin_host::library::spinoff_document(&*store, &source, APP, None, None).unwrap();
    (store, source, brief)
}

// A brief spun off from research is shown with the installed Brief Maker's
// view like any document of it, holds the research whole in the view's data,
// and asking what changed upstream writes to neither document.
#[test]
fn a_spun_off_brief_is_shown_with_the_library_view_and_reading_upstream_writes_nothing() {
    let (store, source, brief) = spun_off_brief("1.0.0");
    install_app(&*store, template("1.2.0", &[])).unwrap();
    let before = (store.read(&brief).unwrap(), store.read(&source).unwrap());

    let session = Session::new(store.clone() as Arc<dyn DocStore>);
    let open = session.open(brief.clone()).unwrap();
    assert_eq!(open.view_source, ViewSource::Library);
    let html = session.human_html().unwrap();
    assert!(html.contains("VIEW 1.2.0"), "{html}");
    assert!(
        html.contains("Lúnasa 0.0"),
        "the view's data carries the frozen copy whole"
    );

    let resp = napkin_host::handle(
        &session,
        &napkin_host::NoConfig,
        napkin_host::HostRequest::new("/upstream", "", Vec::new()),
    );
    assert_eq!(resp.status, 200);
    let up: serde_json::Value = serde_json::from_slice(&resp.body).unwrap();
    assert_eq!(up["upstream"][0]["status"], "current", "{up}");
    assert_eq!(up["upstream"][0]["title"], "Lúnasa");
    session.compose_export(true, false).unwrap();

    assert_eq!(
        (store.read(&brief).unwrap(), store.read(&source).unwrap()),
        before,
        "neither the brief nor its research is written"
    );
}

// ── doc-app-upgrade: locked documents keep their page; unlocked ones catch up ──

/// A schema with `tone`, and `budget` when `budget` is set; nothing else.
fn schema(budget: bool) -> String {
    format!(
        r#"{{"type":"object","additionalProperties":false,"properties":{{"tone":{{"type":"string"}}{}}}}}"#,
        if budget {
            r#","budget":{"type":"string"}"#
        } else {
            ""
        }
    )
}

fn post(session: &Session, path: &str, body: serde_json::Value) -> (u16, serde_json::Value) {
    let r = napkin_host::handle(
        session,
        &napkin_host::NoConfig,
        napkin_host::HostRequest::new(path, "", body.to_string().into_bytes()),
    );
    (
        r.status,
        serde_json::from_slice(&r.body).unwrap_or(serde_json::Value::Null),
    )
}

fn chain_of(bytes: &[u8]) -> clan_sdk::DecisionChain {
    let clan = ClanFile::from_bytes(bytes.to_vec()).unwrap();
    clan_sdk::DecisionChain::from_yaml(&clan.read_entry("agent/decision-chain.yaml").unwrap())
        .unwrap()
}

fn app_updates(bytes: &[u8]) -> Vec<clan_sdk::Decision> {
    chain_of(bytes)
        .decisions
        .into_iter()
        .filter(|d| d.kind.as_deref() == Some("app_update"))
        .collect()
}

fn lock_id(bytes: &[u8]) -> Option<String> {
    let clan = ClanFile::from_bytes(bytes.to_vec()).unwrap();
    napkin_host::ops::review::lock_of(&chain_of(bytes), clan.document_id())
        .and_then(|d| d.id.clone())
}

impl Fixture {
    /// A document of `old`, given some data and locked, and then `now`
    /// installed over it.
    fn locked(old: Vec<u8>, now: Vec<u8>) -> Self {
        let f = Fixture::new(old.clone(), Some(old));
        f.session.open(f.doc.clone()).unwrap();
        f.session
            .patch_data(r#"{"patch":{"tone":"warm"},"agent":"human"}"#)
            .unwrap();
        let (status, v) = post(&f.session, "/approve", serde_json::json!({}));
        assert_eq!(status, 200, "{v}");
        install_app(&*f.store, now).unwrap();
        f
    }
}

#[test]
fn a_locked_document_shows_its_own_page_and_is_offered_the_update() {
    let f = Fixture::locked(v1(), template("1.2.0", &[]));
    let open = f.session.open(f.doc.clone()).unwrap();
    assert_eq!(open.view_source, ViewSource::Document);
    assert_eq!(open.view_version.as_deref(), Some("1.0.0"));
    let u = open.app_update.as_ref().expect("an update is offered");
    assert!(u.available);
    assert_eq!(u.name, "Brief Maker");
    assert_eq!(u.from.version, "1.0.0");
    assert_eq!(u.to.version, "1.2.0");
    assert!(u.blocked.is_none());
    let json = serde_json::to_value(&open).unwrap();
    assert_eq!(json["app_update"]["to"]["version"], "1.2.0");

    assert!(f.session.human_html().unwrap().contains("VIEW 1.0.0"));
    // Export and every handoff carry the page the client approved.
    let (html, _) = f.session.compose_export(false, true).unwrap();
    assert!(html.contains("VIEW 1.0.0") && !html.contains("VIEW 1.2.0"));
    assert_eq!(f.session.raw_bytes().unwrap(), f.stored());
}

#[test]
fn an_unlocked_document_shows_the_installed_page_and_says_it_is_behind() {
    let f = Fixture::new(v1(), Some(template("1.2.0", &[])));
    let open = f.session.open(f.doc.clone()).unwrap();
    assert_eq!(open.view_source, ViewSource::Library);
    assert_eq!(open.app_update.as_ref().unwrap().to.version, "1.2.0");
    // Nothing newer: nothing offered.
    let f = Fixture::new(v1(), Some(v1()));
    assert!(f.session.open(f.doc.clone()).unwrap().app_update.is_none());
}

#[test]
fn the_first_write_catches_an_unlocked_document_up_once() {
    let f = Fixture::new(
        template_schema("1.0.0", &schema(false)),
        Some(template_schema("1.2.0", &schema(true))),
    );
    f.session.open(f.doc.clone()).unwrap();
    // A field only the newer schema allows is taken: page and schema move together.
    f.session
        .patch_data(r#"{"patch":{"budget":"lots"},"agent":"human"}"#)
        .unwrap();
    let stored = ClanFile::from_bytes(f.stored()).unwrap();
    assert!(stored
        .read_entry_string("human/index.html")
        .unwrap()
        .contains("VIEW 1.2.0"));
    assert_eq!(stored.manifest().app.as_ref().unwrap().version, "1.2.0");
    assert!(stored
        .read_entry_string("shared/data.yaml")
        .unwrap()
        .contains("lots"));

    let ups = app_updates(&f.stored());
    assert_eq!(ups.len(), 1);
    let d = &ups[0];
    assert_eq!(d.action, "update_app");
    assert_eq!(d.agent, "napkin-host");
    assert_eq!(d.actor.as_deref(), Some("human:local"));
    assert!(d.pinned);
    assert_eq!(d.targets, vec![stored.document_id().to_string()]);
    assert_eq!(d.extra["trigger"], serde_yaml::Value::from("save"));
    assert_eq!(d.extra["from"]["version"], serde_yaml::Value::from("1.0.0"));
    assert_eq!(d.extra["to"]["version"], serde_yaml::Value::from("1.2.0"));
    // The edit is the newest decision, the catch-up just before it.
    let chain = chain_of(&f.stored());
    assert_eq!(chain.decisions[1].kind.as_deref(), Some("app_update"));

    // A second write does not catch up again.
    f.session
        .patch_data(r#"{"patch":{"tone":"warm"},"agent":"human"}"#)
        .unwrap();
    assert_eq!(app_updates(&f.stored()).len(), 1);
    // A reopen finds nothing to offer.
    assert!(f.session.open(f.doc.clone()).unwrap().app_update.is_none());
}

#[test]
fn a_write_that_changes_nothing_does_not_catch_up() {
    let f = Fixture::new(v1(), Some(template("1.2.0", &[])));
    f.session.open(f.doc.clone()).unwrap();
    f.session
        .patch_data(r#"{"patch":{"tone":"warm"},"agent":"human"}"#)
        .unwrap();
    let before = f.stored();
    // Reopened against an even newer install: a no-op write writes nothing.
    install_app(&*f.store, template("1.3.0", &[])).unwrap();
    f.session.open(f.doc.clone()).unwrap();
    let reply = f
        .session
        .patch_data(r#"{"patch":{"tone":"warm"},"agent":"human"}"#)
        .unwrap();
    assert_eq!(reply["noop"], true);
    assert_eq!(f.stored(), before);
}

#[test]
fn data_that_does_not_fit_blocks_the_catch_up_and_the_write_still_lands() {
    let f = Fixture::new(
        template_schema("1.0.0", &schema(true)),
        Some(template_schema("1.2.0", &schema(false))),
    );
    // Written while 1.0.0 was all there was.
    install_app(&*f.store, template_schema("1.0.0", &schema(true))).unwrap();
    f.session.open(f.doc.clone()).unwrap();
    f.session
        .patch_data(r#"{"patch":{"budget":"lots"},"agent":"human"}"#)
        .unwrap();
    install_app(&*f.store, template_schema("1.2.0", &schema(false))).unwrap();

    let open = f.session.open(f.doc.clone()).unwrap();
    assert_eq!(
        open.app_update.as_ref().unwrap().blocked,
        Some(vec!["budget".to_string()])
    );
    f.session
        .patch_data(r#"{"patch":{"tone":"warm"},"agent":"human"}"#)
        .unwrap();
    let stored = ClanFile::from_bytes(f.stored()).unwrap();
    assert!(stored
        .read_entry_string("shared/data.yaml")
        .unwrap()
        .contains("warm"));
    assert_eq!(stored.manifest().app.as_ref().unwrap().version, "1.0.0");
    assert!(app_updates(&f.stored()).is_empty());
}

#[test]
fn update_on_a_locked_document_keeps_the_lock_and_the_clients_answer() {
    let f = Fixture::locked(v1(), template("1.2.0", &[]));
    f.session.open(f.doc.clone()).unwrap();
    let (status, v) = post(
        &f.session,
        "/client-review",
        serde_json::json!({ "answer": "accepted", "client": { "name": "Jane Murphy" },
            "channel": "none", "parts": [{ "address": "tone", "label": "Tone" }] }),
    );
    assert_eq!(status, 200, "{v}");
    let lock = lock_id(&f.stored()).expect("locked");
    let answer_current = |f: &Fixture| {
        let view = f
            .session
            .read(napkin_host::ops::decisions::decisions)
            .unwrap();
        let v = serde_json::to_value(view).unwrap();
        (
            v["lock"]["locked"].clone(),
            v["client"]["answer"]["current"].clone(),
        )
    };
    assert_eq!(answer_current(&f), (true.into(), true.into()));
    let attention = |f: &Fixture| {
        f.session
            .read(napkin_host::ops::decisions::decisions)
            .unwrap()
            .attention
            .len()
    };
    let asks = attention(&f);

    let (status, v) = post(&f.session, "/app/update", serde_json::json!({}));
    assert_eq!(status, 200, "{v}");
    assert_eq!(v["kind"], "app_update");
    assert_eq!(v["to"]["version"], "1.2.0");

    // The same lock, still locked, and the client's answer still counts.
    assert_eq!(lock_id(&f.stored()).as_deref(), Some(lock.as_str()));
    assert_eq!(answer_current(&f), (true.into(), true.into()));
    let ups = app_updates(&f.stored());
    assert_eq!(ups.len(), 1);
    assert_eq!(ups[0].agent, "human:local");
    assert_eq!(ups[0].extra["trigger"], serde_yaml::Value::from("update"));
    assert!(ups[0]
        .rationale
        .starts_with("Brought the locked version up to Brief Maker 1.2.0"));
    assert!(ups[0].superseded_by.is_none());
    assert_eq!(attention(&f), asks, "an update asks nothing of anyone");

    // The page shown is the new one, now the document's own.
    assert!(f.session.human_html().unwrap().contains("VIEW 1.2.0"));
    let open = f.session.open(f.doc.clone()).unwrap();
    assert_eq!(open.view_source, ViewSource::Document);
    assert_eq!(open.view_version.as_deref(), Some("1.2.0"));
    assert!(open.app_update.is_none());

    // Pressing it again: nothing to update to.
    assert_eq!(
        post(&f.session, "/app/update", serde_json::json!({})).0,
        409
    );
}

#[test]
fn update_is_refused_to_anyone_but_a_person_and_when_the_data_does_not_fit() {
    // A process is not a person.
    let f = Fixture::locked(v1(), template("1.2.0", &[]));
    let before = f.stored();
    let job = Session::with_ctx(
        f.store.clone() as Arc<dyn DocStore>,
        napkin_host::Ctx::new(napkin_host::Actor::process("job-1").unwrap()),
    );
    job.open(f.doc.clone()).unwrap();
    assert_eq!(post(&job, "/app/update", serde_json::json!({})).0, 403);
    assert_eq!(f.stored(), before);

    // Data the new schema refuses: 422, naming the field, nothing written.
    let store = Arc::new(MemStore::default());
    install_app(&*store, template_schema("1.0.0", &schema(true))).unwrap();
    let doc = create_instance(&*store, APP, None).unwrap();
    let session = Session::new(store.clone() as Arc<dyn DocStore>);
    session.open(doc.clone()).unwrap();
    session
        .patch_data(r#"{"patch":{"budget":"lots"},"agent":"human"}"#)
        .unwrap();
    assert_eq!(post(&session, "/approve", serde_json::json!({})).0, 200);
    install_app(&*store, template_schema("1.2.0", &schema(false))).unwrap();
    let open = session.open(doc.clone()).unwrap();
    assert_eq!(
        open.app_update.unwrap().blocked,
        Some(vec!["budget".to_string()])
    );
    let before = store.read(&doc).unwrap();
    let (status, v) = post(&session, "/app/update", serde_json::json!({}));
    assert_eq!(status, 422, "{v}");
    assert!(v.to_string().contains("budget"), "{v}");
    assert_eq!(store.read(&doc).unwrap(), before);
    assert!(session.human_html().unwrap().contains("VIEW 1.0.0"));
}

#[test]
fn trust_follows_the_document_after_an_update() {
    let (private, public) = clan_sdk::generate_keypair();
    let signed = sign_app(
        &ClanFile::from_bytes(template("1.2.0", &[])).unwrap(),
        &private,
        None,
    )
    .unwrap();
    let f = Fixture::locked(v1(), signed);
    let doc = Document::from_bytes_with_key(f.doc.clone(), f.stored(), &public).unwrap();
    let doc = resolve(&*f.store, doc, &public);
    assert_eq!(doc.view_source(), ViewSource::Document, "locked");
    assert!(!doc.trusted(), "its own 1.0.0 is unsigned");

    let ctx = napkin_host::Ctx::local();
    let out = napkin_host::ops::app_update::update(&ctx, &doc, &*f.store, &public).unwrap();
    let change = &out.changes[0];
    let version = f.store.apply(change).unwrap();
    let after = doc.advance(change, version).unwrap();
    assert!(
        after.document_trusted(),
        "it carries the signed template's code and signature"
    );
    assert!(after.trusted());
    assert!(after.app_update().is_none());
}
