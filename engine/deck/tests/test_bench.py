"""The evaluation bench: blinding, both orders, trust logic, Spearman, the non-Claude hook, the experiment matrix. No model call."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from deck.bench import experiment, packets as P
from deck.bench.gold import gold_report
from deck.bench.judges import BenchError, ClaudeJudge, NonClaudeJudge, RecordedJudge
from deck.bench.rubric import criterion_ids, load_rubric, resolve_weights
from deck.bench.run import flip_rate, label_run, run_bench
from deck.bench.stats import noise_line, spearman

FIX = Path(__file__).parent / "fixtures"
RUBRIC = load_rubric()
IDS = criterion_ids(RUBRIC)


def _runs(tmp_path):
    """Three invented run directories from the fixture decks: lumen, investor, and lumen cut short. Names hint at arms."""
    lum = json.loads((FIX / "lumen_water" / "golden_deck.json").read_text())
    inv = json.loads((FIX / "types" / "investor_seed" / "golden_deck.json").read_text())
    short = copy.deepcopy(lum)
    short["order"] = short["order"][:8]
    out = []
    for name, d in (("arm_brief_research_s1", lum), ("arm_prompt_s1", inv), ("arm_prompt_documents_s2", short)):
        d = copy.deepcopy(d)
        d["meta"]["built_from"] = name
        (tmp_path / name).mkdir()
        (tmp_path / name / "deck.json").write_text(json.dumps(d))
        out.append(tmp_path / name)
    return out


def _judge(name, family, base, fwd, rev):
    """A recorded judge: every label scored base (criteria cycle +0/+1), with the given rankings."""
    scores = {f"D{i}": {c: {"score": min(5, base + (k % 2) * (i % 3)), "slide": 1, "evidence": "Slide 1", "rationale": "r"} for k, c in enumerate(IDS)} for i in (1, 2, 3)}
    return RecordedJudge({"judge": name, "family": family, "scores": scores, "rankings": {"forward": fwd, "reverse": rev}})


def _two(monkeypatch):
    """Two judges from two families agreeing on order; the second needs the non-Claude switch."""
    monkeypatch.setenv("DECK_BENCH_ALLOW_NON_CLAUDE", "1")
    a = _judge("j1", "claude", 2, ["D1", "D2", "D3"], ["D1", "D2", "D3"])
    b = _judge("j2", "other", 3, ["D1", "D2", "D3"], ["D1", "D2", "D3"])
    return [a, b]


def test_rubric_copy_has_weights_anchors_and_tender_override():
    assert sum(c["weight_percent"] for c in RUBRIC["criteria"]) == 100
    assert all(set(c["anchors"]) == {"one", "three", "five"} for c in RUBRIC["criteria"])
    assert "buyer" in RUBRIC["tender_override"]["rule"]


def test_weights_default_is_labelled_and_buyer_weights_win():
    w = resolve_weights(RUBRIC, "agency_pitch", None)
    assert w["source"] == "default_assumption" and w["label"] == "default, not validated"
    buyer = [{"criterion": c, "weight": f"{x}%"} for c, x in zip(IDS, [10] * 8 + [20])]
    b = resolve_weights(RUBRIC, "tender_response", buyer)
    assert b["source"] == "brief" and b["weights"][IDS[-1]] == 20
    own = resolve_weights(RUBRIC, "tender_response", [{"criterion": "Price", "weight": "40"}, {"criterion": "Quality", "weight": "60"}])
    assert own["source"] == "default_assumption" and own["buyer_criteria"] == {"Price": 40.0, "Quality": 60.0}


def test_blinding_hides_arms_and_provenance(tmp_path):
    runs = _runs(tmp_path)
    pk, mapping = P.build_packets(runs, seed=7, hide=["brief_research"])
    blob = json.dumps(pk).lower()
    for word in ("arm_", "built_from", "recorded stand-in", "brief_research"):
        assert word not in blob
    assert sorted(mapping) == ["D1", "D2", "D3"] and sorted(mapping.values()) == sorted(r.name for r in runs)
    assert all(set(p) == {"label", "text", "slides", "words"} for p in pk)
    again, m2 = P.build_packets(runs, seed=7)
    assert m2 == mapping                              # seeded: reproducible
    assert any(P.build_packets(runs, seed=s)[1] != mapping for s in range(8))   # and the seed changes the shuffle


def test_both_orders_are_mirrors_and_cover_every_deck(tmp_path):
    pk, _ = P.build_packets(_runs(tmp_path), seed=3)
    o = P.both_orders(pk, 3)
    assert o["reverse"] == list(reversed(o["forward"])) and sorted(o["forward"]) == ["D1", "D2", "D3"]


def test_run_bench_reports_means_weakest_ones_agreement_flip_length(tmp_path, monkeypatch):
    runs = _runs(tmp_path)
    out = run_bench(runs, _two(monkeypatch), seed=7, profile_id="agency_pitch", waiver=None)
    assert set(out["criterion_means"]) == set(IDS) and out["weakest_criterion"] in IDS
    assert out["flip"]["overall"] == 0.0 and out["agreement"]["within_1"] is not None
    assert {j["family"] for j in out["judgments"]} == {"claude", "other"}
    assert out["length"]["adjusted_recorded"] and all(d["adjusted_total"] is not None for d in out["decks"])
    assert out["orders"]["reverse"] == out["orders"]["forward"][::-1]
    assert "arm_" not in json.dumps(out["judgments"])           # judgments carry labels, not runs
    assert out["scoring_run_meta"]["trusted"] is True and out["scoring_run_meta"]["weights_label"] == "default, not validated"
    assert label_run(out["scoring_run_meta"])["label"] == "trusted"


def test_flip_rate_counts_pairs_that_change_between_orders():
    r = [{"judge": "j", "forward": ["A", "B", "C"], "reverse": ["B", "A", "C"]}]
    f = flip_rate(r)
    assert f["pairs"] == 3 and f["overall"] == round(1 / 3, 3) and f["ties"] == [("A", "B")]


def test_one_criterion_at_1_is_listed(tmp_path, monkeypatch):
    runs = _runs(tmp_path)
    js = _two(monkeypatch)
    js[0].data["scores"]["D1"][IDS[2]]["score"] = 1
    out = run_bench(runs, js, seed=7)
    assert {"label": "D1", "judge": "j1", "criterion": IDS[2]} in out["criteria_at_1"]


def test_trusted_label_refused_without_controls(tmp_path, monkeypatch):
    runs = _runs(tmp_path)
    one = run_bench(runs, [_two(monkeypatch)[0]], seed=1)        # one family, no waiver
    meta = one["scoring_run_meta"]
    assert not meta["trusted"] and "fewer than 2 judge families" in meta["untrusted_because"][0]
    with pytest.raises(BenchError):
        label_run(meta, "trusted")
    assert label_run(meta, "smoke")["label"] == "smoke"
    note = "Claude-only by ADR 0006; self-preference caveat accepted"
    solo = run_bench(runs, [_two(monkeypatch)[0]], seed=1, waiver=note)      # one judge plus a note is not enough
    assert not solo["scoring_run_meta"]["trusted"] and "3 or more distinct judges" in solo["scoring_run_meta"]["untrusted_because"][0]
    three = [_judge(f"c{i}", "claude", 2 + i % 2, ["D1", "D2", "D3"], ["D1", "D2", "D3"]) for i in range(3)]
    assert run_bench(runs, three, seed=1, waiver=note)["scoring_run_meta"]["trusted"]
    assert not run_bench(runs, three, seed=1)["scoring_run_meta"]["trusted"]
    pair = [_judge("j1", "claude", 2, ["D1", "D2"], ["D2", "D1"]), _judge("j2", "other", 3, ["D1", "D2"], ["D2", "D1"])]
    two = run_bench(runs[:2], pair, seed=1)                      # two decks: no length regression possible
    assert not two["scoring_run_meta"]["trusted"] and "length-adjusted score not recorded" in two["scoring_run_meta"]["untrusted_because"]


def test_missing_order_or_flip_blocks_trust():
    from deck.bench.run import scoring_run_meta
    w = {"source": "default_assumption", "label": "default, not validated"}
    js = [{"family": "claude", "judge": "a"}, {"family": "other", "judge": "b"}]
    ok = scoring_run_meta(weights=w, judges=js, orders=["forward", "reverse"], flip={"overall": 0.1}, length={"adjusted_recorded": True})
    assert ok["trusted"]
    assert not scoring_run_meta(weights=w, judges=js, orders=["forward"], flip={"overall": 0.1}, length={"adjusted_recorded": True})["trusted"]
    assert not scoring_run_meta(weights=w, judges=js, orders=["forward", "reverse"], flip={"overall": None}, length={"adjusted_recorded": True})["trusted"]


def test_spearman_known_example():
    x = [106, 86, 100, 101, 99, 103, 97, 113, 112, 110]
    y = [7, 0, 27, 50, 28, 29, 20, 12, 6, 17]
    assert round(spearman(x, y), 4) == -0.1758
    assert spearman([1, 2, 3], [1, 2, 3]) == 1.0 and spearman([1, 2, 3], [3, 2, 1]) == -1.0
    assert spearman([1, 1, 1], [1, 2, 3]) is None
    assert round(spearman([1, 2, 2, 4], [1, 3, 2, 4]), 3) == 0.949   # ties use average ranks


def test_gold_flags_criteria_under_point_six_untrusted():
    human = {f"d{i}": {"a": i, "b": i} for i in range(1, 7)}
    judged = {f"d{i}": {"a": i + 0.1, "b": 7 - i} for i in range(1, 7)}   # a agrees, b is reversed
    rep = gold_report(human, judged, ["a", "b", "c"])
    assert rep["criteria"]["a"]["status"] == "smoke" and "a" in rep["untrusted"] and rep["criteria"]["b"]["status"] == "untrusted"
    assert rep["criteria"]["c"]["status"] == "untrusted" and rep["criteria"]["c"]["rho"] is None
    assert rep["untrusted"] == ["a", "b", "c"] and "smoke" in rep["warnings"][0]


def test_non_claude_hook_refuses_without_env(monkeypatch):
    monkeypatch.delenv("DECK_BENCH_ALLOW_NON_CLAUDE", raising=False)
    with pytest.raises(BenchError, match="Claude-only"):
        NonClaudeJudge("other", lambda p, r: {}, lambda p, r, o: [])
    with pytest.raises(BenchError):
        RecordedJudge({"judge": "x", "family": "other", "scores": {}, "rankings": {}})
    monkeypatch.setenv("DECK_BENCH_ALLOW_NON_CLAUDE", "1")
    assert NonClaudeJudge("other", lambda p, r: {}, lambda p, r, o: []).family == "other"
    with pytest.raises(BenchError):
        NonClaudeJudge("claude", lambda p, r: {}, lambda p, r, o: [])


def test_claude_judge_needs_live_and_flag():
    for live, flag in ((False, False), (True, False), (False, True)):
        with pytest.raises(BenchError):
            ClaudeJudge(live=live, confirmed=flag)


def test_judgment_without_evidence_is_rejected(tmp_path):
    j = _judge("j", "claude", 3, ["D1", "D2", "D3"], ["D3", "D2", "D1"])
    j.data["scores"]["D1"][IDS[0]]["evidence"] = ""
    pk, _ = P.build_packets(_runs(tmp_path), 0)
    with pytest.raises(BenchError, match="evidence"):
        j.score({"label": "D1"}, RUBRIC)


def test_experiment_matrix_12_clients_3_arms_2_seeds_is_72_builds_with_cost():
    e = experiment.design([f"c{i}" for i in range(12)], list(experiment.ARMS), [1, 2])
    assert e["builds"] == 72 == len(e["matrix"]) and e["judge_calls"] == 432
    assert len({r["run_id"] for r in e["matrix"]}) == 72
    assert 60 <= e["cost_usd"]["low"] < e["cost_usd"]["high"] <= 160 and "72 builds" in e["line"] and "$" in e["line"]


def test_noise_line_from_repeated_seeds():
    rows = [{"client": "c", "arm": "a", "seed": 1, "total": 3.0}, {"client": "c", "arm": "a", "seed": 2, "total": 3.4},
            {"client": "d", "arm": "a", "seed": 1, "total": 2.0}, {"client": "d", "arm": "a", "seed": 2, "total": 2.2}]
    n = noise_line(rows)
    assert n["cells"] == 2 and n["pooled_sd"] == 0.224 and "noise: pooled SD 0.22" in n["line"]
    assert noise_line(rows[:1])["pooled_sd"] is None


def test_cli_score_gold_design(tmp_path, monkeypatch, capsys):
    from deck.bench.__main__ import main
    runs = _runs(tmp_path)
    monkeypatch.setenv("DECK_BENCH_ALLOW_NON_CLAUDE", "1")
    paths = []
    for j in _two(monkeypatch):
        p = tmp_path / f"{j.name}.json"
        p.write_text(json.dumps(j.data))
        paths.append(str(p))
    out = tmp_path / "bench.json"
    args = ["score", *map(str, runs), "--seed", "7", "--out", str(out)]
    for p in paths:
        args += ["--judgments", p]
    assert main(args + ["--label", "trusted"]) == 0
    bench = json.loads(out.read_text())
    assert bench["scoring_run_meta"]["label"] == "trusted" and set(bench["mapping"]) == {"D1", "D2", "D3"}
    human = tmp_path / "h.json"
    human.write_text(json.dumps({"decks": {r.name: {c: i + 1 for c in IDS} for i, r in enumerate(runs)}}))
    assert main(["gold", "--human", str(human), "--bench", str(out)]) == 0
    assert main(["design", "--clients", "a,b", "--seeds", "1,2"]) == 0
    assert main(["score", *map(str, runs), "--out", str(tmp_path / "x.json")]) == 2      # no judge given
    monkeypatch.delenv("DECK_BENCH_ALLOW_NON_CLAUDE")
    assert main(["score", *map(str, runs), "--judgments", paths[1], "--out", str(tmp_path / "y.json")]) == 2


def test_family_case_cannot_fake_two_families(monkeypatch):
    from deck.bench.run import scoring_run_meta
    monkeypatch.delenv("DECK_BENCH_ALLOW_NON_CLAUDE", raising=False)
    a = RecordedJudge({"judge": "a", "family": "claude", "scores": {}, "rankings": {}})
    b = RecordedJudge({"judge": "b", "family": " Claude ", "scores": {}, "rankings": {}})    # no env var needed: still Claude
    assert a.family == b.family == "claude"
    w = {"source": "x", "label": "y"}
    meta = scoring_run_meta(weights=w, judges=[{"family": "claude", "judge": "a"}, {"family": "Claude", "judge": "b"}],
                            orders=["forward", "reverse"], flip={"overall": 0.0}, length={"adjusted_recorded": True})
    assert meta["judge_families"] == ["claude"] and not meta["trusted"]
    with pytest.raises(BenchError):
        label_run(meta, "trusted")
    monkeypatch.setenv("DECK_BENCH_ALLOW_NON_CLAUDE", "1")
    assert NonClaudeJudge("Other ", lambda p, r: {}, lambda p, r, o: []).family == "other"


def test_same_named_run_dirs_get_unique_ids_and_unharmed_text(tmp_path):
    lum = json.loads((FIX / "lumen_water" / "golden_deck.json").read_text())
    lum["slides"][lum["order"][0]]["blocks"] = [{"type": "text", "text": "something new in your hand, a whole new habit"}]
    dirs = []
    for ag in ("agency_A", "agency_B", "agency_C"):
        d = tmp_path / ag / "new"
        d.mkdir(parents=True)
        (d / "deck.json").write_text(json.dumps(lum))
        dirs.append(d)
    pk, mapping = P.build_packets(dirs, 0)
    assert sorted(mapping.values()) == ["agency_A/new", "agency_B/new", "agency_C/new"]
    blob = " ".join(p["text"] for p in pk)
    assert "something new in your hand" in blob and "a whole new habit" in blob and "agency_" not in blob


def test_evidence_must_be_quoted_from_the_packet_and_slide_must_exist(tmp_path):
    pk, _ = P.build_packets(_runs(tmp_path), 0)
    p = pk[0]
    real = p["text"].split("\n")[1].lstrip("- ")[:40]
    ok = {c: {"score": 3, "slide": 1, "evidence": real, "rationale": "r"} for c in IDS}
    from deck.bench.judges import check_judgment
    assert check_judgment(ok, RUBRIC, p) is ok
    bad = copy.deepcopy(ok)
    bad[IDS[0]]["evidence"] = "a paraphrase that no slide contains"
    with pytest.raises(BenchError, match="not quoted"):
        check_judgment(bad, RUBRIC, p)
    off = copy.deepcopy(ok)
    off[IDS[1]]["slide"] = 99
    with pytest.raises(BenchError, match="slide"):
        check_judgment(off, RUBRIC, p)


def test_mixed_tender_weights_are_per_deck(tmp_path, monkeypatch):
    runs = _runs(tmp_path)
    ids = [c for c in IDS]
    d = json.loads((runs[0] / "deck.json").read_text())
    d["scoring"] = [{"criterion": c, "weight": f"{x}%"} for c, x in zip(ids, [10] * 8 + [20])]
    (runs[0] / "deck.json").write_text(json.dumps(d))
    out = run_bench(runs, _two(monkeypatch), seed=7, profile_id="tender_response")
    assert out["weights"]["source"] == "mixed" and out["scoring_run_meta"]["weights_source"] == "mixed"
    lab = next(k for k, v in out["mapping"].items() if v == runs[0].name)
    assert out["weights"]["weights"][lab][ids[-1]] == 20
    other = next(k for k in out["mapping"] if k != lab)
    assert out["weights"]["weights"][other] != out["weights"]["weights"][lab]
