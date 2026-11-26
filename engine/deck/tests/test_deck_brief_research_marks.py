"""5-tool run, 2026-11-26 (Tidewell, a fictional brand): a deck spun off a brief whose research carries a Confidential mark was refused with
MarksError, "names a document this deck does not hold". The brief's chain marked a part of the research (a ``classify`` decision on
``<research id>#<path>``), but ``apply_upstream_brief`` looked the mark up in no document but the brief. The host now sends the research the
brief carried under the brief's own ``upstream`` (crates/napkin-host read.rs ``brief_upstream``), and the mark is read there. A mark naming a
document that is truly absent is still refused: never skipped."""

from __future__ import annotations

import json
from argparse import Namespace

import pytest

from deck import inputs, run_deck

BRIEF_ID, RESEARCH_ID, PROD_ID = "doc-brief-tidewell", "doc-research-tidewell", "doc-prod-tidewell"
SECRET = "Tidewell's Q3 retailer margin is 31 percent"
RESEARCH = {"campaign": {"name": "Tidewell category"},
            "report": {"summary": {"value": SECRET, "origin": "client", "source": "upload"}}}
BRIEF = {"project_name": "Tidewell Launch", "client": "Tidewell", "objectives": {"commercial": "Win shelf space."},
         "single_minded_proposition": "Water you can taste the coast in.", "audience": "Coastal weekenders."}
CHAIN = [{"kind": "classify", "targets": [f"{RESEARCH_ID}#report.summary"], "licence": {"model": False, "corpus": False}}]


def _empty():
    return inputs.load(None, None, None, [], prompt_text="A pitch for Tidewell")


def _brief(with_research: bool = True) -> dict:
    return {**BRIEF, "upstream": {RESEARCH_ID: RESEARCH}} if with_research else dict(BRIEF)


def test_a_mark_the_briefs_chain_holds_on_its_research_is_read_in_the_research_it_carries():
    inp = _empty()
    assert inputs.apply_upstream_brief(inp, BRIEF_ID, _brief(), CHAIN)
    assert inp.brief["smp"]["value"] == "Water you can taste the coast in."
    got = [m for m in inp.marks if m["kind"] == "classify"]
    assert got == [{"path": f"{RESEARCH_ID}#report.summary", "text": SECRET, "kind": "classify"}]   # the value, not its provenance


def test_a_mark_on_a_document_the_deck_truly_does_not_hold_is_still_refused():
    with pytest.raises(inputs.MarksError, match="names a document this deck does not hold"):
        inputs.apply_upstream_brief(_empty(), BRIEF_ID, _brief(with_research=False), CHAIN)


def test_a_mark_on_the_carried_production_project_is_read_there(tmp_path):
    chain = [{"kind": "classify", "targets": [f"{PROD_ID}#notes.client"], "licence": {"model": False}}]
    prod = {"app": "production-tool", "notes": {"client": "Launch moved to March"}, "finals": {}}
    inp = _empty()
    assert inputs.apply_upstream_brief(inp, BRIEF_ID, _brief(), chain, others={PROD_ID: prod})
    assert {"path": f"{PROD_ID}#notes.client", "text": "Launch moved to March", "kind": "classify"} in inp.marks


def test_run_deck_reads_the_research_the_brief_carries_and_the_production_file(tmp_path):
    bf, mf, pf = tmp_path / "brief_upstream.json", tmp_path / "members.json", tmp_path / "production_upstream.json"
    bf.write_text(json.dumps({"id": BRIEF_ID, "data": _brief()}))
    chain = CHAIN + [{"kind": "classify", "targets": [f"{PROD_ID}#notes.client"], "licence": {"corpus": False}}]
    mf.write_text(json.dumps({"facts": [], "decisions": chain}))
    pf.write_text(json.dumps({"id": PROD_ID, "data": {"app": "production-tool", "notes": {"client": "Launch moved to March"}, "finals": {}}}))
    inp = _empty()
    assert run_deck._brief_upstream(Namespace(brief_upstream=bf, brief=None, deck=None, members=mf, production_upstream=pf), inp)
    assert {m["path"] for m in inp.marks} == {f"{RESEARCH_ID}#report.summary", f"{PROD_ID}#notes.client"}


def test_the_engine_servers_input_view_reads_the_mark_in_the_research_the_brief_carries(tmp_path):
    from deck import server as srv
    from pathlib import Path
    replay = Path(__file__).parent / "fixtures" / "fernley" / "stages"
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_PORT": "0", "NAPKIN_DECK_REPLAY": str(replay)})
    s = srv.Server(cfg)
    d = srv.Doc(cfg.data / "doc", "doc")
    base = {"prompt": {"text": "A pitch deck for Tidewell.", "client": "Tidewell", "project": "", "agency": ""}, "kind": "agency", "format": "pitch"}
    req = srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True,
                                "brief_upstream": {"id": BRIEF_ID, "data": _brief()},
                                "members": {"facts": [{"id": "f_1", "entity": "brand/tidewell", "key": "k", "value": "v", "source": "s1"}],
                                            "sources": [{"id": "s1", "title": "t"}], "decisions": CHAIN}}, cfg)
    inp = s.load_inputs(d, req)   # refused with MarksError before the fix
    assert {"path": f"{RESEARCH_ID}#report.summary", "text": SECRET, "kind": "classify"} in inp.marks
