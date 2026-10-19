//! Package `app/templates/brand/` into a Brand Clan template app.clan, and its
//! filled example (Lumen Water) into an instance, using the SDK alone.
//!
//!     cargo run -p clan-sdk --example make_brand -- [app.clan] [example.clan]
//!
//! Defaults: `brand.app.clan` and `brand.example.clan`.
//!
//! The Brand Clan is `ie.napkin.brand` (docs/contracts/brand-clan.md): one kit
//! per brand, carried frozen into every document it is attached to. The app
//! declares no `attach` (a kit attaches nothing) and no `spinoff`; the
//! documents that take it (Brief Maker, the Research Tool) declare
//! `app.attach.accepts: [ie.napkin.brand]`.
//!
//! The app makes no model call and fetches nothing, so there is no pipeline
//! task: `app/pipeline.yaml` is the declaration of that.
//!
//! Steps: base document seeded with the kit schema -> pack the view -> the
//! requirements -> the pipeline declaration, the facts member schema and the
//! two empty members (`shared/facts.yaml` role pinned-facts,
//! `shared/sources.yaml` role sources) -> make_template with the AppInfo ->
//! reinstall the app's own context. Self-checks: an instance carries every
//! member and the context; the empty kit validates; the schema enforces each
//! origin's conditional requirement; the example validates, strictly and
//! against the schema, and its hashes match its members.

use clan_sdk::hash::sha256_prefixed;
use clan_sdk::{
    create, instantiate, make_template, pack_html, patch_context, patch_requirements, validate,
    AppHome, AppInfo, ClanBuilder, ClanFile, CreateOptions, FileEntry, InstantiateOptions,
    MakeTemplateOptions,
};
use serde_yaml::{Mapping, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[path = "shared/app_ui.rs"]
mod app_ui;

const APP_ID: &str = "ie.napkin.brand";
const PIPELINE_PATH: &str = "app/pipeline.yaml";
const SCHEMA_PATH: &str = "agent/output-schema.json";
const FACTS_PATH: &str = "shared/facts.yaml";
const SOURCES_PATH: &str = "shared/sources.yaml";
const FACTS_SCHEMA_PATH: &str = "app/schemas/facts.schema.json";
const CHAIN_PATH: &str = "agent/decision-chain.yaml";
const DATA_PATH: &str = "shared/data.yaml";

/// The id every address in `example/` is written against.
const EXAMPLE_ID: &str = "b4a1c7e2-6d3f-4a58-8c1e-9f2d7a0b3c15";
/// The brand book excerpt the example's extracted items cite.
const BRAND_BOOK: &str = "mat_5b0a1e7c3d9f2a64";

enum Source {
    File(&'static str),
    Bytes(&'static [u8]),
}
/// Registered members the template adds: (id, archive path, role, source).
const MEMBERS: &[(&str, &str, &str, Source)] = &[
    (
        "pipeline-contract",
        PIPELINE_PATH,
        "pipeline-contract",
        Source::File("app/pipeline.yaml"),
    ),
    (
        "facts-schema",
        FACTS_SCHEMA_PATH,
        "member-schema",
        // The pins are the Research Tool's pins, in the same shape.
        Source::File("../campaign-research/facts.schema.json"),
    ),
    (
        "pinned-facts",
        FACTS_PATH,
        "pinned-facts",
        Source::Bytes(b"facts: []\n"),
    ),
    (
        "sources",
        SOURCES_PATH,
        "sources",
        Source::Bytes(b"sources: []\n"),
    ),
];

fn template_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("app/templates/brand")
}

fn content_type(path: &str) -> &'static str {
    match Path::new(path).extension().and_then(|e| e.to_str()) {
        Some("yaml") => "application/yaml",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        _ => "text/plain",
    }
}

fn register(builder: &mut ClanBuilder, id: &str, path: &str, role: &str, bytes: Vec<u8>) {
    builder.add_entry(path, bytes);
    let files = &mut builder.manifest_mut().files;
    if let Some(entry) = files.iter_mut().find(|f| f.path == path) {
        entry.role = role.into();
    } else {
        files.push(FileEntry {
            id: id.into(),
            path: path.into(),
            role: role.into(),
            content_type: content_type(path).into(),
            priority: None,
            sha256: None,
        });
    }
}

fn copy_all(clan: &ClanFile) -> Result<ClanBuilder, Box<dyn std::error::Error>> {
    let mut builder = ClanBuilder::new(clan.manifest().clone());
    for (path, bytes) in clan.read_all_entries()? {
        builder.add_entry(path, bytes);
    }
    Ok(builder)
}

fn role_of<'a>(clan: &'a ClanFile, path: &str) -> Option<&'a str> {
    clan.manifest().file_by_path(path).map(|f| f.role.as_str())
}

fn require_valid(label: &str, file: &ClanFile) {
    let report = validate(file);
    assert!(
        report.is_content_valid(),
        "{label} does not validate strictly: {report:?}"
    );
}

fn yaml(clan: &ClanFile, path: &str) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(serde_yaml::from_slice(&clan.read_entry(path)?)?)
}

/// Every problem `instance` (YAML, read as JSON) has against the JSON Schema
/// `clan` holds at `schema_path`.
fn schema_problems(
    clan: &ClanFile,
    schema_path: &str,
    instance: &Value,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let schema: serde_json::Value = serde_json::from_slice(&clan.read_entry(schema_path)?)?;
    let validator = jsonschema::validator_for(&schema)
        .map_err(|e| format!("{schema_path} does not compile: {e}"))?;
    let instance = serde_json::to_value(instance)?;
    Ok(validator
        .iter_errors(&instance)
        .map(|e| format!("{e} at {}", e.instance_path))
        .collect())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = template_dir();
    let mut args = std::env::args().skip(1);
    let output = args.next().unwrap_or_else(|| "brand.app.clan".to_string());
    let example_output = args
        .next()
        .unwrap_or_else(|| "brand.example.clan".to_string());

    let schema = fs::read_to_string(dir.join("schema.json"))?;
    // The agent figures and the OS's fields are inlined at build.
    let index_html = app_ui::inline_fields(
        &dir.join(".."),
        &app_ui::inline_figures(
            &dir.join(".."),
            &fs::read_to_string(dir.join("index.html"))?,
        )?,
    )?;
    let requirements = fs::read_to_string(dir.join("agent/requirements.yaml"))?;
    let context = fs::read_to_string(dir.join("context.md"))?;

    // 1. Base document, seeded with the kit schema so instances constrain agents.
    let base = create(CreateOptions {
        title: "Brand Clan".into(),
        brief: "Template app: one brand kit per brand, carried into every document".into(),
        document_type: None,
        no_render: false,
        schema: Some(schema),
    })?;
    let clan = ClanFile::from_bytes(base)?;

    // 2. The app's UI is the human view.
    let clan = ClanFile::from_bytes(pack_html(&clan, &index_html, None, None, None, None)?)?;

    // 3. Capability requirements (spec 22): none.
    let clan = ClanFile::from_bytes(patch_requirements(&clan, &requirements)?)?;

    // 4. Pipeline declaration, the pins' member schema and the two empty
    //    members, registered, and the mark the home screen shows.
    let mut builder = copy_all(&clan)?;
    for (id, path, role, source) in MEMBERS {
        let bytes = match source {
            Source::File(rel) => fs::read(dir.join(rel))?,
            Source::Bytes(b) => b.to_vec(),
        };
        register(&mut builder, id, path, role, bytes);
    }
    register(
        &mut builder,
        "app-icon",
        app_ui::ICON_PATH,
        "app-icon",
        app_ui::icon_svg(&dir)?,
    );
    let clan = ClanFile::from_bytes(builder.build()?)?;

    // 5. Stamp the app block and flip to a template.
    let template_bytes = make_template(
        &clan,
        AppInfo {
            name: "Brand Clan".into(),
            app_id: APP_ID.into(),
            version: "0.1.0".into(),
            icon: Some(app_ui::ICON_PATH.into()),
            entry: "human/index.html".into(),
            schema: Some(SCHEMA_PATH.into()),
            prompt_templates: vec![],
            data_seed: None,
            // A kit attaches nothing and is spun off from nothing: other
            // apps declare `attach.accepts: [ie.napkin.brand]`.
            attach: None,
            spinoff: None,
            home: Some(AppHome {
                colour: Some("#2F7D6D".into()),
                job: Some("Keep a brand".into()),
                line: Some(
                    "One kit per brand: its identity, colours, type, voice and rules, and the work the client approved. Every brief and project can carry it.".into(),
                ),
                start: Some("Start a brand clan".into()),
                // Ellis reads the brand book into the kit.
                crew: vec!["extract".into()],
                noun: vec!["brand clan".into(), "brand clans".into()],
                untitled: Some("Untitled Brand Clan".into()),
                brand: Some("Brand Clan".into()),
                ..Default::default()
            }),
        },
        MakeTemplateOptions::default(),
    )?;

    // 6. Reinstall the app's own context — make_template replaced it.
    let template = ClanFile::from_bytes(template_bytes)?;
    let template_bytes = patch_context(&template, &context, false)?;
    let template = ClanFile::from_bytes(template_bytes.clone())?;

    // 7. Self-check: a fresh instance carries every contract and both members,
    //    empty and under their roles, and the app's context.
    let instance = ClanFile::from_bytes(instantiate(
        &template,
        InstantiateOptions {
            title: "smoke-instance".into(),
            ..Default::default()
        },
    )?)?;
    for (_, path, role, source) in MEMBERS {
        assert_eq!(
            role_of(&instance, path),
            Some(*role),
            "{path} did not travel into the instance as role {role}"
        );
        if let Source::Bytes(b) = source {
            assert_eq!(instance.read_entry(path)?, *b, "{path} is not empty");
        }
    }
    assert!(instance.has_entry("agent/requirements.yaml"));
    assert!(
        instance
            .read_entry_string("agent/context.md")?
            .contains("You never invent a fact."),
        "the app's context was lost — make_template's boilerplate won"
    );
    require_valid("template", &template);
    require_valid("instance", &instance);

    // 8. Self-check: the schema.
    check_schema(&template)?;

    // 9. The example instance, under the id its addresses use.
    let example_bytes = build_example(&template, &dir.join("example"))?;

    fs::write(&output, &template_bytes)?;
    fs::write(&example_output, &example_bytes)?;
    println!(
        "wrote {output} ({} bytes) — context, requirements, pipeline and the facts/sources \
         members verified in an instance; the schema's origin rules enforced",
        template_bytes.len()
    );
    println!(
        "wrote {example_output} ({} bytes) — Lumen Water, id {EXAMPLE_ID}",
        example_bytes.len()
    );
    println!("install: copy into the Napkin Studio app library as {APP_ID}/app.clan");
    Ok(())
}

/// The kit schema accepts the empty kit and holds each origin to what it must
/// carry; a rule never blocks; maps are maps.
fn check_schema(template: &ClanFile) -> Result<(), Box<dyn std::error::Error>> {
    let ok = |label: &str, y: &str| -> Result<(), Box<dyn std::error::Error>> {
        let problems = schema_problems(template, SCHEMA_PATH, &serde_yaml::from_str(y)?)?;
        assert!(problems.is_empty(), "{label} must validate: {problems:#?}");
        Ok(())
    };
    let bad = |label: &str, y: &str| -> Result<(), Box<dyn std::error::Error>> {
        let problems = schema_problems(template, SCHEMA_PATH, &serde_yaml::from_str(y)?)?;
        assert!(!problems.is_empty(), "{label} must be rejected");
        Ok(())
    };
    let empty = "brand: { ref: brand/lumen-water, name: { value: Lumen Water, origin: stated, by: 'human:u_a' } }";
    ok("the empty kit", empty)?;
    ok("a kit with nothing in it yet", "{}")?;
    // Each origin's conditional requirement, in an item and in an envelope.
    let rule = |origin: &str| {
        format!(
            "{empty}\nrules:\n  r1:\n    kind: do\n    area: logo\n    text: Keep it clear.\n    severity: warn\n    {origin}\n"
        )
    };
    ok(
        "a stated item with by",
        &rule("origin: stated\n    by: 'human:u_a'"),
    )?;
    ok(
        "a confirmed item with by",
        &rule("origin: confirmed\n    by: 'human:u_a'"),
    )?;
    ok(
        "an extracted item with a source",
        &rule("origin: extracted\n    source: { material_id: mat_0123456789abcdef, locator: p.1 }"),
    )?;
    ok(
        "a proposed item with fact ids",
        &rule("origin: proposed\n    fact_ids: [f_01JB0B1C2D]"),
    )?;
    bad(
        "an extracted item with no source",
        &rule("origin: extracted"),
    )?;
    bad(
        "a proposed item with no fact_ids",
        &rule("origin: proposed"),
    )?;
    bad(
        "a proposed item with an empty fact_ids",
        &rule("origin: proposed\n    fact_ids: []"),
    )?;
    bad("a stated item with no by", &rule("origin: stated"))?;
    bad("a confirmed item with no by", &rule("origin: confirmed"))?;
    bad("an item with no origin", &rule("decision: d_01JB0D01SEED"))?;
    bad(
        "an envelope that is proposed with no fact_ids",
        "brand: { ref: brand/lumen-water, name: { value: Lumen Water, origin: proposed } }",
    )?;
    bad(
        "an extracted envelope with no source",
        "brand: { ref: brand/lumen-water, name: { value: Lumen Water, origin: extracted } }",
    )?;
    // A rule never blocks.
    bad(
        "a rule that blocks",
        &format!(
            "{empty}\nrules:\n  r1: {{ kind: do, area: logo, text: x, severity: block, origin: stated, by: 'human:u_a' }}\n"
        ),
    )?;
    // Maps are keyed by id, never positional.
    bad(
        "rules as a positional array",
        &format!("{empty}\nrules: [ {{ kind: do, area: logo, text: x, severity: warn, origin: stated, by: 'human:u_a' }} ]\n"),
    )?;
    // A colour is a hex.
    bad(
        "a colour that is not a hex",
        &format!("{empty}\nvisual:\n  colours:\n    c1: {{ name: Blue, hex: blue, role: primary, origin: stated, by: 'human:u_a' }}\n"),
    )?;
    Ok(())
}

/// Instantiate the template as the example document and lay `example/` over
/// it: the members verbatim, the projection built from them, and the brand
/// book's hash.
fn build_example(
    template: &ClanFile,
    example: &Path,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let instance = ClanFile::from_bytes(instantiate(
        template,
        InstantiateOptions {
            title: "Lumen Water — EXAMPLE".into(),
            instance_id: Some(EXAMPLE_ID.into()),
            ..Default::default()
        },
    )?)?;

    let facts = fs::read(example.join(FACTS_PATH))?;
    let sources = fs::read(example.join(SOURCES_PATH))?;
    let chain = fs::read(example.join(CHAIN_PATH))?;
    let book = fs::read(example.join("assets/brand-book-excerpt.txt"))?;
    let mark = fs::read(example.join("assets/lumen-mark.svg"))?;
    let font = fs::read(example.join("assets/lumen-display.woff2"))?;

    // The data: the file as written, plus what the host would write.
    let mut data: Value = serde_yaml::from_slice(&fs::read(example.join(DATA_PATH))?)?;
    data["materials"][BRAND_BOOK]["sha256"] = Value::String(
        sha256_prefixed(&book)
            .trim_start_matches("sha256:")
            .to_string(),
    );
    data["projection"] = projection(&facts, &sources)?;
    let data_bytes = serde_yaml::to_string(&data)?.into_bytes();

    let mut builder = copy_all(&instance)?;
    builder.add_entry(DATA_PATH, data_bytes.clone());
    builder.add_entry(FACTS_PATH, facts.clone());
    builder.add_entry(SOURCES_PATH, sources.clone());
    builder.add_entry(CHAIN_PATH, chain.clone());
    for (name, bytes) in [
        ("brand-book-excerpt.txt", &book),
        ("lumen-mark.svg", &mark),
        ("lumen-display.woff2", &font),
    ] {
        register(
            &mut builder,
            &format!("human-assets-{name}"),
            &format!("human/assets/{name}"),
            "human-asset",
            bytes.clone(),
        );
    }
    // The upload path caches the extracted text as a sidecar.
    register(
        &mut builder,
        "human-assets-.extracted-brand-book-excerpt.txt.txt",
        "human/assets/.extracted/brand-book-excerpt.txt.txt",
        "human-asset",
        book.clone(),
    );
    let m = builder.manifest_mut();
    m.created_at = "2026-09-02T09:00:00Z".into();
    m.updated_at = "2026-10-12T10:14:00Z".into();
    let bytes = builder.build()?;
    let clan = ClanFile::from_bytes(bytes.clone())?;

    // Self-check: id, verbatim members, the hashes the data claims, and that
    // every address and reference in the data resolves.
    assert_eq!(clan.manifest().id, EXAMPLE_ID);
    for (path, want) in [
        (FACTS_PATH, &facts),
        (SOURCES_PATH, &sources),
        (CHAIN_PATH, &chain),
    ] {
        assert_eq!(
            &clan.read_entry(path)?,
            want,
            "{path} was not packed verbatim"
        );
    }
    assert_eq!(role_of(&clan, FACTS_PATH), Some("pinned-facts"));
    assert_eq!(role_of(&clan, SOURCES_PATH), Some("sources"));
    let parsed = yaml(&clan, DATA_PATH)?;
    let built_from = &parsed["projection"]["built_from"];
    assert_eq!(
        built_from["facts_sha256"].as_str(),
        Some(sha256_prefixed(&facts).as_str())
    );
    assert_eq!(
        built_from["sources_sha256"].as_str(),
        Some(sha256_prefixed(&sources).as_str())
    );
    assert_eq!(
        parsed["materials"][BRAND_BOOK]["sha256"].as_str(),
        Some(sha256::hex(&book).as_str()),
        "materials.{BRAND_BOOK}.sha256 does not match the attachment"
    );
    assert_eq!(parsed["kit"]["version"].as_u64(), Some(5));

    // The example is a believable kit: what the brief asks for is all there.
    let pins = parsed["projection"]["pins"]
        .as_mapping()
        .ok_or("projection.pins")?;
    assert_eq!(pins.len(), 2, "two roster pins");
    let text = String::from_utf8(chain.clone())?;
    let chain_ids: Vec<&str> = text
        .lines()
        .filter_map(|l| l.trim_start().strip_prefix("- id: "))
        .collect();
    let mut cited = Vec::new();
    collect_refs(&parsed, &mut cited);
    for id in &cited {
        if id.starts_with("d_01JB0D") {
            assert!(chain_ids.contains(&id.as_str()), "{id} is not in the chain");
        }
        if id.starts_with("f_") {
            assert!(
                pins.contains_key(Value::String(id.clone())),
                "{id} is not a pin"
            );
        }
    }
    let colours = parsed["visual"]["colours"].as_mapping().ok_or("colours")?;
    assert!(colours.len() >= 3, "a few colours");
    let fonts = parsed["visual"]["typography"].as_mapping().ok_or("type")?;
    assert_eq!(fonts.len(), 2, "two fonts");
    assert_eq!(
        fonts.values().filter(|f| f.get("file").is_none()).count(),
        1,
        "exactly one font has no file"
    );
    for (_, f) in fonts {
        if let Some(file) = f.get("file").and_then(Value::as_str) {
            assert!(
                clan.has_entry(&format!("human/{file}")),
                "{file} is not in the archive"
            );
        }
    }
    for (_, l) in parsed["visual"]["logos"].as_mapping().ok_or("logos")? {
        for (_, v) in l["variants"].as_mapping().ok_or("variants")? {
            let a = v["asset"].as_str().ok_or("asset")?;
            assert!(clan.has_entry(&format!("human/{a}")), "{a} is missing");
        }
    }

    let problems = schema_problems(&clan, SCHEMA_PATH, &parsed)?;
    assert!(
        problems.is_empty(),
        "the example against the kit schema: {problems:#?}"
    );
    require_valid("example", &clan);
    Ok(bytes)
}

/// Every `d_…` decision id and `f_…` fact id the data names, wherever it does.
fn collect_refs(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) if s.starts_with("d_") || s.starts_with("f_") => out.push(s.clone()),
        Value::Sequence(s) => s.iter().for_each(|x| collect_refs(x, out)),
        Value::Mapping(m) => m
            .iter()
            .filter(|(k, _)| k.as_str() != Some("projection"))
            .for_each(|(_, x)| collect_refs(x, out)),
        _ => {}
    }
}

/// The host's projection of the members (os-layer section 5): a scalar copy of
/// each pin and each source, and the hashes it was built from.
fn projection(facts: &[u8], sources: &[u8]) -> Result<Value, Box<dyn std::error::Error>> {
    let facts_doc: Value = serde_yaml::from_slice(facts)?;
    let sources_doc: Value = serde_yaml::from_slice(sources)?;
    let mut pins = Mapping::new();
    for f in facts_doc["facts"].as_sequence().ok_or("facts list")? {
        let mut p = Mapping::new();
        for key in [
            "layer",
            "entity",
            "key",
            "value",
            "unit",
            "as_of",
            "confidence",
            "licence",
            "method",
            "retrieved_at",
            "sources",
            "version",
            "status",
            "pin_reason",
        ] {
            if let Some(v) = f.get(key) {
                p.insert(key.into(), v.clone());
            }
        }
        p.insert("stale".into(), Value::Bool(false));
        pins.insert(f["id"].clone(), Value::Mapping(p));
    }
    let mut srcs = Mapping::new();
    for s in sources_doc["sources"].as_sequence().ok_or("sources list")? {
        let mut m = s.as_mapping().ok_or("a source")?.clone();
        let id = m.remove("id").ok_or("a source id")?;
        srcs.insert(id, Value::Mapping(m));
    }
    let mut built_from = Mapping::new();
    built_from.insert("facts_sha256".into(), sha256_prefixed(facts).into());
    built_from.insert("sources_sha256".into(), sha256_prefixed(sources).into());
    built_from.insert("built_at".into(), "2026-10-12T10:14:00Z".into());
    let mut out = Mapping::new();
    out.insert("built_from".into(), Value::Mapping(built_from));
    out.insert("pins".into(), Value::Mapping(pins));
    out.insert("sources".into(), Value::Mapping(srcs));
    Ok(Value::Mapping(out))
}

/// The hex of a SHA-256, without the `sha256:` prefix the SDK writes.
mod sha256 {
    pub fn hex(bytes: &[u8]) -> String {
        clan_sdk::hash::sha256_prefixed(bytes)
            .trim_start_matches("sha256:")
            .to_string()
    }
}
