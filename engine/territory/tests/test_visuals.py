"""Offline tests for frames per territory (territory/visuals). A fake Runway and a fake Ollama stand in for the paid and
local services; a FakeLLM stands in for the one frame-plan call. Every brand and territory here is invented.
Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q territory/tests``."""
from __future__ import annotations

import base64
import contextlib
import io
import json
import re
import urllib.error

import pytest

from territory import cards, pipeline
from territory.llm import FakeLLM
from territory.visuals import board, plan as plan_mod
from visuals import guard, policy, runway, safety, style as style_mod
from territory.visuals.cli import main

KEY = "rwy-test-secret-0123456789"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


def make_run(suicide: bool = False) -> dict:
    ab = {"fields": [{"key": "background", "value": "A suicide prevention helpline wants more calls" if suicide else "A jam brand wants younger buyers", "tag": "given"}]}
    terr = [{"id": "s1", "line": "The first jar in her fridge", "tier": "brave", "proposition": "Her loyalty starts with the first jar.", "tension_text": "Trusted, but her parents' jar.",
             "mechanism": "a series of fridges", "score": {"total": 28, "of": 35}, "ready": True},
            {"id": "s2", "line": "Honest from the jar", "tier": "safe", "proposition": "Honest from the jar.", "tension_text": "Heritage, but unproven.",
             "mechanism": "plain honesty", "score": {"total": 20, "of": 35}, "ready": False}]
    return {"status": "proceed", "gate": {"category": "helplines" if suicide else "condiments", "market": "IE", "why": "ok"}, "assumed_brief": ab, "territories": terr,
            "material": {"origin": "invented", "brief": False, "brief_kind": None, "marks": [], "brand": None}}      # every run here is invented


PLACES = {1: "kitchen", 2: "garden", 3: "street", 4: "market"}
THINGS = {"s1": "jar", "s2": "bottle"}


def shot_framing(tid: str, i: int) -> str:
    return f"A wide view of a {PLACES[i]} with a {THINGS[tid]}"


def plan_output(extra_action: str = "") -> dict:
    """Shots in plain common words (no digits, names or quotes): what the picture-prompt lint lets through."""
    return {"territories": [{"id": tid, "shots": [{"shot": f"f{i}", "framing": shot_framing(tid, i), "camera": "eye level, warm light",
                                                  "action": f"A person opens a cupboard in the {PLACES[i]}{extra_action if i == 1 else ''}", "on_screen_line": f"line {i}"}
                                                 for i in range(1, 5)]}
                            for tid in ("s1", "s2")]}


class FakeRunway:
    """POST /text_to_image makes a task; GET /tasks/{id} says RUNNING once, then SUCCEEDED with an output URL; GET <url> gives PNG bytes."""

    def __init__(self, finish_after: int = 2, fail_ids: tuple = ()):
        self.posts, self.gets, self.headers, self.tasks = [], [], [], {}
        self.finish_after, self.fail_ids = finish_after, fail_ids

    def __call__(self, method, url, headers, body):
        if method == "POST" and url.endswith("/text_to_image"):
            b = json.loads(body)
            self.posts.append(b)
            self.headers.append(headers)
            tid = f"task-{len(self.posts)}"
            self.tasks[tid] = {"polls": 0}
            return 200, json.dumps({"id": tid, "estimatedCost": {"credits": 7}}).encode()
        if method == "GET" and "/tasks/" in url:
            tid = url.rsplit("/", 1)[1]
            self.gets.append(tid)
            t = self.tasks[tid]
            t["polls"] += 1
            if tid in self.fail_ids:
                return 200, json.dumps({"id": tid, "status": "FAILED", "failure": "content moderation"}).encode()
            if t["polls"] < self.finish_after:
                return 200, json.dumps({"id": tid, "status": "RUNNING"}).encode()
            return 200, json.dumps({"id": tid, "status": "SUCCEEDED", "output": [f"https://cdn.example/{tid}.png"], "cost": {"credits": 7}}).encode()
        if method == "GET" and url.startswith("https://cdn.example/"):
            return 200, PNG + url.rsplit("/", 1)[1].encode()      # unique bytes per task, so the fake Ollama can pick one
        return 404, b"{}"


def clean_ollama(url, body):
    return {"message": {"content": json.dumps({"readable_text": [], "logos_or_brands": [], "banned_imagery": []})}}


def flag_task(task_id: str):
    def post(url, body):
        png = base64.b64decode(body["messages"][0]["images"][0])
        found = ["ACMELOGO"] if task_id.encode() in png else []
        return {"message": {"content": json.dumps({"readable_text": [], "logos_or_brands": found, "banned_imagery": []})}}
    return post


def ollama_down(url, body):
    raise urllib.error.URLError("connection refused")


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv(runway.KEY_ENV, KEY)
    monkeypatch.delenv("BRIEF_CLAUDE_TRANSPORT", raising=False)
    monkeypatch.setenv(policy.ENV, "allow")                  # most tests send client-derived shots: the testers' override, not whatever this shell has set (the default is refuse)
    run_path = tmp_path / "runs" / "jam.json"
    run_path.parent.mkdir()
    run_path.write_text(json.dumps(make_run(), indent=1))
    return run_path


def card_id(run_path, argv, **kw) -> str:
    """The id the card shows for these flags: a dry run (no call), read the way a person reads the card."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        main(["--from-run", str(run_path), *argv], llm_factory=lambda: FakeLLM({}), transport=FakeRunway(), guard_post=clean_ollama, sleep=lambda s: None,
             poll_every=0, **kw)
    m = re.search(r"card (c_[0-9a-f]{16})", buf.getvalue())
    return m.group(1) if m else "c_0000000000000000"


def go(run_path, *argv, rw=None, llm=None, ollama=clean_ollama, **kw):
    """Run the CLI with fakes. A bare ``--yes-cost`` beside ``--live`` is the yes of a person who has just read the card: it is filled in
    with the id a dry run of the same flags shows. The spend ledger lives beside the run in a test (outside the frames folder)."""
    rw = rw or FakeRunway()
    llm = llm or FakeLLM({"frames_plan": plan_output()})
    kw.setdefault("ledger_path", run_path.parent / "spend-ledger.jsonl")
    argv = list(argv)
    if "--live" in argv and "--yes-cost" in argv:
        i = argv.index("--yes-cost")
        if i == len(argv) - 1 or argv[i + 1].startswith("--"):
            argv.insert(i + 1, card_id(run_path, [x for x in argv if x not in ("--live", "--yes-cost")], **kw))
    code = main(["--from-run", str(run_path), *argv], llm_factory=lambda: llm, transport=rw, guard_post=ollama, sleep=lambda s: None, poll_every=0, **kw)
    return code, rw, llm


def style_pack(tmp_path, name="style", n_images=2, look="rough pencil, warm"):
    d = tmp_path / name
    d.mkdir(exist_ok=True)
    (d / "style.yaml").write_text(f"look: [{look}]\npalette: [ochre, slate]\nthis_not_that:\n  - {{this: quiet kitchens, not: stock smiles}}\nfinish: rough\nbanned_imagery: [crowds]\n"
                                   + ("references:\n" + "".join(f"  ref{i:02d}.png: {{rights: own, why: invented test image, by: 'human:demo'}}\n" for i in range(n_images)) if n_images else ""))
    for i in range(n_images):
        (d / f"ref{i:02d}.png").write_bytes(PNG + bytes([i]))
    return d


LIVE = ("--live", "--yes-cost")


# ------------------------------------------------------------------------------------------------- the text is frozen

def test_text_is_frozen_and_the_pipeline_never_runs(env, monkeypatch, tmp_path):
    def boom(*a, **k):
        raise AssertionError("the text pipeline must not run")
    monkeypatch.setattr(pipeline, "run", boom)
    before = env.read_bytes()
    code, rw, llm = go(env, *LIVE)
    assert code == 0
    assert env.read_bytes() == before                                   # byte for byte
    assert llm.calls == ["frames_plan"]                                 # the only model call
    frames = json.loads(next((env.parent / "jam.frames").glob("v1-*/frames.json")).read_text())
    run = json.loads(before)
    for c, t in zip(frames["cards"], run["territories"]):               # text, tiers, scores come through unchanged
        assert (c["name"], c["thought"], c["tier"], c["score"]) == (t["line"], t["proposition"], t["tier"], t["score"])
        assert len(c["frames"]) == 4


def test_card_without_frames_keeps_its_old_shape_and_has_empty_frames():
    c = cards.cards(make_run())[0]
    assert c["frames"] == [] and c["visual"] is None and c["thought"] == "Her loyalty starts with the first jar."


# ------------------------------------------------------------------------------------- the plan: one call, then reused

def test_plan_is_one_call_saved_and_reused(env):
    go(env, *LIVE)
    p = plan_mod.plan_path(env)
    assert p.exists() and len(json.loads(p.read_text())["territories"]["s1"]) == 4
    code, rw, llm = go(env, *LIVE)
    assert llm.calls == []                                              # reused: no second model call


def test_plan_with_too_few_shots_saves_nothing(env):
    bad = plan_output()
    bad["territories"][0]["shots"] = bad["territories"][0]["shots"][:3]
    with pytest.raises(plan_mod.PlanError):
        go(env, *LIVE, llm=FakeLLM({"frames_plan": bad}))
    assert not plan_mod.plan_path(env).exists()


def test_plan_only_makes_the_plan_and_no_runway_call(env):
    code, rw, llm = go(env, "--live", "--yes-cost", "--plan-only")
    assert llm.calls == ["frames_plan"] and rw.posts == [] and plan_mod.plan_path(env).exists()


# ------------------------------------------------------------------------- a style change regenerates images only

def test_style_change_regenerates_images_only(env, tmp_path):
    a = style_pack(tmp_path, "a")
    go(env, "--style", str(a), *LIVE)
    run_bytes, plan_bytes = env.read_bytes(), plan_mod.plan_path(env).read_bytes()
    b = style_pack(tmp_path, "b", look="loose ink wash, cool")
    code, rw2, llm2 = go(env, "--style", str(b), *LIVE)
    assert llm2.calls == []                                             # no plan call
    assert env.read_bytes() == run_bytes and plan_mod.plan_path(env).read_bytes() == plan_bytes
    folders = sorted(p.name for p in (env.parent / "jam.frames").iterdir() if p.is_dir())
    assert len(folders) == 2 and folders[0].startswith("v1-") and folders[1].startswith("v2-") and folders[0] != folders[1]
    assert all(len(list((env.parent / "jam.frames" / f).glob("*.png"))) == 8 for f in folders)    # the old version is kept
    assert len(rw2.posts) == 8                                          # all images made again, in the new folder
    assert "loose ink wash" in rw2.posts[0]["promptText"] and "loose ink wash" not in json.dumps(json.loads(plan_bytes))


def test_same_style_goes_to_the_same_version_and_a_new_reference_image_changes_the_hash(tmp_path):
    a = style_pack(tmp_path, "a")
    h = style_mod.load(a).hash
    assert style_mod.load(a).hash == h
    (a / "ref00.png").write_bytes(PNG + b"changed")
    assert style_mod.load(a).hash != h
    (a / "style.yaml").write_text((a / "style.yaml").read_text().replace("ochre", "rust"))
    assert style_mod.load(a).hash not in (h,)


def test_style_prompt_has_shot_style_and_guard_rails_but_not_the_on_screen_line(env, tmp_path):
    code, rw, _ = go(env, "--style", str(style_pack(tmp_path)), *LIVE)
    p = rw.posts[0]["promptText"]
    for want in (shot_framing("s1", 1), "rough pencil", "ochre", "quiet kitchens, not stock smiles", "rough", "crowds", style_mod.GUARD_RAILS):
        assert want in p
    assert "line 1" not in p                                            # words in a prompt become words in the picture
    assert rw.posts[0]["ratio"] == "1344:768" and rw.posts[0]["model"] == "gemini_image3.1_flash"


def test_style_yaml_problems_are_loud(tmp_path):
    d = tmp_path / "s"
    d.mkdir()
    (d / "style.yaml").write_text("look: [x]\nmoood: bad\n")
    with pytest.raises(style_mod.StyleError, match="unknown key"):
        style_mod.load(d)
    (d / "style.yaml").write_text("finish: glossy\n")
    with pytest.raises(style_mod.StyleError, match="finish"):
        style_mod.load(d)
    (tmp_path / "empty").mkdir()
    with pytest.raises(style_mod.StyleError, match="no style.yaml"):
        style_mod.load(tmp_path / "empty")


# --------------------------------------------------------------------------------------------- reference image cap

def test_reference_images_are_capped_at_14_and_the_rest_named(env, tmp_path, capsys):
    d = style_pack(tmp_path, n_images=16)
    code, rw, _ = go(env, "--style", str(d), *LIVE)
    refs = rw.posts[0]["referenceImages"]
    assert len(refs) == 14 and all(r["uri"].startswith("data:image/png;base64,") for r in refs)
    assert [r["tag"] for r in refs][:2] == ["ref01", "ref02"]
    out = capsys.readouterr().out
    assert "at most 14" in out and "ref14.png" in out and "ref15.png" in out
    assert len(style_mod.load(d).ignored_references) == 2


def test_client_refuses_more_than_14_references():
    with pytest.raises(runway.RunwayError, match="at most 14"):
        runway.Client(KEY, FakeRunway()).create("gemini_image3_pro", "p", [{"uri": "data:image/png;base64,AA=="}] * 15)


def test_a_reference_image_over_5mb_is_refused(tmp_path):
    d = style_pack(tmp_path, n_images=0)
    (d / "style.yaml").write_text((d / "style.yaml").read_text() + "references:\n  big.png: {rights: own, why: invented test image, by: 'human:demo'}\n")
    (d / "big.png").write_bytes(b"0" * (4 * 1024 * 1024))              # 4MB raw is over 5MB once base64 encoded
    with pytest.raises(style_mod.StyleError, match="5MB"):
        style_mod.reference_images(style_mod.load(d))


# ------------------------------------------------------------------------------------------------------ idempotency

def test_second_run_makes_no_new_tasks(env):
    code, rw, _ = go(env, *LIVE)
    assert len(rw.posts) == 8
    code, rw2, llm2 = go(env, *LIVE)
    assert rw2.posts == [] and rw2.gets == [] and llm2.calls == []      # saved frames are skipped, not even polled


def test_an_existing_task_is_polled_not_created_again(tmp_path):
    rw = FakeRunway(finish_after=3)
    vdir = tmp_path / "v1"
    jobs = [{"key": "s1-f1-flash", "tid": "s1", "shot": "f1", "kind": "quick", "prompt": "p"}]
    manifest = runway.load_manifest(vdir)
    r1 = runway.generate(runway.Client(KEY, rw), jobs, vdir, manifest, [], sleep=lambda s: None, max_rounds=1, log=lambda *a: None)
    assert r1["created"] == 1 and r1["still_running"] == ["s1-f1-flash"] and not (vdir / "s1-f1-flash.png").exists()
    resumed = runway.load_manifest(vdir)                                # a new process: the task id is in the manifest
    assert runway.state(jobs[0], resumed, vdir) == "polling"
    r2 = runway.generate(runway.Client(KEY, rw), jobs, vdir, resumed, [], sleep=lambda s: None, log=lambda *a: None)
    assert r2["created"] == 0 and len(rw.posts) == 1 and (vdir / "s1-f1-flash.png").exists()


def test_failed_task_is_created_again_on_the_next_run_and_others_are_kept(env):
    code, rw, _ = go(env, *LIVE, rw=FakeRunway(fail_ids=("task-3",)))
    man = json.loads(next((env.parent / "jam.frames").glob("v1-*/manifest.json")).read_text())
    assert sum(1 for e in man["frames"].values() if e.get("file")) == 7
    code, rw2, _ = go(env, *LIVE)
    assert len(rw2.posts) == 1                                          # only the one that failed


# ------------------------------------------------------------------------------------------------------ the key

def test_key_comes_only_from_the_environment(tmp_path, monkeypatch):
    monkeypatch.delenv(runway.KEY_ENV, raising=False)
    monkeypatch.delenv("RUNWAY_API_KEY", raising=False)
    (tmp_path / ".env").write_text(f"{runway.KEY_ENV}=from-dotenv\nRUNWAY_API_KEY=from-dotenv\n")
    monkeypatch.chdir(tmp_path)
    with pytest.raises(runway.RunwayError, match="never reads .env"):
        runway.api_key()
    monkeypatch.setenv("RUNWAY_API_KEY", "other-name")                  # no fallback name either
    with pytest.raises(runway.RunwayError):
        runway.api_key()
    monkeypatch.setenv(runway.KEY_ENV, KEY)
    assert runway.api_key() == KEY


def test_live_run_without_the_key_stops_before_any_call(env, monkeypatch, capsys):
    monkeypatch.delenv(runway.KEY_ENV)
    code, rw, llm = go(env, *LIVE)
    assert code == 2 and rw.posts == [] and llm.calls == []             # not even the plan call is paid for
    assert "RUNWAYML_API_SECRET" in capsys.readouterr().out


def test_key_is_sent_as_a_bearer_header_and_never_printed_or_saved(env, capsys):
    code, rw, _ = go(env, *LIVE)
    assert rw.headers[0]["Authorization"] == f"Bearer {KEY}" and rw.headers[0]["X-Runway-Version"] == "2024-11-06"
    out = capsys.readouterr()
    assert KEY not in out.out + out.err
    for p in env.parent.rglob("*"):
        if p.is_file() and p.suffix in (".json", ".html"):
            assert KEY not in p.read_text()


def test_an_error_that_echoes_the_key_is_scrubbed():
    echo = lambda m, u, h, b: (401, f"bad key {KEY}".encode())
    with pytest.raises(runway.RunwayError) as e:
        runway.Client(KEY, echo).task("t")
    assert KEY not in str(e.value) and "***" in str(e.value)


# -------------------------------------------------------------------------- cost card, and no live call without the flags

def test_dry_run_and_half_flags_make_no_call_and_show_the_card(env, capsys):
    for argv in ((), ("--live",), ("--yes-cost",)):
        code, rw, llm = go(env, *argv)
        out = capsys.readouterr().out
        assert code == 0 and rw.posts == [] and rw.gets == [] and llm.calls == [] and not plan_mod.plan_path(env).exists()
        assert "RUNWAY COST CARD" in out and "56 credits" in out and "$0.56" in out      # 2 territories x 4 frames x 7 credits


def test_live_without_yes_cost_says_so(env, capsys):
    go(env, "--live")
    assert "--yes-cost" in capsys.readouterr().out


def test_shortlist_uses_the_best_model_and_the_card_prices_it(env, capsys):
    go(env)                                                             # dry run only
    code, rw, _ = go(env, "--shortlist", "s2", *LIVE)
    assert {p["model"] for p in rw.posts[:4]} == {"gemini_image3.1_flash"} and {p["model"] for p in rw.posts[4:]} == {"gemini_image3_pro"}
    out = capsys.readouterr().out
    assert "4 new x  7 credits =   28 credits" in out and "4 new x 20 credits =   80 credits" in out and "108 credits = $1.08" in out


def test_unknown_shortlist_id_is_refused(env):
    code, rw, _ = go(env, "--shortlist", "nope", *LIVE)
    assert code == 2 and rw.posts == []


# ------------------------------------------------------------------------------------------------- the guard check

def test_flagged_frame_is_marked_and_kept_out_of_the_deck_slot(env):
    code, rw, _ = go(env, *LIVE, ollama=flag_task("task-1"))
    vdir = next((env.parent / "jam.frames").glob("v1-*"))
    man = json.loads((vdir / "manifest.json").read_text())
    flagged = [k for k, e in man["frames"].items() if e["guard"]["flagged"]]
    assert flagged == ["s1-f1-flash"] and "ACMELOGO" in man["frames"]["s1-f1-flash"]["guard"]["reason"]
    cs = json.loads((vdir / "frames.json").read_text())["cards"]
    s1 = cs[0]
    assert s1["frames"][0]["flagged"] is True and all(not f["flagged"] for f in s1["frames"][1:])
    assert s1["visual"]["image"] == s1["frames"][1]["path"]             # the deck slot skips the flagged one
    html = (vdir / "board.html").read_text()
    assert "needs a person" in html and "ACMELOGO" in html


def test_person_can_approve_a_flagged_frame_and_retry_regenerates_only_flagged(env):
    go(env, *LIVE, ollama=flag_task("task-1"))
    code, rw, _ = go(env, "--approve", "s1-f1-flash", "--approved-by", "Sai", *LIVE)
    vdir = next((env.parent / "jam.frames").glob("v1-*"))
    assert rw.posts == [] and json.loads((vdir / "frames.json").read_text())["cards"][0]["frames"][0]["flagged"] is False


def test_retry_flagged_makes_only_the_flagged_frame_again(env):
    go(env, *LIVE, ollama=flag_task("task-1"))
    code, rw, _ = go(env, "--retry-flagged", *LIVE, rw=FakeRunway())
    assert len(rw.posts) == 1
    vdir = next((env.parent / "jam.frames").glob("v1-*"))
    assert (vdir / "s1-f1-flash.flagged-1.png").exists() and (vdir / "s1-f1-flash.png").exists()


def test_guard_skips_cleanly_when_ollama_is_down(env, capsys):
    code, rw, _ = go(env, *LIVE, ollama=ollama_down)
    out = capsys.readouterr().out
    assert code == 0 and "Guard check skipped" in out and len(rw.posts) == 8
    vdir = next((env.parent / "jam.frames").glob("v1-*"))
    html = (vdir / "board.html").read_text()
    assert "not checked" in html and "needs a person" not in html       # not silently trusted: labelled
    code, rw2, _ = go(env, *LIVE, ollama=clean_ollama)                  # Ollama back: the unchecked frames are checked, none re-made
    assert rw2.posts == [] and "not checked" not in (vdir / "board.html").read_text()


def test_guard_unreadable_reply_is_flagged_not_trusted():
    r = guard.check_image(PNG, post=lambda u, b: {"message": {"content": "I think it is fine"}})
    assert r["checked"] and r["flagged"]


def test_guard_request_shape():
    seen = {}
    guard.check_image(PNG, ["bridge"], post=lambda u, b: seen.update(u=u, b=b) or {"message": {"content": "{}"}})
    b = seen["b"]
    assert seen["u"] == "http://127.0.0.1:11434/api/chat" and b["model"] == "qwen3.5:9b" and b["think"] is False and b["stream"] is False
    assert base64.b64decode(b["messages"][0]["images"][0]) == PNG and "bridge" in b["messages"][0]["content"]


# -------------------------------------------------------------------------------------------- the safe-messaging gate

def test_suicide_brief_gets_no_plan_and_no_frames_until_reviewed(env, capsys):
    env.write_text(json.dumps(make_run(suicide=True)))
    code, rw, llm = go(env, *LIVE)
    assert code == 2 and rw.posts == [] and llm.calls == [] and not plan_mod.plan_path(env).exists()
    assert "--reviewed-by" in capsys.readouterr().out
    assert not (env.parent / "jam.frames").exists()


def test_reviewed_run_proceeds_and_banned_imagery_is_in_every_prompt(env):
    env.write_text(json.dumps(make_run(suicide=True)))
    seen = []
    llm = FakeLLM({"frames_plan": lambda user: seen.append(user) or plan_output()})
    code, rw, _ = go(env, "--reviewed-by", "Sai", *LIVE, llm=llm)
    assert code == 0 and len(rw.posts) == 8
    for p in rw.posts:
        assert "Never show:" in p["promptText"] and "bridge" in p["promptText"] and "noose" in p["promptText"]
    assert "never_show" in seen[0] and "noose" in seen[0]               # the plan call is told too


def test_a_shot_that_names_banned_imagery_is_refused_not_painted(env):
    env.write_text(json.dumps(make_run(suicide=True)))
    llm = FakeLLM({"frames_plan": plan_output(" standing on a bridge at dusk")})
    code, rw, _ = go(env, "--reviewed-by", "Sai", *LIVE, llm=llm)
    assert len(rw.posts) == 6                                           # f1 of both territories is refused
    vdir = next((env.parent / "jam.frames").glob("v1-*"))
    man = json.loads((vdir / "manifest.json").read_text())
    assert man["frames"]["s1-f1-flash"]["status"] == "REFUSED"
    html = (vdir / "board.html").read_text()
    assert "needs a person" in html and "Safe-messaging category" in html


def test_ordinary_brief_is_not_gated(env):
    assert safety.check(make_run())["blocked"] is False
    assert safety.check(make_run(suicide=True))["blocked"] is True
    assert safety.check(make_run(suicide=True), reviewed=True)["blocked"] is False
    assert "bridge" in safety.check(make_run(suicide=True))["banned"]
    assert safety.check({"gate": {"category": "self-harm support"}})["applies"]


# ------------------------------------------------------------------------------------------------------- the board

def test_board_references_images_by_relative_path_and_deck_slot_keys(env):
    go(env, *LIVE)
    vdir = next((env.parent / "jam.frames").glob("v1-*"))
    html = (vdir / "board.html").read_text()
    assert "src='s1-f1-flash.png'" in html and str(env.parent) not in html
    assert html.count("<section") == 2 and html.count("<img") == 8
    c = json.loads((vdir / "frames.json").read_text())["cards"][0]
    f = c["frames"][0]
    assert set(f) >= {"path", "shot", "model", "style_version", "flagged"} and f["path"].startswith("jam.frames/v1-") and f["style_version"].startswith("v1-")
    assert c["visual"]["kind"] == "image_prompt" and c["visual"]["status"] == "illustrative, not final" and c["visual"]["image"] == f["path"]


def test_the_example_style_pack_loads():
    from pathlib import Path
    import territory.visuals as _tv
    d = Path(_tv.__file__).parent
    import shutil, tempfile
    with tempfile.TemporaryDirectory() as t:
        shutil.copy(d / "style.example.yaml", Path(t) / "style.yaml")
        s = style_mod.load(t)
    assert s.finish == "photo-real" and "ordinary kitchens and pavements, not studio sets" in s.this_not_that and s.references == []
