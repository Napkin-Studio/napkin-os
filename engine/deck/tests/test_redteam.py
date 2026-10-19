"""Offline tests for headline narrowing (stage e, DECK-CRAFT-PLAN roadmap 4) and the red team (stage red_team, roadmap 6). A stubbed
model call and recorded JSON written here, one invented client (Lumen Water), no live run. Run from ``engine/``:
``PYTHONPATH=. python3 -m pytest -q deck/tests``."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from types import SimpleNamespace

from deck import assemble, inputs, run_deck, spec, stages, validate

FIX = Path(__file__).parent / "fixtures" / "lumen_water"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
REAL_Q = "The real question is how to make the tap feel personal"


def _deck(verdicts=None):
    """The Lumen Water deck with the given fit verdicts (title -> (verdict, reason)); returns (deck, inputs)."""
    st = {k: json.loads((FIX / f).read_text()) for k, f in FILES.items()}
    inp = inputs.load(FIX / "brief_object.json")
    fit = {"verdicts": [{"title": t, "verdict": v, "reason": r} for t, (v, r) in (verdicts or {}).items()]} if verdicts else None
    return assemble.build(inp, st, client="Lumen Water", project="National awareness campaign", fit=fit), inp


def _sid(deck, title):
    """The slide id with a title."""
    return next(x for x, s in deck["slides"].items() if s["title"] == title)


# ---------------------------------------------------------------- headline narrowing

def test_a_narrowed_headline_is_applied_and_its_verdict_rekeyed():
    """A 'not' headline on a presented slide is replaced; the verdict follows the new title as 'narrowed' with the reason, and is logged."""
    deck, inp = _deck({REAL_Q: ("not", "evidence is about another market")})
    sid = _sid(deck, REAL_Q)
    n = [{"slide": REAL_Q, "headline": "The question is how to make the tap feel personal", "reason": "dropped 'real'"}]
    assert assemble.apply_narrowing(deck, n) == {"applied": 1, "rejected": 0}
    assert deck["slides"][sid]["title"] == "The question is how to make the tap feel personal"
    v = deck["fit"]["verdicts"][0]
    assert v["title"] == deck["slides"][sid]["title"] and v["verdict"] == "narrowed" and v["was"] == "not"
    assert deck["meta"]["narrowing"][0]["applied"] is True and deck["meta"]["narrowing"][0]["from"] == REAL_Q
    found = [f for f in validate.run(deck, inp) if f["check"] == "claim_fit"]
    assert found and found[0]["level"] == "error" and "judged again" in found[0]["message"]   # a 'not' reworded and never re-judged stays a gate error


def test_a_headline_that_adds_a_number_is_rejected_and_the_original_stays():
    """The numbers_trace guard: any number not in the original headline rejects the rewrite."""
    deck, inp = _deck({REAL_Q: ("partly", "overreach")})
    n = [{"slide": REAL_Q, "headline": "The question is how to make 9 in 10 taps personal", "reason": "x"}]
    assert assemble.apply_narrowing(deck, n) == {"applied": 0, "rejected": 1}
    assert _sid(deck, REAL_Q) and deck["fit"]["verdicts"][0]["verdict"] == "partly"
    assert "adds a number" in deck["meta"]["narrowing"][0]["rejected_because"] and deck["meta"]["narrowing"][0]["applied"] is False


def test_numbers_in_the_original_headline_may_be_kept():
    """A narrowed headline that keeps the original's figure passes; one that drops it also passes (it adds nothing)."""
    deck, _ = _deck({REAL_Q: ("partly", "x")})
    sid = _sid(deck, REAL_Q)
    deck["slides"][sid]["title"] = "Water use must fall 40% by 2030 for every household"
    deck["fit"]["verdicts"][0]["title"] = deck["slides"][sid]["title"]
    ok = assemble.apply_narrowing(deck, [{"slide": deck["slides"][sid]["title"], "headline": "Water use must fall 40% by 2030", "reason": "dropped 'every household'"}])
    assert ok["applied"] == 1 and deck["slides"][sid]["title"] == "Water use must fall 40% by 2030"


def test_narrowing_is_refused_for_a_supported_verdict_a_stale_title_and_a_longer_or_unchanged_headline():
    """Only 'not'/'partly' slides are narrowed; stale, unchanged, empty and much longer rewrites are rejected."""
    deck, _ = _deck({REAL_Q: ("supported", "ok"), "Water is loved and ignored in the same breath": ("partly", "x")})
    ins = "Water is loved and ignored in the same breath"
    n = [{"slide": REAL_Q, "headline": "A different headline here", "reason": ""},
         {"slide": "No such slide", "headline": "x y z", "reason": ""},
         {"slide": ins, "headline": ins, "reason": ""},
         {"slide": ins, "headline": "", "reason": ""},
         {"slide": ins, "headline": ins + " and a great many more words appended here", "reason": ""}]
    assert assemble.apply_narrowing(deck, n) == {"applied": 0, "rejected": 5}
    assert _sid(deck, REAL_Q) and _sid(deck, ins)


def test_no_narrowing_leaves_the_deck_as_it_was():
    """An empty list touches nothing (no meta key): old recorded e_copy.json files rebuild as before."""
    deck, _ = _deck({REAL_Q: ("not", "x")})
    before = copy.deepcopy(deck)
    assert assemble.apply_narrowing(deck, []) == {"applied": 0, "rejected": 0} and deck == before


def test_a_fit_rerun_under_the_new_title_wins():
    """When fit.json already holds a verdict for the new title, the old verdict is dropped and the new one kept."""
    new = "The question is how to make the tap feel personal"
    deck, _ = _deck({REAL_Q: ("not", "x"), new: ("supported", "ok")})
    assemble.apply_narrowing(deck, [{"slide": REAL_Q, "headline": new, "reason": "r"}])
    assert [(v["title"], v["verdict"]) for v in deck["fit"]["verdicts"]] == [(new, "supported")]


def _stub(monkeypatch, reply):
    """Replace stages._call with one that records its inputs and returns ``reply``."""
    seen = []
    monkeypatch.setattr(stages, "_call", lambda stage, user, system: (seen.append((stage, user, system)) or (copy.deepcopy(reply), {"model": "m", "secs": 0, "calls": 1})))
    return seen


def test_stage_e_asks_for_narrowing_only_of_not_and_partly_slides(monkeypatch):
    """The stage's user turn carries a <narrow> block for the flagged slide only, with its reason and evidence; replies for other slides are dropped."""
    deck, inp = _deck({REAL_Q: ("not", "other market"), "Water is loved and ignored in the same breath": ("supported", "ok")})
    seen = _stub(monkeypatch, {"edits": [], "narrowed": [{"slide": REAL_Q, "headline": "h", "reason": "r"}, {"slide": "Other", "headline": "h", "reason": "r"}]})
    obj, _ = stages.copy(deck, inp)
    stage, user, system = seen[0]
    assert stage == "e" and "<narrow>" in user and REAL_Q in user.split("<narrow>")[1] and "Water is loved" not in user.split("<narrow>")[1]
    assert "<narrow>" in system and obj["narrowed"] == [{"slide": REAL_Q, "headline": "h", "reason": "r"}]


def test_stage_e_makes_no_call_with_nothing_to_tighten_or_narrow(monkeypatch):
    """No over-budget slide and no flagged verdict: no model call (as before)."""
    deck, inp = _deck({REAL_Q: ("supported", "ok")})
    seen = _stub(monkeypatch, {})
    obj, u = stages.copy(deck, inp)
    assert seen == [] and obj["edits"] == [] and u["calls"] == 0


# ---------------------------------------------------------------- the red team

def _o(slide, ctype, kind="claim_unsupported", **change):
    """One objection as the model returns it."""
    return {"kind": kind, "objection": f"An objection about {slide[:20]}.", "slide": slide, "change": {"type": ctype, **change}}


def test_objections_are_stored_capped_and_one_wording_change_applied():
    """At most six are kept, in meta.red_team; a headline wording change on a presented slide is applied and recorded as a decision."""
    deck, _ = _deck({REAL_Q: ("supported", "ok")})
    new = "The question is how to make the tap feel personal"
    objs = [_o(REAL_Q, "wording", text=new)] + [_o("Water is loved and ignored in the same breath", "ask", note="who signs off?") for _ in range(8)]
    dec = assemble.apply_red_team(deck, {"objections": objs})
    rt = deck["meta"]["red_team"]
    assert len(rt["objections"]) == spec.RED_TEAM_MAX == len(dec) and rt["applied"] == 1 and rt["shown_at"] == ["gate_1", "gate_3"]
    assert dec[0]["applied"] is True and dec[0]["from"] == REAL_Q and dec[0]["to"] == new and dec[0]["by"] == "red_team"
    assert deck["slides"][_sid(deck, new)]["title"] == new and all(not d["applied"] and d["why"] == "left for the person" for d in dec[1:])


def test_an_order_change_moves_one_presented_slide_and_never_the_cover_or_objective():
    """Order: the slide moves after the named slide; the cover and the objective are refused."""
    deck, _ = _deck()
    ins, rq, tp = "Water is loved and ignored in the same breath", REAL_Q, "Lumen Water: National awareness campaign"
    cover = next(s["title"] for s in deck["slides"].values() if s["type"] == "title")
    obj = next(s["title"] for s in deck["slides"].values() if s["type"] == "objective")
    n = len(deck["order"])
    dec = assemble.apply_red_team(deck, {"objections": [_o(ins, "order", after=rq), _o(cover, "order", after=rq), _o(obj, "order", after=rq)]})
    assert dec[0]["applied"] is False and dec[0]["why"] == "already there"   # the insight already follows the real question
    types = [deck["slides"][x]["type"] for x in deck["order"]]
    assert len(deck["order"]) == n and types[0] == "title" and types[1] == "objective"
    assert dec[1]["applied"] is False and dec[2]["applied"] is False
    dec = assemble.apply_red_team(deck, {"objections": [_o(ins, "order", after="Each channel has one job")]})
    pos = [deck["slides"][x]["title"] for x in validate.presented(deck)]
    assert dec[0]["applied"] is True and pos.index(ins) == pos.index("Each channel has one job") + 1 and dec[0]["from"] != dec[0]["to"]


def test_a_change_is_never_applied_to_a_placeholder_a_number_or_a_non_claim():
    """A needs_human slide, a headline that adds a number, a fixed-label slide and a placeholder/ask suggestion are all left for the person."""
    deck, _ = _deck({REAL_Q: ("supported", "ok")})
    team = next(s["title"] for s in deck["slides"].values() if s["type"] == "team")
    inv = next(s["title"] for s in deck["slides"].values() if s["type"] == "investment")
    guard = next(s["title"] for s in deck["slides"].values() if s["type"] == "guardrails")
    before = {x: s["title"] for x, s in deck["slides"].items()}
    dec = assemble.apply_red_team(deck, {"objections": [
        _o(team, "wording", kind="price_unclear", text="A team of 12 experts"),
        _o(inv, "wording", kind="price_unclear", text="Investment of 50000 euros"),
        _o(REAL_Q, "wording", text="The question is how to make 7 taps personal"),
        _o(guard, "wording", text="What the work must never do at all"),
        _o(REAL_Q, "placeholder", kind="ask_unanswered", note="the decision date"),
        _o(REAL_Q, "ask", kind="objective_unclear", note="by when?")]})
    assert [d["applied"] for d in dec] == [False] * 6
    assert {x: s["title"] for x, s in deck["slides"].items()} == before and deck["meta"]["red_team"]["applied"] == 0
    assert "adds a number" in dec[2]["why"]


def test_a_stale_slide_title_and_an_unknown_kind_are_kept_but_never_applied():
    """An objection naming no slide is stored and left for the person; an unknown kind is normalised."""
    deck, _ = _deck()
    dec = assemble.apply_red_team(deck, {"objections": [{"kind": "weird", "objection": "No answer to price.", "slide": "Nope", "change": {"type": "wording", "text": "x"}}]})
    rec = deck["meta"]["red_team"]["objections"][0]
    assert dec[0]["applied"] is False and rec["kind"] in spec.RED_TEAM_KINDS and rec["outcome"] == "left for the person"


def test_the_red_team_stage_sends_the_deck_and_caps_the_reply(monkeypatch):
    """One call on the red_team model (Claude, never the writer's), the presented slides in the user turn, the reply cut to six."""
    deck, inp = _deck()
    seen = _stub(monkeypatch, {"objections": [_o(REAL_Q, "ask") for _ in range(9)]})
    obj, _ = stages.red_team(deck, inp)
    assert len(seen) == 1 and seen[0][0] == "red_team" and REAL_Q in seen[0][1] and len(obj["objections"]) == 6
    assert stages.MODELS["red_team"].startswith("claude-") and stages.MODELS["red_team"] != stages.MODELS["b"]
    assert "never" in seen[0][2].lower() and "Inputs are the only source" in seen[0][2]


def _args(tmp_path, live=False):
    """The slice of the run_deck arguments the red-team step reads."""
    return SimpleNamespace(stages=tmp_path, live=live)


def test_the_step_is_skipped_quietly_with_no_recorded_output(tmp_path):
    """No red_team.json and no --live: a 'skipped' row, no decisions, the deck untouched, no model."""
    deck, inp = _deck()
    before, rep = copy.deepcopy(deck), {"stages": {}}
    run_deck._red_team(_args(tmp_path), deck, inp, {}, rep)
    assert rep["stages"]["red_team"] == {"source": "skipped: no recorded output"} and "decisions" not in rep and deck == before


def test_a_recorded_red_team_is_stored_applied_once_and_reported_with_a_cost_note(tmp_path):
    """The recorded file is read; the objections reach deck.meta; the applied change is a decision in the report; the cost note is there."""
    deck, inp = _deck()
    new = "The question is how to make the tap feel personal"
    (tmp_path / "red_team.json").write_text(json.dumps({"produced_by": "recorded stand-in", "objections": [_o(REAL_Q, "wording", text=new), _o(REAL_Q, "ask", note="when?")]}))
    rep = {"stages": {}}
    run_deck._red_team(_args(tmp_path), deck, inp, {}, rep)
    assert rep["stages"]["red_team"]["source"] == "recorded" and rep["stages"]["red_team"]["applied"] == 1 and "cost_note" in rep["stages"]["red_team"]
    assert [d["applied"] for d in rep["decisions"]] == [True, False] and len(deck["meta"]["red_team"]["objections"]) == 2
    assert not [f for f in validate.run(deck, inp) if f["check"] == "numbers_trace"]


def test_a_deck_with_no_red_team_has_no_red_team_meta_and_the_build_is_unchanged():
    """A plain build holds no red_team or narrowing key (old recorded decks are byte-identical to before)."""
    deck, _ = _deck()
    assert "red_team" not in deck["meta"] and "narrowing" not in deck["meta"]
    golden = json.loads((FIX / "golden_deck.json").read_text())
    assert "red_team" not in golden["meta"]


def test_evaluate_counts_a_narrowed_headline_by_its_old_verdict(tmp_path):
    """A narrowed 'not' headline still counts as 'not' in evaluate's fit counts and is shown as narrowed, so fit_pct does not rise."""
    from deck import evaluate
    deck, inp = _deck({REAL_Q: ("not", "evidence is about another market")})
    assemble.apply_narrowing(deck, [{"slide": REAL_Q, "headline": "The question is how to make the tap feel personal", "reason": "x"}])
    (tmp_path / "deck.json").write_text(__import__("json").dumps(deck))
    (tmp_path / "validation.json").write_text("[]")
    r = evaluate.score(tmp_path)
    assert r["fit"]["not"] == 1 and r["fit_narrowed"] == 1 and r["fit_pct"] == 0
