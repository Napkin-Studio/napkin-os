"""Composing part of a report (compose(part=...)): the sections, headline, summary and page parts asked for are
written again, under the same checks as a whole report; everything else is kept byte for byte."""

import json

from napkin.pipeline import report
from napkin.pipeline.research import Researcher
from napkin.rules import layout as rule

from fakes import FakeModel
from test_pipeline import DOC, caps_for, rclan


def two_lenses(store):
    caps = caps_for(store)
    _, rch, _ = Researcher(DOC, "3", rclan(["IE"]), "t@1.0", caps, ["media_spend", "market_structure"], ["IE"],
                           ["automotive.ev_charging"]).run()
    clan = dict(rclan(["IE"]), facts=rch["facts_append"])
    old, _, _, _ = report.compose(DOC, clan, "t@1.0", caps)
    return clan, old


def same(a, b):
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def subsequence(xs, ys):
    it = iter(ys)
    return all(any(x == y for y in it) for x in xs)


def test_only_the_sections_and_page_parts_asked_for_are_written_again(store):
    clan, old = two_lenses(store)
    media = {p["id"] for p in clan["facts"] if p["key"].startswith("media.")}
    pages = rule.split(old["layout"])
    assert "".join(pages) == old["layout"] and len(pages) > 2
    redo = [i for i, h in enumerate(pages) if media & report._ids(h)]
    model = FakeModel()
    new, cites, _, _ = report.compose(DOC, clan, "t@1.0", caps_for(store, model=model),
                                      part={"old": old, "sections": {"s_media_spend"}, "page": redo,
                                            "why": ["a person marked a fact wrong"]})
    assert [c[0] for c in model.calls] == ["report_part"]
    sent = model.calls[0][1]
    assert sent["rewrite"]["sections"] == ["media_spend"] and [x["part"] for x in sent["rewrite"]["page"]] == redo
    assert sent["changed"] == ["a person marked a fact wrong"] and "person_wording" not in sent
    by_old = {s["id"]: s for s in old["sections"]}
    by_new = {s["id"]: s for s in new["sections"]}
    # the section asked for is new, under the cite rule; every other one is byte-identical
    assert same(by_new["s_market_structure"], by_old["s_market_structure"])
    claims = [b["text"] for b in by_new["s_media_spend"]["blocks"] if b["kind"] == "claim"]
    assert claims == ["Media reads again after the review."]  # the made-up figure was dropped
    assert same(new["headline"], old["headline"]) and same(new["summary"], old["summary"])
    assert same(new["confirm"], old["confirm"]) and same(new["not_researched"], old["not_researched"])
    # the page: the parts asked for are rewritten, every other part is kept as it was
    after = rule.split(new["layout"])
    kept = [h for i, h in enumerate(pages) if i not in redo]
    assert subsequence(kept, after) and "Rewritten after the review." in new["layout"]
    assert new["layout_by"] == old["layout_by"]
    assert set(cites) >= {b2 for b in by_new["s_media_spend"]["blocks"] for b2 in b.get("cites", [])}


def test_the_headline_and_summary_are_written_again_only_when_asked(store):
    clan, old = two_lenses(store)
    new, _, _, _ = report.compose(DOC, clan, "t@1.0", caps_for(store),
                                  part={"old": old, "sections": set(), "headline": True, "summary": True})
    assert new["headline"]["text"].endswith("the research, as reviewed.")
    assert [s["text"] for s in new["summary"]] == ["Read the sections again."]
    assert same(new["sections"], old["sections"]) and new["layout"] == old["layout"]


def test_nothing_asked_is_no_model_call_and_the_report_as_it_was(store):
    clan, old = two_lenses(store)
    model = FakeModel()
    new, _, _, _ = report.compose(DOC, clan, "t@1.0", caps_for(store, model=model), part={"old": old})
    assert model.calls == []
    for k in ("headline", "summary", "sections", "confirm", "not_researched", "layout", "layout_by"):
        assert same(new[k], old[k]), k


def test_a_page_part_the_agent_leaves_unwritten_is_the_old_one_without_what_it_may_no_longer_cite(store):
    clan, old = two_lenses(store)
    media = [p for p in clan["facts"] if p["key"].startswith("media.")]
    gone = media[0]["id"]
    pages = rule.split(old["layout"])
    redo = [i for i, h in enumerate(pages) if gone in report._ids(h)]
    assert redo
    clan["data"]["selection"] = dict(clan["data"].get("selection") or {},
                                     excluded=[{"fact_id": gone, "reason": "wrong", "decision": "d_01EXCLUDE1"}])
    model = FakeModel({"report_part": lambda p: {**FakeModel.r_report_part(p), "page": []}})
    new, _, _, _ = report.compose(DOC, clan, "t@1.0", caps_for(store, model=model),
                                  part={"old": old, "sections": {"s_media_spend"}, "page": redo})
    for i in redo:
        assert pages[i] not in new["layout"] or gone not in pages[i]
    assert gone not in report._ids(new["layout"])
    assert gone not in json.dumps(new["sections"])
