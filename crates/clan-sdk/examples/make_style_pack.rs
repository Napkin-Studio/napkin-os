//! Package `app/templates/style-pack/` into the Style Pack template app.clan,
//! and its invented example into an instance, using the SDK alone.
//!
//!     cargo run -p clan-sdk --example make_style_pack -- [app.clan] [example.clan]
//!
//! Defaults: `style-pack.app.clan` and `style-pack.example.clan`.
//!
//! The same shape as `make_deck_maker`, smaller: no pipeline, no requirements,
//! no spin-off and no attach. A Style Pack is attached INTO a Deck (the Deck's
//! `app.attach.accepts` names it); it attaches nothing itself. The view is
//! `clan render`'s default. Guards: the app's own context survives
//! `make_template`, and the example's data and its content-addressed reference
//! images are stored byte for byte.

use clan_sdk::{
    create, instantiate, make_template, patch_context, validate, AppHome, AppInfo, ClanBuilder,
    ClanFile, CreateOptions, InstantiateOptions, MakeTemplateOptions,
};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const APP_ID: &str = "ie.napkin.style-pack";
const ICON_PATH: &str = "app/icon.svg";
const DATA_PATH: &str = "shared/data.yaml";

fn template_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("app/templates/style-pack")
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
        .unwrap_or_else(|| "style-pack.app.clan".to_string());
    let example_output = args
        .next()
        .unwrap_or_else(|| "style-pack.example.clan".to_string());

    let schema = fs::read_to_string(dir.join("schema.json"))?;
    let context = fs::read_to_string(dir.join("context.md"))?;
    let icon = fs::read_to_string(dir.join("icon.svg"))?;
    let example = fs::read_to_string(dir.join("example/data.yaml"))?;

    // 1. Base document, seeded with the schema; its view is the default one.
    let base = create(CreateOptions {
        title: "Style Pack".into(),
        brief: "Template app: the look of the pictures, shared by the Territory tool and the Deck"
            .into(),
        document_type: None,
        no_render: false,
        schema: Some(schema),
    })?;
    let clan = ClanFile::from_bytes(base)?;

    // 2. The mark, as a registered member.
    let mut builder = copy_all(&clan)?;
    builder.add_entry(ICON_PATH, icon.into_bytes());
    if clan.manifest().file_by_path(ICON_PATH).is_none() {
        builder.manifest_mut().files.push(clan_sdk::FileEntry {
            id: "app-icon".into(),
            path: ICON_PATH.into(),
            role: "app-icon".into(),
            content_type: "image/svg+xml".into(),
            priority: None,
            sha256: None,
            linked: false,
        });
    }
    let clan = ClanFile::from_bytes(builder.build()?)?;

    // 3. Stamp the app block and flip to template. No spin-off, no attach.
    let template_bytes = make_template(
        &clan,
        AppInfo {
            home: Some(AppHome {
                colour: Some("#A8431D".into()),
                brand: Some("Style".into()),
                noun: vec!["style pack".into(), "style packs".into()],
                ..Default::default()
            }),
            name: "Style Pack".into(),
            app_id: APP_ID.into(),
            version: "0.1.0".into(),
            icon: Some(ICON_PATH.into()),
            entry: "human/index.html".into(),
            schema: Some("agent/output-schema.json".into()),
            prompt_templates: vec![],
            data_seed: None,
            spinoff: None,
            attach: None,
        },
        MakeTemplateOptions::default(),
    )?;

    // 4. Reinstall the app's own context: make_template replaced it.
    let template = ClanFile::from_bytes(template_bytes)?;
    let template_bytes = patch_context(&template, &context, false)?;
    let template = ClanFile::from_bytes(template_bytes.clone())?;

    let app_block = template.manifest().app.as_ref().expect("app block");
    assert_eq!(app_block.app_id, APP_ID, "the Style Pack app id");
    assert_eq!(
        app_block.version, "0.1.0",
        "the Style Pack template version"
    );
    assert!(
        app_block.spinoff.is_none(),
        "a Style Pack spins nothing off"
    );
    assert!(app_block.attach.is_none(), "a Style Pack attaches nothing");

    // 5. Self-checks: the context survives into an instance.
    let instance = ClanFile::from_bytes(instantiate(
        &template,
        InstantiateOptions {
            title: "smoke-instance".into(),
            ..Default::default()
        },
    )?)?;
    assert!(
        instance
            .read_entry_string("agent/context.md")?
            .contains("steward"),
        "the Style Pack rules were lost: make_template's boilerplate won"
    );

    // 6. The example instance: the invented pack and its images, content-addressed.
    let sample = ClanFile::from_bytes(instantiate(
        &template,
        InstantiateOptions {
            title: "Demo pack (invented)".into(),
            ..Default::default()
        },
    )?)?;
    let mut builder = copy_all(&sample)?;
    builder.add_entry(DATA_PATH, example.clone().into_bytes());
    let mut images = 0;
    for entry in fs::read_dir(dir.join("example/assets"))? {
        let bytes = fs::read(entry?.path())?;
        let sha: String = Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let path = format!("human/assets/style/{sha}.png");
        assert!(
            example.contains(&path),
            "an example image is not named in the example data: {path}"
        );
        builder.add_entry(path, bytes);
        images += 1;
    }
    assert_eq!(images, 3, "the example's three invented swatches");
    let sample_bytes = builder.build()?;
    let sample = ClanFile::from_bytes(sample_bytes.clone())?;
    assert_eq!(
        sample.read_entry_string(DATA_PATH)?,
        example,
        "the example pack was not stored byte for byte"
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
        "wrote {output} ({} bytes) and {example_output}: context and example verified",
        template_bytes.len()
    );
    println!("install: copy into the Napkin Studio app library as {APP_ID}/app.clan");
    Ok(())
}
