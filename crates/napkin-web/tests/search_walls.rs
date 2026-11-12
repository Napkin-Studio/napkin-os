// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The walls between the one bar (features/one-bar-search.clan) and the records built beside it: Judge
//! (features/judge.clan), the client review link (features/client-review-full.clan), the Idea room
//! (features/idea-room.clan) and the timesheet. The search index holds titles and listed facts only, so a
//! Judge score and its evidence, an overrule's reason, a reviewer's comment and email, a review link's ids,
//! an Idea room card and a timesheet line are found by nobody, whatever their role. Each is written by the
//! real operation, not planted.

use std::sync::Arc;

use axum::http::StatusCode;
use napkin_host::jobindex::JobIndex;
use napkin_host::ops::judge;
use napkin_host::searchindex::SearchIndex;
use napkin_host::{dispatch, Actor, Ctx, HostRequest, NoConfig, PartStore, Session};
use napkin_web::store::{doc_id, TenantStore};
use napkin_web::tenant::TenantId;
use serde_json::{json, Value};

mod search_support;
use search_support::*;

const EVIDENCE: &str = "qxjudgeevidence";
const REASON: &str = "qxoverrulereason";
const COMMENT: &str = "qxreviewercomment";
const REVIEWER: &str = "qxreviewer@client-a.example";
const CARD: &str = "qxideacardtext";
const TIMESHEET: &str = "qxtimesheetline";
const REVIEW: &str = "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3";
const LINK_A: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const LINK_B: &str = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";

fn ok(r: napkin_host::HostResponse, what: &str) {
    assert_eq!(
        r.status,
        200,
        "{what}: {}",
        String::from_utf8_lossy(&r.body)
    );
}

/// A Script editor document under J001 that sends work to Judge and carries its brief.
fn script(client: &str) -> Vec<u8> {
    let plain = bytes(&Doc {
        slug: "walls-script",
        title: "Walls radio script",
        app_id: "ie.napkin.script-editor",
        app_name: "Script editor",
        document_type: None,
        client,
        job: Some("J001"),
        updated: "2026-11-12T10:00:00Z",
        editors: &[],
        assets: &[],
        data: "format: radio\nslot_s: 30\nscript:\n  beats:\n    - { id: b1, kind: voice, role: FVO, text: Tonight try something new }\n  proposals: []\n  seq: 1\nupstream:\n  doc_brief:\n    single_minded_proposition: The easy way in.\n    insight: Younger drinkers think it is for someone else.\n    signers:\n      - { role: planner, person: planning@wk }\n      - { role: creative_director, person: creative-director@wk }\n",
    });
    let f = clan_sdk::ClanFile::from_bytes(plain).unwrap();
    let mut b = clan_sdk::ClanBuilder::new(f.manifest().clone());
    for (path, bytes) in f.read_all_entries().unwrap() {
        if path != clan_sdk::MANIFEST_PATH {
            b.add_entry(path, bytes);
        }
    }
    b.add_entry(
        "app/pipeline.yaml",
        b"pipeline: napkin-script-editor\nversion: 1\nrequest_kind: middleware\ntasks:\n  judge_work:\n    handler: judge_work@1\n    kind: script\n".to_vec(),
    );
    b.build().unwrap()
}

#[tokio::test]
async fn no_role_finds_a_verdict_a_reviewer_a_link_a_card_or_a_timesheet_line() {
    let r = rig();
    let client = seed(r.dir.path(), "wk");
    let dir = r.dir.path().join(TenantId::of_agency("wk").as_str());
    let store = Arc::new(TenantStore::new(dir.clone()));
    let id = doc_id("walls-script");
    store
        .apply(&napkin_host::Change::create(id.clone(), script(&client)))
        .unwrap();
    // an Idea room whose cards hold their words
    put(
        &store,
        &Doc {
            slug: "walls-ideas",
            title: "Walls idea room",
            app_id: "ie.napkin.idea-room",
            app_name: "Idea room",
            document_type: None,
            client: &client,
            job: Some("J001"),
            updated: "2026-11-12T10:00:00Z",
            editors: &["copywriter@wk"],
            assets: &[],
            data: &format!("cards:\n  c1:\n    text: {CARD} one song of silence\n    by: copywriter@wk\n    kind: team\n    comments:\n      - {{ by: art-director@wk, text: {CARD} }}\n"),
        },
    );

    // Judge scores the script (the middleware's answer, as the scoring route writes it) and the creative director overrules it
    let cd = Ctx::new(Actor::human("creative-director@wk").unwrap());
    let s = Session::with_ctx(store.clone(), cd.clone());
    s.open(id.clone()).unwrap();
    let p = s.read(|d| judge::prepare(&*store, &cd, d, None)).unwrap();
    let tests: Vec<Value> = judge::rubric()
        .tests_for(p.piece.kind.id())
        .iter()
        .enumerate()
        .map(|(i, t)| json!({ "id": t.id, "value": if i % 3 == 0 { "fail" } else { "pass" }, "evidence": format!("{EVIDENCE} {}", t.id) }))
        .collect();
    let t = judge::tally(p.piece.kind, &tests).unwrap();
    let answered = judge::Answered {
        handler: "judge_work@1.0".into(),
        backend: "fixture".into(),
        model: None,
        prompt_hash: None,
        rubric_version: judge::rubric().version.clone(),
        price_eur: 0.0,
    };
    s.perform(&Ctx::new(Actor::process("judge").unwrap()), |c, d| {
        judge::score_outcome(c, d, &p, &t, &answered, "none")
    })
    .unwrap();
    s.perform(&cd, |c, d| {
        judge::overrule(&*store, c, d, &json!({ "reason": REASON, "route": "cd" }))
    })
    .unwrap();

    // it is locked and sent to two reviewers, and one comments
    let post = |who: &Ctx, path: &str, body: Value| {
        dispatch(
            who,
            &s,
            &NoConfig,
            HostRequest::new(path, "", body.to_string().into_bytes()),
        )
    };
    ok(post(&cd, "/approve", json!({})), "lock");
    let expires = (chrono::Utc::now() + chrono::Duration::days(20))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    ok(
        post(
            &Ctx::new(Actor::human("account-service@wk").unwrap()),
            "/client-link/issue-round",
            json!({ "review": REVIEW, "expires": expires, "reviewers": [
                { "id": LINK_A, "name": "Alex", "email": "approver@client-a.example", "approver": true },
                { "id": LINK_B, "name": "Bea", "email": REVIEWER },
            ] }),
        ),
        "issue the round",
    );
    ok(
        post(
            &Ctx::new(Actor::client(REVIEWER).unwrap()),
            "/client-link/comment",
            json!({ "id": LINK_B, "piece": 1, "tag": "preference", "text": format!("{COMMENT} too long") }),
        ),
        "comment",
    );

    // a timesheet line, written by the person through the API
    let planner = sign_in(&r, "planning@wk").await;
    let (st, body, _, _) = call(
        &r,
        "POST",
        &format!("/api/t/{}/timesheet/lines", planner.tenant),
        Some(&planner.cookie),
        Some(json!({ "date": "2026-11-12", "job": "J001", "label": format!("{TIMESHEET} script"), "minutes": 30 })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{body}");

    // the document holds them all, so the seed is real
    let chain = String::from_utf8_lossy(&post(&cd, "/chain", json!({})).body).to_string();
    assert!(
        chain.contains(EVIDENCE)
            && chain.contains(REASON)
            && chain.contains(COMMENT)
            && chain.contains(REVIEWER),
        "the chain holds the verdict, the overrule, the comment and the reviewer: {chain}"
    );

    // the index itself holds none of them
    let index = SearchIndex::build(
        &*store,
        &JobIndex::build(&*store, chrono::Utc::now()).unwrap(),
    )
    .unwrap();
    let wire = serde_json::to_string(&index).unwrap().to_lowercase();
    for never in [
        EVIDENCE, REASON, COMMENT, REVIEWER, "client:", CARD, TIMESHEET, REVIEW, LINK_A, LINK_B,
    ] {
        assert!(!wire.contains(never), "the search index holds {never}");
    }
    assert!(wire.contains("walls radio script") && wire.contains("walls idea room"));

    // and no role finds them, while every role that finds the two documents finds them by their titles
    for role in ROLES {
        let p = sign_in(&r, &format!("{role}@wk")).await;
        for q in [
            EVIDENCE,
            REASON,
            COMMENT,
            "qxreviewer",
            CARD,
            TIMESHEET,
            REVIEW,
            LINK_A,
            LINK_B,
            "score",
            "overruled",
            "evidence",
        ] {
            let (st, ids, total, v) = search(&r, &p, q).await;
            assert_eq!(st, StatusCode::OK);
            assert_eq!(
                (ids.len(), total),
                (0, 0),
                "{role} searched {q} and found {v}"
            );
        }
        let (_, ids, _, v) = search(&r, &p, "walls").await;
        let mut want = vec![
            "doc-walls-script".to_string(),
            "doc-walls-ideas".to_string(),
        ];
        want.sort();
        let mut got = ids.clone();
        got.sort();
        assert_eq!(got, want, "{role}");
        let text = v.to_string().to_lowercase();
        for never in [EVIDENCE, REASON, COMMENT, REVIEWER, CARD, TIMESHEET] {
            assert!(!text.contains(never), "{role} was sent {never}: {v}");
        }
    }
}
