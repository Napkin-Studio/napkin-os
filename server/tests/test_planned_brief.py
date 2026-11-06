"""draft_brief, planned (brief/planned.py): Sam plans the whole brief and runs the research it
asks for, Dara writes every part in one call, Jude reviews the whole brief once, Dara rewrites
what he names, Jude scores again; and the run log records all of it."""

import json
import time

import pytest

from napkin.brief.fields import KEYS
from napkin.brief.planned import DIMS

from conftest import Server
from fakes import FakeModel
from test_brief import DOC, Host, check_change_rules, post, retrieval, run

THIN = "Can you make me a brief? Brewline, an Irish coffee chain, is launching an oat-milk iced latte this " \
       "summer and wants more under-30s coming in."


def planned_model(seen):
    m = FakeModel()

    def plan(p):
        seen["plan"] = p
        cat = p["categories"][0]["code"]
        return {"strategy": "Make the oat iced latte the way under-30s start their summer at Brewline.",
                "parts": {k: {"must_say": "it", "rests_on": "assumption"} for k in p["parts"]},
                "brand": "Brewline", "competitors": ["Insomnia", "Costa"],
                "research": [{"lens": "market_structure", "market": "ie", "focus": "who sells iced coffee",
                              "why": "who else sells it", "for_parts": ["competitor_context"]},
                             {"lens": "consumer_culture", "market": "IE", "focus": "under-30s' café habits",
                              "why": "the audience", "for_parts": ["audience"]},
                             {"lens": "media_spend", "market": "IE", "focus": "x", "why": "over the cap",
                              "for_parts": []}],
                "category": cat,
                "ask_client": [{"question": "What is the launch budget?", "part": "budget_and_scope"}]}

    def draft(p):
        seen["draft"] = p
        fid = p["facts"][0]["id"]
        psg = p["library"][0]["id"] if p["library"] else None
        out = {}
        for k in p["parts"]:
            arr = k in ("reasons_to_believe", "tone_and_world", "mandatories", "open_questions")
            out[k] = {"value": [f"{k} item"] if arr else f"The {k} for Brewline", "basis": "assumption",
                      "cites": [], "builds_on_client": False, "why": "a planner's proposal"}
        out["competitor_context"] = {"value": "The category has a flagship.", "basis": "research", "cites": [fid],
                                     "builds_on_client": False, "why": "the market research"}
        out["audience"] = {"value": "Under-30s in Dublin who meet friends in cafés", "basis": "client",
                           "cites": [], "builds_on_client": True, "why": "the client named under-30s"}
        out["mandatories"] = {"value": ["The logo"], "basis": "research", "cites": ["f_MADEUP"],
                              "builds_on_client": False, "why": "made up"}
        if psg:
            out["insight"] = {"value": "Iced coffee is how they declare summer.", "basis": "library", "cites": [psg],
                              "builds_on_client": False, "why": "a precedent"}
        out["client"] = {"value": "Brewline", "basis": "client", "cites": [], "builds_on_client": False,
                         "why": "named"}
        return out

    def review(p, score):
        return {"dimensions": [{"dimension": d, "verdict": "pass" if i < score else "vague", "evidence": "e",
                                "fix": "f"} for i, d in enumerate(DIMS)],
                "chain": {"verdict": "pass", "note": "it holds"},
                "claims": [{"part": "competitor_context", "claim": "a flagship", "cite": "x", "verdict": "partly",
                            "note": "the fact gives a year, not a name"}],
                "notes": [{"parts": ["objectives.commercial", "objectives.behavioural"], "severity": "fix",
                           "note": "The objectives need a measure and a date."},
                          {"parts": ["tone_and_world"], "severity": "consider", "note": "Could be warmer."}],
                "revise": [{"part": "objectives.commercial", "instruction": "add a measure"}] if score < 5 else [],
                "questions": ["What is the launch budget?", "How will the work be judged?"],
                "single_mindedness": {"verdict": "single", "split_into": []}, "summary": "A clear brief."}

    m.overrides.update({
        "plan_brief": plan, "draft_brief_whole": draft,
        "review_brief": lambda p: (seen.setdefault("reviews", []).append(p), review(p, 4))[1],
        "review_brief_again": lambda p: (seen.setdefault("reviews", []).append(p), review(p, 6))[1],
        "rewrite_brief_parts": lambda p: (seen.__setitem__("rewrite", p), {k: {
            "value": "Grow under-30 visits by a measured share this summer", "basis": "assumption", "cites": [],
            "builds_on_client": False, "why": "rewritten on Jude's note"} for k in p["parts"]})[1],
    })
    return m


def test_the_planned_brief_plans_researches_writes_whole_and_reviews_once(tmp_path):
    seen = {}
    s = Server(tmp_path, model=planned_model(seen), retrieval=retrieval(),
               settings_kw={"brief_flow": "planned", "brief_research_max": 2, "runlog_dir": str(tmp_path / "runs")})
    try:
        host = Host()
        replies = run(s, host, inp={"prompt": THIN, "attachments": []})
        research_calls = list(s.research.calls)
    finally:
        s.stop()
    last = replies[-1]
    assert last["job"]["state"] == "done" and last["job"]["progress"] == {"done": 4, "total": 4}
    # the research the plan asked for, capped: two units, the market read as IE
    assert sorted(research_calls) == [("consumer_culture", "IE"), ("market_structure", "IE")]
    assert host.facts, "what the research found is pinned into the brief"
    assert seen["draft"]["facts"], "Dara writes from the facts"
    assert seen["draft"]["plan"]["strategy"].startswith("Make the oat iced latte")
    # every part written; the research claim cites a pinned fact; one citing nothing it was given is assumed
    by = {t.split("#", 1)[1]: d for d in host.chain if d.get("action") == "draft" for t in d["targets"]}
    assert by["competitor_context"]["basis"] == "research" and by["competitor_context"]["cites"][0].startswith("f_")
    assert by["mandatories"]["basis"] == "assumption"
    assert by["competitor_context"]["reasoning"]["attention"].startswith("Check:"), "Jude's partly-supported claim"
    # Dara rewrote it on Jude's note; it is her proposal, so it says it is one (feature brief-first-draft-checks)
    assert host.data["objectives"]["commercial"] == "To confirm: Grow under-30 visits by a measured share this summer"
    # Jude: one note per issue (two notes, not one per part), the fix marked bad. His note on the
    # draft he sent back is the loop's own verdict (test_the_loop_is_recorded_as_it_happened).
    back = {d["id"] for d in host.chain if d.get("superseded_by")}
    notes = [d for d in host.chain if d["kind"] == "verdict" and not set(d["cites"]) & back]
    assert len(notes) == 2 and {d["polarity"] for d in notes} == {"bad", "good"}
    assert sorted(t.split("#", 1)[1] for t in notes[-1]["targets"] + notes[0]["targets"]) == \
        ["objectives.behavioural", "objectives.commercial", "tone_and_world"]
    # the questions once each, from the plan, the draft and the review
    oq = host.data["open_questions"]
    assert oq.count("What is the launch budget?") == 1 and "How will the work be judged?" in oq
    assert host.data["review"]["judge"]["health"] == round(100 * 13 / 14)
    assert any(d["action"] == "plan" and d["agent"].endswith("/synthesise") for d in host.chain)
    check_change_rules(host)
    # the run log: every stage, call, search and decision, with tokens and cost; no bodies by default
    logs = list((tmp_path / "runs").rglob("draft_brief-*.jsonl"))
    assert len(logs) == 1
    evs = [json.loads(x) for x in logs[0].read_text().splitlines()]
    kinds = [e["ev"] for e in evs]
    assert kinds[0] == "job_start" and kinds[-1] == "job_end"
    assert [e["stage"] for e in evs if e["ev"] == "stage_end"] == ["extract", "context", "draft", "judge"]
    purposes = [e["purpose"] for e in evs if e["ev"] == "model"]
    for p in ("plan_brief", "draft_brief_whole", "review_brief", "rewrite_brief_parts", "review_brief_again"):
        assert p in purposes
    assert sum(1 for e in evs if e["ev"] == "research") == 2
    assert all(e["in_tokens"] == 100 and e["cost"] is not None and "payload" not in e
               for e in evs if e["ev"] == "model")
    assert any(e["ev"] == "note" and e["what"] == "research_capped" for e in evs)
    end = evs[-1]
    assert end["state"] == "done" and end["total"]["model_calls"] == len(purposes)
    assert end["total"]["decisions"] == sum(1 for e in evs if e["ev"] == "decision")
    review_notes = [e for e in evs if e["ev"] == "note" and e["what"].startswith("review_brief")]
    assert [n["score"] for n in review_notes] == [11, 13]


def test_the_run_log_is_off_unless_a_directory_is_set(tmp_path):
    seen = {}
    s = Server(tmp_path, model=planned_model(seen), retrieval=retrieval(), settings_kw={"brief_flow": "planned"})
    try:
        run(s, Host(), inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    assert not list(tmp_path.rglob("*.jsonl"))


class FakeJev:
    """jev: a part whose text says "vague" needs rewriting (0.9), any other does not (0.1)."""

    def __init__(self):
        self.calls = []

    def ask(self, state, questions):
        self.calls.append(questions)
        out = {}
        for n, q in questions.items():
            if q["type"] == "noul":
                out[n] = 0.9 if "vague" in str(q["instructions"].get("text", "")).lower() else \
                    0.8 if n == "chain" else 0.1
            else:
                out[n] = ("pass", {"pass": 0.8, "vague": 0.1, "missing": 0.1})
        return out


def test_the_check_loop_rewrites_what_jev_flags_and_jude_explains(tmp_path):
    seen = {}
    m = planned_model(seen)
    base_draft = m.overrides["draft_brief_whole"]

    def draft(p):
        out = base_draft(p)
        out["tone_and_world"] = {"value": ["vague and nice"], "basis": "assumption", "cites": [],
                                 "builds_on_client": False, "why": "x"}
        out["background"] = {"value": "A vague background", "basis": "assumption", "cites": [],
                             "builds_on_client": False, "why": "x"}
        return out

    def explain(p):
        seen["explain"] = p
        return {"parts": {k: {"rework": k == "tone_and_world", "why": f"{k} is generic",
                              "instruction": "make it specific" if k == "tone_and_world" else ""}
                          for k in list(p["flagged"]) + p["empty"]},
                "chain": {"issue": None, "parts": []}, "dimensions": [], "questions": ["What is the budget?"]}

    def rewrite(p):
        seen["rewrite"] = p
        return {k: {"value": ["sunny", "quick-witted"], "basis": "assumption", "cites": [], "builds_on_client": False,
                    "why": "rewritten"} for k in p["parts"]}
    m.overrides.update({"draft_brief_whole": draft, "explain_flags": explain, "rewrite_brief_parts": rewrite})
    jev = FakeJev()
    s = Server(tmp_path, model=m, retrieval=retrieval(), jev=jev,
               settings_kw={"brief_flow": "planned", "brief_judge": "jev", "runlog_dir": str(tmp_path / "runs")})
    try:
        host = Host()
        run(s, host, inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    assert sorted(seen["explain"]["flagged"]) == ["background", "tone_and_world"]
    assert list(seen["rewrite"]["rewrite"]) == ["tone_and_world"], "Jude kept the background: only one rewrite"
    assert host.data["tone_and_world"] == ["sunny", "quick-witted"]
    d = next(d for d in host.chain if d.get("action") == "draft" and d["targets"][0].endswith("#tone_and_world"))
    # an assumption's why is in attention (brief-fact-provenance): never an uncited reason
    assert "Rewritten on Jude's note: tone_and_world is generic" in d["reasoning"]["attention"]
    # the loop is recorded (redraft-provenance): Jude's note on the draft he sent back, as the verdict
    # it was, and his pass on the rewrite; the brief as it stands has no note on it
    back = next(x for x in host.chain if x.get("superseded_by") == d["id"])
    verdicts = [x for x in host.chain if x["kind"] == "verdict"]
    assert [(x["polarity"], x["cites"]) for x in verdicts] == [("good", [d["id"]]), ("bad", [back["id"]])]
    sent = verdicts[1]
    assert sent["id"] in d["cites"]
    assert any(p["point"].startswith("Jude's note: ") and p["cites"] == [sent["id"]] for p in d["reasoning"]["because"])
    # Jude's "What is the budget?" and the plan's "What is the launch budget?" are one ask: it is
    # asked once, in the plan's words, and the merge is in the run log.
    assert [q for q in host.data["open_questions"] if "budget" in q.lower()] == ["What is the launch budget?"]
    assert host.data["review"]["judge"]["health"] == 100
    assert len(jev.calls) == 2, "jev before and after the rewrite"
    check_change_rules(host)
    evs = [json.loads(x) for x in next((tmp_path / "runs").rglob("*.jsonl")).read_text().splitlines()]
    assert sum(1 for e in evs if e["ev"] == "jev") == 2
    j = next(e for e in evs if e["ev"] == "note" and e["what"] == "jude_on_flags")
    assert j["disagreed_with_jev"] == ["background"]
    assert not any(e["ev"] == "model" and e["purpose"] == "review_brief" for e in evs), "no whole-brief review call"


def test_a_missing_dimension_reaches_dara_and_client_is_only_what_ellis_captured(tmp_path):
    seen = {}
    m = planned_model(seen)
    base_draft = m.overrides["draft_brief_whole"]

    def draft(p):
        out = base_draft(p)
        out["background"] = {"value": "Sales are flat.", "basis": "client", "cites": [], "builds_on_client": False,
                             "why": "the client said so"}  # the thin brief says nothing about sales
        return out

    class MissingEval(FakeJev):
        def ask(self, state, questions):
            out = super().ask(state, questions)
            if len(self.calls) == 1:
                out["dim_evaluation_criteria"] = ("missing", {"missing": 0.9, "vague": 0.05, "pass": 0.05})
            return out

    def explain(p):
        seen["explain"] = p
        return {"parts": {k: {"rework": False, "why": "fine", "instruction": ""} for k in list(p["flagged"]) + p["empty"]},
                "chain": {"issue": None, "parts": []},
                "dimensions": [{"dimension": "evaluation_criteria", "parts": ["desired_response.do"],
                                "instruction": "say how the work will be judged"}], "questions": []}
    m.overrides.update({"draft_brief_whole": draft, "explain_flags": explain,
                        "rewrite_brief_parts": lambda p: (seen.__setitem__("rewrite", p), {k: {
                            "value": "Visit twice in June; judged on repeat visits", "basis": "assumption",
                            "cites": [], "builds_on_client": False, "why": "x"} for k in p["parts"]})[1]})
    s = Server(tmp_path, model=m, retrieval=retrieval(), jev=MissingEval(),
               settings_kw={"brief_flow": "planned", "brief_judge": "jev"})
    try:
        host = Host()
        run(s, host, inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    assert seen["explain"]["missing_dimensions"].keys() == {"evaluation_criteria"}
    assert seen["rewrite"]["rewrite"] == {"desired_response.do": "say how the work will be judged"}
    # Dara's proposal says it is one (feature brief-first-draft-checks)
    assert host.data["desired_response"]["do"].startswith("To confirm: Visit twice in June")
    bg = next(d for d in host.chain if d.get("action") == "draft" and d["targets"][0].endswith("#background"))
    assert bg["basis"] == "assumption", "the client said nothing about sales: not the client's words"


def test_a_file_read_as_pages_still_lands_in_a_brief_the_schema_takes(tmp_path):
    # 2026-10-01: the record of a file read as pages carried an extra key the schema refuses, so
    # the host refused the whole brief and the planner saw an empty document
    import base64
    import hashlib
    seen = {}
    m = planned_model(seen)
    m.overrides["read_document"] = lambda p: (seen.__setitem__("read", p), {
        "text": "Page 1\nSamaritans tender\n[Bar chart: calls by age, 18-34 up 12%]", "pages": 1})[1]
    pdf = b"%PDF-1.7 << /Type /Page >> scan"
    att = {"name": "tender deck.pdf", "sha256": hashlib.sha256(pdf).hexdigest(), "text": "Samaritans tender",
           "media_type": "application/pdf",
           "document": {"media_type": "application/pdf", "data": base64.b64encode(pdf).decode()}}
    s = Server(tmp_path, model=m, retrieval=retrieval(), settings_kw={"brief_flow": "planned"})
    try:
        host = Host()
        run(s, host, inp={"prompt": THIN, "attachments": [att]})
    finally:
        s.stop()
    assert seen["read"]["name"] == "tender deck.pdf", "the deck was read as pages"
    mats = host.data["materials"]
    rec = next(v for v in mats.values() if v["name"] == "tender deck.pdf")
    assert set(rec["transcribed"]) <= {"model", "backend"}
    assert host.data.get("insight"), "the brief landed"
    check_change_rules(host)  # the whole document validates against Brief Maker's schema


class HeldJev(FakeJev):
    """jev reading the facts held for a planned search: the market's players are held, the
    audience's habits are not."""

    def ask(self, state, questions):
        if "held" in questions:
            self.calls.append(questions)
            return {"held": 0.9 if "who sells" in str(state.get("need")) else 0.2}
        return super().ask(state, questions)


def carried_facts(n=100):
    """What a brief made from research carries: many pins, each with the source it was read from."""
    out = [{"id": f"f_CARRIED{i:04d}", "entity": "category/food_drink.coffee_shops", "key": f"market.player_{i}",
            "value": f"Chain {i}", "unit": "text", "market": "IE", "as_of": "2026-01-01",
            "retrieved_at": "2026-09-20", "sources": ["src_cso0001"], "quotes": {"src_cso0001": f"Chain {i} sells"},
            "confidence": "medium", "status": "active", "version": 1, "layer": "category",
            "origin": f"fact://category/food_drink.coffee_shops/market.player_{i}@1", "decision": "d_CARRIED001",
            "pinned_at": "2026-09-20T00:00:00Z", "pin_reason": "carried", "licence": "open", "method": "report"}
           for i in range(n)]
    return out, [{"id": "src_cso0001", "uri": "https://www.cso.ie/coffee", "publisher": "CSO",
                  "title": "Coffee shops in Ireland", "tier": "primary", "domain": "cso.ie", "licence": "open"}]


def test_a_brief_from_research_sees_every_fact_with_its_source_and_does_not_search_what_it_holds(tmp_path):
    seen, jev = {}, HeldJev()
    s = Server(tmp_path, model=planned_model(seen), retrieval=retrieval(), jev=jev,
               settings_kw={"brief_flow": "planned", "brief_research_max": 3, "brief_judge": "review"})
    try:
        host = Host()
        host.facts, host.sources = carried_facts(100)
        run(s, host, inp={"prompt": THIN, "attachments": []})
        research_calls = list(s.research.calls)
    finally:
        s.stop()
    # Sam and Dara see every fact the brief holds (not the first 80), each with where it was read
    assert len(seen["plan"]["facts"]) >= 100 and len(seen["draft"]["facts"]) >= 100
    assert seen["plan"]["facts"][0]["source"]["publisher"] == "CSO"
    # the market's players are held: that search is skipped; the audience is not: it runs
    assert ("market_structure", "IE") not in research_calls and ("consumer_culture", "IE") in research_calls
    held = [d for d in host.chain if d.get("action") == "research_held"]
    assert held and "jev" in json.dumps(held[0]["reasoning"])


def test_the_job_the_barrier_and_the_objection_are_drafted_with_the_other_parts(tmp_path):
    seen = {}
    s = Server(tmp_path, model=planned_model(seen), retrieval=retrieval(),
               settings_kw={"brief_flow": "planned", "brief_research_max": 2})
    try:
        host = Host()
        replies = run(s, host, inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    assert replies[-1]["job"]["state"] == "done"
    drafted = {t.split("#", 1)[1] for d in host.chain if d.get("action") == "draft" for t in d["targets"]}
    for k in ("job", "barrier", "objection"):
        assert k in seen["draft"]["parts"], f"Dara is asked for {k}"
        assert str(host.data.get(k) or "").strip(), f"{k} is written, not left empty"
        assert k in drafted, f"{k} carries a draft decision with its reasons"


# ---- intake (brief/intake.py, feature brief-intake-qa) ----------------------------------------------------

import fakes

ASKABLE = ("Client: Brewline\nProject: Iced Latte\nObjective (commercial): Grow iced coffee sales by 10% by Q4.\n"
           "Audience: Under-30s who meet friends in cafes.\nMandatory: The Brewline logo.")  # no budget, no timeline
EVERYTHING = ASKABLE + "\nBudget: Not set yet.\nTimeline: Live by 1 June."
FIGURE = "EUR 150,000 incl. VAT, media inside it"


@pytest.fixture(autouse=True)
def _timeline_label(monkeypatch):
    monkeypatch.setitem(fakes.LABEL_KEYS, "Timeline", "timeline")  # the fake capture reads a Timeline: line


def intake_model(seen):
    """The planned fakes, with Dara resting the budget on the client's words whenever there are some."""
    m = planned_model(seen)
    whole = m.overrides["draft_brief_whole"]

    def draft(p):
        out = whole(p)
        out["budget_and_scope"] = {"value": f"Budget: {FIGURE}.", "basis": "client", "cites": [],
                                   "builds_on_client": True, "why": "the planner's answer"}
        return out
    m.overrides["draft_brief_whole"] = draft
    return m


def intake_server(tmp_path, seen, wait=30, **kw):
    return Server(tmp_path, model=intake_model(seen), retrieval=retrieval(),
                  settings_kw={"brief_flow": "planned", "brief_research_max": 1, "brief_intake_wait": wait,
                               "runlog_dir": str(tmp_path / "runs"), **kw})


def answering(s, host, answers):
    """on_reply: answer the open questions once, with `answers` ({key: text | None}; {} skips them all)."""
    sent = []

    def go(body):
        job = body["job"]
        if job["state"] != "needs_input" or sent:
            return
        sent.append(job["questions"])
        given = {q["id"]: answers.get(q["key"]) for q in job["questions"] if q["key"] in answers}
        st, rb = post(s, "answer_question", {"job_id": job["id"], "questions_id": job["questions_id"],
                                             "answers": given}, host.clan())
        assert st == 200, rb
        host.apply(rb["change"])
    go.sent = sent
    return go


def states(replies):
    return [r["job"]["state"] for r in replies]


def events(tmp_path):
    (log,) = list((tmp_path / "runs").rglob("draft_brief-*.jsonl"))
    return [json.loads(x) for x in log.read_text().splitlines()]


def parts_to_confirm(data):
    return sorted(k for k, v in {**data, **data.get("objectives", {})}.items()
                  if isinstance(v, str) and v.startswith("To confirm:"))


def test_intake_pauses_before_the_plan_and_an_answer_is_written_as_the_clients_word(tmp_path):
    seen = {}
    s = intake_server(tmp_path, seen)
    try:
        host = Host()
        go = answering(s, host, {"budget": FIGURE})
        replies = run(s, host, inp={"prompt": ASKABLE, "attachments": [], "intake": True}, on_reply=go)
    finally:
        s.stop()
    assert "needs_input" in states(replies) and states(replies)[-1] == "done"
    (asked,) = go.sent
    assert [q["key"] for q in asked] == ["budget", "timeline"]
    waiting = next(r for r in replies if r["job"]["state"] == "needs_input")
    assert waiting["job"]["question"] is None and waiting["job"]["stage"] == "context"
    assert waiting["job"]["progress"]["total"] == 4 and waiting["job"]["questions_id"]
    # the plan was not called until the answer arrived, and it reads the answer as the client's words
    assert FIGURE in seen["plan"]["client_said"] and FIGURE in seen["draft"]["client_said"]
    assert any(FIGURE in str(w) for r in seen["reviews"] for w in [r.get("client_said")]), "Jude reads it too"
    # the part it feeds is the client's, not an assumption
    assert host.data["budget_and_scope"] == f"Budget: {FIGURE}."
    by = {t.split("#", 1)[1]: d for d in host.chain if d.get("action") == "draft" for t in d["targets"]}
    assert by["budget_and_scope"]["basis"] == "client"
    # one material and one capture item, the answer verbatim, and one decision saying a person answered
    (mid,) = [m for m, e in host.data["materials"].items() if e["name"] == "Intake answers"]
    assert host.data["materials"][mid]["kind"] == "other"
    (cap,) = [i for i in host.data["capture"]["items"].values() if i["material_id"] == mid]
    assert cap["key"] == "budget" and cap["quote"] == FIGURE and cap["status"] == "fact"
    dec = next(d for d in host.chain if d["action"] == "capture" and mid in d["cites"])
    assert "A person answered" in dec["reasoning"]["decided"] and "planner" in dec["reasoning"]["attention"]
    # it is answered once: no budget question comes back, whatever wording the model used; the timeline was
    # skipped and is asked once
    oq = host.data["open_questions"]
    assert not [q for q in oq if "launch budget" in q.lower()] and "How will the work be judged?" in oq
    assert sum("when does it need to be live" in q.lower() for q in oq) == 1
    check_change_rules(host)
    # zero added model calls: the purposes are today's, each called once
    evs = events(tmp_path)
    purposes = [e["purpose"] for e in evs if e["ev"] == "model"]
    assert {"capture", "scorecard", "plan_brief", "draft_brief_whole", "review_brief"} <= set(purposes)
    assert all(purposes.count(p) == 1 for p in ("capture", "scorecard", "plan_brief", "draft_brief_whole"))
    wait = next(e for e in evs if e.get("what") == "intake_wait")
    assert wait["outcome"] == "answered" and wait["asked"] == ["budget", "timeline"]
    assert any(e["ev"] == "note" and e["what"] == "intake_skipped" for e in evs)


def test_an_answered_client_is_not_asked_again_on_a_redraft_whose_text_names_no_client(tmp_path):
    no_client = ASKABLE.replace("Client: Brewline\n", "")
    s = intake_server(tmp_path, {})
    try:
        host = Host()
        first = answering(s, host, {"client": "Brewline", "budget": FIGURE})
        run(s, host, inp={"prompt": no_client, "attachments": [], "intake": True}, on_reply=first)
        (asked,) = first.sent
        assert asked[0]["key"] == "client"
        # the same document, drafted again from text that still names no client
        second = answering(s, host, {"budget": FIGURE})
        run(s, host, inp={"prompt": no_client, "attachments": [], "intake": True}, on_reply=second)
    finally:
        s.stop()
    again = [q["key"] for q in (second.sent[0] if second.sent else [])]
    assert "client" not in again and "budget" not in again, again


def test_skipping_everything_gives_todays_brief_with_the_question_open_once(tmp_path):
    runs = []
    for intake_on, sub in ((False, "off"), (True, "skip")):
        seen = {}
        s = intake_server(tmp_path / sub, seen)
        try:
            host = Host()
            replies = run(s, host, inp={"prompt": ASKABLE, "attachments": [], "intake": intake_on},
                          on_reply=answering(s, host, {}))
        finally:
            s.stop()
        assert replies[-1]["job"]["state"] == "done"
        runs.append((host, replies, seen, tmp_path / sub))
    (off, off_replies, off_seen, _), (skip, skip_replies, skip_seen, skip_dir) = runs
    assert "needs_input" not in states(off_replies) and "needs_input" in states(skip_replies)
    # the fields are the same as with intake off; the budget is a To confirm, the question is open once, worded by intake
    for k in ("budget_and_scope", "audience", "insight"):
        assert skip.data.get(k) == off.data.get(k)
    assert parts_to_confirm(skip.data) == parts_to_confirm(off.data)
    oq = skip.data["open_questions"]
    assert sum("budget" in q.lower() for q in oq) == 1
    assert next(q for q in oq if "budget" in q.lower()).startswith("[important] What is the budget, and does it "
                                                                    "include VAT")
    assert skip_seen["plan"]["client_said"] == off_seen["plan"]["client_said"]
    evs = events(skip_dir)
    assert next(e for e in evs if e.get("what") == "intake_wait")["outcome"] == "skipped"
    assert any(e["ev"] == "note" and e["what"] == "intake_skipped" for e in evs)
    assert any("Went on without an answer" in d["reasoning"]["decided"] for d in skip.chain)
    check_change_rules(skip)


def test_an_unanswered_question_times_out_into_a_recorded_default_and_a_late_answer_is_refused(tmp_path):
    seen = {}
    s = intake_server(tmp_path, seen, wait=0.5)
    try:
        host = Host()
        t0 = time.time()
        replies = run(s, host, inp={"prompt": ASKABLE, "attachments": [], "intake": True})
        waited = time.time() - t0
        last = replies[-1]
        st, body = post(s, "answer_question", {"job_id": last["job"]["id"], "questions_id": "x", "answers": {}},
                        host.clan())
    finally:
        s.stop()
    assert last["job"]["state"] == "done" and "needs_input" in states(replies) and waited < 20
    assert st == 409 and "went on without" in json.dumps(body), body
    evs = events(tmp_path)
    assert next(e for e in evs if e.get("what") == "intake_wait")["outcome"] == "unanswered"
    assert any(e.get("what") == "intake_unanswered" for e in evs)
    assert any("nobody answered within the wait" in d["reasoning"]["decided"] for d in host.chain)
    assert sum("budget" in q.lower() for q in host.data["open_questions"]) == 1
    check_change_rules(host)


def test_cancel_job_ends_the_wait_at_once_and_the_plan_is_never_called(tmp_path):
    seen = {}
    s = intake_server(tmp_path, seen, wait=60)
    try:
        host = Host()
        st, body = post(s, "draft_brief", {"prompt": ASKABLE, "attachments": [], "intake": True}, host.clan())
        jid, t0 = body["job"]["id"], time.time()
        while body["job"]["state"] != "needs_input":
            assert time.time() - t0 < 20, body["job"]
            time.sleep(0.02)
            _, body = post(s, "job_status", {"job_id": jid}, host.clan())
            host.apply(body["change"])
        t1 = time.time()
        st, body = post(s, "cancel_job", {"job_id": jid}, host.clan())
        host.apply(body["change"])
        job = s.app.state.mw.jobs.get(jid, s.app.state.mw.settings.scope, DOC)
        job.thread.join(5)
    finally:
        s.stop()
    assert body["job"]["state"] == "cancelled" and time.time() - t1 < 5 and not job.thread.is_alive()
    assert "plan" not in seen and "questions" not in body["job"]
    check_change_rules(host)


def test_a_brief_with_every_askable_item_never_pauses_and_adds_no_second(tmp_path):
    seen = {}
    s = intake_server(tmp_path, seen, wait=60)
    try:
        host = Host()
        replies = run(s, host, inp={"prompt": EVERYTHING, "attachments": [], "intake": True}, timeout=20)
    finally:
        s.stop()
    assert set(states(replies)) <= {"queued", "running", "done"}
    assert not any(str(e.get("what")).startswith("intake") for e in events(tmp_path))


def test_without_input_intake_an_incomplete_brief_never_pauses(tmp_path):
    for inp in ({"prompt": ASKABLE, "attachments": []}, {"prompt": ASKABLE, "attachments": [], "intake": False}):
        s = intake_server(tmp_path / str(len(inp)), {}, wait=60)
        try:
            replies = run(s, Host(), inp=inp, timeout=20)
        finally:
            s.stop()
        assert "needs_input" not in states(replies) and states(replies)[-1] == "done"
    # and a wait of 0 is the same as off, even when the request asks
    s = intake_server(tmp_path / "zero", {}, wait=0)
    try:
        replies = run(s, Host(), inp={"prompt": ASKABLE, "attachments": [], "intake": True}, timeout=20)
    finally:
        s.stop()
    assert "needs_input" not in states(replies)


def test_the_fields_flow_and_a_bad_intake_value_ignore_or_refuse_intake(tmp_path):
    s = Server(tmp_path, retrieval=retrieval(), settings_kw={"brief_flow": "fields", "brief_intake_wait": 60})
    try:
        replies = run(s, Host(), inp={"prompt": ASKABLE, "attachments": [], "intake": True}, timeout=20)
        st, body = post(s, "draft_brief", {"prompt": ASKABLE, "attachments": [], "intake": "yes"}, Host().clan())
    finally:
        s.stop()
    assert "needs_input" not in states(replies) and states(replies)[-1] == "done"
    assert st == 400 and "intake" in json.dumps(body)


def test_answer_question_is_routed_to_a_brief_job_and_refused_for_one_that_is_not_waiting(tmp_path):
    seen = {}
    s = intake_server(tmp_path, seen, wait=60)
    try:
        host = Host()
        replies = run(s, host, inp={"prompt": EVERYTHING, "attachments": [], "intake": True}, timeout=20)
        jid = replies[-1]["job"]["id"]
        st, body = post(s, "answer_question", {"job_id": jid, "questions_id": "x", "answers": {}}, host.clan())
        assert st == 409 and body["error"]["type"] == "job_state", body  # a draft_brief that is not waiting
        replies = run(s, host, task="regenerate_field", inp={"field": "insight"}, timeout=20)
        st, body = post(s, "answer_question", {"job_id": replies[-1]["job"]["id"], "questions_id": "x",
                                               "answers": {}}, host.clan())
        assert st == 409 and body["error"]["type"] == "job_state", body  # a regenerate_field job
        # while waiting: a wrong questions_id, an answer to no question and a non-text answer are 400s
        host = Host()  # a document that has not answered intake before
        st, body = post(s, "draft_brief", {"prompt": ASKABLE, "attachments": [], "intake": True}, host.clan())
        jid = body["job"]["id"]
        t0 = time.time()
        while body["job"]["state"] != "needs_input":
            assert time.time() - t0 < 20
            time.sleep(0.02)
            _, body = post(s, "job_status", {"job_id": jid}, host.clan())
            host.apply(body["change"])
        qid = body["job"]["questions_id"]
        for inp in ({"questions_id": "other", "answers": {}}, {"questions_id": qid, "answers": {"q_nope": "x"}},
                    {"questions_id": qid, "answers": {"q_budget": 5}}, {"questions_id": qid, "answers": []}):
            st, bad = post(s, "answer_question", {"job_id": jid, **inp}, host.clan())
            assert st == 400, bad
        st, ok = post(s, "answer_question", {"job_id": jid, "questions_id": qid, "answers": {}}, host.clan())
        assert st == 200 and ok["job"]["state"] == "running" and "questions" not in ok["job"]
        post(s, "cancel_job", {"job_id": jid}, host.clan())
    finally:
        s.stop()
