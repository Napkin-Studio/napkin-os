"""territories-pictures-rights: picture identity by hash, rights words, the Final marker, carrying pictures in, the provider policy.
Run from engine/: ``PYTHONPATH=. python -m pytest -q territory/tests/test_pictures.py`` (needs jsonschema). Pictures here are tiny made-up PNGs."""
from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import re
import zipfile
from pathlib import Path

import pytest

pytest.importorskip("jsonschema")

from territory import contract, gates, pictures as pic  # noqa: E402

FINDINGS = contract.example("findings")
AT = "2026-11-23T10:00:00Z"
PNG = bytes.fromhex("89504e470d0a1a0a") + b"made-up picture "


def img(n: int) -> bytes:
    return PNG + str(n).encode()


def sha(n: int) -> str:
    return hashlib.sha256(img(n)).hexdigest()


def doc():
    return copy.deepcopy(contract.example("data"))


def route(d, tid="t_started"):
    return next(t for t in d["territories"] if t["id"] == tid)


def carried(n, rights="generated", touchpoint=None, **kw):
    return {"sha256": sha(n), "rights": rights, "touchpoint": touchpoint, **kw}


# ---------------------------------------------------------------- identity


def test_hash_identity_and_link_forms():
    assert pic.hash_of(img(1)) == sha(1)
    assert pic.link(sha(1)) == "sha256:" + sha(1) and pic.bare("sha256:" + sha(1).upper()) == sha(1)
    for bad in ("", "abc", "sha256:xyz", "g" * 64):
        with pytest.raises(pic.PictureError):
            pic.bare(bad)


def test_a_slot_is_picked_by_id_or_hash_never_by_position():
    d = doc()
    t = route(d)
    s = pic.attach(t, t["pictures"][2]["id"], carried(1))
    assert pic.find(t, s["id"]) is s and pic.find(t, sha(1)) is s and pic.find(t, "sha256:" + sha(1)) is s
    for ref in ("0", "2", "nope", sha(2)):
        with pytest.raises(pic.PictureError):
            pic.find(t, ref)
    with pytest.raises(pic.PictureError):
        pic.attach(t, sha(1), carried(2))   # a hash is not a slot name for attaching


def test_a_carried_picture_is_a_frame_by_link_with_rights_and_validates():
    d = doc()
    t = route(d)
    s = pic.attach(t, t["pictures"][0]["id"], carried(1, "licensed", source="Production: Hollow Oak"))
    assert (s["kind"], s["image"], s["sha256"], s["rights"], s["source"]) == ("frame", "sha256:" + sha(1), sha(1), "licensed", "Production: Hollow Oak")
    assert contract.problems(d) == [] and contract.check(d, facts=contract.example("facts"), findings=FINDINGS) == []


def test_one_picture_one_slot_and_never_two_routes():
    d = doc()
    t = route(d)
    pic.attach(t, t["pictures"][0]["id"], carried(1))
    with pytest.raises(pic.PictureError):
        pic.attach(t, t["pictures"][1]["id"], carried(1))
    pic.attach(route(d, "t_sunday"), route(d, "t_sunday")["pictures"][0]["id"], carried(1))
    assert any(p.rule == "dup_picture" for p in contract.check(d))


def test_one_image_reused_in_three_slots_fills_one_and_the_rest_are_honest_gaps():
    d = doc()
    t = route(d)
    got = pic.fill(t, [carried(1)] * 3)
    assert got == {"placed": 1, "gaps": 2}
    kinds = [s["kind"] for s in t["pictures"]]
    assert kinds.count("frame") == 1 and kinds.count("gap") == 2
    assert all(s.get("gap_reason") for s in t["pictures"] if s["kind"] == "gap")
    assert contract.problems(d) == [] and not any(p.rule == "dup_picture" for p in contract.check(d))


def test_fill_prefers_the_same_touchpoint_and_leaves_unmatched_sketches():
    d = doc()
    t = route(d)
    got = pic.fill(t, [carried(1, touchpoint="poster"), carried(2, touchpoint="email")])
    assert got == {"placed": 2, "gaps": 0}
    by = {s["touchpoint"]: s for s in t["pictures"] if s["kind"] == "frame"}
    assert by["poster"]["sha256"] == sha(1) and by["email"]["sha256"] == sha(2)
    assert sum(s["kind"] == "sketch" for s in t["pictures"]) == len(t["pictures"]) - 2


# ---------------------------------------------------------------- rights


@pytest.mark.parametrize("stated,word", [("generated", "Generated"), ("own", "Own"), ("licensed", "Licensed"), ("unknown", "Rights to supply"),
                                          (None, "Rights to supply"), ("", "Rights to supply"), ("mock", "Rights to supply"),
                                          ("client_supplied", "Rights to supply"), ("reference_only", "Rights to supply")])
def test_only_stated_rights_are_trusted_everything_else_reads_rights_to_supply(stated, word):
    assert pic.rights_word(stated) == word
    assert (pic.rights_of(stated) in pic.TRUSTED) == (word != "Rights to supply")


def test_rights_enum_comes_from_the_schema_and_the_menu_matches_it():
    assert set(contract.enum("rights")) == {"generated", "own", "licensed", "unknown"}
    assert [c["rights"] for c in pic.RIGHTS_CHOICES] == ["generated", "own", "licensed", "unknown"]
    assert set(pic.RIGHTS_WORD) == set(contract.enum("rights"))


def test_a_frame_without_rights_or_a_gap_without_a_reason_fails_the_schema():
    d = doc()
    s = route(d)["pictures"][0]
    s.update(kind="frame", image="sha256:" + sha(1), sha256=sha(1))
    assert any(p.rule == "required" for p in contract.problems(d))
    s.update(kind="gap")
    s.pop("image"), s.pop("sha256")
    assert any(p.rule == "required" for p in contract.problems(d))


def test_chips_carry_hash_label_and_rights_and_a_gap_shows_none():
    d = doc()
    t = route(d)
    ids = [s["id"] for s in t["pictures"]]
    pic.attach(t, ids[0], carried(1, None))
    pic.attach(t, ids[1], carried(2, "own"))
    t["pictures"][2].update(kind="gap", gap_reason="The client has not sent one.")
    v = {c["id"]: c for c in pic.view(t)}
    assert v[ids[0]]["rights_word"] == "Rights to supply" and v[ids[0]]["trusted"] is False and v[ids[0]]["hash"] == sha(1)[:8]
    assert v[ids[1]]["rights_word"] == "Own" and v[ids[1]]["trusted"] is True and v[ids[1]]["label"] == "Illustrative"
    assert v[ids[2]]["kind"] == "gap" and v[ids[2]]["gap_reason"] and v[ids[2]]["label"] is None
    assert v[ids[3]]["kind"] == "sketch" and v[ids[3]]["label"] == "Mock-up" and v[ids[3]]["rights_word"] is None
    assert all(c["label"] in ("Illustrative", "Mock-up") for c in v.values() if c["kind"] != "gap")


# ---------------------------------------------------------------- Final


def test_final_is_one_per_place_and_only_a_picture():
    d = doc()
    t = route(d)
    ids = [s["id"] for s in t["pictures"]]
    with pytest.raises(pic.PictureError):
        pic.set_final(t, ids[0])           # a sketch is never Final
    tv = [s for s in t["pictures"] if s["touchpoint"] == "tv"]
    assert len(tv) >= 2
    a = pic.attach(t, tv[0]["id"], carried(1))
    b = pic.attach(t, tv[1]["id"], carried(2))
    b["touchpoint"] = "tv"
    pic.set_final(t, a["id"])
    pic.set_final(t, sha(2))               # marking the other replaces it: two pictures of one place show which is Final
    assert [s["id"] for s in pic.finals(t)] == [b["id"]]
    assert [c["final"] for c in pic.view(t) if c["id"] in (a["id"], b["id"])] == [False, True]
    pic.set_final(t, b["id"], False)
    assert pic.finals(t) == []


def test_the_contract_refuses_two_finals_of_one_place_and_a_final_sketch():
    d = doc()
    t = route(d)
    tv = [s for s in t["pictures"] if s["touchpoint"] == "tv"]
    pic.attach(t, tv[0]["id"], carried(1)), pic.attach(t, tv[1]["id"], carried(2))
    tv[0]["final"] = tv[1]["final"] = True
    assert any(p.rule == "final" for p in contract.check(d))
    tv[1].pop("final")
    t["pictures"][-1]["final"] = True
    assert any(p.rule == "final" for p in contract.check(d))


def test_a_final_with_no_stated_rights_holds_the_greenlight_until_a_choice_is_made():
    d = doc()
    tid = d["greenlit"][0]["territory_id"]
    t = route(d, tid)
    s = pic.attach(t, t["pictures"][0]["id"], carried(1, None))
    pic.set_final(t, s["id"])
    b = pic.blockers(d)
    assert len(b) == 1 and b[0]["kind"] == "picture_rights" and b[0]["ids"] == [tid]
    assert re.search(r"Final picture with no rights chosen", b[0]["text"]) and not re.search(r"picture_rights|sha256|None", b[0]["text"])
    assert any(x["kind"] == "picture_rights" for x in gates.blockers(d, "greenlight", findings=FINDINGS))
    pic.set_rights(t, s["id"], "licensed")
    assert pic.blockers(d) == []
    assert not any(x["kind"] == "picture_rights" for x in gates.blockers(d, "greenlight", findings=FINDINGS))
    assert contract.problems(d) == []
    # a route nobody greenlit never holds the gate
    other = route(d, "t_small")
    o = pic.attach(other, other["pictures"][0]["id"], carried(9, None))
    pic.set_final(other, o["id"])
    assert pic.blockers(d) == []


def test_set_rights_refuses_a_slot_with_no_picture_and_a_made_up_word():
    d = doc()
    t = route(d)
    with pytest.raises(pic.PictureError):
        pic.set_rights(t, t["pictures"][0]["id"], "own")
    s = pic.attach(t, t["pictures"][0]["id"], carried(1))
    for word in ("mock", "client_supplied", "supplied", ""):
        with pytest.raises(pic.PictureError):
            pic.set_rights(t, s["id"], word)


# ---------------------------------------------------------------- carrying in: every picture, on this document's own store


def bundle(n=23, with_video=True, mock=0, drop=(), tamper=()):
    """A Production export in miniature: ``assets/<hex>.png`` files and the document's ``assets`` map."""
    buf, meta = io.BytesIO(), {}
    with zipfile.ZipFile(buf, "w") as z:
        for i in range(n):
            h = sha(i)
            meta["sha256:" + h] = {"kind": "image", "mime": "image/png", "sha256": "sha256:" + h,
                                   "origin": "mock" if i < mock else ("generated" if i % 3 == 0 else "uploaded" if i % 3 == 1 else "edited"),
                                   **({"rights": "generated"} if i % 3 == 0 else {"rights": "unknown"} if i % 3 == 1 else {})}
            if i not in drop:
                z.writestr(f"assets/{h}.png", img(i) + (b"x" if i in tamper else b""))
        if with_video:
            v = b"video bytes"
            z.writestr(f"assets/{hashlib.sha256(v).hexdigest()}.mp4", v)
            meta["sha256:" + hashlib.sha256(v).hexdigest()] = {"kind": "video", "mime": "video/mp4"}
    buf.seek(0)
    return zipfile.ZipFile(buf), meta


def test_all_23_of_23_pictures_arrive_on_the_own_store_and_the_video_is_not_touched():
    z, meta = bundle(23)
    store = pic.MemoryStore()
    rep = pic.rehome(meta, pic.zip_reader(z), store, source="Production: Hollow Oak")
    assert rep["ok"] and (rep["arrived"], rep["wanted"], rep["missing"]) == (23, 23, 0)
    assert set(store.blobs) == {sha(i) for i in range(23)}
    assert pic.require_all(rep) is rep
    again = pic.rehome(meta, pic.zip_reader(z), store)   # stored once: a second carry adds nothing
    assert again["ok"] and all(r["status"] == "already" for r in again["pictures"]) and len(store.blobs) == 23


def test_missing_and_tampered_pictures_are_named_and_refuse_a_partial_arrival():
    z, meta = bundle(23, drop=(3, 4, 5), tamper=(7,))
    rep = pic.rehome(meta, pic.zip_reader(z), pic.MemoryStore())
    assert not rep["ok"] and (rep["arrived"], rep["missing"], rep["wanted"]) == (19, 4, 23)
    assert {r["status"] for r in rep["pictures"] if r.get("why")} == {"missing", "mismatch"}
    with pytest.raises(pic.PictureError, match=r"19 of 23 pictures arrived"):
        pic.require_all(rep)


def test_a_mock_is_never_used_and_never_counted_as_arrived():
    z, meta = bundle(10, mock=2)
    store = pic.MemoryStore()
    rep = pic.rehome(meta, pic.zip_reader(z), store)
    assert rep["ok"] and rep["skipped"] == 2 and rep["arrived"] == 8 and rep["wanted"] == 8 and sha(0) not in store.blobs
    skipped = next(r for r in rep["pictures"] if r["status"] == "skipped")
    with pytest.raises(pic.PictureError):
        pic.attach(route(doc()), route(doc())["pictures"][0]["id"], skipped)


def test_rights_travel_as_stated_and_nothing_else_is_inferred_from_origin():
    z, meta = bundle(6)
    rep = pic.rehome(meta, pic.zip_reader(z), pic.MemoryStore())
    got = {r["sha256"]: r["rights"] for r in rep["pictures"]}
    assert got[sha(0)] == "generated" and got[sha(1)] == "unknown" and got[sha(2)] == "unknown"   # an edit states nothing


def test_dirstore_uses_the_workspace_layout_verifies_and_never_overwrites(tmp_path):
    s = pic.DirStore(tmp_path)
    s.put(sha(1), img(1))
    p = tmp_path / "blobs" / sha(1)[:2] / sha(1)
    assert p.read_bytes() == img(1) and s.has(sha(1))
    with pytest.raises(pic.PictureError):
        s.put(sha(2), img(1))
    p.write_bytes(b"kept")
    s.put(sha(1), img(1))
    assert p.read_bytes() == b"kept"


# ---------------------------------------------------------------- the provider


def test_client_material_is_never_sent_to_a_picture_provider_by_default():
    assert pic.provider_allowed(True, {}) is False
    assert pic.provider_allowed(True, {"VISUALS_CLIENT_TO_RUNWAY": ""}) is False
    assert pic.provider_allowed(True, {"VISUALS_CLIENT_TO_RUNWAY": "yes"}) is False
    assert pic.provider_allowed(True, {"VISUALS_CLIENT_TO_RUNWAY": "allow"}) is True      # the tester's override, lint still runs
    assert pic.provider_allowed(False, {}) is True                                        # material a person marked invented or demo
