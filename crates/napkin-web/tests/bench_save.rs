// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! S0-7: save and list stay fast on real sizes. Five saves a minute for three
//! minutes, a library list after each; p95 of each under 150 ms.
//!
//!     PRODUCTION_BENCH=1 cargo test -p napkin-web --test bench_save -- --nocapture
//!
//! `FX_HO_REAL=<a real project .clan>` adds the FX-HO-REAL run (the file is
//! read from disk and never committed). `BENCH_GAP_MS` shortens the 12 s gap
//! between saves for a quick look. In-process: the router is driven directly,
//! so network time is not in the numbers; the disk, hashing, parsing and the
//! session refresh are.

mod support;

use std::time::{Duration, Instant};

use support::big_doc::{self, PRODUCTION};
use support::server::*;

fn p95(v: &mut [Duration]) -> Duration {
    v.sort();
    v[((v.len() as f64) * 0.95).ceil() as usize - 1]
}

async fn run(label: &str, make: impl Fn(&[u8]) -> Vec<u8>) {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let doc = instance(&s, &me, PRODUCTION, "Bench");
    let ws = s.ctx.workspace(&me.tenant);
    let start = ws
        .store
        .read(&napkin_host::DocId::new(doc.clone()))
        .unwrap();
    let mut bytes = make(&start);
    let mut v = version_of(
        &ws.store
            .read(&napkin_host::DocId::new(doc.clone()))
            .unwrap(),
    );
    let gap = Duration::from_millis(
        std::env::var("BENCH_GAP_MS")
            .ok()
            .and_then(|g| g.parse().ok())
            .unwrap_or(12_000),
    );
    let (mut saves, mut lists) = (Vec::new(), Vec::new());
    for i in 0..15 {
        // a small edit on a big document, as the tool leaves it
        bytes = big_doc::with_entry(&bytes, "shared/data.yaml", format!("n: {i}\n").into_bytes());
        let t = Instant::now();
        let r = me.save(&s, &doc, &v, &bytes, None).await;
        saves.push(t.elapsed());
        assert_eq!(r.status.as_u16(), 200);
        v = version_of(&bytes);
        let t = Instant::now();
        assert_eq!(me.get(&s, "/library").await.status.as_u16(), 200);
        lists.push(t.elapsed());
        tokio::time::sleep(gap).await;
    }
    let (ps, pl) = (p95(&mut saves), p95(&mut lists));
    println!(
        "S0-7 {label}: {} bytes, save p95 {ps:?} (max {:?}), list p95 {pl:?} (max {:?})",
        bytes.len(),
        saves.iter().max().unwrap(),
        lists.iter().max().unwrap()
    );
    assert!(ps < Duration::from_millis(150), "{label}: save p95 {ps:?}");
    assert!(pl < Duration::from_millis(150), "{label}: list p95 {pl:?}");
}

#[tokio::test]
#[ignore = "set PRODUCTION_BENCH=1: runs for three minutes"]
async fn s0_7_save_and_list_p95_under_150ms() {
    if std::env::var("PRODUCTION_BENCH").is_err() {
        eprintln!("skipped: PRODUCTION_BENCH is not set");
        return;
    }
    run("FX-5MB", big_doc::big_doc).await;
    match std::env::var("FX_HO_REAL") {
        Ok(_) => {
            run("FX-HO-REAL", |d| {
                big_doc::with_real(d).expect("FX_HO_REAL unreadable")
            })
            .await
        }
        Err(_) => eprintln!("FX-HO-REAL not run: FX_HO_REAL is not set"),
    }
}
