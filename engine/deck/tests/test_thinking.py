"""Offline tests for the thinking lane: three insight candidates, the insight judge, the insight slide shape, and the
idea_single, insight_shape and chain_links checks (DECK-CRAFT-PLAN 3.3-3.5). Invented fixtures only (Lumen Water), a stubbed
model call, no live run. Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests``."""
from __future__ import annotations

import copy
import json
from pathlib import Path

from deck import assemble, evaluate, inputs, run_deck, spec, stages, validate

FIX = Path(__file__).parent / "fixtures"
LUMEN, THINK = FIX / "lumen_water", FIX / "thinking"


def _load(name: str, folder: Path = THINK) -> dict:
    """One recorded fixture file."""
    return json.loads((folder / name).read_text())


def _st(judge: str | None = "insight_judge_pass.json", **over) -> dict:
    """Stage outputs: Lumen's a and c, the thinking b and d, and (optionally) a recorded insight judge."""
    st = {"a": _load("a_requirements.json", LUMEN), "b": _load("b_storyline.json"), "c": _load("c_territories.json", LUMEN), "d": _load("d_idea.json")}
    if judge:
        st["insight_judge"] = _load(judge)
    st.update(over)
    return st


def _build(st: dict) -> tuple[dict, object]:
    """The deck and inputs for a stage set."""
    inp = inputs.load(LUMEN / "brief_object.json")
    return assemble.build(inp, st, client="Lumen Water", project="National awareness campaign"), inp


def _insight(deck: dict) -> dict:
    """The insight slide."""
    return next(s for s in deck["slides"].values() if s["type"] == "insight")


def _checks(deck, inp, name: str) -> list:
    """Findings of one check."""
    return [f for f in validate.run(deck, inp) if f["check"] == name]


# ---------------------------------------------------------------- candidates and the chosen insight

def test_candidates_are_in_the_deck_meta_and_the_chosen_one_is_the_slide():
    """Three candidates reach deck.meta (for Gate 1), the chosen one marked, with the judge's verdict on each."""
    deck, _ = _build(_st())
    cands = deck["meta"]["insight_candidates"]
    assert [c["id"] for c in cands] == ["a", "b", "c"] and [c["chosen"] for c in cands] == [True, False, False]
    assert cands[0]["judge"]["pass"] is True and cands[1]["judge"]["failed"] == ["generic", "specific"]
    assert deck["meta"]["insight"] == {"chosen": "a", "writer_choice": "a", "chosen_by": "writer and judge agree",
                                       "why": "It is the only one that names the tap.", "judged": True, "judge_pass": True, "needs_human": False}
    blocks = _insight(deck)["blocks"]
    assert blocks[0]["kind"] == "statement" and blocks[0]["text"].startswith("People say they care about water")
    assert blocks[0]["refs"] == ["brief:insight"]


def test_the_judge_may_overrule_the_writer():
    """The judge's first passing candidate is the insight; the notes say who chose."""
    deck, _ = _build(_st("insight_judge_overrule.json"))
    assert deck["meta"]["insight"]["chosen"] == "b" and deck["meta"]["insight"]["writer_choice"] == "a"
    assert deck["meta"]["insight"]["chosen_by"] == "judge"
    assert "Writer's pick: a" in _insight(deck)["notes"]


def test_every_candidate_failing_the_judge_marks_the_slide_needs_human():
    """All three fail: the writer's pick stays on the slide, flagged, and the judge's reasons are in the notes."""
    deck, _ = _build(_st("insight_judge_fail.json"))
    sl = _insight(deck)
    assert sl["status"] == "needs_human" and deck["meta"]["insight"]["needs_human"] and deck["meta"]["insight"]["judge_pass"] is False
    assert "Every candidate failed the judge" in sl["notes"]


def test_a_paraphrase_with_a_number_fails_a_candidate_whatever_the_tests_say():
    """The pass is computed in code: all tests right, but a paraphrase with a digit fails; a recorded pass is ignored."""
    j = _load("insight_judge_pass.json")
    j["verdicts"][0]["paraphrase"] = "9 in 10 households ignore the tap."
    j["verdicts"][0]["pass"] = True
    v = assemble.judge_verdicts(j)
    assert v["a"]["pass"] is False and "paraphrase" in v["a"]["failed"]


def test_without_a_recorded_judge_the_writers_choice_stands_and_is_not_judged():
    """No judge output: the deck is built with the writer's pick, judged False, nothing blocks."""
    deck, _ = _build(_st(judge=None))
    assert deck["meta"]["insight"]["judged"] is False and deck["meta"]["insight"]["chosen"] == "a"
    assert _insight(deck)["status"] == "drafted"


def test_the_three_line_slide_does_not_call_the_truth_an_illustrative_quote():
    """No quote block (so no 'Illustrative line' label): a statement, a fixed label saying what it rests on, and the evidence as small lines."""
    deck, _ = _build(_st())
    blocks = _insight(deck)["blocks"]
    assert [b["kind"] for b in blocks] == ["statement", "small", "small"]
    assert blocks[1]["text"] == spec.INSIGHT_LABEL and blocks[2]["refs"] == ["brief:insight"]
    shown = " ".join(str(b.get("text", "")) for b in spec.shown_blocks(_insight(deck)))
    assert spec.ILLUSTRATIVE_QUOTE not in shown
    assert _insight(deck)["claims"][0]["refs"] == ["brief:insight"]


def test_a_truth_with_no_refs_is_labelled_as_a_proposal():
    """A chosen candidate that cites nothing carries the unsourced label and an opinion basis, never a verbatim look."""
    st = _st()
    st["b"]["insight_candidates"][0]["refs"] = []
    deck, _ = _build(st)
    blocks = _insight(deck)["blocks"]
    assert blocks[0]["basis"] == "opinion" and blocks[1]["text"] == spec.INSIGHT_LABEL_UNSOURCED


def test_an_old_stage_b_file_builds_the_deck_it_always_did():
    """A stage b with no candidates: no insight meta, a quote block, and no new finding."""
    deck, inp = _build(_st(b=_load("b_storyline.json", LUMEN), d=_load("d_idea.json", LUMEN), judge=None))
    assert "insight" not in deck["meta"] and "insight_candidates" not in deck["meta"] and "chain" not in deck["meta"]
    assert _insight(deck)["blocks"][0]["kind"] == "quote"
    assert not [f for f in validate.run(deck, inp) if f["check"] in ("insight_shape", "idea_single", "chain_links")]


# ---------------------------------------------------------------- the checks

def test_insight_shape_passes_on_the_good_slide():
    """The fixture's slide has three sentences, a tension, a 'so', no number, refs and an evidence line."""
    deck, inp = _build(_st())
    assert _checks(deck, inp, "insight_shape") == []


def test_insight_shape_fires_on_each_failure():
    """No tension, no 'so', a number, no evidence line and no refs each warn; the form needs all of them."""
    st = _st()
    c = st["b"]["insight_candidates"][0]
    c.update(tension="And the care lives in the abstract.", implication="Make the tap the place for 5 minutes of care.", refs=[])
    st["b"]["insight"]["evidence"] = []
    deck, inp = _build(st)
    found = _checks(deck, inp, "insight_shape")
    msgs = " | ".join(f["message"] for f in found)
    for part in ("no tension", "does not say what it means", "a number in the insight", "cites no input", "no evidence line"):
        assert part in msgs
    assert all(f["level"] == "warn" for f in found)


def test_insight_shape_is_quiet_for_an_old_shape_deck():
    """The check applies to decks built from candidates; an old-shape deck is untouched (its goldens stay byte-identical)."""
    deck, inp = _build(_st(b=_load("b_storyline.json", LUMEN), judge=None))
    assert _checks(deck, inp, "insight_shape") == []


def test_idea_single_passes_for_one_short_idea():
    """One presented idea slide, under 60 words, no channel list."""
    deck, inp = _build(_st())
    assert _checks(deck, inp, "idea_single") == []


def test_idea_single_fires_on_a_channel_list_and_on_two_ideas():
    """An idea that names two channels warns; a second presented idea slide warns unless the client asked for more routes."""
    st = _st()
    st["d"]["idea"] = "Every household gets its own water story, on a poster and on instagram and on the radio."
    deck, inp = _build(st)
    assert any("channel list" in f["message"] or "channels" in f["message"] for f in _checks(deck, inp, "idea_single"))
    deck2, inp2 = _build(_st())
    idea = next(x for x in deck2["order"] if deck2["slides"][x]["type"] == "idea")
    deck2["slides"]["s99"] = copy.deepcopy(deck2["slides"][idea])
    deck2["order"].insert(deck2["order"].index(idea) + 1, "s99")
    assert any("recommend one idea" in f["message"] for f in _checks(deck2, inp2, "idea_single"))
    deck2["requirements"] = {"r_x": {"id": "r_x", "kind": "scope", "text": "Show us three creative directions"}}
    assert _checks(deck2, inp2, "idea_single") == []   # the client asked to see more than one


def test_idea_single_fires_over_the_word_limit():
    """An idea statement past 60 words warns."""
    st = _st()
    st["d"]["idea"] = " ".join(["water"] * 70)
    deck, inp = _build(st)
    assert any("70 words" in f["message"] for f in _checks(deck, inp, "idea_single"))


def test_chain_links_pass_and_each_missing_phrase_fires():
    """The fixture's four phrases are found on the slides they name; a phrase on the wrong slide warns, and the proof must repeat the idea."""
    deck, inp = _build(_st())
    assert deck["meta"]["chain"]["idea_phrase"] == "its own water story" and _checks(deck, inp, "chain_links") == []
    st = _st()
    st["d"]["chain"].update(insight_phrase="a phrase nowhere", strategy_phrase="also not anywhere here")
    deck, inp = _build(st)
    msgs = [f["message"] for f in _checks(deck, inp, "chain_links")]
    assert len(msgs) == 2 and "insight_phrase" in msgs[0] and "proposition slide" in msgs[1]
    st = _st()
    st["d"]["measurement"][0]["how"] = "Utility meter data"
    deck, inp = _build(st)
    assert any("proof does not cite the idea" in f["message"] for f in _checks(deck, inp, "chain_links"))


def test_no_chain_means_no_chain_check():
    """A stage d without a chain adds no meta.chain and no finding."""
    st = _st()
    del st["d"]["chain"]
    deck, inp = _build(st)
    assert "chain" not in deck["meta"] and _checks(deck, inp, "chain_links") == []


def test_relay_test_is_recorded_without_a_model():
    """The relay line holds the titles, the idea line and a lexical overlap, marked record only; None with no idea slide."""
    deck, _ = _build(_st())
    r = validate.relay_test(deck)
    assert r["mode"] == "record_only" and r["idea_line"] == "Every drop has a story." and 0 <= r["overlap"] <= 1 and r["titles"]
    deck["order"] = [x for x in deck["order"] if deck["slides"][x]["type"] != "idea"]
    assert validate.relay_test(deck) is None


# ---------------------------------------------------------------- the judge stage and run_deck

def test_the_judge_stage_reads_the_candidates_blind_and_maps_ids_back(monkeypatch):
    """The judge sees ids j1..j3 and no choice or swap-test text; the object it returns carries the writer's ids."""
    reply = {"verdicts": [{"id": "j1", "tests": _load("insight_judge_pass.json")["verdicts"][0]["tests"], "paraphrase": "x"}], "order": ["j2", "j1"]}
    calls = []
    monkeypatch.setattr(stages, "_call", lambda stage, user, system: (calls.append((stage, user)) or (copy.deepcopy(reply), {"model": "stub", "secs": 0, "calls": 1})))
    obj, _ = stages.insight_judge(_st(judge=None))
    stage, user = calls[0]
    assert stage == "insight_judge" and '"j1"' in user and "chosen_candidate_id" not in user and "swap_test" not in user and "confidence" not in user
    assert obj["verdicts"][0]["id"] == "a" and obj["order"] == ["b", "a"] and stages.MODELS["insight_judge"] != stages.MODELS["b"]


def _args(stages_dir: Path, live: bool):
    """The few run_deck arguments _judge_insight reads."""
    return type("A", (), {"stages": stages_dir, "live": live})()


def _stage_dir(tmp_path: Path, judge: str | None) -> Path:
    """A stage directory (holding a judge file when named)."""
    d = tmp_path / "stages"
    d.mkdir()
    if judge:
        (d / "insight_judge.json").write_text(json.dumps(_load(judge)))
    return d


def test_without_a_recorded_judge_and_not_live_the_step_is_skipped_quietly(tmp_path):
    """Not live and no insight_judge.json: the report says skipped, nothing is called, st gets no judge."""
    st, rep = {"b": _load("b_storyline.json")}, {"stages": {}}
    run_deck._judge_insight(_args(_stage_dir(tmp_path, None), False), None, st, None, rep)
    assert rep["stages"]["insight_judge"] == {"source": "skipped: no recorded output"} and "insight_judge" not in st


def test_a_recorded_judge_is_read_and_an_old_b_adds_no_row(tmp_path):
    """A recorded judge goes into st; a stage b with no candidates adds nothing to the report."""
    st, rep = {"b": _load("b_storyline.json")}, {"stages": {}}
    run_deck._judge_insight(_args(_stage_dir(tmp_path, "insight_judge_pass.json"), False), None, st, None, rep)
    assert st["insight_judge"]["order"] == ["a", "b", "c"] and rep["stages"]["insight_judge"]["source"] == "recorded"
    st2, rep2 = {"b": _load("b_storyline.json", LUMEN)}, {"stages": {}}
    run_deck._judge_insight(_args(tmp_path, False), None, st2, None, rep2)
    assert rep2["stages"] == {}


def test_live_all_fail_reruns_b_once_with_the_reasons_and_logs_it(monkeypatch, tmp_path):
    """Live, stage b live, every candidate fails: b is re-run ONCE with the judge's reasons, judged again, and logged in b."""
    d = _stage_dir(tmp_path, None)
    judged = []

    def call(stage, user, system):
        """Judge fails first and passes after the retry; b returns the same candidates."""
        if stage == "insight_judge":
            judged.append(1)
            return copy.deepcopy(_load("insight_judge_fail.json" if len(judged) == 1 else "insight_judge_pass.json")), {"model": "stub", "secs": 0, "calls": 1}
        assert stage == "b" and "<insight_judge_reasons>" in user
        return _load("b_storyline.json"), {"model": "stub", "secs": 0, "calls": 1}

    monkeypatch.setattr(stages, "_call", call)
    st, rep = {"b": _load("b_storyline.json"), "a": {}}, {"stages": {"b": {"source": "live"}}}
    run_deck._judge_insight(_args(d, True), inputs.load(LUMEN / "brief_object.json"), st, None, rep)
    assert len(judged) == 2 and st["b"]["insight_retry"]["first_candidates"] == ["a", "b", "c"] and st["b"]["insight_retry"]["reasons"][0].startswith("a:")
    assert (d / "insight_judge.json").exists() and (d / "b_storyline.json").exists() and "insight_retry" in rep["stages"]
    assert assemble.judge_verdicts(st["insight_judge"])["a"]["pass"]


# ---------------------------------------------------------------- evaluate

def test_evaluate_reports_insight_idea_and_chain(tmp_path):
    """The code-derived measures for a deck built from candidates, and None for the old shape."""
    deck, inp = _build(_st())
    F = validate.run(deck, inp)
    assert evaluate.thinking(deck, F) == {"insight": {"shape": "pass", "chosen_by": "writer and judge agree", "judge": "pass"}, "idea": "single",
                                          "chain": {"links": 4, "ok": 4}}
    old, oinp = _build(_st(b=_load("b_storyline.json", LUMEN), d=_load("d_idea.json", LUMEN), judge=None))
    to = evaluate.thinking(old, validate.run(old, oinp))
    assert to["insight"] is None and to["idea"] == "single" and to["chain"] is None
    (tmp_path / "deck.json").write_text(json.dumps(deck, default=str))
    (tmp_path / "validation.json").write_text(json.dumps(F))
    row = evaluate.score(tmp_path)
    assert row["thinking"]["chain"]["ok"] == 4 and "Chain links found" in evaluate.page([{**row, "label": None}])


# ---------------------------------------------------------------- fixes from the thinking review

def test_chain_phrase_matches_whole_words_and_needs_three_words():
    """'car' in 'scarce', 'so' in 'reasons' and 'the' no longer count as found; a phrase under three words warns."""
    deck, inp = _build(_st())
    deck["meta"]["chain"] = {"insight_phrase": "car", "strategy_phrase": "so", "idea_phrase": "the", "proof_phrase": "e"}
    msgs = [f for _, _, f in validate.chain_findings(deck)]
    assert len(msgs) == 4 and all("under 3 words" in m for m in msgs)
    assert validate._has_phrase("parents scarce time", "scarce time") and not validate._has_phrase("parents scarce time", "car")


def test_empty_chain_phrase_is_not_a_link_in_evaluate():
    """A phrase that normalises to nothing ('!!!') is not counted as a link."""
    deck = {"meta": {"chain": {"insight_phrase": "!!!"}}, "order": [], "slides": {}}
    assert evaluate.thinking(deck, [])["chain"] is None


def test_vague_judge_answers_are_not_a_firm_no_and_malformed_tests_do_not_crash():
    """'Not sure' is no answer (the generic test fails); a list as tests fails every test instead of raising."""
    t = {"generic": "Not sure", "human_tension": "yes", "specific": "yes", "follows": "yes"}
    v = assemble.judge_verdicts({"verdicts": [{"id": "a", "tests": t, "paraphrase": "x"}]})
    assert v["a"]["pass"] is False and "generic" in v["a"]["failed"]
    assert assemble._yn("No, it is specific") == "no" and assemble._yn("none") == "" and assemble._yn("nothing") == ""
    v = assemble.judge_verdicts({"verdicts": [{"id": "a", "tests": ["x"]}]})
    assert v["a"]["pass"] is False


def test_judge_receives_the_evidence_text_behind_the_refs(monkeypatch):
    """The judge's user message carries an <evidence> block with the text of each cited ref (and says when there is none)."""
    calls = []
    monkeypatch.setattr(stages, "_call", lambda stage, user, system: (calls.append(user) or ({"verdicts": [], "order": []}, {"model": "stub", "secs": 0, "calls": 1})))
    inp = inputs.load(LUMEN / "brief_object.json")
    stages.insight_judge(_st(judge=None), None, inp)
    ev = calls[0].split("<evidence>")[1]
    assert "no evidence text is given" not in ev and ev.strip().strip("</evidence>").strip().startswith("[")
    stages.insight_judge(_st(judge=None))
    assert "no evidence text is given" in calls[1]


def test_a_recorded_judge_is_ignored_when_b_was_live_this_run(tmp_path):
    """Not live: a recorded judge is skipped when stage b was written live (its ids would name new candidates)."""
    st, rep = {"b": _load("b_storyline.json")}, {"stages": {"b": {"source": "live"}}}
    run_deck._judge_insight(_args(_stage_dir(tmp_path, "insight_judge_pass.json"), False), None, st, None, rep)
    assert rep["stages"]["insight_judge"] == {"source": "skipped: no recorded output"} and "insight_judge" not in st


def test_live_b_follows_the_judge_pick_before_c_and_d(tmp_path):
    """When the judge's first passing candidate is not the writer's, the live b records the judge's as the chosen one and keeps the writer's."""
    st = {"b": _load("b_storyline.json"), "insight_judge": _load("insight_judge_overrule.json")}
    st["b"]["insight"]["chosen_candidate_id"] = "a"
    d = tmp_path / "s"; d.mkdir()
    rep = {"stages": {"b": {"source": "live"}}}
    run_deck._follow_judge(_args(d, True), st, rep)
    pick = assemble.passing_ids(st["b"], st["insight_judge"])[0]
    if pick != "a":
        assert st["b"]["insight"]["chosen_candidate_id"] == pick and st["b"]["insight"]["writer_chosen_candidate_id"] == "a"
        assert (d / "b_storyline.json").exists()
    st2 = {"b": _load("b_storyline.json"), "insight_judge": _load("insight_judge_overrule.json")}
    run_deck._follow_judge(_args(d, False), st2, {"stages": {"b": {"source": "recorded"}}})
    assert "writer_chosen_candidate_id" not in st2["b"]["insight"]
