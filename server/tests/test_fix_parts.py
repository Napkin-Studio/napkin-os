"""fix_parts (brief/fix.py): a problem standing on a brief, fixed by the crew in one job. Sam plans
the fix and researches what it lacks, Dara rewrites the named parts together, Jude checks them;
nothing else in the brief is written."""

import copy

from napkin.brief.fields import KEYS
from napkin.brief.fix import FixPartsJob, standing_problem

from conftest import Server
from test_brief import DOC, Host, check_change_rules, post, retrieval, run
from test_planned_brief import THIN, planned_model

OBJ = ["objectives.behavioural", "objectives.commercial"]


def fix_model(seen):
    m = planned_model(seen)

    def plan_fix(p):
        seen["plan_fix"] = p
        return {"strategy": "Grow summer visits by under-30s, measured.",
                "parts": {k: {"instruction": f"give {k} a measure and a date"} for k in p["parts_to_fix"]},
                "brand": "Brewline", "competitors": ["Insomnia"],
                "research": [{"lens": "market_structure", "market": "IE", "focus": "iced coffee sales by chain",
                              "why": "the objective needs a baseline", "for_parts": ["objectives.commercial"]}],
                "category": p["categories"][0]["code"], "ask_client": []}

    def fix(p):
        seen["fix"] = p
        return {k: {"value": f"{k}: up 10% by August", "basis": "assumption", "cites": [],
                    "builds_on_client": False, "why": "fixed on the note"} for k in p["parts"]}

    m.overrides.update({"plan_fix": plan_fix, "fix_brief_parts": fix})
    return m


def drafted(tmp_path, seen):
    s = Server(tmp_path, model=fix_model(seen), retrieval=retrieval(),
               settings_kw={"brief_flow": "planned", "brief_research_max": 2})
    host = Host()
    run(s, host, inp={"prompt": THIN, "attachments": []})
    return s, host


def jude_note(host):
    return next(d for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "bad")


def test_the_crew_fixes_the_parts_a_note_names_and_nothing_else(tmp_path):
    seen = {}
    s, host = drafted(tmp_path, seen)
    try:
        note = jude_note(host)
        assert sorted(t.split("#", 1)[1] for t in note["targets"]) == OBJ
        # a person wrote the behavioural objective before Jude's note: they hold it
        i = host.chain.index(note)
        host.chain.insert(i + 1, {"id": "d_person_edit", "kind": "edit", "action": "edit", "actor": "human:local",
                                  "targets": [f"{DOC}#objectives.behavioural"]})
        # and a person marked the commercial objective wrong, after the note
        host.chain.insert(0, {"id": "d_person_bad", "kind": "verdict", "polarity": "bad", "actor": "human:local",
                              "targets": [f"{DOC}#objectives.commercial"],
                              "rationale": "The baseline is last year's, not this summer's."})
        # a fact a person marked wrong is never used
        gone = host.facts[0]["id"]
        host.data.setdefault("selection", {})["excluded"] = [{"fact_id": gone}]
        before = copy.deepcopy(host.data)
        s.research.calls.clear()
        s.model.overrides["review_brief"] = s.model.overrides["review_brief_again"]  # Jude passes the fix
        replies = run(s, host, task="fix_parts", inp={"verdict": note["id"]})
        research_calls = list(s.research.calls)
    finally:
        s.stop()
    last = replies[-1]
    assert last["task"] == "fix_parts" and last["handler"] == "fix_parts@1.0"
    assert last["job"]["state"] == "done" and last["job"]["progress"] == {"done": 3, "total": 3}
    assert last["result"]["summary"].startswith("Fixed 1 of 2 part(s), 1 proposed")
    # Sam: the problem in Jude's words, then the person's; only the named parts; the research it lacks
    assert [p["by"] for p in seen["plan_fix"]["problem"]] == ["Jude", "a person"]
    assert "last year's" in seen["plan_fix"]["problem"][1]["said"]
    assert sorted(seen["plan_fix"]["parts_to_fix"]) == OBJ
    assert research_calls == [("market_structure", "IE")]
    # Dara: both parts together, with Sam's instructions; never the excluded fact
    assert sorted(seen["fix"]["rewrite"]) == OBJ
    assert seen["fix"]["rewrite"]["objectives.commercial"].startswith("give objectives.commercial a measure")
    assert gone not in {f["id"] for f in seen["fix"]["facts"]}
    # placed: the commercial objective written, the held one proposed, nothing else changed
    assert host.data["objectives"]["commercial"].startswith("objectives.commercial: up 10%")
    assert host.data["objectives"]["behavioural"] == before["objectives"]["behavioural"]
    assert any(d.get("action") == "propose" and f"{DOC}#objectives.behavioural" in d["targets"]
               for d in host.chain if d.get("handler", "").startswith("fix_parts@1"))
    for k in KEYS:
        if not k.startswith("objectives.") and k != "open_questions":
            top, _, leaf = k.partition(".")
            assert (before.get(top) or {}).get(leaf) == (host.data.get(top) or {}).get(leaf) if leaf \
                else before.get(k) == host.data.get(k), k
    # the questions the brief held are kept; the fix only adds to them
    assert all(q in host.data["open_questions"] for q in before["open_questions"])
    # the untouched parts keep their review entries
    assert host.data["review"]["judge"]["fields"]["audience"] == before["review"]["judge"]["fields"]["audience"]
    # the note is answered where the fix wrote; the held part still waits for the person
    mine = [d for d in host.chain if d.get("handler", "").startswith("fix_parts@1") and d["kind"] == "verdict"]
    assert not [d for d in mine if d.get("polarity") == "good" and any("#objectives" in t for t in d["targets"])], \
        "Jude still notes the objectives: no pass"
    assert all(any("#objectives" in t for t in d["targets"]) for d in mine), "no note on a part the fix left alone"
    got = standing_problem(DOC, host.chain, note["id"])
    assert got is not None and got[0] == ["objectives.behavioural"]
    check_change_rules(host)


def test_fix_parts_refuses_what_it_cannot_fix(tmp_path):
    seen = {}
    s, host = drafted(tmp_path, seen)
    try:
        note = jude_note(host)
        good = next(d for d in host.chain if d["kind"] == "verdict" and d.get("polarity") == "good")
        assert post(s, "fix_parts", {}, host.clan())[0] == 400
        assert post(s, "fix_parts", {"verdict": "d_nope"}, host.clan())[0] == 400
        assert post(s, "fix_parts", {"verdict": good["id"]}, host.clan())[0] == 400
        # every part it names written since: answered
        answered = Host(data=host.data, chain=[{"id": "d_after", "kind": "edit", "action": "edit",
                                                "actor": "human:local", "targets": [f"{DOC}#objectives"]}] + host.chain)
        assert post(s, "fix_parts", {"verdict": note["id"]}, answered.clan())[0] == 400
        locked = Host(data={**host.data, "locked": True}, chain=host.chain)
        assert post(s, "fix_parts", {"verdict": note["id"]}, locked.clan())[0] == 400
    finally:
        s.stop()


def test_one_brief_job_at_a_time(tmp_path):
    seen = {}
    s, host = drafted(tmp_path, seen)
    try:
        note = jude_note(host)
        gate = __import__("threading").Event()
        orig = s.model.overrides["plan_fix"]
        s.model.overrides["plan_fix"] = lambda p: (gate.wait(5), orig(p))[1]
        st, body = post(s, "fix_parts", {"verdict": note["id"]}, host.clan())
        assert st == 200
        assert post(s, "fix_parts", {"verdict": note["id"]}, host.clan())[0] == 409
        assert post(s, "regenerate_field", {"field": "insight"}, host.clan())[0] == 409
        assert post(s, "draft_brief", {"prompt": THIN, "attachments": []}, host.clan())[0] == 409
        gate.set()
    finally:
        s.stop()


def test_after_a_rewrite_a_note_stands_only_while_jev_doubts_the_argument():
    stands = FixPartsJob._note_stands
    assert stands(None, {"rewritten": {}, "before": {"chain": 0.9}, "after": None})
    assert stands(None, {"rewritten": {"insight": {}}, "before": {"chain": 0.2}, "after": {"chain": 0.3}})
    assert not stands(None, {"rewritten": {"insight": {}}, "before": {"chain": 0.2}, "after": {"chain": 0.8}})


def test_with_jev_the_check_reads_only_the_named_parts_and_a_mended_argument_leaves_no_note(tmp_path):
    from test_planned_brief import FakeJev
    seen = {}
    s, host = drafted(tmp_path / "a", seen)
    s.stop()
    note = jude_note(host)
    m = fix_model(seen)
    m.overrides["fix_brief_parts"] = lambda p: {k: {"value": f"A vague {k}", "basis": "assumption", "cites": [],
                                                    "builds_on_client": False, "why": "x"} for k in p["parts"]}

    def explain(p):
        seen["explain"] = p
        return {"parts": {k: {"rework": True, "why": "still vague", "instruction": "add a number"}
                          for k in list(p["flagged"]) + p["empty"]},
                "chain": {"issue": "The objectives do not lead to the proposition.", "parts": OBJ + ["insight"]},
                "dimensions": [], "questions": []}
    m.overrides["explain_flags"] = explain
    m.overrides["rewrite_brief_parts"] = lambda p: (seen.__setitem__("rewrite", p), {k: {
        "value": f"{k}: up 10% by August", "basis": "assumption", "cites": [], "builds_on_client": False,
        "why": "x"} for k in p["parts"]})[1]
    s = Server(tmp_path / "b", model=m, retrieval=retrieval(), jev=FakeJev(),
               settings_kw={"brief_flow": "planned", "brief_judge": "jev"})
    try:
        run(s, host, task="fix_parts", inp={"verdict": note["id"]})
    finally:
        s.stop()
    assert sorted(seen["explain"]["flagged"]) == OBJ, "jev reads the named parts only"
    assert sorted(seen["rewrite"]["rewrite"]) == OBJ, "Jude's chain issue reaches only the named parts"
    assert host.data["objectives"]["commercial"] == "objectives.commercial: up 10% by August"
    assert not [d for d in host.chain if d["kind"] == "verdict" and d.get("handler", "").startswith("fix_parts@1")
                and d.get("polarity") == "bad"], "jev reads the argument as mended: no new note"
    assert standing_problem(DOC, host.chain, note["id"]) is None
    passed = [d for d in host.chain if d["kind"] == "verdict" and d.get("handler", "").startswith("fix_parts@1")
              and d.get("polarity") == "good"]
    assert len(passed) == 1 and sorted(t.split("#", 1)[1] for t in passed[0]["targets"]) == OBJ
    assert passed[0]["reasoning"]["decided"].startswith("Checked the fix")
    check_change_rules(host)
