"""Offline tests for the Deck's standalone intake and its hand-off loader (ADR 0028).

No model call, no client material: every fixture is invented (Lumen Water). Run from ``engine/``:
``PYTHONPATH=. python3 -m pytest -q deck/tests``.
"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest
import yaml

from deck import assemble, inputs, intake, refs, run_deck, spec, stages, validate
from deck.inputs import Inputs

FIX = Path(__file__).parent / "fixtures"
BRIEF = FIX / "lumen_water"
PROMPT = FIX / "lumen_water_prompt"
STAGE_FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}


def _stages(folder: Path, extra: dict | None = None) -> dict:
    """The recorded stage outputs in a fixture folder, keyed a, b, c, d (and a0 where present)."""
    files = {**STAGE_FILES, **(extra or {})}
    return {k: json.loads((folder / f).read_text()) for k, f in files.items() if (folder / f).exists()}


def _prompt_inputs(**kw) -> Inputs:
    """Inputs for the prompt-only fixture (no brief)."""
    return inputs.load(None, prompt_text=(PROMPT / "prompt.txt").read_text().strip(), **kw)


def _sl(**kw):
    """A drafted slide with the given overrides."""
    s = {"type": "insight", "section": "Insight", "title": "A title for the slide", "blocks": [], "claims": [], "visual": {}, "status": "drafted", "requirements": []}
    s.update(kw)
    return s


def _deck(slides: list, tier: str | None = None) -> dict:
    """A deck of the given slides, optionally stamped with a built_from tier."""
    meta = {"client": "Lumen Water", "project": "Awareness"}
    if tier:
        meta["built_from"] = {"tier": tier, "documents": [], "brief": False, "research": False}
    ids = [f"s{i:02d}" for i in range(1, len(slides) + 1)]
    return {"meta": meta, "requirements": {}, "order": ids, "slides": dict(zip(ids, slides))}


# ---------------------------------------------------------------- the brief-present path is unchanged

def test_brief_only_deck_is_the_golden_deck_apart_from_built_from():
    """A brief and no prompt text builds the same deck.json and validation.json as before the intake work."""
    inp = inputs.load(BRIEF / "brief_object.json")
    deck = assemble.build(inp, _stages(BRIEF), client="Lumen Water", project="National awareness campaign")
    deck["meta"].pop("built_at")
    assert deck["meta"].pop("built_from") == {"tier": "brief", "documents": [], "brief": True, "research": False}
    assert json.loads(json.dumps(deck, default=str)) == json.loads((BRIEF / "golden_deck.json").read_text())
    assert validate.run(deck, inp) == json.loads((BRIEF / "golden_validation.json").read_text())


def _run_main(monkeypatch, tmp_path, argv):
    """Run run_deck.main with the renderers and LibreOffice stubbed out (no soffice here, no model)."""
    for mod, fn in ((run_deck.render_pptx, "render"), (run_deck.render_web, "render")):
        monkeypatch.setattr(mod, fn, lambda *a, **k: tmp_path / "deck.pptx")
    monkeypatch.setattr(run_deck.subprocess, "run", lambda *a, **k: None)
    monkeypatch.setattr(run_deck, "_soffice", lambda: "soffice")
    return run_deck.main(argv)


def test_run_deck_with_a_brief_writes_the_golden_deck(monkeypatch, tmp_path):
    """The CLI path, not only assemble: --brief and no prompt text writes the golden deck.json."""
    out = tmp_path / "out"
    _run_main(monkeypatch, tmp_path, ["--brief", str(BRIEF / "brief_object.json"), "--stages", str(BRIEF), "--client", "Lumen Water",
                                      "--project", "National awareness campaign", "--out", str(out)])
    deck = json.loads((out / "deck.json").read_text())
    deck["meta"].pop("built_at")
    deck["meta"].pop("built_from")
    assert deck["meta"].pop("audience") == "review"   # run_deck stamps who the render is for
    assert deck["meta"].pop("confirm") and deck["meta"].pop("confirm_summary")["verified"] == 0   # run_deck stamps the confirm list; the build itself is untouched
    assert deck == json.loads((BRIEF / "golden_deck.json").read_text())
    assert json.loads((out / "validation.json").read_text()) == json.loads((BRIEF / "golden_validation.json").read_text())
    assert "intake" not in json.loads((out / "report.json").read_text())   # a complete brief runs no intake


# ---------------------------------------------------------------- inputs: prompt, documents, hand-off

def test_load_accepts_no_brief():
    """No brief: every brief field is present and empty, and the prompt text is carried."""
    inp = _prompt_inputs()
    assert set(inp.brief) == set(inputs.BRIEF_FIELDS) and not any(f["value"] for f in inp.brief.values())
    assert inp.prompt_text.startswith("Lumen Water wants") and inp.coverage["brief_source"] == "none"
    assert not inp.has_brief() and not inp.has_research()


def _brief_clan_data() -> dict:
    """The data a Brief Maker document holds (invented)."""
    return {"background": "Lumen Water serves a region.", "objectives": {"behavioural": "Cut use by 5%"},
            "audience": "Households.", "smp": "Every drop has a story.", "reasons_to_believe": ["40 years"],
            "capture": {"how_to_win": [{"kind": "criteria", "point": "Clarity", "evidence": "RFT p2"}]},
            "open_questions": ["Launch date?", {"question": "Who signs off?"}]}


def _research_rows():
    """Research members (invented): two pins, three findings (one verified, one proposed, one verified here but rejected in the chain)."""
    facts = [{"id": "f_1", "entity": "Lumen Water", "key": "customers", "value": 1200, "unit": "count", "confidence": "high"},
             {"id": "f_2", "entity": "Lumen Water", "key": "leak.share", "value": 0.3, "unit": "proportion", "confidence": "low"}]
    findings = [{"id": "fi_ok", "status": "verified", "statement": "Customers value local service."},
                {"id": "fi_prop", "status": "proposed", "statement": "Use peaks in July."},
                {"id": "fi_bad", "status": "verified", "statement": "Half of customers want 99 tips."}]
    chain = [{"kind": "verdict", "polarity": "bad", "targets": ["finding[fi_bad]"], "reason": "not about households"},
             {"kind": "verdict", "polarity": "bad", "targets": ["pin[f_2]"]}]
    return facts, findings, [{"id": "src_1", "title": "Annual report"}], chain


def _clan_zip(path: Path) -> Path:
    """A Brief Maker .clan carrying a brief and research members, as the files hold them."""
    facts, findings, sources, chain = _research_rows()
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("manifest.yaml", yaml.safe_dump({"document_id": "brief-1", "title": "Brief"}))
        z.writestr("shared/data.yaml", yaml.safe_dump(_brief_clan_data()))
        z.writestr("shared/facts.yaml", yaml.safe_dump({"facts": facts}))
        z.writestr("shared/findings.yaml", yaml.safe_dump({"findings": findings}))
        z.writestr("shared/sources.yaml", yaml.safe_dump({"sources": sources}))
        z.writestr("agent/decision-chain.yaml", yaml.safe_dump({"decisions": chain}))
    return path


def test_from_upstream_matches_the_brief_clan_loader(tmp_path):
    """Parity: the same brief through from_upstream and load_brief_clan gives equal fields and coverage."""
    clan = _clan_zip(tmp_path / "brief.clan")
    fields, htw, oq, cov = inputs.load_brief_clan(clan)
    inp = inputs.from_upstream({"upstream": {"brief-1": _brief_clan_data()}}, {})
    assert inp.brief == fields and inp.how_to_win == htw and inp.open_questions == oq
    assert inp.coverage == cov
    assert inputs.CLAN_FIELDS and inp.has_brief() and not inp.has_research()


def test_from_upstream_reads_research_like_the_clan_loader(tmp_path):
    """Facts, findings, sources and the carried chain give the same Inputs as load() on the clan file;
    the chain's rejected finding stays rejected (the clan loader never read findings from the chain)."""
    clan = _clan_zip(tmp_path / "brief.clan")
    ref = inputs.load(clan)
    facts, findings, sources, chain = _research_rows()
    inp = inputs.from_upstream({"upstream": {"brief-1": _brief_clan_data(), "res-1": {"campaign": {"name": "Lumen"}}}},
                               {"facts": facts, "findings": findings, "sources": sources, "decisions": chain})
    assert inp.brief == ref.brief and inp.facts == ref.facts and inp.sources == ref.sources
    assert inp.rejected_pins == ref.rejected_pins == {"f_2"}
    assert inp.research_doc_id == "res-1" and inp.research_title == "Lumen"
    assert {k: v for k, v in inp.coverage.items() if k != "findings_by_status"} == {k: v for k, v in ref.coverage.items() if k != "findings_by_status"}
    assert inp.findings["fi_bad"]["status"] == "rejected" and inp.findings["fi_bad"]["rejection"]["reason"] == "not about households"
    assert inp.findings["fi_ok"]["status"] == "verified" and inp.coverage["findings_by_status"]["rejected"] == 1


def test_from_upstream_without_a_brief_and_with_prompt_and_answers():
    """Research alone upstream: empty brief fields; the Deck's own prompt, answers and intake are read."""
    facts, findings, sources, chain = _research_rows()
    data = {"upstream": {"res-1": {"campaign": {"name": "Lumen"}}},
            "inputs": {"prompt": {"client": "Lumen Water", "text": "Cut use by 5%."}},
            "intake": {"questions": [{"id": "q_a"}], "answers": {"q_a": {"text": "Under 100,000"}}}}
    inp = inputs.from_upstream(data, {"facts": facts, "findings": findings, "sources": sources, "decisions": chain})
    assert not inp.has_brief() and inp.has_research() and intake.tier(inp)["tier"] == "research"
    assert inp.prompt_text == "Cut use by 5%." and inp.answers["q_a"]["text"] == "Under 100,000" and "answers" not in inp.intake


def test_rejected_finding_in_the_chain_reaches_no_slide():
    """Three hops in miniature: a finding rejected upstream is not sent to a stage, and citing it is an error."""
    facts, findings, sources, chain = _research_rows()
    inp = inputs.from_upstream({"upstream": {"res-1": {}}}, {"facts": facts, "findings": findings, "sources": sources, "decisions": chain})
    block = stages._facts_block(inp)
    assert "fi_bad" not in block and "fi_ok" in block and "[f_2]" not in block
    sl = _sl(claims=[{"text": "Half want tips", "refs": ["fi_bad"], "basis": "sourced"}])
    assert ("rejected_used", "error") in {(f["check"], f["level"]) for f in validate.run(_deck([sl]), inp)}
    deck = assemble.build(inp, {"a0": {"fields": {"insight": {"value": "x", "kind": "research", "refs": ["fi_bad"]}}}}, client="Lumen Water", project="P")
    assert not any(f["check"] == "rejected_used" for f in validate.run(deck, inp))
    assert inp.brief["insight"]["value"] is None   # the field that cited it was dropped


def test_load_doc_reads_docx_md_txt_eml_and_keeps_pdf_page_locators(tmp_path, monkeypatch):
    """Every supported type reads; a PDF keeps its [pN] markers and a page count; nothing is clipped."""
    docx = pytest.importorskip("docx")
    d = docx.Document()
    d.add_paragraph("Lumen Water annual note.")
    t = d.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text, t.rows[0].cells[1].text = "Customers", "1,200"
    d.save(tmp_path / "note.docx")
    (tmp_path / "a.md").write_text("# Heading\nBody 42.")
    (tmp_path / "b.txt").write_text("plain " * 40_000)
    (tmp_path / "c.eml").write_text("Subject: Hello\nFrom: a@example.com\n\nThe launch is in May.")
    assert "1,200" in inputs.load_doc(tmp_path / "note.docx")["text"]
    assert inputs.load_doc(tmp_path / "a.md")["text"] == "# Heading\nBody 42."
    assert inputs.load_doc(tmp_path / "b.txt")["chars"] == 240_000
    assert "launch is in May" in inputs.load_doc(tmp_path / "c.eml")["text"]
    pages = "\n".join(f"[p{n}]\n" + f"Page {n} has real text. " * 20 for n in range(1, 6))
    monkeypatch.setattr(inputs, "_pdf_pages", lambda p: (pages, 5))
    pdf = inputs.load_doc(tmp_path / "x.pdf")
    assert pdf["pages"] == 5 and all(f"[p{n}]" in pdf["text"] for n in range(1, 6))
    inp = inputs.load(None, docs=[("note", tmp_path / "note.docx")], prompt_text="x")
    assert inp.coverage["docs"]["note"] == inp.docs["note"]["chars"]


# ---------------------------------------------------------------- refs and validators

def test_prompt_sentences_split_is_deterministic():
    """Lines, then . ! ? followed by white space; decimals stay whole."""
    assert refs.prompt_sentences("A 5.2 rise. Really? Yes!\n\nNext line") == ["A 5.2 rise.", "Really?", "Yes!", "Next line"]
    assert refs.prompt_sentences("") == []


def test_prompt_and_answer_refs_resolve():
    """prompt:<n> and answer:<qid> resolve to their numbers; out of range, unknown and skipped do not."""
    inp = _prompt_inputs(answers={"q_budget": {"option_id": "o_large", "at": "t"}, "q_tone": {"skipped": True, "at": "t"}, "q_free": {"text": "About 80 staff"}},
                         intake=json.loads((PROMPT / "a0_intake.json").read_text()))
    R = refs.Resolver(inp)
    assert (R.kind("prompt:2"), R.numbers("prompt:2")) == ("prompt", {5.0, 12.0})
    assert R.kind("prompt:9") == R.kind("prompt:0") == R.kind("prompt:x") == "unknown"
    assert R.kind("answer:q_budget") == "answer" and R.numbers("answer:q_budget") == {100000.0}
    assert R.numbers("answer:q_free") == {80.0}
    assert R.kind("answer:q_tone") == R.kind("answer:q_none") == "unknown"
    assert R.source_key("prompt:1")[0] == "prompt" and "prompt" in R.describe("prompt:1")


def test_numbers_trace_accepts_prompt_answer_and_document_numbers_only():
    """A number in the cited prompt sentence, answer or document ref traces; another number still fails."""
    inp = _prompt_inputs(answers={"q_free": {"text": "About 80 staff"}})
    inp.docs["memo"] = {"name": "memo.md", "text": "[p1]\nWe ran 14 pilots.", "chars": 22}
    ok = _sl(blocks=[{"kind": "text", "text": "Cut use by 5% in 12 months", "refs": ["prompt:2"]},
                     {"kind": "text", "text": "80 staff will help", "refs": ["answer:q_free"]},
                     {"kind": "text", "text": "14 pilots ran", "refs": ["doc:memo#p1"]}])
    bad = _sl(blocks=[{"kind": "text", "text": "Cut use by 7% in 12 months", "refs": ["prompt:2"]}])
    checks = lambda d: {(f["check"], f["level"]) for f in validate.run(d, inp)}   # noqa: E731
    assert ("numbers_trace", "error") not in checks(_deck([ok])) and ("unknown_ref", "error") not in checks(_deck([ok]))
    assert ("numbers_trace", "error") in checks(_deck([bad]))   # 7 is nowhere in the inputs
    bad2 = _sl(blocks=[{"kind": "text", "text": "A 40% rise", "refs": ["prompt:1"]}])
    assert ("numbers_trace", "error") in checks(_deck([bad2]))
    assert ("numbers_uncited", "warn") not in checks(_deck([ok]))


def test_thin_evidence_warns_for_prompt_tiers_only():
    """More than THIN_EVIDENCE_SHARE of presented slides citing nothing warns on a prompt tier, not on a brief tier."""
    bare = [_sl(blocks=[{"kind": "text", "text": "A bold idea", "basis": "creative"}]) for _ in range(3)]
    cited = _sl(blocks=[{"kind": "text", "text": "Cut use", "refs": ["prompt:2"]}])
    inp = _prompt_inputs()
    has = lambda d: ("thin_evidence", "warn") in {(f["check"], f["level"]) for f in validate.run(d, inp)}   # noqa: E731
    assert spec.THIN_EVIDENCE_SHARE == 0.5
    assert has(_deck(bare + [cited], "prompt")) and has(_deck(bare, "prompt+documents"))
    assert not has(_deck(bare, "brief")) and not has(_deck(bare, "research")) and not has(_deck(bare + [cited]))
    assert not has(_deck([cited, cited, cited, bare[0]], "prompt"))   # a quarter uncited: fine


# ---------------------------------------------------------------- intake.py

def test_tier_ladder():
    """prompt < prompt+documents < research < brief < brief+research; a field intake filled is not a brief."""
    inp = _prompt_inputs()
    assert intake.tier(inp) == {"tier": "prompt", "documents": [], "brief": False, "research": False}
    inp.docs["memo"] = {"name": "memo.md", "text": "x", "chars": 1}
    assert intake.tier(inp)["tier"] == "prompt+documents" and intake.tier(inp)["documents"] == ["memo.md"]
    intake.apply_a0(inp, json.loads((PROMPT / "a0_intake.json").read_text()))
    assert intake.tier(inp)["tier"] == "prompt+documents" and inp.brief["audience"]["value"]
    inp.facts["f_1"] = {"id": "f_1"}
    assert intake.tier(inp)["tier"] == "research"
    assert intake.tier(inputs.load(BRIEF / "brief_object.json"))["tier"] == "brief"


def test_gap_report_names_empty_fields_proposals_and_slide_types_without_evidence():
    """Empty and proposal-only fields; measurement needs a figure, audience slides need audience evidence."""
    bare = inputs.load(None, prompt_text="Make us a deck about water.")
    g = intake.gap_report(bare)
    assert [x["field"] for x in g["brief_fields"]] == inputs.BRIEF_FIELDS
    types = {x["type"] for x in g["slide_types"]}
    assert {"measurement", "chart", "audience", "insight", "investment"} <= types
    assert all(x["why"] for x in g["slide_types"] + g["brief_fields"])
    inp = _prompt_inputs()
    a0 = json.loads((PROMPT / "a0_intake.json").read_text())
    g2 = intake.gap_report(inp, a0)   # read as if applied
    fields = {x["field"]: x["why"] for x in g2["brief_fields"]}
    assert "audience" not in fields and "background" not in fields and fields["insight"].startswith("filled only by proposal")
    types2 = {x["type"] for x in g2["slide_types"]}
    assert "measurement" not in types2 and "audience" not in types2 and "investment" in types2   # the prompt states 5%, 12, 25, 54
    assert "traction" in {x["type"] for x in intake.gap_report(bare, kind="investor")["slide_types"]}
    full = intake.gap_report(inputs.load(BRIEF / "brief_object.json"))
    assert [x["field"] for x in full["brief_fields"]] == ["competitor_context"]


def test_gap_report_ignores_years_and_locators():
    """A year, 0/1 and a [pN] marker are not a figure to measure against."""
    inp = inputs.load(None, prompt_text="We launch in 2027, one campaign.")
    inp.docs["d"] = {"name": "d.pdf", "text": "[p3]\nNo figures here.", "chars": 20}
    assert "measurement" in {x["type"] for x in intake.gap_report(inp)["slide_types"]}


def test_validate_a0_accepts_the_fixture_and_enforces_the_contract():
    """The recorded fixture is valid; each contract rule has a failing case."""
    a0 = json.loads((PROMPT / "a0_intake.json").read_text())
    assert intake.validate_a0(a0) == []
    mut = lambda f: (lambda c: (f(c), intake.validate_a0(c))[1])(json.loads(json.dumps(a0)))   # noqa: E731
    qs = [{"id": f"q_{i}", "text": "t", "options": [], "allow_text": True, "address": "brief.audience"} for i in range(6)]
    assert any("at most 5" in e for e in mut(lambda c: c.update(questions=qs)))
    assert mut(lambda c: c["fields"]["audience"].update(kind="guess"))
    assert mut(lambda c: c["fields"].update(nonsense={"value": 1, "kind": "prompt", "refs": []}))
    assert mut(lambda c: c.update(abstained=["audience"]))           # filled and abstained
    assert mut(lambda c: c["questions"][0].update(address="audience"))
    assert mut(lambda c: c["questions"][0].update(id="budget"))
    assert mut(lambda c: c.pop("gaps"))
    assert mut(lambda c: c.update(stage="x"))
    assert intake.validate_a0([]) == ["a0 is not an object"]


def test_apply_a0_fills_only_what_the_brief_leaves_empty():
    """The brief's own field is never overwritten; a0 fields land marked and cited."""
    inp = inputs.load(BRIEF / "brief_object.json")
    a0 = {"fields": {"audience": {"value": "Everyone.", "kind": "prompt", "refs": ["prompt:1"]},
                     "competitor_context": {"value": "Other utilities.", "kind": "proposal", "refs": []}}}
    inp.prompt_text = "A sentence."
    rep = intake.apply_a0(inp, a0)
    assert rep["kept_brief"] == ["audience"] and inp.brief["audience"]["value"].startswith("Households")
    assert rep["applied"] == ["competitor_context"]
    f = inp.brief["competitor_context"]
    assert f["from_intake"] and f["kind"] == "proposal" and f["mark"] == "intake"
    assert intake.tier(inp)["brief"] is True   # still the brief's own, intake changes nothing about the tier
    assert intake.apply_a0(inp, a0)["applied"] == []   # idempotent


def test_apply_a0_drops_untraced_figures_and_demotes_uncited_claims():
    """A figure in none of the inputs drops the field (an invented number cannot ride in on a brief field)."""
    inp = _prompt_inputs()
    a0 = {"fields": {"audience": {"value": "Adults aged 25 to 54.", "kind": "prompt", "refs": ["prompt:3"]},
                     "desired_response": {"value": "Cut use by 9%", "kind": "prompt", "refs": ["prompt:2"]},
                     "tone_world_assets": {"value": "Warm", "kind": "document", "refs": ["doc:ghost#p1"]},
                     "insight": {"value": "People care.", "kind": "bogus", "refs": []}}}
    rep = intake.apply_a0(inp, a0)
    assert [d["field"] for d in rep["dropped"]] == ["desired_response"] and "9" in rep["dropped"][0]["why"]
    assert rep["demoted"] == ["tone_world_assets"] and inp.brief["tone_world_assets"]["kind"] == "proposal"
    assert inp.brief["insight"]["kind"] == "proposal" and inp.brief["audience"]["kind"] == "prompt"
    assert inp.brief["desired_response"]["value"] is None


def test_apply_a0_uses_answers_and_turns_unanswered_questions_into_open_questions():
    """The person's answer fills its field first; a skipped question becomes an open question; build still completes."""
    a0 = json.loads((PROMPT / "a0_intake.json").read_text())
    inp = _prompt_inputs(answers={"q_budget": {"option_id": "o_large", "at": "t"}, "q_tone": {"skipped": True, "at": "t"}}, intake=a0)
    rep = intake.apply_a0(inp, a0)
    assert rep["answered"] == ["budget_scope"] and inp.brief["budget_scope"]["refs"] == ["answer:q_budget"]
    assert "over 100,000" in inp.brief["budget_scope"]["value"]
    assert [q["question"] for q in inp.open_questions] == ["How should it sound?"]
    deck = assemble.build(inp, {"a0": a0}, client="Lumen Water", project="P")
    assert deck["meta"]["built_from"]["tier"] == "prompt"


# ---------------------------------------------------------------- assemble

def test_empty_brief_builds_and_labels_thin_slides():
    """No brief and no stages at all: a deck still builds; no claim slide says from_source; structure keeps its status."""
    inp = inputs.load(None, prompt_text="Lumen Water wants a deck.")
    deck = assemble.build(inp, {}, client="Lumen Water", project="P")
    assert deck["meta"]["built_from"]["tier"] == "prompt"
    claim = [s for s in deck["slides"].values() if s["type"] not in assemble.STRUCTURAL_TYPES]
    assert claim and all(s["status"] in ("drafted", "needs_human") for s in claim)
    errors = {f["check"] for f in validate.run(deck, inp) if f["level"] == "error"}
    assert errors == set(), errors


def test_schema_slide_types_match_the_spec():
    """deck.schema.json lists exactly the slide types spec.SLIDE_TYPES defines."""
    schema = json.loads((Path(run_deck.__file__).parent / "deck.schema.json").read_text())
    assert schema["definitions"]["slide"]["properties"]["type"]["enum"] == list(spec.SLIDE_TYPES)


def test_prompt_only_deck_with_recorded_intake_validates_and_matches_the_schema():
    """The recorded a0 fills the brief; slides cite prompt sentences; nothing errors; the deck matches deck.schema.json."""
    jsonschema = pytest.importorskip("jsonschema")
    inp = _prompt_inputs()
    deck = assemble.build(inp, _stages(PROMPT, {"a0": "a0_intake.json"}), client="Lumen Water", project="National awareness campaign")
    assert inp.brief["audience"]["value"] == "Adults aged 25 to 54 in the region." and inp.brief["insight"]["kind"] == "proposal"
    f = validate.run(deck, inp)
    assert validate.summary(f)["pass"], [x for x in f if x["level"] == "error"]
    assert deck["meta"]["built_from"] == {"tier": "prompt", "documents": [], "brief": False, "research": False}
    d = {**deck, "territories": deck.get("territories") or {}}
    schema = json.loads((Path(run_deck.__file__).parent / "deck.schema.json").read_text())
    jsonschema.validate(d, schema)
    d["meta"].pop("built_from")
    jsonschema.validate(d, schema)   # optional: decks built before the field stay valid
    cited = {r for s in deck["slides"].values() for r in assemble.slide_refs(s)}
    assert {"prompt:2", "prompt:3"} <= cited


def test_slide_citing_a_proposed_field_is_drafted_even_with_a_brief():
    """With a brief, a slide on a field the intake only proposed is not from_source."""
    inp = inputs.load(BRIEF / "brief_object.json")
    inp.brief["insight"]["value"] = None
    intake.apply_a0(inp, {"fields": {"insight": {"value": "People care.", "kind": "proposal", "refs": []}}})
    s = [_sl(status="from_source", type="brief_restated", blocks=[{"kind": "text", "text": "x", "refs": ["brief:insight"]}]), _sl(status="from_source", type="brief_restated")]
    assemble._label_thin(s, inp)
    assert [x["status"] for x in s] == ["drafted", "from_source"]


# ---------------------------------------------------------------- the a0 stage

def test_prompt_file_ends_with_the_input_rule_and_forbids_inventing():
    """The a0 prompt keeps the project's line last and carries each rule the design set."""
    text = (stages.PROMPTS / "a0_intake.md").read_text().rstrip("\n")
    assert text.splitlines()[-1].startswith("Inputs are the only source:")
    for needle in ("60,000", "never overwritten", "omitted fields are reported as abstained", "at most 5", "Do not return a blank",
                   "brief and the research first, then documents, then the prompt"):
        assert needle in text


def test_stage_a0_is_registered_and_dispatches(monkeypatch):
    """run_stage('a0') calls intake(); the model and effort are set like the other stages."""
    assert stages.MODELS["a0"] == "claude-sonnet-5-5" and stages.EFFORT["a0"] == "medium"
    monkeypatch.setattr(stages, "intake", lambda inp: ({"stage": "a0_intake"}, {}))
    assert stages.run_stage("a0", None, {})[0]["stage"] == "a0_intake"
    assert run_deck.STAGE_FILES["a0"] == "a0_intake.json" and list(run_deck.STAGE_FILES)[0] == "a0"


def test_intake_reads_every_chunk_of_every_document(monkeypatch):
    """A long document is split, not clipped: the model calls together cover every character, and the
    brief's own fields are sent as read-only context and not asked for. (Stubbed: no model is called.)"""
    seen = []

    def fake(stage, user, system):
        """Record the call; answer with one field per document chunk read."""
        seen.append(user)
        n = len(seen)
        f = {"audience": {"value": f"Part {n}.", "kind": "document", "refs": ["doc:memo#p1"]}} if "<document" in user else {}
        return {"fields": f, "questions": []}, {"model": "stub", "secs": 0, "calls": 1}

    monkeypatch.setattr(stages, "_call", fake)
    text = "[p1]\n" + "\u03a9" * (stages.CHUNK_CHARS * 2 + 5_000)
    inp = inputs.load(BRIEF / "brief_object.json", prompt_text="A prompt sentence.")
    inp.docs["memo"] = {"name": "memo.md", "text": text, "chars": len(text)}
    out, usage = stages.intake(inp)
    docs = [u for u in seen if "<document" in u]
    assert len(docs) == 3 and len(seen) == 4 and usage["calls"] == 4   # prompt call + one per chunk
    assert sum(u.count("\u03a9") for u in docs) == text.count("\u03a9")           # nothing clipped
    assert "audience" not in out["fields"] and "audience" not in out["abstained"]   # the brief supplies it
    assert "competitor_context" in out["abstained"] and intake.validate_a0(out) == []
    assert out["gaps"]["brief_fields"] and out["produced_by"].startswith("live")


def test_merge_a0_precedence_abstain_and_question_cap():
    """Research beats document beats prompt; same-kind chunks join; supplied fields drop; at most 5 questions."""
    qs = [{"id": f"q{i}", "text": f"Q{i}?", "options": [], "address": "brief.audience"} for i in range(8)]
    parts = [{"fields": {"audience": {"value": "From the prompt.", "kind": "prompt", "refs": ["prompt:1"]},
                         "smp": {"value": "One.", "kind": "document", "refs": ["doc:a#p1"]},
                         "background": {"value": "Brief owns this.", "kind": "prompt", "refs": ["prompt:1"]}}, "questions": qs},
             {"fields": {"audience": {"value": "From a document.", "kind": "document", "refs": ["doc:a#p2"]},
                         "smp": {"value": "Two.", "kind": "document", "refs": ["doc:a#p3"]}},
              "conflicts": [{"field": "objectives", "brief": "x", "document": "y", "ref": "doc:a#p2"}, {"field": "nope"}]}]
    out = stages.merge_a0(parts, {"background"})
    assert out["fields"]["audience"]["kind"] == "document" and "the prompt said" in out["fields"]["audience"]["conflict"]
    assert out["fields"]["smp"]["value"] == "One. Two." and out["fields"]["smp"]["refs"] == ["doc:a#p1", "doc:a#p3"]
    assert "background" not in out["fields"] and "background" not in out["abstained"] and "insight" in out["abstained"]
    assert len(out["questions"]) == 5 and out["questions"][0]["id"] == "q_q0" and len(out["conflicts"]) == 1


# ---------------------------------------------------------------- the CLI

def test_run_deck_refuses_an_empty_input(tmp_path, capsys):
    """No prompt, no document, no brief, no research: exit non-zero with a clear message, nothing written."""
    with pytest.raises(SystemExit) as e:
        run_deck.main(["--stages", str(tmp_path), "--client", "A", "--project", "B", "--out", str(tmp_path / "o")])
    assert e.value.code != 0 and "nothing to build a deck from" in capsys.readouterr().err
    assert not (tmp_path / "o").exists()
    with pytest.raises(SystemExit):   # a blank prompt is no prompt
        run_deck.main(["--prompt-text", "   ", "--stages", str(tmp_path), "--client", "A", "--project", "B", "--out", str(tmp_path / "o")])
    with pytest.raises(SystemExit):
        run_deck.main(["--prompt-text", "x", "--prompt-file", str(tmp_path / "p"), "--stages", str(tmp_path), "--client", "A", "--project", "B", "--out", str(tmp_path / "o")])


@pytest.mark.parametrize("how", ["text", "file"])
def test_run_deck_builds_from_a_prompt_alone(monkeypatch, tmp_path, how):
    """--prompt-text or --prompt-file with a recorded a0 builds a deck, makes no research request and says what it was built from."""
    out = tmp_path / "out"
    arg = ["--prompt-text", (PROMPT / "prompt.txt").read_text()] if how == "text" else ["--prompt-file", str(PROMPT / "prompt.txt")]
    answers = tmp_path / "answers.json"
    answers.write_text(json.dumps({"q_budget": {"option_id": "o_small", "at": "t"}}))
    rep = _run_main(monkeypatch, tmp_path, [*arg, "--answers", str(answers), "--stages", str(PROMPT), "--client", "Lumen Water",
                                            "--project", "National awareness campaign", "--out", str(out)])
    deck = json.loads((out / "deck.json").read_text())
    assert deck["meta"]["built_from"]["tier"] == "prompt"
    assert rep["stages"]["a0"]["source"] == "recorded" and rep["intake"]["questions"] == 2 and rep["intake"]["applied"]["answered"] == ["budget_scope"]
    assert "research_request" not in json.dumps(rep) and not (out / "research").exists()   # the engine launches nothing
    assert any("prompt:" in r for s in deck["slides"].values() for r in assemble.slide_refs(s))
    assert json.loads((out / "validation.json").read_text()) is not None


def test_run_deck_research_alone_is_allowed(monkeypatch, tmp_path):
    """--research alone passes the input check (the Deck spun off from Research)."""
    clan = _clan_zip(tmp_path / "res.clan")
    out = tmp_path / "out"
    _run_main(monkeypatch, tmp_path, ["--research", str(clan), "--stages", str(tmp_path / "none"), "--client", "Lumen Water", "--project", "P", "--out", str(out)])
    assert json.loads((out / "deck.json").read_text())["meta"]["built_from"]["tier"] == "research"


def test_an_invalid_recorded_a0_stops_the_run(monkeypatch, tmp_path):
    """A recorded a0 that breaks the contract (six questions) is refused with the reason."""
    d = tmp_path / "stages"
    d.mkdir()
    a0 = json.loads((PROMPT / "a0_intake.json").read_text())
    a0["questions"] = [{**a0["questions"][0], "id": f"q_{i}"} for i in range(6)]
    (d / "a0_intake.json").write_text(json.dumps(a0))
    with pytest.raises(SystemExit) as e:
        _run_main(monkeypatch, tmp_path, ["--prompt-text", "x.", "--stages", str(d), "--client", "A", "--project", "B", "--out", str(tmp_path / "o")])
    assert "at most 5" in str(e.value)


def test_intake_is_needed_only_when_there_is_something_to_fill_and_to_read_from():
    """A complete brief, or an empty one with nothing else to read, runs no intake call."""
    assert not run_deck._needs_intake(inputs.load(BRIEF / "brief_object.json"))   # a gap, but nothing else to read
    full = inputs.load(BRIEF / "brief_object.json")
    full.brief["competitor_context"]["value"] = "Others."
    assert not run_deck._needs_intake(full)
    assert run_deck._needs_intake(_prompt_inputs())
    assert not run_deck._needs_intake(inputs.load(None, prompt_text=""))


# ---- fixes from review: years, rejected pins, names, calc, ids, doc keys, packs ----

def _empty_inp(prompt: str) -> Inputs:
    """Inputs with no brief and the given prompt (invented Lumen Water text)."""
    return inputs.load(None, prompt_text=prompt)


def test_apply_a0_keeps_a_field_that_states_a_year():
    """A year in a field value is not a figure: it must not be dropped as untraced."""
    inp = _empty_inp("We launched in 2024 with 40 stores. Budget is 50,000.")
    rep = intake.apply_a0(inp, {"fields": {"background": {"value": "Launched in 2024 with 40 stores", "kind": "prompt", "refs": ["prompt:1"]}}})
    assert rep["applied"] == ["background"] and not rep["dropped"]


def test_apply_a0_drops_a_figure_from_a_rejected_pin():
    """A pin the person rejected is not evidence: citing it or stating its figure drops the field."""
    inp = _empty_inp("Lumen Water sells water filters.")
    inp.facts = {"f_1": {"id": "f_1", "key": "share", "value": 4242, "unit": "count", "as_of": "2025"}}
    inp.rejected_pins = {"f_1"}
    cited = intake.apply_a0(inp, {"fields": {"insight": {"value": "Spend rose 4242", "kind": "research", "refs": ["f_1"]}}})
    assert cited["applied"] == [] and cited["dropped"]
    bare = intake.apply_a0(inp, {"fields": {"audience": {"value": "4242 households", "kind": "proposal", "refs": []}}})
    assert bare["applied"] == [] and "4242" in bare["dropped"][0]["why"]
    assert not intake._figure_numbers(inp, {}) & {4242.0}


def test_apply_a0_keeps_a_field_with_an_invented_name_and_flags_it():
    """A name or legal line in no input no longer drops the field: it is kept, the token is flagged on the field
    and named on a question card; one the prompt states is not flagged."""
    inp = _empty_inp("Lumen Water wants more households. Rival is Bluewave.")
    bad = {"value": "Acme Corp and Bluewave Ltd, regulated by the Central Bank of Ireland", "kind": "prompt", "refs": ["prompt:1"]}
    rep = intake.apply_a0(inp, {"fields": {"competitor_context": bad}})
    assert rep["applied"] == ["competitor_context"] and not rep["dropped"]
    flag = rep["kept_with_flag"][0]
    assert flag["field"] == "competitor_context" and "Corp" in flag["tokens"] and "Ltd" in flag["tokens"]
    assert inp.brief["competitor_context"]["value"] == bad["value"] and inp.brief["competitor_context"]["kept_with_flag"] == flag["tokens"]
    prop = intake.apply_a0(inp, {"fields": {"audience": {"value": "Customers of Initech", "kind": "proposal", "refs": []}}})
    assert prop["applied"] == ["audience"] and prop["kept_with_flag"][0]["tokens"] == ["Initech"]
    ok = intake.apply_a0(inp, {"fields": {"insight": {"value": "The rival is Bluewave", "kind": "prompt", "refs": ["prompt:2"]}}})
    assert ok["applied"] == ["insight"] and not ok["kept_with_flag"]


FERNLEY = ("Fernley Drinks Ltd wants a sparkling tea launch. The budget is EUR 450,000 gross, with a separate EUR 55,000 fee. "
           "Cans are sold at EUR 1.89.")


def test_fernley_limited_to_keeps_the_whole_budget_field():
    """The ordinary words 'limited to' no longer read as a legal line: the field is kept, with nothing flagged (it used to be dropped,
    and the investment slide said 'Budget given: not given')."""
    inp = _empty_inp(FERNLEY)
    value = "EUR 450,000 gross, limited to paid media and production, with a separate EUR 55,000 fee"
    rep = intake.apply_a0(inp, {"fields": {"budget_scope": {"value": value, "kind": "prompt", "refs": ["prompt:1"]}}})
    assert rep["applied"] == ["budget_scope"] and not rep["dropped"] and not rep["kept_with_flag"]
    assert inp.brief["budget_scope"]["value"] == value
    deck = assemble.build(inp, {}, client="Fernley", project="Tea")
    inv = next(s for s in deck["slides"].values() if s["type"] == "investment")
    assert "450,000" in inv["blocks"][0]["text"] and "not given" not in inv["blocks"][0]["text"]


def test_fernley_rrp_keeps_the_field_flags_the_token_and_asks():
    """An untraced token ('RRP') no longer drops the whole field ('background'): the field is kept, the token is flagged on its
    record and a question card names it. The deck-type question stays first and the five-question cap holds."""
    inp = _empty_inp(FERNLEY)
    a0 = {"fields": {"background": {"value": "Fernley sells sparkling tea in cans at an RRP of EUR 1.89.", "kind": "prompt", "refs": ["prompt:1"]}},
          "questions": [intake.type_question()]}
    rep = intake.apply_a0(inp, a0)
    assert rep["applied"] == ["background"] and not rep["dropped"]
    assert rep["kept_with_flag"][0]["field"] == "background" and rep["kept_with_flag"][0]["tokens"] == ["RRP"]
    f = inp.brief["background"]
    assert f["value"].endswith("RRP of EUR 1.89.") and f["kept_with_flag"] == ["RRP"]
    assert [q["id"] for q in a0["questions"]] == ["q_deck_type", "q_token_background"]
    card = a0["questions"][1]
    assert "'RRP'" in card["text"] and card["address"] == "brief.background" and card["allow_text"] is True
    assert intake.validate_a0({**a0, "stage": "a0_intake", "produced_by": "t", "abstained": [], "gaps": {"brief_fields": [], "slide_types": []},
                               "fields": {}}) == []
    again = intake.apply_a0(inp, a0)   # idempotent: no second card
    assert [q["id"] for q in a0["questions"]] == ["q_deck_type", "q_token_background"] and again["kept_with_flag"] == []
    assert not any(q["question"].startswith("The intake wrote") for q in inp.open_questions)   # a card is for the person, not an open question


def test_token_card_respects_the_question_cap():
    """With five questions already, a flagged token is kept and flagged but no sixth card is added, and the report says so."""
    inp = _empty_inp(FERNLEY)
    qs = [{"id": f"q_{i}", "text": f"Question {i}?", "options": [], "allow_text": True, "address": "brief.audience"} for i in range(intake.MAX_QUESTIONS)]
    a0 = {"fields": {"background": {"value": "Sold at an RRP of EUR 1.89.", "kind": "prompt", "refs": ["prompt:1"]}}, "questions": qs}
    rep = intake.apply_a0(inp, a0)
    assert rep["applied"] == ["background"] and len(a0["questions"]) == intake.MAX_QUESTIONS
    assert "cap" in rep["kept_with_flag"][0]["question"]


def test_answering_remove_on_a_token_card_takes_the_flagged_piece_out():
    """'Remove it' drops the sentence holding the token; any other answer keeps the field and its flag."""
    value = "Fernley sells tea. It is priced at an RRP of EUR 1.89."
    a0 = {"fields": {"background": {"value": value, "kind": "prompt", "refs": ["prompt:1"]}}, "questions": []}
    inp = _empty_inp(FERNLEY)
    intake.apply_a0(inp, a0)
    inp.answers = {"q_token_background": {"option_id": "opt_remove", "at": "t"}}
    rep = intake.apply_a0(inp, a0)
    assert rep["removed"] == ["background"] and inp.brief["background"]["value"] == "Fernley sells tea."
    keep = _empty_inp(FERNLEY)
    intake.apply_a0(keep, {"fields": {"background": {"value": value, "kind": "prompt", "refs": ["prompt:1"]}}, "questions": []})
    keep.answers = {"q_token_background": {"option_id": "opt_keep", "at": "t"}}
    assert "removed" not in intake.apply_a0(keep, {"fields": {}, "questions": []}) and keep.brief["background"]["value"] == value
    assert intake._without_tokens(["a RRP", "b"], ["RRP"]) == ["b"] and intake._without_tokens("RRP only", ["RRP"]) is None


def test_legal_line_is_a_form_not_an_ordinary_word():
    """Both directions: 'limited', 'act' and 'authority' alone are ordinary; a company form, an Act, an Authority, Ltd, GDPR and
    the Central Bank are legal lines (and a legal line no input says is flagged)."""
    legal = lambda t: bool(intake._LEGAL.search(t))
    for plain in ("Limited to paid media.", "Budgets are limited to the county", "We act fast", "Act now to cut waste", "The contracting authority scores each answer",
                  "A commission of 10%", "the limited edition can"):
        assert not legal(plain), plain
    for form in ("Fernley Drinks Limited", "Acme Ltd", "Initech plc", "Bluewave DAC", "Dockhand Inc", "the Companies Act 2014", "the Data Protection Commission",
                 "the Health Products Authority", "we follow GDPR", "regulated by the Central Bank", "a registered trademark"):
        assert legal(form), form
    assert intake._untraced_names("Fernley Drinks Limited sells tea", "fernley drinks limited sells tea") == []
    assert "Limited" in " ".join(intake._untraced_names("Sold by Zed Quill Limited", "sold by"))


def test_calc_ref_is_arithmetic_only():
    """calc: refs evaluate arithmetic and refuse anything else (no code runs)."""
    R = refs.Resolver(_empty_inp("x."), [])
    assert 6.0 in R.numbers("calc:2*3")
    evil = "calc:[c for c in ().__class__.__base__.__subclasses__()][0]"
    assert R.numbers(evil) == set()
    with pytest.raises(ValueError):
        refs.safe_calc("__import__('os').system('true')")
    with pytest.raises(ValueError):
        refs.safe_calc("9**9**9")


def test_merge_a0_gives_colliding_question_ids_unique_ids():
    """Two parts emitting the same id for different questions merge to a valid a0 with unique ids."""
    parts = [{"fields": {}, "questions": [{"id": "q_1", "text": "A?", "address": "brief.audience"}]},
             {"fields": {}, "questions": [{"id": "q_1", "text": "B?", "address": "brief.budget_scope"},
                                          {"id": "q_2", "text": "C?", "address": "brief.audience"},
                                          {"text": "D?", "address": "brief.audience"}]}]
    out = stages.merge_a0(parts, set(), "agency", _empty_inp("Hi there."))
    out["produced_by"] = "test"
    ids = [q["id"] for q in out["questions"]]
    assert len(set(ids)) == 4 and ids[0] == "q_1" and intake.validate_a0(out) == []


def test_prompt_only_deck_activates_category_packs():
    """The prompt (and answers) count when choosing category packs."""
    inp = _empty_inp("A campaign for a suicide prevention charity.")
    assert validate.packs_for(inp)


def test_doc_keys_are_checked(tmp_path, capsys):
    """Repeated --doc keys and a --doc with no '=' are argument errors, not overwrites or IndexError."""
    f = tmp_path / "one.txt"
    f.write_text("Lumen Water has 40 stores.")
    base = ["--prompt-text", "Hi.", "--stages", str(tmp_path), "--client", "L", "--project", "P", "--out", str(tmp_path / "o")]
    with pytest.raises(SystemExit):
        run_deck.main(base + ["--doc", f"a={f}", "--doc", f"a={f}"])
    assert "twice" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        run_deck.main(base + ["--doc", "nofile"])
    assert "KEY=PATH" in capsys.readouterr().err


def test_doc_supply_never_reads_the_clients_requirements_as_the_agencys_own():
    """'Fees must not exceed ...' and 'Minimum turnover ...' under Budget or Credentials are tender text; a decision date keeps no bullet marker and is not a fee."""
    inp = _empty_inp("Lumen Water pitch.")
    inp.docs = {"t": {"name": "T", "text": "[p1]\nCredentials\n- Minimum turnover of EUR 2m in each of the last three years\n- Won a Cannes Lions Grand Prix in 2024\n\n"
                                          "Budget\n- Fees must not exceed EUR 100,000 excluding VAT\n- Award decision expected 12 March 2027\n"}}
    got = intake.doc_supply(inp)
    assert got["credentials"]["items"] == ["Won a Cannes Lions Grand Prix in 2024"]
    assert "investment" not in got
    assert got["next_step"]["items"] == ["Award decision expected 12 March 2027"]


def test_a_flagged_name_is_a_proposal_not_sourced_even_when_the_card_is_not_asked():
    """A name in none of the inputs is kept but never counts as the prompt's: kind is proposal, with or without room for the card;
    'Keep it' restores the kind it claimed."""
    inp = _empty_inp("Fernley Drinks wants a campaign to cut sugar. 1. Make it bold.")
    qs = [{"id": f"q_{i}", "text": f"Question {i}?", "options": [], "allow_text": True, "address": "brief.audience"} for i in range(intake.MAX_QUESTIONS)]
    a0 = {"questions": qs, "fields": {"insight": {"value": "Fernley Drinks Limited", "kind": "prompt", "refs": ["prompt:1"]}}}
    rep = intake.apply_a0(inp, a0)
    assert "cap" in rep["kept_with_flag"][0]["question"] and inp.brief["insight"]["kind"] == "proposal" and "insight" in rep["demoted"]
    again = intake.apply_a0(inp, a0)
    assert again["kept_with_flag"] == [] and inp.brief["insight"]["kind"] == "proposal"
    inp.answers = {intake.TOKEN_QUESTION_PREFIX + "insight": {"option_id": "opt_keep", "at": "t"}}
    intake._apply_token_answers(inp, rep)
    assert inp.brief["insight"]["kind"] == "prompt"
