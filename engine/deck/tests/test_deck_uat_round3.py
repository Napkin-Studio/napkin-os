"""UAT round 3 (Harrowgate, 2026-11-23): the Deck faults two rounds of fixtures did not catch. Each test is built from the REAL Harrowgate deck
document the UAT downloaded (fixtures/harrowgate/deck_pitch.json: its 19 presented slides, as the engine wrote them, and the evidence they cite;
Harrowgate Bakery Co. is a fictional client) and from the metadata of its Production export (fixtures/harrowgate/production.json: one key visual,
17 sizes, six storyboard frames). Offline: no model, no network, no LibreOffice.
Run from engine/: ``PYTHONPATH=. python3 -m pytest deck/tests/test_deck_uat_round3.py``."""
from __future__ import annotations

import copy
import hashlib
import io
import json
import re
from pathlib import Path

import pytest
from PIL import Image
from pptx import Presentation

from deck import assemble, export_clean, images, inputs, profiles, render_pptx, render_web, spec
from deck.inputs import answered_question

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "harrowgate"
LUMEN = HERE / "fixtures" / "lumen_water"

ID = re.compile(r"\b(?:f|fi)_[A-Za-z0-9]{6,}|\b(?:brief|req):[A-Za-z0-9_.]+")
TO_CONFIRM = re.compile(r"(?i)\bto confirm\b")


@pytest.fixture(autouse=True)
def look(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(spec, "GRAPHICS", True)


def _real():
    return json.loads((FIX / "deck_pitch.json").read_text())


def _prod_with_pictures(tmp_path):
    """The Harrowgate export's metadata with a small real picture under every item (the UAT export held no bytes), at the item's own shape."""
    prod = json.loads((FIX / "production.json").read_text())
    (tmp_path / "assets").mkdir(exist_ok=True)
    for it in prod["items"].values():
        w, h = (it["aspect"]["w"], it["aspect"]["h"]) if it.get("aspect") else (it["width"], it["height"])
        k = 120 / max(w, h)
        w, h = max(8, round(w * k)), max(8, round(h * k))
        im = Image.new("RGB", (w, h), (200, 160, 90))
        im.putpixel((0, 0), (len(it["entity"]) % 255, 1, 2))
        b = io.BytesIO()
        im.save(b, "PNG")
        data = b.getvalue()
        sha = hashlib.sha256(data).hexdigest()
        (tmp_path / "assets" / f"{sha}.png").write_bytes(data)
        it.update(sha256=sha, file=f"assets/{sha}.png", width=w, height=h, bytes=len(data), mime="image/png")
        if it["role"] != "size":
            it["aspect"] = {"w": w, "h": h}
    return prod


def _slide(deck, sid):
    return deck["slides"][sid]


def _mini_deck(*sids):
    real = _real()
    slides = {sid: copy.deepcopy(real["slides"][sid]) for sid in sids}
    for s in slides.values():   # as the idea stage wrote it, before any picture was bound
        s["slots"] = {k: v for k, v in (s.get("slots") or {}).items() if k in ("title", "lead", "copy", "points")}
        s.pop("strip", None)
        s.pop("ooh", None)
    return {"meta": {"client": "Harrowgate Bakery Co.", "project": "Proper Crunch", "audience": "review"}, "order": list(slides), "slides": slides}


# ================================================================================================ 1. the cover has a picture
def test_the_cover_takes_the_portrait_key_visual_in_its_own_column(tmp_path):
    prod = _prod_with_pictures(tmp_path)
    deck = _mini_deck("s01")
    images.bind_production(deck, prod, "creative_cover", ())
    im = _slide(deck, "s01")["slots"]["picture"]["image"]
    assert im["status"] == "made" and im.get("asset"), im   # round 3: status empty, "would lose part of its protected area in a 16:9 crop"
    assert im["text_zone"].get("none") is True   # never the full-bleed cover: its 16:9 crop would cut the bag


def test_a_landscape_cover_picture_still_goes_full_width_when_it_fits(tmp_path):
    prod = _prod_with_pictures(tmp_path)
    mk = next(k for k, it in prod["items"].items() if it["role"] == "master")
    prod["items"][mk].pop("keep", None)   # nothing to protect: any crop is fine
    deck = _mini_deck("s01")
    images.bind_production(deck, prod, "creative_cover", ())
    assert "text_zone" not in _slide(deck, "s01")["slots"]["picture"]["image"]


# ================================================================================================ 2. one storyboard slide, every frame
def _storyboard_deck(tmp_path):
    prod = _prod_with_pictures(tmp_path)
    deck = _mini_deck("s10", "s12")   # the idea stage's own 'Storyboard frames: six stills as an Instagram and TikTok carousel'
    got = images.bind_production(deck, prod, "creative_cover", ())
    return deck, prod, got


def test_the_idea_stages_storyboard_is_the_storyboard_slide_and_none_is_added(tmp_path):
    deck, prod, got = _storyboard_deck(tmp_path)
    assert images.execution_channel(_slide(deck, "s12")["title"]) == "film"   # was social: a phone-frame size, so Production's frames were never bound to it
    assert "added_storyboard" not in got   # (the out-of-home slide it adds is another matter)
    titles = [deck["slides"][k]["title"] for k in deck["order"]]
    assert sum("storyboard" in t.lower() for t in titles) == 1


def test_the_strip_holds_every_frame_production_made_and_the_title_counts_them(tmp_path):
    deck, prod, _ = _storyboard_deck(tmp_path)
    s = _slide(deck, "s12")
    frames = [k for k, it in prod["items"].items() if it["role"] == "frame"]
    assert len(frames) == 6
    assert s["strip"]["shots"] == [1, 2, 3, 4, 5, 6] and s["strip"]["of"] == 6 and "note" not in s["strip"]   # round 3: four of six, titled "six stills"
    assert [k for k in s["slots"] if k.startswith("shot_")] == [f"shot_{i}" for i in range(1, 7)]
    assert "six stills" in s["title"]
    assert len(s["strip"]["captions"]) == 6 and s["strip"]["captions"][0].startswith("Baked crisps")   # the slide's own 'Frame n:' lines


def test_six_frames_are_drawn_whole_in_two_rows_in_the_pptx_and_the_web_deck(tmp_path):
    deck, prod, _ = _storyboard_deck(tmp_path)
    pics = images.copy_assets(deck, tmp_path / "out", "review", [tmp_path], None)
    placed = set()
    pp = render_pptx.render(deck, inputs.Inputs(brief={}), tmp_path / "d.pptx", None, [], pictures=pics, placed=placed)
    prs = Presentation(str(pp))
    sl = prs.slides[1]
    strip = [sh for sh in sl.shapes if sh.name == "Strip picture"]
    assert len(strip) == 6
    W, H = prs.slide_width, prs.slide_height
    assert all(sh.left >= 0 and sh.top >= 0 and sh.left + sh.width <= W and sh.top + sh.height <= H for sh in strip)
    rows = sorted({round(sh.top / 91440, 1) for sh in strip})
    assert len(rows) == 2
    for i, a in enumerate(strip):   # no frame sits on another
        for b in strip[i + 1:]:
            assert a.left + a.width <= b.left or b.left + b.width <= a.left or a.top + a.height <= b.top or b.top + b.height <= a.top
    texts = " ".join(sh.text_frame.text for sh in sl.shapes if sh.has_text_frame)
    assert "six stills" in texts
    render_web.render(deck, inputs.Inputs(brief={}), tmp_path / "d.html", [], pictures=pics, placed=placed, look=True)
    html = (tmp_path / "d.html").read_text()
    assert len(re.findall(r'data-slot="shot_\d"', html)) == 6 and "sb2" in html


def test_more_than_six_frames_are_sampled_with_the_note(tmp_path):
    from deck import graphics
    picks, note = graphics.strip_picks(list(range(1, 10)))
    assert len(picks) == 6 and picks[0] == 1 and picks[-1] == 9 and note == "6 of 9 shots"
    assert [graphics.strip_picks(list(range(n)))[0] for n in (3, 4, 5, 6)] == [list(range(n)) for n in (3, 4, 5, 6)]
    assert [spec.strip_rows(n) for n in (3, 4, 5, 6)] == [[3], [4], [3, 2], [3, 3]]


# ================================================================================================ 3 and 4. no id and no "to confirm" in a client export
def _render_clean(tmp_path, deck):
    pp = render_pptx.render(deck, inputs.Inputs(brief={}), tmp_path / "c.pptx", None, [], clean=True, placed=set())
    prs = Presentation(str(pp))
    notes = [s.notes_slide.notes_text_frame.text if s.has_notes_slide else "" for s in prs.slides]
    texts = [" ".join(sh.text_frame.text for sh in s.shapes if sh.has_text_frame) for s in prs.slides]
    return notes, texts


def test_no_evidence_id_is_in_any_note_of_the_real_harrowgate_deck(tmp_path):
    real = _real()
    deck = {"meta": real["meta"], "order": [k for k in real["order"] if k != "s39"], "slides": copy.deepcopy(real["slides"])}   # (s39 is the picture-only storyboard slide)
    for s in deck["slides"].values():   # no picture files here
        s["slots"] = {k: v for k, v in (s.get("slots") or {}).items() if v.get("kind") != "image"}
    notes, texts = _render_clean(tmp_path, deck)
    bad = [(i + 1, ID.findall(n)) for i, n in enumerate(notes) if ID.search(n)]
    assert not bad, bad   # round 3: req:R14, brief:reasons_to_believe, fi_..., f_... in the speaker notes of slides 5, 7 and 15
    assert not [t for t in texts if ID.search(t)]
    assert not [n for n in notes if TO_CONFIRM.search(n)]   # slides 4, 7 and 8 carried "(to confirm)" and "To confirm: ..." in their notes


def test_the_real_claim_says_what_is_open_in_plain_words():
    line = "43% choose on promotion while 11% buy the less guilty option (to confirm). Trial comes through the deal, and the treat must not apologise."
    kept, found = export_clean.clean_text(line)
    assert "confirm" not in kept.lower() and kept.startswith("43% choose on promotion")
    assert found == ["43% choose on promotion while 11% buy the less guilty option (to settle)."]   # was the bare "(to confirm)", which read "(to confirm)" in the appendix
    assert not TO_CONFIRM.search(export_clean.client_text("- Any 'less fat' line needs a comparator. To confirm: CAP Section 15 clearance."))


def test_the_open_points_slides_never_say_to_confirm():
    real = _real()
    deck = {"meta": real["meta"], "order": list(real["order"]), "slides": copy.deepcopy(real["slides"])}
    s = deck["slides"]["s04"]
    s["blocks"][0]["text"] = "43% choose on promotion while 11% buy the less guilty option (to confirm)."
    deck["slides"]["s07"]["blocks"].append({"kind": "bullets", "items": [{"text": "40% less fat than the leading fried crisps. To confirm: the comparator range."}]})
    deck["slides"]["s01"]["blocks"].append({"kind": "text", "text": "[a bracketed blank to fill]"})
    deck["order"].append("s_div")
    deck["slides"]["s_div"] = {**copy.deepcopy(deck["slides"]["s04"]), "type": "appendix", "title": "Appendix", "blocks": [], "claims": []}
    got = export_clean.scrub(deck)
    assert got["items"] >= 3
    open_titles = [deck["slides"][k]["title"] for k in deck["order"] if deck["slides"][k]["title"].startswith(export_clean.OPEN_TITLE)]
    assert open_titles and not any(TO_CONFIRM.search(t) for t in open_titles)
    everything = json.dumps([[deck["slides"][k]["title"], deck["slides"][k]["blocks"]] for k in deck["order"]], ensure_ascii=False)
    assert not TO_CONFIRM.search(everything), TO_CONFIRM.findall(everything)   # round 3: "Open items to confirm" x3 and "(to confirm)" x4 in the appendix


# ================================================================================================ 5. the questions slide
HARROWGATE_QUESTION = ("What is the 40% less fat claim measured against (which fried crisp, which test), and is it substantiated? — Answer: It is measured "
                       "against the leading ready-salted fried crisps, lab tested. Say 40% less fat than the leading fried crisps, and name the comparator on pack.")


def _lumen_build(inp, st=None, **kw):
    st = st or {k: json.loads((LUMEN / f).read_text()) for k, f in (("a", "a_requirements.json"), ("b", "b_storyline.json"), ("c", "c_territories.json"), ("d", "d_idea.json"))}
    return assemble.build(inp, st, client="Lumen Water", project="Working name", **kw)


def test_a_deck_with_no_open_question_has_no_questions_slide():
    assert answered_question(HARROWGATE_QUESTION)
    inp = inputs.load(LUMEN / "brief_object.json")
    inp.open_questions = [{"question": HARROWGATE_QUESTION}]
    deck = _lumen_build(inp)
    assert not [s for s in deck["slides"].values() if s["type"] == "questions"]   # round 3: the slide came out with nothing under it


def test_a_deck_with_an_open_question_keeps_the_slide_and_lists_it():
    inp = inputs.load(LUMEN / "brief_object.json")
    inp.open_questions = [{"question": HARROWGATE_QUESTION}, {"question": "Who signs off the film?"}]
    deck = _lumen_build(inp)
    q = next(s for s in deck["slides"].values() if s["type"] == "questions")
    assert [i["text"] for i in q["blocks"][0]["items"]] == ["Who signs off the film?"]


# ================================================================================================ 7. the campaign line
def test_the_briefs_one_line_is_the_idea_line_word_for_word():
    inp = inputs.load(LUMEN / "brief_object.json")
    inp.brief = {**inp.brief, "smp": {"value": "Proper crunch."}}
    st = {k: json.loads((LUMEN / f).read_text()) for k, f in (("a", "a_requirements.json"), ("b", "b_storyline.json"), ("c", "c_territories.json"), ("d", "d_idea.json"))}
    st["d"] = {**st["d"], "campaign_line": "Proper crunch. Not sorry.", "idea": "Oven Crisps stop saying Proper crunch. Not sorry. and just say crunch.",
               "executions": [{**st["d"]["executions"][0], "copy": ["Proper crunch. Not sorry.", "Baked by a real bakery."]}]}
    deck = _lumen_build(inp, st)
    idea = next(s for s in deck["slides"].values() if s["type"] == "idea")
    assert idea["title"] == "Proper crunch."   # round 3: "Proper crunch. Not sorry."
    assert "Not sorry" not in json.dumps(deck["slides"], ensure_ascii=False)
    assert "Agree 'Proper crunch' as the campaign platform" in json.dumps(deck["slides"], ensure_ascii=False)


def test_the_prompts_own_one_line_counts_when_the_brief_gives_none():
    inp = inputs.Inputs(brief={}, prompt_text="A pitch deck for Harrowgate Bakery Co.: Proper Crunch. Harrowgate Oven Crisps, in a 120 g bag. One line: Proper crunch.")
    assert assemble.stated_line(inp) == ("Proper crunch.", True)
    assert assemble.stated_line(inputs.Inputs(brief={"smp": {"value": "To agree."}}, prompt_text="No line here.")) == ("", False)
    longer = inputs.Inputs(brief={"smp": {"value": "A very long proposition that runs on and on across the page for far too many words, surely."}})
    assert assemble.stated_line(longer) == ("", False)   # a paragraph is not a line
    assert assemble.stated_line(inputs.Inputs(brief={"smp": {"value": "Proper crunch."}})) == ("Proper crunch.", False)
    # a proposition only corrects a line that is that proposition grown: an unrelated creative line stands (the Lumen golden's "Tide's in.")
    d = {"campaign_line": "Tide's in."}
    assert assemble.keep_stated_line(d, "Every drop has a story.") is d
    assert assemble.keep_stated_line(d, "Every drop has a story.", True)["campaign_line"] == "Every drop has a story."


# ================================================================================================ 8. no tender content on an agency pitch
def test_the_tender_scope_note_belongs_to_the_tender_profile_only():
    inp = inputs.load(LUMEN / "brief_object.json")
    pitch = _lumen_build(inp, profile=profiles.load("agency_pitch"))
    roles = next(s for s in pitch["slides"].values() if s["type"] == "channel_roles")
    assert "tender" not in roles["notes"].lower() and "Scope check" not in roles["notes"]   # round 3: slide 14 of an agency pitch
    default = _lumen_build(inp)
    assert "Scope check" not in next(s for s in default["slides"].values() if s["type"] == "channel_roles")["notes"]
    tender = _lumen_build(inp, profile=profiles.load("tender_response"))
    assert any("Scope check" in s.get("notes", "") for s in tender["slides"].values() if s["type"] == "channel_roles")


# ================================================================================================ client polish after round 3: no planning text, a quiet footnote
def _clean_storyboard(tmp_path, extra_line="Contains wheat. See pack for allergens."):
    deck, prod, _ = _storyboard_deck(tmp_path)
    s = _slide(deck, "s12")
    copy = next(b for b in s["blocks"] if b["kind"] == "copy")
    copy["lines"] = [ln for ln in copy["lines"]] + [extra_line]
    export_clean.scrub(deck)
    return deck


def test_planning_text_never_reaches_a_client_slide_and_moves_to_the_notes():
    real = _real()
    deck = {"meta": real["meta"], "order": list(real["order"]), "slides": copy.deepcopy(real["slides"])}
    before = [k for k in deck["order"] if any(str(b.get("text", "")).startswith("Role:") for b in deck["slides"][k]["blocks"])]
    assert len(before) >= 3   # the key visual, out of home and storyboard slides of the real deck all carried "Role: ..."
    export_clean.scrub(deck)
    for k in deck["order"]:
        s = deck["slides"][k]
        assert not [b for b in s["blocks"] if str(b.get("text", "")).lstrip().lower().startswith(("role:", "the storyboard frames made in production"))], k
    kept = deck["slides"][before[0]]["notes"]
    assert kept.startswith("Role:") and "Role:" in export_clean.notes_of(kept)   # the words stay for the speaker
    only = {"blocks": [{"kind": "text", "text": "Role: x"}, {"kind": "text", "text": "A real sentence."}, {"kind": "copy", "lines": ["Role: a line of the work"]}]}
    assert export_clean.take_planning_text(only) == ["Role: x"] and len(only["blocks"]) == 2   # a copy line that starts with the word is the work itself


def test_a_clean_storyboard_slide_has_no_role_text_in_the_pptx_the_web_deck_or_the_pdf_words(tmp_path):
    deck = _clean_storyboard(tmp_path)
    pics = images.copy_assets(deck, tmp_path / "out", "review", [tmp_path], None)
    placed = set()
    pp = render_pptx.render(deck, inputs.Inputs(brief={}), tmp_path / "d.pptx", None, [], pictures=pics, placed=placed, clean=True)
    sl = Presentation(str(pp)).slides[1]
    texts = " ".join(sh.text_frame.text for sh in sl.shapes if sh.has_text_frame)
    assert "Role:" not in texts and "Six stills that show" not in texts
    assert "Role:" in sl.notes_slide.notes_text_frame.text
    render_web.render(deck, inputs.Inputs(brief={}), tmp_path / "d.html", [], pictures=pics, placed=placed, look=True, clean=True)
    html = (tmp_path / "d.html").read_text()
    section = html[html.index('id="s12"'):]
    section = section[:section.index("</section>")]
    assert "Role:" not in section and "Six stills that show" not in re.sub(r'<div class="notes".*', "", section, flags=re.S)


def test_a_line_beside_the_frames_is_one_small_footnote_under_them_not_a_panel(tmp_path):
    deck = _clean_storyboard(tmp_path)
    pics = images.copy_assets(deck, tmp_path / "out", "review", [tmp_path], None)
    placed = set()
    pp = render_pptx.render(deck, inputs.Inputs(brief={}), tmp_path / "d.pptx", None, [], pictures=pics, placed=placed, clean=True)
    prs = Presentation(str(pp))
    sl = prs.slides[1]
    strip = [sh for sh in sl.shapes if sh.name == "Strip picture"]
    foot = [sh for sh in sl.shapes if sh.name == "StoryboardLines"]
    assert len(foot) == 1 and "Contains wheat" in foot[0].text_frame.text
    assert foot[0].top >= max(sh.top + sh.height for sh in strip)   # under the frames
    assert foot[0].height < 0.5 * 914400 and foot[0].text_frame.paragraphs[0].runs[0].font.size.pt <= 12   # the 12 pt caption floor
    assert not [sh for sh in sl.shapes if sh.shape_type == 1 and sh.width > 3 * 914400 and sh.height > 1.2 * 914400 and sh.top < strip[0].top]   # no big filled panel above the frames
    render_web.render(deck, inputs.Inputs(brief={}), tmp_path / "d.html", [], pictures=pics, placed=placed, look=True, clean=True)
    html = (tmp_path / "d.html").read_text()
    section = html[html.index('id="s12"'):]
    section = section[:section.index("</section>")]
    assert re.search(r'class="[^"]*\bsb-foot\b', section) and "Contains wheat. See pack for allergens." in section
    assert 'class="body split exec' not in section   # not the dark copy panel
