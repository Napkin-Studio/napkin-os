"""The vision critic bench, phase 1 (feature deck-vision-critic): rubric, grading page, run under a cap, agreement and trust.

No test here makes a live call or needs LibreOffice: a stub renderer writes tiny pictures, and a fake transport with
fixed usage makes counted calls. Run: ``BRIEF_TESTS_OFFLINE=1 python3 -m pytest -q deck/tests/test_bench_visual.py``.
"""
from __future__ import annotations

import copy
import json
import shutil
import zipfile
from pathlib import Path

import jsonschema
import pytest

from deck import spec
from deck.bench import fixtures, spike_image
from deck.bench import visual as V
from deck.bench import visual_agree as A
from deck.bench import visual_stats as S
from deck.bench import visual_transport as T
from deck.bench.judges import BenchError

SCHEMA = Path(V.DECK / "schemas" / "visual_rubric.schema.json")
CANARY, CANARY_NUM = "ZQXCANARY-7319", "48213"
SECRET = b"test-secret-not-a-real-one"


@pytest.fixture(autouse=True)
def trust_secret(monkeypatch):
    monkeypatch.setenv(A.SECRET_ENV, SECRET.decode())


def live_run(key, images, transport, **kw):
    """V.run live, with the id off the cost card for the same settings (the gate every live run passes through)."""
    kw.setdefault("max_usd", 5.0)
    card = V.plan_cost(key, images, kw.get("model", V.PRIMARY["model"]), kw.get("orders", 2), kw["max_usd"], kw.get("max_tokens", V.MAX_OUT_TOKENS),
                       kw.get("max_deck_usd", V.DECK_CAP_USD))
    return V.run(key, images, transport, live=True, card_id=card["id"], **kw)


# ---------------------------------------------------------------- rubric

def test_the_rubric_has_ten_questions_all_yes_is_good_and_validates_against_the_existing_schema():
    r = V.load_rubric()
    jsonschema.validate(r, json.loads(SCHEMA.read_text()))
    items = V.rubric_items(r)
    assert r["version"] == 1 and len(items) == 10 and len(r["per_slide"]) == 8 and len(r["per_deck"]) == 2
    assert all(i["pass_is"] == "yes" for i in items.values())
    assert all(i.get("confirm_with", spec.CHECKS[0]) in spec.ISSUE_CHECKS for i in items.values())
    assert set(V.load_data()["questions"]) == set(items)
    assert all(V.load_data()["questions"][q]["canned_message"] for q in items)   # canned text lives in the bench data for now
    assert V.prompt_version() == 1 and len(V.prompt_sha()) == 64


def test_a_question_applies_only_to_the_slides_it_names():
    facts = {"type": "insight", "n": 3, "of": 9, "has_image": False, "content": True}
    assert V.questions_for(facts, "A") == ["v_one_focus", "v_balance", "v_not_crowded", "v_looks_finished"]
    assert V.questions_for({**facts, "type": "title", "content": False}, "A") == ["v_one_focus", "v_balance", "v_looks_finished"]
    assert V.questions_for(facts, "B") == []
    assert V.questions_for({**facts, "has_image": True}, "B") == ["v_image_fits", "v_image_clean", "v_text_on_image", "v_crop_ok"]


# ---------------------------------------------------------------- statistics

def test_kappa_has_known_values_and_is_undefined_without_both_classes():
    pairs = [(True, True)] * 20 + [(True, False)] * 5 + [(False, True)] * 5 + [(False, False)] * 70
    assert S.kappa(pairs) == pytest.approx((0.9 - (0.25 * 0.25 + 0.75 * 0.75)) / (1 - (0.25 * 0.25 + 0.75 * 0.75)))
    assert S.kappa([(True, True), (False, False)]) == 1.0
    assert S.kappa([(False, False)] * 5) is None                  # nobody fails
    assert S.kappa([(True, True)] * 3 + [(False, True)] * 3) is None   # the critic fails everything
    assert S.kappa([]) is None


def test_wilson_lower_bound_and_flip_rate_and_self_agreement():
    assert S.wilson_lower(18, 20) == pytest.approx(0.699, abs=0.005)
    assert S.wilson_lower(60, 60) > 0.93 and S.wilson_lower(0, 0) is None
    # the flip rate is over slides where either order fails: 1 flip of 3 either-fail slides
    assert S.flip_rate([(True, True), (True, False), (False, False), (False, True), (False, False)]) == pytest.approx(2 / 3)
    assert S.flip_rate([(False, False)] * 4) is None
    assert S.self_agreement([("yes", "yes"), ("no", "yes"), ("no", "no"), ("yes", "yes")]) == 0.75 and S.self_agreement([]) is None


def test_the_cluster_bootstrap_is_seeded_and_resamples_whole_contents():
    rows = [{"p": i % 4 == 0, "c": i % 4 == 0 or i % 9 == 0, "cluster": f"c{i % 6}"} for i in range(120)]
    stat = lambda rs: S.kappa([(r["p"], r["c"]) for r in rs])
    a = S.cluster_bootstrap(rows, stat, lambda r: r["cluster"], 300, 7)
    b = S.cluster_bootstrap(rows, stat, lambda r: r["cluster"], 300, 7)
    assert a == b and a["lo"] < a["point"] < a["hi"] + 1e-9 and a["lo"] > 0.4
    assert S.cluster_bootstrap([{"p": False, "c": False, "cluster": "x"}] * 4, stat, lambda r: r["cluster"], 50, 1)["lo"] is None


# ---------------------------------------------------------------- agreement and trust (hand-made grades with known figures)

PRIMARY_CFG = {**V.PRIMARY, "primary": True, "prompt_sha": "p" * 64, "rubric_version": 1, "libreoffice": "LO 1", "fonts": "f1", "width": 1280}


def synth(q="v_balance", fails_nat=10, fails_seed=10, passes=60, critic_misses=0, baseline_equals_critic=False, repeats=8, cant=0, critic_blind=False):
    """A key, grades and critic answers with known figures: person fails then passes, spread over six contents."""
    key = {"slides": {}}
    grades, results = {}, {}
    n = 0

    def add(person_fail, seeded):
        nonlocal n
        n += 1
        tok = f"S{n:03d}"
        crit_fail = person_fail and not (critic_misses and n % 2 == 0 and critic_misses > 0) if not critic_blind else False
        meas = {"corner": 0.9} if (baseline_equals_critic and person_fail) else {"corner": 0.1, "ink": 0.2}
        key["slides"][tok] = {"questions": [q], "content": f"c{n % 6}", "seeded": {"kind": "aside"} if seeded else None, "repeat_of": None, "measures": meas}
        grades[tok] = {q: "no" if person_fail else "yes"}
        v = "fail" if crit_fail else "pass"
        results[tok] = {"1": {"answers": {q: {"verdict": v}}}, "2": {"answers": {q: {"verdict": v}}}}
        return tok
    toks = [add(True, False) for _ in range(fails_nat)] + [add(True, True) for _ in range(fails_seed)] + [add(False, False) for _ in range(passes)]
    for k in range(cant):
        grades[toks[-1 - k]][q] = "cant"
    for k, t in enumerate(toks[:repeats]):   # the person repeats the same answer
        rt = f"R{k:03d}"
        key["slides"][rt] = {**key["slides"][t], "repeat_of": t}
        grades[rt] = dict(grades[t])
    return key, {"answers": grades}, {"config": PRIMARY_CFG, "results": results}


def state_of(q="v_balance", **kw):
    key, grades, visual = synth(q, **{k: v for k, v in kw.items() if k not in ("cfg",)})
    if "cfg" in kw:
        visual["config"] = kw["cfg"]
    return A.agree(grades, visual, key, seed=3, n_boot=300)["questions"][q]


def test_a_perfect_critic_with_enough_natural_and_seeded_fails_reaches_acts():
    r = state_of()
    assert r["state"] == "acts", r["reasons"]
    assert r["by_subset"]["both"]["kappa"] == pytest.approx(1.0) and r["by_subset"]["both"]["specificity_wilson_lb"] >= 0.9
    assert r["added_value"]["caught_over_baseline"] == 20 and r["by_subset"]["natural"]["person_fails"] == 10 and r["by_subset"]["seeded"]["person_fails"] == 10


def test_a_question_with_five_fails_can_never_reach_acts_and_four_fails_is_off():
    assert state_of(fails_nat=5, fails_seed=0)["state"] == "advisory"
    assert state_of(fails_nat=2, fails_seed=2)["state"] == "off"
    r = state_of(fails_nat=9, fails_seed=5)   # 14 fails: under the 15 needed
    assert r["state"] == "advisory" and any("person fails under 15" in x for x in r["reasons"])


def test_seeded_fails_alone_cannot_reach_acts():
    r = state_of(fails_nat=3, fails_seed=20)
    assert r["state"] == "advisory" and any("natural person fails under 5" in x for x in r["reasons"])


def test_undefined_kappa_is_off_and_a_critic_that_sees_nothing_is_off():
    r = state_of(critic_blind=True)
    assert r["state"] == "off" and "undefined" in r["reasons"][0]
    assert state_of(fails_nat=0, fails_seed=0)["state"] == "off"


def test_the_critic_must_add_over_the_code_baseline_or_it_does_not_act():
    r = state_of(baseline_equals_critic=True)
    assert r["state"] == "advisory" and r["added_value"]["passes"] is False
    assert any("code baseline" in x for x in r["reasons"])
    assert r["baseline"]["both"]["kappa"] == pytest.approx(1.0)   # the code-only figures sit beside the critic's


def test_a_person_who_cannot_tell_too_often_makes_the_question_off_and_low_self_agreement_blocks_acts():
    assert state_of(cant=18)["state"] == "off" and "can't-tell" in state_of(cant=18)["reasons"][0]
    assert state_of(repeats=0)["state"] == "advisory" and any("self-agreement" in x for x in state_of(repeats=0)["reasons"])


def test_a_question_without_a_fix_or_a_confirm_cannot_act_and_a_non_primary_configuration_is_off():
    assert state_of("v_one_focus")["state"] == "advisory"   # v_one_focus has fix none and no confirm_with
    r = state_of(cfg={**PRIMARY_CFG, "model": "claude-opus-5-5", "primary": False})
    assert r["state"] == "off" and "exploratory" in r["reasons"][0]


def test_the_trust_file_reads_off_on_a_key_mismatch_a_hand_edit_a_forged_digest_or_no_secret(tmp_path, monkeypatch):
    key, grades, visual = synth()
    doc = A.agree(grades, visual, key, seed=3, n_boot=300)
    f = tmp_path / "critic_trust.json"
    f.write_text(json.dumps(doc))
    cur = A.trust_key(PRIMARY_CFG)
    assert A.read_trust(f, cur)["v_balance"] == "acts"
    assert set(A.read_trust(f, {**cur, "model": "claude-opus-5-5"}).values()) == {"off"}   # another model
    assert set(A.read_trust(f, {**cur, "libreoffice": "LO 2"}).values()) == {"off"}       # another renderer
    edited = copy.deepcopy(doc)
    edited["questions"]["v_one_focus"]["state"] = "acts"
    f.write_text(json.dumps(edited))
    assert set(A.read_trust(f, cur).values()) == {"off"}                                  # a hand edit fails the digest
    import hashlib
    forged = copy.deepcopy(doc)
    forged["questions"]["v_one_focus"]["state"] = "acts"
    forged["digest"] = hashlib.sha256(json.dumps({k: v for k, v in forged.items() if k != "digest"}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    f.write_text(json.dumps(forged))
    assert set(A.read_trust(f, cur).values()) == {"off"}                                  # a recomputed plain sha256 is rejected
    rekeyed = copy.deepcopy(doc)
    rekeyed["key"] = {**rekeyed["key"], "model": "whatever"}
    f.write_text(json.dumps(rekeyed))
    assert set(A.read_trust(f, rekeyed["key"]).values()) == {"off"}                       # editing the key alone is rejected
    gates = copy.deepcopy(doc)
    gates["gates"]["acts_fails"] = 1
    f.write_text(json.dumps(gates))
    assert set(A.read_trust(f, cur).values()) == {"off"}                                  # so are the gates and the configuration flag
    f.write_text(json.dumps(doc))
    assert A.read_trust(f, cur)["v_balance"] == "acts"
    monkeypatch.delenv(A.SECRET_ENV)
    assert set(A.read_trust(f, cur).values()) == {"off"}                                  # without the secret nothing reads as trusted
    with pytest.raises(BenchError, match=A.SECRET_ENV):
        A.agree(grades, visual, key, seed=3, n_boot=50)
    monkeypatch.setenv(A.SECRET_ENV, SECRET.decode())
    f.write_text(json.dumps(A.off_file()))
    assert set(A.read_trust(f, cur).values()) == {"off"}
    assert set(A.read_trust(tmp_path / "missing.json").values()) == {"off"}


def test_the_committed_trust_file_marks_every_question_off():
    committed = json.loads(V.TRUST_PATH.read_text())
    assert committed == A.off_file()
    assert set(A.read_trust(V.TRUST_PATH, A.trust_key(PRIMARY_CFG)).values()) == {"off"}


def test_the_code_baseline_reads_the_measures_and_never_a_model():
    assert V.code_predict("v_balance", {"corner": 0.7}) == "fail" and V.code_predict("v_balance", {"corner": 0.5, "ink": 0.2}) == "pass"
    assert V.code_predict("v_balance", {"ink": 0.04}) == "fail"
    assert V.code_predict("v_not_crowded", {"words": 70, "budget": 60}) == "fail" and V.code_predict("v_not_crowded", {"words": 50, "budget": 60}) == "pass"
    assert V.code_predict("v_one_focus", {"sizes": [28, 28, 14]}) == "fail" and V.code_predict("v_one_focus", {"sizes": [36, 14, 14]}) == "pass"
    assert V.code_predict("v_looks_finished", {"flags": ["text_overlap"]}) == "fail" and V.code_predict("v_crop_ok", {"flags": ["x"]}) == "pass"


# ---------------------------------------------------------------- cost: reservation, the cap, no network

def _png(w=1280, h=720):
    return spike_image.tiny_png(w, h)


def _key_and_images(tmp_path, n=6):
    images = tmp_path / "pack"
    images.mkdir()
    png = _png()
    key = {"width": 1280, "environment": {"libreoffice": "LO 1", "fonts": "f1"}, "slides": {}}
    for i in range(n):
        (images / f"s{i}.png").write_bytes(png + bytes([i]))   # distinct bytes, same picture size
        key["slides"][f"S{i:03d}"] = {"questions": ["v_one_focus", "v_balance"], "image": f"s{i}.png", "image_sha": f"sha{i}", "hash": f"h{i}",
                                      "facts": {"type": "insight", "n": i + 1, "of": 9, "has_image": False, "content": True}, "repeat_of": None}
    return key, images


REPLY = json.dumps({"answers": {"v_one_focus": {"verdict": "pass", "description": "one headline"}, "v_balance": {"verdict": "fail", "description": f"bare right half {CANARY} {CANARY_NUM}"}}})


def test_calls_reserve_their_worst_case_before_starting_and_the_run_stops_before_the_cap(tmp_path):
    key, images = _key_and_images(tmp_path)
    worst = T.worst_case_usd(V.PRIMARY["model"], T.estimate_input_tokens(_png(), len(V.prompt_text()) + 400), V.MAX_OUT_TOKENS)
    fake = T.FakeTransport(lambda *a: REPLY, tokens_in=1500, tokens_out=400, delay=0.05)
    doc = live_run(key, images, fake, max_usd=worst * 2.5, workers=4)
    assert fake.calls == 2 and doc["calls"] == 2 and doc["unjudgeable_calls"] == 10   # 6 slides x 2 orders = 12 jobs; only 2 fit the cap
    assert doc["usd"] <= worst * 2.5 and doc["usd"] == pytest.approx(2 * spec.estimate_usd(V.PRIMARY["model"], 1500, 400))
    skipped = [r for per in doc["results"].values() for r in per.values() if r["source"] == "unjudgeable"]
    assert skipped and all("cap" in r["reason"] for r in skipped)
    assert all(a["verdict"] == "unjudgeable" for r in skipped for a in r["answers"].values())   # never a pass


def test_a_larger_cap_runs_every_call_in_parallel_and_prices_unknown_models_at_the_maximum(tmp_path):
    key, images = _key_and_images(tmp_path)
    fake = T.FakeTransport(lambda *a: REPLY, tokens_in=1000, tokens_out=200, delay=0.05)
    doc = live_run(key, images, fake, max_usd=5.0, workers=4)
    assert doc["calls"] == 12 and fake.max_in_flight >= 2 and doc["config"]["primary"] is True
    assert doc["usd"] == pytest.approx(12 * spec.estimate_usd(V.PRIMARY["model"], 1000, 200), abs=1e-3)
    assert spec.estimate_usd("some-new-model", 1_000_000, 0) == 4.0
    b = T.Budget(1.0)
    assert b.reserve("some-new-model", 100_000, 10_000) is not None and b.reserve("some-new-model", 400_000, 10_000) is None


def test_answers_in_two_orders_and_unmatched_replies_are_unjudgeable_not_pass(tmp_path):
    key, images = _key_and_images(tmp_path, 2)
    seen = []
    fake = T.FakeTransport(lambda s, u, p, m: seen.append(u) or "not json at all")
    doc = live_run(key, images, fake, max_usd=5.0)
    # The calls run on a thread pool, so `seen` is in finishing order: count the two orders, don't index them.
    forward = [u.index("v_one_focus") < u.index("v_balance") for u in seen]
    assert len(seen) == 4 and forward.count(True) == 2 and forward.count(False) == 2
    assert all(a["verdict"] == "unjudgeable" for per in doc["results"].values() for r in per.values() for a in r["answers"].values())
    assert V.parse_reply('{"answers":{"v_one_focus":{"verdict":"maybe"}}}', ["v_one_focus"])["v_one_focus"]["verdict"] == "unjudgeable"


def assert_no_calls(transport):
    assert transport.calls == 0, f"{transport.calls} live calls were made"


def test_a_replay_from_recordings_makes_no_call_with_the_network_blocked_and_the_guard_trips_on_a_real_call(tmp_path):
    key, images = _key_and_images(tmp_path, 3)
    rec = tmp_path / "rec"
    live = T.FakeTransport(lambda *a: REPLY)
    live_run(key, images, live, max_usd=5.0, record_to=rec)
    assert live.calls == 6 and len(list(rec.glob("*.json"))) == 6
    quiet = T.FakeTransport(lambda *a: REPLY)
    with T.block_network():
        doc = V.run(key, images, quiet, max_usd=0.0, recordings=rec, live=False)
        with pytest.raises(AssertionError, match="network blocked"):
            import socket
            socket.socket().connect(("203.0.113.1", 80))
    assert_no_calls(quiet) and doc["replayed"] == 6 and doc["usd"] == 0
    with pytest.raises(AssertionError):   # positive control: a fake transport that makes nonzero calls trips the guard
        assert_no_calls(live)
    assert V.run(key, images, None, max_usd=1.0, live=False)["unjudgeable_calls"] == 6   # no recording, not live: nothing is called


def test_the_api_transport_refuses_without_the_napkin_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="API key"):
        T.ApiTransport().call(system="s", user_text="u", image_png=_png(), model=V.PRIMARY["model"], max_tokens=10)


# ---------------------------------------------------------------- seeded faults and the grading page

class StubRenderer(V.Renderer):
    """No LibreOffice: pages are small pictures, the PDF is a placeholder, QA reports nothing."""

    def pdf(self, pptx, workdir):
        p = Path(workdir) / (Path(pptx).stem + ".pdf")
        p.write_bytes(b"%PDF stub")
        return p

    def pages(self, pdf, dest, width):
        from pptx import Presentation
        dest.mkdir(parents=True, exist_ok=True)
        stem = Path(pdf).stem
        pptx = Path(pdf).with_suffix(".pptx")
        n = len(Presentation(str(pptx)).slides) if pptx.exists() else 30
        out = []
        for i in range(n):
            p = dest / f"p-{i + 1:02d}.png"
            p.write_bytes(_png(64, 36) + stem.encode() + bytes([i]))
            out.append(p)
        return out

    def qa(self, pptx, pdf):
        return {"slides": {}, "pixels": {}}

    def versions(self):
        return {"libreoffice": "stub", "fonts": "stub"}


@pytest.fixture(scope="module")
def runs(tmp_path_factory):
    root = tmp_path_factory.mktemp("runs")
    out = []
    for name in ("lumen_water", "agency_pitch"):
        fixtures.build_one(name, root / name, geometry_only=True)
        (root / name / "deck.pdf").write_bytes(b"%PDF stub")
        shutil.copytree(root / name, root / f"{name}__alt")
        out += [root / name, root / f"{name}__alt"]
    return out


def test_seeded_faults_change_the_slide_in_the_way_they_name(runs):
    from pptx import Presentation
    prs = Presentation(str(runs[0] / "deck.pptx"))
    base = Presentation(str(runs[0] / "deck.pptx"))
    i = 2
    before = sum(len(sh.text_frame.paragraphs) for sh in base.slides[i].shapes if sh.has_text_frame)
    assert V.seed_fault(prs, i, "overfilled")
    assert sum(len(sh.text_frame.paragraphs) for sh in prs.slides[i].shapes if sh.has_text_frame) > before
    prs = Presentation(str(runs[0] / "deck.pptx"))
    assert V.seed_fault(prs, i, "aside")
    assert all(a.left <= b.left and a.width <= b.width for a, b in zip(prs.slides[i].shapes, base.slides[i].shapes) if a.width)
    prs = Presentation(str(runs[0] / "deck.pptx"))
    assert V.seed_fault(prs, i, "equal_blocks")
    boxes = [sh for sh in prs.slides[i].shapes if sh.shape_type == 17 and sh.width == prs.slides[i].shapes[-1].width]
    assert len(boxes) >= 3
    with pytest.raises(BenchError):
        V.seed_fault(prs, i, "nope")


FORBIDDEN = ["seeded", "natural", "critic", "phase", "baseline", "overfilled", "equal_blocks", "lumen", "agency", "fenwick", "key.json"]


def leaks(page_dir: Path, key: dict) -> list:
    """Anything in the page or its file names that a grader could read the answer from."""
    text = (page_dir / "index.html").read_text().lower() + " ".join(p.name for p in page_dir.iterdir()).lower()
    words = FORBIDDEN + [s["run"].lower() for s in key["slides"].values()] + [s["hash"] for s in key["slides"].values()]
    return sorted({w for w in words if w and w in text})


@pytest.fixture(scope="module")
def packed(runs, tmp_path_factory):
    out = tmp_path_factory.mktemp("pack") / "page"
    key_out = out.parent / "key.json"
    key = V.pack(runs, "A", out, key_out, seed=5, renderer=StubRenderer(), slides=24, repeats=3, quota={"overfilled": 3, "aside": 3, "equal_blocks": 2})
    return out, key, key_out


def test_the_page_is_self_contained_blind_and_the_key_keeps_the_seeded_faults(packed):
    out, key, key_out = packed
    html = (out / "index.html").read_text()
    assert "http" not in html.lower() and "<script src" not in html and "<link" not in html   # no network, no outside file
    assert leaks(out, key) == []
    assert json.loads(key_out.read_text()) == key and key_out.parent != out   # the key is not in the page folder
    seeded = [s for s in key["slides"].values() if s["seeded"]]
    assert len(seeded) == 8 and {s["seeded"]["kind"] for s in seeded} == {"overfilled", "aside", "equal_blocks"}
    assert sum(1 for s in key["slides"].values() if s["repeat_of"]) == 3 and len(key["slides"]) == 24 + 3
    assert sorted(key["decks"]) == [f"D{i:02d}" for i in range(1, 5)]
    assert all((out / s["image"]).exists() for s in key["slides"].values()) and key["warmup"]
    assert all(set(s["questions"]) <= set(V.SESSION_QUESTIONS["A"]) for s in key["slides"].values())


def test_a_page_that_leaks_fails_the_leak_test(packed, tmp_path):
    out, key, _ = packed
    bad = tmp_path / "bad"
    shutil.copytree(out, bad)
    (bad / "index.html").write_text((bad / "index.html").read_text().replace("</body>", "<!-- seeded: aside --></body>"))
    assert "seeded" in leaks(bad, key)   # the positive control: a page that deliberately leaks is caught
    shutil.copy(out / "slide-001.png", bad / "lumen-water-s05.png")
    assert "lumen" in leaks(bad, key)


def test_answers_round_trip_from_a_page_into_agree(packed):
    out, key, _ = packed
    grades = {"session": "A", "answers": {t: {q: ("no" if (s["seeded"] and q in s["seeded"]["targets"]) else "yes") for q in s["questions"]}
                                          for t, s in key["slides"].items()}}
    results = {t: {o: {"answers": {q: {"verdict": "fail" if grades["answers"][t][q] == "no" else "pass"} for q in s["questions"]}} for o in "12"}
               for t, s in key["slides"].items() if not s["repeat_of"]}
    doc = A.agree(grades, {"config": PRIMARY_CFG, "results": results}, key, seed=1, n_boot=100)
    q = doc["questions"]["v_balance"]
    assert q["by_subset"]["both"]["person_fails"] == 3 and q["by_subset"]["seeded"]["person_fails"] == 3 and q["by_subset"]["natural"]["person_fails"] == 0
    assert q["state"] in ("off", "advisory") and doc["self_agreement_pooled"] == 1.0
    assert doc["digest"] == A.sign(doc, SECRET)


def test_session_b_refuses_when_no_slide_has_a_picture(runs, tmp_path):
    with pytest.raises(BenchError, match="placed picture"):
        V.pack(runs, "B", tmp_path / "b", tmp_path / "b.key.json", renderer=StubRenderer())


# ---------------------------------------------------------------- recordings and the planted-string leak test

def fixture_hashes(runs) -> set:
    return {V.slide_hash(d, sid) for d in (json.loads((r / "deck.json").read_text()) for r in runs) for sid in d["slides"]}


def test_every_committed_recording_maps_to_an_invented_fixture_slide(runs, tmp_path):
    hashes = fixture_hashes(runs)
    committed = Path(__file__).parent / "fixtures" / "critic"
    assert V.recording_problems(committed, hashes) == []   # the folder may not exist yet: nothing committed is nothing wrong
    d = json.loads((runs[0] / "deck.json").read_text())
    good = tmp_path / "good"
    good.mkdir()
    (good / "a.json").write_text(json.dumps({"slide_hash": V.slide_hash(d, d["order"][0])}))
    assert V.recording_problems(good, hashes) == []
    (good / "stray.json").write_text(json.dumps({"slide_hash": "not-a-fixture", "reply": "client text"}))
    (good / "bad.json").write_text("{")
    assert V.recording_problems(good, hashes) == ["bad.json", "stray.json"]   # the positive control


def scan(run_dir: Path, needles: tuple) -> list:
    """Where a planted string appears in a built deck: deck.json, the pptx XML, and every other file but the critic's own."""
    found = []
    for p in sorted(Path(run_dir).rglob("*")):
        if not p.is_file() or p.name in ("visual.json",):
            continue
        blob = p.read_bytes()
        if p.suffix == ".pptx":
            with zipfile.ZipFile(p) as z:
                blob = b" ".join(z.read(n) for n in z.namelist() if n.endswith((".xml", ".rels")))
        for n in needles:
            if n.encode() in blob:
                found.append((p.name, n))
    return found


def test_the_scan_finds_a_planted_string_copied_into_a_deck(runs, tmp_path):
    """The scanner's positive control: a helper that copies a critic note into speaker notes must be caught, and a clean build is not."""
    needles = (CANARY, CANARY_NUM)
    built = tmp_path / "built"
    fixtures.build_one("lumen_water", built, geometry_only=True)
    assert scan(built, needles) == []
    from pptx import Presentation
    prs = Presentation(str(built / "deck.pptx"))
    prs.slides[1].notes_slide.notes_text_frame.text = f"critic said {CANARY} {CANARY_NUM}"
    prs.save(str(built / "deck.pptx"))
    assert ("deck.pptx", CANARY) in scan(built, needles) and ("deck.pptx", CANARY_NUM) in scan(built, needles)


@pytest.mark.xfail(strict=True, reason="proves nothing until phase 2 wires the critic in: no build reads visual.json yet (run_deck has no --critic)")
def test_planted_critic_text_never_reaches_a_deck_built_with_the_critic(runs, tmp_path):
    key, images = _key_and_images(tmp_path, 2)
    doc = live_run(key, images, T.FakeTransport(lambda *a: REPLY), max_usd=5.0)
    planted = [a["description"] for per in doc["results"].values() for r in per.values() for a in r["answers"].values() if CANARY in a["description"]]
    assert planted and all(CANARY in p and CANARY_NUM in p for p in planted)
    visual_json = tmp_path / "visual.json"
    visual_json.write_text(json.dumps(doc))
    from deck import run_deck
    built = tmp_path / "built"
    fixtures.build_one("lumen_water", built, geometry_only=True, extra=("--critic", str(visual_json)))   # phase 2: the build must consume the critic
    assert scan(built, (CANARY, CANARY_NUM)) == []


# ---------------------------------------------------------------- the transport spike, prepared

def test_the_spike_builds_a_valid_picture_one_stream_json_line_and_reads_its_result():
    png = spike_image.tiny_png()
    assert T.png_size(png) == (64, 64)
    line = json.loads(spike_image.message(png))
    assert [b["type"] for b in line["message"]["content"]] == ["image", "text"] and line["message"]["content"][0]["source"]["media_type"] == "image/png"
    cmd = spike_image.command()
    assert cmd[:2] == ["claude", "-p"] and "stream-json" in cmd and "--max-budget-usd" in cmd and cmd[cmd.index("--max-budget-usd") + 1] == "0.01"
    ok = spike_image.judge(json.dumps({"type": "result", "result": "Left is red and right is blue.", "is_error": False, "total_cost_usd": 0.003}))
    assert ok["ok"] and not spike_image.judge(json.dumps({"type": "result", "result": "no idea", "is_error": False}))["ok"]
    assert not spike_image.judge("")["ok"]


def test_the_spike_does_nothing_without_the_cost_confirmation(capsys):
    assert spike_image.main([]) == 2
    assert "COST CARD" in capsys.readouterr().out


# ---------------------------------------------------------------- band and repair-seam tests (slice 5 landed)

def test_a_critic_fix_runs_only_inside_its_code_confirm_band():
    from deck import repair
    assert repair.critic_fix_allowed("v_balance", {"corner": 0.5}) is False
    assert repair.critic_fix_allowed("v_balance", {"corner": 0.7}) is True
    assert repair.critic_fix_allowed("v_one_focus", {"sizes": [30, 30]}) is False   # no fix: advisory only
    assert repair.critic_fix_allowed("v_not_crowded", {"words": 10, "budget": 5}) is True   # its fix is switch_layout, never shorten
    assert repair.critic_fix_allowed("v_balance", {"corner": 0.7}, {"critic": {"may_fix": ["crop_image"], "needs_code_confirm": True}}) is False   # a fix the policy does not allow


def test_critic_issues_carry_the_canned_message_and_never_count_in_the_keep_rule():
    from deck import issues as I, repair
    assert set(spec.CRITIC_CHECKS) <= set(spec.ISSUE_CHECKS) and "v_balance" in spec.ISSUE_CHECKS
    deck = {"order": ["s01"], "slides": {"s01": {"type": "content"}}}
    one = I.derive([], {"slides": {}}, deck, {})   # no findings: nothing
    assert one == []
    crit = {"id": "i_00000001", "round": 0, "slide": "s01", "source": "critic", "check": "v_balance", "level": "warn", "severity": "major", "message": "canned", "status": "open"}
    assert repair.counts([crit], deck) == {"blocker": 0, "major": 0, "minor": 0} and repair.pairs([crit], deck) == set()
    made = []
    I._make(made, {}, "critic", {"check": "v_balance", "level": "error", "message": "x"}, "s01", None, 0, {})
    assert made[0]["severity"] != "blocker"   # the critic never raises a blocker
    sel = repair.select({"deck": {"order": ["s01"], "slides": {"s01": {"type": "content"}}}, "issues": [crit]}, {"repair_on": ["blocker", "major"], "critic": {"enabled": False}}, ["s01"], {"left": {}}, set())
    assert sel == []   # off by default: the critic is advisory until its questions are graded


# ---------------------------------------------------------------- the adversarial review's fixes

def test_a_paid_call_that_stops_on_max_tokens_or_refuses_is_booked_not_free(tmp_path):
    key, images = _key_and_images(tmp_path, 3)
    for stop in ("max_tokens", "refusal"):
        fake = T.FakeTransport(lambda *a: "", tokens_in=1500, tokens_out=1200, stop=stop)
        doc = live_run(key, images, fake, max_usd=5.0)
        assert doc["calls"] == 6 and doc["usd"] == pytest.approx(6 * spec.estimate_usd(V.PRIMARY["model"], 1500, 1200))
        assert all(a["verdict"] == "unjudgeable" for per in doc["results"].values() for r in per.values() for a in r["answers"].values())
        assert all(r["reason"] == f"stopped: {stop}" for per in doc["results"].values() for r in per.values())
    one = T.worst_case_usd(V.PRIMARY["model"], T.estimate_input_tokens(_png(), len(V.prompt_text()) + 400), V.MAX_OUT_TOKENS)
    fake = T.FakeTransport(lambda *a: "", tokens_in=1500, tokens_out=1200, stop="max_tokens")
    doc = live_run(key, images, fake, max_usd=one * 1.5, workers=1)   # a stopped call still counts against the cap
    assert fake.calls == 1 and doc["usd"] > 0 and doc["unjudgeable_calls"] == 5


def test_missing_usage_and_failed_calls_book_the_worst_case_and_only_an_unsent_call_is_free(tmp_path):
    key, images = _key_and_images(tmp_path, 2)
    no_usage = T.FakeTransport(lambda *a: REPLY, tokens_in=0, tokens_out=0)
    doc = live_run(key, images, no_usage, max_usd=5.0)
    worst = T.worst_case_usd(V.PRIMARY["model"], T.estimate_input_tokens(_png(), len(V.prompt_text()) + 400), V.MAX_OUT_TOKENS)
    assert doc["usd"] == pytest.approx(4 * worst, rel=0.02) and doc["usd"] > 0

    class Boom(T.FakeTransport):
        def call(self, **k):
            raise TimeoutError("sent, no answer")
    doc = live_run(key, images, Boom(), max_usd=5.0)
    assert doc["usd"] == pytest.approx(4 * worst, rel=0.02) and doc["unjudgeable_calls"] == 4

    class Unsent(T.FakeTransport):
        def call(self, **k):
            raise T.NoCharge("no key")
    assert live_run(key, images, Unsent(), max_usd=5.0)["usd"] == 0


def test_the_reservation_prices_images_at_w_h_over_750_cache_writes_at_1_25x_and_flags_an_overrun():
    assert T.estimate_input_tokens(_png(1280, 720), 0) == -(-1280 * 720 // 750) + 1
    assert T.worst_case_usd("claude-sonnet-5-5", 1_000_000, 0) == pytest.approx(2.5)
    b = T.Budget(10.0, 1.0)
    r = b.reserve("claude-sonnet-5-5", 100_000, 1000, "D01")
    b.settle(r, r * 2, "D01")   # the real cost passed the reservation: booked in full and flagged, not clamped
    assert b.spent == pytest.approx(r * 2) and b.overruns == 1


def test_the_per_deck_cap_stops_a_deck_while_other_decks_go_on(tmp_path):
    key, images = _key_and_images(tmp_path, 6)
    for i, s in enumerate(key["slides"].values()):
        s["deck"] = "D01" if i < 3 else "D02"
    one = T.worst_case_usd(V.PRIMARY["model"], T.estimate_input_tokens(_png(), len(V.prompt_text()) + 400), V.MAX_OUT_TOKENS)
    fake = T.FakeTransport(lambda *a: REPLY, tokens_in=1500, tokens_out=400)
    doc = live_run(key, images, fake, max_usd=50.0, max_deck_usd=one * 2.5, workers=1)
    assert 4 <= doc["calls"] < 12 and doc["deck_usd"].keys() == {"D01", "D02"}   # each deck stops early (12 asked); neither starves the other
    assert all(v > 0 for v in doc["deck_usd"].values())
    assert all(v <= one * 2.5 for v in doc["deck_usd"].values())
    why = {r["reason"] for per in doc["results"].values() for r in per.values() if r["source"] == "unjudgeable"}
    assert why == {"over the per-deck cap: not started"}
    assert V.DECK_CAP_USD == 0.40


def test_a_live_run_needs_the_id_printed_on_its_cost_card_and_the_card_uses_the_real_token_estimate(tmp_path):
    key, images = _key_and_images(tmp_path, 2)
    fake = T.FakeTransport(lambda *a: REPLY)
    for bad in (None, "", "deadbeef", True):
        with pytest.raises(BenchError, match="cost card"):
            V.run(key, images, fake, max_usd=5.0, live=True, card_id=bad)
    assert fake.calls == 0
    card = V.plan_cost(key, images, V.PRIMARY["model"], 2, 5.0)
    assert card["id"] in card["text"] and card["calls"] == 4
    other = V.plan_cost(key, images, V.PRIMARY["model"], 2, 4.0)
    assert other["id"] != card["id"]   # the id covers the caps
    assert V.run(key, images, fake, max_usd=5.0, live=True, card_id=card["id"])["calls"] == 4
    big = tmp_path / "big"
    big.mkdir()
    for s in key["slides"].values():
        (big / s["image"]).write_bytes(_png(2560, 1440))
    assert V.plan_cost(key, big, V.PRIMARY["model"], 2, 5.0)["est_in"] > 3 * card["est_in"]   # real picture sizes, not a fixed 2000


def test_the_cli_refuses_a_bare_yes_cost_and_a_wrong_card_id(tmp_path, capsys):
    from deck.bench.__main__ import main
    key, images = _key_and_images(tmp_path, 1)
    kp = tmp_path / "key.json"
    kp.write_text(json.dumps(key))
    base = ["visual", "run", "--key", str(kp), "--images", str(images), "--max-usd", "1", "--out", str(tmp_path / "v.json"), "--live"]
    with pytest.raises(SystemExit):
        main(base + ["--yes-cost"])
    assert main(base + ["--yes-cost", "wrong"]) == 2
    assert "COST CARD" in capsys.readouterr().out and not (tmp_path / "v.json").exists()


def test_the_recording_key_includes_the_effort():
    a = V.call_key("sha", 1, "p", "m", ["q"], "low")
    assert a != V.call_key("sha", 1, "p", "m", ["q"], "high") and a == V.call_key("sha", 1, "p", "m", ["q"])


def test_repeats_show_a_fresh_label_and_every_picture_is_one_png_encoding(packed):
    out, key, _ = packed
    shown = {t: (s["shown"]["deck"], s["shown"]["n"]) for t, s in key["slides"].items()}
    assert len(set(shown.values())) == len(shown)   # no two slides share a label: a repeat cannot be matched to its original by it
    for t, s in key["slides"].items():
        if s["repeat_of"]:
            assert shown[t] != shown[s["repeat_of"]] and s["shown"]["deck"] != key["slides"][s["repeat_of"]]["deck"]
    html = (out / "index.html").read_text()
    assert all(f'"deck": "{d}", "n": {n}' in html for d, n in shown.values())
    for p in list(out.glob("*.png")):
        assert p.read_bytes().endswith(b"\x00\x00\x00\x00IEND\xaeB`\x82"), p.name   # re-encoded: no trailing bytes from the renderer
