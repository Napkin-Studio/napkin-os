"""The pure parts of tools/prop_replay.py (the phase 0 replay harness): the selection rule, the blinding and the
pre-registered rule's arithmetic. Fixtures only; no model call, no file outside tmp_path."""

import json
import re

import pytest

from tools import prop_replay as pr


# ------------------------------------------------------------------------------------------- selection

def entries(spec):
    return [{"name": n, "state": s} for n, s in spec]


def test_selection_takes_the_first_twenty_done_runs_of_off_and_thin_in_name_order():
    names = [f"{b}{i:02d}-{arm}" for b in "ct" for i in range(1, 8) for arm in ("off", "thin")]   # 28 runs
    spec = [(n, "done") for n in names] + [("zzz-other", "done")]
    chosen = pr.select_runs(entries(reversed(spec)))          # whatever order the folder listing comes in
    assert chosen == sorted(names)[:20] and len(chosen) == 20
    assert "zzz-other" not in chosen                          # only the off and thin arms


def test_selection_skips_runs_not_done_and_fails_when_short():
    spec = [(f"c{i:02d}-off", "done" if i != 3 else None) for i in range(1, 25)]
    chosen = pr.select_runs(entries(spec))
    assert "c03-off" not in chosen and chosen[2] == "c04-off"
    with pytest.raises(ValueError):
        pr.select_runs(entries(spec[:10]))


def test_list_source_counts_a_run_done_only_with_summary_and_job_end(tmp_path):
    runs = tmp_path / "runs"
    for name, summary, end in (("c01-off", "done", "done"), ("c02-off", "done", None), ("c03-off", None, None),
                               ("c04-off", "failed", "failed")):
        d = runs / name
        d.mkdir(parents=True)
        if summary:
            (d / "summary.json").write_text(json.dumps({"final_state": summary}))
            (d / "runlog.jsonl").write_text(json.dumps({"ev": "model"}) + "\n" + (json.dumps({"ev": "job_end", "state": end}) if end else ""))
    got = {e["name"]: e["state"] for e in pr.list_source(tmp_path)}
    assert got == {"c01-off": "done", "c02-off": None, "c03-off": None, "c04-off": None}


def test_extract_input_reads_the_one_draft_call():
    ev = {"ev": "model", "purpose": "draft_brief_whole", "secs": 30, "cost": 0.09, "in_tokens": 1, "out_tokens": 2,
          "payload": {"system": "s", "payload": {"client_said": "Brief", "plan": {"strategy": "S"}, "facts": [], "findings": [],
                                                 "client_words": [{"id": "cap_1"}], "library": [{"id": "psg_1"}]}},
          "reply": {"insight": {"value": "I"}, "single_minded_proposition": {"value": "P"}, "audience": {"value": "A"}}}
    other = {"ev": "model", "purpose": "plan_brief"}
    got = pr.extract_input("c01-off", [json.dumps(other), json.dumps(ev)])
    assert got["first_draft"] == {"insight": "I", "single_minded_proposition": "P", "audience": "A"}
    assert got["brief_text"] == "Brief" and got["strategy"] == "S" and got["library"] == [{"id": "psg_1"}]
    with pytest.raises(ValueError):
        pr.extract_input("c01-off", [json.dumps(other)])
    with pytest.raises(ValueError):
        pr.extract_input("c01-off", [json.dumps(ev), json.dumps(ev)])
    bad = dict(ev, reply={"insight": {"value": "I"}})
    with pytest.raises(ValueError):
        pr.extract_input("c01-off", [json.dumps(bad)])


# --------------------------------------------------------------------------------------------- blinding

def row(name, winner="A new winning line", source="seed:2", pool=None):
    pool = pool if pool is not None else [{"source": "seed:0", "value": "Alpha line."}, {"source": "seed:1", "value": "Beta line"},
                                          {"source": "seed:2", "value": "A new winning line"}, {"source": "first_draft", "value": "The earlier line."}]
    return {"name": name, "brief_text": "A client brief, in plain words.", "insight": "To confirm: One insight.",
            "first": "The earlier line.", "winner": winner, "winner_source": source, "pool": pool}


def test_tidy_takes_off_the_mark_and_the_final_stop_only():
    assert pr.tidy("To confirm: A line.") == "A line"
    assert pr.tidy("A line...") == "A line..."
    assert pr.tidy("  Wait. Why.  ") == "Wait. Why"


def test_pairs_exist_only_where_a_new_candidate_won():
    rows = [row("a"), row("b", winner="The earlier line.", source="first_draft"), row("c", winner=None, source=None)]
    o1, o2, ideas, key = pr.build_packets(rows)
    assert [k["job"] for k in key["pairs"].values()] == ["a", "a"]
    assert len(o1["items"]) == len(o2["items"]) == 1
    assert len(ideas["items"]) == 3                       # every job with a pool is asked the same-idea question


def test_order_two_is_order_one_swapped_and_the_key_recovers_the_sides():
    rows = [row(f"j{i}") for i in range(12)]
    o1, o2, _, key = pr.build_packets(rows)
    sides = {"o1": {}, "o2": {}}
    for packet in (o1, o2):
        for it in packet["items"]:
            k = key["pairs"][it["item"]]
            x = re.search(r"DRAFT X\nInsight: .*\nProposition: (.*)\n", it["prompt"]).group(1)
            y = re.search(r"DRAFT Y\nInsight: .*\nProposition: (.*)\n", it["prompt"]).group(1)
            want = {"winner": "A new winning line", "first_draft": "The earlier line"}
            assert (x, y) == (want[k["X"]], want[k["Y"]])
            assert {k["X"], k["Y"]} == {"winner", "first_draft"}
            sides[f"o{k['order']}"][k["job"]] = k["X"]
    assert all(sides["o1"][j] != sides["o2"][j] for j in sides["o1"])      # positions swapped between the orders
    assert 0 < sum(v == "winner" for v in sides["o1"].values()) < 12     # and the coin is not always the same side


def test_packets_name_no_arm_source_or_seed_and_ids_say_nothing():
    rows = [row(f"j{i}") for i in range(6)]
    o1, o2, ideas, key = pr.build_packets(rows)
    text = json.dumps([o1, o2, ideas])
    for tell in ("winner", "first_draft", "first draft", "seed", "candidate", "arm", "off", "thin", "j0", "to confirm"):
        assert not re.search(rf"\b{tell}\b", text.replace("Draft X", "").replace("Draft Y", ""), re.I), tell
    ids = [it["item"] for p in (o1, o2, ideas) for it in p["items"]]
    assert len(ids) == len(set(ids)) and all(re.fullmatch(r"(o1|o2|s)-[0-9a-f]{8}", i) for i in ids)
    assert not any(row_["name"] in i for row_ in rows for i in ids)
    assert [it["item"] for it in o1["items"]] != [f"o1-{pr.opaque('pair', f'j{i}', 1)}" for i in range(6)]   # shuffled, not in job order


def test_packets_are_deterministic_and_the_key_covers_every_item():
    rows = [row(f"j{i}") for i in range(5)]
    a, b = pr.build_packets(rows), pr.build_packets(rows)
    assert a == b
    o1, o2, ideas, key = a
    assert {it["item"] for it in o1["items"] + o2["items"]} == set(key["pairs"])
    assert {it["item"] for it in ideas["items"]} == set(key["sameidea"])
    for item, k in key["sameidea"].items():
        assert sorted(k["numbers"].values()) == sorted(["seed:0", "seed:1", "seed:2", "first_draft"])


def test_same_idea_listing_is_numbered_in_a_seeded_order_and_key_maps_back():
    _, _, ideas, key = pr.build_packets([row("a")])
    it = ideas["items"][0]
    listed = re.findall(r"^(\d+)\. (.*)$", it["prompt"], re.M)
    k = key["sameidea"][it["item"]]
    src = {"seed:0": "Alpha line", "seed:1": "Beta line", "seed:2": "A new winning line", "first_draft": "The earlier line"}
    assert [(n, src[k["numbers"][n]]) for n, _ in listed] == listed and len(listed) == 4


# ------------------------------------------------------------------------------------ the rule's arithmetic

def scores(w, l, rest=None):
    """Per-job rater scores that give a pair sum of +4 (a win), -4 (a loss) or 0 (a tie) for both raters."""
    jobs = {}
    for i in range(w):
        jobs[f"w{i}"] = {"sonnet": [1, 1], "opus": [1, 1]}
    for i in range(l):
        jobs[f"l{i}"] = {"sonnet": [-1, -1], "opus": [-1, -1]}
    for i in range(rest or 0):
        jobs[f"t{i}"] = {"sonnet": [1, -1], "opus": [0, 0]}
    return jobs


def ideas(n=20, c=4):
    return {f"j{i}": {"sonnet": c, "opus": c + 1} for i in range(n)}


FLAGS = [(False, False)] * 20


def test_pass_at_the_exact_thresholds():
    r = pr.apply_rule(scores(8, 2), ideas(), FLAGS)       # W=8, L=2: net exactly 6
    assert r["verdict"] == "PASS" and r["conditions"]["a_net_and_wins"] == {"W": 8, "L": 2, "net": 6, "ok": True}


def test_net_of_five_fails_and_so_do_seven_wins_with_net_seven():
    assert pr.apply_rule(scores(8, 3), ideas(), FLAGS)["verdict"] == "DROP"        # net 5
    r = pr.apply_rule(scores(7, 0), ideas(), FLAGS)                                # net 7 but W < 8
    assert r["verdict"] == "DROP" and not r["conditions"]["a_net_and_wins"]["ok"]


def test_a_pair_sum_of_plus_or_minus_two_is_a_win_or_loss_and_one_is_a_tie():
    j = {"w": {"sonnet": [1, 1], "opus": [0, 0]}, "l": {"sonnet": [-1, -1], "opus": [0, 0]},
         "t": {"sonnet": [1, 0], "opus": [1, -1]}, "u": {"sonnet": [1, 1], "opus": [-1, 0]}}   # u sums to +1
    r = pr.apply_rule(j, {}, [])
    assert (r["conditions"]["a_net_and_wins"]["W"], r["conditions"]["a_net_and_wins"]["L"]) == (1, 1)


def test_each_rater_alone_needs_more_wins_than_losses_and_both_orders_must_agree():
    # the pooled sum says 10 wins, but Opus alone never has both orders agree for the winner: its W is 0, L is 4
    j = {f"w{i}": {"sonnet": [1, 1], "opus": [1, 0]} for i in range(10)}
    j.update({f"l{i}": {"sonnet": [0, 0], "opus": [-1, -1]} for i in range(4)})
    r = pr.apply_rule(j, ideas(), FLAGS)
    assert r["conditions"]["a_net_and_wins"]["ok"] is True       # (a) holds on the pooled sums
    assert r["conditions"]["b_each_rater"] == {"sonnet": [10, 0], "opus": [0, 4], "ok": False}
    assert r["verdict"] == "DROP"


def test_median_ideas_uses_the_lower_rater_and_needs_three():
    two = {f"j{i}": {"sonnet": 2, "opus": 5} for i in range(20)}
    assert pr.apply_rule(scores(9, 1), two, FLAGS)["conditions"]["c_median_ideas"] == {"median": 2, "n": 20, "ok": False}
    mixed = {f"j{i}": {"sonnet": 3 if i < 10 else 2, "opus": 4} for i in range(20)}    # median of ten 3s and ten 2s is 2.5
    assert pr.apply_rule(scores(9, 1), mixed, FLAGS)["conditions"]["c_median_ideas"]["ok"] is False
    exact = {f"j{i}": {"sonnet": 3, "opus": 4} for i in range(20)}
    assert pr.apply_rule(scores(9, 1), exact, FLAGS)["verdict"] == "PASS"


def test_and_flag_margin_is_two():
    two_more = [(False, True)] * 2 + [(False, False)] * 18
    three_more = [(False, True)] * 3 + [(False, False)] * 17
    offset = [(True, False)] + [(False, True)] * 3 + [(False, False)] * 16               # winners 3, first drafts 1: extra 2
    assert pr.apply_rule(scores(9, 1), ideas(), two_more)["verdict"] == "PASS"
    r = pr.apply_rule(scores(9, 1), ideas(), three_more)
    assert r["verdict"] == "DROP" and r["conditions"]["d_and_flag"] == {"first_drafts": 0, "winners": 3, "extra": 3, "ok": False}
    assert pr.apply_rule(scores(9, 1), ideas(), offset)["conditions"]["d_and_flag"]["extra"] == 2


def test_a_missing_judgement_makes_the_verdict_incomplete_never_a_score():
    j = scores(9, 1)
    j["w0"]["opus"][1] = None
    r = pr.apply_rule(j, ideas(), FLAGS)
    assert r["verdict"] == "INCOMPLETE" and r["missing"] == ["w0"]
    i = ideas()
    i["j0"]["sonnet"] = None
    assert pr.apply_rule(scores(9, 1), i, FLAGS)["verdict"] == "INCOMPLETE"


def test_ties_are_counted_in_the_denominator_not_the_wins():
    r = pr.apply_rule(scores(8, 2), ideas(), FLAGS)
    assert r["pairs_rated"] == 10 and r["ties_or_unrated"] == 10


def test_distinct_ideas_counts_groups_and_left_out_numbers():
    assert pr.distinct_ideas([[1, 2], [3]], 5) == 4                # {1,2}, {3}, 4, 5
    assert pr.distinct_ideas([[1, 2, 3, 4, 5]], 5) == 1
    assert pr.distinct_ideas([[1, 2], [2, 3]], 4) == 3             # 2 counted once: {1,2}, {3}, 4
    assert pr.distinct_ideas([[9], []], 3) is None                 # out of range is unreadable, not ignored
    assert pr.distinct_ideas("nope", 3) is None and pr.distinct_ideas([1, 2], 3) is None


def test_the_constants_are_the_pre_registered_ones():
    assert (pr.P0_MIN_NET, pr.P0_MIN_WINS, pr.P0_MIN_MEDIAN_IDEAS, pr.P0_MAX_EXTRA_AND, pr.N_JOBS) == (6, 8, 3, 2, 20)


# ------------------------------------------------------------- the whole flow, offline, on fake inputs

def _fake_inputs(out, n=4):
    (out / "inputs").mkdir(parents=True)
    names = [f"c0{i}-off" for i in range(1, n + 1)]
    for nm in names:
        (out / "inputs" / f"{nm}.json").write_text(json.dumps({
            "name": nm, "brief_text": "A client brief, in plain words.", "strategy": "S", "facts": [], "findings": [],
            "client_words": [], "library": [], "source_call": {},
            "first_draft": {"insight": "To confirm: An insight about people.", "single_minded_proposition": "To confirm: A plain first line.",
                            "job": "J", "audience": "Adults", "competitor_context": "Rival", "reasons_to_believe": ["R"]}}))
    (out / "inputs/selection.json").write_text(json.dumps({"runs": [{"name": n} for n in names]}))
    return names


def test_replay_packets_rate_and_analyse_run_end_to_end_with_fakes(tmp_path, monkeypatch):
    out = tmp_path / "out"
    names = _fake_inputs(out)

    def fake_call(purpose, system, payload, schema):
        if purpose == "candidates_smp":
            return {"candidates": [{"value": f"Candidate line number {i}", "angle": "", "rests_on": "", "cites": []} for i in range(4)]}
        return {"ranking": [0, 1, 2, 3, 4], "why_winner": "", "losers": []}

    monkeypatch.setattr(pr, "make_port", lambda cost: (None, None))
    monkeypatch.setattr(pr, "make_call", lambda port, client, job, max_tokens=12000: fake_call)
    base = ["--out", str(out)]
    pr.main(base + ["replay", "--workers", "1"])
    assert sorted(p.stem for p in (out / "results").glob("*.json")) == names
    blk = json.loads((out / "blocks" / f"{names[0]}.json").read_text())
    assert blk["first_draft"]["single_minded_proposition"] == "A plain first line"       # mark and stop off
    assert blk["first_draft"]["insight"] == blk["winner"]["insight"]                     # the same insight on both sides
    assert blk["first_draft"]["reasons_to_believe"] == "" and blk["winner"]["objection"] == ""
    assert (out / "blocks.md").exists()

    pr.main(base + ["packets"])
    assert {p.name for p in (out / "packets").iterdir()} == {"order1.json", "order2.json", "sameidea.json"}
    key = json.loads((out / "key.json").read_text())

    def fake_rater(rater, prompt, cost, job, kind='pair', n=None):
        if "Put together the ones" in prompt:
            return {"groups": [[1, 2], [3], [4], [5]]}          # 4 ideas of 5
        return {"better": "X", "reason": "x"}                    # always the first position

    monkeypatch.setattr(pr, "rater_call", fake_rater)
    pr.main(base + ["rate", "--workers", "1"])
    assert len(list((out / "ratings").glob("*.json"))) == (len(names) * 2 + len(names)) * 2
    pr.main(base + ["analyse"])
    a = json.loads((out / "analysis.json").read_text())
    # 'always X' is position bias: it cancels across the two orders, so no pair is won and the rule drops
    assert a["verdict"] == "DROP" and a["conditions"]["a_net_and_wins"]["W"] == 0 and a["conditions"]["a_net_and_wins"]["L"] == 0
    assert a["conditions"]["c_median_ideas"]["median"] == 4 and a["missing"] == []
    # a rater that always prefers the winner, found through the key, wins every pair
    pos = {it: k for it, k in key["pairs"].items()}

    def winner_rater(rater, prompt, cost, job, kind='pair', n=None):
        if job in pos:
            return {"better": "X" if pos[job]["X"] == "winner" else "Y", "reason": ""}
        return {"better": "no real difference", "reason": ""} if "Put together" not in prompt else {"groups": [[1], [2], [3], [4], [5]]}

    for f in (out / "ratings").glob("*.json"):
        f.unlink()
    monkeypatch.setattr(pr, "rater_call", winner_rater)
    pr.main(base + ["rate", "--workers", "1"])
    pr.main(base + ["analyse"])
    a = json.loads((out / "analysis.json").read_text())
    assert a["conditions"]["a_net_and_wins"]["W"] == len(names) and a["verdict"] == "DROP"     # 4 wins: under the 8 needed
    assert a["conditions"]["c_median_ideas"]["median"] == 5


def test_a_failed_run_makes_the_verdict_incomplete(tmp_path, monkeypatch):
    out = tmp_path / "out"
    _fake_inputs(out, 2)

    def boom(purpose, system, payload, schema):
        raise RuntimeError("down")

    monkeypatch.setattr(pr, "make_port", lambda cost: (None, None))
    monkeypatch.setattr(pr, "make_call", lambda port, client, job, max_tokens=12000: boom)
    pr.main(["--out", str(out), "replay", "--workers", "1"])
    with pytest.raises(SystemExit):          # packets refuse while any run is FAILED
        pr.main(["--out", str(out), "packets"])
    pr.main(["--out", str(out), "analyse"])
    a = json.loads((out / "analysis.json").read_text())
    assert a["verdict"] == "INCOMPLETE" and any(m.startswith("c01-off:run failed") for m in a["missing"])
    assert a["not_part_of_the_rule"]["outcomes"] == {"generate_failed": 2}


def test_inputs_refuses_to_select_twice(tmp_path):
    out = tmp_path / "out"
    _fake_inputs(out, 1)
    with pytest.raises(SystemExit):
        pr.main(["--out", str(out), "inputs", "--src", str(tmp_path)])


def test_cost_log_stops_calls_at_the_cap(tmp_path):
    log = pr.CostLog(tmp_path / "c.jsonl", 0.05)
    log.check()
    log.add({"cost_usd": 0.06})
    with pytest.raises(pr.BudgetExceeded):
        log.check()
    assert pr.CostLog(tmp_path / "c.jsonl", 1.0).spent == pytest.approx(0.06)     # the cap counts earlier runs too


def test_distinct_ideas_reads_string_and_float_numbers_and_refuses_what_it_cannot_read():
    assert pr.distinct_ideas([["1", "2"], ["3", "4", "5"]], 5) == 2
    assert pr.distinct_ideas([[1.0, 2.0], [3]], 3) == 2
    assert pr.distinct_ideas([["one", "two"]], 3) is None
    assert pr.distinct_ideas([[9]], 3) is None


def test_pick_is_normalised_and_unusable_answers_are_not_usable():
    assert pr.normalise_pick(" y. ") == "Y" and pr.normalise_pick("No real difference") == "no real difference"
    assert pr.normalise_pick("maybe") is None
    assert pr.usable({"better": "Y."}, "pair") and not pr.usable({"better": "both"}, "pair")
    assert pr.usable({"groups": [["1", "2"]]}, "sameidea", 3) and not pr.usable({"x": 1}, "sameidea", 3)


def test_hard_cap_holds_whatever_max_usd_says(tmp_path):
    log = pr.CostLog(tmp_path / "c.jsonl", 160.0)
    log.add({"cost_usd": pr.HARD_CAP_USD})
    with pytest.raises(pr.BudgetExceeded):
        log.check()


def test_a_rerun_after_packets_makes_analyse_incomplete_and_ids_follow_content(tmp_path, monkeypatch):
    out = tmp_path / "out"
    names = _fake_inputs(out, 2)
    ok = lambda purpose, system, payload, schema: (
        {"candidates": [{"value": f"Candidate line {i}", "angle": "", "rests_on": "", "cites": []} for i in range(4)]}
        if purpose == "candidates_smp" else {"ranking": [0, 1, 2, 3, 4], "why_winner": "", "losers": []})
    monkeypatch.setattr(pr, "make_port", lambda cost: (None, None))
    monkeypatch.setattr(pr, "make_call", lambda port, client, job, max_tokens=12000: ok)
    base = ["--out", str(out)]
    pr.main(base + ["replay", "--workers", "1"])
    pr.main(base + ["packets"])
    ids1 = sorted(i["item"] for i in json.loads((out / "packets/order1.json").read_text())["items"])
    ok2 = lambda purpose, system, payload, schema: (
        {"candidates": [{"value": f"Another line {i}", "angle": "", "rests_on": "", "cites": []} for i in range(4)]}
        if purpose == "candidates_smp" else {"ranking": [0, 1, 2, 3, 4], "why_winner": "", "losers": []})
    monkeypatch.setattr(pr, "make_call", lambda port, client, job, max_tokens=12000: ok2)
    pr.main(base + ["replay", "--workers", "1", "--force"])      # results rewritten after the key was made
    pr.main(base + ["analyse"])
    a = json.loads((out / "analysis.json").read_text())
    assert a["verdict"] == "INCOMPLETE" and any("different results" in m for m in a["missing"])
    # same content: same ids; changed winner: a new id, so an old rating is never matched
    o1, _, _, _ = pr.build_packets(pr._rows(out))
    assert sorted(i["item"] for i in o1["items"]) != ids1       # the winner changed with the results
    rows = pr._rows(out)
    rows[0]["winner"] = "A different winner"
    o1b, _, _, _ = pr.build_packets(rows)
    assert sorted(i["item"] for i in o1b["items"]) != ids1
