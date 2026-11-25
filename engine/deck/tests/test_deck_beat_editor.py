"""deck-beat-editor: the person's storyline at gate 1, applied to stage b with no model call, and built into the deck.

Owner (2026-11-25): "Mock approved." A reworded beat keeps its section's evidence; a beat the person added is never moved by the
12-slide cap; reordering beats reorders the slides within the story (the investment and the ask stay last); deleting the only home
of a mandatory warns and moves it. No model call and no client material: the fixtures are invented.
Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests/test_deck_beat_editor.py``.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import jsonschema
import pytest

from deck import assemble, inputs, profiles, run_state, spec, stages, validate
from deck import storyline_edit as se

HERE = Path(__file__).parent
TYPES = HERE / "fixtures" / "types"
FERN = HERE / "fixtures" / "fernley" / "stages"
FILES = {"a0": "a0_intake.json", "a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
AGENCY_TYPES = ("agency_pitch", "creative_work", "tender_response", "credentials")


def _st(pid: str) -> dict:
    return {k: json.loads((TYPES / pid / f).read_text()) for k, f in FILES.items() if (TYPES / pid / f).exists()}


def _raw(pid: str) -> bytes:
    return (TYPES / pid / "b_storyline.json").read_bytes()


def _edit(raw: bytes, beats: list) -> dict:
    return {"base": se.sha_bytes(raw), "beats": beats, "by": "human:test", "at": "2026-11-25T10:00:00"}


def _build(pid: str, st: dict) -> dict:
    inp = inputs.load(None, prompt_text=(TYPES / pid / "prompt.txt").read_text().strip())
    return assemble.build(inp, st, client="Fixture Client", project="Fixture Project", profile=profiles.load(pid))


def _presented(deck: dict) -> list[dict]:
    return [deck["slides"][s] for s in validate.presented(deck)]


# ---------------------------------------------------------------- the edit itself

@pytest.mark.parametrize("edit, words", [
    (None, "must be an object"),
    ({"beats": [{"key": "reframe", "title": "x"}]}, "names no storyline"),
    ({"base": "a" * 64, "beats": []}, "at least one beat"),
    ({"base": "a" * 64, "beats": [{"key": "reframe", "title": "  "}]}, "has no words"),
    ({"base": "a" * 64, "beats": [{"key": "reframe", "title": "x" * (se.TITLE_MAX + 1)}]}, "longer than"),
    ({"base": "a" * 64, "beats": [{"key": "reframe", "title": "x"}, {"key": "reframe", "title": "y"}]}, "repeats"),
    ({"base": "a" * 64, "beats": [{"key": "Bad Key", "title": "x"}]}, "names no section"),
    ({"base": "a" * 64, "beats": [{"key": None, "title": "x"}] * (se.BEATS_MAX + 1)}, f"at most {se.BEATS_MAX}"),
])
def test_an_edit_that_cannot_be_applied_is_refused_in_words(edit, words):
    with pytest.raises(se.EditRefused, match=words):
        se.check(edit)


def test_reword_keeps_the_evidence_delete_takes_out_add_is_the_persons_and_the_order_is_kept():
    raw = _raw("agency_pitch")
    b = json.loads(raw)
    edit = _edit(raw, [{"key": "audience", "title": b["audience"]["title"]},
                       {"key": "reframe", "title": "The real question is   whether the tap can feel like yours"},
                       {"key": None, "title": "People already trust their tap more than they say"}])
    new = se.apply(b, edit, se.sha_bytes(raw))
    assert new["reframe"]["title"] == "The real question is whether the tap can feel like yours" and new["reframe"]["person_words"] is True
    assert new["reframe"]["claims"] == b["reframe"]["claims"]   # owner: a reworded beat keeps its section's evidence
    assert "person_words" not in new["audience"] and "insight" not in new
    assert new["person"]["order"] == ["audience", "reframe", "p1"] and new["person"]["deleted"] == ["insight"]
    assert new["person"]["beats"] == [{"id": "p1", "title": "People already trust their tap more than they say"}]
    assert new["person"]["reworded"] == ["reframe"] and b["reframe"]["title"] != new["reframe"]["title"], "the agents' dict is not changed"
    assert se.applied(new, edit) and not se.applied(b, edit)


def test_an_edit_made_against_another_storyline_or_naming_a_missing_beat_is_refused():
    raw = _raw("agency_pitch")
    b = json.loads(raw)
    with pytest.raises(se.StaleEdit, match="changed since you edited it"):
        se.apply(b, _edit(b"another storyline", [{"key": "reframe", "title": "x"}]), se.sha_bytes(raw))
    with pytest.raises(se.EditRefused, match="does not have"):
        se.apply(b, _edit(raw, [{"key": "gap_chart", "title": "x"}]), se.sha_bytes(raw))


# ---------------------------------------------------------------- gate 1 as the page reads it

def test_gate_one_names_each_beat_its_storyline_and_the_mandatories_it_states(tmp_path):
    shutil.copytree(FERN, tmp_path, dirs_exist_ok=True)
    a = json.loads((tmp_path / "a_requirements.json").read_text())
    a["requirements"].append({"id": "r_mand", "kind": "mandatory", "text": "Show the logo on every piece", "ref": "brief:mandatories"})
    (tmp_path / "a_requirements.json").write_text(json.dumps(a))
    b = json.loads((tmp_path / "b_storyline.json").read_text())
    b["barrier"].setdefault("points", [{"text": "x", "refs": []}])[0]["refs"].append("req:r_mand")
    (tmp_path / "b_storyline.json").write_text(json.dumps(b))
    g = run_state.gate_payload("storyline", tmp_path)
    assert g["editable"] is True and g["base"] == se.sha_bytes((tmp_path / "b_storyline.json").read_bytes())
    assert [x["key"] for x in g["beats"]] == ["reframe", "gap_chart", "barrier", "insight", "audience"]
    assert {x["words"] for x in g["beats"]} == {"agents"}
    barrier = next(x for x in g["beats"] if x["key"] == "barrier")
    assert barrier["carries"] == [{"id": "r_mand", "text": "Show the logo on every piece", "to": "the guardrails slide"}]


def test_gate_one_after_the_edit_shows_the_persons_order_and_words(tmp_path):
    raw = _raw("agency_pitch")
    new = se.apply(json.loads(raw), _edit(raw, [{"key": None, "title": "Mine first"}, {"key": "insight", "title": "Water is loved and ignored, said my way"}]),
                   se.sha_bytes(raw))
    beats = run_state.beats(new)
    assert [(x["key"], x["words"], x["n"]) for x in beats] == [(None, "yours", "01"), ("insight", "yours", "02")]
    assert beats[0]["src"] == "Your words · no source yet" and beats[1]["src"].startswith("Your words · evidence kept: ")


def test_an_investor_story_is_not_offered_for_editing(tmp_path):
    (tmp_path / "i_investor.json").write_text(json.dumps({"problem": {"title": "A problem", "refs": []}}))
    g = run_state.gate_payload("storyline", tmp_path)
    assert g["beats"] and "editable" not in g and "base" not in g


# ---------------------------------------------------------------- the deck built from it

@pytest.mark.parametrize("pid", AGENCY_TYPES)
def test_every_agency_type_builds_the_persons_storyline(pid):
    st, raw = _st(pid), _raw(pid)
    st["b"] = se.apply(st["b"], _edit(raw, [{"key": "audience", "title": st["b"]["audience"]["title"]},
                                            {"key": "reframe", "title": "My reworded real question"},
                                            {"key": None, "title": "A point of my own"}]), se.sha_bytes(raw))
    deck = _build(pid, st)
    shown = _presented(deck)
    types = [x["type"] for x in shown]
    titles = [x["title"] for x in shown]
    assert "insight" not in [x["type"] for x in deck["slides"].values()], "a beat taken out has no slide standing in for it"
    assert "My reworded real question" in titles
    mine = next(x for x in shown if x["type"] == "person_beat")
    assert mine["title"] == "A point of my own" and mine["status"] == "needs_human" and mine["claims"][0]["basis"] == "opinion"
    assert types.index("audience") < types.index("real_question") < types.index("person_beat"), "the slides follow the person's order"
    assert not any(k in x for x in deck["slides"].values() for k in ("beat", "beat_kept")) and "storyline_order" not in deck["meta"]
    jsonschema.validate(deck, json.loads((Path(spec.__file__).parent / "deck.schema.json").read_text()))
    ends = [t for t in types if t in ("investment", "next_step", "ask")]
    assert not ends or types.index(ends[-1]) > types.index("person_beat"), "the investment and the ask stay last"


def test_a_beat_the_person_added_is_never_moved_by_the_cap():
    st, raw = _st("agency_pitch"), _raw("agency_pitch")
    keep = [{"key": k, "title": st["b"][k]["title"]} for k in se.section_keys(st["b"])]
    added = [{"key": None, "title": f"My point number {i}"} for i in range(1, 6)]
    st["b"] = se.apply(st["b"], _edit(raw, keep + added), se.sha_bytes(raw))
    deck = _build("agency_pitch", st)
    shown = [x["title"] for x in _presented(deck)]
    assert all(f"My point number {i}" in shown for i in range(1, 6))
    assert len(shown) > spec.PITCH_CAP, "past the cap because of the person's beats: they stay, the agents' slides moved first"


def test_reordering_moves_the_story_slides_only_within_their_slots():
    raw = _raw("agency_pitch")

    def built(order):
        st = _st("agency_pitch")
        st["b"] = se.apply(st["b"], _edit(raw, [{"key": k, "title": st["b"][k]["title"]} for k in order]), se.sha_bytes(raw))
        return [x["type"] for x in _presented(_build("agency_pitch", st))]
    keys = se.section_keys(json.loads(raw))
    same, flipped = built(keys), built(list(reversed(keys)))
    story = {"real_question", "insight", "audience"}
    assert [t for t in same if t not in story] == [t for t in flipped if t not in story], "every other slide keeps its place"
    assert [i for i, t in enumerate(same) if t in story] == [i for i, t in enumerate(flipped) if t in story], "the beats keep their slots"
    assert [t for t in flipped if t in story] == ["audience", "insight", "real_question"]
    assert flipped[-1] == "investment" or "investment" not in flipped


def test_a_deleted_beat_that_stated_a_mandatory_leaves_it_on_the_guardrails_slide():
    st, raw = _st("agency_pitch"), _raw("agency_pitch")
    st["a"]["requirements"].append({"id": "r_mand", "kind": "mandatory", "text": "Show the logo on every piece", "ref": "brief:mandatories"})
    st["b"]["reframe"].setdefault("claims", []).append({"text": "The logo shows on every piece.", "refs": ["req:r_mand"]})
    raw = json.dumps(st["b"]).encode()
    assert se.mandatories(st["b"]["reframe"], st["a"]["requirements"])[0]["to"] == "the guardrails slide"
    st["b"] = se.apply(st["b"], _edit(raw, [{"key": k, "title": st["b"][k]["title"]} for k in se.section_keys(st["b"]) if k != "reframe"]),
                       se.sha_bytes(raw))
    deck = _build("agency_pitch", st)
    said = json.dumps([s for s in deck["slides"].values() if "r_mand" in s["requirements"]])
    assert "Show the logo on every piece" in said, "the mandatory is still said, on the slide that lists every mandatory"


def test_stage_c_reads_the_persons_storyline(monkeypatch):
    """Live: the territories are written from the storyline as the person left it (the whole stage b goes to stage c)."""
    st, raw = _st("agency_pitch"), _raw("agency_pitch")
    st["b"] = se.apply(st["b"], _edit(raw, [{"key": None, "title": "Only my beat"}]), se.sha_bytes(raw))
    seen = []
    monkeypatch.setattr(stages, "_call", lambda stage, user, system: (seen.append(user), ({"territories": [], "order": []}, {}))[1])
    stages.territories(None, st)
    assert "Only my beat" in seen[0] and "Water is loved" not in seen[0]


# ---------------------------------------------------------------- the server: applied on approval, before stage c, with no model call

@pytest.fixture
def engine(tmp_path):
    import threading
    from deck import server as srv
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_REPLAY": str(FERN), "NAPKIN_DECK_PORT": "0"})
    httpd = srv.serve(cfg)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield type("E", (), {"base": f"http://127.0.0.1:{httpd.server_address[1]}", "dir": tmp_path / "runs"})
    httpd.shutdown()


def _call(base, path, body=None):
    import urllib.error
    import urllib.request
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def _settle(base, doc="d1"):
    import time
    end = time.time() + 30
    while time.time() < end:
        _, v = _call(base, f"/run/{doc}")
        if v["state"] in ("gate", "done", "failed"):
            return v
        time.sleep(0.05)
    raise AssertionError("the run did not settle")


FERN_INPUTS = {"prompt": {"text": (FERN.parent / "prompt.txt").read_text().strip(), "client": "Fernley Drinks Ltd (FICTIONAL)", "project": "Fernley Tea 2027",
                          "agency": ""}, "kind": "agency", "format": "pitch"}


def _run(e, approvals, **kw):
    return _call(e.base, "/run", {"doc": "d1", "inputs": FERN_INPUTS, "approvals": approvals, "mode": "replay", "render": False, **kw})


def test_the_server_applies_the_persons_storyline_on_approval_and_the_deck_follows_it(engine, monkeypatch):
    from deck import stages as stg
    monkeypatch.setattr(stg, "_call", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no model call")))
    _run(engine, {})
    g = _settle(engine.base)["run"]["gate"]
    assert g["editable"] is True
    keys = [b["key"] for b in g["beats"]]
    edit = {"base": g["base"], "by": "human:test", "at": "t",
            "beats": [{"key": "audience", "title": "We talk to 18 to 34 year olds who drink iced coffee all summer"},
                      {"key": "reframe", "title": next(b["title"] for b in g["beats"] if b["key"] == "reframe")},
                      {"key": None, "title": "Summer tea has to feel like a choice, not a compromise"}]
            + [{"key": k, "title": next(b["title"] for b in g["beats"] if b["key"] == k)} for k in keys if k not in ("audience", "reframe", "barrier")]}
    yes = {"storyline": {"decision": "approve"}}
    status, _ = _run(engine, yes, storyline_edit=edit)
    assert status == 202
    v = _settle(engine.base)
    assert v["run"]["gate"]["id"] == "territories", v
    assert any("your storyline shapes the deck's story slides" in n for n in v["notices"])
    st = next(engine.dir.glob("d1/*/stages"))
    b = json.loads((st / "b_storyline.json").read_text())
    assert b["person"]["order"][:3] == ["audience", "reframe", "p1"] and "barrier" not in b
    assert (st / "b_storyline.agents.json").exists() and "barrier" in json.loads((st / "b_storyline.agents.json").read_text())
    # approving again with the same edit changes nothing (the edit is recognised as applied)
    before = (st / "b_storyline.json").read_bytes()
    yes2 = {**yes, "territories": {"decision": "approve"}}
    _run(engine, yes2, storyline_edit=edit); _settle(engine.base)
    assert (st / "b_storyline.json").read_bytes() == before
    yes3 = {**yes2, "idea": {"decision": "approve"}}
    _run(engine, yes3, storyline_edit=edit)
    v = _settle(engine.base)
    assert v["state"] == "done", v
    deck = v["payload"]["deck"]
    shown = [deck["slides"][s] for s in validate.presented(deck)]
    titles = [x["title"] for x in shown]
    assert "We talk to 18 to 34 year olds who drink iced coffee all summer" in titles
    assert "Summer tea has to feel like a choice, not a compromise" in titles
    assert titles.index("We talk to 18 to 34 year olds who drink iced coffee all summer") < titles.index("Summer tea has to feel like a choice, not a compromise")


def test_an_edit_against_another_storyline_is_refused_before_anything_runs(engine):
    _run(engine, {})
    g = _settle(engine.base)["run"]["gate"]
    status, body = _run(engine, {"storyline": {"decision": "approve"}},
                        storyline_edit={"base": "f" * 64, "beats": [{"key": g["beats"][0]["key"], "title": "x"}]})
    assert status == 409 and body["error"]["type"] == "storyline_changed" and "changed since you edited it" in body["error"]["message"]
    assert not list(engine.dir.glob("d1/*/stages/c_territories.json"))
    status, body = _run(engine, {}, storyline_edit={"base": "f" * 64, "beats": []})
    assert status == 400 and "at least one beat" in body["error"]["message"]


def test_no_later_step_rewords_the_persons_words_or_reorders_their_beats():
    """Found on the local stack (2026-11-25): stage e narrowed the person's reworded headline ('may hold them back'). Their words
    stay; the narrower headline goes to the slide's notes. The red team neither rewords nor moves the person's beats."""
    st, raw = _st("agency_pitch"), _raw("agency_pitch")
    mine = "Water is loved, and everyone already says so"
    st["b"] = se.apply(st["b"], _edit(raw, [{"key": "insight", "title": mine}, {"key": "reframe", "title": st["b"]["reframe"]["title"]},
                                            {"key": None, "title": "My own point"}]), se.sha_bytes(raw))
    deck = _build("agency_pitch", st)
    assert deck["meta"]["storyline"]["yours"] == [mine, "My own point"]
    sid = next(s for s in deck["order"] if deck["slides"][s]["title"] == mine)
    deck["fit"] = {"verdicts": [{"title": mine, "verdict": "not", "reason": "r"}]}
    out = assemble.apply_narrowing(deck, [{"slide": mine, "headline": "Water may be loved", "reason": "softer"}])
    assert out == {"applied": 0, "rejected": 1} and deck["slides"][sid]["title"] == mine
    assert "Water may be loved" in deck["slides"][sid]["notes"]
    ok, why, _, _ = assemble._rt_wording(deck, sid, {"text": "Water is loved"})
    assert not ok and "own words" in why and deck["slides"][sid]["title"] == mine
    pres = validate.presented(deck)
    ids = {deck["slides"][s]["title"]: s for s in pres}
    ok, why, _, _ = assemble._rt_order(deck, sid, {"after": deck["slides"][pres[-1]]["title"]}, ids)
    assert not ok and "order" in why
