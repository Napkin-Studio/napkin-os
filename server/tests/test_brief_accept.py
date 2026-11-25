"""Acceptance run 2026-11-25 (local build 47fc87e0), Brief Maker findings A5-A8, offline. Copperell is a fictional brand."""

from napkin.brief import checks

from conftest import Server
from test_brief import DOC, Host, run, retrieval
from test_planned_brief import THIN, planned_model

LINE = "Refill. Not landfill."
END = "End line: 'Refill. Not landfill.' (word for word)"
# the acceptance run's mandatories after the redraft: the model's own wording sixth, no end line
A8_MANDS = ["Bottle is the hero, logo top right", "No real, recognisable faces", "No children near the product",
            "Include 'Keep out of reach of children. Read the label before use.'", "No plastic-free claim",
            "'Refill. Not landfill.' used word for word"]


# ── A8: the canonical end line goes first, in place of the model's own mention ────────────────────────────────────
def test_the_models_own_mention_of_the_line_gives_way_to_the_canonical_end_line_first():
    got = checks.carry_fixed_line(A8_MANDS, LINE)
    assert got[0] == END
    assert got[1:] == A8_MANDS[:5], "the restatement goes; nothing else moves"
    assert sum(1 for m in got if "landfill" in m.lower()) == 1, "no duplicate"
    assert checks.carry_fixed_line(got, LINE) is None, "idempotent"


def test_other_restatements_go_and_an_item_that_says_more_stays():
    for said in ("Use 'Refill. Not landfill.' word for word everywhere", "The line 'Refill. Not landfill.' runs on every piece, verbatim",
                 "Always use the end line Refill. Not landfill. exactly"):
        assert checks.carry_fixed_line(["No faces", said], LINE) == [END, "No faces"], said
    more = "Never pair 'Refill. Not landfill.' with a planet image"
    assert checks.carry_fixed_line([more], LINE) == [END, more]
    # an end line already there but not first moves to the top
    assert checks.carry_fixed_line(["No faces", END], LINE) == [END, "No faces"]


def test_a_redraft_whose_model_writes_its_own_mention_still_carries_the_end_line_first(tmp_path):
    m = planned_model({})
    for k in ("draft_brief_whole", "rewrite_brief_parts"):
        orig = m.overrides[k]

        def wrapped(p, orig=orig):
            out = orig(p)
            if "mandatories" in out:
                out["mandatories"] = {"value": A8_MANDS, "basis": "client", "cites": [], "builds_on_client": True, "why": "the client's"}
            return out
        m.overrides[k] = wrapped
    s = Server(tmp_path, model=m, retrieval=retrieval(), settings_kw={"brief_flow": "planned"})
    try:
        host = Host()
        run(s, host, inp={"prompt": THIN, "attachments": []})
        host.data["open_questions"] = ["Which line does the board prefer: the client's 'Clean, without the plastic.' or 'Refill. Not landfill.'? — "
                                       "Answer: Refill. Not landfill. Use it word for word everywhere."] + list(host.data["open_questions"])
        host.chain.insert(0, {"id": "d_HUMAN00031", "kind": "edit", "actor": "human:shrey", "agent": "human:shrey",
                              "action": "answer an open question", "targets": [f"{DOC}#open_questions"], "timestamp": "2026-11-25T10:00:00Z"})
        replies = run(s, host, inp={"prompt": THIN, "attachments": [], "intake": False, "redraft": True})
    finally:
        s.stop()
    props = {p["field"]: p["value"] for p in replies[-1]["result"]["proposals"]}
    mands = props.get("mandatories") or host.data["mandatories"]
    assert mands[0] == END, mands
    assert "'Refill. Not landfill.' used word for word" not in mands


# ── A6: the same ask in other words, and a body part that asks the client ─────────────────────────────────────────
from napkin.brief.questions import dedupe, same_ask  # noqa: E402

TRACKER_1 = "Is there budget for a pre-launch tracker wave and a regional holdout? — Answer: Yes, confirmed"
TRACKER_2 = "Is there money for a tracker wave before April and an area with no posters to compare against?"
BUDGET_PART = ("Deliverables: posters for stations and big supermarkets. Budget: to be confirmed, described as mid-size. "
               "Does it include VAT, and does media sit inside it?")


def test_the_tracker_question_in_other_words_is_the_same_ask():
    assert same_ask(TRACKER_1, TRACKER_2)
    kept, merged = dedupe([TRACKER_1, TRACKER_2])
    assert kept == [TRACKER_1], "the answered one stays, the twin goes"
    assert merged


def test_same_meaning_words_do_not_merge_different_asks():
    assert not same_ask("What is the media budget?", "What is the production budget?")
    assert not same_ask("What is the budget?", "What is the media budget?")
    assert not same_ask("Is there a pre-launch tracker wave?", "Is there a regional holdout?")
    assert not same_ask("When is the tender due?", "When does the campaign go live?")


def test_a_stating_part_that_asks_the_client_goes_back_and_the_audiences_voice_does_not():
    back = checks.revisions({"budget_and_scope": {"value": BUDGET_PART, "basis": "client"}})
    assert back and back[0]["part"] == "budget_and_scope"
    assert "Does it include VAT, and does media sit inside it?" in back[0]["instruction"]
    assert checks.revisions({"objection": {"value": '"Will it really clean as well as my usual spray?"', "basis": "assumption"}}) == []
    assert checks.asked_in("Never say 'Why pay more?' on a poster.") == [], "a quoted question is words to avoid, not an ask"
    assert checks.asked_in("£200k excluding VAT, media included.") == []
