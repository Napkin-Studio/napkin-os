"""brief-fact-provenance: what each part of a planned brief rests on, worked out after Dara wrote it
(brief/provenance.py, rules/derive.py). The owner's rule runs through every test here: a value is never
edited, a worked-out conclusion is tied to its inputs, and no claim sends a part to a rewrite.

The Lidl replay (staging job_565f98e45d8350f5e5fc, 2026-10-19): two facts outside the measure list (RTÉ,
28 Sep: available from 5 October; TheJournal, 15 Oct: the offer has closed from today), a 63-character
request, nothing captured, and Dara's correct conclusion that the offer was over in 10 days."""

import ast
import copy
import datetime as dt
import json
from pathlib import Path

import jsonschema
import pytest

from napkin import reasoning as rsn
from napkin.brief import checkloop, fix, planned
from napkin.brief import provenance as prov
from napkin.brief.fields import KEYS
from napkin.brief.planned import DIMS
from napkin.rules import derive

from conftest import Server
from fakes import FakeModel
from test_brief import BRIEF_SCHEMA, DOC, Host, check_change_rules, retrieval, run

REPO = Path(__file__).resolve().parents[2]
FACTS_SCHEMA = json.loads((REPO / "app/templates/brief-maker/facts.schema.json").read_text())
PROMPT = "Write a brief for Lidl Connect's mobile launch in Ireland, please."  # a request, nothing else
assert len(PROMPT) <= 70
BG = "Lidl Connect's €8.99 for life offer was over in 10 days."
RTE_URL = "https://www.rte.ie/news/business/2026/0928/lidl-connect-launch/"
TJ_URL = "https://www.thejournal.ie/lidl-connect-offer-closed-6512345-Oct2026/"
RTE_Q = "Lidl Connect will be available from 5 October"
TJ_Q = "Lidl Connect has closed its new EUR 8.99 for life offer to new customers from today onwards."
ENTITY = "brand/lidl-connect"


# =============================================================================================
# The Lidl replay, end to end
# =============================================================================================
class LidlResearch:
    """The research port: the two pages the staging job read."""

    def __init__(self):
        self.calls = []

    def search(self, query, lens, market, entity=None, category=None, max_sources=6, attribution=None):
        self.calls.append((lens, market))
        return {"sources": [
            {"id": "s1", "url": RTE_URL, "publisher": "RTÉ", "title": "Lidl to launch a mobile network",
             "retrieved_at": "2026-10-16", "published_at": "2026-09-28", "excerpts": [RTE_Q + ", the retailer said."]},
            {"id": "s2", "url": TJ_URL, "publisher": "TheJournal.ie", "title": "Lidl Connect closes its offer",
             "retrieved_at": "2026-10-16", "published_at": "2026-10-15", "excerpts": [TJ_Q]}],
            "trace": {"backend": "fake", "queries": [query]}}


def ids_by_key(facts):
    a = next(f["id"] for f in facts if f["key"].endswith("x_service_launch"))
    b = next(f["id"] for f in facts if f["key"].endswith("x_offer_closed"))
    return a, b


def lidl_model(seen, *, dara_cites=True, tie=None, jude_partly=False, bg_basis="client"):
    m = FakeModel()

    def plan(p):
        seen["plan"] = p
        return {"strategy": "Lidl Connect as the honest-price network.",
                "parts": {k: {"must_say": "it", "rests_on": "assumption"} for k in p["parts"]},
                "brand": "Lidl Connect", "competitors": ["Tesco Mobile"],
                "research": [{"lens": "brands_positioning", "market": "IE", "focus": "Lidl Connect's launch offer",
                              "why": "the launch", "for_parts": ["background"]}],
                "category": p["categories"][0]["code"], "ask_client": []}

    def extract(p):
        by = {s["url"]: s["source_id"] for s in p["sources"]}
        return {"facts": [
            {"about": "subject", "category": None, "competitor": None, "key_suffix": "x_service_launch",
             "value_number": None, "value_text": "Available from 5 October", "value_boolean": None, "unit": "text",
             "as_of": "2026-09-28", "market_specific": True,
             "evidence": [{"source_id": by[RTE_URL], "quote": RTE_Q}]},
            {"about": "subject", "category": None, "competitor": None, "key_suffix": "x_offer_closed",
             "value_number": None, "value_text": "The EUR 8.99 for life offer closed to new customers",
             "value_boolean": None, "unit": "text", "as_of": "2026-10-15", "market_specific": True,
             "evidence": [{"source_id": by[TJ_URL], "quote": TJ_Q}]}], "not_found": []}

    def draft(p):
        seen["draft"] = p
        a, b = ids_by_key(p["facts"])
        seen["ids"] = (a, b)
        out = {k: {"value": [f"A {k} item"] if k in ("reasons_to_believe", "tone_and_world", "mandatories",
                                                      "open_questions") else f"A proposal for the {k}",
                   "basis": "assumption", "cites": [], "builds_on_client": False, "why": "a planner's proposal"}
               for k in p["parts"]}
        out["background"] = {"value": BG, "basis": bg_basis, "cites": [a, b] if dara_cites else [],
                             "builds_on_client": True, "why": "the offer's launch and its closure"}
        out["objectives.commercial"]["why"] = "launch in Q4 2026"  # an assumption's why stating a figure
        return out

    def tie_claims(p):
        seen.setdefault("tie", []).append(p)
        if tie is None:
            return {"ties": []}
        return tie(p, seen)

    def review(p):
        seen.setdefault("reviews", []).append(p)
        claims = [{"part": "background", "claim": "over in 10 days", "cite": seen["ids"][0], "verdict": "partly",
                   "note": "no fact says 10 days"}] if jude_partly else []
        return {"dimensions": [{"dimension": d, "verdict": "pass", "evidence": "e", "fix": "f"} for d in DIMS],
                "chain": {"verdict": "pass", "note": "it holds"}, "claims": claims, "notes": [], "revise": [],
                "questions": [], "single_mindedness": {"verdict": "single", "split_into": []}, "summary": "Clear."}

    m.overrides.update({"plan_brief": plan, "extract_facts": extract, "draft_brief_whole": draft,
                        "tie_claims": tie_claims, "review_brief": review, "review_brief_again": review})
    return m


def name_both(p, seen):
    a, b = seen["ids"]
    n = next(s["n"] for s in p["sentences"] if s["part"] == "background")
    return {"ties": [{"part": "background", "n": n, "states": True, "cites": [a, b], "calc": {"op": "days_between", "inputs": [a, b]}}]}


def lidl_server(tmp_path, model, **kw):
    return Server(tmp_path, model=model, research=LidlResearch(), retrieval=retrieval(),
                  settings_kw={"brief_flow": "planned", "brief_research_max": 1,
                               "runlog_dir": str(tmp_path / "runs"), **kw})


def events(tmp_path):
    out = []
    for f in sorted((tmp_path / "runs").rglob("*.jsonl")):
        out += [json.loads(x) for x in f.read_text().splitlines()]
    return out


def bg_decision(host):
    return next(d for d in host.chain if d.get("action") in ("draft", "propose", "regenerate")
                and d["targets"][0].endswith("#background"))


@pytest.mark.parametrize("variant", ["dara_cites", "tie_names", "review_jude_partly"])
def test_lidl_offer_over_in_10_days(tmp_path, variant):
    seen = {}
    m = lidl_model(seen, dara_cites=variant != "tie_names", tie=name_both if variant == "tie_names" else None,
                   jude_partly=variant == "review_jude_partly")
    s = lidl_server(tmp_path, m)
    try:
        host = Host()
        run(s, host, inp={"prompt": PROMPT, "attachments": []})
        layer_writes = [json.loads(r.content) for r in s.layers.service.requests
                        if r.method == "POST" and r.url.path == "/v1/layers/facts"]
    finally:
        s.stop()
    a, b = seen["ids"]
    # two kept pins, in this job's new pins, so in the facts Dara saw; never written to the layers
    kept = {f["id"]: f for f in host.facts if f.get("kept_in_document")}
    assert set(kept) == {a, b}
    assert {f["id"] for f in seen["draft"]["facts"]} >= {a, b}
    assert [f["id"] for f in seen["draft"]["facts"][:2]] == [a, b] or set(f["id"] for f in seen["draft"]["facts"][:2]) == {a, b}
    assert not [w for w in layer_writes if (w.get("fact") or {}).get("entity") == ENTITY]
    for f in kept.values():
        assert "origin" not in f and "version" not in f and f["pin_reason"] == "kept in this brief only"
        assert f["layer"] == "brand" and f["quotes"]
    jsonschema.Draft7Validator(FACTS_SCHEMA).validate({"facts": host.facts})
    # the value is Dara's, byte for byte
    assert host.data["background"] == BG
    d = bg_decision(host)
    assert d["basis"] == "research", "the client said nothing about the offer: not the client's words"
    assert {a, b} <= set(d["cites"])
    derived = [c for c in d["claims"] if c["kind"] == "derived"]
    assert len(derived) == 1
    c = derived[0]
    assert set(c["cites"]) == {a, b} and c["check"] == "recomputed"
    assert c["working"] == "15 Oct 2026 - 5 Oct 2026 = 10 days"
    assert set(c["cites"]) <= set(d["cites"])
    pt = next(p for p in d["reasoning"]["because"] if p["point"].startswith("Worked out:"))
    assert set(pt["cites"]) == {a, b}
    # certainty by campaign-clan §6.1: the lowest of two pins, a recomputed working costs nothing
    want = rsn.lowest([kept[a]["confidence"], kept[b]["confidence"]])
    assert d["reasoning"]["certainty"]["level"] == want
    assert "attention" not in d["reasoning"] or "Check:" not in d["reasoning"]["attention"]
    assert not d["reasoning"]["decided"].endswith("after Jude's note.")
    assert "builds on what the client wrote" not in json.dumps(d["reasoning"]), "nothing captured: not kept"
    # an assumption's figure-bearing why is in attention; no point borrows the plan or the materials
    plan_id = next(x["id"] for x in host.chain if x.get("action") == "plan")
    mats = set(host.data["materials"])
    for x in host.chain:
        if x.get("basis") == "assumption":
            for p in x["reasoning"]["because"]:
                assert not set(p.get("cites") or []) & ({plan_id} | mats), (x["targets"], p)
    obj = next(x for x in host.chain if x.get("action") == "draft" and x["targets"][0].endswith("#objectives.commercial"))
    assert "launch in Q4 2026" in obj["reasoning"]["attention"]
    # the prompt's words are kept for Sources
    prompt = next(v for v in host.data["materials"].values() if v["kind"] == "prompt")
    assert prompt["text"] == PROMPT
    if variant == "review_jude_partly":
        rv = host.data["review"]["judge"]["fields"]["background"]
        assert rv["outcome"] == "passed"
        assert any(ch["check"] == "claim_supported" and ch["status"] == "pass" for ch in rv["checks"])
    check_change_rules(host)
    evs = events(tmp_path)
    note = next(e for e in evs if e["ev"] == "note" and e["what"] == "provenance" and e["stage"] == "draft")
    assert note["parts"]["background"]["basis_said"] == "client" and note["parts"]["background"]["basis"] == "research"
    assert note["parts"]["background"]["builds_on_client_dropped"] is True


def test_lidl_jev_tie_failed(tmp_path):
    seen = {}
    m = lidl_model(seen, dara_cites=False)

    def boom(p):
        raise RuntimeError("tie_claims is down")
    m.overrides["tie_claims"] = boom
    vague = m.overrides["draft_brief_whole"]

    def draft(p):
        out = vague(p)
        out["tone_and_world"] = {"value": ["vague and nice"], "basis": "assumption", "cites": [],
                                 "builds_on_client": False, "why": "x"}
        return out
    m.overrides["draft_brief_whole"] = draft

    def explain(p):
        seen["explain"] = p
        return {"parts": {k: {"rework": k == "tone_and_world", "why": "generic", "instruction": "be specific"
                              if k == "tone_and_world" else ""} for k in list(p["flagged"]) + p["empty"]},
                "chain": {"issue": None, "parts": []}, "dimensions": [], "questions": []}
    m.overrides["explain_flags"] = explain
    m.overrides["rewrite_brief_parts"] = lambda p: (seen.__setitem__("rewrite", p), {
        k: {"value": ["sunny"], "basis": "assumption", "cites": [], "builds_on_client": False, "why": "x"}
        for k in p["parts"]})[1]
    from test_planned_brief import FakeJev
    s = Server(tmp_path, model=m, research=LidlResearch(), retrieval=retrieval(), jev=FakeJev(),
               settings_kw={"brief_flow": "planned", "brief_judge": "jev", "brief_research_max": 1,
                            "runlog_dir": str(tmp_path / "runs")})
    try:
        host = Host()
        run(s, host, inp={"prompt": PROMPT, "attachments": []})
    finally:
        s.stop()
    assert host.data["background"] == BG
    assert "background" not in seen["rewrite"]["rewrite"], "provenance never sends a part to a rewrite"
    assert seen["explain"]["claims"]["background"][0]["kind"] == "to_confirm"
    d = bg_decision(host)
    assert d["claims"][0]["kind"] == "to_confirm" and d["reasoning"]["attention"].startswith("To confirm:")
    note = next(e for e in events(tmp_path) if e["ev"] == "note" and e["what"] == "provenance" and e["stage"] == "draft")
    assert note["tie_call"] == "failed"
    check_change_rules(host)


def test_doc_pin_replay_mints_no_duplicate_and_no_conflict(tmp_path):
    seen = {}
    s = lidl_server(tmp_path, lidl_model(seen))
    try:
        host = Host()
        run(s, host, inp={"prompt": PROMPT, "attachments": []})
        first = copy.deepcopy(host.facts)
        n = len(host.changes)
        run(s, host, inp={"prompt": PROMPT, "attachments": []})
    finally:
        s.stop()
    held = {f["id"]: f for f in first}
    for ch in host.changes[n:]:
        for f in ch.get("facts_append") or []:
            assert f["id"] not in held or held[f["id"]] == f, "the host would refuse it (409)"
    kept = [f for f in host.facts if f.get("kept_in_document")]
    assert len(kept) == 2 and all(__import__("re").fullmatch(r"f_[0-9A-Z]{6,}", f["id"]) for f in kept)


def test_doc_pin_same_identity_new_value_is_a_contest_note(tmp_path):
    seen = {}
    s = lidl_server(tmp_path, lidl_model(seen))
    try:
        host = Host()
        run(s, host, inp={"prompt": PROMPT, "attachments": []})
        held = next(f for f in host.facts if f["key"].endswith("x_offer_closed"))
        # the brief already holds that identity with another value
        held["value"] = "The offer is still open"
        before = len(host.facts)
        run(s, host, inp={"prompt": PROMPT, "attachments": []})
    finally:
        s.stop()
    assert len([f for f in host.facts if f["key"].endswith("x_offer_closed")]) == 1
    assert len(host.facts) == before
    assert any(e["ev"] == "note" and e["what"] == "unlisted_contests" for e in events(tmp_path))


def old_schema():
    s = copy.deepcopy(BRIEF_SCHEMA)
    item = s["definitions"]["materials"]["additionalProperties"]
    item["properties"].pop("text")
    item.pop("if", None)
    item.pop("then", None)
    return s


def test_old_brief_packs(tmp_path):
    seen = {}
    m = lidl_model(seen, dara_cites=False)
    base = m.overrides["draft_brief_whole"]

    def draft(p):
        seen["draft"] = p
        seen["ids"] = (None, None)
        out = base({**p, "facts": p["facts"] + [{"id": "f_X", "key": "x.x_service_launch"},
                                                {"id": "f_Y", "key": "x.x_offer_closed"}]})
        out["background"]["cites"] = []
        return out
    m.overrides["draft_brief_whole"] = draft
    s = lidl_server(tmp_path, m)
    try:
        host = Host(schema=old_schema())
        run(s, host, inp={"prompt": PROMPT, "attachments": []})
    finally:
        s.stop()
    assert not [f for f in host.facts if f.get("kept_in_document")], "an older brief keeps no document pins"
    assert all("text" not in v for v in host.data["materials"].values())
    evs = events(tmp_path)
    um = next(e for e in evs if e["ev"] == "note" and e["what"] == "unlisted_measures")
    assert len(um["notes"]) == 2 and all(set(n) == {"key", "fact_id"} for n in um["notes"])
    d = bg_decision(host)
    tc = next(c for c in d["claims"] if c["kind"] == "to_confirm")
    assert {n["fact_id"] for n in um["notes"]} & set(tc.get("suggest") or []), "the facts are suggested"
    jsonschema.Draft7Validator(old_schema()).validate(host.data)


# =============================================================================================
# The client guard, on all five paths
# =============================================================================================
CLAIMED = "Sales are flat this year."


def _client_part(key):
    return {"value": CLAIMED, "basis": "client", "cites": [], "builds_on_client": True,
            "why": "the client said so"}


@pytest.mark.parametrize("path", ["draft", "draft_prefilled", "revise", "jev_rewrite", "fix_parts", "engine_checked"])
def test_client_guard_all_paths(tmp_path, path):
    from test_planned_brief import THIN, FakeJev, planned_model
    seen = {}
    m = planned_model(seen)
    key = "background"
    kw = {"brief_flow": "planned", "brief_research_max": 1, "runlog_dir": str(tmp_path / "runs")}
    jev = None
    host = Host()
    base = m.overrides["draft_brief_whole"]
    if path in ("draft", "draft_prefilled"):
        m.overrides["draft_brief_whole"] = lambda p: {**base(p), key: _client_part(key)}
        if path == "draft_prefilled":
            host = Host(data={"background": CLAIMED})  # W holds the text: the old guard let it through
    elif path == "revise":
        def review(first):
            return lambda p: {"dimensions": [{"dimension": d, "verdict": "pass", "evidence": "e", "fix": "f"}
                                             for d in DIMS],
                              "chain": {"verdict": "pass", "note": "ok"}, "claims": [], "notes": [],
                              "revise": [{"part": key, "instruction": "say why now"}] if first else [],
                              "questions": [], "single_mindedness": {"verdict": "single", "split_into": []},
                              "summary": "ok"}
        m.overrides["review_brief"] = review(True)
        m.overrides["review_brief_again"] = review(False)
        m.overrides["rewrite_brief_parts"] = lambda p: {k: _client_part(k) for k in p["parts"]}
    elif path == "jev_rewrite":
        kw["brief_judge"] = "jev"
        jev = FakeJev()
        m.overrides["draft_brief_whole"] = lambda p: {**base(p), key: {
            "value": "A vague background", "basis": "assumption", "cites": [], "builds_on_client": False, "why": "x"}}
        m.overrides["explain_flags"] = lambda p: {
            "parts": {k: {"rework": k == key, "why": "vague", "instruction": "be specific" if k == key else ""}
                      for k in list(p["flagged"]) + p["empty"]},
            "chain": {"issue": None, "parts": []}, "dimensions": [], "questions": []}
        m.overrides["rewrite_brief_parts"] = lambda p: {k: _client_part(k) for k in p["parts"]}
    elif path == "fix_parts":
        key = "objectives.commercial"
        m.overrides["plan_fix"] = lambda p: {"strategy": "s", "parts": {k: {"instruction": "fix"} for k in p["parts_to_fix"]},
                                            "brand": "Brewline", "competitors": [], "research": [], "category": None,
                                            "ask_client": []}
        m.overrides["fix_brief_parts"] = lambda p: {k: _client_part(k) for k in p["parts"]}
    elif path == "engine_checked":
        from napkin.brief import engine
        from test_engine_adapter import ENGINE_URL, REPLY, Engine
        import httpx
        reply = copy.deepcopy(REPLY)
        reply["background"] = "A vague background"
        e = Engine(reply)
        engine.TRANSPORT, old_t = httpx.MockTransport(e), engine.TRANSPORT
        kw.update(brief_engine_url=ENGINE_URL, brief_judge="jev")
        jev = FakeJev()
        m.overrides["explain_flags"] = lambda p: {
            "parts": {k: {"rework": k == key, "why": "vague", "instruction": "be specific" if k == key else ""}
                      for k in list(p["flagged"]) + p["empty"]},
            "chain": {"issue": None, "parts": []}, "dimensions": [], "questions": []}
        m.overrides["rewrite_brief_parts"] = lambda p: {k: _client_part(k) for k in p["parts"]}
    s = Server(tmp_path, model=m, retrieval=retrieval(), jev=jev, settings_kw=kw)
    try:
        run(s, host, inp={"prompt": THIN, "attachments": []})
        if path == "fix_parts":
            note = next(d for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "bad")
            m.overrides["review_brief"] = m.overrides["review_brief_again"]  # Jude passes the fix
            run(s, host, task="fix_parts", inp={"verdict": note["id"]})
    finally:
        s.stop()
        if path == "engine_checked":
            engine.TRANSPORT = old_t
    top, _, leaf = key.partition(".")
    assert (host.data[top][leaf] if leaf else host.data[top]) == CLAIMED, "the value is never edited"
    d = next(x for x in host.chain if x.get("kind") == "edit" and x.get("action") != "plan"
             and x["targets"] and x["targets"][0].endswith("#" + key))
    assert d["basis"] in ("research", "assumption"), (path, d["basis"])
    assert "builds on what the client wrote" not in json.dumps(d["reasoning"])
    notes = [e for e in events(tmp_path) if e["ev"] == "note" and e["what"] == "provenance"
             and key in e["parts"] and e["parts"][key]["basis_said"] == "client"]
    assert notes and notes[-1]["parts"][key].get("builds_on_client_dropped") is True
    assert notes[-1]["stage"] == {"draft": "draft", "draft_prefilled": "draft", "revise": "revise",
                                  "jev_rewrite": "check", "fix_parts": "fix", "engine_checked": "engine_checked"}[path]
    if path == "draft":
        # the client's name passes: the material names it
        c = next(x for x in host.chain if x.get("action") == "draft" and x["targets"][0].endswith("#client"))
        assert c["basis"] == "client" and any(x.startswith("mat_") for x in c["cites"])


def test_regenerate_field_on_a_planned_brief_is_a_one_part_fix(tmp_path):
    from test_planned_brief import THIN, planned_model
    seen = {}
    m = planned_model(seen)
    m.overrides["plan_fix"] = lambda p: (seen.__setitem__("plan_fix", p), {
        "strategy": "s", "parts": {k: {"instruction": "sharper"} for k in p["parts_to_fix"]}, "brand": "Brewline",
        "competitors": [], "research": [], "category": None, "ask_client": []})[1]
    m.overrides["fix_brief_parts"] = lambda p: (seen.__setitem__("fix", p), {
        k: {"value": "Summer starts with an iced oat latte.", "basis": "assumption", "cites": [],
            "builds_on_client": False, "why": "sharper"} for k in p["parts"]})[1]
    s = Server(tmp_path, model=m, retrieval=retrieval(), settings_kw={"brief_flow": "planned", "brief_research_max": 1})
    try:
        host = Host()
        run(s, host, inp={"prompt": THIN, "attachments": []})
        replies = run(s, host, task="regenerate_field", inp={"field": "insight", "guidance": "Make it about 10 days"})
    finally:
        s.stop()
    last = replies[-1]
    assert last["job"]["state"] == "done" and last["job"]["progress"]["total"] == 3
    assert {r["job"]["stage"] for r in replies} <= {"context", "draft", "judge"}
    assert seen["plan_fix"]["planner_guidance"] == "Make it about 10 days"
    assert list(seen["fix"]["rewrite"]) == ["insight"]
    assert host.data["insight"] == "Summer starts with an iced oat latte."
    check_change_rules(host)


# =============================================================================================
# The cleaner, unit by unit
# =============================================================================================
class Rec:
    def __init__(self):
        self.notes = []

    def note(self, what, **kw):
        self.notes.append({"what": what, **kw})


class StubModel:
    def __init__(self, fn=None):
        self.fn, self.calls = fn, []

    def structured(self, purpose, system, payload, schema, max_tokens=None):
        self.calls.append((purpose, payload))
        if self.fn is None:
            return {"ties": []}
        return self.fn(payload)


def pin(fid, entity, key, value, quote, src, as_of, conf="medium", unit="text"):
    return {"id": fid, "entity": entity, "key": key, "value": value, "unit": unit, "as_of": as_of,
            "retrieved_at": "2026-10-16", "sources": [src], "quotes": {src: quote}, "confidence": conf,
            "status": "active", "layer": "brand", "decision": "d_AAAAAAAA", "pinned_at": "2026-10-16T00:00:00Z",
            "pin_reason": "kept in this brief only", "licence": "open", "method": "report",
            "kept_in_document": {"why": "x", "measure_proposed": True}}


FA = pin("f_AAAAAAAA", ENTITY, "positioning.x_service_launch", "Available from 5 October", RTE_Q, "src_rte00001",
         "2026-09-28")
FB = pin("f_BBBBBBBB", ENTITY, "positioning.x_offer_closed", "The EUR 8.99 for life offer closed", TJ_Q,
         "src_tj000001", "2026-10-15", conf="high")
SRCS = [{"id": "src_rte00001", "uri": RTE_URL, "published_at": "2026-09-28"},
        {"id": "src_tj000001", "uri": TJ_URL, "published_at": "2026-10-15"}]


def ctx_for(pins, *, sources=SRCS, items=None, model=None, excluded=(), new_pins=(), mats=None):
    clan = {"facts": list(pins), "sources": list(sources), "findings": [],
            "data": {"selection": {"excluded": [{"fact_id": x} for x in excluded]}}}
    ev = prov.evidence(clan, {}, list(new_pins), [])
    rl = Rec()
    return prov.Ctx(ev, prov.ClientWords(items or {}, {}, mats or {}), {}, "Lidl Connect", ["Tesco Mobile"],
                    model or StubModel(), rl), rl


def part(value, basis="research", cites=(), why="x", boc=False):
    return {"value": value, "basis": basis, "cites": list(cites), "builds_on_client": boc, "why": why}


def placed(v, client):
    pts, cert, attn = prov.because(v, client)
    return rsn.make("Wrote it.", pts, cert, "it changes", only_option="one", attention=attn)


def test_claim_from_no_fact_is_to_confirm():
    ctx, rl = ctx_for([FA, FB])
    out = {"background": part("Lidl has 340 stores in Ireland.", cites=[])}
    got = prov.clean_parts(out, ctx, stage="draft")["background"]
    assert got["value"] == "Lidl has 340 stores in Ireland."
    assert got["claims"] == [{"text": "Lidl has 340 stores in Ireland.", "kind": "to_confirm", "cites": [],
                              "by": "match"}] or (got["claims"][0]["kind"] == "to_confirm" and got["claims"][0]["cites"] == [])
    assert got["certainty"][0] == "low"
    r = placed(got, ctx.client)  # places: no point states a figure without a real cite
    assert r["attention"].startswith("To confirm: Lidl has 340 stores")
    assert all(not (rsn.states_figure(p["point"]) and not p.get("cites")) for p in r["because"])
    # the code's verdict, in review mode and in jev mode alike
    vs = prov.judge_claims({"background": got}, [])
    assert [v["verdict"] for v in vs] == ["unsupported"] and prov.code_verdicts({"background": got}) == vs
    note = next(n for n in rl.notes if n["what"] == "provenance")
    assert note["parts"]["background"]["claims"][0]["rests_on"] == "none"


def test_assumption_why_with_digit_places():
    ctx, _ = ctx_for([FA, FB])
    got = prov.clean_parts({"objectives.commercial": part("Launch the plan in Q4 2026.", "assumption",
                                                          why="launch in Q4 2026")}, ctx, stage="draft")
    v = got["objectives.commercial"]
    r = placed(v, ctx.client)
    assert "launch in Q4 2026" in r["attention"]
    assert all(not p.get("cites") for p in r["because"]), "no borrowed provenance"
    assert v["claims"][0]["kind"] == "to_confirm"


def test_event_sentence_net():
    other = pin("f_CCCCCCCC", "category/telecoms.mobile_networks", "market.x_players", "Four networks",
                "Ireland has four mobile networks", "src_rte00001", "2026-09-28")
    ctx, rl = ctx_for([FA, FB, other])
    got = prov.clean_parts({"competitor_context": part("Lidl closed the offer.", cites=["f_CCCCCCCC"])}, ctx,
                           stage="draft")["competitor_context"]
    assert got["value"] == "Lidl closed the offer."
    assert got["claims"][0]["kind"] == "to_confirm" and got["claims"][0]["by"] == "net"
    note = next(n for n in rl.notes if n["what"] == "provenance")
    assert note["parts"]["competitor_context"]["missed"] == 1


T1 = pin("f_TTTTTTT1", "brand/tesco-mobile", "positioning.x_sale_start", "Sale starts 1 March 2026",
         "Tesco Mobile's sale starts on 1 March 2026", "src_rte00001", "2026-02-20")
T2 = pin("f_TTTTTTT2", "brand/tesco-mobile", "positioning.x_sale_end", "Sale ends 13 March 2026",
         "Tesco Mobile's sale ends on 13 March 2026", "src_rte00001", "2026-02-20")


@pytest.mark.parametrize("named", [False, True])
def test_coincidental_pair_is_only_a_suggestion(named):
    def fn(p):
        n = p["sentences"][0]["n"]
        return {"ties": [{"part": "background", "n": n, "cites": [T1["id"], T2["id"]],
                          "calc": {"op": "days_between", "inputs": [T1["id"], T2["id"]]}}]}
    ctx, _ = ctx_for([FA, FB, T1, T2], model=StubModel(fn if named else None))
    got = prov.clean_parts({"background": part("Lidl Connect's promotion ran for 12 days.")}, ctx,
                           stage="draft")["background"]
    c = got["claims"][0]
    assert c["kind"] == "to_confirm" and c["cites"] == []
    assert {T1["id"], T2["id"]} <= set(c["suggest"])
    assert got["basis"] == "assumption"


def test_derived_mismatch_keeps_value():
    fa4 = {**FA, "id": "f_AAAAAAA4", "quotes": {"src_rte00001": "Lidl Connect will be available from 4 October"},
           "value": "Available from 4 October"}

    def fn(p):
        return {"ties": [{"part": "background", "n": 0, "cites": [fa4["id"], FB["id"]],
                          "calc": {"op": "days_between", "inputs": [fa4["id"], FB["id"]]}}]}
    ctx, _ = ctx_for([fa4, FB], model=StubModel(fn))
    sent = "Lidl Connect's offer was over in 10 days."
    got = prov.clean_parts({"background": part(sent, cites=[fa4["id"], FB["id"]])}, ctx, stage="draft")["background"]
    c = got["claims"][0]
    assert got["value"] == sent and c["kind"] == "derived" and c["check"] == "false"
    assert c["working"] == "15 Oct 2026 - 4 Oct 2026 = 11 days"
    assert got["certainty"][0] == "low"
    assert "Check the working" in placed(got, ctx.client)["attention"]
    # a model-named tie with no calc: the working is only stated, a level lower
    ctx2, _ = ctx_for([FA, FB], model=StubModel(lambda p: {"ties": [{"part": "background", "n": 0,
                                                                       "cites": [FA["id"], FB["id"]], "calc": None}]}))
    g2 = prov.clean_parts({"background": part("Lidl Connect's offer ran for a fortnight.")}, ctx2,
                          stage="draft")["background"]
    assert g2["claims"][0]["kind"] == "derived" and g2["claims"][0]["check"] == "stated"
    assert g2["certainty"][0] == rsn.step_down(rsn.lowest([FA["confidence"], FB["confidence"]]))
    # "from today" on a page with no publication date: stated, never a mismatch
    ctx3, _ = ctx_for([FA, FB], sources=[SRCS[0], {"id": "src_tj000001", "uri": TJ_URL}])
    g3 = prov.clean_parts({"background": part(sent, cites=[FA["id"], FB["id"]])}, ctx3, stage="draft")["background"]
    assert g3["claims"][0]["kind"] == "derived" and g3["claims"][0]["check"] == "stated"


def test_derived_from_client_and_fact():
    items = {"cap_0000000000000001": {"key": "timeline", "value": "Launch on 1 November", "status": "fact",
                                      "quote": "We launch on 1 November", "material_id": "mat_0000000000000001"}}
    ctx, _ = ctx_for([FA, FB], items=items)
    sent = "Our launch on 1 November is 17 days after Lidl closed its offer."
    got = prov.clean_parts({"background": part(sent, cites=["cap_0000000000000001", FB["id"]])}, ctx,
                           stage="draft")["background"]
    c = got["claims"][0]
    assert c["kind"] == "derived" and set(c["cites"]) == {"cap_0000000000000001", FB["id"]}
    assert c["check"] == "recomputed" and c["working"] == "1 Nov 2026 - 15 Oct 2026 = 17 days"


def test_fact_claim_number_not_in_cite():
    ctx, _ = ctx_for([FA, FB])
    got = prov.clean_parts({"background": part("Lidl Connect charged €9.99 for life.", cites=[FB["id"]])}, ctx,
                           stage="draft")["background"]
    c = got["claims"][0]
    assert c["kind"] == "fact" and c["check"] == "false" and c["cites"] == [FB["id"]]
    assert [v["verdict"] for v in prov.code_verdicts({"background": got})] == ["partly"]
    assert got["certainty"][0] == "low" and got["value"] == "Lidl Connect charged €9.99 for life."


GOOSED_Q = ("Lidl Connect | €107.88 | €107.88 | €215.76 | Budget seekers who know Eir is strong 48 | €155.88 | "
            "€155.88 | €311.76 | No thinking and coverage Clear Mobile | €155.88 | €155.88 | €311.76")
FG = pin("f_GGGGGGGG", "category/telco.mvnos", "positioning.year_one_cost",
         "Year 1 costs: Lidl €107.88, 48 €155.88, Clear Mobile €155.88", GOOSED_Q, "src_rte00001", "2026-10-06")
FP = pin("f_PPPPPPPP", ENTITY, "positioning.new_price", "New sign-ups pay €12.99 a month",
         "Any customers signing up from today onwards will be charged €12.99 per month", "src_tj000001", "2026-10-15")


def test_a_monthly_price_over_a_year_is_worked_out():
    """The staging draft (2026-10-20): 12.99 x 12 = 155.88 is Dara's conclusion, though the comparison
    fact states €155.88 (about 48 and Clear Mobile); it was filed as a plain fact."""
    ctx, _ = ctx_for([FP, FG])
    sent = "At €12.99 a month, the first year comes to the same €155.88 as 48 and Clear Mobile."
    got = prov.clean_parts({"background": part(sent, cites=[FP["id"], FG["id"]])}, ctx, stage="draft")["background"]
    c = got["claims"][0]
    assert c["kind"] == "derived" and c["check"] == "recomputed"
    assert c["working"] == "€12.99 × 12 = €155.88" and c["calc"]["op"] == "product"
    assert c["calc"]["inputs"] == [FP["id"]] and set(c["cites"]) == {FP["id"], FG["id"]}
    # no period named: a figure a fact states is that fact's
    g2 = prov.clean_parts({"background": part("48 and Clear Mobile cost €155.88 in year one.", cites=[FG["id"]])},
                          ctx, stage="draft")["background"]
    assert g2["claims"][0]["kind"] == "fact" and g2["claims"][0]["cites"] == [FG["id"]]
    # nobody states the yearly figure: still worked out, from the monthly price
    g3 = prov.clean_parts({"background": part("Lidl Connect costs €155.88 a year at €12.99 a month.",
                                              cites=[FP["id"]])}, ctx, stage="draft")["background"]
    assert g3["claims"][0]["kind"] == "derived" and g3["claims"][0]["check"] == "recomputed"


def test_a_sentence_without_a_figure_ties_only_to_a_fact_that_says_it():
    """The staging draft: a sentence naming Lidl took the part's Lidl fact (the offer's closure) as its
    source, whatever it said."""
    ctx, _ = ctx_for([FB, FG])
    v = ["Lidl Connect suits people who know Eir is strong.", "Lidl Connect logo and Lidl brand colours."]
    got = prov.clean_parts({"mandatories": part(v, cites=[FB["id"], FG["id"]])}, ctx, stage="draft")["mandatories"]
    by = {c["text"]: c for c in got["claims"]}
    assert by[v[0]]["kind"] == "fact" and by[v[0]]["cites"] == [FG["id"]], "the comparison's words say it"
    assert by[v[1]]["kind"] == "to_confirm" and by[v[1]]["cites"] == [], "the closure fact says nothing of logos"
    # the tie call naming the closure fact for it changes nothing; told it states nothing, it is no claim
    named = StubModel(lambda p: {"ties": [{"part": "mandatories", "n": 0, "states": True, "cites": [FB["id"]],
                                           "calc": None}]})
    ctx2, _ = ctx_for([FB, FG], model=named)
    g2 = prov.clean_parts({"mandatories": part(v[1:], cites=[FB["id"]])}, ctx2, stage="draft")["mandatories"]
    assert g2["claims"][0]["kind"] == "to_confirm" and g2["claims"][0]["cites"] == []
    told = StubModel(lambda p: {"ties": [{"part": "mandatories", "n": 0, "states": False, "cites": [], "calc": None}]})
    ctx3, _ = ctx_for([FB, FG], model=told)
    g3 = prov.clean_parts({"mandatories": part(v[1:], cites=[FB["id"]])}, ctx3, stage="draft")["mandatories"]
    assert g3["claims"] == [] and g3["value"] == v[1:]
    # a paraphrase the tie call names, in the fact's own words, stands
    para = StubModel(lambda p: {"ties": [{"part": "background", "n": 0, "states": True, "cites": [FB["id"]],
                                          "calc": None}]})
    ctx4, _ = ctx_for([FB, FG], model=para)
    g4 = prov.clean_parts({"background": part("Lidl Connect closed its offer to new customers.")}, ctx4,
                          stage="draft")["background"]
    assert g4["claims"][0]["kind"] == "fact" and g4["claims"][0]["cites"] == [FB["id"]]


def test_the_writers_to_confirm_line_stays_to_confirm():
    ctx, _ = ctx_for([FB, FG])
    v = ["Over the first year it costs the same as 48", "To confirm: you can buy and switch in Lidl stores",
         "To confirm: €12.99 includes 100GB"]
    got = prov.clean_parts({"reasons_to_believe": part(v, cites=[FB["id"], FG["id"]])}, ctx,
                           stage="draft")["reasons_to_believe"]
    tbc = [c for c in got["claims"] if c["text"].startswith("To confirm")]
    assert len(tbc) == 2 and all(c["kind"] == "to_confirm" and c["cites"] == [] and c["by"] == "writer"
                                 for c in tbc)


def test_a_brand_named_in_digits_is_not_a_figure():
    ctx, _ = ctx_for([FP, FG])
    # the plan's competitors name the operator 48
    ctx2 = prov.Ctx(ctx.ev, ctx.client, {}, "Lidl Connect", ["48", "Clear Mobile"], StubModel(), Rec())
    sent = "Switch to Lidl Connect at €12.99 instead of falling back to 48."
    got = prov.clean_parts({"background": part(sent, cites=[FP["id"]])}, ctx2, stage="draft")["background"]
    assert got["claims"][0]["kind"] == "fact" and got["claims"][0]["cites"] == [FP["id"]]


def test_client_guard_unit_mapping_and_assumption_items():
    items = {"cap_0000000000000002": {"key": "business_problem", "value": "Sales fell 12% in 2025",
                                      "status": "assumption", "material_id": "mat_0000000000000001"}}
    ctx, rl = ctx_for([FA, FB], items=items)
    got = prov.clean_parts({"background": part("Sales fell 12% in 2025.", "client", boc=True),
                            "audience": part("Sales fell 12% in 2025.", "client", boc=True),
                            "insight": part("Sales fell 15% in 2025.", "client")}, ctx, stage="draft")
    assert got["background"]["basis"] == "client" and got["background"]["builds_on_client"]
    assert got["background"]["claims"][0]["kind"] == "client"
    assert got["background"]["certainty"][0] == "low", "an assumption item alone: capture_certainty's low"
    assert got["audience"]["basis"] == "assumption" and not got["audience"]["builds_on_client"]
    assert got["insight"]["basis"] == "client" and got["insight"]["claims"][0]["kind"] == "to_confirm"
    assert any(n["what"] == "basis_corrected" and n["part"] == "audience" for n in rl.notes)


def test_kept_pins_survive_cap():
    many = [pin(f"f_HELD{i:05d}", "category/telecoms.mobile", f"market.x_{i}", f"v{i}", f"q{i}", "src_rte00001",
                "2026-01-01") for i in range(400)]
    ctx, _ = ctx_for(many, new_pins=[FA, FB])
    ids = [f["id"] for f in ctx.ev["facts"]]
    assert len(ids) == 400 and {FA["id"], FB["id"]} <= set(ids)


def test_excluded_pin_unties_the_claim():
    ctx, _ = ctx_for([FA, FB], excluded=[FB["id"]])
    got = prov.clean_parts({"background": part(BG, cites=[FA["id"], FB["id"]])}, ctx, stage="fix")["background"]
    assert FB["id"] not in got["cites"]
    assert all(c["kind"] == "to_confirm" or c.get("check") == "false" for c in got["claims"])
    assert not any(c["kind"] == "derived" and c.get("check") == "recomputed" for c in got["claims"])


def test_jude_partly_on_a_recomputed_working_is_supported():
    ctx, _ = ctx_for([FA, FB])
    parts = prov.clean_parts({"background": part(BG, cites=[FA["id"], FB["id"]])}, ctx, stage="draft")
    vs = prov.judge_claims(parts, [{"part": "background", "claim": "over in 10 days", "cite": FA["id"],
                                    "verdict": "partly", "note": "not literal"}])
    assert vs[0]["verdict"] == "supported"


def test_values_are_never_edited_and_derived_lost_is_counted():
    ctx, rl = ctx_for([FA, FB])
    prior = {"background": [{"text": BG, "kind": "derived", "working": "15 Oct 2026 - 5 Oct 2026 = 10 days"}]}
    got = prov.clean_parts({"background": part("Lidl Connect has a cheap plan.", cites=[FA["id"]])}, ctx,
                           stage="revise", prior=prior)
    assert got["background"]["value"] == "Lidl Connect has a cheap plan."
    note = next(n for n in rl.notes if n["what"] == "provenance")
    assert note["parts"]["background"]["derived_lost"] == 1 and note["stage"] == "revise"


# =============================================================================================
# What the code may no longer say or do
# =============================================================================================
OLD_DRAFT_RESEARCH = ("Cite every id it rests on. Use their\n  numbers exactly as given; never a number that is not in "
                      "a cited fact.")
OLD_CLIENT = """Keep their meaning; you may write it out more fully. Cite nothing."""
OLD_FIX = """Rest every claim on the facts given, citing their ids; a claim no fact supports starts with "To confirm:"
or is left out. Never use a figure that is not in a cited fact."""


def test_prompt_snapshot():
    d = planned.DRAFT_SYSTEM
    assert "never a number that is not in a cited fact" not in d
    assert "Cite the cap_ ids\n  of the client's words (client_words) it rests on." in d
    assert "Cite nothing." not in d.split('basis "research"')[0]
    # nothing else in DRAFT_SYSTEM moved: Dara's prompt, as before but for the listed edits
    before = d.replace("Cite the cap_ ids\n  of the client's words (client_words) it rests on.", "Cite nothing.") \
        .replace("Use their\n  numbers exactly as given.", "Use their\n  numbers exactly as given; never a number that "
                                                           "is not in a cited fact.")
    assert before.count("Cite nothing.") == 1 and OLD_DRAFT_RESEARCH in before and OLD_CLIENT in before
    assert len(before.splitlines()) == len(SNAPSHOT_DRAFT.splitlines()) and before == SNAPSHOT_DRAFT
    f = fix.FIX_NOTE
    assert "or is left out" not in f and "Never use a figure that is not in a cited fact" not in f
    assert f.startswith(SNAPSHOT_FIX_HEAD)


SNAPSHOT_DRAFT = """You are a senior strategic planner writing a complete creative brief, every part at once, so
the parts make one argument: the objectives, the audience, the insight, the proposition and its proof all
serve the plan's strategy.

You get what the client said, the parts captured from their words, the plan, the facts (each with an id,
its value, the quote it was read from and its source), the findings, the research the brief came from,
and planning library passages (ids psg_...).

For each part give value, basis, cites, builds_on_client and why:
- basis "client": the client said it. Keep their meaning; you may write it out more fully. Cite nothing.
- basis "research": it rests on facts or findings given to you. Cite every id it rests on. Use their
  numbers exactly as given; never a number that is not in a cited fact.
- basis "library": it rests on a planning passage; cite the psg_ id.
- basis "assumption": your professional proposal from what is generally known; it is marked for the agency
  to confirm. Name real competitors and a concrete audience where you can. No figures at all.
- builds_on_client: true when the client stated this part and you wrote it out more fully.
- why: one sentence on what the part rests on.
Lists (reasons to believe, tone, mandatories, open questions) are arrays of short items. A reason to
believe you cannot prove from a fact starts with "To confirm:". Budget and scope: deliverables, channels and
timing only, no budget figure the client did not give. Open questions: what only the client can answer.
Return null for a part only when nothing sensible can be said. Never restate the person's request as content.
Write in plain British English, specific and vivid, no category jargon."""
SNAPSHOT_FIX_HEAD = """

You are fixing a problem on this brief. Rewrite ONLY the parts in `rewrite`, together, so they make one
argument with the rest of the brief and the problem in `problem` is gone. Follow each part's instruction.
Rest every claim on the facts given, citing their ids; a claim no fact supports starts with "To confirm:".
"""


def _imports(path: Path) -> set:
    names = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.ImportFrom):
            names |= {f"{node.module}.{a.name}" for a in node.names}
            names |= {a.name for a in node.names}
        elif isinstance(node, ast.Import):
            names |= {a.name for a in node.names}
    return names


def test_no_brief_module_strips_a_claim():
    brief = REPO / "server/napkin/brief"
    for p in brief.glob("*.py"):
        names = _imports(p)
        assert "clean_claim" not in names and "unsourced_figures" not in names, p.name
        assert "clean_claim" not in p.read_text(), p.name
    src = (brief / "checkloop.py").read_text()
    assert "downgraded" not in src and "from .fields import clean" not in src and "basis" not in src.split("def run")[1]
    pl = (brief / "planned.py").read_text()
    assert '"high", "the client said it"' not in pl and "[plan_id] if plan_id else mat_ids} for p in pts" not in pl


def test_facts_schemas_identical():
    a = json.loads((REPO / "app/templates/brief-maker/facts.schema.json").read_text())
    b = json.loads((REPO / "app/templates/campaign-research/facts.schema.json").read_text())
    for k in ("$id", "title", "description"):
        a.pop(k), b.pop(k)
    assert a == b
    v = jsonschema.Draft7Validator(FACTS_SCHEMA)
    v.validate({"facts": [FA]})
    with pytest.raises(jsonschema.ValidationError):
        v.validate({"facts": [{**FA, "origin": "fact://brand/lidl-connect/positioning.x@1"}]})


# =============================================================================================
# rules/derive.py
# =============================================================================================
def test_derive_dates_durations_prices_and_names():
    anchor = dt.date(2026, 9, 28)
    assert [s.date for s in derive.dates_in("from 5 October", anchor)] == [dt.date(2026, 10, 5)]
    assert [s.date for s in derive.dates_in("on 15 Oct 2026")] == [dt.date(2026, 10, 15)]
    assert [s.date for s in derive.dates_in("on October 5th, 2026")] == [dt.date(2026, 10, 5)]
    assert [s.date for s in derive.dates_in("as of 2026-10-05")] == [dt.date(2026, 10, 5)]
    today = derive.dates_in("has closed from today onwards", dt.date(2026, 10, 15))[0]
    assert today.date == dt.date(2026, 10, 15) and today.anchored
    assert not derive.dates_in("from today")[0].anchored
    assert [s.value for s in derive.durations_in("10 days, a fortnight, a 10-day run, two weeks")] == [10, 14, 10, 14]
    prices = derive.prices_in("€8.99, EUR 8.99, 9 euro, £5 and $3")
    assert [(p.value, p.extra["currency"]) for p in prices] == [(8.99, "EUR"), (8.99, "EUR"), (9.0, "EUR"),
                                                                (5.0, "GBP"), (3.0, "USD")]
    sp = derive.spans("A B2B launch on 4G in Q4 2026 at 12.5% for 1.5m people")
    assert [(s.kind, s.text) for s in sp] == [("number", "2026"), ("number", "12.5"), ("number", "1.5")]
    assert derive.number_supported(next(s for s in sp if s.text == "1.5"), [1_480_000.0])
    assert derive.compute("days_between", [dt.date(2026, 10, 5), dt.date(2026, 10, 15)]) == 10
    assert derive.compute("percent_change", [80, 100]) == 25
    assert derive.compute("ratio", [1, 0]) is None


# =============================================================================================
# The run log: ids and counts unless bodies are on
# =============================================================================================
def test_runlog_ids_only(tmp_path):
    seen = {}
    s = lidl_server(tmp_path, lidl_model(seen))
    try:
        run(s, Host(), inp={"prompt": PROMPT, "attachments": []})
    finally:
        s.stop()
    evs = events(tmp_path)
    texts = [BG, RTE_Q, TJ_Q, "over in 10 days", "the offer's launch", "Available from 5 October"]
    for e in evs:
        if e["ev"] == "note" and e["what"] in ("provenance", "unlisted_measures"):
            blob = json.dumps(e, ensure_ascii=False)
            assert not any(t in blob for t in texts), e
        if e["ev"] == "decision":
            assert not {"decided", "because", "attention", "why_certain"} & set(e), e
    um = next(e for e in evs if e["ev"] == "note" and e["what"] == "unlisted_measures")
    assert all(set(n) == {"key", "fact_id"} for n in um["notes"])
    d = next(e for e in evs if e["ev"] == "decision" and e.get("targets") == ["background"])
    assert "derived" in d["claims"] and d["certainty"]


def test_runlog_bodies_on_keeps_decision_words_and_search_results(tmp_path):
    from napkin import runlog
    runlog.configure(str(tmp_path), bodies=True)
    try:
        rl = runlog.open_log("job_1", "draft_brief@1")
        rl.decisions([{"id": "d_1", "kind": "edit", "reasoning": {"decided": "Wrote it.", "because": [{"point": "p"}],
                                                                  "certainty": {"level": "low", "why": "w"}}}])
        rl.research(lens="l", market="IE", query="q", secs=0.1, urls=[RTE_URL],
                    results=[{"url": RTE_URL, "title": "t", "published_at": "2026-09-28", "text": "x" * 5000}])
        rl.end("done")
        evs = [json.loads(x) for x in next(tmp_path.rglob("*.jsonl")).read_text().splitlines()]
        dec = next(e for e in evs if e["ev"] == "decision")
        assert dec["decided"] == "Wrote it." and dec["because"] == ["p"]
        res = next(e for e in evs if e["ev"] == "research")
        assert res["results"][0]["url"] == RTE_URL and len(res["results"][0]["text"]) == runlog.RESULT_CHARS
        runlog.configure(str(tmp_path / "off"), bodies=False)
        rl = runlog.open_log("job_2", "draft_brief@1")
        rl.research(lens="l", market="IE", query="q", secs=0.1, urls=[RTE_URL],
                    results=[{"url": RTE_URL, "title": "t", "published_at": None, "text": "abc"}])
        rl.end("done")
        e = next(json.loads(x) for x in next((tmp_path / "off").rglob("*.jsonl")).read_text().splitlines()
                 if '"research"' in x)
        assert "results" not in e and e["result_chars"] == [3] and e["urls"] == [RTE_URL]
    finally:
        runlog.configure(None)


def test_research_cap_hands_the_results_to_the_log():
    import threading
    from napkin.capabilities import ResearchCap

    class Port:
        def search(self, *a, **kw):
            return {"sources": [{"url": RTE_URL, "title": "t", "published_at": "2026-09-28",
                                 "excerpts": [RTE_Q, "more"]}], "trace": {"queries": ["q"]}}

    class Log:
        def research(self, **kw):
            self.kw = kw
    log_ = Log()
    ResearchCap(Port(), {"handler": "h", "job": "job_9"}, threading.Semaphore(1), runlog_of=lambda: log_) \
        .search("q", "l", "IE")
    assert log_.kw["results"] == [{"url": RTE_URL, "title": "t", "published_at": "2026-09-28",
                                   "text": RTE_Q + "\nmore"}]


def test_research_select_names_the_job():
    from napkin.websearch import WebResearch

    class Port:
        def call(self, purpose, system, payload, schema, **kw):
            self.purpose, self.kw = purpose, kw
            return {"sources": []}
    port_ = Port()
    w = WebResearch(port_, "tvly-key")
    w._select("q", "brands_positioning", "IE", [{"url": RTE_URL, "title": "t", "passages": [], "page": "text"}], 3,
              "2026-10-19", None, {"handler": "draft_brief@1", "job": "job_565f"})
    assert port_.purpose == "research_select"
    assert "job=job_565f" in port_.kw["attribution"] and port_.kw["headers"]["X-Napkin-Job"] == "job_565f"


def test_the_model_line_carries_cache_tokens(caplog):
    import logging
    from test_model import GOOD, SCHEMA, U, FakeSDK, port
    from napkin.model import Usage
    sdk = FakeSDK([(json.dumps(GOOD), "end_turn", U(10, 5, 3, 2))])
    with caplog.at_level(logging.INFO, logger="napkin.model"):
        port(sdk).call("draft_brief_whole", "sys", {"x": 1}, SCHEMA, usage=Usage(), attribution="h job=job_7")
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("model draft_brief_whole"))
    assert "cache_read=2" in line and "cache_write=3" in line and "job=job_7" in line


def test_the_eval_guard_baseline_is_the_old_prompt():
    from evals.derived_claims import OLD_DRAFT_SYSTEM
    assert OLD_DRAFT_SYSTEM == SNAPSHOT_DRAFT
