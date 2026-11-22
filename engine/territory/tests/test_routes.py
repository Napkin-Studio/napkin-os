"""territories-engine-routes: the crew of five headings, routes with a measured distance, the spread check and the Review agent's fixes, steering.
Run from engine/: ``PYTHONPATH=. python -m pytest -q territory/tests/test_routes.py`` (needs jsonschema). No real model is called: a stand-in model
answers every stage, and the live-mode tests send it through ``Spend.wrap`` and ``gates.drive`` exactly as the middleware handler does."""
from __future__ import annotations

import copy
import dataclasses
import hashlib
import json
import re
import threading

import pytest

pytest.importorskip("jsonschema")

from territory import compare, contract, gates, insights, routes, spend as sp  # noqa: E402
from territory.llm import FakeLLM  # noqa: E402

FACTS, FINDINGS = contract.example("facts"), contract.example("findings")
AT = "2026-11-23T10:00:00Z"
DIRS = {"core": 0.2, "feel": 0.45, "opposite": 0.55, "adjacent": 0.6, "outside": 0.85}
WORDS_BAD = re.compile(r"(blocked_by|derived_resolution|rests_on|_id\b|None\b|null\b|\bfield\b|Traceback|Error\()")
VERIFIED = next(f["id"] for f in FINDINGS["findings"] if f["status"] == "verified")
PROPOSED = next(f["id"] for f in FINDINGS["findings"] if f["status"] == "proposed")
PIN = FACTS["facts"][0]["id"]

WORDS = {"core": "platform timetable seat morning", "feel": "sunday kettle blanket garden", "opposite": "loud siren circus prank",
         "adjacent": "meal kit breakfast hotel menu", "outside": "cruise lounge airship observatory"}


def doc0(edit=None):
    """A document at the pick gate, approved: the point where Explore may run. ``edit`` changes the document before the approval."""
    d = copy.deepcopy(contract.example("pick"))
    if edit:
        edit(d)
    d, refusals = gates.approve(gates.open_gate(d, "pick"), "pick", "Shrey", AT)
    assert refusals == []
    return d


def _w(dr, n, k):
    """A made-up word that exists only for this heading, route and slot: different routes share no words, so only a planted duplicate is close."""
    h = hashlib.sha1(f"{dr}{n}{k}".encode()).hexdigest()
    return "".join(chr(97 + int(c, 16) % 26) for c in h[:7])


def route_row(dr, n, cites=None, **kw):
    w = WORDS[dr].split()
    a, b, c, d = (_w(dr, n, k) for k in range(4))
    row = {"name": f"{w[0].title()} {a.title()}", "thought": f"{b} {c} {d} {a}", "why": f"{c} {d} {b}", "tension": f"{d} {a}, but {c} {b}",
           "sketch": f"{b} {a} {d}", "risk": "A client may find it odd.", "cites": [VERIFIED, "brief:audience"] if cites is None else cites}
    row.update(kw)
    return row


def heading_out(dr, n=2, off=0, **kw):
    return {"picked_up": [{"text": f"Read the {dr} brief", "cite": "brief:smp"}, {"text": "Kept a pin", "cite": PIN}],
            "turn": f"Went {dr} and came back with {n} routes.", "routes": [route_row(dr, i + 1 + off, **kw) for i in range(n)]}


def user_dir(u):
    return json.loads(u)


def distance_fn(u):
    rows = json.loads(u)["routes"]
    out = []
    for r in rows:
        d = next((v for k, v in DIRS.items() if r["name"].split()[0].lower() in WORDS[k].split()), 0.5)
        out.append({"id": r["id"], "distance": d, "reason": "x"})
    return {"routes": out}


def sort_fn(u):
    rows = json.loads(u)["territories"]
    return {"tiers": [{"id": r["id"], "tier": "stretch", "reason": "x", "group": r["id"]} for r in rows]}


def kill_fn(u):
    rows = json.loads(u)["seeds"]
    return {"verdicts": [{"id": r["id"], "keep": True, "strength": 4, "tests": {}} for r in rows]}


def both():
    """What the stand-in Review agent answers: one rewritten route (a fix) or a trail far out (an agent), whichever the prompt asks for."""
    return {"route": route_row("feel", 5), **heading_out("outside", off=20)}


def outputs(**over):
    o = {f"route_{d}": (lambda u, d=d: heading_out(d)) for d in DIRS}
    o.update(route_custom=lambda u: heading_out("outside"), distance=distance_fn, sort=sort_fn, kill=kill_fn,
             spread_repair=lambda u: both())
    o.update(over)
    return o


def run(d=None, llm=None, **kw):
    llm = llm or FakeLLM(outputs())
    d = d or doc0()
    return routes.explore(d, llm, facts=FACTS, findings=FINDINGS, **kw), llm


def plain(*texts):
    for t in texts:
        assert t and not WORDS_BAD.search(t), t


def live(d):
    return [t for t in d["territories"] if t["status"] == "live"]


def stage_calls(llm):
    out = {}
    for s in llm.calls:
        out[s] = out.get(s, 0) + 1
    return out


# ---------------------------------------------------------------- one crew, five headings, in parallel


def test_five_headings_go_out_at_once_and_each_has_a_trail():
    barrier = threading.Barrier(5, timeout=5)        # passes only if all five headings are in flight together
    def wait(dr):
        def fn(u):
            barrier.wait()
            return heading_out(dr)
        return fn
    d, llm = run(llm=FakeLLM(outputs(**{f"route_{k}": wait(k) for k in DIRS})))
    assert d["run"].get("error") is None, d["run"].get("error")
    assert [c["direction"] for c in d["crew"]] == list(DIRS)
    assert [e["crew"] for e in d["expeditions"]] == [c["id"] for c in d["crew"]]
    assert all(e["state"] == "back" and e["routes"] and e["way"] and e["turn"] for e in d["expeditions"])
    assert len(live(d)) == 10                          # two each, nothing killed, nothing repaired
    assert stage_calls(llm)["distance"] == 1 and stage_calls(llm)["kill"] == 1


def test_the_result_is_the_contracts_and_has_no_text_leaks():
    d, _ = run()
    assert contract.check(d, facts=FACTS, findings=FINDINGS) == []
    assert contract.lint(d) == []
    for kind, key in (("crew_member", "crew"), ("expedition", "expeditions"), ("territory", "territories"), ("action", "actions")):
        assert contract.validate_all(kind, d[key]) == []
    assert contract.validate_shape("spread", d["spread"]) == []
    for t in d["territories"]:
        assert contract.band_of(t["distance"]) == t["band"] and t["state"] == "found" and t["origin"]["kind"] == "crew"


def test_distance_is_measured_by_the_rating_and_sets_the_band():
    d, _ = run()
    by = {c["id"]: c["direction"] for c in d["crew"]}
    for t in d["territories"]:
        assert t["distance"] == DIRS[by[t["crew"]]]
    assert {t["band"] for t in d["territories"]} == {"core", "stretch", "far_out"}


def test_a_route_the_rating_misses_is_measured_from_the_words_not_made_up():
    d, _ = run(llm=FakeLLM(outputs(distance=lambda u: {"routes": []})))
    assert contract.check(d, facts=FACTS, findings=FINDINGS) == []
    assert all(0.1 <= t["distance"] <= 0.95 for t in d["territories"])


def test_each_heading_gets_the_others_remit_as_avoid_and_never_its_own():
    seen = {}
    def spy(dr):
        def fn(u):
            seen[dr] = json.loads(u)
            return heading_out(dr)
        return fn
    run(llm=FakeLLM(outputs(**{f"route_{k}": spy(k) for k in DIRS})))
    heads = {c["short"]: c["heading"] for c in routes.CREW}
    for k, u in seen.items():
        mine = next(c for c in routes.CREW if c["direction"] == k)
        assert mine["heading"] not in json.dumps(u["avoid"]) and len(u["avoid"]) == 4
        assert all(a["sent_to"] == heads[a["member"]] for a in u["avoid"])
        assert "angle" not in json.dumps(u)             # the planner never sees the number
        assert u["insights"] and u["brief"] and u["pins"] and u["findings"]


def test_every_heading_begins_from_its_own_picks():
    seen = {}
    def spy(dr):
        def fn(u):
            seen[dr] = json.loads(u)["start_from"]
            return heading_out(dr)
        return fn
    d, _ = run(llm=FakeLLM(outputs(**{f"route_{k}": spy(k) for k in DIRS})))
    ticked = [i["id"] for i in d["focus"]["insights"] if i["ticked"]]
    assert all(seen[k] and set(seen[k]) <= set(ticked) for k in DIRS)
    assert len({seen[k][0] for k in DIRS}) == min(5, len(ticked))          # not all five on the strongest finding
    assert [e["insights"] for e in d["expeditions"]] == [seen[k] for k in DIRS]


def test_a_heading_whose_routes_were_all_thrown_away_is_asked_once_more_and_no_more():
    calls = []
    def bad_then_good(u):
        calls.append(json.loads(u))
        return {"turn": "x", "picked_up": [], "routes": [route_row("feel", 1, cites=[])]} if len(calls) == 1 else heading_out("feel")
    d, _ = run(llm=FakeLLM(outputs(route_feel=bad_then_good)))
    assert len(calls) == 2 and "redo" in calls[1] and "cites" in calls[1]["redo"]
    assert [t for t in d["territories"] if t["crew"] == "cr_feel"]
    again = []
    run(llm=FakeLLM(outputs(route_feel=lambda u: (again.append(u), {"routes": [route_row("feel", 1, cites=[])]})[1])))
    assert len(again) == 2                                                  # asked once more, then it is a gap, not a loop


def test_a_source_marked_out_of_play_is_not_sent_and_cannot_be_cited():
    d = doc0(lambda x: next(s for s in x["focus"]["sources"] if s["id"] == PIN).update(in_play=False))
    seen = {}
    def spy(u):
        seen.update(json.loads(u))
        return heading_out("core", cites=[PIN])
    res, _ = run(d, FakeLLM(outputs(route_core=spy)))
    assert PIN not in {p["id"] for p in seen["pins"]}
    assert not [t for t in res["territories"] if t["crew"] == "cr_core"]
    assert res["expeditions"][0]["routes"] == []


# ---------------------------------------------------------------- what is kept and what is refused


def test_a_route_with_no_cite_or_a_cite_not_in_play_is_refused_with_a_reason():
    bad = heading_out("core", n=0)
    bad["routes"] = [route_row("core", 1), route_row("core", 2, cites=[]), route_row("core", 3, cites=["f_NOSUCH999"])]
    bad["routes"][0]["name"] = "Good one"
    res, llm = run(llm=FakeLLM(outputs(route_core=lambda u: bad)))
    names = [t["name"] for t in res["territories"] if t["crew"] == "cr_core"]
    assert names == ["Good one"]
    _, info = routes.explore_ex(doc0(), FakeLLM(outputs(route_core=lambda u: bad)), facts=FACTS, findings=FINDINGS)
    why = {x["reason"] for x in info["dropped"]}
    assert "a route with no cites is not shown" in why and any(w.startswith("cites an id that is not in play") for w in why)


def test_a_pick_named_in_cites_stands_for_its_sources():
    d = doc0()
    first = next(i for i in d["focus"]["insights"] if i["ticked"])
    res, _ = run(d, FakeLLM(outputs(route_core=lambda u: heading_out("core", cites=[first["id"]]))))
    core = [t for t in res["territories"] if t["crew"] == "cr_core"]
    assert core and all(t["evidence"] == first["evidence"] for t in core)


def test_a_member_whose_routes_were_all_killed_still_explored_its_bearing(monkeypatch):
    monkeypatch.setattr(routes, "CONFIG", dataclasses.replace(routes.CONFIG, min_keep=0))
    def kill(u):
        rows = json.loads(u)["seeds"]
        return {"verdicts": [{"id": r["id"], "keep": not r["line"].startswith("Loud"), "strength": 2, "tests": {}} for r in rows]}
    res, _ = run(llm=FakeLLM(outputs(kill=kill)))
    assert not [t for t in live(res) if t["crew"] == "cr_opposite"]
    assert res["spread"]["gaps"] == [] and res["actions"] == []


def test_the_words_are_plain_and_inside_the_schema_lengths():
    messy = heading_out("core", n=1)
    r = messy["routes"][0]
    r.update(name="**Bold** `title`", thought="x" * 600 + ". " + "y", why="- a bullet\n" + "w " * 400, sketch="# heading line")
    res, _ = run(llm=FakeLLM(outputs(route_core=lambda u: messy)))
    t = next(t for t in res["territories"] if t["crew"] == "cr_core")
    assert "*" not in t["name"] and "`" not in t["name"] and not t["sketch"].startswith("#")
    assert len(t["thought"]) <= 240 and len(t["why"]) <= 400
    assert contract.check(res, facts=FACTS, findings=FINDINGS) == []


def test_a_route_naming_an_internal_id_is_dropped():
    bad = heading_out("core", n=1, thought=f"Build on {VERIFIED} for the weekend.")
    res, _ = run(llm=FakeLLM(outputs(route_core=lambda u: bad)))
    assert not [t for t in res["territories"] if t["crew"] == "cr_core"]


def test_at_most_three_routes_from_a_heading_and_sixteen_live_in_all():
    many = {"turn": "Lots.", "picked_up": [], "routes": [route_row("core", i) for i in range(1, 7)]}
    res, _ = run(llm=FakeLLM(outputs(route_core=lambda u: many)))
    assert len([t for t in res["territories"] if t["crew"] == "cr_core"]) == 3
    assert len(res["expeditions"][0]["routes"]) <= contract.limit("expedition", "routes")
    assert len(live(res)) <= routes.CONFIG.max_routes <= contract.limit("territories")


def test_a_route_resting_on_an_unchecked_finding_says_so_in_words():
    res, _ = run(llm=FakeLLM(outputs(route_core=lambda u: heading_out("core", cites=[PROPOSED]))))
    core = [t for t in res["territories"] if t["crew"] == "cr_core"]
    assert core and all(routes.UNCHECKED in t["risks"] for t in core)
    others = [t for t in res["territories"] if t["crew"] == "cr_feel"]
    assert all(routes.UNCHECKED not in t["risks"] for t in others)
    assert gates._findings_derived(FINDINGS) >= {PROPOSED}


def test_the_kill_check_sees_each_routes_heading():
    seen = {}
    def kill(u):
        seen.update(json.loads(u))
        return kill_fn(u)
    run(llm=FakeLLM(outputs(kill=kill)))
    heads = {c["heading"] for c in routes.CREW}
    assert seen["seeds"] and all(s["heading"] in heads for s in seen["seeds"]) and seen["tensions"] and seen["assumed_brief"]["fields"]


def test_the_kill_check_marks_a_route_killed_with_its_reason_and_keeps_enough(monkeypatch):
    monkeypatch.setattr(routes, "CONFIG", dataclasses.replace(routes.CONFIG, min_keep=6))
    def kill(u):
        rows = json.loads(u)["seeds"]
        return {"verdicts": [{"id": r["id"], "keep": r["line"].startswith("Platform"), "strength": 2 if not r["line"].startswith("Platform") else 4,
                              "tests": {"generic": {"fails": True, "reason": "any brand could say it"}}} for r in rows]}
    res, _ = run(llm=FakeLLM(outputs(kill=kill)))
    killed = [t for t in res["territories"] if t["status"] == "killed"]
    assert killed and all(t["kill_reason"] and "same for any brand" in t["kill_reason"] for t in killed)
    assert len(live(res)) >= routes.CONFIG.min_keep
    assert any(routes.RESTORED in t["risks"] for t in live(res))
    assert contract.check(res, facts=FACTS, findings=FINDINGS) == []


# ---------------------------------------------------------------- the spread check and the Review agent


def _dupe_outputs(**over):
    """A planted near-duplicate (feel copies core's first route) and nothing far out (no band for far_out)."""
    core = heading_out("core")
    feel = heading_out("feel")
    feel["routes"][0].update({k: core["routes"][0][k] for k in ("name", "thought", "sketch")})
    feel["routes"][0]["name"] = "Platform Timetable 1 again"
    return outputs(route_core=lambda u: core, route_feel=lambda u: feel, route_outside=lambda u: heading_out("adjacent", off=10), **over)


def test_the_spread_check_flags_a_planted_near_duplicate_and_an_unexplored_band():
    llm = FakeLLM(_dupe_outputs(spread_repair=lambda u: both()))
    d, info = routes.explore_ex(doc0(), llm, facts=FACTS, findings=FINDINGS)
    assert d["run"].get("error") is None, d["run"]
    kinds = {a["kind"] for a in d["actions"]}
    assert kinds == {"spread_fix", "sent_agent"}
    assert all(a["agent"] == "review" and a["undone"] is False for a in d["actions"])
    fix = next(a for a in d["actions"] if a["kind"] == "spread_fix")
    old, new, other = fix["territory_ids"]
    t = {x["id"]: x for x in d["territories"]}
    assert t[old]["status"] == "parked" and t[new]["status"] == "live" and t[new]["origin"] == {"kind": "further", "from": [old]}
    agent = next(a for a in d["actions"] if a["kind"] == "sent_agent")
    assert all(t[i]["crew"] not in {c["id"] for c in routes.CREW} for i in agent["territory_ids"])
    assert len(d["crew"]) == 6 and d["crew"][-1]["direction"] == "custom"
    assert stage_calls(llm)["spread_repair"] == 2        # a fix and the agent: never more than the cap
    assert contract.check(d, facts=FACTS, findings=FINDINGS) == []


def test_pair_fixes_do_not_use_up_the_budget_for_sending_an_agent_into_a_gap():
    # three close pairs (only two are fixed) and nothing far out: the agent still goes
    same = lambda dr: heading_out(dr)
    dup = lambda u: {**heading_out("feel", n=2), "routes": [dict(route_row("feel", 1), name="Platform Dup One"), dict(route_row("feel", 1), name="Platform Dup Two")]}
    llm = FakeLLM(_dupe_outputs(route_opposite=dup, route_adjacent=dup))
    d, _ = routes.explore_ex(doc0(), llm, facts=FACTS, findings=FINDINGS)
    kinds = [a["kind"] for a in d["actions"]]
    assert kinds.count("spread_fix") <= routes.CONFIG.max_pair_fixes and kinds.count("sent_agent") == routes.CONFIG.max_gap_agents
    assert contract.check(d, facts=FACTS, findings=FINDINGS) == []
    assert contract.validate_shape("spread", d["spread"]) == []


def test_a_clean_spread_makes_no_repair_calls():
    d, llm = run()
    assert "spread_repair" not in stage_calls(llm) and d["actions"] == [] and d["spread"]["close"] == []
    assert d["spread"]["gaps"] == []


def test_a_routes_idea_group_is_its_theme_and_an_id_or_a_missing_group_is_never_one():
    def grouped(u):
        rows = json.loads(u)["territories"]
        return {"tiers": [{"id": r["id"], "tier": "stretch", "reason": "x", "group": ("the journey as the treat" if i % 2 else r["id"])} for i, r in enumerate(rows)]}
    d, _ = run(llm=FakeLLM(outputs(sort=grouped)))
    themes = [t.get("theme") for t in d["territories"]]
    assert "the journey as the treat" in themes and None in themes
    assert all(t is None or (0 < len(t) <= contract.limit("territory", "theme", what="maxLength") and not insights._ID_IN_TEXT.search(t)) for t in themes)
    assert contract.check(d, facts=FACTS, findings=FINDINGS) == []
    again = routes.themed(d["territories"], {t["id"]: "something else" for t in d["territories"]})
    assert [t.get("theme") for t in again] == [t.get("theme") or "something else" for t in d["territories"]], "a theme a route has is kept"


def test_undo_takes_a_fix_back_and_an_agent_away_and_only_once():
    llm = FakeLLM(_dupe_outputs(spread_repair=lambda u: both()))
    d, _ = routes.explore_ex(doc0(), llm, facts=FACTS, findings=FINDINGS)
    fix = next(a for a in d["actions"] if a["kind"] == "spread_fix")
    d2, r = routes.undo(d, fix["id"], "Shrey")
    assert r == []
    t = {x["id"]: x for x in d2["territories"]}
    assert t[fix["territory_ids"][0]]["status"] == "live" and fix["territory_ids"][1] not in t
    assert next(a for a in d2["actions"] if a["id"] == fix["id"])["undone"] is True
    assert routes.undo(d2, fix["id"], "Shrey")[1] and routes.undo(d2, fix["id"], "")[1]
    agent = next(a for a in d2["actions"] if a["kind"] == "sent_agent")
    d3, r = routes.undo(d2, agent["id"], "Shrey")
    assert r == [] and len(d3["crew"]) == 5 and len(d3["expeditions"]) == 5
    assert not [x for x in d3["territories"] if x["id"] in agent["territory_ids"]]
    assert contract.check(d3, facts=FACTS, findings=FINDINGS) == []
    plain(*routes.undo(d, "act_nosuch", "Shrey")[1], *routes.undo(d2, fix["id"], "Shrey")[1])


def test_the_explore_back_fixture_undoes_for_real():
    """The page's Undo asks for exactly this: the committed fixture must round-trip through routes.undo and stay a valid document."""
    d = contract.example("states/explore_back")
    fix = next(a for a in d["actions"] if a["kind"] == "spread_fix")
    d2, r = routes.undo(d, fix["id"], "Shrey")
    assert r == [] and {t["id"]: t for t in d2["territories"]}[fix["territory_ids"][0]]["status"] == "live"
    assert fix["territory_ids"][1] not in {t["id"] for t in d2["territories"]}
    agent = next(a for a in d2["actions"] if a["kind"] == "sent_agent")
    d3, r = routes.undo(d2, agent["id"], "Shrey")
    assert r == [] and len(d3["crew"]) == 4
    contract.validate(d3)


# ---------------------------------------------------------------- steering


def explored(spend=None):
    s = spend or sp.Spend(cap_usd=5, doc="t")
    llm = FakeLLM(outputs())
    d = routes.explore(doc0(), s.wrap(llm), facts=FACTS, findings=FINDINGS)
    return d, s, llm


def test_a_steer_re_runs_only_that_heading_and_pays_for_nothing_else():
    d, s, llm = explored()
    llm.calls.clear()
    others = {t["id"]: t for t in d["territories"] if t["crew"] != "cr_feel"}
    new = {"turn": "Went further.", "picked_up": [], "routes": [route_row("outside", 7)]}
    llm.outputs["route_feel"] = lambda u: new
    d2, r = routes.steer(d, s.wrap(llm), "cr_feel", "further", "Shrey", at=AT, facts=FACTS, findings=FINDINGS)
    assert r == []
    assert [c for c in llm.calls if c.startswith("route_")] == ["route_feel"]
    after = {t["id"]: t for t in d2["territories"] if t["crew"] != "cr_feel"}
    assert after == others                                          # nobody else's trail changed
    feel = [t for t in d2["territories"] if t["crew"] == "cr_feel"]
    assert [t["origin"]["kind"] for t in feel] == ["further"] and feel[0]["name"].startswith("Cruise")
    e = next(e for e in d2["expeditions"] if e["crew"] == "cr_feel")
    assert e["steer"] == [{"kind": "further", "by": "Shrey", "at": AT}] and e["turn"] == "Went further."
    assert [r["territory_id"] for r in e["routes"]] == [feel[0]["id"]]
    assert contract.check(d2, facts=FACTS, findings=FINDINGS) == []
    assert routes.steer_decision("cr_feel", e["steer"][0])["by"] == "Shrey"


def test_a_steer_message_carries_the_instruction_and_the_earlier_routes():
    d, s, llm = explored()
    seen = {}
    def spy(u):
        seen.update(json.loads(u))
        return heading_out("feel")
    llm.outputs["route_feel"] = spy
    routes.steer(d, s.wrap(llm), "cr_feel", "pull", "Shrey", facts=FACTS, findings=FINDINGS)
    assert seen["steer"]["kind"] == "pull" and len(seen["steer"]["earlier"]) == 2
    assert all(a.get("brought_back") for a in seen["avoid"])        # now the landing points of the others are known


def test_cross_needs_another_member_and_records_both_in_the_origin():
    d, s, llm = explored()
    assert routes.steer(d, s.wrap(llm), "cr_feel", "cross", "Shrey")[1]
    d2, r = routes.steer(d, s.wrap(llm), "cr_feel", "cross", "Shrey", with_="cr_core", facts=FACTS, findings=FINDINGS)
    assert r == []
    feel = [t for t in d2["territories"] if t["crew"] == "cr_feel" and t["origin"]["kind"] == "cross"]
    assert feel and feel[0]["origin"]["from"] == ["cr_feel", "cr_core"]
    assert next(e for e in d2["expeditions"] if e["crew"] == "cr_feel")["steer"][0]["with"] == "cr_core"


def test_stop_makes_no_call_and_a_steer_needs_a_named_person():
    d, s, llm = explored()
    llm.calls.clear()
    d2, r = routes.steer(d, s.wrap(llm), "cr_core", "stop", "Shrey", at=AT)
    assert r == [] and llm.calls == []
    assert next(e for e in d2["expeditions"] if e["crew"] == "cr_core")["state"] == "stopped"
    for who in ("", "engine"):
        assert routes.steer(d, s.wrap(llm), "cr_core", "further", who)[1]
    assert routes.steer(d, s.wrap(llm), "cr_nosuch", "stop", "Shrey")[1] and routes.steer(d, s.wrap(llm), "cr_core", "sideways", "Shrey")[1]
    plain(*routes.steer(d, s.wrap(llm), "cr_nosuch", "stop", "Shrey")[1])


def test_a_steer_that_fails_changes_nothing_and_says_why():
    d, s, llm = explored()
    def boom(u):
        raise RuntimeError("Traceback: model down")
    llm.outputs["route_feel"] = boom
    d2, r = routes.steer(d, s.wrap(llm), "cr_feel", "further", "Shrey", facts=FACTS, findings=FINDINGS)
    assert d2 == d and r and "Nothing was changed" in r[0]
    plain(*r)


def test_a_steer_does_not_fix_a_pair_a_person_took_back():
    llm = FakeLLM(_dupe_outputs(spread_repair=lambda u: both()))
    s = sp.Spend(cap_usd=5)
    d = routes.explore(doc0(), s.wrap(llm), facts=FACTS, findings=FINDINGS)
    fix = next(a for a in d["actions"] if a["kind"] == "spread_fix")
    d, _ = routes.undo(d, fix["id"], "Shrey")
    llm.calls.clear()
    llm.outputs["route_feel"] = lambda u: _dupe_outputs()["route_feel"](u)      # the same near-duplicate comes back
    routes.steer(d, s.wrap(llm), "cr_feel", "further", "Shrey", facts=FACTS, findings=FINDINGS)
    assert "spread_repair" not in llm.calls


# ---------------------------------------------------------------- live mode: gates, spend, failures in words (LESSONS 11, 13)


def test_explore_starts_only_when_the_pick_gate_is_approved():
    d = gates.open_gate(copy.deepcopy(contract.example("pick")), "pick")
    llm = FakeLLM(outputs())
    with pytest.raises(routes.NotReady) as e:
        routes.explore(d, llm, facts=FACTS, findings=FINDINGS)
    plain(str(e.value))
    held = gates.drive(d, {"explore": routes.stage(llm, facts=FACTS, findings=FINDINGS)}, findings=FINDINGS)
    assert llm.calls == [] and held["run"]["state"] == "gate"
    approved, _ = gates.approve(d, "pick", "Shrey", AT)
    out = gates.drive(approved, {"explore": routes.stage(llm, facts=FACTS, findings=FINDINGS), "develop": lambda doc: doc}, findings=FINDINGS)
    assert stage_calls(llm).get("route_core") == 1 and out["expeditions"] and out["territories"]


def test_a_changed_pick_voids_the_approval_and_explore_will_not_run():
    d = doc0()
    first = next(i for i in d["focus"]["insights"] if i["ticked"])
    first["ticked"] = False
    llm = FakeLLM(outputs())
    with pytest.raises(routes.NotReady):
        routes.explore(d, llm, facts=FACTS, findings=FINDINGS)
    assert llm.calls == []


def test_a_resumed_explore_pays_nothing_again(tmp_path):
    store = tmp_path / "spend.json"
    s1 = sp.Spend(cap_usd=5, store=store)
    llm = FakeLLM(outputs())
    d1 = routes.explore(doc0(), s1.wrap(llm), facts=FACTS, findings=FINDINGS)
    n, paid = len(llm.calls), s1.total()
    s2 = sp.Spend(cap_usd=5, store=store)                       # a new process reads what was paid for
    d2 = routes.explore(doc0(), s2.wrap(llm), facts=FACTS, findings=FINDINGS)
    assert len(llm.calls) == n and s2.total() == paid and d1["territories"] == d2["territories"]


def test_one_trail_that_fails_is_retried_alone_and_the_others_never_repay():
    s = sp.Spend(cap_usd=5)
    llm = FakeLLM(outputs())
    state = {"fail": True}
    def flaky(u):
        if state["fail"]:
            raise RuntimeError("Traceback: boom")
        return heading_out("opposite")
    llm.outputs["route_opposite"] = flaky
    d = gates.drive(doc0(), {"explore": routes.stage(s.wrap(llm), facts=FACTS, findings=FINDINGS)}, findings=FINDINGS)
    assert d["run"]["state"] == "failed" and d["run"]["error"]["stage"] == "explore" and d["run"]["error"]["retryable"]
    plain(d["run"]["error"]["message"])
    assert "The Opposite pole" in d["run"]["error"]["message"] or "opposite pole" in d["run"]["error"]["message"].lower()
    assert contract.validate(d) is None
    paid_before = {k: v for k, v in stage_calls(llm).items() if k.startswith("route_") and k != "route_opposite"}
    state["fail"] = False
    d = gates.request(d, "pick", "retry", AT) if False else d
    d["run"]["gate_requests"] = [{"gate": "pick", "kind": "retry", "at": AT, "status": "waiting"}]
    d = gates.drive(d, {"explore": routes.stage(s.wrap(llm), facts=FACTS, findings=FINDINGS), "develop": lambda doc: doc}, findings=FINDINGS)
    after = stage_calls(llm)
    assert {k: after[k] for k in paid_before} == paid_before          # the four that finished were not asked again
    assert d["expeditions"] and not d["run"].get("error")


def test_a_cap_stops_the_crew_in_plain_words_without_a_price():
    s = sp.Spend(cap_usd=0.0001)
    d = gates.drive(doc0(), {"explore": routes.stage(s.wrap(FakeLLM(outputs())), facts=FACTS, findings=FINDINGS)}, findings=FINDINGS)
    assert d["run"]["state"] == "failed" and "limit" in d["run"]["error"]["message"]
    assert not re.search(r"[$€£]\s?\d|USD", d["run"]["error"]["message"])
    contract.validate(d)


def test_five_concurrent_headings_leave_one_honest_ledger():
    s = sp.Spend(cap_usd=5)
    llm = FakeLLM(outputs())
    routes.explore(doc0(), s.wrap(llm), facts=FACTS, findings=FINDINGS)
    assert len(s.lines) == len(llm.calls) and len({l["key"] for l in s.lines}) == len(s.lines)
    assert sorted(l["stage"] for l in s.lines).count("route_core") == 1


def test_nothing_picked_or_nothing_back_ends_in_words():
    d = doc0()
    res = routes.explore(d, FakeLLM(outputs(**{f"route_{k}": (lambda u: {"turn": "Nothing.", "routes": []}) for k in DIRS})), facts=FACTS, findings=FINDINGS)
    assert res["run"]["state"] == "failed"
    plain(res["run"]["error"]["message"])
    contract.validate(res)


def test_the_run_counts_its_model_calls_and_prices_stay_out_of_the_document():
    d, llm = run()
    assert d["run"]["calls"]["model"] >= len(llm.calls) > 0
    assert contract.lint(d) == []
    assert "usd" not in json.dumps(d).lower()


# ---------------------------------------------------------------- Confidential parts never reach a model or a route


def test_a_marked_part_is_never_sent_and_a_route_that_repeats_it_is_dropped():
    secret = "the client is considering a merger in spring"
    def mark(x):
        brief = next(v for v in x["upstream"].values() if isinstance(v, dict) and "background" in v)
        brief["background"] = f"Linea runs weekend trains. Confidential: {secret}. More text."
    d = doc0(mark)
    sent = []
    def spy(dr):
        def fn(u):
            sent.append(u)
            return heading_out(dr, thought=f"Say {secret} out loud.") if dr == "core" else heading_out(dr)
        return fn
    outs = outputs(**{f"route_{k}": spy(k) for k in DIRS})
    spent = []
    def keep(stage):
        inner = outs[stage]
        return lambda u: (spent.append(u), inner(u))[1]
    outs.update({k: keep(k) for k in ("distance", "kill", "sort")})
    res = routes.explore(d, FakeLLM(outs), facts=FACTS, findings=FINDINGS, marks=[{"path": "background", "text": secret, "kind": "span"}])
    assert sent and not any(secret in u for u in sent + spent)
    assert not [t for t in res["territories"] if t["crew"] == "cr_core"]
    assert secret not in json.dumps([res["territories"], res["expeditions"]])


def test_short_marks_are_ignored_so_a_word_does_not_empty_the_brief():
    assert routes._marks([{"text": "Linea"}, "x", {"text": "a perfectly long confidential clause"}]) == ["a perfectly long confidential clause"]


# ---------------------------------------------------------------- the measure's own parts


def test_band_edges_and_arcs():
    for dist, band in ((0.0, "core"), (0.34, "core"), (0.35, "stretch"), (0.64, "stretch"), (0.65, "far_out"), (1.0, "far_out")):
        assert contract.band_of(dist) == band
    assert routes._gap_arc([0, 90, 180, 270])[0] == 90
    w, mid = routes._gap_arc([350, 10])
    assert round(w) == 340 and round(mid) == 180


def test_pair_distance_is_zero_for_one_idea_and_large_for_different_ones():
    a = {"id": "t_a", "name": "Platform four", "thought": "The weekend starts on the platform", "sketch": "A woman checks the board"}
    b = {"id": "t_b", "name": "Cruise lounge", "thought": "A lounge above the clouds", "sketch": "An airship drifts by"}
    assert routes.pair_distance(a, b, {}) == 1.0
    assert routes.pair_distance(a, b, {"t_a": "g", "t_b": "g"}) == 0.0
    assert routes.pair_distance(a, dict(a, id="t_c"), {}) == 0.0


# ---------------------------------------------------------------- the baseline arm still works against the crew


def test_the_blind_pack_takes_the_crew_and_the_plain_prompt():
    d, _ = run()
    cards = routes.cards(d, 3)
    assert len({c["crew"] for c in cards}) == 3                       # shown by spread, not by one heading
    plain_prompt = FakeLLM({"baseline": {"territories": [{"id": f"b{i}", "name": f"Plain {i}", "thought": "A thought", "why": "A reason",
                                                          "proposition": "One sentence.", "tension": "X, but Y."} for i in range(3)]}})
    base = compare.baseline({"fields": {}, "prompt": "p", "category": "rail", "market": "ie"}, plain_prompt)
    pack, key = compare.blind_pack(cards, base, seed=compare.pack_seed("t"))
    assert sorted(key.values()) == ["pipeline", "plain_prompt"] and all(len(v) == 3 for v in pack.values())
    assert "tier" not in json.dumps(pack) and "crew" not in json.dumps(pack)


def test_the_estimate_names_every_stage_the_crew_calls():
    from territory.llm import STAGE_MODEL
    for stage in [f"route_{d}" for d in ("core", "feel", "opposite", "adjacent", "outside", "yours", "custom")] + ["distance", "spread_repair", "kill", "sort"]:
        assert stage in STAGE_MODEL
        assert sp.estimate_call(stage) > 0
