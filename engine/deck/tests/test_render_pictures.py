"""deck-frames-in: pictures drawn in the pptx, the web deck and the HyperFrames project, the Illustrative and Flagged marks, and the
client refusal (no byte of an unapproved or flagged picture in any output). Offline, geometry only (no LibreOffice).
Run from engine/: ``PYTHONPATH=. python3 -m pytest deck/tests/test_render_pictures.py``."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import zipfile
from pathlib import Path

import pytest
from PIL import Image
from pptx import Presentation

from deck import images

HERE = Path(__file__).resolve().parent
DEMO = HERE / "fixtures" / "frames_demo"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def jdeck(run: Path) -> dict:
    return json.loads((run / "deck.json").read_text())


def pics(prs, n):
    return [sh for sh in prs.slides[n - 1].shapes if sh.shape_type == 13 and sh.name == "Picture"]


def caps(prs, n):
    """The picture labels: shapes named Caption that are not the territory panel's own 'Illustrative, not final' note."""
    return [sh for sh in prs.slides[n - 1].shapes if sh.name == "Caption" and "not final" not in sh.text_frame.text]


def words(sh):
    return sh.text_frame.text.replace("\xa0", " ")


@pytest.fixture(scope="module")
def review_run(demo_stages, build_demo, tmp_path_factory):
    """The demo built for review, with --hyperframes."""
    return build_demo(demo_stages, tmp_path_factory.mktemp("rev") / "o", "--pictures", "creative_cover", "--hyperframes")


@pytest.fixture(scope="module")
def review_json(review_run, tmp_path_factory):
    """The one click for t1 by the demo approver, made from the review build's own deck."""
    p = tmp_path_factory.mktemp("rj") / "review.json"
    assert images.main(["approve", "--review", str(p), "--deck", str(review_run / "deck.json"), "--territory", "t1", "--by", "human:demo-approver"]) == 0
    return p


@pytest.fixture(scope="module")
def client_run(demo_stages, build_demo, review_json, tmp_path_factory):
    return build_demo(demo_stages, tmp_path_factory.mktemp("cli") / "o", "--pictures", "creative_cover", "--hyperframes", "--audience", "client",
                      "--review", str(review_json), "--approver", "human:demo-approver")


# ---------------------------------------------------------------- the pptx

def test_a_territory_slide_draws_four_pictures_cropped_with_alt_text_and_a_name(review_run):
    prs = Presentation(str(review_run / "deck.pptx"))
    ps = pics(prs, 8)
    assert len(ps) == 4
    for sh in ps:
        assert sh.name == "Picture" and sh._element.nvPicPr.cNvPr.get("descr")
        assert abs(sh.width / sh.height - 16 / 9) < 0.01
    assert [round(sh.left / 914400, 2) for sh in ps] == sorted(round(sh.left / 914400, 2) for sh in ps)


def test_crop_values_in_the_xml_match_images_crop_box(review_run):
    d = jdeck(review_run)
    prs = Presentation(str(review_run / "deck.pptx"))
    checked = 0
    for n in (1, 5, 8, 11):
        for sh in pics(prs, n):
            src = sh._element.find(f".//{A}srcRect")
            w, h = Image.open(__import__("io").BytesIO(sh.image.blob)).size
            box = images.crop_box(w, h, sh.width / sh.height)
            l, t, r, b = images.src_rect(box, w, h)
            got = {k: int(src.get(k, 0)) if src is not None else 0 for k in "ltrb"}
            assert all(abs(got[k] - round(v * 100000)) <= 2 for k, v in zip("ltrb", (l, t, r, b))), (n, got, (l, t, r, b))
            checked += 1
    assert checked >= 6
    assert any(sh._element.find(f".//{A}srcRect") is not None for sh in pics(prs, 1) + pics(prs, 11))   # a cover and an idea box are cropped


def test_every_unapproved_picture_carries_the_label_on_a_pill_and_the_flagged_one_says_so(review_run):
    prs = Presentation(str(review_run / "deck.pptx"))
    d = jdeck(review_run)
    assert [words(c) for c in caps(prs, 8)] == ["Illustrative"] * 4
    assert [words(c) for c in caps(prs, 9)] == ["Illustrative", "Illustrative", "Illustrative · Flagged", "Illustrative"] or \
        sorted(words(c) for c in caps(prs, 9)) == sorted(["Illustrative"] * 3 + ["Illustrative · Flagged"])
    flagged = [sh for sh in pics(prs, 9) if sh.line.fill.type == 1]
    assert len(flagged) == 1   # the red outline: exactly the flagged picture
    for sid in ("s01", "s11"):
        assert any(words(c) == "Illustrative" for c in caps(prs, d["order"].index(sid) + 1))


def test_approved_pictures_carry_no_label_in_a_review_render(demo_stages, build_demo, review_json, tmp_path):
    run = build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover", "--review", str(review_json), "--approver", "human:demo-approver")
    prs = Presentation(str(run / "deck.pptx"))
    assert len(pics(prs, 8)) == 4 and caps(prs, 8) == []                     # t1: approved, drawn, unmarked
    assert len(caps(prs, 9)) == 4                                            # t2: still Illustrative (one also Flagged)


def test_the_picture_label_flag_changes_the_word(demo_stages, build_demo, tmp_path):
    run = build_demo(demo_stages, tmp_path / "o", "--pictures", "creative", "--picture-label", "Mood only")
    assert {words(c) for c in caps(Presentation(str(run / "deck.pptx")), 8)} == {"Mood only"}


def test_the_pictured_execution_drops_the_image_prompt_note_and_the_layout_is_unchanged(demo_stages, build_demo, tmp_path):
    pic = f"{DEMO / 'cover.png'}"
    run = build_demo(demo_stages, tmp_path / "o", "--pictures", "creative", "--image", f"s12.picture={pic}", "--image-rights", "s12.picture=own")
    base = build_demo(demo_stages, tmp_path / "b")
    t = lambda r, n: " ".join(sh.text_frame.text for sh in Presentation(str(r / "deck.pptx")).slides[n - 1].shapes if sh.has_text_frame)
    assert "Image prompt" not in t(base, 12) and "Image prompt" not in t(run, 12)   # UAT round 4: a picture prompt is never drawn, pictured or not
    assert "Illustrative" in t(run, 12)
    lr, lb = (json.loads((r / "layouts.json").read_text())["slides"]["s12"] for r in (run, base))
    assert (lr["id"], lb["id"]) == ("execution_visual", "execution") and not lr["fallback"] and lr["relaxed"] == lb["relaxed"]   # the picture layout, drawn as the carve was


def test_the_text_diff_between_pictured_and_plain_holds_only_the_label_flagged_and_the_prompt_note(demo_stages, build_demo, tmp_path):
    pictured = build_demo(demo_stages, tmp_path / "a", "--pictures", "creative_cover", "--image", f"s12.picture={DEMO / 'cover.png'}",
                          "--image-rights", "s12.picture=own")
    plain = build_demo(demo_stages, tmp_path / "b")
    def texts(r):
        return [[words(sh) for sh in sl.shapes if sh.has_text_frame and sh.name != "SlideNumber"] for sl in Presentation(str(r / "deck.pptx")).slides]
    allowed = re.compile(r"^(Illustrative|Illustrative · Flagged)$")
    from collections import Counter
    for i, (a, b) in enumerate(zip(texts(pictured), texts(plain)), 1):
        wa, wb = Counter(" ".join(a).split()), Counter(" ".join(b).split())   # a picture layout may set the same words in other boxes: compare the words
        # exact equality: the pictured slide's words are the plain slide's words less the image prompt note, plus the picture labels
        prompt = " ".join(x for x in b if x.startswith("Image prompt")).split()
        got = Counter(" ".join(x for x in a if not allowed.match(x)).split())   # the label boxes are the only extras allowed
        want = Counter(wb)
        if any(allowed.match(x) for x in a):   # a picture was drawn here: it replaces the image prompt note
            want.subtract(Counter(prompt))
        want = +want
        assert got == want, (i, got - want, want - got)


def test_a_narrowed_layout_that_does_not_fit_draws_no_picture_and_raises_a_finding(demo_stages, build_demo, tmp_path):
    import shutil
    st = tmp_path / "st"
    shutil.copytree(demo_stages, st)
    d = json.loads((st / "d_idea.json").read_text())
    d["idea"] = "A household sees its own story today. " * 60   # too long for any layout with a picture's box taken out of it (and for the plain emphasis bar: the slide goes to the flow)
    (st / "d_idea.json").write_text(json.dumps(d))
    run, base = build_demo(st, tmp_path / "o", "--pictures", "creative"), build_demo(st, tmp_path / "b")
    deck = jdeck(run)
    idea = next(i for i, s in deck["slides"].items() if s["type"] == "idea")
    n = deck["order"].index(idea) + 1
    lr, lb = (json.loads((r / "layouts.json").read_text())["slides"] for r in (run, base))
    assert lr[idea]["id"] != "image_text"   # the picture layout did not hold the words: the slide is drawn without the picture
    assert not pics(Presentation(str(run / "deck.pptx")), n)
    hit = [f for f in json.loads((run / "validation.json").read_text()) if f["check"] == "image_missing"]
    assert [f["slide"] for f in hit] == [idea] and hit[0]["level"] == "warn" and hit[0]["slide_no"] == n
    assert not any(f["check"] == "image_missing" for f in json.loads((base / "validation.json").read_text()))


# ---------------------------------------------------------------- the web deck and HyperFrames

def test_the_web_deck_has_img_with_alt_cover_crop_the_label_and_data_uris(review_run):
    html = (review_run / "deck.html").read_text()
    figs = re.findall(r"<figure class=\"pic[^>]*>.*?</figure>", html, re.S)
    assert len(figs) == 13
    for f in figs:
        assert re.search(r'<img src="data:image/jpeg;base64,[A-Za-z0-9+/=]+" alt="[^"]+"', f)
    assert "object-fit:cover" in html and html.count("Illustrative") >= 13 and "Illustrative · Flagged" in html
    assert "https://" not in re.sub(r"<script.*?</script>", "", html, flags=re.S).split("<body>")[1].replace("http://www.w3.org", "")   # still self-contained


def test_hyperframes_writes_assets_and_references_them_as_files(review_run):
    hf = review_run / "hyperframes"
    files = sorted(p.name for p in (hf / "assets").iterdir())
    assert files and all(f.endswith("-1920.jpg") for f in files)
    idx = (hf / "index.html").read_text()
    assert "data:image" not in idx
    refs = set(re.findall(r'src="assets/([^"]+)"', idx))
    assert refs == set(files)


def test_the_web_markup_is_one_source_for_both_outputs(review_run):
    for f in (review_run / "deck.html", review_run / "hyperframes" / "index.html"):
        t = f.read_text()
        assert "pic-strip" in t and "pic-side" in t and ".plabel" in t and 'class="plabel flagged"' in t


# ---------------------------------------------------------------- the client refusal

def test_the_client_render_draws_only_approved_pictures_and_refuses_the_rest_in_validation(client_run):
    d = jdeck(client_run)
    prs = Presentation(str(client_run / "deck.pptx"))
    drawn = [(n, sh.name) for n in range(1, len(prs.slides) + 1) for sh in pics(prs, n)]
    assert len(drawn) == 6 and {n for n, _ in drawn} == {1, 8, 11}          # t1's four, the cover and the idea
    assert pics(prs, 9) == [] and pics(prs, 10) == []                       # t2 and t3 are not approved: no picture shape at all
    assert caps(prs, 8) == []                                               # approved: no label
    html = (client_run / "deck.html").read_text()
    assert html.count("<figure") == 6
    val = json.loads((client_run / "validation.json").read_text())
    un = [f for f in val if f["check"] == "image_unapproved"]
    assert un and all(f["level"] == "error" for f in un) and {f["slide"] for f in un} >= {"s09", "s10"}


def test_the_review_render_has_no_image_unapproved_error(review_run):
    val = json.loads((review_run / "validation.json").read_text())
    assert not any(f["check"] == "image_unapproved" for f in val) and any(f["check"] == "image_flagged" and f["level"] == "warn" for f in val)


def test_a_client_folder_holds_no_byte_of_an_unapproved_or_flagged_picture(client_run, demo_stages, tmp_path):
    d = jdeck(client_run)
    refused = [im for _, _, im in images.image_slots(d) if im.get("status") in ("made", "flagged") and im.get("asset")]
    assert len(refused) == 7   # t2's four and t3's three
    assets = d["assets"]
    originals, derived, b64 = set(), set(), []
    for im in refused:
        rec = assets[im["asset"]]
        src = demo_stages / rec["file"]
        originals.add(rec["sha256"])
        jpg = images.derived_jpeg(src, tmp_path / "ref", rec["sha256"])
        derived.add(hashlib.sha256(jpg.read_bytes()).hexdigest())
        b64.append(base64.b64encode(jpg.read_bytes()).decode()[:400])
    approved = {assets[im["asset"]]["sha256"] for _, _, im in images.image_slots(d) if im["status"] == "approved"}
    assert approved and not approved & originals
    bad_hashes = originals | derived
    seen = set()
    for p in client_run.rglob("*"):
        if p.is_file():
            seen.add(hashlib.sha256(p.read_bytes()).hexdigest())
    assert not (seen & bad_hashes), "an unapproved picture's file is in the client folder"
    with zipfile.ZipFile(client_run / "deck.pptx") as z:
        media = {hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith("ppt/media/")}
    assert media and not (media & bad_hashes)
    html = (client_run / "deck.html").read_text()
    assert not any(b in html for b in b64)
    assert [p for p in (client_run / "assets").iterdir() if p.is_file()] == []   # a client folder holds no original (it could carry metadata), only the derived JPEGs
    assert len(list((client_run / "assets" / "derived").iterdir())) == len(approved) == len(list((client_run / "hyperframes" / "assets").iterdir()))


def test_a_reference_only_asset_is_never_drawn_in_either_audience(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover"))
    some = next(iter(d["assets"].values()))
    some["rights"] = "reference_only"
    for audience in ("review", "client"):
        got = images.drawn({**d, "meta": {**d["meta"], "audience": audience}}, audience)
        assert all(d["assets"][im["asset"]]["rights"] != "reference_only" for im in got.values())
    assert len(images.drawn(d, "review")) < len([1 for _, _, im in images.image_slots(d) if im["status"] in ("made", "flagged")])


def test_an_approval_that_names_another_asset_is_not_drawn_for_a_client(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover"))
    im = d["slides"]["s08"]["slots"]["frame_1"]["image"]
    im["status"] = "approved"
    im["approval"] = {"asset": "img_ffffffffffff", "decision": "approve", "by": "human:x", "at": "2026-11-17T10:00:00+00:00"}
    assert ("s08", "frame_1") not in images.drawn(d, "client") and ("s08", "frame_1") in images.drawn(d, "review")


def test_a_missing_picture_file_stops_the_build_with_a_plain_message(demo_stages, build_demo, tmp_path):
    import shutil
    st = tmp_path / "st"
    shutil.copytree(demo_stages, st)
    next((st / "assets").iterdir()).unlink()
    with pytest.raises(SystemExit, match="is not on disk"):
        build_demo(st, tmp_path / "o", "--pictures", "creative_cover")
