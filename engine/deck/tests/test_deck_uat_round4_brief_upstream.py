"""UAT round 4 L2 (Copperell, a fictional brand): a brief-only deck (Continue in -> Deck from a locked brief) built from an EMPTY brief. The
middleware never sent the brief to the engine, so the intake abstained on every field ("nothing the person gave states it") and Built from said
'research'. Now the brief travels as ``brief_upstream`` and the engine reads its fields through the one mapping (brief_from_data)."""

from __future__ import annotations

import json
from argparse import Namespace
from pathlib import Path

import pytest

from deck import inputs, intake, run_deck

HERE = Path(__file__).parent

#: The brief as the UAT deck doc-ie-napkin-deck-maker-f64c4f51 carried it under data.upstream (shortened, same keys and shapes).
BRIEF_ID = "3f19ff27-fd4f-42de-a575-049063082f64"
BRIEF = {
    "project_name": "Copperell Refill", "client": "Copperell Home Ltd",
    "objectives": {"attitudinal": "Move belief from 'a tablet can't clean' to 'it cleans as well as my usual spray'.", "behavioural": "Sell the starter bottle."},
    "audience": "To confirm: Renters and flatshare students aged 20-35.",
    "single_minded_proposition": "Cleans as well as your usual spray.",
    "reasons_to_believe": ["Sampling sachets with online grocery orders.", "Ribbed amber glass, kept for life."],
    "desired_response": {"do": "Pick up the Refill bottle.", "feel": "Pleased and quietly proud.", "think": "It cleans as well."},
    "tone_and_world": ["Calm but confident", "Premium but not posh"],
    "mandatories": ["Bottle is the hero, logo top right", "Include: 'Keep out of reach of children. Read the label before use.'"],
    "background": "A refill cleaner in amber glass.", "insight": "She suspects she pays for the scent.", "competitor_context": "smol, Method",
    "budget_and_scope": "£200k excluding VAT", "capture": {},
}
MEMBERS = {"facts": [{"id": "f_00A9B1FB70AB47229F2E1658", "entity": "brand/smol", "key": "positioning.claim", "value": "Powerful performance",
                      "source": "s1", "as_of": "2026-08-11", "confidence": "low"}], "sources": [{"id": "s1", "title": "smol", "url": "https://example.invalid/"}]}

FIELDS = ("objectives", "audience", "smp", "reasons_to_believe", "desired_response", "tone_world_assets", "mandatories")


def _empty():
    return inputs.load(None, None, None, [], prompt_text="A pitch for Copperell")


def test_a_brief_only_deck_takes_every_field_of_the_brief_it_was_spun_off_from():
    inp = _empty()
    assert not inp.has_brief()
    assert inputs.apply_upstream_brief(inp, BRIEF_ID, BRIEF)
    assert all(inp.brief[f]["value"] and inp.brief[f]["kind"] == "brief-maker" for f in FIELDS)   # round 4: every one abstained
    inputs.apply_research(inp, MEMBERS)
    assert intake.tier(inp)["tier"] == "brief+research"   # round 4: 'research' alone, though the brief was there
    left = [g["field"] for g in intake.gap_report(inp).get("brief_fields") or []]
    assert not set(FIELDS) & set(left), left


def test_the_decks_own_brief_and_a_non_brief_entry_are_never_taken():
    inp = inputs.load(HERE / "fixtures" / "lumen_water" / "brief_object.json", None, None, [], prompt_text="x")
    before = json.dumps(inp.brief, sort_keys=True, default=str)
    assert not inputs.apply_upstream_brief(inp, BRIEF_ID, BRIEF)
    assert json.dumps(inp.brief, sort_keys=True, default=str) == before
    assert not inputs.apply_upstream_brief(_empty(), "p", {"app": "production-tool", "finals": {}})


def test_run_deck_reads_the_brief_upstream_file_and_a_brief_flag_still_wins(tmp_path):
    f = tmp_path / "brief_upstream.json"
    f.write_text(json.dumps({"id": BRIEF_ID, "data": BRIEF}))
    inp = _empty()
    assert run_deck._brief_upstream(Namespace(brief_upstream=f, brief=None, deck=None, members=None), inp)
    assert inp.brief["smp"]["value"] == "Cleans as well as your usual spray."
    assert not run_deck._brief_upstream(Namespace(brief_upstream=f, brief=Path("b.json"), deck=None, members=None), _empty())
    f.write_text(json.dumps({"id": BRIEF_ID}))
    with pytest.raises(SystemExit, match="must be a JSON file"):
        run_deck._brief_upstream(Namespace(brief_upstream=f, brief=None, deck=None, members=None), _empty())


def _srv(tmp_path):
    from deck import server as srv
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_PORT": "0", "NAPKIN_DECK_REPLAY": str(HERE / "fixtures" / "fernley" / "stages")})
    return srv, cfg, srv.Server(cfg)


def test_the_engine_server_passes_the_brief_and_reads_it_for_the_inputs_rows(tmp_path, monkeypatch):
    srv, cfg, s = _srv(tmp_path)
    d = srv.Doc(cfg.data / "doc", "doc")
    d.folder = cfg.data / "doc" / "k"
    seen = []
    monkeypatch.setattr(srv.run_deck, "main", lambda argv: seen.append(list(argv)) or {})
    base = {"prompt": {"text": "A pitch for Copperell", "client": "Copperell", "project": "Copperell Refill", "agency": ""}, "kind": "agency", "format": "pitch"}
    req = srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True, "members": MEMBERS,
                                "brief_upstream": {"id": BRIEF_ID, "data": BRIEF}}, cfg)
    s.call_engine(d, req, None)
    sent = json.loads(Path(seen[0][seen[0].index("--brief-upstream") + 1]).read_text())
    assert sent == {"id": BRIEF_ID, "data": BRIEF}
    inp = s.load_inputs(d, req)
    assert inp.has_brief() and intake.tier(inp)["tier"] == "brief+research"
    plain = srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True}, cfg)
    s.call_engine(d, plain, None)
    assert "--brief-upstream" not in seen[1]
    for bad in ({"id": "x"}, {"id": "", "data": {}}, {"id": "x", "data": {"app": "production-tool"}}, "nope"):
        with pytest.raises(srv.Refused) as e:
            srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True, "brief_upstream": bad}, cfg)
        assert e.value.status == 400
