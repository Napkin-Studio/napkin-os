"""The first deck built on UAT came out much worse than the local one (2026-11-23): fixes for what a Production deck lost, a film nobody wanted,
and text that must not leave the building. Offline, on the invented Lumen Water project. Run from engine/: ``PYTHONPATH=. python3 -m pytest deck/tests/test_deck_uat_fixes.py``."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

from deck import assemble, export_clean, from_production as fp, images, inputs, prod_picker as pp, spec, stages

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "fixtures" / "production_demo"))
import make_bundle as mb   # noqa: E402

sys.path.remove(str(HERE / "fixtures" / "production_demo"))


def _slides(*pairs):
    return [assemble._slide(t, title, [{"kind": "text", "text": "Role: x"}]) for t, title in pairs]


def test_a_key_visual_slide_is_a_group_of_finals_and_not_a_gap():
    assert images.execution_group("Key visual") == "keyvisual"
    assert images.execution_group("Mood frame") == "keyvisual"
    assert images.execution_group("Packshot") == "product" and images.execution_group("Out of home") is None


def test_the_key_visual_slide_takes_a_key_visual_final(tmp_path, monkeypatch):
    monkeypatch.setattr(spec, "GRAPHICS", True)
    slides = {"s1": {"type": "title", "title": "Lumen Water"}, "s2": {"type": "idea", "title": "Every drop has a story."},
              "s3": {"type": "execution", "title": "Key visual"}}
    deck = {"meta": {"client": "Lumen Water"}, "order": list(slides), "slides": slides}
    clan = tmp_path / "lumen.clan"
    mb.build_clan(clan, embed=("master", "upload_master", "story", "six", "feed", "link", "f1", "f2", "f3", "f4", "fe"))
    pp.run(deck, pp.Source(clan), tmp_path / "st")
    im = ((deck["slides"]["s3"].get("slots") or {}).get("picture") or {}).get("image") or {}
    assert (im.get("from") or {}).get("kind") == "production" and im.get("status") in ("made", "flagged"), im


def test_a_production_deck_keeps_its_out_of_home_execution_on_its_own_slide(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    S = lambda: _slides(("title", "Lumen"), ("idea", "Every drop"), ("execution", "Out of home"), ("channel_roles", "Each channel has one job"))   # noqa: E731
    merged = assemble._arrange_pitch(S(), set(), 1, [], None, target=None)
    assert not any(x["type"] == "execution" for x in merged)   # the old way: it folds into the channel slide, whose layout draws none of its frames
    assert next(x for x in merged if x["type"] == "channel_roles").get("merged")
    kept = assemble._arrange_pitch(S(), set(), 1, [], None, target=None, production=True)
    assert [x["title"] for x in kept if x["type"] == "execution"] == ["Out of home"]
    assert not next(x for x in kept if x["type"] == "channel_roles").get("merged")


def test_a_production_deck_presents_the_executions_its_finals_fill_first():
    ex = _slides(("execution", "Social stills"), ("execution", "15-second film"), ("execution", "Key visual"), ("execution", "Out of home"),
                 ("execution", "Out of home"), ("execution", "Packshot"), ("execution", "Storyboard frames"))
    got = [x["title"] for x in assemble._shown_executions(ex, [], production=True)]
    assert got == ["Social stills", "Key visual", "Out of home", "Packshot"]   # four kinds, in story order, the film never first
    ex = _slides(("execution", "Key visual"), ("execution", "Out of home"), ("execution", "Out of home"), ("execution", "Packshot"), ("execution", "Storyboard frames"))
    assert [x["title"] for x in assemble._shown_executions(ex, [], production=True)] == ["Key visual", "Out of home", "Packshot", "Storyboard frames"]


def test_no_film_in_a_deck_made_from_pictures():
    d = {"executions": [{"channel": "15-second film for social", "role": "r", "copy": [], "answer": "a"}, {"channel": "Out of home", "role": "r", "copy": [], "answer": "a"},
                        {"channel": "Storyboard frames", "role": "r", "copy": [], "answer": "a"}],
         "channel_roles": [{"channel": "TV", "role": "x"}, {"channel": "Out of home", "role": "y"}]}
    out = assemble.drop_film(d)
    assert [x["channel"] for x in out["executions"]] == ["Out of home", "Storyboard frames"]
    assert [x["channel"] for x in out["channel_roles"]] == ["Out of home"]
    assert len(d["executions"]) == 3   # the input is not changed
    assert assemble.is_film_channel("30 second TV spot") and not assemble.is_film_channel("96-sheet roadside")


def test_the_idea_stage_is_told_the_finals_and_that_a_deck_of_pictures_has_no_film(tmp_path):
    clan = tmp_path / "lumen.clan"
    mb.build_clan(clan, embed=("master", "upload_master", "story", "six", "feed", "link", "f1", "f2", "f3", "f4", "fe"))
    doc = pp.Source(clan).doc
    summary = fp.finals_summary(doc)
    assert summary["key_visuals"] >= 1 and summary["storyboard_frames"] >= 1
    inp = inputs.Inputs(brief={})
    assert stages._visuals_block(inp) == ""   # a deck of a prompt alone is told nothing new
    inp.production_visuals = summary
    block = stages._visuals_block(inp)
    assert "NO film" in block and "a key visual" in block and "storyboard frames (stills)" in block


def test_open_items_leave_the_slides_for_one_appendix_slide():
    slides = _slides(("title", "Lumen: Water"), ("insight", "To confirm: People want a good bottle"), ("appendix_sources", "Sources"))
    slides[1]["blocks"] = [{"kind": "bullets", "items": [{"text": "A real point."}, {"text": ""}, {"text": "To confirm: a loose claim."},
                                                          {"text": "Nothing is on shelf. To confirm with the client."}]},
                           {"kind": "text", "text": "A response from [Agency]"}, {"kind": "small", "text": "agency note", "internal": True}]
    deck = {"meta": {}, "order": ["s01", "s02", "s03"], "slides": dict(zip(["s01", "s02", "s03"], slides))}
    res = export_clean.scrub(deck)
    s2 = deck["slides"]["s02"]
    assert s2["title"] == "People want a good bottle"
    assert [i["text"] for i in s2["blocks"][0]["items"]] == ["A real point.", "a loose claim.", "Nothing is on shelf."]
    assert len(s2["blocks"]) == 1   # the bracket line and the internal block are gone
    assert res["items"] == 3 and deck["order"][-1] == "s03"
    new = deck["slides"][deck["order"][-2]]
    assert new["title"] == export_clean.OPEN_TITLE and "a loose claim" in str(new["blocks"])
    texts = [i["text"] for s in deck["slides"].values() if s is not new for b in s["blocks"] for i in (b.get("items") or [b]) if i.get("text")]
    assert texts and not any(export_clean.has_marks(t) for t in texts)


def test_a_presented_slide_hands_its_supply_cards_and_parentheticals_to_the_list_and_the_appendix_keeps_its_own():
    cover = assemble._slide("title", "Lumen", [{"kind": "text", "text": "Hello"}, {"kind": "text", "human": True, "text": "Proposed (not given by the client): a presenter [presenter and date]. To confirm: who."}])
    story = assemble._slide("insight", "A claim", [{"kind": "bullets", "items": [{"text": "Cider is fizzy (draft insight, to confirm)."}, {"text": "Fee split", "human": True}]}])
    divider = assemble._slide("appendix", "Appendix", [{"kind": "text", "text": "Backup"}])
    behind = assemble._slide("team", "The team", [{"kind": "bullets", "items": [{"text": "Proposed (not given by the client): a lead. To confirm: name.", "human": True}]}])
    deck = {"meta": {}, "order": ["s01", "s02", "s03", "s04"], "slides": dict(zip(["s01", "s02", "s03", "s04"], [cover, story, divider, behind]))}
    export_clean.scrub(deck)
    assert [b["text"] for b in deck["slides"]["s01"]["blocks"]] == ["Hello"]
    assert deck["slides"]["s02"]["blocks"][0]["items"] == [{"text": "Cider is fizzy."}]
    assert "To confirm: name" in str(deck["slides"]["s04"]["blocks"])   # behind the divider the card stays: it is the To supply list
    listed = str(deck["slides"][deck["order"][-1]]["blocks"])
    assert "presenter" in listed and "draft insight, to confirm" in listed and "Fee split" in listed


def test_the_exported_notes_carry_no_evidence_ids_and_the_cover_no_agency_line():
    assert export_clean.notes_of("Said once, on slide 9.\n\nEvidence:\n[req:R3]\n[f_ab12]") == "Said once, on slide 9."
    assert export_clean.notes_of("Evidence:\n[req:R3]") == ""
    assert export_clean.notes_of("Role.\n\nEvidence:\n[brief:insight] brief field (brief-maker): To confirm: a line.") == "Role."
    assert export_clean.clean_text("A response from [Agency]") == ("", [])


def test_a_clean_render_has_no_draft_mark_or_check_banner(tmp_path):
    pytest.importorskip("pptx")
    from deck import render_pptx, render_web
    deck = {"meta": {"client": "Lumen", "project": "Water", "agency": "[Agency]", "kind": "agency", "format": "pitch"}, "order": ["s01"],
            "slides": {"s01": assemble._slide("title", "Lumen: Water", [{"kind": "text", "text": "Hello"}], status="needs_human")}}
    inp = inputs.Inputs(brief={})
    findings = [{"check": "word_budget", "level": "error", "slide": "s01", "message": "x"}]
    from pptx import Presentation
    outs = {}
    for clean in (False, True):
        p = tmp_path / f"d{clean}.pptx"
        render_pptx.render(deck, inp, p, None, findings, clean=clean)
        outs[clean] = " ".join(sh.text_frame.text for sl in Presentation(p).slides for sh in sl.shapes if sh.has_text_frame)
        h = tmp_path / f"d{clean}.html"
        render_web.render(deck, inp, h, findings, clean=clean)
        outs[(clean, "html")] = h.read_text()
    assert "DRAFT" in outs[False] and "CHECK FAILED" in outs[False]
    assert "DRAFT" not in outs[True] and "CHECK FAILED" not in outs[True]
    assert "CHECK FAILED" in outs[(False, "html")] and "CHECK FAILED" not in outs[(True, "html")].split("</style>")[-1] and "DRAFT ·" not in outs[(True, "html")].split("</style>")[-1]


def test_the_carried_research_is_the_decks_evidence():
    inp = inputs.Inputs(brief={})
    assert not inp.has_research()
    members = {"facts": [{"id": "f_01", "entity": "market", "key": "value", "value": 7.6, "unit": "%", "as_of": "2026", "confidence": "high"}],
               "findings": [{"id": "fi_01", "statement": "Cider lost share.", "status": "verified"}], "sources": [], "decisions": []}
    assert inputs.apply_research(inp, members) is True and inp.has_research()
    assert inp.findings and inp.coverage["facts"] == 1
    assert inputs.apply_research(inputs.Inputs(brief={}), {"facts": [], "findings": []}) is False
