"""Show the work (spec.SHOW_WORK, deck/show_work.py): the presented story in agency order, the idea and at least two executions in the
first ten slides on both paths and every deck type that has an idea, one routes slide with the recommendation marked, and stage b's own
single-minded proposition on the proposition slide (no fallback label; a missing one is a validation error).

Round 3 of the blind judging found the work at slides 11-13 of 19-20 (path B) and trimmed away inside a sketch's ten (path A).
Offline: no model, no LibreOffice. Every brand, brief and stage output is invented. The suite runs with DECK_SHOW_WORK=0 (conftest), so
each test turns it on."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from deck import assemble, inputs, profiles, show_work, spec, validate

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "lumen_water"
TYPES = HERE / "fixtures" / "types"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
LINE = "Looking after water starts at your own tap"
ORDER = ["title", "brief_gaps", "objective", "insight", "proposition", "territory_choice", "idea", "execution", "execution", "next_step"]


@pytest.fixture
def on(monkeypatch):
    """Show the work on, with the features it ships with."""
    for f in ("SHOW_WORK", "FINISH", "BRIEF_GAPS", "LOOK_V3"):
        monkeypatch.setattr(spec, f, True)


def _st(folder: Path) -> dict:
    return {k: json.loads((folder / f).read_text()) for k, f in FILES.items() if (folder / f).exists()}


def _rich(st: dict, line: str | None = LINE, n_exec: int = 4) -> dict:
    """Invented stage outputs with three routes, ``n_exec`` executions and, unless None, stage b's proposition line."""
    st = copy.deepcopy(st)
    if line is not None:
        st["b"].setdefault("proposition", {})["line"] = line
    st["c"] = {"stage": "c", "produced_by": "invented", "chosen": "t2", "chosen_by": "test",
               "territories": [{"id": f"t{i}", "name": n, "thought": f"{n} as a thought", "why": "Fits the insight", "mood": "Warm",
                                "risks": "Twee", "sketch": s} for i, (n, s) in enumerate(
                   [("The Tap Tells", "A tap whispers a household memory"), ("Meter Moments", "A kitchen meter that smiles back"),
                    ("Quiet Pipes", "The house at night, pipes humming")], 1)],
               "ranking": {"order": ["t2", "t1", "t3"], "reasons": {"t1": "Warm but soft", "t2": "Closest to the insight", "t3": "Too dark"},
                           "by": "test"}}
    chans = ["outdoor", "radio", "social", "in-store", "direct mail", "search"]
    st["d"] = {**st["d"], "executions": [{"channel": chans[i], "role": f"Job {i + 1}", "copy": [f"Line for {chans[i]}."], "answer": "A piece",
                                          "visual": {"kind": "image_prompt", "prompt": "a tap"}} for i in range(n_exec)]}
    return st


def _brief_deck(line: str | None = LINE, n_exec: int = 4):
    """Path B: the brief tool's object, with two brief gaps."""
    inp = inputs.load(FIX / "brief_object.json")
    inp.brief_issues = [{"id": f"bi_0{i}", "kind": "missing", "topic": t, "what": "Not given.", "why_it_matters": "It matters.",
                         "question": q, "quote": "", "source": "rule"} for i, (t, q) in enumerate(
        [("timing", "When should the campaign go live?"), ("budget", "What is the budget?"), ("market", "Which regions are in scope?"),
         ("audience", "Who decides in the household?")], 1)]
    return assemble.build(inp, _rich(_st(FIX), line, n_exec), client="Lumen Water", project="Water saving", fmt="pitch",
                          profile=profiles.load("agency_pitch")), inp


def _sketch_deck(line: str | None = LINE, n_exec: int = 4):
    """Path A: a prompt alone (a sketch, held to ten)."""
    inp = inputs.load(None, prompt_text=(TYPES / "agency_pitch" / "prompt.txt").read_text().strip())
    return assemble.build(inp, _rich(_st(TYPES / "agency_pitch"), line, n_exec), client="Lumen Water", project="Water saving",
                          profile=profiles.load("agency_pitch")), inp


def _roles(d) -> list:
    return [show_work.role(d["slides"][x]) for x in validate.presented(d)]


def test_path_b_presents_the_agency_order(on):
    d, _ = _brief_deck()
    assert _roles(d) == ORDER
    backup = [d["slides"][x]["type"] for x in d["order"] if x not in validate.presented(d)]
    for t in ("competition", "audience", "measurement", "risks", "team", "investment", "real_question"):
        assert t in backup or not any(s["type"] == t for s in d["slides"].values()), t


def test_path_a_sketch_keeps_the_idea_and_two_executions_inside_ten(on):
    d, _ = _sketch_deck()
    roles = _roles(d)
    assert len(roles) <= spec.SKETCH_MAX_SLIDES
    assert "idea" in roles and roles.count("execution") >= 2
    assert roles.index("idea") < roles.index("execution") and roles[-1] == "next_step"


def test_the_hero_execution_comes_straight_after_the_idea(on):
    d, _ = _brief_deck()
    roles = _roles(d)
    assert roles[roles.index("idea") + 1] == "execution"


def test_the_brief_gaps_slide_is_compact(on):
    d, _ = _brief_deck()
    gs = next(d["slides"][x] for x in validate.presented(d) if d["slides"][x].get("role") == "brief_gaps")
    items = next(b["items"] for b in gs["blocks"] if b["kind"] == "bullets")
    assert len(items) == 3 and "Who decides in the household?" in gs["notes"]


def test_one_routes_slide_shows_every_route_and_marks_the_recommendation(on):
    d, _ = _brief_deck()
    rs = next(d["slides"][x] for x in validate.presented(d) if d["slides"][x]["type"] == "territory_choice")
    assert rs["title"] == "Three routes, one recommendation"
    rows = next(b["rows"] for b in rs["blocks"] if b["kind"] == "table")
    assert len(rows) == 4 and rows[1][0] == "Meter Moments (our recommendation)"
    assert {r[0].split(" (")[0] for r in rows[1:]} == {"The Tap Tells", "Meter Moments", "Quiet Pipes"}
    assert "Too dark" in rs["notes"]


def test_fewer_slides_fill_with_the_third_execution_before_setup(on):
    d, inp = _brief_deck()
    roles = _roles(d)
    assert roles.count("execution") == 2   # gaps took the tenth place
    inp2 = inputs.load(FIX / "brief_object.json")
    inp2.brief_issues = []
    d2 = assemble.build(inp2, _rich(_st(FIX)), client="Lumen Water", project="Water saving", fmt="pitch", profile=profiles.load("agency_pitch"))
    assert _roles(d2).count("execution") == 3 and len(_roles(d2)) == 10


def test_the_trim_honours_the_keep_set():
    S = [{"type": t, "title": t} for t in ("title", "objective", "audience", "competition", "idea", "execution", "execution", "execution", "next_step")]
    shown = [x for x in S if x["type"] == "execution"]
    keep = show_work.keep_set(S, shown)
    story, backup = assemble._trim(S, list(S), [], 4, order=("execution", "audience", "competition", "objective"), keep=keep)
    types = [x["type"] for x in story]
    assert "idea" in types and types.count("execution") >= 2
    assert {x["type"] for x in backup} >= {"audience", "competition"}   # setup goes first; the keep set never moves


def test_a_work_session_presents_every_route_and_the_work_in_ten(on, monkeypatch):
    monkeypatch.setattr(spec, "RECIPES", True)
    inp = inputs.load(None, prompt_text=(TYPES / "creative_work" / "prompt.txt").read_text().strip())
    d = assemble.build(inp, _rich(_st(TYPES / "creative_work")), client="Lumen Water", project="Water saving", profile=profiles.load("creative_work"))
    roles = _roles(d)
    assert "territory_choice" in roles and roles.count("territory") in (0, 3)   # every route's slide when all fit, else the routes slide alone
    assert "idea" in roles[:10] and roles[:10].count("execution") >= 2


def test_the_proposition_is_stage_bs_own_line(on):
    d, _ = _brief_deck()
    ps = next(d["slides"][x] for x in d["order"] if d["slides"][x]["type"] == "proposition")
    assert ps["title"] == LINE and ps["proposition_source"] == "stage_b"
    assert not [f for f in validate.run(d, _brief_deck()[1]) if f["check"] == "proposition_line"]


def test_a_missing_proposition_is_a_validation_error_never_a_fallback_label(on):
    d, inp = _brief_deck(line=None)
    ps = next(d["slides"][x] for x in d["order"] if d["slides"][x]["type"] == "proposition")
    assert ps["title"] != "The single thought" and ps["proposition_source"] == "missing"
    errs = [f for f in validate.run(d, inp) if f["check"] == "proposition_line"]
    assert errs and errs[0]["level"] == "error"
    assert "The single thought" not in json.dumps(d)


def test_the_stage_b_prompt_asks_for_the_line():
    text = (Path(spec.__file__).parent / "prompts" / "b_storyline.md").read_text()
    assert "proposition{line,rtbs" in text and "never the brief's key message" in text


def test_work_in_first_ten_fails_a_deck_that_hides_the_work():
    d = {"meta": {"format": "pitch", "kind": "agency", "show_work": {"mode": "pitch"}}, "order": [f"s{i:02d}" for i in range(1, 15)],
         "slides": {f"s{i:02d}": {"type": t, "title": t} for i, t in enumerate(
             ["title", "objective", "questions", "real_question", "chart", "insight", "audience", "proposition", "competition", "idea",
              "execution", "execution", "execution", "next_step"], 1)}}
    found = show_work.findings(d, d["order"])
    assert any(c == "work_in_first_ten" and lvl == "error" for c, lvl, _s, _m in found)


def test_the_order_is_read_from_the_recipe_never_the_type_id():
    assert show_work.present_mode(profiles.load("agency_pitch")) == "pitch"
    assert show_work.present_mode(profiles.load("creative_work")) == "tissue"
    assert show_work.present_mode(profiles.load("tender_response")) is None   # the buyer's order
    assert show_work.present_mode(profiles.load("credentials")) is None       # no idea to show


def test_the_trim_removes_by_identity_not_by_equal_content():
    S = [{"type": "execution", "title": "same"} for _ in range(3)] + [{"type": "idea", "title": "i"}]
    keep = {id(S[0]), id(S[1])}
    story, backup = assemble._trim(S, list(S), [], 3, order=("execution",), keep=keep)
    assert any(x is S[0] for x in story) and any(x is S[1] for x in story) and backup[0] is S[2]


def test_the_flag_off_builds_as_before(monkeypatch):
    for f in ("FINISH", "BRIEF_GAPS", "LOOK_V3"):
        monkeypatch.setattr(spec, f, True)
    d, _ = _brief_deck()
    assert not any(d["slides"][x]["type"] == "territory_choice" and d["slides"][x]["title"].endswith("one recommendation") for x in d["order"])
    assert next(d["slides"][x] for x in d["order"] if d["slides"][x]["type"] == "proposition").get("proposition_source") is None


def test_a_long_script_gives_its_place_to_a_piece_that_fits():
    def ex(n_words):
        return {"type": "execution", "title": "x", "blocks": [{"kind": "text", "text": "Role: a job"}, {"kind": "copy", "lines": ["word " * n_words]}]}
    hero, long_, short1, short2 = ex(10), ex(assemble.COPY_LONG + 30), ex(12), ex(14)
    S = [{"type": "idea", "title": "i", "blocks": []}, hero, long_, short1, short2]
    got = assemble._work_first(S, [hero, long_, short1])
    assert got[0] is hero and got[1] is short1 and got[2] is short2 and all(x is not long_ for x in got)


def test_the_red_team_never_reorders_the_agency_order(on):
    d, _ = _brief_deck()
    pres = validate.presented(d)
    gaps = next(x for x in pres if d["slides"][x].get("role") == "brief_gaps")
    routes = next(x for x in pres if d["slides"][x]["type"] == "territory_choice")
    ok, why, *_ = assemble._rt_order(d, gaps, {"after": "R"}, {"R": routes})
    assert not ok and "agency order" in why and validate.presented(d) == pres


def test_long_copy_keeps_its_opening_and_sign_off_and_the_rest_goes_to_the_notes():
    lines = [f"Q: question {i} with several more words in it? A: an answer of some length here." for i in range(9)] + ["Who is paying? Your council."]
    x = {"type": "execution", "title": "Local press", "notes": "", "blocks": [{"kind": "copy", "lines": list(lines)}]}
    assert show_work.fit_copy([x]) == 1
    on = x["blocks"][0]["lines"]
    assert on[0] == lines[0] and on[-1] == lines[-1] and sum(len(ln.split()) for ln in on) <= show_work.COPY_ON_SLIDE
    for ln in lines[len(on) - 1:-1]:
        assert ln in x["notes"]   # moved word for word, nothing dropped
    short = {"type": "execution", "title": "Radio", "notes": "", "blocks": [{"kind": "copy", "lines": ["One line.", "Two line.", "Three."]}]}
    assert show_work.fit_copy([short]) == 0 and short["blocks"][0]["lines"] == ["One line.", "Two line.", "Three."]


def test_a_persons_gate_2_edit_of_the_proposition_is_the_headline():
    """The handoffs branch (PR #264) writes a person's Gate 2 edit to proposition.line; it is read defensively (not merged here yet)."""
    b = {"proposition": {"line": "  Your tap,   your story  ", "edited_by": "human:planner"}}
    assert show_work.proposition_title(b, "The brief's message") == ("Your tap, your story", "person")
    assert show_work.proposition_title({"proposition": {"line": {"text": "Every drop counts here", "by": "human:x"}}}, "") == ("Every drop counts here", "person")
    assert show_work.proposition_title({"proposition": {"line": "Model line"}}, "") == ("Model line", "stage_b")
    for odd in ({"proposition": "just a string"}, {"proposition": {"line": ["a", "list"]}}, {"proposition": {"line": None}}, None, {"proposition": {"line": True}}):
        title, src = show_work.proposition_title(odd, "The brief's message")
        assert src == "missing" and title == "The brief's message"


def test_an_edited_line_reaches_the_slide(on):
    d, _ = _brief_deck(line="A person's sharper thought")
    ps = next(d["slides"][x] for x in d["order"] if d["slides"][x]["type"] == "proposition")
    assert ps["title"] == "A person's sharper thought"
