"""UAT round 4 F30, owner decision 2026-11-24 ("Go with your recommendation"): the measurement slide's 7-row table and the 8-item guardrails
list are two slides, never one slide drawn small (Copperell, a fictional brand). Within the pitch's cap the second slide counts, and the
cap's folds and moves still apply."""

from __future__ import annotations

import pytest

from deck import assemble, spec


@pytest.fixture(autouse=True)
def look(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)


def _measurement(rows: int):
    table = [["What we measure", "Baseline", "How"]] + [[f"KPI {n}", "None in the brief: set before launch", "Tracked weekly"] for n in range(rows)]
    return assemble._slide("measurement", "How we will know it worked", [{"kind": "table", "rows": table}])


def _guardrails(items: int):
    return assemble._slide("guardrails", "What the work must never do",
                           [{"kind": "bullets", "title": "What the work must always carry, and never do",
                             "items": [{"text": f"Rule {n}", "basis": "sourced"} for n in range(items)]}], status="from_source")


def _base():
    t = lambda ty: assemble._slide(ty, f"A full sentence title for the {ty} slide", [{"kind": "text", "text": f"{ty} line", "basis": "opinion"}])   # noqa: E731
    return [t(x) for x in ("title", "objective", "insight", "proposition", "idea")], [t("investment")]


def _story(out):
    return out[:next((i for i, x in enumerate(out) if x["type"] == "appendix"), len(out))]


def test_a_full_table_and_a_long_list_are_two_slides_never_one_drawn_small():
    head, tail = _base()
    S = head + [_guardrails(8), _measurement(6)] + tail   # the UAT slide: six data rows beside eight rules, no_fit
    story = _story(assemble._arrange_pitch(S, target=None, cap=12))
    ms = next(x for x in story if x["type"] == "measurement")
    gr = next(x for x in story if x["type"] == "guardrails")
    assert [b["kind"] for b in ms["blocks"]] == ["table"] and not ms.get("merged")
    assert len(gr["blocks"][0]["items"]) == 8   # every rule, on its own slide
    assert len(story) == len(S)


def test_a_small_table_and_a_short_list_still_merge_as_designed():
    head, tail = _base()
    S = head + [_guardrails(2), _measurement(2)] + tail
    story = _story(assemble._arrange_pitch(S, target=None, cap=12))
    ms = next(x for x in story if x["type"] == "measurement")
    assert ms.get("merged") == [{"type": "guardrails", "title": "What the work must never do"}]
    assert not [x for x in story if x["type"] == "guardrails"]


def test_the_split_slide_counts_toward_the_cap_and_the_caps_rules_still_apply():
    head, tail = _base()
    filler = [assemble._slide(t, f"Title {t}", [{"kind": "text", "text": f"{t} words", "basis": "opinion"}])
              for t in ("real_question", "audience", "competition", "risks", "timeline")]
    S = head + filler + [_guardrails(8), _measurement(6)] + tail   # 13 presented with the split
    out = assemble._arrange_pitch(S, target=None, cap=12)
    story = _story(out)
    assert len(story) == 12
    words = lambda xs: {it["text"] for x in xs for b in x["blocks"] for it in (b.get("items") or [])}   # noqa: E731
    assert {f"Rule {n}" for n in range(8)} <= words(out)   # moved or presented, never dropped
    assert any(x["type"] == "measurement" for x in story)
