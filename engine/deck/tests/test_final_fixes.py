"""The final review fixes (deck-maker session, 2026-11-18): private LibreOffice profiles, a clean out folder per build, the checklist's slot gate,
the shorten ledger and marks guard, the small defaults, and the cover/sparse/execution design fixes."""
from __future__ import annotations

import concurrent.futures
import contextlib
import io
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from deck import run_deck

FX = Path(__file__).with_name("fixtures") / "lumen_water"
BASE = ["--stages", str(FX), "--brief", str(FX / "brief_object.json"), "--client", "Lumen Water", "--project", "National awareness campaign", "--no-qa"]
HAVE_SOFFICE = bool(shutil.which("soffice") or Path("/Applications/LibreOffice.app/Contents/MacOS/soffice").exists())


def _build(out: Path, *extra, spy=None):
    saved = (run_deck.subprocess.run, run_deck._soffice)
    run_deck.subprocess.run = spy or (lambda *a, **k: None)
    run_deck._soffice = lambda: "soffice"
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            run_deck.main([*BASE, "--out", str(out), *extra])
    finally:
        run_deck.subprocess.run, run_deck._soffice = saved
    return out


# ---------------------------------------------------------------- 1: a private LibreOffice profile per call

def test_the_build_converts_in_a_private_profile_and_removes_it(tmp_path):
    calls = []

    def spy(argv, *a, **k):
        if argv and argv[0] == "soffice":
            calls.append(list(argv))
        return None
    _build(tmp_path / "o", spy=spy)
    assert len(calls) == 1, "no retry loop: one conversion"
    prof = [x for x in calls[0] if x.startswith("-env:UserInstallation=file://")]
    assert prof, calls[0]
    assert not Path(prof[0].split("file://", 1)[1]).exists(), "the profile is cleaned up afterwards"


def test_each_conversion_gets_its_own_profile(tmp_path):
    seen = []
    saved = (run_deck.subprocess.run, run_deck._soffice)
    run_deck.subprocess.run = lambda argv, *a, **k: seen.append(argv[1])
    run_deck._soffice = lambda: "soffice"
    try:
        run_deck.to_pdf(tmp_path / "a.pptx", tmp_path)
        run_deck.to_pdf(tmp_path / "b.pptx", tmp_path)
    finally:
        run_deck.subprocess.run, run_deck._soffice = saved
    assert seen[0] != seen[1] and all(s.startswith("-env:UserInstallation=file://") for s in seen)


@pytest.mark.skipif(not HAVE_SOFFICE, reason="LibreOffice not installed")
def test_two_concurrent_conversions_both_make_a_pdf(tmp_path):
    from pptx import Presentation
    jobs = []
    for n in ("a", "b"):
        d = tmp_path / n
        d.mkdir()
        prs = Presentation()
        prs.slides.add_slide(prs.slide_layouts[5]).shapes.title.text = f"deck {n}"
        prs.save(d / "deck.pptx")
        jobs.append(d)
    with concurrent.futures.ThreadPoolExecutor(2) as ex:
        list(ex.map(lambda d: run_deck.to_pdf(d / "deck.pptx", d), jobs))
    assert all((d / "deck.pdf").stat().st_size > 500 for d in jobs)

# ---------------------------------------------------------------- 2: every build starts from a clean out folder

def test_a_client_build_leaves_no_stale_repair_output_from_an_earlier_review_build(tmp_path):
    import test_repair as TR
    out = tmp_path / "o"
    TR.build(out, TR.fake_qa({"s06": TR.layout_is("pair", "comparison")}))
    assert (out / "repair.json").exists() and (out / "repair").is_dir() and (out / "issues.json").exists() and (out / "qa.json").exists()
    TR.build(out, None, "--audience", "client", "--no-repair", "--no-qa")
    for name in ("repair", "repair.json", "issues.json", "qa.json"):
        assert not (out / name).exists(), f"stale {name} from the review build survived a client build"


def test_an_until_deck_build_also_wipes_them(tmp_path):
    import test_repair as TR
    out = tmp_path / "o"
    TR.build(out, TR.fake_qa({"s06": TR.layout_is("pair", "comparison")}))
    TR.build(out, None, "--until", "deck")
    for name in ("repair", "repair.json", "issues.json", "qa.json"):
        assert not (out / name).exists(), name


def test_the_repair_record_survives_the_wipe(tmp_path):
    import test_repair as TR
    out = tmp_path / "o"
    TR.build(out, TR.fake_qa({"s06": TR.layout_is("pair", "comparison")}))
    assert (out / "repair_record.json").exists()
    TR.build(out, TR.fake_qa({"s06": TR.layout_is("pair", "comparison")}))
    assert (out / "repair.json").exists()   # the replay still ran its round


def test_text_mode_and_pins_change_the_out_folder_but_not_the_stages_key():
    from deck import server
    base = {"prompt": {"text": "x"}, "kind": "agency", "format": "pitch"}
    assert server.out_key(base) == ""
    a = server.out_key({**base, "text_mode": "preserve"})
    b = server.out_key({**base, "text_mode": "condense"})
    c = server.out_key({**base, "review": {"pinned": {"s03": {}}}})
    assert len({"", a, b, c}) == 4
    assert server.inputs_key(base) == server.inputs_key({**base, "text_mode": "preserve"})   # the paid stages stay cached


# ---------------------------------------------------------------- 3: the slot checks are raised, so l_slots_clean can answer

def test_a_slot_missing_error_makes_l_slots_clean_no():
    import tempfile
    import test_checklist as TC
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        clean = TC.answer(TC.make(t / "c", deck_edit=TC.with_image()), "l_slots_clean")
        assert clean["answer"] == "yes", clean
        bad = TC.make(t / "b", deck_edit=TC.with_image(), validation=[{"check": "slot_missing", "slide": "s4", "level": "error", "message": "x"}])
        got = TC.answer(bad, "l_slots_clean")
        assert got["answer"] == "no", got


def test_no_raised_name_is_reserved():
    from deck import spec
    for name in ("slot_limit", "slot_missing", "slot_unknown", "slot_stale", "block_unbound", "layout_unknown"):
        assert name not in spec.RESERVED_CHECKS and name in spec.ISSUE_CHECKS


# ---------------------------------------------------------------- 4: shorten recordings by request hash, and a lifetime shorten ledger

def _shorten_ctx(tmp_path, led, call_fn, marks=()):
    import test_repair as TR
    return {**TR._ctx(call_fn, stages_dir=tmp_path / "st"), "shorten_ledger": led, "inp": __import__("types").SimpleNamespace(marks=list(marks))}


def test_shorten_recordings_are_named_by_request_hash_and_never_overwritten(tmp_path):
    import test_repair as TR
    from deck import repair
    (tmp_path / "st").mkdir()
    req2 = [{**TR.REQ[0], "slot": "other"}]
    fn = lambda r: ({"edits": [{"slide": "T", "slot": r[0]["slot"], "field": "1", "text": "x"}]}, {"usd": 0.01})
    ctx = _shorten_ctx(tmp_path, None, fn)
    repair.get_reply(ctx, 1, TR.REQ, [])
    repair.get_reply(ctx, 1, req2, [])   # the same round number, another request: the first recording must survive
    files = sorted(p.name for p in (tmp_path / "st").glob("e_repair_*.json"))
    assert files == sorted([f"e_repair_{repair.sha(TR.REQ)}.json", f"e_repair_{repair.sha(req2)}.json"]), files


def test_two_rebuilds_cannot_each_spend_the_deck_cap(tmp_path):
    import test_repair as TR
    from deck import repair
    from visuals import jobs
    (tmp_path / "st").mkdir()
    called = []
    fn = lambda r: called.append(r) or ({"edits": []}, {"usd": 0.5})
    led_path = tmp_path / "ledger.shorten.jsonl"
    req2 = [{**TR.REQ[0], "slot": "other"}]
    # two builds of the same deck: each starts with ctx["usd"] at 0 (a fresh process) but they share the deck's lifetime ledger
    e1, r1 = repair.get_reply(_shorten_ctx(tmp_path, jobs.Ledger(led_path, "deck-1"), fn), 1, TR.REQ, [])
    skipped = []
    e2, r2 = repair.get_reply(_shorten_ctx(tmp_path, jobs.Ledger(led_path, "deck-1"), fn), 1, req2, skipped)
    assert e1 == [] and r1["source"] == "live" and len(called) == 1
    assert e2 is None and "deck's cap" in skipped[0]["why"] and len(called) == 1, "the second rebuild must not spend another 0.60"
    assert repair.shorten_spent(jobs.Ledger(led_path, "deck-1")) == 0.5
    # another deck has its own budget
    assert repair.get_reply(_shorten_ctx(tmp_path, jobs.Ledger(led_path, "deck-2"), fn), 1, req2, [])[1]["source"] == "live"


def test_a_call_that_dies_before_it_settles_still_counts_at_its_upper_bound(tmp_path):
    import test_repair as TR
    from deck import repair
    from visuals import jobs
    (tmp_path / "st").mkdir()

    def die(r):
        raise TimeoutError("lost")
    led = jobs.Ledger(tmp_path / "l.jsonl", "d")
    repair.get_reply(_shorten_ctx(tmp_path, led, die), 1, TR.REQ, [])
    assert repair.shorten_spent(led) == repair.estimate(TR.REQ)["usd_upper"] > 0


# ---------------------------------------------------------------- 5: marked text never goes into a paid shorten request

def test_a_marked_phrase_never_appears_in_a_shorten_request(tmp_path, monkeypatch):
    import shutil
    import test_repair as TR
    stages_dir = tmp_path / "stages"
    shutil.copytree(TR.REPAIR_FX / "overlong", stages_dir)
    marks = tmp_path / "marks.json"
    marks.write_text(json.dumps([{"path": "brief.x", "text": "every household sees its own water story", "kind": "confidential"}]))
    (stages_dir / "e_repair_1.json").write_text("{}")   # makes the rung available; get_reply is replaced below
    seen = TR.capture_request(monkeypatch, lambda r: [])
    TR.build(tmp_path / "o", TR.fake_qa({TR.S: TR.too_long(TR.SLOT, TR.CAP, TR.BLOCK)}, "word_budget"), "--text-mode", "condense", "--marks", str(marks), stages_dir=stages_dir)
    assert not any("household sees its own water story" in json.dumps(r) for r in seen), "a marked phrase went into a shorten request"
    # control: with no marks the same deck does send that slot
    seen2 = TR.capture_request(monkeypatch, lambda r: [])
    TR.build(tmp_path / "o2", TR.fake_qa({TR.S: TR.too_long(TR.SLOT, TR.CAP, TR.BLOCK)}, "word_budget"), "--text-mode", "condense", stages_dir=stages_dir)
    assert any("household sees its own water story" in json.dumps(r) for r in seen2)


def test_with_no_mark_data_a_live_shorten_is_refused_and_nothing_is_sent(tmp_path):
    import test_repair as TR
    from deck import repair
    called = []
    ctx = {**TR._ctx(lambda r: called.append(r) or ({"edits": []}, {"usd": 0.01})), "inp": __import__("types").SimpleNamespace(marks=None)}
    skipped = []
    edits, row = repair.get_reply(ctx, 1, TR.REQ, skipped)
    assert edits is None and called == [] and "no mark data" in skipped[0]["why"]
    ctx["inp"] = __import__("types").SimpleNamespace(marks=[])   # an empty list is a real answer
    assert repair.get_reply(ctx, 1, TR.REQ, [])[0] == [] and len(called) == 1


# ---------------------------------------------------------------- minors

from test_images_gen import hermetic, stages as image_stages  # noqa: E402,F401  (fixtures: no network, a copy of the demo stages)


def test_no_layout_plan_resets_planned_slots_and_their_prompts(monkeypatch, image_stages, tmp_path):
    import test_images_gen as TG
    TG.with_subjects(monkeypatch, image_stages, tmp_path)
    d, text = TG.go(image_stages, tmp_path / "o", "--images", "plan", "--no-layout-plan")
    assert "card" in text
    left = [(sid, k, im.get("status")) for sid, s in d["slides"].items() for k, v in (s.get("slots") or {}).items()
            for im in [v.get("image") if isinstance(v, dict) else None] if im and (im.get("status") == "planned" or im.get("prompt") or im.get("subject"))]
    assert left == [], f"planned slots kept their prompt and subject in deck.json under --no-layout-plan: {left[:3]}"


def test_the_critic_deck_cap_cannot_be_raised_by_a_flag(tmp_path):
    from deck.bench import visual as V
    from deck.bench.__main__ import main as bench_main
    assert V.DECK_CAP_USD == 0.40
    with pytest.raises(SystemExit) as e:
        bench_main(["visual", "run", "--key", "k.json", "--images", str(tmp_path), "--max-usd", "5", "--max-deck-usd", "2.0", "--out", str(tmp_path / "o")])
    assert e.value.code == 2
    # and a caller that skips the CLI is clamped too
    card = V.plan_cost({"slides": {}}, tmp_path, V.PRIMARY["model"], 1, 5.0, max_deck_usd=9.0)
    assert "$0.40 a deck" in card["text"]


def test_the_territory_card_prices_from_the_one_shared_table_and_hides_no_bug(monkeypatch):
    """The Territory card's stand-in table (_FALLBACK) is gone; the card, the Deck and the run log read engine/prices.json."""
    from territory import cost
    import price_table as prices
    from deck import spec
    assert not hasattr(cost, "_FALLBACK")
    assert cost._price("claude-opus-5-5", 1_000_000, 1_000_000) == 24.0 == spec.estimate_usd("claude-opus-5-5", 1_000_000, 1_000_000)
    assert cost._price("claude-sonnet-5-5", 3000, 1200) == spec.estimate_usd("claude-sonnet-5-5", 3000, 1200)
    monkeypatch.setattr(prices, "usd", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("a real bug")))
    with pytest.raises(RuntimeError):   # never swallowed
        cost._price("claude-opus-5-5", 1, 1)


def test_the_docs_and_the_code_agree_on_the_defaults():
    deck_dir = Path(run_deck.__file__).parent
    src = (deck_dir / "run_deck.py").read_text()
    assert "absent means preserve" not in src and "also when absent" not in src
    assert "does not apply them yet" not in (deck_dir / "spec.py").read_text()
    contract = (deck_dir.parents[1] / "docs" / "contracts" / "deck-visuals.md").read_text()
    assert "behaves as it does today (no pictures" not in contract and "spec.DENSITY_DEFAULTS" in contract
    assert "0.65 to 1.25" not in (deck_dir / "server.py").read_text()
    from deck import spec
    assert spec.DENSITY_DEFAULTS == {"pitch": "lean", "full": "detailed"}


def test_a_pitch_with_no_density_flag_builds_lean_and_no_text_mode_means_no_loop_shorten(tmp_path):
    out = _build(tmp_path / "o")   # the default path: no --density, no --text-mode
    d = json.loads((out / "deck.json").read_text())
    assert d["meta"]["preferences"]["density"] == {"level": "lean", "source": "default"}
    assert "text_mode" not in d["meta"]["preferences"]
