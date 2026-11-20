"""deck-handoffs: a person's edits, retries and own ideas at the gates (deck.gate_edits), the tissue-session kit and the client's reactions
(deck.tissue), and the production brief (deck.production_brief). No model, no network: every fixture is invented (the Lumen Water gate
recording, fixtures/lumen_gate). Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests/test_handoffs.py``."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from deck import gate_edits as ge
from deck import production_brief as pb
from deck import server as srv
from deck import tissue

LUMEN = Path(__file__).parent / "fixtures" / "lumen_gate" / "stages"
AT = "2026-11-20T10:00:00Z"


@pytest.fixture
def stages(tmp_path):
    d = tmp_path / "stages"
    shutil.copytree(LUMEN, d)
    return d


def rd(stages, name):
    return json.loads((stages / name).read_text())


def req(rid, gate, kind, **kw):
    return {"id": rid, "gate": gate, "kind": kind, "by": "human:sai", "at": AT, **kw}


# ---------------------------------------------------------------- edit

def test_an_edit_changes_only_the_words_named_marks_them_human_and_removes_what_comes_after(stages):
    (stages / "fit.json").write_text("{}")
    out = ge.apply(stages, [req("r1", "storyline", "edit", edits={"proposition": "Your tap has a story.", "insight": "We love water we never see."})], live=False)
    assert out["handled"] == ["r1"]
    b = rd(stages, "b_storyline.json")
    assert b["proposition"]["line"] == "Your tap has a story." and b["insight"]["title"] == "We love water we never see."
    assert b["proposition"]["rtbs"], "what was not edited stays"
    assert not (stages / "c_territories.json").exists() and not (stages / "d_idea.json").exists() and not (stages / "fit.json").exists()
    led = ge.read_ledger(stages)
    e = {x["key"]: x for x in led["edits"]}
    assert e["proposition"]["before"] is None and e["proposition"]["after"] == "Your tap has a story." and e["proposition"]["by"] == "human:sai"
    assert e["insight"]["before"] == "Water is loved and ignored in the same breath"
    assert set(led["reopened"]) == {"territories", "idea"}, "the gates whose stages were removed wait for a new approval"
    assert ge.view(stages)["requests"]["r1"]["status"] == "done"


def test_a_territory_edit_and_an_idea_edit(stages):
    ge.apply(stages, [req("r1", "territories", "edit", edits={"territory.t1.name": "The Tap Remembers"})], live=False)
    assert rd(stages, "c_territories.json")["territories"][0]["name"] == "The Tap Remembers"
    assert not (stages / "d_idea.json").exists()
    shutil.copy(LUMEN / "d_idea.json", stages / "d_idea.json")
    ge.apply(stages, [req("r2", "idea", "edit", edits={"line": "Every tap, a story.", "idea": "Each home hears its own water."})], live=False)
    d = rd(stages, "d_idea.json")
    assert d["campaign_line"] == "Every tap, a story." and d["idea"] == "Each home hears its own water." and d["executions"]


def test_a_human_edit_is_never_overwritten_when_the_stage_is_written_again(stages):
    ge.apply(stages, [req("r1", "idea", "edit", edits={"line": "Every tap, a story."})], live=False)
    shutil.copy(LUMEN / "d_idea.json", stages / "d_idea.json")   # the model writes stage d again
    assert rd(stages, "d_idea.json")["campaign_line"] == "Every drop has a story."
    assert ge.reapply(stages) == ["line"]
    assert rd(stages, "d_idea.json")["campaign_line"] == "Every tap, a story."


@pytest.mark.parametrize("bad,msg", [
    (req("r1", "storyline", "edit", edits={"line": "x"}), "you can change"),
    (req("r1", "territories", "edit", edits={"territory.t1.refs": "x"}), "territory's"),
    (req("r1", "idea", "edit", edits={"line": "  "}), "empty"),
    (req("r1", "idea", "edit"), "names the words"),
    (req("r1", "storyline", "own", own={"line": "x", "idea": "y"}), "territories gate"),
    (req("r1", "idea", "own", own={"line": "x"}), "needs line and idea"),
    (req("r 1", "idea", "retry"), "needs an id"),
    (req("r1", "budget", "edit", edits={}), "gate must be"),
])
def test_requests_the_engine_will_not_take_are_refused_in_words(bad, msg):
    with pytest.raises(ge.EditError, match=msg):
        ge.check_request(bad)


def test_an_edit_of_a_territory_that_is_not_there_is_refused_and_recorded(stages):
    out = ge.apply(stages, [req("r1", "territories", "edit", edits={"territory.t9.name": "x"})], live=False)
    assert out["handled"] == ["r1"] and "no territory t9" in ge.view(stages)["requests"]["r1"]["message"]
    assert (stages / "d_idea.json").exists(), "a refused request changes nothing"


def test_each_request_is_acted_on_once_and_waits_until_its_stage_is_written(stages):
    (stages / "d_idea.json").unlink()
    r = req("r1", "idea", "edit", edits={"line": "Every tap, a story."})
    assert ge.apply(stages, [r], live=False)["handled"] == [], "stage d is not written yet: the request waits"
    shutil.copy(LUMEN / "d_idea.json", stages / "d_idea.json")
    assert ge.apply(stages, [r], live=False)["handled"] == ["r1"]
    assert ge.apply(stages, [r], live=False)["handled"] == [], "already handled"


# ---------------------------------------------------------------- retry, own

def test_a_retry_is_live_only_and_queues_the_note_once(stages):
    ge.apply(stages, [req("r1", "territories", "retry", note="Braver, please")], live=False)
    assert ge.view(stages)["requests"]["r1"]["status"] == "refused" and (stages / "c_territories.json").exists()
    out = ge.apply(stages, [req("r2", "territories", "retry", note="Braver, please")], live=True)
    assert not (stages / "c_territories.json").exists() and not (stages / "d_idea.json").exists()
    assert "Braver, please" in out["notes"]["c"] and ge.read_ledger(stages)["reopened"]["territories"] == AT
    assert "Braver, please" in ge.take_notes(stages)["c"] and ge.take_notes(stages) == {}, "a note is read once"


def test_bring_your_own_route_becomes_the_pick_and_survives_a_rewrite(stages):
    own = {"name": "Water Diary", "thought": "Households keep a week's water diary.", "why": "Makes use visible"}
    ge.apply(stages, [req("r1", "territories", "own", own=own)], live=False)
    c = rd(stages, "c_territories.json")
    assert c["chosen"] == "t_own_1" and c["chosen_by"].startswith("brought by human:sai")
    t = c["territories"][-1]
    assert t["origin"] == "human" and t["name"] == "Water Diary"
    assert not (stages / "d_idea.json").exists()
    shutil.copy(LUMEN / "c_territories.json", stages / "c_territories.json")   # stage c written again
    ge.reapply(stages)
    c = rd(stages, "c_territories.json")
    assert c["chosen"] == "t_own_1" and any(t["id"] == "t_own_1" for t in c["territories"])


def test_bring_your_own_idea_pins_the_line_and_rewrites_stage_d_around_it(stages):
    own = {"line": "Listen to your tap.", "idea": "Every household hears the story of its own water."}
    out = ge.apply(stages, [req("r1", "idea", "own", own=own)], live=True)
    assert not (stages / "d_idea.json").exists() and "Listen to your tap." in out["notes"]["d"]
    shutil.copy(LUMEN / "d_idea.json", stages / "d_idea.json")   # the model's stage d, written around the idea
    ge.reapply(stages)
    d = rd(stages, "d_idea.json")
    assert d["campaign_line"] == "Listen to your tap." and d["idea"] == own["idea"]


def test_bring_your_own_idea_in_a_replay_puts_the_words_in_and_says_the_executions_are_recorded(stages):
    out = ge.apply(stages, [req("r1", "idea", "own", own={"line": "Listen to your tap.", "idea": "Hear your water."})], live=False)
    assert rd(stages, "d_idea.json")["campaign_line"] == "Listen to your tap." and "Replay" in out["notices"][0]


def test_an_old_approval_does_not_count_for_a_reopened_gate():
    reopened = {"territories": AT}
    assert ge.approval_counts("territories", {"decision": "approve", "at": "2026-11-20T09:00:00Z"}, reopened) is False
    assert ge.approval_counts("territories", {"decision": "approve", "at": "2026-11-20T11:00:00Z"}, reopened) is True
    assert ge.approval_counts("storyline", {"decision": "approve"}, reopened) is True
    present = {"b_storyline.json", "c_territories.json"}
    old = {"storyline": {"decision": "approve"}, "territories": {"decision": "approve", "at": "2026-11-19T09:00:00Z"}}
    assert srv.plan_segment("agency", present, old, reopened=reopened) == (None, "territories")
    assert srv.plan_segment("agency", present, old) == ("d", None)


def test_with_notes_adds_the_note_to_the_named_stage_once():
    from deck import stages as st
    seen = []
    orig = st._call
    st._call = lambda stage, user, system: (seen.append((stage, user)), ({}, {}))[1]
    try:
        undo = srv.Server.with_notes({"c": "\n<person_note>braver</person_note>"})
        st._call("b", "story", "sys")
        st._call("c", "routes", "sys")
        st._call("c", "routes again", "sys")
        undo()
    finally:
        st._call = orig
    assert seen == [("b", "story"), ("c", "routes\n<person_note>braver</person_note>"), ("c", "routes again")]


# ---------------------------------------------------------------- the tissue kit

def test_the_tissue_kit_has_one_page_per_route_and_a_reactions_sheet(stages, tmp_path):
    res = tissue.write_kit(stages, tmp_path / "out", "Lumen Water (invented)", "Tap campaign")
    kit = json.loads((tmp_path / "out" / "tissue.json").read_text())
    assert [r["id"] for r in kit["routes"]] == ["t1"] and res["files"] == ["tissue.html", "tissue.json", "reactions.json"]
    r = kit["routes"][0]
    assert r["line"] == "A tap whispers a household memory" and r["key_visual"]["description"] and r["execution"]["channel"]
    assert r["execution"]["drafted"] is True and r["key_visual"]["picture"] is None
    page = (tmp_path / "out" / "tissue.html").read_text()
    assert "Reactions sheet" in page and "Not for us" in page and "<script" not in page
    assert json.loads((tmp_path / "out" / "reactions.json").read_text()) == {"by": "", "at": "", "routes": {"t1": {"verdict": None, "comments": ""}}}


def test_the_kit_escapes_the_words_and_takes_a_picture_when_the_territory_tool_made_one(stages, tmp_path):
    c = rd(stages, "c_territories.json")
    c["territories"][0]["name"] = "<img src=x onerror=alert(1)>"
    (stages / "c_territories.json").write_text(json.dumps(c))
    (stages / "assets").mkdir()
    (stages / "assets" / "abc.png").write_bytes(b"png")
    (stages / "frames.json").write_text(json.dumps({"frames": {"k1": {"territory": "t1", "status": "made", "file": "assets/abc.png", "subject": "A tap at dawn"}}}))
    tissue.write_kit(stages, tmp_path / "out")
    page = (tmp_path / "out" / "tissue.html").read_text()
    assert "<img src=x" not in page and "&lt;img" in page and 'src="assets/abc.png"' in page and (tmp_path / "out" / "assets" / "abc.png").exists()


def _three(stages):
    c = rd(stages, "c_territories.json")
    c["territories"] += [{"id": "t2", "name": "Water Week", "thought": "b", "sketch": "s2"}, {"id": "t3", "name": "Tap Talk", "thought": "c", "sketch": "s3"}]
    c["ranking"] = {"order": ["t1", "t2", "t3"]}
    (stages / "c_territories.json").write_text(json.dumps(c))
    (stages / "d_idea.json").unlink()


def test_reactions_make_the_loved_route_the_recommendation_and_feed_stage_d(stages):
    _three(stages)
    r = tissue.check_reactions({"by": "client", "at": AT, "routes": {"t1": {"verdict": "like"}, "t2": {"verdict": "not_for_us", "comments": "too worthy"},
                                                                     "t3": {"verdict": "love", "comments": "more humour, keep the tap"}}})
    res = tissue.apply_reactions(stages, r)
    c = rd(stages, "c_territories.json")
    assert res == {"chosen": "t3", "changed": True} and c["chosen"] == "t3" and c["chosen_by"].startswith("the client at the tissue session")
    assert c["tissue_reactions"] == r
    notes = tissue.reaction_notes(r, c)
    assert notes.index("Tap Talk (the route you develop)") < notes.index("Water Week") and "more humour" in notes and "too worthy" in notes


def test_reactions_tie_goes_to_the_judge_order_and_nothing_liked_changes_nothing(stages):
    _three(stages)
    both = tissue.check_reactions({"routes": {"t3": {"verdict": "love"}, "t2": {"verdict": "love"}}})
    assert tissue.winner(both, rd(stages, "c_territories.json")) == "t2"
    none = tissue.check_reactions({"routes": {"t1": {"verdict": "not_for_us", "comments": "no"}}})
    assert tissue.winner(none, rd(stages, "c_territories.json")) is None
    assert tissue.check_reactions({"routes": {"t1": {"verdict": None, "comments": ""}}}) is None
    with pytest.raises(ValueError, match="love, like or not_for_us"):
        tissue.check_reactions({"routes": {"t1": {"verdict": "meh"}}})


# ---------------------------------------------------------------- the production brief

def test_the_production_brief_has_deliverables_formats_rights_and_timing_and_a_valid_spine(stages, tmp_path):
    d = rd(stages, "d_idea.json")
    d["executions"].append({"id": "E9", "channel": "Social video", "role": "Reach", "copy": ["Hear it."], "visual": {"kind": "image_prompt", "prompt": "A phone by a tap"}})
    d["executions"].append({"id": "E10", "channel": "Radio", "role": "Remind", "copy": ["Listen."]})
    d["timeline"] = [{"phase": "Live", "when": "Spring 2027"}]
    d["script"] = {"length_s": 30, "lines": [{"t": "0-5", "vo": "Your tap has a story.", "sfx": "Drip"}]}   # stage d's new field, read defensively
    (stages / "d_idea.json").write_text(json.dumps(d))
    res = pb.write(stages, tmp_path / "out", "Lumen Water (invented)", "Tap campaign", market="Ireland",
                   human_edits=[{"key": "line", "after": "Every drop has a story.", "by": "human:sai", "at": AT}])
    j = json.loads((tmp_path / "out" / "production_brief.json").read_text())
    assert res["deliverables"] == 3 and j["for"] == "ie.napkin.production-tool" and j["status"] == "proposal"
    lanes = {x["id"]: x for x in j["deliverables"]}
    assert lanes["E9"]["lane"] == "social" and lanes["E9"]["formats"][0]["format_id"] == "meta-reels-9x16" and lanes["E9"]["lengths_s"] == [15, 6]
    assert lanes["E10"]["lane"] == "audio" and lanes["E10"]["formats"] == [] and lanes["E10"]["lengths_s"] == [30, 20]
    assert j["rights"]["territory"] == "Ireland" and j["rights"]["term"] == "[To supply]" and set(j["rights"]["needs"]) >= {"music", "voice", "talent"}
    assert j["timing"] == [{"phase": "Live", "when": "Spring 2027"}] and j["script"]["length_s"] == 30
    assert j["mandatories"] == ["Show the Lumen Water logo on every execution"] and j["concept"]["key_visual"]["label"] == "Illustrative"
    spine = j["spine"]   # Production contract 3 briefSpine: only its keys, each within its length
    assert set(spine) <= {"insight", "proposition", "audience", "tone", "feel", "mandatories", "donts", "format"}
    assert all(len(spine[k]) <= pb.SPINE_MAX[k] for k in pb.SPINE_MAX if k in spine) and all(len(m) <= 120 for m in spine["mandatories"])
    md = (tmp_path / "out" / "production_brief.md").read_text()
    assert "## Deliverables" in md and "## Rights needs" in md and "Written by people" in md and "VO: Your tap has a story." in md


def test_the_brief_prefers_a_production_final_the_client_may_see(stages):
    (stages / "production.json").write_text(json.dumps({"items": {
        "fset#master": {"role": "master", "rights": "reference_only", "client_showable": False, "sha256": "a" * 64},
        "size_1": {"role": "size", "rights": "generated", "client_showable": True, "final": {"id": "final_x"}, "sha256": "b" * 64, "width": 1080, "height": 1350}}}))
    kv = pb.build(stages)["concept"]["key_visual"]
    assert kv["source"] == "production" and kv["item"] == "size_1" and kv["final"] is True and kv["label"] == "Final"


def test_no_approved_idea_no_brief_and_lanes_from_words(stages):
    (stages / "d_idea.json").unlink()
    with pytest.raises(ValueError, match="no approved idea"):
        pb.build(stages)
    assert [pb.lane_of(w) for w in ("Social video (proposed)", "Outdoor posters near shops", "TV spot", "Point of sale at the chiller", "Podcast read", "Search")] == \
        ["social", "ooh", "film", "print", "audio", "other"]
    assert pb.cut("one two three four", 9) == "one two…"
