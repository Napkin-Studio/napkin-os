"""Laurence's checks run whichever judge reads the brief (feature brief-jev-checks, ADR 0035 addendum)."""

import hashlib

from napkin.brief import checks
from napkin.brief.planned import REVIEW_SYSTEM


def test_the_review_prompt_is_byte_identical_to_what_it_was_before_the_guide_moved():  # T12
    assert len(REVIEW_SYSTEM) == 3384
    assert hashlib.sha256(REVIEW_SYSTEM.encode()).hexdigest() == \
        "bfe84c9b6faa045f9ad27f4c6220f1e370fdb28c9bf1e5a47ad1b222971a1231"


def test_the_review_prompt_takes_its_test_rules_from_checks():  # T13, review half
    tests, anti = checks.guide_parts()
    assert tests in REVIEW_SYSTEM and anti in REVIEW_SYSTEM
    assert checks.tests_guide() == tests + "\n" + anti


import json

import pytest
from jsonschema import Draft202012Validator

from napkin.brief import checkloop
from napkin.brief import provenance as prov
from napkin.brief.planned import REVIEW_SYSTEM  # noqa: F811 (the module's own, for the substring checks)
from napkin.jev import JevError

from conftest import Server
from test_brief import Host, check_change_rules, post, retrieval, run
from test_planned_brief import THIN, FakeJev, planned_model

W = lambda n: " ".join(f"w{i}" for i in range(n))
SHORT = "Grow under-30 visits by a measured share this summer"


def part(v, basis="assumption"):
    return {"value": v, "basis": basis, "cites": [], "builds_on_client": False, "why": "x"}


class RaisingJev:
    def ask(self, state, questions):
        raise JevError("jev did not answer (test)")


class SecondCallRaises(FakeJev):
    def ask(self, state, questions):
        if self.calls:
            self.calls.append(None)
            raise JevError("jev went away")
        return super().ask(state, questions)


SETTINGS = {
    "review": (lambda: None, {}),
    "jev": (FakeJev, {"brief_judge": "jev"}),
    "jev_raising": (RaisingJev, {"brief_judge": "jev"}),
    "jev_unconfigured": (lambda: None, {"brief_judge": "jev"}),
}


def faulty(seen, proposition=None, job="Move them. Then move them again.", extra=None, m=None):
    """planned_model whose first draft has a long proposition and a two-sentence job, with explain_flags
    answering every test as passed (a part named in seen['fail'] fails) and counting its calls."""
    m = m or planned_model(seen)
    base = m.overrides["draft_brief_whole"]

    def draft(p):
        out = base(p)
        out["single_minded_proposition"] = part(proposition or W(40))
        out["job"] = part(job)
        out["insight"] = part("An assumed insight.")
        for k, v in (extra or {}).items():
            out[k] = v
        return out

    def explain(p):
        seen.setdefault("explains", []).append(p)
        out = {"parts": {k: {"rework": False, "why": "fine", "instruction": ""}
                         for k in list(p["flagged"]) + p["empty"]},
               "chain": {"issue": None, "parts": []}, "dimensions": [], "questions": []}
        if "tests" in p:
            fail = seen.get("fail") or {}
            out["tests"] = {k: ({"pass": False, "failed_test": fail[k][0], "instruction": fail[k][1]} if k in fail
                                else {"pass": True, "failed_test": "", "instruction": ""}) for k in p["tested"]}
        return out

    def rewrite(p):
        seen.setdefault("rewrites", []).append(p)
        seen["rewrite"] = p
        return {k: part(SHORT) for k in p["parts"]}
    m.overrides.update({"draft_brief_whole": draft, "explain_flags": explain, "rewrite_brief_parts": rewrite})
    return m


def go(tmp_path, m, jev=None, kw=None, run_kw=None, host=None):
    s = Server(tmp_path, model=m, retrieval=retrieval(), jev=jev,
               settings_kw={"brief_flow": "planned", "runlog_dir": str(tmp_path / "runs"), **(kw or {})})
    host = host or Host()
    try:
        run(s, host, inp={"prompt": THIN, "attachments": []}, **(run_kw or {}))
    finally:
        s.stop()
    return host


def notes(tmp_path):
    evs = [json.loads(x) for f in (tmp_path / "runs").rglob("*.jsonl") for x in f.read_text().splitlines()]
    return [e for e in evs if e["ev"] == "note"]


def whats(tmp_path):
    return [e["what"] for e in notes(tmp_path)]


def purposes(m):
    return [c[0] for c in m.calls]


def judge_payload(seen):
    return seen["explains"][0] if seen.get("explains") else seen["reviews"][0]


@pytest.mark.parametrize("setting", list(SETTINGS))
def test_one_faulty_draft_gets_the_same_checks_under_every_judge_setting(tmp_path, setting):  # T1
    mk, kw = SETTINGS[setting]
    seen = {}
    m = faulty(seen)
    host = go(tmp_path, m, jev=mk(), kw=kw)
    p = judge_payload(seen)
    assert set(p["tests"]) == set(checks.TESTED)
    assert p["part_checks"]["job"]["sentences"] == 2 and p["part_checks"]["single_minded_proposition"]["words"] == 40
    told = seen["rewrite"]["rewrite"]
    assert "at most 20 words" in told["single_minded_proposition"] and "2 sentences" in told["job"]
    assert "checks_sent_back" in whats(tmp_path)
    assert SHORT in host.data["single_minded_proposition"] and SHORT in host.data["job"]
    check_change_rules(host)
    if setting == "jev":
        assert "review_brief" not in purposes(m), "jev answered: no whole-brief review"
    else:
        assert "review_brief" in purposes(m)


@pytest.mark.parametrize("setting", ["review", "jev"])
def test_when_jude_names_a_part_code_leaves_its_instruction_out(tmp_path, setting):  # T1b
    mk, kw = SETTINGS[setting]
    seen = {"fail": {"single_minded_proposition": ("single_minded", "Make it one promise, not a tagline")}}
    m = faulty(seen)
    if setting == "review":
        base = m.overrides["review_brief"]
        m.overrides["review_brief"] = lambda p: {**base(p), "revise": [
            {"part": "single_minded_proposition", "instruction": "Make it one promise, not a tagline"}]}
    go(tmp_path, m, jev=mk(), kw=kw)
    told = seen["rewrite"]["rewrite"]
    assert told["single_minded_proposition"] == "Make it one promise, not a tagline", "Jude's alone"
    assert "2 sentences" in told["job"], "what only code measured still goes back"


def test_jev_flags_nothing_and_jude_fails_the_insight_on_a_test(tmp_path):  # T2
    seen = {"fail": {"insight": ("fresh", "Make the insight fresh: say what they stopped doing")}}
    m = faulty(seen, proposition="Short line.", job="A job.")
    host = go(tmp_path, m, jev=FakeJev(), kw={"brief_judge": "jev"})
    assert seen["rewrite"]["rewrite"] == {"insight": "Make the insight fresh: say what they stopped doing"}
    assert SHORT in host.data["insight"]
    sent = next(d for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "bad"
                and d["targets"][0].endswith("#insight"))
    assert any("fresh" in p["point"] for p in sent["reasoning"]["because"])
    redraft = next(d for d in host.chain if d.get("action") == "draft" and d["targets"][0].endswith("#insight")
                   and sent["id"] in d["cites"])
    assert any(p["point"].startswith("Jude's note: ") for p in redraft["reasoning"]["because"])
    assert "Jude" in redraft["reasoning"]["attention"]
    check_change_rules(host)


def test_a_limit_that_survives_the_first_rewrite_goes_back_once_more_from_the_new_text(tmp_path):  # T3
    seen = {}
    m = faulty(seen, job="A job.")
    fid_claims = {}
    real = prov.clean_parts

    def spy(out, *a, **kw):
        got = real(out, *a, **kw)
        fid_claims.setdefault(kw.get("stage"), []).append({k: v.get("claims") for k, v in got.items()})
        return got
    prov.clean_parts = spy
    n = {"i": 0}

    def rewrite(p):
        seen.setdefault("rewrites", []).append(p)
        n["i"] += 1
        return {k: part(W(30) if n["i"] == 1 else "Easy mornings, every day.") for k in p["parts"]}
    m.overrides["rewrite_brief_parts"] = rewrite
    jev = FakeJev()
    try:
        host = go(tmp_path, m, jev=jev, kw={"brief_judge": "jev"})
    finally:
        prov.clean_parts = real
    assert purposes(m).count("rewrite_brief_parts") == 2 and purposes(m).count("explain_flags") == 1
    assert len(jev.calls) == 2, "jev before and after the first rewrite"
    w = whats(tmp_path)
    assert "checks_sent_back" in w and "checks_sent_back_again" in w
    first, second = seen["rewrites"]
    assert "at most 20 words" in first["rewrite"]["single_minded_proposition"]
    assert W(30) in second["brief"]["single_minded_proposition"], "the second rewrite reads the first one's text"
    carried = fid_claims["check"][0]["single_minded_proposition"]
    assert carried, "the first rewrite derived a claim"
    assert second["prior_claims"]["single_minded_proposition"] == carried, "and the second rewrite is told of it"
    assert "Easy mornings" in host.data["single_minded_proposition"]
    bad = next(d for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "bad"
               and d["targets"][0].endswith("#single_minded_proposition"))
    pts = " ".join(p["point"] for p in bad["reasoning"]["because"])
    assert "at most 20 words" in pts and " Then: " in pts, "both asks are on the record"
    # only a check named it: the record says a check sent it back, not Jude
    assert "A check sent it back" in bad["reasoning"]["attention"]
    d = next(d for d in host.chain if d.get("action") == "draft" and bad["id"] in d["cites"])
    assert any(p["point"].startswith("A check: ") for p in d["reasoning"]["because"])
    assert "Jude" not in d["reasoning"]["attention"]
    check_change_rules(host)


def test_the_first_rewrite_of_a_code_only_part_reads_rewritten_on_a_check(tmp_path):  # T3b
    seen = {}
    m = faulty(seen, job="A job.")
    host = go(tmp_path, m, jev=FakeJev(), kw={"brief_judge": "jev"})
    bad = next(d for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "bad"
               and d["targets"][0].endswith("#single_minded_proposition"))
    d = next(d for d in host.chain if d.get("action") == "draft" and bad["id"] in d["cites"])
    att = d["reasoning"]["attention"] or ""
    assert "Rewritten on a check: " in att and "Rewritten on Jude" not in att


def test_the_cost_ceiling_on_the_jev_path(tmp_path):  # T4
    seen = {}
    m = faulty(seen, proposition="Short line.", job="A job.")
    go(tmp_path, m, jev=FakeJev(), kw={"brief_judge": "jev"})
    assert purposes(m).count("explain_flags") == 1
    assert "rewrite_brief_parts" not in purposes(m) and "review_brief" not in purposes(m)
    assert "tests_unanswered" not in whats(tmp_path)

    seen = {}
    m = faulty(seen)
    go(tmp_path / "b", m, jev=FakeJev(), kw={"brief_judge": "jev"})
    assert purposes(m).count("explain_flags") == 1 and purposes(m).count("rewrite_brief_parts") == 1

    # jev not answering: the review path's calls, and no loop call
    seen = {}
    m = faulty(seen)
    go(tmp_path / "c", m, jev=RaisingJev(), kw={"brief_judge": "jev"})
    assert "explain_flags" not in purposes(m) and purposes(m).count("review_brief") == 1


def test_a_jude_answer_that_omits_tests_is_logged_not_an_error(tmp_path):
    seen = {}
    m = faulty(seen)
    base = m.overrides["explain_flags"]
    m.overrides["explain_flags"] = lambda p: {k: v for k, v in base(p).items() if k != "tests"}
    host = go(tmp_path, m, jev=FakeJev(), kw={"brief_judge": "jev"})
    assert "tests_unanswered" in whats(tmp_path)
    assert SHORT in host.data["single_minded_proposition"], "code's send-backs do not wait for Jude's tests"


@pytest.mark.parametrize("setting", list(SETTINGS))
def test_every_judge_setting_calls_code_s_measures(tmp_path, setting, monkeypatch):  # T5
    mk, kw = SETTINGS[setting]
    calls = {"tests": 0, "revisions": 0}
    for name in calls:
        orig = getattr(checks, name)

        def wrap(*a, _o=orig, _n=name, **k):
            calls[_n] += 1
            return _o(*a, **k)
        monkeypatch.setattr(checks, name, wrap)
    go(tmp_path, faulty({}), jev=mk(), kw=kw)
    assert calls["tests"] >= 1 and calls["revisions"] >= 1


def regen(tmp_path, rewrite=None):
    """A planned draft under jev, then regenerate_field on the proposition, whose fix comes back as two
    sentences (a limit code measures); `rewrite` replaces the redraft's answer. -> (host, seen, fixes)"""
    from test_fix_parts import fix_model
    seen = {}
    m = faulty(seen, proposition="Short line.", job="A job.", m=fix_model(seen))
    fixes = []

    def fix(p):
        fixes.append(p)
        return {k: part("One thought. Then another thought.") for k in p["parts"]}
    m.overrides["fix_brief_parts"] = fix
    if rewrite:
        m.overrides["rewrite_brief_parts"] = rewrite
    m.overrides["plan_fix"] = lambda p: {
        "strategy": "Sharpen the line.", "parts": {k: {"instruction": "say it once"} for k in p["parts_to_fix"]},
        "brand": "Brewline", "competitors": [], "research": [], "category": p["categories"][0]["code"],
        "ask_client": []}
    s = Server(tmp_path, model=m, retrieval=retrieval(), jev=FakeJev(),
               settings_kw={"brief_flow": "planned", "brief_judge": "jev", "runlog_dir": str(tmp_path / "runs")})
    host = Host()
    try:
        run(s, host, inp={"prompt": THIN, "attachments": []})
        seen.pop("rewrite", None)
        run(s, host, task="regenerate_field", inp={"field": "single_minded_proposition", "guidance": "sharper"})
    finally:
        s.stop()
    return host, seen, fixes


def test_regenerate_field_on_the_jev_path_sends_the_proposition_back(tmp_path):  # T6
    host, seen, fixes = regen(tmp_path)
    assert fixes, "the redraft ran"
    assert "2 sentences" in seen["rewrite"]["rewrite"]["single_minded_proposition"]
    assert SHORT in host.data["single_minded_proposition"]
    # only a check sent it back: the decision says a check, and never Jude's note, for that part
    prop = [d for d in host.chain if d.get("action") == "draft" and d["targets"][0].endswith("#single_minded_proposition")
            and d["reasoning"]["decided"].startswith("Rewrote")]
    said = [d["reasoning"]["decided"] for d in prop]
    assert any("on a check" in x for x in said) and not any("Jude" in x for x in said), said


def test_a_fix_part_still_over_its_limit_after_both_rewrites_gets_no_good_verdict(tmp_path):
    host, seen, fixes = regen(tmp_path, rewrite=lambda p: {k: part("Still one. Still two.") for k in p["parts"]})
    assert "Still one" in host.data["single_minded_proposition"]
    good = [d for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "good"
            and any(t.endswith("#single_minded_proposition") for t in d["targets"])]
    assert not [d for d in good if "Checked the" in d["reasoning"]["decided"]], "nobody read the final text"


def test_the_clients_own_words_are_not_cut_and_a_held_part_becomes_a_proposal(tmp_path):  # T7
    # both paths measure through checks.revisions, which leaves the client's own words alone
    # (a client-basis part reaching a draft is the provenance tests' ground, not this file's)
    own = {"background": {"value": W(200), "basis": "client"}, "single_minded_proposition": {
        "value": "To confirm: " + W(10), "basis": "assumption"}}
    assert checks.revisions(own) == [] and "background" not in checks.facts(own)
    for setting in ("review", "jev"):
        mk, kw = SETTINGS[setting]
        # a person holds the proposition: the rewrite is proposed, their words stay
        seen = {}
        m = faulty(seen)
        host = go(tmp_path / (setting + "_held"), m, jev=mk(), kw=kw,
                  host=Host(data={"single_minded_proposition": "A person wrote this line."}))
        assert host.data["single_minded_proposition"] == "A person wrote this line."
        prop = [d for d in host.chain if d.get("action") == "propose"
                and d["targets"][0].endswith("#single_minded_proposition")]
        assert any(SHORT in d["proposed_value"] for d in prop), f"{setting}: the rewrite is a proposal"
        check_change_rules(host)


def test_jev_failing_between_its_two_readings_changes_nothing_twice(tmp_path):  # T8
    seen = {}
    m = faulty(seen)
    jev = SecondCallRaises()
    host = go(tmp_path, m, jev=jev, kw={"brief_judge": "jev"})
    assert purposes(m).count("rewrite_brief_parts") == 1, "checks were applied once, nothing sent back twice"
    assert SHORT in host.data["single_minded_proposition"]
    assert "jev_failed" in whats(tmp_path)
    check_change_rules(host)


def test_jev_down_with_an_empty_part_makes_no_loop_call_and_the_review_runs(tmp_path):  # T8b
    seen = {}
    m = faulty(seen, extra={"mandatories": None})
    host = go(tmp_path, m, jev=RaisingJev(), kw={"brief_judge": "jev"})
    assert "explain_flags" not in purposes(m) and "review_brief" in purposes(m)
    assert host.data["single_minded_proposition"], "the brief is placed"


def test_a_failing_jude_call_falls_back_to_the_review_and_the_brief_is_placed(tmp_path):  # T9
    seen = {}
    m = faulty(seen)
    m.overrides["explain_flags"] = lambda p: "not json at all"
    host = go(tmp_path, m, jev=FakeJev(), kw={"brief_judge": "jev"})
    assert "check_loop_failed" in whats(tmp_path)
    assert "review_brief" in purposes(m)
    assert SHORT in host.data["single_minded_proposition"], "the review path sent it back"
    assert host.data["insight"] and host.data["audience"], "no part is left unplaced"
    check_change_rules(host)


def test_jude_s_schema_takes_the_old_answer_shape_and_refuses_a_test_for_a_part_not_asked():  # T10
    ask = ["background"]
    tested = list(checks.TESTED)
    v = Draft202012Validator(checkloop.jude_schema(ask, tests=tested))
    old = {"parts": {"background": {"rework": False, "why": "fine", "instruction": ""}},
           "chain": {"issue": None, "parts": []}, "dimensions": [], "questions": []}
    assert not list(v.iter_errors(old)), "no `tests` key: still valid"
    ok = {**old, "tests": {"insight": {"pass": False, "failed_test": "fresh", "instruction": "make it fresh"}}}
    assert not list(v.iter_errors(ok))
    bad = {**old, "tests": {"audience": {"pass": True, "failed_test": "", "instruction": ""}}}
    assert list(v.iter_errors(bad)), "audience is not a tested part"
    assert "tests" not in checkloop.jude_schema(ask)["properties"], "no tested parts, no key"
    assert "tests" not in checkloop.jude_schema(ask, tests=tested)["required"]


def test_the_answered_verdict_says_only_what_happened_on_the_jev_path(tmp_path):  # T11
    seen = {}
    m = faulty(seen, job="A job.")
    host = go(tmp_path, m, jev=FakeJev(), kw={"brief_judge": "jev"})
    good = [d for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "good"]
    assert good, "the proposition passed after its rewrite"
    pts = " ".join(p["point"] for d in good for p in d["reasoning"]["because"])
    assert "Jude reviewed the brief again" not in pts
    assert "code measured it again and jev read it again" in pts

    # a part still over its limit after the last rewrite gets no 'answered' verdict
    seen = {}
    m = faulty(seen, job="A job.")
    m.overrides["rewrite_brief_parts"] = lambda p: {k: part(W(30)) for k in p["parts"]}
    host = go(tmp_path / "b", m, jev=FakeJev(), kw={"brief_judge": "jev"})
    assert not [d for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "good"
                and d["targets"][0].endswith("#single_minded_proposition")]

    # jev not answering after the rewrite: code alone measured it
    seen = {}
    m = faulty(seen, job="A job.")
    host = go(tmp_path / "c", m, jev=SecondCallRaises(), kw={"brief_judge": "jev"})
    pts = " ".join(p["point"] for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "good"
                   for p in d["reasoning"]["because"])
    assert "code measured it again" in pts and "jev read it again" not in pts


def test_the_loop_s_jude_prompt_carries_the_same_test_rules_as_the_review():  # T13
    tests, anti = checks.guide_parts("`tests` (pass false, one instruction that names the test and the fix)",
                                     "`tests` with pass false")
    system = checkloop.jude_system(list(checks.TESTED))
    assert tests in system and anti in system
    assert tests.split("@")[0][:40] in REVIEW_SYSTEM
    # the wording that is not about where a failing part goes is written once
    assert checks.TESTED_WORDS["insight"] in system and "a normal person" in system and "a normal person" in REVIEW_SYSTEM
    assert checkloop.jude_system([]) == checkloop.JUDE_SYSTEM, "no tested part: Jude's prompt is as it was"


def test_a_model_outage_on_a_brief_jev_finds_clean_still_places_the_draft(tmp_path):
    seen = {}
    m = faulty(seen, proposition="Short line.", job="A job.")
    m.overrides["explain_flags"] = lambda p: "not json at all"
    m.overrides["review_brief"] = lambda p: "not json at all"
    host = go(tmp_path, m, jev=FakeJev(), kw={"brief_judge": "jev"})
    w = whats(tmp_path)
    assert "check_loop_failed" in w and "review_failed_after_loop" in w
    assert host.data["insight"] and host.data["single_minded_proposition"], "the draft is placed"
    assert "Not reviewed" in json.dumps(host.data.get("review"))
    check_change_rules(host)


def test_the_review_summary_credits_a_check_not_jude_for_a_code_send_back(tmp_path):
    seen = {}
    m = faulty(seen, job="A job.")
    host = go(tmp_path, m, jev=FakeJev(), kw={"brief_judge": "jev"})
    summary = host.data["review"]["scorecard"]["summary"]
    assert "Jude sent 0 and a check sent 1 back" in summary, summary


def test_an_answered_verdict_says_jev_read_it_again_only_for_text_jev_read(tmp_path):
    # T3's setup: the proposition is rewritten twice, so jev never read its final text
    seen = {}
    m = faulty(seen, job="A job.")
    n = {"i": 0}

    def rewrite(p):
        n["i"] += 1
        return {k: part(W(30) if n["i"] == 1 else "Easy mornings, every day.") for k in p["parts"]}
    m.overrides["rewrite_brief_parts"] = rewrite
    host = go(tmp_path, m, jev=FakeJev(), kw={"brief_judge": "jev"})
    ans = [d for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "good"
           and d["targets"][0].endswith("#single_minded_proposition") and "answers the note" in d["reasoning"]["decided"]]
    assert ans, "code measured the final text and it passes"
    text = json.dumps(ans[0]["reasoning"])
    assert "code measured it again" in text and "jev read it again" not in text
