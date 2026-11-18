"""The repair loop (deck-repair-loop, slice 5): the map, the ladder, the keep gate, the token ledger, the shorten guard, record and replay.

No model call and no network: ``--live`` is never passed, the paid rung is driven by recordings or by an injected ``call_fn``, and QA is a
deterministic stand-in (``qa_seam``) so a real round runs (a real .pptx is rendered and read back) without LibreOffice. Every replay test asserts
that rounds ran and that one was kept, so none passes because the loop never started. Run from ``engine/``:
``PYTHONPATH=. python3 -m pytest -q deck/tests/test_repair.py``.
"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import shutil
from pathlib import Path

import pytest
from pptx import Presentation

from deck import assemble, issues as I, layouts, ledger, repair, run_deck, spec, stages, validate
from deck.bench import checklist, compare, fixtures

FX = fixtures.FIXTURE_ROOT / "lumen_water"
REPAIR_FX = fixtures.FIXTURE_ROOT / "repair"
POLICY = repair.load_policy()
#: The overlong fixture's idea slide (s08, block 1, slot ``text``): an invented sentence with a quarter pair, a hedge, a negation and a count.
LONG = ("It links the tap to the person, so that every household sees its own water story in the bills they already read and the adverts they already see, "
        "and it does so about four times a year, not once, in Q3 and Q4, for up to 12 months.")
SHORT = ("It links the tap to the person, so every household sees its own water story in the bills they already read and the adverts they already see, "
         "about four times a year, not once, in Q3 and Q4, for up to 12 months.")
S, SLOT, BLOCK, CAP = "s08", "text", 1, 215   # the fake QA flags s08's text while it is over CAP characters


# ---------------------------------------------------------------------------------------------------- helpers
def fake_qa(rules: dict, check: str = "text_overflow"):
    """A QA stand-in: ``rules`` is ``{slide id: fn(slide) -> message or None}``; a message is an error of ``check`` on that slide, naming its shape."""
    def qa(pptx, pdf, folder, findings):
        deck = json.loads((Path(folder) / "deck.json").read_text())
        slides = {}
        for sid, fn in rules.items():
            msg = fn(deck["slides"][sid])
            if msg:
                slides.setdefault(str(deck["order"].index(sid) + 1), []).append({"check": check, "level": "error", "message": msg})
        res = {"slides": slides, "pixels": {}, "summary": {"errors": sum(map(len, slides.values())), "warnings": 0, "slides_flagged": len(slides), "line": "stand-in"}}
        (Path(folder) / "qa.json").write_text(json.dumps(res))
        return res
    return qa


def too_long(slot: str, limit: int, block: int = 0):
    """Flag the slide while block ``block``'s words are over ``limit`` characters (a shortening clears it)."""
    return lambda s: (f"'slot:{slot}' text is about 5.2 in tall in a 4.4 in frame: \"{s['blocks'][block].get('text', '')[:10]}\"" if len(s["blocks"][block].get("text", "")) > limit else None)


def layout_is(slot: str, layout_id: str):
    """Flag the slide while it is drawn in ``layout_id`` (a layout swap clears it)."""
    return lambda s: (f"'slot:{slot}' text is about 5.2 in tall in a 4.4 in frame: \"x\"" if (s.get("layout") or {}).get("id") == layout_id else None)


def scale_over(slot: str, cap: float):
    """Flag the slide while its type is scaled above ``cap`` (a shrink clears it)."""
    return lambda s: (f"'slot:{slot}' text is about 5.2 in tall in a 4.4 in frame: \"x\"" if ((s.get("layout") or {}).get("fit") or {}).get("scale", 1) > cap else None)


def build(out: Path, qa=None, *extra, stages_dir: Path | None = None, monkeypatch=None) -> dict:
    """run_deck on the Lumen Water fixture: no model, no LibreOffice, a real .pptx, QA through ``qa``."""
    saved = (run_deck.subprocess.run, run_deck._soffice, run_deck.qa_seam)
    run_deck.subprocess.run, run_deck._soffice, run_deck.qa_seam = (lambda *a, **k: None), (lambda: "soffice"), qa
    argv = ["--stages", str(stages_dir or FX), "--brief", str(FX / "brief_object.json"), "--client", "Lumen Water", "--project", "National awareness campaign",
            "--out", str(out), "--density", "detailed", *extra]
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            return run_deck.main(argv)
    finally:
        run_deck.subprocess.run, run_deck._soffice, run_deck.qa_seam = saved


def jload(p: Path):
    return json.loads(Path(p).read_text())


@pytest.fixture
def stages_copy(tmp_path):
    d = tmp_path / "stages"
    shutil.copytree(REPAIR_FX / "overlong", d)
    return d


def recording(stages_dir: Path, n: int, request: list, edits: list) -> None:
    (stages_dir / f"e_repair_{n}.json").write_text(json.dumps({"stage": "e_repair", "round": n, "request_sha": repair.sha(request), "request": request, "edits": edits,
                                                                "usage": {"model": "claude-sonnet-5-5", "usd": 0.01, "prompt_tokens": 100, "completion_tokens": 50, "secs": 1.0}}))


def _edit(request, text):
    """The stand-in model's answer: ``text`` for the idea slide's slot, from whatever the request asked."""
    r = next(x for x in request if x["slot"] == SLOT)
    return [{"slide": r["slide"], "slot": r["slot"], "field": r["fields"][0]["id"], "text": text}]


def capture_request(monkeypatch, edits_for):
    """Wrap repair.get_reply: remember each request and answer with ``edits_for(request)`` (a stand-in for the model). No network."""
    seen = []

    def fake(ctx, n, request, skipped):
        seen.append(request)
        return edits_for(request), {"source": "recorded", "request_sha": repair.sha(request)}
    monkeypatch.setattr(repair, "get_reply", fake)
    return seen


# ---------------------------------------------------------------------------------------------------- the map and the interface
def test_every_check_has_a_row_and_every_rung_is_a_fix_kind():
    assert set(repair.ACTION_MAP) >= set(spec.ISSUE_CHECKS)
    for check, row in repair.ACTION_MAP.items():
        for rung in [*row["rungs"], *row.get("flow", ()), *row.get("regen_then_drop", ())]:
            assert rung in spec.ISSUE_FIXES or rung in repair.EXTRA_RUNGS, (check, rung)
    for c in spec.QA_RENDER_CHECKS + spec.CHECKS:   # content checks are never repaired: a fact, a source or a decision is a person's
        if c in spec.CHECKS and c not in ("word_budget", "image_missing", "image_unapproved", "image_flagged", "image_rights"):
            assert repair.ACTION_MAP[c]["rungs"] == ("left_for_person",), c


def test_slice_four_interface_is_the_one_the_loop_consumes():
    import inspect
    assert list(inspect.signature(layouts.plan).parameters) == ["base_deck", "library", "prefs", "swaps", "hooks", "fixes"]


def test_policy_loads_and_a_profile_or_file_overrides_it(tmp_path):
    assert POLICY["max_rounds"] == 2 and POLICY["images"]["on_flag"] == "wait_for_person" and "ledger_kept" in POLICY["shorten"]["guards"]
    over = tmp_path / "p.yaml"
    over.write_text("max_rounds: 0\nshorten:\n  max_cut_ratio: 0.2\n")
    p = repair.load_policy({"repair": {"max_usd": 0.1}}, over)
    assert (p["max_rounds"], p["max_usd"], p["shorten"]["max_cut_ratio"], p["shorten"]["max_slots_per_round"]) == (0, 0.1, 0.2, 12)
    over.write_text("max_rounds: 5\n")
    with pytest.raises(Exception):
        repair.load_policy(None, over)


# ---------------------------------------------------------------------------------------------------- FIX 2: the token ledger, from the rendered pptx
BASE_TEXT = "Revenue grew in Q3 from EUR 5m to EUR 7m, up to 12 hires, not 40% of Lumen Water staff, said Acme."
#: The adversarial table: one altered word each. Every row must be refused.
ADVERSARIAL = {
    "Q3 to Q4": lambda t: t.replace("Q3", "Q4"),
    "5m to 5k": lambda t: t.replace("EUR 5m", "EUR 5k"),
    "a dropped not": lambda t: t.replace(", not 40%", ", 40%"),
    "a dropped up to": lambda t: t.replace("up to 12", "12"),
    "a name swap": lambda t: t.replace("Acme", "Globex"),
    "a from/to swap": lambda t: t.replace("from EUR 5m to EUR 7m", "from EUR 7m to EUR 5m"),
    "40% to 40": lambda t: t.replace("40%", "40"),
    "EUR to GBP": lambda t: t.replace("EUR 7m", "GBP 7m"),
    "two numbers reordered": lambda t: t.replace("12 hires, not 40%", "40% hires, not 12"),
}


def _one_slide(tmp_path, text: str):
    """A real pptx of the Lumen deck with the audience slide's lead set to ``text`` (planned and rendered from the base), and its base deck."""
    build(tmp_path / "ledger", None, "--no-qa")
    base = layouts.strip_plan(jload(tmp_path / "ledger" / "deck.json"))
    s = base["slides"]["s05"]
    s["blocks"][0]["text"] = text
    deck, _iss, _ = layouts.plan(base, prefs={"density": "detailed"})
    from deck import render_pptx
    folder = tmp_path / "round"
    folder.mkdir()
    render_pptx.render(deck, None, folder / "deck.pptx", layouts_out=folder / "layouts.json")
    (folder / "deck.json").write_text(json.dumps(deck))
    return base, deck, folder


def _tamper(folder: Path, old: str, new: str) -> None:
    prs = Presentation(str(folder / "deck.pptx"))
    done = 0
    glue = lambda t: t[:t.rfind(" ")] + "\u00a0" + t[t.rfind(" ") + 1:]   # the renderer glues the last two words
    old, new = glue(old), glue(new) if new.rfind(" ") > 0 else new
    for sh in prs.slides[4].shapes:
        if sh.has_text_frame and old in sh.text_frame.text:
            for p in sh.text_frame.paragraphs:
                for r in p.runs:
                    if old in r.text:
                        r.text, done = r.text.replace(old, new), done + 1
    assert done, "the text to tamper with was not on the slide"
    prs.save(str(folder / "deck.pptx"))


def test_the_ledger_passes_an_untouched_slide_and_refuses_every_adversarial_row(tmp_path):
    base, deck, folder = _one_slide(tmp_path, BASE_TEXT)
    assert [d for d in repair.read_ledger(base, deck, folder, "review") if d["slide"] == "s05"] == []
    for name, mutate in ADVERSARIAL.items():
        b2, d2, f2 = _one_slide(tmp_path / name.replace(" ", "_").replace("/", "_"), BASE_TEXT)
        mutated = mutate(BASE_TEXT)
        assert mutated != BASE_TEXT, name
        _tamper(f2, BASE_TEXT, mutated)
        diffs = [d for d in repair.read_ledger(b2, d2, f2, "review") if d["slide"] == "s05"]
        assert diffs, f"the ledger did not refuse: {name}"


def test_mutation_every_single_ledger_token_changed_is_refused():
    """Mutate one word at a time: when the word carries the ledger (deleting it changes the ledger), every changed or dropped form of it is a different
    ledger, so every mutant is refused; a word that carries nothing may change freely."""
    texts = [BASE_TEXT, LONG, "Radio reach was about 3x in H1 FY26, never under 2m.", "Not for B2B in March 2026, without a budget of USD 4bn."]
    # what the ledger covers, spelled out: a ledger that quietly stopped reading a class of word would have no mutants of that class
    assert ledger.tokens(BASE_TEXT, ledger.known_names([BASE_TEXT])) == [
        ("num", "Q3"), ("name", "EUR"), ("num", "5m"), ("name", "EUR"), ("num", "7m"), ("hedge", "up to"), ("num", "12"), ("neg", "not"), ("num", "40%"),
        ("name", "Lumen"), ("name", "Water"), ("name", "Acme")]
    assert [k for k, _ in ledger.tokens(texts[2])] == ["hedge", "num", "num", "num", "neg", "num"]
    assert [k for k, _ in ledger.tokens(texts[3])] == ["neg", "num", "month", "num", "neg", "name", "num"]
    mutants = survivors = 0
    for t in texts:
        known = ledger.known_names([t])
        base = ledger.tokens(t, known)
        words = t.split(" ")
        for i, w in enumerate(words):
            without = " ".join(words[:i] + words[i + 1:])
            if ledger.tokens(without, known) == base:
                continue   # a word that carries nothing
            core = w.rstrip(".,")
            tail = w[len(core):]
            variants = ["", "Zed" + tail, core + "x" + tail]
            if any(c.isdigit() for c in core):
                variants += [core.translate(str.maketrans("0123456789", "1234567890")) + tail, core.rstrip("m%kx") + tail]
            if core.lower() in ("not", "never", "without", "about", "up", "est"):
                variants += ["", "only"]
            for v in variants:
                mutant = " ".join(words[:i] + ([v] if v else []) + words[i + 1:])
                if mutant == t:
                    continue
                mutants += 1
                survivors += ledger.tokens(mutant, known) == base
    assert mutants > 60 and survivors == 0


def test_the_ledger_reads_moved_points_from_the_notes_and_refuses_a_line_that_differs_by_one_character(tmp_path):
    out = tmp_path / "m"
    build(out, None, "--no-qa", "--density", "lean")
    deck = jload(out / "deck.json")
    moved = [(sid, s) for sid, s in deck["slides"].items() if (s.get("layout") or {}).get("fit", {}).get("moved")]
    assert moved, "the lean build moves at least one point to the notes"
    base = layouts.strip_plan(deck)
    assert repair.read_ledger(base, deck, out, "review") == []
    sid, s = moved[0]
    prs = Presentation(str(out / "deck.pptx"))
    sl = prs.slides[deck["order"].index(sid)]
    tf = sl.notes_slide.notes_text_frame
    line = ledger.notes_moved_lines(sl)[0]
    tf.text = tf.text.replace("- " + line, "- " + line[:-1] + ("!" if not line.endswith("!") else "?"), 1)
    prs.save(str(out / "deck.pptx"))
    diffs = repair.read_ledger(base, deck, out, "review")
    assert any(d["kind"] == "moved" and d["slide"] == sid for d in diffs)


# ---------------------------------------------------------------------------------------------------- the shorten guard (own words, ledger)
@pytest.mark.parametrize("new,why", [
    (SHORT, ""),
    (SHORT.replace("water story", "water tale"), "words that are not on the slide"),   # a synonym
    (SHORT.replace("up to 12", "up to 21"), "adds a number"),
    (SHORT.replace("Q3 and Q4", "Q4 and Q3"), "ledger"),
    (SHORT.replace("not once", "once"), "ledger"),
    (SHORT.replace("up to 12", "12"), "ledger"),
    (LONG + " today", "longer"),
    ("It links.", "cuts more than"),
    (LONG, "unchanged"),
])
def test_the_shorten_guard_accepts_deleting_and_refuses_a_synonym_a_changed_ledger_growth_and_a_deep_cut(new, why):
    got = assemble.shorten_problem(LONG, new, "Who we reach\n" + LONG, ledger.known_names([LONG]), tuple(POLICY["shorten"]["guards"]), 0.35)
    assert (why in got) if why else got == ""


def test_the_guard_refuses_a_title_and_measures_the_cut_against_the_base_not_the_last_round():
    guards = tuple(POLICY["shorten"]["guards"])
    assert "title" in assemble.shorten_problem(LONG, SHORT, LONG, frozenset(), guards, is_label=True) or "label" in assemble.shorten_problem(LONG, SHORT, LONG, frozenset(), guards, is_label=True)
    twice = SHORT.replace("every household sees", "every household")   # a second cut from the first round's text is still measured against the base
    known = ledger.known_names([LONG])
    assert assemble.shorten_problem(LONG, twice, LONG, known, guards, 0.35, current=SHORT) == ""
    deep = "It links the tap to the person, in Q3 and Q4, for up to 12 months."   # past 35 percent of the BASE field, whatever the last round held
    assert "cuts more than" in assemble.shorten_problem(LONG, deep.replace(", in Q3", ", not once, in Q3"), LONG, known, guards, 0.35, current=SHORT) or "cuts more than" in assemble.shorten_problem(LONG, "It links the tap to the person, not once, in Q3 and Q4, for up to 12 months.", LONG, known, guards, 0.35, current=SHORT)


# ---------------------------------------------------------------------------------------------------- FIX 4: eligibility
def _deck_with(blocks):
    return {"title": "T", "blocks": blocks, "type": "audience"}


def test_only_text_small_callout_card_and_unsourced_bullets_or_kv_items_are_eligible():
    quote = {"kind": "quote", "text": "We love Lumen."}
    statement = {"kind": "statement", "text": "A bold line."}
    fromto = {"kind": "fromto", "from": "a", "to": "b"}
    table = {"kind": "table", "rows": [["h"], ["c"]]}
    stats = {"kind": "stats", "items": [{"text": "5%"}]}
    sourced = {"kind": "text", "text": "A fact.", "refs": ["brief:x"], "basis": "sourced"}
    human = {"kind": "text", "text": "To supply.", "human": True}
    internal = {"kind": "small", "text": "Agency note.", "internal": True}
    ok_text = {"kind": "text", "text": "Plain words."}
    bullets = {"kind": "bullets", "items": [{"text": "a point"}, {"text": "sourced point", "refs": ["r"]}, {"text": "human point", "human": True}, "plain item"]}
    kv = {"kind": "kv", "items": [["Budget", "about 5m"]]}
    s = _deck_with([quote, statement, fromto, table, stats, sourced, human, internal, ok_text, bullets, kv])
    got = {bi: repair.eligible_fields(s, bi) for bi in range(len(s["blocks"]))}
    assert [bi for bi, f in got.items() if f] == [8, 9, 10]
    assert [f[0] for f in got[9]] == ["9.0", "9.3"] and got[10][0][1] == "about 5m"


def test_a_request_never_carries_a_quote_a_statement_or_an_evidence_item(tmp_path, monkeypatch, stages_copy):
    seen = capture_request(monkeypatch, lambda r: [])
    (stages_copy / "e_repair_1.json").write_text("{}")   # a recording exists, so the paid rung is available (its request is stale and unused here)
    out = tmp_path / "o"
    build(out, fake_qa({S: too_long(SLOT, CAP, BLOCK), "s04": layout_is("quote", "quote_cards"), "s03": layout_is("statement", "emphasis_bar")}), "--text-mode", "condense", stages_dir=stages_copy)
    sent = [json.dumps(r) for req in seen for r in req]
    assert seen and sent
    deck = jload(out / "repair" / "base_deck.json")
    for banned in ("I never think about", deck["slides"]["s03"]["blocks"][0].get("text", "\u0000")):
        assert not any(banned in s for s in sent)
    for r in (x for req in seen for x in req):
        assert r["slide"] != deck["slides"]["s04"]["title"] and r["slide"] != deck["slides"]["s03"]["title"]


def test_evidence_on_a_judged_slide_is_never_moved_to_the_notes():
    s = {"type": "insight", "blocks": [{"kind": "bullets", "items": [{"text": "evidence", "refs": ["doc:a#p1"]}]}]}
    assert repair._evidence_slide(s) and not repair._evidence_slide({**s, "type": "execution"})


# ---------------------------------------------------------------------------------------------------- the loop, with real rounds
def test_a_layout_swap_round_is_kept_and_the_rounds_are_real(tmp_path):
    out = tmp_path / "o"
    rep = build(out, fake_qa({"s06": layout_is("pair", "comparison")}))
    r = jload(out / "repair.json")
    assert r["rounds"] and any(x["kept"] for x in r["rounds"]), r["rounds"]
    kept = next(x for x in r["rounds"] if x["kept"])
    assert kept["actions"][0]["action"] in ("shrink", "switch_layout") and kept["fixed"] >= 1
    assert (out / "repair" / "round-1" / "deck.pptx").exists() and (out / "repair" / "round-0" / "deck.json").exists()
    issues = jload(out / "issues.json")
    assert next(i for i in issues if i["slide"] == "s06" and i["check"] == "text_overflow")["status"] == "fixed"
    assert rep["repair"]["rounds"][0]["seconds"] >= 0 and "repair" in rep["stages"]


def test_the_ladder_goes_shrink_then_switch_across_rounds_and_a_rung_is_never_tried_twice(tmp_path):
    out = tmp_path / "o"
    build(out, fake_qa({"s06": layout_is("pair", "comparison")}))
    r = jload(out / "repair.json")
    acts = [a["action"] for x in r["rounds"] for a in x["actions"] if a["slide"] == "s06"]
    assert acts[0] == "shrink" and "switch_layout" in acts and len(acts) == len(set(acts))
    assert len(r["rounds"]) <= 2


def test_at_most_two_rounds_and_a_stop_is_named(tmp_path):
    out = tmp_path / "o"
    build(out, fake_qa({"s06": lambda s: "'slot:pair' text is about 5.2 in tall in a 4.4 in frame: \"x\""}))   # nothing ever clears it
    r = jload(out / "repair.json")
    assert len(r["rounds"]) <= 2 and r["stopped"] in spec.REPAIR_STOPS and not any(x["kept"] for x in r["rounds"])
    final = jload(out / "deck.json")
    assert final["slides"]["s06"]["layout"]["id"] == "comparison" and final["meta"]["repair_policy"]["max_rounds"] == 2   # rolled back whole; the policy is stamped because a round ran
    assert not (out / "repair" / "round-3").exists()


def test_selection_order_is_fixed_whatever_order_the_findings_come_in(tmp_path):
    out = build(tmp_path / "o", fake_qa({"s06": layout_is("pair", "comparison"), "s10": layout_is("roles", "role_grid"), "s02": lambda s: None}))
    deck = jload(tmp_path / "o" / "deck.json")
    m = {"deck": deck, "issues": jload(tmp_path / "o" / "repair" / "round-0" / "issues.json") if (tmp_path / "o" / "repair" / "round-0" / "issues.json").exists() else jload(tmp_path / "o" / "issues.json")}
    state = {"left": {}, "tried": set()}
    first = [i["id"] for i in repair.select(m, POLICY, deck["order"], state, set())]
    import random
    for seed in range(5):
        shuffled = copy.deepcopy(m)
        random.Random(seed).shuffle(shuffled["issues"])
        assert [i["id"] for i in repair.select(shuffled, POLICY, deck["order"], state, set())] == first


def test_a_pinned_slide_is_left_alone_and_a_persons_layout_is_never_switched(tmp_path):
    review = tmp_path / "review.json"
    review.write_text(json.dumps({"pinned": {"s06": {"by": "human:sai", "at": "2026-11-17"}}}))
    out = tmp_path / "o"
    build(out, fake_qa({"s06": layout_is("pair", "comparison")}), "--review", str(review))
    deck = jload(out / "deck.json")
    assert deck["slides"]["s06"]["pinned"] is True
    r = jload(out / "repair.json") if (out / "repair.json").exists() else {"rounds": [], "left_for_person": []}
    assert not any(a["slide"] == "s06" for x in r["rounds"] for a in x["actions"])
    assert deck["slides"]["s06"]["layout"]["id"] == "comparison"
    left = [i for i in jload(out / "issues.json") if i["slide"] == "s06"]
    assert left and left[0]["severity"] == "blocker"
    out2 = tmp_path / "p"
    build(out2, fake_qa({"s06": layout_is("pair", "comparison")}), "--layout", "s06=comparison")
    r2 = jload(out2 / "repair.json")
    assert not any(a["action"] == "switch_layout" and a["slide"] == "s06" for x in r2["rounds"] for a in x["actions"])


# ---------------------------------------------------------------------------------------------------- FIX 1, 3: the keep gate
def _m(issues_=(), counts_=None, pairs_=None, content=frozenset(), cl=None, ledger_=(), ok=True):
    iss = list(issues_)
    deck = {"order": ["s01", "s02"], "slides": {"s01": {"type": "x"}, "s02": {"type": "x"}}}
    return {"issues": iss, "counts": counts_ or repair.counts(iss, deck), "pairs": pairs_ if pairs_ is not None else repair.pairs(iss, deck), "content": set(content),
            "checklist": cl, "ledger": list(ledger_), "ok": ok, "deck": deck}


def _iss(i, check="text_overflow", slide="s01", sev="blocker", source="qa_render"):
    return {"id": f"i_{i:08x}", "round": 0, "slide": slide, "source": source, "check": check, "level": "error", "severity": sev, "message": "m", "status": "open"}


def _cl(**answers):
    base = {"g_no_blocker": "yes", "l_repeat_max2": "yes", "l_variety": "yes", "m_usd": 0.1, "w_words_sha": "a"}
    base.update(answers)
    res = {k: ({"answer": "value", "value": v} if k.startswith(("m_", "w_words")) else {"answer": v}) for k, v in base.items()}
    return {"results": res, "summary": {"yes": 1, "no": 0, "na": 0, "metrics": {}}}


def test_k2_runs_through_compare_with_repair_tiers_so_a_layout_swap_that_breaks_the_variety_items_is_refused():
    t = repair.repair_tiers()
    assert t["l_repeat_max2"] == "gate" and t["l_variety"] == "gate" and t["m_usd"] == "advisory" and t["w_words_sha"] == "advisory"
    assert compare.tiers()["l_repeat_max2"] == "advisory"   # compare.py and checklist.json are not edited: the loop passes its own map
    prev = _m([_iss(1)], cl=_cl())
    ok = _m([], cl=_cl(m_usd=0.5, w_words_sha="b"))   # the run's cost and the words hash move: not a gate here
    assert repair.gate(prev, ok, {"i_00000001"})["K2"] is True
    bad = _m([], cl=_cl(l_repeat_max2="no"))
    g = repair.gate(prev, bad, {"i_00000001"})
    assert g["K2"] is False and not g["keep"] and "l_repeat_max2" in g["K2_detail"]["changed"]
    lost = _m([], cl=_cl(l_variety="n/a"))
    assert repair.gate(prev, lost, {"i_00000001"})["K2"] is False   # lost coverage


def test_no_hiding_a_content_finding_that_disappears_rejects_the_round_as_one_that_appears():
    prev = _m([_iss(1)], content={("numbers_trace", "s01", "warn")}, cl=_cl())
    gone = _m([], content=set(), cl=_cl())
    assert repair.gate(prev, gone, {"i_00000001"})["K4"] is False
    new = _m([], content={("numbers_trace", "s01", "warn"), ("bare_claim", "s02", "warn")}, cl=_cl())
    assert repair.gate(prev, new, {"i_00000001"})["K4"] is False
    same = _m([], content={("numbers_trace", "s01", "warn")}, cl=_cl())
    assert repair.gate(prev, same, {"i_00000001"})["K4"] is True


def test_content_set_ignores_the_word_budget_and_slot_checks_and_the_render_findings():
    f = [{"check": "numbers_trace", "level": "warn", "slide": "s01"}, {"check": "word_budget", "level": "warn", "slide": "s01"}, {"check": "slot_limit", "level": "warn", "slide": "s01"},
         {"check": "text_overflow", "level": "error", "slide": "s01"}, {"check": "image_flagged", "level": "warn", "slide": "s02"}]
    assert repair.content_set(f) == {("numbers_trace", "s01", "warn")}


def test_block_unbound_and_slot_stale_count_as_blockers_and_a_new_pair_rejects_whatever_the_totals():
    deck = {"order": ["s01", "s02"], "slides": {"s01": {"type": "x"}, "s02": {"type": "x"}}}
    assert repair.counts([_iss(1, "block_unbound", sev="minor"), _iss(2, "slot_stale", sev="minor")], deck)["blocker"] == 2
    prev = _m([_iss(1, "text_overflow", "s01"), _iss(2, "min_font", "s02", "major")], cl=_cl())
    swapped = _m([_iss(3, "text_overlap", "s01")], cl=_cl())   # totals fall (2 to 1) but a new (check, slide) pair appears at blocker
    g = repair.gate(prev, swapped, {"i_00000001"})
    assert g["K1"] is False and not g["keep"]
    introduced = _m([_iss(4, "block_unbound", "s02", "minor")], cl=_cl())
    assert repair.gate(_m([], cl=_cl()), introduced, set())["K1"] is False


def test_the_keep_rule_needs_progress_the_ledger_and_readable_qa():
    prev = _m([_iss(1)], cl=_cl())
    assert repair.gate(prev, _m([_iss(1)], cl=_cl()), {"i_00000001"})["K5"] is False   # fixed nothing
    assert repair.gate(prev, _m([], cl=_cl(), ledger_=[{"slide": "s01", "kind": "shown"}]), {"i_00000001"})["K3"] is False
    assert repair.gate(prev, _m([], cl=_cl(), ok=False), {"i_00000001"})["keep"] is False
    assert repair.gate(prev, _m([], cl=_cl()), {"i_00000001"})["keep"] is True


# ---------------------------------------------------------------------------------------------------- FIX 6: re-plan from the base
def test_planning_twice_gives_the_same_bytes_and_cumulative_fixes_equal_the_same_fixes_in_one_pass(tmp_path):
    out = build(tmp_path / "b", None, "--no-qa")
    base = jload(tmp_path / "b" / "deck.json")
    fixes = {"slides": {"s06": {"avoid": ["comparison"], "scale_max": 0.95}}}
    a = layouts.plan(base, prefs={"density": "detailed"}, fixes=fixes)[0]
    b = layouts.plan(base, prefs={"density": "detailed"}, fixes=fixes)[0]
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    assert json.dumps(layouts.plan(a, prefs={"density": "detailed"}, fixes=fixes)[0], sort_keys=True) == json.dumps(a, sort_keys=True)   # a planned deck is stripped first
    step1 = {"slides": {"s06": {"scale_max": 0.95}}}
    step2 = copy.deepcopy(step1)
    step2["slides"]["s06"].update(avoid=["comparison"])
    one_pass = layouts.plan(base, prefs={"density": "detailed"}, fixes=step2)[0]
    again = layouts.plan(layouts.plan(base, prefs={"density": "detailed"}, fixes=step1)[0], prefs={"density": "detailed"}, fixes=step2)[0]
    assert json.dumps(one_pass, sort_keys=True) == json.dumps(again, sort_keys=True)


def test_every_round_plans_from_the_base_deck_never_from_the_last_planned_deck(tmp_path, monkeypatch):
    seen = []
    real = layouts.plan

    def spy(base, *a, **k):
        seen.append(copy.deepcopy(base))
        return real(base, *a, **k)
    monkeypatch.setattr(layouts, "plan", spy)
    build(tmp_path / "o", fake_qa({"s06": layout_is("pair", "comparison")}))
    assert len(seen) >= 2 and all(not any("slots" in s and s["slots"].get("title") for s in d["slides"].values()) for d in seen)


# ---------------------------------------------------------------------------------------------------- FIX 9: deck_sha in every folder
def test_qa_json_carries_the_hash_of_its_own_deck_json_in_out_and_every_round_folder_and_the_checklist_reads_it(tmp_path):
    out = tmp_path / "o"
    build(out, fake_qa({"s06": layout_is("pair", "comparison")}))
    folders = [out, *sorted((out / "repair").glob("round-*"))]
    assert len(folders) >= 3
    for f in folders:
        qa = jload(f / "qa.json")
        assert qa["deck_sha"] and repair.deck_sha_of(f / "deck.json") == qa["deck_sha"], f
        assert checklist.run_checklist(f)["results"]["g_checks_current"]["answer"] == "yes", f


# ---------------------------------------------------------------------------------------------------- the paid rung
def _shorten_run(tmp_path, monkeypatch, stages_dir, edits_for=None):
    (stages_dir / "e_repair_1.json").write_text("{}")   # makes the rung available; get_reply is replaced below
    seen = capture_request(monkeypatch, edits_for or (lambda r: _edit(r, SHORT)))
    out = tmp_path / "o"
    rep = build(out, fake_qa({S: too_long(SLOT, CAP, BLOCK)}, "word_budget"), "--text-mode", "condense", stages_dir=stages_dir)
    return out, rep, seen


def test_shorten_is_a_guarded_deleting_edit_kept_with_the_words_still_in_the_ledger_and_the_notes(tmp_path, monkeypatch, stages_copy):
    out, rep, seen = _shorten_run(tmp_path, monkeypatch, stages_copy)
    r = jload(out / "repair.json")
    assert seen and r["rounds"][0]["kept"] and r["rounds"][0]["actions"][0]["action"] == "shorten"
    assert r["rounds"][0]["text"]["packet_changed"] and r["rounds"][0]["text"]["slides"] == [S]
    deck = jload(out / "deck.json")
    assert deck["slides"][S]["blocks"][BLOCK]["text"] == SHORT
    base = jload(out / "repair" / "base_deck.json")
    assert base["slides"][S]["blocks"][BLOCK]["text"] == LONG   # the base is what the guards compare with
    prs = Presentation(str(out / "deck.pptx"))
    assert any(SHORT.replace(" ", "") in sh.text_frame.text.replace(" ", "").replace("\u00a0", "") for sh in prs.slides[7].shapes if sh.has_text_frame)


def test_a_reply_that_swaps_a_word_or_a_number_is_refused_and_listed_and_the_deck_keeps_its_words(tmp_path, monkeypatch, stages_copy):
    bad = lambda r: _edit(r, SHORT.replace("up to 12", "up to 21"))
    out, rep, _ = _shorten_run(tmp_path, monkeypatch, stages_copy, bad)
    assert jload(out / "deck.json")["slides"][S]["blocks"][BLOCK]["text"] == LONG
    assert any("edit refused" in s["why"] and "number" in s["why"] for s in jload(out / "repair.json")["skipped"])


def test_text_mode_preserve_and_absent_never_shorten_or_move_text(tmp_path, monkeypatch, stages_copy):
    (stages_copy / "e_repair_1.json").write_text("{}")
    seen = capture_request(monkeypatch, lambda r: [])
    for extra in (("--text-mode", "preserve"), ()):
        out = tmp_path / ("p" if extra else "a")
        build(out, fake_qa({S: too_long(SLOT, CAP, BLOCK)}, "word_budget"), *extra, stages_dir=stages_copy)
        r = jload(out / "repair.json") if (out / "repair.json").exists() else {"skipped": [], "rounds": []}
        assert not any(a["action"] in ("shorten", "overflow_to_notes") for x in r["rounds"] for a in x["actions"])
        assert any("text mode condense" in s["why"] for s in r["skipped"]) or not r["rounds"]
    assert seen == []


def test_a_client_deck_is_shortened_only_with_a_persons_yes(tmp_path, monkeypatch, stages_copy):
    (stages_copy / "e_repair_1.json").write_text("{}")
    seen = capture_request(monkeypatch, lambda r: _edit(r, SHORT))
    build(tmp_path / "n", fake_qa({S: too_long(SLOT, CAP, BLOCK)}, "word_budget"), "--text-mode", "condense", "--audience", "client", stages_dir=stages_copy)
    assert seen == []
    assert any("person's yes" in s["why"] for s in jload(tmp_path / "n" / "repair.json")["skipped"])
    build(tmp_path / "y", fake_qa({S: too_long(SLOT, CAP, BLOCK)}, "word_budget"), "--text-mode", "condense", "--audience", "client", "--approve-shorten", stages_dir=stages_copy)
    assert seen


def test_the_free_rungs_run_without_a_recording_and_a_text_move_needs_condense():
    ok, why = repair.shorten_available("condense", "review", False, False, None)
    assert not ok and "not live" in why
    assert repair.shorten_available("preserve", "review", True, False, None)[0] is False
    assert repair.shorten_available("condense", "review", True, False, None)[0] is True
    assert repair.shorten_available("condense", "client", True, False, None)[0] is False and repair.shorten_available("condense", "client", True, True, None)[0] is True


# ---------------------------------------------------------------------------------------------------- FIX 7: a failing or refused call, and the caps
def _ctx(call_fn, live=True, cap=2.0, spent=0.0, policy=None, stages_dir=None):
    return {"live": live, "stages": stages_dir, "policy": policy or POLICY, "call_fn": call_fn, "usd": [0.0], "run_cap": cap, "spent": lambda: spent}


REQ = [{"slide": "T", "slot": "lead", "role": "body", "max_chars": 30, "max_words": 6, "fields": [{"id": "1", "text": LONG}]}]


class Refused(Exception):
    """Stands in for the server's cost-cap refusal."""


@pytest.mark.parametrize("exc", [RuntimeError("boom"), Refused("402"), TimeoutError("slow")])
def test_a_call_that_raises_or_is_refused_is_caught_skipped_and_listed(exc):
    def boom(request):
        raise exc
    skipped = []
    edits, row = repair.get_reply(_ctx(boom), 1, REQ, skipped)
    assert edits is None and row["source"] == "skipped" and skipped and "the call failed" in skipped[0]["why"]


def test_a_call_over_the_deck_cap_or_the_run_cap_is_skipped_not_attempted():
    called = []
    fn = lambda r: called.append(r) or ({"edits": []}, {"usd": 0.01})
    s1, s2 = [], []
    assert repair.get_reply(_ctx(fn, policy={**POLICY, "max_usd": 0.001}), 1, REQ, s1)[0] is None and "deck's cap" in s1[0]["why"]
    assert repair.get_reply(_ctx(fn, cap=0.002), 1, REQ, s2)[0] is None and "NAPKIN_DECK_MAX_USD" in s2[0]["why"]
    assert called == []
    assert repair.get_reply(_ctx(fn, spent=1.99999), 1, REQ, [])[0] is None   # what the run's stages already spent counts
    assert repair.get_reply(_ctx(fn), 1, REQ, [])[0] == [] and len(called) == 1


def test_the_engine_reads_napkin_deck_max_usd_for_a_cli_run(monkeypatch):
    monkeypatch.delenv("NAPKIN_DECK_MAX_USD", raising=False)
    assert repair.run_cap() == 2.0
    monkeypatch.setenv("NAPKIN_DECK_MAX_USD", "0.0001")
    assert repair.run_cap() == 0.0001
    called = []
    skipped = []
    ctx = _ctx(lambda r: called.append(r) or ({"edits": []}, {"usd": 0.01}), cap=repair.run_cap())
    assert repair.get_reply(ctx, 1, REQ, skipped)[0] is None and called == [] and "NAPKIN_DECK_MAX_USD" in skipped[0]["why"]


def test_a_stale_recording_is_listed_and_never_applied(tmp_path):
    d = tmp_path / "st"
    d.mkdir()
    recording(d, 1, [{"other": "request"}], [{"slide": "T", "slot": "lead", "field": "0", "text": SHORT}])
    skipped = []
    edits, row = repair.get_reply(_ctx(lambda r: None, live=False, stages_dir=d), 1, REQ, skipped)
    assert edits is None and "stale" in skipped[0]["why"]
    recording(d, 1, REQ, [{"slide": "T", "slot": "lead", "field": "0", "text": SHORT}])
    edits, row = repair.get_reply(_ctx(lambda r: None, live=False, stages_dir=d), 1, REQ, [])
    assert row["source"] == "recorded" and edits[0]["text"] == SHORT


def test_the_cost_card_prices_the_upper_bound_at_the_request_max_tokens():
    card = repair.estimate(REQ)
    assert card["slots"] == 1 and card["tokens_out"] == 16000 and card["usd_upper"] == spec.estimate_usd(stages.MODELS["e"], card["tokens_in"], 16000)


# ---------------------------------------------------------------------------------------------------- FIX 8: the critic
def test_a_critic_issue_never_gets_shorten_or_notes_even_with_a_map_row_that_would():
    issue = {"id": "i_00000009", "round": 0, "slide": "s01", "slot": "lead", "source": "critic", "check": "v_not_crowded", "level": "warn", "severity": "major", "message": "m", "status": "open"}
    pol = {**POLICY, "critic": {"enabled": True, "may_fix": ["switch_layout", "shorten"], "needs_code_confirm": False}}
    assert repair._resolve_critic(issue, pol) == "switch_layout"
    saved = repair.ACTION_MAP["v_not_crowded"]
    repair.ACTION_MAP["v_not_crowded"] = {"rungs": ("shorten", "overflow_to_notes", "switch_layout")}
    try:
        env = {"deck": {"slides": {"s01": {"type": "x", "blocks": [], "layout": {"id": "cards", "chosen_by": "rule", "alternatives": ["text_columns"]}}}}, "fixes": {}, "policy": pol,
               "state": {"tried": set(), "left": {}}, "library": {}, "shorten_ok": True, "shorten_why": "", "text_mode": "condense", "density": "lean"}
        got = repair.choose(issue, env, [])
        assert got and got["rung"] == "switch_layout"
    finally:
        repair.ACTION_MAP["v_not_crowded"] = saved


# ---------------------------------------------------------------------------------------------------- FIX 5: record, replay, seams
def _replay_run(tmp_path, name, stages_dir):
    out = tmp_path / name
    rep = build(out, fake_qa({S: too_long(SLOT, CAP, BLOCK), "s06": layout_is("pair", "comparison")}, "word_budget"), "--text-mode", "condense", stages_dir=stages_dir)
    return out, rep


def _normal(rep: dict) -> dict:
    r = json.loads(json.dumps(rep))
    for k in ("wall_secs", "started"):
        r.pop(k, None)
    for s in r.get("stages", {}).values():
        if isinstance(s, dict):
            s.pop("secs", None)
    for x in (r.get("repair") or {}).get("rounds", []):
        x.pop("seconds", None)
    r.pop("layout_plan", None)
    r.get("stages", {}).pop("layout_plan", None)
    if "validation" in r:
        r["validation"] = layouts.without_plan_summary(r["validation"])
    return r


def test_a_recorded_repair_replays_byte_for_byte_without_measuring_and_the_replay_ran_real_rounds(tmp_path, monkeypatch, stages_copy):
    # run once: the stand-in model answers through get_reply, the run records e_repair_1.json from its request, and repair_record.json offline
    (stages_copy / "e_repair_1.json").write_text("{}")
    seen = capture_request(monkeypatch, lambda r: _edit(r, SHORT))
    first, rep1 = _replay_run(tmp_path, "first", stages_copy)
    assert jload(first / "repair.json")["rounds"] and any(x["kept"] for x in jload(first / "repair.json")["rounds"])
    record = jload(first / "repair_record.json")
    # the replay: the recording is read (the model is never asked), the record's fixes and verdicts are applied, and render and QA decide nothing
    monkeypatch.undo()
    shutil.copy(first / "repair_record.json", stages_copy / "repair_record.json")
    recording(stages_copy, 1, seen[0], _edit(seen[0], SHORT))
    monkeypatch.setattr(stages, "_call", lambda *a, **k: (_ for _ in ()).throw(AssertionError("a replay never calls the model")))
    monkeypatch.setattr(stages, "repair_copy", lambda *a, **k: (_ for _ in ()).throw(AssertionError("a replay never calls the model")))
    measured = []
    real_measure = repair.measure
    monkeypatch.setattr(repair, "measure", lambda *a, **k: measured.append(a[2]) or real_measure(*a, **k))
    second, rep2 = _replay_run(tmp_path, "second", stages_copy)
    third, rep3 = _replay_run(tmp_path, "third", stages_copy)
    for out in (second, third):
        r = jload(out / "repair.json")
        assert r["rounds"] and any(x["kept"] for x in r["rounds"]) and rep2["repair"].get("replayed")
    assert len(measured) <= 2, "the replay measures only the kept round to write its files, never to decide"
    for name in ("deck.json", "validation.json", "issues.json", "repair.json"):
        a, b, c = (jload(o / name) for o in (first, second, third))
        if name == "deck.json":
            for d in (a, b, c):
                d["meta"].pop("built_at", None)
        assert b == c, name
        assert a == b, name
    assert _normal(rep2) == _normal(rep3)
    assert jload(second / "deck.json")["slides"][S]["blocks"][BLOCK]["text"] == SHORT
    assert jload(second / "repair_record.json")["base_sha"] == record["base_sha"]


def test_a_stale_record_is_listed_and_the_run_decides_afresh(tmp_path, stages_copy):
    (stages_copy / "repair_record.json").write_text(json.dumps({"base_sha": "x", "policy_sha": "y", "rounds": [], "stopped": "clean"}))
    out = tmp_path / "o"
    build(out, fake_qa({"s06": layout_is("pair", "comparison")}), stages_dir=stages_copy)
    r = jload(out / "repair.json")
    assert any(s["rung"] == "replay" and "stale" in s["why"] for s in r["skipped"]) and r["rounds"]


def test_a_failing_paid_call_still_delivers_the_deck_and_lists_the_skipped_rung(tmp_path, monkeypatch, stages_copy):
    (stages_copy / "e_repair_1.json").write_text("{}")
    out = tmp_path / "o"
    build(out, fake_qa({S: too_long(SLOT, CAP, BLOCK)}, "word_budget"), "--text-mode", "condense", stages_dir=stages_copy)
    assert (out / "deck.json").exists() and (out / "deck.pptx").exists() and (out / "report.json").exists()
    assert any(s["rung"] == "shorten" for s in jload(out / "repair.json")["skipped"])


# ---------------------------------------------------------------------------------------------------- no change when nothing needs repair
def _written(out: Path):
    deck = jload(out / "deck.json")
    deck["meta"].pop("built_at", None)
    return deck, jload(out / "validation.json"), jload(out / "layouts.json")


def test_a_clean_run_and_no_repair_and_zero_rounds_are_byte_identical(tmp_path):
    clean = lambda: fake_qa({})
    only_blockers = _policy(tmp_path, "repair_on: [blocker]\n")   # the Lumen build has one major (a cover slot limit) and no blocker: nothing to repair
    a = build(tmp_path / "a", clean(), "--no-repair")
    b = build(tmp_path / "b", clean(), "--repair-policy", str(only_blockers))
    c = build(tmp_path / "c", clean(), "--repair-policy", str(_policy(tmp_path, "max_rounds: 0\n")))
    d = build(tmp_path / "d", fake_qa({"s06": layout_is("pair", "comparison")}), "--no-repair")
    for out in ("b", "c"):
        assert _written(tmp_path / out) == _written(tmp_path / "a")
    assert "repair" not in a and "repair" not in b and "repair" not in c
    assert not (tmp_path / "a" / "issues.json").exists() and not (tmp_path / "a" / "repair").exists() and not (tmp_path / "b" / "repair.json").exists()
    assert (tmp_path / "b" / "issues.json").exists() and (tmp_path / "c" / "issues.json").exists()   # the loop is on (max_rounds 0 too): the issues are written
    assert _written(tmp_path / "d")[0] == _written(tmp_path / "a")[0] and not (tmp_path / "d" / "repair.json").exists()


def _policy(tmp_path, text):
    p = tmp_path / "policy.yaml"
    p.write_text(text)
    return p


def test_until_never_starts_the_loop(tmp_path):
    out = tmp_path / "o"
    build(out, fake_qa({"s06": layout_is("pair", "comparison")}), "--until", "deck")
    assert not (out / "repair.json").exists() and not (out / "issues.json").exists()


def test_repair_writes_no_key_under_review_look_or_inputs(tmp_path):
    out = tmp_path / "o"
    build(out, fake_qa({"s06": layout_is("pair", "comparison")}))
    before = jload(out / "repair" / "base_deck.json")
    after = jload(out / "deck.json")
    for k in set(before["meta"]) | set(after["meta"]):
        if k not in ("repair_policy", "layout_plan", "layout_title_pt", "built_at"):
            assert before["meta"].get(k) == after["meta"].get(k) or k == "preferences", k
    assert not {"review", "look", "inputs"} & set(after)


# ---------------------------------------------------------------------------------------------------- adapters
def test_adapters_map_slides_and_slots_keep_ids_stable_and_validate(tmp_path):
    import jsonschema
    out = build(tmp_path / "o", fake_qa({"s06": layout_is("pair", "comparison")}))
    schema = json.loads((Path(spec.__file__).parent / "schemas" / "issue.schema.json").read_text())
    iss = jload(tmp_path / "o" / "issues.json")
    for i in iss:
        jsonschema.validate(i, schema)
    qa_issue = next(i for i in iss if i["check"] == "text_overflow")
    assert qa_issue["slide"] == "s06" and qa_issue["slot"] == "pair" and qa_issue["source"] == "qa_render" and qa_issue["severity"] == "blocker"
    deck = jload(tmp_path / "o" / "repair" / "round-0" / "deck.json") if (tmp_path / "o" / "repair" / "round-0").exists() else jload(tmp_path / "o" / "deck.json")
    again = I.from_qa({"slides": {"6": [{"check": "text_overflow", "level": "error", "message": "'slot:pair' text is about 5.2 in tall"}]}}, deck, POLICY, 1)
    assert again[0]["id"] == qa_issue["id"] and again[0]["round"] == 1   # the same finding keeps its id across rounds
    assert I.issue_id("qa_render", "text_overflow", "s06", "pair", 0) == qa_issue["id"]
    assert I.from_qa({"slides": {"99": [{"check": "margin", "level": "warn", "message": "m"}]}}, deck, POLICY)[0]["slide"] == "deck"
    first = I.from_validation([{"check": "empty_slot", "level": "warn", "slide": "s02"}, {"check": "empty_slot", "level": "warn", "slide": "s02"}], deck, POLICY)
    assert first[0]["id"] != first[1]["id"]   # repeats on one slide count


# ---------------------------------------------------------------------------------------------------- the seeded faults (invented)
def test_the_overlong_fixture_reaches_zero_blockers_or_is_left_for_the_person_and_adds_no_validator_finding(tmp_path, monkeypatch):
    stages_dir = tmp_path / "st"
    shutil.copytree(REPAIR_FX / "overlong", stages_dir)
    out = tmp_path / "o"
    base = build(tmp_path / "plain", None, "--no-repair", "--no-qa", stages_dir=stages_dir)
    build(out, None, stages_dir=stages_dir)
    after = {(f["check"], f.get("slide")) for f in jload(out / "validation.json") if f["level"] == "error"}
    before = {(f["check"], f.get("slide")) for f in jload(tmp_path / "plain" / "validation.json") if f["level"] == "error"}
    assert after <= before
    issues = jload(out / "issues.json")
    assert not [i for i in issues if i["severity"] == "blocker" and i["status"] in ("open", "unfixed")] or all(i["status"] in ("left_for_person", "rolled_back") for i in issues if i["severity"] == "blocker" and i["status"] != "fixed")


def test_salvage_round_replays_only_the_action_that_helped(tmp_path):
    prev = {"issues": [_iss(1, slide="s01"), _iss(2, "min_font", "s02", "major")], "deck": {"order": ["s01", "s02"], "slides": {}}}
    cur = {"issues": [_iss(3, "text_overlap", "s02", "blocker")], "deck": prev["deck"]}   # s01 improved and gained nothing; s02 got a new issue
    acts = [{"slide": "s01", "issue_id": "i_00000001", "action": "shrink"}, {"slide": "s02", "issue_id": "i_00000002", "action": "switch_layout"}]
    assert [a["slide"] for a in repair._salvage(prev, cur, acts)] == ["s01"]
    assert repair._salvage(prev, {"issues": [*cur["issues"], _iss(4, "text_overflow", "deck", "blocker")], "deck": prev["deck"]}, acts) == []   # the deck-level count went up


def test_sentences_are_fixed_text_for_a_person():
    a = {"slide": "s07", "check": "text_overflow", "action": "switch_layout", "from": "image_text", "to": "cards"}
    assert repair.sentence(a, "kept") == "Slide 7: the text ran past its box. Fixed: layout image_text to cards."
    assert repair.sentence({**a, "action": "overflow_to_notes"}, "rolled_back").startswith("Slide 7: the text ran past its box. Tried, rolled back:")


# ---------------------------------------------------------------------------------------------------- the free picture rungs and the left-for-a-person rows
def _env(slide: dict, lib: dict | None = None, **over):
    base = {"deck": {"slides": {"s01": slide}}, "fixes": {}, "policy": POLICY, "state": {"tried": set(), "left": {}, "targeted": set()}, "library": lib or layouts.load(),
            "shorten_ok": False, "shorten_why": "off", "text_mode": None, "density": "detailed"}
    return {**base, **over}


def _issue(check, slot=None, source="qa_render", sev="major"):
    return {"id": "i_0000000a", "round": 0, "slide": "s01", "slot": slot, "source": source, "check": check, "level": "warn", "severity": sev, "message": "m", "status": "open"} if slot else \
           {"id": "i_0000000a", "round": 0, "slide": "s01", "source": source, "check": check, "level": "warn", "severity": sev, "message": "m", "status": "open"}


def _pic_slide(layout="image_text"):
    return {"type": "idea", "blocks": [], "layout": {"id": layout, "chosen_by": "rule", "alternatives": ["image_left", "cards"], "fit": {"scale": 1.0}},
            "slots": {"picture": {"kind": "image", "image": {"focal": {"x": 0.2, "y": 0.4}}}}}


def test_scrim_and_crop_write_the_agreed_image_fixes_and_drop_image_uses_the_layouts_version_without_a_picture():
    env = _env(_pic_slide())
    fixes = {}
    assert repair.apply_effect(fixes, "add_scrim", _issue("text_on_image_contrast"), env) == {"from": "none", "to": "dark"}
    repair.apply_effect(fixes, "crop_image", _issue("picture_stretch"), env)
    assert fixes["images"]["s01"]["picture"] == {"scrim": "dark", "fit": "cover", "focal": {"x": 0.2, "y": 0.4}}   # the focal point is kept
    assert repair.apply_effect(fixes, "drop_image", _issue("image_rights"), env)["to"] == "cards_split" and fixes["slides"]["s01"]["layout"] == "cards_split"
    assert [r for r in repair.ACTION_MAP["text_on_image_contrast"]["rungs"]][:3] == ["add_scrim", "switch_layout", "drop_image"]


def test_a_scrim_the_loop_sets_is_drawn_in_the_pptx_and_planning_binds_it_to_the_image_slot(tmp_path):
    lib = layouts.load()
    assert "scrim" in json.loads((Path(spec.__file__).parent / "deck.schema.json").read_text())["definitions"]["image_slot"]["properties"]
    assert spec.IMAGE_SCRIMS == ("none", "dark", "light")
    from deck import render_pptx
    src = inspect_src(render_pptx.Renderer.picture)
    assert 'im.get("scrim")' in src and "Scrim" in inspect_src(render_pptx.Renderer._scrim)


def inspect_src(fn) -> str:
    import inspect
    return inspect.getsource(fn)


def test_a_flagged_picture_waits_for_a_person_by_default_and_regen_then_drop_skips_the_unwired_regen_and_lists_it():
    env = _env(_pic_slide())
    assert repair.choose(_issue("image_flagged", sev="blocker"), env, []) is None
    assert env["state"]["left"]["i_0000000a"]
    regen = _env(_pic_slide(), policy={**POLICY, "images": {**POLICY["images"], "on_flag": "regen_then_drop"}})
    skipped = []
    got = repair.choose(_issue("image_flagged", sev="blocker"), regen, skipped)
    assert got["rung"] == "drop_image" and skipped[0]["rung"] == "regen_image" and "not wired" in skipped[0]["why"]


def test_colour_belongs_to_the_look_a_contrast_finding_is_left_and_a_furniture_layout_is_never_swapped():
    env = _env({"type": "x", "blocks": [], "layout": {"id": "cards", "chosen_by": "rule", "alternatives": ["text_columns"], "fit": {"scale": 1.0}}})
    assert repair.choose(_issue("contrast"), env, []) is None and env["state"]["left"]
    cover = _env({"type": "title", "blocks": [], "layout": {"id": "cover", "chosen_by": "rule", "alternatives": ["cards"], "fit": {"scale": 1.0}}})
    assert repair.available("switch_layout", _issue("slot_limit", "lead"), cover)[0] is False


def test_the_overlap_fixture_is_cleared_by_the_free_rungs_and_the_shrink_floor_is_the_policys(tmp_path):
    out = tmp_path / "o"
    build(out, fake_qa({"s10": layout_is("roles", "role_grid")}))   # a seeded overlap: only a layout swap clears it (role_grid offers native_table and cards)
    r = jload(out / "repair.json")
    assert any(x["kept"] for x in r["rounds"]) and jload(out / "deck.json")["slides"]["s10"]["layout"]["id"] != "role_grid"
    env = _env({"type": "x", "blocks": [], "layout": {"id": "cards", "chosen_by": "rule", "alternatives": [], "fit": {"scale": 0.86}}})
    assert repair.available("shrink", _issue("text_overflow", "points"), env)[0] is False   # 0.81 would go under the 0.85 floor
    assert repair.available("shrink", _issue("text_overflow", "points"), _env({"type": "x", "blocks": [], "layout": {"id": "cards", "chosen_by": "rule", "alternatives": [], "fit": {"scale": 1.0}}}))[0]
