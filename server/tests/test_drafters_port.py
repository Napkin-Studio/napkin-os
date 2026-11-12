"""The ADR 0007 port fix in drafters.py (features/brief-proposition-candidates.clan, phase 0): the sourced seeds, the
ownable sentence, the ranker's copy-device wording, and the two additive keywords. Correct on their own whether or
not the candidate step is ever built. No model call."""

import re

from napkin.brief import drafters
from napkin.brief.fields import RUBRIC_FIELDS

import pytest

REASON_FROM = "Reason from the drafted insight, the plan, the facts and the client's words, and the precedent passages if any are given."


# ---------------------------------------------------------------------------------- the port fix (U18-U20)

def test_seeds_are_the_sourced_proposition_types():
    """U18: like engine/rag/test_smp_rules.py's test of the engine's tuple."""
    joined = " ".join(drafters.SMP_ANGLE_SEEDS)
    for word in ("killer fact", "promise", "emotional benefit", "big idea"):
        assert word in joined
    assert "judged" not in joined and "settles for" not in joined
    assert len(drafters.SMP_ANGLE_SEEDS) == 4


def test_seeds_are_word_for_word_the_engines():
    """The server cannot import engine/ (the image never holds it), so the words are compared from the source."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[2] / "engine/parse_brief.py").read_text()
    block = re.search(r"SMP_ANGLE_SEEDS = \((.*?)\n\)", src, re.S).group(1)
    engine = tuple(re.findall(r'^\s*"(.*)",$', block, re.M))
    assert engine == drafters.SMP_ANGLE_SEEDS


@pytest.mark.parametrize("rid", ["smp", "insight"])
def test_ownable_sentence_is_the_engines_not_the_stale_one(rid):
    """U20: 'Never restate' is gone; the engine's standing-line and split-audience wording is in."""
    for n in (1, 4):
        s = drafters.field_system(rid, n)
        assert "Never restate" not in s and "tagline" not in s.split("OWNABLE TENSION")[1].split("Reason from")[0]
        assert "Do not simply restate the brand's standing line unless the brief asks for continuity" in s
        assert "name the tension that unites the segments" in s


def test_ranker_wording_names_copy_devices_and_keeps_one_thought():
    """U20: 'restated taglines' replaced by the copy devices; ADR 0034's one-thought sentence stays."""
    s = drafters.RANK_SYSTEM
    assert "restated" not in s
    assert "pun or double meaning" in s and "headline-able is not a fault" in s
    assert "one thought, not a thought with an 'and'" in s


def test_field_system_keywords_default_to_the_text_as_it_was():
    """U19: both keywords at their defaults change nothing; grounds=False and reason_from drop and replace."""
    base = drafters.field_system("smp", 4)
    assert base == drafters.field_system("smp", 4, grounds=True, reason_from=None)
    assert "Each draft carries its own grounds." in base and drafters.GROUNDS_GUIDE in base
    assert "Reason from the working brief, the client's captured words and the precedent passages given." in base
    new = drafters.field_system("smp", 4, grounds=False, reason_from=REASON_FROM)
    assert "carries its own grounds" not in new and "Also return `grounds`" not in new
    assert "working brief" not in new and REASON_FROM in new
    assert "GENUINELY DISTINCT drafts" in new and "Make them compete." in new
    assert "Each draft carries its own grounds" not in drafters.field_system("smp", 1, grounds=False)


def test_rank_without_context_sends_the_payload_drafter_rank_sent_before():
    """U19: the payload and system are what Drafter._rank built (field, examples, index and value only)."""
    seen = {}

    def call(purpose, system, payload, schema):
        seen.update(purpose=purpose, system=system, payload=payload)
        return {"ranking": [1, 0], "why_winner": "w", "losers": [{"index": 0, "why": "x"}]}

    order, why, losers = drafters.rank(call, "smp", [{"value": "a"}, {"value": "b"}])
    f = RUBRIC_FIELDS["smp"]
    assert seen["purpose"] == "rank_smp"
    assert seen["payload"] == {"field": f["label"], "good_example": f["good_example"], "bad_example": f["bad_example"],
                               "candidates": [{"index": 0, "value": "a"}, {"index": 1, "value": "b"}]}
    crit = "; ".join(f"{r['id']}: {r['test']}" for r in f["rubric"] if r["method"] == "llm")
    assert seen["system"] == drafters.RANK_SYSTEM.format(label=f["label"], crit=crit)
    assert (order, why, losers) == ([1, 0], "w", {0: "x"})


def test_drafter_rank_delegates_to_the_module_function():
    drafter = drafters.Drafter.__new__(drafters.Drafter)
    drafter.rid = "smp"
    drafter._call = lambda purpose, system, payload, schema: {"ranking": [0], "why_winner": "", "losers": []}
    assert drafter._rank([{"value": "a"}, {"value": "b"}]) == ([0, 1], "", {})


def test_rank_with_context_adds_it_and_the_flags():
    seen = {}

    def call(purpose, system, payload, schema):
        seen.update(system=system, payload=payload)
        return {"ranking": [0], "why_winner": "", "losers": []}

    drafters.rank(call, "smp", [{"value": "a", "words": 1, "and_flag": True}], context={"insight": "i"})
    assert seen["payload"]["context"] == {"insight": "i"}
    assert seen["payload"]["candidates"] == [{"index": 0, "value": "a", "words": 1, "and_flag": True}]
    assert drafters.RANK_CONTEXT_NOTE in seen["system"]
