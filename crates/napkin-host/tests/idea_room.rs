//! The Idea room's host operations (features/idea-room.clan): humans first, early opening, cards and votes,
//! routes as forks and their merge with no model, and the creative director's pick. Each test is a fact the
//! design's `done_when` names. The gate is read from the decision chain by the host, never from the page.

use std::sync::Arc;

use clan_sdk::{
    merge::MergeReport, patch_data_namespaced, ClanBuilder, ClanFile, Decision, DecisionChain,
};
use napkin_host::ops::{gate, ideas};
use napkin_host::{handle, Actor, Ctx, DocId, Document, FsStore, HostRequest, NoConfig, Session};
use serde_json::{json, Value};

struct Rig {
    dir: tempfile::TempDir,
    id: DocId,
}

fn brief_copy() -> Value {
    json!({
        "insight": "Younger drinkers think Irish whiskey is for someone else.",
        "single_minded_proposition": "The easy way into Irish whiskey.",
        "signers": [
            { "role": "planner", "person": "aoife@wk" },
            { "role": "creative_director", "person": "dara@wk" },
        ],
    })
}

/// An Idea room as the spin-off leaves it: the brief frozen under `upstream`, no cards yet.
fn room() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("room.clan"));
    let base = ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "Idea room, Client A".into(),
            brief: "an idea room".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut m = base.manifest().clone();
    m.app = Some(clan_sdk::AppInfo {
        home: None,
        name: "Idea room".into(),
        app_id: ideas::IDEA_ROOM.into(),
        version: "0.1.0".into(),
        icon: None,
        entry: "human/index.html".into(),
        schema: None,
        prompt_templates: vec![],
        data_seed: None,
        spinoff: None,
        attach: None,
    });
    let mut b = ClanBuilder::new(m);
    for (p, bytes) in base.read_all_entries().unwrap() {
        if p != clan_sdk::MANIFEST_PATH && p != "shared/data.yaml" {
            b.add_entry(p, bytes);
        }
    }
    b.add_entry(
        "shared/data.yaml",
        serde_yaml::to_string(&json!({ "upstream": { "doc_brief": brief_copy() } }))
            .unwrap()
            .into_bytes(),
    );
    b.add_entry(
        "app/pipeline.yaml",
        b"pipeline: napkin-idea-room\nhumans_first:\n  cards: 5\n".to_vec(),
    );
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    Rig { dir, id }
}

fn as_ctx(rig: &Rig, ctx: Ctx) -> Session {
    let s = Session::with_ctx(Arc::new(FsStore::new(rig.dir.path().to_path_buf())), ctx);
    s.open(rig.id.clone()).unwrap();
    s
}

fn person(rig: &Rig, who: &str) -> Session {
    as_ctx(rig, Ctx::new(Actor::human(who).unwrap()))
}

fn post(s: &Session, path: &str, body: Value) -> (u16, Value) {
    let r = handle(
        s,
        &NoConfig,
        HostRequest::new(path, "", body.to_string().into_bytes()),
    );
    (
        r.status,
        serde_json::from_slice(&r.body).unwrap_or(Value::Null),
    )
}

fn get(s: &Session, path: &str) -> Value {
    let r = handle(s, &NoConfig, HostRequest::new(path, "", Vec::new()));
    assert_eq!(r.status, 200, "{path}");
    serde_json::from_slice(&r.body).unwrap()
}

fn card(rig: &Rig, who: &str, text: &str) -> Value {
    let (status, v) = post(&person(rig, who), "/ideas/card", json!({ "text": text }));
    assert_eq!(status, 200, "{v}");
    v
}

fn writers() -> [&'static str; 5] {
    ["maeve@wk", "oisin@wk", "maeve@wk", "dara@wk", "oisin@wk"]
}

fn chain(rig: &Rig) -> DecisionChain {
    let clan = ClanFile::open(rig.id.as_str()).unwrap();
    DecisionChain::from_yaml(&clan.read_entry("agent/decision-chain.yaml").unwrap()).unwrap()
}

fn doc(rig: &Rig) -> Document {
    let store = FsStore::new(rig.dir.path().to_path_buf());
    Document::load(&store, rig.id.clone()).unwrap()
}

fn open_room(rig: &Rig) {
    for (i, w) in writers().iter().enumerate() {
        card(rig, w, &format!("An idea, number {}.", i + 1));
    }
}

#[test]
fn humans_first_four_cards_refuse_five_allow_and_a_handlers_card_does_not_count() {
    let rig = room();
    for (i, w) in writers().iter().take(4).enumerate() {
        card(&rig, w, &format!("An idea, number {}.", i + 1));
    }
    let g = get(&person(&rig, "maeve@wk"), "/ideas/gate");
    assert_eq!(
        (
            g["team_cards"].clone(),
            g["needed"].clone(),
            g["open"].clone()
        ),
        (json!(4), json!(5), json!(false))
    );
    assert_eq!(g["to_go"], 1);
    let refused = ideas::allow_model_task(&doc(&rig)).unwrap_err();
    assert_eq!(refused.status, 409);
    assert!(refused.message.starts_with("ideas_closed"), "{refused}");

    // A handler cannot write a card at all, so it cannot make the fifth.
    let handler = as_ctx(
        &rig,
        Ctx::new(Actor::process("job_1").unwrap()).with_handler("ban_default@1.0"),
    );
    let (status, v) = post(
        &handler,
        "/ideas/card",
        json!({ "text": "A card from a model." }),
    );
    assert_eq!(status, 403, "{v}");
    assert_eq!(
        get(&person(&rig, "maeve@wk"), "/ideas/gate")["team_cards"],
        4
    );

    // Neither can a patch: the page cannot write a card with the generic route either, and a card a
    // handler's decision made would not be counted (the count reads the chain).
    let (status, v) = post(
        &person(&rig, "maeve@wk"),
        "/patch-data",
        json!({ "agent": "human", "action": "edit", "patch": { "cards": { "c9": { "text": "x", "kind": "team", "by": "maeve@wk" } } } }),
    );
    assert_eq!(status, 403, "{v}");
    assert_eq!(
        get(&person(&rig, "maeve@wk"), "/ideas/gate")["team_cards"],
        4
    );

    // The fifth card, by a person, opens it.
    card(&rig, "oisin@wk", "The fifth idea.");
    let g = get(&person(&rig, "maeve@wk"), "/ideas/gate");
    assert_eq!(
        (
            g["team_cards"].clone(),
            g["open"].clone(),
            g["to_go"].clone()
        ),
        (json!(5), json!(true), json!(0))
    );
    assert_eq!(g["opened_via"], "cards");
    ideas::allow_model_task(&doc(&rig)).unwrap();

    // Every card names who wrote it, from the context, and carries the brief's own words.
    let data: Value = get(&person(&rig, "maeve@wk"), "/ideas/room")["data"].clone();
    let c1 = &data["cards"]["c1"];
    assert_eq!(c1["by"], "maeve@wk");
    assert_eq!(c1["kind"], "team");
    assert_eq!(
        c1["brief_link"]["proposition"],
        "The easy way into Irish whiskey."
    );
    assert_eq!(c1["votes"], json!([]));
    // Each card is one decision by a person.
    let made: Vec<_> = chain(&rig)
        .decisions
        .into_iter()
        .filter(|d| d.action == "idea_card")
        .collect();
    assert_eq!(made.len(), 5);
    assert!(made
        .iter()
        .all(|d| d.actor.as_deref().is_some_and(|a| a.starts_with("human:"))));
}

#[test]
fn only_the_creative_director_opens_it_early_and_with_a_reason() {
    let rig = room();
    card(&rig, "maeve@wk", "One idea.");
    let early = |who: &str, rationale: &str| {
        post(
            &person(&rig, who),
            "/ideas/open-early",
            json!({ "rationale": rationale }),
        )
    };
    assert_eq!(
        early("maeve@wk", "Early.").0,
        403,
        "a copywriter is refused"
    );
    assert_eq!(
        early("aoife@wk", "Early.").0,
        403,
        "the planner is not the creative director"
    );
    assert_eq!(early("dara@wk", "  ").0, 400, "an empty reason");
    assert!(
        ideas::allow_model_task(&doc(&rig)).is_err(),
        "nothing opened it yet"
    );
    let (status, v) = early("dara@wk", "The team asked for help.");
    assert_eq!(status, 200, "{v}");
    let g = get(&person(&rig, "dara@wk"), "/ideas/gate");
    assert_eq!(
        (
            g["open"].clone(),
            g["opened_by"].clone(),
            g["opened_via"].clone()
        ),
        (json!(true), json!("dara@wk"), json!("early"))
    );
    ideas::allow_model_task(&doc(&rig)).unwrap();
    let opened: Vec<_> = chain(&rig)
        .decisions
        .into_iter()
        .filter(|d| d.action == "open_early")
        .collect();
    assert_eq!(opened.len(), 1, "one decision");
    assert_eq!(opened[0].actor.as_deref(), Some("human:dara@wk"));
    assert_eq!(opened[0].rationale, "The team asked for help.");
    assert_eq!(early("dara@wk", "Again.").0, 409, "already open");
}

#[test]
fn votes_are_per_card_and_comments_name_their_writer() {
    let rig = room();
    card(&rig, "maeve@wk", "One song of silence.");
    let maeve = person(&rig, "maeve@wk");
    let (_, v) = post(&maeve, "/ideas/vote", json!({ "card": "c1" }));
    assert_eq!(
        (v["votes"].clone(), v["voted"].clone()),
        (json!(1), json!(true))
    );
    let (_, v) = post(
        &person(&rig, "oisin@wk"),
        "/ideas/vote",
        json!({ "card": "c1" }),
    );
    assert_eq!(v["votes"], 2);
    let (_, v) = post(
        &person(&rig, "oisin@wk"),
        "/ideas/vote",
        json!({ "card": "c1" }),
    );
    assert_eq!(
        (v["votes"].clone(), v["voted"].clone()),
        (json!(1), json!(false)),
        "a second press takes the vote back"
    );
    assert_eq!(
        post(&maeve, "/ideas/vote", json!({ "card": "nope" })).0,
        404
    );
    let (status, _) = post(
        &person(&rig, "oisin@wk"),
        "/ideas/comment",
        json!({ "card": "c1", "text": "The pour is the film." }),
    );
    assert_eq!(status, 200);
    let data = get(&person(&rig, "maeve@wk"), "/ideas/room")["data"].clone();
    assert_eq!(data["cards"]["c1"]["comments"][0]["by"], "oisin@wk");
}

/// The spike's findings made permanent: the host writes a route's branch through its own operation, two
/// people work one route, the SDK merge folds them with no model, a planted clash is listed with both sides.
#[test]
fn three_routes_are_three_forks_and_the_merge_calls_no_model() {
    let rig = room();
    let (status, v) = post(
        &person(&rig, "dara@wk"),
        "/ideas/routes/start",
        json!({ "routes": [{ "name": "a", "bet": "b", "cards": [] }, { "name": "c", "bet": "d", "cards": [] }] }),
    );
    assert_eq!(
        status, 409,
        "routes are made from the team's cards, so the room has to be open: {v}"
    );
    open_room(&rig);

    let routes = json!({ "routes": [
        { "name": "One song", "bet": "A bar goes quiet for one song.", "cards": ["c1", "c2"] },
        { "name": "The long pour", "bet": "The first pour takes a minute.", "cards": ["c3"] },
        { "name": "Last orders", "bet": "A bell that means something.", "cards": ["c4", "c5"] },
    ] });
    let dara = || person(&rig, "dara@wk");
    let (status, v) = post(&dara(), "/ideas/routes/start", routes.clone());
    assert_eq!(status, 200, "{v}");
    let dir = rig.dir.path();
    for n in 1..=3 {
        assert!(
            dir.join(format!("room.route_{n}.clan")).exists(),
            "branch {n}"
        );
    }
    // The room takes no write while routes are out, and starting again is refused.
    let (status, _) = post(
        &person(&rig, "maeve@wk"),
        "/ideas/card",
        json!({ "text": "Too late." }),
    );
    assert_eq!(status, 409);
    assert_eq!(post(&dara(), "/ideas/routes/start", routes).0, 409);
    assert_eq!(
        get(&dara(), "/ideas/gate")["routes_out"],
        json!(["route_1", "route_2", "route_3"])
    );

    // Two people work route_1 through the host.
    let edit = |who: &str, body: Value| post(&person(&rig, who), "/ideas/routes/edit", body);
    assert_eq!(
        edit(
            "maeve@wk",
            json!({ "route": "route_1", "bet": "A bar goes quiet, once a night." })
        )
        .0,
        200
    );
    let (status, v) = edit(
        "oisin@wk",
        json!({ "route": "route_1", "note": "The film is the pour." }),
    );
    assert_eq!((status, v["version"].clone()), (200, json!(3)), "{v}");
    assert_eq!(
        edit("maeve@wk", json!({ "route": "route_9", "note": "x" })).0,
        409
    );
    assert_eq!(edit("maeve@wk", json!({ "route": "route_1" })).0, 400);
    let (status, _) = edit("maeve@wk", json!({ "route": "route_1", "cards": ["c99"] }));
    assert_eq!(status, 404, "a route names cards that are in the room");
    // A handler cannot work a route.
    let handler = as_ctx(&rig, Ctx::new(Actor::process("job_1").unwrap()));
    assert_eq!(
        post(
            &handler,
            "/ideas/routes/edit",
            json!({ "route": "route_1", "note": "x" })
        )
        .0,
        403
    );

    // A planted clash: two branches wrote the same key outside their own.
    for (n, v) in [(2, "A"), (3, "B")] {
        let path = dir.join(format!("room.route_{n}.clan"));
        let b = ClanFile::open(path.to_str().unwrap()).unwrap();
        std::fs::write(
            &path,
            patch_data_namespaced(&b, &json!({ "shared_hook": v })).unwrap(),
        )
        .unwrap();
    }

    // Merge: nothing but the host and the SDK runs.
    let cd = || person(&rig, "dara@wk");
    let (status, v) = post(
        &cd(),
        "/merge",
        json!({ "branches": ["route-1", "route-2", "route-3"] }),
    );
    assert_eq!(status, 200, "{v}");
    let routes = v["routes"].as_object().unwrap();
    assert_eq!(routes.len(), 3, "the merged file holds all three");
    assert_eq!(routes["route_1"]["bet"], "A bar goes quiet, once a night.");
    assert_eq!(routes["route_1"]["notes"][0]["by"], "oisin@wk");
    assert_eq!(routes["route_1"]["version"], 3);
    let clashes = v["clashes"].as_array().unwrap();
    assert_eq!(clashes.len(), 1);
    assert_eq!(clashes[0]["key"], "shared_hook");
    assert_eq!(clashes[0]["left"]["value"], "B", "the winner is listed");
    assert_eq!(clashes[0]["right"]["value"], "A", "and the other side");

    // The chain shows the merge marker, and no handler or model entry anywhere in it.
    let c = chain(&rig);
    assert!(
        c.decisions.iter().any(|d| d.agent == "clan-merge"),
        "the merge marker"
    );
    assert!(c.decisions.iter().any(|d| d.action == "merge_routes"));
    for d in &c.decisions {
        assert!(
            d.handler.is_none() && d.backend.is_none(),
            "no handler or model entry: {d:?}"
        );
        assert!(
            !d.actor.as_deref().unwrap_or("").starts_with("process:"),
            "{d:?}"
        );
    }
    // Both people's edits are in the room's history, under their own names.
    let who: Vec<_> = c.decisions.iter().filter_map(|d| d.actor.clone()).collect();
    assert!(
        who.contains(&"human:maeve@wk".to_string()) && who.contains(&"human:oisin@wk".to_string())
    );
    // The report is in the file with the clash unsettled, the marker is gone, and the room takes writes again.
    let clan = ClanFile::open(rig.id.as_str()).unwrap();
    let report = MergeReport::from_yaml(&clan.read_entry("merge-report.yaml").unwrap()).unwrap();
    assert_eq!(report.unresolved, 1);
    assert_eq!(get(&cd(), "/ideas/gate")["routes_out"], json!([]));
    assert_eq!(
        post(
            &person(&rig, "maeve@wk"),
            "/ideas/card",
            json!({ "text": "After the merge." })
        )
        .0,
        200
    );

    // The pick will not go over a clash nobody settled.
    let (status, v) = post(
        &cd(),
        "/ideas/pick",
        json!({ "route": "route_1", "rationale": "The ritual." }),
    );
    assert_eq!(status, 409, "{v}");
    assert!(v["error"].as_str().unwrap().contains("shared_hook"), "{v}");
}

fn routes_and_merge(rig: &Rig) {
    open_room(rig);
    let (status, v) = post(
        &person(rig, "dara@wk"),
        "/ideas/routes/start",
        json!({ "routes": [
        { "name": "One song", "bet": "A bar goes quiet.", "cards": ["c1"] },
        { "name": "The long pour", "bet": "A slow first pour.", "cards": ["c2"] },
    ] }),
    );
    assert_eq!(status, 200, "{v}");
    let (status, v) = post(&person(rig, "dara@wk"), "/merge", json!({}));
    assert_eq!(status, 200, "{v}");
    assert_eq!(v["clashes"], json!([]));
}

#[test]
fn the_creative_director_picks_one_route_version_and_a_second_pick_supersedes_the_first() {
    let rig = room();
    routes_and_merge(&rig);
    let pick = |s: &Session, route: &str, why: &str| {
        post(
            s,
            "/ideas/pick",
            json!({ "route": route, "rationale": why }),
        )
    };

    assert_eq!(
        pick(&person(&rig, "maeve@wk"), "route_1", "I like it.").0,
        403,
        "a copywriter's pick"
    );
    assert_eq!(
        pick(&person(&rig, "aoife@wk"), "route_1", "I like it.").0,
        403,
        "the planner's"
    );
    let handler = as_ctx(
        &rig,
        Ctx::new(Actor::process("job_1").unwrap()).with_handler("judge@1.0"),
    );
    assert_eq!(
        pick(&handler, "route_1", "A model's pick.").0,
        403,
        "a handler context"
    );
    assert!(
        chain(&rig)
            .decisions
            .iter()
            .all(|d| d.action != "pick_route"),
        "nothing was written"
    );

    let dara = || person(&rig, "dara@wk");
    assert_eq!(pick(&dara(), "route_9", "x").0, 404);
    let (status, v) = pick(&dara(), "route_1", "The ritual is the idea.");
    assert_eq!(status, 200, "{v}");
    let picks: Vec<Decision> = chain(&rig)
        .decisions
        .into_iter()
        .filter(|d| d.action == "pick_route")
        .collect();
    assert_eq!(picks.len(), 1);
    let p = &picks[0];
    assert_eq!(p.kind.as_deref(), Some("verdict"));
    assert_eq!(p.polarity.as_deref(), Some("good"));
    assert_eq!(p.reason_code.as_deref(), Some("route.chosen"));
    assert_eq!(p.reviewer_role.as_deref(), Some("creative-director"));
    assert_eq!(p.actor.as_deref(), Some("human:dara@wk"));
    assert_eq!(p.version.as_deref(), Some("1"), "the route's version");
    assert!(p.targets[0].ends_with("#routes[route_1]"));
    let data = get(&person(&rig, "dara@wk"), "/ideas/room")["data"].clone();
    assert_eq!(data["chosen"]["route"], "route_1");
    assert_eq!(data["chosen"]["decision"], p.id.clone().unwrap());

    // The page cannot write the pick with a patch.
    let (status, _) = post(
        &dara(),
        "/patch-data",
        json!({ "agent": "human", "action": "edit", "patch": { "chosen": { "route": "route_2" } } }),
    );
    assert_eq!(status, 403);

    // A second pick needs a reason, and then replaces the first: both stay in the history.
    assert_eq!(pick(&dara(), "route_2", "").0, 400);
    assert_eq!(
        pick(&dara(), "route_2", "The client changed the budget.").0,
        200
    );
    let picks: Vec<Decision> = chain(&rig)
        .decisions
        .into_iter()
        .filter(|d| d.action == "pick_route")
        .collect();
    assert_eq!(picks.len(), 2, "the first pick is still there");
    let (newest, oldest) = (&picks[0], &picks[1]);
    assert_eq!(
        oldest.superseded_by, newest.id,
        "the second supersedes the first"
    );
    assert!(newest.superseded_by.is_none());
    assert_eq!(
        get(&person(&rig, "dara@wk"), "/ideas/room")["data"].clone()["chosen"]["route"],
        "route_2"
    );

    // Reopen: a reason, the live pick is replaced, nothing is chosen until the next pick.
    assert_eq!(
        post(
            &person(&rig, "maeve@wk"),
            "/ideas/reopen",
            json!({ "rationale": "x" })
        )
        .0,
        403
    );
    assert_eq!(
        post(&dara(), "/ideas/reopen", json!({ "rationale": "" })).0,
        400
    );
    assert_eq!(
        post(
            &dara(),
            "/ideas/reopen",
            json!({ "rationale": "Back to the team." })
        )
        .0,
        200
    );
    assert!(get(&person(&rig, "dara@wk"), "/ideas/room")["data"].clone()["chosen"].is_null());
    assert_eq!(
        chain(&rig)
            .decisions
            .iter()
            .filter(|d| d.action == "pick_route")
            .count(),
        2
    );
    assert!(chain(&rig)
        .decisions
        .iter()
        .filter(|d| d.action == "pick_route")
        .all(|d| d.superseded_by.is_some()));
    assert_eq!(
        post(&dara(), "/ideas/reopen", json!({ "rationale": "Again." })).0,
        409,
        "nothing to reopen"
    );
}

#[test]
fn a_model_task_is_refused_until_the_room_is_open() {
    let rig = room();
    // Not an Idea room at all.
    let other = tempfile::tempdir().unwrap();
    let plain = other.path().join("plain.clan");
    std::fs::write(
        &plain,
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "x".into(),
            brief: "x".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let store = FsStore::new(other.path().to_path_buf());
    let d = Document::load(&store, DocId::from(plain)).unwrap();
    assert_eq!(ideas::allow_model_task(&d).unwrap_err().status, 400);
    assert!(ideas::allow_model_task(&doc(&rig)).is_err());
}

/// Creative work starts only on a brief the client has confirmed; the host's spin-off check is the same
/// for every tool the brief is spun off into, the Idea room among them.
#[test]
fn a_room_is_spun_off_an_open_gate_brief_and_a_closed_one_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let id = DocId::from(dir.path().join("brief.clan"));
    let base = ClanFile::from_bytes(
        clan_sdk::create(clan_sdk::CreateOptions {
            title: "J001 brief".into(),
            brief: "a brief".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut m = base.manifest().clone();
    m.app = Some(clan_sdk::AppInfo {
        home: None,
        name: "Brief Maker".into(),
        app_id: gate::BRIEF_MAKER.into(),
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
    for (p, bytes) in base.read_all_entries().unwrap() {
        if p != clan_sdk::MANIFEST_PATH {
            b.add_entry(p, bytes);
        }
    }
    std::fs::write(id.as_str(), b.build().unwrap()).unwrap();
    // The gate is not enforced in this process unless the environment says so; this test file sets it only
    // for the closed brief, and a brief that passes everything (gate off) is the open one.
    let clan = ClanFile::open(id.as_str()).unwrap();
    std::env::set_var("NAPKIN_BRIEF_GATE", "off");
    gate::allow_spinoff(&id, &clan).expect("open gate: 200");
    std::env::set_var("NAPKIN_BRIEF_GATE", "on");
    let refused = gate::allow_spinoff(&id, &clan).unwrap_err();
    std::env::remove_var("NAPKIN_BRIEF_GATE");
    assert_eq!(refused.status, 409, "closed gate: 409");
}
