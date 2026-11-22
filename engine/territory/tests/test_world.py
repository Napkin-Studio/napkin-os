"""territories-engine-develop: every kept route developed into a world, tested against the brief, ranked blind.
Run from engine/: ``PYTHONPATH=. python -m pytest -q territory/tests/test_world.py`` (needs jsonschema). No real model is called: a stand-in model
writes each route's world (the fixture's own world, the expected output of the writer), and the live-mode tests send it through ``Spend.wrap`` and
``gates.drive`` exactly as the middleware handler does."""
from __future__ import annotations

import copy
import json
import re

import pytest

pytest.importorskip("jsonschema")

from territory import contract, gates, ladder, routes, world  # noqa: E402
from territory import spend as sp  # noqa: E402
from territory.llm import STAGE_MODEL, FakeLLM  # noqa: E402

FACTS, FINDINGS = contract.example("facts"), contract.example("findings")
AT = "2026-11-23T10:00:00Z"
FIX = contract.example("data")
WORLDS = {t["name"]: copy.deepcopy(t["world"]) for t in FIX["territories"] if t.get("world")}
for _n, _w in WORLDS.items():             # the fixture's own worlds hold two to four lines; a writer is asked for six or more, so these are made six
    _w["lines"] = [*_w["lines"], *[f"Another line to say it, number {i}" for i in range(6 - len(_w["lines"]))]]
TIERS = {t["name"]: t["tier"] for t in FIX["territories"]}
WORDS_BAD = re.compile(r"(blocked_by|derived_resolution|rests_on|_id\b|None\b|null\b|\bfield\b|Traceback|Error\(|\bf_[0-9A-Z]{6,}|\bfi_[0-9A-Z]{6,}|\bbrief:)")


def doc0(edit=None):
    """A document at the point Develop runs: the fixture's routes as thoughts (nothing developed), the pick approved, Explore done."""
    d = copy.deepcopy(FIX)
    for t in d["territories"]:
        if t["state"] == "developed":
            for k in ("world", "checks", "marks", "pictures", "blind", "rank"):
                t.pop(k, None)
            t["state"] = "found"
    pick = contract.example("pick")
    d["greenlit"], d["sends"], d["asks"] = [], [], []
    d["run"] = copy.deepcopy(pick["run"])
    d.pop("review", None)
    d.pop("journey", None)
    if edit:
        edit(d)
    d, refusals = gates.approve(gates.open_gate(d, "pick"), "pick", "Shrey", AT)
    assert refusals == []
    d["run"]["state"] = "building"
    return d


def world_for(name: str) -> dict:
    """The fixture's world for a route, or (the two routes the fixture leaves as thoughts) another route's world under a different name."""
    if name in WORLDS:
        return copy.deepcopy(WORLDS[name])
    return copy.deepcopy(list(WORLDS.values())[sum(map(ord, name)) % len(WORLDS)])


def _handles(user: str) -> dict:
    return {r["id"]: r for r in json.loads(user)["routes"]}


def w_out(user, bad=None):
    """The writer's answer to one batch: the fixture world of each route, keyed by the handle it was sent."""
    out = []
    for h, r in _handles(user).items():
        w = world_for(r["name"])
        w["id"], w["mood"] = h, "A world with a feeling."
        out.append((bad or (lambda h, w: w))(h, w))
    return {"worlds": out}


def c_out(user, status="ok"):
    return {"checks": [{"id": h, "proposition": {"status": status, "text": "It lands on the proposition."},
                        "mandatory": {"status": status, "text": "It keeps the fare and never turns on the car."},
                        "rival": {"status": status, "text": "Rivals could not say this."}} for h in _handles(user)]}


def j_out(user):
    """Scores spread by letter; the ranking is by total, then letter."""
    rows = json.loads(user)["routes"]
    scores = [{"id": r["id"], **{d: 1 + (i + k) % 5 for k, d in enumerate(ladder.SCORE_DIMS)}} for i, r in enumerate(rows)]
    ranked = sorted(scores, key=lambda s: -sum(s[d] for d in ladder.SCORE_DIMS))
    return {"scores": scores, "ranking": [s["id"] for s in ranked]}


def fake(**over):
    outs = {"world": w_out, "world_checks": c_out, "judge": j_out, "world_more": lambda u: {"lines": ["Brand new line one.", "Brand new line two."]}}
    outs.update(over)
    return FakeLLM(outs)


def develop(d=None, llm=None, **kw):
    llm = llm or fake()
    return world.develop_ex(d or doc0(), llm, facts=FACTS, findings=FINDINGS, **kw), llm


def live_found(d):
    return [t for t in d["territories"] if t["status"] == "live" and t["state"] == "found"]


# ---------------------------------------------------------------- one world: words, limits, leaks


class _Ctx:
    marks: list = []


def shape(raw, ctx=None, rules=None):
    return world.shape_world(raw, ctx or _Ctx(), rules)


def raw(name="Already Started", **edit):
    w = copy.deepcopy(WORLDS[name])
    w.update(edit)
    return w


def test_every_fixture_world_is_accepted_as_written():
    for name, w in WORLDS.items():
        got, _, repairs = shape(raw(name))
        assert got["headlines"] == w["headlines"] and set(got["lines"]) == set(w["lines"]) - set(w["headlines"].values()), name
        assert contract.validate_shape("world", got) == [], name


def test_contrast_is_made_in_code_and_the_ink_keeps_its_hue():
    p = {"bg": "#F4B942", "ink": "#E3962B", "acc": "#FFF6E0", "soft": "#E3962B"}      # the demo's own soft on its bg: too faint
    got, _, repairs = shape(raw(palette=p))
    assert contract.contrast(got["palette"]["ink"], got["palette"]["bg"]) >= 4.5
    assert got["palette"]["ink"] != p["ink"] and any("text colour" in r for r in repairs)
    # a colour that already reads is not touched; short and lowercase hex is normalised
    got2, _, rep2 = shape(raw(palette={"bg": "#fff", "ink": "#111", "acc": "#f00", "soft": "#eee"}))
    assert got2["palette"] == {"bg": "#FFFFFF", "ink": "#111111", "acc": "#FF0000", "soft": "#EEEEEE"} and not rep2
    for bg in ("#777777", "#767676", "#808080", "#00FF00", "#FF00FF"):                 # any background can be made readable
        ink, _ = world.readable_ink("#888888", bg)
        assert contract.contrast(ink, bg) >= 4.5, bg
    with pytest.raises(world.Refused, match="hex"):
        shape(raw(palette={**p, "bg": "orange"}))


def test_font_is_held_to_the_cleared_list():
    for font, weight in (("Fraunces", 600), ("Archivo Black", 800), ("DM Serif Display", 400), ("Caveat", 700)):
        got, _, rep = shape(raw(type={"font": font, "weight": weight, "italic": True}))
        assert got["type"]["font"] in ("newsreader", "geist_extra_bold") and any("cleared" in r for r in rep), font
    assert shape(raw(type={"font": "geist_extra_bold", "weight": 400, "italic": True}))[0]["type"] == {"font": "geist_extra_bold", "weight": 800, "italic": False}


def test_length_limits_are_enforced_not_hoped_for():
    w = WORLDS["Already Started"]
    long_line = " ".join(["word"] * (world.CONFIG.w_line + 1))
    got, _, rep = shape(raw(lines=[long_line, *w["lines"]]))
    assert long_line not in got["lines"] and any("over the limit" in r for r in rep)
    with pytest.raises(world.Refused, match="words, over the limit"):
        shape(raw(headlines={**w["headlines"], "wq": " ".join(["word"] * (world.CONFIG.w_headline + 1))}))
    many = [f"A different line number {chr(97 + i)} here" for i in range(20)]
    assert len(shape(raw(lines=many))[0]["lines"]) == world.CONFIG.max_lines <= contract.limit("world", "lines")
    with pytest.raises(world.Refused, match="at least"):
        shape(raw(lines=["Only one."]))
    # a descriptive field is cut at a word end, never mid-word
    got, _, _ = shape(raw(social="POV: " + " ".join(["wander"] * 60)))
    assert len(got["social"].split()) <= world.CONFIG.w_social and not got["social"].endswith("wand")
    assert len(shape(raw(refs=[f"A reference number {i}" for i in range(12)]))[0]["refs"]) <= 6


@pytest.mark.parametrize("bad", ["Weekend (to confirm)", "Seat TBC", "the rests_on field", "see brief:smp", "Cite f_TIRED0418 here",
                                 "A [bracketed] note", "It is {{name}}", "SUPER", "   ", "This is derived by the agent"])
def test_text_that_is_not_for_people_never_reaches_a_world(bad):
    w = WORLDS["Already Started"]
    tv = copy.deepcopy(w["tv"])
    tv[0]["text"] = bad
    got, _, rep = shape(raw(tv=tv))                  # a TV frame that leaks is dropped, the world stands on the rest
    assert all(bad not in f["text"] for f in got["tv"])
    with pytest.raises(world.Refused):                # a headline that leaks refuses the world
        shape(raw(headlines={**w["headlines"], "sq": bad}))
    got, _, _ = shape(raw(lines=[bad, *w["lines"]]))
    assert bad not in got["lines"]
    assert contract.lint({"x": world.spoken(got)}) == []


def test_markdown_marks_are_stripped_not_shipped():
    got, _, _ = shape(raw(lines=["**Out-of-office:** on.", *WORLDS["Already Started"]["lines"][1:]]))
    assert got["lines"][0] == "Out-of-office: on."


def test_a_part_marked_confidential_never_reaches_a_world():
    class C:
        marks = ["the secret launch date of the thing"]
    w = WORLDS["Already Started"]
    got, _, _ = shape(raw(lines=["Mark the secret launch date of the thing now.", *w["lines"]]), C)
    assert all("secret launch date" not in x for x in got["lines"])
    with pytest.raises(world.Refused, match="Confidential"):
        shape(raw(social="It is the secret launch date of the thing."), C)


def test_scenes_voices_and_frames_come_from_the_lists():
    w = WORLDS["Already Started"]
    with pytest.raises(world.Refused, match="scene"):
        shape(raw(scenes={**w["scenes"], "story": "volcano"}))
    got, _, rep = shape(raw(radio=[{"voice": "narrator voice", "text": "Nope."}, *w["radio"]]))
    assert all(r["voice"].isupper() for r in got["radio"]) and any("voice" in r for r in rep)
    with pytest.raises(world.Refused, match="TV frames"):
        shape(raw(tv=[{"scene": "volcano", "text": "Lava."}, w["tv"][0]]))


def test_figures_the_words_state_must_be_in_the_inputs():
    w = shape(raw())[0]
    assert world.figures_in(w, "Weekend returns from 29 euro. Fare 29.") == []
    assert world.figures_in(w, "No numbers here") == ["29 euro"]
    w2 = copy.deepcopy(w)
    w2["social"] = "Now 40% off, only €15."
    assert world.figures_in(w2, "29") == ["40%", "€15"]


# ---------------------------------------------------------------- develop: the stage


def test_develop_makes_a_world_for_every_kept_route_in_one_call_per_batch():
    (d, info), llm = develop()
    kept = [t for t in doc0()["territories"] if t["status"] == "live"]
    out = [t for t in d["territories"] if t["status"] == "live"]
    assert len(out) == len(kept) and all(t["state"] == "developed" for t in out), info
    assert [t for t in d["territories"] if t["status"] == "killed" and t["state"] == "developed"] == []       # a killed route is not developed
    n = -(-len(kept) // world.CONFIG.batch)
    assert llm.calls.count("world") == n and llm.calls.count("world_checks") == 1 and llm.calls.count("judge") == 1 and len(llm.calls) == n + 2
    assert info["calls"] == n + 2 and d["run"]["calls"]["model"] >= n + 2 and not d["run"].get("error")
    assert contract.check(d, facts=FACTS, findings=FINDINGS) == []
    assert d["journey"] == world.JOURNEY and contract.validate_all("journey", d["journey"]) == []


def test_every_world_has_the_whole_contract_shape_and_legible_ink():
    (d, _), _ = develop()
    for t in (t for t in d["territories"] if t["state"] == "developed"):
        w = t["world"]
        assert contract.validate_shape("territory", t) == [], t["name"]
        assert contract.contrast(w["palette"]["ink"], w["palette"]["bg"]) >= 4.5
        assert len(w["lines"]) <= 16 and 4 <= len(t["pictures"]) <= 12
        assert {p["touchpoint"] for p in t["pictures"]} == {"tv", "story", "poster", "seat", "email"}
        assert all(p["scene"] == w["scenes"][p["touchpoint"]] for p in t["pictures"] if p["touchpoint"] != "tv")
        assert [c["kind"] for c in t["checks"]][:5] == ["proposition", "mandatory", "evidence", "rival", "contrast"] and t["checks"][-1]["kind"] == "judge"
        assert all(not WORDS_BAD.search(c["text"]) for c in t["checks"]) and len(t["checks"]) <= 8
        assert set(t["marks"]) == {"fit", "ownable", "risk"} and all(1 <= v <= 5 for v in t["marks"].values())
        assert t["references"] == w["refs"]
    assert contract.lint(d) == []


def test_the_blind_rank_is_stored_with_its_score_and_nothing_else_is_shown():
    (d, _), _ = develop()
    dev = [t for t in d["territories"] if t["state"] == "developed"]
    assert sorted(t["rank"] for t in dev) == list(range(1, len(dev) + 1))
    for t in dev:
        assert t["blind"]["of"] == 35 and t["blind"]["advisory"] is True and t["blind"]["total"] == ladder.total(t["blind"]["by_dimension"])
        assert t["tier"] in ladder.TIERS                                      # the judged tier is kept
        j = next(c for c in t["checks"] if c["kind"] == "judge")
        assert f"number {t['rank']} of {len(dev)}" in j["text"] and "35" not in j["text"] and str(t["blind"]["total"]) not in j["text"]
        assert world.show(t) == {"rank": t["rank"]}


def test_the_judge_is_blind_and_on_another_model():
    (d, _), llm = develop()
    seen = []
    llm2 = fake(judge=lambda u: (seen.append(u), j_out(u))[1])
    d2, _ = world.develop_ex(doc0(), llm2, facts=FACTS, findings=FINDINGS)
    user = seen[0]
    base = doc0()
    for t in base["territories"]:
        for secret in (t["name"], t["id"], t["crew"], f'"{t["band"]}"', f'"{t["tier"]}"'):
            assert secret not in user, secret
    for c in base["crew"]:
        assert c["name"] not in user and c["id"] not in user and c["heading"] not in user
    assert not re.search(r"\b(t_[a-z0-9]{3,}|cr_[a-z]+|ex_[a-z0-9]+|distance|band|tier|origin|crew)\b", user)
    rows = json.loads(user)["routes"]
    assert any(r["evidence"] for r in rows) and all(not WORDS_BAD.search(" ".join(r["evidence"])) for r in rows)        # the evidence is words, never ids
    letters = [r["id"] for r in json.loads(user)["routes"]]
    assert letters == [world._letter(i) for i in range(len(letters))]
    assert STAGE_MODEL["judge"] != STAGE_MODEL["world"] and STAGE_MODEL["world_checks"] != STAGE_MODEL["world"]
    order = [r["thought"] for r in json.loads(user)["routes"]]
    assert order != sorted(order, key=lambda x: [t["thought"] for t in base["territories"]].index(x)) or len(order) < 3      # the shuffle tells nothing


def test_a_judge_that_leaves_a_dimension_empty_is_asked_once_more_and_never_completed_from_guesses():
    seen = []

    def j_null(user):
        o = j_out(user)
        seen.append("redo" in json.loads(user))
        if not seen[-1]:
            o["scores"][1]["truth"] = None
            o["scores"][2]["fit"] = "high"
        return o
    llm = fake(judge=j_null)
    (d, _), _ = develop(llm=llm)
    assert seen == [False, True] and llm.calls.count("judge") == 2
    assert all("blind" in t for t in d["territories"] if t["state"] == "developed")        # the second answer was complete
    assert contract.check(d, facts=FACTS, findings=FINDINGS) == []


def test_the_judge_is_not_a_second_call_per_route_and_a_missing_score_is_not_made_up():
    def j_partial(user):
        o = j_out(user)
        o["scores"] = o["scores"][1:]
        o["ranking"] = o["ranking"][:2]
        return o
    (d, _), _ = develop(llm=fake(judge=j_partial))
    dev = [t for t in d["territories"] if t["state"] == "developed"]
    assert sum("blind" not in t for t in dev) == 1
    lone = next(t for t in dev if "blind" not in t)
    assert lone["checks"][-1]["kind"] == "judge" and sorted(t["rank"] for t in dev if "rank" in t) == list(range(1, len([t for t in dev if "rank" in t]) + 1))
    assert contract.check(d, facts=FACTS, findings=FINDINGS) == []


def test_a_check_that_did_not_come_back_is_unchecked_never_ok():
    def c_gap(user):
        o = c_out(user)
        o["checks"][0]["mandatory"] = {"status": "great", "text": "x"}
        o["checks"][1] = {"id": o["checks"][1]["id"]}
        o["checks"] = o["checks"][:-1]
        return o
    (d, _), _ = develop(llm=fake(world_checks=c_gap))
    by = {t["name"]: {c["kind"]: c["status"] for c in t["checks"]} for t in d["territories"] if t["state"] == "developed"}
    states = [v["mandatory"] for v in by.values()]
    assert states.count("unchecked") >= 3 and "ok" in states
    assert all(v["proposition"] in ("ok", "unchecked") for v in by.values())


def test_mandatories_are_checked_and_a_failure_is_carried_to_the_gate():
    def c_fail(user):
        o = c_out(user)
        o["checks"][0]["mandatory"] = {"status": "fail", "text": "A line shows the car being turned on."}
        return o
    (d, _), _ = develop(llm=fake(world_checks=c_fail))
    failed = [t for t in d["territories"] if any(c["kind"] == "mandatory" and c["status"] == "fail" for c in t.get("checks", []))]
    assert len(failed) == 1 and failed[0]["marks"]["risk"] >= 2
    assert gates._mandatory(failed[0]) == "fail"                                # the gate's ask for a reason reads this very check
    ck = next(c for c in failed[0]["checks"] if c["kind"] == "mandatory")
    assert ck["cite"] == ["brief:mandatories"] and "car" in ck["text"]
    d2 = gates.open_gate(d, "greenlight", findings=FINDINGS)
    assert contract.check(d2, facts=FACTS, findings=FINDINGS) == []


def test_a_brief_with_no_mandatories_says_so_instead_of_claiming_a_pass():
    def edit(d):
        for k in list(d["upstream"]):
            for key in ("mandatories",):
                d["upstream"][k].pop(key, None)
    (d, _), _ = develop(doc0(edit))
    for t in (t for t in d["territories"] if t["state"] == "developed"):
        ck = next(c for c in t["checks"] if c["kind"] == "mandatory")
        assert ck["status"] == "unchecked" and "no mandatories" in ck["text"] and "cite" not in ck


def test_evidence_check_is_the_codes_derived_or_verified():
    (d, _), _ = develop()
    derived = {f["id"] for f in FINDINGS["findings"] if f["status"] == "proposed"}
    for t in (t for t in d["territories"] if t["state"] == "developed"):
        ck = next(c for c in t["checks"] if c["kind"] == "evidence")
        has = bool(derived & set(t["evidence"]))
        assert (ck["status"] == "warn") == has or "29" in ck["text"], t["name"]
        if has:
            assert "nobody has checked" in ck["text"] and t["marks"]["risk"] >= 2


def test_a_price_the_words_invent_is_flagged_on_the_evidence_check():
    def bad(h, w):
        w["social"] = "Weekend returns from 15 euro."
        return w
    (d, _), _ = develop(llm=fake(world=lambda u: w_out(u, bad)))
    t = next(t for t in d["territories"] if t["state"] == "developed")
    ck = next(c for c in t["checks"] if c["kind"] == "evidence")
    assert ck["status"] == "warn" and "15 euro" in ck["text"]


def test_a_refused_world_is_written_again_once_in_one_call_and_named():
    seen = []

    def bad_once(user):
        d = json.loads(user)
        seen.append("redo" in d)
        names = [r["name"] for r in d["routes"]]

        def mut(h, w):
            if "redo" not in d and d["routes"][int(h[1:]) - 1]["name"] in (names[0],) and h == "r1":
                w["headlines"]["wq"] = " ".join(["long"] * 30)
            return w
        return w_out(user, mut)
    llm = fake(world=bad_once)
    (d, info), _ = develop(llm=llm)
    n = -(-len(live_found(doc0())) // world.CONFIG.batch)
    refused_batches = 1 if seen[0] is False else 0
    assert llm.calls.count("world") == n + 1 and seen.count(True) == 1           # ONE retry call, for the refused routes together
    assert all(t["state"] == "developed" for t in d["territories"] if t["status"] == "live")
    assert info["dropped"] == [] and refused_batches == 1


def test_a_world_still_refused_after_the_retry_leaves_the_route_a_thought_and_says_so():
    def always_bad(h, w):
        if h == "r1":
            w["headlines"]["sl"] = "This is {{unfilled}}"
        return w
    (d, info), llm = develop(llm=fake(world=lambda u: w_out(u, always_bad)))
    left = [t for t in d["territories"] if t["status"] == "live" and t["state"] == "found"]
    assert left and {x["territory"] for x in info["dropped"]} == {t["id"] for t in left}
    assert all(any("shown as a thought" in r for r in t["risks"]) for t in left) and not d["run"].get("error")
    assert all("rank" not in t for t in left) and contract.check(d, facts=FACTS, findings=FINDINGS) == []
    assert llm.calls.count("world") <= -(-len(live_found(doc0())) // world.CONFIG.batch) + 1 + 2


def test_nothing_developed_is_a_failure_in_words():
    d0 = doc0()
    d, info = world.develop_ex(d0, fake(world=lambda u: {"worlds": []}), facts=FACTS, findings=FINDINGS)
    assert d["run"]["state"] == "failed" and d["run"]["error"]["stage"] == "develop" and d["run"]["error"]["retryable"]
    assert not WORDS_BAD.search(d["run"]["error"]["message"]) and d["territories"] == d0["territories"]


def test_develop_refuses_to_run_before_the_gates_say_so():
    d = copy.deepcopy(contract.example("pick"))
    with pytest.raises(routes.NotReady):
        world.develop_ex(d, fake(), facts=FACTS, findings=FINDINGS)
    d2 = doc0()
    d2["run"]["state"] = "gate"
    d2 = gates.open_gate(d2, "pick", findings=FINDINGS)
    d2["run"]["approvals"] = {}
    with pytest.raises(routes.NotReady):
        world.develop_ex(d2, fake(), facts=FACTS, findings=FINDINGS)
    llm = fake()
    d3 = gates.drive(d2, {"develop": world.stage(llm, facts=FACTS, findings=FINDINGS)}, findings=FINDINGS)
    assert llm.calls == [] and d3["run"]["state"] == "gate"


def test_no_route_is_developed_twice_and_a_parked_one_is_left_alone():
    def edit(d):
        d["territories"][0]["status"] = "parked"
    d0 = doc0(edit)
    (d, _), llm = develop(d0)
    assert d["territories"][0]["state"] == "found" and d["territories"][0]["status"] == "parked"
    llm2 = fake()
    with pytest.raises(routes.NotReady):                                      # Develop is done: the gates say greenlight, so no model is called
        world.develop_ex(d, llm2, facts=FACTS, findings=FINDINGS)
    assert llm2.calls == []


# ---------------------------------------------------------------- live mode: the gates, the spend, the resume


def test_live_mode_develop_runs_only_through_the_gates_and_ends_at_greenlight():
    llm = fake()
    spend = sp.Spend(cap_usd=5.0)
    wrapped = spend.wrap(llm)
    out = gates.drive(doc0(), {"develop": world.stage(wrapped, facts=FACTS, findings=FINDINGS)}, findings=FINDINGS)
    assert out["run"]["state"] == "gate" and out["run"]["gate"]["id"] == "greenlight" and not out["run"].get("error")
    assert all(t["state"] == "developed" for t in out["territories"] if t["status"] == "live")
    assert contract.check(out, facts=FACTS, findings=FINDINGS) == []
    assert gates.next_step(out, findings=FINDINGS)["do"] in ("hold", "open_gate")
    assert all(l["stage"] in ("world", "world_checks", "judge") for l in spend.lines)
    assert json.dumps(out).lower().count("usd") == 0 and not [p for p in contract.lint(out) if p.rule == "price"]


def test_a_resume_after_the_cap_or_a_timeout_never_pays_twice():
    llm = fake()
    cap = sp.Spend(cap_usd=0.0001)
    out = gates.drive(doc0(), {"develop": world.stage(cap.wrap(llm), facts=FACTS, findings=FINDINGS)}, findings=FINDINGS)
    assert out["run"]["state"] == "failed" and out["run"]["error"]["stage"] == "develop" and out["run"]["error"]["retryable"]
    assert "limit" in out["run"]["error"]["message"] and not WORDS_BAD.search(out["run"]["error"]["message"]) and llm.calls == []
    spend = sp.Spend(cap_usd=5.0)
    inner_calls = []
    inner = lambda s, a, b: (inner_calls.append(s), llm(s, a, b))[1]       # noqa: E731
    d0 = doc0()
    world.develop_ex(d0, spend.wrap(inner), facts=FACTS, findings=FINDINGS)
    first = len(inner_calls)
    world.develop_ex(d0, spend.wrap(inner), facts=FACTS, findings=FINDINGS)       # the same run again: every answer is read, none bought
    assert first > 0 and len(inner_calls) == first


def test_a_failed_batch_is_not_a_silent_stop():
    def boom(user):
        raise RuntimeError("boom")
    d, _ = world.develop_ex(doc0(), fake(world=boom), facts=FACTS, findings=FINDINGS)
    assert d["run"]["state"] == "failed" and "try again" in d["run"]["error"]["message"] and "boom" not in d["run"]["error"]["message"]


def test_the_estimate_knows_the_new_stages_and_never_prices_them_low():
    for stg in ("world", "world_checks", "judge", "world_more"):
        assert sp.estimate_call(stg) >= 0.02, stg
    assert sp.estimate_call("world") > sp.estimate_call("world_checks") > 0


# ---------------------------------------------------------------- the category safety rules


SENSITIVE = "A campaign for a national helpline about suicide prevention and support."


def sens(d):
    k = next(iter(d["upstream"]))
    d["upstream"][k]["background"] = SENSITIVE


def test_the_pack_reader_equals_the_yaml_reading():
    yaml = pytest.importorskip("yaml")
    for f in sorted(world.packs_dir().glob("*.yaml")):
        text = f.read_text()
        want = yaml.safe_load(text)
        got = world.read_pack(text)
        assert got["id"] == want["id"] and got["when_any"] == want["when_any"], f.name
        for key in ("banned_phrases", "banned_imagery", "watch_words"):
            assert [x["text"] for x in got[key]] == [x["text"] for x in want.get(key, [])], (f.name, key)
        assert got["required_on_deck"] == want.get("required_on_deck", []), f.name
    assert any(world.read_pack(f.read_text())["banned_phrases"] for f in world.packs_dir().glob("*.yaml"))


def test_an_ordinary_brief_triggers_no_pack():
    (d, info), _ = develop()
    assert info["packs"] == [] and "review" not in d


def test_a_sensitive_pack_refuses_a_banned_phrase_and_asks_for_a_named_review():
    def say(h, w):
        if h == "r1":
            w["lines"][0] = "A cry for help is heard"
        return w
    llm = fake(world=lambda u: w_out(u, say))
    (d, info), _ = develop(doc0(sens), llm)
    assert info["packs"] == ["suicide_prevention"]
    left = [t for t in d["territories"] if t["status"] == "live" and t["state"] == "found"]
    assert left and all("cry for help" not in " ".join(world.spoken(t["world"])).lower() for t in d["territories"] if t.get("world"))
    assert any("safety rules ban" in x["reason"] for x in info["dropped"])
    assert d["review"]["sensitive"] == {"required": True, "status": "missing"}
    g = gates.open_gate(d, "greenlight", findings=FINDINGS)
    assert any(b["kind"] == "sensitive_review" for b in g["run"]["gate"]["blocked_by"])
    assert contract.check(g, facts=FACTS, findings=FINDINGS) == []


def test_banned_imagery_is_held_out_of_what_is_seen_and_watch_words_are_noted():
    def say(h, w):
        if h == "r2":
            w["tv"][0]["text"] = "A figure stands on the railway bridge."
        if h == "r3":
            w["lines"][0] = "Some roads go instantly where you need."
        return w
    (d, info), _ = develop(doc0(sens), fake(world=lambda u: w_out(u, say)))
    assert all("railway" not in " ".join(world.spoken(t["world"])).lower() for t in d["territories"] if t.get("world"))
    ww = [t for t in d["territories"] if any("needs a person's read" in r for r in t["risks"])]
    assert ww and all(any(c["kind"] == "landscape" and c["status"] == "warn" for c in t["checks"]) for t in ww)


def test_the_writer_is_told_the_rules_and_a_sensitive_review_is_never_marked_done_here():
    seen = []
    (d, _), _ = develop(doc0(sens), fake(world=lambda u: (seen.append(json.loads(u)), w_out(u))[1]))
    rules = seen[0]["category_rules"]
    assert "cry for help" in rules["never_write"] and rules["must_hold"] and rules["take_care"]
    assert d["review"]["sensitive"]["status"] == "missing" and "by" not in d["review"]["sensitive"]
    d2 = copy.deepcopy(doc0(sens))
    d2["review"] = {"sensitive": {"required": True, "status": "done", "by": "Aoife", "inputs": "abc"}}
    (d3, _), _ = develop(d2)
    assert d3["review"]["sensitive"]["status"] == "done"                             # a person's review is never overwritten


def test_missing_packs_fail_closed(monkeypatch, tmp_path):
    monkeypatch.setenv(world.PACKS_ENV, str(tmp_path))
    d, _ = world.develop_ex(doc0(), fake(), facts=FACTS, findings=FINDINGS)
    assert d["run"]["state"] == "failed" and d["run"]["error"]["retryable"] is False and "safety rules" in d["run"]["error"]["message"]
    assert all(t["state"] != "developed" for t in d["territories"])


# ---------------------------------------------------------------- the person's moves


def developed_doc():
    (d, _), _ = develop()
    return d


def test_write_more_like_this_is_one_call_and_changes_only_the_lines():
    d = developed_doc()
    t = next(t for t in d["territories"] if t["state"] == "developed" and t["status"] == "live")
    llm = fake()
    d2, ref = world.more(d, llm, t["id"], "Shrey", facts=FACTS, findings=FINDINGS)
    assert ref == [] and llm.calls == ["world_more"]
    t2 = next(x for x in d2["territories"] if x["id"] == t["id"])
    assert t2["world"]["lines"] == [*t["world"]["lines"], "Brand new line one.", "Brand new line two."]
    assert {k: v for k, v in t2.items() if k != "world"} == {k: v for k, v in t.items() if k != "world"}
    assert {k: v for k, v in t2["world"].items() if k != "lines"} == {k: v for k, v in t["world"].items() if k != "lines"}
    assert contract.check(d2, facts=FACTS, findings=FINDINGS) == []


def test_write_more_refuses_in_words_and_never_repeats_a_line():
    d = developed_doc()
    t = next(t for t in d["territories"] if t["state"] == "developed" and t["status"] == "live")
    same = fake(world_more=lambda u: {"lines": [t["world"]["lines"][0], t["world"]["headlines"]["wq"]]})
    d2, ref = world.more(d, same, t["id"], "Shrey", facts=FACTS, findings=FINDINGS)
    assert d2 == d and ref and "different" in ref[0]
    _, ref = world.more(d, fake(), "t_nope", "Shrey")
    assert ref and not WORDS_BAD.search(ref[0])
    full = copy.deepcopy(d)
    next(x for x in full["territories"] if x["id"] == t["id"])["world"]["lines"] = [f"Distinct line {i} here" for i in range(16)]
    _, ref = world.more(full, fake(), t["id"], "Shrey", facts=FACTS, findings=FINDINGS)
    assert ref and "16" in ref[0]
    _, ref = world.more(d, fake(), t["id"], "  ", facts=FACTS, findings=FINDINGS)
    assert ref


def test_push_rewrites_one_route_and_asks_the_judge_again_and_keeps_what_a_person_set():
    d = developed_doc()
    t = next(t for t in d["territories"] if t["state"] == "developed" and t["status"] == "live")
    me = next(x for x in d["territories"] if x["id"] == t["id"])
    me["world"].update(starred=[me["world"]["lines"][0]], lead=me["world"]["lines"][1], dial_set={"tone": 10, "energy": 10, "register": 10, "brand": 10})
    seen = []

    def pushed(user):
        o = json.loads(user)
        seen.append(o)
        return w_out(user, lambda h, w: {**w, "lines": [*w["lines"][:3], "A pushed line that is new."]})
    llm = fake(world=pushed)
    d2, ref, info = world.push(d, llm, t["id"], "Shrey", facts=FACTS, findings=FINDINGS)
    assert ref == [] and sorted(llm.calls) == ["judge", "world", "world_checks"] and llm.calls[0] == "world" and info["calls"] == 3
    assert len(seen[0]["routes"]) == 1 and seen[0]["its_current_world"]["lines"] == me["world"]["lines"] and "push" in seen[0]
    t2 = next(x for x in d2["territories"] if x["id"] == t["id"])
    assert "A pushed line that is new." in t2["world"]["lines"]
    assert t2["world"]["starred"] == me["world"]["starred"] and t2["world"]["lead"] == me["world"]["lead"] and t2["world"]["dial_set"] == me["world"]["dial_set"]
    others = [x for x in d2["territories"] if x["id"] != t["id"]]
    assert [x.get("world") for x in others] == [x.get("world") for x in d["territories"] if x["id"] != t["id"]]
    dev = [x for x in d2["territories"] if x["state"] == "developed" and x["status"] == "live"]
    assert sorted(x["rank"] for x in dev) == list(range(1, len(dev) + 1))
    assert contract.check(d2, facts=FACTS, findings=FINDINGS) == []


def test_push_that_cannot_be_written_leaves_the_route_as_it_was():
    d = developed_doc()
    t = next(t for t in d["territories"] if t["state"] == "developed" and t["status"] == "live")
    bad = fake(world=lambda u: w_out(u, lambda h, w: {**w, "scenes": {"story": "volcano"}}))
    d2, ref, _ = world.push(d, bad, t["id"], "Shrey", facts=FACTS, findings=FINDINGS)
    assert d2 == d and ref and "left as it was" in ref[0]
    _, ref, _ = world.push(d, fake(), "t_nope", "Shrey")
    assert ref
    parked = copy.deepcopy(d)
    next(x for x in parked["territories"] if x["id"] == t["id"])["status"] = "parked"
    assert world.push(parked, fake(), t["id"], "Shrey")[1]


def test_dials_need_no_model_the_four_corners_are_data():
    d = developed_doc()
    for t in (t for t in d["territories"] if t["state"] == "developed"):
        assert set(t["world"]["headlines"]) == {"wq", "wl", "sq", "sl"} and len(t["world"]["lines"]) >= 4
        assert set(t["world"]["dial"]) == {"tone", "energy", "register", "brand"}


def test_one_set_of_routes_gets_different_palettes_or_says_so():
    (d, _), _ = develop()
    bgs = [t["world"]["palette"]["bg"] for t in d["territories"] if t["state"] == "developed"]
    assert len(set(bgs)) >= len(bgs) - 2
