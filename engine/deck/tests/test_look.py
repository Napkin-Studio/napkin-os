"""Offline tests for deck/look.py: the look resolved token by token (deck-look-kits).

Fixtures are invented: a demo brand kit, a demo Style Pack and a demo agency look (Lumen Water is the invented client).
Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests``.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from deck import look, theme
from visuals import style as vstyle

FIX = Path(__file__).parent / "fixtures"
BRAND_TOKENS = {"colours": {"accent": "0B7A75", "paper": "F4FBFA", "ink": "10302E", "panel": "DDF0EE"}, "colour_ids": {"c_teal": "0B7A75", "c_sand": "D9B382"},
                "fonts": {"head": "Brand Serif", "body": "Brand Sans"}, "type_ids": {"t_head": "Brand Serif"},
                "logos": {"dark": "<svg xmlns='http://www.w3.org/2000/svg'><rect width='10' height='10'/></svg>"},
                "imagery_bans": ["stock handshake", "thumbs up"], "kit": {"document_id": "brand-1", "version": 5}}
AGENCY = {"id": "demo-agency", "rev": 4, "accent": "#7A3FF2", "base": "#1E22AA", "accent_ink": "#5A22C8", "accent_use": "line", "surface": "mono"}


def _pack(**deck):
    data = {"pack": {"name": "Demo pack"}, "kit": {"version": 2, "stewards": ["human:demo"]}, "look": ["natural light"]}
    if deck:
        data["deck"] = deck
    st = vstyle.load(data)
    st.document_id = "pack-1"
    return st


def test_with_no_input_the_deck_is_exactly_today():
    got = look.resolve()
    assert got.theme is None and got.brand is None and got.problems == []
    bf = {"colors": {"accent": "#112233"}, "head": "Georgia"}
    same = look.resolve(brand_file=bf)
    assert same.theme is None and same.brand == bf         # a --brand deck keeps its look exactly (Q13)


def test_an_empty_style_pack_and_no_brand_change_no_token_but_are_stamped():
    got = look.resolve(style=_pack())
    assert got.brand is None and got.theme["source"] == "default" and got.theme["style_pack"] == {"document_id": "pack-1", "version": 2, "hash": _pack().hash}
    assert got.theme["colors"] == {f: getattr(theme.NAPKIN, f) for f in theme.COLOR_FIELDS} and set(got.theme["from"].values()) == {"default"}


def test_the_agency_look_dresses_the_deck_automatically():
    got = look.resolve(agency=AGENCY)
    c = got.theme["colors"]
    assert c["accent"] == "7A3FF2" and c["accent_ink"] == "5A22C8" and c["paper"] == "FFFFFF" and c["ink"] == "1E22AA"
    assert got.theme["source"] == "agency_look" and got.theme["agency"] == {"id": "demo-agency", "rev": 4} and got.theme["accent_use"] == "outline"
    assert got.theme["from"]["accent"] == "agency_look" and got.theme["from"]["ink"] == "agency_look" and got.theme["from"]["panel"] == "default"
    assert got.theme["from"]["accent_on_dark"] == "derived" and "accent_on_dark" in got.theme["derived"]
    assert got.brand["colors"]["accent"] == "7A3FF2"


def test_a_deck_can_opt_out_of_the_agency_look():
    got = look.resolve(agency=AGENCY, use_agency=False)
    assert got.theme is None and got.brand is None


def test_an_agency_with_no_look_changes_nothing():
    for none in (None, {}, {"id": "x", "rev": 1}):
        assert look.resolve(agency=none).theme is None


def test_an_agency_base_that_cannot_hold_contrast_is_not_used_as_ink_and_says_so():
    got = look.resolve(agency={"id": "a", "rev": 1, "accent": "7A3FF2", "base": "#FFD400"})
    assert got.theme["colors"]["ink"] == theme.NAPKIN.ink and got.theme["from"]["ink"] == "default"
    assert any("agency look base FFD400 is not used as ink" in p for p in got.problems) and got.theme["problems"] == got.problems


def test_a_bad_agency_colour_is_ignored_with_a_problem():
    got = look.resolve(agency={"id": "a", "rev": 1, "accent": "7A3FF2", "base": "blue"})
    assert got.theme["colors"]["accent"] == "7A3FF2" and any("base" in p and "not a 6-digit" in p for p in got.problems)


def test_a_style_pack_literal_outranks_the_agency_look():
    got = look.resolve(style=_pack(colours={"accent": {"hex": "A8431D"}}, type={"head": {"family": "Georgia", "fallback": ["Cambria", "serif"]}}), agency=AGENCY)
    assert got.theme["colors"]["accent"] == "A8431D" and got.theme["from"]["accent"] == "style_pack" and got.theme["source"] == "style_pack"
    assert got.theme["from"]["accent_ink"] == "agency_look" and got.theme["colors"]["accent_ink"] == "5A22C8"   # token by token, not theme by theme
    assert got.theme["fonts"] == {"head": "Georgia", "body": "Calibri", "fallback": ["Cambria", "serif"]} and got.theme["from"]["head"] == "style_pack"


def test_a_pack_pointer_into_the_agency_look_picks_one_of_its_colours():
    got = look.resolve(style=_pack(colours={"paper": {"agency": "accent"}, "ink": {"agency": "base"}}), agency=AGENCY)
    assert got.theme["colors"]["paper"] == "7A3FF2" and got.theme["colors"]["ink"] == "1E22AA"
    assert got.theme["from"]["paper"] == got.theme["from"]["ink"] == "style_pack"


def test_a_pack_pointer_into_the_brand_with_no_brand_falls_through():
    pack = _pack(colours={"accent": {"brand": "c_teal"}})
    assert look.resolve(style=pack).theme["from"]["accent"] == "default"
    assert look.resolve(style=pack, agency=AGENCY).theme["from"]["accent"] == "agency_look"
    got = look.resolve(style=pack, agency=AGENCY, brand=BRAND_TOKENS)
    assert got.theme["colors"]["accent"] == "0B7A75" and got.theme["from"]["accent"] == "style_pack"     # it picks the brand's own colour


def test_a_client_brand_adds_only_its_logo_and_bans_when_the_deck_wears_the_agency():
    got = look.resolve(brand=BRAND_TOKENS, agency=AGENCY)                      # wears defaults to agency
    assert got.theme["colors"]["accent"] == "7A3FF2" and got.theme["from"]["accent"] == "agency_look"
    assert got.theme["fonts"] == {"head": "Cambria", "body": "Calibri"}
    assert got.imagery_bans == ["stock handshake", "thumbs up"] and got.brand["logo_dark_svg"].startswith("<svg")
    assert "brand_clan" not in set(got.theme["from"].values())


def test_a_client_brand_dresses_the_deck_only_when_it_wears_the_client_or_both():
    for wears in ("client", "co_branded"):
        got = look.resolve(brand=BRAND_TOKENS, agency=AGENCY, style=_pack(colours={"accent": {"hex": "A8431D"}}), wears=wears)
        assert got.theme["source"] == "brand_clan" and got.theme["colors"]["accent"] == "0B7A75" and got.theme["from"]["accent"] == "brand_clan"
        assert got.theme["fonts"]["head"] == "Brand Serif" and got.theme["kit"] == {"document_id": "brand-1", "version": 5}


def test_the_brand_file_stays_in_the_brand_tier_beside_a_client_kit_and_above_the_pack():
    bf = {"colors": {"accent": "#112233", "tint": "#EEEEEE"}, "head": "Georgia"}
    got = look.resolve(brand_file=bf, style=_pack(colours={"accent": {"hex": "A8431D"}, "paper": {"hex": "FFFFFF"}}), agency=AGENCY)
    assert got.theme["colors"]["accent"] == "112233" and got.theme["from"]["accent"] == "brand_file" and got.theme["from"]["paper"] == "style_pack"
    assert got.theme["colors"]["panel"] == "EEEEEE" and got.theme["from"]["head"] == "brand_file" and got.brand["head"] == "Georgia"
    won = look.resolve(brand_file=bf, brand=BRAND_TOKENS, wears="client")
    assert won.theme["colors"]["accent"] == "0B7A75" and won.brand["colors"]["accent"] == "0B7A75" and "tint" not in won.brand["colors"] and won.theme["colors"]["panel"] == "DDF0EE"


def test_strict_brand_ignores_literals_and_the_agency_look_and_lists_what_it_derived():
    pack = _pack(colours={"accent": {"hex": "A8431D"}})
    got = look.resolve(style=pack, agency=AGENCY, strict_brand=True)
    assert got.theme["colors"]["accent"] == theme.NAPKIN.accent and got.theme["from"]["accent"] == "default"
    kit = look.resolve(brand=BRAND_TOKENS, wears="client", strict_brand=True)
    assert kit.theme["colors"]["accent"] == "0B7A75" and kit.theme["derived"] and any(p.startswith("strict_brand: derived") for p in kit.theme["problems"])


def test_a_low_contrast_colour_lands_in_the_problems_and_is_never_fatal():
    got = look.resolve(style=_pack(colours={"accent": {"hex": "FFF3B0"}, "ink": {"hex": "FFF3B0"}}))
    assert got.theme["problems"] and any("ink on paper" in p for p in got.theme["problems"])
    assert got.theme["colors"]["accent_ink"] != "FFF3B0"                              # derived to read as text


def test_classic_stays_classic():
    got = look.resolve(theme="classic", agency=AGENCY)
    assert got.theme["name"] == "classic" and theme.get_theme("classic", got.brand).layouts is False


def test_the_brand_seam_returns_nothing_without_a_brand_clan():
    empty = look.brand_tokens(None)
    assert not any(empty[k] for k in ("colours", "colour_ids", "fonts", "type_ids", "logos", "imagery_bans", "chart", "kit")) and empty["logo_placement"] is None
    assert look.brand_tokens({"visual": {"colours": [{"id": "c1", "role": "accent", "hex": "0B7A75"}]}}) == empty     # a stub until Contract 6 lands
    assert look.resolve(brand=empty, agency=AGENCY, wears="client").theme["from"]["accent"] == "agency_look"
    assert look.resolve(brand=look.brand_tokens(None)).theme is None


def test_every_token_has_a_recorded_winner_and_the_record_matches_the_deck_schema():
    schema = json.loads((Path(__file__).parents[1] / "deck.schema.json").read_text())["properties"]["meta"]["properties"]["theme"]
    got = look.resolve(style=_pack(colours={"accent": {"hex": "A8431D"}}), agency=AGENCY, brand=BRAND_TOKENS, wears="client")
    rec = got.theme
    assert set(rec["from"]) == set(theme.COLOR_FIELDS) | {"head", "body"}
    assert set(rec) <= set(schema["properties"]) and set(schema["required"]) <= set(rec)
    assert rec["source"] in schema["properties"]["source"]["enum"] and all(v in schema["properties"]["from"]["additionalProperties"]["enum"] for v in rec["from"].values())
    assert set(rec["scale"]) <= set(schema["properties"]["scale"]["properties"])


# ------------------------------------------------------------------ through run_deck: the golden is the golden, words never move

BRIEF = FIX / "lumen_water"
BASE_ARGS = ["--brief", str(BRIEF / "brief_object.json"), "--stages", str(BRIEF), "--client", "Lumen Water", "--project", "National awareness campaign"]


def _build(monkeypatch, tmp_path, *extra) -> tuple[dict, dict]:
    from deck import run_deck
    for mod, fn in ((run_deck.render_pptx, "render"), (run_deck.render_web, "render")):
        monkeypatch.setattr(mod, fn, lambda *a, **k: tmp_path / "deck.pptx")
    monkeypatch.setattr(run_deck.subprocess, "run", lambda *a, **k: None)
    monkeypatch.setattr(run_deck, "_soffice", lambda: "soffice")
    out = tmp_path / f"out{len(list(tmp_path.glob('out*')))}"
    run_deck.main([*BASE_ARGS, "--out", str(out), *extra])
    deck = json.loads((out / "deck.json").read_text())
    for k in ("built_at", "built_from", "audience", "confirm", "confirm_summary"):
        deck["meta"].pop(k, None)
    return deck, json.loads((out / "report.json").read_text())


def _golden() -> dict:
    return json.loads((BRIEF / "golden_deck.json").read_text())


def _write(tmp_path, name, obj) -> str:
    p = tmp_path / name
    p.write_text(json.dumps(obj))
    return str(p)


def test_no_look_input_leaves_the_golden_and_the_report_untouched(monkeypatch, tmp_path):
    deck, rep = _build(monkeypatch, tmp_path)
    assert deck == _golden() and "look" not in rep and "style_pack" not in rep


def test_opting_out_or_having_no_agency_look_leaves_the_golden_untouched(monkeypatch, tmp_path):
    deck, _ = _build(monkeypatch, tmp_path, "--agency-look", _write(tmp_path, "ag.json", AGENCY), "--no-agency-look")
    assert deck == _golden()
    deck, _ = _build(monkeypatch, tmp_path, "--agency-look", _write(tmp_path, "none.json", {}))
    assert deck == _golden()


def test_the_words_are_frozen_when_an_agency_look_and_a_style_pack_are_attached(monkeypatch, tmp_path):
    """The Lumen Water golden built with an invented agency look and Style Pack differs from the golden only in meta.theme and meta.brand."""
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "style.yaml").write_text("look: [natural light]\\ndeck:\\n  colours:\\n    accent: {hex: A8431D}\\n".replace("\\n", "\n"))
    deck, rep = _build(monkeypatch, tmp_path, "--agency-look", _write(tmp_path, "ag.json", AGENCY), "--style", str(pack))
    got = {k: v for k, v in deck.items()}
    theme_rec, brand = got["meta"].pop("theme"), got["meta"].pop("brand")
    assert got == _golden()                                          # every word, number, name and legal line is unchanged
    assert theme_rec["colors"]["accent"] == "A8431D" and theme_rec["from"]["accent_ink"] == "agency_look" and brand["colors"]["accent"] == "A8431D"
    assert rep["look"]["source"] == "style_pack" and rep["style_pack"]["used"] is True
    schema = json.loads((Path(__file__).parents[1] / "deck.schema.json").read_text())
    jsonschema = pytest.importorskip("jsonschema")
    jsonschema.validate(theme_rec, {**schema["properties"]["meta"]["properties"]["theme"], "definitions": schema.get("definitions", {})})


def test_a_pack_that_breaks_its_rules_is_not_used_and_the_deck_still_builds(monkeypatch, tmp_path):
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "style.yaml").write_text("look: [a]\nreferences:\n  a.png: {rights: own}\n")
    (pack / "a.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    deck, rep = _build(monkeypatch, tmp_path, "--style", str(pack))
    assert deck == _golden() and rep["style_pack"]["used"] is False and "reason" in rep["style_pack"]["error"]


def test_a_brand_file_alone_is_applied_exactly_as_before(monkeypatch, tmp_path):
    bf = {"name": "Demo", "colors": {"accent": "#112233"}, "head": "Georgia"}
    deck, _ = _build(monkeypatch, tmp_path, "--brand", _write(tmp_path, "brand.json", bf))
    assert deck["meta"].pop("brand") == bf and "theme" not in deck["meta"] and deck == _golden()
