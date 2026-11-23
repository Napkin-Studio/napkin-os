// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Fixtures for the save route: app templates, Production instances, and a
//! document of a chosen size (FX-5MB) that does not compress away.
#![allow(dead_code)]

use clan_sdk::{AppInfo, ClanBuilder, ClanFile, MakeTemplateOptions};

pub const PRODUCTION: &str = "ie.napkin.production";

/// A template app of `app_id`, signed by nobody (the host does not need it).
pub fn template(app_id: &str, name: &str) -> Vec<u8> {
    let base = clan_sdk::create(clan_sdk::CreateOptions {
        title: name.into(),
        brief: "test".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    clan_sdk::make_template(
        &ClanFile::from_bytes(base).unwrap(),
        AppInfo {
            home: None,
            name: name.into(),
            app_id: app_id.into(),
            version: "1.0.0".into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: Some("agent/output-schema.json".into()),
            prompt_templates: vec![],
            data_seed: None,
            spinoff: None,
            attach: None,
        },
        MakeTemplateOptions::default(),
    )
    .unwrap()
}

/// `bytes` with one more entry (replacing a same-named one): the way the tool
/// leaves a document after an edit, same identity, new revision bytes.
pub fn with_entry(bytes: &[u8], path: &str, data: Vec<u8>) -> Vec<u8> {
    let clan = ClanFile::from_bytes(bytes.to_vec()).unwrap();
    let mut b = ClanBuilder::new(clan.manifest().clone());
    for (p, e) in clan.read_all_entries().unwrap() {
        if p != clan_sdk::MANIFEST_PATH && p != path {
            b.add_entry(p, e);
        }
    }
    b.add_entry(path.to_string(), data);
    b.build().unwrap()
}

/// `n` bytes a compressor cannot shrink (xorshift64*), so the archive is about `n`.
pub fn noise(n: usize, seed: u64) -> Vec<u8> {
    let mut x = seed | 1;
    let mut out = Vec::with_capacity(n);
    while out.len() < n {
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        out.extend_from_slice(&x.wrapping_mul(0x2545F4914F6CDD1D).to_le_bytes());
    }
    out.truncate(n);
    out
}

/// FX-5MB: `doc` grown to about 5 MB with pictures-sized noise.
pub fn big_doc(doc: &[u8]) -> Vec<u8> {
    let mut out = doc.to_vec();
    for i in 0..5 {
        out = with_entry(
            &out,
            &format!("human/assets/pic{i}.bin"),
            noise(1 << 20, 7 + i),
        );
    }
    out
}

/// FX-HO-REAL: a Production instance carrying the entries of a real project
/// archive (`FX_HO_REAL=<path to a .clan>`), under `fx/`. `None` when unset.
/// The real file is client-like data: it is read from disk, never committed.
pub fn with_real(doc: &[u8]) -> Option<Vec<u8>> {
    let path = std::env::var("FX_HO_REAL").ok()?;
    let real = ClanFile::from_bytes(std::fs::read(path).ok()?).ok()?;
    let mut out = doc.to_vec();
    for (p, e) in real.read_all_entries().ok()? {
        if p != clan_sdk::MANIFEST_PATH {
            out = with_entry(&out, &format!("fx/{p}"), e);
        }
    }
    Some(out)
}
