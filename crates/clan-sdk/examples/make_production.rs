//! Package the Production Tool's document template as the OS app
//! `ie.napkin.production`, using the SDK alone.
//!
//!     cargo run -p clan-sdk --example make_production -- [app.clan] [example.clan]
//!
//! Defaults: `production.app.clan` and `production.example.clan`.
//!
//! Production documents are not library documents: they live in the relay
//! (S3) and open at `/production`, never in the shell. The app is installed in
//! every workspace for one reason: so that Production takes part in spin-offs
//! like any other app. It declares `spinoff { accepts: [Brief Maker], upstream }`
//! (a brief is carried whole under `data.upstream.<brief id>`), and it is the
//! source app of a Production to Deck spin-off (the Deck declares that it
//! accepts it). `napkin-web` bridges the bytes to and from the relay
//! (`docs/contracts/os-layer.md` §5.9).
//!
//! The data schema, the seed and the summary view are not repeated here: they
//! are the ones `production-tool/clan-store` builds with `npm run app` (from
//! `production-tool/contracts/document.schema.json`), read out of the checked
//! in `app-template.gen.ts`, so the two cannot drift. Only the app block is
//! this packer's: another id, a name, the spin-off contract.
//!
//! The example is a tiny Brief Maker document spun off into the template: the
//! shape a Production project is born in. The Production Tool's store test
//! opens it (`production-tool/clan-store/test/spinoff.test.ts`).

use base64::Engine as _;
use clan_sdk::{
    create, make_template, spinoff, validate, AppHome, AppInfo, ClanBuilder, ClanFile,
    CreateOptions, InstantiateOptions, MakeTemplateOptions, SpinoffOptions, SpinoffSpec,
};
use std::fs;
use std::path::{Path, PathBuf};

const APP_ID: &str = "ie.napkin.production";
const BRIEF_APP_ID: &str = "ie.napkin.brief-maker";
const VERSION: &str = "1.0.0";
const DATA_PATH: &str = "shared/data.yaml";

/// The example brief. Every field of it must reach the project, whole (the spine is only the Brief node's
/// reading of it): tests/production_spinoff.rs checks each one.
const BRIEF_DATA: &str = "single_minded_proposition: Lumen is what the day starts with.
audience: Adults 25 to 40.
tone_and_world:
  - Quiet
background: Lumen Water sells bottled spring water.
objectives:
  commercial: Grow share of morning hydration by 4 points.
  behavioural: Reach for Lumen first at breakfast.
mandatories:
  - Show the glass bottle
budget_and_scope: EUR 400k, three markets.
";

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The template the Production Tool's store builds, decoded from its generated module.
fn store_template() -> Result<ClanFile, Box<dyn std::error::Error>> {
    let path = root().join("production-tool/clan-store/src/app-template.gen.ts");
    let ts = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let marker = "export const APP_TEMPLATE_BASE64 =";
    let at = ts
        .find(marker)
        .ok_or("app-template.gen.ts has no APP_TEMPLATE_BASE64")?;
    let rest = &ts[at + marker.len()..];
    let open = rest.find('\'').ok_or("APP_TEMPLATE_BASE64 is not quoted")? + 1;
    let close = open
        + rest[open..]
            .find('\'')
            .ok_or("APP_TEMPLATE_BASE64 is not closed")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(&rest[open..close])?;
    Ok(ClanFile::from_bytes(bytes)?)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let output = args
        .next()
        .unwrap_or_else(|| "production.app.clan".to_string());
    let example_output = args
        .next()
        .unwrap_or_else(|| "production.example.clan".to_string());

    // 1. The Production Tool's own document template: schema, seed, summary view.
    let base = store_template()?;
    let schema_path = base
        .manifest()
        .app
        .as_ref()
        .and_then(|a| a.schema.clone())
        .unwrap_or_else(|| "agent/output-schema.json".into());

    // 2. A fresh identity and this app's block. The human view stays the tool's
    //    summary page: a Production document opens at /production, not in the shell.
    let mut builder = ClanBuilder::new(base.manifest().clone());
    for (path, bytes) in base.read_all_entries()? {
        if path == clan_sdk::MANIFEST_PATH {
            continue;
        }
        builder.add_entry(path, bytes);
    }
    let clan = ClanFile::from_bytes(builder.build()?)?;
    let template_bytes = make_template(
        &clan,
        AppInfo {
            home: Some(AppHome {
                colour: Some("#E0556B".into()),
                brand: Some("Production".into()),
                ..Default::default()
            }),
            name: "Production".into(),
            app_id: APP_ID.into(),
            version: VERSION.into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: Some(schema_path),
            prompt_templates: vec![],
            data_seed: None,
            spinoff: Some(SpinoffSpec {
                accepts: vec![BRIEF_APP_ID.into()],
                upstream: true,
                ..Default::default()
            }),
            attach: None,
        },
        MakeTemplateOptions::default(),
    )?;
    let template = ClanFile::from_bytes(template_bytes.clone())?;

    // 3. The contract is asserted, not assumed.
    let app = template.manifest().app.as_ref().expect("app block");
    assert_eq!(app.app_id, APP_ID);
    let spin = app.spinoff.as_ref().expect("app.spinoff is declared");
    assert_eq!(spin.accepts, vec![BRIEF_APP_ID.to_string()]);
    assert!(spin.upstream, "app.spinoff.upstream must be true");
    assert!(template.has_entry("agent/output-schema.json"));

    // 4. Smoke: it instantiates, and a brief spins off into it, whole.
    clan_sdk::instantiate(
        &template,
        InstantiateOptions {
            title: "smoke".into(),
            ..Default::default()
        },
    )?;
    let example = example_spinoff(&template)?;
    let carried = example.manifest().carried().expect("lineage.carried");
    let data: serde_yaml::Value = serde_yaml::from_slice(&example.read_entry(DATA_PATH)?)?;
    assert!(
        data["upstream"][&carried.document_id]["single_minded_proposition"].is_string(),
        "the brief is carried under data.upstream.<brief id>"
    );
    for (label, file) in [("template", &template), ("example", &example)] {
        let report = validate(file);
        if !report.is_valid() {
            eprintln!("[warn] {label} validation: {report:?}");
        }
    }

    fs::write(&output, &template_bytes)?;
    fs::write(&example_output, example.raw_bytes())?;
    println!(
        "wrote {output} ({} bytes) and {example_output}",
        template_bytes.len()
    );
    println!("install: copy into the Napkin Studio app library as {APP_ID}/app.clan");
    Ok(())
}

/// A small Brief Maker document spun off into `template`, as napkin-web does it.
fn example_spinoff(template: &ClanFile) -> Result<ClanFile, Box<dyn std::error::Error>> {
    let source = create(CreateOptions {
        title: "Lumen Water brief".into(),
        brief: "A brief to carry into Production".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })?;
    let source = ClanFile::from_bytes(source)?;
    // a brief is a Brief Maker document: give it the app id the template accepts
    let mut manifest = source.manifest().clone();
    manifest.app = Some(AppInfo {
        home: None,
        name: "Brief Maker".into(),
        app_id: BRIEF_APP_ID.into(),
        version: "0.0.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach: None,
    });
    let mut b = ClanBuilder::new(manifest);
    for (path, bytes) in source.read_all_entries()? {
        if path == clan_sdk::MANIFEST_PATH || path == DATA_PATH {
            continue;
        }
        b.add_entry(path, bytes);
    }
    b.add_entry(DATA_PATH, BRIEF_DATA.as_bytes().to_vec());
    let source = ClanFile::from_bytes(b.build()?)?;
    let bytes = spinoff(
        template,
        &source,
        SpinoffOptions {
            title: "Lumen Water".into(),
            map: None,
            instance_id: None,
            source_uri: Some("clan-store:doc-lumen-brief".into()),
        },
    )?;
    Ok(ClanFile::from_bytes(bytes)?)
}
