"""The 4-tool gate's last blocker (UAT develop cc786b51, the deck from the Production project): slide 9 "Key visual: station posters" had
no picture, printed its working picture prompt as slide text ("Image prompt (illustrative, not final): Close, honest still in a small
rented kitchen…") and set its poster copy past the frame. Also from that run: the brief deck's territory risks printed as a raw list
("['Category safety: …', …]") in the slides and the PDF appendix, and slide 2 said one objective twice in different words.
No model call; the fixtures are invented (Harrowgate, Lumen). Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests/test_deck_gate_kv.py``.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import pytest
from pptx import Presentation

from deck import assemble, images, inputs, profiles, render_pptx, render_web, spec
from deck.tests.test_deck_uat_round3 import _prod_with_pictures, _real

HERE = Path(__file__).parent
TYPES = HERE / "fixtures" / "types"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
#: Words that are a picture prompt's, never client copy.
PROMPTISH = re.compile(r"(?i)\bimage prompt\b|\bmood frame for\b|illustrative, not final\)?:")


@pytest.fixture(autouse=True)
def look(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(spec, "GRAPHICS", True)


def _st(pid="agency_pitch") -> dict:
    return {k: json.loads((TYPES / pid / f).read_text()) for k, f in FILES.items() if (TYPES / pid / f).exists()}


def _build(st, pid="agency_pitch"):
    inp = inputs.load(None, prompt_text=(TYPES / pid / "prompt.txt").read_text().strip())
    return assemble.build(inp, st, client="Fixture Client", project="Fixture Project", profile=profiles.load(pid)), inp


FERN = HERE / "fixtures" / "fernley"


def _prompted_deck():
    """A built deck (the Fernley recording: three executions) whose executions each carry a picture prompt and no picture."""
    st = {k: json.loads((FERN / "stages" / f).read_text()) for k, f in FILES.items()}
    for x in st["d"].get("executions") or []:
        x["visual"] = {"kind": "image_prompt", "prompt": "Close, honest still in a small rented kitchen. Clear empty space top right for the logo.",
                       "status": "illustrative, not final"}
    inp = inputs.load(None, prompt_text=(FERN / "prompt.txt").read_text().strip())
    return assemble.build(inp, st, client="Fixture Client", project="Fixture Project", profile=profiles.load("agency_pitch")), inp


def _slide_texts(pptx: Path) -> tuple[list, list]:
    prs = Presentation(str(pptx))
    texts = [" ".join(sh.text_frame.text for sh in s.shapes if sh.has_text_frame) for s in prs.slides]
    notes = [s.notes_slide.notes_text_frame.text if s.has_notes_slide else "" for s in prs.slides]
    return texts, notes


# ---------------------------------------------------------------- a picture prompt is never client copy

def test_a_picture_prompt_stays_the_makers_brief_and_never_reaches_a_slide(tmp_path):
    deck, inp = _prompted_deck()
    ex = [deck["slides"][s] for s in deck["order"] if deck["slides"][s]["type"] == "execution"]
    assert ex and all("small rented kitchen" in (x.get("visual") or {}).get("prompt", "") for x in ex), "the brief is kept in the slide's data"
    texts, _ = _slide_texts(render_pptx.render(deck, inp, tmp_path / "d.pptx", None, []))
    assert not any(PROMPTISH.search(t) or "small rented kitchen" in t for t in texts), "no slide of the PowerPoint shows the prompt"
    render_web.render(deck, inp, tmp_path / "d.html", [])
    slides = re.sub(r'<aside class="notes".*?</aside>|<script.*?</script>|data-notes="[^"]*"', "", (tmp_path / "d.html").read_text(), flags=re.S)
    assert "Image prompt" not in slides and "small rented kitchen" not in slides


def test_no_client_slide_of_any_deck_carries_prompt_words(tmp_path):
    """The guard over every renderer path a person reads: the PowerPoint, the web deck (printed as the PDF), the clean client copy."""
    deck, inp = _prompted_deck()
    for clean in (False, True):
        texts, _ = _slide_texts(render_pptx.render(copy.deepcopy(deck), inp, tmp_path / f"c{clean}.pptx", None, [], clean=clean, placed=set()))
        assert not [t for t in texts if PROMPTISH.search(t)], texts
        render_web.render(copy.deepcopy(deck), inp, tmp_path / f"c{clean}.html", [], clean=clean)
        body = re.sub(r'<aside class="notes".*?</aside>|<script.*?</script>|data-notes="[^"]*"', "", (tmp_path / f"c{clean}.html").read_text(), flags=re.S)
        assert not PROMPTISH.search(body)


# ---------------------------------------------------------------- the key visual stands in for a poster with no size

def _kv_only(tmp_path):
    prod = _prod_with_pictures(tmp_path)
    prod["items"] = {k: v for k, v in prod["items"].items() if v["role"] == "master"}
    return prod


def test_a_poster_with_no_size_shows_the_key_visual_and_says_so(tmp_path):
    deck = _real()
    sid = next(s for s in deck["order"] if deck["slides"][s]["type"] == "execution")
    deck["slides"][sid]["title"] = "Key visual: station posters"
    deck["slides"][sid]["slots"].pop("picture", None)
    prod = _kv_only(tmp_path)
    master = next(iter(prod["items"]))
    got = images.bind_production(deck, prod, names=())
    im = deck["slides"][sid]["slots"]["picture"]["image"]
    assert (im.get("from") or {}).get("key") == master, im
    assert "The key visual stands in here: Production has no out-of-home size of it yet." in deck["slides"][sid]["notes"]
    assert not any(h["slide"] == sid for h in got["held"])


@pytest.mark.parametrize("title, takes", [("Instagram and TikTok", False), ("Storyboard frames: six stills", False), ("Print ad in the Metro", True)])
def test_only_a_poster_print_or_display_execution_takes_the_key_visual(tmp_path, title, takes):
    deck = _real()
    sid = next(s for s in deck["order"] if deck["slides"][s]["type"] == "execution")
    deck["slides"][sid]["title"] = title
    deck["slides"][sid]["slots"].pop("picture", None)
    prod = _kv_only(tmp_path)
    images.bind_production(deck, prod, names=())
    im = ((deck["slides"][sid].get("slots") or {}).get("picture") or {}).get("image") or {}
    assert ((im.get("from") or {}).get("key") == next(iter(prod["items"]))) is takes


def test_with_no_key_visual_either_the_slot_is_a_clean_gap(tmp_path):
    deck = _real()
    sid = next(s for s in deck["order"] if deck["slides"][s]["type"] == "execution")
    deck["slides"][sid]["title"] = "Key visual: station posters"
    deck["slides"][sid]["slots"].pop("picture", None)
    prod = _prod_with_pictures(tmp_path)
    prod["items"] = {k: v for k, v in prod["items"].items() if v["role"] == "frame"}
    images.bind_production(deck, prod, names=())
    im = ((deck["slides"][sid].get("slots") or {}).get("picture") or {}).get("image") or {}
    assert (im.get("from") or {}).get("key") is None


# ---------------------------------------------------------------- the poster's words fit its frame

def test_the_poster_sets_its_lines_at_a_size_that_fits():
    uat = ["One tablet. Tap water. Now watch the hob.", "In shops and online.", "Refill. Not landfill."]
    assert render_web.poster_px(uat) < 64 and render_web.poster_px(["Drop.", "Shake."]) == 64
    assert render_web.poster_px(["word " * 80]) == render_web.POSTER_PX[-1]


# ---------------------------------------------------------------- a list is never printed as a list; an objective is said once

def test_a_territorys_risks_list_reads_as_sentences_in_the_slides_and_the_appendix(tmp_path):
    st = _st()
    for t in st["c"]["territories"]:
        t["risks"] = ["Category safety: a demo can be read as a claim", "Ownability is moderate"]
    deck, inp = _build(st)
    kv = [r for s in deck["slides"].values() for b in s["blocks"] if b["kind"] == "kv" for r in b["items"]]
    risks = [v for k, v in kv if k == "Risks"]
    assert risks and all(v == "Category safety: a demo can be read as a claim. Ownability is moderate." for v in risks)
    texts, _ = _slide_texts(render_pptx.render(deck, inp, tmp_path / "r.pptx", None, [], clean=True, placed=set()))
    render_web.render(deck, inp, tmp_path / "r.html", [], clean=True)
    body = re.sub(r"<script.*?</script>", "", (tmp_path / "r.html").read_text(), flags=re.S)
    assert not any("['" in t for t in texts) and "[&#39;" not in body and "['" not in body


def test_an_objective_already_on_slide_two_is_not_said_again_in_the_briefs_words():
    st = _st()
    st["a"]["requirements"] = [r for r in st["a"]["requirements"] if r["kind"] != "objective"] + [
        {"id": "R2", "kind": "objective", "text": "Shoppers should feel the refill is as effective as the big brands.", "ref": "brief:objectives.attitudinal"}]
    inp = inputs.load(None, prompt_text=(TYPES / "agency_pitch" / "prompt.txt").read_text().strip())
    inp.brief["objectives"] = {"value": {"attitudinal": "It should also feel as effective as the big brands."}}
    deck = assemble.build(inp, st, client="C", project="P", profile=profiles.load("agency_pitch"))
    obj = next(s for s in deck["slides"].values() if s["type"] == "objective")
    said = json.dumps(obj["blocks"])
    assert "as effective as the big brands" in said and "It should also feel" not in said
