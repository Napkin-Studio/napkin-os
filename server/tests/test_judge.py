"""Judge (features/judge.clan): the rubric, the judge_work handler, its refusals, the allow list, the wall,
and the calibration report. No model call: a fake model answers where a model would."""

import json
import logging
import re
from pathlib import Path

import pytest

from napkin import client_ai, registry
from napkin.app import Middleware
from napkin.config import Settings, _default_pipelines
from napkin.judge import calibrate, core, rubric
from napkin.util import TaskError

from fakes import FakeModel
from conftest import layer_store

REPO = Path(__file__).resolve().parents[2]
CANARY = "Canary: the tractor sings at midnight."

SCRIPT = {"format": "radio", "slot_s": 30, "proposition": "The whiskey that waits for you.", "cast": "duo",
          "script": {"beats": [{"id": "b1", "kind": "voice", "role": "FVO", "text": "Tonight, try something new.",
                                "visual_action": "", "voiceover": "", "dialogue": "", "on_screen_text": "",
                                "sound_intention": "", "duration_s": 0},
                               {"id": "b2", "kind": "voice", "role": "MVO", "text": "The first pour is easy.",
                                "visual_action": "", "voiceover": "", "dialogue": "", "on_screen_text": "",
                                "sound_intention": "", "duration_s": 0}]},
          "checks": {"mandatory": [{"text": "Drink responsibly", "source": "document"}],
                     "banned": [{"text": "smooth", "source": "document"}]}}
BRIEF = {"single_minded_proposition": "The easy way into Irish whiskey.", "insight": "It feels like someone else's."}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ("NAPKIN_JUDGE_BACKEND", "NAPKIN_JUDGE_FIXTURE", "NAPKIN_MODEL_PIN", "NAPKIN_SPEND_CAP_EUR",
              "NAPKIN_PAID_CALLS", "NAPKIN_JUDGE_PRICE_EUR", "NAPKIN_ENV"):
        monkeypatch.delenv(k, raising=False)


class JudgeModel(FakeModel):
    """Answers every llm test of a call, except the ids in `fail`; `mutate` can break the reply."""

    def __init__(self, fail=(), mutate=None):
        super().__init__()
        self.fail, self.mutate = set(fail), mutate
        for p in core.PURPOSES.values():
            self.overrides[p] = self.answer

    def answer(self, payload):
        out = {t["id"]: {"value": "fail" if t["id"] in self.fail else "pass", "evidence": f"Evidence for {t['id']}."}
               for t in payload["tests"]}
        return self.mutate(out) if self.mutate else out


def middleware(model=None, **kw):
    settings = Settings(pipelines=_default_pipelines(), **kw)
    return Middleware(settings, model_client=model or JudgeModel(), layer_store=layer_store())


def body(kind="script", content=None, brief=None, **inp):
    return {"request_kind": "middleware",
            "payload": {"task": "judge_work", "input": {"work": {"kind": kind, "content": content or SCRIPT},
                                                        "brief": brief or BRIEF, "rubric_version": "1", **inp}},
            "clan": {"id": "doc_1", "version": "v1"}}


def ids_of(result):
    return [t["id"] for t in result["tests"]]


# -- the rubric ------------------------------------------------------------------------------------

def test_the_rubric_has_ten_tests_a_dimension_per_kind_with_unique_ids():
    r = rubric.load()
    ids = [t["id"] for t in r["tests"]]
    assert len(ids) == len(set(ids))
    assert {t["method"] for t in r["tests"]} <= {"code", "llm"}
    for kind in r["kinds"]:
        ts = rubric.tests_for(kind)
        assert len(ts) == 30
        for dim in ("idea", "craft", "effect"):
            assert len([t for t in ts if t["dim"] == dim]) == 10, (kind, dim)
    for t in r["tests"]:
        assert t["question"] and t["pass_when"] and t["reason_code"].startswith("judge.fail.")


def test_the_hosts_copy_of_the_rubric_is_byte_identical():
    host = REPO / "crates/napkin-host/src/ops/judge_rubric.json"
    if not host.exists():
        pytest.skip("the crates folder is not in this build")
    assert host.read_bytes() == rubric.FILE.read_bytes()


# -- registration ----------------------------------------------------------------------------------

def test_judge_work_is_a_registered_task_and_a_pipeline_can_declare_it():
    assert "judge_work" in registry.TASKS
    mod, handler = registry.resolve("judge_work", {"pipeline": {"tasks": {"judge_work": {"handler": "judge_work@1"}}}})
    assert handler == "judge_work@1.0" and mod.KIND == "short"
    assert registry.resolve("judge_work", {})[1] == "judge_work@1.0"
    assert registry.parse_pipeline("tasks:\n  judge_work:\n    handler: judge_work@1\n") == {"judge_work": "judge_work@1"}


# -- the fixture backend ---------------------------------------------------------------------------

@pytest.mark.parametrize("kind", ["script", "idea_route", "visual_brief"])
def test_the_fixture_backend_answers_every_test_id_of_each_kind(monkeypatch, kind):
    monkeypatch.setenv("NAPKIN_JUDGE_BACKEND", "fixture")
    model = JudgeModel()
    content = {"script": SCRIPT,
               "idea_route": {"route": {"name": "One song", "bet": "A bar goes quiet for one song."},
                              "cards": [{"text": "x", "kind": "team", "brief_link": {}, "tests": {}}]},
               "visual_brief": {"territory": {"name": "Late bar", "line": "A bar, late."}, "tone": ["warm"],
                                "must_show": ["the bottle"], "never_show": ["a crowd"],
                                "reference_frames": {"a": {"caption": "c"}}}}[kind]
    out = middleware(model).handle(body(kind, content))
    res = out["result"]
    assert ids_of(res) == [t["id"] for t in rubric.tests_for(kind)]
    assert all(t["value"] in ("pass", "fail") and t["evidence"] for t in res["tests"])
    assert res["backend"] == "fixture" and res["model"] is None and res["price_eur"] == 0
    assert "total" not in res and "score" not in res
    assert out["handler"] == "judge_work@1.0" and out["change"] is None and out["job"]["state"] == "done"
    assert model.calls == [], "the fixture backend makes no model call"


def test_code_tests_run_in_code_and_the_fixture_file_can_be_chosen(monkeypatch, tmp_path):
    monkeypatch.setenv("NAPKIN_JUDGE_BACKEND", "fixture")
    f = tmp_path / "fx.json"
    f.write_text(json.dumps({"kinds": {"script": {"fail": ["effect.tone"]}}, "evidence": {"effect.tone": "Too loud."}}))
    monkeypatch.setenv("NAPKIN_JUDGE_FIXTURE", str(f))
    got = {t["id"]: t for t in middleware().handle(body())["result"]["tests"]}
    assert got["effect.tone"]["value"] == "fail" and got["effect.tone"]["evidence"] == "Too loud."
    assert got["craft.script.mandatory_present"]["value"] == "fail"       # Drink responsibly is not in the beats
    assert got["craft.script.no_banned_word"]["value"] == "pass"
    assert got["craft.script.fits_the_slot"]["evidence"] == "4 seconds against a 30 second slot."


def test_quote_prices_the_run_and_runs_nothing(monkeypatch):
    monkeypatch.setenv("NAPKIN_JUDGE_BACKEND", "llm-judge")
    monkeypatch.setenv("NAPKIN_JUDGE_PRICE_EUR", "0.04")
    model = JudgeModel()
    out = middleware(model).handle(body(quote=True))
    assert out["result"] == {"quote": {"price_eur": 0.04, "backend": "llm-judge", "tests": 30}}
    assert model.calls == []
    monkeypatch.setenv("NAPKIN_JUDGE_BACKEND", "fixture")
    assert middleware().handle(body(quote=True))["result"]["quote"]["price_eur"] == 0


# -- the refusals ----------------------------------------------------------------------------------

def refused(mw, status, etype, **kw):
    with pytest.raises(TaskError) as e:
        mw.handle(body(**kw))
    assert (e.value.status, e.value.etype) == (status, etype)
    assert CANARY not in e.value.message
    return e.value


def test_unset_or_unknown_backend_is_not_configured_and_never_falls_through(monkeypatch):
    model = JudgeModel()
    mw = middleware(model)
    refused(mw, 503, "not_configured")
    refused(mw, 503, "not_configured", quote=True)
    monkeypatch.setenv("NAPKIN_JUDGE_BACKEND", "jev")
    refused(mw, 503, "not_configured")
    assert model.calls == []


def test_ai_off_refuses_the_model_backend_before_any_call(monkeypatch):
    monkeypatch.setenv("NAPKIN_JUDGE_BACKEND", "llm-judge")
    model = JudgeModel()
    assert client_ai.written_yes_recorded({"org": "o", "brand": "b"}) is False
    refused(middleware(model), 403, "ai_off")
    assert model.calls == []


@pytest.fixture
def yes(monkeypatch):
    monkeypatch.setattr(client_ai, "written_yes_recorded", lambda scope, client_id=None: True)
    monkeypatch.setenv("NAPKIN_JUDGE_BACKEND", "llm-judge")


def test_a_route_that_is_not_eu_pinned_is_refused(yes, monkeypatch):
    model = JudgeModel()
    monkeypatch.setenv("NAPKIN_MODEL_PIN", "eu")           # the anthropic wire cannot name its region
    refused(middleware(model), 403, "not_eu")
    monkeypatch.delenv("NAPKIN_MODEL_PIN")
    monkeypatch.setenv("NAPKIN_ENV", "staging")             # deployed: client work goes to eu. profiles only
    refused(middleware(model), 403, "not_eu")
    assert model.calls == []


def test_a_global_bedrock_profile_is_refused_and_an_eu_one_is_not(yes, monkeypatch):
    monkeypatch.setenv("NAPKIN_MODEL_PIN", "eu")
    for model_id, ok in (("global.anthropic.claude-opus-5-5", False), ("eu.anthropic.claude-opus-4-6-v1", True)):
        from napkin.model_routes import Routes
        r = Routes("bedrock", model_id, None, None, pin=None, exceptions={})

        class Port:
            routes = r

        class Cap:
            class model:
                _port = Port
        if ok:
            assert core.check_route(Cap)
        else:
            with pytest.raises(TaskError) as e:
                core.check_route(Cap)
            assert e.value.etype == "not_eu"


def test_the_spend_guard_refuses_before_any_model_call(yes, monkeypatch):
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "0")
    model = JudgeModel()
    e = refused(middleware(model), 429, "spend_refused")
    assert "cap" in e.message
    assert model.calls == []
    monkeypatch.delenv("NAPKIN_SPEND_CAP_EUR")
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "off")
    refused(middleware(model), 429, "spend_refused")


def test_the_model_backend_asks_once_per_dimension_and_answers_all_thirty(yes):
    model = JudgeModel(fail={"idea.surprise"})
    out = middleware(model).handle(body())
    res = out["result"]
    assert ids_of(res) == [t["id"] for t in rubric.tests_for("script")]
    assert {t["id"]: t["value"] for t in res["tests"]}["idea.surprise"] == "fail"
    assert sorted(p for p, *_ in model.calls) == ["judge_craft", "judge_effect", "judge_idea"]
    assert res["backend"] == "llm-judge" and re.fullmatch(r"[0-9a-f]{8}", res["prompt_hash"]) and res["model"]
    for _, payload, _ in model.calls:                       # code tests are never sent to the model
        assert not [t for t in payload["tests"] if t["id"].startswith("craft.script.mandatory")]


@pytest.mark.parametrize("how", ["missing", "doubled", "unknown", "no_evidence", "bad_value"])
def test_a_malformed_model_reply_is_an_error_and_never_a_pass(yes, how):
    def mutate(out):
        first = next(iter(out))
        if how == "missing":
            out.pop(first)
        elif how == "doubled":
            out[first + "_again"] = dict(out[first])
        elif how == "unknown":
            out["idea.made_up"] = out.pop(first)
        elif how == "no_evidence":
            out[first]["evidence"] = ""
        else:
            out[first]["value"] = "maybe"
        return out
    refused(middleware(JudgeModel(mutate=mutate)), 502, "judge_malformed")


def test_merge_refuses_a_missing_doubled_or_unknown_id():
    ts = rubric.tests_for("script")
    ok = {t["id"]: {"value": "pass", "evidence": "e"} for t in ts}
    assert len(core.merge("script", ok, {})) == 30
    with pytest.raises(TaskError):
        core.merge("script", {k: v for k, v in ok.items() if k != ts[0]["id"]}, {})
    with pytest.raises(TaskError):
        core.merge("script", ok, {"idea.extra": {"value": "pass", "evidence": "e"}})


def test_a_bad_work_kind_or_rubric_version_is_a_400(monkeypatch):
    monkeypatch.setenv("NAPKIN_JUDGE_BACKEND", "fixture")
    mw = middleware()
    refused(mw, 400, "invalid_input", kind="poster")
    refused(mw, 400, "invalid_input", rubric_version="9")


# -- the allow list --------------------------------------------------------------------------------

def schema_keys(path):
    return list(json.loads((REPO / path).read_text())["properties"])


def test_the_input_is_built_from_an_allow_list_and_only_marked_fields_pass():
    script_keys = schema_keys("app/templates/script-editor/schema.json")
    brief_keys = schema_keys("app/templates/brief-maker/schema.json")
    mark = lambda k: f"MARK<{k}>"  # noqa: E731
    doc = {k: mark(k) for k in script_keys}
    doc["script"] = {"beats": [{k: mark("beat." + k) for k in (*core.BEAT_FIELDS, "private")}],
                     "proposals": [{"by": mark("proposal.by")}], "seq": mark("seq")}
    doc["checks"] = {"mandatory": [{"text": mark("mandatory.text"), "source": mark("mandatory.source"), "by": mark("m.by")}],
                     "banned": [{"text": mark("banned.text"), "source": mark("banned.source")}], "extra": mark("extra")}
    doc["handoffs"] = {"judge": mark("handoffs")}
    brief = {k: mark("brief." + k) for k in brief_keys}
    got = json.dumps(core.assemble_input({"work": {"kind": "script", "content": doc}, "brief": brief, "rubric_version": "1"}))
    present = set(re.findall(r"MARK<([^>]*)>", got))
    assert {"format", "slot_s", "proposition", "cast", "mandatory.text", "banned.text"} <= present
    assert {"beat." + k for k in core.BEAT_FIELDS} <= present
    assert {"brief." + k for k in core.BRIEF_FIELDS if k in brief_keys} == {p for p in present if p.startswith("brief.")}
    gone = {"film", "handoffs", "script", "checks", "proposal.by", "seq", "beat.private", "m.by", "extra"}
    assert not (gone & present), gone & present
    for k in ("project_name", "client", "materials", "capture", "review", "passages", "upstream", "projection",
              "budget_and_scope" if "budget_and_scope" not in core.BRIEF_FIELDS else "client"):
        assert "brief." + k not in present
    # none of the keys the Idea room's or Script editor's prompts use reach Judge's input
    for k in ("proposals", "rewrite_line", "headline_options", "ban_default", "swap_test", "fame_test", "by", "votes",
              "comments", "handoffs"):
        assert f'"{k}"' not in got


def test_an_idea_route_never_carries_a_card_author_and_a_visual_brief_only_its_fields():
    card = {"text": "t", "kind": "team", "by": "MARK<by>", "votes": ["MARK<vote>"], "comments": [{"text": "MARK<c>"}],
            "brief_link": {"insight": "i", "proposition": "p", "other": "MARK<o>"},
            "tests": {"banned_match": {"banned": "b", "by": "MARK<bm>"}, "swap": {"answer": "MARK<s>"}}}
    got = json.dumps(core.work_content("idea_route", {"route": {"name": "n", "bet": "b", "cards": ["MARK<x>"], "notes": ["MARK<n>"]},
                                                      "cards": [card], "chosen": "MARK<ch>"}))
    assert "MARK" not in got
    vb = core.work_content("visual_brief", {"territory": {"name": "n", "line": "l", "chosen_by": "MARK<cb>"},
                                            "proposition": "p", "reference_frames": {"a": {"caption": "c", "path": "MARK<p>"}},
                                            "unknown": "MARK<u>"})
    assert "MARK" not in json.dumps(vb)


# -- the wall: no content in the run log -----------------------------------------------------------

def test_work_content_is_in_no_log_line_and_no_run_log_file(yes, monkeypatch, tmp_path, caplog):
    from napkin import runlog
    runlog.configure(str(tmp_path / "runs"), bodies=True)
    try:
        content = json.loads(json.dumps(SCRIPT))
        content["script"]["beats"][0]["text"] = CANARY
        brief = {**BRIEF, "insight": CANARY}
        caplog.set_level(logging.DEBUG)
        mw = Middleware(Settings(pipelines=_default_pipelines(), runlog_dir=str(tmp_path / "runs"), runlog_bodies=True),
                        model_client=JudgeModel(), layer_store=layer_store())
        mw.handle(body(content=content, brief=brief))
        text = "\n".join(r.getMessage() for r in caplog.records)
        files = [p.read_text() for p in (tmp_path / "runs").rglob("*") if p.is_file()]
        assert "judge_work" in text and CANARY not in text
        assert CANARY not in "\n".join(files)
    finally:
        runlog.configure(None, bodies=False)


# -- the calibration report ------------------------------------------------------------------------

def rows(n, agree, repeat_same=True):
    out = []
    for i in range(n):
        route = "team" if i % 2 else "cd"
        ok = i < agree
        want = "returned" if route == "team" else "kept"
        dec = want if ok else ("kept" if want == "returned" else "returned")
        r = {"piece": f"p{i}", "work_hash": "h", "judge_version": "j", "at": f"2026-11-01T00:00:{i % 60:02d}", "advised_route": route,
             "tests": [{"id": "idea.fame", "value": "pass"}], "then": {"decision": dec, "overruled": not ok}}
        out.append(r)
        if i < 10:
            out.append({**r, "then": {"decision": "none"}, "advised_route": route if repeat_same else "x"})
    return out


def test_the_calibration_report_on_the_fixture_file_says_not_earned(capsys):
    assert calibrate.main([str(Path(__file__).parent / "fixtures/judge_telemetry.json")]) == 0
    out = capsys.readouterr().out
    assert "Decided pieces: 70" in out and "Agreement with the creative director" in out and "earned: no" in out
    assert "Repeatability" in out and "idea.surprise" in out


def test_trust_is_earned_only_when_every_number_clears():
    r = calibrate.report(rows(100, 100))
    assert r["earned"] and r["agreement_lower"] >= 0.8 and r["repeat"] == 1.0
    assert not calibrate.report(rows(100, 60))["earned"]
    few = calibrate.report(rows(30, 30))
    assert not few["earned"] and "30 decided" in " ".join(few["failing"])
    assert not calibrate.report(rows(100, 100, repeat_same=False))["earned"]
    assert calibrate.wilson_lower(0, 0) == 0.0 and 0.8 < calibrate.wilson_lower(95, 100) < 0.95
