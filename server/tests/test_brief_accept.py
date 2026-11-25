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


def test_a_kept_mandatories_gets_the_end_line_as_a_proposal_never_written_over(tmp_path):
    m = planned_model({})
    for k in ("draft_brief_whole", "rewrite_brief_parts"):
        orig = m.overrides[k]
        m.overrides[k] = lambda p, orig=orig: {k2: v for k2, v in orig(p).items() if k2 in p["parts"]}   # only the open parts, as a model answers
    s = Server(tmp_path, model=m, retrieval=retrieval(), settings_kw={"brief_flow": "planned"})
    try:
        host = Host()
        run(s, host, inp={"prompt": THIN, "attachments": []})
        host.data["mandatories"] = list(A8_MANDS)
        host.data["locked_fields"] = ["mandatories"]   # Keep as is
        host.data["open_questions"] = ["Which line does the board prefer: the client's 'Clean, without the plastic.' or 'Refill. Not landfill.'? — "
                                       "Answer: Refill. Not landfill. Use it word for word everywhere."] + list(host.data["open_questions"])
        host.chain.insert(0, {"id": "d_HUMAN00032", "kind": "edit", "actor": "human:shrey", "agent": "human:shrey",
                              "action": "answer an open question", "targets": [f"{DOC}#open_questions"], "timestamp": "2026-11-25T10:00:00Z"})
        replies = run(s, host, inp={"prompt": THIN, "attachments": [], "intake": False, "redraft": True})
    finally:
        s.stop()
    assert host.data["mandatories"] == A8_MANDS, "the person's part is not written over"
    props = {p["field"]: p["value"] for p in replies[-1]["result"]["proposals"]}
    assert props["mandatories"][0] == END and "'Refill. Not landfill.' used word for word" not in props["mandatories"]


# ── A9: a client's file keeps its own name ─────────────────────────────────────────────────────────────────────
def test_an_attachment_is_named_by_its_own_file_name_not_the_stored_one():
    from napkin.doc import build_materials
    sha = "a" * 64
    mats, unread = build_materials({"attachments": [{"name": "document-1795538546841-0.txt", "label": "copperell-brand-notes.txt",
                                                     "sha256": sha, "text": "Copperell brand notes."}]}, {})
    assert [m.name for m in mats] == ["copperell-brand-notes.txt"]
    mats2, _ = build_materials({"attachments": [{"name": "brief.pdf", "sha256": sha, "text": "x"}]}, {})
    assert [m.name for m in mats2] == ["brief.pdf"], "no label: the name, as before"
    mats3, _ = build_materials({"attachments": [{"name": "document-1-0.txt", "label": "  ", "sha256": sha, "text": "x"}]}, {})
    assert [m.name for m in mats3] == ["document-1-0.txt"], "an empty label is no label"


# ── A10: Fix this with the agents changes the parts its note names, re-opens nothing a person settled, counts honestly ──
from napkin.brief.fix import standing_problem  # noqa: E402
from test_fix_parts import drafted, jude_note  # noqa: E402


def _v(i, kind, parts, **kw):
    return {"id": i, "kind": kind, "targets": [f"{DOC}#{k}" for k in parts], **kw}


def test_a_good_word_from_the_same_reading_does_not_take_a_part_out_of_the_fix():
    # the acceptance brief: the note on the reason to believe and the objection, and in the same review a good word on
    # another point of the reason to believe, both judging the same draft
    write = _v("d_AFNCL4VNMV6R", "edit", ["reasons_to_believe"], action="draft", actor="agent:drafter")
    note = _v("d_HUD5X5GRRUPI", "verdict", ["reasons_to_believe", "objection"], polarity="bad", actor="agent:judge",
              cites=["d_AFNCL4VNMV6R", "d_O6CRYKMY4BLN"], rationale="'You can watch it work' contradicts the objection.")
    same = _v("d_2N5ZIKATJPVD", "verdict", ["reasons_to_believe"], polarity="good", actor="agent:judge",
              cites=["d_AFNCL4VNMV6R"], rationale="'Not used: …' is a ban, not a reason to believe.")
    parts, _ = standing_problem(DOC, [same, note, write], "d_HUD5X5GRRUPI")
    assert parts == ["reasons_to_believe", "objection"], "the words at fault are in the reason to believe: it is fixed too"
    # a later pass on a newer write still answers it, as the page reads it
    later = _v("d_ok", "verdict", ["reasons_to_believe"], polarity="good", actor="agent:judge", cites=["d_NEWWRITE"],
               rationale="Checked the fix.")
    assert standing_problem(DOC, [later, same, note, write], "d_HUD5X5GRRUPI")[0] == ["objection"]
    # and a person's keep answers it
    kept = _v("d_keep", "verdict", ["reasons_to_believe"], polarity="good", actor="human:local", rationale="Planner decision: keep.")
    assert standing_problem(DOC, [kept, note, write], "d_HUD5X5GRRUPI")[0] == ["objection"]


def test_a_fix_never_places_a_note_on_a_part_it_did_not_write_and_counts_what_still_needs_you(tmp_path):
    seen = {}
    s, host = drafted(tmp_path, seen)
    try:
        note = jude_note(host)
        fixed = [t.split("#", 1)[1] for t in note["targets"]]
        # the person kept the proposition with a reason before asking for the fix
        host.chain.insert(0, {"id": "d_keep_smp", "kind": "verdict", "polarity": "good", "actor": "human:local",
                              "targets": [f"{DOC}#single_minded_proposition"], "rationale": "Kept: the line is the sign-off."})
        review = s.model.overrides["review_brief"]

        def still(p):  # the Review agent, after the fix, notes one fixed part together with the kept proposition
            out = review(p)
            out["notes"] = [{"parts": [fixed[0], "single_minded_proposition"], "severity": "fix", "note": "Still one doubt short."}]
            out["revise"] = []
            return out
        s.model.overrides["review_brief"] = s.model.overrides["review_brief_again"] = still
        replies = run(s, host, task="fix_parts", inp={"verdict": note["id"]})
    finally:
        s.stop()
    new_bad = [d for d in replies[-1]["change"]["decisions"] if d["kind"] == "verdict" and d.get("polarity") == "bad"] if replies[-1].get("change") else []
    new_bad = new_bad or [d for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "bad" and d["id"] != note["id"]
                          and "fix_parts" in str(d.get("agent") or d.get("handler") or "")]
    named = {t.split("#", 1)[1] for d in new_bad for t in d["targets"]}
    assert "single_minded_proposition" not in named, "a part the person kept is never re-opened by the fix"
    summary = replies[-1]["result"]["summary"]
    assert "still needs you" in summary and summary.startswith(f"Fixed {len(fixed) - 1} of {len(fixed)} part(s)"), summary


def test_the_brief_makers_own_materials_carry_the_file_name_too():
    from napkin.brief.capture import build_materials as brief_materials
    sha = "c" * 64
    mats = brief_materials({"attachments": [{"name": "document-1795538546841-0.txt", "label": "copperell-brand-notes.txt",
                                             "sha256": sha, "media_type": "text/plain", "text": "Notes."}]}, {})
    assert [m.name for m in mats] == ["copperell-brand-notes.txt"]
