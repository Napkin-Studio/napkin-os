// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Script editor's packer and spin-offs (features/script-editor.clan, `done_when` 1 and 11): the real
//! packer's template validates, a brief that has passed the gate spins off into it carrying the brief whole
//! and lifting the proposition, and a TV script sent to Film spins off into Advertising Studio (`ie.napkin.film`)
//! with every beat under the same id, as a script revision that template's own schema accepts.

use clan_sdk::{
    create, patch_data_with, spinoff, validate, AppInfo, ClanBuilder, ClanFile, CreateOptions,
    DecisionEntry, PatchDataOptions, SpinoffOptions, SpinoffSpec, MANIFEST_PATH,
};
use serde_json::{json, Value};

const BRIEF_APP: &str = "ie.napkin.brief-maker";
const SCRIPT_APP: &str = "ie.napkin.script-editor";
const FILM_APP: &str = "ie.napkin.film";

fn open(bytes: Vec<u8>) -> ClanFile {
    ClanFile::from_bytes(bytes).unwrap()
}

/// A template, from its real packer.
fn packed(example: &str, app: &str) -> ClanFile {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let out = std::env::temp_dir().join(format!("{example}-pack-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&out).unwrap();
    let app_path = out.join(format!("{app}.app.clan"));
    let example_path = out.join(format!("{app}.example.clan"));
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let run = std::process::Command::new(cargo)
        .args([
            "run",
            "-q",
            "--locked",
            "-p",
            "clan-sdk",
            "--example",
            example,
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

fn with_app(name: &str, app_id: &str, spin: Option<SpinoffSpec>) -> ClanFile {
    let base = open(
        create(CreateOptions {
            title: name.into(),
            brief: name.into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    );
    let mut m = base.manifest().clone();
    m.app = Some(AppInfo {
        home: None,
        name: name.into(),
        app_id: app_id.into(),
        version: "0.1.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: spin,
        attach: None,
    });
    let mut b = ClanBuilder::new(m);
    for (p, v) in base.read_all_entries().unwrap() {
        if p != MANIFEST_PATH {
            b.add_entry(p, v);
        }
    }
    open(b.build().unwrap())
}

fn seed(file: &ClanFile, patch: Value) -> ClanFile {
    open(
        patch_data_with(
            file,
            &patch,
            PatchDataOptions {
                decision: Some(DecisionEntry {
                    agent_name: "human".into(),
                    action: "seed".into(),
                    rationale: "test seed".into(),
                    ..Default::default()
                }),
                ..Default::default()
            },
            None,
        )
        .unwrap(),
    )
}

/// A brief as the Brief Maker leaves it: the proposition, the mandatories and the people who sign.
fn brief() -> ClanFile {
    seed(
        &with_app("J001 brief", BRIEF_APP, None),
        json!({
            "single_minded_proposition": "The whiskey that waits for you.",
            "mandatories": ["Drink responsibly line", "Age 18 plus only"],
            "signers": [{ "role": "creative_director", "person": "dara@wk" }],
        }),
    )
}

fn data_of(f: &ClanFile) -> Value {
    serde_json::to_value(
        serde_yaml::from_slice::<serde_yaml::Value>(&f.read_entry("shared/data.yaml").unwrap())
            .unwrap(),
    )
    .unwrap()
}

#[test]
fn the_template_packs_validates_and_a_gated_brief_spins_off_into_it() {
    let template = packed("make_script_editor", "script-editor");
    let app = template.manifest().app.as_ref().expect("app block");
    assert_eq!(app.app_id, SCRIPT_APP);
    assert!(
        validate(&template).is_valid(),
        "{}",
        validate(&template).display()
    );

    let src = brief();
    let page = open(
        spinoff(
            &template,
            &src,
            SpinoffOptions {
                title: "Script, Client A".into(),
                map: None,
                instance_id: None,
                source_uri: Some("clan-store:brief".into()),
            },
        )
        .unwrap(),
    );
    let data = data_of(&page);
    assert_eq!(data["proposition"], "The whiskey that waits for you.");
    // The brief is carried whole and frozen: its mandatories (the live check reads them here) and its signers.
    let doc_id = src
        .manifest()
        .document_id
        .clone()
        .unwrap_or_else(|| src.manifest().id.clone());
    let carried = &data["upstream"][doc_id.as_str()];
    assert_eq!(carried["mandatories"][1], "Age 18 plus only");
    assert_eq!(carried["signers"][0]["person"], "dara@wk");
    let lineage = page.manifest().lineage.as_ref().expect("lineage");
    assert_eq!(lineage.parent_id, src.manifest().id);
    assert!(validate(&page).is_valid(), "{}", validate(&page).display());
}

#[test]
fn the_sample_validates_against_the_scripts_own_schema() {
    let template = packed("make_script_editor", "script-editor");
    let sample = open(
        clan_sdk::instantiate(
            &template,
            clan_sdk::InstantiateOptions {
                title: "sample".into(),
                ..Default::default()
            },
        )
        .unwrap(),
    );
    let example = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../app/templates/script-editor/example/data.yaml"),
    )
    .unwrap();
    let doc = open(
        {
            let mut b = ClanBuilder::new(sample.manifest().clone());
            for (p, v) in sample.read_all_entries().unwrap() {
                if p != "shared/data.yaml" {
                    b.add_entry(p, v);
                }
            }
            b.add_entry("shared/data.yaml", example.into_bytes());
            b
        }
        .build()
        .unwrap(),
    );
    assert!(validate(&doc).is_valid(), "{}", validate(&doc).display());
}

/// What the Script editor writes when a TV script is sent to Film (app/templates/script-editor/index.html,
/// `filmScript`): the page's own function is tested in app/tests/scriptEditor.test.ts; this is its shape.
fn tv_script() -> Value {
    json!({
        "format": "tv",
        "slot_s": 30,
        "script": { "beats": [
            { "id": "b1", "kind": "voice", "role": "VO", "text": "Take your time.", "visual_action": "A bar after closing. One glass." },
            { "id": "b2", "kind": "music", "text": "Slow strings", "visual_action": "The door swings shut." },
            { "id": "b4", "kind": "voice", "role": "FVO", "text": "Client A waits.", "visual_action": "The bottle, label forward." },
        ], "proposals": [], "seq": 4 },
        "handoffs": { "film": { "kind": "script", "id": "script", "revision": "1", "content_hash": "ab12" } },
        "film": { "script": {
            "current": "r1",
            "revisions": [{
                "id": "r1", "created_by": "human:sam@wk", "created_at": "2026-11-12T10:00:00Z", "status": "draft",
                "source": { "kind": "script", "version": "1", "content_hash": "ab12" },
                "beats": [
                    { "id": "b1", "visual_action": "A bar after closing. One glass.", "voiceover": "Take your time.", "speaker": "VO", "duration_s": 0.8 },
                    { "id": "b2", "visual_action": "The door swings shut.", "sound_intention": "Slow strings", "cue": "music" },
                    { "id": "b4", "visual_action": "The bottle, label forward.", "voiceover": "Client A waits.", "speaker": "FVO", "duration_s": 0.8 },
                ],
            }],
        } },
    })
}

#[test]
fn a_tv_script_sent_to_film_opens_there_with_the_same_beat_ids_and_validates() {
    let script_t = packed("make_script_editor", "script-editor");
    let film_t = packed("make_advertising_studio", "advertising-studio");
    let src = seed(
        &open(
            spinoff(
                &script_t,
                &brief(),
                SpinoffOptions {
                    title: "Script, Client A".into(),
                    map: None,
                    instance_id: None,
                    source_uri: Some("clan-store:brief".into()),
                },
            )
            .unwrap(),
        ),
        tv_script(),
    );
    let film = open(
        spinoff(
            &film_t,
            &src,
            SpinoffOptions {
                title: "Film, Client A".into(),
                map: None,
                instance_id: None,
                source_uri: Some("clan-store:script".into()),
            },
        )
        .unwrap(),
    );
    assert_eq!(film.manifest().app.as_ref().unwrap().app_id, FILM_APP);
    let data = data_of(&film);

    // The first script revision holds the same beat ids, in order, with the picture and the words.
    let rev = &data["script"]["revisions"][0];
    let ids: Vec<&str> = rev["beats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        ["b1", "b2", "b4"],
        "the beats keep their ids, a removed number stays gone"
    );
    assert_eq!(data["script"]["current"], "r1");
    assert_eq!(
        rev["beats"][0]["visual_action"],
        "A bar after closing. One glass."
    );
    assert_eq!(rev["beats"][1]["sound_intention"], "Slow strings");
    // The script itself travels whole and read-only under upstream.
    let doc_id = src
        .manifest()
        .document_id
        .clone()
        .unwrap_or_else(|| src.manifest().id.clone());
    assert_eq!(
        data["upstream"][doc_id.as_str()]["script"]["beats"][2]["id"],
        "b4"
    );

    // Advertising Studio's own schema holds the result.
    assert!(validate(&film).is_valid(), "{}", validate(&film).display());
    let schema: Value =
        serde_json::from_str(&film.read_entry_string("agent/output-schema.json").unwrap()).unwrap();
    let revisions = &schema["properties"]["script"]["properties"]["revisions"]["items"];
    for k in revisions["required"].as_array().unwrap() {
        assert!(
            rev.get(k.as_str().unwrap()).is_some(),
            "a revision needs {k}"
        );
    }
    let beat_required = revisions["properties"]["beats"]["items"]["required"]
        .as_array()
        .unwrap();
    for b in rev["beats"].as_array().unwrap() {
        for k in beat_required {
            assert!(b.get(k.as_str().unwrap()).is_some(), "a beat needs {k}");
        }
    }
}
