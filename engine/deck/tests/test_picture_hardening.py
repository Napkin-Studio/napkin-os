"""deck-frames-in, after the adversarial check: a reused --out, one content in every format, frames bound to their territories, brand names,
metadata-free client folders, and the smaller fixes. Run from engine/: ``PYTHONPATH=. python3 -m pytest deck/tests/test_picture_hardening.py``."""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest
from PIL import Image, PngImagePlugin
from pptx import Presentation

from deck import from_territory, images, inputs, render_pptx, render_web, validate

HERE = Path(__file__).resolve().parent
DEMO = HERE / "fixtures" / "frames_demo"


def jdeck(run: Path) -> dict:
    return json.loads((run / "deck.json").read_text())


def files(root: Path) -> list:
    return [p for p in Path(root).rglob("*") if p.is_file()]


# ---------------------------------------------------------------- 1. a reused --out

def test_a_client_render_into_a_folder_a_review_used_holds_no_earlier_byte(demo_stages, build_demo, tmp_path):
    out = tmp_path / "o"
    build_demo(demo_stages, out, "--pictures", "creative_cover", "--hyperframes")
    d = jdeck(out)
    review_bytes = {hashlib.sha256(p.read_bytes()).hexdigest() for p in files(out / "assets")} | {hashlib.sha256(p.read_bytes()).hexdigest() for p in files(out / "hyperframes" / "assets")}
    assert len(review_bytes) > 10
    (out / "png").mkdir(exist_ok=True)
    (out / "png" / "slide-99.png").write_bytes(next(iter(files(out / "assets" / "derived"))).read_bytes())   # a page image of the earlier review
    (out / "deck.pdf").write_bytes(b"%PDF old review")
    rev = tmp_path / "r.json"
    assert images.main(["approve", "--review", str(rev), "--deck", str(out / "deck.json"), "--territory", "t1", "--by", "human:x"]) == 0
    build_demo(demo_stages, out, "--pictures", "creative_cover", "--hyperframes", "--audience", "client", "--review", str(rev), "--approver", "human:x")
    approved = {im["asset"] for _, _, im in images.image_slots(jdeck(out)) if im["status"] == "approved"}
    keep = {jdeck(out)["assets"][a]["sha256"] for a in approved}
    assert not (out / "png" / "slide-99.png").exists() and not (out / "deck.pdf").exists()
    assert len(list((out / "assets" / "derived").iterdir())) == len(approved) == len(list((out / "hyperframes" / "assets").iterdir()))
    names = {p.name for p in (out / "assets" / "derived").iterdir()}
    assert names == {f"{s}-1920.jpg" for s in keep}
    html = (out / "deck.html").read_text()
    assert html.count("<figure") == 6


# ---------------------------------------------------------------- 2. one content in every format

def _flow_stages(demo_stages, tmp_path):
    st = tmp_path / "st"
    shutil.copytree(demo_stages, st)
    d = json.loads((st / "d_idea.json").read_text())
    d["idea"] = "A household sees its own story today. " * 16   # too long for the emphasis bar: the slide falls to the flow
    (st / "d_idea.json").write_text(json.dumps(d))
    return st


def test_a_slide_the_pptx_draws_without_its_picture_is_drawn_without_it_in_every_format(demo_stages, build_demo, tmp_path):
    run = build_demo(_flow_stages(demo_stages, tmp_path), tmp_path / "o", "--pictures", "creative", "--hyperframes")
    d = jdeck(run)
    idea = next(i for i, s in d["slides"].items() if s["type"] == "idea")
    hits = [f for f in json.loads((run / "validation.json").read_text()) if f["check"] == "image_missing"]
    assert [(f["slide"], f["slot"]) for f in hits] == [(idea, "picture")] and "does not fit" in hits[0]["message"]
    n = d["order"].index(idea) + 1
    assert not [sh for sh in Presentation(str(run / "deck.pptx")).slides[n - 1].shapes if sh.shape_type == 13]
    for f in (run / "deck.html", run / "hyperframes" / "index.html"):
        t = f.read_text()
        sec = t[t.index(f'id="{idea}"') if f.name == "deck.html" else t.index(f'id="clip-{idea}"'):]
        sec = sec[:sec.index("</section>")]
        assert "<figure" not in sec, f.name
    # the other pictures are the same set in all three
    pp = sum(1 for sl in Presentation(str(run / "deck.pptx")).slides for sh in sl.shapes if sh.shape_type == 13)
    assert pp > 0 and (run / "deck.html").read_text().count("<figure") == pp
    hf = (run / "hyperframes" / "index.html").read_text()
    assert hf.count("<figure") == pp and len(list((run / "hyperframes" / "assets").iterdir())) == len(set(__import__("re").findall(r'src="assets/([^"]+)"', hf)))


def test_the_classic_theme_draws_no_picture_anywhere_and_says_so_for_every_slot(demo_stages, build_demo, tmp_path):
    run = build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover")
    d = jdeck(run)
    pics = images.copy_assets(d, tmp_path / "x", "review", [demo_stages])
    inp = inputs.load(None, None, tmp_path / "none.json", [], prompt_text="x")
    r = render_pptx.Renderer(d, inp, theme="classic", pictures=pics)
    r.render(tmp_path / "c.pptx")
    assert r.placed == set()
    wanted = {k for k in images.drawn(d, "review") if d["slides"][k[0]]["type"] in images.SLOT_TABLE}
    assert {(f["slide"], f["slot"]) for f in r.picture_findings} == wanted and all(f["check"] == "image_missing" for f in r.picture_findings)
    html = tmp_path / "w.html"
    render_web.render(d, inp, html, None, pics, placed=r.placed)
    assert "<figure" not in html.read_text()


# ---------------------------------------------------------------- 3. frames bind to their territories

def test_frames_made_for_other_territories_are_refused(demo_stages, build_demo, tmp_path):
    st = tmp_path / "st"
    shutil.copytree(demo_stages, st)
    c = json.loads((st / "c_territories.json").read_text())
    c["territories"][0], c["territories"][1] = c["territories"][1], c["territories"][0]   # ids now name other territories' words
    c["territories"][0]["id"], c["territories"][1]["id"] = "t1", "t2"
    (st / "c_territories.json").write_text(json.dumps(c))
    with pytest.raises(SystemExit, match="other territories"):
        build_demo(st, tmp_path / "o", "--pictures", "creative_cover")
    assert not (tmp_path / "o" / "deck.json").exists()
    build_demo(st, tmp_path / "p")   # with no --pictures the stage file is never read: nothing is refused


def test_replace_moves_a_stale_d_idea_aside_and_says_so(tmp_path, capsys):
    st = tmp_path / "st"
    st.mkdir()
    (st / "c_territories.json").write_text("{}")
    (st / "d_idea.json").write_text('{"idea": "old"}')
    man = next((DEMO / "lumen_run.frames").glob("v1-*/manifest.json"))
    assert from_territory.main([str(DEMO / "lumen_run.json"), "--frames", str(man), "--stages", str(st), "--replace"]) == 0
    assert not (st / "d_idea.json").exists() and json.loads((st / "d_idea.replaced.json").read_text()) == {"idea": "old"}
    assert "written from other territories" in capsys.readouterr().out
    assert json.loads((st / "frames.json").read_text())["territories_sha256_12"] == images.territories_sha(json.loads((st / "c_territories.json").read_text())["territories"])


# ---------------------------------------------------------------- 4. brand and generic names

def test_name_forms_ignore_generic_suffixes_and_catch_the_distinctive_word():
    assert images.digits_or_name("An Acme jar on a shelf", ["Acme Ltd"])
    assert images.digits_or_name("a glass of water", ["Lumen Water"]) is None          # a plain word of the name stays allowed
    assert images.digits_or_name("Lumen glass", ["Lumen Water"])                         # the distinctive first word does not
    assert images.digits_or_name("the group meets", ["Napkin Group"]) is None             # a generic suffix alone is not the name
    assert images.digits_or_name("Napkin sketch", ["Napkin Group"])
    assert images.digits_or_name("Acme", ["Acme Inc", "[Agency]"])


def test_a_brand_name_in_a_frame_subject_holds_the_frame_back(demo_stages, build_demo, tmp_path):
    st = tmp_path / "st"
    shutil.copytree(demo_stages, st)
    f = json.loads((st / "frames.json").read_text())
    f["frames"]["t1-f1-pro"]["subject"] = "Lumen bottle on a shelf"
    (st / "frames.json").write_text(json.dumps(f))
    brand = tmp_path / "brand.json"
    brand.write_text(json.dumps({"name": "Lumen"}))
    d = jdeck(build_demo(st, tmp_path / "o", "--pictures", "creative_cover", "--brand", str(brand)))
    cover = d["slides"][d["order"][0]]["slots"]["picture"]["image"]
    assert cover["status"] == "empty" and "held back" in cover["reason"] and "Lumen" in cover["reason"]
    plain = jdeck(build_demo(st, tmp_path / "p", "--pictures", "creative_cover"))   # client is Lumen Water: its first word is caught too
    assert plain["slides"][plain["order"][0]]["slots"]["picture"]["image"]["status"] == "empty"


# ---------------------------------------------------------------- 5. metadata-free client folders

def test_a_client_folder_carries_no_exif_gps_and_no_png_text_chunk(demo_stages, build_demo, tmp_path):
    jpg, png = tmp_path / "gps.jpg", tmp_path / "text.png"
    ex = Image.Exif()
    ex[0x010F] = "SecretCameraMaker"
    ex[0x8825] = {1: "N", 2: (53.0, 20.0, 59.0), 3: "W", 4: (6.0, 15.0, 30.0)}
    Image.new("RGB", (1200, 900), (30, 90, 120)).save(jpg, exif=ex.tobytes())
    meta = PngImagePlugin.PngInfo()
    meta.add_text("Comment", "SecretPngComment 53.3498 N")
    Image.new("RGB", (1200, 900), (120, 90, 30)).save(png, pnginfo=meta)
    assert b"SecretCameraMaker" in jpg.read_bytes() and b"SecretPngComment" in png.read_bytes()
    args = ["--pictures", "creative", "--image", f"s12.picture={jpg}", "--image-rights", "s12.picture=own", "--image", f"s13.picture={png}", "--image-rights", "s13.picture=own"]
    rev = build_demo(demo_stages, tmp_path / "r", *args)
    d = jdeck(rev)
    review = {"images": {sid: {"picture": {"asset": d["slides"][sid]["slots"]["picture"]["image"]["asset"], "decision": "approve", "by": "human:x", "at": "2026-11-17T10:00:00+00:00"}} for sid in ("s12", "s13")}}
    rj = tmp_path / "rv.json"
    rj.write_text(json.dumps(review))
    out = build_demo(demo_stages, tmp_path / "c", *args, "--audience", "client", "--review", str(rj), "--approver", "human:x", "--hyperframes")
    assert sum(1 for im in (i for _, _, i in images.image_slots(jdeck(out))) if im["status"] == "approved") == 2
    import zipfile
    blobs = [p.read_bytes() for p in files(out) if p.suffix in (".jpg", ".png", ".html")]
    with zipfile.ZipFile(out / "deck.pptx") as z:
        blobs += [z.read(n) for n in z.namelist() if n.startswith("ppt/media/")]
    assert blobs and not [b for b in blobs if b"SecretCameraMaker" in b or b"SecretPngComment" in b or b"Exif" in b[:2000] or b"tEXt" in b or b"GPS" in b[:4000]]
    assert [p for p in files(out / "assets") if p.parent.name != "derived"] == []


# ---------------------------------------------------------------- 6, 8. size before read, no global pixel limit

def test_the_file_size_is_checked_before_the_file_is_read(tmp_path, monkeypatch):
    f = tmp_path / "big.png"
    Image.new("RGB", (40, 40)).save(f)
    monkeypatch.setattr(images, "MAX_BYTES", 10)
    monkeypatch.setattr(Path, "read_bytes", lambda self: (_ for _ in ()).throw(AssertionError("read before the size check")))
    with pytest.raises(images.ImageError, match="refused"):
        images.inspect_file(f)


def test_the_pixel_limit_is_a_local_check_not_a_global_setting(tmp_path, monkeypatch):
    before = Image.MAX_IMAGE_PIXELS
    f = tmp_path / "w.png"
    Image.new("RGB", (400, 400)).save(f)
    images.inspect_file(f)
    images.derived_jpeg(f, tmp_path / "run", images.inspect_file(f)["sha256"])
    assert Image.MAX_IMAGE_PIXELS == before
    monkeypatch.setattr(images, "MAX_PIXELS", 1000)
    with pytest.raises(images.ImageError, match="pixels"):
        images.inspect_file(f)
    with pytest.raises(images.ImageError, match="million pixels"):
        images.derived_jpeg(f, tmp_path / "run2", "0" * 64)
    assert Image.MAX_IMAGE_PIXELS == before


# ---------------------------------------------------------------- 7. a held Style Pack is a finding

def test_a_held_style_pack_raises_a_major_finding_and_prints_a_line(demo_stages, tmp_path, capsys):
    from deck import issues, run_deck
    bad = tmp_path / "pack"
    bad.mkdir()
    (bad / "style.yaml").write_text("finish: not-a-finish\n")
    st = tmp_path / "st"
    st.mkdir()
    man = next((DEMO / "lumen_run.frames").glob("v1-*/manifest.json"))
    assert from_territory.main([str(DEMO / "lumen_run.json"), "--frames", str(man), "--stages", str(st), "--chosen", "t1", "--style-pack", str(bad)]) == 0
    for f in (DEMO / "base").glob("*.json"):
        shutil.copyfile(f, st / f.name)
    capsys.readouterr()
    saved = (run_deck.subprocess.run, run_deck._soffice)
    run_deck.subprocess.run, run_deck._soffice = (lambda *a, **k: None), (lambda: "soffice")
    try:
        run_deck.main(["--stages", str(st), "--brief", str(st / "brief_object.json"), "--client", "Lumen Water", "--project", "p", "--out", str(tmp_path / "o"), "--no-qa", "--pictures", "creative"])
    finally:
        run_deck.subprocess.run, run_deck._soffice = saved
    assert "style pack held:" in capsys.readouterr().out
    hit = [f for f in json.loads((tmp_path / "o" / "validation.json").read_text()) if f["check"] == "style_pack_held"]
    assert len(hit) == 1 and hit[0]["level"] == "warn" and issues.severity("style_pack_held", "warn") == "major"


# ---------------------------------------------------------------- 9. a human approving a flagged or unchecked frame

def test_a_review_warns_when_a_person_approved_a_flagged_or_unchecked_frame(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover"))
    review = {"images": {}}
    for sid, slot in (("s09", "frame_3"), ("s10", "frame_3")):   # t2's flagged frame, t3's never-checked frame
        im = d["slides"][sid]["slots"][slot]["image"]
        review["images"][sid] = {slot: {"asset": im["asset"], "decision": "approve", "by": "human:x", "at": "2026-11-17T10:00:00+00:00"}}
    rj = tmp_path / "r.json"
    rj.write_text(json.dumps(review))
    run = build_demo(demo_stages, tmp_path / "p", "--pictures", "creative_cover", "--review", str(rj), "--approver", "human:x")
    p = jdeck(run)
    assert p["slides"]["s09"]["slots"]["frame_3"]["image"]["status"] == "approved"      # the contract lets a person approve it
    msgs = {f["slide"]: f["message"] for f in json.loads((run / "validation.json").read_text()) if f["check"] == "image_flagged"}
    assert "guard flagged it" in msgs["s09"] and "no guard looked" in msgs["s10"] and all(f["level"] == "warn" for f in json.loads((run / "validation.json").read_text()) if f["check"] == "image_flagged")
