"""deck-handoffs: the Production importer reads contract 3's finals and assets[].rights (develop #257), records per-asset sizes and the relay's
widths, says what a client may see, and still reads a contract 2 document. Offline; the export is the invented Lumen Water bundle that
fixtures/production_demo/make_bundle.py draws in code, changed per test. Run from engine/: ``PYTHONPATH=. python3 -m pytest deck/tests/test_production_v3.py``."""
from __future__ import annotations

import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

import pytest

from deck import from_production as fp

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "fixtures" / "production_demo"))
import make_bundle as mb   # noqa: E402

sys.path.remove(str(HERE / "fixtures" / "production_demo"))

SHA = {k: "sha256:" + hashlib.sha256(mb.draw(*v)).hexdigest() for k, v in mb.PICTURES.items()}
FINAL_SIZE, FINAL_FRAME, FINAL_PIC, FINAL_MASTER = (mb.uid("final", n) for n in range(1, 5))


def make(tmp_path, mutate=None):
    p = tmp_path / "bundle.zip"
    mb.build(p, mutate=mutate)
    return p


def finals(d):
    d["finals"] = {
        FINAL_SIZE: {"id": FINAL_SIZE, "v": 1, "field_v": {}, "of": {"kind": "size", "id": mb.S_MAKING}, "asset": SHA["making"], "set_id": mb.FSET_NEW,
                     "format": {"pack_id": "social", "pack_version": "2026-10-13", "format_id": "meta-feed-image-1x1"}, "channel": "social",
                     "at": "2026-11-19T10:00:00Z", "by": "human:p_demo"},
        FINAL_FRAME: {"id": FINAL_FRAME, "v": 1, "field_v": {}, "of": {"kind": "frame", "id": mb.F1_OLD}, "asset": SHA["f1_old"], "version": 1,
                      "at": "2026-11-19T10:01:00Z", "by": "human:p_demo"},
        FINAL_PIC: {"id": FINAL_PIC, "v": 1, "field_v": {}, "of": {"kind": "picture", "id": "pic_loose_0001"}, "asset": SHA["orphan"], "version": 1,
                    "at": "2026-11-19T10:02:00Z", "by": "human:p_demo"},
        FINAL_MASTER: {"id": FINAL_MASTER, "v": 1, "field_v": {}, "of": {"kind": "picture", "id": "pic_kv_0001"}, "asset": SHA["master"], "version": 1,
                       "at": "2026-11-19T10:03:00Z", "by": "human:p_demo"}}


def test_finals_offer_the_exact_picture_marked_and_say_who_and_when(tmp_path):
    p, _ = fp.build(make(tmp_path, finals))
    it = p["items"]
    size = it[mb.S_MAKING]   # 'making' in Production, but a person marked it final: it stands
    assert size["sha256"] == SHA["making"].removeprefix("sha256:") and size["status"] == "ready"
    assert size["final"] == {"id": FINAL_SIZE, "at": "2026-11-19T10:00:00Z", "by": "human:p_demo"}
    frame = next(v for v in it.values() if v["role"] == "frame" and v.get("shot") == mb.SH1)   # the final frame, ahead of the shot's pick
    assert frame["entity"] == mb.F1_OLD and frame["final"]["id"] == FINAL_FRAME
    assert it[f"{mb.FSET_NEW}#master"]["final"]["id"] == FINAL_MASTER
    rows = {r["id"]: r for r in p["finals"]}
    assert rows[FINAL_SIZE]["item"] == mb.S_MAKING and rows[FINAL_FRAME]["item"] == mb.F1_OLD
    loose = rows[FINAL_PIC]
    assert loose["item"] is None and "no slot takes it yet" in loose["why_not_placed"] and loose["rights"] == "reference_only"


def test_client_showable_comes_from_rights_alone_and_sizes_are_recorded(tmp_path):
    def stated(d):
        d["assets"][SHA["upload_master"]]["rights"] = "licensed"   # a person said so in Production
        d["assets"][SHA["story"]]["rights"] = "unknown"            # a person has not said: lowered, never raised
    p, _ = fp.build(make(tmp_path, stated))
    it = p["items"]
    assert it[f"{mb.FSET_OLD}#master"]["rights"] == "licensed" and it[f"{mb.FSET_OLD}#master"]["client_showable"] is True
    assert "to_supply" not in it[f"{mb.FSET_OLD}#master"]
    assert it[mb.S_STORY]["rights"] == "reference_only" and it[mb.S_STORY]["client_showable"] is False and it[mb.S_STORY]["to_supply"] == "rights"
    assert it[f"{mb.FSET_NEW}#master"]["asset_size"] == {"w": 1920, "h": 1080}
    assert p["relay"] == {"route": "GET /assets/{sha256}", "widths": [480, 1200, 2400]}
    blob = json.dumps(p)
    assert not any(c in blob for c in mb.CANARIES), "no location, thumb, copy line or brief spine reaches production.json"


def test_a_document_without_finals_or_rights_reads_as_before(tmp_path):
    p, _ = fp.build(make(tmp_path))
    assert "finals" not in p and all("final" not in v for v in p["items"].values())
    assert p["items"][f"{mb.FSET_OLD}#master"]["rights"] == "reference_only"   # an upload with nothing stated
    assert p["items"][f"{mb.FSET_NEW}#master"]["client_showable"] is True


def _v2_bundle(tmp_path) -> tuple[Path, dict]:
    pics = {k: mb.draw(*mb.PICTURES[k]) for k in ("f1", "f2", "f4", "upload_master")}
    sha = {k: "sha256:" + hashlib.sha256(v).hexdigest() for k, v in pics.items()}

    def asset(k, origin):
        w, h, _ = mb.PICTURES[k]
        return {"sha256": sha[k], "kind": "image", "mime": "image/png", "w": w, "h": h, "origin": origin, "locations": [f"idb://sha256/{sha[k][7:]}"]}
    doc = {"contract_version": "2", "app": "production-tool", "participant": {"id": "p_demo", "handle": "demo"}, "stage": {"current": "storyboard"},
           "assets": [asset("f1", "generated"), asset("f2", "generated"), asset("f4", "mock"), asset("upload_master", "uploaded")],
           "keys": [], "refs": [], "shots": [{"id": "sh_a"}, {"id": "sh_b"}, {"id": "sh_c"}],
           "frames": [{"id": "fr_a1", "shot_id": "sh_a", "asset": sha["f1"], "job_id": "j1", "selected": True, "kind": "generated"},
                      {"id": "fr_b1", "shot_id": "sh_b", "asset": sha["f2"], "job_id": "j2", "selected": True, "kind": "generated"},
                      {"id": "fr_c1", "shot_id": "sh_c", "asset": sha["f4"], "job_id": "j3", "selected": True, "kind": "mock"}],
           "takes": [], "jobs": [], "reviews": [], "stale": [], "exports": []}
    cbuf = io.BytesIO()
    with zipfile.ZipFile(cbuf, "w") as c:
        c.writestr("manifest.yaml", "format: clan\napp_id: ie.napkin.production-tool\n")
        c.writestr("shared/data.yaml", json.dumps(doc))
    out = tmp_path / "v2.zip"
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("project.clan", cbuf.getvalue())
        for k, b in pics.items():
            z.writestr(f"assets/{sha[k][7:]}.png", b)
    return out, sha


def test_contract_2_is_still_read_its_selected_frames_offered_and_mock_refused(tmp_path):
    bundle, sha = _v2_bundle(tmp_path)
    p, _ = fp.build(bundle)
    assert p["source_contract"] == "2" and p["contract_version"] == "3"   # the deck's binding reads contract 3's record
    frames = {k: v for k, v in p["items"].items() if v["role"] == "frame"}
    assert set(frames) == {"fr_a1", "fr_b1"} and all(v["rights"] == "generated" and v["client_showable"] for v in frames.values())
    assert any("mock" in r["reason"] for r in p["refused"])
    assert fp.read_document(zipfile.ZipFile(io.BytesIO(zipfile.ZipFile(bundle).read("project.clan"))))["project"]["id"].startswith("proj_")


def test_a_contract_2_label_on_contract_3_shape_and_contract_4_are_refused(tmp_path):
    for cv in ("2", "4"):
        with pytest.raises(fp.FromProductionError, match=f"contract '{cv}'"):
            fp.build(make(tmp_path, lambda d, cv=cv: d.update(contract_version=cv)))
