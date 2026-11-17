"""Offline tests for deck/look.py: the look resolved token by token (deck-look-kits).

Fixtures are invented: a demo brand kit, a demo Style Pack and a demo agency look (Lumen Water is the invented client).
Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests``.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from deck import look, theme
from visuals import style as vstyle

FIX = Path(__file__).parent / "fixtures"
BRAND_TOKENS = {"name": "Lumen Water", "colours": {"accent": "0B7A75", "paper": "F4FBFA", "ink": "10302E", "panel": "DDF0EE"}, "colour_ids": {"c_teal": "0B7A75", "c_sand": "D9B382"},
                "fonts": {"head": "Brand Serif", "body": "Brand Sans"}, "type_ids": {"t_head": "Brand Serif"},
                "logos": {"dark": "<svg xmlns='http://www.w3.org/2000/svg'><rect width='10' height='10'/></svg>"},
                "imagery_bans": ["stock handshake", "thumbs up"], "kit": {"document_id": "brand-1", "version": 5}}
AGENCY = {"id": "demo-agency", "rev": 4, "accent": "#7A3FF2", "base": "#1E22AA", "accent_ink": "#5A22C8", "accent_use": "line", "surface": "mono",
          "wordmark": "data:image/svg+xml,demo"}


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


def test_the_agency_look_dresses_the_deck_with_its_accent_only():
    got = look.resolve(agency=AGENCY)
    c = got.theme["colors"]
    assert c["accent"] == "7A3FF2" and c["accent_ink"] == "5A22C8"
    assert c["ink"] == theme.NAPKIN.ink and c["paper"] == theme.NAPKIN.paper and c["panel"] == theme.NAPKIN.panel   # base and surface are shell chrome
    assert got.theme["source"] == "agency_look" and got.theme["agency"] == {"id": "demo-agency", "rev": 4}
    assert "accent_use" not in got.theme and got.logo is None and "logo" not in got.theme                        # not drawn by any renderer: not stamped; no wordmark
    assert got.theme["from"]["accent"] == "agency_look" and got.theme["from"]["ink"] == "default"
    assert got.theme["from"]["accent_on_dark"] == "derived" and "accent_on_dark" in got.theme["derived"]
    assert got.brand["colors"]["accent"] == "7A3FF2" and "ink" not in got.brand["colors"]


def test_a_deck_can_opt_out_of_the_agency_look():
    got = look.resolve(agency=AGENCY, use_agency=False)
    assert got.theme is None and got.brand is None


def test_an_agency_with_no_look_changes_nothing():
    for none in (None, {}, {"id": "x", "rev": 1}):
        assert look.resolve(agency=none).theme is None


def test_the_agency_base_is_never_read():
    for base in ("#FFD400", "#16181D", "#1E22AA"):
        got = look.resolve(agency={"id": "a", "rev": 1, "accent": "7A3FF2", "base": base})
        assert got.theme["colors"]["ink"] == theme.NAPKIN.ink and got.theme["from"]["ink"] == "default" and got.problems == []


def test_a_bad_agency_colour_is_ignored_with_a_problem():
    got = look.resolve(agency={"id": "a", "rev": 1, "accent": "7A3FF2", "accent_ink": "blue"})
    assert got.theme["colors"]["accent"] == "7A3FF2" and any("accent_ink" in p and "not a 6-digit" in p for p in got.problems)


def test_a_style_pack_literal_outranks_the_agency_look():
    got = look.resolve(style=_pack(colours={"accent": {"hex": "A8431D"}}, type={"head": {"family": "Georgia", "fallback": ["Cambria", "serif"]}}), agency=AGENCY)
    assert got.theme["colors"]["accent"] == "A8431D" and got.theme["from"]["accent"] == "style_pack" and got.theme["source"] == "style_pack"
    assert got.theme["from"]["accent_ink"] == "agency_look" and got.theme["colors"]["accent_ink"] == "5A22C8"   # token by token, not theme by theme
    assert got.theme["fonts"] == {"head": "Georgia", "body": "Calibri", "fallback": ["Cambria", "serif"]} and got.theme["from"]["head"] == "style_pack"


def test_a_pack_pointer_into_the_agency_look_picks_one_of_its_colours():
    got = look.resolve(style=_pack(colours={"accent": {"agency": "accent"}, "ink": {"agency": "base"}}), agency=AGENCY)
    assert got.theme["colors"]["accent"] == "7A3FF2" and got.theme["from"]["accent"] == "style_pack"
    assert got.theme["colors"]["ink"] == theme.NAPKIN.ink and got.theme["from"]["ink"] == "default"      # the base is not the agency's to give


def test_a_pack_pointer_into_the_brand_with_no_brand_falls_through():
    pack = _pack(colours={"accent": {"brand": "c_teal"}})
    assert look.resolve(style=pack).theme["from"]["accent"] == "default"
    assert look.resolve(style=pack, agency=AGENCY).theme["from"]["accent"] == "agency_look"
    got = look.resolve(style=pack, agency=AGENCY, brand=BRAND_TOKENS, wears="client")
    assert got.theme["colors"]["accent"] == "0B7A75" and got.theme["from"]["accent"] == "brand_clan"     # wearing the client, the brand tier gives it


def test_a_brand_pointer_cannot_sidestep_wears_agency():
    """Q1: under wears agency a client kit gives no colour or type, not even through a pack's {brand: id} pointer."""
    pack = _pack(colours={"accent": {"brand": "c_teal"}}, type={"head": {"brand": "t_head"}})
    for wears in ("agency",):
        got = look.resolve(style=pack, agency=AGENCY, brand=BRAND_TOKENS, wears=wears)
        assert got.theme["colors"]["accent"] == "7A3FF2" and got.theme["from"]["accent"] == "agency_look"
        assert got.theme["fonts"]["head"] == "Cambria" and got.theme["from"]["head"] == "default"
    both = look.resolve(style=pack, brand=BRAND_TOKENS, wears="co_branded")
    assert both.theme["fonts"]["head"] == "Brand Serif" and both.theme["from"]["head"] in ("style_pack", "brand_clan")


def test_a_client_brand_adds_only_its_logo_and_bans_when_the_deck_wears_the_agency():
    got = look.resolve(brand=BRAND_TOKENS, agency=AGENCY, client="Lumen Water")  # wears defaults to agency
    assert got.theme["colors"]["accent"] == "7A3FF2" and got.theme["from"]["accent"] == "agency_look"
    assert got.theme["fonts"] == {"head": "Cambria", "body": "Calibri"}
    assert got.imagery_bans == ["stock handshake", "thumbs up"] and got.logo["data"].startswith("<svg") and got.logo["placement"] == "cover_only"
    assert "logo_dark_svg" not in (got.brand or {}) and got.held == []
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


def test_a_low_contrast_colour_is_reset_not_left_to_a_warning():
    got = look.resolve(style=_pack(colours={"accent": {"hex": "FFF3B0"}, "ink": {"hex": "FFF3B0"}}))
    assert got.theme["colors"]["ink"] == theme.NAPKIN.ink and got.theme["from"]["ink"] == "default"
    assert any(p.startswith("ink FFF3B0 (style pack)") and "reset to the default" in p for p in got.theme["problems"])
    assert got.theme["colors"]["accent_ink"] != "FFF3B0"                              # derived to read as text


def test_a_pack_with_a_dark_paper_cannot_make_the_default_ink_unreadable():
    got = look.resolve(style=_pack(colours={"paper": {"hex": "1B2024"}}))
    assert got.theme["colors"]["paper"] == theme.NAPKIN.paper and got.theme["from"]["paper"] == "default"
    assert any("paper 1B2024" in p and "reset to the default" in p for p in got.problems)
    assert not [p for p in got.theme["problems"] if "ink on paper" in p]
    both = look.resolve(style=_pack(colours={"paper": {"hex": "111111"}, "ink": {"hex": "222222"}}))        # a clash inside one pack: both reset
    assert both.theme["colors"]["paper"] == theme.NAPKIN.paper and both.theme["colors"]["ink"] == theme.NAPKIN.ink
    assert both.theme["from"]["paper"] == both.theme["from"]["ink"] == "default"
    own = look.resolve(brand_file={"colors": {"paper": "#111111", "ink": "#222222"}})                        # a brand's own palette is left as it is
    assert own.theme is None


def test_a_lower_tier_loses_to_a_brand_file_token_it_cannot_be_read_against():
    got = look.resolve(brand_file={"colors": {"paper": "#10141A"}}, style=_pack(colours={"ink": {"hex": "20262E"}}))
    assert got.theme["colors"]["paper"] == "10141A" and got.theme["colors"]["ink"] == theme.NAPKIN.ink and got.theme["from"]["ink"] == "default"


def test_a_pale_accent_is_a_fill_only_and_lines_take_the_default_accent():
    pale = look.resolve(agency={"id": "a", "rev": 1, "accent": "#FFD6DD"})
    assert pale.theme["colors"]["accent"] == "FFD6DD" and pale.theme["accent_line"] == theme.NAPKIN.accent
    assert pale.brand["colors"]["accent_line"] == theme.NAPKIN.accent and any("fills only" in p for p in pale.problems)
    assert theme.get_theme("napkin", pale.brand).line_accent == theme.NAPKIN.accent and theme.get_theme("napkin", pale.brand).accent == "FFD6DD"
    strong = look.resolve(agency={"id": "a", "rev": 1, "accent": "#7A3FF2"})
    assert "accent_line" not in strong.theme and theme.get_theme("napkin", strong.brand).line_accent == "7A3FF2"


def test_the_client_logo_is_placed_only_when_the_kit_is_for_the_briefs_client():
    for client in ("Lumen Water", "LUMEN  water.", "L\u00fcmen Water"):
        got = look.resolve(brand=BRAND_TOKENS, client=client)
        assert got.logo and got.logo["name"] == "Lumen Water" and got.held == [], client
    for client in ("Harbour County Council", "", "Lumenara Foods", "Lumen Water Ltd", "Lumen", "Water"):
        got = look.resolve(brand=BRAND_TOKENS, client=client)
        assert got.logo is None and len(got.held) == 1 and "held" in got.held[0] and got.theme["held"] == got.held, client
    nameless = look.resolve(brand={**BRAND_TOKENS, "name": ""}, client="Lumen Water")
    assert nameless.logo is None and "unnamed brand" in nameless.held[0]


def test_nothing_in_a_look_is_dropped_silently_when_only_a_logo_is_given():
    got = look.resolve(brand={**BRAND_TOKENS, "colours": {}, "fonts": {}, "colour_ids": {}, "type_ids": {}, "imagery_bans": []}, client="Lumen Water")
    assert got.theme is not None and got.logo and got.brand is None


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
    assert "held" in schema["properties"] and "accent_line" in schema["properties"] and "accent_use" in schema["properties"]
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
    assert deck["meta"].pop("preferences") == {"agency_look": {"use": False, "source": "person"}} and deck == _golden()   # the opt-out is stamped, nothing else moves
    deck, _ = _build(monkeypatch, tmp_path, "--agency-look", _write(tmp_path, "none.json", {}))
    assert deck == _golden()


def test_the_words_are_frozen_when_an_agency_look_and_a_style_pack_are_attached(monkeypatch, tmp_path):
    """The Lumen Water golden built with an invented agency look and Style Pack differs from the golden only in meta.theme, meta.brand and meta.preferences."""
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "style.yaml").write_text("look: [natural light]\ndeck:\n  colours:\n    accent: {hex: A8431D}\n".replace("\\n", "\n"))
    deck, rep = _build(monkeypatch, tmp_path, "--agency-look", _write(tmp_path, "ag.json", AGENCY), "--style", str(pack))
    got = {k: v for k, v in deck.items()}
    theme_rec, brand = got["meta"].pop("theme"), got["meta"].pop("brand")
    assert got["meta"].pop("preferences") == {"agency_look": {"use": True, "source": "default"}}
    assert got == _golden()                                          # every word, number, name and legal line is unchanged
    assert theme_rec["colors"]["accent"] == "A8431D" and theme_rec["from"]["accent_ink"] == "agency_look" and brand["colors"]["accent"] == "A8431D"
    assert rep["look"]["source"] == "style_pack" and rep["style_pack"]["used"] is True
    schema = json.loads((Path(__file__).parents[1] / "deck.schema.json").read_text())
    jsonschema = pytest.importorskip("jsonschema")
    jsonschema.validate(theme_rec, {**schema["properties"]["meta"]["properties"]["theme"], "definitions": schema.get("definitions", {})})


def test_a_pack_that_breaks_its_rules_is_held_loudly_and_the_deck_still_builds(monkeypatch, tmp_path):
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "style.yaml").write_text("look: [a]\nreferences:\n  a.png: {rights: own}\n".replace("\\n", "\n"))
    (pack / "a.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    deck, rep = _build(monkeypatch, tmp_path, "--style", str(pack))
    hold = deck["meta"].pop("style_hold")                            # slices 3 and 6 read this: no pictures are made until the pack is fixed
    assert deck == _golden() and "reason" in hold["reason"] and hold["pack"] == "pack"
    assert rep["style_pack"]["used"] is False and rep["style_pack"]["hold"] is True and "reason" in rep["style_pack"]["error"]


def test_a_pack_that_names_the_client_is_held_not_used(monkeypatch, tmp_path):
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "style.yaml").write_text("look: [natural light]\nnotes: Made for Lumen Water\n".replace("\\n", "\n"))
    deck, rep = _build(monkeypatch, tmp_path, "--style", str(pack))
    assert "Lumen Water" in deck["meta"]["style_hold"]["reason"] and rep["style_pack"]["hold"] is True


def test_a_pack_that_cannot_be_read_is_held_too(monkeypatch, tmp_path):
    deck, rep = _build(monkeypatch, tmp_path, "--style", str(tmp_path / "missing"))
    assert deck["meta"]["style_hold"]["reason"].startswith("style folder not found") and rep["style_pack"]["hold"] is True


def test_a_brand_file_alone_is_applied_exactly_as_before(monkeypatch, tmp_path):
    bf = {"name": "Demo", "colors": {"accent": "#112233"}, "head": "Georgia"}
    deck, _ = _build(monkeypatch, tmp_path, "--brand", _write(tmp_path, "brand.json", bf))
    assert deck["meta"].pop("brand") == bf and "theme" not in deck["meta"] and deck == _golden()


# ------------------------------------------------------------------ replay: a deck keeps the look it was built with

def _build_in(monkeypatch, tmp_path, out, *extra, base=BASE_ARGS, real=False):
    from deck import run_deck
    if not real:
        for mod, fn in ((run_deck.render_pptx, "render"), (run_deck.render_web, "render")):
            monkeypatch.setattr(mod, fn, lambda *a, **k: tmp_path / "deck.pptx")
    real_run = run_deck.subprocess.run   # LibreOffice and pdftoppm are stubbed; the SVG rasteriser is the real one
    monkeypatch.setattr(run_deck.subprocess, "run", lambda cmd, *a, **k: real_run(cmd, *a, **k) if str(cmd[0]).endswith("rsvg-convert") else None)
    monkeypatch.setattr(run_deck, "_soffice", lambda: "soffice")
    run_deck.main([*base, "--out", str(out), "--no-qa", *extra])
    return json.loads((out / "deck.json").read_text()), json.loads((out / "report.json").read_text())


def test_the_agency_look_is_copied_into_the_run_folder_and_replayed_byte_for_byte(monkeypatch, tmp_path):
    out = tmp_path / "run"
    first, _ = _build_in(monkeypatch, tmp_path, out, "--agency-look", _write(tmp_path, "ag.json", AGENCY))
    assert json.loads((out / "look.json").read_text())["agency"] == AGENCY
    changed = {**AGENCY, "rev": 5, "accent": "#D6336C", "accent_ink": "#A61E4D"}
    again, rep = _build_in(monkeypatch, tmp_path, out, "--agency-look", _write(tmp_path, "ag2.json", changed))
    for d in (first, again):
        d["meta"].pop("built_at")
    assert again == first and again["meta"]["theme"]["colors"]["accent"] == "7A3FF2"          # not re-read: the recorded look is replayed
    assert "rev 4 to 5" in rep["look"]["notice"] and "update to current look" in rep["look"]["notice"]
    bare, _ = _build_in(monkeypatch, tmp_path, out)                                            # even with no flag at all
    bare["meta"].pop("built_at")
    assert bare == first


def test_update_to_current_look_takes_the_new_look_and_records_it(monkeypatch, tmp_path):
    out = tmp_path / "run"
    _build_in(monkeypatch, tmp_path, out, "--agency-look", _write(tmp_path, "ag.json", AGENCY))
    changed = {**AGENCY, "rev": 5, "accent": "#D6336C", "accent_ink": "#A61E4D"}
    deck, rep = _build_in(monkeypatch, tmp_path, out, "--agency-look", _write(tmp_path, "ag2.json", changed), "--update-look")
    assert deck["meta"]["theme"]["colors"]["accent"] == "D6336C" and deck["meta"]["theme"]["agency"]["rev"] == 5 and "notice" not in rep["look"]
    assert json.loads((out / "look.json").read_text())["agency"]["rev"] == 5


def test_an_existing_deck_keeps_its_look_and_is_offered_the_update(monkeypatch, tmp_path):
    out = tmp_path / "old"
    old, _ = _build_in(monkeypatch, tmp_path, out)                                             # built before the agency had a look
    assert "theme" not in old["meta"] and not (out / "look.json").exists()
    rebuilt, rep = _build_in(monkeypatch, tmp_path, out, "--agency-look", _write(tmp_path, "ag.json", AGENCY))
    assert "theme" not in rebuilt["meta"] and "update to current look" in rep["look"]["notice"] and not (out / "look.json").exists()
    taken, _ = _build_in(monkeypatch, tmp_path, out, "--agency-look", _write(tmp_path, "ag.json", AGENCY), "--update-look")
    assert taken["meta"]["theme"]["colors"]["accent"] == "7A3FF2" and (out / "look.json").exists()


def test_opting_out_does_not_forget_the_recorded_look(monkeypatch, tmp_path):
    out = tmp_path / "run"
    _build_in(monkeypatch, tmp_path, out, "--agency-look", _write(tmp_path, "ag.json", AGENCY))
    off, _ = _build_in(monkeypatch, tmp_path, out, "--no-agency-look")
    assert "theme" not in off["meta"] and off["meta"]["preferences"]["agency_look"]["use"] is False
    on, _ = _build_in(monkeypatch, tmp_path, out)
    assert on["meta"]["theme"]["colors"]["accent"] == "7A3FF2"


# ------------------------------------------------------------------ the client's logo: one path, into the pptx

def _png(path_or_none=None, size=(120, 40), colour=(11, 122, 117)) -> bytes:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", size, colour).save(buf, "PNG")
    return buf.getvalue()


KIT_LOGO = {**BRAND_TOKENS, "colours": {}, "fonts": {}, "colour_ids": {}, "type_ids": {}, "imagery_bans": []}   # a kit with a logo and no other token


def _pptx_logo(path: Path):
    from pptx import Presentation
    first = Presentation(str(path)).slides[0]
    return [sh for sh in first.shapes if sh.name == "Logo"]


def test_a_deck_wearing_the_agency_brand_with_a_kit_and_no_other_token_gets_the_logo_in_the_pptx(monkeypatch, tmp_path):
    monkeypatch.setattr(look, "brand_tokens", lambda frozen=None: {**KIT_LOGO, "logos": {"dark": _png()}})
    out = tmp_path / "run"
    deck, rep = _build_in(monkeypatch, tmp_path, out, real=True)
    th = deck["meta"]["theme"]
    assert th["logo"]["placement"] == "cover_only" and th["source"] == "default" and "held" not in th
    rec = deck["assets"][th["logo"]["asset"]]
    assert rec["rights"] == "client_supplied" and (out / rec["file"]).is_file() and rec["file"] == f"assets/{rec['sha256']}.png"
    assert len(_pptx_logo(out / "deck.pptx")) == 1                                              # the logo is on the cover
    assert f'alt="Lumen Water logo"' in (out / "deck.html").read_text() and "data:image/png;base64," in (out / "deck.html").read_text()
    assert rep["look"]["held"] == []


@pytest.mark.skipif(not __import__("shutil").which("rsvg-convert"), reason="no SVG rasteriser on this machine")
def test_an_svg_logo_is_sanitised_and_rasterised_for_the_pptx(monkeypatch, tmp_path):
    svg = "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='40'><rect width='120' height='40' fill='#0B7A75'/></svg>"
    monkeypatch.setattr(look, "brand_tokens", lambda frozen=None: {**KIT_LOGO, "logos": {"dark": svg}})
    out = tmp_path / "run"
    deck, _ = _build_in(monkeypatch, tmp_path, out, real=True)
    assert deck["assets"][deck["meta"]["theme"]["logo"]["asset"]]["mime"] == "image/png" and len(_pptx_logo(out / "deck.pptx")) == 1


def test_a_logo_for_another_brand_is_held_with_a_note_and_not_placed(monkeypatch, tmp_path):
    monkeypatch.setattr(look, "brand_tokens", lambda frozen=None: {**KIT_LOGO, "name": "Harbour County", "logos": {"dark": _png()}})
    out = tmp_path / "run"
    deck, rep = _build_in(monkeypatch, tmp_path, out, real=True)
    th = deck["meta"]["theme"]
    assert "logo" not in th and "assets" not in deck and len(th["held"]) == 1 and "Harbour County" in th["held"][0]
    assert rep["look"]["held"] == th["held"] and _pptx_logo(out / "deck.pptx") == []


def test_a_logo_that_cannot_be_made_safe_is_held_not_dropped_silently(monkeypatch, tmp_path):
    for bad in ("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
                "<svg xmlns='http://www.w3.org/2000/svg'><rect onload='x()' width='1' height='1'/></svg>",
                "<svg xmlns='http://www.w3.org/2000/svg'><image href='http://example.com/a.png'/></svg>",
                "<!DOCTYPE svg [<!ENTITY x 'y'>]><svg xmlns='http://www.w3.org/2000/svg'/>", "<svg"):
        with pytest.raises(look.LogoError):
            look.sanitise_svg(bad)
    monkeypatch.setattr(look, "brand_tokens", lambda frozen=None: {**KIT_LOGO, "logos": {"dark": "<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"}})
    deck, rep = _build_in(monkeypatch, tmp_path, tmp_path / "run")
    th = deck["meta"]["theme"]
    assert "logo" not in th and th["held"][0].startswith("The client's logo could not be placed") and rep["look"]["held"] == th["held"]


def test_a_logo_with_a_placement_of_none_is_not_drawn(monkeypatch, tmp_path):
    monkeypatch.setattr(look, "brand_tokens", lambda frozen=None: {**KIT_LOGO, "logos": {"dark": _png()}, "logo_placement": "none"})
    out = tmp_path / "run"
    deck, _ = _build_in(monkeypatch, tmp_path, out, real=True)
    assert deck["meta"]["theme"]["logo"]["placement"] == "none" and _pptx_logo(out / "deck.pptx") == []


# ------------------------------------------------------------------ the runner's path: a Deck document with kits attached

def _deck_clan(path: Path, *, brand_version=5, library=True, look=None) -> Path:
    """A Deck document (.clan) the way the host leaves it after attaching research, a Brand Clan and a Style Pack: the kits frozen under
    upstream, the pins of the research and of the brand merged into one facts file, and lineage.attached naming each app."""
    import zipfile
    import yaml
    from visuals import style as vstyle
    pack = {"pack": {"name": "Demo pack"}, "kit": {"version": 2, "stewards": ["human:demo"], "published": {"by": "human:demo", "at": "2026-11-17T10:00:00Z"}}, "look": ["natural light"],
            "deck": {"colours": {"accent": {"hex": "A8431D"}}}}
    facts = [{"id": "f_1", "entity": "Lumen Water", "key": "customers", "value": 1200, "unit": "count", "confidence": "high"},
             {"id": "f_brand1", "entity": "Lumen", "key": "brand.market_share", "value": 0.61, "unit": "proportion", "confidence": "high",
              "ref": "fact://brand/lumen/market_share@1"}]
    data = {"upstream": {"res-1": {"campaign": {"name": "Lumen"}},
                         "brand-1": {"kit": {"version": brand_version}, "brand": {"name": "Lumen Water"}, "visual": {"colours": []}},
                         "pack-1": pack},
            "inputs": {"prompt": {"client": "Lumen Water", "project": "Awareness", "text": "Lumen Water wants a summer campaign."},
                       "library": {"enabled": library}},
            "look": look or {}}
    attached = [{"app_id": "ie.napkin.campaign-research", "carried": {"document_id": "res-1"}},
                {"app_id": "ie.napkin.brand", "carried": {"document_id": "brand-1"}},
                {"app_id": "ie.napkin.style-pack", "carried": {"document_id": "pack-1"}}]
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("manifest.yaml", yaml.safe_dump({"document_id": "deck-1", "app": {"app_id": "ie.napkin.deck-maker"}, "lineage": {"attached": attached}}))
        z.writestr("shared/data.yaml", yaml.safe_dump(data))
        z.writestr("shared/facts.yaml", yaml.safe_dump({"facts": facts}))
    assert vstyle.load(pack).hash
    return path


PROMPT_ARGS = ["--prompt-text", "Lumen Water wants a summer campaign.", "--stages", str(FIX / "types" / "agency_pitch"), "--client", "Lumen Water", "--project", "Awareness"]


def test_the_runner_path_never_reads_a_kit_as_research_and_drops_the_brand_pins(monkeypatch, tmp_path):
    """The fix, through run_deck --deck (the path a server runner takes): kits are classified by lineage.attached, and a brand pin never reaches the facts."""
    doc = _deck_clan(tmp_path / "deck.clan")
    deck, rep = _build_in(monkeypatch, tmp_path, tmp_path / "run", "--deck", str(doc), base=PROMPT_ARGS)
    cov = rep["coverage"]
    assert cov["kits_ignored"] == ["brand-1", "pack-1"] and cov["kit_pins_dropped"] == ["f_brand1"] and cov["facts"] == 1
    assert deck["meta"]["research_doc_id"] == "res-1"
    slides = json.dumps(deck["slides"])                                     # the coverage names the dropped pin; no slide carries it or its figure
    assert "0.61" not in slides and "f_brand1" not in slides and "market_share" not in slides
    assert deck["meta"]["theme"]["colors"]["accent"] == "A8431D" and rep["style_pack"]["used"] is True      # the attached pack's deck colour, once the library is on


def test_an_update_of_the_brand_kit_is_reapplied_by_construction(monkeypatch, tmp_path):
    for n, version in enumerate((5, 6)):
        doc = _deck_clan(tmp_path / f"deck{n}.clan", brand_version=version)
        _, rep = _build_in(monkeypatch, tmp_path, tmp_path / f"run{n}", "--deck", str(doc), base=PROMPT_ARGS)
        assert rep["coverage"]["kit_pins_dropped"] == ["f_brand1"] and rep["coverage"]["kits_ignored"] == ["brand-1", "pack-1"]


def test_with_the_library_off_the_pack_is_ignored_but_the_brand_pins_are_still_dropped(monkeypatch, tmp_path):
    doc = _deck_clan(tmp_path / "deck.clan", library=False)
    deck, rep = _build_in(monkeypatch, tmp_path, tmp_path / "run", "--deck", str(doc), base=PROMPT_ARGS)
    assert rep["coverage"]["kit_pins_dropped"] == ["f_brand1"] and rep["coverage"]["kits_gated_off"] is True
    assert "theme" not in deck["meta"] and "style_pack" not in rep


def test_the_runner_path_reads_the_look_preferences_of_the_document(monkeypatch, tmp_path):
    doc = _deck_clan(tmp_path / "deck.clan", look={"agency_look": {"use": False, "by": "human:demo"}})
    deck, _ = _build_in(monkeypatch, tmp_path, tmp_path / "run", "--deck", str(doc), "--agency-look", _write(tmp_path, "ag.json", AGENCY), base=PROMPT_ARGS)
    assert deck["meta"]["preferences"]["agency_look"] == {"use": False, "source": "person"} and deck["meta"]["theme"]["from"]["accent"] == "style_pack"
    doc2 = _deck_clan(tmp_path / "deck2.clan", look={"agency_look": {"use": True}})
    deck2, _ = _build_in(monkeypatch, tmp_path, tmp_path / "run2", "--deck", str(doc2), "--agency-look", _write(tmp_path, "ag.json", AGENCY), base=PROMPT_ARGS)
    assert deck2["meta"]["theme"]["from"]["accent_ink"] == "agency_look"


# ------------------------------------------------------------------ every agency in the registry, on Lumen

def _registry() -> list:
    """The agencies in the app's registry (app/src/shell/agency/palette.ts AGENCY_COLOURS), as the agency-look JSON the runner passes."""
    text = (Path(__file__).parents[3] / "app" / "src" / "shell" / "agency" / "palette.ts").read_text()
    block = text[text.index("AGENCY_COLOURS: Readonly"):text.index("export const AGENCY_ALIASES")]
    parts = re.split(r"\n  (\w+): \{", block)
    out = []
    for i in range(1, len(parts), 2):
        body = parts[i + 1]
        m = re.search(r"base: '(#\w{6})', accent: '(#\w{6})'", body)
        ink = re.search(r"accentInk: '(#\w{6})'", body)
        if m:
            out.append({"id": parts[i], "rev": 1, "base": m.group(1), "accent": m.group(2), **({"accent_ink": ink.group(1)} if ink else {}),
                        **({"accent_use": "line"} if "accentUse: 'line'" in body else {}), **({"surface": "mono"} if "surface: 'mono'" in body else {})})
    return out


def test_the_registry_has_every_agency_the_sweep_runs():
    ids = {a["id"] for a in _registry()}
    assert {"wk", "ogilvy", "boysandgirls", "pluto"} <= ids and len(ids) >= 9


@pytest.mark.parametrize("ag", _registry(), ids=lambda a: a["id"])
def test_no_agency_look_makes_a_token_pair_worse_than_the_default(ag):
    default = theme.NAPKIN
    got = look.resolve(agency=ag)
    t = theme.get_theme("napkin", got.brand)
    assert got.theme["colors"]["ink"] == default.ink and got.theme["colors"]["paper"] == default.paper and got.theme["colors"]["panel"] == default.panel   # base is chrome
    assert theme.check_palette(t) == theme.check_palette(default) == []                                         # no new contrast problem
    for fg, bg in (("ink", "paper"), ("ink", "panel"), ("mute", "paper"), ("accent_ink", "paper"), ("accent_ink", "panel"), ("on_dark", "ink"),
                   ("on_dark_mute", "ink"), ("accent_on_dark", "ink")):
        assert theme.contrast(getattr(t, fg), getattr(t, bg)) >= min(theme.contrast(getattr(default, fg), getattr(default, bg)), theme.AA), (fg, bg)
    assert theme.contrast(t.line_accent, t.paper) >= look.LINE_MIN                                              # lines, rules and chart series always read
    assert (t.accent_line != "") == (theme.contrast(t.accent, t.paper) < look.LINE_MIN)
    assert "accent_use" not in got.theme and got.logo is None


def test_pale_accents_are_fills_only():
    pale = {a["id"] for a in _registry() if theme.contrast(a["accent"].lstrip("#"), theme.NAPKIN.paper) < look.LINE_MIN}
    assert {"wk", "ogilvy", "boysandgirls"} <= pale
    for ag in _registry():
        got = look.resolve(agency=ag)
        assert ("accent_line" in got.theme) == (ag["id"] in pale), ag["id"]


@pytest.mark.skipif(not (__import__("shutil").which("soffice") or Path("/Applications/LibreOffice.app").exists()) or not __import__("shutil").which("pdftoppm"),
                    reason="no LibreOffice or pdftoppm: the rendered-slide QA cannot run")
def test_every_agency_look_on_lumen_adds_no_qa_finding(tmp_path):
    """The real pipeline (pptx, PDF, rendered-slide QA) on the Lumen golden, once per registry agency: no QA error or warning the default theme does not have."""
    import os
    import subprocess
    import sys
    env = {**os.environ, "BRIEF_TESTS_OFFLINE": "1", "PYTHONPATH": str(Path(__file__).parents[2])}
    def run(out, *extra):
        r = subprocess.run([sys.executable, "-m", "deck.run_deck", "--stages", str(BRIEF), "--brief", str(BRIEF / "brief_object.json"), "--client", "Lumen Water",
                            "--project", "National awareness campaign", "--out", str(out), *extra], cwd=Path(__file__).parents[2], env=env, capture_output=True, text=True)
        assert r.returncode == 0, r.stderr[-500:]
        return json.loads((out / "report.json").read_text())["qa"]
    base = run(tmp_path / "base")
    assert base.startswith("QA: 0 errors, 0 warnings")
    for ag in _registry():
        line = run(tmp_path / ag["id"], "--agency-look", _write(tmp_path, ag["id"] + ".json", ag))
        assert line.startswith("QA: 0 errors, 0 warnings"), (ag["id"], line)


# ------------------------------------------------------------------ the adversarial check: names, wears, replay, packs

@pytest.mark.parametrize("brand,client", [("Delta", "Delta Faucet"), ("Group Nine", "Nine Network"), ("\u00dcnilever", "Nilever"), ("Lumen", "Lumen Water Ltd"),
                                         ("Water", "Lumen Water")])
def test_the_logo_gate_needs_the_same_words_and_a_prefix_or_a_stripped_word_does_not_pass(brand, client):
    assert look.same_name(brand, client) is False and look.same_name(client, brand) is False
    got = look.resolve(brand={**BRAND_TOKENS, "name": brand}, client=client)
    assert got.logo is None and len(got.held) == 1


def test_the_logo_gate_folds_accents_and_case_only():
    assert look.same_name("Nestl\u00e9", "NESTLE") and look.same_name("Lumen-Water", "lumen water") and not look.same_name("", "")


def test_a_stale_update_request_does_not_reread_the_agency_look_on_every_build(monkeypatch, tmp_path):
    """update_requested is a timestamp kept in the document: it counts only while newer than the look last applied (look.json applied_at)."""
    out = tmp_path / "run"
    doc = {"agency_look": {"update_requested": "2026-01-01T00:00:00Z"}}
    first, _ = _build_in(monkeypatch, tmp_path, out, "--deck", str(_deck_clan(tmp_path / "d.clan", look=doc)), "--agency-look", _write(tmp_path, "a1.json", AGENCY), base=PROMPT_ARGS)
    assert first["meta"]["theme"]["colors"]["accent_ink"] == "5A22C8" and json.loads((out / "look.json").read_text())["applied_at"] > "2026-01-01"
    moved = {**AGENCY, "rev": 9, "accent": "#D6336C", "accent_ink": "#A61E4D"}
    for n in range(2):                                                                        # the same stale request, build after build
        again, rep = _build_in(monkeypatch, tmp_path, out, "--deck", str(_deck_clan(tmp_path / "d.clan", look=doc)), "--agency-look", _write(tmp_path, "a2.json", moved), base=PROMPT_ARGS)
        assert again["meta"]["theme"]["colors"]["accent_ink"] == "5A22C8" and "rev 4 to 9" in rep["look"]["notice"], n
    import datetime
    applied = datetime.datetime.strptime(json.loads((out / "look.json").read_text())["applied_at"], "%Y-%m-%dT%H:%M:%S.%fZ")
    fresh = {"agency_look": {"update_requested": (applied + datetime.timedelta(microseconds=1)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")}}   # a new request, newer than the last apply, is taken
    taken, _ = _build_in(monkeypatch, tmp_path, out, "--deck", str(_deck_clan(tmp_path / "d.clan", look=fresh)), "--agency-look", _write(tmp_path, "a2.json", moved), base=PROMPT_ARGS)
    assert taken["meta"]["theme"]["colors"]["accent_ink"] == "A61E4D"
    later, _ = _build_in(monkeypatch, tmp_path, out, "--deck", str(_deck_clan(tmp_path / "d.clan", look=fresh)), "--agency-look", _write(tmp_path, "a1.json", AGENCY), base=PROMPT_ARGS)
    assert later["meta"]["theme"]["colors"]["accent_ink"] == "A61E4D"                         # that request is now older than the apply: not re-read


def test_a_recorded_look_made_before_applied_at_still_replays(monkeypatch, tmp_path):
    out = tmp_path / "run"
    out.mkdir()
    (out / "look.json").write_text(json.dumps(AGENCY))
    deck, _ = _build_in(monkeypatch, tmp_path, out, "--agency-look", _write(tmp_path, "a2.json", {**AGENCY, "rev": 7, "accent": "#D6336C"}))
    assert deck["meta"]["theme"]["colors"]["accent"] == "7A3FF2"


def test_an_unknown_wears_never_crashes_a_build(monkeypatch, tmp_path):
    doc = _deck_clan(tmp_path / "deck.clan", look={"brand": {"wears": "everyone"}})
    deck, rep = _build_in(monkeypatch, tmp_path, tmp_path / "run", "--deck", str(doc), "--agency-look", _write(tmp_path, "ag.json", AGENCY), base=PROMPT_ARGS)
    assert any("'everyone'" in p and "wears the agency" in p for p in rep["look"]["problems"]) and deck["meta"]["theme"]["colors"]["accent"] == "A8431D"


def test_an_attached_pack_that_is_not_published_is_refused_and_held(monkeypatch, tmp_path):
    import zipfile
    import yaml
    doc = _deck_clan(tmp_path / "deck.clan")
    with zipfile.ZipFile(doc) as z:
        files = {n: z.read(n) for n in z.namelist()}
    data = yaml.safe_load(files["shared/data.yaml"])
    del data["upstream"]["pack-1"]["kit"]["published"]
    files["shared/data.yaml"] = yaml.safe_dump(data).encode()
    with zipfile.ZipFile(tmp_path / "draft.clan", "w") as z:
        for n, b in files.items():
            z.writestr(n, b)
    deck, rep = _build_in(monkeypatch, tmp_path, tmp_path / "run", "--deck", str(tmp_path / "draft.clan"), base=PROMPT_ARGS)
    assert "not published" in deck["meta"]["style_hold"]["reason"] and rep["style_pack"]["hold"] is True and "theme" not in deck["meta"]


def test_a_rasteriser_that_times_out_holds_the_logo(monkeypatch):
    import subprocess
    monkeypatch.setattr(look.shutil if hasattr(look, "shutil") else __import__("shutil"), "which", lambda n: "/bin/true")
    def boom(*a, **k):
        raise subprocess.TimeoutExpired("rsvg-convert", 60)
    monkeypatch.setattr(subprocess, "run", boom)
    with pytest.raises(look.LogoError, match="too long"):
        look.rasterise_svg("<svg xmlns='http://www.w3.org/2000/svg'/>")


def _minimal_brand(frozen: dict | None) -> dict:
    """A minimal Brand Clan fixture mapper in place of the stub: Contract 6's shape, trimmed to what the deck reads."""
    if not frozen:
        return look.brand_tokens(None)
    cols = {c["role"]: c["hex"] for c in frozen["visual"]["colours"]}
    return {"name": frozen["brand"]["name"], "colours": {"accent": cols["accent"], "paper": cols["background"]}, "colour_ids": {c["id"]: c["hex"] for c in frozen["visual"]["colours"]},
            "fonts": {"head": frozen["visual"]["typography"]["heading"]}, "type_ids": {}, "logos": {"dark": _png()}, "logo_placement": "cover_only",
            "imagery_bans": [d for d in frozen["visual"]["imagery"]["dont"]], "chart": [], "kit": {"document_id": "brand-1", "version": frozen["kit"]["version"]}}


def _brand_deck(tmp_path, name="Lumen Water", wears=None):
    import zipfile
    import yaml
    doc = _deck_clan(tmp_path / f"brand-{name.replace(' ', '')}-{wears}.clan", look={"brand": {"wears": wears}} if wears else {})
    with zipfile.ZipFile(doc) as z:
        files = {n: z.read(n) for n in z.namelist()}
    data = yaml.safe_load(files["shared/data.yaml"])
    data["upstream"]["brand-1"] = {"kit": {"version": 5}, "brand": {"name": name},
                                   "visual": {"colours": [{"id": "c_teal", "role": "accent", "hex": "0B7A75"}, {"id": "c_bg", "role": "background", "hex": "F4FBFA"}],
                                              "typography": {"heading": "Brand Serif"}, "imagery": {"dont": ["stock handshake"]}}}
    del data["upstream"]["pack-1"]
    files["shared/data.yaml"] = yaml.safe_dump(data).encode()
    attached = yaml.safe_load(files["manifest.yaml"])
    attached["lineage"]["attached"] = [a for a in attached["lineage"]["attached"] if a["app_id"] != "ie.napkin.style-pack"]
    files["manifest.yaml"] = yaml.safe_dump(attached).encode()
    out = tmp_path / f"b-{name.replace(' ', '')}-{wears}.clan"
    with zipfile.ZipFile(out, "w") as z:
        for n, b in files.items():
            z.writestr(n, b)
    return out


def test_runner_path_wears_agency_takes_the_clients_logo_and_bans_but_never_its_colours(monkeypatch, tmp_path):
    monkeypatch.setattr(look, "brand_tokens", _minimal_brand)
    out = tmp_path / "run"
    deck, rep = _build_in(monkeypatch, tmp_path, out, "--deck", str(_brand_deck(tmp_path)), "--agency-look", _write(tmp_path, "ag.json", AGENCY), base=PROMPT_ARGS, real=True)
    th = deck["meta"]["theme"]
    assert th["colors"]["accent"] == "7A3FF2" and th["from"]["accent"] == "agency_look" and th["fonts"]["head"] == "Cambria"
    assert th["colors"]["paper"] == theme.NAPKIN.paper and len(_pptx_logo(out / "deck.pptx")) == 1
    assert th["logo"]["placement"] == "cover_only" and rep["look"]["held"] == []


def test_runner_path_wears_client_dresses_the_deck_in_the_clients_tokens(monkeypatch, tmp_path):
    monkeypatch.setattr(look, "brand_tokens", _minimal_brand)
    deck, _ = _build_in(monkeypatch, tmp_path, tmp_path / "run", "--deck", str(_brand_deck(tmp_path, wears="client")), "--agency-look", _write(tmp_path, "ag.json", AGENCY), base=PROMPT_ARGS)
    th = deck["meta"]["theme"]
    assert th["colors"]["accent"] == "0B7A75" and th["from"]["accent"] == "brand_clan" and th["fonts"]["head"] == "Brand Serif" and th["kit"] == {"document_id": "brand-1", "version": 5}


def test_runner_path_holds_the_logo_of_a_kit_that_is_not_the_clients(monkeypatch, tmp_path):
    monkeypatch.setattr(look, "brand_tokens", _minimal_brand)
    out = tmp_path / "run"
    deck, rep = _build_in(monkeypatch, tmp_path, out, "--deck", str(_brand_deck(tmp_path, name="Harbour County")), base=PROMPT_ARGS, real=True)
    th = deck["meta"]["theme"]
    assert "logo" not in th and "Harbour County" in th["held"][0] and _pptx_logo(out / "deck.pptx") == [] and rep["look"]["held"] == th["held"]
