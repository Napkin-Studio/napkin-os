"""Tests added by the 17 Nov review of the Territory tool (features/territory-tool.clan, decision of that date).
Each one failed before its fix. A fake Runway, a fake Ollama and a FakeLLM stand in for paid and local services; every brand,
territory and style pack here is invented. The pack in ``demo_pack`` is a DEMO for tests: it is not Laurence's pack.
Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q territory/tests``."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from territory import cards, compare, llm as llm_mod
from territory.llm import FakeLLM, LiveLLM
from territory.visuals import board, guard, plan as plan_mod, runway, safety, style as style_mod
from test_visuals import KEY, LIVE, FakeRunway, PNG, clean_ollama, env, flag_task, go, make_run, ollama_down, plan_output, style_pack  # noqa: F401

DEMO_NOTE = "DEMO PACK, invented for tests. It is not Laurence's pack."


def demo_pack(tmp_path, name="demo", look="loose ink wash, cool", banned="crowds", n_images=1):
    d = tmp_path / name
    d.mkdir(exist_ok=True)
    (d / "style.yaml").write_text(f"look: [{look}]\npalette: [slate]\nfinish: rough\nbanned_imagery: [{banned}]\nnotes: {DEMO_NOTE}\n")
    for i in range(n_images):
        (d / f"ref{i:02d}.png").write_bytes(PNG + bytes([i, 7]))
    return d


def vdirs(run_path):
    return sorted(p for p in (run_path.parent / (run_path.stem + ".frames")).iterdir() if p.is_dir())


def manifest_of(vdir):
    return json.loads((vdir / "manifest.json").read_text())


# ------------------------------------------------------- the text cannot change when only the style pack changes

def test_the_frame_plan_does_not_depend_on_the_style_packs_banned_imagery(env, tmp_path):
    seen = []
    other = env.with_name("jam2.json")
    other.write_text(env.read_text())
    for run, pack in ((env, demo_pack(tmp_path, "a", banned="crowds")), (other, demo_pack(tmp_path, "b", banned="umbrellas"))):
        llm = FakeLLM({"frames_plan": lambda user: seen.append(user) or plan_output()})
        go(run, "--style", str(pack), *LIVE, llm=llm)
    assert seen[0] == seen[1] and "crowds" not in seen[0] and "umbrellas" not in seen[1]


def test_a_style_pack_that_bans_a_word_does_not_drop_shots_so_every_pack_gets_the_same_frames(env, tmp_path):
    llm = FakeLLM({"frames_plan": plan_output(" among crowds")})
    code, rw, _ = go(env, "--style", str(demo_pack(tmp_path, banned="crowds")), *LIVE, llm=llm)
    assert len(rw.posts) == 8 and "Never show: crowds" in rw.posts[0]["promptText"]


def test_swapping_the_style_pack_changes_only_image_prompts_and_hashes_never_text(env, tmp_path):
    """The whole point of the tool, end to end: the default pack, then a demo pack in the pack slot."""
    run_bytes = env.read_bytes()
    go(env, *LIVE)
    plan_bytes = plan_mod.plan_path(env).read_bytes()
    code, rw2, llm2 = go(env, "--style", str(demo_pack(tmp_path)), *LIVE)
    assert code == 0 and llm2.calls == []
    assert env.read_bytes() == run_bytes and plan_mod.plan_path(env).read_bytes() == plan_bytes
    v1, v2 = vdirs(env)
    f1, f2 = (json.loads((v / "frames.json").read_text()) for v in (v1, v2))
    strip = lambda cs: [{k: v for k, v in c.items() if k not in ("frames", "visual")} for c in cs]
    assert strip(f1["cards"]) == strip(f2["cards"]) and strip(f1["cards"])[0]["name"] == "The first jar in her fridge"
    m1, m2 = manifest_of(v1), manifest_of(v2)
    assert m1["inputs"] == m2["inputs"]                                       # same run, same plan, same safety list
    assert m1["style"]["hash"] != m2["style"]["hash"] and m1["style"]["source"] != m2["style"]["source"]
    for k, e1 in m1["frames"].items():
        e2 = m2["frames"][k]
        assert e1["prompt_sha256"] != e2["prompt_sha256"] and e1["prompt"] != e2["prompt"]
        shot = lambda e: e["prompt"].split(" Look:")[0]                       # the shot description comes first, then the style
        assert shot(e1) == shot(e2)
    for c1, c2 in zip(f1["cards"], f2["cards"]):                              # the picture slot moves; the words around it do not
        assert c1["visual"]["prompt"] != c2["visual"]["prompt"] and c1["visual"]["image"] != c2["visual"]["image"]
    assert "DEMO PACK" in v2.joinpath("manifest.json").read_text()
    assert style_mod.load(None).source == "default until Laurence answers"


def test_a_saved_plan_for_a_changed_run_is_refused_not_reused(env):
    go(env, *LIVE)
    run = json.loads(env.read_text())
    run["territories"][0]["line"] = "A different line"
    env.write_text(json.dumps(run))
    code, rw, llm = go(env, *LIVE)
    assert code == 2 and rw.posts == [] and llm.calls == []


def test_a_plan_that_misses_a_territory_is_refused_not_painted_as_a_blank_shot(env):
    go(env, "--live", "--yes-cost", "--plan-only")
    p = plan_mod.plan_path(env)
    plan = json.loads(p.read_text())
    plan["territories"].pop("s2")
    p.write_text(json.dumps(plan))
    code, rw, _ = go(env, *LIVE)
    assert code == 2 and rw.posts == []


def test_the_plan_is_never_overwritten(env):
    go(env, "--live", "--yes-cost", "--plan-only")
    run = json.loads(env.read_text())
    with pytest.raises(plan_mod.PlanError, match="already"):
        plan_mod.make(run, env, FakeLLM({"frames_plan": plan_output()}))


# -------------------------------------------------------------------------------------- frames are reproducible

def test_the_manifest_records_what_made_each_frame_and_a_changed_input_is_refused(env):
    go(env, *LIVE)
    vdir = vdirs(env)[0]
    m = manifest_of(vdir)
    assert set(m["inputs"]) >= {"run_sha256_12", "plan_sha256_12", "safety_banned_sha256_12"}
    assert m["inputs"]["run_sha256_12"] == plan_mod.run_hash(env) and m["inputs"]["plan_sha256_12"] == plan_mod.plan_hash(env)
    for e in m["frames"].values():
        assert re.fullmatch(r"[0-9a-f]{64}", e["prompt_sha256"]) and re.fullmatch(r"[0-9a-f]{64}", e["sha256"])
    m["inputs"]["plan_sha256_12"] = "0" * 12
    runway.save_manifest(vdir, m)
    code, rw, _ = go(env, *LIVE)
    assert code == 2 and rw.posts == []


def test_a_territory_id_cannot_write_outside_the_version_folder(env):
    run = json.loads(env.read_text())
    run["territories"][0]["id"] = "../../evil"
    env.write_text(json.dumps(run))
    code, rw, _ = go(env, *LIVE)
    assert code == 2 and rw.posts == [] and not (env.parent.parent / "evil-f1-flash.png").exists()


def test_the_best_frame_wins_a_shot_unless_it_is_flagged_and_the_quick_one_is_clean(tmp_path):
    (tmp_path / "a.png").write_bytes(PNG)
    (tmp_path / "b.png").write_bytes(PNG)
    m = {"frames": {"s1-f1-flash": {"territory": "s1", "shot": "f1", "tier": "quick", "model": "flash", "file": "a.png", "guard": {"checked": True, "flagged": False}},
                    "s1-f1-pro": {"territory": "s1", "shot": "f1", "tier": "best", "model": "pro", "file": "b.png", "guard": {"checked": True, "flagged": True, "reason": "x"}}}}
    got = board.frames_for(m, tmp_path, tmp_path, "v1-x")["s1"]
    assert len(got) == 1 and got[0]["model"] == "flash" and not got[0]["flagged"]


# ------------------------------------------------------------------------------ the guard must not fail open

def test_a_frame_nobody_has_checked_does_not_reach_the_deck_slot(env):
    code, rw, _ = go(env, *LIVE, ollama=ollama_down)
    vdir = vdirs(env)[0]
    c = json.loads((vdir / "frames.json").read_text())["cards"][0]
    assert len(c["frames"]) == 4 and c["visual"] is None                    # shown on the board as 'not checked', never in a deck
    f = c["frames"][0]
    code, rw2, _ = go(env, "--approve", f["key"], *LIVE, ollama=ollama_down)
    c = json.loads((vdir / "frames.json").read_text())["cards"][0]
    assert c["visual"]["image"] == f["path"] and manifest_of(vdir)["frames"][f["key"]]["approved_at"]   # a person's yes opens the slot


@pytest.mark.parametrize("reply", ["{}", '{"note": "all good"}', '{"banned_imagery": []}', "[]"])
def test_a_guard_reply_that_does_not_answer_the_question_is_flagged_not_clean(reply):
    r = guard.check_image(PNG, ["bridge"], post=lambda u, b: {"message": {"content": reply}})
    assert r["checked"] and r["flagged"]


def test_a_guard_reply_that_is_not_json_at_all_is_not_a_crash():
    def bad(url, body):
        raise json_error()
    json_error = lambda: __import__("json").JSONDecodeError("x", "y", 0)
    r = guard.check_image(PNG, post=bad)
    assert r["checked"] is False and r["flagged"] is False and "not" in r["reason"]


# -------------------------------------------------------------------------------- the safe-messaging gate

def sensitive_run(tmp_path, innocent_category=True):
    run = make_run()
    run["territories"][1]["proposition"] = "Nobody should face suicide alone."          # the model's own text names it
    p = tmp_path / "runs" / "s.json"
    p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps(run))
    return p


def test_the_gate_reads_the_territory_text_not_only_the_category_and_the_assumed_brief(env, tmp_path):   # env sets the key: no vacuous stop
    p = sensitive_run(tmp_path)
    code, rw, llm = go(p, *LIVE)
    assert code == 2 and rw.posts == [] and llm.calls == []


def test_reviewed_flag_alone_no_longer_opens_the_gate(env, capsys):
    env.write_text(json.dumps(make_run(suicide=True)))
    with pytest.raises(SystemExit):
        go(env, "--reviewed", *LIVE)


def test_review_is_a_named_record_bound_to_the_run_and_a_changed_run_needs_a_new_one(env):
    env.write_text(json.dumps(make_run(suicide=True)))
    code, rw, _ = go(env, "--reviewed-by", "Sai", *LIVE)
    rec = json.loads(env.with_name("jam.safe-review.json").read_text())
    assert code == 0 and rw.posts and rec["reviewer"] == "Sai" and rec["run_sha256_12"] == plan_mod.run_hash(env) and rec["date"]
    code, rw2, _ = go(env, *LIVE)                                         # the record on disk is enough on the next run
    assert code == 0
    run = json.loads(env.read_text())
    run["territories"][0]["line"] += " (edited)"
    env.write_text(json.dumps(run))
    code, rw3, llm3 = go(env, *LIVE)                                      # the run changed after the review: blocked again
    assert code == 2 and rw3.posts == [] and llm3.calls == []


def test_an_empty_reviewer_name_is_refused(env):
    env.write_text(json.dumps(make_run(suicide=True)))
    code, rw, _ = go(env, "--reviewed-by", "  ", *LIVE)
    assert code == 2 and rw.posts == []


# ------------------------------------------------------------------------------------------ cost caps and the card

def test_the_default_cap_is_two_dollars_and_a_card_over_the_cap_stops_before_any_call(env, capsys):
    code, rw, llm = go(env, "--max-usd", "0.50", *LIVE)                   # 56 credits ($0.56) plus the plan call
    assert code == 2 and rw.posts == [] and llm.calls == [] and "cap" in capsys.readouterr().out
    code, rw, llm = go(env, *LIVE)                                        # the default cap ($2.00) covers it
    assert code == 0 and len(rw.posts) == 8
    assert runway.DEFAULT_MAX_USD == 2.0


def test_the_card_shows_the_cap(env, capsys):
    go(env)
    assert "cap $2.00" in capsys.readouterr().out


def test_generate_stops_creating_tasks_at_the_credit_cap(tmp_path):
    rw = FakeRunway()
    jobs = [{"key": f"s{i}-f1-flash", "tid": f"s{i}", "shot": "f1", "kind": "quick", "prompt": "p"} for i in range(5)]
    res = runway.generate(runway.Client(KEY, rw), jobs, tmp_path, runway.load_manifest(tmp_path), [], sleep=lambda s: None, max_credits=14, log=lambda *a: None)
    assert len(rw.posts) == 2 and "cap" in res["stopped"]


def test_generate_stops_when_runway_estimates_more_than_the_card(tmp_path):
    class Dear(FakeRunway):
        def __call__(self, method, url, headers, body):
            s, raw = super().__call__(method, url, headers, body)
            if method == "POST":
                raw = json.dumps({"id": f"task-{len(self.posts)}", "estimatedCost": {"credits": 70}}).encode()
            return s, raw
    rw = Dear()
    jobs = [{"key": f"s{i}-f1-flash", "tid": f"s{i}", "shot": "f1", "kind": "quick", "prompt": "p"} for i in range(5)]
    res = runway.generate(runway.Client(KEY, rw), jobs, tmp_path, runway.load_manifest(tmp_path), [], sleep=lambda s: None, max_credits=500, log=lambda *a: None)
    assert len(rw.posts) == 1 and "estimate" in res["stopped"]


@pytest.mark.parametrize("status", [401, 402, 403])
def test_generate_stops_on_a_refused_key_or_no_credit_instead_of_trying_every_frame(tmp_path, status):
    posts = []
    def deny(method, url, headers, body):
        posts.append(url)
        return status, b'{"error": "no"}'
    jobs = [{"key": f"s{i}-f1-flash", "tid": f"s{i}", "shot": "f1", "kind": "quick", "prompt": "p"} for i in range(5)]
    res = runway.generate(runway.Client(KEY, deny), jobs, tmp_path, runway.load_manifest(tmp_path), [], sleep=lambda s: None, log=lambda *a: None)
    assert len(posts) == 1 and res["stopped"]


def test_a_frame_that_keeps_failing_is_given_up_on_after_three_attempts(env, capsys):
    go(env, *LIVE, rw=FakeRunway(fail_ids=("task-3",)))
    go(env, *LIVE, rw=FakeRunway(fail_ids=("task-1",)))
    go(env, *LIVE, rw=FakeRunway(fail_ids=("task-1",)))
    capsys.readouterr()
    code, rw, _ = go(env, *LIVE)
    assert rw.posts == [] and "given up" in capsys.readouterr().out


def test_a_task_with_no_output_url_is_an_error_not_a_crash(tmp_path):
    class Empty(FakeRunway):
        def __call__(self, method, url, headers, body):
            if method == "GET" and "/tasks/" in url:
                return 200, json.dumps({"id": "t", "status": "SUCCEEDED", "output": []}).encode()
            if not url.startswith("http"):
                raise ValueError("unknown url type: " + repr(url))      # what the real urllib transport does with an empty URL
            return super().__call__(method, url, headers, body)
    jobs = [{"key": "s1-f1-flash", "tid": "s1", "shot": "f1", "kind": "quick", "prompt": "p"}]
    res = runway.generate(runway.Client(KEY, Empty()), jobs, tmp_path, runway.load_manifest(tmp_path), [], sleep=lambda s: None, max_rounds=1, log=lambda *a: None)
    assert res["still_running"] == ["s1-f1-flash"]


def test_live_llm_stops_at_its_dollar_cap(monkeypatch):
    from deck import stages
    monkeypatch.setattr(stages, "_call", lambda stage, user, system: ({}, {"usd": 0.6, "model": "m"}))
    live = LiveLLM(approved=True, max_usd=1.0)
    live("frames_plan", "s", "u")
    live("frames_plan", "s", "u")                                          # 1.2 spent: over the cap now
    with pytest.raises(RuntimeError, match="cap"):
        live("frames_plan", "s", "u")


# ---------------------------------------------------------------------------------- the dry run proves up to the call

def test_the_dry_run_prints_the_exact_request_it_would_send_and_sends_nothing(env, tmp_path, capsys):
    go(env, "--live", "--yes-cost", "--plan-only")
    capsys.readouterr()
    code, rw, llm = go(env, "--style", str(demo_pack(tmp_path)))
    out = capsys.readouterr().out
    assert code == 0 and rw.posts == [] and rw.gets == [] and llm.calls == []
    assert "REQUEST PREVIEW" in out and "gemini_image3.1_flash" in out and "1344:768" in out and "Frame 1 of s1" in out and "loose ink wash" in out
    assert "referenceImages: 1" in out and "prompt sha256" in out and "style default" not in out
    assert "RUNWAYML_API_SECRET" not in out and KEY not in out


def test_the_dry_run_with_no_plan_says_so_and_calls_no_model(env, capsys):
    code, rw, llm = go(env)
    out = capsys.readouterr().out
    assert llm.calls == [] and "frame plan not made yet" in out and "REQUEST PREVIEW" in out


# ---------------------------------------------------------------------------------------- the blind pack stays fair

def test_a_blind_pack_with_an_empty_arm_is_refused_because_it_shows_which_set_is_which():
    pipe = [{"name": f"p{i}", "thought": "t", "why": "w", "score": {"total": i}} for i in range(5)]
    with pytest.raises(ValueError, match="empty"):
        compare.blind_pack(pipe, [], seed=1)
    with pytest.raises(ValueError, match="empty"):
        compare.blind_pack([], [{"name": "b", "thought": "t", "why": "w"}], seed=1)


def test_the_plain_prompt_that_skips_proposition_or_tension_is_warned_about():
    base = [{"name": "b", "thought": "a long paragraph", "why": "another", "proposition": "One thought."}]
    assert compare.shape_warnings(base) and "tension" in compare.shape_warnings(base)[0]
    assert compare.shape_warnings([{"name": "b", "proposition": "p", "tension": "X, but Y."}]) == []


# -------------------------------------------------------------------------------------------- nothing client in git

def test_frames_and_plans_are_gitignored_so_client_pictures_are_never_committed():
    root = Path(__file__).resolve().parents[3]
    text = (root / ".gitignore").read_text()
    assert "*.frames/" in text and "*.frames-plan.json" in text and "*.safe-review.json" in text


def test_no_real_brand_is_named_in_the_territory_code():
    here = Path(__file__).resolve().parents[1]
    for p in list(here.rglob("*.py")) + list(here.rglob("*.md")):
        if p.name == "test_review.py":
            continue
        assert "guinness" not in p.read_text().lower(), p


# --------------------------------------------- a create that may have reached Runway is UNKNOWN, never paid for twice

class Dies(BaseException):
    """Stands in for the process being killed mid-request."""


class TimesOutOn(FakeRunway):
    def __init__(self, nth: int, exc=TimeoutError("timed out"), **kw):
        super().__init__(**kw)
        self.nth, self.exc, self.seen = nth, exc, 0

    def __call__(self, method, url, headers, body):
        if method == "POST" and url.endswith("/text_to_image"):
            self.seen += 1
            if self.seen == self.nth:
                raise self.exc
        return super().__call__(method, url, headers, body)


def _jobs(n=3):
    return [{"key": f"s{i}-f1-flash", "tid": f"s{i}", "shot": "f1", "kind": "quick", "prompt": f"p{i}"} for i in range(1, n + 1)]


def test_a_create_timeout_is_unknown_and_is_never_created_again(tmp_path):
    rw = TimesOutOn(2)
    man = runway.load_manifest(tmp_path)
    res = runway.generate(runway.Client(KEY, rw), _jobs(), tmp_path, man, [], sleep=lambda s: None, log=lambda *a: None)
    assert res["unknown"] == ["s2-f1-flash"] and man["frames"]["s2-f1-flash"]["status"] == "UNKNOWN" and res["stopped"]
    assert runway.state(_jobs()[1], man, tmp_path) == "unknown"
    rw2 = FakeRunway()
    res2 = runway.generate(runway.Client(KEY, rw2), _jobs(), tmp_path, runway.load_manifest(tmp_path), [], sleep=lambda s: None, log=lambda *a: None)
    assert [json.loads(b)["promptText"] if isinstance(b, (bytes, str)) else b["promptText"] for b in rw2.posts] == ["p3"]    # s2 is NOT created again
    assert res2["unknown"] == ["s2-f1-flash"]


@pytest.mark.parametrize("exc", [ConnectionResetError("reset"), OSError("network down"), ValueError("not json")])
def test_any_failure_after_the_post_left_the_client_is_unknown_not_failed(tmp_path, exc):
    man = runway.load_manifest(tmp_path)
    res = runway.generate(runway.Client(KEY, TimesOutOn(1, exc)), _jobs(1), tmp_path, man, [], sleep=lambda s: None, log=lambda *a: None)
    assert man["frames"]["s1-f1-flash"]["status"] == "UNKNOWN" and res["unknown"]


def test_a_server_error_on_create_is_unknown_but_a_client_error_is_a_plain_failure(tmp_path):
    for status, want in ((503, "UNKNOWN"), (400, "FAILED")):
        d = tmp_path / str(status)
        man = runway.load_manifest(d)
        runway.generate(runway.Client(KEY, lambda m, u, h, b, s=status: (s, b'{"error": "x"}')), _jobs(1), d, man, [], sleep=lambda s: None, log=lambda *a: None)
        assert man["frames"]["s1-f1-flash"]["status"] == want


def test_the_creating_marker_is_on_disk_and_synced_before_the_post(tmp_path, monkeypatch):
    synced, seen = [], {}
    real = __import__("os").fsync
    monkeypatch.setattr("os.fsync", lambda fd: synced.append(fd) or real(fd))

    def spy(method, url, headers, body):
        if method == "POST":
            seen["disk"] = runway.load_manifest(tmp_path)["frames"]["s1-f1-flash"]["status"]
            seen["synced"] = len(synced)
            raise Dies()
        return 404, b"{}"
    with pytest.raises(Dies):
        runway.generate(runway.Client(KEY, spy), _jobs(1), tmp_path, runway.load_manifest(tmp_path), [], sleep=lambda s: None, log=lambda *a: None)
    assert seen["disk"] == "CREATING" and seen["synced"] >= 1
    rw = FakeRunway()                                                         # the process died mid-request: next run must not re-create it
    res = runway.generate(runway.Client(KEY, rw), _jobs(1), tmp_path, runway.load_manifest(tmp_path), [], sleep=lambda s: None, log=lambda *a: None)
    assert rw.posts == [] and res["unknown"] == ["s1-f1-flash"]


def test_the_card_counts_unknown_jobs_and_warns_they_may_be_billed(env, capsys):
    go(env, *LIVE, rw=TimesOutOn(3))
    capsys.readouterr()
    code, rw, _ = go(env)
    out = capsys.readouterr().out
    assert "1 unknown" in out and "may already be billed" in out and "--retry-unknown" in out


def test_retry_unknown_without_a_live_card_is_refused_and_creates_nothing(env, capsys):
    go(env, *LIVE, rw=TimesOutOn(3))
    for argv in (("--retry-unknown",), ("--retry-unknown", "--live"), ("--retry-unknown", "--yes-cost")):
        code, rw, _ = go(env, *argv)
        out = capsys.readouterr().out
        assert code == 2 and rw.posts == [] and "RUNWAY COST CARD" in out and "--live --yes-cost" in out


def test_retry_unknown_with_the_card_creates_the_unknown_job_once_and_a_plain_run_never_does(env, capsys):
    go(env, *LIVE, rw=TimesOutOn(3))                                          # stops at the timeout: job 3 unknown, jobs 4 to 8 never sent
    capsys.readouterr()
    code, plain, _ = go(env, *LIVE)                                           # no flag: the five never-sent jobs only, not the unknown one
    assert code == 0 and len(plain.posts) == 5 and "unknown" in capsys.readouterr().out
    code, rw, _ = go(env, "--retry-unknown", *LIVE)
    out = capsys.readouterr().out
    assert code == 0 and len(rw.posts) == 1 and "1 new x  7 credits =    7 credits" in out
    code, rw2, _ = go(env, "--retry-unknown", *LIVE)
    assert rw2.posts == []                                                    # nothing left unknown


def test_retry_unknown_must_fit_inside_max_usd(env):
    go(env, *LIVE, rw=TimesOutOn(3))
    code, rw, _ = go(env, "--retry-unknown", "--max-usd", "0.01", *LIVE)
    assert code == 2 and rw.posts == []
