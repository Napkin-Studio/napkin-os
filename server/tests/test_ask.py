"""ask_research: a person's question answered in its section; jev decides whether to search."""

import threading
from types import SimpleNamespace

import pytest

from napkin import registry
from napkin.capabilities import Capabilities
from napkin.model import ModelPort
from napkin.pipeline.ask import SYSTEM, Asker, validate
from napkin.pipeline.research import Researcher
from napkin.util import TaskError

from fakes import FakeModel, FakeResearch

SCOPE = {"org": "org/test-agency", "brand": "brand/test"}
DOC = "11111111-2222-4333-8444-555555555555"
SETTINGS = SimpleNamespace(reuse_days=30, research_concurrency=2)


class FakeJev:
    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    def ask(self, state, questions):
        self.calls.append((state, questions))
        a = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        return {n: (0.9 if n == "grounded" else a) for n in questions}


def stated(v, gate):
    return {"value": v, "origin": "stated", "gate": gate, "by": "human:u", "decision": "d_TESTSTATED1"}


def caps_for(store, model=None, research=None, jev=None):
    return Capabilities(handler="t@1.0", scope=SCOPE, model_port=ModelPort(model or FakeModel(), "claude-opus-5", 30),
                        research_port=research or FakeResearch(), layer_store=store,
                        research_semaphore=threading.Semaphore(4), jev_port=jev)


def researched(store):
    clan = {"id": DOC, "version": "3", "facts": [], "findings": [], "decision_chain": {"decisions": []},
            "data": {"campaign": {"brand": stated({"ref": "brand/bmw", "name": "BMW"}, "created"),
                                  "categories": stated(["automotive.ev_charging"], "research"),
                                  "markets": stated(["IE"], "research")}}}
    _, ch, _ = Researcher(DOC, "3", clan, "t@1.0", caps_for(store), ["media_spend"], ["IE"],
                          ["automotive.ev_charging"]).run()
    return dict(clan, facts=ch["facts_append"])


def answering(missing=(), figure=False):
    def r(p):
        pid = p["pins"][0]["id"]
        s = [{"text": "Spend leans on the channel the research names.", "cites": [pid]}]
        if figure:
            s.append({"text": "It is 87% of all spend.", "cites": [pid]})
        return {"sentences": s, "missing": list(missing), "lens": p["lens"] or "media_spend", "topic": "Where spend goes"}
    return r


def ask(store, clan, q="Where does the money go?", lens="media_spend", jev=None, model=None, research=None, about=None):
    caps = caps_for(store, model=model or FakeModel({"ask_answer": answering()}), research=research, jev=jev)
    return Asker(DOC, "3", clan, "t@1.0", caps, q, lens, SETTINGS, about=about).run()


def test_an_answer_the_facts_hold_is_written_in_its_section_without_a_search(store):
    clan = researched(store)
    research, jev = FakeResearch(), FakeJev(0.83)
    result, change, _ = ask(store, clan, jev=jev, research=research)
    assert research.calls == [] and not result["searched"]
    rec = next(iter(change["data_patch"]["asks"].values()))
    assert rec["lens"] == "media_spend" and rec["in_section"] and rec["status"] == "answered"
    assert rec["answer"][0]["cites"] and not rec["searched"] and rec["new_facts"] == []
    assert "0.83" not in str(rec)  # jev's scores are never on the page
    acts = [d["action"] for d in change["decisions"]]
    assert acts == ["check_answer", "ask_research"]
    assert "0.83" in str(change["decisions"][0]["reasoning"])  # they are in the record
    assert all(t.endswith(f"#asks[{rec['id']}]") for d in change["decisions"] for t in d["targets"])
    assert change["facts_append"] == [] and "selection" not in change["data_patch"]


def test_when_jev_says_it_does_not_answer_the_researchers_search_with_the_question(store):
    clan = researched(store)
    research, jev = FakeResearch(), FakeJev(0.2, 0.7)
    result, change, _ = ask(store, clan, q="What share of spend is on TV?", jev=jev, research=research)
    assert research.calls == [("media_spend", "IE")] and result["searched"]
    rec = next(iter(change["data_patch"]["asks"].values()))
    assert rec["searched"] and rec["status"] == "answered" and len(jev.calls) == 2
    acts = [d["action"] for d in change["decisions"]]
    assert acts[0] == "check_answer" and acts[-1] == "ask_research" and "research_run" in acts
    # a search on one question is not the lens's run: its runs, coverage and gaps stay
    assert not set(change["data_patch"].get("selection") or {}) - {"contested"}
    for d in change["decisions"]:
        assert not [t for t in d["targets"] if "#selection.lenses_run" in t or "#selection.coverage" in t]


def test_without_jev_what_the_answer_says_is_missing_decides(store):
    clan = researched(store)
    r1 = FakeResearch()
    _, ch1, _ = ask(store, clan, research=r1, model=FakeModel({"ask_answer": answering(missing=["TV share of spend"])}))
    # still partial after the first search: a second one, on what the answer says is missing
    assert r1.calls == [("media_spend", "IE"), ("media_spend", "IE")]
    rec = next(iter(ch1["data_patch"]["asks"].values()))
    assert len(rec["searches"]) == 2 and "Specifically: TV share of spend" in rec["searches"][1]["focus"]
    assert rec["web_sources"] >= 1
    r2 = FakeResearch()
    _, change, _ = ask(store, clan, research=r2)
    assert r2.calls == []
    assert "Not checked by jev" in str(change["decisions"][0]["reasoning"])


def test_a_sentence_with_a_figure_nothing_cited_holds_is_dropped(store):
    clan = researched(store)
    _, change, _ = ask(store, clan, jev=FakeJev(0.9), model=FakeModel({"ask_answer": answering(figure=True)}))
    rec = next(iter(change["data_patch"]["asks"].values()))
    assert len(rec["answer"]) == 1 and "87" not in str(rec["answer"])


def test_a_question_outside_the_sections_gets_its_own(store):
    clan = researched(store)
    _, change, _ = ask(store, clan, q="Are there grants for home chargers?", lens=None, jev=FakeJev(0.9))
    rec = next(iter(change["data_patch"]["asks"].values()))
    assert not rec["in_section"] and rec["topic"] == "Where spend goes" and rec["lens"] == "media_spend"


def test_the_question_is_checked_before_any_job(store):
    clan = researched(store)
    with pytest.raises(TaskError):
        validate(clan, {"question": "  "})
    with pytest.raises(TaskError):
        validate(clan, {"question": "Why?", "lens": "astrology"})
    assert validate(clan, {"question": " Why? "}) == ("Why?", None, None)


def test_a_document_made_before_the_task_can_still_ask():
    clan = {"pipeline": {"tasks": {"compose_report": "compose_report@1"}}}
    mod, handler = registry.resolve("ask_research", clan)
    assert handler == "ask_research@1.0"


# -- about: the fact or finding the question was asked from ------------------------------------

def with_finding(clan, status="proposed"):
    pid = clan["facts"][-1]["id"]
    fi = {"id": "fi_ABOUT1", "statement": "Spend leans on one channel.", "lens": "media_spend", "cites": [pid],
          "status": status}
    return dict(clan, findings=[fi]), pid


def test_about_is_checked_against_the_document(store):
    clan, pid = with_finding(researched(store))
    assert validate(clan, {"question": "Is this right?", "about": pid}) == ("Is this right?", None, pid)
    assert validate(clan, {"question": "Is this right?", "about": "fi_ABOUT1"})[2] == "fi_ABOUT1"
    for about in ("f_NOPE", "fi_NOPE", "src_1", 7, ""):
        with pytest.raises(TaskError):
            validate(clan, {"question": "Is this right?", "about": about})
    # a fact a person excluded, and a rejected finding, are out of use
    out = dict(clan, data=dict(clan["data"], selection={"excluded": [{"fact_id": pid}]}))
    with pytest.raises(TaskError):
        validate(out, {"question": "Is this right?", "about": pid})
    with pytest.raises(TaskError):
        validate(out, {"question": "Is this right?", "about": "fi_ABOUT1"})
    rej, _ = with_finding(researched(store), status="rejected")
    with pytest.raises(TaskError):
        validate(rej, {"question": "Is this right?", "about": "fi_ABOUT1"})


def test_the_fact_asked_about_leads_the_evidence_and_the_prompt_names_it(store):
    clan = researched(store)
    last = clan["facts"][-1]["id"]
    seen = []

    def r(p):
        seen.append(p)
        return answering()(p)
    _, change, _ = ask(store, clan, q="Is this figure current?", jev=FakeJev(0.9), about=last,
                       model=FakeModel({"ask_answer": r}))
    assert seen[0]["about"] == last and seen[0]["pins"][0]["id"] == last
    rec = next(iter(change["data_patch"]["asks"].values()))
    assert rec["about"] == last
    assert rec["in_report"] is False  # under the fact until a person adds it
    # grounded on it: the answer cites the item asked about
    assert last in rec["answer"][0]["cites"]


def test_a_finding_asked_about_leads_with_what_it_cites(store):
    clan, pid = with_finding(researched(store))
    seen = []

    def r(p):
        seen.append(p)
        return answering()(p)
    _, change, _ = ask(store, clan, q="Why does it say that?", jev=FakeJev(0.9), about="fi_ABOUT1",
                       model=FakeModel({"ask_answer": r}))
    assert seen[0]["about"] == "fi_ABOUT1" and seen[0]["findings"][0]["id"] == "fi_ABOUT1"
    assert seen[0]["pins"][0]["id"] == pid
    assert next(iter(change["data_patch"]["asks"].values()))["about"] == "fi_ABOUT1"


def test_without_about_the_record_says_none(store):
    clan = researched(store)
    seen = []

    def r(p):
        seen.append(p)
        return answering()(p)
    _, change, _ = ask(store, clan, jev=FakeJev(0.9), model=FakeModel({"ask_answer": r}))
    assert seen[0]["about"] is None
    rec = next(iter(change["data_patch"]["asks"].values()))
    assert rec["about"] is None and rec["in_report"] is True


# Owner, 2026-11-12: a question on a fact can not take longer than a whole brief or research (about 3 minutes).
def test_with_too_little_time_left_no_search_starts_and_the_answer_is_written(store, monkeypatch):
    import napkin.pipeline.ask as ask_mod
    clan = researched(store)
    monkeypatch.setattr(ask_mod, "ASK_BUDGET_S", 10.0)  # under SEARCH_NEEDS_S from the start
    research, jev = FakeResearch(), FakeJev(0.2)
    result, change, _ = ask(store, clan, q="What share of spend is on TV?", jev=jev, research=research)
    assert research.calls == [] and not result["searched"]
    rec = next(iter(change["data_patch"]["asks"].values()))
    assert rec["status"] == "partial" and rec["answer"] and not rec["searched"]
    assert rec["searches"] == [{"focus": "What share of spend is on TV?", "sources": 0, "urls": [], "facts": 0,
                                "skipped": "out of time"}]


class SlowResearch(FakeResearch):
    def __init__(self, secs):
        super().__init__()
        self.secs = secs

    def search(self, *a, **k):
        import time
        time.sleep(self.secs)
        return super().search(*a, **k)


def test_a_search_still_running_at_the_deadline_is_cut_to_a_gap(store):
    import time
    clan = researched(store)
    r = Researcher(DOC, "3", clan, "t@1.0", caps_for(store, research=SlowResearch(3.0)), ["media_spend"], ["IE"],
                   ["automotive.ev_charging"], seed="late", question_first=True)
    t0 = time.monotonic()
    res, ch, _ = r.run(focus="What share of spend is on TV?", deadline=time.monotonic() + 0.3)
    assert time.monotonic() - t0 < 2.0, "the run does not wait for the late unit"
    assert ch["facts_append"] == []
    run = next(d for d in ch["decisions"] if d["action"] == "research_run")
    assert "failed: out of time" in run["rationale"] and any("#selection.gaps[" in t or t.startswith("selection.gaps[")
                                                             for t in run["targets"]), "the cut unit is a recorded gap"


# UAT round 6: an answer with no sentences and a missing list naming a year failed the whole ask
# ("reasoning.because[1] states a figure and cites nothing"). The check rests on the ask itself.
def test_nothing_to_cite_and_a_year_in_what_is_missing_still_answers(store):
    clan = researched(store)
    empty = lambda p: {"sentences": [], "missing": ["the 2024 figure for TV share"], "lens": "media_spend", "topic": "TV"}
    result, change, _ = ask(store, clan, q="What share of spend is on TV?", jev=FakeJev(0.1),
                            model=FakeModel({"ask_answer": empty}))
    chk = change["decisions"][0]
    assert chk["action"] == "check_answer"
    for p in chk["reasoning"]["because"]:
        assert p.get("cites"), p
    assert any("#asks[" in c for p in chk["reasoning"]["because"] for c in p["cites"])
    assert result["status"] in ("partial", "not_found")


# -- a question about the fact itself: its quote, its source, its date (UAT round 12, 2026-11-13) --------

OATLY = "f_A5563F579269124A6011D028"
QUOTE = ("In late 2023 the Advertising Standards Authority of Ireland upheld one of three complaints from the "
         "National Dairy Council and ruled that “But Made For Humans” could not run in Ireland again.")


def oatly_doc():
    fact = {"id": OATLY, "entity": "brand/oatly", "key": "regulation.restriction.but_made_for_humans_banned_ie",
            "value": "Oatly is banned from using 'But Made For Humans' slogan in Ireland following ASAI ruling.",
            "unit": "text", "market": "IE", "as_of": "2023-12-01", "retrieved_at": "2026-11-12", "confidence": "low",
            "status": "active", "sources": ["src_40ea40b6ea4c9ac64244"], "quotes": {"src_40ea40b6ea4c9ac64244": QUOTE}}
    other = dict(fact, id="f_3B727D8359D100BFF3815BD7", key="regulation.restriction.other", value="Something else.",
                 quotes={"src_1": "Nothing dated."}, sources=["src_1"], as_of="2026-11-12")
    src = {"id": "src_40ea40b6ea4c9ac64244", "publisher": "Clearbox Communications", "title": "Oatly",
           "url": "https://clearboxcommunications.com/work/oatly", "retrieved_at": "2026-11-12", "published_at": None}
    return {"id": DOC, "version": "3", "facts": [other, fact], "findings": [], "sources": [src],
            "decision_chain": {"decisions": []},
            "data": {"campaign": {"brand": stated({"ref": "brand/oatly", "name": "Oatly"}, "created"),
                                  "categories": stated(["beverages.plant_milk"], "research"),
                                  "markets": stated(["IE"], "research")}}}


def test_a_question_about_a_fact_gets_its_quote_source_and_dates(store):
    seen = []

    def r(p):
        seen.append(p)
        return {"sentences": [{"text": "It is from late 2023: Clearbox Communications quotes the ASAI ruling.",
                               "cites": [OATLY]},
                              {"text": "It rests on 1 source, a ruling of 1 December 2023, so confidence is low.",
                               "cites": [OATLY]}],
                "missing": [], "lens": "regulation_clearance", "topic": "When and how sure"}
    _, change, _ = ask(store, oatly_doc(), q="What year is this from, and how sure are we of it?",
                       lens="regulation_clearance", jev=FakeJev(0.9), about=OATLY, model=FakeModel({"ask_answer": r}))
    fact = seen[0]["about_fact"]
    assert fact["id"] == OATLY and fact["as_of"] == "2023-12-01" and fact["confidence"] == "low"
    assert fact["source_count"] == 1
    assert fact["sources"] == [{"id": "src_40ea40b6ea4c9ac64244", "quote": QUOTE, "publisher": "Clearbox Communications",
                                "title": "Oatly", "url": "https://clearboxcommunications.com/work/oatly",
                                "published_at": None, "retrieved_at": "2026-11-12"}]
    assert "about_fact" in seen[0] and "never in a sentence" in SYSTEM
    rec = next(iter(change["data_patch"]["asks"].values()))
    # both sentences survive the cite check: the figures are in the fact's quote and dates
    assert [s["cites"] for s in rec["answer"]] == [[OATLY], [OATLY]] and rec["status"] == "answered"


def test_ids_written_in_a_sentence_are_not_figures_and_leave_its_text(store):
    def r(p):
        return {"sentences": [{"text": f"In late 2023 the ASAI ruled against the slogan ({OATLY}).", "cites": [OATLY]}],
                "missing": [], "lens": "regulation_clearance", "topic": "When"}
    _, change, _ = ask(store, oatly_doc(), q="What year is this from?", lens="regulation_clearance",
                       jev=FakeJev(0.9), about=OATLY, model=FakeModel({"ask_answer": r}))
    rec = next(iter(change["data_patch"]["asks"].values()))
    assert [s["text"] for s in rec["answer"]] == ["In late 2023 the ASAI ruled against the slogan."]


def test_a_figure_only_the_about_facts_quote_holds_needs_that_fact_cited(store):
    def r(p):
        return {"sentences": [{"text": "It was from late 2023.", "cites": ["f_3B727D8359D100BFF3815BD7"]}],
                "missing": [], "lens": "regulation_clearance", "topic": "When"}
    _, change, _ = ask(store, oatly_doc(), q="What year is this from?", lens="regulation_clearance",
                       jev=FakeJev(0.9), about=OATLY, model=FakeModel({"ask_answer": r}))
    assert next(iter(change["data_patch"]["asks"].values()))["answer"] == []
