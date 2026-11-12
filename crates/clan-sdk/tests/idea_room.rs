// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Idea room's template (features/idea-room.clan): the real packer's template, spun off from a brief,
//! carries the brief whole under `upstream` (so the lineage names the brief it came from and the version it
//! was at), packs and validates; and three route branches merge with one planted clash.

use clan_sdk::{
    create, fork, merge, patch_data_namespaced, patch_data_with, spinoff, validate, AppInfo,
    ClanBuilder, ClanFile, CreateOptions, DecisionEntry, MergeOptions, PatchDataOptions,
    SpinoffOptions, SpinoffSpec, MANIFEST_PATH,
};
use serde_json::json;

const BRIEF_APP: &str = "ie.napkin.brief-maker";
const IDEA_APP: &str = "ie.napkin.idea-room";

fn open(bytes: Vec<u8>) -> ClanFile {
    ClanFile::from_bytes(bytes).unwrap()
}

/// The packed template, from the real packer.
fn packed() -> ClanFile {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let out = std::env::temp_dir().join(format!("idea-room-pack-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&out).unwrap();
    let app_path = out.join("idea-room.app.clan");
    let example_path = out.join("idea-room.example.clan");
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let run = std::process::Command::new(cargo)
        .args([
            "run",
            "-q",
            "--locked",
            "-p",
            "clan-sdk",
            "--example",
            "make_idea_room",
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
                "single_minded_proposition": "The easy way into Irish whiskey.",
                "insight": "Younger drinkers think Irish whiskey is for someone else.",
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
fn a_spun_off_idea_room_carries_the_brief_and_validates() {
    let template = packed();
    let app = template.manifest().app.as_ref().expect("app block");
    assert_eq!(app.app_id, IDEA_APP);
    let spin = app.spinoff.as_ref().expect("spinoff");
    assert_eq!(
        spin.accepts,
        vec![BRIEF_APP.to_string()],
        "from a brief and from no other"
    );
    assert!(spin.upstream);
    // The humans-first number is declared in the template's own pipeline, for the host to read.
    let pipeline = template.read_entry_string("app/pipeline.yaml").unwrap();
    assert!(pipeline.contains("humans_first") && pipeline.contains("cards: 5"));

    let src = brief();
    let room = open(
        spinoff(
            &template,
            &src,
            SpinoffOptions {
                title: "Idea room, Client A".into(),
                map: None,
                instance_id: None,
                source_uri: Some("clan-store:brief".into()),
            },
        )
        .unwrap(),
    );
    let data: serde_yaml::Value =
        serde_yaml::from_slice(&room.read_entry("shared/data.yaml").unwrap()).unwrap();
    let doc_id = src
        .manifest()
        .document_id
        .clone()
        .unwrap_or_else(|| src.manifest().id.clone());
    let up = &data["upstream"][doc_id.as_str()];
    assert_eq!(
        up["insight"],
        "Younger drinkers think Irish whiskey is for someone else."
    );
    assert_eq!(
        up["single_minded_proposition"],
        "The easy way into Irish whiskey."
    );
    assert_eq!(up["signers"][0]["person"], "dara@wk");
    let carried = room.manifest().carried().expect("lineage.carried");
    assert_eq!(carried.document_id, doc_id);
    assert!(validate(&room).is_valid(), "{}", validate(&room).display());

    // A full room (every field of the schema) validates against the template's own schema.
    let full = serde_json::json!({
        "cards": { "c1": {
            "text": "One song of silence.", "by": "maeve@wk", "kind": "team", "at": "2026-11-12T09:10:00Z",
            "brief_link": { "insight": "i", "proposition": "p" }, "votes": ["oisin@wk"],
            "comments": [{ "by": "oisin@wk", "text": "yes", "at": "2026-11-12T09:11:00Z" }],
            "tests": {
                "swap": { "answer": "fits a competitor", "reason": "r" },
                "fame": { "headline": "h", "friend_line": "f" },
                "banned_match": { "banned": "c9", "by": "dara@wk", "at": "2026-11-12T09:12:00Z" }
            }
        } },
        "ai_open": { "state": "early", "by": "dara@wk", "decision": "d_1", "at": "t", "reason": "r" },
        "routes_out": ["route_2"],
        "routes": { "route_1": {
            "name": "One song", "bet": "b", "cards": ["c1"],
            "notes": [{ "by": "maeve@wk", "text": "n", "at": "t" }], "version": 2, "started_by": "dara@wk", "branch": "x"
        } },
        "chosen": { "route": "route_1", "version": "2", "decision": "d_2", "by": "dara@wk", "at": "t" }
    });
    let filled = open(patch_data_with(&room, &full, PatchDataOptions::default(), None).unwrap());
    assert!(
        validate(&filled).is_valid(),
        "{}",
        validate(&filled).display()
    );
}

#[test]
fn three_route_branches_merge_with_one_planted_clash() {
    let template = packed();
    let room = open(
        spinoff(
            &template,
            &brief(),
            SpinoffOptions {
                title: "Idea room".into(),
                map: None,
                instance_id: None,
                source_uri: None,
            },
        )
        .unwrap(),
    );
    let ids: Vec<String> = ["route_1", "route_2", "route_3"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mut branches: Vec<ClanFile> = fork(&room, &ids)
        .unwrap()
        .into_iter()
        .map(|(_, b)| open(b))
        .collect();
    for (i, b) in branches.iter_mut().enumerate() {
        let id = format!("route_{}", i + 1);
        let mut patch =
            json!({ id.clone(): { "name": format!("Route {}", i + 1), "bet": "b", "version": 1 } });
        if i > 0 {
            patch["shared_hook"] = json!(if i == 1 { "A" } else { "B" });
        }
        *b = open(patch_data_namespaced(b, &patch).unwrap());
    }
    let out = merge(&branches, MergeOptions::default()).unwrap();
    let merged = open(out.bytes);
    let data: serde_yaml::Value =
        serde_yaml::from_slice(&merged.read_entry("shared/data.yaml").unwrap()).unwrap();
    for n in 1..=3 {
        assert!(data[format!("route_{n}")].is_mapping(), "route {n}");
    }
    assert_eq!(out.report.conflicts.len(), 1, "only the planted clash");
    let c = &out.report.conflicts[0];
    assert_eq!(c.key, "shared_hook");
    assert_eq!(c.losers.len(), 1, "both sides are listed");
    assert!(merged.has_entry("merge-report.yaml"));
}
