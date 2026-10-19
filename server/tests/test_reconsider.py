"""reconsider@2: a person's review (a fact verified, marked wrong or corrected; a finding verified or rejected)
brings the document in step: exactly the findings, confidences, answers and report parts resting on what was
reviewed change, and nothing else does. No layer is written; no model call when nothing rests on it."""

import copy
import json
import threading
from types import SimpleNamespace

import httpx
import pytest

from napkin.capabilities import Capabilities
from napkin.model import ModelPort
from napkin.pipeline import report
from napkin.pipeline.reconsider import Reconsider, held_parts, page_hash, validate
from napkin.pipeline.research import Researcher
from napkin.rules import layout as rule
from napkin.rules.confidence import finding_confidence
from napkin.util import TaskError

from conftest import Server
from fakes import FakeModel, FakeResearch
from test_ask import FakeJev, stated

SCOPE = {"org": "org/test-agency", "brand": "brand/test"}
DOC = "11111111-2222-4333-8444-555555555555"
SETTINGS = SimpleNamespace(reuse_days=30, research_concurrency=2)
T = "2026-10-19T10:00:00Z"


def caps_for(store, model=None, jev=None):
    return Capabilities(handler="t@1.0", scope=SCOPE, model_port=ModelPort(model or FakeModel(), "claude-opus-5", 30),
                        research_port=FakeResearch(), layer_store=store, research_semaphore=threading.Semaphore(4),
                        jev_port=jev)


def finding(fid, cites, st, lens, status="proposed"):
    f = {"id": fid, "statement": st, "cites": cites, "method": "synthesis", "status": status, "derived_by": "t@1.0",
         "confidence": "medium", "derived_at": "2026-10-02T00:00:00Z", "decision": "d_TESTFIND01", "lens": lens}
    if status == "verified":
        f["verification"] = {"decision": "d_VERIFYFI01", "by": "human:ana", "at": T}
    if status == "rejected":
        f["rejection"] = {"decision": "d_REJECTFI01", "by": "human:ana", "at": T, "reason": "one survey"}
    return f


def document(store):
    """Two lenses researched for IE; three findings, two answers and a composed report (record and page):
    fi_ONMEDIA01 rests on the media pin alone, fi_BOTHPINS01 on it and a market pin, fi_MARKET0001 on the market
    pins only. ask_A cites the media pin, ask_B the market finding."""
    clan = {"id": DOC, "version": "3", "facts": [], "findings": [], "decision_chain": {"decisions": []},
            "data": {"campaign": {"brand": stated({"ref": "brand/bmw", "name": "BMW"}, "created"),
                                  "categories": stated(["automotive.ev_charging"], "research"),
                                  "markets": stated(["IE"], "research")}}}
    _, ch, _ = Researcher(DOC, "3", clan, "t@1.0", caps_for(store), ["media_spend", "market_structure"], ["IE"],
                          ["automotive.ev_charging"]).run()
    pins = ch["facts_append"]
    media = next(p["id"] for p in pins if p["key"].startswith("media."))
    m0, m1 = [p["id"] for p in pins if p["key"].startswith("market.")][:2]
    findings = [finding("fi_ONMEDIA01", [media], "Spend leans on one channel.", "media_spend"),
                finding("fi_BOTHPINS01", [media, m0], "The market and its spend move together.", "media_spend"),
                finding("fi_MARKET0001", [m0, m1], "The market is crowded and growing.", "market_structure")]
    asks = {"ask_A": {"id": "ask_A", "question": "Where does the money go?", "lens": "media_spend", "in_section": True,
                      "answer": [{"text": "Mostly one channel.", "cites": [media]}], "status": "answered",
                      "searched": False, "new_facts": []},
            "ask_B": {"id": "ask_B", "question": "Is the market crowded?", "lens": "market_structure",
                      "in_section": True, "answer": [{"text": "It is.", "cites": ["fi_MARKET0001"]}],
                      "status": "answered", "searched": False, "new_facts": []}}
    by = {p["id"]: p for p in pins}
    for f in findings:
        f["confidence"] = finding_confidence([by[c] for c in f["cites"]])
    clan = dict(clan, facts=pins, findings=findings, data=dict(clan["data"], asks=asks))
    rpt, _, _, _ = report.compose(DOC, clan, "t@1.0", caps_for(store))
    clan["data"]["report"] = rpt
    return clan, media, m0, m1


def rework_to(pin):
    return lambda p: {"findings": [{"id": x["id"], "statement": "The category's own measure is what remains.",
                                    "cites": [pin], "why": "only the market figure is left"} for x in p["findings"]]}


def answer_from(p):
    pid = p["pins"][0]["id"]
    return {"sentences": [{"text": "What remains points elsewhere.", "cites": [pid]}], "missing": [],
            "lens": "media_spend", "topic": "Spend"}


def model_for(m1=None):
    return FakeModel({"rework_findings": rework_to(m1), "ask_answer": answer_from})


def run(clan, events, store, model=None, jev=None):
    caps = caps_for(store, model=model or FakeModel(), jev=jev)
    return Reconsider(DOC, "3", clan, "t@1.0", caps, validate(clan, {"events": events}), SETTINGS).run()


def purposes(model):
    return sorted(c[0] for c in model.calls)


def section(rpt, sid):
    return json.dumps(next(s for s in rpt["sections"] if s["id"] == sid), sort_keys=True)


def kept_parts(old, new, redo):
    """Every page part not written again is in the new page, in order, byte for byte."""
    before, after = rule.split(old["layout"]), iter(rule.split(new["layout"]))
    return all(any(p == q for q in after) for i, p in enumerate(before) if i not in redo)


def ev(kind, iid, **kw):
    return {"kind": kind, "id": iid, "decision": "d_REVIEW0001", **kw}


def updates(change):
    """findings_update by finding id, each also in `read` as the job read it (N2)."""
    out = {u["id"]: {k: v for k, v in u.items() if k != "id"} for u in change["findings_update"]}
    assert len(out) == len(change["findings_update"])
    for fid in out:
        assert change["read"][f"findings.{fid}"]["id"] == fid
    return out


# -- one test per event kind ----------------------------------------------------------------------------------------

def test_a_fact_marked_wrong(store):
    clan, media, m0, m1 = document(store)
    clan["decision_chain"]["decisions"] = [{"id": "d_REVIEW0001", "kind": "verdict", "polarity": "bad",
                                            "rationale": "The source is a press release."}]
    old = clan["data"]["report"]
    model, jev = model_for(m1), FakeJev(0.85)
    result, change, _ = run(clan, [ev("fact_rejected", media)], store, model, jev)
    patch = change["data_patch"]
    # the fact is excluded with the person's reason
    assert patch["selection"]["excluded"] == [{"fact_id": media, "reason": "The source is a press release.",
                                               "decision": change["decisions"][0]["id"]}]
    # findings: the one with nothing left fell, was worked out again and is superseded by its replacement; the one
    # still standing is changed in place to cite what holds it up (no duplicate); the market finding is untouched
    checked = {c["id"]: c["stands"] for c in result["checked"]}
    assert checked == {"fi_ONMEDIA01": False, "fi_BOTHPINS01": True}
    [new] = change["findings_append"]
    assert new["statement"] == "The category's own measure is what remains." and new["cites"] == [m1]
    assert new["status"] == "proposed"
    up = updates(change)
    assert set(up) == {"fi_ONMEDIA01", "fi_BOTHPINS01"}
    assert up["fi_ONMEDIA01"] == {"status": "superseded",
                                  "superseded_by": {"finding": new["id"], "decision": new["decision"]}}
    assert up["fi_BOTHPINS01"]["cites"] == [m0] and "recheck" not in up["fi_BOTHPINS01"]  # proposed stays proposed
    assert "status" not in up["fi_BOTHPINS01"] and "statement" not in up["fi_BOTHPINS01"]
    # its confidence now comes from the one pin left, and is written
    pins = {p["id"]: p for p in clan["facts"]}
    assert up["fi_BOTHPINS01"].get("confidence") == result["confidence"].get("fi_BOTHPINS01", {}).get("now")
    assert up["fi_BOTHPINS01"]["confidence"] == finding_confidence([pins[m0]]) != clan["findings"][1]["confidence"]
    assert result["reworked"]["fi_BOTHPINS01"]["kept"] and result["reworked"]["fi_ONMEDIA01"]["new"] == new["id"]
    # the answer citing it is answered again; the other is not
    assert set(patch["asks"]) == {"ask_A"} and media not in json.dumps(patch["asks"])
    # the report: the media section and the page parts citing the fact are written again, nothing else
    rpt = patch["report"]
    assert result["report"]["sections"] == ["s_media_spend"]
    assert not result["report"]["headline"] and not result["report"]["summary"]
    assert section(rpt, "s_market_structure") == section(old, "s_market_structure")
    assert rpt["headline"] == old["headline"] and rpt["summary"] == old["summary"]
    assert media not in json.dumps(rpt["sections"]) and "fi_ONMEDIA01" not in json.dumps(rpt)
    assert kept_parts(old, rpt, result["report"]["page"]) and media not in report._ids(rpt["layout"])
    assert purposes(model) == ["ask_answer", "report_part", "rework_findings"]
    d = change["decisions"][0]
    assert d["action"] == "reconsider" and f"{DOC}#facts[{media}]" in d["targets"]
    assert [x["action"] for x in change["decisions"]].count("synthesise_finding") == 1
    assert {f"{DOC}#findings[fi_ONMEDIA01]", f"{DOC}#findings[fi_BOTHPINS01]"} <= set(d["targets"])
    # the report now cites the replacement, never the superseded finding
    assert "fi_ONMEDIA01" not in json.dumps(rpt)


def test_a_fact_corrected(store):
    clan, media, m0, m1 = document(store)
    old_pin = next(p for p in clan["facts"] if p["id"] == media)
    # the host pinned the person's value: a report pin with a human source, no layer row (no origin, no version)
    new_pin = {k: v for k, v in old_pin.items() if k not in ("origin", "version", "layer", "quotes", "stale")}
    new_pin.update(id="f_CORRECTED01", value=0.31, method="report", confidence="high", sources=["src_human0001"],
                   decision="d_REVIEW0001", review={"verdict": "verified", "by": "human:ana", "at": T,
                                                    "decision": "d_REVIEW0001"})
    old_pin["replaced_by"] = {"fact_id": "f_CORRECTED01", "decision": "d_REVIEW0001"}
    clan["facts"].append(new_pin)
    clan["findings"][0] = dict(finding("fi_ONMEDIA01", [media], "Spend leans on one channel.", "media_spend",
                                       status="verified"), confidence="low")
    old = clan["data"]["report"]
    model, jev = model_for(m1), FakeJev(0.85)
    result, change, _ = run(clan, [ev("fact_corrected", media, replaced_by="f_CORRECTED01")], store, model, jev)
    # every finding citing the old pin still stands: changed in place to cite the new one, nothing appended
    assert {c["id"] for c in result["checked"] if c["stands"]} == {"fi_ONMEDIA01", "fi_BOTHPINS01"}
    assert change["findings_append"] == []
    up = updates(change)
    assert up["fi_ONMEDIA01"]["cites"] == ["f_CORRECTED01"]
    assert up["fi_BOTHPINS01"]["cites"] == ["f_CORRECTED01", m0]
    # the verified one stays verified, re-checked against the correction; the proposed one stays proposed
    assert "status" not in up["fi_ONMEDIA01"] and "status" not in up["fi_BOTHPINS01"]
    assert up["fi_ONMEDIA01"]["recheck"] == {
        "decision": change["decisions"][0]["id"],
        "note": "re-checked against the correction d_REVIEW0001; still holds"}
    assert "recheck" not in up["fi_BOTHPINS01"]
    # the person's value counts as reviewer-verified (high); a single cite is one lower, and it is written
    assert up["fi_ONMEDIA01"]["confidence"] == "medium"
    assert result["confidence"]["fi_ONMEDIA01"]["now"] == "medium"
    assert "selection" not in change["data_patch"]  # a correction excludes nothing
    assert set(change["data_patch"]["asks"]) == {"ask_A"}
    rpt = change["data_patch"]["report"]
    assert result["report"]["sections"] == ["s_media_spend"]
    assert section(rpt, "s_market_structure") == section(old, "s_market_structure")
    assert "f_CORRECTED01" in section(rpt, "s_media_spend") and media not in json.dumps(rpt["sections"])
    assert kept_parts(old, rpt, result["report"]["page"])
    assert purposes(model) == ["ask_answer", "report_part"]  # nothing fell: no rework call


def test_a_fact_verified(store):
    clan, media, m0, m1 = document(store)
    pins = {p["id"]: p for p in clan["facts"]}
    assert pins[m1]["confidence"] == "low"  # the market's player count rests on a blog alone
    pins[m1]["review"] = {"verdict": "verified", "by": "human:ana", "at": T, "decision": "d_REVIEW0001"}
    model = FakeModel()
    result, change, _ = run(clan, [ev("fact_verified", m1)], store, model, FakeJev(0.85))
    # the one finding citing it is worth more now (a person verified it: high); nothing else changes
    assert result["confidence"] == {"fi_MARKET0001": {"was": "low", "now": "high"}}
    assert result["checked"] == [] and change["findings_append"] == [] and change["data_patch"] == {}
    assert updates(change) == {"fi_MARKET0001": {"confidence": "high"}}  # written, in place
    assert [d["action"] for d in change["decisions"]] == ["reconsider"]
    assert "fi_MARKET0001's confidence is now high (was low)" in json.dumps(change["decisions"][0]["reasoning"])
    assert model.calls == []


def test_a_finding_rejected(store):
    clan, media, m0, m1 = document(store)
    old = clan["data"]["report"]
    clan["findings"][2] = finding("fi_MARKET0001", [m0, m1], "The market is crowded and growing.",
                                  "market_structure", status="rejected")
    model = FakeModel({"ask_answer": answer_from})
    result, change, _ = run(clan, [ev("finding_rejected", "fi_MARKET0001")], store, model, FakeJev(0.85))
    # no finding is written again; the answer and the report parts resting on it are
    assert change["findings_append"] == [] and change["findings_update"] == [] and result["checked"] == []
    assert set(change["data_patch"]["asks"]) == {"ask_B"}
    rpt = change["data_patch"]["report"]
    assert result["report"]["sections"] == ["s_market_structure"]
    assert section(rpt, "s_media_spend") == section(old, "s_media_spend")
    assert "fi_MARKET0001" not in json.dumps(rpt)
    # the headline and summary cited it, so they were written again too
    assert result["report"]["headline"] and result["report"]["summary"]
    assert kept_parts(old, rpt, result["report"]["page"])
    assert purposes(model) == ["ask_answer", "report_part"]


def test_a_finding_verified(store):
    clan, *_ = document(store)
    clan["findings"][0] = finding("fi_ONMEDIA01", clan["findings"][0]["cites"], "Spend leans on one channel.",
                                  "media_spend", status="verified")
    model = FakeModel()
    result, change, _ = run(clan, [ev("finding_verified", "fi_ONMEDIA01")], store, model, FakeJev(0.85))
    assert change["data_patch"] == {} and change["findings_append"] == [] and result["confidence"] == {}
    assert [d["action"] for d in change["decisions"]] == ["reconsider"]
    assert f"{DOC}#findings[fi_ONMEDIA01]" in change["decisions"][0]["targets"]
    assert model.calls == []


def test_a_verified_finding_that_still_stands_stays_verified(store):
    clan, media, m0, m1 = document(store)
    clan["findings"][1] = finding("fi_BOTHPINS01", [media, m0], "The market and its spend move together.",
                                  "media_spend", status="verified")
    result, change, _ = run(clan, [ev("fact_rejected", media)], store, model_for(m1), FakeJev(0.85))
    up = updates(change)["fi_BOTHPINS01"]
    assert up["cites"] == [m0] and "status" not in up
    assert up["recheck"] == {"decision": change["decisions"][0]["id"],
                             "note": "re-checked against the rejection d_REVIEW0001; still holds"}
    assert change["read"]["findings.fi_BOTHPINS01"] == clan["findings"][1]
    assert len({f["id"] for f in change["findings_append"]}) == len(change["findings_append"]) == 1


def test_a_fallen_finding_is_superseded_by_one_already_standing_on_what_remains(store):
    clan, media, m0, m1 = document(store)
    model = FakeModel({"ask_answer": answer_from, "rework_findings": lambda p: {"findings": [
        {"id": x["id"], "statement": "The market is crowded and growing.", "cites": [m0, m1], "why": "the same"}
        for x in p["findings"]]}})
    result, change, _ = run(clan, [ev("fact_rejected", media)], store, model, FakeJev(0.1))
    # both media findings fell; what they are worked out as is the market finding already there: no duplicate
    assert change["findings_append"] == []
    up = updates(change)
    for old in ("fi_ONMEDIA01", "fi_BOTHPINS01"):
        assert up[old] == {"status": "superseded",
                           "superseded_by": {"finding": "fi_MARKET0001", "decision": change["decisions"][0]["id"]}}


# -- across events --------------------------------------------------------------------------------------------------

def test_no_model_call_when_nothing_rests_on_what_was_reviewed(store):
    clan, media, m0, m1 = document(store)
    del clan["data"]["report"]
    clan["findings"] = clan["findings"][:1]   # only the media finding
    clan["data"]["asks"] = {}
    model, jev = FakeModel(), FakeJev(0.85)
    result, change, _ = run(clan, [ev("fact_rejected", m1)], store, model, jev)
    assert model.calls == [] and jev.calls == []
    assert set(change["data_patch"]) == {"selection"} and change["findings_append"] == []
    assert "Nothing the crew wrote needs writing again" in json.dumps(change["decisions"][0]["reasoning"])


def test_several_reviews_are_one_run(store):
    clan, media, m0, m1 = document(store)
    pin = next(p for p in clan["facts"] if p["id"] == m1)
    pin["review"] = {"verdict": "verified", "by": "human:ana", "at": T, "decision": "d_REVIEW0001"}
    model = FakeModel({"rework_findings": rework_to(m0), "ask_answer": answer_from})
    result, change, _ = run(clan, [ev("fact_rejected", media), ev("fact_verified", m1)], store, model, FakeJev(0.1))
    assert purposes(model).count("report_part") == 1 and purposes(model).count("rework_findings") == 1
    d = change["decisions"][0]
    assert {f"{DOC}#facts[{media}]", f"{DOC}#facts[{m1}]", f"{DOC}#selection.excluded[{media}]"} <= set(d["targets"])
    # both media findings fell (jev: no longer supported) and were worked out again in one call; the market
    # finding cites the verified pin: only its confidence is recomputed
    assert {c["id"] for c in result["checked"] if not c["stands"]} == {"fi_ONMEDIA01", "fi_BOTHPINS01"}
    assert result["confidence"] == {"fi_MARKET0001": {"was": "low", "now": "high"}}


def test_a_page_part_holding_a_persons_wording_is_held_not_rewritten(store):
    clan, media, m0, m1 = document(store)
    old = clan["data"]["report"]
    pages = rule.split(old["layout"])
    hit = [i for i, h in enumerate(pages) if media in report._ids(h)]
    mine = hit[0]
    clan["edits"] = {f"report:{page_hash(pages[mine])}:b1": "<p>Our own words</p>"}
    result, change, _ = run(clan, [ev("fact_rejected", media)], store, model_for(m1), FakeJev(0.85))
    rpt = change["data_patch"]["report"]
    assert pages[mine] in rpt["layout"] and mine not in result["report"]["page"]
    assert result["held"] == [{"part": mine, "edits": [f"report:{page_hash(pages[mine])}:b1"]}]
    assert "hold your own wording" in change["decisions"][0]["reasoning"]["attention"]


def test_wording_keyed_to_the_whole_page_holds_the_whole_page(store):
    clan, media, m0, m1 = document(store)
    old = clan["data"]["report"]
    clan["edits"] = {f"report:{page_hash(old['layout'])}:b2": "<p>Ours</p>"}
    result, change, _ = run(clan, [ev("fact_rejected", media)], store, model_for(m1), FakeJev(0.85))
    rpt = change["data_patch"]["report"]
    assert rpt["layout"] == old["layout"] and result["report"]["page"] == []
    assert result["report"]["sections"] == ["s_media_spend"]  # the record is still brought in step


def test_the_page_hash_is_the_views():
    # clan-fields.html: h=5381; h=((h<<5)+h+charCode)|0; (h>>>0).toString(36)
    assert page_hash("") == "45h"
    assert page_hash("abc") == "3772q3"
    assert page_hash("é€𝄞 x") == "1utl59g"  # UTF-16 code units, as the view reads them (checked in node)
    assert held_parts({"report:zzz:b1": "<p>x</p>"}, ["<p>a</p>"]) == ({}, False)


# The same page and hashes are pinned in app/tests/templates.test.ts: the view keys a person's wording per part
# (`report:<hash of the part>:b<n>`), and must split and hash exactly as this does.
PAGE = ('<header class="cl-hero"><h1>Frozen grows</h1><p class="cl-dek">Value &amp; volume, “both”</p></header>\n'
        '<section class="cl-band"><h2>Media</h2><p>Spend leans on one channel.<br>'
        '<clan-cite refs="f_01JA0B3P4Q"></clan-cite></p></section>')


def test_the_page_parts_are_the_views():
    parts = rule.split(PAGE)
    assert len(parts) == 3 and parts[1] == "\n"
    assert [page_hash(p) for p in parts] == ["kcamkm", "3t0v", "v4mvo"]
    assert rule.split("<P>Upper</P><p>x</p>") == ["<P>Upper</P><p>x</p>"]  # not as the check writes it: one part


def test_events_are_checked(store):
    clan, media, *_ = document(store)
    for events in ([], [{"kind": "fact_wrong", "id": media, "decision": "d_REVIEW0001"}],
                   [{"kind": "fact_rejected", "id": "f_NOTHERE001", "decision": "d_REVIEW0001"}],
                   [{"kind": "fact_rejected", "id": media}],
                   [{"kind": "fact_corrected", "id": media, "decision": "d_REVIEW0001"}],
                   [{"kind": "finding_verified", "id": "fi_NOTHERE01", "decision": "d_REVIEW0001"}]):
        with pytest.raises(TaskError):
            validate(clan, {"events": events})
    two = validate(clan, {"events": [ev("fact_verified", media), ev("fact_verified", media)]})
    assert len(two) == 1


def test_a_second_reconsider_on_the_document_is_refused_while_one_runs(tmp_path, store):
    clan, media, m0, m1 = document(store)
    gate = threading.Event()

    def slow(p):
        gate.wait(10)
        return rework_to(m1)(p)
    s = Server(tmp_path, model=FakeModel({"rework_findings": slow, "ask_answer": answer_from}))
    try:
        body = {"request_kind": "middleware", "payload": {"task": "reconsider",
                                                          "input": {"events": [ev("fact_rejected", media)]}},
                "clan": copy.deepcopy(clan)}
        r1 = httpx.post(s.url + "/v1/tasks", json=body, timeout=10)
        assert r1.status_code == 200, r1.text
        r2 = httpx.post(s.url + "/v1/tasks", json=body, timeout=10)
        assert r2.status_code == 409 and r2.json()["error"]["type"] == "job_state"
        gate.set()
    finally:
        gate.set()
        s.stop()
