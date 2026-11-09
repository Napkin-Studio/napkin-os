// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Moving a document onto a newer version of its app.
//!
//! A document made from a template app carries its own copy of the app: the
//! page, the output schema, the pipeline contract, the member schemas, the
//! app's own manifest and icon, and the app block and signature in its
//! manifest. [`upgrade_app`] swaps that whole set for the one an installed
//! template carries, together or not at all, and only when the document's
//! data and members still validate against the template's schemas. Nothing
//! else in the document changes: identity, client, data, members, decision
//! chain, context and uploads stay the document's.
//!
//! [`app_digest`] says whether two archives carry the same app: a sha256
//! over the app-owned entries (sorted by path) and the app block. The version
//! string is typed by hand, so the digest — not the version — is what says a
//! document is behind its installed app.

use serde_json::Value;

use crate::container::{ClanBuilder, ClanFile, MANIFEST_PATH};
use crate::error::{Error, Result};
use crate::hash::sha256_hex;
use crate::manifest::FileEntry;

/// The entries that are an app's own, whichever document carries them.
pub const APP_ENTRIES: &[&str] = &[
    "agent/output-schema.json",
    "app/icon.svg",
    "app/manifest.yaml",
    "app/pipeline.yaml",
    "human/export.html",
    "human/index.html",
    "human/styles.css",
];

/// Member schemas: `app/schemas/<name>.schema.json` checks the member
/// `shared/<name>.yaml`.
const SCHEMAS: &str = "app/schemas/";
const ASSETS: &str = "human/assets/";
const DATA: &str = "shared/data.yaml";
const OUTPUT_SCHEMA: &str = "agent/output-schema.json";

/// Whether `path` belongs to the app rather than to the document.
pub fn is_app_entry(path: &str) -> bool {
    APP_ENTRIES.contains(&path) || (path.starts_with(SCHEMAS) && path.ends_with(".schema.json"))
}

/// The app-owned paths `clan` holds, sorted.
fn app_paths(clan: &ClanFile) -> Result<Vec<String>> {
    let mut paths: Vec<String> = clan
        .entry_paths()?
        .into_iter()
        .filter(|p| is_app_entry(p))
        .collect();
    paths.sort();
    paths.dedup();
    Ok(paths)
}

/// `sha256:<hex>` over the app `clan` carries: each app-owned entry as
/// `path:<sha256>` in path order, then the app block as JSON. Stable across
/// zip order; the signature is not part of it (it follows the code it signs).
pub fn app_digest(clan: &ClanFile) -> Result<String> {
    let mut msg = String::from("napkin-app-digest-v1\n");
    for path in app_paths(clan)? {
        msg.push_str(&format!(
            "{path}:{}\n",
            sha256_hex(&clan.read_entry(&path)?)
        ));
    }
    let app = serde_json::to_string(&clan.manifest().app)?;
    msg.push_str(&format!("app:{app}\n"));
    Ok(format!("sha256:{}", sha256_hex(msg.as_bytes())))
}

/// The major of a plain `MAJOR[.MINOR[.PATCH]]` version.
fn major(version: &str) -> Option<u64> {
    let parts: Vec<&str> = version.trim().split('.').collect();
    if parts.is_empty()
        || parts.len() > 3
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    parts[0].parse().ok()
}

/// Refuse a template that is not a newer copy of `doc`'s own app: not a
/// template, a different app id, or a different (or unparsable) major.
fn check_same_app(doc: &ClanFile, template: &ClanFile) -> Result<()> {
    let tm = template.manifest();
    if tm.document_type.as_deref() != Some("template") {
        return Err(Error::OutputRejected(
            "upgrade_app expects a template app (document_type: template)".into(),
        ));
    }
    let to = tm
        .app
        .as_ref()
        .ok_or_else(|| Error::OutputRejected("the template has no app block".into()))?;
    let from = doc
        .manifest()
        .app
        .as_ref()
        .ok_or_else(|| Error::OutputRejected("the document is not an app's".into()))?;
    if from.app_id != to.app_id {
        return Err(Error::OutputRejected(format!(
            "the document is {}, the template is {}",
            from.app_id, to.app_id
        )));
    }
    match (major(&from.version), major(&to.version)) {
        (Some(a), Some(b)) if a == b => Ok(()),
        _ => Err(Error::OutputRejected(format!(
            "{} {} and {} are not the same major version",
            to.app_id, from.version, to.version
        ))),
    }
}

/// A YAML entry of `clan` as JSON, or `None` when it is absent or empty.
fn yaml_json(clan: &ClanFile, path: &str) -> Result<Option<Value>> {
    if !clan.has_entry(path) {
        return Ok(None);
    }
    let text = clan.read_entry_string(path)?;
    if text.trim().is_empty() {
        return Ok(None);
    }
    let v: Value = serde_yaml::from_str(&text)?;
    Ok(Some(v))
}

/// A JSON pointer as a dotted path: `/objectives/commercial` →
/// `objectives.commercial`.
fn dotted(pointer: &str) -> String {
    pointer
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| s.replace("~1", "/").replace("~0", "~"))
        .collect::<Vec<_>>()
        .join(".")
}

fn join(base: &str, key: &str) -> String {
    if base.is_empty() {
        key.to_string()
    } else {
        format!("{base}.{key}")
    }
}

/// The paths in `instance` that `schema` rejects, each named by the field it
/// is about: the property a `required` misses, the ones `additionalProperties`
/// refuses, else the value's own path.
fn misfits_of(schema_json: &[u8], mut instance: Value, label: &str) -> Result<Vec<String>> {
    let schema: Value = serde_json::from_slice(schema_json)
        .map_err(|e| Error::Schema(format!("{label}: the template's schema is not JSON: {e}")))?;
    let compiled = jsonschema::validator_for(&schema)
        .map_err(|e| Error::Schema(format!("{label}: could not compile schema: {e}")))?;
    if let Some(obj) = instance.as_object_mut() {
        obj.remove("$schema");
    }
    let mut out = Vec::new();
    for e in compiled.iter_errors(&instance) {
        let at = dotted(e.instance_path.as_str());
        match &e.kind {
            jsonschema::error::ValidationErrorKind::Required { property } => {
                out.push(join(&at, property.as_str().unwrap_or("?")));
            }
            jsonschema::error::ValidationErrorKind::AdditionalProperties { unexpected } => {
                out.extend(unexpected.iter().map(|k| join(&at, k)));
            }
            _ => out.push(if at.is_empty() { "(root)".into() } else { at }),
        }
    }
    Ok(out)
}

/// The fields of `doc`'s data and members that `template`'s schemas would
/// reject, sorted and without repeats. Empty means the document fits.
pub fn upgrade_misfits(doc: &ClanFile, template: &ClanFile) -> Result<Vec<String>> {
    let mut out = Vec::new();
    if template.has_entry(OUTPUT_SCHEMA) {
        let data = yaml_json(doc, DATA)?.unwrap_or_else(|| Value::Object(Default::default()));
        out.extend(misfits_of(
            &template.read_entry(OUTPUT_SCHEMA)?,
            data,
            OUTPUT_SCHEMA,
        )?);
    }
    for path in app_paths(template)? {
        let Some(name) = path
            .strip_prefix(SCHEMAS)
            .and_then(|p| p.strip_suffix(".schema.json"))
        else {
            continue;
        };
        let member = format!("shared/{name}.yaml");
        if let Some(value) = yaml_json(doc, &member)? {
            out.extend(misfits_of(&template.read_entry(&path)?, value, &path)?);
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

/// `doc` with `template`'s app in place of its own: every app-owned entry
/// (the ones the template lacks are dropped), the template's `human/assets/*`
/// the document does not hold (its own are never overwritten), and the app
/// block and signature in the manifest — all together, or nothing.
///
/// Refused when the template is not a template of the same app id and major
/// ([`Error::OutputRejected`]), and when the document's data or a member does
/// not validate against the template's schemas ([`Error::DoesNotFit`], naming
/// the fields). When the document already carries exactly the template's app
/// ([`app_digest`] equal) its bytes come back unchanged.
pub fn upgrade_app(doc: &ClanFile, template: &ClanFile) -> Result<Vec<u8>> {
    check_same_app(doc, template)?;
    if app_digest(doc)? == app_digest(template)? {
        return Ok(doc.raw_bytes().to_vec());
    }
    let misfits = upgrade_misfits(doc, template)?;
    if !misfits.is_empty() {
        return Err(Error::DoesNotFit(misfits));
    }

    let tm = template.manifest();
    let mut manifest = doc.manifest().clone();
    manifest.next_revision();
    manifest.app = tm.app.clone();
    manifest.signature = tm.signature.clone();
    manifest.files.retain(|f| !is_app_entry(&f.path));

    let mut b = ClanBuilder::new(manifest);
    let mut held = Vec::new();
    for (path, bytes) in doc.read_all_entries()? {
        if path == MANIFEST_PATH || is_app_entry(&path) {
            continue;
        }
        held.push(path.clone());
        b.add_entry(path, bytes);
    }
    for (path, bytes) in template.read_all_entries()? {
        let app = is_app_entry(&path);
        let new_asset = path.starts_with(ASSETS) && !held.contains(&path);
        if !app && !new_asset {
            continue;
        }
        register(&mut b.manifest_mut().files, tm.file_by_path(&path));
        b.add_entry(path, bytes);
    }
    b.build()
}

/// Register the template's entry for a path, unless the registry already
/// has that path. An id another path holds gets a suffix.
fn register(files: &mut Vec<FileEntry>, from: Option<&FileEntry>) {
    let Some(from) = from else { return };
    if files.iter().any(|f| f.path == from.path) {
        return;
    }
    let mut entry = from.clone();
    entry.sha256 = None;
    let base = entry.id.clone();
    let mut n = 2;
    while files.iter().any(|f| f.id == entry.id) {
        entry.id = format!("{base}-{n}");
        n += 1;
    }
    files.push(entry);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::create::{create, CreateOptions};
    use crate::instantiate::{instantiate, make_template, InstantiateOptions, MakeTemplateOptions};
    use crate::manifest::AppInfo;
    use crate::sign::{generate_keypair, sign_app, verify_app};

    const APP: &str = "ie.napkin.brief";

    fn schema(extra: &str) -> String {
        format!(
            r#"{{"type":"object","additionalProperties":false,
                "properties":{{"tone":{{"type":"string"}}{extra}}}}}"#
        )
    }

    /// A template of `version` whose page names the version, with `schema`,
    /// a facts member schema and `assets`.
    fn template_of(
        version: &str,
        schema: &str,
        facts_schema: &str,
        assets: &[(&str, &[u8])],
    ) -> ClanFile {
        let base = create(CreateOptions {
            title: "Brief Maker".into(),
            brief: "fixture".into(),
            document_type: None,
            no_render: false,
            schema: Some(schema.into()),
        })
        .unwrap();
        let clan = ClanFile::from_bytes(base).unwrap();
        let mut b = ClanBuilder::new(clan.manifest().clone());
        for (p, by) in clan.read_all_entries().unwrap() {
            if p != MANIFEST_PATH && p != "human/index.html" {
                b.add_entry(p, by);
            }
        }
        b.add_entry(
            "human/index.html",
            format!("<html><body>VIEW {version}</body></html>").into_bytes(),
        );
        b.add_entry(
            "app/pipeline.yaml",
            format!("pipeline: {version}\n").into_bytes(),
        );
        b.add_entry(
            "app/schemas/facts.schema.json",
            facts_schema.as_bytes().to_vec(),
        );
        b.add_entry("shared/facts.yaml", b"facts: []\n".to_vec());
        for (p, role) in [
            ("app/pipeline.yaml", "pipeline-contract"),
            ("app/schemas/facts.schema.json", "member-schema"),
            ("shared/facts.yaml", "pinned-facts"),
        ] {
            b.manifest_mut().files.push(FileEntry {
                id: role.into(),
                path: p.into(),
                role: role.into(),
                content_type: "text/plain".into(),
                priority: None,
                sha256: None,
            });
        }
        for (name, bytes) in assets {
            b.add_entry(format!("human/assets/{name}"), bytes.to_vec());
        }
        let with = ClanFile::from_bytes(b.build().unwrap()).unwrap();
        ClanFile::from_bytes(
            make_template(
                &with,
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
                    spinoff: None,
                    attach: None,
                },
                MakeTemplateOptions::default(),
            )
            .unwrap(),
        )
        .unwrap()
    }

    const FACTS: &str =
        r#"{"type":"object","required":["facts"],"properties":{"facts":{"type":"array"}}}"#;

    fn template(version: &str, schema: &str) -> ClanFile {
        template_of(version, schema, FACTS, &[])
    }

    fn instance(t: &ClanFile) -> ClanFile {
        ClanFile::from_bytes(instantiate(t, InstantiateOptions::default()).unwrap()).unwrap()
    }

    fn with_entry(clan: &ClanFile, path: &str, bytes: &[u8]) -> ClanFile {
        let mut b = ClanBuilder::new(clan.manifest().clone());
        for (p, by) in clan.read_all_entries().unwrap() {
            if p != MANIFEST_PATH {
                b.add_entry(p, by);
            }
        }
        b.add_entry(path, bytes.to_vec());
        ClanFile::from_bytes(b.build().unwrap()).unwrap()
    }

    #[test]
    fn it_swaps_exactly_the_app_and_keeps_the_document() {
        let old = template_of("1.0.0", &schema(""), FACTS, &[("logo.svg", b"old")]);
        let doc = instance(&old);
        let doc = with_entry(&doc, "shared/data.yaml", b"tone: warm\n");
        let doc = with_entry(&doc, "human/assets/upload.png", b"mine");
        let doc = with_entry(&doc, "agent/decision-chain.yaml", b"decisions: []\n");
        let new = template_of(
            "1.1.0",
            &schema(r#","budget":{"type":"string"}"#),
            FACTS,
            &[("logo.svg", b"new"), ("badge.svg", b"badge")],
        );

        let up = ClanFile::from_bytes(upgrade_app(&doc, &new).unwrap()).unwrap();
        for p in [
            "human/index.html",
            "agent/output-schema.json",
            "app/pipeline.yaml",
            "app/manifest.yaml",
            "app/schemas/facts.schema.json",
        ] {
            assert_eq!(up.read_entry(p).unwrap(), new.read_entry(p).unwrap(), "{p}");
        }
        assert_eq!(up.manifest().app.as_ref().unwrap().version, "1.1.0");
        assert_eq!(app_digest(&up).unwrap(), app_digest(&new).unwrap());
        // The document's own: identity, data, members, chain, context, uploads.
        assert_eq!(up.document_id(), doc.document_id());
        assert_ne!(up.manifest().id, doc.manifest().id, "a new revision");
        assert_eq!(up.manifest().title, doc.manifest().title);
        assert_eq!(
            up.manifest().lineage.as_ref().unwrap().parent_id,
            doc.manifest().lineage.as_ref().unwrap().parent_id
        );
        for p in [
            "shared/data.yaml",
            "shared/facts.yaml",
            "agent/decision-chain.yaml",
            "agent/context.md",
            "human/assets/upload.png",
        ] {
            assert_eq!(up.read_entry(p).unwrap(), doc.read_entry(p).unwrap(), "{p}");
        }
        // Assets: new ones added, the document's never overwritten.
        assert_eq!(up.read_entry("human/assets/badge.svg").unwrap(), b"badge");
        assert_eq!(up.read_entry("human/assets/logo.svg").unwrap(), b"old");
        assert!(
            crate::validate(&up).is_valid(),
            "{}",
            crate::validate(&up).display()
        );
    }

    #[test]
    fn an_entry_the_template_dropped_goes_too() {
        let old = template("1.0.0", &schema(""));
        let doc = with_entry(&instance(&old), "human/export.html", b"<p>export</p>");
        let new = template("1.1.0", &schema(""));
        let up = ClanFile::from_bytes(upgrade_app(&doc, &new).unwrap()).unwrap();
        assert!(!up.has_entry("human/export.html"));
        assert!(up.manifest().file_by_path("human/export.html").is_none());
    }

    #[test]
    fn data_that_does_not_fit_is_refused_naming_the_fields() {
        let old = template("1.0.0", &schema(r#","budget":{"type":"string"}"#));
        let doc = with_entry(
            &instance(&old),
            "shared/data.yaml",
            b"tone: warm\nbudget: lots\n",
        );
        // budget is gone, and objectives is now required.
        let new = template(
            "1.1.0",
            r#"{"type":"object","additionalProperties":false,"required":["objectives"],
                "properties":{"tone":{"type":"string"},"objectives":{"type":"object"}}}"#,
        );
        match upgrade_app(&doc, &new) {
            Err(Error::DoesNotFit(paths)) => assert_eq!(paths, vec!["budget", "objectives"]),
            other => panic!("expected DoesNotFit, got {other:?}"),
        }
        assert_eq!(
            upgrade_misfits(&doc, &new).unwrap(),
            vec!["budget", "objectives"]
        );
    }

    #[test]
    fn a_member_that_does_not_fit_is_refused() {
        let old = template("1.0.0", &schema(""));
        let doc = with_entry(&instance(&old), "shared/facts.yaml", b"facts:\n- id: f1\n");
        let strict = r#"{"type":"object","properties":{"facts":{"type":"array",
            "items":{"type":"object","required":["id","unit"]}}}}"#;
        let new = template_of("1.1.0", &schema(""), strict, &[]);
        match upgrade_app(&doc, &new) {
            Err(Error::DoesNotFit(paths)) => assert_eq!(paths, vec!["facts.0.unit"]),
            other => panic!("expected DoesNotFit, got {other:?}"),
        }
    }

    #[test]
    fn another_app_or_major_is_refused() {
        let doc = instance(&template("1.0.0", &schema("")));
        let other_major = template("2.0.0", &schema(""));
        assert!(matches!(
            upgrade_app(&doc, &other_major),
            Err(Error::OutputRejected(_))
        ));

        let other = template("1.1.0", &schema(""));
        let mut m = other.manifest().clone();
        m.app.as_mut().unwrap().app_id = "ie.napkin.other".into();
        let mut b = ClanBuilder::new(m);
        for (p, by) in other.read_all_entries().unwrap() {
            if p != MANIFEST_PATH {
                b.add_entry(p, by);
            }
        }
        let other = ClanFile::from_bytes(b.build().unwrap()).unwrap();
        assert!(matches!(
            upgrade_app(&doc, &other),
            Err(Error::OutputRejected(_))
        ));
        // A document is not a template.
        assert!(matches!(
            upgrade_app(&doc, &doc),
            Err(Error::OutputRejected(_))
        ));
    }

    #[test]
    fn the_signature_moves_with_the_code() {
        let (private, public) = generate_keypair();
        let doc = instance(&template("1.0.0", &schema("")));
        let new = ClanFile::from_bytes(
            sign_app(&template("1.1.0", &schema("")), &private, None).unwrap(),
        )
        .unwrap();
        assert!(!verify_app(&doc, &public));
        let up = ClanFile::from_bytes(upgrade_app(&doc, &new).unwrap()).unwrap();
        assert!(
            verify_app(&up, &public),
            "the carried signature matches the carried code"
        );

        // And an unsigned template takes a signed document's signature away.
        let signed_old = ClanFile::from_bytes(
            sign_app(&template("1.0.0", &schema("")), &private, None).unwrap(),
        )
        .unwrap();
        let doc = instance(&signed_old);
        assert!(verify_app(&doc, &public));
        let up = ClanFile::from_bytes(upgrade_app(&doc, &template("1.1.0", &schema(""))).unwrap())
            .unwrap();
        assert!(up.manifest().signature.is_none());
        assert!(!verify_app(&up, &public));
    }

    #[test]
    fn it_is_idempotent() {
        let doc = instance(&template("1.0.0", &schema("")));
        let new = template("1.1.0", &schema(""));
        let once = upgrade_app(&doc, &new).unwrap();
        let twice = upgrade_app(&ClanFile::from_bytes(once.clone()).unwrap(), &new).unwrap();
        assert_eq!(once, twice, "an up-to-date document comes back unchanged");
    }

    #[test]
    fn the_digest_is_the_apps_and_ignores_zip_order_and_data() {
        let t = template("1.0.0", &schema(""));
        let doc = instance(&t);
        assert_eq!(app_digest(&doc).unwrap(), app_digest(&t).unwrap());
        // Same entries, written in reverse order.
        let mut b = ClanBuilder::new(doc.manifest().clone());
        let mut all = doc.read_all_entries().unwrap();
        all.reverse();
        for (p, by) in all {
            if p != MANIFEST_PATH {
                b.add_entry(p, by);
            }
        }
        let reversed = ClanFile::from_bytes(b.build().unwrap()).unwrap();
        assert_eq!(app_digest(&reversed).unwrap(), app_digest(&doc).unwrap());
        // Data is not the app's; the page and the app block are.
        let filled = with_entry(&doc, "shared/data.yaml", b"tone: warm\n");
        assert_eq!(app_digest(&filled).unwrap(), app_digest(&doc).unwrap());
        let paged = with_entry(&doc, "human/index.html", b"<p>other</p>");
        assert_ne!(app_digest(&paged).unwrap(), app_digest(&doc).unwrap());
        assert_ne!(
            app_digest(&template("1.0.1", &schema(""))).unwrap(),
            app_digest(&t).unwrap()
        );
    }
}
