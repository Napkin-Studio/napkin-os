"""territories-gates: one pure state machine for pick, greenlight, the sensitive review and the asks.
Run from engine/: ``PYTHONPATH=. python -m pytest -q territory/tests/test_gates.py`` (needs jsonschema). No model is called: the live-mode test
at the bottom drives every gate with a stand-in model priced through the spend module.

Every case here goes through the same functions the middleware handler calls (``gates.drive``, ``approve``, ...), so live and replay cannot differ."""
from __future__ import annotations

import copy
import re

import pytest

pytest.importorskip("jsonschema")

from territory import contract, gates, spend as sp  # noqa: E402

FACTS, FINDINGS = contract.example("facts"), contract.example("findings")
AT = "2026-11-23T10:00:00Z"
WORDS_BAD = re.compile(r"(blocked_by|derived_resolution|rests_on|_id\b|None\b|null\b|\bfield\b|Traceback|Error\()")


def doc(name="data"):
    return copy.deepcopy(contract.example(name))


def route(d, tid):
    return next(t for t in d["territories"] if t["id"] == tid)


def set_check(d, tid, kind, status):
    for c in route(d, tid)["checks"]:
        if c["kind"] == kind:
            c["status"] = status
    return d


def ok(res):
    d, refusals = res
    assert refusals == [], refusals
    return d


def plain(*texts):
    for t in texts:
        assert t and not WORDS_BAD.search(t), t


def kinds(d, gate):
    return [b["kind"] for b in gates.blockers(d, gate, findings=FINDINGS)]


def at_pick():
    return gates.open_gate(doc("pick"), "pick")


def at_greenlight(greenlit=("t_started", "t_sitdown"), **kw):
    d = doc("greenlight_open")
    d["greenlit"] = []
    for tid in greenlit:
        d = ok(gates.greenlight_route(d, tid, "Shrey", AT, findings=FINDINGS))
    return gates.open_gate(d, "greenlight", findings=FINDINGS)


# ---------------------------------------------------------------- the contract's own states hold the machine to the documents the app sees


def test_the_fixture_states_say_what_the_machine_says():
    for name, gate, want in [("greenlight_derived_pending", "greenlight", {"derived_evidence"}),
                             ("greenlight_sensitive_missing", "greenlight", {"sensitive_review"}),
                             ("greenlight_open", "greenlight", {"nothing_picked"})]:
        d = doc(name)
        assert {b["kind"] for b in gates.blockers(d, gate, findings=FINDINGS)} == want, name
        refreshed = gates.open_gate(d, gate, findings=FINDINGS)
        assert {b["kind"] for b in refreshed["run"]["gate"]["blocked_by"]} == want
        assert contract.check(refreshed, facts=FACTS, findings=FINDINGS) == [], name


def test_the_pick_fixture_is_open_and_can_be_approved():
    e = gates.evaluate(doc("pick"))
    assert e["gate"] == "pick" and e["can_approve"] and e["blocked_by"] == [] and e["next"]["do"] == "hold"


# ---------------------------------------------------------------- pick


def test_pick_needs_one_ticked_insight_and_says_so_in_words():
    d = at_pick()
    for i in d["focus"]["insights"]:
        i["ticked"] = False
    e = gates.evaluate(d)
    assert [b["kind"] for b in e["blocked_by"]] == ["nothing_picked"] and not e["can_approve"]
    plain(e["words"], *(b["text"] for b in e["blocked_by"]))
    d2, refusals = gates.approve(d, "pick", "Shrey", AT)
    assert d2 == d and len(refusals) == 1
    plain(*refusals)


def test_approving_pick_records_the_decision_and_lets_explore_go():
    d = ok(gates.approve(at_pick(), "pick", "Shrey", AT))
    a = d["run"]["approvals"]["pick"]
    assert a["by"] == "Shrey" and a["decision"] == "approve" and a["inputs"] == gates.inputs_hash(d, "pick")
    assert d["run"]["decisions"][-1]["gate"] == "pick" and d["run"]["decisions"][-1]["kind"] == "approve"
    n = gates.next_step(d)
    assert (n["do"], n["stage"]) == ("run", "explore")
    contract.validate(d)


def test_an_unnamed_or_engine_approval_is_refused():
    for who in ("", "  ", "engine", "Engine"):
        d, r = gates.approve(at_pick(), "pick", who, AT)
        assert r and "named person" in r[0] and "approvals" not in d["run"] or not d["run"]["approvals"].get("pick")


def test_approving_a_gate_that_is_not_open_is_refused_in_words():
    d, r = gates.approve(at_pick(), "greenlight", "Shrey", AT)
    assert r and "pick" in r[0]
    plain(*r)
    done = doc()
    assert gates.approve(done, "pick", "Shrey", AT)[1]


# ---------------------------------------------------------------- an approval counts only for the inputs it was given for (LESSONS 11, 18)


def test_a_new_inputs_hash_voids_the_approval():
    d = ok(gates.approve(at_pick(), "pick", "Shrey", AT))
    assert gates.approval_state(d, "pick")["valid"]
    first = next(i for i in d["focus"]["insights"] if i["ticked"])
    first["ticked"] = False                                   # an edit after approving
    s = gates.approval_state(d, "pick")
    assert s["stale"] and not s["valid"]
    assert gates.next_step(d)["do"] == "hold"


def test_an_approval_of_another_run_never_passes_this_gate():
    a = ok(gates.approve(at_pick(), "pick", "Shrey", AT))
    b = at_pick()
    for i in b["focus"]["insights"][:2]:
        i["ticked"] = not i["ticked"]
    b["run"]["approvals"] = copy.deepcopy(a["run"]["approvals"])      # run A's approval carried into run B
    assert gates.inputs_hash(a, "pick") != gates.inputs_hash(b, "pick")
    assert gates.next_step(b)["do"] == "hold"
    assert gates.approval_state(b, "pick")["valid"] is False


def test_an_approval_from_before_approvals_were_tied_to_inputs_passes_nothing():
    d = at_pick()
    d["run"]["approvals"]["pick"] = {"by": "Shrey", "at": AT, "decision": "approve"}
    assert gates.next_step(d)["do"] == "hold" and "approving again" in gates.approval_state(d, "pick")["words"]


def test_an_edit_never_disables_the_next_approve_and_needs_no_reload():
    d = ok(gates.approve(at_pick(), "pick", "Shrey", AT))
    d = gates.open_gate(d, "pick")                              # the view refreshes the gate in place after the edit
    d["focus"]["insights"][5]["ticked"] = True
    d = gates.open_gate(d, "pick")
    e = gates.evaluate(d)
    assert e["can_approve"] and e["approval"]["stale"] and e["next"]["do"] == "hold"
    d = ok(gates.approve(d, "pick", "Shrey", AT))               # Approve works again straight away
    assert gates.evaluate(d)["next"]["do"] == "run" and gates.approval_state(d, "pick")["valid"]


def test_an_edit_request_is_answered_with_what_was_done():
    d = ok(gates.approve(at_pick(), "pick", "Shrey", AT))
    d["focus"]["insights"][0]["ticked"] = False
    d = gates.request(d, "pick", "edit", AT)
    d2, ans = gates.settle_requests(d)
    assert ans[0]["did"] == "refreshed" and "no longer applies" in ans[0]["words"] and d2["run"]["gate_requests"] == []
    plain(ans[0]["words"])


def test_a_request_the_engine_cannot_honour_is_answered_in_words_never_dropped():
    d = gates.request(doc(), "pick", "edit", AT)               # a finished run takes no edit
    d2, ans = gates.settle_requests(d)
    assert ans[0]["did"] == "none" and "cannot be changed" in ans[0]["words"] and d2["run"]["gate_requests"] == []
    d = gates.request(at_pick(), "pick", "retry", AT)           # nothing failed
    _, ans = gates.settle_requests(d)
    assert ans[0]["did"] == "none" and "nothing to try again" in ans[0]["words"]
    plain(*(a["words"] for a in ans))


# ---------------------------------------------------------------- greenlight: derived, mandatory, sensitive, nothing


def test_greenlight_with_no_developed_routes_says_so():
    d = at_greenlight()
    d["territories"] = [t for t in d["territories"] if t["state"] != "developed"]
    d["greenlit"] = []
    assert kinds(d, "greenlight") == ["no_routes"]


def test_greenlighting_a_route_that_rests_on_a_derived_finding_asks_before_it_passes():
    d = at_greenlight(("t_started", "t_passenger"))
    assert kinds(d, "greenlight") == ["derived_evidence"]
    ask = next(a for a in d["asks"] if a["kind"] == "derived_evidence")
    assert ask["territory_id"] == "t_passenger" and ask["status"] == "open" and "fi_NOTALK003" in ask["ids"]
    assert gates.approve(d, "greenlight", "Shrey", AT, findings=FINDINGS)[1]
    d = ok(gates.answer_ask(d, ask["id"], "verify", "Shrey", AT, findings=FINDINGS))
    assert next(g for g in d["greenlit"] if g["territory_id"] == "t_passenger")["derived_resolution"] == "verified"
    assert kinds(d, "greenlight") == []


def test_a_derived_route_can_be_sent_flagged_or_taken_off_the_list():
    d = at_greenlight(("t_started", "t_passenger"))
    ask = next(a for a in d["asks"] if a["kind"] == "derived_evidence")
    f = ok(gates.answer_ask(d, ask["id"], "send_flagged", "Shrey", AT, findings=FINDINGS))
    assert next(g for g in f["greenlit"] if g["territory_id"] == "t_passenger")["derived_resolution"] == "sent_flagged" and not kinds(f, "greenlight")
    c = ok(gates.answer_ask(d, ask["id"], "change", "Shrey", AT, findings=FINDINGS))
    assert [g["territory_id"] for g in c["greenlit"]] == ["t_started"] and not [a for a in c["asks"] if a["kind"] == "derived_evidence"]


def test_a_derived_finding_the_greenlit_entry_does_not_list_still_asks():
    d = at_greenlight(("t_passenger",))
    next(g for g in d["greenlit"])["rests_on_derived"] = []
    next(g for g in d["greenlit"])["derived_resolution"] = "verified"
    assert kinds(d, "greenlight") == ["derived_evidence"]               # the findings, not the entry, decide


def test_answered_asks_are_not_asked_again_after_a_refresh():
    d = at_greenlight(("t_started", "t_passenger"))
    ask = next(a for a in d["asks"] if a["kind"] == "derived_evidence")
    d = ok(gates.answer_ask(d, ask["id"], "verify", "Shrey", AT, findings=FINDINGS))
    d = gates.open_gate(gates.open_gate(d, "greenlight", findings=FINDINGS), "greenlight", findings=FINDINGS)
    assert [a["status"] for a in d["asks"] if a["kind"] == "derived_evidence"] == ["answered"]


def test_a_failed_mandatory_is_refused_unless_the_person_says_why():
    d = set_check(at_greenlight(), "t_sitdown", "mandatory", "fail")
    d = gates.open_gate(d, "greenlight", findings=FINDINGS)
    assert kinds(d, "greenlight") == ["near_mandatory"]
    ask = next(a for a in d["asks"] if a["kind"] == "near_mandatory")
    _, r = gates.answer_ask(d, ask["id"], "ok", "Shrey", AT, findings=FINDINGS)
    assert r and "why" in r[0]
    d = ok(gates.answer_ask(d, ask["id"], "ok", "Shrey", AT, note="Legal cleared the line on 20 Nov.", findings=FINDINGS))
    assert kinds(d, "greenlight") == [] and next(g for g in d["greenlit"] if g["territory_id"] == "t_sitdown")["note"].startswith("Legal")


def test_close_to_a_mandatory_needs_a_confirmation_not_a_reason():
    d = gates.open_gate(set_check(at_greenlight(), "t_sitdown", "mandatory", "warn"), "greenlight", findings=FINDINGS)
    assert kinds(d, "greenlight") == ["near_mandatory"]
    ask = next(a for a in d["asks"] if a["kind"] == "near_mandatory")
    assert kinds(ok(gates.answer_ask(d, ask["id"], "ok", "Shrey", AT, findings=FINDINGS)), "greenlight") == []


def test_sensitive_pack_needs_a_named_review_and_the_review_is_void_if_routes_change():
    d = at_greenlight()
    d["review"] = {"sensitive": {"required": True, "status": "missing"}}
    d = gates.open_gate(d, "greenlight", findings=FINDINGS)
    assert kinds(d, "greenlight") == ["sensitive_review"] and gates.approve(d, "greenlight", "Shrey", AT, findings=FINDINGS)[1]
    assert gates.record_review(d, "engine", AT)[1] and gates.record_review(d, "", AT)[1]
    d = ok(gates.record_review(d, "Laurence", AT))
    assert kinds(d, "greenlight") == [] and gates.sensitive_state(d)["by"] == "Laurence"
    d = ok(gates.approve(d, "greenlight", "Shrey", AT, findings=FINDINGS))
    assert gates.next_step(d)["do"] == "run"
    d = ok(gates.greenlight_route(d, "t_sunday", "Shrey", AT))            # the routes change after the review
    assert kinds(d, "greenlight") == ["sensitive_review"] and gates.sensitive_state(d)["voided"]
    assert "reviewed an earlier version" in gates.sensitive_state(d)["words"]
    assert gates.next_step(d)["do"] == "hold"
    d = gates.open_gate(d, "greenlight", findings=FINDINGS)
    assert [a["status"] for a in d["asks"] if a["kind"] == "sensitive_review"] == ["open"]


def test_a_pack_not_marked_sensitive_has_no_review_to_do():
    assert gates.record_review(at_greenlight(), "Laurence", AT)[1]
    assert "sensitive_review" not in kinds(at_greenlight(), "greenlight")


def test_greenlighting_nothing_needs_a_reason_and_sends_nothing():
    d = at_greenlight(greenlit=())
    e = gates.evaluate(d, findings=FINDINGS)
    assert not e["can_approve"] and e["can_approve_with_reason"] and kinds(d, "greenlight") == ["nothing_picked"]
    _, r = gates.approve(d, "greenlight", "Shrey", AT, findings=FINDINGS)
    assert r
    plain(*r)
    d = ok(gates.approve(d, "greenlight", "Shrey", AT, note="None of these is ownable yet.", findings=FINDINGS))
    assert gates.next_step(d)["do"] == "finish"
    out = gates.drive(d, {}, findings=FINDINGS)
    assert out["run"]["state"] == "done" and out["run"]["done"]["sent"] == 0 and not out.get("sends")


def test_a_greenlight_approval_is_void_when_a_route_is_edited_after_it():
    d = ok(gates.approve(at_greenlight(), "greenlight", "Shrey", AT, findings=FINDINGS))
    assert gates.next_step(d, findings=FINDINGS)["do"] == "run"
    route(d, "t_started")["world"]["lines"] = route(d, "t_started")["world"]["lines"][:1] + ["A line the person changed."]
    assert gates.next_step(d, findings=FINDINGS)["do"] == "hold" and gates.evaluate(d, findings=FINDINGS)["approval"]["stale"]
    d = ok(gates.approve(d, "greenlight", "Shrey", AT, findings=FINDINGS))
    assert gates.next_step(d, findings=FINDINGS)["do"] == "run"


def test_a_vote_does_not_void_an_approval():
    d = ok(gates.approve(at_greenlight(), "greenlight", "Shrey", AT, findings=FINDINGS))
    route(d, "t_started")["vote"] = "up" if route(d, "t_started").get("vote") != "up" else "down"
    assert gates.approval_state(d, "greenlight")["valid"]


# ---------------------------------------------------------------- the engine refuses what the app should not have let through


def test_the_engine_will_not_run_a_stage_past_an_approval_that_does_not_match():
    d = ok(gates.approve(at_pick(), "pick", "Shrey", AT))
    d["run"].update(state="building", stage="explore", gate=None)
    d["focus"]["insights"][0]["ticked"] = not d["focus"]["insights"][0]["ticked"]    # a building state written by hand over a changed pick
    n = gates.next_step(d)
    assert (n["do"], n["gate"]) == ("open_gate", "pick") and "approving again" in n["words"]


def test_a_stage_that_is_not_built_fails_in_words_not_silently():
    d = ok(gates.approve(at_pick(), "pick", "Shrey", AT))
    out = gates.drive(d, {})
    assert out["run"]["state"] == "failed" and out["run"]["error"]["retryable"] is False
    plain(out["run"]["error"]["message"])
    assert "not built" in out["run"]["error"]["message"]
    contract.validate(out)


def test_a_failing_stage_is_kept_retryable_and_try_again_runs_it():
    d = ok(gates.approve(at_pick(), "pick", "Shrey", AT))
    boom = {"explore": lambda doc: (_ for _ in ()).throw(RuntimeError("socket 500 at 10.0.0.3"))}
    out = gates.drive(d, boom)
    assert out["run"]["state"] == "failed" and out["run"]["error"]["retryable"]
    assert "10.0.0.3" not in out["run"]["error"]["message"]
    out = gates.request(out, "pick", "retry", AT)
    assert gates.next_step(out)["do"] == "run"
    assert gates.settle_requests(out)[1][0]["did"] == "queued"


def test_the_cap_stops_a_run_in_words_and_pays_for_nothing_more():
    d = ok(gates.approve(at_pick(), "pick", "Shrey", AT))
    s = sp.Spend(cap_usd=0.0001)

    def explore(doc):
        s.wrap(Paid())("tensions", "s", "u")
        return doc
    out = gates.drive(d, {"explore": explore})
    assert out["run"]["state"] == "failed" and "limit" in out["run"]["error"]["message"] and s.lines == []
    assert not re.search(r"\$|usd|\d+\.\d\d", out["run"]["error"]["message"], re.I)


# ---------------------------------------------------------------- live mode: every gate, models stubbed, spend asserted


class Paid:
    def __init__(self):
        self.n = 0

    def __call__(self, stage, system, user):
        self.n += 1
        return {"ok": stage}, {"model": "claude-sonnet-5-5", "prompt_tokens": 1000, "completion_tokens": 500, "calls": 1}


def _stages(spend, model):
    llm = spend.wrap(model)
    full = contract.example("data")

    def explore(d):
        llm("tensions", "crew goes out", d["title"])
        d["expeditions"] = copy.deepcopy(full["expeditions"])
        d["territories"] = [{**copy.deepcopy(t), "state": "found"} for t in full["territories"]]
        return d

    def develop(d):
        llm("sort", "develop", d["title"])
        d["territories"] = copy.deepcopy(full["territories"])
        d["spread"] = copy.deepcopy(full["spread"])
        return d

    def send(d):
        ids = [g["territory_id"] for g in d["greenlit"]]
        d["sends"] = [{"id": "snd_deck1", "to": "deck-maker", "territory_ids": ids,
                       "not_chosen": [t["id"] for t in d["territories"] if t["id"] not in ids and t["status"] == "live" and t["state"] == "developed"],
                       "by": "Shrey", "at": AT, "status": "sent"}]
        return d
    return {"explore": explore, "develop": develop, "send": send}


def live_run(sensitive=False, derived=False):
    """The whole run through the same functions a handler calls: pick, explore, develop, greenlight, send. Returns (doc, spend, model, log)."""
    model, s = Paid(), None
    s = sp.Spend(cap_usd=1.5)
    st = _stages(s, model)
    full = contract.example("data")
    d = doc("pick")
    for k in ("upstream", "finds", "focus", "journey", "crew"):
        d[k] = copy.deepcopy(full[k])
    log = []
    if sensitive:
        d["review"] = {"sensitive": {"required": True, "status": "missing"}}
    d = gates.drive(d, st, findings=FINDINGS)                           # a draft run opens the pick gate
    assert d["run"]["gate"]["id"] == "pick" and model.n == 0            # held: no paid call yet
    log.append(gates.evaluate(d, findings=FINDINGS))
    d = gates.drive(d, st, findings=FINDINGS)
    assert model.n == 0                                                 # still held, still free
    d = ok(gates.approve(d, "pick", "Shrey", AT))
    d = gates.drive(d, st, findings=FINDINGS)                           # explore, develop, then the greenlight gate
    assert d["run"]["gate"]["id"] == "greenlight" and model.n == 2
    held_calls = model.n
    d = gates.drive(d, st, findings=FINDINGS)
    assert model.n == held_calls                                        # a held greenlight spends nothing
    assert gates.approve(d, "greenlight", "Shrey", AT, findings=FINDINGS)[1]     # nothing greenlit
    for tid in (["t_started", "t_passenger"] if derived else ["t_started", "t_sitdown"]):
        d = ok(gates.greenlight_route(d, tid, "Shrey", AT, findings=FINDINGS))
    d = gates.open_gate(d, "greenlight", findings=FINDINGS)
    if derived:
        ask = next(a for a in d["asks"] if a["kind"] == "derived_evidence")
        assert gates.approve(d, "greenlight", "Shrey", AT, findings=FINDINGS)[1]
        d = ok(gates.answer_ask(d, ask["id"], "send_flagged", "Shrey", AT, findings=FINDINGS))
    if sensitive:
        assert gates.approve(d, "greenlight", "Shrey", AT, findings=FINDINGS)[1]
        d = ok(gates.record_review(d, "Laurence", AT))
    d = ok(gates.approve(d, "greenlight", "Shrey", AT, findings=FINDINGS))
    d = gates.drive(d, st, findings=FINDINGS)
    return d, s, model, log


@pytest.mark.parametrize("sensitive,derived", [(False, False), (True, False), (False, True), (True, True)])
def test_live_mode_goes_through_every_gate_and_ends_sent(sensitive, derived):
    d, s, model, log = live_run(sensitive, derived)
    assert d["run"]["state"] == "done" and d["run"]["gate"] is None
    assert d["sends"] and d["sends"][0]["territory_ids"] == [g["territory_id"] for g in d["greenlit"]]
    assert [x["gate"] for x in d["run"]["decisions"]] == ["pick", "greenlight"]
    assert gates.approval_state(d, "pick")["valid"] and gates.approval_state(d, "greenlight")["valid"]
    assert model.n == 2 and len(s.lines) == 2
    assert d["run"]["done"]["greenlit"] == 2 and d["run"]["done"]["sent"] == 2
    assert contract.check(d, facts=FACTS, findings=FINDINGS) == []


def test_live_and_replay_take_the_same_steps():
    """Replay: the same document with the model's work already in it (a resumed run). It reaches the same gates with no model call at all."""
    live, _, _, _ = live_run()
    replay = doc("pick")
    replay["upstream"] = copy.deepcopy(live["upstream"])
    full = contract.example("data")
    replay["crew"], replay["expeditions"], replay["territories"] = full["crew"], full["expeditions"], full["territories"]
    replay = ok(gates.approve(gates.drive(replay, {}), "pick", "Shrey", AT))
    calls = []
    replay = gates.drive(replay, {"explore": lambda d: calls.append("explore") or d, "develop": lambda d: calls.append("develop") or d})
    assert calls == [] and replay["run"]["gate"]["id"] == "greenlight"


def test_the_gate_the_machine_opens_is_always_a_valid_contract_document():
    for sensitive in (False, True):
        d, _, _, _ = live_run(sensitive=sensitive)
        assert contract.check(d, facts=FACTS, findings=FINDINGS) == []
    for name in contract.example_states():
        d = doc(name)
        g = (d["run"].get("gate") or {}).get("id")
        if g:
            assert contract.check(gates.open_gate(d, g, findings=FINDINGS), facts=FACTS, findings=FINDINGS) == [], name


# ---------------------------------------------------------------- words, and the screen's view


@pytest.mark.parametrize("name", ["pick", "greenlight_open", "greenlight_derived_pending", "greenlight_sensitive_missing", "failed_refused", "explore_running", "data"])
def test_every_word_the_machine_gives_a_person_reads_plainly(name):
    d = doc(name)
    e = gates.evaluate(d, findings=FINDINGS)
    plain(e["words"], e["next"]["words"], *(b["text"] for b in e["blocked_by"]), *(c["text"] for c in e["checks"]), e["sensitive"]["words"])
    if e["approval"]:
        plain(e["approval"]["words"])


def test_evaluate_exposes_what_the_ui_needs():
    e = gates.evaluate(doc("greenlight_derived_pending"), findings=FINDINGS)
    assert set(e) >= {"gate", "state", "blocked_by", "can_approve", "can_approve_with_reason", "approval", "asks", "sensitive", "inputs",
                      "checks", "words", "requests", "next"}
    assert e["gate"] == "greenlight" and not e["can_approve"] and e["asks"][0]["kind"] == "derived_evidence" and len(e["inputs"]) == 12
    assert e["next"]["do"] == "hold" and e["next"]["gate"] == "greenlight"
    assert gates.evaluate(doc())["gate"] is None and gates.evaluate(doc())["next"]["do"] == "idle"


def test_the_machine_is_pure():
    d = doc("greenlight_derived_pending")
    before = copy.deepcopy(d)
    gates.evaluate(d, findings=FINDINGS), gates.next_step(d), gates.blockers(d, "greenlight", findings=FINDINGS)
    gates.approve(d, "greenlight", "Shrey", AT), gates.open_gate(d, "greenlight"), gates.drive(d, {}), gates.sync_asks(d)
    assert d == before


def test_a_failed_run_waits_in_words_until_it_is_retried():
    d = doc("failed_refused")
    n = gates.next_step(d)
    assert n["do"] == "failed" and "Try again" in n["words"]
    plain(n["words"])
