//! Package `app/templates/territories/` into the Territories template app.clan, and its finished sample run into an instance, using
//! the SDK alone.
//!
//!     cargo run -p clan-sdk --example make_territories -- [app.clan] [example.clan]
//!
//! Defaults: `territories.app.clan` and `territories.example.clan`.
//!
//! Territories is started from a Brief Maker or Research Tool document. The spin-off carries the source WHOLE under
//! `data.upstream.<source document id>` (os-layer 5.1: the data, the chain, the merged pins and findings, the assets) and
//! the contract takes no map and no lift: nothing of the source is ever copied into the document's own members. Three things this
//! packer guards:
//!
//! 1. The id, version and spin-off contract are asserted (`accepts` the two tools, `upstream` true), so a regression fails the packer and
//!    `crates/clan-sdk/tests/spinoff.rs`, which runs it.
//! 2. The template's seed data (`seed.json`) is a valid blank document: packing the view validates the data against `schema.json`, which
//!    requires the engine's members. Hosts start a document from `{}` (create_instance, spin-off), so a document just spun off holds
//!    only `upstream` and `projection`, and the engine's first write adds the rest. The seed holds no approvals: nothing starts past a gate.
//! 3. `make_template` replaces `agent/context.md`, so the app's own context is reinstalled and asserted to survive into an instance.

use clan_sdk::{
    create, instantiate, make_template, pack_html, patch_context, patch_requirements, validate,
    AppHome, AppInfo, ClanBuilder, ClanFile, CreateOptions, FileEntry, InstantiateOptions,
    MakeTemplateOptions, SpinoffSpec,
};
use std::fs;
use std::path::{Path, PathBuf};

#[allow(dead_code)]
#[path = "shared/app_ui.rs"]
mod app_ui;

const APP_ID: &str = "ie.napkin.territories";
const VERSION: &str = "0.1.0";
/// The apps a Territories document is spun off from, whole, under `upstream`.
const BRIEF_APP_ID: &str = "ie.napkin.brief-maker";
const RESEARCH_APP_ID: &str = "ie.napkin.campaign-research";
const ICON_PATH: &str = "app/icon.svg";
const DATA_PATH: &str = "shared/data.yaml";

fn template_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("app/templates/territories")
}

fn copy_all(clan: &ClanFile) -> Result<ClanBuilder, Box<dyn std::error::Error>> {
    let mut builder = ClanBuilder::new(clan.manifest().clone());
    for (path, bytes) in clan.read_all_entries()? {
        builder.add_entry(path, bytes);
    }
    Ok(builder)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = template_dir();
    let mut args = std::env::args().skip(1);
    let output = args
        .next()
        .unwrap_or_else(|| "territories.app.clan".to_string());
    let example_output = args
        .next()
        .unwrap_or_else(|| "territories.example.clan".to_string());

    let schema = fs::read_to_string(dir.join("schema.json"))?;
    // The source cards and the one agent engine (the Booth's circles) are inlined at the page's markers.
    let index_html = app_ui::inline_sphere(
        &dir.join(".."),
        &app_ui::inline_source_card(
            &dir.join(".."),
            &fs::read_to_string(dir.join("index.html"))?,
        )?,
    )?;
    let requirements = fs::read_to_string(dir.join("agent/requirements.yaml"))?;
    let context = fs::read_to_string(dir.join("context.md"))?;
    let icon = fs::read_to_string(dir.join("icon.svg"))?;
    let seed = fs::read_to_string(dir.join("seed.json"))?;
    let example = fs::read_to_string(dir.join("example/data.json"))?;

    // 1. Base document, seeded with the contract's schema.
    let base = create(CreateOptions {
        title: "Territories".into(),
        brief: "Template app: routes for a campaign, from a brief and its research".into(),
        document_type: None,
        no_render: false,
        schema: Some(schema),
    })?;
    let clan = ClanFile::from_bytes(base)?;

    // 2. The blank document as the template's seed (valid against the schema, which packing the view checks), and the mark
    //    as a registered member. The seed goes first: packing the view validates the data against the schema, which requires its members.
    let mut builder = copy_all(&clan)?;
    builder.add_entry(ICON_PATH, icon.clone().into_bytes());
    if clan.manifest().file_by_path(ICON_PATH).is_none() {
        builder.manifest_mut().files.push(FileEntry {
            id: "app-icon".into(),
            path: ICON_PATH.into(),
            role: "app-icon".into(),
            content_type: "image/svg+xml".into(),
            priority: None,
            sha256: None,
        });
    }
    builder.add_entry(DATA_PATH, seed.clone().into_bytes());
    let clan = ClanFile::from_bytes(builder.build()?)?;

    // 3. The app's UI is the human view.
    let clan = ClanFile::from_bytes(pack_html(&clan, &index_html, None, None, None, None)?)?;

    // 4. Capability requirements (spec 28).
    let clan = ClanFile::from_bytes(patch_requirements(&clan, &requirements)?)?;

    // 5. Stamp the app block and flip to template.
    let template_bytes = make_template(
        &clan,
        AppInfo {
            home: Some(AppHome {
                colour: Some("#14947F".into()),
                brand: Some("Territories".into()),
                ..Default::default()
            }),
            name: "Territories".into(),
            app_id: APP_ID.into(),
            version: VERSION.into(),
            icon: Some(ICON_PATH.into()),
            entry: "human/index.html".into(),
            schema: Some("agent/output-schema.json".into()),
            prompt_templates: vec![],
            data_seed: None,
            spinoff: Some(SpinoffSpec {
                accepts: vec![BRIEF_APP_ID.into(), RESEARCH_APP_ID.into()],
                upstream: true,
                ..Default::default()
            }),
            attach: None,
        },
        MakeTemplateOptions::default(),
    )?;

    // 6. Reinstall the app's own context: make_template replaced it.
    let template = ClanFile::from_bytes(template_bytes)?;
    let template_bytes = patch_context(&template, &context, false)?;
    let template = ClanFile::from_bytes(template_bytes.clone())?;

    // The spin-off contract, id and version are asserted, not assumed.
    let app_block = template.manifest().app.as_ref().expect("app block");
    assert_eq!(
        app_block.app_id, APP_ID,
        "the Territories id is fixed by the contract"
    );
    assert_eq!(
        app_block.version, VERSION,
        "the Territories template version"
    );
    let spin = app_block.spinoff.as_ref().expect("app.spinoff is declared");
    assert_eq!(
        spin.accepts,
        vec![BRIEF_APP_ID.to_string(), RESEARCH_APP_ID.to_string()],
        "Territories accepts the Brief Maker and the Research Tool"
    );
    assert!(
        spin.upstream,
        "app.spinoff.upstream must be true: the source is carried whole"
    );
    assert!(
        spin.map.is_none() && spin.lift.is_empty(),
        "no map and no lift: nothing is copied out of the source"
    );
    let seeded: serde_json::Value = serde_yaml::from_str(&template.read_entry_string(DATA_PATH)?)?;
    assert_eq!(
        seeded,
        serde_json::from_str::<serde_json::Value>(&seed)?,
        "the template's seed is the blank document in seed.json"
    );
    assert!(
        seeded["run"]["approvals"]
            .as_object()
            .is_some_and(|a| a.is_empty()),
        "a new document starts with no approvals: no gate is passed before a person passes it"
    );

    // 7. Self-checks: the contract and the context travel into an instance.
    let instance = ClanFile::from_bytes(instantiate(
        &template,
        InstantiateOptions {
            title: "smoke-instance".into(),
            ..Default::default()
        },
    )?)?;
    for path in [
        "agent/requirements.yaml",
        "agent/context.md",
        "agent/output-schema.json",
    ] {
        assert!(
            instance.has_entry(path),
            "{path} did not travel into the instance"
        );
    }
    assert!(
        instance
            .read_entry_string("agent/context.md")?
            .contains("Cite, never copy"),
        "the app's own context was lost: make_template's boilerplate won"
    );

    // 8. The example instance: the finished sample run as the document's data.
    let sample = ClanFile::from_bytes(instantiate(
        &template,
        InstantiateOptions {
            title: "Linea: Weekend by Rail (sample)".into(),
            ..Default::default()
        },
    )?)?;
    let mut builder = copy_all(&sample)?;
    builder.add_entry(DATA_PATH, example.clone().into_bytes());
    let sample_bytes = builder.build()?;
    let sample = ClanFile::from_bytes(sample_bytes.clone())?;
    assert_eq!(
        sample.read_entry_string(DATA_PATH)?,
        example,
        "the sample run was not stored byte for byte"
    );

    for (label, file) in [
        ("template", &template),
        ("instance", &instance),
        ("example", &sample),
    ] {
        let report = validate(file);
        if !report.is_valid() {
            eprintln!("[warn] {label} validation: {report:?}");
        }
    }

    fs::write(&output, &template_bytes)?;
    fs::write(&example_output, &sample_bytes)?;
    println!(
        "wrote {output} ({} bytes) and {example_output}: id, spin-off contract, seed and context verified",
        template_bytes.len()
    );
    println!("install: copy into the Napkin Studio app library as {APP_ID}/app.clan");
    Ok(())
}
