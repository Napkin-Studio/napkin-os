"""deck-graphics slices 2-3 (features/deck-graphics.clan): execution frames drawn from native shapes with Production first, and the film
storyboard strip. The frame geometry (window at the exact format aspect, never out of its box), the frame for each channel and format,
Production sizes bound by channel and shown whole, a stale or rights-pending size never handed to a generated picture, the strip's
picks in shot order (all Production or none), the 'Mock-up' label, the web twin, the checklist items, and the flag: off changes
nothing. Offline: no model, no network, no LibreOffice."""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest
from pptx import Presentation

from deck import from_production as fp, graphics, images, spec
from deck.bench import checklist as cl

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE / "fixtures" / "production_demo"))
import make_bundle as mb   # noqa: E402

sys.path.remove(str(HERE / "fixtures" / "production_demo"))


@pytest.fixture
def gr(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(spec, "GRAPHICS", True)


@pytest.fixture(scope="module")
def bundle(tmp_path_factory):
    p = tmp_path_factory.mktemp("prod") / "napkin-lumen-water-production.zip"
    mb.build(p)
    return p


@pytest.fixture(scope="module")
def prod(bundle):
    return fp.build(bundle, at="2026-11-18T10:00:00+00:00")[0]


def _deck():
    slides = {"s1": {"type": "execution", "title": "Social stories"}, "s2": {"type": "execution", "title": "Outdoor"},
              "s3": {"type": "execution", "title": "TV film"}, "s4": {"type": "execution", "title": "Radio"}}
    return {"meta": {"client": "Lumen Water"}, "order": list(slides), "slides": slides}


def _im(deck, sid, slot="picture"):
    return ((deck["slides"][sid].get("slots") or {}).get(slot) or {}).get("image")


# ================================================================================================ geometry
@pytest.mark.parametrize("kind", graphics.FRAME_KINDS)
@pytest.mark.parametrize("ratio", [9 / 16, 0.8, 2 / 3, 1.0, 1.414, 16 / 9, 2.0, 4.04])
def test_the_window_takes_the_exact_aspect_and_the_frame_stays_in_its_box(kind, ratio):
    for box in ((1.0, 1.2, 4.5, 5.6), (0.0, 0.0, 6.0, 2.0)):
        g = graphics.frame_geometry(kind, ratio, *box)
        x, y, w, h = g["window"]
        assert abs(w / h - ratio) < 1e-9
        ox, oy, ow, oh = g["outer"]
        bx, by, bw, bh = box
        assert ox >= bx - 1e-9 and oy >= by - 1e-9 and ox + ow <= bx + bw + 1e-9 and oy + oh <= by + bh + 1e-9
        assert ox <= x and oy <= y and x + w <= ox + ow + 1e-9 and y + h <= oy + oh + 1e-9   # the window is inside the frame
        assert any(r == "bezel" for r, *_ in g["parts"])


@pytest.mark.parametrize("channel,ratio,fid,want", [
    ("ooh", 2 / 3, "uk-6-sheet", "poster_portrait"), ("ooh", 2.0, "uk-48-sheet", "billboard"), ("ooh", 4.04, "uk-bus-tside", "strip"),
    ("ooh", 9 / 16, "uk-d6", "poster_portrait"), ("social", 9 / 16, "meta-stories-9x16", "phone"), ("social", 0.8, "meta-feed-image-4x5", "phone"),
    ("social", 1.0, "meta-feed-image-1x1", "phone"), ("social", 16 / 9, "youtube-16x9", "screen"), ("film", 16 / 9, "film-16x9", "screen"),
    ("film", 9 / 16, "film-9x16", "phone"), ("film", 1.0, "film-1x1", "phone"), ("print", 1.414, "mag-a4-dps", "spread"),
    ("print", 0.707, "mag-a4-full-page", "poster_portrait"), ("display", 8.0, "iab-728x90", "strip"), (None, 1.0, None, None),
])
def test_the_frame_for_each_channel_and_format(channel, ratio, fid, want):
    assert graphics.frame_kind(channel, ratio, fid) == want


def test_every_default_format_is_in_the_packs():
    packs = graphics.pack_formats()
    assert set(spec.FRAME_FORMATS) == set(graphics.FRAME_KINDS)
    assert all(f in packs for f in spec.FRAME_FORMATS.values())
    assert abs(packs["uk-6-sheet"]["w"] / packs["uk-6-sheet"]["h"] - 2 / 3) < 1e-9 and packs["uk-48-sheet"]["w"] / packs["uk-48-sheet"]["h"] == 2.0


def test_frame_of_production_keeps_its_format_and_generated_takes_the_default():
    deck = {"assets": {"img_a": {"width": 1200, "height": 1800, "source": {"format_id": "uk-6-sheet", "channel": "ooh", "role": "size"}},
                       "img_b": {"width": 1280, "height": 720, "source": {"role": "frame"}},
                       "img_c": {"width": 1000, "height": 1000, "rights": "generated"}}}
    a = graphics.frame_of(deck, "Outdoor", {"asset": "img_a", "from": {"kind": "production"}})
    assert a == {"kind": "poster_portrait", "ratio": 2 / 3, "production": True, "format_id": "uk-6-sheet"}
    b = graphics.frame_of(deck, "TV film", {"asset": "img_b", "from": {"kind": "production"}})
    assert b["kind"] == "screen" and abs(b["ratio"] - 16 / 9) < 1e-9
    c = graphics.frame_of(deck, "Outdoor", {"asset": "img_c", "from": {"kind": "generated"}})
    assert c["kind"] == "poster_portrait" and not c["production"] and c["format_id"] == "uk-6-sheet"   # the 6-sheet's 2:3, cropped to it
    assert graphics.frame_of(deck, "Radio", {"asset": "img_c"}) is None and graphics.frame_of(deck, "Lumen Water", {"asset": "img_c"}) is None


# ================================================================================================ binding: Production first
def test_flag_off_binds_exactly_as_before(prod):
    d = _deck()
    images.bind_production(d, prod)
    assert _im(d, "s2")["from"]["key"] == mb.S_SIX and _im(d, "s3")["from"]["key"] == mb.F1
    assert not any(k.startswith("shot_") for s in d["slides"].values() for k in (s.get("slots") or {}))


def test_production_sizes_are_bound_by_channel_whole(gr, prod):
    d = _deck()
    got = images.bind_production(d, prod)
    assert _im(d, "s1")["from"]["key"] == mb.S_STORY and _im(d, "s2")["from"]["key"] == mb.S_SIX
    rec = d["assets"][_im(d, "s2")["asset"]]
    fr = graphics.frame_of(d, "Outdoor", _im(d, "s2"))
    assert fr["kind"] == "poster_portrait" and abs(fr["ratio"] - rec["width"] / rec["height"]) < spec.PICTURE_STRETCH_TOL   # window = the size
    assert not d["slides"]["s4"].get("slots") and got["held"] == []


def test_a_48_sheet_lands_in_a_billboard_not_held_for_its_shape(gr, tmp_path):
    p, _ = fp.build(_bundle(tmp_path, "wide"))
    six = next(k for k, it in p["items"].items() if it.get("role") == "size" and (it.get("format") or {}).get("format_id") == "uk-6-sheet")
    it = p["items"].pop(six)
    p["items"]["size_48"] = {**it, "key": "size_48", "entity": "size_48", "aspect": {"w": 2, "h": 1}, "width": 1200, "height": 600,
                             "format": {"format_id": "uk-48-sheet"}}
    d = _deck()
    images.bind_production(d, p)
    assert _im(d, "s2")["from"]["key"] == "size_48"
    off = _deck()
    spec.GRAPHICS = False
    try:
        images.bind_production(off, p)
    finally:
        spec.GRAPHICS = True
    assert _im(off, "s2")["from"].get("key") != "size_48"   # before the flag: a 2:1 never fits a 4:5 slot (another shape, or none, is taken)


def _bundle(tmp_path, name):
    out = tmp_path / f"{name}.zip"
    mb.build(out)
    return out


def test_a_stale_only_channel_is_held_never_generated(gr, prod):
    p = copy.deepcopy(prod)
    for it in p["items"].values():
        if it.get("role") == "size" and it.get("channel") == "ooh":
            it["status"] = "stale"
    d = _deck()
    got = images.bind_production(d, p)
    im = _im(d, "s2")
    assert im["status"] == "empty" and "Out of date in Production" in im["reason"] and "asset" not in im
    assert any(h["slide"] == "s2" for h in got["held"])


def test_a_rights_pending_size_is_never_placed(gr, prod):
    p = copy.deepcopy(prod)
    for it in p["items"].values():
        if it.get("role") == "size":
            it["rights"] = "reference_only"
            it["rights_why"] = "upload with no stated licence"
    d = _deck()
    images.bind_production(d, p)
    im = _im(d, "s2")
    assert im["status"] == "empty" and im["reason"].startswith(spec.RIGHTS_TO_SUPPLY) and "asset" not in im
    assert ("s2", "picture") not in images.drawn(d, "review")


# ================================================================================================ the storyboard strip
def test_shot_order_is_productions_rank_and_end_cards_are_left_out(prod):
    keys = images.production_storyboard(prod)
    ranks = [prod["items"][k]["shot_rank"] for k in keys]
    assert ranks == sorted(ranks) and all(prod["items"][k]["shot_kind"] == "shot" for k in keys)
    assert len(keys) == 3   # the demo: shots 1-3 picked, shot 4's pick is a mock (refused at import), the end card is not a shot


def test_strip_picks():
    assert graphics.strip_picks([1, 2]) == ([], "2 placeable storyboard frame(s): a strip needs 3")
    assert graphics.strip_picks([1, 2, 3]) == ([1, 2, 3], "") and graphics.strip_picks([1, 2, 3, 4]) == ([1, 2, 3, 4], "")
    assert graphics.strip_picks([1, 2, 3, 4, 5, 6]) == ([1, 2, 3, 4, 5, 6], "")   # UAT round 3: a storyboard of six is drawn whole (was cut to four)
    picks, note = graphics.strip_picks(list(range(1, 10)))
    assert picks[0] == 1 and picks[-1] == 9 and len(picks) == 6 and picks == sorted(picks) and note == "6 of 9 shots"


def test_a_film_with_three_production_frames_gets_a_strip(gr, prod):
    d = _deck()
    got = images.bind_production(d, prod)
    shots = [_im(d, "s3", f"shot_{i}") for i in (1, 2, 3)]
    assert all(s and s["from"]["kind"] == "production" and s["status"] == "made" for s in shots)
    assert [s["from"]["key"] for s in shots] == images.production_storyboard(prod)
    assert _im(d, "s3", "shot_4") is None and got["strips"] == [{"slide": "s3", "shots": 3, "note": ""}]
    assert d["slides"]["s3"]["strip"] == {"shots": [1, 2, 3], "of": 3}   # the storyboard's own shot numbers, no note when all are drawn


def test_a_long_storyboard_shows_first_last_and_spaced_shots_with_its_note(gr, prod):
    p = copy.deepcopy(prod)
    base = [k for k in images.production_storyboard(p)][0]
    for n in range(4, 10):   # six more picked shots after the demo's three: nine in all
        p["items"][f"frame_x{n}"] = {**p["items"][base], "key": f"frame_x{n}", "entity": f"frame_x{n}", "shot_rank": f"a{n}z"}
    d = _deck()
    images.bind_production(d, p)
    st = d["slides"]["s3"]["strip"]
    assert st == {"shots": [1, 3, 4, 6, 7, 9], "of": 9, "note": "6 of 9 shots"}
    assert [k for k in d["slides"]["s3"]["slots"] if k.startswith("shot_")] == [f"shot_{i}" for i in range(1, 7)]


def test_the_mockups_switch_turns_frames_off(gr):
    d = {"meta": {"preferences": {"look": {"graphics": {"mockups": False}}}}, "order": [], "slides": {}}
    assert not graphics.part_on(d, "mockups") and graphics.part_on(d, "icons")
    assert graphics.part_on({"meta": {}}, "mockups")


def test_a_rights_pending_frame_is_not_counted_so_no_strip(gr, prod):
    p = copy.deepcopy(prod)
    first = images.production_storyboard(p)[0]
    p["items"][first]["rights"] = "reference_only"
    d = _deck()
    images.bind_production(d, p)
    assert not any(k.startswith("shot_") for k in d["slides"]["s3"].get("slots") or {})   # 2 placeable: one frame in a screen, no strip
    assert _im(d, "s3")["from"]["kind"] == "production"


# ================================================================================================ the subject rule
def test_the_artwork_rule_changes_only_the_system_text_under_the_flag(monkeypatch):
    from deck import stages
    off = stages.g_system()
    assert stages.ARTWORK_RULE not in off
    monkeypatch.setattr(spec, "GRAPHICS", True)
    on = stages.g_system()
    assert stages.ARTWORK_RULE in on and on.index(stages.ARTWORK_RULE) < on.index("Inputs are the only source:")
    assert on.replace(stages.ARTWORK_RULE + "\n", "") == off


# ================================================================================================ rendered: pptx, web, checklist
@pytest.fixture()
def prod_stages(tmp_path, demo_stages, bundle):
    import shutil
    st = tmp_path / "stages"
    shutil.copytree(demo_stages, st)
    assert fp.main([str(bundle), "--stages", str(st)]) == 0
    return st


def _frames_of(prs):
    return {n: [sh.name for sh in sl.shapes if sh.name.startswith("Frame: ") or sh.name in ("Framed picture", "Strip picture", "MockupLabel")]
            for n, sl in enumerate(prs.slides, 1)}


def test_rendered_frames_carry_mock_up_and_keep_production_whole(gr, tmp_path, prod_stages, build_demo):
    run = build_demo(prod_stages, tmp_path / "a", "--pictures", "creative_cover", "--production", "--hyperframes")
    prs = Presentation(str(run / "deck.pptx"))
    framed = {n: v for n, v in _frames_of(prs).items() if any(x.startswith("Frame: ") for x in v)}
    assert framed, "no frame drawn"
    for v in framed.values():
        assert "MockupLabel" in v
    for sl in prs.slides:
        for sh in sl.shapes:
            if sh.name == "MockupLabel":
                assert sh.text_frame.text == spec.MOCKUP_LABEL
            if sh.name == "Framed picture":
                assert max(sh.crop_left, sh.crop_right, sh.crop_top, sh.crop_bottom) <= spec.PICTURE_STRETCH_TOL   # Production: whole
    res = cl.run_checklist(run)["results"]
    for i in ("m_mockup_labelled", "m_frame_aspect", "m_frame_rights"):
        assert res[i]["answer"] == "yes", (i, res[i])
    assert res["m_production_first"]["answer"] == "value" and res["m_production_first"]["value"] > 0
    html = (run / "deck.html").read_text()
    assert html.count('class="mockup"') >= len(framed) and "frame-wrap" in html
    hf = (run / "hyperframes" / "index.html").read_text()
    assert 'class="mockup"' in hf and ".mockup{" in hf and ".frame-wrap .pic .plabel{display:none}" in hf   # HyperFrames gets the styles too


def test_flag_off_draws_no_frame(monkeypatch, tmp_path, prod_stages, build_demo):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    run = build_demo(prod_stages, tmp_path / "b", "--pictures", "creative_cover", "--production")
    prs = Presentation(str(run / "deck.pptx"))
    assert not any(v for v in _frames_of(prs).values())
    assert "mockup" not in (run / "deck.html").read_text()
    res = cl.run_checklist(run)["results"]
    assert all(res[i]["answer"] == "n/a" for i in ("m_mockup_labelled", "m_frame_aspect", "m_frame_rights", "m_production_first", "s_strip_order"))


def test_a_frame_without_its_label_fails_the_gate(gr, tmp_path, prod_stages, build_demo):
    run = build_demo(prod_stages, tmp_path / "c", "--pictures", "creative_cover", "--production")
    prs = Presentation(str(run / "deck.pptx"))
    for sl in prs.slides:
        for sh in list(sl.shapes):
            if sh.name in ("MockupLabel", "MockupPill"):
                sh._element.getparent().remove(sh._element)
    prs.save(str(run / "deck.pptx"))
    assert cl.run_checklist(run)["results"]["m_mockup_labelled"]["answer"] == "no"
