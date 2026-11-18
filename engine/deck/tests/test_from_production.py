"""deck-prod-assets slices 1-2: deck.from_production reads a Production Tool export, and images.bind_production places its pictures.
Offline; the bundle is the invented Lumen Water export that fixtures/production_demo/make_bundle.py builds in code (no client material).
Run from engine/: ``PYTHONPATH=. python3 -m pytest deck/tests/test_from_production.py``."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

from deck import from_production as fp, imagegen, images, spec, validate

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "fixtures" / "production_demo"))
import make_bundle as mb   # noqa: E402

sys.path.remove(str(HERE / "fixtures" / "production_demo"))


@pytest.fixture(autouse=True)
def no_socket(monkeypatch):
    """Any connection raises: the importer and the binding never reach the network."""
    def refuse(*a, **k):
        raise AssertionError("deck-prod-assets opened a socket")
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)


@pytest.fixture(scope="module")
def bundle(tmp_path_factory):
    p = tmp_path_factory.mktemp("prod") / "napkin-lumen-water-production.zip"
    mb.build(p)
    return p


@pytest.fixture(scope="module")
def prod(bundle):
    return fp.build(bundle, at="2026-11-18T10:00:00+00:00")[0]


def make(tmp_path, **kw):
    p = tmp_path / "bundle.zip"
    mb.build(p, **kw)
    return p


def refused(prod, entity):
    return next((r["reason"] for r in prod["refused"] if r["entity"].startswith(entity)), None)


# ---------------------------------------------------------------- (1) the offer

def test_from_production_reads_bundle(prod):
    items = prod["items"]
    assert set(items) == {f"{mb.FSET_NEW}#master", f"{mb.FSET_OLD}#master", mb.S_STORY, mb.S_SIX, mb.S_FEED, mb.S_LINK, mb.S_CLIENT,
                          mb.S_OLD_STORY, mb.F1, mb.F2, mb.F3, mb.FE}
    assert mb.S_MAKING not in items and mb.S_FILM not in items and mb.F1_OLD not in items   # making, video, and a frame nobody picked
    assert (items[mb.S_STORY]["status"], items[mb.S_FEED]["status"], items[mb.S_LINK]["status"]) == ("ready", "look", "stale")
    assert "needs a look" in items[mb.S_FEED]["reason"] and "Out of date" in items[mb.S_LINK]["reason"]
    assert items[mb.S_STORY]["channel"] == "social" and items[mb.S_SIX]["channel"] == "ooh" and items[mb.S_STORY]["format"]["format_id"] == "meta-stories-9x16"
    assert items[mb.S_STORY]["aspect"] == {"w": 9, "h": 16} and items[mb.S_STORY]["delivery"] == {"width": 900, "height": 1600}
    assert prod["contract_version"] == "3" and prod["project"]["id"] == mb.PROJECT and prod["fixture"] is True
    assert prod["not_carried"] == {"renders": 1, "video_sizes": 1, "video_masters": 0}


def test_each_item_records_entity_version_origin_sha_and_bundle_hash(bundle, prod):
    clan = zipfile.ZipFile(bundle).read("Lumen-Water-launch-invented.clan")
    for key, it in prod["items"].items():
        assert it["entity"] and it["version"] == 2 and it["origin"] in ("generated", "uploaded", "edited") and len(it["sha256"]) == 64
        assert it["bundle_sha256"] == hashlib.sha256(clan).hexdigest() == prod["bundle"]["clan_sha256"]
        assert it["file"] == f"assets/{it['sha256']}.png"
    assert prod["items"][mb.S_STORY]["job_id"] == mb.JOB


def test_the_film_execution_frame_is_one_picked_frame_per_shot(prod):
    frames = {k: v for k, v in prod["items"].items() if v["role"] == "frame"}
    assert set(frames) == {mb.F1, mb.F2, mb.F3, mb.FE}   # F1_OLD is an alternate, F4 is mock
    assert frames[mb.F1]["shot"] == mb.SH1 and frames[mb.FE]["shot_kind"] == "end_card"
    assert images.production_frame(prod) == mb.F1   # the first shot (end cards never), one frame: no four-box strip


# ---------------------------------------------------------------- (2) refusals

@pytest.mark.parametrize("cv", ["2", "4"])
def test_refuses_contract_2_and_4(tmp_path, cv):
    with pytest.raises(fp.FromProductionError, match=f"contract '{cv}'"):
        fp.build(make(tmp_path, contract=cv))


def test_the_legacy_export_is_refused_by_name(tmp_path):
    with pytest.raises(fp.FromProductionError, match="legacy export \\(document.json"):
        fp.build(make(tmp_path, legacy=True))


def test_hash_mismatch_refused_item_by_item(tmp_path):
    p, _ = fp.build(make(tmp_path, flip="story"))
    assert mb.S_STORY not in p["items"] and "do not hash" in refused(p, mb.S_STORY)
    assert mb.S_SIX in p["items"] and f"{mb.FSET_NEW}#master" in p["items"]   # the rest are offered


def test_a_missing_asset_is_refused_item_by_item(tmp_path):
    p, _ = fp.build(make(tmp_path, omit="master"))
    assert f"{mb.FSET_NEW}#master" not in p["items"] and "no bytes" in refused(p, mb.FSET_NEW)
    assert p["format_sets"][mb.FSET_NEW]["master"] is None and mb.S_STORY in p["items"]   # the master may be absent


def test_not_an_export_and_two_clans_are_refused(tmp_path):
    z = tmp_path / "x.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("readme.txt", "hello")
    with pytest.raises(fp.FromProductionError, match="no <project>.clan"):
        fp.build(z)
    two = tmp_path / "two.zip"
    with zipfile.ZipFile(make(tmp_path)) as src, zipfile.ZipFile(two, "w") as dst:
        for n in src.namelist():
            dst.writestr(n, src.read(n))
        dst.writestr("Other.clan", src.read("Lumen-Water-launch-invented.clan"))
    with pytest.raises(fp.FromProductionError, match="2 .clan files"):
        fp.build(two)
    (tmp_path / "plain.zip").write_bytes(b"not a zip")
    with pytest.raises(fp.FromProductionError, match="not a zip"):
        fp.build(tmp_path / "plain.zip")


def test_another_app_and_a_document_with_no_project_are_refused(tmp_path):
    with pytest.raises(fp.FromProductionError, match="not 'production-tool'"):
        fp.build(make(tmp_path, mutate=lambda d: d.update(app="brief-maker")))
    with pytest.raises(fp.FromProductionError, match="no project id"):
        fp.build(make(tmp_path, mutate=lambda d: d["project"].update(id="nope")))


# ---------------------------------------------------------------- (3) rights

def test_rights_from_origin(prod):
    it = prod["items"]
    assert it[f"{mb.FSET_NEW}#master"]["rights"] == "generated" and "to_supply" not in it[f"{mb.FSET_NEW}#master"]
    up = it[f"{mb.FSET_OLD}#master"]
    assert up["rights"] == "reference_only" and up["to_supply"] == "rights" and "uploaded" in up["rights_why"]
    assert it[mb.S_OLD_STORY]["rights"] == "reference_only"   # a size made from an upload is the upload's: inference only lowers
    assert it[mb.F3]["rights"] == "generated"                  # an edit whose chain reaches only a generated frame
    assert mb.F4 not in it and "mock" in refused(prod, mb.F4)  # mock output is refused


def test_edits_with_no_chain_or_of_a_canvas_picture_are_reference_only():
    doc = mb.document({k: mb.draw(*v) for k, v in mb.PICTURES.items()})
    sha = {k: "sha256:" + hashlib.sha256(mb.draw(*v)).hexdigest() for k, v in mb.PICTURES.items()}
    assert fp.rights_of(doc, sha["fn1"])[0] == "reference_only" and "canvas picture" in fp.rights_of(doc, sha["fn1"])[1]
    assert fp.rights_of(doc, sha["orphan"]) == ("reference_only", "an edit with no frame chain")
    assert fp.rights_of(doc, sha["f3"])[0] == "generated"
    doc["assets"][sha["upload_master"]]["origin"] = "drawn"
    assert fp.rights_of(doc, sha["upload_master"])[0] == "own"
    doc["assets"][sha["f3_gen"]]["origin"] = "mock"
    assert fp.rights_of(doc, sha["f3"])[0] == "mock"


def test_a_rights_field_never_raises_mock_or_an_upload_and_is_reported_as_forged():
    """Contract 3 defines no rights field on an asset: a forged one is ignored, mock is refused first, and the export is named forged."""
    doc = mb.document({k: mb.draw(*v) for k, v in mb.PICTURES.items()})
    sha = {k: "sha256:" + hashlib.sha256(mb.draw(*v)).hexdigest() for k, v in mb.PICTURES.items()}
    doc["assets"][sha["master"]].update(origin="mock", rights="generated")
    assert fp.rights_of(doc, sha["master"]) == ("mock", "mock output")
    doc["assets"][sha["upload_master"]].update(origin="uploaded", rights="licensed")
    assert fp.rights_of(doc, sha["upload_master"])[0] == "reference_only"
    for forged in ("own", "client_supplied", "generated"):
        doc["assets"][sha["upload_master"]]["rights"] = forged
        assert fp.rights_of(doc, sha["upload_master"])[0] == "reference_only", forged
    assert {w["entity"] for w in fp.forged_fields(doc)} == {sha["master"], sha["upload_master"]}


def test_a_forged_rights_field_in_a_bundle_is_ignored_and_warned(tmp_path):
    master = "sha256:" + hashlib.sha256(mb.draw(*mb.PICTURES["master"])).hexdigest()

    def forge(d):
        for a in d["assets"].values():
            if a.get("origin") == "uploaded":
                a["rights"] = "licensed"
        d["assets"][master].update(origin="mock", rights="generated")
    p, _ = fp.build(make(tmp_path, mutate=forge))
    up = p["items"][f"{mb.FSET_OLD}#master"]
    assert up["rights"] == "reference_only" and up["to_supply"] == "rights"
    assert f"{mb.FSET_NEW}#master" not in p["items"] and "mock" in refused(p, mb.FSET_NEW)
    assert p["warnings"] and all("forged" in w["warning"] for w in p["warnings"])
    clean, _ = fp.build(make(tmp_path))
    assert "warnings" not in clean


# ---------------------------------------------------------------- focal points, channels

def test_protect_boxes_map_through_the_crop_and_extend_or_regenerate_take_the_centre(prod):
    it = prod["items"]
    assert it[f"{mb.FSET_NEW}#master"]["focal"] == {"x": 0.7292, "y": 0.5} and it[f"{mb.FSET_NEW}#master"]["focal_by"] == "protect"
    assert it[mb.S_STORY]["focal"] == {"x": round((1400 - 1040) / 607.5, 4), "y": 0.5}
    assert it[mb.S_SIX]["focal"] == fp.CENTRE and it[mb.S_SIX]["focal_by"] == "centre"        # regenerate
    assert it[mb.S_CLIENT]["focal"] == fp.CENTRE                                               # extend
    assert it[f"{mb.FSET_OLD}#master"]["focal"] == fp.CENTRE                                   # keep_middle
    assert not any(k in it for it in prod["items"].values() for k in ("crop", "protect", "boxes"))   # a focal point, never pixels
    k = it[f"{mb.FSET_NEW}#master"]["keep"]                                                    # the boxes' union, as fractions
    assert k == {"x0": round(1200 / 1920, 4), "y0": round(240 / 1080, 4), "x1": round(1600 / 1920, 4), "y1": round(840 / 1080, 4)}
    assert it[mb.S_STORY]["keep"]["x0"] == round(160 / 607.5, 4) and "keep" not in it[mb.S_SIX] and "keep" not in it[f"{mb.FSET_OLD}#master"]


def test_size_focal_outside_the_crop_is_the_centre():
    fs = {"protect": {"boxes": [{"role": "subject", "x": 0, "y": 0, "w": 10, "h": 10}]}}
    assert fp.size_focal({"method": "crop", "crop": {"x": 500, "y": 0, "w": 100, "h": 100}}, fs) == (fp.CENTRE, "centre")


def test_channels_come_from_the_pinned_packs_and_fall_back_to_the_nearest_aspect(prod):
    src = json.loads(fp.PACKS_SOURCE.read_text())
    assert hashlib.sha256(fp.PACKS.read_bytes()).hexdigest() == src["sha256"] and len(src["commit"]) == 40
    assert prod["format_packs"]["commit"] == src["commit"]
    c = prod["items"][mb.S_CLIENT]
    assert c["channel_by"] == "nearest_aspect" and "channel" not in c


# ---------------------------------------------------------------- (9) privacy and the zip

def test_production_json_carries_no_spine_decision_thumb_location_or_copy(prod):
    text = json.dumps(prod)
    for canary in mb.CANARIES:
        assert canary not in text, canary
    assert prod["format_sets"][mb.FSET_OLD]["brief"] == {"document_id": mb.BRIEF_DOC, "data_sha256": "sha256:" + "ab" * 32}
    assert "etag" not in text.lower()


def test_only_offered_image_assets_are_copied(tmp_path, bundle):
    st = tmp_path / "st"
    assert fp.main([str(bundle), "--stages", str(st)]) == 0
    p = json.loads((st / "production.json").read_text())
    files = sorted(x.name for x in (st / "assets").iterdir())
    assert files == sorted({i["file"].split("/")[1] for i in p["items"].values()})
    assert not any(x.suffix == ".mp4" for x in (st / "assets").iterdir())
    assert sorted(x.name for x in st.iterdir()) == ["assets", "production.json"]


def test_members_are_read_by_exact_name_so_a_traversal_name_is_never_written(tmp_path):
    src = make(tmp_path)
    evil = tmp_path / "evil.zip"
    with zipfile.ZipFile(src) as a, zipfile.ZipFile(evil, "w") as b:
        for n in a.namelist():
            b.writestr(n, a.read(n))
        b.writestr("../escaped.png", b"x")
        b.writestr("assets/../../escaped2.png", b"x")
    st = tmp_path / "deep" / "st"
    assert fp.main([str(evil), "--stages", str(st)]) == 0
    assert not list(tmp_path.rglob("escaped*.png"))


def test_a_zip_bomb_member_is_refused_before_it_is_inflated(tmp_path):
    bomb = tmp_path / "bomb.zip"
    with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Big.clan", b"\0" * (fp.RATIO_MAX * 2000))
    with pytest.raises(fp.FromProductionError, match="zip bomb"):
        fp.build(bomb)


def test_a_member_over_its_cap_is_refused(monkeypatch, tmp_path):
    monkeypatch.setattr(fp, "DATA_MAX", 100)
    with pytest.raises(fp.FromProductionError, match="byte cap"):
        fp.build(make(tmp_path))


def test_finished_pictures_embedded_in_the_clan_are_preferred(tmp_path):
    p, _ = fp.build(make(tmp_path, embed=("master",)))
    assert f"{mb.FSET_NEW}#master" in p["items"] and p["bundle"]["assets_from"] == "clan+zip"


# ---------------------------------------------------------------- (2) the update key

def test_the_offer_hash_is_the_update_key_never_the_etag(tmp_path, prod):
    again, _ = fp.build(make(tmp_path), at="2026-11-19T10:00:00+00:00")
    assert again["offer_sha256"] == prod["offer_sha256"]   # nothing offered changed: silent
    assert "etag" not in json.dumps(again).lower()
    gone, _ = fp.build(make(tmp_path, omit="six"))
    assert gone["offer_sha256"] != prod["offer_sha256"]


# ---------------------------------------------------------------- (4) binding into the deck

def _deck():
    slides = {"s1": {"type": "title", "title": "Lumen Water"}, "s2": {"type": "idea", "title": "Every drop has a story."},
              "s3": {"type": "execution", "title": "Social stories"}, "s4": {"type": "execution", "title": "Outdoor"},
              "s5": {"type": "execution", "title": "TV film"}, "s6": {"type": "territory", "title": "Territory: The Tap Tells"},
              "s7": {"type": "execution", "title": "Radio"}}
    return {"meta": {"client": "Lumen Water"}, "order": list(slides), "slides": slides}


def _im(deck, sid, slot="picture"):
    return ((deck["slides"][sid].get("slots") or {}).get(slot) or {}).get("image")


def test_bind_production_slots(prod):
    d = _deck()
    got = images.bind_production(d, prod, "creative_cover")
    master = f"{mb.FSET_NEW}#master"
    assert _im(d, "s1")["from"] == {"kind": "production", "key": master, "run": prod["bundle"]["clan_sha256"][:12]} and _im(d, "s1")["aspect"] == "16:9"
    assert _im(d, "s2")["from"]["key"] == master and _im(d, "s2")["aspect"] == "4:3"
    assert _im(d, "s3")["from"]["key"] == mb.S_STORY and _im(d, "s3")["aspect"] == "9:16"     # phone: the 9:16 social size
    assert _im(d, "s4")["from"]["key"] == mb.S_SIX and _im(d, "s4")["aspect"] == "4:5"       # poster: OOH before a 4:5 of an unknown format
    assert _im(d, "s5")["from"]["key"] == mb.F1 and _im(d, "s5")["kind"] == "frame"          # film: one picked frame
    assert not d["slides"]["s6"].get("slots") and not d["slides"]["s7"].get("slots")         # territory never; audio has no slot
    assert got["placed"] == 5 and got["held"] == [] and len(d["order"]) == 7                   # no slide added
    assert _im(d, "s1")["focal"] == {"x": 0.7292, "y": 0.5} and "crop" not in json.dumps(d["slides"])
    src = d["assets"][_im(d, "s3")["asset"]]["source"]
    assert src == {"app": "ie.napkin.production-tool", "project_id": mb.PROJECT, "entity": mb.S_STORY, "role": "size", "version": 2,
                   "origin": "generated", "bundle_sha256": prod["bundle"]["clan_sha256"], "job_id": mb.JOB, "format_id": "meta-stories-9x16", "channel": "social"}
    assert d["meta"]["production"]["offer_sha256"] == prod["offer_sha256"] and d["meta"]["production"]["how"] == "bundle"


def test_creative_keeps_the_cover_and_none_binds_nothing(prod):
    d = _deck()
    images.bind_production(d, prod, "creative")
    assert _im(d, "s1") is None and _im(d, "s2") is not None
    d = _deck()
    assert images.bind_production(d, prod, "none")["placed"] == 0 and "assets" not in d


def test_a_persons_own_picture_is_kept_and_a_territory_frame_gives_way(prod):
    d = _deck()
    d["slides"]["s1"]["slots"] = {"picture": {"kind": "image", "image": {"kind": "illustration", "status": "made", "aspect": "16:9", "asset": "img_aaaaaaaaaaaa",
                                                                           "from": {"kind": "upload"}}}}
    d["slides"]["s2"]["slots"] = {"picture": {"kind": "image", "image": {"kind": "frame", "status": "made", "aspect": "4:3", "asset": "img_bbbbbbbbbbbb",
                                                                           "from": {"kind": "territory_frame", "key": "t1-f4-pro"}}}}
    got = images.bind_production(d, prod)
    assert _im(d, "s1")["from"]["kind"] == "upload" and got["kept"] == 1
    assert _im(d, "s2")["from"]["kind"] == "production"


def test_a_flagged_size_is_flagged_with_its_reason_and_a_stale_one_is_never_placed(prod):
    p = copy.deepcopy(prod)
    p["items"][mb.S_STORY]["status"] = "stale"
    d = _deck()
    got = images.bind_production(d, p)
    # the 4:5 feed size is the wrong shape for a 9:16 phone slot: the 9:16 size waiting for its rights is held instead
    assert _im(d, "s3")["status"] == "empty" and _im(d, "s3")["from"]["key"] == mb.S_OLD_STORY and {"s3"} <= {h["slide"] for h in got["held"]}
    p["items"][mb.S_STORY].update(status="look", reason="Flagged by review in Production: needs a look")
    d = _deck()
    images.bind_production(d, p)
    assert _im(d, "s3")["from"]["key"] == mb.S_STORY and _im(d, "s3")["status"] == "flagged"
    p["items"][mb.S_SIX]["status"] = "look"
    p["items"][mb.S_SIX]["reason"] = "Flagged by review in Production: needs a look"
    d = _deck()
    images.bind_production(d, p)
    assert _im(d, "s4")["status"] == "flagged" and "needs a look" in _im(d, "s4")["reason"]


def test_unknown_rights_are_held_as_rights_to_supply_and_never_placed(prod):
    d = _deck()
    got = images.bind_production(d, prod, brief_document_id=mb.BRIEF_DOC)   # Q9: the set linked to the deck's brief is the uploaded one
    im = _im(d, "s1")
    assert im["status"] == "empty" and "asset" not in im and im["reason"].startswith(spec.RIGHTS_TO_SUPPLY)
    assert {h["slide"] for h in got["held"]} == {"s1", "s2"} and not any(a["rights"] == "reference_only" for a in (d.get("assets") or {}).values())
    assert images.drawn(d, "review").keys().isdisjoint({("s1", "picture"), ("s2", "picture")})
    found = []
    validate._images(d["slides"]["s1"], "s1", d, "review", lambda *a: found.append(a))
    assert found and found[0][0] == "image_rights" and found[0][1] == "warn" and spec.RIGHTS_TO_SUPPLY in found[0][3]


def test_a_rights_pending_or_filled_slot_leaves_the_generation_plan(prod):
    d = _deck()
    images.bind_production(d, prod, brief_document_id=mb.BRIEF_DOC)
    images.add_empty_slots(d, "creative_cover")
    keys = {(c["sid"], c["slot"]) for c in imagegen.candidate_slots(d)}
    assert ("s1", "picture") not in keys and ("s2", "picture") not in keys and ("s3", "picture") not in keys


# ---------------------------------------------------------------- shapes: aspect tolerance and protect boxes

def _size(key, channel, w, h, set_id="fset_x", **kw):
    return {key: {"role": "size", "status": "ready", "rights": "generated", "channel": channel, "aspect": {"w": w, "h": h}, "set": set_id,
                  "entity": key, "sha256": hashlib.sha256(key.encode()).hexdigest(), "file": f"assets/{key}.png", "mime": "image/png",
                  "width": w * 100, "height": h * 100, "focal": {"x": 0.5, "y": 0.5}, "origin": "generated", **kw}}


def test_a_channel_size_of_the_wrong_shape_is_never_placed():
    prod = {"items": {**_size("ooh_banner", "ooh", 78, 10), **_size("skyscraper", "display", 2, 7)}}
    key, why = images.production_size(prod, "ooh", "4:5")
    assert key is None and "78:10" in why and "4:5" in why            # a 7.8:1 OOH banner never fills a 4:5 poster slot
    key, why = images.production_size(prod, "display", "16:9")
    assert key is None and "2:7" in why                                # nor a 2:7 skyscraper a 16:9 slot
    assert images.production_size(prod, "social", "9:16") == (None, None)   # nothing made for the channel: no reason to state
    prod["items"].update(_size("six_sheet", "ooh", 2, 3))
    assert images.production_size(prod, "ooh", "4:5") == ("six_sheet", None)   # 2:3 sits within the tolerance of 4:5


def test_a_size_whose_crop_would_cut_its_protect_box_is_never_placed():
    wide = {"x0": 0.05, "y0": 0.3, "x1": 0.95, "y1": 0.7}    # the centre is kept by any crop, the box is not
    prod = {"items": _size("square", "social", 1, 1, keep=wide)}
    assert not images.keeps_protected(prod["items"]["square"], "4:5")
    key, why = images.production_size(prod, "social", "4:5")
    assert key is None and "protected area" in why
    prod["items"]["square"]["keep"] = {"x0": 0.3, "y0": 0.1, "x1": 0.7, "y1": 0.9}
    assert images.production_size(prod, "social", "4:5") == ("square", None)
    off = {"x0": 0.0, "y0": 0.4, "x1": 0.12, "y1": 0.6}       # a box at the edge: a crop centred on it is pushed back inside, and keeps it
    assert images.keeps_protected({"keep": off, "width": 1920, "height": 1080, "focal": {"x": 0.06, "y": 0.5}}, "4:5")


def test_an_unfit_execution_slot_is_left_empty_with_its_reason(prod):
    p = copy.deepcopy(prod)
    for k in (mb.S_SIX, mb.S_CLIENT):
        p["items"][k]["aspect"] = {"w": 78, "h": 10}
    d = _deck()
    got = images.bind_production(d, p)
    im = _im(d, "s4")
    assert im["status"] == "empty" and "asset" not in im and im["from"]["kind"] == "production" and "No Production size fits" in im["reason"]
    assert any(h["slide"] == "s4" for h in got["held"])
    keys = {(c["sid"], c["slot"]) for c in imagegen.candidate_slots(d)}
    assert ("s4", "picture") not in keys                                   # held with its reason, never planned over silently


def test_a_key_visual_whose_box_a_crop_would_cut_leaves_that_slot_empty(prod):
    p = copy.deepcopy(prod)
    master = f"{mb.FSET_NEW}#master"
    p["items"][master]["keep"] = {"x0": 0.05, "y0": 0.3, "x1": 0.95, "y1": 0.7}
    p["items"][master]["focal"] = {"x": 0.5, "y": 0.5}
    d = _deck()
    images.bind_production(d, p)
    assert _im(d, "s1")["from"]["key"] == master and _im(d, "s1")["status"] == "made"     # 16:9 shows the whole 16:9 master
    assert _im(d, "s2")["status"] == "empty" and "protected area" in _im(d, "s2")["reason"]   # a 4:3 crop would cut the box


def test_with_no_linked_set_a_placeable_key_visual_wins_and_the_choice_is_said(prod):
    p = copy.deepcopy(prod)
    new, old = f"{mb.FSET_NEW}#master", f"{mb.FSET_OLD}#master"
    assert mb.FSET_NEW > mb.FSET_OLD
    p["items"][new]["rights"], p["items"][old]["rights"] = "reference_only", "generated"
    key, fset, why = images.choose_master(p, None)
    assert (key, fset) == (old, mb.FSET_OLD) and "can be placed" in why and "waits for its rights" in why
    assert images.choose_master(p, mb.BRIEF_DOC)[1] == mb.FSET_OLD and "linked" in images.choose_master(p, mb.BRIEF_DOC)[2]
    assert images.choose_master(prod, None)[:2] == (new, mb.FSET_NEW)
    got = images.bind_production(_deck(), p)
    assert got["master"]["set"] == mb.FSET_OLD and got["master"]["why"] == why


# ---------------------------------------------------------------- the pictures are written as they pass, under a total cap

def test_pictures_are_written_one_by_one_and_capped_in_total(monkeypatch, tmp_path, bundle):
    work = tmp_path / "work"
    work.mkdir()
    p, files = fp.build(bundle, work=work)
    assert files and all(Path(f).parent == work and Path(f).is_file() for f in files.values())
    assert fp.build(bundle)[1] == {}                                      # no work folder: checked, then nothing kept
    one = max(it["bytes"] for it in p["items"].values())
    monkeypatch.setattr(fp, "ASSETS_TOTAL_MAX", one)
    work2 = tmp_path / "work2"
    work2.mkdir()
    capped, files2 = fp.build(bundle, work=work2)
    assert 1 <= len(files2) < len(files) and any("MB cap" in r["reason"] for r in capped["refused"])
    assert sum(Path(f).stat().st_size for f in files2.values()) <= one


# ---------------------------------------------------------------- (5) label and client gate

def test_production_label_and_client_gate(prod):
    assert spec.PRODUCTION_LABEL == "Production" and images.clean_label(spec.PRODUCTION_LABEL) == "Production"
    d = _deck()
    images.bind_production(d, prod)
    assert images.picture_label(_im(d, "s1"), "Illustrative") == "Production"
    assert images.picture_label({"from": {"kind": "generated"}}, "Illustrative") == "Illustrative"
    assert ("s1", "picture") in images.drawn(d, "review") and images.drawn(d, "client") == {}
    aid = _im(d, "s1")["asset"]
    images.stamp_review(d, {"assets": {aid: {"asset": aid, "decision": "approve", "by": "human:demo", "at": "2026-11-18T10:00:00Z"}}}, "human:demo")
    assert ("s1", "picture") in images.drawn(d, "client")   # only the deck's approver's approval of this very asset


def test_the_schema_takes_a_deck_with_production_pictures(prod):
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((HERE.parent / "deck.schema.json").read_text())
    d = _deck()
    images.bind_production(d, prod, brief_document_id=None)
    sl = schema["definitions"]["image_slot"]
    for sid in d["order"]:
        for v in (d["slides"][sid].get("slots") or {}).values():
            jsonschema.validate(v["image"], {**sl, "definitions": schema["definitions"]})
    for a in d["assets"].values():
        jsonschema.validate(a, {**schema["definitions"]["asset"], "definitions": schema["definitions"]})
    jsonschema.validate(d["meta"]["production"], schema["properties"]["meta"]["properties"]["production"])


# ---------------------------------------------------------------- run_deck end to end (geometry only)

@pytest.fixture()
def prod_stages(tmp_path, demo_stages, bundle):
    st = tmp_path / "stages"
    shutil.copytree(demo_stages, st)
    assert fp.main([str(bundle), "--stages", str(st)]) == 0
    return st


def test_run_deck_production_places_pictures_spends_nothing_and_keeps_the_words(tmp_path, prod_stages, build_demo):
    # --no-layout-plan: the words as written (the plan's fit moves to the notes depend on the layout, which a picture can change)
    with_p = json.loads((build_demo(prod_stages, tmp_path / "a", "--pictures", "creative_cover", "--production", "--no-layout-plan") / "deck.json").read_text())
    without = json.loads((build_demo(prod_stages, tmp_path / "b", "--pictures", "creative_cover", "--no-layout-plan") / "deck.json").read_text())
    kinds = {(sid, n): (im.get("from") or {}).get("kind") for sid, n, im in images.image_slots(with_p)}
    assert "production" in kinds.values() and "production" not in {(im.get("from") or {}).get("kind") for _, _, im in images.image_slots(without)}
    assert len(with_p["order"]) == len(without["order"])                     # pulling never adds a slide
    assert imagegen.words_sha(with_p) == imagegen.words_sha(without)         # words never depend on pictures
    assert [with_p["slides"][s].get("title") for s in with_p["order"]] == [without["slides"][s].get("title") for s in without["order"]]
    rep = json.loads((tmp_path / "a" / "report.json").read_text())
    assert rep["production"]["usd"] == 0 and rep["production"]["placed"] >= 2 and rep.get("usd_total", 0) == 0
    assert rep["production"]["key_visual"]["set"] and rep["production"]["key_visual"]["why"]   # which set gave the key visual, and why
    assert "production" not in without["meta"]


def test_a_stray_production_json_changes_nothing_without_the_flag(tmp_path, demo_stages, prod_stages, build_demo):
    clean = json.loads((build_demo(demo_stages, tmp_path / "c", "--pictures", "creative_cover") / "deck.json").read_text())
    stray = json.loads((build_demo(prod_stages, tmp_path / "d", "--pictures", "creative_cover") / "deck.json").read_text())
    for k in ("order", "slides", "assets"):
        assert json.dumps(clean.get(k), sort_keys=True) == json.dumps(stray.get(k), sort_keys=True), k


def test_run_deck_refuses_production_with_no_production_json(tmp_path, demo_stages, build_demo):
    with pytest.raises(SystemExit, match="production.json is missing"):
        build_demo(demo_stages, tmp_path / "e", "--production")


def test_run_deck_refuses_production_on_an_investor_deck(tmp_path, demo_stages, build_demo):
    with pytest.raises(SystemExit, match="an investor deck has none of those slides"):
        build_demo(demo_stages, tmp_path / "inv", "--production", "--kind", "investor")


def test_the_review_pptx_labels_a_production_picture_production(tmp_path, prod_stages, build_demo):
    from pptx import Presentation
    run = build_demo(prod_stages, tmp_path / "f", "--production")
    caps = [sh.text_frame.text for s in Presentation(run / "deck.pptx").slides for sh in s.shapes if sh.name == "Caption" and sh.has_text_frame]
    assert "Production" in caps


# ---------------------------------------------------------------- (6) nothing is sent, nothing is spent

def test_importing_from_production_loads_no_provider_module():
    # -I keeps the child free of the caller's environment; the suite's own interpreter and import path (site-packages included, so yaml
    # and PIL load) are handed over explicitly, so the child imports exactly what the suite would.
    path = [str(HERE.parents[1])] + [p for p in sys.path if p and os.path.isdir(p)]
    code = (f"import sys; sys.path[:0] = {path!r}; import deck.from_production, deck.images; "
            "bad = [m for m in sys.modules if m.split('.')[0] in ('anthropic', 'openai', 'requests', 'httpx', 'urllib3') or m.endswith(('runway', 'guard', 'ollama')) "
            "or m.startswith('visuals') or m == 'deck.imagegen']; "
            "assert not bad, bad")
    r = subprocess.run([sys.executable, "-I", "-c", code], cwd=HERE.parents[1], capture_output=True, text=True, env={"PATH": "/usr/bin:/bin"})
    assert r.returncode == 0, r.stderr


def test_the_fixture_is_invented_and_built_in_code():
    assert not list((HERE / "fixtures" / "production_demo").glob("*.zip"))   # nothing binary is committed: the script builds it
    doc = mb.document({k: mb.draw(*v) for k, v in mb.PICTURES.items()})
    assert doc["contract_version"] == "3" and doc["project"]["title"].endswith("(invented)")
    assert set(fp.load_packs()) >= {"meta-stories-9x16", "uk-6-sheet", "meta-feed-image-4x5"}
