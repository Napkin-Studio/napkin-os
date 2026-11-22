"""territories-engine-insights: ranked, cited insights in one call; every cite resolves; strength computed in code; no leaks.
Run from engine/: ``PYTHONPATH=. python -m pytest -q territory/tests/test_insights.py``. No real model call is made."""
from __future__ import annotations

import json

import pytest

pytest.importorskip("jsonschema")

from territory import carried, contract, insights, spend as sp  # noqa: E402
from territory.llm import FakeLLM  # noqa: E402

DIR = carried.spunoff_dir()
DOC = json.loads((DIR / "data.json").read_text())
FACTS = json.loads((DIR / "facts.json").read_text())
FINDINGS = json.loads((DIR / "findings.json").read_text())
INP = carried.engine_input(DOC, FACTS, FINDINGS)
VERIFIED = next(f for f in INP["findings"] if f["status"] == "verified")
PROPOSED = next(f for f in INP["findings"] if f["status"] != "verified")
PIN = INP["facts"][0]["id"]


def raw(*rows):
    return {"insights": list(rows)}


def good():
    return raw(
        {"kind": "tension", "text": "They want the occasion without the alcohol, but not to be seen choosing less.", "cites": [VERIFIED["id"], "brief:audience"]},
        {"kind": "truth", "text": "A drink in hand is a ticket to the conversation.", "cites": [PIN]},
        {"kind": "provocation", "text": "What if the zero was the only thing on the label nobody could ignore?", "cites": []},
        {"kind": "tension", "text": "The parent brand gives permission here, but it is a stranger next door.", "cites": [PROPOSED["id"]]})


def run(out, **kw):
    llm = FakeLLM({"insights": out})
    return insights.run(DOC, llm, facts=FACTS, findings=FINDINGS, **kw), llm


def test_one_call_valid_and_cited():
    res, llm = run(good())
    assert llm.calls == ["insights"]
    rows = res["insights"]
    assert len(rows) == 4 and not res["dropped"]
    assert contract.validate_all("insight", rows) == []
    known = contract.known_cites(DOC, FACTS, FINDINGS)
    assert all(c in known for r in rows for c in r["evidence"])
    assert [r["rank"] for r in rows] == [1, 2, 3, 4]
    assert all(r["by"] == "engine" for r in rows)


def test_every_carried_input_reaches_the_model():
    seen = {}
    insights.run(DOC, lambda s, sys_, u: (seen.update(u=u) or ({"insights": []}, {})), facts=FACTS, findings=FINDINGS)
    u = json.loads(seen["u"])
    for n in INP["brief"]:
        assert f"brief:{n}" in u["brief"] and u["brief"][f"brief:{n}"]
    assert {p["id"] for p in u["pins"]} == {p["id"] for p in FACTS["facts"]}
    assert {f["id"] for f in u["findings"]} == {f["id"] for f in INP["findings"]}
    assert "null" not in seen["u"].lower().replace("never_use", "")


def test_out_of_play_id_drops_the_insight_and_says_why():
    bad = raw({"kind": "truth", "text": "A made-up claim.", "cites": ["f_ZZZZZZZZ"]},
              {"kind": "truth", "text": "A real claim.", "cites": [PIN]})
    res, _ = run(bad)
    assert [r["text"] for r in res["insights"]] == ["A real claim."]
    assert "not in play" in res["dropped"][0]["reason"]


def test_rejected_finding_cannot_be_cited():
    rej = [f["id"] for f in FINDINGS["findings"] if f.get("status") == "rejected"]
    if rej:
        res, _ = run(raw({"kind": "truth", "text": "From a rejected finding.", "cites": rej[:1]}))
        assert res["error"]


def test_strength_rules_and_derived():
    ix = insights._index(INP)
    s, d, _ = insights.strength_of([], ix)
    assert (s, d) == ("thin", False)                       # Napkin's idea: never strong, never derived
    s, d, _ = insights.strength_of([PROPOSED["id"]], ix)
    assert d is True and s == "thin"                        # derived caps at thin
    s, d, parts = insights.strength_of([VERIFIED["id"], "brief:audience"], ix)
    assert d is False and parts["solid"] == 1 and parts["independent"] == 1
    assert s in ("moderate", "strong")


def test_derived_flag_set_on_unverified_cite():
    res, _ = run(good())
    by_text = {r["text"]: r for r in res["insights"]}
    assert by_text["The parent brand gives permission here, but it is a stranger next door."]["derived"] is True
    assert by_text["A drink in hand is a ticket to the conversation."]["derived"] is False


def test_tension_without_cite_dropped_provocation_allowed():
    res, _ = run(raw({"kind": "tension", "text": "Uncited, but still said.", "cites": []},
                     {"kind": "borrowed", "text": "Borrow the sommelier's card from wine.", "cites": []}))
    assert [r["kind"] for r in res["insights"]] == ["borrowed"]
    assert res["insights"][0]["strength"] == "thin" and res["insights"][0]["evidence"] == []


def test_top_five_ticked_and_ranked_by_strength():
    rows = [{"kind": "truth", "text": f"Truth number {i} about the pour.", "cites": [PIN]} for i in range(7)]
    res, _ = run(raw(*rows, {"kind": "tension", "text": "Strong one, but two sources.", "cites": [VERIFIED["id"], "brief:audience"]}))
    got = res["insights"]
    assert sum(r["ticked"] for r in got) == 5 and all(r["ticked"] == (r["rank"] <= 5) for r in got)
    order = [insights.ORDER[r["strength"]] for r in got]
    assert order == sorted(order)


def test_does_not_restate_a_brief_field():
    field = INP["brief"]["insight"]
    res, _ = run(raw({"kind": "truth", "text": field[:290], "cites": ["brief:insight"]} if len(field) <= 300 else
                     {"kind": "truth", "text": field, "cites": ["brief:insight"]}, {"kind": "truth", "text": "Something else entirely.", "cites": [PIN]}))
    assert all(r["text"] != field for r in res["insights"])


def test_text_leaks_cleaned_or_dropped():
    res, _ = run(raw({"kind": "truth", "text": "**Bold** claim about the pour.", "cites": [PIN]},
                     {"kind": "truth", "text": f"Rests on {PIN} directly.", "cites": [PIN]},
                     {"kind": "truth", "text": "Pour it slowly (to confirm)", "cites": [PIN]}))
    assert [r["text"] for r in res["insights"]] == ["Bold claim about the pour."] or res.get("error")
    for r in res.get("insights", []):
        assert "**" not in r["text"] and "(to confirm)" not in r["text"] and PIN not in r["text"]


def test_refusal_becomes_plain_run_error(monkeypatch):
    monkeypatch.setattr(insights.contract, "validate_all", lambda k, v: [contract.Problem("focus.insights[0].text", "maxLength", "Insight 1 is too long.")])
    res, _ = run(good())
    err = res["error"]
    assert err["stage"] == "insights" and err["retryable"] and err["refused"] == ["Insight 1 is too long."] and res["insights"] == []


def test_nothing_usable_is_an_error_in_words():
    res, _ = run(raw({"kind": "truth", "text": "X", "cites": ["f_ZZZZZZZZ"]}))
    assert res["error"]["retryable"] and "f_" not in res["error"]["message"]


def test_no_brief_asks_through_intake_without_a_call():
    llm = FakeLLM({"insights": good()})
    res = insights.run({}, llm)
    assert llm.calls == [] and res["gate"]["action"] == "ask" and "category" in res["words"] and "market" in res["words"]
    res = insights.run({}, llm, category="cider", market="IE")
    assert llm.calls == ["insights"] or res.get("error")


def test_planner_insight_appends_without_a_call():
    res, llm = run(good())
    n = len(llm.calls)
    rows = insights.append_planner(res["insights"], "Aoife's own read of the table.", [PIN], by="Aoife", inp=INP)
    assert len(llm.calls) == n and rows[-1]["kind"] == "yours" and rows[-1]["by"] == "Aoife" and rows[-1]["ticked"]
    assert contract.validate_all("insight", rows) == []
    with pytest.raises(ValueError):
        insights.append_planner(rows, "x", ["f_ZZZZZZZZ"], by="Aoife", inp=INP)


def test_live_mode_path_through_spend_wrapper_pays_once(tmp_path):
    """The same function the server calls, behind Spend.wrap: one paid call, a retry reads the recorded answer."""
    calls = []

    def inner(stage, system, user):
        calls.append(stage)
        return good(), {"model": "claude-sonnet-5-5", "prompt_tokens": 8000, "completion_tokens": 2000, "calls": 1}

    s = sp.Spend(cap_usd=0.5, store=tmp_path / "s.json")
    s.ask({"est_usd": insights.estimate_usd(), "calls": 1})
    for _ in range(2):
        res = insights.run(DOC, s.wrap(inner), facts=FACTS, findings=FINDINGS)
        assert len(res["insights"]) == 4
    assert calls == ["insights"] and 0 < s.total() < 0.5


def test_cap_reached_is_plain_words():
    s = sp.Spend(cap_usd=0.0001)
    res = insights.run(DOC, s.wrap(lambda *a: (good(), {})), facts=FACTS, findings=FINDINGS)
    assert res["error"]["retryable"] and "limit" in res["error"]["message"]


def test_napkins_idea_is_thin_even_when_it_cites_a_spark():
    res, _ = run(raw({"kind": "provocation", "text": "What if the round was the ad?", "cites": [VERIFIED["id"], "brief:audience"]}))
    assert res["insights"][0]["strength"] == "thin"
