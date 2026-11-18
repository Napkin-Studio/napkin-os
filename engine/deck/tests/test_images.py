"""deck-frames-in: images.py (records, assets, approvals, crops) and the build it feeds. Offline, no model; every picture is the
invented Lumen Water demo set (tests/fixtures/frames_demo). Run from engine/: ``PYTHONPATH=. python3 -m pytest -q deck/tests/test_images.py``."""
from __future__ import annotations

import copy
import hashlib
import json
import shutil
from pathlib import Path

import jsonschema
import pytest
from PIL import Image

from deck import images, spec
from deck.bench import checklist
from test_render_parity import pptx_signature

HERE = Path(__file__).resolve().parent
DECK_SCHEMA = json.loads((HERE.parent / "deck.schema.json").read_text())
DEMO = HERE / "fixtures" / "frames_demo"


def jdeck(run: Path) -> dict:
    """The run's deck.json without the layout plan's keys (``layouts.strip_plan``): these tests are about what slice 3 placed."""
    from deck import layouts
    return layouts.strip_plan(json.loads((run / "deck.json").read_text()))


# ---------------------------------------------------------------- crop_box

@pytest.mark.parametrize("w,h,aspect", [(1600, 900, "16:9"), (1600, 900, "4:3"), (900, 1600, "16:9"), (900, 1600, "9:16"), (1000, 1000, "1:1"),
                                        (1000, 1000, "4:5"), (320, 180, "4:3"), (3, 2, "16:9")])
def test_crop_box_holds_the_aspect_and_stays_inside_the_source(w, h, aspect):
    x0, y0, x1, y1 = images.crop_box(w, h, aspect)
    assert 0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h
    assert abs((x1 - x0) / (y1 - y0) - images.ratio(aspect)) <= 1.5 / min(x1 - x0, y1 - y0) * images.ratio(aspect) + 0.01   # never stretches


def test_a_picture_of_the_box_aspect_is_not_cropped():
    assert images.crop_box(1600, 900, "16:9") == (0, 0, 1600, 900)


@pytest.mark.parametrize("focal", [{"x": 0, "y": 0}, {"x": 1, "y": 1}, {"x": 0.05, "y": 0.95}, {"x": 0.5, "y": 0.5}, {"x": -3, "y": 9}])
def test_a_focal_point_at_the_edges_never_leaves_the_source(focal):
    for w, h, a in ((1600, 900, "4:3"), (900, 1600, "16:9")):
        x0, y0, x1, y1 = images.crop_box(w, h, a, focal)
        assert x0 >= 0 and y0 >= 0 and x1 <= w and y1 <= h


def test_the_focal_point_moves_the_crop_toward_it():
    left = images.crop_box(1600, 900, "4:3", {"x": 0, "y": 0.5})
    right = images.crop_box(1600, 900, "4:3", {"x": 1, "y": 0.5})
    assert left[0] == 0 and right[2] == 1600 and left[0] < right[0]


def test_src_rect_is_the_trimmed_share_on_each_side():
    l, t, r, b = images.src_rect((200, 0, 1400, 900), 1600, 900)
    assert (round(l, 4), t, round(r, 4), b) == (0.125, 0.0, 0.125, 0.0)


# ---------------------------------------------------------------- the slot table

def test_slot_names_match_the_contracts_pattern_and_the_types_are_picture_types():
    for t, rows in images.SLOT_TABLE.items():
        assert t in spec.PICTURE_SLIDE_TYPES
        for name, aspect, n in rows:
            assert aspect in spec.IMAGE_ASPECTS and n >= 1
            for i in range(1, n + 1):
                assert images.SLOT_NAME.match(f"{name}_{i}" if n > 1 else name)
    assert [n for n, _ in images.slot_specs({"type": "territory"})] == ["frame_1", "frame_2", "frame_3", "frame_4"]   # a slot with count n binds <name>_1..<name>_n


@pytest.mark.parametrize("title,aspect", [("Outdoor", "4:5"), ("Social stories", "9:16"), ("Press advert", "16:9"), ("Search ads", None), ("Radio", None)])
def test_an_execution_slot_follows_the_channel_frame(title, aspect):
    got = images.slot_specs({"type": "execution", "title": title})
    assert (got[0][1] if got else None) == aspect


def test_an_evidence_slide_takes_no_slot():
    for t in ("objective", "chart", "insight", "measurement", "timeline", "risks", "credentials"):
        assert images.slot_specs({"type": t, "title": "x"}) == []


# ---------------------------------------------------------------- the build: slots, assets, stamps

def test_frames_are_bound_by_territory_id_on_each_territory_slide(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover"))
    frames = json.loads((demo_stages / "frames.json").read_text())["frames"]
    for sid in d["order"]:
        s = d["slides"][sid]
        if s["type"] != "territory":
            continue
        tid = next(t["id"] for t in json.loads((demo_stages / "c_territories.json").read_text())["territories"] if s["label"] == f"Territory {t['name']}")
        for i in range(1, 5):
            im = s["slots"][f"frame_{i}"]["image"]
            if im["status"] != "empty":
                assert im["from"]["key"].startswith(f"{tid}-f{i}-")
                assert im["from"]["key"] in frames


def test_the_cover_follows_the_chosen_territorys_f1_and_the_idea_its_f4(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover"))
    cover = d["slides"][d["order"][0]]["slots"]["picture"]["image"]
    idea = next(s for s in d["slides"].values() if s["type"] == "idea")["slots"]["picture"]["image"]
    assert cover["from"]["key"] == "t1-f1-pro" and cover["aspect"] == "16:9"
    assert idea["from"]["key"] == "t1-f4-flash" and idea["aspect"] == "4:3"


def test_creative_alone_leaves_the_cover_and_the_divider_without_a_slot(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative"))
    assert "slots" not in d["slides"][d["order"][0]]
    assert not any("slots" in s for s in d["slides"].values() if s["type"] == "appendix")
    assert any("slots" in s for s in d["slides"].values() if s["type"] == "territory")


def test_pictures_none_places_nothing_and_conflicts_with_image(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "none"))
    assert not any("slots" in s for s in d["slides"].values()) and "assets" not in d
    with pytest.raises(SystemExit):
        build_demo(demo_stages, tmp_path / "p", "--pictures", "none", "--image", f"s01.picture={DEMO / 'cover.png'}")


def test_frames_arrive_made_never_approved_and_the_flagged_one_stays_flagged(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover"))
    got = {(sid, n): im for sid, n, im in images.image_slots(d)}
    assert {im["status"] for im in got.values()} == {"made", "flagged", "empty"}
    flagged = [im for im in got.values() if im["status"] == "flagged"]
    assert len(flagged) == 1 and "readable sign" in flagged[0]["reason"]
    assert all(not im.get("approval") for im in got.values())


def test_territory_accepted_is_kept_and_never_read_as_approval(demo_stages, build_demo, tmp_path):
    frames = json.loads((demo_stages / "frames.json").read_text())["frames"]
    assert frames["t2-f3-flash"]["territory_accepted"] is True and frames["t2-f3-flash"]["status"] == "flagged"
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover"))
    assert all(im["status"] != "approved" for _, _, im in images.image_slots(d))


def test_assets_are_registered_once_by_sha256_with_the_manifests_guard(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover"))
    for aid, a in d["assets"].items():
        assert aid == "img_" + a["sha256"][:12] and a["file"] == f"assets/{a['sha256']}.png" and a["rights"] == "generated"
    used = {im["asset"] for _, _, im in images.image_slots(d) if im.get("asset")}
    assert used == set(d["assets"])   # no record without a slot, one record per picture
    flagged = next(a for a in d["assets"].values() if a["guard"]["flagged"])
    assert flagged["guard"]["checked"] and "readable sign" in flagged["guard"]["reason"]


def test_one_file_used_twice_is_one_asset(demo_stages, build_demo, tmp_path):
    pic = DEMO / "cover.png"
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover", "--image", f"s12.picture={pic}", "--image-rights", "s12.picture=own",
                         "--image", f"s13.picture={pic}", "--image-rights", "s13.picture=own"))
    assert d["slides"]["s12"]["slots"]["picture"]["image"]["asset"] == d["slides"]["s13"]["slots"]["picture"]["image"]["asset"]
    assert sum(1 for a in d["assets"].values() if a["sha256"] == hashlib.sha256(pic.read_bytes()).hexdigest()) == 1


def test_empty_slots_carry_a_reason_and_the_preferences_are_stamped(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover"))
    empty = [im for _, _, im in images.image_slots(d) if im["status"] == "empty"]
    assert empty and all(im.get("reason") for im in empty)
    assert any("banned imagery" in im["reason"] for im in empty)   # a refused shot says why
    p = d["meta"]["preferences"]
    assert p["pictures"]["on"] == "creative_cover" and p["picture_source"] == {"allow": "existing", "source": "default"}
    assert p["picture_approval"]["label"] == "Illustrative" and p["picture_approval"]["source"] == "default"
    d2 = jdeck(build_demo(demo_stages, tmp_path / "p", "--pictures", "creative", "--picture-label", "Draft only", "--approver", "human:ann"))
    assert d2["meta"]["preferences"]["picture_approval"] == {"approver": "named", "user": "human:ann", "label": "Draft only", "source": "person"}


def test_the_demo_deck_validates_against_the_deck_schema(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover", "--image", f"s05.picture={DEMO / 'small.png'}",
                         "--image-rights", "s05.picture=own"))
    errs = list(jsonschema.Draft7Validator(DECK_SCHEMA).iter_errors(d))
    assert errs == [], errs[:3]


def test_a_generated_source_with_no_mark_data_is_refused_with_the_plain_words(demo_stages, build_demo, tmp_path):
    with pytest.raises(SystemExit) as e:   # deck-image-gen: generation is built; with no mark data it is refused, and nothing was sent
        build_demo(demo_stages, tmp_path / "o", "--pictures", "creative", "--picture-source", "generated")
    assert "no mark data" in str(e.value)


def test_generated_is_refused_message(demo_stages, tmp_path, capsys):
    from deck import run_deck
    with pytest.raises(SystemExit) as e:
        run_deck.main(["--stages", str(demo_stages), "--client", "x", "--project", "y", "--out", str(tmp_path), "--prompt-text", "p", "--picture-source", "generated"])
    assert "Confidential" in str(e.value)


# ---------------------------------------------------------------- supplied pictures

def test_supplied_pictures_need_a_right_or_they_are_reference_only_and_not_placed(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative", "--image", f"s05.picture={DEMO / 'small.png'}"))
    im = d["slides"]["s05"]["slots"]["picture"]["image"]
    assert im["status"] == "empty" and "image_rights" in im["reason"] and "asset" not in im
    assert not any(a["rights"] == "reference_only" for a in d.get("assets", {}).values())   # a reference-only picture is never even registered
    findings = json.loads((tmp_path / "o" / "validation.json").read_text())
    assert not any(f["check"] == "image_rights" and f["level"] == "error" for f in findings)   # held back, so nothing reference-only fills a slot


@pytest.mark.parametrize("target,why", [("s99.picture", "no slide s99"), ("s02.picture", "evidence slide"), ("s05.sidebar", "has the slots"), ("s12.logo", "meta.theme.logo")])
def test_a_bad_target_is_refused_before_anything_is_written(demo_stages, build_demo, tmp_path, target, why, capsys):
    with pytest.raises(SystemExit):
        build_demo(demo_stages, tmp_path / "o", "--pictures", "creative", "--image", f"{target}={DEMO / 'cover.png'}", "--image-rights", f"{target}=own")
    assert not (tmp_path / "o" / "deck.json").exists()


def test_the_logo_slot_is_refused_by_name():
    with pytest.raises(images.ImageError, match="meta.theme.logo"):
        images.parse_image_args([f"s01.logo={DEMO / 'cover.png'}"], [])


def test_stated_rights_are_one_of_the_three():
    with pytest.raises(images.ImageError):
        images.parse_image_args([f"s01.picture={DEMO / 'cover.png'}"], ["s01.picture=generated"])
    with pytest.raises(images.ImageError):
        images.parse_image_args([f"s01.picture={DEMO / 'cover.png'}"], ["s02.picture=own"])


# ---------------------------------------------------------------- image safety (fix: hostile or awkward files)

def _save(path: Path, im: Image.Image, **kw) -> Path:
    im.save(path, **kw)
    return path


def test_exif_orientation_is_applied_to_the_size_and_the_derived_jpeg(tmp_path):
    im = Image.new("RGB", (200, 100), (200, 30, 30))
    ex = Image.Exif()
    ex[0x0112] = 6   # rotate 90 clockwise on display
    f = _save(tmp_path / "turned.jpg", im, exif=ex)
    info = images.inspect_file(f)
    assert (info["width"], info["height"]) == (100, 200) and info["oriented"] is True
    out = images.derived_jpeg(f, tmp_path / "run", info["sha256"])
    with Image.open(out) as d:
        assert d.size == (100, 200)


def test_rgba_is_flattened_onto_white_in_the_derived_jpeg(tmp_path):
    f = _save(tmp_path / "t.png", Image.new("RGBA", (40, 40), (255, 0, 0, 0)))
    out = images.derived_jpeg(f, tmp_path / "run", images.inspect_file(f)["sha256"])
    with Image.open(out) as d:
        assert d.mode == "RGB" and all(c > 240 for c in d.getpixel((20, 20)))


def test_the_derived_jpeg_is_at_most_1920_on_the_long_side_and_cached(tmp_path):
    f = _save(tmp_path / "big.png", Image.new("RGB", (2600, 1300), (10, 20, 30)))
    sha = images.inspect_file(f)["sha256"]
    a = images.derived_jpeg(f, tmp_path / "run", sha)
    m = a.stat().st_mtime_ns
    with Image.open(a) as d:
        assert max(d.size) == 1920
    assert images.derived_jpeg(f, tmp_path / "run", sha) == a and a.stat().st_mtime_ns == m and a.name == f"{sha}-1920.jpg"


def test_svg_is_refused_by_suffix_and_by_content(tmp_path):
    body = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'
    for name in ("a.svg", "b.png"):
        p = tmp_path / name
        p.write_text(body)
        with pytest.raises(images.ImageError, match="SVG"):
            images.inspect_file(p)


def test_an_oversized_picture_is_refused_before_it_is_decoded(tmp_path, monkeypatch):
    f = _save(tmp_path / "wide.png", Image.new("RGB", (6000, 6000), (1, 2, 3)))
    monkeypatch.setattr(images, "MAX_PIXELS", 10_000_000)
    with pytest.raises(images.ImageError, match="pixels"):
        images.inspect_file(f)


def test_a_decompression_bomb_and_a_corrupt_file_are_refused(tmp_path, monkeypatch):
    f = _save(tmp_path / "b.png", Image.new("RGB", (400, 400), (1, 2, 3)))
    monkeypatch.setattr(images, "MAX_PIXELS", 1000)
    with pytest.raises(images.ImageError):
        images.inspect_file(f)
    bad = tmp_path / "c.png"
    bad.write_bytes(b"\x89PNG\r\n\x1a\nnot really")
    monkeypatch.undo()
    with pytest.raises(images.ImageError):
        images.inspect_file(bad)
    gif = _save(tmp_path / "d.gif", Image.new("P", (10, 10)))
    with pytest.raises(images.ImageError, match="PNG, JPEG or WEBP"):
        images.inspect_file(gif)


# ---------------------------------------------------------------- digits and names (fix: labels and alt text)

@pytest.mark.parametrize("label", ["Draft 2", "v1", "2026", ""])
def test_a_label_with_a_digit_or_nothing_is_refused(label):
    with pytest.raises(images.ImageError):
        images.clean_label(label)


def test_a_label_naming_the_client_or_the_agency_is_refused_but_a_word_of_it_is_not():
    for bad in ("Lumen Water draft", "Napkin Studio"):
        with pytest.raises(images.ImageError, match="names"):
            images.clean_label(bad, ["Lumen Water", "Napkin Studio"])
    assert images.clean_label("Water mood", ["Lumen Water"]) == "Water mood"
    with pytest.raises(images.ImageError):
        images.clean_label("x" * 31)


def test_alt_text_refuses_digits_and_names_and_is_cut_to_140():
    for bad in ("A tap in 2026", "The Lumen Water tap"):
        with pytest.raises(images.ImageError):
            images.make_alt(bad, ["Lumen Water"])
    long = "a quiet kitchen " * 20
    assert len(images.make_alt(long)) <= 140 and not images.make_alt(long).endswith(" ")


def test_a_label_flag_with_a_digit_stops_the_build_and_a_frame_whose_subject_names_the_client_is_held_back(demo_stages, build_demo, tmp_path):
    with pytest.raises(SystemExit):
        build_demo(demo_stages, tmp_path / "o", "--pictures", "creative", "--picture-label", "Draft 2")
    st = tmp_path / "st"
    shutil.copytree(demo_stages, st)
    f = json.loads((st / "frames.json").read_text())
    f["frames"]["t1-f1-pro"]["subject"] = "A glass of Lumen Water on a table"
    (st / "frames.json").write_text(json.dumps(f))
    d = jdeck(build_demo(st, tmp_path / "p", "--pictures", "creative_cover"))
    held = [im for _, _, im in images.image_slots(d) if im.get("from", {}).get("key") == "t1-f1-pro" or "held back" in im.get("reason", "")]
    assert any("held back" in im.get("reason", "") for im in held)


# ---------------------------------------------------------------- approvals

def _review(by="human:demo-approver", asset=None, decision="approve", at="2026-11-17T10:00:00+00:00"):
    return {"images": {"s08": {"frame_1": {"asset": asset, "decision": decision, "by": by, "at": at}}}}


def _demo(demo_stages, build_demo, tmp_path, *args):
    return jdeck(build_demo(demo_stages, tmp_path, "--pictures", "creative_cover", *args))


def test_a_decision_is_stamped_only_by_the_approver_for_the_slots_own_asset(demo_stages, build_demo, tmp_path):
    d = _demo(demo_stages, build_demo, tmp_path / "o")
    aid = d["slides"]["s08"]["slots"]["frame_1"]["image"]["asset"]
    ok = copy.deepcopy(d)
    assert images.stamp_review(ok, _review(asset=aid), "human:demo-approver") == {"approved": 1, "rejected": 0, "ignored": 0}
    im = ok["slides"]["s08"]["slots"]["frame_1"]["image"]
    assert im["status"] == "approved" and im["approval"]["asset"] == aid and im["approval"]["by"] == "human:demo-approver"
    for review, approver in ((_review(asset=aid, by="human:someone-else"), "human:demo-approver"),   # a different person
                             (_review(asset="img_ffffffffffff"), "human:demo-approver"),               # another picture
                             (_review(asset=aid, at=""), "human:demo-approver"),                       # no timestamp
                             (_review(asset=aid), None),                                               # no approver for the deck
                             (_review(asset=aid, by="demo-approver"), "demo-approver")):               # not human:<id>
        c = copy.deepcopy(d)
        got = images.stamp_review(c, review, approver)
        assert got["approved"] == 0 and c["slides"]["s08"]["slots"]["frame_1"]["image"]["status"] == "made", (review, approver)


def test_replace_and_remove_mark_the_picture_rejected(demo_stages, build_demo, tmp_path):
    d = _demo(demo_stages, build_demo, tmp_path / "o")
    aid = d["slides"]["s08"]["slots"]["frame_1"]["image"]["asset"]
    for dec in ("replace", "remove"):
        c = copy.deepcopy(d)
        assert images.stamp_review(c, _review(asset=aid, decision=dec), "human:demo-approver")["rejected"] == 1
        assert c["slides"]["s08"]["slots"]["frame_1"]["image"]["status"] == "rejected"


def test_changing_the_frame_file_returns_the_slot_to_made(demo_stages, build_demo, tmp_path):
    d = _demo(demo_stages, build_demo, tmp_path / "o")
    aid = d["slides"]["s08"]["slots"]["frame_1"]["image"]["asset"]
    rev = tmp_path / "review.json"
    rev.write_text(json.dumps(_review(asset=aid)))
    a = _demo(demo_stages, build_demo, tmp_path / "a", "--review", str(rev), "--approver", "human:demo-approver")
    assert a["slides"]["s08"]["slots"]["frame_1"]["image"]["status"] == "approved"
    st = tmp_path / "st"
    shutil.copytree(demo_stages, st)
    f = json.loads((st / "frames.json").read_text())
    other = f["frames"]["t1-f2-pro"]   # another picture in this slot
    f["frames"]["t1-f1-pro"].update({k: other[k] for k in ("file", "sha256", "width", "height")})
    (st / "frames.json").write_text(json.dumps(f))
    b = _demo(st, build_demo, tmp_path / "b", "--review", str(rev), "--approver", "human:demo-approver")
    im = b["slides"]["s08"]["slots"]["frame_1"]["image"]
    assert im["status"] == "made" and not im.get("approval") and im["asset"] != aid


def test_a_frame_shared_by_the_cover_and_a_territory_slide_is_approved_per_slot(demo_stages, build_demo, tmp_path):
    d = _demo(demo_stages, build_demo, tmp_path / "o")
    review = {}
    res = images.approve_territory(review, d, "t1", "human:demo-approver", at="2026-11-17T10:00:00+00:00")
    # t1: four territory frames, the cover's f1 and the idea's f4: one entry for every slot holding one of its frames
    assert sorted(res["approved"]) == sorted([("s01", "picture"), ("s08", "frame_1"), ("s08", "frame_2"), ("s08", "frame_3"), ("s08", "frame_4"), ("s11", "picture")])
    assert all(e["decision"] == "approve" and e["by"] == "human:demo-approver" for slots in review["images"].values() for e in slots.values())


def test_approving_a_territory_needs_a_person_and_skips_flagged_unchecked_and_refused(demo_stages, build_demo, tmp_path):
    d = _demo(demo_stages, build_demo, tmp_path / "o")
    for bad in ("claude", "agent:x", "human:", "", None):
        with pytest.raises(images.ImageError):
            images.approve_territory({}, d, "t2", bad)
    review = {}
    t2 = images.approve_territory(review, d, "t2", "human:demo-approver")
    assert ("s09", "frame_3") in [(s, n) for s, n, _ in t2["skipped"]] and "flagged" in dict(((s, n), w) for s, n, w in t2["skipped"])[("s09", "frame_3")]
    assert "frame_3" not in review["images"]["s09"] and len(t2["approved"]) == 3   # the flagged one is left for a person
    t3 = images.approve_territory({}, d, "t3", "human:demo-approver")
    why = {(s, n): w for s, n, w in t3["skipped"]}
    assert "no guard" in why[("s10", "frame_3")]                                   # never looked at by the guard
    assert "empty" in why[("s10", "frame_4")]                                      # refused: nothing to approve


def test_the_flagged_slot_stays_flagged_after_the_review_and_a_territory_approval(demo_stages, build_demo, tmp_path):
    d = _demo(demo_stages, build_demo, tmp_path / "o")
    review = {}
    images.approve_territory(review, d, "t2", "human:demo-approver")
    rev = tmp_path / "r.json"
    rev.write_text(json.dumps(review))
    b = _demo(demo_stages, build_demo, tmp_path / "b", "--review", str(rev), "--approver", "human:demo-approver")
    assert b["slides"]["s09"]["slots"]["frame_3"]["image"]["status"] == "flagged"
    assert b["slides"]["s09"]["slots"]["frame_1"]["image"]["status"] == "approved"


def test_the_approve_command_writes_the_review_file(demo_stages, build_demo, tmp_path, capsys):
    run = build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover")
    rev = tmp_path / "review.json"
    assert images.main(["approve", "--review", str(rev), "--deck", str(run / "deck.json"), "--territory", "t1", "--by", "human:demo-approver"]) == 0
    assert set(json.loads(rev.read_text())["images"]) == {"s01", "s08", "s11"}
    assert images.main(["approve", "--review", str(rev), "--deck", str(run / "deck.json"), "--territory", "t1", "--by", "claude"]) == 2
    assert "only a person approves" in capsys.readouterr().err


def test_a_rebuild_with_a_changed_review_changes_only_slots_and_preferences(demo_stages, build_demo, tmp_path):
    a = jdeck(build_demo(demo_stages, tmp_path / "a", "--pictures", "creative_cover"))
    review = {}
    images.approve_territory(review, a, "t1", "human:demo-approver")
    rev = tmp_path / "r.json"
    rev.write_text(json.dumps(review))
    b = jdeck(build_demo(demo_stages, tmp_path / "b", "--pictures", "creative_cover", "--review", str(rev), "--approver", "human:demo-approver"))
    for d in (a, b):
        d["meta"].pop("built_at", None)
    for sid in a["order"]:
        sa, sb = dict(a["slides"][sid]), dict(b["slides"][sid])
        sa.pop("slots", None), sb.pop("slots", None)
        assert sa == sb, sid                              # no word, block or note moved
    ma, mb = dict(a["meta"]), dict(b["meta"])
    ma.pop("preferences"), mb.pop("preferences")
    assert ma == mb and {k: v for k, v in a.items() if k not in ("slides", "meta")} == {k: v for k, v in b.items() if k not in ("slides", "meta")}
    assert checklist.words_sha(a) == checklist.words_sha(b)


# ---------------------------------------------------------------- words, layouts, no-op

def test_words_are_equal_with_and_without_pictures_through_the_one_shared_hash(demo_stages, build_demo, tmp_path):
    with_p = jdeck(build_demo(demo_stages, tmp_path / "a", "--pictures", "creative_cover"))
    without = jdeck(build_demo(demo_stages, tmp_path / "b"))
    assert checklist.words_sha(with_p) == checklist.words_sha(without)
    # one hash: the checklist's w_words_sha calls the same function, and no frames module hashes words itself
    import inspect
    assert "words_sha(r.deck)" in inspect.getsource(checklist.w_words_sha)
    for mod in ("images.py", "from_territory.py"):
        assert "_words_of" not in (HERE.parent / mod).read_text() and "words_sha" not in (HERE.parent / mod).read_text()


def test_layout_ids_equal_the_build_without_pictures_and_nothing_falls_back(demo_stages, build_demo, tmp_path):
    with_p = build_demo(demo_stages, tmp_path / "a", "--pictures", "creative_cover")
    without = build_demo(demo_stages, tmp_path / "b")
    la = json.loads((with_p / "layouts.json").read_text())["slides"]
    lb = json.loads((without / "layouts.json").read_text())["slides"]
    # a picture layout (cover_image, image_text, frames_strip, execution_visual) stands where the rules' text layout stood
    from deck import layouts
    deck = json.loads((with_p / "deck.json").read_text())
    plain_deck = json.loads((without / "deck.json").read_text())
    for k, v in la.items():
        want = lb[k]["id"]
        if any(((d["slides"][k].get("layout") or {}).get("why") or "").startswith("variety") for d in (deck, plain_deck)):
            continue   # a variety swap depends on the families the whole deck holds, which a picture layout changes: not what this test is about
        assert v["id"] == want or (v["id"] in layouts.load() and layouts.pick(deck["slides"][k]) == want and any(
            s.get("required") for s in layouts.load()[v["id"]]["slots"].values() if s["kind"] == "image")), (k, v["id"], want)
    assert sum(v["fallback"] for v in la.values()) == 0
    assert not any(f["check"] == "image_missing" for f in json.loads((with_p / "validation.json").read_text()))


def test_frames_json_with_no_pictures_flag_changes_nothing(demo_stages, build_demo, tmp_path):
    """A stray frames.json in a stages folder never changes a deck nobody asked to picture."""
    plain = tmp_path / "plain"
    plain.mkdir()
    for f in demo_stages.glob("*.json"):
        if f.name != "frames.json":
            shutil.copyfile(f, plain / f.name)
    a = build_demo(plain, tmp_path / "a")
    b = build_demo(demo_stages, tmp_path / "b")   # the same stages, with frames.json and assets/ beside them
    da, db = jdeck(a), jdeck(b)
    da["meta"].pop("built_at"), db["meta"].pop("built_at")   # the only moving part: the build time
    assert da == db
    assert pptx_signature(a / "deck.pptx") == pptx_signature(b / "deck.pptx")
    d = jdeck(b)
    assert "assets" not in d and "preferences" not in d["meta"] and not any("slots" in s for s in d["slides"].values())
    assert not (b / "assets").exists()


def test_a_territory_made_stage_c_with_no_mood_or_risks_builds(demo_stages, build_demo, tmp_path):
    d = jdeck(build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover"))
    t = next(s for s in d["slides"].values() if s["type"] == "territory")
    kv = next(b for b in t["blocks"] if b["kind"] == "kv")
    assert [r[0] for r in kv["items"]] == ["Why it fits"]
    t3 = [s for s in d["slides"].values() if s["type"] == "territory"][2]
    assert [r[0] for r in next(b for b in t3["blocks"] if b["kind"] == "kv")["items"]] == ["Why it fits", "Risks"]   # the assumption-dependent one


def test_frames_stay_bound_across_the_pitch_arrangement_and_the_full_format(demo_stages, build_demo, tmp_path):
    for fmt in ("pitch", "full"):
        d = jdeck(build_demo(demo_stages, tmp_path / fmt, "--pictures", "creative_cover", "--format", fmt))
        keys = {s["label"]: s["slots"]["frame_1"]["image"]["from"]["key"] for s in d["slides"].values() if s["type"] == "territory"}
        assert keys == {"Territory The Tap Tells": "t1-f1-pro", "Territory Every Drop Counted": "t2-f1-flash", "Territory The Quiet Mains": "t3-f1-flash"}, fmt


def test_frames_stay_bound_after_a_red_team_reorder_and_a_stage_e_title_change(demo_stages, build_demo, tmp_path):
    st = tmp_path / "st"
    shutil.copytree(demo_stages, st)
    (st / "red_team.json").write_text(json.dumps({"stage": "red_team", "produced_by": "test", "objections": []}))
    (st / "e_copy.json").write_text(json.dumps({"stage": "e", "produced_by": "test", "edits": [
        {"title": "Territory: The Tap Tells", "blocks": [], "new_title": "Territory: The Tap Speaks"}]}))
    d = jdeck(build_demo(st, tmp_path / "o", "--pictures", "creative_cover"))
    ts = [s for s in d["slides"].values() if s["type"] == "territory"]
    assert [s["slots"]["frame_1"]["image"]["from"]["key"] for s in ts] == ["t1-f1-pro", "t2-f1-flash", "t3-f1-flash"]


def test_a_bad_style_pack_plus_frames_still_builds_with_the_hold_flag_and_never_restamps_a_style(demo_stages, build_demo, tmp_path):
    from deck import from_territory
    bad = tmp_path / "pack"
    bad.mkdir()
    (bad / "style.yaml").write_text("finish: not-a-finish\n")
    st = tmp_path / "st"
    st.mkdir()
    assert from_territory.main([str(DEMO / "lumen_run.json"), "--frames", str(next((DEMO / "lumen_run.frames").glob("v1-*/manifest.json"))), "--stages", str(st),
                                "--chosen", "t1", "--style-pack", str(bad)]) == 0
    for f in (DEMO / "base").glob("*.json"):
        shutil.copyfile(f, st / f.name)
    d = jdeck(build_demo(st, tmp_path / "o", "--pictures", "creative_cover"))
    sp = d["meta"]["preferences"]["style_pack"]
    assert sp["hold"] is True and "could not be read" in sp["hold_reason"] and sp["hash"] == "5d1c3a90"
    assert {im["style"]["hash"] for _, _, im in images.image_slots(d) if im.get("style")} == {"5d1c3a90"}   # the frames keep the style they were made in
    assert list(jsonschema.Draft7Validator(DECK_SCHEMA).iter_errors(d)) == []
    ok = jdeck(build_demo(demo_stages, tmp_path / "p", "--pictures", "creative_cover"))
    assert "style_pack" not in ok["meta"]["preferences"]
