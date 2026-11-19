"""brief_issues: the brief tool flags what is wrong with or missing from a brief instead of smoothing it, and never adopts a passage
that looks pasted from another brief as the client's objective. Also the JSON reader that made every deck stage b reply unusable.

Offline: no model (the scorecard is faked). Every brand, brief and reply here is invented."""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import brief_issues as BI  # noqa: E402
import brief_llm  # noqa: E402
import parse_brief as pb  # noqa: E402

#: An invented weak brief: a store launch with another company's anniversary objectives pasted into it, a mascot that is both
#: mandatory and to be cut, money for one year and a campaign that runs into the next, and no audience or budget figure.
MESSY = (
    "Brightbarn is opening its first two home-goods stores in Lakeside and Hillport. "
    "Communication objectives: celebrate 30 years of Crumbly Biscuits and build trust in the Crumbly family recipe. "
    "The key visuals must include the Barnaby mascot. "
    "In the closing notes, please reduce the use of the Barnaby mascot and the logo. "
    "The budget is approved for 2025 and must be spent by December 2025. "
    "The campaign runs for 12 weeks from March 2026."
)
FOREIGN = "celebrate 30 years of Crumbly Biscuits and build trust in the Crumbly family recipe"


def test_the_rule_checks_flag_the_missing_basics_and_the_two_contradictions():
    got = {(i["kind"], i["topic"]) for i in BI.rule_checks(MESSY)}
    assert ("missing", "audience") in got and ("missing", "budget") in got        # no audience, no figure (only years)
    assert ("contradiction", "timing") in got and ("contradiction", "mandatories") in got
    timing = next(i for i in BI.rule_checks(MESSY) if i["topic"] == "timing")
    assert "2025" in timing["what"] and "2026" in timing["what"] and timing["quote"] in MESSY and timing["question"].endswith("?")


def test_a_complete_brief_raises_no_rule_issue():
    ok = ("Pinehollow Dairy wants 10% more shoppers to buy its oat milk by June 2027. Our audience is parents aged 30 to 45 "
          "in the north-west. The budget is EUR 200,000.")
    assert BI.rule_checks(ok) == []


def test_the_models_list_is_verified_merged_and_ranked():
    raw = [{"kind": "missing", "topic": "audience", "what": "No audience.", "why_it_matters": "Aimed at no one.", "question": "Who is it for?"},
           {"kind": "foreign_content", "topic": "objective", "what": "The objectives are another company's.", "why_it_matters": "Wrong goal.",
            "question": "Can you send this launch's own objectives?", "quote": FOREIGN},
           {"kind": "contradiction", "topic": "brand", "what": "Invented clash.", "why_it_matters": "x", "question": "Which one?",
            "quote": "words this brief never says"},   # unverifiable: dropped, never attributed to the brief
           {"kind": "opinion", "what": "x", "question": "y?"}]                                  # unknown kind: dropped
    issues = BI.detect(MESSY, raw)
    kinds = [i["kind"] for i in issues]
    assert kinds[0] == "foreign_content" and kinds == sorted(kinds, key=BI.KINDS.index)
    assert not [i for i in issues if i["question"] == "Which one?"]
    assert [i for i in issues if i["topic"] == "audience" and i["source"] == "model"]           # the model's, not a second rule copy
    assert len([i for i in issues if i["topic"] == "audience"]) == 1
    assert [i["id"] for i in issues] == [f"bi_{n:02d}" for n in range(1, len(issues) + 1)]
    assert all(set(i) >= {"kind", "topic", "what", "why_it_matters", "question", "quote", "source"} for i in issues)


def test_a_foreign_passage_is_quarantined_never_adopted_as_the_objective():
    obj = {"loop2_golden": {"fields": {"objectives": {"value": {"attitudinal": FOREIGN.capitalize() + ".", "behavioural": None}},
                                       "audience": {"value": "Shoppers in two towns."}}},
           "loop1_capture": {"fields": {"objectives": [{"value": "Celebrate 30 years of Crumbly Biscuits", "status": "fact"}]}},
           "loop2_brief": {"objective": FOREIGN, "open_questions": []}}
    issues = BI.detect(MESSY, [{"kind": "foreign_content", "topic": "objective", "what": "Another company's objectives.",
                                "why_it_matters": "The work would chase the wrong goal.", "question": "What are this launch's objectives?",
                                "quote": FOREIGN}])
    n = BI.quarantine(obj, issues)
    assert n == 3
    assert obj["loop2_golden"]["fields"]["objectives"]["value"]["attitudinal"] is None
    assert obj["loop1_capture"]["fields"]["objectives"][0]["value"] is None and obj["loop1_capture"]["fields"]["objectives"][0]["quarantined"]
    assert obj["loop2_brief"]["objective"] is None and obj["loop2_golden"]["fields"]["audience"]["value"] == "Shoppers in two towns."
    assert {q["value"] for q in issues[0]["quarantined"]} >= {FOREIGN}


def test_run_writes_brief_issues_from_the_scorecard_and_quarantines(monkeypatch):
    """run(): the scorecard's model list (brief_issues.PROMPT rides in its call) is verified, merged with the rules and written to
    brief_object.brief_issues; the scorecard keeps its own shape; a foreign objective leaves the capture."""
    monkeypatch.setattr(pb, "capture_toon", lambda segs: {"fields": {"objectives": {"value": FOREIGN, "status": "fact"}},
                                                          "how_to_win": {}, "open_questions": []})
    monkeypatch.setattr(pb, "how_to_win_toon", lambda segs: {})
    raw = [{"kind": "foreign_content", "topic": "objective", "what": "Another brand's anniversary objectives.",
            "why_it_matters": "The launch has no objective of its own.", "question": "What should the two openings achieve?", "quote": FOREIGN}]
    monkeypatch.setattr(pb, "score_betterbriefs", lambda text, fields=None: {"dimensions": [], "mode": "llm", "brief_issues": raw})
    monkeypatch.setenv("BRIEF_ALLOW_NONCLAUDE", "1")
    out = pb.run(None, raw_text=MESSY)
    assert "brief_issues" not in out["betterbriefs_scorecard"]
    issues = out["brief_issues"]
    assert issues[0]["kind"] == "foreign_content" and issues[0]["quarantined"]
    assert {(i["kind"], i["topic"]) for i in issues} >= {("contradiction", "timing"), ("contradiction", "mandatories"), ("missing", "budget")}
    assert out["loop1_capture"]["fields"]["objectives"]["value"] is None
    assert BI.PROMPT in pb.SCORECARD_SYSTEM and '"brief_issues"' in pb.SCORECARD_SYSTEM


# ------------------------------------------------------------------------------------------------ fewer unreadable-output retries

#: A captured shape of the deck's stage b reply (19 Nov 2026), content invented: a fenced object, then a paragraph after the fence.
#: Every such reply read as unusable (whole=True), so each stage b paid three tries and a repair call.
TRAILING_PROSE = '''```json
{
  "reframe": {"title": "The real job is to make a small saving feel like ours", "line": "Use less, together.", "claims": []},
  "audience": {"title": "Households who think they are careful already", "voices": []},
  "proposition": {"rtbs": [{"text": "A shared goal: a 5% cut in 12 months.", "refs": ["prompt:2"]}]}
}
```

**Questions for the client.** The evidence is thin, so:
1. What is the baseline? {not JSON}
2. When will a budget be set?'''


def test_a_whole_reply_with_prose_after_the_fence_is_read():
    obj = brief_llm._loads_lenient(TRAILING_PROSE, whole=True)
    assert obj["reframe"]["line"] == "Use less, together." and obj["proposition"]["rtbs"][0]["refs"] == ["prompt:2"]
    assert brief_llm._loads_lenient("Here it is: [1, 2, 3] and that is all.", whole=True) == [1, 2, 3]


def test_a_truncated_reply_still_reads_as_unusable():
    cut = TRAILING_PROSE.split('"proposition"')[0]   # the outer object never closes
    assert brief_llm._loads_lenient(cut, whole=True) is None
    assert brief_llm._outer_value('{"a": [1, 2}') is None   # a mismatched bracket is not a value


def test_json_call_takes_the_reply_in_one_call(monkeypatch):
    """The whole chain: one link answers the trailing-prose reply and _json_call returns it at once (no retry, no repair)."""
    calls = []

    def link(provider, model, user, **kw):
        calls.append(model)
        return TRAILING_PROSE
    monkeypatch.setattr(brief_llm, "_call_link", link)
    reader = lambda raw: brief_llm._loads_lenient(raw, whole=True)
    obj = brief_llm._json_call("u", system="s", model="claude-opus-5-5", only_model=True, parse=reader, retries=1)
    assert obj["audience"]["voices"] == [] and calls == ["claude-opus-5-5"]
