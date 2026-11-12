"""Sai's first-draft checks under the jev judge (feature jev-runs-first-draft-checks): what code can measure is
sent back and rewritten whichever judge the deployment sets, and single-mindedness is never assumed."""

import json
import re
from pathlib import Path

import pytest

from napkin.brief import checks

from conftest import Server
from fakes import explained
from test_brief import Host, check_change_rules, retrieval, run
from test_planned_brief import THIN, FakeJev, planned_model

REPO = Path(__file__).resolve().parents[2]
W = lambda n: " ".join(f"w{i}" for i in range(n))  # noqa: E731
LONG_SMP = "Fresh bread every morning. It is quick and it is cheap. Buy it now."


def _part(v):
    return {"value": v, "basis": "assumption", "cites": [], "builds_on_client": False, "why": "x"}


def bad_draft_model(seen):
    """planned_model, with a first draft Sai's checks send back: a three-sentence proposition with a standalone
    'and', and a background far over its limit. The rewrite keeps an 'and' in the proposition the first time, so
    code sends it back again; the background comes back short."""
    m = planned_model(seen)
    base = m.overrides["draft_brief_whole"]
    m.overrides["draft_brief_whole"] = lambda p: {**base(p), "single_minded_proposition": _part(LONG_SMP),
                                                  "background": _part(W(200))}
    smp = iter(["Quick and cheap.", "Quick and cheap, every morning."])

    def rewrite(p):
        seen.setdefault("rewrites", []).append(p)
        return {k: _part(next(smp) if k == "single_minded_proposition" else
                         "Sales are flat." if k == "background" else "Grow under-30 visits by a set share")
                for k in p["parts"]}
    m.overrides["rewrite_brief_parts"] = rewrite
    return m


def notes(tmp_path, what):
    evs = [json.loads(x) for f in (tmp_path / "runs").rglob("*.jsonl") for x in f.read_text().splitlines()]
    return [e for e in evs if e["ev"] == "note" and e["what"] == what]


def test_the_jev_judge_sends_back_what_code_measures_and_measures_again(tmp_path):
    seen = {}
    m = bad_draft_model(seen)

    def explain(p):
        seen["explain"] = p
        # the Review agent reads the proposition as one thought: code's 'and' still overrules it below
        return explained(p, {"parts": {k: {"rework": False, "why": "fine", "instruction": ""}
                                       for k in list(p["flagged"]) + p["empty"]},
                             "chain": {"issue": None, "parts": []}, "dimensions": [], "questions": []}, "single")
    m.overrides["explain_flags"] = explain
    s = Server(tmp_path, model=m, retrieval=retrieval(), jev=FakeJev(),
               settings_kw={"brief_flow": "planned", "brief_judge": "jev", "runlog_dir": str(tmp_path / "runs")})
    try:
        host = Host()
        run(s, host, inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    # the Review agent saw what code measured and the skill's tests
    ex = seen["explain"]
    assert ex["part_checks"]["single_minded_proposition"]["sentences"] == 3
    assert ex["part_checks"]["single_minded_proposition"]["standalone_and"] is True
    assert ex["part_checks"]["background"]["words"] == 200
    assert "single_minded" in ex["tests"]["single_minded_proposition"]
    assert set(ex["code_sent_back"]) == {"single_minded_proposition", "background"}
    # both went back in the loop's one rewrite, with code's instructions, though jev flagged neither
    first, again = seen["rewrites"]
    told = first["rewrite"]
    assert set(told) == {"single_minded_proposition", "background"}
    assert "3 sentences" in told["single_minded_proposition"] and "'and'" in told["single_minded_proposition"]
    assert "200 words and the limit is" in told["background"]
    # measured again after the rewrite: the 'and' left in the proposition goes back once more
    assert set(again["rewrite"]) == {"single_minded_proposition"} and "'and'" in again["rewrite"]["single_minded_proposition"]
    assert "Sales are flat." in host.data["background"]
    assert host.data["single_minded_proposition"].endswith("Quick and cheap, every morning.")
    # code still finds a standalone 'and': the brief is not recorded as single-minded
    sm = host.data["review"]["scorecard"]["single_mindedness"]
    assert sm["verdict"] == "multiple"
    check_change_rules(host)  # the document, 'multiple' included, validates against Brief Maker's schema
    assert [sorted(n["parts"]) for n in notes(tmp_path, "checks_sent_back")] == [["background", "single_minded_proposition"]]
    assert [n["parts"] for n in notes(tmp_path, "checks_sent_back_again")] == [["single_minded_proposition"]]
    assert [n["by"] for n in notes(tmp_path, "single_mindedness")] == ["code"]
    assert notes(tmp_path, "jude_on_flags")[0]["code_sent_back"] == ["background", "single_minded_proposition"]


def test_a_part_failing_a_skill_test_goes_back_and_the_review_agents_verdict_is_recorded(tmp_path):
    seen = {}
    m = planned_model(seen)
    base = m.overrides["draft_brief_whole"]
    m.overrides["draft_brief_whole"] = lambda p: {**base(p), "background": _part(W(200))}

    def explain(p):
        return explained(p, {"parts": {}, "chain": {"issue": None, "parts": []}, "dimensions": [], "questions": [],
                             "failed_tests": [{"part": "job", "test": "one_change", "instruction": "Ask for one change."}]},
                         "multiple")
    m.overrides["explain_flags"] = explain
    s = Server(tmp_path, model=m, retrieval=retrieval(), jev=FakeJev(),
               settings_kw={"brief_flow": "planned", "brief_judge": "jev"})
    try:
        host = Host()
        run(s, host, inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    told = seen["rewrite"]["rewrite"]
    assert told["job"] == "Ask for one change." and "background" in told
    assert host.data["review"]["scorecard"]["single_mindedness"]["verdict"] == "multiple"
    check_change_rules(host)


def test_nothing_judged_the_brief_so_single_mindedness_is_unchecked_not_single(tmp_path):
    seen = {}
    m = planned_model(seen)
    m.overrides["explain_flags"] = lambda p: pytest.fail("jev and code flagged nothing: no Review agent call")
    s = Server(tmp_path, model=m, retrieval=retrieval(), jev=FakeJev(),
               settings_kw={"brief_flow": "planned", "brief_judge": "jev"})
    try:
        host = Host()
        run(s, host, inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    assert host.data["review"]["scorecard"]["single_mindedness"] == {"verdict": "unchecked", "split_into": []}
    check_change_rules(host)  # 'unchecked' is in Brief Maker's schema


def test_the_review_judge_sends_back_the_same_draft_as_before(tmp_path):
    seen = {}
    m = bad_draft_model(seen)
    s = Server(tmp_path, model=m, retrieval=retrieval(),
               settings_kw={"brief_flow": "planned", "brief_judge": "review", "runlog_dir": str(tmp_path / "runs")})
    try:
        host = Host()
        run(s, host, inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    assert not any(c[0] == "explain_flags" for c in m.calls), "the review judge makes no check-loop call"
    first, again = seen["rewrites"]
    assert set(first["rewrite"]) == {"objectives.commercial", "single_minded_proposition", "background"}
    assert first["rewrite"]["objectives.commercial"] == "add a measure", "the Review agent's own ask comes first"
    assert "3 sentences" in first["rewrite"]["single_minded_proposition"]
    assert set(again["rewrite"]) == {"single_minded_proposition"}
    assert [c[0] for c in m.calls].count("review_brief_again") == 2, "the Review agent reads each rewrite"
    assert host.data["review"]["scorecard"]["single_mindedness"]["verdict"] == "single", "the Review agent's own verdict"
    assert [n["parts"] for n in notes(tmp_path, "checks_sent_back_again")] == [["single_minded_proposition"]]
    check_change_rules(host)


def _deployed_judges():
    """NAPKIN_BRIEF_JUDGE as each deployed environment's Terraform sets it."""
    out = {}
    for env in ("staging", "uat"):
        tf = (REPO / "infra" / "envs" / env / "main.tf").read_text()
        got = re.findall(r'NAPKIN_BRIEF_JUDGE\s*=\s*"([^"]*)"', tf)
        assert len(got) == 1, f"{env}: NAPKIN_BRIEF_JUDGE is set once"
        # the mapping below is the planned flow's: an engine or another flow is a path this test must learn
        assert "NAPKIN_BRIEF_ENGINE_URL" not in tf and "NAPKIN_BRIEF_FLOW" not in tf, \
            f"{env} sets the brief engine or flow: extend this test to that path"
        out[env] = got[0]
    return out


@pytest.mark.parametrize("env", ["staging", "uat"])
def test_the_judge_each_deployment_sets_runs_the_code_checks(tmp_path, monkeypatch, env):
    judge = _deployed_judges()[env]
    calls = []
    real = checks.revisions
    monkeypatch.setattr(checks, "revisions", lambda whole: (calls.append(sorted(whole)), real(whole))[1])
    seen = {}
    m = planned_model(seen)
    m.overrides["explain_flags"] = lambda p: explained(p, {"parts": {k: {"rework": False, "why": "", "instruction": ""}
                                                                     for k in list(p["flagged"]) + p["empty"]},
                                                           "chain": {"issue": None, "parts": []}, "dimensions": [],
                                                           "questions": []})
    s = Server(tmp_path, model=m, retrieval=retrieval(), jev=FakeJev(),
               settings_kw={"brief_flow": "planned", "brief_judge": judge})
    try:
        host = Host()
        run(s, host, inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    assert host.data.get("review"), f"{env} ({judge}): the brief was judged"
    assert len(calls) >= 2, f"{env} sets NAPKIN_BRIEF_JUDGE={judge!r}: its judge must send back what code measures " \
                            "and measure again after the rewrite (checks.revisions)"
