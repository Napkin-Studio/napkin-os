// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The server's sanitiser against the shell's, on one shared corpus
//! (app/tests/fixtures/svg, features/agency-looks-admin.clan):
//!
//! * `<name>.svg` → byte for byte `<name>.out.svg`, which the TS sanitiser
//!   wrote (`node tests/fixtures/svg/write-out.mjs`), and sanitising that
//!   output gives it back;
//! * `invalid/*.svg` are refused by both (no `<svg>`, no viewBox, no shapes);
//! * `hostile/<name>.svg` is refused before sanitising, with exactly what
//!   `hostile/<name>.found.json` lists. `NAPKIN_WRITE_FOUND=1` rewrites those.

use std::path::{Path, PathBuf};

use napkin_web::svg_sanitise::{
    active_content, clean_upload, sanitise_svg, Found, Refused, CLEAN_MAX, RAW_MAX, SHAPES_MAX,
};

fn corpus() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../app/tests/fixtures/svg")
}

fn svgs(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            let n = p.file_name().unwrap().to_string_lossy();
            n.ends_with(".svg") && !n.ends_with(".out.svg")
        })
        .collect();
    v.sort();
    v
}

#[test]
fn every_fixture_sanitises_byte_for_byte_as_the_shell_does() {
    let files = svgs(&corpus());
    assert!(files.len() >= 12, "the corpus is there: {files:?}");
    for f in [
        "boysandgirls-logo",
        "catapult-logo",
        "catapult-icon",
        "pluto-logo",
    ] {
        assert!(
            corpus().join(format!("{f}.svg")).is_file(),
            "{f} is in the corpus"
        );
    }
    for f in files {
        let src = std::fs::read_to_string(&f).unwrap();
        let want = std::fs::read_to_string(f.with_extension("out.svg"))
            .unwrap_or_else(|_| panic!("{} has no .out.svg", f.display()));
        let got = sanitise_svg(&src).unwrap_or_else(|e| panic!("{}: {e:?}", f.display()));
        assert_eq!(got, want, "{}", f.display());
        assert_eq!(
            sanitise_svg(&got).unwrap(),
            got,
            "{} is idempotent",
            f.display()
        );
        assert!(
            active_content(&src).is_empty(),
            "{} is not refused",
            f.display()
        );
        assert!(clean_upload(src.as_bytes()).is_ok(), "{}", f.display());
    }
}

#[test]
fn invalid_files_are_refused_as_the_shell_refuses_them() {
    for (name, why) in [
        ("no-viewbox", "svg has no viewBox"),
        ("no-shapes", "svg has no shapes"),
        ("not-svg", "not an svg"),
        ("prototype-name", "allowed is not iterable"),
    ] {
        let src = std::fs::read_to_string(corpus().join(format!("invalid/{name}.svg"))).unwrap();
        assert_eq!(sanitise_svg(&src).map_err(|e| e.0), Err(why), "{name}");
        assert!(
            matches!(clean_upload(src.as_bytes()), Err(Refused::Unusable(_))),
            "{name}"
        );
    }
}

#[test]
fn hostile_files_are_refused_saying_what_and_where() {
    let dir = corpus().join("hostile");
    let files = svgs(&dir);
    assert!(files.len() >= 10);
    let write = std::env::var_os("NAPKIN_WRITE_FOUND").is_some();
    for f in files {
        let src = std::fs::read_to_string(&f).unwrap();
        let found = active_content(&src);
        assert!(!found.is_empty(), "{} is refused", f.display());
        let json = f.with_extension("found.json");
        if write {
            std::fs::write(&json, serde_json::to_string_pretty(&found).unwrap() + "\n").unwrap();
        }
        let want: Vec<Found> = serde_json::from_str(&std::fs::read_to_string(&json).unwrap())
            .unwrap_or_else(|e| panic!("{}: {e}", json.display()));
        assert_eq!(found, want, "{}", f.display());
        assert_eq!(
            clean_upload(src.as_bytes()).unwrap_err(),
            Refused::Active(want)
        );
    }
}

#[test]
fn the_size_and_shape_limits_hold() {
    // as sent: 200 KB
    let pad = |n: usize| {
        format!(
            "<svg viewBox=\"0 0 1 1\"><rect width=\"1\" height=\"1\"/><!--{}--></svg>",
            "x".repeat(n)
        )
    };
    let edge = pad(RAW_MAX - pad(0).len());
    assert_eq!(edge.len(), RAW_MAX);
    assert!(clean_upload(edge.as_bytes()).is_ok());
    assert!(matches!(
        clean_upload(pad(RAW_MAX).as_bytes()),
        Err(Refused::TooBig(_))
    ));
    // 10 MB is refused before it is read
    let huge = vec![b' '; 10 * 1024 * 1024];
    assert!(matches!(clean_upload(&huge), Err(Refused::TooBig(_))));
    // cleaned: 48 KB
    let long: String = (0..1500)
        .map(|i| format!("<path d=\"M{i} 0h1v1h-1z\"/>"))
        .collect();
    let svg = format!("<svg viewBox=\"0 0 9 9\">{long}</svg>");
    assert!(svg.len() < RAW_MAX);
    let cleaned = sanitise_svg(&svg).unwrap();
    assert!(cleaned.len() > CLEAN_MAX);
    assert!(matches!(clean_upload(svg.as_bytes()), Err(Refused::TooBig(m)) if m.contains("48 KB")));
    // 2,000 shapes
    let many: String = (0..SHAPES_MAX + 1).map(|_| "<rect/>").collect();
    let svg = format!("<svg viewBox=\"0 0 1 1\">{many}</svg>");
    assert!(sanitise_svg(&svg).unwrap().len() < CLEAN_MAX);
    assert!(
        matches!(clean_upload(svg.as_bytes()), Err(Refused::TooBig(m)) if m.contains("2001 shapes"))
    );
    let ok: String = (0..SHAPES_MAX).map(|_| "<rect/>").collect();
    assert!(clean_upload(format!("<svg viewBox=\"0 0 1 1\">{ok}</svg>").as_bytes()).is_ok());
    // not text
    assert!(matches!(
        clean_upload(&[0xff, 0xfe, 0x00]),
        Err(Refused::Unusable(_))
    ));
}

#[test]
fn an_upload_says_what_cleaning_dropped() {
    let src = std::fs::read_to_string(corpus().join("illustrator.svg")).unwrap();
    let c = clean_upload(src.as_bytes()).unwrap();
    assert_eq!(c.dropped, ["style"]);
    let w = c.warnings.join(" ");
    for want in ["Transforms", "Strokes", "stylesheet"] {
        assert!(w.contains(want), "{want}: {w}");
    }
    let src = std::fs::read_to_string(corpus().join("defs-and-text.svg")).unwrap();
    let c = clean_upload(src.as_bytes()).unwrap();
    assert!(
        c.dropped.iter().any(|d| d == "text") && c.dropped.iter().any(|d| d == "linearGradient")
    );
    assert!(c.warnings.iter().any(|w| w.contains("Live text")));
    assert!(c.warnings.iter().any(|w| w.contains("Gradient")));
    let plain = std::fs::read_to_string(corpus().join("pluto-logo.svg")).unwrap();
    let c = clean_upload(plain.as_bytes()).unwrap();
    assert!(c.dropped.is_empty() && c.warnings.is_empty());
}
