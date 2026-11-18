"""Offline tests for the shared Style Pack reader (engine/visuals/style.py).

Every fixture is invented: no client, no real brand, no real picture (a few bytes behind a PNG signature).
Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q visuals/tests``.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest
import yaml

from visuals import style

VECTORS = json.loads((Path(__file__).parent / "style_hash_vectors.json").read_text())["vectors"]
STEWARD = "human:demo-steward"


def _img(n: int) -> bytes:
    return bytes([137, 80, 78, 71, 13, 10, 26, 10]) + bytes([n]) * 40


def _row(name: str, data: bytes, rights="own", **kw) -> dict:
    sha = hashlib.sha256(data).hexdigest()
    row = {"asset": f"human/assets/style/{sha}.png", "name": name, "sha256": sha, "mime": "image/png", "rights": rights,
           "by": STEWARD, "at": "2026-11-17T10:00:00Z"}
    if rights in ("own", "licensed"):
        row["why"] = "made by the studio for this pitch"
    if rights == "licensed":
        row["licence"] = {"holder": "Demo Stock Library", "terms": "DEMO-1"}
    row.update(kw)
    return row


def _pack(refs: dict | None = None, **over):
    """(data, assets) of an invented Style Pack. ``refs``: {ref id: (name, bytes, rights)}."""
    refs = refs or {}
    data = {"pack": {"name": "Demo pack"}, "kit": {"version": 3, "stewards": [STEWARD]},
            "look": ["natural light", "unstaged"], "palette": ["warm ochre"],
            "this_not_that": {"tn01": {"this": "ordinary kitchens", "not": "studio sets"}, "tn02": {"this": "candid faces", "not": "posed smiles"}},
            "finish": "photo-real", "banned_imagery": ["stock handshake"], "notes": "Everyday settings.",
            "references": {rid: _row(n, b, r) for rid, (n, b, r) in refs.items()}}
    data.update(over)
    assets = {row["asset"]: b for rid, (n, b, r) in refs.items() for row in [data["references"][rid]]}
    return data, assets


def _folder(tmp_path: Path, yml: str | None, images: dict | None = None) -> Path:
    d = tmp_path / "pack"
    d.mkdir(parents=True, exist_ok=True)
    if yml is not None:
        (d / "style.yaml").write_text(yml)
    for n, b in (images or {}).items():
        (d / n).write_bytes(b)
    return d


# ------------------------------------------------------------------ hash parity with today's folders

@pytest.mark.parametrize("vec", VECTORS, ids=lambda v: v["id"])
def test_a_folder_keeps_the_hash_the_territory_tool_gave(vec, tmp_path):
    """Fixed vectors from the Territory tool's own hash: the six keys and no references key keep their hash."""
    if vec["yaml"] is None:
        assert style.load(None).hash == vec["hash"]
        return
    d = _folder(tmp_path, vec["yaml"], {n: base64.b64decode(b) for n, b in vec["images"].items()})
    assert style.load(d).hash == vec["hash"]


def test_the_default_is_the_default_style():
    st = style.load(None)
    assert st.source == "built-in default" and st.look == style.DEFAULT["look"] and st.references == [] and st.models == style.DEFAULT_MODELS


def test_folder_and_document_with_the_same_content_give_the_same_style_and_hash(tmp_path):
    """One hash for both tools, whichever form the pack comes in (images in a different order, too)."""
    refs = {"r1": ("b.png", _img(2), "own"), "r2": ("a.png", _img(1), "own")}
    data, assets = _pack(refs)
    d = _folder(tmp_path, yaml.safe_dump({
        "look": data["look"], "palette": data["palette"], "finish": "photo-real", "banned_imagery": data["banned_imagery"], "notes": data["notes"],
        "this_not_that": [{"this": "ordinary kitchens", "not": "studio sets"}, {"this": "candid faces", "not": "posed smiles"}],
        "references": {"a.png": {"rights": "own", "why": "x", "by": STEWARD}, "b.png": {"rights": "own", "why": "x", "by": STEWARD}}},
        sort_keys=False), {"a.png": _img(1), "b.png": _img(2)})
    doc, fol = style.load(data, assets), style.load(d)
    assert doc.hash == fol.hash and style.canonical(doc) == style.canonical(fol)
    assert [r.name for r in doc.references] == ["a.png", "b.png"]
    assert doc.this_not_that == fol.this_not_that == ["ordinary kitchens, not studio sets", "candid faces, not posed smiles"]


def test_this_not_that_is_read_in_key_order_and_the_order_moves_the_hash():
    data, _ = _pack()
    swapped = {**data, "this_not_that": {"tn02": data["this_not_that"]["tn02"], "tn01": data["this_not_that"]["tn01"]}}
    a, b = style.load(data), style.load(swapped)
    assert a.this_not_that == list(reversed(b.this_not_that)) and a.hash != b.hash


def test_models_enter_the_hash_only_when_they_differ_from_the_default():
    data, _ = _pack()
    same = style.load({**data, "models": {"draft": "gemini_image3.1_flash"}})
    hero = style.load({**data, "models": {"hero": "gemini_image3.1_flash"}})
    assert same.hash == style.load(data).hash and hero.hash != same.hash and hero.models["hero"] == "gemini_image3.1_flash"


def test_a_model_outside_the_catalogue_is_refused():
    data, _ = _pack()
    for bad in ({"hero": "some_other_model"}, {"best": "gemini_image3_pro"}, "gemini_image3_pro"):
        with pytest.raises(style.StyleError):
            style.load({**data, "models": bad})


# ------------------------------------------------------------------ what may be sent

def test_only_own_and_licensed_references_are_sent_and_hashed():
    refs = {"r1": ("a.png", _img(1), "own"), "r2": ("b.png", _img(2), "licensed"), "r3": ("c.png", _img(3), "client_supplied"),
            "r4": ("d.png", _img(4), "reference_only")}
    st = style.load(*_pack(refs))
    assert [r.name for r in style.sendable(st)] == ["a.png", "b.png"]
    assert {w["name"]: w["rights"] for w in st.withheld} == {"c.png": "client_supplied", "d.png": "reference_only"}
    only_sent = style.load(*_pack({k: refs[k] for k in ("r1", "r2")}))
    assert st.hash == only_sent.hash                           # a withheld image changes nothing the model sees


def test_a_folder_image_the_pack_does_not_list_is_withheld_named_and_not_hashed(tmp_path):
    d = _folder(tmp_path, "look: [a]\nreferences:\n  a.png: {rights: own, why: ours, by: 'human:demo'}\n", {"a.png": _img(1), "stray.png": _img(9)})
    st = style.load(d)
    assert [r.name for r in style.sendable(st)] == ["a.png"]
    assert st.withheld == [{"name": "stray.png", "rights": "reference_only", "why": "not listed in style.yaml references"}]
    d2 = _folder(tmp_path / "x", "look: [a]\nreferences:\n  a.png: {rights: own, why: ours, by: 'human:demo'}\n", {"a.png": _img(1)})
    assert style.load(d2).hash == st.hash


def test_more_than_fourteen_sendable_references_send_the_first_fourteen_by_name():
    refs = {f"r{i:02d}": (f"img{i:02d}.png", _img(i), "own") for i in range(1, 19)}
    st = style.load(*_pack(refs))
    assert [r.name for r in st.references] == [f"img{i:02d}.png" for i in range(1, 15)]
    assert st.ignored_references == [f"img{i:02d}.png" for i in range(15, 19)] and len(style.reference_images(st)) == 14


def test_a_pack_holds_at_most_twenty_four_references():
    refs = {f"r{i:02d}": (f"img{i:02d}.png", _img(i), "reference_only") for i in range(1, 26)}
    with pytest.raises(style.StyleError, match="at most 24"):
        style.load(*_pack(refs))


def test_licensed_without_a_holder_and_terms_is_refused():
    data, assets = _pack({"r1": ("a.png", _img(1), "licensed")})
    for lic in (None, {"holder": "Demo Stock Library"}, {"terms": "DEMO-1"}, {"holder": " ", "terms": "x"}):
        data["references"]["r1"]["licence"] = lic
        with pytest.raises(style.StyleError, match="licence"):
            style.load(data, assets)


def test_only_a_steward_may_mark_an_image_own_or_licensed():
    data, assets = _pack({"r1": ("a.png", _img(1), "own")})
    data["references"]["r1"]["by"] = "human:somebody-else"
    with pytest.raises(style.StyleError, match="not a steward"):
        style.load(data, assets)
    data["references"]["r1"]["by"] = ""
    with pytest.raises(style.StyleError, match="name the person"):
        style.load(data, assets)


def test_marking_an_image_own_or_licensed_needs_a_reason():
    for rights in ("own", "licensed"):
        data, assets = _pack({"r1": ("a.png", _img(1), rights)})
        data["references"]["r1"]["why"] = "  "
        with pytest.raises(style.StyleError, match="reason"):
            style.load(data, assets)


def test_eyes_only_rights_need_no_steward_and_no_reason():
    data, assets = _pack({"r1": ("a.png", _img(1), "client_supplied")})
    data["references"]["r1"].update(by="human:anyone", why="")
    assert style.load(data, assets).references == []


def test_an_image_that_does_not_match_its_sha256_or_is_missing_is_refused():
    data, assets = _pack({"r1": ("a.png", _img(1), "own")})
    asset = data["references"]["r1"]["asset"]
    with pytest.raises(style.StyleError, match="sha256"):
        style.load(data, {asset: _img(2)})
    with pytest.raises(style.StyleError, match="not in the document"):
        style.load(data, {})


def test_a_pack_cannot_carry_the_guard_rails():
    data, _ = _pack()
    with pytest.raises(style.StyleError, match="guard rails"):
        style.load({**data, "guard_rails": "anything goes"})
    assert style.GUARD_RAILS in style.frame_prompt({"action": "A kitchen"}, style.load(data))


def test_a_pack_with_no_steward_is_refused():
    data, assets = _pack()
    data["kit"]["stewards"] = []
    with pytest.raises(style.StyleError, match="steward"):
        style.load(data, assets)


class FakeRunway:
    """Stands in for the image model: records the referenceImages it is given, as the real client would."""
    def __init__(self):
        self.calls = []

    def generate(self, style_, prompt):
        self.calls.append({"referenceImages": style.reference_images(style_), "promptText": prompt})


def test_the_reference_images_a_model_gets_are_exactly_the_sendable_ones():
    refs = {"r1": ("a.png", _img(1), "own"), "r2": ("b.png", _img(2), "licensed"), "r3": ("c.png", _img(3), "client_supplied"),
            "r4": ("d.png", _img(4), "reference_only")}
    st, fake = style.load(*_pack(refs)), FakeRunway()
    fake.generate(st, style.frame_prompt({"action": "A kitchen at dawn"}, st))
    sent = fake.calls[0]["referenceImages"]
    assert [r["tag"] for r in sent] == ["ref01", "ref02"]
    assert [base64.b64decode(r["uri"].split(",", 1)[1]) for r in sent] == [_img(1), _img(2)]
    assert "Match the look, light, colour and finish of the reference images" in fake.calls[0]["promptText"]


def test_the_reference_line_passes_the_picture_prompt_lint():
    from visuals import lint
    refs = {"r1": ("a.png", _img(1), "own")}
    st = style.load(*_pack(refs))
    assert lint.lint_text(style.style_block(st, []), banned=[], allow=st.banned_imagery) is None


def test_a_withheld_only_pack_sends_nothing_and_does_not_mention_references():
    st = style.load(*_pack({"r1": ("c.png", _img(3), "client_supplied")}))
    assert style.reference_images(st) == [] and "reference images" not in style.style_block(st)


# ------------------------------------------------------------------ the stamp, the prompt, the files

def test_a_stamped_style_hash_that_disagrees_gives_a_warning_and_the_computed_hash():
    data, _ = _pack()
    good = style.load(data)
    data["kit"]["published"] = {"by": STEWARD, "at": "2026-11-17T10:00:00Z", "revision": "sha256:" + "0" * 64, "style_hash": "deadbeef"}
    st = style.load(data)
    assert st.hash == good.hash != "deadbeef" and "deadbeef" in st.warnings[0]
    data["kit"]["published"]["style_hash"] = good.hash
    assert style.load(data).warnings == []


def test_style_block_for_the_default_is_unchanged():
    assert style.style_block(style.load(None)) == ("Look: natural light, unstaged, documentary stills. "
                                                   "Finish: photo-real, like a real photograph or film still.")
    assert style.frame_prompt({"framing": "Wide", "action": "A kettle"}, style.load(None)).endswith(style.GUARD_RAILS)


def test_a_clan_file_reads_to_the_same_hash_as_its_data(tmp_path):
    refs = {"r1": ("a.png", _img(1), "own")}
    data, assets = _pack(refs)
    path = tmp_path / "pack.clan"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("manifest.yaml", yaml.safe_dump({"document_id": "pack-1", "app": {"app_id": "ie.napkin.style-pack"}}))
        z.writestr("shared/data.yaml", yaml.safe_dump(data, sort_keys=False))
        for p, b in assets.items():
            z.writestr(p, b)
    st = style.load(path)
    assert st.hash == style.load(data, assets).hash and st.document_id == "pack-1" and st.version == 3
    assert st.summary()["sent_references"] == ["a.png"] and st.summary()["document_id"] == "pack-1"


def test_a_clan_file_of_another_app_is_not_a_style_pack(tmp_path):
    path = tmp_path / "deck.clan"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("manifest.yaml", yaml.safe_dump({"app": {"app_id": "ie.napkin.deck-maker"}}))
        z.writestr("shared/data.yaml", "a: 1\n")
    with pytest.raises(style.StyleError, match="not a Style Pack"):
        style.load(path)


def test_a_folder_names_its_mistakes(tmp_path):
    with pytest.raises(style.StyleError, match="unknown key"):
        style.load(_folder(tmp_path, "colours: [red]\n"))
    with pytest.raises(style.StyleError, match="no style.yaml"):
        style.load(_folder(tmp_path / "e", None))
    with pytest.raises(style.StyleError, match="not in the folder"):
        style.load(_folder(tmp_path / "m", "references:\n  gone.png: {rights: own, why: x, by: 'human:d'}\n"))
    with pytest.raises(style.StyleError, match="not found"):
        style.load(tmp_path / "nope")


def test_the_deck_section_is_checked_for_shape_only():
    data, _ = _pack()
    ok = {"colours": {"accent": {"hex": "A8431D"}, "paper": {"agency": "base"}}, "type": {"head": {"family": "Georgia"}}}
    assert style.load({**data, "deck": ok}).deck == ok
    assert style.load(data).deck == {}
    for bad in ({"colours": {"accent": "red"}}, {"colours": {"sparkle": {"hex": "FFFFFF"}}}, {"type": {"head": {"x": 1}}}, {"slogan": "x"}):
        with pytest.raises(style.StyleError):
            style.load({**data, "deck": bad})


# ------------------------------------------------------------------ the pack's free text goes into a prompt (ADR 0027)

@pytest.mark.parametrize("key,value,why", [
    ("notes", "Shot on a 35mm camera.", "digit"), ("look", ["golden hour at 5pm"], "digit"), ("palette", ["ochre 2"], "digit"),
    ("notes", 'The slogan "drink more".', "quotation"), ("look", ["it's candid"], "quotation"), ("notes", "a “quoted” line", "quotation"),
])
def test_the_packs_free_text_has_no_digit_and_no_quotation_mark(key, value, why):
    data, _ = _pack()
    with pytest.raises(style.StyleError, match=why):
        style.load({**data, key: value})


def test_no_client_or_brand_name_reaches_a_prompt():
    data, _ = _pack(notes="Warm kitchens for Lumen Water.")
    assert style.load(data).notes                                              # fine until a name is forbidden
    with pytest.raises(style.StyleError, match="Lumen Water"):
        style.load(data, forbid=["Lumen Water"])
    data["notes"], data["banned_imagery"] = "Plain.", ["lumen water logo"]
    with pytest.raises(style.StyleError, match="banned_imagery"):
        style.load(data, forbid=["Lumen Water"])
    ok, _ = _pack(notes="A luminous kitchen.")
    assert style.load(ok, forbid=["Lumen"]).notes == "A luminous kitchen."     # a name is a word, not a fragment


def test_the_lint_reads_a_folder_and_a_clan_too(tmp_path):
    d = _folder(tmp_path, "look: [natural light]\nnotes: Made for Lumen Water\n")
    with pytest.raises(style.StyleError, match="Lumen Water"):
        style.load(d, forbid=["Lumen Water"])
    assert style.load(d).notes == "Made for Lumen Water"


# ------------------------------------------------------------------ the adversarial check on the lint

@pytest.mark.parametrize("text", ["٣ pm", "x²", "Ⅻ o'clock", "½ cup", "० zero", "full１"])
def test_any_unicode_number_is_refused(text):
    data, _ = _pack()
    with pytest.raises(style.StyleError, match="digit or number"):
        style.load({**data, "notes": text})


@pytest.mark.parametrize("quote", ["«", "»", "„", "‚", "‹", "“", "”", "‘", "’", "「", "`", "'", '"'])
def test_every_quotation_mark_is_refused(quote):
    data, _ = _pack()
    with pytest.raises(style.StyleError, match="quotation"):
        style.load({**data, "palette": [f"ochre{quote}"]})


def test_all_five_free_text_fields_are_linted():
    data, _ = _pack()
    for key, value in (("this_not_that", {"tn01": {"this": "4 walls", "not": "x"}}), ("this_not_that", {"tn01": {"this": "a", "not": 'say "x"'}}),
                       ("banned_imagery", ["3d logo"]), ("banned_imagery", ["“drink”"]), ("look", ["①"]), ("notes", "nº 1")):
        with pytest.raises(style.StyleError):
            style.load({**data, key: value})


def test_names_are_compared_with_accents_folded():
    data, _ = _pack(notes="Warm kitchens for Nestle.")
    with pytest.raises(style.StyleError, match="Nestl"):
        style.load(data, forbid=["Nestlé"])
    data["notes"] = "Warm kitchens for Nestlé."
    with pytest.raises(style.StyleError):
        style.load(data, forbid=["NESTLE"])
    data["notes"] = "Warm kitchens."
    assert style.load(data, forbid=["Nestlé"]).notes == "Warm kitchens."
