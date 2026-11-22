"""production-spinoff, deck v3 (UAT 2026-11-22): the storyboard strip drawn with its frame captions, every OOH size in billboard and poster frames
with the format named (and a slide for them when the idea stage wrote none), one offer row per picture, a Packshot or size-crops slot that has no
final of its kind left as a gap (never the key visual), real strike-through, and no 'field is null' on a slide. Offline, on the invented demo
project (fixtures/production_demo)."""
from __future__ import annotations

import copy
import re
import sys
from pathlib import Path

import pytest
from pptx import Presentation

from deck import from_production as fp, graphics, images, render_pptx, render_web, spec, stages

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE / "fixtures" / "production_demo"))
import make_bundle as mb   # noqa: E402

sys.path.remove(str(HERE / "fixtures" / "production_demo"))


@pytest.fixture(autouse=True)
def gr(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(spec, "GRAPHICS", True)


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("v3")
    z = tmp / "lumen.zip"
    mb.build(z)
    (tmp / "work").mkdir()
    prod, files = fp.build(z, at="2026-11-22T10:00:00+00:00", work=tmp / "work")
    return prod, files, tmp


def _deck(*slides):
    sl = {f"s{i:02d}": {"type": t, "title": ti, "section": spec.SLIDE_TYPES[t]["section"], "label": ti, "blocks": b, "claims": [], "visual": {"kind": "layout", "hint": t},
                        "notes": "", "status": "drafted", "requirements": [], "footnotes": []} for i, (t, ti, b) in enumerate(slides, 1)}
    return {"meta": {"client": "Lumen Water", "project": "Lumen", "audience": "review"}, "order": list(sl), "slides": sl}


FILM_BLOCKS = [{"kind": "text", "text": "Role: Shows the pour."},
               {"kind": "copy", "lines": ["Frame 1: A tap in a kitchen.", "Frame 2: A glass fills.", "Frame 3: Someone drinks.", "VO (dry): Every drop."], "answer": "Because.", "basis": "creative"}]


def _render(deck, prod, files, tmp, name):
    """Both renderers on a bound deck: (pptx path, web html text, picture findings)."""
    pics = {}
    for aid, rec in deck["assets"].items():
        pics[aid] = images.derived_jpeg(Path(files[rec["sha256"]]), tmp / name, rec["sha256"])
    out = tmp / f"{name}.pptx"
    pf = []
    render_pptx.render(deck, None, out, pictures=pics, picture_findings=pf)
    web = tmp / f"{name}.html"
    render_web.render(deck, None, web, pictures=pics)
    return out, web.read_text(), pf


def _names(prs, n):
    return [sh.name for sh in prs.slides[n].shapes]


# ================================================================================================ 1. the storyboard strip
def test_a_storyboard_slide_draws_its_frames_with_their_captions(built):
    prod, files, tmp = built
    d = _deck(("execution", "TV film", copy.deepcopy(FILM_BLOCKS)))
    images.bind_production(d, prod)
    st = d["slides"]["s01"]["strip"]
    assert st["captions"] == ["A tap in a kitchen.", "A glass fills.", "Someone drinks."]
    copy_lines = next(b for b in d["slides"]["s01"]["blocks"] if b["kind"] == "copy")["lines"]
    assert copy_lines == ["VO (dry): Every drop."]   # the frames carry their own lines: not said twice
    out, web, pf = _render(d, prod, files, tmp, "sb")
    prs = Presentation(str(out))
    names = _names(prs, 0)
    assert names.count("Strip picture") == 3 and names.count("StripCaption") == 3 and not pf
    caps = [sh.text_frame.text for sh in prs.slides[0].shapes if sh.name == "StripCaption"]
    assert [c.replace("\xa0", " ") for c in caps] == st["captions"]
    assert web.count('class="sb-cap"') == 3 and "A glass fills." in web and 'sb-strip' in web


def test_a_frame_line_with_a_super_keeps_its_kind():
    sl = {"blocks": [{"kind": "copy", "lines": ["Frame 2 super: Brought something still.", "End frame: Hollow Oak.", "Frame 4 VO: One."], "answer": "a"}]}
    assert images.take_frame_captions(sl, [1, 2, 3, 4]) == ["", "Super: Brought something still.", "", "VO: One."]
    assert sl["blocks"][0]["lines"] == ["End frame: Hollow Oak."]


def test_a_storyboard_without_frame_lines_still_draws_numbered_frames(built):
    prod, files, tmp = built
    d = _deck(("execution", "TV film", [{"kind": "text", "text": "Role: x"}, {"kind": "copy", "lines": ["VO: one."], "answer": "a", "basis": "creative"}]))
    images.bind_production(d, prod)
    assert "captions" not in d["slides"]["s01"]["strip"]
    out, web, pf = _render(d, prod, files, tmp, "sb2")
    assert _names(Presentation(str(out)), 0).count("Strip picture") == 3 and not pf


# ================================================================================================ 2. out of home
def _ooh_prod(prod, fids=("uk-48-sheet", "uk-96-sheet", "uk-6-sheet"), files=None, work=None):
    """The demo's items plus OOH sizes of the pinned packs, each its own drawn picture (written to ``work`` and added to ``files``)."""
    p = copy.deepcopy(prod)
    six = next(k for k, it in p["items"].items() if (it.get("format") or {}).get("format_id") == "uk-6-sheet")
    base = p["items"].pop(six)
    for n, fid in enumerate(fids):
        f = graphics.pack_formats()[fid]
        w, h = (1200, int(round(1200 * f["h"] / f["w"]))) if f["w"] >= f["h"] else (int(round(1200 * f["w"] / f["h"])), 1200)
        it = {**base, "key": f"size_{fid}", "entity": f"size_{fid}", "aspect": {"w": w, "h": h}, "width": w, "height": h, "format": {"format_id": fid}, "channel": "ooh"}
        if files is not None:
            raw = mb.draw(w, h, 40 + 70 * n)
            import hashlib
            hx = hashlib.sha256(raw).hexdigest()
            path = Path(work) / f"{hx}.png"
            path.write_bytes(raw)
            files[hx] = path
            it.update(sha256=hx, file=f"assets/{hx}.png", bytes=len(raw))
        p["items"][f"size_{fid}"] = it
    return p


def test_ooh_sizes_go_in_billboard_and_poster_frames_each_named(built):
    prod, files, tmp = built
    files = dict(files)
    p = _ooh_prod(prod, files=files, work=tmp / "work")
    d = _deck(("idea", "Every drop.", []), ("execution", "Outdoor", [{"kind": "text", "text": "Role: be seen."},
                                                                      {"kind": "copy", "lines": ["Drink."], "answer": "Because.", "basis": "creative"}]))
    got = images.bind_production(d, p)
    s = d["slides"]["s02"]
    names = {f["format_id"]: f["name"] for f in s["ooh"]["formats"]}
    assert names == {"uk-48-sheet": "48-sheet roadside", "uk-96-sheet": "96-sheet roadside", "uk-6-sheet": "6-sheet street furniture"}
    kinds = {}
    for f in s["ooh"]["formats"]:
        im = s["slots"][f["slot"]]["image"]
        fr = graphics.frame_of(d, "Outdoor", im)
        kinds[f["format_id"]] = fr["kind"]
        assert abs(fr["ratio"] - graphics.pack_formats()[f["format_id"]]["w"] / graphics.pack_formats()[f["format_id"]]["h"]) < 1e-9   # the format's own shape
    assert kinds == {"uk-48-sheet": "billboard", "uk-96-sheet": "billboard", "uk-6-sheet": "poster_portrait"}
    assert got["ooh"][0]["slide"] == "s02" and not got.get("added")
    out, web, pf = _render(d, p, files, tmp, "ooh")
    prs = Presentation(str(out))
    n = list(d["order"]).index("s02")
    assert [sh.text_frame.text.replace("\xa0", " ") for sh in prs.slides[n].shapes if sh.name == "FormatName"] == [f["name"] for f in s["ooh"]["formats"]]
    assert _names(prs, n).count("Framed picture") == 3 and not pf
    for sh in prs.slides[n].shapes:
        if sh.name == "Framed picture":
            assert max(sh.crop_left, sh.crop_right, sh.crop_top, sh.crop_bottom) <= spec.PICTURE_STRETCH_TOL   # never stretched
    assert web.count('class="ooh-name"') == 3 and "48-sheet roadside" in web and "f-billboard" in web and "f-poster_portrait" in web


def test_an_ooh_slide_is_added_when_the_idea_stage_wrote_none(built):
    prod, files, tmp = built
    files = dict(files)
    p = _ooh_prod(prod, ("uk-48-sheet", "uk-6-sheet"), files, tmp / "work")
    d = _deck(("idea", "Every drop.", []), ("execution", "Social stories", [{"kind": "text", "text": "Role: x"}, {"kind": "copy", "lines": ["a"], "answer": "b", "basis": "creative"}]),
              ("close", "Next", []))
    got = images.bind_production(d, p)
    sid = got["added"]
    assert sid and d["order"].index(sid) == 2 and d["slides"][sid]["title"] == "Out of home"
    assert [f["name"] for f in d["slides"][sid]["ooh"]["formats"]] == ["48-sheet roadside", "6-sheet street furniture"]
    out, web, pf = _render(d, p, files, tmp, "ooh2")
    assert [sh.text_frame.text.replace("\xa0", " ") for sh in Presentation(str(out)).slides[2].shapes if sh.name == "FormatName"] == ["48-sheet roadside", "6-sheet street furniture"]
    again = images.bind_production(copy.deepcopy(d), p)
    assert not again.get("added")   # an OOH execution exists now: none is added twice


def test_no_ooh_slide_is_added_without_ooh_finals_or_without_graphics(built, monkeypatch):
    prod, _, _ = built
    d = _deck(("idea", "Every drop.", []))
    assert images.bind_production(d, copy.deepcopy(prod)).get("added")   # the demo's one 6-sheet is an OOH final and no execution shows it: a slide is added
    monkeypatch.setattr(spec, "GRAPHICS", False)
    d2 = _deck(("idea", "Every drop.", []))
    assert not images.bind_production(d2, _ooh_prod(prod)).get("added") and len(d2["order"]) == 1


def test_a_wide_96_sheet_is_a_billboard_and_a_bus_side_a_strip():
    assert graphics.frame_kind("ooh", 4.0, "uk-96-sheet") == "billboard" and graphics.frame_kind("ooh", 2.0, "uk-48-sheet") == "billboard"
    assert graphics.frame_kind("ooh", 2 / 3, "uk-6-sheet") == "poster_portrait" and graphics.frame_kind("ooh", 4.04, "uk-bus-tside") == "strip"
    assert spec.frame_for("Out of home") == "poster" and spec.frame_for("48-sheet roadside") == "poster"


# ================================================================================================ 3. one row per picture
def test_the_offer_lists_one_picture_once():
    cands = [{"role": "master", "sha": "sha256:aa", "key": "final_01A#master", "final": True}, {"role": "master", "sha": "sha256:aa", "key": "final_01B#master", "final": True},
             {"role": "master", "sha": "sha256:bb", "key": "final_01C#master"}, {"role": "frame", "sha": "sha256:aa", "key": "frame_01D"}]
    nc = {}
    out = fp._one_of_each(cands, nc)
    assert [c["key"] for c in out] == ["final_01B#master", "final_01C#master", "frame_01D"] and nc["duplicates"] == 1   # the newest of the two; a frame is its own role


def test_a_built_offer_never_repeats_a_picture(built):
    prod, _, _ = built
    shas = [(it["role"], it["sha256"]) for it in prod["items"].values()]
    assert len(shas) == len(set(shas))


# ================================================================================================ 4. honest gaps
def _gap_deck():
    return _deck(("idea", "Every drop.", []), ("execution", "Packshot", [{"kind": "text", "text": "Role: the can."}]),
                 ("execution", "Size crops", [{"kind": "text", "text": "Role: every size."}]))


def test_a_packshot_slot_with_no_packshot_final_is_a_gap_not_the_key_visual(built):
    prod, _, _ = built
    p = copy.deepcopy(prod)
    for it in p["items"].values():
        it.pop("subject", None)
    d = _gap_deck()
    got = images.bind_production(d, p)
    im = d["slides"]["s02"]["slots"]["picture"]["image"]
    assert im["status"] == "empty" and im["reason"].startswith("To supply from Production: a packshot") and "asset" not in im
    assert ("s02", "picture") not in images.drawn(d, "review")
    assert any(h["slide"] == "s02" for h in got["held"])
    master_asset = d["slides"]["s01"]["slots"]["picture"]["image"]["asset"]
    assert all((v.get("image") or {}).get("asset") != master_asset for sid in ("s02", "s03") for v in (d["slides"][sid].get("slots") or {}).values())


def test_a_packshot_final_fills_the_packshot_slot(built):
    prod, _, _ = built
    p = copy.deepcopy(prod)
    key = next(k for k, it in p["items"].items() if it["role"] == "size" and it.get("channel") == "social" and it["status"] == "ready")
    p["items"][key]["subject"] = "packshot"
    d = _gap_deck()
    images.bind_production(d, p)
    assert d["slides"]["s02"]["slots"]["picture"]["image"]["from"]["key"] == key


def test_the_jobs_say_what_a_picture_is():
    doc = {"jobs": {"j1": {"op": "generate", "text": "Product packshot of @can on a plain white background", "outputs": ["sha256:p1"]},
                    "j2": {"op": "resize", "input_hashes": ["sha256:p1"], "outputs": ["sha256:p2"]},
                    "j3": {"op": "generate", "director": {"input": {"brief": {"title": "a packshot pitch"}, "text": "A can on a stump"}}, "outputs": ["sha256:k1"]},
                    "j4": {"op": "resize", "input_hashes": ["sha256:k1"], "outputs": ["sha256:k2"]}}}
    packs, crops = fp._made_pictures(doc)
    assert packs == {"sha256:p1", "sha256:p2"} and crops == {"sha256:k2"}   # the brief's words never make a packshot; a resize is a crop


# ================================================================================================ 5. text leaks
def test_a_struck_word_is_a_real_strike_through_in_the_pptx_and_the_web(built):
    prod, files, tmp = built
    d = _deck(("execution", "Social stories", [{"kind": "text", "text": "Role: the strike."},
                                               {"kind": "copy", "lines": ["~~Fizzy.~~ Still.", "Still, on purpose."], "answer": "The strike.", "basis": "creative"}]))
    images.bind_production(d, prod)
    out, web, _ = _render(d, prod, files, tmp, "strike")
    prs = Presentation(str(out))
    A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
    struck = [r for sl in prs.slides for r in sl._element.iter(f"{A}r") if r.find(f"{A}rPr") is not None and r.find(f"{A}rPr").get("strike") == "sngStrike"]
    assert [r.find(f"{A}t").text for r in struck] == ["Fizzy."]
    assert not any("~~" in (t.text or "") for sl in prs.slides for t in sl._element.iter(f"{A}t"))
    assert "<s>Fizzy.</s>" in web and "~~" not in web


def test_an_unmatched_tilde_pair_never_shows():
    assert render_web._e("a ~~b") == "a b" and render_web._e("~~a~~ b") == "<s>a</s> b" and render_web._a("~~a~~ b") == "a b"


def test_the_records_own_wording_never_reaches_a_slide(monkeypatch):
    assert spec.internal_wording("Objectives: the brief gives none (field is null); to be confirmed.") and not spec.internal_wording("Grow sales by 30%.")
    sent = {}

    def fake(stage, user, system):
        sent["user"] = user
        return {"requirements": [{"id": "R1", "kind": "objective", "text": "Objectives: the brief gives none (field is null).", "ref": "brief#objectives"},
                                 {"id": "R2", "kind": "message", "text": "Say it plainly.", "ref": "brief#insight"}]}, {}
    monkeypatch.setattr(stages, "_call", fake)
    monkeypatch.setattr(stages, "_sum", lambda u: {})
    inp = type("I", (), {})()
    inp.docs, inp.prompt_text, inp.answers = {}, "", {}
    inp.brief = {"insight": {"value": "People want honest drinks."}, "objectives": {"value": None}, "audience": {"value": ""}}
    out, _ = stages.requirements(inp)
    assert [r["id"] for r in out["requirements"]] == ["R2"]
    assert "objectives" not in sent["user"] and "null" not in sent["user"] and "insight" in sent["user"]
