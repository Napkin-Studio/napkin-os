"""UAT round 4 blocker 2 (Copperell, a fictional brand): a deck spun off a brief named no project, so the cover read "Copperell Home Ltd:" (a
'[Project]' placeholder scrubbed from a client file) and the exports were named "Project". The engine server takes the brief's project name, and
the cover never ends on a bare colon."""

from __future__ import annotations

import json
from pathlib import Path

from deck import assemble, inputs

HERE = Path(__file__).parent
LUMEN = HERE / "fixtures" / "lumen_water"


def _stages():
    return {k: json.loads((LUMEN / f).read_text()) for k, f in (("a", "a_requirements.json"), ("b", "b_storyline.json"), ("c", "c_territories.json"), ("d", "d_idea.json"))}


def _cover(project, line="Refill. Not landfill."):
    st = _stages()
    st["d"] = {**st["d"], "campaign_line": line}
    deck = assemble.build(inputs.load(LUMEN / "brief_object.json"), st, client="Copperell Home Ltd", project=project)
    return deck["slides"][deck["order"][0]]["title"]


def test_the_cover_never_ends_on_a_bare_colon():
    assert _cover("Copperell Refill") == "Copperell Home Ltd: Copperell Refill"
    assert _cover("[Project]") == "Copperell Home Ltd: Refill. Not landfill."   # round 4: "Copperell Home Ltd:" once the placeholder was scrubbed
    assert _cover("") == "Copperell Home Ltd: Refill. Not landfill."
    assert _cover("[Project]", line="Watch one tablet fizz into 500 ml of cleaner in tap water, and the bottle earns its place.") == "Copperell Home Ltd"


def test_the_engine_server_names_the_project_from_the_brief_when_the_prompt_names_none(tmp_path, monkeypatch):
    from deck import server as srv
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_PORT": "0", "NAPKIN_DECK_REPLAY": str(HERE / "fixtures" / "fernley" / "stages")})
    s = srv.Server(cfg)
    d = srv.Doc(cfg.data / "doc", "doc")
    d.folder = cfg.data / "doc" / "k"
    seen = []
    monkeypatch.setattr(srv.run_deck, "main", lambda argv: seen.append(list(argv)) or {})
    base = {"prompt": {"text": "A pitch deck for Copperell Home Ltd.", "client": "Copperell Home Ltd", "project": "", "agency": ""}, "kind": "agency", "format": "pitch"}
    brief = {"project_name": "Copperell Refill", "objectives": "Sell the starter bottle", "mandatories": ["End line: 'Refill. Not landfill.' (word for word)"]}
    req = srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True, "brief_upstream": {"id": "b1", "data": brief}}, cfg)
    s.call_engine(d, req, None)
    assert seen[0][seen[0].index("--project") + 1] == "Copperell Refill"
    named = srv.validate_request({"doc": "doc", "inputs": {**base, "prompt": {**base["prompt"], "project": "Spring push"}}, "mode": "replay", "render": True,
                                  "brief_upstream": {"id": "b1", "data": brief}}, cfg)
    s.call_engine(d, named, None)
    assert seen[1][seen[1].index("--project") + 1] == "Spring push"   # what the person typed wins
    plain = srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True}, cfg)
    s.call_engine(d, plain, None)
    assert seen[2][seen[2].index("--project") + 1] == "[Project]"
