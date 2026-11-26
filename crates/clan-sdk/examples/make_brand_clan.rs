//! Package `app/templates/brand-clan/` into the Brand Clan template app.clan,
//! and its invented example (Tidewell Zero) into an instance, using the SDK alone.
//!
//!     cargo run -p clan-sdk --example make_brand_clan -- [app.clan] [example.clan]
//!
//! Defaults: `brand-clan.app.clan` and `brand-clan.example.clan`.
//!
//! `ie.napkin.brand` (docs/contracts/brand-clan.md) is an attach SOURCE: it
//! attaches nothing and spins nothing off; the Brief, Research, Deck and
//! Production apps declare `app.attach.accepts`. Its view is `clan render`'s
//! default: the client window shows it, there is no app screen. Guards: the
//! app's own context survives `make_template`, the example is stored byte
//! for byte with its pictures, and the version attach reads is `kit.version`.

use clan_sdk::{
    create, instantiate, make_template, patch_context, validate, AppHome, AppInfo, ClanBuilder,
    ClanFile, CreateOptions, FileEntry, InstantiateOptions, MakeTemplateOptions,
};
use std::fs;
use std::path::{Path, PathBuf};

const APP_ID: &str = "ie.napkin.brand";
const ICON_PATH: &str = "app/icon.svg";
const DATA_PATH: &str = "shared/data.yaml";

fn template_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("app/templates/brand-clan")
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
    let output = args.next().unwrap_or_else(|| "brand-clan.app.clan".into());
    let example_output = args
        .next()
        .unwrap_or_else(|| "brand-clan.example.clan".into());

    let schema = fs::read_to_string(dir.join("schema.json"))?;
    let context = fs::read_to_string(dir.join("context.md"))?;
    let icon = fs::read_to_string(dir.join("icon.svg"))?;
    let example = fs::read_to_string(dir.join("example/data.yaml"))?;

    let base = create(CreateOptions {
        title: "Brand Clan".into(),
        brief: "Template app: the Brand Bible of one look of one client's brand".into(),
        document_type: None,
        no_render: false,
        schema: Some(schema),
    })?;
    let clan = ClanFile::from_bytes(base)?;
    let mut builder = copy_all(&clan)?;
    builder.add_entry(ICON_PATH, icon.into_bytes());
    if clan.manifest().file_by_path(ICON_PATH).is_none() {
        builder.manifest_mut().files.push(FileEntry {
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

    let template_bytes = make_template(
        &clan,
        AppInfo {
            home: Some(AppHome {
                colour: Some("#5B5BF7".into()),
                brand: Some("Brand".into()),
                noun: vec!["Brand Clan".into(), "Brand Clans".into()],
                ..Default::default()
            }),
            name: "Brand Clan".into(),
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
    let template = ClanFile::from_bytes(template_bytes)?;
    let template_bytes = patch_context(&template, &context, false)?;
    let template = ClanFile::from_bytes(template_bytes.clone())?;

    let app_block = template.manifest().app.as_ref().expect("app block");
    assert_eq!(app_block.app_id, APP_ID, "the Brand Clan app id");
    assert!(app_block.attach.is_none(), "a Brand Clan attaches nothing");
    assert!(
        app_block.spinoff.is_none(),
        "a Brand Clan spins nothing off"
    );

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
            .contains("published"),
        "the Brand Clan rules were lost: make_template's boilerplate won"
    );

    let sample = ClanFile::from_bytes(instantiate(
        &template,
        InstantiateOptions {
            title: "Tidewell · Zero (invented)".into(),
            ..Default::default()
        },
    )?)?;
    let mut builder = copy_all(&sample)?;
    builder.add_entry(DATA_PATH, example.clone().into_bytes());
    // v1 is its own read-only snapshot, as a publish writes it.
    builder.add_entry("app/brand/versions/v1.yaml", example.clone().into_bytes());
    let mut pictures = 0;
    for entry in fs::read_dir(dir.join("example/assets"))? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".svg") {
            let path = format!("human/assets/{name}");
            assert!(
                example.contains(&path),
                "an example picture is not named in the data: {path}"
            );
            builder.add_entry(path, fs::read(entry.path())?);
            pictures += 1;
        }
    }
    assert_eq!(pictures, 6, "three logos and three imagery examples");
    let sample_bytes = builder.build()?;
    let sample = ClanFile::from_bytes(sample_bytes.clone())?;
    assert_eq!(
        sample.read_entry_string(DATA_PATH)?,
        example,
        "the example was not stored byte for byte"
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
