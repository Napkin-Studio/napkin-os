// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! S0-5: the snapshot ring. Seeded random save sequences against a fake clock,
//! then the same rules through the save route.

mod support;

use napkin_web::snapshots::{Reason, Ring, KEEP, MIN_GAP_MS};
use support::big_doc::{self, PRODUCTION};
use support::server::*;

const REASONS: [Reason; 6] = [
    Reason::Interval,
    Reason::Accept,
    Reason::Manual,
    Reason::Handoff,
    Reason::Export,
    Reason::Landing,
];

/// xorshift: a seeded sequence, the same on every run.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

#[test]
fn s0_5_five_hundred_random_sequences_keep_the_rules() {
    let dir = tempfile::tempdir().unwrap();
    let other = Ring::new(dir.path().join("other-tenant"));
    other.record("doc-x", Reason::Accept, b"theirs", 1).unwrap();
    for seed in 1..=500u64 {
        let ring = Ring::new(dir.path().join(format!("t{seed}")));
        let mut rng = Rng(seed.wrapping_mul(0x9E3779B97F4A7C15) | 1);
        let mut now: u128 = 1_700_000_000_000;
        let mut taken: Vec<(u128, Reason)> = Vec::new();
        let steps = 1 + (rng.next() % 140) as usize;
        for i in 0..steps {
            // gaps from seconds to half an hour, so both sides of the 10-minute rule occur
            now += (rng.next() % 1_800_000) as u128;
            let reason = REASONS[(rng.next() % 6) as usize];
            let newest = taken.last().map(|t| t.0);
            let bytes = format!("{seed}-{i}");
            let did = ring.record("doc-x", reason, bytes.as_bytes(), now).unwrap();
            let due = reason.always() || newest.map_or(true, |n| now - n >= MIN_GAP_MS);
            assert_eq!(did, due, "seed {seed} step {i}: {reason:?}");
            if did {
                taken.push((now, reason));
            }
        }
        let listed = ring.list("doc-x");
        assert!(listed.len() <= KEEP, "seed {seed}: {} kept", listed.len());
        let want = taken.len().min(KEEP);
        assert_eq!(listed.len(), want, "seed {seed}");
        // newest present, order by time, and exactly the newest `want` taken
        let times: Vec<u128> = listed.iter().map(|l| l.0).collect();
        assert!(
            times.windows(2).all(|w| w[0] <= w[1]),
            "seed {seed}: ordered"
        );
        let expect: Vec<u128> = taken[taken.len() - want..].iter().map(|t| t.0).collect();
        assert_eq!(times, expect, "seed {seed}: the newest are the ones kept");
        // every always-reason inside the kept window is there
        for (ms, r) in &taken[taken.len() - want..] {
            if r.always() {
                assert!(
                    listed.iter().any(|(m, p)| m == ms
                        && p.file_name()
                            .unwrap()
                            .to_string_lossy()
                            .contains(r.as_str())),
                    "seed {seed}: {r:?} at {ms} must be kept"
                );
            }
        }
    }
    // a second ring's directory was never touched
    assert_eq!(other.list("doc-x").len(), 1);
}

#[tokio::test]
async fn s0_5_through_the_route_snapshots_follow_the_reason_and_stay_out_of_the_library() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let other = sign_in(&s, "planner", "javelin").await;
    let doc = instance(&s, &me, PRODUCTION, "P");
    let ws = s.ctx.workspace(&me.tenant);
    let mut bytes = ws
        .store
        .read(&napkin_host::DocId::new(doc.clone()))
        .unwrap();
    let mut v = version_of(&bytes);
    let mut flags = Vec::new();
    for (i, reason) in [
        "interval", "interval", "manual", "accept", "handoff", "export",
    ]
    .iter()
    .enumerate()
    {
        bytes = big_doc::with_entry(&bytes, "shared/data.yaml", format!("n: {i}\n").into_bytes());
        let r = me.save(&s, &doc, &v, &bytes, Some(reason)).await;
        assert_eq!(r.status.as_u16(), 200);
        flags.push(r.json()["snapshot"].as_bool().unwrap());
        v = version_of(&bytes);
    }
    // the first interval save is the first snapshot; the next two are inside
    // ten minutes; accept, handoff and export always snapshot
    assert_eq!(flags, vec![true, false, false, true, true, true]);

    let dir = s
        .dir
        .path()
        .join("data")
        .join(me.tenant.as_str())
        .join("snapshots")
        .join(&doc);
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 4);
    let lib = me.get(&s, "/library").await.json().to_string();
    assert!(!lib.contains("snapshots") && !lib.contains("accept-"));
    // the other agency has none
    assert!(!s
        .dir
        .path()
        .join("data")
        .join(other.tenant.as_str())
        .join("snapshots")
        .exists());
}
