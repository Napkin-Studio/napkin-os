"""A stage the host refuses must not leave the report waiting for ever (and the document locked)."""

import importlib.util
from pathlib import Path

import pytest

from conftest import contract_suite
from napkin.pipeline import campaign

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("contract_test", contract_suite())
ct = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ct)

PROMPT = "BMW is trying to enter the Ev hybrid market in Ireland. Make a campaign clan on that"


class RefusingHost(ct.Host):
    """A host that refuses the research stage's change (it never applies it), as it would on a stale base."""

    def apply(self, ch):
        if ch.get("facts_append"):
            return None
        return super().apply(ch)


class TolerantRun(ct.Run):
    """The contract suite's driver, except that a staged finding may cite a fact of the refused stage: the
    synthesis ran on the job's working copy before the refusal was known. The host refuses that change in turn
    (it cites a pin it does not hold) and the job goes on without it too."""

    def check_staged(self, body):
        try:
            super().check_staged(body)
        except ct.Fail as e:
            if "which is not a pin in the document" not in str(e):
                raise
            self.cited_unlanded = True


def new_suite(server):
    return ct.Suite(ct.Client(server.url, None), REPO / "app" / "templates" / "campaign-research", 30)


def test_a_refused_stage_becomes_a_gap_the_job_finishes_and_frees_the_document(server):
    # Merged with integrate/jev-hardening: no stage may halt a job (owner, 2026-09-30), so a change the host
    # refuses is found (sent with the others, then alone: campaign.REFUSED_AFTER polls), dropped, and its stage
    # becomes a named gap; the job goes on to the report instead of failing (it failed here before the merge).
    suite = new_suite(server)
    doc, data, inp, facts, chain = ct.start_doc(PROMPT)
    host = RefusingHost(suite, doc, data, facts, chain)
    r = TolerantRun(suite, host, inp)
    r.start(ct.pick_first)
    assert r.states[-1] == "done"
    assert any(d.get("action") == "research" and "did not apply" in (d.get("rationale") or "") for d in host.chain)
    # the job is over, so the document is free again: a new campaign is accepted, not refused with 409
    status, _ = suite.c.task("start_campaign", inp, host.clan())
    assert status == 200


def test_a_host_that_applies_every_stage_is_not_cut_off(server):
    suite = new_suite(server)
    doc, data, inp, facts, chain = ct.start_doc(PROMPT)
    host = ct.Host(suite, doc, data, facts, chain)
    r = ct.Run(suite, host, inp)
    r.start(ct.pick_first)
    assert r.states[-1] == "done"
