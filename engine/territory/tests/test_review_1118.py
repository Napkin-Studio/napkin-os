"""Tests for the 18 Nov 2026 review of the Territory tool (features/territory-tool.clan): the prompt lint and the Confidential deny-list on
every shot, the client-to-Runway policy (Sai, 18 Nov: allowed for testing; may change), card ids, the lifetime ledger, paid output saved
first, intake-checked tags and the style pack as the only visual driver. A fake Runway, a fake Ollama and a FakeLLM stand in for every
paid or local service; every brand, brief and mark here is invented. Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q territory/tests``."""
from __future__ import annotations

import contextlib
import io
import json
import re
import shutil

import pytest

from territory import cards, material, pipeline, run as run_mod
from territory.llm import FakeLLM, prompt
from territory.visuals import plan as plan_mod
from territory.visuals.cli import main
from visuals import jobs as vjobs, policy, runway, style as style_mod
from test_territory import outputs, task
from test_visuals import KEY, LIVE, FakeRunway, card_id, clean_ollama, env, flag_task, go, make_run, plan_output, style_pack  # noqa: F401

MARK = {"path": "insight", "text": "Project Quokka launches the sparkling bramble range", "kind": "confidential_field"}


def write_run(env, **material_block):
    run = make_run()
    run["material"] = {"origin": "invented", "brief": False, "brief_kind": None, "marks": [], "brand": None, **material_block}
    env.write_text(json.dumps(run))
    return env


def ledger_of(run_path):
    return vjobs.Ledger(run_path.parent / "spend-ledger.jsonl", "territory:" + plan_mod.run_hash(run_path))


def frames_manifest(run_path):
    return json.loads(next((run_path.parent / (run_path.stem + ".frames")).glob("v1-*/manifest.json")).read_text())


# ------------------------------------------------------------------------------- the policy switch (one place, said plainly)

def test_the_policy_is_one_switch_that_allows_for_testing_and_fails_closed_on_a_bad_value():
    assert policy.CLIENT_TO_RUNWAY == "allow" and "Sai 2026-11-18" in policy.DECIDED
    assert policy.client_to_runway({}) == "allow"
    assert policy.client_to_runway({policy.ENV: "refuse"}) == "refuse"
    assert policy.client_to_runway({policy.ENV: "maybe"}) == "refuse"
    assert "allowed (testing policy" in policy.label({}) and "refused (policy)" in policy.label({policy.ENV: "refuse"})


def test_the_card_and_the_manifest_say_which_policy_applied(env, capsys):
    write_run(env, origin="client")
    go(env)
    assert "Client-derived prompts -> Runway: allowed (testing policy" in capsys.readouterr().out
    code, rw, _ = go(env, *LIVE)
    m = frames_manifest(env)["material"]
    assert code == 0 and m["policy"] == "allow" and m["client_derived"] is True and "testing" in m["policy_label"]


# ------------------------------------------------------------------------------- allow: client-derived prompts go only after the lint

def test_allow_sends_client_derived_shots_only_after_the_lint(env):
    write_run(env, origin="client", brief=True, brief_kind="clan")
    llm = FakeLLM({"frames_plan": plan_output(" beside a zorblaxian gadget")})       # not a common word: never sent
    code, rw, _ = go(env, *LIVE, llm=llm)
    assert code == 0 and len(rw.posts) == 6                                          # f1 of both territories refused, the rest sent
    assert all("zorblaxian" not in p["promptText"] for p in rw.posts)
    e = frames_manifest(env)["frames"]["s1-f1-flash"]
    assert e["status"] == "REFUSED" and "allowed word list" in e["error"]


def test_a_shot_with_a_digit_or_a_brand_word_is_refused_for_invented_material_too(env):
    for extra in (" holding a nike bag", " with seven cups"):
        p = env.with_name(f"r{len(extra)}.json")
        p.write_text(json.dumps(make_run()))
        code, rw, _ = go(p, *LIVE, llm=FakeLLM({"frames_plan": plan_output(extra)}))
        assert code == 0 and len(rw.posts) == 6


# ------------------------------------------------------------------------------- refuse: client-derived prompts never go

def test_refuse_blocks_client_derived_runs_before_any_call(env, monkeypatch, capsys):
    monkeypatch.setenv(policy.ENV, "refuse")
    write_run(env, origin="client")
    code, rw, llm = go(env, *LIVE)
    out = capsys.readouterr().out
    assert code == 2 and rw.posts == [] and llm.calls == [] and "refused (policy)" in out and "client-derived" in out


def test_refuse_still_sends_material_a_person_marked_invented(env, monkeypatch):
    monkeypatch.setenv(policy.ENV, "refuse")
    code, rw, _ = go(write_run(env, origin="invented"), *LIVE)
    assert code == 0 and len(rw.posts) == 8


# ------------------------------------------------------------------------------- Confidential is blocked under both policies

@pytest.mark.parametrize("pol", ["allow", "refuse"])
def test_a_shot_that_draws_on_a_confidential_part_is_never_sent(env, monkeypatch, pol):
    monkeypatch.setenv(policy.ENV, pol)
    write_run(env, origin="client", brief=True, brief_kind="clan", marks=[MARK])
    code, rw, _ = go(env, *LIVE, llm=FakeLLM({"frames_plan": plan_output(" near the sparkling bramble range")}))
    assert all("bramble" not in p["promptText"] for p in rw.posts)
    if pol == "refuse":
        assert code == 2 and rw.posts == []                                          # client-derived: nothing at all
    else:
        assert code == 0 and len(rw.posts) == 6
        assert frames_manifest(env)["frames"]["s1-f1-flash"]["error"].endswith("would draw on a Confidential part")


@pytest.mark.parametrize("pol", ["allow", "refuse"])
def test_marks_that_cannot_be_known_refuse_the_frames_under_both_policies(env, monkeypatch, capsys, pol):
    monkeypatch.setenv(policy.ENV, pol)
    write_run(env, origin="client", brief=True, brief_kind="json", marks=None)
    code, rw, llm = go(env, *LIVE)
    assert code == 2 and rw.posts == [] and llm.calls == [] and "no mark data" in capsys.readouterr().out


def test_a_run_saved_before_the_material_flag_needs_a_named_declaration_bound_to_the_run(env, capsys):
    run = make_run()
    run.pop("material")
    env.write_text(json.dumps(run))
    code, rw, _ = go(env, *LIVE)
    assert code == 2 and rw.posts == [] and "--declared-by" in capsys.readouterr().out
    code, rw, _ = go(env, "--material", "demo", *LIVE)                                 # no name: refused
    assert code == 2 and rw.posts == []
    code, rw, _ = go(env, "--material", "demo", "--declared-by", "Sai", *LIVE)
    rec = json.loads(material.declaration_path(env).read_text())
    assert code == 0 and len(rw.posts) == 8 and rec["by"] == "Sai" and rec["run_sha256_12"] == plan_mod.run_hash(env)


def test_the_text_run_carries_the_brief_marks_into_the_run():
    b = material.block("client", "brief.clan", [MARK], "Acme")
    assert b["marks"] == [MARK] and b["brief_kind"] == "clan" and b["brand"] == "Acme"
    assert material.block(None, "brief_object.json", None)["marks"] is None              # unknown, not empty
    assert material.block("demo", None, None)["marks"] == [] and material.block("x", None, None)["origin"] == "unknown"


# ------------------------------------------------------------------------------- the yes is the card's id

def test_a_wrong_or_stale_card_id_is_refused(env, capsys):
    code, rw, llm = go(env, "--live", "--yes-cost", "c_deadbeefdeadbeef")
    assert code == 2 and rw.posts == [] and llm.calls == [] and "not this card's id" in capsys.readouterr().out
    first = card_id(env, [], ledger_path=env.parent / "spend-ledger.jsonl")
    go(env, *LIVE, rw=FakeRunway(), ollama=clean_ollama)
    code, rw, _ = go(env, "--live", "--yes-cost", first, "--retry-flagged")             # the card has changed since: refused
    assert code == 2 and rw.posts == []


def test_a_bare_yes_cost_makes_nothing(env, capsys):
    code, rw, llm = main(["--from-run", str(env), "--live", "--yes-cost"], llm_factory=lambda: FakeLLM({}), transport=FakeRunway(),
                         ledger_path=env.parent / "l.jsonl"), None, None
    assert code == 0 and "--yes-cost c_" in capsys.readouterr().out


# ------------------------------------------------------------------------------- the ledger: every attempt counts, for the run's lifetime

def test_a_retry_keeps_the_earlier_attempts_credits_and_a_deleted_folder_does_not_lower_the_spend(env):
    go(env, *LIVE, ollama=flag_task("task-1"))
    code, rw, _ = go(env, "--retry-flagged", *LIVE)
    assert code == 0 and len(rw.posts) == 1
    spent = vjobs.spent_usd({"jobs": {}}, ledger_of(env))
    assert abs(spent - (9 * 0.07 + plan_mod.estimate()["est_usd"])) < 1e-6           # nine pictures and the plan call
    e = frames_manifest(env)["frames"]["s1-f1-flash"]
    assert e["history"][0]["task"] == "task-1" and e["history"][0]["file"] == "s1-f1-flash.flagged-1.png"
    shutil.rmtree(env.parent / "jam.frames")
    assert vjobs.spent_usd({"jobs": {}}, ledger_of(env)) == spent


def test_the_cap_holds_across_runs_and_style_versions(env, tmp_path, capsys):
    code, rw, _ = go(env, "--max-usd", "0.70", *LIVE)                                  # 0.56 + the plan call
    assert code == 0 and len(rw.posts) == 8
    capsys.readouterr()
    code, rw, _ = go(env, "--style", str(style_pack(tmp_path)), "--max-usd", "0.70", *LIVE)
    assert code == 2 and rw.posts == [] and "already spent" in capsys.readouterr().out
    code, rw, _ = go(env, "--max-usd", "3", *LIVE)
    assert code == 2 and rw.posts == []                                                # never above $2.50


def test_frames_made_before_the_ledger_existed_count_against_the_cap(env, tmp_path):
    go(env, *LIVE, ledger_path=tmp_path / "before.jsonl")                             # stands in for the first live run, made before the ledger
    code, rw, _ = go(env, *LIVE, ledger_path=tmp_path / "now.jsonl")
    led = vjobs.Ledger(tmp_path / "now.jsonl", "territory:" + plan_mod.run_hash(env))
    assert code == 0 and rw.posts == []
    assert abs(vjobs.spent_usd({"jobs": {}}, led) - (8 * 0.07 + plan_mod.estimate()["est_usd"])) < 1e-6
    n = len(led.lines())
    go(env, *LIVE, ledger_path=tmp_path / "now.jsonl")
    assert len(led.lines()) == n                                                       # read once, never twice


def test_generate_checks_the_ledger_under_its_lock_and_counts_sends_that_got_no_answer(tmp_path):
    led = vjobs.Ledger(tmp_path / "l.jsonl", "territory:x")
    jobs = [{"key": f"s{i}-f1-flash", "tid": f"s{i}", "shot": "f1", "kind": "quick", "prompt": "p"} for i in range(5)]
    rw = FakeRunway()
    res = runway.generate(runway.Client(KEY, rw), jobs, tmp_path / "v1", runway.load_manifest(tmp_path / "v1"), [], sleep=lambda s: None,
                          log=lambda *a: None, ledger=led, cap_usd=0.14)
    assert len(rw.posts) == 2 and "lifetime cap" in res["stopped"]
    rw2 = FakeRunway()
    runway.generate(runway.Client(KEY, rw2), jobs, tmp_path / "v2", runway.load_manifest(tmp_path / "v2"), [], sleep=lambda s: None,
                    log=lambda *a: None, ledger=led, cap_usd=0.14)
    assert rw2.posts == []                                                             # another version folder: the same run's cap


def test_a_polling_timeout_is_not_a_crash(tmp_path):
    class SlowPoll(FakeRunway):
        def __call__(self, method, url, headers, body):
            if method == "GET" and "/tasks/" in url:
                raise TimeoutError("read timed out")
            return super().__call__(method, url, headers, body)
    jobs = [{"key": "s1-f1-flash", "tid": "s1", "shot": "f1", "kind": "quick", "prompt": "p"}]
    res = runway.generate(runway.Client(KEY, SlowPoll()), jobs, tmp_path, runway.load_manifest(tmp_path), [], sleep=lambda s: None, max_rounds=2,
                          log=lambda *a: None)
    assert res["still_running"] == ["s1-f1-flash"]


def test_retry_flagged_over_the_cap_moves_no_file(env):
    go(env, *LIVE, ollama=flag_task("task-1"))
    code, rw, _ = go(env, "--retry-flagged", "--max-usd", "0.64", *LIVE)
    vdir = next((env.parent / "jam.frames").glob("v1-*"))
    assert code == 2 and rw.posts == [] and (vdir / "s1-f1-flash.png").exists() and not (vdir / "s1-f1-flash.flagged-1.png").exists()


# ------------------------------------------------------------------------------- approvals are a person's, and show at once

def test_approve_needs_a_name_records_it_and_refreshes_the_board_in_a_dry_run(env):
    go(env, *LIVE, ollama=flag_task("task-1"))
    code, rw, _ = go(env, "--approve", "s1-f1-flash")
    assert code == 2
    code, rw, _ = go(env, "--approve", "s1-f1-flash", "--approved-by", "Sai")
    vdir = next((env.parent / "jam.frames").glob("v1-*"))
    assert code == 0 and rw.posts == []
    assert json.loads((vdir / "frames.json").read_text())["cards"][0]["frames"][0]["flagged"] is False
    assert frames_manifest(env)["frames"]["s1-f1-flash"]["approved_by"] == "Sai" and "approved by Sai" in (vdir / "board.html").read_text()


# ------------------------------------------------------------------------------- the style pack: forbid names, pinned models

def test_the_style_pack_may_not_name_the_brand_or_change_the_model_tiers(env, tmp_path, capsys):
    write_run(env, brand="Zestora")
    d = style_pack(tmp_path, look="zestora green, warm")
    code, rw, _ = go(env, "--style", str(d), *LIVE)
    assert code == 2 and rw.posts == [] and "Style pack problem" in capsys.readouterr().out
    d2 = style_pack(tmp_path, "pro")
    (d2 / "style.yaml").write_text((d2 / "style.yaml").read_text() + "models: {draft: gemini_image3_pro}\n")
    code, rw, _ = go(env, "--style", str(d2), *LIVE)
    assert code == 2 and rw.posts == [] and "cannot change the tiers" in capsys.readouterr().out


# ------------------------------------------------------------------------------- the style pack is the only visual driver

def test_the_plan_prompt_leaves_lens_and_light_to_the_style_pack_and_the_default_hash_is_unchanged():
    p = prompt("frames_plan")
    assert "Say nothing about the lens, the light" in p and "lens, angle and light" not in p
    assert style_mod.load(None).hash == "4ba913ca"                                    # saved default frames stay in their folder
    assert style_mod.load(None).source == "default until Laurence answers"


def test_a_plan_saved_before_the_change_keeps_its_words_but_its_camera_phrase_is_not_painted(env):
    shots = plan_output()
    plan = {"run": env.name, "run_sha256_12": plan_mod.run_hash(env), "model": "fake", "usd": 0.0,
            "territories": {t["id"]: [{**s, "camera": "long lens, warm practical light"} for s in t["shots"]] for t in shots["territories"]}}
    plan_mod.plan_path(env).write_text(json.dumps(plan))
    code, rw, llm = go(env, *LIVE)
    assert code == 0 and llm.calls == [] and len(rw.posts) == 8
    assert all("long lens" not in p["promptText"] for p in rw.posts)


# ------------------------------------------------------------------------------- the text run: card id, --out first

def _text_argv(out, *extra):
    return ["--category", "condiments", "--market", "IE", "--prompt", "a brief", "--material", "invented", "--out", str(out), *extra]


def _text_card(out):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        run_mod.main(_text_argv(out))
    return re.search(r"card\s+(c_[0-9a-f]{16})", buf.getvalue()).group(1)


def test_a_live_text_run_needs_out_and_the_cards_id(tmp_path, capsys):
    out = tmp_path / "run.json"
    fake = FakeLLM(outputs())
    assert run_mod.main(["--category", "condiments", "--market", "IE", "--live", "--yes-cost", "c_x"], llm_factory=lambda: fake) == 2
    assert run_mod.main(_text_argv(out, "--live", "--yes-cost", "c_deadbeefdeadbeef"), llm_factory=lambda: fake) == 2
    assert fake.calls == [] and not out.exists()
    out.write_text("{}")
    assert run_mod.main(_text_argv(out, "--live", "--yes-cost", _text_card(out)), llm_factory=lambda: fake) == 2   # never overwrites paid output
    assert fake.calls == []


def test_the_paid_result_is_saved_before_the_baseline_call_can_fail(tmp_path):
    out = tmp_path / "run.json"
    o = outputs()

    def boom(user):
        raise RuntimeError("the baseline call failed")
    o["baseline"] = boom
    with pytest.raises(RuntimeError):
        run_mod.main(_text_argv(out, "--live", "--yes-cost", _text_card(out)), llm_factory=lambda: FakeLLM(o))
    saved = json.loads(out.read_text())
    assert saved["territories"] and saved["material"]["origin"] == "invented" and saved["material"]["marks"] == []


# ------------------------------------------------------------------------------- tags are checked against the intake

def test_given_and_observed_are_checked_against_the_intake_and_the_card_says_so():
    o = outputs()
    o["assumed_brief"]["fields"].append({"key": "insight", "value": "they never think about it", "tag": "given"})   # the intake says inferred
    o["tensions"]["tensions"][1].update(evidence="observed", **{"from": ["insight"]})
    res = pipeline.run(task(), FakeLLM(o))
    f = {x["key"]: x for x in res["assumed_brief"]["fields"]}
    assert f["insight"]["tag"] == "inferred" and f["insight"]["tag_claimed"] == "given" and f["audience"]["tag"] == "given"
    t2 = next(t for t in res["tensions"] if t["id"] == "t2")
    assert t2["evidence"] == "invented" and t2["evidence_claimed"] == "observed"
    risks = " ".join(r for c in cards.cards(res) for r in c["risks"])
    assert "called insight given" in risks and "called its tension observed" in risks


def test_restored_and_unjudged_seeds_carry_a_card_warning():
    o = outputs()
    o["kill"] = {"verdicts": [{"id": "s1", "keep": False, "strength": 2}, {"id": "s3", "keep": False, "strength": 5},
                              {"id": "s4", "keep": False, "strength": 4}, {"id": "s5", "keep": False, "strength": 1}]}
    res = pipeline.run(task(), FakeLLM(o))
    assert all(any("restored after the kill gate" in r for r in c["risks"]) for c in cards.cards(res))
    o["kill"] = {"verdicts": [{"id": "s1", "keep": True, "strength": 4}]}
    res = pipeline.run(task(), FakeLLM(o))
    c = {x["id"]: x for x in cards.cards(res)}
    assert any("not judged by the kill gate" in r for r in c["s4"]["risks"]) and not any("kill gate" in r for r in c["s1"]["risks"])
