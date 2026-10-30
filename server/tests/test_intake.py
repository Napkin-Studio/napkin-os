"""Intake (brief/intake.py, feature brief-intake-qa): the questions are rules over the capture, an
answer is one material and one capture item with the answer verbatim, and a question answered never
comes back in open_questions."""

import pytest

from napkin.brief import intake
from napkin.brief.capture import cap_id
from napkin.rules.quotes import find_quote


def item(key, value="x"):
    return {"key": key, "value": value, "status": "fact", "material_id": "mat_a", "quote": value}


def held(*keys):
    return {f"cap_{k}": item(k) for k in keys}


EVERYTHING = held("objective", "target_audience", "budget", "mandatories", "timeline")
NAMED = {"client": {"value": "Brewline", "quote": "Brewline", "material_id": "mat_a"}}


def keys(qs):
    return [q["key"] for q in qs]


def test_a_capture_holding_every_askable_item_asks_nothing():
    assert intake.questions(EVERYTHING, NAMED, 3) == []


@pytest.mark.parametrize("have,settles", [
    (("objective",), "objective"), (("success_metrics",), "objective"), (("target_audience",), "audience"),
    (("budget",), "budget"), (("mandatories",), "mandatories"), (("constraints",), "mandatories"),
    (("timeline",), "timeline")])
def test_each_item_settles_its_question(have, settles):
    assert settles not in keys(intake.questions(held(*have), {}, 10))
    assert settles in keys(intake.questions({}, {}, 10))


def test_the_client_is_settled_by_the_named_client_or_an_answer_not_by_any_item():
    assert "client" in keys(intake.questions(EVERYTHING, {}, 10))
    assert "client" in keys(intake.questions(held("background_context"), {}, 10), )
    assert "client" not in keys(intake.questions({}, NAMED, 10))


def test_an_answered_client_is_not_asked_again_on_a_redraft_that_names_no_client():
    asked = intake.questions({}, {}, 10)
    mat, items, *_ = intake.answer_items(asked, {"q_client": "Brewline"})
    stored = {mat.id: mat.entry("2026-10-30T09:00:00Z")}  # what the document holds after the first draft
    # the re-draft's own capture names no client: only the document's stored items and materials remain
    assert intake.answer_materials(stored) == {mat.id}
    assert "client" not in keys(intake.questions(items, {}, 10, intake.answer_materials(stored)))
    # a background_context item from some other material is not an answer
    other = {"cap_x": item("background_context")}
    assert "client" in keys(intake.questions(other, {}, 10, intake.answer_materials(stored)))


def test_one_question_per_gap_in_priority_order_and_capped():
    every = intake.questions({}, {}, 10)
    assert keys(every) == ["client", "objective", "audience", "budget", "mandatories", "timeline"]
    assert keys(intake.questions({}, {}, 3)) == ["client", "objective", "audience"]
    assert keys(intake.questions(held("objective"), NAMED, 2)) == ["audience", "budget"]
    assert intake.questions({}, {}, 0) == []
    for q in every:
        assert q["skippable"] is True and q["id"] == f"q_{q['key']}" and q["why"] and q["text"].endswith("?")


def test_the_strategic_parts_are_never_asked():
    asked = " ".join(q["text"].lower() for q in intake.questions({}, {}, 10))
    for word in ("tone", "insight", "barrier", "proposition", "objection", "competitor", "reasons to believe"):
        assert word not in asked
    assert not {"tone", "insight", "barrier", "proposition", "objection", "competitors"} & set(intake.KEYS)


def test_a_vague_audience_is_interpreted_not_asked():
    assert "audience" not in keys(intake.questions({"c": item("target_audience", "under-30s")}, NAMED, 10))


def test_an_answer_the_document_already_holds_is_not_asked_again():
    asked = intake.questions({}, NAMED, 10)
    mat, items, *_ = intake.answer_items(asked, {"q_budget": "EUR 150,000 incl. VAT"})
    assert "budget" not in keys(intake.questions(items, NAMED, 10))


def test_answers_become_one_material_and_one_verbatim_item_each():
    asked = intake.questions({}, NAMED, 10)
    answers = {"q_budget": '  EUR 150,000 incl. VAT, "media" inside it  ', "q_objective": None, "q_timeline": "  "}
    mat, items, done, skipped = intake.answer_items(asked, answers)
    assert (mat.kind, mat.name, mat.readable) == ("other", "Intake answers", True)
    assert mat.id.startswith("mat_") and mat.id == intake.answer_items(asked, answers)[0].id  # deterministic
    assert keys(done) == ["budget"] and keys(skipped) == ["objective", "audience", "mandatories", "timeline"]
    (cid, it), = items.items()
    value = 'EUR 150,000 incl. VAT, "media" inside it'
    assert it == {"key": "budget", "value": value, "status": "fact", "material_id": mat.id, "quote": value}
    assert cid == cap_id("budget", value, mat.id)
    assert find_quote(mat.text, it["quote"]), "the quote is in the material, so the provenance check holds"


def test_no_answer_builds_nothing_and_lists_every_question_as_skipped():
    asked = intake.questions({}, NAMED, 3)
    mat, items, done, skipped = intake.answer_items(asked, {})
    assert (mat, items, done) == (None, {}, []) and skipped == asked


def test_an_answer_to_the_client_question_is_filed_as_background_words():
    mat, items, done, _ = intake.answer_items(intake.questions({}, {}, 1), {"q_client": "Brewline, the coffee chain"})
    assert [i["key"] for i in items.values()] == ["background_context"]
