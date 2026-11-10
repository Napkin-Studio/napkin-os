"""The pure parts of tools/engine_eval.py (the three-idea evaluation harness): selection, blinding and label stripping,
order swapping, the sign rule and every branch of each decision rule, the cost reservation, the variety measure on
sub-pools, and the arms driven by a scripted fake model. Fixtures only: no model call, no file outside tmp_path."""

import copy
import json
import re
import threading

import jsonschema
import pytest

from napkin.brief import candidates, checks
from tools import engine_eval as ee


# =============================================================================================== fixtures
PARTS = ["insight", "single_minded_proposition", "objection", "audience", "background", "competitor_context", "job",
         "reasons_to_believe", "objectives.commercial", "open_questions"]


def entry(value, basis="assumption"):
    return {"value": value, "basis": basis, "cites": [], "builds_on_client": False, "why": "w"}


def draft_reply(insight="A true tension.", prop="One plain thought", **over):
    r = {k: entry(f"{k} text") for k in PARTS}
    r["reasons_to_believe"] = entry(["a reason"], "client")
    r["open_questions"] = entry(["a question"])
    r["insight"], r["single_minded_proposition"] = entry(insight), entry(prop)
    r.update(over)
    return r


def stored_payload():
    return {"client_said": "A client brief, in plain words.", "captured": {"audience": "Adults 20 to 45", "background": "Number four"},
            "client_words": [{"id": "cap_1", "words": "w"}], "facts": [], "findings": [], "research_upstream": [],
            "library": [{"id": "psg_1", "text": "t"}],
            "plan": {"strategy": "STRATEGY", "brand": "Brand", "competitors": ["Rival"], "category": "c", "ask_client": [],
                     "parts": {k: {"must_say": f"say {k}", "rests_on": "assumption"} for k in PARTS}},
            "parts": {k: f"what {k} is" for k in PARTS}, "who_handles": {k: "dara" for k in PARTS}}


def make_inp(bid="c01", **kw):
    inp = {"name": f"{bid}-off", "id": bid, "brief_text": f"Brief of {bid}.", "payload": stored_payload(),
           "first_draft": {"insight": "To confirm: Stored insight.", "single_minded_proposition": "To confirm: Stored line."},
           "system_is_draft_system": True}
    inp.update(kw)
    return inp


class Fake:
    """A scripted model: `handlers[purpose](system, payload, schema)` -> the answer; records like Caller."""

    def __init__(self, handlers, fail=None):
        self.handlers, self.records, self.fail, self.seen = handlers, [], fail or {}, []

    def __call__(self, purpose, system, payload, schema):
        self.seen.append({"purpose": purpose, "system": system, "payload": copy.deepcopy(payload), "schema": schema})
        n = sum(1 for s in self.seen if s["purpose"] == purpose)
        if purpose in self.fail and n in self.fail[purpose]:
            self.records.append({"purpose": purpose, "attempts": 1, "cost_usd": 0.01, "secs": 1.0, "first_validation_error": None, "ok": False, "error": "boom"})
            raise RuntimeError("boom")
        out = self.handlers[purpose](system, payload, schema)
        self.records.append({"purpose": purpose, "attempts": 1, "cost_usd": 0.01, "secs": 1.0, "first_validation_error": None, "ok": True, "error": None})
        return out


def jude_answer(prop_pass=True, ins_pass=True, instruction="Say it without and.", **extra):
    a = {"parts": {}, "dimensions": [], "chain": {"issue": None, "parts": []}, "questions": [],
         "tests": {"single_minded_proposition": {"pass": prop_pass, "failed_test": "" if prop_pass else "single_minded", "instruction": "" if prop_pass else instruction},
                   "insight": {"pass": ins_pass, "failed_test": "" if ins_pass else "fresh", "instruction": "" if ins_pass else "Make it fresher."}}}
    a.update(extra)
    return a


def standard_handlers(**over):
    h = {
        "draft_brief_whole": lambda s, p, sc: draft_reply(insight=p["plan"]["parts"]["insight"]["must_say"] + " drafted",
                                                          prop=("Line from " + p["plan"]["parts"]["single_minded_proposition"]["must_say"][:10])),
        "insight_hypotheses": lambda s, p, sc: {"hypotheses": [
            {"value": f"Hypothesis {i} about people", "mechanism": "m", "tension": "t", "counter_evidence": "none in the input",
             "brand_role": "r", "cites": ["psg_1"] if i == 0 else []} for i in range(8)]},
        "rank_insight": lambda s, p, sc: {"ranking": list(range(len(p["candidates"]))), "why_winner": "w", "losers": []},
        "candidates_smp": lambda s, p, sc: {"candidates": [{"value": f"Option line {i}", "angle": "a", "rests_on": "r", "cites": []} for i in range(7)]},
        "rank_smp": lambda s, p, sc: {"ranking": list(range(len(p["candidates"]))), "why_winner": "w", "losers": []},
        "explain_flags": lambda s, p, sc: jude_answer(),
        "rewrite_brief_parts": lambda s, p, sc: {"single_minded_proposition": entry("Rewritten line")},
    }
    h.update(over)
    return h


# =============================================================================================== selection
def entries(spec):
    return [{"name": n, "state": s} for n, s in spec]


def test_selection_takes_every_id_in_id_order_and_only_the_off_arm():
    spec = [(f"{b}{i:02d}-{arm}", "done") for b in "ct" for i in range(1, 11) for arm in ("off", "thin")]
    got = ee.select_runs(entries(reversed(spec)))
    ids = sorted({n[:-4] for n, _ in spec if n.endswith("-off")})
    assert got == [f"{i}-off" for i in ids] and len(got) == 20
    assert not any(n.endswith("thin") for n in got)


def test_selection_leaves_out_a_run_that_is_not_done_and_ignores_ids_not_in_the_briefs_file():
    spec = [("c01-off", "done"), ("c02-off", None), ("c03-off", "done"), ("c04-off", "done")]
    assert ee.select_runs(entries(spec), ids=["c01", "c02", "c03"]) == ["c01-off", "c03-off"]
    assert ee.select_runs(entries([("hearthly-off-1", "done")]), ids=["c01"]) == []


def test_list_source_counts_a_run_done_only_with_summary_and_job_end(tmp_path):
    runs = tmp_path / "runs"
    for name, summary, end in (("c01-off", "done", "done"), ("c02-off", "done", None), ("c03-off", None, None), ("c04-off", "failed", "failed")):
        d = runs / name
        d.mkdir(parents=True)
        if summary:
            (d / "summary.json").write_text(json.dumps({"final_state": summary}))
            (d / "runlog.jsonl").write_text(json.dumps({"ev": "model"}) + "\n" + (json.dumps({"ev": "job_end", "state": end}) if end else ""))
    assert {e["name"]: e["state"] for e in ee.list_source(tmp_path)} == {"c01-off": "done", "c02-off": None, "c03-off": None, "c04-off": None}


def stored_event(payload=None, reply=None, system=None):
    from napkin.brief.planned import DRAFT_SYSTEM
    return {"ev": "model", "purpose": "draft_brief_whole", "secs": 30, "cost": 0.09,
            "payload": {"system": system or DRAFT_SYSTEM, "payload": payload or stored_payload()},
            "reply": reply or {"insight": {"value": "I"}, "single_minded_proposition": {"value": "P"}}}


def test_extract_input_keeps_the_stored_payload_whole_and_the_first_draft():
    got = ee.extract_input("c01-off", [json.dumps({"ev": "model", "purpose": "plan_brief"}), json.dumps(stored_event())])
    assert got["id"] == "c01" and got["payload"] == stored_payload() and got["first_draft"] == {"insight": "I", "single_minded_proposition": "P"}
    assert got["brief_text"] == stored_payload()["client_said"] and got["system_is_draft_system"] is True
    assert ee.extract_input("c01-off", [json.dumps(stored_event(system="other"))])["system_is_draft_system"] is False
    with pytest.raises(ValueError):
        ee.extract_input("c01-off", [])
    with pytest.raises(ValueError):
        ee.extract_input("c01-off", [json.dumps(stored_event()), json.dumps(stored_event())])
    with pytest.raises(ValueError):
        ee.extract_input("c01-off", [json.dumps(stored_event(reply={"insight": {"value": "I"}}))])


def fake_source(tmp_path, ids=("c01", "c02", "t01")):
    src = tmp_path / "src"
    (src / "runs").mkdir(parents=True)
    (src / "briefs.json").write_text(json.dumps([{"id": i, "text": "x"} for i in ids]))
    for i in ids:
        for arm in ("off", "thin"):
            d = src / "runs" / f"{i}-{arm}"
            d.mkdir()
            (d / "summary.json").write_text(json.dumps({"final_state": "done"}))
            (d / "runlog.jsonl").write_text(json.dumps(stored_event()) + "\n" + json.dumps({"ev": "job_end", "state": "done"}))
    return src


def test_select_writes_the_list_with_hashes_and_a_timestamp_and_refuses_to_select_twice(tmp_path):
    src, out = fake_source(tmp_path), tmp_path / "out"
    a = type("A", (), {"out": str(out), "src": str(src)})()
    ee.cmd_select(a)
    sel = json.loads((out / "inputs/selection.json").read_text())
    assert [r["id"] for r in sel["runs"]] == ["c01", "c02", "t01"]
    assert all(len(r["source_runlog_sha256"]) == 64 for r in sel["runs"]) and sel["selected_at"].endswith("Z")
    assert (out / "inputs/c01.json").exists()
    with pytest.raises(SystemExit):
        ee.cmd_select(a)


# =============================================================================================== text, labels, blinding
@pytest.mark.parametrize("label", ["To confirm:", "Draft for testing:", "Draft for confirmation:", "Working proposal:", "Hypothesis to test:",
                                   "Hypothesis:", "Assumption:", "Proposed:", "TO CONFIRM :", "  draft for testing:  "])
def test_tidy_removes_every_listed_label_and_capitalises(label):
    assert ee.tidy(f"{label} people want a treat.") == "People want a treat"


def test_tidy_removes_stacked_labels_and_leaves_a_midsentence_colon_alone():
    assert ee.tidy("To confirm: Hypothesis to test: a line") == "A line"
    assert ee.tidy("The reason: a line") == "The reason: a line"
    assert ee.tidy("Assumptions are risky: say so") == "Assumptions are risky: say so"


def test_tidy_drops_one_final_full_stop_and_normalises_white_space():
    assert ee.tidy("A line.") == "A line" and ee.tidy("A line...") == "A line..." and ee.tidy("  Wait.  Why.  ") == "Wait. Why"
    assert ee.tidy("Two\n\nlines  here") == "Two lines here" and ee.tidy(None) == "" and ee.tidy("") == ""


def test_an_arm_cannot_be_told_from_its_labels_or_punctuation():
    """The same words with every tell an arm could carry give one shown text."""
    base = "A treat you choose on purpose"
    variants = [base, base + ".", f"To confirm: {base}.", f"Draft for testing: {base}", f"Hypothesis to test: {base.lower()}.",
                f"  Working proposal:  {base}  ", f"Draft for confirmation: To confirm: {base}."]
    assert len({ee.tidy(v) for v in variants}) == 1


def test_leftover_label_report_finds_short_text_before_a_colon():
    assert ee.leftover_label("Nobody expected: a treat") and ee.leftover_label("Cheap, fast and good: pick two")
    assert not ee.leftover_label("A treat you choose on purpose") and not ee.leftover_label("One two three four five six: x")


def run_arms(tmp_path, bids=("c01", "c02", "c03", "c04", "c05", "c06"), handlers=None, force=False, skip=()):
    out = tmp_path / "out"
    inputs = [make_inp(b) for b in bids]
    arms_by = {}
    for inp in inputs:
        fake = Fake(handlers or standard_handlers())
        arms_by[inp["id"]] = ee.process_brief(out, inp, lambda job, arm, f=fake: Fake(handlers or standard_handlers()), force, skip)
    return out, inputs, arms_by


def packets_for(tmp_path, bids=("c01", "c02", "c03", "c04", "c05", "c06"), handlers=None):
    out, inputs, arms_by = run_arms(tmp_path, bids, handlers)
    packets, key = ee.build_packets(inputs, arms_by)
    return out, inputs, arms_by, packets, key


def test_packets_name_no_arm_idea_source_or_seed_and_ids_say_nothing(tmp_path):
    _, inputs, _, packets, key = packets_for(tmp_path)
    text = json.dumps(packets)
    for tell in ("T1", "C1", "L2", "R0", "R1", "J0", "J1", "H1", "SV1", "seed", "hyp", "plan", "first_draft", "winner", "investigator",
                 "insight_hypotheses", "candidates", "route", "baseline", "treatment", "control", "idea", "arm"):
        assert not re.search(rf"\b{tell}\b", re.sub(r"(?s)CLIENT BRIEF:.*?DRAFT X", "DRAFT X", text), re.I), tell
    ids = [it["item"] for p in packets for it in p["items"]]
    assert len(ids) == len(set(ids)) and all(re.fullmatch(r"[0-9a-f]{10}", i) for i in ids)
    assert not any(inp["id"] in i for inp in inputs for i in ids)
    for item in ids:       # the key is where the arms live, not the packet
        assert item in key["pairs"] or item in key["sameidea"]
    assert set(packets[0]) == {"packet", "items"}
    assert all(set(it) <= {"item", "kind", "question", "prompt", "n"} for p in packets for it in p["items"])


def test_the_same_question_has_the_same_prompt_shape_whatever_the_idea_or_arm(tmp_path):
    _, _, _, packets, key = packets_for(tmp_path)
    shapes = {}
    for p in packets:
        for it in p["items"]:
            if it["kind"] != "pair":
                continue
            shape = re.sub(r"(?s)CLIENT BRIEF:.*?\n\nDRAFT X\n", "CLIENT BRIEF:<b>\n\nDRAFT X\n", it["prompt"])
            shape = re.sub(r"(?m)^(Insight|Proposition): .*$", r"\1: <t>", shape)
            shapes.setdefault(it["question"], set()).add(shape)
    assert set(shapes) == {"insight", "proposition"} and all(len(v) == 1 for v in shapes.values())
    assert {k["question"] for k in key["pairs"].values()} == {"insight", "proposition"}


def test_items_from_different_ideas_are_mixed_in_every_packet(tmp_path):
    _, _, _, packets, key = packets_for(tmp_path, bids=[f"c{i:02d}" for i in range(1, 13)])
    for p in packets:
        pair_items_ = [it for it in p["items"] if it["kind"] == "pair"]
        if len(pair_items_) >= 20:
            assert len({key["pairs"][it["item"]]["idea"] for it in pair_items_}) >= 2
    flat = [key["pairs"][it["item"]]["comparison"] for p in packets for it in p["items"] if it["kind"] == "pair"]
    assert flat != sorted(flat)           # not in comparison order


def test_an_item_and_its_swapped_twin_never_share_a_packet_and_packets_hold_at_most_forty(tmp_path):
    _, _, _, packets, key = packets_for(tmp_path, bids=[f"c{i:02d}" for i in range(1, 15)])
    where = {}
    for p in packets:
        assert len(p["items"]) <= 40
        for it in p["items"]:
            k = key["pairs"].get(it["item"])
            if k:
                where.setdefault((k["brief"], k["comparison"]), []).append(p["packet"])
    assert where and all(len(v) == 2 and v[0] != v[1] for v in where.values())
    for p in packets:       # same-idea items are in packets of their own
        assert len({it["kind"] for it in p["items"]}) == 1


def test_order_two_is_order_one_swapped_and_the_key_recovers_the_sides(tmp_path):
    _, inputs, arms_by, packets, key = packets_for(tmp_path, bids=[f"c{i:02d}" for i in range(1, 13)])
    by = {}
    for p in packets:
        for it in p["items"]:
            if it["kind"] == "pair" and it["question"] == "proposition":
                k = key["pairs"][it["item"]]
                x = re.search(r"DRAFT X\nInsight: .*\nProposition: (.*)\n", it["prompt"]).group(1)
                y = re.search(r"DRAFT Y\nInsight: .*\nProposition: (.*)\n", it["prompt"]).group(1)
                inp = next(i for i in inputs if i["id"] == k["brief"])
                tx = ee.arm_text(arms_by[k["brief"]], inp, k["X"])[0][1]
                ty = ee.arm_text(arms_by[k["brief"]], inp, k["Y"])[0][1]
                assert (x, y) == (ee.tidy(tx), ee.tidy(ty)) and {k["X"], k["Y"]} == {k["first"], k["second"]}
                by.setdefault((k["brief"], k["comparison"]), {})[k["order"]] = k["X"]
    assert all(v[1] != v[2] for v in by.values())                         # positions swapped between the orders
    firsts = [v[1] == "S" for (b, c), v in by.items() if c == "SvO"]
    assert 0 < sum(firsts) < len(firsts)                                  # the coin is not always the same side


def test_packets_are_deterministic_and_the_key_covers_every_item(tmp_path):
    out, inputs, arms_by, packets, key = packets_for(tmp_path)
    again = ee.build_packets(inputs, arms_by)
    assert (packets, key) == again
    assert {it["item"] for p in packets for it in p["items"]} == set(key["pairs"]) | set(key["sameidea"])


def test_identical_text_is_a_tie_without_a_rating_and_a_failed_or_no_gate_side_too(tmp_path):
    h = standard_handlers(explain_flags=lambda s, p, sc: jude_answer(prop_pass=True))      # nobody sends the proposition back
    _, _, _, packets, key = packets_for(tmp_path, ["c01"], h)
    ties = {k.split("|")[1]: v for k, v in key["auto_ties"].items()}
    assert ties.get("R1vR0") == "identical text" and ties.get("R0pvR0") == "identical text"
    assert not any(k["comparison"] in ("R1vR0", "R0pvR0") for k in key["pairs"].values())
    # a no_gate step: T1 and S have no text, C1 v B is still rated
    h2 = standard_handlers(insight_hypotheses=lambda s, p, sc: {"hypotheses": [{"value": "w " * 60, "mechanism": "", "tension": "", "counter_evidence": "", "brand_role": "", "cites": []}]},
                           candidates_smp=lambda s, p, sc: {"candidates": [{"value": "word " * 30, "angle": "", "rests_on": "", "cites": []}]})
    _, _, _, _, key2 = packets_for(tmp_path / "x", ["c01"], h2)
    t2 = {k.split("|")[1]: v for k, v in key2["auto_ties"].items()}
    assert "T1vC1.ins" in t2 and "T1vB.ins" in t2 and "SvO" in t2 and "C1vB.prop" not in t2
    assert any(k["comparison"] == "C1vB.prop" for k in key2["pairs"].values())


def test_failed_final_arm_makes_its_comparisons_ties_and_packets_proceed(tmp_path):
    h = standard_handlers()
    fail = {"insight_hypotheses": [1, 2]}
    out = tmp_path / "out"
    inp = make_inp("c01")
    fk = Fake(h, fail=fail)
    arms = ee.process_brief(out, inp, lambda job, arm: fk)
    assert arms["H1"]["status"] == "FAILED_final" and arms["H1"]["runs"] == 2 and len(arms["H1"]["failed_runs"]) == 2
    assert arms["T1"]["status"] == "FAILED_final" and "dependency" in arms["T1"]["error"]
    assert arms["B"]["status"] == "ok" and arms["C1"]["status"] == "ok"
    _, key = ee.build_packets([inp], {"c01": arms})
    assert key["auto_ties"]["c01|T1vC1.ins"].startswith("T1 FAILED_final") or "FAILED_final" in key["auto_ties"]["c01|T1vC1.ins"]


# =============================================================================================== sign rule and outcomes
def test_sign_threshold_reproduces_the_protocol_table_from_the_binomial():
    assert {n: ee.sign_threshold(n) for n in range(5, 21)} == ee.SIGN_TABLE


def test_sign_rule_at_the_exact_thresholds_and_just_inside():
    assert ee.sign_rule(15, 5) and not ee.sign_rule(14, 6)          # n = 20 needs 15
    assert ee.sign_rule(8, 0) and not ee.sign_rule(7, 0)            # W at least 8 whatever n
    assert ee.sign_rule(13, 4) and not ee.sign_rule(12, 5)          # n = 17 needs 13
    assert not ee.sign_rule(4, 0) and not ee.sign_rule(5, 0)        # n < 5, and W < 8 with n = 5
    assert ee.sign_rule(10, 2) and not ee.sign_rule(9, 3)           # n = 12 needs 10


def test_a_pair_sum_of_plus_or_minus_two_is_a_win_or_a_loss_and_one_is_a_tie():
    s = lambda a, b, c, d: ee.brief_outcome({"sonnet": [a, b], "opus": [c, d]})
    assert s(1, 1, 0, 0) == "W" and s(1, 1, 1, 1) == "W" and s(1, 0, 0, 0) == "T" and s(1, 1, 1, 0) == "W"
    assert s(-1, -1, 0, 0) == "L" and s(-1, 0, 0, 0) == "T" and s(0, 0, 0, 0) == "T"
    assert s(1, -1, 1, -1) == "T"                                    # a rater who flips with the order cancels out
    assert s(1, -1, 0, 1) == "T" and s(1, -1, 1, 1) == "W" and s(1, 1, 1, -1) == "W" and s(-1, 1, -1, 0) == "T"
    assert s(1, 1, None, 0) is None and s(None, 1, 1, 1) is None     # a missing judgement is never a score


def test_one_rater_alone_wins_only_when_both_orders_pick_the_side():
    assert ee.rater_outcome([1, 1]) == "W" and ee.rater_outcome([1, 0]) == "T" and ee.rater_outcome([1, -1]) == "T"
    assert ee.rater_outcome([-1, -1]) == "L" and ee.rater_outcome([0, 0]) == "T" and ee.rater_outcome([1, None]) is None


def units_of(spec):
    """spec: {brief: (sonnet o1, o2, opus o1, o2) | 'tie'}"""
    return {b: ({"tie": "x"} if v == "tie" else {"scores": {"sonnet": [v[0], v[1]], "opus": [v[2], v[3]]}}) for b, v in spec.items()}


def test_tally_counts_ties_and_listed_missing_judgements_never_as_scores():
    t = ee.tally(units_of({"a": (1, 1, 1, 1), "b": (-1, -1, -1, -1), "c": (1, 0, 0, 0), "d": "tie", "e": (1, 1, None, 1), "f": (1, 1, 1, 0)}))
    assert (t["W"], t["L"], t["T"], t["net"]) == (2, 1, 2, 1) and t["missing"] == ["e"]
    assert t["per_rater"]["sonnet"] == {"W": 2, "L": 1, "T": 2} and t["per_rater"]["opus"]["W"] == 1


def test_each_rater_ahead_needs_a_strict_lead_for_both():
    t = ee.tally(units_of({"a": (1, 1, 1, 1), "b": (-1, -1, 1, 1), "c": (1, 1, 0, 0)}))
    assert t["per_rater"]["sonnet"]["W"] == 2 and t["per_rater"]["opus"]["W"] == 2 and ee.each_rater_ahead(t)
    t2 = ee.tally(units_of({"a": (1, 1, 1, 1), "b": (-1, -1, -1, -1), "c": (1, 1, -1, -1)}))
    assert not ee.each_rater_ahead(t2)      # opus 1-2


# =============================================================================================== the decision rules
def T(W, L, tie=0, sonnet=None, opus=None):
    """A tally with both raters equal to the pair unless given as (W, L)."""
    s, o = sonnet or (W, L), opus or (W, L)
    return {"W": W, "L": L, "T": tie, "net": W - L, "missing": [],
            "per_rater": {"sonnet": {"W": s[0], "L": s[1], "T": 0}, "opus": {"W": o[0], "L": o[1], "T": 0}}}


OK_GATES = {"incomplete": [], "invalid": []}


def idea1_base(**over):
    d = {"T1vC1.ins": T(15, 3, 2), "C1vB.ins": T(5, 4, 11), "T1vC1.prop": T(6, 5, 9), "T1vB.ins": T(12, 4, 4), "C1vB.prop": T(4, 4, 12),
         "median_ideas": 6, "over57_t1": 1, "over57_c1": 0, "cost_ok": True, "jude_fail_ins_t1": 3, "jude_fail_ins_b": 2, "code_sb_t1": 2, "code_sb_c1": 1,
         "survival_measured": True, "confounded": False, "gates": OK_GATES}
    d.update(over)
    return d


def test_idea1_go_when_every_condition_holds_and_each_condition_alone_blocks_it():
    assert ee.idea1_rules(idea1_base())["verdict"] == "GO"
    breaks = {
        "sr": {"T1vC1.ins": T(14, 6)}, "rater": {"T1vC1.ins": T(15, 3, 2, sonnet=(16, 3), opus=(8, 8))},
        "noise margin": {"C1vB.ins": T(11, 2, 7)},         # |net 9| leaves 15-3-9 = 3 < 4
        "prop guard": {"T1vC1.prop": T(3, 6, 11)}, "ship": {"T1vB.ins": T(3, 6, 11)},
        "median": {"median_ideas": 4}, "over57": {"over57_t1": 4, "over57_c1": 1}, "cost": {"cost_ok": False},
        "jude": {"jude_fail_ins_t1": 6, "jude_fail_ins_b": 3}, "code": {"code_sb_t1": 5, "code_sb_c1": 2}}
    for name, over in breaks.items():
        r = ee.idea1_rules(idea1_base(**over))
        assert r["verdict"] == "INCONCLUSIVE", (name, r)


def test_idea1_boundaries_are_inclusive_where_the_protocol_says_at_least_or_at_most():
    d = idea1_base(**{"T1vC1.ins": T(15, 3, 2), "C1vB.ins": T(8, 0, 12)})                     # 12 - 8 = 4 exactly
    assert ee.idea1_rules(d)["verdict"] == "GO"
    assert ee.idea1_rules(idea1_base(**{"C1vB.ins": T(9, 0, 11)}))["verdict"] == "INCONCLUSIVE"   # 12 - 9 = 3
    assert ee.idea1_rules(idea1_base(median_ideas=5))["verdict"] == "GO"
    assert ee.idea1_rules(idea1_base(over57_t1=3, over57_c1=1))["verdict"] == "GO"               # exactly 2 more
    assert ee.idea1_rules(idea1_base(jude_fail_ins_t1=4, jude_fail_ins_b=2))["verdict"] == "GO"
    assert ee.idea1_rules(idea1_base(**{"T1vC1.prop": T(5, 5, 10), "T1vB.ins": T(5, 5, 10)}))["verdict"] == "GO"   # W = L passes the guards


def test_idea1_drop_at_net_two_and_a_tie_in_net_three_is_not_a_drop():
    assert ee.idea1_rules(idea1_base(**{"T1vC1.ins": T(8, 6, 6)}))["verdict"] == "DROP"       # net 2
    assert ee.idea1_rules(idea1_base(**{"T1vC1.ins": T(8, 5, 7)}))["verdict"] == "INCONCLUSIVE"   # net 3, SR fails
    assert ee.idea1_rules(idea1_base(**{"T1vC1.ins": T(5, 9, 6)}))["verdict"] == "DROP"       # negative
    r = ee.idea1_rules(idea1_base(**{"T1vC1.prop": T(1, 8, 11)}))                             # C1 passes SR against T1 on the proposition
    assert r["verdict"] == "DROP" and "C1 passes SR against T1 on the proposition" in r["why"]


def test_idea1_length_confound_and_unmeasured_survival_stop_a_go_but_not_a_drop():
    assert ee.idea1_rules(idea1_base(confounded=True))["verdict"] == "INCONCLUSIVE"
    r = ee.idea1_rules(idea1_base(survival_measured=False))
    assert r["verdict"] == "INCONCLUSIVE" and "survival" in " ".join(r["why"])
    assert ee.idea1_rules(idea1_base(confounded=True, **{"T1vC1.ins": T(8, 6, 6)}))["verdict"] == "DROP"


def test_idea1_records_apart_when_the_plan_edit_alone_moves_the_draft():
    r = ee.idea1_rules(idea1_base(**{"C1vB.prop": T(15, 3, 2)}))
    assert r["plan_edit_alone_moves_the_draft"]["C1vB.prop_SR_either_way"] and not r["plan_edit_alone_moves_the_draft"]["C1vB.ins_SR_either_way"]
    r2 = ee.idea1_rules(idea1_base(**{"C1vB.ins": T(3, 15, 2)}))
    assert r2["plan_edit_alone_moves_the_draft"]["C1vB.ins_SR_either_way"]


def test_validity_gates_come_first_missing_data_is_incomplete_and_position_bias_leaves_no_verdict():
    g = ee.gate_failures(failed_final_briefs=3, missing=[], x_share={"sonnet": 0.5, "opus": 0.5}, steps_ran=20, n=20)
    assert g["incomplete"] and ee.idea1_rules(idea1_base(gates=g))["verdict"] == "INCOMPLETE"
    assert not ee.gate_failures(failed_final_briefs=2, missing=[], x_share={}, steps_ran=20, n=20)["incomplete"]
    g = ee.gate_failures(failed_final_briefs=0, missing=["c01:T1vC1.ins"], x_share={}, steps_ran=20, n=20)
    assert ee.idea1_rules(idea1_base(gates=g))["verdict"] == "INCOMPLETE"
    g = ee.gate_failures(failed_final_briefs=0, missing=[], x_share={}, steps_ran=17, n=20)
    assert g["incomplete"] and not ee.gate_failures(failed_final_briefs=0, missing=[], x_share={}, steps_ran=18, n=20)["incomplete"]
    g = ee.gate_failures(failed_final_briefs=0, missing=[], x_share={"sonnet": 0.66, "opus": 0.4}, steps_ran=20, n=20)
    r = ee.idea1_rules(idea1_base(gates=g))
    assert g["invalid"] and r["verdict"] == "INCONCLUSIVE" and "validity" in r["why"][0]
    assert not ee.gate_failures(failed_final_briefs=0, missing=[], x_share={"sonnet": 0.65, "opus": 0.65}, steps_ran=20, n=20)["invalid"]
    # a verdict that would be a GO is still INCOMPLETE with missing data
    assert ee.verdict_of({"incomplete": ["m"], "invalid": []}, {"a": True}, {}, False, [])["verdict"] == "INCOMPLETE"


def test_position_x_share_ignores_ties_and_order_agreement_ignores_missing():
    assert ee.position_x_share(["X", "Y", "no real difference", None, "X"]) == 2 / 3 and ee.position_x_share(["no real difference"]) is None
    assert ee.order_agreement([[1, 1], [1, -1], [0, 0], [None, 1]]) == 2 / 3 and ee.order_agreement([]) is None


def idea2_base(**over):
    d = {"SvO": T(14, 3, 3), "LvO": T(6, 6, 8), "L2vO": T(5, 7, 8), "median_s8": 6, "median_s4": 3, "median_l4": 2, "code_fail_s": 2, "code_fail_o": 1,
         "sendback_s": 8, "sendback_o": 7, "cost_ok": True, "survival_measured": True, "confounded": False, "gates": OK_GATES}
    d.update(over)
    return d


def test_idea2_go_and_each_condition_alone_blocks_it():
    assert ee.idea2_rules(idea2_base())["verdict"] == "GO"
    breaks = {"sr": {"SvO": T(11, 4, 5)}, "rater": {"SvO": T(14, 3, 3, sonnet=(15, 3), opus=(7, 7))},
              "s8": {"median_s8": 4}, "gain": {"median_s4": 2, "median_l4": 2}, "code": {"code_fail_s": 5, "code_fail_o": 2},
              "sendback": {"sendback_s": 10, "sendback_o": 7}, "cost": {"cost_ok": False}}
    assert ee.idea2_rules(idea2_base(**{"LvO": T(9, 2, 9)}))["verdict"] == "GO"        # net(S) 11 - net(L) 7 = 4, exactly
    breaks["controls"] = {"LvO": T(10, 2, 8)}                                          # net(L) 8: the margin is 3
    for name, over in breaks.items():
        assert ee.idea2_rules(idea2_base(**over))["verdict"] in ("INCONCLUSIVE", "DROP"), name
        assert ee.idea2_rules(idea2_base(**over))["verdict"] != "GO", name


def test_idea2_variety_clause_is_read_on_the_equal_seed_sub_pool():
    assert ee.idea2_rules(idea2_base(median_s4=3, median_l4=2))["verdict"] == "GO"          # exactly 1 above
    r = ee.idea2_rules(idea2_base(median_s4=2, median_l4=2))                                # no higher than L's: DROP
    assert r["verdict"] == "DROP" and "S's first-4-plus-O median no higher than L's" in r["why"]
    assert ee.idea2_rules(idea2_base(median_s8=9, median_s4=2, median_l4=2))["verdict"] == "DROP"    # 8-pool counts alone never rescue it
    assert ee.idea2_rules(idea2_base(**{"SvO": T(8, 6, 6)}))["verdict"] == "DROP"


def test_idea2_unmeasured_survival_or_length_confound_stop_a_go():
    assert ee.idea2_rules(idea2_base(survival_measured=False))["verdict"] == "INCONCLUSIVE"
    assert ee.idea2_rules(idea2_base(confounded=True))["verdict"] == "INCONCLUSIVE"


def idea3_base(**over):
    d = {"R1vR0": T(13, 4, 3), "R0pvR0": T(3, 3, 14), "R1vO": T(12, 5, 3), "R0vO": T(6, 6, 8), "code_fail_r1": 2, "code_fail_r0": 1, "cost_ok": True,
         "unanswered_j1": 1, "unanswered_j0": 0, "split": {"both": 4, "only_R1": 3, "only_R0": 0, "neither": 0}, "confounded": False, "gates": OK_GATES}
    d.update(over)
    return d


def test_idea3_go_drop_and_the_go_via_more_send_backs_split():
    assert ee.idea3_rules(idea3_base())["verdict"] == "GO"
    r = ee.idea3_rules(idea3_base(split={"both": 2, "only_R1": 5, "only_R0": 0, "neither": 0}))
    assert r["verdict"] == "GO via more send-backs" and r["go_via_more_sendbacks"]
    r = ee.idea3_rules(idea3_base(split={"both": 4, "only_R1": 4, "only_R0": 0, "neither": 0}))     # exactly half is not more than half
    assert r["verdict"] == "GO"
    assert ee.idea3_rules(idea3_base(**{"R1vR0": T(8, 6, 6)}))["verdict"] == "DROP"
    assert ee.idea3_rules(idea3_base(**{"R1vO": T(4, 5, 11), "R0vO": T(10, 1, 9)}))["verdict"] == "DROP"     # 4 or more below
    assert ee.idea3_rules(idea3_base(**{"R1vO": T(5, 4, 11), "R0vO": T(10, 1, 9)}))["verdict"] != "GO"     # net 1 against net 9


def test_idea3_each_condition_alone_blocks_a_go_and_unanswered_tests_make_it_incomplete():
    breaks = {"sr": {"R1vR0": T(10, 4, 6)}, "rater": {"R1vR0": T(13, 4, 3, sonnet=(14, 3), opus=(6, 6))},
              "noise": {"R0pvR0": T(8, 0, 12)}, "ship": {"R1vO": T(6, 6, 8), "R0vO": T(9, 2, 9)}, "code": {"code_fail_r1": 5, "code_fail_r0": 1},
              "cost": {"cost_ok": False}}
    for name, over in breaks.items():
        assert ee.idea3_rules(idea3_base(**over))["verdict"] not in ("GO", "GO via more send-backs"), name
    assert ee.idea3_rules(idea3_base(unanswered_j1=3, unanswered_j0=0))["verdict"] == "INCOMPLETE"
    assert ee.idea3_rules(idea3_base(unanswered_j1=2, unanswered_j0=0))["verdict"] == "GO"
    assert ee.idea3_rules(idea3_base(confounded=True))["verdict"] == "INCONCLUSIVE"


def test_rewrite_split_counts_only_the_wins_by_who_was_rewritten():
    s = ee.rewrite_split([("W", True, True), ("W", True, False), ("W", False, True), ("W", False, False), ("L", True, False), ("T", True, False)])
    assert s == {"both": 1, "only_R1": 1, "only_R0": 1, "neither": 1}


def test_length_confound_needs_both_75_percent_of_wins_and_15_briefs():
    js = [(1, 20, 10)] * 15 + [(1, 10, 20)] * 5                       # 75% of non-tie judgements won by the longer text
    assert ee.length_confound(js, 15)["confounded"]
    assert not ee.length_confound(js, 14)["confounded"]
    js2 = [(1, 20, 10)] * 14 + [(1, 10, 20)] * 6                      # 70%
    assert not ee.length_confound(js2, 20)["confounded"]
    r = ee.length_confound([(0, 20, 10), (1, 5, 5), (-1, 5, 20), (1, 9, 3)], 3)      # a tie and an equal length are left out
    assert r["n"] == 2 and r["share_longer_wins"] == 1.0
    assert ee.length_confound([(-1, 20, 10)] * 4, 20)["share_longer_wins"] == 0.0 and ee.length_confound([], 20)["share_longer_wins"] is None


# =============================================================================================== the cost reservation (R5)
def test_reserve_refuses_a_call_that_could_pass_the_cap_counting_calls_in_flight(tmp_path):
    log = ee.replay_cost_log(tmp_path, 24.0)
    assert log.cap == 24.0
    held = [log.reserve("draft_brief_whole") for _ in range(4)]          # 2.00 in flight
    log.spent = 22.0                                                      # 22 + 2 + 0.5 > 24
    with pytest.raises(ee.BudgetExceeded):
        log.reserve("draft_brief_whole")
    log.settle(held[0], {"purpose": "draft_brief_whole", "cost_usd": 0.1, "ok": True})    # releases 0.5, spends 0.1
    assert log.reserved == 1.5 and abs(log.spent - 22.1) < 1e-9
    with pytest.raises(ee.BudgetExceeded):
        log.reserve("draft_brief_whole")                                  # 22.1 + 1.5 + 0.5 = 24.1 > 24
    assert log.reserve("rank_smp") == 0.10                                # 22.1 + 1.5 + 0.1 fits


def test_four_workers_with_the_stored_maximum_draft_cannot_pass_the_cap(tmp_path):
    log = ee.replay_cost_log(tmp_path, 24.0)
    log.spent = 22.4
    got, errs = [], []

    def worker():
        try:
            got.append(log.reserve("draft_brief_whole"))
        except ee.BudgetExceeded:
            errs.append(1)
    ts = [threading.Thread(target=worker) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(got) == 3 and len(errs) == 1                               # 22.4 + 3 x 0.5 = 23.9; the fourth would be 24.4
    assert log.spent + log.reserved <= 24.0 + 1e-9


def test_reserves_by_purpose_are_the_protocols(tmp_path):
    log = ee.replay_cost_log(tmp_path, 24.0)
    for p, r in (("draft_brief_whole", 0.5), ("explain_flags", 0.25), ("rewrite_brief_parts", 0.25), ("insight_hypotheses", 0.25),
                 ("rank_smp", 0.10), ("candidates_smp", 0.10), ("rank_insight", 0.10), ("smoke", 0.10)):
        assert log.reserve(p) == r


def test_a_call_with_no_cost_figure_is_logged_at_its_reserve_and_one_with_a_figure_at_the_figure(tmp_path):
    """F3: the reserve stands in only when there is no envelope (no usable figure); a failed call with a figure is that figure."""
    log = ee.replay_cost_log(tmp_path, 24.0)
    h = log.reserve("draft_brief_whole")
    log.settle(h, {"purpose": "draft_brief_whole", "ok": False, "error": "timeout"})
    h = log.reserve("explain_flags")
    log.settle(h, {"purpose": "explain_flags", "ok": True, "cost_usd": None})
    h = log.reserve("rank_smp")
    log.settle(h, {"purpose": "rank_smp", "ok": False, "cost_usd": 0.02})
    h = log.reserve("rank_smp")
    log.settle(h, {"purpose": "rank_smp", "ok": True, "cost_usd": 0.02})
    h = log.reserve("rank_smp")
    log.settle(h, {"purpose": "rank_smp", "ok": False, "cost_usd": float("nan")})       # not a usable figure
    h = log.reserve("rank_smp")
    log.settle(h, {"purpose": "rank_smp", "ok": False, "cost_usd": True})
    rows = ee.read_log(tmp_path / "cost_log.jsonl")
    assert [r["cost_usd"] for r in rows] == [0.5, 0.25, 0.02, 0.02, 0.10, 0.10]
    assert [r["cost_assumed_at_reserve"] for r in rows] == [True, True, False, False, True, True]
    assert log.reserved == 0 and abs(log.spent - 0.99) < 1e-9


def test_a_failed_call_that_reports_more_than_its_reserve_is_logged_at_what_it_reported(tmp_path):
    log = ee.replay_cost_log(tmp_path, 24.0)
    h = log.reserve("rank_smp")
    log.settle(h, {"purpose": "rank_smp", "ok": False, "cost_usd": 0.4})
    assert abs(log.spent - 0.4) < 1e-9


def test_the_cap_is_min_of_max_usd_and_the_hard_cap_and_earlier_spend_counts(tmp_path):
    assert ee.replay_cost_log(tmp_path / "a", 999.0).cap == ee.CFG["REPLAY_HARD_CAP_USD"] == 25.0
    assert ee.replay_cost_log(tmp_path / "b", 3.0).cap == 3.0
    p = tmp_path / "c"
    log = ee.replay_cost_log(p, 24.0)
    log.settle(log.reserve("rank_smp"), {"purpose": "rank_smp", "ok": True, "cost_usd": 23.95})
    again = ee.replay_cost_log(p, 24.0)
    assert abs(again.spent - 23.95) < 1e-9
    with pytest.raises(ee.BudgetExceeded):
        again.reserve("rank_smp")                                         # 23.95 + 0.10 > 24


def test_rater_cap_is_its_own_log_and_the_reserve_depends_on_the_model(tmp_path):
    log = ee.rater_cost_log(tmp_path)
    assert log.cap == 40.0 and log.path.name == "rater_cost_log.jsonl"
    assert log.reserve("rate:sonnet") == ee.CFG["RATER_RESERVE_USD"]["sonnet"] and log.reserve("rate:opus") == ee.CFG["RATER_RESERVE_USD"]["opus"]
    log.spent = 39.5
    with pytest.raises(ee.BudgetExceeded):
        log.reserve("rate:opus")


def pilot_rows(d=0.13, sv=0.05, f=0.05, jobs=1, nsv=2):
    """One pilot brief's calls exactly as protocol section 8 plans them (a rewrite row of 4)."""
    rows = []
    for j in range(jobs):
        job = f"c0{j + 1}"
        add = lambda purpose, arm, cost, n=1: rows.extend({"purpose": purpose, "cost_usd": cost, "arm": arm, "job": job} for _ in range(n))
        add("draft_brief_whole", "B", d, 3)
        add("insight_hypotheses", "H1", 0.07)
        add("rank_insight", "H1", 0.011)
        add("candidates_smp", "S", 0.032, 3)
        add("rank_smp", "S", 0.011, 3)
        add("explain_flags", "J0", f, 3)
        add("explain_flags", "SV1", sv, nsv)
        add("rewrite_brief_parts", "J0", 0.045, 4)
    return rows


def test_projection_uses_the_median_per_purpose_excludes_smoke_and_adds_ten_percent():
    rows = [{"purpose": "draft_brief_whole", "cost_usd": c, "arm": "B", "job": "c01"} for c in (0.1, 0.3, 0.2)] \
        + [{"purpose": "draft_brief_whole", "cost_usd": 9.0, "arm": "B", "job": "smoke"}, {"purpose": "smoke", "cost_usd": 1.0, "job": "smoke"}] \
        + [{"purpose": "explain_flags", "cost_usd": 0.04, "arm": "SV1", "job": "c01"}, {"purpose": "explain_flags", "cost_usd": 0.06, "arm": "J0", "job": "c01"}]
    p = ee.project_replay(rows, n_pilot=1, n_total=20)
    assert p["per_purpose"]["draft_brief_whole"]["median_usd"] == 0.2 and p["per_purpose"]["draft_brief_whole"]["planned_calls"] == 60
    # F4: the pilot made 2 explain_flags calls in its one brief; section 8 plans 5 a brief (J0, J0', J1, SV1, SV2): 5 wins
    ex = p["per_purpose"]["explain_flags"]
    assert ex["pilot_per_brief"] == 2 and ex["protocol_per_brief"] == 5 and ex["planned_calls"] == 100 and ex["median_usd"] == 0.05
    # a purpose the pilot never called takes the protocol's own estimate, flagged as such
    assert p["per_purpose"]["rank_smp"]["median_from"] == "protocol estimate" and p["per_purpose"]["rank_smp"]["planned_calls"] == 60
    per_brief = 0.2 * 3 + 0.07 + 0.011 + 0.032 * 3 + 0.011 * 3 + 0.05 * 5 + 0.045 * 4
    assert abs(p["total_usd"] - per_brief * 20 * 1.1) < 1e-6          # a median is not the pilot's total x 10
    lean = ee.project_replay(rows, 1, 20, include_survival=False)
    assert lean["per_purpose"]["explain_flags"]["median_usd"] == 0.06 and lean["per_purpose"]["explain_flags"]["protocol_per_brief"] == 3


def test_a_pilot_that_called_a_purpose_more_often_than_the_plan_projects_its_own_frequency():
    rows = [{"purpose": "draft_brief_whole", "cost_usd": 0.1, "arm": "B", "job": c} for c in ("c01", "c02") for _ in range(4)]     # 4 a brief (retries), plan 3
    d = ee.project_replay(rows, n_pilot=2, n_total=20)["per_purpose"]["draft_brief_whole"]
    assert d["pilot_per_brief"] == 4 and d["protocol_per_brief"] == 3 and d["planned_calls"] == 80
    one = [{"purpose": "draft_brief_whole", "cost_usd": 0.1, "arm": "B", "job": "c01"}]                                               # 1 a brief, plan 3
    assert ee.project_replay(one, 1, 20)["per_purpose"]["draft_brief_whole"]["planned_calls"] == 60


def test_the_plan_follows_the_arms_this_run_makes(monkeypatch):
    assert ee.planned_per_brief()["explain_flags"] == 5 and ee.planned_per_brief(False)["explain_flags"] == 3
    monkeypatch.setitem(ee.CFG, "INCLUDE_IDEA3", False)
    assert ee.planned_per_brief()["explain_flags"] == 4 and abs(ee.planned_per_brief()["rewrite_brief_parts"] - 8 / 3) < 1e-9
    assert "explain_flags" not in ee.planned_per_brief(False)         # idea 3 off and the reviews cut: J0 and J0' go too


def test_cut_order_is_survival_first_then_stop_and_never_l2():
    assert ee.cut_decision(pilot_rows(d=0.13, sv=0.05), 1, 20)["decision"] == "run_all"
    d = ee.cut_decision(pilot_rows(d=0.13, sv=0.5, nsv=4), 1, 20)       # the reviews retried and dear: they pull the median up
    assert d["decision"] == "drop_survival" and d["projection"]["total_usd"] > 23 >= d["projection_without_survival"]["total_usd"]
    assert ee.cut_decision(pilot_rows(d=0.3, sv=0.2), 1, 20)["decision"] == "stop"
    assert "L2" not in json.dumps(d) and ee.SURVIVAL_ARMS == ("SV1", "SV2")


def test_project_rater_is_the_median_per_call_cost_times_the_planned_judgements():
    rows = [{"rater": "sonnet", "job": "synthetic", "cost_usd": c} for c in (0.07, 0.09, 0.08)] + [{"rater": "opus", "job": "synthetic", "cost_usd": c} for c in (0.2, 0.15, 0.17)]
    m = ee.project_rater(rows, {"sonnet": 1000, "opus": 1000})
    assert abs(m["total_usd"] - (0.08 + 0.17) * 1000) < 1e-6 and m["over_cap"] is True
    assert ee.project_rater(rows, {"sonnet": 100, "opus": 100})["over_cap"] is False
    assert ee.project_rater([], {"sonnet": 5, "opus": 5})["total_usd"] is None


# =============================================================================================== variety on sub-pools
def test_distinct_ideas_counts_groups_and_left_out_numbers():
    assert ee.distinct_ideas([[1, 2], [3]], 4) == 3 and ee.distinct_ideas([], 3) == 3 and ee.distinct_ideas([[1, 2, 3, 4]], 4) == 1
    assert ee.distinct_ideas([[1, 2], [2, 3]], 3) == 2          # a number named twice counts in its first group
    assert ee.distinct_ideas([["1", 2.0], [3]], 3) == 2          # digits and whole floats are read as numbers


def test_distinct_ideas_refuses_what_it_cannot_read_never_the_most_favourable_count():
    for bad in (None, "x", [1, 2], [[1, 9]], [[0]], [[True]], [["a"]], {"a": 1}, [[1.5]]):
        assert ee.distinct_ideas(bad, 4) is None


def test_the_sub_pool_is_derived_by_keeping_only_those_numbers():
    groups = [[1, 5, 8], [2, 3], [4, 6]]                         # an 8-pool
    assert ee.distinct_ideas(groups, 8) == 4                     # {1,5,8} {2,3} {4,6} and 7 alone
    keep = {1, 2, 3, 4, 8}                                       # first four plus the baseline
    assert ee.distinct_ideas(groups, 8, keep) == 3               # {1,8} {2,3} {4}
    assert ee.distinct_ideas([[5, 6, 7]], 8, keep) == 5          # a group of numbers all outside the sub-pool counts for nothing
    assert ee.distinct_ideas([[1, 2, 3, 4, 8]], 8, keep) == 1 and ee.distinct_ideas([], 8, keep) == 5
    assert ee.distinct_ideas([[1, 9]], 8, keep) is None           # an unreadable answer stays missing


def test_variety_takes_the_lower_rater_per_brief_and_derives_the_first_four_plus_o_sub_pool():
    key = {"sameidea": {"i1": {"brief": "c01", "idea": 2, "pool": "S", "n": 8, "kind": "propositions",
                               "numbers": {str(n): {"source": "first_draft" if n == 8 else f"seed:{n - 1}", "idx": None if n == 8 else n - 1} for n in range(1, 9)}}}}
    # numbers 1..7 are draft idx 0..6; 8 is the first draft; the sub-pool keeps idx 0-3 and the baseline = numbers {1,2,3,4,8}
    r = {("sonnet", "i1"): {"groups": [[1, 2], [3, 4], [5, 6, 7, 8]]}, ("opus", "i1"): {"groups": [[1, 2, 3, 4, 8]]}}
    rating = lambda who, item: r.get((who, item))
    v8, v4 = ee.variety(key, rating, "S"), ee.variety(key, rating, "S", True)
    assert v8["per_brief"]["c01"] == 3 and v4["per_brief"]["c01"] == 1        # sonnet: {1,2} {3,4} {8}+...: 3 groups on 8; opus 4 on 8, 1 on 5
    assert v4["median"] == 1 and v8["median"] == 3
    missing = ee.variety(key, lambda who, item: r.get((who, item)) if who == "sonnet" else None, "S")
    assert missing["missing"] == ["c01"] and missing["per_brief"] == {} and missing["median"] is None


def test_variety_median_min_max_over_briefs():
    key = {"sameidea": {f"i{k}": {"brief": f"c{k}", "idea": 2, "pool": "L", "n": 3, "kind": "propositions", "numbers": {"1": {"source": "seed:0", "idx": 0}, "2": {"source": "seed:1", "idx": 1}, "3": {"source": "first_draft", "idx": None}}} for k in range(3)}}
    groups = {"i0": [[1, 2, 3]], "i1": [[1, 2]], "i2": []}
    rating = lambda who, item: {"groups": groups[item]}
    v = ee.variety(key, rating, "L")
    assert (v["median"], v["min"], v["max"]) == (2, 1, 3)


# =============================================================================================== pure steps
def test_edit_plan_touches_only_must_say_and_t1_differs_from_c1_in_the_insight_alone():
    p = stored_payload()
    c1, t1 = ee.edit_plan(p), ee.edit_plan(p, insight="The new insight")
    assert p == stored_payload()                                         # the stored payload is not mutated
    for k in ("single_minded_proposition", "objection"):
        assert c1["plan"]["parts"][k] == {"must_say": ee.RESET_MUST_SAY, "rests_on": "assumption"}
    assert c1["plan"]["parts"]["insight"] == p["plan"]["parts"]["insight"]
    assert t1["plan"]["parts"]["insight"] == {"must_say": "The new insight", "rests_on": "assumption"}        # R8: rests_on stays
    t1b = copy.deepcopy(t1)
    t1b["plan"]["parts"]["insight"] = c1["plan"]["parts"]["insight"]
    assert t1b == c1 and t1["who_handles"] == p["who_handles"]


def test_investigator_sees_no_strategy_no_insight_and_not_the_other_must_says_unless_the_switch_is_on():
    pay = ee.investigator_payload(stored_payload())
    assert set(pay) == {"client_said", "captured", "client_words", "facts", "findings", "research_upstream", "library", "plan", "write"}
    assert set(pay["plan"]) == {"brand", "competitors", "parts"} and set(pay["plan"]["parts"]) == {"audience", "background", "competitor_context"}
    assert "STRATEGY" not in json.dumps(pay) and "say insight" not in json.dumps(pay) and "say objection" not in json.dumps(pay)
    assert pay["write"] == 8
    assert ee.investigator_payload(stored_payload(), sees_strategy=True)["plan"]["strategy"] == "STRATEGY"
    ee.CFG["INVESTIGATOR_SEES_STRATEGY"] = True
    try:
        assert "strategy" in ee.investigator_payload(stored_payload())["plan"]
    finally:
        ee.CFG["INVESTIGATOR_SEES_STRATEGY"] = False


def test_investigator_system_is_the_field_system_plus_the_note_and_the_schema_holds_the_five_fields():
    s = ee.investigator_system()
    assert "GENUINELY DISTINCT drafts" in s and s.endswith(ee.INVESTIGATOR_NOTE) and "confidence" not in ee.INVESTIGATOR_NOTE.lower()
    assert "Each draft carries its own grounds" not in s
    sch = ee.hypothesis_schema()
    props = sch["properties"]["hypotheses"]["items"]["properties"]
    assert set(props) == {"value", "mechanism", "tension", "counter_evidence", "brand_role", "cites"} and sch["properties"]["hypotheses"]["maxItems"] == 8
    assert set(ee.hypothesis_schema(plain=True)["properties"]["hypotheses"]["items"]["properties"]) == {"value"}


def test_clean_hypotheses_drops_empty_duplicates_and_a_copy_of_the_plans_insight_and_splits_cites():
    raw = {"hypotheses": [{"value": "  A  "}, {"value": "a."}, {"value": ""}, {"value": "Plan insight"}, {"value": "B", "cites": ["psg_1", "f_9", 3]}]}
    got = ee.clean_hypotheses(raw, "To confirm: Plan insight.", {"psg_1"})
    assert [h["value"] for h in got] == ["A", "B"] and got[1]["cites_resolve"] == ["psg_1"] and got[1]["cites_dangling"] == ["f_9"]
    assert ee.rests_on_of(["f_1", "psg_1"]) == "research" and ee.rests_on_of(["psg_1"]) == "library" and ee.rests_on_of([]) == "assumption"


def test_choose_insight_skips_the_plans_own_and_over_50_words_and_none_is_no_gate():
    pool = [{"source": "hyp:0", "words": 60}, {"source": "plan", "words": 20}, {"source": "hyp:1", "words": 50}, {"source": "hyp:2", "words": 10}]
    assert ee.choose_insight(pool, [1, 0, 2, 3]) == 2           # the plan's is ranked first and never chosen; 60 words skipped; 50 passes
    assert ee.choose_insight(pool, [1, 0, 3, 2]) == 3
    assert ee.choose_insight([{"source": "hyp:0", "words": 51}, {"source": "plan", "words": 5}], [1, 0]) is None


def test_choose_new_prefers_an_unflagged_candidate_and_never_the_first_draft():
    pool = [{"source": "seed:0", "gate_ok": True, "and_flag": True}, {"source": "first_draft", "gate_ok": True, "and_flag": False},
            {"source": "seed:1", "gate_ok": True, "and_flag": False}, {"source": "seed:2", "gate_ok": False, "and_flag": False}]
    assert candidates.choose_new(pool, [0, 1, 2, 3]) == 2       # the flagged first, the unflagged below it wins, the first draft is skipped
    assert candidates.choose_new(pool, [3, 1, 0, 2]) == 2
    assert candidates.choose_new([pool[0], pool[1]], [0, 1]) == 0                      # all flagged: the best-ranked of them
    assert candidates.choose_new([pool[1], pool[3]], [0, 1]) is None                  # none clears the gate: no_gate
    assert candidates.choose_new([pool[1], pool[2]], [1, 0]) == 1


def test_generate_records_the_seed_index_modulo_the_seeds_it_was_given_and_the_draft_position():
    raw = {"candidates": [{"value": f"line {i}"} for i in range(7)]}
    call = lambda *a: raw
    got = candidates.generate(call, {}, 7, seeds=candidates.ROUTE_SEEDS)
    assert [c["seed"] for c in got] == list(range(7)) and [c["idx"] for c in got] == list(range(7))
    got = candidates.generate(call, {}, 7)                       # the ladder seeds: three are asked for twice
    assert [c["seed"] for c in got] == [0, 1, 2, 3, 0, 1, 2] and [c["idx"] for c in got] == list(range(7))
    pay = candidates.generate_payload(insight="I", strategy="S", parts={}, facts=[], findings=[], client_words=[], library=[], n=7, seeds=candidates.ROUTE_SEEDS)
    assert pay["angles"] == list(candidates.ROUTE_SEEDS) and len(candidates.ROUTE_SEEDS) == 7
    assert all(s.startswith("build it on ") for s in candidates.ROUTE_SEEDS)


def test_rank_note_replaces_the_default_and_counter_evidence_is_shown_when_present_and_defaults_are_unchanged():
    from napkin.brief import drafters
    seen = []
    call = lambda purpose, system, payload, schema: (seen.append((system, payload)) or {"ranking": [0, 1], "why_winner": "w", "losers": []})
    drafters.rank(call, "insight", [{"value": "a", "counter_evidence": "x"}, {"value": "b"}], context={"c": 1}, note="MY NOTE")
    assert seen[-1][0].endswith("\nMY NOTE") and seen[-1][1]["candidates"][0]["counter_evidence"] == "x" and "counter_evidence" not in seen[-1][1]["candidates"][1]
    drafters.rank(call, "smp", [{"value": "a"}], context={"c": 1})
    assert seen[-1][0].endswith(drafters.RANK_CONTEXT_NOTE)
    drafters.rank(call, "smp", [{"value": "a"}])
    assert "context" not in seen[-1][1] and drafters.RANK_CONTEXT_NOTE not in seen[-1][0]


def test_the_two_lines_from_the_protocol_are_what_the_protocol_says():
    assert ee.INSIGHT_REASON_FROM.startswith("Reason from the client's words") and ee.RESET_MUST_SAY == "Follow from the insight in this plan."
    assert ee.JUDE_J1_SENTENCE == "For the proposition also answer must_be_true and counter_argument, one sentence each, and use them in your instruction."
    assert ee.COUNTER_ARGUMENT["protocol"] == "What is the strongest counterargument? It fails when nothing in the brief answers it."
    assert ee.COUNTER_ARGUMENT["reviewer"].endswith("a doubt the reasons to believe or the objection should answer is not a fail.")
    assert ee.CFG["IDEA3_COUNTER_ARGUMENT_RULE"] == "reviewer"


# =============================================================================================== idea 3 pure parts
def whole_of(prop="One plain thought", insight="A true tension", **over):
    w = {k: entry(v) for k, v in (("insight", insight), ("single_minded_proposition", prop), ("objection", "A doubt"), ("job", "A job."))}
    w["reasons_to_believe"] = entry(["a reason"], "client")
    w.update(over)
    return w


def test_j0_payload_computes_empty_sets_chain_holds_to_0_8_and_flags_nothing():
    pay, tested, ask = ee.jude_variant_payload(stored_payload(), whole_of(), "J0")
    assert pay["chain_holds"] == 0.8 and pay["flagged"] == {} and pay["missing_dimensions"] == {} and pay["claims"] == {}
    assert tested == [k for k in checks.TESTED if k in whole_of()] and ask == pay["empty"]
    assert "open_questions" not in pay["empty"] and "audience" in pay["empty"] and "insight" not in pay["empty"]
    assert set(pay["tests"]) == set(tested) and "must_be_true" not in pay["tests"]["single_minded_proposition"]
    assert pay["part_checks"] == checks.facts(whole_of())
    sch = ee.jude_variant_schema(ask, tested, "J0")
    jsonschema.Draft202012Validator.check_schema(sch)
    assert "must_be_true" not in sch["properties"]["tests"]["properties"]["single_minded_proposition"]["properties"]


def test_j1_adds_two_tests_two_required_answer_fields_and_one_system_sentence_only_to_the_proposition():
    p0, tested, ask = ee.jude_variant_payload(stored_payload(), whole_of(), "J0")
    p1, tested1, ask1 = ee.jude_variant_payload(stored_payload(), whole_of(), "J1")
    assert tested == tested1 and ask == ask1
    assert p1["tests"]["single_minded_proposition"]["must_be_true"] == ee.MUST_BE_TRUE
    assert p1["tests"]["single_minded_proposition"]["counter_argument"] == ee.COUNTER_ARGUMENT["reviewer"]
    p1b = copy.deepcopy(p1)
    del p1b["tests"]["single_minded_proposition"]["must_be_true"], p1b["tests"]["single_minded_proposition"]["counter_argument"]
    assert p1b == p0                                                    # nothing else differs
    s0, s1 = ee.jude_variant_system(tested, "J0"), ee.jude_variant_system(tested, "J1")
    assert s1 == s0 + "\n" + ee.JUDE_J1_SENTENCE
    sch = ee.jude_variant_schema(ask, tested, "J1")
    node = sch["properties"]["tests"]["properties"]["single_minded_proposition"]
    assert {"must_be_true", "counter_argument"} <= set(node["required"]) and "must_be_true" not in sch["properties"]["tests"]["properties"]["insight"]["properties"]
    good = jude_answer()
    good["tests"]["single_minded_proposition"].update(must_be_true="m", counter_argument="c")
    good["parts"] = {k: {"rework": False, "why": "", "instruction": ""} for k in ask}
    jsonschema.Draft202012Validator(sch).validate(good)
    bare = jude_answer()
    bare["parts"] = good["parts"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.Draft202012Validator(sch).validate(bare)


def test_counter_argument_rule_is_a_switch_and_the_protocols_original_stays_selectable():
    ee.CFG["IDEA3_COUNTER_ARGUMENT_RULE"] = "protocol"
    try:
        p1, _, _ = ee.jude_variant_payload(stored_payload(), whole_of(), "J1")
        assert p1["tests"]["single_minded_proposition"]["counter_argument"] == "What is the strongest counterargument? It fails when nothing in the brief answers it."
    finally:
        ee.CFG["IDEA3_COUNTER_ARGUMENT_RULE"] = "reviewer"


def test_todo_from_jude_builds_the_instruction_as_production_does():
    keys = list(stored_payload()["parts"])
    P = "single_minded_proposition"
    tf = ee.todo_from_jude(jude_answer(prop_pass=False), [], ["insight", P], whole_of(), keys)
    assert tf["todo"][P] == "Say it without and." and tf["by"][P] == "jude" and tf["failed"] == [P]
    # nothing failed, code sends it back (a standalone and): code's instruction, by code
    tf = ee.todo_from_jude(jude_answer(), [], ["insight", P], whole_of(prop="Fast and cheap"), keys)
    assert tf["by"][P] == "code" and "standalone 'and'" in tf["todo"][P]
    # Jude failed it and code also names it: Jude's word stands, by both
    tf = ee.todo_from_jude(jude_answer(prop_pass=False), [], ["insight", P], whole_of(prop="Fast and cheap"), keys)
    assert tf["by"][P] == "both" and tf["todo"][P] == "Say it without and."
    # chain issue and a dimension fix are joined with the failed test, "... Also: ..."
    j = jude_answer(prop_pass=False, chain={"issue": "the proof does not follow", "parts": [P]},
                    dimensions=[{"dimension": "language", "instruction": "Use plainer words.", "parts": [P]}])
    tf = ee.todo_from_jude(j, [], ["insight", P], whole_of(), keys)
    assert tf["todo"][P] == "Make it follow the brief's one argument: the proof does not follow Also: Use plainer words. Also: Say it without and."
    # Jude's part note on an empty part
    tf = ee.todo_from_jude({"parts": {"audience": {"rework": True, "why": "w", "instruction": "Write it."}}, "tests": {}}, ["audience"], [], whole_of(), keys)
    assert tf["todo"] == {"audience": "Write it."}
    # a missing tests entry is unanswered, a pass-less entry too; neither asks for a rewrite
    tf = ee.todo_from_jude({"tests": {P: {"failed_test": "x"}}}, [], ["insight", P], whole_of(), keys)
    assert tf["unanswered"] == ["insight", P] and P not in tf["todo"]
    # a failed test with no instruction falls back to the test's name
    j = {"tests": {P: {"pass": False, "failed_test": "ownable", "instruction": ""}}}
    assert ee.todo_from_jude(j, [], [P], whole_of(), keys)["todo"][P] == "Fix what fails the ownable test."
    assert ee.todo_from_jude({"tests": {P: {"pass": False, "failed_test": "", "instruction": ""}}}, [], [P], whole_of(), keys)["todo"] == {}


def test_survival_counts_and_the_substituted_brief_for_a_winner():
    c = ee.survival_counts(jude_answer(prop_pass=False, ins_pass=False), whole_of(prop="Fast and cheap"))
    assert c["jude_fails_proposition"] and c["jude_fails_insight"] and c["code_sends_proposition"] and not c["code_sends_insight"] and c["unanswered"] == []
    assert ee.survival_counts({}, whole_of())["unanswered"] == ["single_minded_proposition", "insight"]
    w = whole_of(prop="To confirm: Original")
    w["single_minded_proposition"]["cites"] = ["psg_1"]
    sub = ee.substitute_proposition(w, "A winning line")
    assert sub["single_minded_proposition"]["value"] == "To confirm: A winning line" and sub["single_minded_proposition"]["cites"] == ["psg_1"]
    assert sub["single_minded_proposition"]["basis"] == "assumption" and w["single_minded_proposition"]["value"] == "To confirm: Original"
    client = whole_of()
    client["single_minded_proposition"]["basis"] = "client"
    client["insight"]["basis"] = "client"
    assert ee.substitute_proposition(client, "A line")["single_minded_proposition"]["value"] == "A line"


def test_code_flags_measure_what_code_can_measure():
    f = ee.code_flags("To confirm: Fast and cheap, always", "smp")
    assert f["standalone_and"] and f["single_minded_flag"] and f["fails_code_check"] and not f["over_limit"] and f["words"] == 4
    assert ee.code_flags("word " * 21, "smp")["over_limit"] and not ee.code_flags("word " * 21, "smp")["sent_back_length"]
    assert ee.code_flags("word " * 24, "smp")["sent_back_length"]
    assert ee.code_flags("One. Two.", "smp")["multi_sentence"] and ee.code_flags("Plain thought", "smp")["fails_code_check"] is False
    assert ee.code_flags("A thing: another", "smp")["colon_semicolon_dash"]
    i = ee.code_flags("word " * 51, "insight")
    assert i["over_limit"] and not i["sent_back_length"] and ee.code_flags("word " * 58, "insight")["sent_back_length"] and not ee.code_flags("word " * 57, "insight")["sent_back_length"]


# =============================================================================================== the arms with a scripted model
def test_b_is_one_draft_call_exactly_as_production_sends_it(tmp_path):
    from napkin.brief.planned import DRAFT_SYSTEM
    inp = make_inp()
    fake = Fake(standard_handlers())
    res = ee.arm_B(fake, inp, {})
    s = fake.seen[0]
    assert s["purpose"] == "draft_brief_whole" and s["system"] == DRAFT_SYSTEM and s["payload"] == inp["payload"]
    assert set(s["schema"]["properties"]) == set(PARTS)
    assert res["insight"].startswith("To confirm:") and res["proposition"].startswith("To confirm:")       # mark_assumptions ran


def test_c1_and_t1_send_the_edited_plan_and_t1_carries_the_chosen_insight(tmp_path):
    inp = make_inp()
    fake = Fake(standard_handlers())
    h = ee.arm_H1(fake, inp, {})
    assert "status" not in h
    assert [s["purpose"] for s in fake.seen] == ["insight_hypotheses", "rank_insight"]
    hyp_call, rank_call = fake.seen
    assert hyp_call["payload"] == ee.investigator_payload(inp["payload"]) and "STRATEGY" not in json.dumps(hyp_call["payload"])
    texts = [c["value"] for c in rank_call["payload"]["candidates"]]
    assert len(texts) == 9 and ee.tidy("say insight") in texts            # the plan's insight is in the pool, tidy
    plan_row = next(c for c in rank_call["payload"]["candidates"] if c["value"] == ee.tidy("say insight"))
    assert plan_row["counter_evidence"] == "" and all("counter_evidence" in c for c in rank_call["payload"]["candidates"])
    assert rank_call["system"].endswith(ee.INSIGHT_RANK_NOTE) and set(rank_call["payload"]["context"]) == {"audience", "background", "competitor_context", "client_said"}
    assert rank_call["payload"]["context"]["audience"] == "Adults 20 to 45" and rank_call["payload"]["context"]["competitor_context"] == "say competitor_context"
    # the ranker (identity order over the shown order) puts the first shown first: the chosen one is a new hypothesis
    assert h["chosen_value"].startswith("Hypothesis") and h["chosen_rests_on"] in ("library", "assumption") and h["plan_rank"] >= 0
    t1 = ee.arm_T1(Fake(standard_handlers()), inp, {"H1": {"status": "ok", **h}})
    c1 = ee.arm_C1(Fake(standard_handlers()), inp, {})
    t1_fake = Fake(standard_handlers())
    ee.arm_T1(t1_fake, inp, {"H1": {"status": "ok", **h}})
    assert t1_fake.seen[0]["payload"]["plan"]["parts"]["insight"]["must_say"] == h["chosen_value"]
    assert t1_fake.seen[0]["payload"]["plan"]["parts"]["single_minded_proposition"]["must_say"] == ee.RESET_MUST_SAY
    assert ee.arm_T1(Fake(standard_handlers()), inp, {"H1": {"status": "no_gate"}}) == {"status": "no_gate"}


def test_the_hypothesis_step_is_no_gate_when_none_is_within_50_words_and_fails_on_an_empty_answer():
    inp = make_inp()
    long = standard_handlers(insight_hypotheses=lambda s, p, sc: {"hypotheses": [{"value": "w " * 60}]})
    assert ee.arm_H1(Fake(long), inp, {})["status"] == "no_gate"
    with pytest.raises(ValueError):
        ee.arm_H1(Fake(standard_handlers(insight_hypotheses=lambda s, p, sc: {"hypotheses": []})), inp, {})


def routes_deps(inp):
    return {"B": {"status": "ok", **ee.arm_B(Fake(standard_handlers()), inp, {})}}


def test_route_arms_differ_only_in_the_seeds_and_choose_a_new_candidate_never_the_baseline():
    inp = make_inp()
    deps = routes_deps(inp)
    seen = {}
    for name, fn in (("L", ee.arm_L), ("L2", ee.arm_L2), ("S", ee.arm_S)):
        f = Fake(standard_handlers())
        res = fn(f, inp, deps)
        seen[name] = f.seen
        assert [s["purpose"] for s in f.seen] == ["candidates_smp", "rank_smp"] and res["winner_source"].startswith("seed:")
        assert len(res["pool"]) == 8 and res["pool"][-1]["source"] == "first_draft"
        assert "Stored line" not in json.dumps(f.seen[0]["payload"]) and deps["B"]["proposition"] not in json.dumps(f.seen[0]["payload"])   # B's proposition is never shown
        assert f.seen[0]["payload"]["insight"] == "insight text drafted" or "drafted" in f.seen[0]["payload"]["insight"]
    assert seen["L"][0]["payload"]["angles"] == seen["L2"][0]["payload"]["angles"] == [candidates.SMP_ANGLE_SEEDS[i % 4] for i in range(7)]
    assert seen["S"][0]["payload"]["angles"] == list(candidates.ROUTE_SEEDS)
    a, b = copy.deepcopy(seen["S"][0]["payload"]), seen["L"][0]["payload"]
    a["angles"] = b["angles"]
    assert a == b and seen["S"][0]["system"] == seen["L"][0]["system"]
    L = ee.arm_L(Fake(standard_handlers()), inp, deps)
    assert L["winner_seed"] in range(4) and L["kept_by_ranker"] in (True, False) and L["winner_source"] == f"seed:{L['winner_seed']}"


def test_route_arm_records_the_seed_index_modulo_the_seeds_and_no_gate_when_nothing_clears():
    inp = make_inp()
    deps = routes_deps(inp)
    h = standard_handlers(rank_smp=lambda s, p, sc: {"ranking": list(reversed(range(len(p["candidates"])))), "why_winner": "w", "losers": []})
    res = ee.arm_S(Fake(h), inp, deps)
    assert res["winner_seed"] == 6 or res["winner_seed"] in range(7)
    h2 = standard_handlers(candidates_smp=lambda s, p, sc: {"candidates": [{"value": "word " * 30}]})
    assert ee.arm_S(Fake(h2), inp, deps)["status"] == "no_gate"
    h3 = standard_handlers(candidates_smp=lambda s, p, sc: {"candidates": []})
    with pytest.raises(ValueError):
        ee.arm_S(Fake(h3), inp, deps)


def test_idea3_arms_run_the_review_then_at_most_two_rewrites_and_neither_named_means_no_call():
    inp = make_inp()
    deps = routes_deps(inp)
    f = Fake(standard_handlers())
    r = ee.arm_J0(f, inp, deps)
    assert [s["purpose"] for s in f.seen] == ["explain_flags"] and r["proposition"] == deps["B"]["proposition"] and not r["rewritten"] and r["sent_by"] is None
    f = Fake(standard_handlers(explain_flags=lambda s, p, sc: jude_answer(prop_pass=False)))
    r = ee.arm_J0(f, inp, deps)
    assert [s["purpose"] for s in f.seen] == ["explain_flags", "rewrite_brief_parts"] and r["sent_by"] == "jude" and r["rewritten"]
    rw = f.seen[1]
    assert rw["payload"]["rewrite"] == {"single_minded_proposition": "Say it without and."} and rw["payload"]["prior_claims"] == {"single_minded_proposition": []}
    from napkin.brief.planned import DRAFT_SYSTEM, REWRITE_NOTE
    assert set(rw["payload"]["parts"]) == {"single_minded_proposition"} and rw["system"] == DRAFT_SYSTEM + REWRITE_NOTE
    assert r["proposition"] == "To confirm: Rewritten line"
    # still flagged after the rewrite: one more, on code's instruction, with the redraft payload; then stop
    f = Fake(standard_handlers(explain_flags=lambda s, p, sc: jude_answer(prop_pass=False),
                               rewrite_brief_parts=lambda s, p, sc: {"single_minded_proposition": entry("Fast and cheap")}))
    r = ee.arm_J0(f, inp, deps)
    assert [s["purpose"] for s in f.seen] == ["explain_flags", "rewrite_brief_parts", "rewrite_brief_parts"] and r["rewrites"][1]["by"] == "code"
    assert "captured" in f.seen[2]["payload"] and "captured" not in f.seen[1]["payload"] and "standalone 'and'" in f.seen[2]["payload"]["rewrite"]["single_minded_proposition"]
    # code alone sends it back (B has a standalone and), Jude passes it
    deps_and = {"B": {"status": "ok", **ee.arm_B(Fake(standard_handlers(draft_brief_whole=lambda s, p, sc: draft_reply(prop="Fast and cheap"))), inp, {})}}
    f = Fake(standard_handlers())
    r = ee.arm_J0(f, inp, deps_and)
    assert r["sent_by"] == "code" and r["rewritten"] and [s["purpose"] for s in f.seen] == ["explain_flags", "rewrite_brief_parts"]


def test_j1_call_carries_the_extra_tests_and_a_null_rewrite_leaves_the_proposition_standing():
    inp = make_inp()
    deps = routes_deps(inp)
    h = standard_handlers(explain_flags=lambda s, p, sc: {**jude_answer(prop_pass=False)},
                          rewrite_brief_parts=lambda s, p, sc: {"single_minded_proposition": None})
    f = Fake(h)
    r = ee.arm_J1(f, inp, deps)
    assert "must_be_true" in f.seen[0]["payload"]["tests"]["single_minded_proposition"] and f.seen[0]["system"].endswith(ee.JUDE_J1_SENTENCE)
    assert r["proposition"] == deps["B"]["proposition"] and r["rewrites"][0]["changed"] is False


def test_survival_arms_read_the_t1_draft_and_the_substituted_brief_and_skip_a_no_gate():
    inp = make_inp()
    deps = routes_deps(inp)
    t1 = {"status": "ok", **ee.arm_T1(Fake(standard_handlers()), inp, {"H1": {"status": "ok", "chosen_value": "Chosen"}})}
    f = Fake(standard_handlers())
    r = ee.arm_SV1(f, inp, {"B": deps["B"], "T1": t1})
    assert [s["purpose"] for s in f.seen] == ["explain_flags"] and "Chosen" in json.dumps(f.seen[0]["payload"]["brief"]) and "jude_fails_proposition" in r
    s = {"status": "ok", "winner_value": "A winning line"}
    f = Fake(standard_handlers())
    ee.arm_SV2(f, inp, {"B": deps["B"], "S": s})
    assert f.seen[0]["payload"]["brief"]["single_minded_proposition"] == "To confirm: A winning line"
    assert ee.arm_SV1(Fake({}), inp, {"B": deps["B"], "T1": {"status": "no_gate"}}) == {"status": "no_gate"}
    assert ee.arm_SV2(Fake({}), inp, {"B": deps["B"], "S": {"status": "no_gate"}}) == {"status": "no_gate"}


# =============================================================================================== running arms
def test_process_brief_runs_every_arm_in_the_protocols_order_and_keeps_settled_arms(tmp_path):
    out = tmp_path / "out"
    inp = make_inp()
    order = []
    fk = Fake(standard_handlers())
    arms = ee.process_brief(out, inp, lambda job, arm: (order.append(arm) or fk))
    assert order and [n for n, *_ in ee.arm_specs()] == ["B", "C1", "H1", "T1", "L", "L2", "S", "J0", "J0p", "J1", "SV1", "SV2"]
    assert all(a["status"] == "ok" for a in arms.values()) and (out / "arms/c01/SV2.json").exists()
    n_before = len(fk.seen)
    ee.process_brief(out, inp, lambda job, arm: fk)
    assert len(fk.seen) == n_before                                    # settled arms are not run again


def test_the_replay_run_is_force_free_of_survival_when_skipped_and_idea3_is_a_switch(tmp_path):
    out = tmp_path / "out"
    arms = ee.process_brief(out, make_inp(), lambda j, a: Fake(standard_handlers()), skip=ee.SURVIVAL_ARMS)
    assert "SV1" not in arms and "J1" in arms
    ee.CFG["INCLUDE_IDEA3"] = False
    try:
        # J0 and J0' are the survival reviews' baseline, so they stay; only J1 and idea 3's comparisons go (F2)
        names = {n for n, *_ in ee.arm_specs()}
        assert {"J0", "J0p"} <= names and "J1" not in names and not any(c[1] == 3 for c in ee.comparisons())
    finally:
        ee.CFG["INCLUDE_IDEA3"] = True


def test_the_optional_arms_are_switches_and_off_by_default():
    names = {n for n, *_ in ee.arm_specs()}
    assert "H1p" not in names and "T1p" not in names and "D0vB" not in {c[0] for c in ee.comparisons()}
    ee.CFG["INCLUDE_PLAIN_BEST_OF_8"], ee.CFG["INCLUDE_D0_V_B"] = True, True
    try:
        assert {"H1p", "T1p"} <= {n for n, *_ in ee.arm_specs()} and {"D0vB", "T1vT1p.ins"} <= {c[0] for c in ee.comparisons()}
    finally:
        ee.CFG["INCLUDE_PLAIN_BEST_OF_8"], ee.CFG["INCLUDE_D0_V_B"] = False, False


def test_an_arm_runs_at_most_twice_then_is_failed_final_and_the_failed_runs_are_kept(tmp_path):
    p = tmp_path / "x.json"
    calls = []

    def fn(caller, deps):
        calls.append(1)
        raise ValueError("bad")
    d = ee.execute_arm(p, fn, lambda: Fake({}), {})
    assert d["status"] == "FAILED_final" and d["runs"] == 2 and len(calls) == 2 and len(d["failed_runs"]) == 2
    assert ee.execute_arm(p, fn, lambda: Fake({}), {})["status"] == "FAILED_final" and len(calls) == 2     # never a third run
    ok = ee.execute_arm(tmp_path / "y.json", lambda c, dp: (_ for _ in ()).throw(ValueError("x")) if not calls.append(1) and len(calls) < 4 else {"v": 1}, lambda: Fake({}), {})
    assert ok["status"] == "ok" and ok["runs"] == 2 and ok["failed_runs"]                                  # the second run succeeded


def test_a_budget_stop_is_not_failed_final_and_stops_the_run(tmp_path):
    p = tmp_path / "x.json"

    def fn(caller, deps):
        raise ee.BudgetExceeded("cap")
    with pytest.raises(ee.StopRun):
        ee.execute_arm(p, fn, lambda: Fake({}), {})
    assert json.loads(p.read_text())["status"] == "budget_stopped"
    d = ee.execute_arm(p, lambda c, dp: {"v": 1}, lambda: Fake({}), {})        # a later run picks it up
    assert d["status"] == "ok"


def test_a_dependency_that_failed_makes_the_arm_failed_final_without_a_call(tmp_path):
    called = []
    d = ee.execute_arm(tmp_path / "x.json", lambda c, dp: called.append(1), lambda: Fake({}), {"B": {"status": "FAILED_final"}})
    assert d["status"] == "FAILED_final" and not called and d["runs"] == 0
    assert ee.execute_arm(tmp_path / "y.json", lambda c, dp: {"status": "no_gate"}, lambda: Fake({}), {"H1": {"status": "no_gate"}})["status"] == "no_gate"


def test_a_force_rerun_moves_the_earlier_arms_aside_and_writes_the_reason(tmp_path):
    out = tmp_path / "out"
    (out / "arms/c01").mkdir(parents=True)
    (out / "arms/c01/B.json").write_text("{}")
    ee._discard(out, ["c01"], "a harness fault")
    assert not (out / "arms/c01").exists() and list((out / "pilot_discarded").glob("c01-*/B.json"))
    assert "a harness fault" in (out / "changes.md").read_text()


# =============================================================================================== raters
def test_rate_item_asks_again_at_most_three_times_then_the_judgement_is_missing(tmp_path):
    log = ee.rater_cost_log(tmp_path)
    n = []
    got, calls = ee.rate_item("sonnet", {"item": "i", "kind": "pair", "prompt": "p"}, log, lambda *a: n.append(1))
    assert got is None and calls == 4 and len(n) == 4
    seq = iter([None, None, {"better": "X"}])
    got, calls = ee.rate_item("sonnet", {"item": "i", "kind": "pair", "prompt": "p"}, log, lambda *a: next(seq))
    assert got == {"better": "X"} and calls == 3


def test_rate_item_lets_a_budget_stop_through_and_treats_a_crash_as_unusable():
    def boom(*a):
        raise ee.BudgetExceeded("cap")
    with pytest.raises(ee.BudgetExceeded):
        ee.rate_item("opus", {"item": "i", "kind": "pair", "prompt": "p"}, None, boom)
    seq = iter([RuntimeError("x"), {"better": "Y"}])

    def flaky(*a):
        v = next(seq)
        if isinstance(v, Exception):
            raise v
        return v
    assert ee.rate_item("opus", {"item": "i", "kind": "pair", "prompt": "p"}, None, flaky) == ({"better": "Y"}, 2)


def test_usable_answers_and_pick_normalisation():
    assert ee.usable({"better": "x."}, "pair") and ee.usable({"better": " No real difference "}, "pair") and not ee.usable({"better": "Z"}, "pair")
    assert not ee.usable({"better_insight": "X"}, "pair") and not ee.usable("X", "pair") and not ee.usable({}, "pair")
    assert ee.usable({"groups": [[1, 2], [3]]}, "sameidea", 3) and not ee.usable({"groups": [[1, 4]]}, "sameidea", 3)


def test_rater_call_is_shaped_as_r1_requires():
    argv = ee.rater_argv("opus")
    assert argv[:2] == [ee.CLAUDE, "-p"] and argv[argv.index("--effort") + 1] == "medium" and argv[argv.index("--model") + 1] == "claude-opus-5-5"
    for flag in ("--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"):
        assert flag in argv
    assert argv[argv.index("--setting-sources") + 1] == "" and ee.RATER_SYSTEM == "You are an impartial judge. Answer only with the JSON asked for."
    assert "--system-prompt-file" not in argv        # added by run_claude over a pipe, with --tools ""


def test_run_claude_puts_the_system_prompt_on_a_pipe_and_no_tools_last(tmp_path, monkeypatch):
    seen = {}

    class P:
        pid = 1
        returncode = 0

        def communicate(self, input=None, timeout=None):
            seen["stdin"] = input
            return json.dumps({"result": "{}", "total_cost_usd": 0.01}), ""

    def popen(argv, **kw):
        seen["argv"], seen["cwd"] = argv, kw["cwd"]
        return P()
    monkeypatch.setattr(ee.subprocess, "Popen", popen)
    env = ee.run_claude(["claude", "-p"], "prompt", "SYSTEM", 5, tmp_path)
    a = seen["argv"]
    assert env["total_cost_usd"] == 0.01 and a[-2:] == ["--tools", ""] and a[a.index("--system-prompt-file") + 1].startswith("/dev/fd/")
    assert "SYSTEM" not in " ".join(a) and seen["stdin"] == "prompt"


def test_the_synthetic_item_is_made_up_not_one_of_the_briefs():
    it = ee.synthetic_item()
    assert "Fleetwell" in it["prompt"] and "van" in it["prompt"] and it["kind"] == "pair"


def test_frozen_prompts_are_the_amendments():
    assert "Do not pick a draft because its insight is more interesting: judge the proposition alone." in ee.PROPOSITION_PROMPT
    assert "Decide which INSIGHT is better for this brief." in ee.INSIGHT_PROMPT and "better_insight" not in ee.INSIGHT_PROMPT + ee.PROPOSITION_PROMPT
    assert "Proposition:" not in ee.INSIGHT_PROMPT and "same text" not in ee.INSIGHT_PROMPT
    assert ee.INSIGHT_PROMPT.count("Length and polish are not merits.") == 1
    md = ee.rating_prompts_text()
    assert "Effort: medium" in md and ee.RATER_SYSTEM in md


# =============================================================================================== analysis end to end
def rating_for(key, prefer):
    """A fake rater that picks the side named in `prefer` (an arm) in every comparison it appears in; else a coin."""
    def rating(who, item):
        k = key["pairs"].get(item)
        if k is None:
            s = key["sameidea"][item]
            return {"groups": [[1, 2]] if s["pool"] == "S" else []}
        if prefer in (k["X"], k["Y"]):
            return {"better": "X" if k["X"] == prefer else "Y"}
        return {"better": "no real difference"}
    return rating


def test_analyse_end_to_end_a_rater_that_always_prefers_s_gives_s_twenty_wins(tmp_path):
    bids = [f"c{i:02d}" for i in range(1, 21)]
    out, inputs, arms_by, packets, key = packets_for(tmp_path, bids)
    res = ee.analyse(out, inputs, arms_by, key, rating_for(key, "S"))
    t = res["tallies"]["SvO"]
    assert (t["W"], t["L"], t["T"]) == (20, 0, 0) and t["missing"] == []
    assert res["idea2"]["rules"]["go_conditions"]["SR on S v O"] is True and res["idea2"]["rules"]["go_conditions"]["each rater alone W > L"] is True
    assert res["tallies"]["T1vC1.ins"]["T"] == 20 and res["idea1"]["rules"]["verdict"] in ("DROP", "INCONCLUSIVE", "INCOMPLETE")
    assert isinstance(ee.render_md(res), str) and "Idea 2" in ee.render_md(res)


def test_analyse_marks_a_missing_rating_incomplete_never_a_score(tmp_path):
    bids = [f"c{i:02d}" for i in range(1, 21)]
    out, inputs, arms_by, packets, key = packets_for(tmp_path, bids)
    base = rating_for(key, "S")
    dropped = next(i for i, k in key["pairs"].items() if k["comparison"] == "SvO")
    res = ee.analyse(out, inputs, arms_by, key, lambda who, item: None if (who == "opus" and item == dropped) else base(who, item))
    t = res["tallies"]["SvO"]
    assert t["W"] == 19 and len(t["missing"]) == 1 and res["idea2"]["rules"]["verdict"] == "INCOMPLETE"


def test_analyse_position_bias_leaves_no_quality_verdict(tmp_path):
    bids = [f"c{i:02d}" for i in range(1, 21)]
    out, inputs, arms_by, packets, key = packets_for(tmp_path, bids)
    res = ee.analyse(out, inputs, arms_by, key, lambda who, item: {"better": "X"} if item in key["pairs"] else {"groups": []})
    assert res["idea2"]["rules"]["verdict"] == "INCONCLUSIVE" and "validity" in res["idea2"]["rules"]["why"][0]
    assert res["idea2"]["x_share"]["sonnet"] == 1.0


def test_cmd_analyse_writes_the_two_files_and_a_stale_key_is_incomplete(tmp_path):
    bids = [f"c{i:02d}" for i in range(1, 21)]
    out, inputs, arms_by, packets, key = packets_for(tmp_path, bids)
    (out / "inputs").mkdir()
    (out / "inputs/selection.json").write_text(json.dumps({"runs": [{"id": i["id"]} for i in inputs]}))
    for i in inputs:
        (out / "inputs" / f"{i['id']}.json").write_text(json.dumps(i))
    (out / "ratings").mkdir()
    ee.write_run_config(out)
    key["results_sha256"] = "stale"
    (out / "key.json").write_text(json.dumps(key))
    ee.cmd_analyse(type("A", (), {"out": str(out)})())
    res = json.loads((out / "analysis.json").read_text())
    assert (out / "analysis.md").exists() and res["stale_key"] and res["idea1"]["rules"]["verdict"] == "INCOMPLETE"
    key["results_sha256"] = ee.results_hash(out)
    (out / "key.json").write_text(json.dumps(key))
    ee.cmd_analyse(type("A", (), {"out": str(out)})())
    assert not json.loads((out / "analysis.json").read_text())["stale_key"]


def test_cmd_packets_refuses_while_an_arm_is_unsettled_but_not_for_a_failed_final_one(tmp_path):
    out, inputs, arms_by = run_arms(tmp_path, ["c01"])
    ee.write_run_config(out)
    (out / "inputs").mkdir()
    (out / "inputs/selection.json").write_text(json.dumps({"runs": [{"id": "c01"}]}))
    (out / "inputs/c01.json").write_text(json.dumps(inputs[0]))
    p = out / "arms/c01/J1.json"
    d = json.loads(p.read_text())
    p.write_text(json.dumps({**d, "status": "budget_stopped"}))
    with pytest.raises(SystemExit):
        ee.cmd_packets(type("A", (), {"out": str(out)})())
    p.write_text(json.dumps({"status": "FAILED_final", "calls": [], "failed_runs": [], "runs": 2}))
    ee.cmd_packets(type("A", (), {"out": str(out)})())
    key = json.loads((out / "key.json").read_text())
    assert key["auto_ties"]["c01|R1vR0"] and key["results_sha256"] == ee.results_hash(out) and (out / "rating_prompts.md").exists()


def test_cmd_rate_refuses_before_the_rater_cost_is_measured(tmp_path):
    with pytest.raises(SystemExit):
        ee.cmd_rate(type("A", (), {"out": str(tmp_path), "raters": ["sonnet"], "retry_missing": False})())


def test_the_config_block_holds_the_owners_defaults():
    c = ee.CFG
    assert c["RATER_HARD_CAP_USD"] == 40.0 and c["REPLAY_HARD_CAP_USD"] == 25.0 and c["REPLAY_WORKING_LIMIT_USD"] == 24.0
    assert c["INCLUDE_IDEA3"] is True and c["IDEA3_COUNTER_ARGUMENT_RULE"] == "reviewer" and c["INCLUDE_PLAIN_BEST_OF_8"] is False
    assert c["INCLUDE_D0_V_B"] is False and c["INVESTIGATOR_SEES_STRATEGY"] is False and c["RATER_EFFORT"] == "medium"


def test_the_preregistered_constants_are_the_protocols():
    assert (ee.MIN_DECIDED, ee.MIN_WINS, ee.MARGIN_NET, ee.EXTRA_MAX) == (5, 8, 4, 2)
    assert (ee.COST_LINE_USD, ee.COST_LINE_SECS, ee.X_BIAS_MAX, ee.STEPS_MIN_OF_20) == (0.15, 60.0, 0.65, 18)
    assert (ee.LENGTH_SHARE, ee.LENGTH_BRIEFS, ee.MEDIAN_IDEAS_MIN, ee.SUB_POOL_GAIN) == (0.75, 15, 5, 1)
    assert ee.PROJECTION_CUT_USD == 23.0 and ee.PROJECTION_MARGIN == 1.10 and ee.PILOT_BRIEFS == ("c01", "t01")
    assert ee.RESERVE_USD == {"draft_brief_whole": 0.5, "explain_flags": 0.25, "rewrite_brief_parts": 0.25, "insight_hypotheses": 0.25} and ee.RESERVE_DEFAULT_USD == 0.10
    assert ee.MAX_TOKENS == {"draft_brief_whole": 16000, "explain_flags": 6000, "rewrite_brief_parts": 8000} and ee.MAX_TOKENS_DEFAULT == 12000
    assert ee.routes_doc()["purposes"]["insight_hypotheses"] == {"effort": "medium"} and ee.routes_doc()["purposes"]["draft_brief_whole"] == {"effort": "medium"}
    assert "rank_insight" not in ee.routes_doc()["purposes"] and "explain_flags" not in ee.routes_doc()["purposes"]


# =============================================================================================== the whole flow against a fake CLI
def test_the_whole_flow_runs_against_a_fake_claude_cli(tmp_path, monkeypatch):
    """select, smoke, pilot, replay, packets, measure-raters, rate, analyse through the real call path (ModelPort, the
    argv, the system prompt on a pipe, the reserve and the cost logs) with a CLI that answers schema-valid junk."""
    from pathlib import Path
    from types import SimpleNamespace
    monkeypatch.setattr(ee, "CLAUDE", str(Path(__file__).parent / "fake_claude.py"))
    monkeypatch.setattr(ee, "RATER_CWD", tmp_path / "cwd")
    src, out = fake_source(tmp_path, ids=("c01", "t01", "c02")), tmp_path / "out"
    A = SimpleNamespace(out=str(out), src=str(src), max_usd=24.0, only=None, force=False, reason=None, raters=["sonnet", "opus"], retry_missing=False, rater="opus")
    ee.cmd_select(A)
    with pytest.raises(SystemExit):
        ee.cmd_replay(A)                                                   # not before the pilot
    ee.cmd_smoke(A)
    ee.cmd_pilot(A)
    pilot = json.loads((out / "pilot.json").read_text())
    assert pilot["decision"] == "run_all" and sorted(p.name for p in (out / "arms").iterdir()) == ["c01", "t01"]
    with pytest.raises(SystemExit):
        ee.cmd_pilot(A)                                                    # the pilot runs once
    ee.cmd_replay(A)
    arms = ee.load_arms(out, ["c01", "t01", "c02"])
    assert all(a["status"] in ee.OK_STATUS for b in arms.values() for a in b.values()), {b: {k: v.get("error") for k, v in a.items() if v["status"] not in ee.OK_STATUS} for b, a in arms.items()}
    assert len(arms["c01"]) == 12
    rows = ee.read_log(out / "cost_log.jsonl")
    assert rows and all(r["reserve_usd"] > 0 and r["ok"] for r in rows) and {r["effort"] for r in rows if r["purpose"] == "draft_brief_whole"} == {"medium"}
    assert {r["effort"] for r in rows if r["purpose"] in ("explain_flags", "rank_smp", "rewrite_brief_parts")} == {"low"}
    assert {r["effort"] for r in rows if r["purpose"] in ("insight_hypotheses", "candidates_smp")} == {"medium"}
    assert all(c["attempts"] >= 1 for a in arms["c01"].values() for c in a["calls"])
    ee.cmd_packets(A)
    key = json.loads((out / "key.json").read_text())
    assert key["pairs"] and (out / "rating_prompts.md").exists()
    with pytest.raises(SystemExit):
        ee.cmd_rate(A)                                                     # cost is measured first
    ee.cmd_measure_raters(A)
    m = json.loads((out / "rater_measure.json").read_text())
    assert m["over_cap"] is False and m["per_rater"]["opus"]["calls_measured"] == 3
    ee.cmd_rate(A)
    n_files = len(list((out / "ratings").glob("*.json")))
    assert n_files == 2 * (len(key["pairs"]) + len(key["sameidea"]))
    rrows = [r for r in ee.read_log(out / "rater_cost_log.jsonl") if r["job"] != "synthetic"]
    assert len(rrows) == n_files and {r["effort"] for r in rrows} == {"medium"} and {r["model"] for r in rrows} == {"claude-sonnet-5-5", "claude-opus-5-5"}
    ee.cmd_rate(A)                                                         # nothing left to rate: no new call
    assert len(ee.read_log(out / "rater_cost_log.jsonl")) == len(rrows) + 6
    ee.cmd_analyse(A)
    res = json.loads((out / "analysis.json").read_text())
    assert not res["stale_key"] and (out / "analysis.md").exists() and res["n_briefs"] == 3
    ee.cmd_cost(A)


def test_the_replay_cap_stops_the_run_before_any_spend_it_could_not_cover(tmp_path, monkeypatch):
    from pathlib import Path
    from types import SimpleNamespace
    monkeypatch.setattr(ee, "CLAUDE", str(Path(__file__).parent / "fake_claude.py"))
    monkeypatch.setattr(ee, "RATER_CWD", tmp_path / "cwd")
    src, out = fake_source(tmp_path, ids=("c01", "t01")), tmp_path / "out"
    A = SimpleNamespace(out=str(out), src=str(src), max_usd=0.52, only=None, force=False, reason=None)
    ee.cmd_select(A)
    ee._run_briefs(A, {"c01"})
    rows = ee.read_log(out / "cost_log.jsonl")
    assert sum(r["cost_usd"] for r in rows) <= 0.52
    arms = ee.load_arms(out, ["c01"])["c01"]
    assert arms["T1"]["status"] == "budget_stopped" and "L" not in arms and arms["B"]["status"] == "ok"   # the third 0.50 draft would not fit


def test_a_call_that_needs_a_second_attempt_logs_both_attempts_and_the_first_validation_error(tmp_path, monkeypatch):
    from pathlib import Path
    monkeypatch.setattr(ee, "CLAUDE", str(Path(__file__).parent / "fake_claude.py"))
    monkeypatch.setattr(ee, "RATER_CWD", tmp_path / "cwd")
    monkeypatch.setenv("FAKE_BAD_FIRST", "1")
    cost = ee.replay_cost_log(tmp_path, 24.0)
    port, client = ee.make_port(cost)
    call = ee.Caller(port, client, "c01", "B")
    got = call("rank_smp", "System.", {"x": 1}, {"type": "object", "additionalProperties": False, "required": ["word"], "properties": {"word": {"type": "string"}}})
    rec = call.records[0]
    assert got["word"] and rec["attempts"] == 2 and rec["ok"] and abs(rec["cost_usd"] - 0.02) < 1e-9
    assert rec["first_validation_error"] and "word" in rec["first_validation_error"]
    rows = ee.read_log(tmp_path / "cost_log.jsonl")
    assert len(rows) == 2 and {r["arm"] for r in rows} == {"B"} and {r["job"] for r in rows} == {"c01"}


def test_chosen_in_plans_group_reads_each_raters_grouping():
    key = {"sameidea": {"i1": {"brief": "c01", "pool": "H1", "n": 4, "numbers": {"1": {"source": "plan", "idx": None}, "2": {"source": "hyp:0", "idx": 0},
                                                                                "3": {"source": "hyp:1", "idx": 1}, "4": {"source": "hyp:2", "idx": 2}}}}}
    arms = {"c01": {"H1": {"status": "ok", "chosen": 1}}}
    r = {"sonnet": {"groups": [[1, 3], [2, 4]]}, "opus": {"groups": [[1, 2], [3]]}}
    got = ee.chosen_in_plan_group(key, lambda who, item: r[who], arms)
    assert got == {"briefs": 1, "per_rater": {"sonnet": 1, "opus": 0}, "both_raters": 0}
    r["opus"] = {"groups": "bad"}
    assert ee.chosen_in_plan_group(key, lambda who, item: r[who], arms)["briefs"] == 0


# =============================================================================================== F3: infrastructure errors
def use_fake_cli(monkeypatch, tmp_path):
    from pathlib import Path
    monkeypatch.setattr(ee, "CLAUDE", str(Path(__file__).parent / "fake_claude.py"))
    monkeypatch.setattr(ee, "RATER_CWD", tmp_path / "cwd")
    monkeypatch.setitem(ee.CFG, "INFRA_BACKOFF_S", 0)


SCHEMA_WORD = {"type": "object", "additionalProperties": False, "required": ["word"], "properties": {"word": {"type": "string"}}}


def one_call(tmp_path, purpose="rank_smp"):
    cost = ee.replay_cost_log(tmp_path, 24.0)
    port, client = ee.make_port(cost)
    return ee.Caller(port, client, "c01", "B"), cost


def test_envelope_classification_separates_the_service_from_the_models_work():
    reason = ee.infra_reason
    assert reason({"is_error": True, "result": "API Error: 529 overloaded"}).startswith("is_error")
    assert reason({"is_error": True, "subtype": "success", "result": "Claude AI usage limit reached"})
    assert reason({"is_error": True, "result": "Invalid API key"}) and reason({"is_error": False}) and reason({"result": None, "is_error": False})
    assert reason({"is_error": False, "result": "{}"}) is None and reason({"is_error": False, "result": ""}) is None
    for sub in ee.MODEL_FAILURE_SUBTYPES:                       # the model's own failures stay model failures
        assert reason({"is_error": True, "subtype": sub, "result": "x"}) is None


def test_an_is_error_envelope_is_infrastructure_logged_at_its_own_figure_and_never_a_model_failure(tmp_path, monkeypatch):
    use_fake_cli(monkeypatch, tmp_path)
    monkeypatch.setenv("FAKE_MODE", "is_error")
    call, cost = one_call(tmp_path)
    with pytest.raises(ee.InfraError) as ei:
        call("rank_smp", "System.", {"x": 1}, SCHEMA_WORD)
    assert "overloaded" in str(ei.value) and not isinstance(ei.value, ee.StopRun)
    row = ee.read_log(tmp_path / "cost_log.jsonl")[0]
    assert row["infra"] and row["ok"] is False and row["cost_usd"] == 0.0 and row["cost_assumed_at_reserve"] is False    # the envelope's figure, not the reserve
    assert cost.reserved == 0 and call.records[0]["ok"] is False


def test_a_crash_with_no_envelope_is_infrastructure_logged_at_the_reserve(tmp_path, monkeypatch):
    use_fake_cli(monkeypatch, tmp_path)
    monkeypatch.setenv("FAKE_MODE", "crash")
    call, cost = one_call(tmp_path)
    with pytest.raises(ee.InfraError) as ei:
        call("draft_brief_whole", "System.", {"x": 1}, SCHEMA_WORD)
    assert "no envelope" in str(ei.value)
    row = ee.read_log(tmp_path / "cost_log.jsonl")[0]
    assert row["infra"] and row["cost_assumed_at_reserve"] is True and row["cost_usd"] == 0.5        # only now is the reserve used


def test_a_timeout_is_infrastructure_and_the_process_is_killed(tmp_path, monkeypatch):
    use_fake_cli(monkeypatch, tmp_path)
    monkeypatch.setenv("FAKE_MODE", "hang")
    monkeypatch.setitem(ee.CFG, "CALL_TIMEOUT_S", 1)
    call, cost = one_call(tmp_path)
    with pytest.raises(ee.InfraError) as ei:
        call("rank_smp", "System.", {"x": 1}, SCHEMA_WORD)
    assert "timeout" in str(ei.value)
    row = ee.read_log(tmp_path / "cost_log.jsonl")[0]
    assert row["infra"] and row["cost_assumed_at_reserve"] is True and row["cost_usd"] == 0.10


def test_a_truncation_stays_a_model_failure_logged_at_its_figure_and_resets_the_infra_count(tmp_path, monkeypatch):
    from napkin.model import ModelError
    use_fake_cli(monkeypatch, tmp_path)
    monkeypatch.setenv("FAKE_MODE", "truncate")
    call, cost = one_call(tmp_path)
    cost.gate.streak = 2
    with pytest.raises(ModelError) as ei:
        call("rank_smp", "System.", {"x": 1}, SCHEMA_WORD)
    assert ei.value.kind == "truncated" and not isinstance(ei.value, ee.InfraError)
    row = ee.read_log(tmp_path / "cost_log.jsonl")[0]
    assert not row.get("infra") and row["ok"] is True and row["cost_assumed_at_reserve"] is False
    assert cost.gate.streak == 0                       # the CLI answered: not an outage


def test_an_infrastructure_error_does_not_use_up_a_run_and_writes_no_failed_final(tmp_path, monkeypatch):
    monkeypatch.setitem(ee.CFG, "INFRA_BACKOFF_S", 0)
    p, seen = tmp_path / "x.json", []

    def fn(caller, deps):
        seen.append(1)
        if len(seen) < 3:
            raise ee.InfraError("overloaded")
        return {"v": 1}
    d = ee.execute_arm(p, fn, lambda: Fake({}), {})
    assert d["status"] == "ok" and d["runs"] == 1 and d["failed_runs"] == [] and len(seen) == 3     # the two outages cost no run


def test_an_infra_stop_leaves_the_arm_unsettled_and_never_failed_final(tmp_path, monkeypatch):
    monkeypatch.setitem(ee.CFG, "INFRA_BACKOFF_S", 0)
    p = tmp_path / "x.json"

    def fn(caller, deps):
        raise ee.InfraStop("3 in a row")
    with pytest.raises(ee.StopRun):
        ee.execute_arm(p, fn, lambda: Fake({}), {})
    assert not p.exists()

    def endless(caller, deps):
        raise ee.InfraError("down")
    with pytest.raises(ee.InfraStop):
        ee.execute_arm(p, endless, lambda: Fake({}), {})            # a caller with no gate is still never endless
    assert not p.exists()


def test_three_infra_errors_in_a_row_stop_the_replay_cleanly_and_the_same_command_resumes(tmp_path, monkeypatch):
    from types import SimpleNamespace
    use_fake_cli(monkeypatch, tmp_path)
    monkeypatch.setitem(ee.CFG, "REPLAY_WORKERS", 1)
    src, out = fake_source(tmp_path, ids=("c01", "t01")), tmp_path / "out"
    A = SimpleNamespace(out=str(out), src=str(src), max_usd=24.0, only=None, force=False, reason=None)
    ee.cmd_select(A)
    monkeypatch.setenv("FAKE_MODE", "is_error")
    cost = ee._run_briefs(A, None)
    assert "3 infrastructure errors in a row" in cost.stopped and "run the same command again" in cost.stopped
    rows = ee.read_log(out / "cost_log.jsonl")
    assert len(rows) == 3 and all(r["infra"] and r["cost_usd"] == 0.0 for r in rows)        # it stopped at the third, not later
    arms = ee.load_arms(out, ["c01", "t01"])
    assert not any(a["status"] == "FAILED_final" for b in arms.values() for a in b.values()) and not any(arms.values())
    stop = json.loads((out / "infra_stop.json").read_text())
    assert stop["where"] == "replay" and "infrastructure" in stop["message"]
    monkeypatch.delenv("FAKE_MODE")
    cost2 = ee._run_briefs(A, None)                  # a fresh process: the service is back
    assert cost2.stopped is None
    arms = ee.load_arms(out, ["c01", "t01"])
    assert all(a["status"] in ee.OK_STATUS and a["runs"] == 1 for b in arms.values() for a in b.values())


def test_a_good_answer_between_outages_resets_the_count():
    g = ee.InfraGate()
    assert isinstance(g.hit(ee.InfraError("a")), ee.InfraError) and not isinstance(g.hit(ee.InfraError("b")), ee.InfraStop)
    g.ok()
    assert not isinstance(g.hit(ee.InfraError("c")), ee.InfraStop) and not isinstance(g.hit(ee.InfraError("d")), ee.InfraStop)
    stop = g.hit(ee.InfraError("e"))
    assert isinstance(stop, ee.InfraStop)
    with pytest.raises(ee.InfraStop):
        g.check()                                                  # once halted every call refuses at once


def test_a_rater_infrastructure_error_uses_no_reask_and_a_run_of_them_stops_without_a_missing_judgement(tmp_path, monkeypatch):
    monkeypatch.setitem(ee.CFG, "INFRA_BACKOFF_S", 0)
    seq = iter([ee.InfraError("down"), ee.InfraError("down"), None, {"better": "X"}])

    def caller(*a):
        v = next(seq)
        if isinstance(v, Exception):
            raise v
        return v
    got, asks = ee.rate_item("sonnet", {"item": "i", "kind": "pair", "prompt": "p"}, None, caller)
    assert got == {"better": "X"} and asks == 2                    # two outages, one unusable answer, one good: 2 asks
    all_down = lambda *a: (_ for _ in ()).throw(ee.InfraError("down"))
    with pytest.raises(ee.InfraStop):
        ee.rate_item("sonnet", {"item": "i", "kind": "pair", "prompt": "p"}, None, all_down)
    stop = lambda *a: (_ for _ in ()).throw(ee.InfraStop("3 in a row"))
    with pytest.raises(ee.InfraStop):
        ee.rate_item("sonnet", {"item": "i", "kind": "pair", "prompt": "p"}, None, stop)


def test_rater_call_logs_an_is_error_envelope_at_its_figure_and_a_crash_at_the_reserve(tmp_path, monkeypatch):
    use_fake_cli(monkeypatch, tmp_path)
    log = ee.rater_cost_log(tmp_path)
    monkeypatch.setenv("FAKE_MODE", "is_error")
    with pytest.raises(ee.InfraError):
        ee.rater_call("sonnet", "p", log, "j")
    monkeypatch.setenv("FAKE_MODE", "crash")
    with pytest.raises(ee.InfraError):
        ee.rater_call("opus", "p", log, "j")
    rows = ee.read_log(tmp_path / "rater_cost_log.jsonl")
    assert [(r["cost_usd"], r["cost_assumed_at_reserve"], r["infra"]) for r in rows] == [(0.0, False, True), (0.5, True, True)]
    monkeypatch.setenv("FAKE_MODE", "truncate")      # a model-side oddity: an answer the CLI gave, so not an outage
    assert ee.rater_call("sonnet", "p", log, "j") is None
    assert log.gate.streak == 0


def test_a_rater_answered_by_another_model_fails_loudly_and_is_never_scored(tmp_path, monkeypatch):
    use_fake_cli(monkeypatch, tmp_path)
    log = ee.rater_cost_log(tmp_path)
    monkeypatch.setenv("FAKE_MODEL_USAGE", "claude-haiku-4-5")
    with pytest.raises(ee.ModelMismatch) as ei:
        ee.rater_call("opus", "p", log, "j")
    assert "claude-haiku-4-5" in str(ei.value) and "opus" in str(ei.value)
    with pytest.raises(ee.ModelMismatch):              # rate_item never swallows it as an unusable answer
        ee.rate_item("opus", {"item": "i", "kind": "pair", "prompt": "p"}, log)
    row = ee.read_log(tmp_path / "rater_cost_log.jsonl")[0]
    assert row["ok"] is False and row["error"] == "model mismatch" and row["models_seen"] == ["claude-haiku-4-5"]
    monkeypatch.delenv("FAKE_MODEL_USAGE")
    assert ee.rater_call("opus", "p", log, "j") == {"better": "X", "reason": "fake"}
    good = ee.read_log(tmp_path / "rater_cost_log.jsonl")[-1]
    assert good["model_checked"] is True and good["models_seen"] == ["claude-opus-5-5"]
    monkeypatch.setenv("FAKE_NO_MODEL_USAGE", "1")      # no usage to check: said so in the log, not silently passed
    ee.rater_call("opus", "p", log, "j")
    assert ee.read_log(tmp_path / "rater_cost_log.jsonl")[-1]["model_checked"] is False


# =============================================================================================== F1, F2: the send-back guards
def twenty(tmp_path, bids=None):
    return packets_for(tmp_path, bids or [f"c{i:02d}" for i in range(1, 21)])


GATE_T1_INSIGHT = "Jude fails T1's insight in at most 2 more briefs than B's (J0)"


def test_the_idea1_survival_guard_counts_both_sides_over_the_briefs_where_both_ran(tmp_path):
    out, inputs, arms_by, packets, key = twenty(tmp_path)
    # Jude fails B's insight in the three briefs where the survival review has no result (no_gate, FAILED, no_gate) ...
    for b in ("c03", "c05"):
        arms_by[b]["T1"], arms_by[b]["SV1"] = {"status": "no_gate"}, {"status": "no_gate"}
    arms_by["c04"]["SV1"] = {"status": "FAILED_final", "calls": [], "failed_runs": [], "runs": 2}
    for b in ("c03", "c04", "c05"):
        arms_by[b]["J0"]["jude_fails_insight"] = True
    # ... and fails T1's insight in three briefs where B's passes
    for b in ("c10", "c11", "c12"):
        arms_by[b]["SV1"]["jude_fails_insight"] = True
    r = ee.analyse(out, inputs, arms_by, key, rating_for(key, "S"))["idea1"]
    # over different sets T1 would read 3 against 3 (a pass); over the paired 17 briefs it is 3 against 0
    assert r["survival"]["paired_briefs"] == 17 and r["survival"]["paired_T1"]["jude_fails_insight"] == 3
    assert r["survival"]["paired_B_via_J0"]["jude_fails_insight"] == 0 and r["survival"]["B_via_J0"]["jude_fails_insight"] == 3
    assert r["rules"]["go_conditions"][GATE_T1_INSIGHT] is False
    assert r["rules"]["go_conditions"]["code sends T1's insight or proposition back in at most 2 more briefs than C1's"] is True
    assert r["guard_pairs"]["T1_C1_code_checks"] == 18          # T1 ran in 18 briefs; C1's count is over those 18 only


def test_a_failed_final_survival_arm_is_missing_data_under_r6_never_measured_and_clean(tmp_path):
    out, inputs, arms_by, packets, key = twenty(tmp_path)
    failed = {"status": "FAILED_final", "calls": [], "failed_runs": [], "runs": 2}
    arms_by["c04"]["SV1"] = failed
    r = ee.analyse(out, inputs, arms_by, key, rating_for(key, "S"))
    assert r["failed_final"]["SV1"] == ["c04"] and r["idea1"]["rules"]["verdict"] != "INCOMPLETE"      # one is within R6's two
    for b in ("c05", "c06"):
        arms_by[b]["SV1"] = failed
    r = ee.analyse(out, inputs, arms_by, key, rating_for(key, "S"))
    assert r["idea1"]["rules"]["verdict"] == "INCOMPLETE" and "FAILED-final in 3 briefs" in " ".join(r["idea1"]["rules"]["why"])
    assert r["idea2"]["rules"]["verdict"] != "INCOMPLETE"                  # SV1 is idea 1's arm
    arms_by["c07"]["SV2"], arms_by["c08"]["SV2"], arms_by["c09"]["SV2"] = failed, failed, failed
    r = ee.analyse(out, inputs, arms_by, key, rating_for(key, "S"))
    assert r["idea2"]["rules"]["verdict"] == "INCOMPLETE"
    # an unsettled survival arm (no file at all) is not 'measured' either
    del arms_by["c10"]["SV1"]
    r = ee.analyse(out, inputs, arms_by, key, rating_for(key, "S"))
    assert r["idea1"]["rules"]["go_conditions"][GATE_T1_INSIGHT] is False and r["idea1"]["rules"]["guards_not_measured"]


def test_the_idea2_send_back_guard_is_paired_and_survival_is_measured_only_when_every_brief_is_settled(tmp_path):
    out, inputs, arms_by, packets, key = twenty(tmp_path)
    arms_by["c03"]["S"], arms_by["c03"]["SV2"] = {"status": "no_gate"}, {"status": "no_gate"}
    arms_by["c03"]["J0"]["jude_fails_proposition"] = True            # O is sent back here, but S has no winner to compare
    arms_by["c04"]["SV2"]["jude_fails_proposition"] = True            # S's winner is sent back here, O is not
    r = ee.analyse(out, inputs, arms_by, key, rating_for(key, "S"))["idea2"]
    assert r["send_backs"] == {"S_winner_in_B": 1, "O_via_J0": 0, "paired_briefs": 19}
    assert r["guard_pairs"] == {"S_O_code_checks": 19, "SV2_J0": 19}
    # before F1 an SV2 that ran in a single brief counted as measured
    for b in [f"c{i:02d}" for i in range(2, 21)]:
        del arms_by[b]["SV2"]
    r = ee.analyse(out, inputs, arms_by, key, rating_for(key, "S"))["idea2"]
    assert r["rules"]["guards_not_measured"] and r["rules"]["verdict"] in ("INCONCLUSIVE", "DROP", "INCOMPLETE")
    assert r["rules"]["go_conditions"]["Jude or code sends S's winner back in at most 2 more briefs than O"] is False


def test_j0_runs_whether_or_not_idea_3_is_included_and_the_guards_say_not_measured_when_it_is_absent(tmp_path, monkeypatch):
    monkeypatch.setitem(ee.CFG, "INCLUDE_IDEA3", False)
    names = [n for n, *_ in ee.arm_specs()]
    assert "J0" in names and "J0p" in names and "J1" not in names
    arms = ee.process_brief(tmp_path / "a", make_inp(), lambda j, a: Fake(standard_handlers()))
    assert arms["J0"]["status"] == "ok" and arms["J0p"]["status"] == "ok" and "J1" not in arms and arms["SV1"]["status"] == "ok"
    # the survival reviews cut (R5) and idea 3 off: J0 and J0' are nobody's baseline, so they are cut too
    cut = ee.process_brief(tmp_path / "b", make_inp(), lambda j, a: Fake(standard_handlers()), skip=ee.SURVIVAL_ARMS)
    assert "J0" not in cut and "J0p" not in cut and "SV1" not in cut
    monkeypatch.setitem(ee.CFG, "INCLUDE_IDEA3", True)
    kept = ee.process_brief(tmp_path / "c", make_inp(), lambda j, a: Fake(standard_handlers()), skip=ee.SURVIVAL_ARMS)
    assert "J0" in kept and "J1" in kept and "SV2" not in kept


def test_with_idea_3_off_the_baseline_is_measured_from_j0_and_with_j0_absent_it_is_not_measured_rather_than_zero(tmp_path, monkeypatch):
    monkeypatch.setitem(ee.CFG, "INCLUDE_IDEA3", False)
    out, inputs, arms_by, packets, key = twenty(tmp_path)
    assert all("J0" in a and "J1" not in a for a in arms_by.values())
    r = ee.analyse(out, inputs, arms_by, key, rating_for(key, "S"))
    assert "idea3" not in r and r["idea1"]["survival"]["B_via_J0"]["briefs"] == 20 and r["idea1"]["rules"]["guards_not_measured"] == []
    for a in arms_by.values():          # what the old code did: J0 never ran, so B's baseline read 0
        a.pop("J0"), a.pop("J0p")
    r = ee.analyse(out, inputs, arms_by, key, rating_for(key, "S"))
    for k, gate in (("idea1", GATE_T1_INSIGHT), ("idea2", "Jude or code sends S's winner back in at most 2 more briefs than O")):
        assert r[k]["rules"]["guards_not_measured"] and r[k]["rules"]["go_conditions"][gate] is False
        assert r[k]["rules"]["verdict"] in ("INCONCLUSIVE", "DROP") and "not measured" in " ".join(r[k]["rules"]["why"] + ["not measured"])
    assert ee.idea1_rules(idea1_base(jude_fail_ins_t1=None, jude_fail_ins_b=None, survival_measured=False))["go_conditions"][GATE_T1_INSIGHT] is False


# =============================================================================================== F4: the pilot decides only on a clean pilot
def pilot_setup(tmp_path, monkeypatch, max_usd=24.0):
    from types import SimpleNamespace
    use_fake_cli(monkeypatch, tmp_path)
    src, out = fake_source(tmp_path, ids=("c01", "t01", "c02")), tmp_path / "out"
    A = SimpleNamespace(out=str(out), src=str(src), max_usd=max_usd, only=None, force=False, reason=None, raters=["sonnet", "opus"],
                        retry_missing=False, rater="opus")
    ee.cmd_select(A)
    return A, out


def test_a_pilot_with_a_failed_final_arm_writes_no_decision(tmp_path, monkeypatch):
    A, out = pilot_setup(tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_MODE", "truncate")                 # every call is a model failure: every arm FAILED_final
    with pytest.raises(SystemExit) as e:
        ee.cmd_pilot(A)
    assert "NO PILOT DECISION WRITTEN" in str(e.value) and "c01:B=FAILED_final" in str(e.value)
    assert not (out / "pilot.json").exists()
    monkeypatch.delenv("FAKE_MODE")                             # fix the fault, move the pilot aside (R7), run it again
    A.only, A.force, A.reason = {"c01", "t01"}, True, "the fault"
    ee.cmd_replay(A)
    A.only, A.force = None, False
    ee.cmd_pilot(A)
    assert json.loads((out / "pilot.json").read_text())["decision"] == "run_all"


def test_a_pilot_stopped_by_the_budget_writes_no_decision(tmp_path, monkeypatch):
    A, out = pilot_setup(tmp_path, monkeypatch, max_usd=0.52)
    with pytest.raises(SystemExit) as e:
        ee.cmd_pilot(A)
    assert "NO PILOT DECISION WRITTEN" in str(e.value) and "budget_stopped" in str(e.value) and not (out / "pilot.json").exists()


def test_an_outage_during_the_pilot_writes_no_decision_and_says_why(tmp_path, monkeypatch):
    A, out = pilot_setup(tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_MODE", "is_error")
    with pytest.raises(SystemExit) as e:
        ee.cmd_pilot(A)
    assert "infrastructure errors in a row" in str(e.value) and not (out / "pilot.json").exists()


def test_no_gate_pilot_arms_count_as_settled_and_a_failed_or_missing_one_does_not(tmp_path):
    out = tmp_path / "out"
    for b in ee.PILOT_BRIEFS:
        (out / "arms" / b).mkdir(parents=True)
        for n, *_ in ee.arm_specs():
            (out / "arms" / b / f"{n}.json").write_text(json.dumps({"status": "no_gate" if n in ("T1", "SV1") else "ok"}))
    assert ee.pilot_unsettled(out, ee.PILOT_BRIEFS) == []
    (out / "arms/t01/L.json").write_text(json.dumps({"status": "FAILED_final"}))
    (out / "arms/c01/S.json").unlink()
    (out / "arms/c01/J1.json").write_text(json.dumps({"status": "budget_stopped"}))
    assert ee.pilot_unsettled(out, ee.PILOT_BRIEFS) == ["c01:S=missing", "c01:J1=budget_stopped", "t01:L=FAILED_final"]


# =============================================================================================== F5: the run's configuration is pinned
def flow_through_pilot(tmp_path, monkeypatch):
    A, out = pilot_setup(tmp_path, monkeypatch)
    ee.cmd_pilot(A)
    return A, out


def test_the_pilot_snapshots_every_cfg_switch_and_the_git_head_before_its_first_call(tmp_path, monkeypatch):
    A, out = flow_through_pilot(tmp_path, monkeypatch)
    snap = json.loads((out / "run_config.json").read_text())
    assert snap["cfg"] == json.loads(json.dumps(ee.CFG)) and set(snap["cfg"]) >= {"INCLUDE_IDEA3", "IDEA3_COUNTER_ARGUMENT_RULE", "INCLUDE_PLAIN_BEST_OF_8",
                                                                                   "INCLUDE_D0_V_B", "INVESTIGATOR_SEES_STRATEGY", "RATER_HARD_CAP_USD"}
    head = __import__("subprocess").run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=ee.REPO).stdout.strip()
    assert snap["git_head"] == head and len(head) == 40 and snap["models"]["raters"] == ee.RATERS
    assert (out / "run_config.json").stat().st_mtime <= (out / "cost_log.jsonl").stat().st_mtime        # written before the calls
    with pytest.raises(SystemExit):
        ee.cmd_pilot(A)                                          # and a second pilot is refused as before


def test_replay_packets_rate_and_analyse_refuse_a_changed_switch_with_a_clear_message(tmp_path, monkeypatch):
    A, out = flow_through_pilot(tmp_path, monkeypatch)
    ee.cmd_replay(A)
    ee.cmd_packets(A)
    for flip in (("INCLUDE_IDEA3", False), ("IDEA3_COUNTER_ARGUMENT_RULE", "protocol"), ("INCLUDE_D0_V_B", True), ("RATER_HARD_CAP_USD", 400.0)):
        monkeypatch.setitem(ee.CFG, *flip)
        for name, cmd in (("replay", ee.cmd_replay), ("packets", ee.cmd_packets), ("rate", ee.cmd_rate), ("analyse", ee.cmd_analyse)):
            with pytest.raises(SystemExit) as e:
                cmd(A)
            msg = str(e.value)
            assert msg.startswith(f"{name} refused") and f"CFG {flip[0]}" in msg and repr(flip[1]) in msg, (name, msg)
        monkeypatch.setitem(ee.CFG, flip[0], json.loads((out / "run_config.json").read_text())["cfg"][flip[0]])
    ee.cmd_packets(A)                                           # restored: accepted again


def test_a_changed_git_head_or_edited_code_is_refused_and_an_operational_knob_is_not(tmp_path, monkeypatch):
    A, out = flow_through_pilot(tmp_path, monkeypatch)
    monkeypatch.setitem(ee.CFG, "REPLAY_WORKERS", 4)
    monkeypatch.setitem(ee.CFG, "INFRA_BACKOFF_S", 1)
    ee.cmd_replay(A)                                            # workers and waits are not what a run measures
    real = ee._git
    monkeypatch.setattr(ee, "_git", lambda *a: "0" * 40 + "\n" if a[0] == "rev-parse" else real(*a))
    with pytest.raises(SystemExit) as e:
        ee.cmd_packets(A)
    assert "git HEAD" in str(e.value) and "0" * 40 in str(e.value)
    monkeypatch.setattr(ee, "_git", lambda *a: "diff --git a/x b/x\n" if a[0] == "diff" else real(*a))
    with pytest.raises(SystemExit) as e:
        ee.cmd_packets(A)
    assert "uncommitted changes" in str(e.value)
    monkeypatch.undo()


def test_commands_refuse_without_a_snapshot_and_a_forced_rerun_takes_a_new_one_and_keeps_the_old(tmp_path, monkeypatch):
    A, out = pilot_setup(tmp_path, monkeypatch)
    for cmd in (ee.cmd_replay, ee.cmd_packets, ee.cmd_rate, ee.cmd_analyse):
        with pytest.raises(SystemExit) as e:
            cmd(A)
        assert "no run_config.json" in str(e.value)
    ee.cmd_pilot(A)
    monkeypatch.setitem(ee.CFG, "INCLUDE_PLAIN_BEST_OF_8", True)
    A.only, A.force, A.reason = {"c01", "t01"}, True, "a harness fault"
    ee.cmd_replay(A)                                            # R7: the fault fix is re-snapshotted, with its reason
    snap = json.loads((out / "run_config.json").read_text())
    assert snap["cfg"]["INCLUDE_PLAIN_BEST_OF_8"] is True and snap["note"].endswith("a harness fault")
    assert len(snap["previous"]) == 1 and snap["previous"][0]["cfg"]["INCLUDE_PLAIN_BEST_OF_8"] is False


def test_analysis_carries_the_snapshot_in_json_and_markdown(tmp_path, monkeypatch):
    A, out = flow_through_pilot(tmp_path, monkeypatch)
    ee.cmd_replay(A)
    ee.cmd_packets(A)
    ee.cmd_measure_raters(A)
    ee.cmd_rate(A)
    ee.cmd_analyse(A)
    snap = json.loads((out / "run_config.json").read_text())
    res = json.loads((out / "analysis.json").read_text())
    assert res["run_config"]["cfg"] == snap["cfg"] and res["run_config"]["git_head"] == snap["git_head"]
    md = (out / "analysis.md").read_text()
    assert "Run configuration" in md and snap["git_head"] in md and '"INCLUDE_IDEA3": true' in md


# =============================================================================================== F6: the tie rule is R2's literal
def test_a_proposition_item_ties_when_the_two_propositions_alone_are_identical_whatever_the_insights(tmp_path):
    # T1 and C1 are both drafted from a reset plan, so their propositions are the same text; their insights differ
    _, inputs, arms_by, packets, key = packets_for(tmp_path, ["c01"])
    assert arms_by["c01"]["T1"]["proposition"] == arms_by["c01"]["C1"]["proposition"]
    assert ee.tidy(arms_by["c01"]["T1"]["insight"]) != ee.tidy(arms_by["c01"]["C1"]["insight"])
    ties = {k.split("|")[1]: v for k, v in key["auto_ties"].items()}
    assert ties["T1vC1.prop"] == "identical text"
    assert not any(k["comparison"] == "T1vC1.prop" for k in key["pairs"].values())
    assert any(k["comparison"] == "T1vC1.ins" for k in key["pairs"].values())          # the insights differ: rated


def test_an_insight_item_ties_when_the_two_insights_are_identical_and_the_propositions_may_differ(tmp_path):
    # B and C1 are drafted from the same plan insight; make their insights identical and their propositions differ
    h = standard_handlers(draft_brief_whole=lambda s, p, sc: draft_reply(insight="Same insight", prop="Line from " + p["plan"]["parts"]["single_minded_proposition"]["must_say"][:10]))
    _, _, arms_by, _, key = packets_for(tmp_path, ["c01"], h)
    ties = {k.split("|")[1]: v for k, v in key["auto_ties"].items()}
    assert ties["C1vB.ins"] == "identical text"
    assert any(k["comparison"] == "C1vB.prop" for k in key["pairs"].values())            # propositions differ: rated
    assert not any(k["comparison"] == "C1vB.ins" for k in key["pairs"].values())


def test_tidy_equality_is_what_makes_texts_identical_so_a_label_or_full_stop_never_hides_a_tie(tmp_path):
    h = standard_handlers(draft_brief_whole=lambda s, p, sc: draft_reply(prop="Draft for testing: One plain thought.", insight="I " + p["plan"]["parts"]["insight"]["must_say"]),
                          rewrite_brief_parts=lambda s, p, sc: {"single_minded_proposition": entry("one plain thought")})
    _, _, _, _, key = packets_for(tmp_path, ["c01"], h)
    assert {k.split("|")[1]: v for k, v in key["auto_ties"].items()}["C1vB.prop"] == "identical text"
