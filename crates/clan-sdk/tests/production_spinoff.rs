//! The Production app (`examples/make_production.rs`): its spin-off contract, packed and run through
//! `cargo run` as CI does, so a regression in the packer is caught here (features/production-spinoff.clan).

use clan_sdk::ClanFile;

#[test]
fn the_packed_production_app_takes_a_brief_whole_and_its_example_carries_one() {
    let out = std::env::temp_dir().join(format!("production-pack-{}", std::process::id()));
    std::fs::create_dir_all(&out).unwrap();
    let app_path = out.join("production.app.clan");
    let example_path = out.join("production.example.clan");
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let run = std::process::Command::new(cargo)
        .args([
            "run",
            "-q",
            "--locked",
            "-p",
            "clan-sdk",
            "--example",
            "make_production",
            "--",
        ])
        .arg(&app_path)
        .arg(&example_path)
        .output()
        .unwrap();
    assert!(
        run.status.success(),
        "packer failed: {}",
        String::from_utf8_lossy(&run.stderr)
    );
    let app = ClanFile::from_bytes(std::fs::read(&app_path).unwrap()).unwrap();
    let example = ClanFile::from_bytes(std::fs::read(&example_path).unwrap()).unwrap();
    let _ = std::fs::remove_dir_all(&out);

    let block = app.manifest().app.as_ref().expect("app block");
    assert_eq!(block.app_id, "ie.napkin.production");
    let spin = block.spinoff.as_ref().expect("app.spinoff");
    assert_eq!(
        spin.accepts,
        vec![
            "ie.napkin.brief-maker".to_string(),
            "ie.napkin.campaign-research".to_string(),
            "ie.napkin.territories".to_string()
        ]
    );
    assert!(spin.upstream);
    // the tool's own document schema travels, so every write to a project is checked against it
    assert!(app.has_entry("agent/output-schema.json"));

    // a brief spun off into it: carried whole, nothing else in the data
    let carried = example.manifest().carried().expect("lineage.carried");
    let data: serde_yaml::Value =
        serde_yaml::from_slice(&example.read_entry("shared/data.yaml").unwrap()).unwrap();
    let keys: Vec<_> = data.as_mapping().unwrap().keys().collect();
    assert_eq!(keys, vec!["upstream"]);
    assert!(data["upstream"][&carried.document_id]["single_minded_proposition"].is_string());

    // Owner 2026-11-23: a spin-off carries everything but the heavy media. The Production project holds
    // the WHOLE brief (every field, objectives included), not the spine its Brief node reads.
    let brief = &data["upstream"][&carried.document_id];
    for key in [
        "single_minded_proposition",
        "audience",
        "tone_and_world",
        "background",
        "objectives",
        "mandatories",
        "budget_and_scope",
    ] {
        assert!(!brief[key].is_null(), "the carried brief lost {key}");
    }
    assert_eq!(
        brief["objectives"]["behavioural"],
        "Reach for Lumen first at breakfast."
    );
}
