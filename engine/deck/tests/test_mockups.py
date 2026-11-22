"""Execution mock-ups in situ (spec.MOCKUPS, deck/mockup.py), held in code.

Round 4 blind judging of decks from real client briefs: "the work is shown almost entirely as text": both executions in the first ten
slides were text slides with no mock-up. So each presented execution is drawn as the work where it runs, picked by its channel, its
headline and line typeset inside the ad, the client label as the brand, the picture filling the ad's visual area or a typographic ad,
labelled Mock-up; stage g gets a picture slot per presented execution (five a deck at most); the fit check asks an execution's picture
is the scene alone. Also here: the brief's contamination stated on the gaps slide.

Offline: no model, no LibreOffice. Every brand, brief and copy line is invented. The suite runs with DECK_MOCKUPS=0 (conftest), so each
test turns it on."""
from __future__ import annotations

import re

import pytest

from deck import assemble, graphics, mockup, render_pptx, scene, spec
from visuals import fit

FONTS = {"head": "Archivo", "body": "Source Sans 3"}
BOX = (5.6, 1.9, 7.08, 4.37)
SHORT = ["Look at what is gone from the bowl.", "Nothing added. Nothing hidden.", "VO: Tabbel. Only what cats need."]
LONG = ["Ciara. Office worker. Took the bus here for years. First ride last week.", "Raining. Rode anyway. Work coat and all.",
        "Someone like you went first. Your nearest station is close by."]


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(spec, "MOCKUPS", True)
    monkeypatch.setattr(spec, "GRAPHICS", True)


def _deck(client="Tabbel"):
    ex = lambda title: {"type": "execution", "title": title, "section": "The work", "blocks": [   # noqa: E731
        {"kind": "text", "text": "Role: carries the idea."}, {"kind": "copy", "lines": list(SHORT), "answer": "Shows the idea."}]}
    return {"meta": {"client": client, "project": "Relaunch"}, "order": ["s1", "s2", "s3", "s4", "s5", "s6"],
            "slides": {"s1": {"type": "title", "title": "Cover", "blocks": []}, "s2": {"type": "idea", "title": "Idea", "blocks": []},
                       "s3": ex("Bus-stop outdoor"), "s4": ex("Local radio"), "s5": {"type": "appendix", "title": "Appendix", "blocks": []},
                       "s6": ex("Social video")}}


@pytest.mark.parametrize("title,kind", [
    ("Bus-stop outdoor", "poster"), ("Roadside billboard", "billboard"), ("Social video", "phone"), ("App and registration messages", "phone"),
    ("In-store wobbler", "shelf"), ("Local radio", "radio"), ("TV and online video", "film"), ("Door drops", "print"),
    ("Leak notice (the utility's own letter or message)", "print"), ("Workplaces", "poster")])
def test_the_scene_follows_the_channel(title, kind):
    assert mockup.kind_of(title) == kind


def test_only_presented_executions_at_16_9_are_mockups(on):
    d = _deck()
    assert mockup.applies(d, "s3") and mockup.applies(d, "s4")
    assert not mockup.applies(d, "s6")   # in the appendix
    assert not mockup.applies(d, "s2")   # not an execution
    d["meta"]["preferences"] = {"size": {"canvas": "4:3"}}
    assert not mockup.applies(d, "s3")   # 4:3 and A4 keep the earlier layout


def test_off_means_off(monkeypatch):
    monkeypatch.setattr(spec, "MOCKUPS", False)
    monkeypatch.setattr(spec, "GRAPHICS", True)
    assert not mockup.applies(_deck(), "s3")
    d = _deck()
    d["meta"]["preferences"] = {"look": {"graphics": {"mockups": False}}}
    monkeypatch.setattr(spec, "MOCKUPS", True)
    assert not mockup.applies(d, "s3")   # the deck's own switch for the mock-ups part


def test_headline_and_line_go_in_the_ad_and_a_job_label_is_never_the_brand():
    cp = mockup.copy_of({"meta": {"client": "Tabbel"}}, {"lines": SHORT, "answer": ""})
    assert cp["headline"] == SHORT[0] and cp["line"] == "Tabbel. Only what cats need." and cp["middle"] == [SHORT[1]]
    assert mockup.copy_of({"meta": {"client": "Brief 1"}}, {"lines": SHORT})["brand"] == mockup.BRAND_PLACEHOLDER
    labelled = mockup.copy_of({"meta": {"client": "Tabbel"}}, {"lines": ["Headline: Ask us anything.", "[Answer: to confirm]", "Strapline: Ask."]})
    assert labelled["headline"] == "Ask us anything." and labelled["line"] == "Ask."   # a placeholder never goes in the ad


@pytest.mark.parametrize("title", ["Bus-stop outdoor", "Roadside billboard", "Social video", "In-store wobbler", "Local radio",
                                   "TV and online video", "Door drops", "Workplaces"])
@pytest.mark.parametrize("pic", [False, True])
@pytest.mark.parametrize("lines", [SHORT, LONG])
def test_every_scene_stays_in_its_box_and_never_drops_a_line(title, pic, lines):
    cp = mockup.copy_of({"meta": {"client": "Tabbel"}}, {"lines": lines, "answer": "It answers."})
    sc = mockup.scene(title, BOX, cp, {"picture": {}} if pic else {}, FONTS)
    x, y, w, h = BOX
    for o in sc.ops:
        assert o["x"] >= x - 1e-6 and o["y"] >= y - 1e-6 and o["x"] + o["w"] <= x + w + 1e-6 and o["y"] + o["h"] <= y + h + 1e-6, o["name"]
        if o["op"] == "text":
            assert o["size"] >= mockup.MIN_PT and o["lines"]
    if sc.kind not in ("radio", "film"):
        assert cp["headline"] in sc.used, "the headline is set in the ad"
        assert any(o["op"] == ("pic" if pic else "rect") and o["name"] in ("Mock-up picture", "Mock-up face", "Mock-up page") for o in sc.ops)
    left = [i["text"] for b in mockup.left_blocks(sc, cp) for i in b.get("items") or []]
    for ln in lines:   # every copy line is on the slide once: in the ad or in the left column
        assert (ln in left) != (ln in sc.used or mockup._unspeak(ln) in sc.used), ln


def test_no_picture_is_a_typographic_ad_never_an_empty_frame():
    cp = mockup.copy_of({"meta": {"client": "Tabbel"}}, {"lines": SHORT})
    sc = mockup.scene("Bus-stop outdoor", BOX, cp, {}, FONTS)
    assert not sc.slots and any(o["name"] == "Mock-up face" for o in sc.ops)
    assert any(o["op"] == "text" and o["name"] == "Mock-up headline" for o in sc.ops)
    with_pic = mockup.scene("Bus-stop outdoor", BOX, cp, {"picture": {"asset": "a"}}, FONTS)
    assert with_pic.slots == ["picture"] and any(o["name"] == "Mock-up band" for o in with_pic.ops)


def test_radio_is_a_script_card_with_a_wave_and_its_speakers():
    cp = mockup.copy_of({"meta": {"client": "Tabbel"}}, {"lines": ["SFX: a bowl set down.", "WOMAN (quietly): Is that all?", "VO: Tabbel."]})
    sc = mockup.scene("Local radio", BOX, cp, {}, FONTS)
    assert sum(1 for o in sc.ops if o["name"] == "Mock-up wave") == len(mockup.WAVE)
    speakers = [o["lines"][0] for o in sc.ops if o["name"] == "Mock-up speaker"]
    assert speakers == ["SFX", "WOMAN", "VO"] and not sc.spill


def test_film_is_three_or_four_storyboard_frames_ending_on_the_end_card():
    cp = mockup.copy_of({"meta": {"client": "Tabbel"}}, {"lines": SHORT})
    sc = mockup.scene("TV and online video", BOX, cp, {"picture": {}}, FONTS)
    frames = [o for o in sc.ops if o["name"] == "Mock-up storyboard"]
    assert len(frames) == 3 and any(o["name"] == "Mock-up end card" for o in sc.ops) and sc.slots == ["picture"]
    shots = {f"shot_{i}": {} for i in range(1, 5)}
    sc4 = mockup.scene("TV and online video", BOX, cp, shots, FONTS)
    assert sum(1 for o in sc4.ops if o["name"] == "Mock-up storyboard") == 4 and sc4.slots == sorted(shots)   # Production shots first


def test_the_web_draws_the_same_scene_as_one_svg():
    cp = mockup.copy_of({"meta": {"client": "Tabbel"}}, {"lines": SHORT})
    sc = mockup.scene("Door drops", BOX, cp, {"picture": {}}, FONTS)
    svg = mockup.svg(sc, lambda slot: "data:image/jpeg;base64,AAAA")
    words = " ".join(re.findall(r"<tspan[^>]*>([^<]*)</tspan>", svg))   # the headline is wrapped over several lines
    assert svg.startswith('<svg class="mock-svg"') and "<image " in svg and "var(--ink)" in svg
    assert "Look at what is gone from the bowl." in words


def test_the_pptx_paints_the_scene_and_the_web_follows_its_box(on):
    assert "_lay_mockup" in render_pptx.Renderer.__dict__ and "_paint_mockup" in render_pptx.Renderer.__dict__
    import inspect
    src = inspect.getsource(render_pptx.Renderer._lay_execution) + inspect.getsource(render_pptx.Renderer._lay_execution_stack)
    assert src.count("self._mock_on(s)") == 2
    assert "mockup_box" in inspect.getsource(render_pptx.render)


def test_stage_g_gets_a_slot_per_presented_execution_five_at_most(on):
    deck = {"order": ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"], "slides": {
        "s1": {"type": "title"}, "s2": {"type": "idea"}, "s3": {"type": "execution"}, "s4": {"type": "execution"},
        "s5": {"type": "execution"}, "s6": {"type": "audience"}, "s7": {"type": "appendix"}, "s8": {"type": "execution"}}}
    cands = [{"sid": s, "slot": "picture"} for s in deck["order"]]
    got = [c["sid"] for c in scene.slots_for(deck, cands)]
    assert got == ["s1", "s2", "s3", "s4", "s6"] and len(got) <= scene.MAX_PICTURES


def test_stage_g_is_told_the_execution_card_is_the_ads_picture(on, monkeypatch):
    from deck import stages
    monkeypatch.setattr(spec, "PICTURE_PLAN", True)
    assert stages.MOCKUP_RULE in stages.g_system()
    monkeypatch.setattr(spec, "MOCKUPS", False)
    assert stages.MOCKUP_RULE not in stages.g_system()


def test_the_fit_check_asks_an_executions_picture_is_the_scene_alone():
    card = {"role": "execution", "format": "Bus-stop outdoor", "key_visual": "a rider at a dock", "setting": "a wet street", "must_not": ["not a field"]}
    q = fit.question(card)
    assert "Bus-stop outdoor" in q and "shows_an_ad" in q
    ad = fit.parse('{"shows_idea": true, "setting_seen": "street", "setting_fits": true, "wrong_cues": [], "shows_an_ad": true}')
    assert not fit.verdict(ad)["pass"] and "advert" in fit.correction(card, fit.verdict(ad))
    ok = fit.parse('{"shows_idea": true, "setting_seen": "street", "setting_fits": true, "wrong_cues": [], "shows_an_ad": false}')
    assert fit.verdict(ok)["pass"]
    assert "shows_an_ad" not in fit.question({"key_visual": "a bowl", "setting": "a shop"})   # other roles ask as before


def test_the_graphics_report_names_the_mockups_it_drew(on, tmp_path):
    from pptx import Presentation
    from pptx.util import Inches
    prs = Presentation()
    deck = _deck()
    for sid in deck["order"]:
        sl = prs.slides.add_slide(prs.slide_layouts[6])
        if sid == "s3":
            sl.shapes.add_shape(1, Inches(1), Inches(1), Inches(1), Inches(1)).name = "Mock-up face"
    prs.save(tmp_path / "d.pptx")
    rep = graphics.report(deck, None, tmp_path / "d.pptx")
    assert rep["mockups"] == [{"slide": "s3", "scene": "poster", "picture": False, "typographic": True}]


def test_brief_contamination_is_said_plainly_on_the_gaps_slide():
    sl = assemble._brief_gaps_slide([
        {"kind": "foreign_content", "topic": "objective", "question": "Which objectives are yours?", "what": "x", "why_it_matters": "y"},
        {"kind": "contradiction", "topic": "budget", "question": "Which budget holds?", "what": "x", "why_it_matters": "y"},
        {"kind": "missing", "topic": "audience", "question": "Who is the audience?", "what": "x", "why_it_matters": "y"}])
    items = [i["text"] for i in sl["blocks"][0]["items"]]
    assert items[0].startswith("Part of the brief (the objective) appears to come from another brand's brief; we've set it aside.")
    assert items[1] == "The brief contradicts itself on the budget. Which budget holds?"
    assert items[2] == "Who is the audience?"
