// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Hardening of the full client review link (features/client-review-full.clan, after the
//! independent review): what one link holder can cost, who may be a reviewer, a second round on one
//! lock, and the actor on every client route.
#![allow(dead_code)]

use std::sync::Arc;

use clan_sdk::{ClanBuilder, ClanFile, DecisionChain};
use napkin_host::{dispatch, Actor, Ctx, DocId, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

const BRIEF: &str = "ie.napkin.brief-maker";
const VISUAL: &str = "ie.napkin.visual-brief";
const REVIEW: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REVIEW2: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const A: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const B: &str = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
const C: &str = "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3";
const A_MAIL: &str = "approver@client-a.example";
const B_MAIL: &str = "second@client-a.example";
const C_MAIL: &str = "third@client-a.example";

struct Rig {
    _dir: tempfile::TempDir,
    session: Session,
    id: DocId,
}

fn staff() -> Ctx {
    Ctx::new(Actor::human("aoife").unwrap())
}
fn client(email: &str) -> Ctx {
    Ctx::new(Actor::client(email).unwrap())
}
fn in_days(n: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::days(n))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

/// A tiny MP4: `ftyp` and a `moov` with an `mvhd` that says 10 seconds (timescale 1000).
fn film() -> Vec<u8> {
    let mut mvhd = vec![0u8; 4];
    mvhd.extend([0u8; 8]); // creation, modification
    mvhd.extend(1000u32.to_be_bytes());
    mvhd.extend(10_000u32.to_be_bytes());
    mvhd.extend([0u8; 80]);
    let b = |k: &[u8; 4], body: &[u8]| {
        let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend(k);
        v.extend(body);
        v
    };
    let mut out = b(b"ftyp", b"isom\0\0\0\0isom");
    out.extend(b(b"moov", &b(b"mvhd", &mvhd)));
    out
}

fn build(app: &str, data: &Value, assets: &[(&str, &[u8])]) -> Vec<u8> {
    let plain = clan_sdk::create(clan_sdk::CreateOptions {
        title: "Review".into(),
        brief: "a thing to review".into(),
        document_type: None,
        no_render: false,
        schema: None,
    })
    .unwrap();
    let base = ClanFile::from_bytes(plain).unwrap();
    let mut m = base.manifest().clone();
    m.app = Some(clan_sdk::AppInfo {
        home: None,
        name: "App".into(),
        app_id: app.into(),
        version: "1.0.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach: None,
    });
    let mut b = ClanBuilder::new(m);
    for (path, bytes) in base.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH && path != "shared/data.yaml" {
            b.add_entry(path, bytes);
        }
    }
    b.add_entry("shared/data.yaml", data.to_string().into_bytes());
    for (name, bytes) in assets {
        b.add_entry(format!("human/assets/{name}"), bytes.to_vec());
    }
    b.build().unwrap()
}

fn rig(app: &str, data: Value, assets: &[(&str, &[u8])]) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("doc.clan"));
    std::fs::write(id.as_str(), build(app, &data, assets)).unwrap();
    let session = Session::with_ctx(Arc::new(FsStore::new(dir.path().to_path_buf())), staff());
    session.open(id.clone()).unwrap();
    Rig {
        _dir: dir,
        session,
        id,
    }
}

fn visual_data() -> Value {
    json!({
        "territory": { "name": "Permission to stop", "line": "The evening starts when the day is over." },
        "proposition": "The whiskey that waits for you.",
        "tone": ["Unhurried"], "must_show": ["The bottle"], "never_show": ["Driving"],
        "reference_frames": {
            "a": { "asset": "a.png", "caption": "The bar at nine" },
            "b": { "asset": "b.png" },
            "c": { "asset": "c.mp4", "caption": "The pour", "ai": "none" },
        },
    })
}

const PNG_A: &[u8] = b"\x89PNG\r\n\x1a\nA";
const PNG_B: &[u8] = b"\x89PNG\r\n\x1a\nB";

impl Rig {
    fn call(&self, ctx: &Ctx, path: &str, body: Value) -> (u16, Value) {
        let r = dispatch(
            ctx,
            &self.session,
            &NoConfig,
            HostRequest::new(path, "", body.to_string().into_bytes()),
        );
        (
            r.status,
            serde_json::from_slice(&r.body).unwrap_or(Value::Null),
        )
    }
    fn raw(&self, ctx: &Ctx, path: &str, body: Value) -> (u16, Vec<u8>, Vec<(String, String)>) {
        let r = dispatch(
            ctx,
            &self.session,
            &NoConfig,
            HostRequest::new(path, "", body.to_string().into_bytes()),
        );
        (r.status, r.body, r.headers)
    }
    fn lock(&self) {
        assert_eq!(self.call(&staff(), "/approve", json!({})).0, 200);
    }
    fn locked_brief() -> Rig {
        let r = rig(
            BRIEF,
            json!({ "single_minded_proposition": "The easy way into Irish whiskey.", "insight": "Younger drinkers think it is for someone else." }),
            &[],
        );
        r.lock();
        r
    }
    fn locked_visual() -> Rig {
        let r = rig(
            VISUAL,
            visual_data(),
            &[("a.png", PNG_A), ("b.png", PNG_B), ("c.mp4", &film())],
        );
        r.lock();
        r
    }
    fn round(&self, review: &str, people: Value) -> (u16, Value) {
        self.call(
            &staff(),
            "/client-link/issue-round",
            json!({ "review": review, "reviewers": people, "expires": in_days(30) }),
        )
    }
    /// A, the approver, B and C.
    fn three(&self, review: &str) -> (u16, Value) {
        self.round(
            review,
            json!([
                { "id": A, "name": "Alex", "email": A_MAIL, "approver": true },
                { "id": B, "name": "Bea", "email": B_MAIL },
                { "id": C, "name": "Cal", "email": C_MAIL },
            ]),
        )
    }
    fn chain(&self) -> DecisionChain {
        let clan = ClanFile::open(self.id.as_str()).unwrap();
        DecisionChain::from_yaml(&clan.read_entry("agent/decision-chain.yaml").unwrap()).unwrap()
    }
    fn state(&self, who: &str, id: &str) -> (u16, Value) {
        self.call(&client(who), "/client-link/state", json!({ "id": id }))
    }
    fn comment(&self, who: &str, id: &str, c: Value) -> (u16, Value) {
        let mut body = c;
        body["id"] = json!(id);
        self.call(&client(who), "/client-link/comment", body)
    }
    fn answer(&self, who: &str, id: &str, a: &str) -> (u16, Value) {
        self.call(
            &client(who),
            "/client-link/answer",
            json!({ "id": id, "answer": a, "said": "Please look at the light" }),
        )
    }
    fn of(&self, action: &str) -> Vec<clan_sdk::Decision> {
        self.chain()
            .decisions
            .into_iter()
            .filter(|d| d.kind.as_deref() == Some("client_review") && d.action == action)
            .collect()
    }
}

use std::sync::atomic::Ordering::Relaxed;

fn reads() -> (usize, usize) {
    (
        napkin_host::ops::client_pieces::ASSET_READS.load(Relaxed),
        napkin_host::ops::client_pieces::ASSET_HASHES.load(Relaxed),
    )
}

// The counters are process-wide, so the test that reads them is the only one in this file that
// serves pieces or asks for a state; the others never touch an asset.
#[test]
fn asset_reads_and_hashes_do_not_grow_with_requests_on_an_unchanged_document() {
    let r = Rig::locked_visual();
    assert_eq!(r.three(REVIEW).0, 200);
    // the first look at a new version hashes its pieces once
    assert_eq!(r.state(A_MAIL, A).0, 200);
    let (r0, h0) = reads();
    for _ in 0..12 {
        let (s, _, _) = r.raw(
            &client(A_MAIL),
            "/client-link/piece",
            json!({ "id": A, "n": 3 }),
        );
        assert_eq!(s, 200);
        assert_eq!(r.state(A_MAIL, A).0, 200);
    }
    let (r1, h1) = reads();
    // nothing is hashed again: the pieces' hashes are worked out once for this version
    assert_eq!(h1 - h0, 0, "hashes grew with the requests");
    // and a piece is read once to be served, not once more to be listed and again to be checked
    assert!(r1 - r0 <= 12, "reads grew: {}", r1 - r0);

    // an asset swapped with no change to the data is still found, and the link is dead
    let clan = ClanFile::open(r.id.as_str()).unwrap();
    let mut b = ClanBuilder::new(clan.manifest().clone());
    for (p, bytes) in clan.read_all_entries().unwrap() {
        if p != clan_sdk::MANIFEST_PATH {
            b.add_entry(
                p.clone(),
                if p == "human/assets/a.png" {
                    b"\x89PNG\r\n\x1a\nSWAPPED".to_vec()
                } else {
                    bytes
                },
            );
        }
    }
    std::fs::write(r.id.as_str(), b.build().unwrap()).unwrap();
    r.session.open(r.id.clone()).unwrap();
    assert_eq!(r.state(A_MAIL, A).0, 410);
    let (s, _, _) = r.raw(
        &client(A_MAIL),
        "/client-link/piece",
        json!({ "id": A, "n": 3 }),
    );
    assert_eq!(s, 410);
}

#[test]
fn the_gate_and_the_round_view_name_who_confirmed_in_full_and_a_reviewer_never_sees_it() {
    let r = Rig::locked_brief();
    assert_eq!(r.three(REVIEW).0, 200);
    let (_, g) = r.call(&staff(), "/gate", json!({}));
    assert_eq!(g["confirmed"], false);
    assert!(g.get("confirmed_by").is_none(), "nobody has confirmed yet");
    // reviewer B approves, and counts for nothing: the gate names nobody
    assert_eq!(r.answer(B_MAIL, B, "confirm").0, 200);
    let (_, g) = r.call(&staff(), "/gate", json!({}));
    assert!(g.get("confirmed_by").is_none());
    assert_eq!(r.answer(A_MAIL, A, "confirm").0, 200);
    let (_, g) = r.call(&staff(), "/gate", json!({}));
    assert_eq!(g["confirmed"], true, "{g}");
    assert_eq!(g["confirmed_by"]["email"], A_MAIL);
    assert_eq!(g["confirmed_by"]["name"], "Alex");
    // the round view gives the agency every address, and a reviewer's own view holds no one else's
    let (_, v) = r.call(&staff(), "/client-review/round", json!({}));
    let mails: Vec<&str> = v["reviewers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["email"].as_str().unwrap())
        .collect();
    assert!(mails.contains(&A_MAIL) && mails.contains(&B_MAIL));
    let (_, own) = r.state(B_MAIL, B);
    let own = own.to_string();
    assert!(!own.contains(A_MAIL) && !own.contains("Alex"), "{own}");
}

#[test]
#[ignore]
fn measure_comment_on_a_large_document() {
    let mut x: u64 = 88172645463325252;
    let mut big = |n: usize| -> Vec<u8> {
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                (x >> 24) as u8
            })
            .collect()
    };
    let (a, b, c) = (big(64 << 20), big(64 << 20), big(64 << 20));
    let r = rig(
        VISUAL,
        visual_data(),
        &[("a.png", &a), ("b.png", &b), ("c.mp4", &c)],
    );
    let t = std::time::Instant::now();
    r.lock();
    println!("lock {:?}", t.elapsed());
    let t = std::time::Instant::now();
    assert_eq!(r.three(REVIEW).0, 200);
    println!("issue round {:?}", t.elapsed());
    let t = std::time::Instant::now();
    r.state(A_MAIL, A);
    println!("first state (hash 192 MB) {:?}", t.elapsed());
    let t = std::time::Instant::now();
    let (s, v) = r.comment(
        A_MAIL,
        A,
        json!({ "piece": 1, "tag": "preference", "text": "x" }),
    );
    println!("comment {s} {:?} {v}", t.elapsed());
    let t = std::time::Instant::now();
    r.comment(
        A_MAIL,
        A,
        json!({ "piece": 1, "tag": "preference", "text": "y" }),
    );
    println!("second comment {:?}", t.elapsed());
}
