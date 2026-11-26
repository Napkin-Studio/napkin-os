"""Offline tests for the shared Runway client and the Deck's job loop (deck-image-gen). A recorded fake stands in for Runway: no network."""
from __future__ import annotations

import json
import multiprocessing
import subprocess
import sys
from pathlib import Path

import pytest

from visuals import jobs, runway

KEY = "rw_SECRET_KEY_123"
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082")


class Fake:
    """A fake Runway transport. Echoes the key in its error bodies (so a leak would show)."""
    def __init__(self, fail=None, est=None):
        self.posts, self.gets, self.fail, self.est, self.n = [], [], fail, est, 0

    def __call__(self, method, url, headers, body, timeout=0):
        if method == "POST":
            if self.fail == "timeout":
                raise TimeoutError(f"timed out with {headers['Authorization']}")
            if isinstance(self.fail, int):
                return self.fail, json.dumps({"error": f"bad {headers['Authorization']}"}).encode()
            self.posts.append(json.loads(body))
            self.n += 1
            return 200, json.dumps({"id": f"task{self.n}", "estimatedCost": {"credits": self.est or 7}}).encode()
        self.gets.append(url)
        if "/tasks/" in url:
            return 200, json.dumps({"status": "SUCCEEDED", "output": ["https://cdn.example/x.png"], "cost": {"credits": 7}}).encode()
        return 200, PNG


def job(i, tier="draft", slots=None):
    p = f"A kitchen tap, picture {i}."
    return {"key": runway.request_key(runway.TIER_MODEL[tier], "1344:768", p, [], "r1", 1), "tier": tier, "ratio": "1344:768", "prompt": p,
            "slots": slots or [f"s0{i}.picture"], "ref_shas": []}


def run(cache, ledger, js, cap=2.5, fake=None, **kw):
    fake = fake or Fake()
    m = jobs.load_manifest(cache)
    r = jobs.generate(runway.Client(KEY, fake), js, cache, m, jobs.Ledger(ledger, "deck1"), cap, lambda j: [], sleep=lambda s: None, log=lambda *a: None, **kw)
    return fake, m, r


def test_tiers_are_pinned_in_code():
    assert runway.TIER_MODEL == {"draft": "gemini_image3.1_flash", "hero": "gemini_image3_pro"}
    assert runway.credits_for("gemini_image3.1_flash") == 7 and runway.credits_for("gemini_image3_pro", "2K") == 20


@pytest.mark.parametrize("aspect,draft,hero", [("16:9", "1344:768", "2752:1536"), ("3:2", "1248:832", "2528:1696"), ("4:3", "1184:864", "2400:1792"),
                                               ("1:1", "1024:1024", "2048:2048"), ("4:5", "896:1152", "1856:2304"), ("9:16", "768:1344", "1536:2752")])
def test_snap_table_locks_all_six_aspects(aspect, draft, hero):
    assert runway.snap(aspect, runway.TIER_MODEL["draft"], "1K") == draft
    assert runway.snap(aspect, runway.TIER_MODEL["hero"], "2K") == hero


def test_snap_refuses_an_aspect_with_no_ratio():
    with pytest.raises(runway.RunwayError):
        runway.snap("21:9x", "gemini_image3.1_flash")


def test_request_key_is_the_request():
    a = runway.request_key("m", "1:1", "a  b", ["x", "y"], "r1", 1)
    assert a == runway.request_key("m", "1:1", "a b", ["y", "x"], "r1", 1)
    assert a != runway.request_key("m", "1:1", "a b", ["x", "y"], "r1", 2) and a != runway.request_key("m", "1:1", "a b", ["x"], "r1", 1)
    assert a != runway.request_key("m", "1:1", "a b", ["x", "y"], "r2", 1) and a.startswith("j_") and len(a) == 18


def test_create_sends_the_ratio_and_territory_keeps_its_own():
    f = Fake()
    c = runway.Client(KEY, f)
    c.create("gemini_image3.1_flash", "p", [], ratio="768:1344")
    c.create("gemini_image3.1_flash", "p", [])
    assert [p["ratio"] for p in f.posts] == ["768:1344", runway.RATIO]


def test_a_first_run_posts_and_an_identical_rerun_posts_nothing(tmp_path):
    js = [job(1), job(2)]
    f1, m, r = run(tmp_path / "c", tmp_path / "l.jsonl", js)
    assert len(f1.posts) == 2 and r["created"] == 2 and all(jobs.state(m["jobs"][j["key"]], tmp_path / "c") == "saved" for j in js)
    f2, m2, r2 = run(tmp_path / "c", tmp_path / "l.jsonl", js)
    assert f2.posts == [] and r2["created"] == 0


def test_a_create_that_times_out_is_unknown_counts_as_spent_and_is_not_recreated(tmp_path):
    js = [job(1), job(2)]
    f, m, r = run(tmp_path / "c", tmp_path / "l.jsonl", js, fake=Fake(fail="timeout"))
    assert r["unknown"] == [js[0]["key"]] and m["jobs"][js[0]["key"]]["state"] == "unknown" and r["stopped"]
    assert not r["failed"]
    assert jobs.spent_usd(m, None) == 0.07
    f2, m2, r2 = run(tmp_path / "c", tmp_path / "l.jsonl", js)
    assert f2.posts and len(f2.posts) == 1 and f2.posts[0]["promptText"] == js[1]["prompt"]   # job 1 stays unknown, job 2 goes
    f3, m3, r3 = run(tmp_path / "c", tmp_path / "l.jsonl", [js[0]], retry_unknown=True)
    assert len(f3.posts) == 1


def test_a_marker_with_no_task_is_unknown_after_a_crash(tmp_path):
    j = job(1)
    assert jobs.state({"state": "creating"}, tmp_path) == "unknown"
    f, m, r = run(tmp_path / "c", tmp_path / "l.jsonl", [j])
    assert jobs.state(m["jobs"][j["key"]], tmp_path / "c") == "saved"


def test_territory_tool_also_treats_a_timeout_as_unknown_not_failed(tmp_path):
    jb = [{"key": "t1-f1-flash", "tid": "t1", "shot": "f1", "kind": "quick", "prompt": "p"}]
    man = {"frames": {}}
    out = runway.generate(runway.Client(KEY, Fake(fail="timeout")), jb, tmp_path, man, [], sleep=lambda s: None, log=lambda *a: None)
    assert out["unknown"] == ["t1-f1-flash"] and man["frames"]["t1-f1-flash"]["status"] == "UNKNOWN"
    assert runway.state(jb[0], man, tmp_path) == "unknown"


def test_a_refusal_stops_every_later_create(tmp_path):
    f, m, r = run(tmp_path / "c", tmp_path / "l.jsonl", [job(1), job(2)], fake=Fake(fail=402))
    assert len(r["failed"]) == 1 and "refused" in r["stopped"]


def test_the_key_is_in_no_manifest_ledger_or_error(tmp_path):
    f, m, r = run(tmp_path / "c", tmp_path / "l.jsonl", [job(1)], fake=Fake(fail=402))
    f, m, r = run(tmp_path / "c2", tmp_path / "l2.jsonl", [job(2)], fake=Fake(fail="timeout"))
    for p in list(tmp_path.rglob("*.json*")):
        assert KEY not in p.read_text(), p


def test_spend_is_derived_from_jobs_and_survives_a_deleted_cache(tmp_path):
    js = [job(i) for i in range(1, 4)]
    run(tmp_path / "c", tmp_path / "l.jsonl", js)
    led = jobs.Ledger(tmp_path / "l.jsonl", "deck1")
    assert jobs.spent_usd(jobs.load_manifest(tmp_path / "c"), led) == 0.21
    import shutil
    shutil.rmtree(tmp_path / "c")
    assert jobs.spent_usd(jobs.load_manifest(tmp_path / "c"), led) == 0.21     # the cache is gone, the ledger still counts
    assert jobs.spent_usd(jobs.load_manifest(tmp_path / "c"), jobs.Ledger(tmp_path / "l.jsonl", "other")) == 0


def test_spend_prices_at_the_largest_of_estimate_reported_and_table(tmp_path):
    f, m, r = run(tmp_path / "c", tmp_path / "l.jsonl", [job(1)], fake=Fake(est=15))
    assert jobs.spent_usd(m, None) == 0.15


def test_a_create_never_starts_if_it_would_pass_the_cap(tmp_path):
    f, m, r = run(tmp_path / "c", tmp_path / "l.jsonl", [job(i) for i in range(1, 6)], cap=0.22)
    assert len(f.posts) == 3 and "cap reached" in r["stopped"]


def _worker(args):
    cache, ledger, i = args
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    run(Path(cache), Path(ledger), [job(i)], cap=0.07)


def test_two_processes_racing_for_the_last_slot_make_exactly_one_create(tmp_path):
    ctx = multiprocessing.get_context("fork")
    ps = [ctx.Process(target=_worker, args=((str(tmp_path / f"c{i}"), str(tmp_path / "l.jsonl"), i),)) for i in (1, 2)]
    [p.start() for p in ps]
    [p.join(30) for p in ps]
    rows = [r for r in jobs.Ledger(tmp_path / "l.jsonl", "deck1").lines() if r.get("state") == "creating"]
    assert len(rows) == 1
