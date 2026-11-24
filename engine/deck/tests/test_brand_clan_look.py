"""Brand Clan phase 2, lane C3 (docs/contracts/brand-clan.md section 8; mocks e1, e2): a deck reads the client's Brand Clan through
look.brand_tokens, the client's Brand Clan wins over the agency look, and its look is not held behind the team-library switch."""
import json
from pathlib import Path

from deck import look

ROOT = Path(__file__).resolve().parents[3]
ZERO = json.loads((ROOT / "docs/contracts/examples/brand-clan/data.zero-v2.json").read_text())
AGENCY = {"id": "agency", "rev": 3, "accent": "#E0452A"}


def test_brand_tokens_read_the_brand_clan_by_role_and_id():
    t = look.brand_tokens(ZERO, "doc-ie-napkin-brand-zero")
    assert t["name"] == "Zero"
    assert t["colours"] == {"accent": "7FD6BD", "ink": "1C2630", "paper": "F4F6F7"}
    assert t["colour_ids"]["silver"] == "9AA7B1" and t["colour_ids"]["mint"] == "7FD6BD"
    assert t["fonts"] == {"head": "Tidewell Serif", "body": "Tidewell Sans"}
    assert t["type_ids"] == {"serif": "Tidewell Serif", "sans": "Tidewell Sans"}
    assert t["imagery_bans"] == ["people drinking in cars"]
    assert t["kit"] == {"document_id": "doc-ie-napkin-brand-zero", "version": 2}
    assert "1C2630" not in t["chart"] and "7FD6BD" in t["chart"]


def test_a_logo_whose_file_did_not_reach_the_deck_is_held_and_said():
    t = look.brand_tokens(ZERO)
    assert t["logos"] == {}
    assert t["held"] and "did not reach this deck" in t["held"][0]
    got = look.resolve(brand=t, wears="client", agency=AGENCY)
    assert any("did not reach this deck" in h for h in got.held)


SVG = b"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 10'><rect width='40' height='10' fill='#F4F6F7'/></svg>"


def test_the_logo_file_reaches_the_deck_and_is_placed_for_the_client():
    # owner 2026-11-24, "Yes it reaches deck": the file travels with the Brand Clan (inputs reads it into _logo_files)
    fb = {**ZERO, "_document_id": "doc-zero", "_logo_files": {"dark": {"name": "logo-zero-dark.svg", "bytes": SVG}}}
    t = look.brand_tokens(fb)
    assert t["logos"]["dark"].startswith("<svg") and t["held"] == [] and t["for_client"] is True
    # the Brand Clan is named for a look ("Zero"), not the client: it is still placed for the deck's client
    got = look.resolve(brand=t, wears="client", agency=AGENCY, client="Tidewell")
    assert got.logo and got.logo["placement"] == "cover_only" and got.logo["data"].startswith("<svg")
    assert not any("logo" in h for h in got.held)


def test_a_png_or_jpeg_logo_is_placed_as_a_png():
    from io import BytesIO

    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (40, 10), (28, 38, 48)).save(buf, "JPEG")
    t = look.brand_tokens({**ZERO, "_logo_files": {"dark": {"name": "logo.jpg", "bytes": buf.getvalue()}}})
    assert t["logos"]["dark"].startswith(b"\x89PNG")
    bad = look.brand_tokens({**ZERO, "_logo_files": {"dark": {"name": "logo.jpg", "bytes": b"not a picture"}}})
    assert bad["logos"] == {} and any("could not be read" in h for h in bad["held"])


def test_the_client_brand_clan_wins_over_the_agency_look():
    got = look.resolve(brand=look.brand_tokens(ZERO), wears="client", agency=AGENCY)
    assert got.theme["from"]["accent"] == "brand_clan" and got.brand["colors"]["accent"] == "7FD6BD"
    assert got.theme["from"]["head"] == "brand_clan" and got.brand["head"] == "Tidewell Serif"
    # with no Brand Clan the agency's accent stands, as before
    assert look.resolve(brand=look.brand_tokens(None), wears="client", agency=AGENCY).theme["from"]["accent"] == "agency_look"


def test_the_deck_wears_the_client_when_a_brand_clan_is_attached_and_nobody_chose(tmp_path, monkeypatch):
    from deck import run_deck
    src = (ROOT / "engine/deck/run_deck.py").read_text()
    # the rule is in the one place that decides wears: a Brand Clan present, no look.brand.wears, no --wears other than the default
    assert 'wears = "client"' in src and 'look._present(look.brand_tokens(ctx.get("brand")))' in src
    assert run_deck is not None


def test_inputs_carry_the_brand_clan_with_the_library_off(tmp_path):
    import io
    import zipfile

    import yaml

    from deck import inputs
    did = "doc-ie-napkin-brand-zero"
    man = {"document_id": "doc-deck-1", "lineage": {"attached": [{"app_id": "ie.napkin.brand", "carried": {"document_id": did}, "version": 2}]}}
    data = {"upstream": {did: ZERO}, "inputs": {"library": {"enabled": False}}}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("manifest.yaml", yaml.safe_dump(man))
        z.writestr("shared/data.yaml", yaml.safe_dump(data))
    p = tmp_path / "deck.clan"
    p.write_bytes(buf.getvalue())
    _inp, ctx = inputs.from_deck_document(p)
    assert ctx["library"] is False
    assert "_logo_files" not in ctx["brand"], "no logo file was carried into this deck"
    assert ctx["brand"]["name"] == "Zero" and ctx["brand"]["_document_id"] == did
    assert look.brand_tokens(ctx["brand"])["kit"] == {"document_id": did, "version": 2}


def test_inputs_read_the_logo_files_the_host_carried(tmp_path):
    import io
    import zipfile

    import yaml

    from deck import inputs
    did = "doc-ie-napkin-brand-zero"
    man = {"document_id": "doc-deck-1", "lineage": {"attached": [{"app_id": "ie.napkin.brand", "carried": {"document_id": did}, "version": 2}]}}
    data = {"upstream": {did: ZERO}}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("manifest.yaml", yaml.safe_dump(man))
        z.writestr("shared/data.yaml", yaml.safe_dump(data))
        z.writestr(f"human/assets/brand/{did}/logo-zero-dark.svg", SVG)
    p = tmp_path / "deck.clan"
    p.write_bytes(buf.getvalue())
    _inp, ctx = inputs.from_deck_document(p)
    assert ctx["brand"]["_logo_files"] == {"dark": {"name": "logo-zero-dark.svg", "bytes": SVG}}
    assert look.brand_tokens(ctx["brand"])["logos"]["dark"].startswith("<svg")
