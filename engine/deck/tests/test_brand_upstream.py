"""Acceptance A60 (Copperell, a fictional brand): Start said the deck wore "Copperell Original · Brand Clan · built with v2", and the PPTX was
navy and Source Sans with no logo. The host sent the middleware only the upstream index, so the engine never saw the Brand Clan. Now the host
carries it beside the index (with its logo files), the middleware forwards it as ``brand_upstream``, the engine server writes it for
``run_deck --brand-upstream``, and the build wears it exactly as the ``--deck`` path does (inputs.brand_clan_copy, look.brand_tokens)."""

from __future__ import annotations

import base64
import io
import json
from argparse import Namespace
from pathlib import Path

import pytest

from deck import run_deck

HERE = Path(__file__).parent
BRAND_ID = "doc-ie-napkin-brand-copperell"


def _png() -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGBA", (480, 120), (217, 154, 43, 255)).save(buf, "PNG")
    return buf.getvalue()


COPPER = {
    "name": "Copperell Original", "kit": {"version": 2},
    "visual": {
        "colours": [{"id": "amber", "name": "Amber", "hex": "#D99A2B", "role": "accent"}, {"id": "charcoal", "name": "Charcoal", "hex": "#2B2A28", "role": "ink"},
                    {"id": "cream", "name": "Cream", "hex": "#F6F1E7", "role": "paper"}],
        "typography": [{"id": "head", "family": "Libre Caslon", "role": "head"}, {"id": "body", "family": "Inter", "role": "body"}],
        "logos": [{"id": "wordmark", "label": "Wordmark", "variant": "dark", "asset": "human/assets/ab12-wordmark.png"}],
    },
}


def carrier(png: bytes | None = None) -> dict:
    return {"id": BRAND_ID, "version": 2, "data": COPPER,
            "logos": {f"human/assets/brand/{BRAND_ID}/ab12-wordmark.png": base64.b64encode(png or _png()).decode()}}


def test_run_deck_reads_the_carried_brand_clan_with_its_logo_and_a_deck_flag_wins(tmp_path):
    f = tmp_path / "brand_upstream.json"
    png = _png()
    f.write_text(json.dumps(carrier(png)))
    ctx = run_deck._brand_upstream(Namespace(brand_upstream=f, deck=None), None)
    assert ctx["brand"]["name"] == "Copperell Original" and ctx["brand"]["_document_id"] == BRAND_ID
    assert ctx["brand"]["_logo_files"] == {"dark": {"name": "ab12-wordmark.png", "bytes": png}}
    assert run_deck._brand_upstream(Namespace(brand_upstream=f, deck=Path("d.clan")), {"x": 1}) == {"x": 1}
    f.write_text(json.dumps({"id": BRAND_ID}))
    with pytest.raises(SystemExit, match="must be a JSON file"):
        run_deck._brand_upstream(Namespace(brand_upstream=f, deck=None), None)


def test_the_engine_server_passes_the_brand_clan_and_refuses_a_bad_one(tmp_path, monkeypatch):
    from deck import server as srv
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_PORT": "0", "NAPKIN_DECK_REPLAY": str(HERE / "fixtures" / "fernley" / "stages")})
    s = srv.Server(cfg)
    d = srv.Doc(cfg.data / "doc", "doc")
    d.folder = cfg.data / "doc" / "k"
    seen = []
    monkeypatch.setattr(srv.run_deck, "main", lambda argv: seen.append(list(argv)) or {})
    base = {"prompt": {"text": "A pitch for Copperell", "client": "Copperell Home", "project": "Refill", "agency": ""}, "kind": "agency", "format": "pitch"}
    req = srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True, "brand_upstream": carrier()}, cfg)
    s.call_engine(d, req, None)
    assert json.loads(Path(seen[0][seen[0].index("--brand-upstream") + 1]).read_text()) == carrier(base64.b64decode(carrier()["logos"][f"human/assets/brand/{BRAND_ID}/ab12-wordmark.png"]))
    s.call_engine(d, srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True}, cfg), None)
    assert "--brand-upstream" not in seen[1]
    for bad in ({"id": BRAND_ID}, {"id": "", "data": {}}, {"id": BRAND_ID, "data": {}, "logos": "x"}, "nope"):
        with pytest.raises(srv.Refused) as e:
            srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True, "brand_upstream": bad}, cfg)
        assert e.value.status == 400


def test_a_build_through_the_middleware_path_wears_the_brand_clan_colours_type_and_logo(tmp_path):
    """The whole engine side of the server path: cached stages (no model, nothing paid), the real pptx renderer."""
    f = tmp_path / "brand_upstream.json"
    f.write_text(json.dumps(carrier()))
    out = tmp_path / "run"
    run_deck.main(["--prompt-text", "Copperell wants a refill launch.", "--stages", str(HERE / "fixtures" / "types" / "agency_pitch"),
                   "--client", "Copperell Home", "--project", "Refill", "--out", str(out), "--no-qa", "--until", "deck",
                   "--brand-upstream", str(f)])
    deck = json.loads((out / "deck.json").read_text())
    theme = deck["meta"]["theme"]
    assert theme["source"] == "brand_clan"
    assert theme["colors"]["accent"] == "D99A2B"
    assert theme["fonts"]["head"] == "Libre Caslon"
    assert theme.get("logo", {}).get("placement") == "cover_only", theme
    rep = json.loads((out / "report.json").read_text())
    assert rep["look"]["source"] == "brand_clan" and not rep["look"]["held"]


def test_a_hand_made_brand_clan_dresses_the_built_deck_by_order(tmp_path):
    """UAT 2026-11-26 (Sólás Lights, a fictional brand): a Brand Clan made by hand (every colour, face and logo role "other") built a deck in
    the default look. The order is the role now: the navy is the deck's ink, the brass its accent, Georgia its headline face, and the logo
    (variant "other") is placed on the cover."""
    solas = {"name": "Original", "kit": {"version": 2}, "visual": {
        "colours": [{"id": "navy", "name": "Night navy", "hex": "#14233F", "role": "other"}, {"id": "brass", "name": "Brass", "hex": "#E0B040", "role": "other"}],
        "typography": [{"id": "georgia", "family": "Georgia", "role": "other"}],
        "logos": [{"id": "solas-logo", "label": "Logo", "variant": "other", "asset": "human/assets/230864de45-solas-logo.png"}]}}
    f = tmp_path / "brand_upstream.json"
    f.write_text(json.dumps({"id": BRAND_ID, "version": 2, "data": solas,
                             "logos": {f"human/assets/brand/{BRAND_ID}/230864de45-solas-logo.png": base64.b64encode(_png()).decode()}}))
    out = tmp_path / "run"
    run_deck.main(["--prompt-text", "Sólás Lights wants a launch.", "--stages", str(HERE / "fixtures" / "types" / "agency_pitch"),
                   "--client", "Sólás Lights", "--project", "Beacon", "--out", str(out), "--no-qa", "--until", "deck",
                   "--brand-upstream", str(f)])
    theme = json.loads((out / "deck.json").read_text())["meta"]["theme"]
    assert theme["source"] == "brand_clan"
    assert theme["colors"]["ink"] == "14233F" and theme["colors"]["accent"] == "E0B040"
    assert theme["fonts"]["head"] == "Georgia"
    assert theme.get("logo", {}).get("placement") == "cover_only", theme
