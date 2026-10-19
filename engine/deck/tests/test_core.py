"""Offline tests for the core roadmap fixes: the objective slide, stated limits and the sketch tier, the cost and repair
hygiene, the brief: ref describe, so_what in the facts block, and the smoke bugs. No model call: a stage is tested through a
stubbed brief_llm and recorded JSON; every client is invented (Lumen Water, Fernley Drinks). Run from ``engine/``:
``PYTHONPATH=. python3 -m pytest -q deck/tests``.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

from deck import assemble, inputs, intake, profiles, refs, run_deck, spec, stages, validate

HERE = Path(__file__).parent
BRIEF = HERE / "fixtures" / "lumen_water"
TYPES = HERE / "fixtures" / "types"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}


def _st(folder: Path) -> dict:
    """The recorded stage outputs in a fixture folder."""
    return {k: json.loads((folder / f).read_text()) for k, f in FILES.items() if (folder / f).exists()}


def _brief_inp(prompt: str = "", **kw):
    """Inputs with the Lumen Water brief (so the build is not a sketch), plus an optional prompt."""
    return inputs.load(BRIEF / "brief_object.json", prompt_text=prompt, **kw)


def _build(inp=None, profile=None, st=None, fmt="pitch", **kw):
    """Build the Lumen Water deck (or the given inputs and stages)."""
    return assemble.build(inp or _brief_inp(), st if st is not None else _st(BRIEF), client="Lumen Water", project="National awareness campaign",
                          profile=profile, fmt=fmt, **kw)


def _presented(deck) -> list:
    """Slide types of the presented story."""
    return [deck["slides"][x]["type"] for x in validate.presented(deck)]


def _long_doc(inp):
    """Give inputs a document of real length, so a prompt-built deck is not a sketch."""
    inp.docs = {"pack": {"name": "Pack", "text": "x " * spec.SKETCH_DOC_CHARS, "pages": 1}}
    return inp


# ---------------------------------------------------------------- 1b, 1c: what the notes and the facts block say

def test_brief_ref_describe_gives_the_fields_text_and_its_underlying_refs():
    """A brief: ref describes itself with the field's first 140 characters and the refs it rests on."""
    inp = _brief_inp()
    inp.brief["insight"]["value"] = "People care about water. " * 20
    inp.brief["insight"]["refs"] = ["prompt:1", "answer:q_1"]
    line = refs.Resolver(inp, []).describe("brief:insight")
    assert line.startswith("[brief:insight] brief field (") and "People care about water." in line
    assert "rests on prompt:1, answer:q_1" in line
    body = line.split("): ", 1)[1].split(" (rests on")[0]
    assert len(body) <= 140
    inp.brief["objectives"]["value"] = {"behavioural": "Cut use by 5%", "attitudinal": ""}
    assert ": Cut use by 5%" in refs.Resolver(inp, []).describe("brief:objectives.behavioural")
    inp.brief["audience"]["value"] = None
    assert refs.Resolver(inp, []).describe("brief:audience").count(":") == 1   # an empty field adds no text


def test_notes_carry_what_the_brief_says():
    """The speaker notes of a slide citing a brief field show that field's words."""
    deck = _build()
    ins = next(s for s in deck["slides"].values() if s["type"] == "insight")
    assert "People care about water in the abstract" in ins["notes"]


def test_facts_block_sends_so_what_beside_the_statement_and_the_loader_keeps_it():
    """A finding's so_what rides beside its statement in the facts block; one without is unchanged. inputs keeps the field."""
    r = inputs.parse_research(
        [], [{"id": "fi_1", "statement": "Bottled water use fell 4%.", "so_what": "Households are open to the tap.", "status": "verified"},
             {"id": "fi_2", "statement": "Tap trust is high.", "status": "proposed"}], {}, [])
    inp = _brief_inp()
    inp.findings = r["findings"]
    assert inp.findings["fi_1"]["so_what"] == "Households are open to the tap."
    lines = stages._facts_block(inp).split("\n")
    assert lines[0] == "[fi_1] FINDING (verified): Bottled water use fell 4%. SO WHAT: Households are open to the tap."
    assert lines[1] == "[fi_2] FINDING (proposed): Tap trust is high."


# ---------------------------------------------------------------- 1: the objective slide

def test_objective_slide_is_second_in_the_agency_pitch_and_the_brief_read_back_stays_in_the_appendix():
    """The objective slide (50 words) is presented at position 2, built from the requirement and brief objectives; brief_restated is backup."""
    deck = _build(profile=profiles.load("agency_pitch"))
    pres = _presented(deck)
    assert pres[:2] == ["title", "objective"] and "brief_restated" not in pres
    ob = deck["slides"]["s02"]
    assert ob["section"] == "Objective" and ob["status"] == "from_source" and validate.words(ob) <= spec.SLIDE_TYPES["objective"]["words"] == 50
    assert [i["text"] for i in ob["blocks"][0]["items"]] == ["Cut household use by 5% in 12 months"]
    assert all(i["refs"] for i in ob["blocks"][0]["items"]) and "r_01" in ob["requirements"]
    back = _presented(deck) and [deck["slides"][x]["type"] for x in deck["order"][len(pres):]]
    assert back[0] == "appendix" and "brief_restated" in back
    assert "objective" in spec.SLIDE_TYPES and "objective" not in stages.JUDGED   # a fixed label headline: nothing for the fit judge to read


def test_objective_slide_uses_the_persons_answer_about_the_number_and_stays_in_budget():
    """An answer to the question addressed to brief.objectives is shown beside the objectives; whole items only, up to 50 words."""
    inp = _brief_inp(intake={"questions": [{"id": "q_objective_number", "text": "Which number?", "options": [], "allow_text": True, "address": "brief.objectives"}]},
                     answers={"q_objective_number": {"text": "Household use from 140 to 133 litres by 30 Sep 2027", "at": "t"}})
    st = _st(BRIEF)
    st["a"]["requirements"] += [{"id": f"r_x{i}", "kind": "objective", "text": " ".join(["word"] * 18), "ref": "brief:objectives"} for i in range(4)]
    deck = _build(inp, st=st)
    ob = next(s for s in deck["slides"].values() if s["type"] == "objective")
    assert ob["blocks"][0]["text"].startswith("The number to move: Household use from 140 to 133")
    assert ob["blocks"][0]["refs"] == ["answer:q_objective_number"]
    assert validate.words(ob) <= 50 and len(ob["blocks"][1]["items"]) < 5   # whole items until the budget
    assert not [f for f in validate.run(deck, inp) if f["check"] in ("numbers_trace", "word_budget") and f["slide"] == "s02"]


def test_no_objective_in_the_inputs_means_no_objective_slide():
    """Nothing is invented: with no objectives, requirement or answer, the slide is not built."""
    inp = _brief_inp()
    inp.brief["objectives"]["value"] = None
    st = _st(BRIEF)
    st["a"]["requirements"] = [r for r in st["a"]["requirements"] if r["kind"] != "objective"]
    assert "objective" not in [s["type"] for s in _build(inp, st=st)["slides"].values()]


def test_objective_is_slide_two_in_credentials_and_after_the_response_map_in_a_tender():
    """Credentials: position 2. Tender: after the response map, which stays second (compliance first); brief_restated is backup in both."""
    for pid, want in (("credentials", ["title", "objective", "team"]), ("tender_response", ["title", "scoring", "objective"])):
        inp = inputs.load(None, prompt_text=(TYPES / pid / "prompt.txt").read_text().strip())
        _long_doc(inp)
        st = _st(TYPES / pid)
        if pid == "credentials":
            st["a"]["requirements"] = [{"id": "r_01", "kind": "objective", "text": "Get to know the brand", "ref": "prompt:2"}] + st["a"]["requirements"]
        deck = assemble.build(inp, st, client="Ardent", project="Meeting", profile=profiles.load(pid))
        pres = _presented(deck)
        assert pres[:3] == want and "brief_restated" not in pres, pid
        assert deck["slides"][validate.presented(deck)[1 if pid == "credentials" else 2]]["type"] == "objective"


def test_objective_quant_warns_unless_the_first_three_slides_quantify_the_objective():
    """A number and a from/to, versus or by-date pattern in the first three presented slides passes; otherwise a warning (agency decks only)."""
    deck = _build()
    inp = _brief_inp()
    got = [f for f in validate.run(deck, inp) if f["check"] == "objective_quant"]
    assert len(got) == 1 and got[0]["level"] == "warn"   # '5% in 12 months' has no from/to or date
    for text in ("Awareness from 11% to 25% by 30 Sep 2027", "Stores 612 vs 900", "Reach 150,000 buyers by Q3 2027"):
        d = _build()
        d["slides"]["s02"]["blocks"][0]["items"][0]["text"] = text
        assert not [f for f in validate.run(d, inp) if f["check"] == "objective_quant"], text
    inv = json.loads((TYPES / "investor_seed" / "golden_deck.json").read_text())
    assert not [f for f in validate.run(inv, inp) if f["check"] == "objective_quant"]   # an investor deck keeps its own order
    assert "objective_quant" in spec.CHECKS


def test_a_deck_with_an_objective_slide_matches_the_schema():
    """The schema's slide-type enum has 'objective'."""
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((Path(assemble.__file__).parent / "deck.schema.json").read_text())
    enum = schema["definitions"]["slide"]["properties"]["type"]["enum"]
    assert set(spec.SLIDE_TYPES) <= set(enum)


# ---------------------------------------------------------------- the same sentence once on a slide (smoke bug)

def test_a_sentence_is_not_repeated_as_title_statement_and_quote():
    """Identical words as the title, a statement and a quote leave one copy; the refs of a dropped block stay as a claim."""
    s = assemble._slide("problem", "Delivery paperwork costs a week every month.",
                        [{"kind": "statement", "text": "Delivery paperwork costs a week every month."},
                         {"kind": "quote", "text": "Delivery paperwork costs a week every month", "refs": ["prompt:1"]},
                         {"kind": "text", "text": "Teams re-key every invoice."},
                         {"kind": "text", "text": "Teams re-key every invoice!"},
                         {"kind": "small", "text": "A placeholder", "human": True}, {"kind": "small", "text": "A placeholder", "human": True}])
    assert [b["text"] for b in s["blocks"]] == ["Teams re-key every invoice.", "A placeholder", "A placeholder"]
    assert s["claims"] == [{"text": "Delivery paperwork costs a week every month", "refs": ["prompt:1"], "basis": "sourced"}]


def test_investor_section_with_one_sentence_three_times_builds_it_once():
    """Stage i writing one sentence as the section title, statement and a quote shows it once."""
    line = "Independent wholesalers lose a week a month to matching paperwork."
    st = {"i": {"cover": {"title": "Dockhand"}, "sections": [{"type": "problem", "title": line, "statement": line, "quotes": [{"text": line, "refs": []}]}]}}
    inp = inputs.load(None, prompt_text="Dockhand matches proof of delivery to invoices.")
    deck = assemble.build_investor(inp, st, client="Dockhand", project="Seed")
    prob = next(s for s in deck["slides"].values() if s["type"] == "problem")
    shown = [t for t, _ in validate._texts(prob)]
    assert sum(spec.norm_text(t) == spec.norm_text(line) for t in shown) == 1


# ---------------------------------------------------------------- 3: stated limits and the sketch

LIMIT_PROMPTS = {
    "no more than 8 slides": 8, "Keep it to a 7-slide deck.": 7, "The page limit is 9.": 9, "slide limit: 6": 6,
    "We have a 20 slides maximum.": 20,
}


@pytest.mark.parametrize("text,n", list(LIMIT_PROMPTS.items()))
def test_a_limit_in_the_prompt_is_read(text, n):
    """'no more than 14 slides', '20 slides', 'page limit' and the like in the prompt are the limit."""
    inp = _brief_inp(f"Pitch for Lumen Water. {text}")
    got = assemble.stated_limit(inp)
    assert got and got["max_slides"] == n and got["source"] == "the prompt's stated limit"


def test_minutes_become_slides_only_with_a_presentation_word_and_only_tighten():
    """'10 minutes' for the presentation is 5 slides; minutes of something else are not a limit; a long slot never loosens the profile."""
    assert assemble.stated_limit(_brief_inp("We have 10 minutes to present."))["max_slides"] == 5
    assert assemble.stated_limit(_brief_inp("Reply within 10 minutes of the call.")) is None
    prof = profiles.load("agency_pitch")
    long_slot = assemble._length_for(prof, [], [], _brief_inp("Our presentation slot is 90 minutes."))
    assert long_slot["max_slides"] == 18 and long_slot["source"] == "profile"
    explicit = assemble._length_for(prof, [], [], _brief_inp("Use at most 25 slides."))
    assert explicit["max_slides"] == 25 and explicit["source"] == "the prompt's stated limit"   # an explicit limit is the real one


def test_a_limit_in_an_answer_a_document_or_the_brief_is_read_with_a_limit_word():
    """Answers count as the person's words; documents and the brief need a limit word in the sentence ('20 slides' someone supplies is not one)."""
    ans = _brief_inp(intake={"questions": [{"id": "q_limits", "text": "Limits?", "options": [], "allow_text": True, "address": "brief.mandatories"}]},
                     answers={"q_limits": {"text": "Max 12 slides please", "at": "t"}})
    assert assemble.stated_limit(ans) == {"max_slides": 12, "source": "an answer's stated limit", "derived": False}
    doc = _brief_inp()
    doc.docs = {"itt": {"name": "ITT", "text": "[p3] The presentation must be no more than 15 slides. We will supply 40 slides of data.", "pages": 3}}
    assert assemble.stated_limit(doc)["max_slides"] == 15
    doc.docs["itt"]["text"] = "We will supply 40 slides of data and a 30 page report."
    assert assemble.stated_limit(doc) is None
    brief = _brief_inp()
    brief.brief["mandatories"]["value"] = ["Presentations are limited to 11 slides."]
    assert assemble.stated_limit(brief) == {"max_slides": 11, "source": "the brief's stated limit", "derived": False}


def test_respect_stated_limit_is_on_for_every_profile():
    """Every profile file says respect_stated_limit."""
    for p in profiles.all_profiles():
        assert p["length"].get("respect_stated_limit") is True, p["id"]


def test_the_agency_pitch_holds_to_a_limit_stated_in_the_prompt():
    """Dockhand said 14 and got 18: the story is cut at the stated limit, the least needed slides go behind the divider, nothing is lost."""
    plain = _build()
    assert "length" not in plain["meta"] and len(validate.presented(plain)) == 16   # no limit stated: built as before (the risks and competition slides are presented since roadmap item 10)
    inp = _brief_inp("Pitch for Lumen Water. No more than 8 slides.")
    deck = _build(inp)
    pres = _presented(deck)
    assert len(pres) == 8 and deck["meta"]["length"]["source"] == "the prompt's stated limit"
    for keep in ("title", "objective", "insight", "idea", "team", "investment"):
        assert keep in pres
    back = [deck["slides"][x]["type"] for x in deck["order"][len(pres):]]
    assert back[0] == "appendix" and {"guardrails", "timeline"} <= set(back)
    assert sorted(s["type"] for s in plain["slides"].values() if s["type"] != "objective" or True).count("guardrails") == sorted(s["type"] for s in deck["slides"].values()).count("guardrails")
    assert not [f for f in validate.run(deck, inp) if f["check"] == "pitch_length"]
    full = _build(inp, fmt="full")
    assert "length" in full["meta"] and "appendix" not in [s["type"] for s in full["slides"].values()]   # full keeps every slide


def test_a_tender_holds_to_the_limit_written_in_its_prompt():
    """The offline smoke wrote a 20-slide limit in the prompt and tender ignored it: the prompt is read, and 10 slides (a sketch) also holds."""
    inp = inputs.load(None, prompt_text=(TYPES / "tender_response" / "prompt.txt").read_text().strip())
    st = _st(TYPES / "tender_response")
    st["a"]["rules"] = []   # the stage a rule is gone: the prompt still says it
    assert assemble.stated_limit(inp)["max_slides"] == 20
    deck = assemble.build(_long_doc(inp), st, client="Harbour", project="Recycling", profile=profiles.load("tender_response"))
    assert deck["meta"]["length"] == {"max_slides": 20, "minutes": 30, "source": "the prompt's stated limit"}
    assert len(validate.presented(deck)) <= 20


def test_a_prompt_only_build_is_a_sketch_of_at_most_ten_slides_and_the_cover_says_so():
    """The thin tier: at most spec.SKETCH_MAX_SLIDES presented, the cover carries the fixed SKETCH label, and meta says so."""
    for pid in ("agency_pitch", "tender_response", "credentials"):
        inp = inputs.load(None, prompt_text=(TYPES / pid / "prompt.txt").read_text().strip())
        deck = assemble.build(inp, _st(TYPES / pid), client="Client", project="Project", profile=profiles.load(pid))
        pres = validate.presented(deck)
        assert len(pres) <= spec.SKETCH_MAX_SLIDES == 10, pid
        cover = deck["slides"][pres[0]]
        assert any(b.get("text") == spec.SKETCH_LABEL for b in cover["blocks"]), pid
        assert deck["meta"]["sketch"]["label"] == spec.SKETCH_LABEL and deck["meta"]["sketch"]["tier"] == "prompt"
        assert deck["meta"]["length"]["max_slides"] <= 10 and "sketch" in deck["meta"]["length"]["source"] or deck["meta"]["length"]["source"] != "profile"
        assert validate.words(cover) <= spec.SLIDE_TYPES["title"]["words"]
    assert "sketch" in spec.SKETCH_LABEL.lower()


def test_sketch_threshold_prompt_with_documents_and_a_brief():
    """prompt+documents is a sketch only while the documents hold under spec.SKETCH_DOC_CHARS; a brief, or documents of real length, is not."""
    inp = inputs.load(None, prompt_text="A short ask.")
    assert assemble._sketch(inp)
    inp.docs = {"note": {"name": "Note", "text": "x" * (spec.SKETCH_DOC_CHARS - 1), "pages": 1}}
    assert assemble._sketch(inp)
    inp.docs["note"]["text"] = "x" * spec.SKETCH_DOC_CHARS
    assert not assemble._sketch(inp)
    assert not assemble._sketch(_brief_inp("A short ask."))
    deck = _build()
    assert "sketch" not in deck["meta"] and not any(b.get("text") == spec.SKETCH_LABEL for s in deck["slides"].values() for b in s["blocks"])


def test_a_sketch_with_a_tighter_stated_limit_takes_the_tighter():
    """A stated limit under ten wins over the sketch's ten; the credentials least is dropped when the limit is under it."""
    prof = profiles.load("credentials")
    inp = inputs.load(None, prompt_text="Chemistry meeting. No more than 7 slides.")
    L = assemble._length_for(prof, [], [], inp, True)
    assert L["max_slides"] == 7 and "min_slides" not in L and L["source"] == "the prompt's stated limit"


def test_trim_never_moves_a_type_it_does_not_name():
    """With nothing left to move the story stays over the limit (pitch_length reports it); the types it holds back are not moved."""
    S = [{"type": t} for t in ("title", "insight", "idea", "team", "process")]
    story, backup = assemble._trim(S, list(S), [], 2)
    assert [x["type"] for x in story] == ["title", "insight", "idea", "team"] and [x["type"] for x in backup] == ["process"]
    assert assemble._trim(S, list(S), [], None) == (S, [])


# ---------------------------------------------------------------- 12: cost and transport hygiene

def test_estimate_usd_uses_the_price_table():
    """Opus 5.5 at 5/25 and Sonnet 5.5 at 3/15 dollars per million tokens in/out; an unknown model is 0; a list names the dearest."""
    assert spec.PRICE_PER_MTOK == {"claude-opus-5-5": (5.0, 25.0), "claude-sonnet-5-5": (3.0, 15.0)}
    assert spec.estimate_usd("claude-opus-5-5", 1_000_000, 1_000_000) == 30.0
    assert spec.estimate_usd("claude-sonnet-5-5", 2_000, 500) == round(2_000 / 1e6 * 3 + 500 / 1e6 * 15, 4)
    assert spec.estimate_usd("nope", 5, 5) == 0.0
    assert spec.estimate_usd("claude-sonnet-5-5,claude-opus-5-5", 1_000_000, 0) == 5.0
    assert spec.estimate_usd("claude-sonnet-5-5", 0, 0, cache_read=1_000_000, cache_creation=1_000_000) == round(3 * 0.1 + 3 * 1.25, 4)


class _Ledger(dict):
    """A stand-in for brief_llm's private ledger."""


def _fake_llm(monkeypatch, replies, ledger=None):
    """Install a stand-in brief_llm: each _json_call attempt reads the next reply through ``parse``. Returns the list of calls made."""
    calls = []
    mod = types.ModuleType("brief_llm")
    mod.CLI_TIMEOUT_S = 1.0

    class NoClaudeAvailable(RuntimeError):
        """No usable reply."""

    class Scope:
        """The private ledger scope."""

        def __enter__(self):
            """Open a ledger."""
            self.led = _Ledger(ledger or {"prompt_tokens": 1000, "completion_tokens": 400, "cache_read_tokens": 0, "cache_creation_tokens": 0, "calls": 1})
            return self.led

        def __exit__(self, *a):
            """Close it."""
            return False

    def loads(raw, whole=False):
        """Read one whole JSON object, or None."""
        try:
            v = json.loads(raw)
        except ValueError:
            return None
        return v if isinstance(v, dict) else None

    def json_call(user, system=None, retries=1, model=None, parse=None, **kw):
        """Answer from the queue; the reader sees the text."""
        calls.append({"user": user, "system": system, "model": model, "retries": retries})
        return parse(replies.pop(0)) if replies else None

    mod.NoClaudeAvailable, mod._stats_scope, mod._loads_lenient, mod._json_call = NoClaudeAvailable, Scope, loads, json_call
    monkeypatch.setitem(sys.modules, "brief_llm", mod)
    return calls


def test_a_call_records_an_estimated_usd_from_tokens(monkeypatch):
    """Under the CLI transport (tokens, no dollars) each stage records usd from the price table and says it is an estimate."""
    calls = _fake_llm(monkeypatch, ['{"ok": 1}'])
    obj, usage = stages._call("b", "u", "s")
    assert obj == {"ok": 1} and len(calls) == 1 and "repaired" not in usage
    assert usage["usd"] == spec.estimate_usd("claude-opus-5-5", 1000, 400) > 0 and usage["usd_estimated"] is True


def test_a_real_usd_from_the_transport_is_kept(monkeypatch):
    """When the ledger carries a real dollar figure, that figure is the one recorded and it is not marked estimated."""
    _fake_llm(monkeypatch, ['{"ok": 1}'], ledger={"prompt_tokens": 10, "completion_tokens": 10, "calls": 1, "usd": 0.4321})
    _, usage = stages._call("fit", "u", "s")
    assert usage["usd"] == 0.4321 and "usd_estimated" not in usage


def test_unusable_json_gets_one_repair_call_with_the_bad_text(monkeypatch):
    """The reply is not JSON: one extra call is shown the bad text and asked for valid JSON only; its result is used; usage says repaired."""
    calls = _fake_llm(monkeypatch, ['{"sections": [1, 2', '{"sections": [1, 2]}'])
    obj, usage = stages._call("i", "write the deck", "system")
    assert obj == {"sections": [1, 2]} and len(calls) == 2
    assert calls[0]["retries"] == 2 and calls[1]["retries"] == 0 and calls[1]["system"] == stages.REPAIR_SYSTEM
    assert '{"sections": [1, 2' in calls[1]["user"] and "valid JSON object only" in calls[1]["user"]
    assert calls[1]["model"] == stages.MODELS["i"] and usage["repaired"] is True


def test_a_failed_repair_raises_and_a_reply_of_nothing_is_not_repaired(monkeypatch):
    """Two unusable replies raise the stage error (no third call); no reply at all has nothing to repair."""
    calls = _fake_llm(monkeypatch, ["not json", "still not json"])
    with pytest.raises(sys.modules["brief_llm"].NoClaudeAvailable, match="repair call failed"):
        stages._call("i", "u", "s")
    assert len(calls) == 2
    calls = _fake_llm(monkeypatch, [])
    with pytest.raises(sys.modules["brief_llm"].NoClaudeAvailable):
        stages._call("i", "u", "s")
    assert len(calls) == 1


def test_a_long_bad_reply_is_cut_in_the_middle_for_the_repair_call():
    """The repair call shows the head and the tail of a very long reply."""
    bad = "A" * 40_000 + "MIDDLE" + "B" * 40_000
    shown = stages._repair_user(bad)
    assert shown.startswith("<unusable_reply>\nAAAA") and "BBBB\n</unusable_reply>" in shown and "MIDDLE" not in shown


def test_sum_adds_usd_and_keeps_the_flags():
    """A stage that made several calls sums their dollars; estimated and repaired stay set."""
    out = stages._sum([{"model": "claude-opus-5-5", "usd": 0.1, "usd_estimated": True}, {"model": "claude-sonnet-5-5", "usd": 0.05, "repaired": True}])
    assert out["usd"] == 0.15 and out["usd_estimated"] is True and out["repaired"] is True
    assert "usd" not in stages._sum([{"model": "m"}])


def test_report_prices_every_stage_that_has_tokens(monkeypatch, tmp_path):
    """A recorded stage whose usage holds tokens but no dollars is priced (estimate, labelled), so usd_total is not 0."""
    row = run_deck._price_stage({"source": "recorded", "model": "claude-opus-5-5", "prompt_tokens": 100_000, "completion_tokens": 20_000})
    assert row["usd"] == spec.estimate_usd("claude-opus-5-5", 100_000, 20_000) == 1.0 and row["usd_estimated"] is True
    real = {"model": "claude-opus-5-5", "prompt_tokens": 100_000, "usd": 2.5}
    assert run_deck._price_stage(real) == real   # a real figure is kept
    assert run_deck._price_stage({"source": "missing"}) == {"source": "missing"}
    assert run_deck._price_stage({"model": "claude-sonnet-5-5", "tokens_in": 1_000_000, "tokens_out": 0})["usd"] == 3.0
    d = tmp_path / "stages"
    d.mkdir()
    for f in ("a_requirements.json", "b_storyline.json", "c_territories.json", "d_idea.json"):
        data = json.loads((BRIEF / f).read_text())
        data["usage"] = {"model": "claude-opus-5-5", "prompt_tokens": 50_000, "completion_tokens": 10_000, "secs": 3}
        (d / f).write_text(json.dumps(data))
    for mod in (run_deck.render_pptx, run_deck.render_web):
        monkeypatch.setattr(mod, "render", lambda *a, **k: tmp_path / "deck.pptx")
    monkeypatch.setattr(run_deck.subprocess, "run", lambda *a, **k: None)
    monkeypatch.setattr(run_deck, "_soffice", lambda: "soffice")
    rep = run_deck.main(["--brief", str(BRIEF / "brief_object.json"), "--stages", str(d), "--client", "Lumen Water", "--project", "National awareness campaign",
                         "--out", str(tmp_path / "out"), "--no-qa"])
    assert rep["usd_total"] == round(4 * spec.estimate_usd("claude-opus-5-5", 50_000, 10_000), 4) > 0
    assert rep["usd_basis"] == spec.USD_BASIS and rep["stages"]["a"]["usd_estimated"] is True


def test_a_dangling_brief_ref_is_a_warning_when_there_is_no_brief():
    """With no brief a brief: ref that resolves to nothing is a warning; with a brief, or for any other ref kind, it is still an error."""
    inp = inputs.load(None, prompt_text="Lumen Water wants more households.")
    sl = {"type": "insight", "section": "Insight", "title": "A title that says something clear", "blocks": [{"kind": "text", "text": "Words.", "refs": ["brief:nonsense", "f_ghost"]}],
          "claims": [], "visual": {}, "status": "drafted", "requirements": []}
    deck = {"meta": {"client": "Lumen Water", "project": "x"}, "requirements": {}, "order": ["s01"], "slides": {"s01": sl}}
    got = {f["message"].split()[0]: f["level"] for f in validate.run(deck, inp) if f["check"] == "unknown_ref"}
    assert got == {"brief:nonsense": "warn", "f_ghost": "error"}
    with_brief = {f["message"].split()[0]: f["level"] for f in validate.run(deck, _brief_inp()) if f["check"] == "unknown_ref"}
    assert with_brief["brief:nonsense"] == "error"


# ---------------------------------------------------------------- the smoke bugs

def test_the_credentials_questions_slide_is_in_the_presented_spine():
    """'Questions for the client' is presented, before the next step, never behind the Appendix divider, in both formats."""
    pid = "credentials"
    for fmt in ("pitch", "full"):
        inp = _long_doc(inputs.load(None, prompt_text=(TYPES / pid / "prompt.txt").read_text().strip()))
        inp.open_questions = [{"question": "Who attends from your side?", "why": "x", "priority": "normal"}]
        deck = assemble.build(inp, _st(TYPES / pid), client="Ardent", project="Meeting", profile=profiles.load(pid), fmt=fmt)
        pres = _presented(deck)
        assert "questions" in pres and pres.index("questions") < pres.index("next_step"), fmt
        q = next(s for s in deck["slides"].values() if s["type"] == "questions")
        assert "Who attends from your side?" in str(q["blocks"])
    assert "questions" not in profiles.load(pid)["appendix"]


def test_stage_h_line_counts_the_slides_checked_not_only_the_flagged():
    """A clean 7-slide deck says so ('on 7 slides checked (0 flagged)'), not 'on 0 slides'."""
    clean = {"errors": 0, "warnings": 0, "total": 0, "slides_flagged": 0, "by_check": {}, "line": "QA: 0 errors, 0 warnings on 0 slides"}
    assert run_deck._qa_line(clean, 7) == "QA: 0 errors, 0 warnings on 7 slides checked (0 flagged)"
    dirty = {"errors": 1, "warnings": 2, "total": 3, "slides_flagged": 2, "by_check": {"min_font": 3},
             "line": "QA: 1 errors, 2 warnings on 2 slides (min_font 3)"}
    assert run_deck._qa_line(dirty, 7) == "QA: 1 errors, 2 warnings on 7 slides checked (2 flagged) (min_font 3)"


# ---------------------------------------------------------------- review fixes: stated limits that are not limits on the deck

def test_a_document_sentence_about_other_slides_is_not_the_decks_limit():
    """'up to 3 slides of evidence per past campaign' in a document is about case studies, not the whole deck."""
    inp = _brief_inp()
    inp.docs = {"t": {"name": "T", "text": "Case studies: up to 3 slides of evidence per past campaign are welcome in your written response.", "pages": 1}}
    assert assemble.stated_limit(inp) is None
    assert assemble._length_for(profiles.load("agency_pitch"), [], [], inp, False)["max_slides"] == 18
    inp.docs["t"]["text"] = "Pitch decks must be no more than 12 slides."
    assert assemble.stated_limit(inp)["max_slides"] == 12   # a real limit still counts


def test_a_past_decks_size_or_a_page_limit_on_a_tender_is_not_the_decks_limit():
    """'last year was 40 slides' and 'the tender response must be within 20 pages' in the person's words do not set max_slides."""
    prof = profiles.load("agency_pitch")
    past = assemble._length_for(prof, [], [], _brief_inp("Last year our pitch was 40 slides and it was too long."), False)
    assert past["max_slides"] == 18 and past["source"] == "profile"
    pages = _brief_inp("Pitch for Lumen Water. The tender response must be within 20 pages.")
    assert assemble.stated_limit(pages) is None
    assert assemble.stated_limit(_brief_inp("The pitch deck must be within 20 pages."))["max_slides"] == 20   # a page limit on the deck still counts


def test_the_objective_slide_does_not_promise_a_number_when_the_objective_has_none():
    """A qualitative objective gets the plain title; one with a figure keeps 'by how much and by when'."""
    inp = _brief_inp()
    soft = assemble._objective_slide(inp, [{"text": "Attitudinal: Feel better about tap water", "refs": ["brief:objectives.attitudinal"]}])
    assert soft["title"] == "What has to change"
    hard = assemble._objective_slide(inp, [{"text": "Behavioural: Cut use by 5%", "refs": ["brief:objectives.behavioural"]}])
    assert hard["title"] == "What has to change, by how much and by when"
