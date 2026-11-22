"""An execution slide that groups Production's finals ("Size crops", "Packshot", "Storyboard frames") gets pictures from them, not a grey
Role box (production-spinoff live test 2026-11-22: only the key visual was ever offered). Offline, on the invented demo project."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

from deck import images, prod_picker as pp, spec

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "fixtures" / "production_demo"))
import make_bundle as mb   # noqa: E402

sys.path.remove(str(HERE / "fixtures" / "production_demo"))


def _deck():
    slides = {"s1": {"type": "title", "title": "Lumen Water"}, "s2": {"type": "idea", "title": "Every drop has a story."},
              "s3": {"type": "execution", "title": "Size crops"}, "s4": {"type": "execution", "title": "Packshot"},
              "s5": {"type": "execution", "title": "Storyboard frames"}}
    return {"meta": {"client": "Lumen Water"}, "order": list(slides), "slides": slides}


def _bound(tmp_path, monkeypatch, graphics: bool):
    monkeypatch.setattr(spec, "GRAPHICS", graphics)
    d = _deck()
    clan = tmp_path / "lumen.clan"
    mb.build_clan(clan, embed=("master", "upload_master", "story", "six", "feed", "link", "f1", "f2", "f3", "f4", "fe"))
    res = pp.run(d, pp.Source(clan), tmp_path / "st")
    return d, res


def _from(d, sid):
    im = ((d["slides"][sid].get("slots") or {}).get("picture") or {}).get("image") or {}
    return im, im.get("from") or {}


@pytest.mark.parametrize("graphics", [False, True])
def test_size_packshot_and_storyboard_slides_each_take_a_final_from_production(tmp_path, monkeypatch, graphics):
    d, res = _bound(tmp_path, monkeypatch, graphics)
    items = res["picker"]["picks"]
    by_slot = {p["slot"]: p for p in items}
    assert {"s1.picture", "s2.picture", "s3.picture", "s4.picture", "s5.picture"} <= set(by_slot), sorted(by_slot)
    for sid in ("s3", "s4", "s5"):
        im, fr = _from(d, sid)
        assert fr.get("kind") == "production" and fr.get("key"), (sid, im)
    keys = {sid: _from(d, sid)[1]["key"] for sid in ("s3", "s4", "s5")}
    assert by_slot["s5.picture"]["role"] == "storyboard_frame"           # the storyboard slide shows a frame
    assert by_slot["s3.picture"]["role"] in ("key_visual", "size")        # the crops slide shows a Format set's picture or a size
    if graphics:   # the live default: every shape is shown whole, so each slide takes a picture no earlier slide holds
        held = [_from(d, "s1")[1]["key"], _from(d, "s2")[1]["key"]]
        assert keys["s3"] not in held and keys["s4"] not in held and keys["s3"] != keys["s4"]
    for sid in ("s3", "s4"):   # the person can swap among every final of the group
        assert len(by_slot[f"{sid}.picture"]["eligible"]) > 1


def test_a_group_pool_offers_every_final_and_puts_the_unused_placeable_ones_first(tmp_path, monkeypatch):
    monkeypatch.setattr(spec, "GRAPHICS", True)
    d = _deck()
    clan = tmp_path / "lumen.clan"
    mb.build_clan(clan)
    meta = pp.Plan(pp.Source(clan)).metadata_prod()
    pool = images.group_pool(meta, "16:9", any_shape=True)
    roles = {meta["items"][k]["role"] for k in pool}
    assert roles <= {"master", "size"} and len(pool) >= 3
    used = {pool[0]}
    again = images.group_pool(meta, "16:9", used, any_shape=True)
    assert again[0] != pool[0] and set(again) == set(pool)
    assert images.execution_group("Size crops") == "sizes" and images.execution_group("Packshot") == "product"
    assert images.execution_group("Key visual") is None and images.execution_channel("Storyboard frames") == "film"
    del d
