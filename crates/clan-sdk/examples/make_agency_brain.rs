//! Package `app/templates/agency-brain/` into the Napkin Brain template app.clan, using the SDK alone.
//!
//!     cargo run -p clan-sdk --example make_agency_brain -- [app.clan]
//!
//! Default: `agency-brain.app.clan`.
//!
//! A brain is made from this template, one per client and one for the agency, in the agency's own
//! workspace (features/napkin-brain.clan, A2). The template's page is static; a later record gives it
//! the shared Booth. Two things this packer guards:
//!
//! 1. `make_template` replaces `agent/context.md` with boilerplate, so the app's own context is
//!    reinstalled and asserted to survive into an instance.
//! 2. The data schema is the line format: a derived line holds ids, a rule and typed slots, never
//!    words from a source. The packer refuses a schema that lets a derived line carry free text.

use clan_sdk::{
    create, instantiate, make_template, pack_html, patch_context, patch_requirements, validate,
    AppHome, AppInfo, ClanBuilder, ClanFile, CreateOptions, FileEntry, InstantiateOptions,
    MakeTemplateOptions,
};
use std::fs;
use std::path::{Path, PathBuf};

const APP_ID: &str = "ie.napkin.agency-brain";
const PIPELINE_PATH: &str = "app/pipeline.yaml";
const ICON_PATH: &str = "app/icon.svg";

fn template_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("app/templates/agency-brain")
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
    let output = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "agency-brain.app.clan".to_string());

    let schema = fs::read_to_string(dir.join("schema.json"))?;
    // The page is static: no marker is spliced. A later record adds the shared Booth with its marker.
    let index_html = fs::read_to_string(dir.join("index.html"))?;
    let requirements = fs::read_to_string(dir.join("agent/requirements.yaml"))?;
    let pipeline = fs::read_to_string(dir.join("app/pipeline.yaml"))?;
    let context = fs::read_to_string(dir.join("context.md"))?;
    let icon = fs::read_to_string(dir.join("icon.svg"))?;

    // The line format is checked, not assumed: a derived line has no `text` and no free key.
    let parsed: serde_json::Value = serde_json::from_str(&schema)?;
    let derived = &parsed["definitions"]["line"]["oneOf"][0];
    assert_eq!(derived["properties"]["kind"]["const"], "derived");
    assert_eq!(
        derived["additionalProperties"],
        serde_json::json!(false),
        "a derived line may carry no key but its own"
    );
    assert!(
        derived["properties"].get("text").is_none(),
        "a derived line holds no text"
    );

    // 1. Base document, seeded with the data schema.
    let base = create(CreateOptions {
        title: "Napkin Brain".into(),
        brief: "Template app: what an agency has decided, as pages of cited lines".into(),
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
            // "Napkin Studio Brain" in the OS bar.
            home: Some(AppHome {
                colour: Some("#3F7D6B".into()),
                brand: Some("Brain".into()),
                noun: vec!["brain".into(), "brains".into()],
                untitled: Some("New brain".into()),
                ..Default::default()
            }),
            name: "Napkin Brain".into(),
            app_id: APP_ID.into(),
            version: "0.1.0".into(),
            icon: Some(ICON_PATH.into()),
            entry: "human/index.html".into(),
            schema: Some("agent/output-schema.json".into()),
            prompt_templates: vec![],
            data_seed: None,
            // A brain is made on the first ingest, never spun off from a document.
            spinoff: None,
            attach: None,
        },
        MakeTemplateOptions::default(),
    )?;

    // 6. Reinstall the app's own context: make_template replaced it.
    let template = ClanFile::from_bytes(template_bytes)?;
    let template_bytes = patch_context(&template, &context, false)?;
    let template = ClanFile::from_bytes(template_bytes.clone())?;

    // 7. Self-checks: the contracts travel into an instance, and the rules survived.
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
            .contains("Cite every line"),
        "the brain's own context was lost: make_template's boilerplate won"
    );
    let report = validate(&instance);
    if !report.is_valid() {
        eprintln!("[warn] instance validation: {report:?}");
    }

    fs::write(&output, &template_bytes)?;
    println!(
        "wrote {output} ({} bytes): context, requirements, pipeline and line schema verified",
        template_bytes.len()
    );
    println!("install: copy into the Napkin Studio app library as {APP_ID}/app.clan");
    Ok(())
}
