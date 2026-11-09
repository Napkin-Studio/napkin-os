"""The insight and proposition checks, from the planning skill (ADR 0034): one thought, not a thought
with an 'and'. Code flags the word; the judge decides whether it joins two thoughts."""

from napkin.brief.drafters import RANK_SYSTEM
from napkin.brief.fields import RUBRIC_FIELDS
from napkin.brief.judge import failures, judge_field
from napkin.brief.rubric import and_flag, reason_code


class Judge:
    """The capabilities model's `structured`, answering each test it is given: pass, except the ids in `fail`."""

    def __init__(self, fail=()):
        self.calls, self.fail = [], set(fail)

    def structured(self, purpose, system, payload, schema, max_tokens=None, **_):
        self.calls.append((purpose, payload))
        return {t["id"]: {"verdict": "fail" if t["id"] in self.fail else "pass",
                          "reason": "it joins two thoughts" if t["id"] in self.fail else "ok",
                          "fix": "keep one thought" if t["id"] in self.fail else None} for t in payload["tests"]}


def test_the_and_flag_fires_on_a_standalone_and_or_ampersand_only():
    assert and_flag("Fast and cheap.")
    assert and_flag("Black & Decker for the weekend.")
    assert and_flag("Tea AND toast")
    # not on a word that contains "and", a hyphenated or possessive form, or an ampersand inside a token
    assert not and_flag("The Irish relish that makes Tuesday's tea taste like you tried.")
    assert not and_flag("Understand the brand, land the plan.")
    assert not and_flag("Q&A is a service.")
    assert not and_flag("Rock-and-roll tea.")
    assert not and_flag("")
    assert not and_flag(None)


def test_the_judge_is_asked_about_an_and_and_not_failed_by_the_code():
    model = Judge()
    res = judge_field(model, "smp", {"single_minded_proposition": "Cheap and cheerful, every day."}, [])
    smp = [pl for p, pl in model.calls if p == "judge_smp"]
    assert smp and "single_minded" in smp[0]["flags"]
    assert "joins two thoughts" in smp[0]["flags"]["single_minded"]
    # the word alone fails nothing: the judge's pass stands
    assert next(c for c in res["checks"] if c["check"] == "single_minded")["status"] == "pass"


def test_a_judge_fail_on_two_thoughts_goes_back_to_the_writer_with_its_fix():
    model = Judge(fail={"single_minded"})
    res = judge_field(model, "smp", {"single_minded_proposition": "Cheap and cheerful, every day."}, [])
    got = failures(res)
    assert [f["check"] for f in got] == ["single_minded"]
    assert got[0]["fix"] == "keep one thought"


def test_no_flag_when_there_is_no_and():
    model = Judge()
    judge_field(model, "smp", {"single_minded_proposition": "You do not have to be at your worst to call."}, [])
    smp = [pl for p, pl in model.calls if p == "judge_smp"]
    assert smp and "flags" not in smp[0]


def test_the_proposition_tests_are_the_skills_five():
    ids = {c["id"]: c for c in RUBRIC_FIELDS["smp"]["rubric"]}
    # single minded, true, motivating, ownable, generative
    for want in ("single_minded", "true_backed", "reason_to_care", "ownable", "room_for_many_ads"):
        assert want in ids and ids[want]["method"] == "llm"
    assert "not a thought with an 'and'" in ids["single_minded"]["test"]
    assert ids["single_minded"]["tolerance"] == "hard"
    assert "not a thought with an 'and'" in RUBRIC_FIELDS["smp"]["prompt"]


def test_the_insight_tests_are_the_skills_four_beside_tension_and_why():
    ids = {c["id"]: c for c in RUBRIC_FIELDS["insight"]["rubric"]}
    # true and seen, about the audience, fresh, gives the product a role
    for want in ("rings_true", "about_audience", "fresh", "has_implication", "is_tension", "reveals_why"):
        assert want in ids
    assert ids["rings_true"]["method"] == ids["about_audience"]["method"] == ids["fresh"]["method"] == "llm"
    assert "role" in ids["has_implication"]["test"]
    assert "not a fact, a statistic or an observation" in RUBRIC_FIELDS["insight"]["prompt"].lower()


def test_the_writer_is_told_the_skills_wording_and_new_fails_have_reason_codes():
    assert "not a thought with an 'and'" in RANK_SYSTEM
    assert "never a list or an 'and'" not in RANK_SYSTEM
    assert reason_code("fresh") == "cliche"
    assert reason_code("true_backed") == "off_strategy"
