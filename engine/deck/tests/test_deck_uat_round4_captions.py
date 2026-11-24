"""UAT round 4 (deck A, a deck made from a Production project, fictional brand): the storyboard captions under the frames overlapped when a
frame's line wrapped past its row. Every caption box now has the height its lines need, so none runs over a frame or another caption."""

from __future__ import annotations

import json

import pytest
from pptx import Presentation

from deck import images, inputs, render_pptx, render_web, spec

import test_deck_uat_round3 as R3   # the Harrowgate storyboard fixture (fictional client)

EMU = 914400


@pytest.fixture(autouse=True)
def look(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(spec, "GRAPHICS", True)


LONG = ("A shopper drops one tablet into tap water in the amber bottle, shakes it and watches the fizz turn it into a working cleaner on "
        "the worktop beside the candle")


def _five_long(tmp_path):
    deck, prod, _ = R3._storyboard_deck(tmp_path)
    s = deck["slides"]["s12"]
    for k in [k for k in s["slots"] if k.startswith("shot_")][5:]:   # five frames: two rows, three and two
        del s["slots"][k]
    s["strip"]["shots"] = s["strip"]["shots"][:5]
    s["strip"]["captions"] = [f"{LONG} ({n})." for n in range(1, 6)]
    return deck


def _boxes(shapes, name):
    return [(sh.left / EMU, sh.top / EMU, sh.width / EMU, sh.height / EMU) for sh in shapes if sh.name == name]


def _overlap(a, b):
    return a[0] < b[0] + b[2] - 0.01 and b[0] < a[0] + a[2] - 0.01 and a[1] < b[1] + b[3] - 0.01 and b[1] < a[1] + a[3] - 0.01


def test_long_frame_captions_never_overlap_a_frame_or_each_other_in_the_pptx(tmp_path):
    deck = _five_long(tmp_path)
    pics = images.copy_assets(deck, tmp_path / "out", "review", [tmp_path], None)
    pp = render_pptx.render(deck, inputs.Inputs(brief={}), tmp_path / "d.pptx", None, [], pictures=pics, placed=set())
    sl = Presentation(str(pp)).slides[1]
    frames, caps = _boxes(sl.shapes, "Strip picture"), _boxes(sl.shapes, "StripCaption")
    assert len(frames) == 5 and len(caps) == 5
    for c in caps:
        assert not any(_overlap(c, f) for f in frames), c   # round 4: the lines under the first row ran over the second row's frames
    for i, a in enumerate(caps):
        assert not any(_overlap(a, b) for b in caps[i + 1:])
    R = render_pptx.Renderer(deck, inputs.Inputs(brief={}))
    for c, cap in zip(caps, deck["slides"]["s12"]["strip"]["captions"]):
        need = R.nlines(cap, c[2], 10) * render_pptx.Renderer.STRIP_LINE_10
        assert c[3] + 0.02 >= need, (c, need)   # the box holds every line it wraps to: nothing runs out of it


def test_the_web_deck_wraps_two_row_captions_and_never_cuts_them(tmp_path):
    deck = _five_long(tmp_path)
    pics = images.copy_assets(deck, tmp_path / "out", "review", [tmp_path], None)
    placed = set()   # the web deck draws what the pptx placed (as the round-3 strip test does)
    render_pptx.render(deck, inputs.Inputs(brief={}), tmp_path / "d.pptx", None, [], pictures=pics, placed=placed)
    render_web.render(deck, inputs.Inputs(brief={}), tmp_path / "d.html", [], pictures=pics, placed=placed, look=True)
    html = (tmp_path / "d.html").read_text()
    assert html.count('class="sb-cap"') == 5 and LONG in html
    rule = html[html.index(".sb-strip.sb2 .sb-cap{"):].split("}")[0]
    assert "nowrap" not in rule and "ellipsis" not in rule   # every word shows: the caption wraps inside its own cell
