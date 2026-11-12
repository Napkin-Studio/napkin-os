"""A start_campaign question can be skipped (answer_question `skip: true`, middleware-api §8.3;
features/research-skip-question.clan). The field stays empty, the job goes on as it does for a question
nobody answers, and the skip is recorded: a decision, a chat message, a gap and a run-log event."""

import json

import pytest

from napkin import runlog
from napkin.util import TaskError

from test_no_halt import BMW, LABELLED, TONIC, TWO_BRANDS, MiniHost, drive, reasoned, start

NO_BRAND = "Launch it in Ireland this spring."
NO_MARKET = "Brand: Harbour Tonic\nLaunch the tonic this spring."


def skip_write(h, q, who="human:u"):
    """The view: the person's message (answer.skipped) as their own write, then nothing on the field."""
    mid = f"msg_SKIP{len(h.chain):04d}"
    h.data.setdefault("intake", {}).setdefault("messages", {})[mid] = {
        "role": "user", "by": who, "at": "2026-11-12T10:00:00Z", "text": "Skipped", "job_id": "job_test0001",
        "answer": {"question_id": q["id"], "skipped": True}}
    did = f"d_TESTSKIP{len(h.chain):04d}"
    h.chain.insert(0, {"id": did, "kind": "edit", "agent": "human", "action": "answer_question",
                       "targets": [f"{h.doc}#intake.messages[{mid}]"], "rationale": f"{q['id']} skipped by {who}"})


def skipper(fields, asked):
    """Skip every question about one of `fields`; anything else fails the test."""
    def answer(job, h, q):
        fld = q["address"].partition("#campaign.")[2]
        asked.append(fld)
        assert fld in fields, f"asked about {fld}: {q['text']}"
        skip_write(h, q)
        job.answer(h.clan(), {"job_id": job.id, "question_id": q["id"], "skip": True})
    return answer


def skip_recorded(host, job, fld):
    label = fld.replace("_", " ")
    assert fld in job.skipped_fields
    assert {"stage": "identify", "reason": "skipped"} in job.gaps
    d = next(d for d in host.chain if d.get("agent") != "human"
             and d["reasoning"]["decided"] == f"Went on without the {label}: you skipped the question.")
    assert d["action"] == "identify" and "human:u skipped" in d["rationale"]
    assert d["reasoning"]["attention"].startswith(f"You skipped the question, so the job went on without the {label}")
    assert any(m.startswith(f"You skipped it, so I went on without the {label}") for m in host.messages())
    reasoned(host)


@pytest.mark.parametrize("prompt,fld", [(NO_BRAND, "brand"), (TWO_BRANDS, "brand")])
def test_a_skipped_brand_stays_empty_and_the_run_goes_on(store, prompt, fld):
    host, asked = MiniHost(prompt), []
    job = start(store, host)
    v = drive(job, host, skipper({"brand", "categories"}, asked))
    assert asked[0] == "brand" and asked.count("brand") == 1, "a skipped question is not asked again"
    assert v["state"] == "done"
    assert "brand" not in host.data["campaign"]
    skip_recorded(host, job, "brand")
    assert not job.unattended, "a skip is not nobody answering: later questions are still asked"


def test_a_skipped_category_goes_on_without_one_and_research_names_the_gap(store):
    host, asked = MiniHost(BMW), []
    job = start(store, host)
    v = drive(job, host, skipper({"categories"}, asked))
    assert asked == ["categories"]
    assert v["state"] == "done"
    assert "categories" not in host.data["campaign"], "a skip never takes the material's reading"
    skip_recorded(host, job, "categories")
    assert {"stage": "research", "reason": "gated"} in job.gaps
    # nothing to cite: the job ends done with no report, and says the person skipped, not that a step failed
    assert "report" not in host.data
    end = next(m for m in host.messages() if m.startswith("There's no report"))
    assert "You skipped the question about the categories." in end and "working out the brand" not in end


def test_a_skipped_market_goes_on_without_one_and_ends_saying_why(store):
    host, asked = MiniHost(NO_MARKET, categories=TONIC), []
    job = start(store, host)
    v = drive(job, host, skipper({"markets"}, asked))
    assert asked == ["markets"]
    assert v["state"] == "done"
    assert "markets" not in host.data["campaign"]
    skip_recorded(host, job, "markets")
    assert {"stage": "research", "reason": "no_market"} in job.gaps
    assert any(m.startswith("Nothing to research: no market is settled") for m in host.messages())


def test_a_skip_is_an_answer_event_in_the_run_log(store, tmp_path):
    runlog.configure(str(tmp_path), bodies=True)
    try:
        host, asked = MiniHost(NO_BRAND), []
        job = start(store, host)
        job.caps.runlog = runlog.open_log(job.id, "start_campaign@1.0", "org/test-agency")
        drive(job, host, skipper({"brand", "categories"}, asked))
    finally:
        runlog.configure(None)
    events = [json.loads(line) for p in tmp_path.rglob("*.jsonl") for line in p.read_text().splitlines()]
    answers = [e for e in events if e.get("ev") == "answer"]
    assert answers and all(e.get("skipped") is True for e in answers)


@pytest.mark.parametrize("extra,why", [
    ({}, "exactly one of option_id, text and skip"),
    ({"skip": True, "text": "x"}, "exactly one of option_id, text and skip"),
    ({"skip": True, "option_id": "o"}, "exactly one of option_id, text and skip"),
    ({"option_id": "o", "text": "x"}, "exactly one of option_id, text and skip"),
    ({"skip": True, "option_id": "o", "text": "x"}, "exactly one of option_id, text and skip"),
    ({"skip": False}, "skip, when given, must be true"),
    ({"skip": "yes"}, "skip, when given, must be true"),
])
def test_answer_question_takes_exactly_one_of_option_text_and_skip(store, extra, why):
    host = MiniHost(NO_BRAND)
    job = start(store, host)
    seen = []

    def answer(job, h, q):
        if not seen:
            seen.append(q)
            with pytest.raises(TaskError) as e:
                job.answer(h.clan(), {"job_id": job.id, "question_id": q["id"], **extra})
            assert e.value.status == 400 and why in e.value.message
            assert job.view()["state"] == "needs_input", "a refused answer leaves the question open"
        skip_write(h, q)
        job.answer(h.clan(), {"job_id": job.id, "question_id": q["id"], "skip": True})
    assert drive(job, host, answer)["state"] == "done" and seen
