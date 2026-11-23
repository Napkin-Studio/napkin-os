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
def test_the_storyboard_slide_takes_a_frame_and_size_and_packshot_slides_are_gaps_without_their_own_finals(tmp_path, monkeypatch, graphics):
    d, res = _bound(tmp_path, monkeypatch, graphics)
    items = res["picker"]["picks"]
    by_slot = {p["slot"]: p for p in items}
    assert {"s1.picture", "s2.picture", "s5.picture"} <= set(by_slot), sorted(by_slot)
    im, fr = _from(d, "s5")
    assert fr.get("kind") == "production" and fr.get("key") and by_slot["s5.picture"]["role"] == "storyboard_frame"   # the storyboard slide shows a frame
    held = {_from(d, "s1")[1]["key"], _from(d, "s2")[1]["key"]}
    im, fr = _from(d, "s3")   # the crops slide shows one of Production's sizes (any shape when frames are drawn), never the key visual
    if graphics:
        assert fr.get("kind") == "production" and by_slot["s3.picture"]["role"] == "size" and fr["key"] not in held
    else:
        assert fr.get("key") not in held and (im["status"] == "empty" or by_slot["s3.picture"]["role"] == "size")
    im, fr = _from(d, "s4")   # the demo holds no packshot final: a clear gap, never the key visual or another slide's picture
    assert im["status"] == "empty" and im["reason"].startswith("To supply from Production: a packshot") and fr.get("key") not in held
    assert "s4.picture" not in by_slot


def test_a_group_pool_offers_only_the_finals_of_its_kind_and_puts_the_unused_ones_first(tmp_path, monkeypatch):
    monkeypatch.setattr(spec, "GRAPHICS", True)
    d = _deck()
    clan = tmp_path / "lumen.clan"
    mb.build_clan(clan)
    meta = pp.Plan(pp.Source(clan)).metadata_prod()
    assert images.group_pool(meta, "16:9", any_shape=True, group="product") == []   # no packshot final in the demo
    pool = images.group_pool(meta, "16:9", any_shape=True, group="sizes")
    roles = {meta["items"][k]["role"] for k in pool}
    assert roles == {"size"} and len(pool) >= 2
    used = {pool[0]}
    again = images.group_pool(meta, "16:9", used, any_shape=True, group="sizes")
    assert again[0] != pool[0] and set(again) == set(pool)
    assert images.execution_group("Size crops") == "sizes" and images.execution_group("Packshot") == "product"
    assert images.execution_group("Key visual") == "keyvisual" and images.execution_channel("Storyboard frames") == "film"
    del d
