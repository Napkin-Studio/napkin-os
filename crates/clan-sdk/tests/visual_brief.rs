// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The visual brief's spin-off (features/visual-brief.clan, `done_when` 1): the real packer's template, spun
//! off from a brief, carries the brief whole under `upstream` (so the lineage names the brief it came from and
//! the version it was at) and lifts the brief's proposition and tone into the page's own fields.

use clan_sdk::{
    create, patch_data_with, spinoff, validate, AppInfo, ClanBuilder, ClanFile, CreateOptions,
    DecisionEntry, PatchDataOptions, SpinoffOptions, SpinoffSpec, MANIFEST_PATH,
};
use serde_json::json;

const BRIEF_APP: &str = "ie.napkin.brief-maker";
const VISUAL_APP: &str = "ie.napkin.visual-brief";

fn open(bytes: Vec<u8>) -> ClanFile {
    ClanFile::from_bytes(bytes).unwrap()
}

/// The packed template, from the real packer.
fn packed() -> ClanFile {
    let out = std::env::temp_dir().join(format!("visual-brief-pack-{}", std::process::id()));
    std::fs::create_dir_all(&out).unwrap();
    let app_path = out.join("visual-brief.app.clan");
    let example_path = out.join("visual-brief.example.clan");
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let run = std::process::Command::new(cargo)
        .args([
            "run",
            "-q",
            "--locked",
            "-p",
            "clan-sdk",
            "--example",
            "make_visual_brief",
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
    let t = open(std::fs::read(&app_path).unwrap());
    let _ = std::fs::remove_dir_all(&out);
    t
}

/// A brief as the Brief Maker leaves it: its fields, and a decision on the chain for the write.
fn brief() -> ClanFile {
    let base = open(
        create(CreateOptions {
            title: "J001 brief".into(),
            brief: "a brief".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    );
    let mut m = base.manifest().clone();
    m.app = Some(AppInfo {
        home: None,
        name: "Brief Maker".into(),
        app_id: BRIEF_APP.into(),
        version: "0.2.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None::<SpinoffSpec>,
        attach: None,
    });
    let mut b = ClanBuilder::new(m);
    for (p, v) in base.read_all_entries().unwrap() {
        if p != MANIFEST_PATH {
            b.add_entry(p, v);
        }
    }
    let base = open(b.build().unwrap());
    let decision = DecisionEntry {
        agent_name: "human".into(),
        action: "seed the brief".into(),
        rationale: "the brief the planner wrote".into(),
        ..Default::default()
    };
    open(
        patch_data_with(
            &base,
            &json!({
                "single_minded_proposition": "The whiskey that waits for you.",
                "tone_and_world": ["Unhurried", "Dry", "Never nostalgic"],
                "signers": [{ "role": "creative_director", "person": "dara@wk" }],
            }),
            PatchDataOptions {
                decision: Some(decision),
                ..Default::default()
            },
            None,
        )
        .unwrap(),
    )
}

#[test]
fn a_spun_off_visual_brief_carries_the_brief_and_lifts_its_proposition_and_tone() {
    let template = packed();
    let app = template.manifest().app.as_ref().expect("app block");
    assert_eq!(app.app_id, VISUAL_APP);
    let src = brief();
    let page = open(
        spinoff(
            &template,
            &src,
            SpinoffOptions {
                title: "Visual brief, Permission to stop".into(),
                map: None,
                instance_id: None,
                source_uri: Some("clan-store:brief".into()),
            },
        )
        .unwrap(),
    );

    // The brief's proposition and tone are the page's own, lifted at spin-off.
    let data: serde_yaml::Value =
        serde_yaml::from_slice(&page.read_entry("shared/data.yaml").unwrap()).unwrap();
    assert_eq!(data["proposition"], "The whiskey that waits for you.");
    assert_eq!(
        data["tone"],
        serde_yaml::from_str::<serde_yaml::Value>("[Unhurried, Dry, Never nostalgic]").unwrap()
    );

    // The brief is carried whole and frozen, so its signers and every field are still there to read.
    let doc_id = src
        .manifest()
        .document_id
        .clone()
        .unwrap_or_else(|| src.manifest().id.clone());
    assert_eq!(
        data["upstream"][doc_id.as_str()]["signers"][0]["person"],
        "dara@wk"
    );

    // The lineage names the brief it came from and the version it was at.
    let carried = page.manifest().carried().expect("lineage.carried");
    assert_eq!(carried.document_id, doc_id);
    assert!(
        carried.last_decision.is_some(),
        "the newest brief decision, the version carried"
    );
    let lineage = page.manifest().lineage.as_ref().expect("lineage");
    assert_eq!(lineage.parent_id, src.manifest().id);
    assert_eq!(lineage.parent_uri, "clan-store:brief");
    assert!(validate(&page).is_valid(), "{}", validate(&page).display());
}
