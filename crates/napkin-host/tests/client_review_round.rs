// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The full client review link (features/client-review-full.clan): one locked version sent to several
//! named reviewers in a round, one of them the approver; pieces one at a time; comments pinned to a
//! spot or a moment; one answer each; and the agency's merged view with its two fixed flags.

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

#[test]
fn a_round_of_three_writes_three_links_with_one_review_id_and_round_one() {
    let r = Rig::locked_brief();
    let (s, v) = r.three(REVIEW);
    assert_eq!(s, 200, "{v}");
    assert_eq!(v["round"], 1);
    assert_eq!(v["links"].as_array().unwrap().len(), 3);
    let issued = r.of("issue_link");
    assert_eq!(issued.len(), 3);
    let mut ids = Vec::new();
    for d in &issued {
        let l = serde_json::to_value(d.extra.get("link").unwrap()).unwrap();
        assert_eq!(l["review"], REVIEW);
        assert_eq!(l["round"], 1);
        assert_eq!(l["scope"], "review");
        ids.push(l["id"].as_str().unwrap().to_string());
        // the pieces are the host's: a brief is one page of words, hashed by the host
        assert_eq!(l["pieces"].as_array().unwrap().len(), 1);
        assert_eq!(l["pieces"][0]["kind"], "text");
        assert!(l["pieces"][0]["sha256"]
            .as_str()
            .unwrap()
            .starts_with("sha256:"));
    }
    ids.sort();
    assert_eq!(ids, vec![A, B, C]);
    // the roles are the record's
    let (_, list) = r.call(&staff(), "/client-link/list", json!({}));
    let roles: Vec<&str> = list["links"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["role"].as_str().unwrap())
        .collect();
    assert_eq!(roles.iter().filter(|r| **r == "approver").count(), 1);
}

#[test]
fn zero_or_two_approvers_and_other_bad_rounds_are_refused() {
    let r = Rig::locked_brief();
    let p = |a: bool, b: bool| {
        json!([
            { "id": A, "name": "Alex", "email": A_MAIL, "approver": a },
            { "id": B, "name": "Bea", "email": B_MAIL, "approver": b },
        ])
    };
    assert_eq!(r.round(REVIEW, p(false, false)).0, 400);
    assert_eq!(r.round(REVIEW, p(true, true)).0, 400);
    assert_eq!(r.round(REVIEW, json!([])).0, 400);
    // the same address twice, a bad address, the host's fields in the body
    let same = json!([
        { "id": A, "name": "Alex", "email": A_MAIL, "approver": true },
        { "id": B, "name": "Alex again", "email": A_MAIL },
    ]);
    assert_eq!(r.round(REVIEW, same).0, 400);
    let bad = json!([{ "id": A, "name": "Alex", "email": "nope", "approver": true }]);
    assert_eq!(r.round(REVIEW, bad).0, 400);
    for key in ["round", "pieces", "version", "lock", "doc_hash"] {
        let (s, _) = r.call(
            &staff(),
            "/client-link/issue-round",
            json!({ "review": REVIEW, "reviewers": p(true, false), "expires": in_days(30), key: 1 }),
        );
        assert_eq!(s, 400, "{key} is the host's");
    }
    assert!(r.of("issue_link").is_empty(), "nothing was written");
    // a person only, and a client cannot make a round
    assert_eq!(
        r.call(&client(A_MAIL), "/client-link/issue-round", json!({}))
            .0,
        403
    );
    // a document type with no clean spec gets no round
    let other = rig("ie.napkin.idea-room", json!({}), &[]);
    other.lock();
    assert_eq!(other.three(REVIEW).0, 400);
    // a link lasts at most 30 days
    let (s, _) = r.call(
        &staff(),
        "/client-link/issue-round",
        json!({ "review": REVIEW, "reviewers": p(true, false), "expires": in_days(31) }),
    );
    assert_eq!(s, 400);
    // one that is not ended is made, once
    assert_eq!(r.round(REVIEW, p(true, false)).0, 200);
    assert_eq!(
        r.round(REVIEW, p(true, false)).0,
        409,
        "a review id is used once"
    );
}

#[test]
fn an_unlocked_edited_or_reopened_document_is_409() {
    let open = rig(BRIEF, json!({ "insight": "x" }), &[]);
    assert_eq!(open.three(REVIEW).0, 409);
    let r = Rig::locked_brief();
    r.call(
        &staff(),
        "/patch-data",
        json!({ "agent": "human", "action": "edit", "patch": { "tone": "Louder" } }),
    );
    assert_eq!(r.three(REVIEW).0, 409);
}

#[test]
fn each_reviewer_answers_once_as_themselves_and_the_others_stay_open() {
    let r = Rig::locked_brief();
    r.three(REVIEW);
    let lock = r
        .chain()
        .decisions
        .iter()
        .find(|d| d.kind.as_deref() == Some("approve"))
        .cloned()
        .unwrap();
    let (s, v) = r.call(
        &client(B_MAIL),
        "/client-link/answer",
        json!({ "id": B, "answer": "confirm" }),
    );
    assert_eq!(s, 200, "{v}");
    // B is not the approver: the answer is advice
    let advice = r.of("client_advice");
    assert_eq!(advice.len(), 1);
    assert_eq!(
        advice[0].actor.as_deref(),
        Some(&format!("client:{B_MAIL}")[..])
    );
    assert_eq!(advice[0].version, lock.version);
    assert_eq!(advice[0].cites, vec![lock.id.clone().unwrap()]);
    // a second answer by B is 410, and A and C are open
    assert_eq!(r.answer(B_MAIL, B, "confirm").0, 410);
    assert_eq!(r.state(A_MAIL, A).1["state"], "open");
    assert_eq!(r.state(C_MAIL, C).1["state"], "open");
    // the approver's answer is the client_answer
    assert_eq!(
        r.call(
            &client(A_MAIL),
            "/client-link/answer",
            json!({ "id": A, "answer": "confirm" })
        )
        .0,
        200
    );
    let answers = r.of("client_answer");
    assert_eq!(answers.len(), 1);
    assert_eq!(
        answers[0].actor.as_deref(),
        Some(&format!("client:{A_MAIL}")[..])
    );
    assert_eq!(answers[0].version, lock.version);
}

#[test]
fn only_the_approvers_answer_counts_for_the_gate_and_the_route() {
    let r = Rig::locked_brief();
    r.three(REVIEW);
    let confirmed = |r: &Rig| -> (bool, Value) {
        let (_, g) = r.call(&staff(), "/gate", json!({}));
        let (_, d) = r.call(&staff(), "/decisions", json!({}));
        (g["confirmed"] == true, d["client"]["answer"].clone())
    };
    assert!(!confirmed(&r).0);
    for (who, id) in [(B_MAIL, B), (C_MAIL, C)] {
        assert_eq!(
            r.call(
                &client(who),
                "/client-link/answer",
                json!({ "id": id, "answer": "confirm" })
            )
            .0,
            200
        );
    }
    let (gate, answer) = confirmed(&r);
    assert!(
        !gate,
        "two reviewers approving is not the client's decision"
    );
    assert!(
        answer.is_null(),
        "nor does the decision view read it: {answer}"
    );
    assert_eq!(
        r.call(
            &client(A_MAIL),
            "/client-link/answer",
            json!({ "id": A, "answer": "confirm" })
        )
        .0,
        200
    );
    let (gate, answer) = confirmed(&r);
    assert!(gate, "the approver's Approve is");
    assert_eq!(answer["answer"], "accepted");
}

#[test]
fn a_reviewer_has_their_own_link_and_cannot_use_anothers() {
    let r = Rig::locked_brief();
    r.three(REVIEW);
    // B's actor on A's link: refused, and nothing written
    let before = std::fs::read(r.id.as_str()).unwrap();
    assert_eq!(
        r.call(
            &client(B_MAIL),
            "/client-link/answer",
            json!({ "id": A, "answer": "confirm" })
        )
        .0,
        403
    );
    assert_eq!(
        r.comment(
            B_MAIL,
            A,
            json!({ "piece": 1, "tag": "preference", "text": "x" })
        )
        .0,
        403
    );
    assert_eq!(std::fs::read(r.id.as_str()).unwrap(), before);
    // B cannot take back A's comment
    let (_, c) = r.comment(
        A_MAIL,
        A,
        json!({ "piece": 1, "tag": "preference", "text": "mine" }),
    );
    let cid = c["comment"].as_str().unwrap().to_string();
    let (s, _) = r.call(
        &client(B_MAIL),
        "/client-link/comment-withdraw",
        json!({ "id": B, "comment": cid }),
    );
    assert_eq!(s, 404, "another reviewer's comment is no comment of B's");
    assert_eq!(
        r.call(
            &client(A_MAIL),
            "/client-link/comment-withdraw",
            json!({ "id": A, "comment": cid })
        )
        .0,
        200
    );
}

#[test]
fn a_reviewers_own_state_holds_nothing_of_another() {
    let r = Rig::locked_brief();
    r.three(REVIEW);
    r.comment(
        B_MAIL,
        B,
        json!({ "piece": 1, "tag": "preference", "text": "MARKER_B_COMMENT" }),
    );
    r.comment(
        A_MAIL,
        A,
        json!({ "piece": 1, "tag": "preference", "text": "MARKER_A_COMMENT" }),
    );
    r.call(
        &client(C_MAIL),
        "/client-link/answer",
        json!({ "id": C, "answer": "changes", "said": "MARKER_C_SAID" }),
    );
    let (_, mine) = r.state(A_MAIL, A);
    let text = mine.to_string();
    for other in [
        "MARKER_B_COMMENT",
        "MARKER_C_SAID",
        B_MAIL,
        C_MAIL,
        "Bea",
        "Cal",
        B,
        C,
    ] {
        assert!(!text.contains(other), "{other} is not A's to see: {text}");
    }
    assert!(text.contains("MARKER_A_COMMENT"));
}

#[test]
fn a_comment_is_pinned_tagged_and_written_on_the_links_version() {
    let r = Rig::locked_visual();
    assert_eq!(r.three(REVIEW).0, 200);
    let lock = r
        .chain()
        .decisions
        .iter()
        .find(|d| d.kind.as_deref() == Some("approve"))
        .cloned()
        .unwrap();
    let ok = |c: Value| r.comment(B_MAIL, B, c);
    let (s, v) = ok(
        json!({ "piece": 1, "pin": { "x": 0.25, "y": 0.5 }, "tag": "single_minded_proposition", "text": "Not this line" }),
    );
    assert_eq!(s, 400, "a tag is a point the visual brief shows: {v}");
    let (s, v) = ok(
        json!({ "piece": 1, "pin": { "x": 0.25, "y": 0.5 }, "tag": "proposition", "text": "Not this line" }),
    );
    assert_eq!(s, 200, "{v}");
    let (s, _) =
        ok(json!({ "piece": 3, "pin": { "t_ms": 4000 }, "tag": "preference", "text": "Cut here" }));
    assert_eq!(s, 200);
    let written = r.of("client_comment");
    assert_eq!(written.len(), 2);
    assert_eq!(
        written[0].actor.as_deref(),
        Some(&format!("client:{B_MAIL}")[..])
    );
    assert_eq!(written[0].version, lock.version);
    assert_eq!(written[0].cites, vec![lock.id.clone().unwrap()]);
    // outside the piece, past the film's ten seconds, an unknown tag, too long, empty, a pin on the wrong kind
    for (c, why) in [
        (
            json!({ "piece": 1, "pin": { "x": 1.5, "y": 0.5 }, "tag": "preference", "text": "x" }),
            "x out of range",
        ),
        (
            json!({ "piece": 1, "pin": { "x": 0.5, "y": -0.1 }, "tag": "preference", "text": "x" }),
            "y out of range",
        ),
        (
            json!({ "piece": 1, "pin": { "x": 0.5 }, "tag": "preference", "text": "x" }),
            "x without y",
        ),
        (
            json!({ "piece": 3, "pin": { "t_ms": 10_001 }, "tag": "preference", "text": "x" }),
            "past the end",
        ),
        (
            json!({ "piece": 1, "pin": { "t_ms": 10 }, "tag": "preference", "text": "x" }),
            "a moment on an image",
        ),
        (
            json!({ "piece": 9, "tag": "preference", "text": "x" }),
            "no such piece",
        ),
        (
            json!({ "piece": 1, "tag": "banned_list", "text": "x" }),
            "a tag that is no brief point",
        ),
        (
            json!({ "piece": 1, "tag": "preference", "text": "a".repeat(2001) }),
            "over 2,000",
        ),
        (
            json!({ "piece": 1, "tag": "preference", "text": "   " }),
            "empty",
        ),
        (
            json!({ "piece": 1, "tag": "preference", "text": "x", "actor": "human:aoife" }),
            "an actor in the body",
        ),
        (
            json!({ "piece": 1, "tag": "preference", "text": "x", "round": 9 }),
            "a round in the body",
        ),
    ] {
        assert_eq!(ok(c).0, 400, "{why}");
    }
    assert_eq!(r.of("client_comment").len(), 2, "refusals write nothing");
    // 2,000 exactly is allowed
    assert_eq!(
        ok(json!({ "piece": 1, "tag": "preference", "text": "a".repeat(2000) })).0,
        200
    );
}

#[test]
fn a_link_holds_at_most_a_hundred_comments() {
    let r = Rig::locked_brief();
    r.three(REVIEW);
    for i in 0..100 {
        let (s, v) = r.comment(
            B_MAIL,
            B,
            json!({ "piece": 1, "tag": "preference", "text": format!("c{i}") }),
        );
        assert_eq!(s, 200, "{i}: {v}");
    }
    assert_eq!(
        r.comment(
            B_MAIL,
            B,
            json!({ "piece": 1, "tag": "preference", "text": "one more" })
        )
        .0,
        429
    );
    // a withdrawn comment still counts: the chain does not shrink
    let (_, st) = r.state(B_MAIL, B);
    let cid = st["comments"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(
        r.call(
            &client(B_MAIL),
            "/client-link/comment-withdraw",
            json!({ "id": B, "comment": cid })
        )
        .0,
        200
    );
    assert_eq!(
        r.comment(
            B_MAIL,
            B,
            json!({ "piece": 1, "tag": "preference", "text": "again" })
        )
        .0,
        429
    );
    // another reviewer's cap is their own
    assert_eq!(
        r.comment(
            C_MAIL,
            C,
            json!({ "piece": 1, "tag": "preference", "text": "mine" })
        )
        .0,
        200
    );
}

#[test]
fn an_answer_ends_a_reviewers_comments_and_every_route() {
    let r = Rig::locked_brief();
    r.three(REVIEW);
    r.comment(
        B_MAIL,
        B,
        json!({ "piece": 1, "tag": "preference", "text": "one" }),
    );
    assert_eq!(
        r.call(
            &client(B_MAIL),
            "/client-link/answer",
            json!({ "id": B, "answer": "confirm" })
        )
        .0,
        200
    );
    assert_eq!(
        r.comment(
            B_MAIL,
            B,
            json!({ "piece": 1, "tag": "preference", "text": "late" })
        )
        .0,
        410
    );
    assert_eq!(r.state(B_MAIL, B).0, 410);
    assert_eq!(
        r.call(
            &client(B_MAIL),
            "/client-link/piece",
            json!({ "id": B, "n": 1 })
        )
        .0,
        410
    );
    // asking for changes needs words: the answer's or a comment's
    assert_eq!(
        r.call(
            &client(C_MAIL),
            "/client-link/answer",
            json!({ "id": C, "answer": "changes" })
        )
        .0,
        400
    );
    r.comment(
        C_MAIL,
        C,
        json!({ "piece": 1, "tag": "preference", "text": "this" }),
    );
    assert_eq!(
        r.call(
            &client(C_MAIL),
            "/client-link/answer",
            json!({ "id": C, "answer": "changes" })
        )
        .0,
        200
    );
}

#[test]
fn a_piece_is_served_only_as_the_version_the_link_names() {
    let r = Rig::locked_visual();
    assert_eq!(r.three(REVIEW).0, 200);
    let (_, st) = r.state(A_MAIL, A);
    let pieces = st["pieces"].as_array().unwrap();
    assert_eq!(
        pieces.len(),
        3,
        "two images and a film, and no page of words"
    );
    assert_eq!(pieces[0]["label"], "The bar at nine");
    assert_eq!(pieces[2]["kind"], "film");
    assert_eq!(pieces[2]["duration_ms"], 10_000);
    assert_eq!(pieces[2]["ai"], "none");
    assert_eq!(
        pieces[0]["ai"], "not_recorded",
        "nothing is called AI-free without a record"
    );
    assert_eq!(st["version_n"], 1, "the version as people count it");
    // no address or hash is the client's to see
    assert!(!st.to_string().contains("human/assets") && !st.to_string().contains("\"sha256\""));
    let (s, bytes, h) = r.raw(
        &client(A_MAIL),
        "/client-link/piece",
        json!({ "id": A, "n": 1 }),
    );
    assert_eq!(s, 200);
    assert_eq!(bytes, PNG_A);
    assert!(h
        .iter()
        .any(|(k, v)| k == "Content-Type" && v == "image/png"));
    assert_eq!(
        r.raw(
            &client(A_MAIL),
            "/client-link/piece",
            json!({ "id": A, "n": 4 })
        )
        .0,
        404
    );
    assert_eq!(
        r.raw(
            &client(A_MAIL),
            "/client-link/piece",
            json!({ "id": A, "n": 0 })
        )
        .0,
        404
    );
    // an image swapped for another, with no change to the data: the link is dead
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
    assert_eq!(
        r.state(A_MAIL, A),
        (410, json!({ "ok": false, "state": "superseded" }))
            .clone()
            .into_state()
    );
    assert_eq!(
        r.raw(
            &client(A_MAIL),
            "/client-link/piece",
            json!({ "id": A, "n": 1 })
        )
        .0,
        410
    );
    assert_eq!(
        r.comment(
            A_MAIL,
            A,
            json!({ "piece": 1, "tag": "preference", "text": "x" })
        )
        .0,
        410
    );
}

trait IntoState {
    fn into_state(self) -> (u16, Value);
}
impl IntoState for (u16, Value) {
    fn into_state(self) -> (u16, Value) {
        let (s, v) = self;
        (s, json!({ "ok": false, "state": v["state"] }))
    }
}

#[test]
fn a_piece_that_is_not_a_known_kind_or_not_named_by_the_spec_is_never_listed() {
    let mut d = visual_data();
    d["reference_frames"]["b"] = json!({ "asset": "notes.txt" });
    d["reference_frames"]["c"] = json!({ "asset": "../secret.png" });
    d["reference_frames"]["d"] = json!({ "asset": "extra.png" }); // a slot the spec does not name
    let r = rig(
        VISUAL,
        d,
        &[
            ("a.png", PNG_A),
            ("notes.txt", b"private"),
            ("extra.png", PNG_B),
            ("agent-only.png", PNG_B),
        ],
    );
    r.lock();
    assert_eq!(r.three(REVIEW).0, 200);
    let (_, st) = r.state(A_MAIL, A);
    assert_eq!(st["pieces"].as_array().unwrap().len(), 1);
}

#[test]
fn rounds_are_counted_from_the_file_and_an_old_link_is_superseded() {
    let r = Rig::locked_brief();
    r.three(REVIEW);
    assert_eq!(r.state(A_MAIL, A).1["round"], 1);
    // the signed version is opened, changed and signed again: round 2, and every round 1 link is superseded
    assert_eq!(
        r.call(
            &staff(),
            "/unapprove",
            json!({ "rationale": "changes asked for" })
        )
        .0,
        200
    );
    r.call(
        &staff(),
        "/patch-data",
        json!({ "agent": "human", "action": "edit", "patch": { "tone": "Louder" } }),
    );
    r.lock();
    assert_eq!(r.state(A_MAIL, A), (410, r.state(A_MAIL, A).1));
    assert_eq!(r.state(A_MAIL, A).1["state"], "superseded");
    assert_eq!(
        r.comment(
            A_MAIL,
            A,
            json!({ "piece": 1, "tag": "preference", "text": "x" })
        )
        .0,
        410
    );
    assert_eq!(
        r.call(
            &client(A_MAIL),
            "/client-link/answer",
            json!({ "id": A, "answer": "confirm" })
        )
        .0,
        410
    );
    let (s, v) = r.round(
        REVIEW2,
        json!([{ "id": B, "name": "Alex", "email": A_MAIL, "approver": true }]),
    );
    assert_eq!(s, 409, "a link id is used once, in any round: {v}");
    let (s, v) = r.round(
        REVIEW2,
        json!([
            { "id": "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4", "name": "Alex", "email": A_MAIL, "approver": true },
            { "id": "e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5", "name": "Bea", "email": B_MAIL },
        ]),
    );
    assert_eq!(s, 200, "{v}");
    assert_eq!(v["round"], 2);
    // the agency's view is of round 2
    let (_, round) = r.call(&staff(), "/client-review/round", json!({}));
    assert_eq!(round["round"], 2);
    assert_eq!(round["reviewers"].as_array().unwrap().len(), 2);
}

#[test]
fn the_merged_view_flags_a_split_piece_and_two_pins_on_one_spot() {
    let r = Rig::locked_visual();
    r.three(REVIEW);
    // two pins close together on piece 1 by two reviewers; a far one by the third; a film moment pair
    r.comment(B_MAIL, B, json!({ "piece": 1, "pin": { "x": 0.40, "y": 0.40 }, "tag": "preference", "text": "Warmer" }));
    r.comment(C_MAIL, C, json!({ "piece": 1, "pin": { "x": 0.42, "y": 0.40 }, "tag": "preference", "text": "Cooler" }));
    r.comment(A_MAIL, A, json!({ "piece": 1, "pin": { "x": 0.90, "y": 0.90 }, "tag": "preference", "text": "Far away" }));
    r.comment(
        B_MAIL,
        B,
        json!({ "piece": 3, "pin": { "t_ms": 1000 }, "tag": "preference", "text": "Slow" }),
    );
    r.comment(
        C_MAIL,
        C,
        json!({ "piece": 3, "pin": { "t_ms": 2500 }, "tag": "preference", "text": "Quick" }),
    );
    r.comment(
        A_MAIL,
        A,
        json!({ "piece": 3, "pin": { "t_ms": 9000 }, "tag": "preference", "text": "Later" }),
    );
    // B approves piece 2 and C asks for changes on it; A approves it too
    let marks = |ok: bool| json!([{ "piece": 1, "answer": "approve" }, { "piece": 2, "answer": if ok { "approve" } else { "changes" } }, { "piece": 3, "answer": "approve" }]);
    let ans = |who: &str, id: &str, a: &str, m: Value| {
        r.call(
            &client(who),
            "/client-link/answer",
            json!({ "id": id, "answer": a, "said": "ok", "pieces": m }),
        )
    };
    assert_eq!(ans(B_MAIL, B, "confirm", marks(true)).0, 200);
    assert_eq!(ans(C_MAIL, C, "changes", marks(false)).0, 200);
    let (s, v) = r.call(&staff(), "/client-review/round", json!({}));
    assert_eq!(s, 200, "{v}");
    let comments = v["comments"].as_array().unwrap();
    assert_eq!(comments.len(), 6);
    // ordered by piece, then position
    let order: Vec<&str> = comments
        .iter()
        .map(|c| c["text"].as_str().unwrap())
        .collect();
    assert_eq!(
        order,
        ["Warmer", "Cooler", "Far away", "Slow", "Quick", "Later"]
    );
    let flags = |t: &str| -> Vec<String> {
        comments.iter().find(|c| c["text"] == t).unwrap()["flags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f.as_str().unwrap().to_string())
            .collect()
    };
    assert!(flags("Warmer").contains(&"same spot".to_string()));
    assert!(flags("Cooler").contains(&"same spot".to_string()));
    assert!(!flags("Far away").contains(&"same spot".to_string()));
    assert!(
        flags("Slow").contains(&"same spot".to_string()),
        "within 2 seconds on a film"
    );
    assert!(flags("Quick").contains(&"same spot".to_string()));
    assert!(!flags("Later").contains(&"same spot".to_string()));
    // a piece one approved and another asked to change
    let pieces = v["pieces"].as_array().unwrap();
    assert_eq!(pieces[1]["split"], true);
    assert_eq!(pieces[0]["split"], false);
    // the agency sees every reviewer, with who counts
    let who: Vec<(&str, bool)> = v["reviewers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["role"].as_str().unwrap(), r["counts"].as_bool().unwrap()))
        .collect();
    assert!(who.contains(&("approver", false)));
}

#[test]
fn a_client_actor_reaches_the_client_routes_and_no_others() {
    let src = include_str!("../src/routes.rs");
    let mut paths: Vec<String> = Vec::new();
    for line in src.lines() {
        let t = line.trim();
        if !t.starts_with("\"/") || !t.contains("=>") {
            continue;
        }
        for part in t.split("=>").next().unwrap().split('|') {
            let p = part.trim().trim_matches('"');
            if p.starts_with('/') && !p.contains(' ') {
                paths.push(p.to_string());
            }
        }
    }
    for must in [
        "/client-link/issue-round",
        "/client-review/round",
        "/client-link/comment",
        "/client-link/comment-withdraw",
        "/client-link/piece",
    ] {
        assert!(
            paths.iter().any(|p| p == must),
            "{must} is in the table read"
        );
    }
    let r = Rig::locked_brief();
    r.three(REVIEW);
    let before = std::fs::read(r.id.as_str()).unwrap();
    let allowed = napkin_host::ops::client_link::CLIENT_ROUTES;
    // the list is exactly the five the contract names
    let mut names = allowed.to_vec();
    names.sort();
    assert_eq!(
        names,
        [
            "/client-link/answer",
            "/client-link/comment",
            "/client-link/comment-withdraw",
            "/client-link/piece",
            "/client-link/state"
        ]
    );
    for p in &paths {
        let (s, _) = r.call(&client(A_MAIL), p, json!({}));
        if allowed.contains(&p.as_str()) {
            assert_ne!(s, 403, "{p} is the client's");
        } else {
            assert_eq!(s, 403, "{p} must refuse a client actor");
        }
    }
    assert_eq!(
        std::fs::read(r.id.as_str()).unwrap(),
        before,
        "nothing was written"
    );
}

#[test]
fn a_client_actor_writes_only_the_answer_and_the_comment() {
    // every decision kind a person can write is refused to a client on every route but the five
    let r = Rig::locked_brief();
    r.three(REVIEW);
    for (path, body) in [
        ("/approve", json!({})),
        ("/sign", json!({})),
        (
            "/patch-data",
            json!({ "agent": "x", "action": "y", "patch": { "a": 1 } }),
        ),
        ("/client-review", json!({ "answer": "accepted" })),
        ("/client-link/issue", json!({ "id": A })),
        ("/client-link/withdraw", json!({ "id": A })),
        ("/client-review/reopen", json!({})),
    ] {
        assert_eq!(r.call(&client(A_MAIL), path, body).0, 403, "{path}");
    }
}

#[test]
fn a_chain_with_the_new_actions_reads_under_the_phase_one_state_function() {
    // rollback: the older code ignores the new records and still reads the chain
    let r = Rig::locked_brief();
    r.three(REVIEW);
    r.comment(
        B_MAIL,
        B,
        json!({ "piece": 1, "tag": "preference", "text": "x" }),
    );
    r.call(
        &client(C_MAIL),
        "/client-link/answer",
        json!({ "id": C, "answer": "confirm" }),
    );
    let (s, v) = r.call(&staff(), "/decisions", json!({}));
    assert_eq!(s, 200, "{v}");
    assert_eq!(r.call(&staff(), "/client-link/list", json!({})).0, 200);
}

#[test]
fn a_comment_never_reaches_the_agent_context() {
    // the chain goes to the middleware as agent context; what a client typed into a link does not
    let r = Rig::locked_brief();
    r.three(REVIEW);
    r.comment(
        B_MAIL,
        B,
        json!({ "piece": 1, "tag": "preference", "text": "MARKER_NEVER_IN_A_PROMPT" }),
    );
    r.call(
        &client(C_MAIL),
        "/client-link/answer",
        json!({ "id": C, "answer": "changes", "said": "MARKER_ADVICE_SAID" }),
    );
    r.call(
        &client(A_MAIL),
        "/client-link/answer",
        json!({ "id": A, "answer": "changes", "said": "MARKER_APPROVER_SAID" }),
    );
    // the chain does hold them (the agency reads them there) ...
    let chain = serde_yaml::to_string(&r.chain()).unwrap();
    assert!(chain.contains("MARKER_NEVER_IN_A_PROMPT") && chain.contains("MARKER_APPROVER_SAID"));
    // ... and the context sent for a run does not
    let sent = r.session.clan_context_for_agent().to_string();
    for m in [
        "MARKER_NEVER_IN_A_PROMPT",
        "MARKER_ADVICE_SAID",
        "MARKER_APPROVER_SAID",
    ] {
        assert!(
            !sent.contains(m),
            "{m} is outsider text and stays out of a prompt"
        );
    }
}
