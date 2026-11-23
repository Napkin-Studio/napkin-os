"""territories-spinoff-out-deck: a Deck spun off from a Territories document reads what came through (LESSONS 7, 11, 14, 15).

Two tests carry the weight. ``test_every_carried_field_reaches_the_deck_reader`` names each field a route carries and finds it in stage c, in the
gate-2 screen's payload and on the built slides (a field that travels and is read by nobody fails here). ``test_a_live_run_from_territories_*``
runs the real ``run_deck`` live with the model stubbed, through all three gates, and checks that no model is asked for stage c, that the sent routes
are gate 2's territories with the judge's first pre-picked, and that the person's pick changes the route the idea is written from.

The document is the Territories tool's own greenlight fixture (invented brand Linea): ``app/templates/territories/example/states/greenlight_open.json``.
"""
from __future__ import annotations

import copy
import json
import time
from pathlib import Path

import pytest

from deck import assemble, from_territory as ft, inputs, profiles, server, spec, stages
from deck import run_state as rs

ROOT = Path(__file__).resolve().parents[3]
STATE = ROOT / "app" / "templates" / "territories" / "example" / "states" / "greenlight_open.json"
FERN = Path(__file__).parent / "fixtures" / "fernley"
FILES = {"a0": "a0_intake.json", "a": "a_requirements.json", "b": "b_storyline.json", "insight_judge": "insight_judge.json",
         "c": "c_territories.json", "d": "d_idea.json", "e": "e_copy.json", "fit": "fit.json", "red_team": "red_team.json"}
INPUTS = {"prompt": {"text": (FERN / "prompt.txt").read_text().strip(), "client": "Linea Rail (FICTIONAL)", "project": "Linea Weekend 2027", "agency": ""},
          "kind": "agency", "format": "pitch", "deck_type": {"id": "agency_pitch", "by": "person", "at": "t"}}
DOC = "terr-doc-1"


def territories(sent=("t_started", "t_passenger"), not_chosen=("t_sunday",)) -> dict:
    """The greenlight fixture with the sends the person made: two routes to Deck Maker."""
    d = json.loads(STATE.read_text())
    by = {t["id"]: t for t in d["territories"]}
    d["greenlit"] = [{"territory_id": i, "by": "Shrey", "at": "2026-11-18T10:05:00Z", "rests_on_derived": [], "derived_resolution": "verified"} for i in (*sent, *not_chosen)]
    d["sends"] = [{"id": "snd_deck", "to": "deck-maker", "territory_ids": list(sent), "not_chosen": list(not_chosen), "by": "Shrey",
                   "at": "2026-11-18T10:20:00Z", "status": "sent"}]
    # one route with a frame by link and stated rights, one with a frame and none, one gap: the picture words are the tests'
    by["t_started"]["pictures"].append({"id": "pic_started_f1", "touchpoint": "poster", "kind": "frame", "image": "sha256:" + "a" * 64, "sha256": "a" * 64, "rights": "licensed"})
    by["t_started"]["pictures"].append({"id": "pic_started_f2", "touchpoint": "story", "kind": "frame", "image": "sha256:" + "b" * 64, "sha256": "b" * 64, "rights": "unknown"})
    by["t_passenger"]["pictures"].append({"id": "pic_pass_gap", "touchpoint": "email", "kind": "gap", "gap_reason": "No picture was made for the email."})
    return d


# ── the reader ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_every_carried_field_reaches_the_deck_reader():
    doc = territories()
    c = ft.stage_c_from_document(DOC, doc)
    by = {t["id"]: t for t in doc["territories"]}
    assert [t["id"] for t in c["territories"]] == ["t_started", "t_passenger"]          # judge rank 1, then 2: the routes SENT, not all greenlit
    assert c["ranking"]["order"] == ["t_started", "t_passenger"] and c["chosen"] == "t_started"
    assert "flagged for Gate 2" in c["chosen_by"]
    assert c["from_territories"] == {"document": DOC, "count": 2, "greenlit_by": "Shrey", "not_chosen": 1, "held_back": 0,
                                     "names": ["Already Started", "Passenger Seat"] if by["t_passenger"]["name"] == "Passenger Seat" else [by["t_started"]["name"], by["t_passenger"]["name"]]}
    for row in c["territories"]:
        t = by[row["id"]]
        assert row["name"] == t["name"] and row["thought"] == t["thought"] and row["why"] == t["why"] and row["sketch"] == t["sketch"]
        assert row["risks"] == "; ".join(t["risks"])                                  # a list becomes the sentence the slide holds
        assert row["rank"] == t["rank"] and row["tier"] == t["tier"] and row["band"] == t["band"]
        words = row["their_words"]
        assert words and len(words) <= ft.MAX_WORDS
        w = t["world"]
        assert set(words) <= {*w["headlines"].values(), *w["lines"]}
        assert words[0] in w["headlines"].values()                                      # the world's own words, not invented ones
        assert row["checked"] == [x["text"] for x in t["checks"] if x["status"] == "ok"][:4]
        assert row["evidence"] == t["evidence"]
    # pictures: sketches are mock-ups, a frame carries STATED rights only, unknown reads Rights to supply, a gap says why
    p = {t["id"]: t["pictures"] for t in c["territories"]}
    assert p["t_started"]["mock_ups"] == 8 and "mock-up sketches, not finished pictures" in p["t_started"]["line"]
    assert {(f["sha256"][0], f["rights"]) for f in p["t_started"]["frames"]} == {("a", "Licensed"), ("b", ft.RIGHTS_TO_SUPPLY)}
    assert "rights: Licensed, Rights to supply" in p["t_started"]["line"]
    assert p["t_passenger"]["gaps"][0]["gap"] == "No picture was made for the email."
    assert all("image" not in f for r in p.values() for f in r.get("frames", []))           # a link (the hash), never bytes or a path

    # the gate-2 screen reads the same rows
    cdir = Path(__import__("tempfile").mkdtemp())
    (cdir / "c_territories.json").write_text(json.dumps(c))
    g = rs.gate_payload("territories", cdir)
    assert [x["id"] for x in g["territories"]] == ["t_started", "t_passenger"] and g["first_pick"] == "t_started"
    assert [x["name"] for x in g["territories"]] == c["from_territories"]["names"]

    # and the slides say what came through: names, their lines, what was checked, the pictures' status, the count
    slides = _slides(c)
    text = json.dumps(slides, ensure_ascii=False)
    for row in c["territories"]:
        assert row["name"] in text and row["their_words"][0] in text and row["checked"][0] in text
    terr_slides = [s for s in slides if s["type"] == "territory"]
    assert len(terr_slides) == 2
    assert "2 routes from Territories, greenlit by Shrey" in text and "1 more was not chosen" in text
    assert "mock-up sketches, not finished pictures" in text and "Rights to supply" in text
    assert "Licensed" in text


def _slides(c: dict) -> list:
    """Stage c in the deck's own assembler: the territory slides and the recommendation, with the rest of the deck from the Fernley recording."""
    st = {k: json.loads((FERN / "stages" / fn).read_text()) for k, fn in FILES.items() if k in ("a", "b", "d") and (FERN / "stages" / fn).exists()}
    st["c"] = c
    inp = inputs.load(None, None, Path("/nonexistent/doc_facts.json"), [], prompt_text=INPUTS["prompt"]["text"], answers={}, verified={})
    deck = assemble.build(inp, st, client="Linea Rail", project="Linea Weekend 2027")
    return [deck["slides"][i] for i in deck["order"]]


def test_a_route_that_was_not_sent_or_was_killed_never_travels():
    doc = territories()
    assert "t_sunday" not in {t["id"] for t in ft.stage_c_from_document(DOC, doc)["territories"]}
    for t in doc["territories"]:
        if t["id"] == "t_passenger":
            t["status"] = "killed"
    assert [t["id"] for t in ft.stage_c_from_document(DOC, doc)["territories"]] == ["t_started"]
    doc["sends"][0]["territory_ids"] = ["t_passenger"]
    with pytest.raises(ft.FromTerritoryError, match="no greenlit route"):
        ft.stage_c_from_document(DOC, doc)


def test_without_a_send_the_greenlit_routes_go_and_at_most_five():
    doc = territories()
    doc["sends"] = []
    doc["greenlit"] = [{"territory_id": t["id"], "by": "Shrey"} for t in doc["territories"] if t.get("state") == "developed"]   # eight routes greenlit
    c = ft.stage_c_from_document(DOC, doc)
    assert len(c["territories"]) == ft.MAX_ROUTES == 5
    assert c["from_territories"]["held_back"] == 3
    assert [t["rank"] for t in c["territories"]] == [1, 2, 3, 4, 5]


def test_unranked_routes_follow_the_ranked_in_the_order_they_were_sent():
    doc = territories(sent=("t_breakfast", "t_sunday", "t_ride"), not_chosen=())
    assert [t["id"] for t in ft.stage_c_from_document(DOC, doc)["territories"]] == ["t_sunday", "t_breakfast", "t_ride"]


def test_text_that_leaks_never_reaches_a_slide():
    doc = territories()
    t = next(x for x in doc["territories"] if x["id"] == "t_started")
    t["mood"], t["world"]["lines"][0] = "Warm (to confirm)", "**bold** line"
    t["why"] = "field is null"
    row = ft.stage_c_from_document(DOC, doc)["territories"][0]
    assert "mood" not in row and "**bold** line" not in row["their_words"] and row["why"] == t["tension"]


def test_the_carried_document_is_neither_the_brief_nor_the_research():
    doc = territories()
    brief = {"background": "Linea rail", "objectives": "More weekend returns"}
    got = inputs.from_upstream({"upstream": {DOC: doc, "brief-1": brief}}, {})
    assert got.brief["objectives"]["value"] == "More weekend returns" and got.coverage.get("brief_source") != "none"
    assert ft.carried({"upstream": {"brief-1": brief, DOC: doc}}) == (DOC, doc)
    assert ft.carried({"upstream": {"brief-1": brief}}) is None
    assert inputs.is_territories(doc) and not inputs.is_territories(brief) and not inputs.is_territories({"app": "production-tool"})


def test_a_recorded_stage_c_is_never_overwritten(tmp_path, monkeypatch):
    s = _server(tmp_path, monkeypatch)
    rec = {"stage": "c", "territories": [{"id": "x", "name": "Recorded", "thought": "t", "why": "w", "risks": "r", "sketch": "s", "mood": "m"}],
           "ranking": {"order": ["x"], "reasons": {}, "by": "recorded"}, "chosen": "x"}
    stages_dir = Path(tmp_path / "runs" / DOC / "stages")
    stages_dir.mkdir(parents=True)
    (stages_dir / "c_territories.json").write_text(json.dumps(rec))
    v = _go(s, {}, DOC)
    v = _go(s, _approve("storyline"), DOC)
    assert json.loads((stages_dir / "c_territories.json").read_text())["territories"][0]["name"] == "Recorded"
    assert v["run"]["stage"] == "territories"


# ── the live run, model stubbed ────────────────────────────────────────────────────────────────────────────────────────────

def _approve(*gates, picked=None):
    out = {g: {"by": "human:sai", "at": "t", "decision": "approve"} for g in gates}
    if picked:
        out["territories"]["picked"] = picked
    return out


def _server(tmp_path, monkeypatch, asked=None, users=None):
    monkeypatch.setattr(spec, "RECIPES", True)
    monkeypatch.setattr(spec, "LOOK_V3", True)
    assert profiles.recipes_on()

    def fake_call(stage, user, system):
        if asked is not None:
            asked.append(stage)
        if users is not None:
            users[stage] = user
        obj = json.loads((FERN / "stages" / FILES.get(stage, "c_territories.json" if stage == "c_judge" else "x")).read_text())
        if stage == "c_judge":
            obj = obj["ranking"]
        return obj, {"usd": 0.01, "calls": 1, "model": "stub"}

    monkeypatch.setattr(stages, "_call", fake_call)
    return server.Server(server.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_LIVE": "1", "NAPKIN_DECK_MAX_USD": "5", "NAPKIN_DECK_PORT": "0"}))


def _go(s, approvals, doc=DOC, tu=True, data=None):
    body = {"doc": doc, "inputs": INPUTS, "approvals": approvals, "mode": "live", "render": False}
    if tu:
        body["territories_upstream"] = {"id": "src-territories", "data": data or territories()}
    v = s.run(body)
    end = time.time() + 120
    while s.busy and time.time() < end:
        time.sleep(0.05)
    return s.view(s.docs[doc]) if v else None


def test_a_live_run_from_territories_passes_all_three_gates_with_the_routes_sent(tmp_path, monkeypatch):
    asked, users = [], {}
    s = _server(tmp_path, monkeypatch, asked, users)
    v = _go(s, {})
    assert v["state"] == "gate" and v["run"]["stage"] == "storyline", v["run"].get("error")
    v = _go(s, _approve("storyline"))
    assert v["state"] == "gate" and v["run"]["stage"] == "territories", v["run"].get("error")
    assert "c" not in asked and "c_judge" not in asked                      # no model wrote or ranked the territories: the person's routes are used
    gate = v["run"]["gate"]
    assert [t["id"] for t in gate["territories"]] == ["t_started", "t_passenger"] and gate["first_pick"] == "t_started"
    assert gate["territories"][0]["name"] == "Already Started"
    # gate 2: the person changes the pick; the idea is written from THAT route, with its own words beside it
    v = _go(s, _approve("storyline", "territories", picked="t_passenger"))
    assert v["state"] == "gate" and v["run"]["stage"] == "idea", v["run"].get("error")
    assert "c" not in asked and "d" in asked
    sent_to_d = users["d"]
    assert "t_passenger" in sent_to_d and "their_words" in sent_to_d and "t_started" not in sent_to_d.split("<requirements>")[0].split("<territory>")[1]
    assert v["run"]["gate"]["idea"]["territory_id"] == "t_passenger"
    v = _go(s, _approve("storyline", "territories", "idea", picked="t_passenger"))
    assert v["state"] != "failed", v["run"].get("error")


def test_the_pre_picked_route_is_the_judges_first_when_the_person_changes_nothing(tmp_path, monkeypatch):
    asked, users = [], {}
    s = _server(tmp_path, monkeypatch, asked, users)
    _go(s, {})
    _go(s, _approve("storyline"))
    v = _go(s, _approve("storyline", "territories"))
    assert v["state"] == "gate" and v["run"]["stage"] == "idea" and v["run"]["gate"]["idea"]["territory_id"] == "t_started"


def test_a_deck_with_no_territories_upstream_still_asks_the_model(tmp_path, monkeypatch):
    asked = []
    s = _server(tmp_path, monkeypatch, asked)
    _go(s, {}, "plain", tu=False)
    _go(s, _approve("storyline"), "plain", tu=False)
    assert "c" in asked


def test_a_bad_territories_upstream_is_refused_not_ignored():
    with pytest.raises(server.Refused):
        server.territories_upstream({"territories_upstream": {"id": "x", "data": {"app": "production-tool"}}})
    assert server.territories_upstream({}) is None


def test_one_greenlit_route_skips_gate_2_and_the_idea_is_the_routes(tmp_path, monkeypatch):
    """The owner (2026-11-23): one tool per job. With one route carried there is nothing to pick: no gate 2 and no model call for the territories; the
    idea stage starts from the route and the model's framing never replaces the route's line or thought."""
    asked, users = [], {}
    s = _server(tmp_path, monkeypatch, asked, users)
    one = territories(sent=("t_started",), not_chosen=("t_sunday", "t_passenger"))
    route = next(t for t in one["territories"] if t["id"] == "t_started")
    v = _go(s, {}, data=one)
    assert v["state"] == "gate" and v["run"]["stage"] == "storyline"
    v = _go(s, _approve("storyline"), data=one)
    assert v["state"] == "gate" and v["run"]["stage"] == "idea", v["run"].get("error")     # straight past gate 2
    assert "c" not in asked and "c_judge" not in asked and "d" in asked
    assert "their_words" in users["d"] and "<fixed_idea>" in users["d"] and route["thought"] in users["d"]
    idea = json.loads(next(iter((tmp_path / "runs" / DOC).glob("*/stages/d_idea.json"))).read_text())
    assert idea["idea"] == route["thought"] and idea["campaign_line"] in (*route["world"]["headlines"].values(), *route["world"]["lines"])
    assert idea["idea_from"]["territory"] == "t_started"
    assert idea["chain"]["idea_phrase"] in idea["idea"]
    assert v["run"]["gate"]["idea"]["territory_id"] == "t_started"
    v = _go(s, _approve("storyline", "idea"), data=one)                                  # no territories approval is ever asked
    assert v["state"] != "failed", v["run"].get("error")


def test_two_routes_still_hold_gate_2_and_a_deck_with_none_asks_the_model(tmp_path, monkeypatch):
    asked = []
    s = _server(tmp_path, monkeypatch, asked)
    _go(s, {})
    v = _go(s, _approve("storyline"))
    assert v["run"]["stage"] == "territories" and "c" not in asked
    assert server.auto_gates(Path(tmp_path)) == frozenset()                               # no stage c there: nothing is skipped
