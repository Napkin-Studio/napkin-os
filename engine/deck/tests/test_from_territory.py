"""deck-frames-in: deck.from_territory carries a Territory run and its frames into a stages folder. Offline; the run, the plan and the
twelve-odd pictures are the invented Lumen Water demo. Run from engine/: ``PYTHONPATH=. python3 -m pytest deck/tests/test_from_territory.py``."""
from __future__ import annotations

import copy
import json
import socket
import subprocess
import sys
from pathlib import Path

import pytest

from deck import from_territory as ft, images
from territory import cards
from territory.visuals import board
from visuals import runway

HERE = Path(__file__).resolve().parent
DEMO = HERE / "fixtures" / "frames_demo"
RUN = DEMO / "lumen_run.json"
MANIFEST = next((DEMO / "lumen_run.frames").glob("v1-*/manifest.json"))
VDIR = MANIFEST.parent
BRIEF = DEMO / "base" / "brief_object.json"


@pytest.fixture(autouse=True)
def no_socket(monkeypatch):
    """The tests install the socket guard themselves (they do not rely on BRIEF_TESTS_OFFLINE): any connection raises."""
    def refuse(*a, **k):
        raise AssertionError("from_territory opened a socket")
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)


def load():
    run, man = json.loads(RUN.read_text()), json.loads(MANIFEST.read_text())
    plan_path = RUN.with_name("lumen_run.frames-plan.json")
    return run, man, json.loads(plan_path.read_text()), ft.sha12(RUN), ft.sha12(plan_path)


def make(**kw):
    run, man, plan, rh, ph = load()
    return ft.from_run(kw.pop("run", run), kw.pop("manifest", man), kw.pop("plan", plan), kw.pop("run_hash", rh), kw.pop("plan_hash", ph), VDIR,
                       "lumen_run.json", "v1-5d1c3a90", **kw)


def run_cli(tmp_path, *extra, stages=None):
    st = stages or tmp_path / "st"
    code = ft.main([str(RUN), "--frames", str(MANIFEST), "--stages", str(st), *extra])
    return code, st


# ---------------------------------------------------------------- stage c

def test_stage_c_maps_the_runs_fields_to_the_decks_names():
    c, _ = make()
    t1 = c["territories"][0]
    assert (t1["id"], t1["name"], t1["thought"], t1["why"], t1["sketch"]) == ("t1", "The Tap Tells", "Let the tap speak for the household.",
                                                                       "People value water but never link it to their own tap.", "The Tap Tells")
    assert t1["proposition"] and t1["tension_text"] and t1["mechanism"] and t1["tier"] == "safe"
    assert all("mood" not in t and ("risks" in t) == (t["id"] == "t3") for t in c["territories"])


def test_the_assumption_dependent_territory_carries_the_fixed_label():
    c, _ = make()
    assert c["territories"][2]["risks"] == ft.ASSUMED_RISK == "Rests on an assumed brief: to confirm"


def test_the_ranking_reasons_are_the_tier_and_its_reason():
    c, _ = make()
    assert c["ranking"]["reasons"]["t2"].startswith("stretch: ") and "number it has never seen" in c["ranking"]["reasons"]["t2"]
    assert c["ranking"]["order"] == ["t1", "t2", "t3"] and "not a decision" in c["ranking"]["by"]


def test_chosen_is_set_only_by_chosen():
    c, _ = make()
    assert "chosen" not in c
    c, _ = make(chosen="t2")
    assert c["chosen"] == "t2"
    with pytest.raises(ft.FromTerritoryError, match="no such territory"):
        make(chosen="t9")


def test_the_field_mapping_matches_the_territory_modules_own_card():
    run = load()[0]
    c, _ = make()
    for t, row in zip(run["territories"], c["territories"]):
        card = cards.card(t, run)
        assert (row["name"], row["thought"], row["why"], row["sketch"]) == (card["name"], card["thought"], card["why"], card["sketch"])


# ---------------------------------------------------------------- frames.json

def test_pro_wins_over_flash_per_shot_and_a_refused_shot_has_no_file():
    _, f = make()
    fr = f["frames"]
    assert "t1-f1-pro" in fr and "t1-f1-flash" not in fr and "t1-f2-pro" in fr and "t1-f2-flash" not in fr
    assert fr["t3-f4-flash"]["status"] == "refused" and "file" not in fr["t3-f4-flash"] and "banned imagery" in fr["t3-f4-flash"]["reason"]
    assert fr["t1-f1-pro"]["tier"] == "best" and fr["t1-f1-pro"]["model"] == "gemini_image3_pro"


def test_a_clean_flash_frame_beats_a_flagged_pro_frame():
    run, man, plan, rh, ph = load()
    assert man["frames"]["t2-f2-pro"]["guard"]["flagged"] and not man["frames"]["t2-f2-flash"]["guard"]["flagged"]
    _, f = make()
    assert "t2-f2-flash" in f["frames"] and "t2-f2-pro" not in f["frames"] and f["frames"]["t2-f2-flash"]["status"] == "made"


def test_the_pick_is_the_territory_boards_own_pick_whatever_the_order():
    run, man, plan, rh, ph = load()
    own = board.frames_for(man, VDIR, RUN.parent, "v1", plan)
    mine = ft.pick_frames(man)
    for tid, frames in own.items():
        for fr in frames:
            assert mine[tid][fr["shot"]][0] == fr["key"], (tid, fr["shot"])
    rev = {**man, "frames": dict(reversed(list(man["frames"].items())))}
    assert {t: {s: k for s, (k, _) in v.items()} for t, v in ft.pick_frames(rev).items()} == {t: {s: k for s, (k, _) in v.items()} for t, v in mine.items()}


def test_flagged_frames_are_kept_with_their_reason_and_the_territorys_acceptance_is_only_recorded():
    _, f = make()
    e = f["frames"]["t2-f3-flash"]
    assert e["status"] == "flagged" and e["reason"] == "test: readable sign" and e["territory_accepted"] is True and "approved" not in json.dumps(e)
    assert f["frames"]["t1-f1-pro"]["territory_accepted"] is False


def test_the_record_holds_the_run_the_version_and_the_style_for_the_slot_stamp():
    _, f = make()
    assert f["stage"] == "frames" and f["version"] == "v1-5d1c3a90" and f["fixture"] is True
    assert f["run"] == {"file": "lumen_run.json", "sha256_12": ft.sha12(RUN), "same_brief": "unverified"}
    assert f["style"] == {"pack": "invented fixture style", "version": 1, "hash": "5d1c3a90"}
    e = f["frames"]["t1-f1-pro"]
    assert e["subject"] == "A kitchen tap at first light, water starts to run into a glass" and e["prompt_sha256"] and (e["width"], e["height"]) == (1344, 768)


def test_each_file_is_copied_once_by_sha256(tmp_path):
    code, st = run_cli(tmp_path)
    assert code == 0
    f = json.loads((st / "frames.json").read_text())
    files = sorted(p.name for p in (st / "assets").iterdir())
    assert files == sorted({v["file"].split("/")[1] for v in f["frames"].values() if v.get("file")}) and len(files) == 11
    assert all(v["file"] == f"assets/{v['sha256']}.png" for v in f["frames"].values() if v.get("file"))
    assert "source" not in json.dumps(f)   # the Territory file name is not kept in the stage file
    assert run_cli(tmp_path, "--replace", stages=st)[0] == 0 and sorted(p.name for p in (st / "assets").iterdir()) == files


# ---------------------------------------------------------------- refusals

def test_a_foreign_manifest_is_refused():
    run, man, plan, rh, ph = load()
    for bad in ({"run_sha256_12": "0" * 12}, {"plan_sha256_12": "0" * 12}):
        m = copy.deepcopy(man)
        m["inputs"].update(bad)
        with pytest.raises(ft.FromTerritoryError, match="another run|another run or plan"):
            make(manifest=m)
    p = copy.deepcopy(plan)
    p["run_sha256_12"] = "f" * 12
    with pytest.raises(ft.FromTerritoryError):
        make(plan=p)


def test_a_run_that_did_not_proceed_and_a_manifest_missing_keys_are_refused():
    run, man, *_ = load()
    with pytest.raises(ft.FromTerritoryError, match="not 'proceed'"):
        make(run={**run, "status": "stop"})
    with pytest.raises(ft.FromTerritoryError, match="not a Territory frames manifest"):
        make(manifest={"frames": man["frames"]})
    m = copy.deepcopy(man)
    del m["frames"]["t1-f1-pro"]["shot"]
    with pytest.raises(ft.FromTerritoryError, match="lacks"):
        make(manifest=m)


def test_a_changed_picture_file_is_refused(tmp_path):
    run, man, plan, rh, ph = load()
    m = copy.deepcopy(man)
    m["frames"]["t1-f1-pro"]["sha256"] = "0" * 64
    with pytest.raises(ft.FromTerritoryError, match="sha256 differs"):
        make(manifest=m)


def test_an_existing_stage_c_or_d_needs_replace(tmp_path):
    st = tmp_path / "st"
    st.mkdir()
    (st / "c_territories.json").write_text("{}")
    assert run_cli(tmp_path, stages=st)[0] == 2
    assert run_cli(tmp_path, "--replace", stages=st)[0] == 0
    st2 = tmp_path / "st2"
    st2.mkdir()
    (st2 / "d_idea.json").write_text("{}")
    assert run_cli(tmp_path, stages=st2)[0] == 2   # the idea was written from other territories
    assert not (st2 / "c_territories.json").exists()


def test_a_brief_whose_given_fields_differ_is_refused_and_a_matching_one_is_verified(tmp_path):
    code, st = run_cli(tmp_path, "--brief", str(BRIEF))
    assert code == 0 and json.loads((st / "frames.json").read_text())["run"]["same_brief"] == "verified"
    other = json.loads(BRIEF.read_text())
    other["loop2_golden"]["fields"]["background"]["value"] = "A different client entirely."
    p = tmp_path / "other.json"
    p.write_text(json.dumps(other))
    code, st2 = run_cli(tmp_path, "--brief", str(p), stages=tmp_path / "st2")
    assert code == 2 and not (st2 / "frames.json").exists()


def test_the_style_pack_that_cannot_be_read_sets_the_hold_and_the_build_goes_on(tmp_path):
    bad = tmp_path / "pack"
    bad.mkdir()
    (bad / "style.yaml").write_text("finish: not-a-finish\nlook: [1, 2]\n")
    code, st = run_cli(tmp_path, "--style-pack", str(bad))
    assert code == 0
    f = json.loads((st / "frames.json").read_text())
    assert "could not be read" in f["style_hold"]["reason"] and f["style"]["hash"] == "5d1c3a90"   # never restamped
    good = tmp_path / "pack2"
    good.mkdir()
    (good / "style.yaml").write_text("look: [soft light]\nfinish: rough\n")
    assert "style_hold" not in json.loads((run_cli(tmp_path, "--style-pack", str(good), stages=tmp_path / "s2")[1] / "frames.json").read_text())


# ---------------------------------------------------------------- the Territory format (a contract test)

def test_an_entry_built_with_the_territory_modules_own_job_key_and_entry_is_readable():
    """When runway.job_key or runway._entry changes shape, this fails and from_territory is revisited (the file contract)."""
    job = {"tid": "t9", "shot": "f2", "kind": "best", "prompt": "A quiet street"}
    key, entry = runway.job_key("t9", "f2", "best"), runway._entry(job)
    assert key == "t9-f2-pro" and set(ft.ENTRY_KEYS) <= set(entry) and {"prompt", "prompt_sha256"} <= set(entry)
    entry.update(status="SUCCEEDED", file=f"{key}.png", sha256="x", guard={"checked": True, "flagged": False, "found": {}, "reason": "clean"})
    man = {"frames": {key: entry}}
    assert ft.pick_frames(man)["t9"]["f2"][0] == key
    quick = runway._entry({**job, "kind": "quick"})
    assert quick["tier"] == "quick" and runway.job_key("t9", "f2", "quick") == "t9-f2-flash"


# ---------------------------------------------------------------- nothing is sent, nothing is spent

def test_importing_from_territory_and_images_loads_no_provider_module():
    code = (f"import sys; sys.path.insert(0, {str(HERE.parents[1])!r}); import deck.from_territory, deck.images; "
            "bad = [m for m in sys.modules if m.split('.')[0] in ('anthropic', 'openai') or m.endswith(('runway', 'guard', 'ollama')) "
            "or m.startswith('territory.visuals.runway') or m.startswith('territory.visuals.guard')]; "
            "assert not bad, bad")
    r = subprocess.run([sys.executable, "-I", "-c", code], cwd=HERE.parents[1], capture_output=True, text=True,
                       env={"PATH": "/usr/bin:/bin"})
    assert r.returncode == 0, r.stderr


def test_building_and_rendering_a_deck_opens_no_socket(tmp_path, demo_stages, build_demo):
    build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover", "--hyperframes")   # the autouse guard raises on any connection
    assert (tmp_path / "o" / "deck.pptx").exists()


# ---------------------------------------------------------------- the invented demo set itself

def test_the_demo_pngs_are_the_scripts_drawing_compared_by_pixels_not_bytes():
    """Pillow versions may encode the same pixels to different bytes, so the committed files are compared with a fresh drawing by pixels."""
    from PIL import Image, ImageChops
    sys.path.insert(0, str(DEMO))
    try:
        import make_frames as mk
    finally:
        sys.path.remove(str(DEMO))
    n = 0
    for tid, shot, tier in mk.FRAMES:
        with Image.open(VDIR / f"{tid}-{shot}-{tier}.png") as got:
            assert got.size == (mk.W, mk.H)
            assert ImageChops.difference(got.convert("RGB"), mk.draw_frame(tid, shot, tier)).getbbox() is None, (tid, shot, tier)
        n += 1
    for name, (w, h, hue) in {"cover.png": (1600, 900, 0), "small.png": (320, 180, 1)}.items():
        with Image.open(DEMO / name) as got:
            assert got.size == (w, h) and ImageChops.difference(got.convert("RGB"), mk.draw_supplied(w, h, hue)).getbbox() is None
    assert n == 14


def test_the_demo_set_is_marked_invented_small_and_consistent():
    man = json.loads(MANIFEST.read_text())
    assert man["fixture"] is True
    assert man["inputs"]["run_sha256_12"] == ft.sha12(RUN) and man["inputs"]["plan_sha256_12"] == ft.sha12(RUN.with_name("lumen_run.frames-plan.json"))
    assert json.loads(RUN.with_name("lumen_run.frames-plan.json").read_text())["run_sha256_12"] == ft.sha12(RUN)
    assert sum(p.stat().st_size for p in DEMO.rglob("*") if p.is_file() and "__pycache__" not in p.parts) < 400_000
    assert not [p for p in DEMO.rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.suffix not in (".png", ".json", ".py")]
    text = " ".join(p.read_text() for p in DEMO.rglob("*.json"))
    assert "territory-frames" not in text and "napkin-studio-os" not in text   # nothing from the real runs
