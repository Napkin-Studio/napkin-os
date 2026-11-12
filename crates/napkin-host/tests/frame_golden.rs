// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The frame composer makes the pages the shell's TypeScript made, byte for
//! byte (features/doc-open-direct.clan: "nothing else breaks").
//!
//! `tests/fixtures/frame/expected.json` is the SHA-256 and length of every
//! page the shell composed — the Research and Brief views, a fragment and two
//! edge pages, for each host's last pass, render model, capture and theme —
//! recorded before the composition moved here (see the README there). A page
//! that differs is written under `target/frame-golden/` for diffing.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use napkin_host::frame::{compose, FrameOptions, Reach, RenderModel, Theme};
use serde_json::Value;

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/frame")
}

fn input(name: &str) -> String {
    let dir = fixtures();
    let plain = dir.join(format!("{name}.html"));
    if plain.exists() {
        return std::fs::read_to_string(plain).unwrap();
    }
    let gz = std::fs::read(dir.join(format!("{name}.html.gz"))).unwrap();
    let mut out = String::new();
    flate2::read::GzDecoder::new(&gz[..])
        .read_to_string(&mut out)
        .unwrap();
    out
}

#[test]
fn compose_makes_the_pages_the_shell_made() {
    let expected: Value =
        serde_json::from_str(&std::fs::read_to_string(fixtures().join("expected.json")).unwrap())
            .unwrap();
    let origin = expected["origin"].as_str().unwrap().to_string();
    let cases = expected["cases"].as_object().unwrap();
    assert_eq!(
        cases.len(),
        120,
        "5 inputs × 3 hosts × 2 models × capture × theme"
    );

    let mut inputs = BTreeMap::new();
    let mut wrong = Vec::new();
    let out = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/frame-golden");
    for (case, want) in cases {
        let parts: Vec<&str> = case.split('/').collect();
        let [name, reach, model, capture, theme] = parts[..] else {
            panic!("case {case}");
        };
        let html = inputs.entry(name).or_insert_with(|| input(name));
        let opts = FrameOptions {
            model: RenderModel::parse(model).unwrap(),
            capture: capture == "capture",
            theme: Theme::parse(theme).unwrap(),
            reach: match reach {
                "web" => Reach::Origin(origin.clone()),
                "desktop" => Reach::Scheme,
                "device" => Reach::Device,
                other => panic!("reach {other}"),
            },
        };
        let page = compose(html, &opts);
        let sha = clan_sdk::hash::sha256_hex(page.as_bytes());
        if sha != want["sha256"].as_str().unwrap()
            || page.len() as u64 != want["len"].as_u64().unwrap()
        {
            std::fs::create_dir_all(&out).unwrap();
            std::fs::write(out.join(format!("{}.html", case.replace('/', "."))), &page).unwrap();
            wrong.push(format!(
                "{case} ({} bytes, want {})",
                page.len(),
                want["len"]
            ));
        }
    }
    assert!(
        wrong.is_empty(),
        "{} of {} pages differ from the shell's (written to {}):\n  {}",
        wrong.len(),
        cases.len(),
        out.display(),
        wrong.join("\n  ")
    );
}
