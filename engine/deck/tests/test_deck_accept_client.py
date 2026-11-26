"""Acceptance A32 (Copperell, a fictional brand): a deck from a brief named no client, so the engine built with '[Client]' and the cover and its
open items showed it although the brief names the client. The engine server takes the brief's client when the prompt names none."""

from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).parent


def test_the_engine_server_names_the_client_from_the_brief_when_the_prompt_names_none(tmp_path, monkeypatch):
    from deck import server as srv
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_PORT": "0", "NAPKIN_DECK_REPLAY": str(HERE / "fixtures" / "fernley" / "stages")})
    s = srv.Server(cfg)
    d = srv.Doc(cfg.data / "doc", "doc")
    d.folder = cfg.data / "doc" / "k"
    seen = []
    monkeypatch.setattr(srv.run_deck, "main", lambda argv: seen.append(list(argv)) or {})
    base = {"prompt": {"text": "A pitch deck.", "client": "", "project": "Copperell Refill", "agency": ""}, "kind": "agency", "format": "pitch"}
    brief = {"client": "To confirm: Copperell Home Ltd, launching Copperell Refill.", "objectives": "Sell the starter bottle"}
    run = lambda inputs, bu=brief: s.call_engine(d, srv.validate_request(   # noqa: E731
        {"doc": "doc", "inputs": inputs, "mode": "replay", "render": True, **({"brief_upstream": {"id": "b1", "data": bu}} if bu else {})}, cfg), None)
    run(base)
    assert seen[-1][seen[-1].index("--client") + 1] == "Copperell Home Ltd"   # A32: '[Client]'
    run({**base, "prompt": {**base["prompt"], "client": "Typed Client"}})
    assert seen[-1][seen[-1].index("--client") + 1] == "Typed Client"   # what the person typed wins
    run(base, bu={"client": {"value": "Copperell Home Ltd"}, "objectives": "x"})
    assert seen[-1][seen[-1].index("--client") + 1] == "Copperell Home Ltd"
    run(base, bu=None)
    assert seen[-1][seen[-1].index("--client") + 1] == "[Client]"   # nothing names one: the placeholder, flagged as an open item, as before
