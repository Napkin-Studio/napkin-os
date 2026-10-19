//! Package `app/templates/deck-maker/` into the Deck Maker template app.clan,
//! and its recorded sample run into an instance, using the SDK alone.
//!
//!     cargo run -p clan-sdk --example make_deck_maker -- [app.clan] [example.clan]
//!
//! Defaults: `deck-maker.app.clan` and `deck-maker.example.clan`.
//!
//! Same shape as `make_advertising_studio`, plus a spin-off contract: a deck
//! is started from the app's own Start screen (a prompt of any length and any
//! documents), or spun off from a Brief Maker or Research Tool document, whose
//! data is carried whole under `data.upstream` (ADR 0023, 0028). The contract
//! takes no map and no lift: the deck's fields are never seeded from upstream. Two things this packer guards:
//!
//! 1. `make_template` replaces `agent/context.md` with boilerplate, so the
//!    app's own context (the input rule, placeholders, gates) is reinstalled
//!    and asserted to survive into an instance.
//! 2. The sample run's data is written as the example instance's
//!    `shared/data.yaml`, byte for byte.

use clan_sdk::{
    create, instantiate, make_template, pack_html, patch_context, patch_requirements, validate,
    AppInfo, ClanBuilder, ClanFile, CreateOptions, FileEntry, InstantiateOptions,
    MakeTemplateOptions, SpinoffSpec,
};
use std::fs;
use std::path::{Path, PathBuf};

const APP_ID: &str = "ie.napkin.deck-maker";
/// The apps a deck is spun off from, whole, under `upstream`.
const BRIEF_APP_ID: &str = "ie.napkin.brief-maker";
const RESEARCH_APP_ID: &str = "ie.napkin.campaign-research";
const PIPELINE_PATH: &str = "app/pipeline.yaml";
const ICON_PATH: &str = "app/icon.svg";
const DATA_PATH: &str = "shared/data.yaml";

fn template_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("app/templates/deck-maker")
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
        .unwrap_or_else(|| "deck-maker.app.clan".to_string());
    let example_output = args
        .next()
        .unwrap_or_else(|| "deck-maker.example.clan".to_string());

    let schema = fs::read_to_string(dir.join("schema.json"))?;
    let index_html = fs::read_to_string(dir.join("index.html"))?;
    let requirements = fs::read_to_string(dir.join("agent/requirements.yaml"))?;
    let pipeline = fs::read_to_string(dir.join("app/pipeline.yaml"))?;
    let context = fs::read_to_string(dir.join("context.md"))?;
    let icon = fs::read_to_string(dir.join("icon.svg"))?;
    let example = fs::read_to_string(dir.join("example/data.yaml"))?;

    // 1. Base document, seeded with the run schema.
    let base = create(CreateOptions {
        title: "Deck Maker".into(),
        brief: "Template app: a pitch deck from a prompt, research and a brief".into(),
        document_type: None,
        no_render: false,
        schema: Some(schema),
    })?;
    let clan = ClanFile::from_bytes(base)?;

    // 2. The app's UI is the human view.
    let clan = ClanFile::from_bytes(pack_html(&clan, &index_html, None, None, None, None)?)?;

    // 3. Capability requirements (spec §28).
    let clan = ClanFile::from_bytes(patch_requirements(&clan, &requirements)?)?;

    // 4. Pipeline contract and the mark, as registered members.
    let mut builder = copy_all(&clan)?;
    for (id, path, role, ctype, bytes) in [
        (
            "pipeline-contract",
            PIPELINE_PATH,
            "pipeline-contract",
            "application/yaml",
            pipeline.into_bytes(),
        ),
        (
            "app-icon",
            ICON_PATH,
            "app-icon",
            "image/svg+xml",
            icon.into_bytes(),
        ),
    ] {
        builder.add_entry(path, bytes);
        if clan.manifest().file_by_path(path).is_none() {
            builder.manifest_mut().files.push(FileEntry {
                id: id.into(),
                path: path.into(),
                role: role.into(),
                content_type: ctype.into(),
                priority: None,
                sha256: None,
            });
        }
    }
    let clan = ClanFile::from_bytes(builder.build()?)?;

    // 5. Stamp the app block and flip to template.
    let template_bytes = make_template(
        &clan,
        AppInfo {
            home: None,
            name: "Deck Maker".into(),
            app_id: APP_ID.into(),
            version: "0.2.0".into(),
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
        },
        MakeTemplateOptions::default(),
    )?;

    // 6. Reinstall the app's own context: make_template replaced it.
    let template = ClanFile::from_bytes(template_bytes)?;
    let template_bytes = patch_context(&template, &context, false)?;
    let template = ClanFile::from_bytes(template_bytes.clone())?;

    // The spin-off contract and version are asserted, not assumed: a regression
    // here must fail the packer (and the spinoff.rs test that runs it).
    let app_block = template.manifest().app.as_ref().expect("app block");
    assert_eq!(app_block.version, "0.2.0", "the Deck template version");
    let spin = app_block.spinoff.as_ref().expect("app.spinoff is declared");
    assert_eq!(
        spin.accepts,
        vec![BRIEF_APP_ID.to_string(), RESEARCH_APP_ID.to_string()],
        "the Deck accepts the Brief Maker and the Research Tool"
    );
    assert!(spin.upstream, "app.spinoff.upstream must be true");

    // 7. Self-checks: the contracts travel into an instance, and the input rule survived.
    let instance = ClanFile::from_bytes(instantiate(
        &template,
        InstantiateOptions {
            title: "smoke-instance".into(),
            ..Default::default()
        },
    )?)?;
    for path in ["agent/requirements.yaml", PIPELINE_PATH, "agent/context.md"] {
        assert!(
            instance.has_entry(path),
            "{path} did not travel into the instance"
        );
    }
    assert!(
        instance
            .read_entry_string("agent/context.md")?
            .contains("ADR 0023"),
        "the deck input rule was lost: make_template's boilerplate won"
    );

    // 8. The example instance: the sample run as the document's data.
    let sample = ClanFile::from_bytes(instantiate(
        &template,
        InstantiateOptions {
            title: "Lumen Water · First Light (sample)".into(),
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
        "wrote {output} ({} bytes) and {example_output}: context, requirements, pipeline and sample verified",
        template_bytes.len()
    );
    println!("install: copy into the Napkin Studio app library as {APP_ID}/app.clan");
    Ok(())
}
