"""brand_build: the model's recorded readings -> a candidate Brand Bible (merge.py), checked against the Brand Clan schema."""

import copy
import json
from pathlib import Path

import jsonschema
import pytest

from brand_fixtures import BIBLE_PAGES, fake_png, make_pdf, make_zip, recorded
from napkin.brand import PAGE_CAP, build, confidential, material
from napkin.brand.ids import ID
from napkin.brand.merge import assemble, hex_of, resolve_assets, safe_name

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "app/templates/brand-clan/schema.json").read_text())


def valid(candidate: dict):
    """The candidate is the shape of shared/data.yaml without `kit` (contract 2.2)."""
    s = copy.deepcopy(SCHEMA)
    s["required"] = ["name"]
    jsonschema.validate(candidate, s)


class Model:
    """The model's calls, answered from the recorded outputs; the first run of pages gets piece-1, later ones piece-2."""

    def __init__(self, pictures="pictures-logos.json", piece_for=None):
        self.calls, self.pictures, self.piece_for = [], recorded(pictures), piece_for

    def structured(self, purpose, system, payload, schema, **kw):
        self.calls.append((purpose, payload, kw))
        if purpose == build.PICTURES:
            return self.pictures
        first = int(str(payload["pages"]).split("-")[0])
        return recorded((self.piece_for or (lambda a: "piece-1.json" if a == 1 else "piece-2.json"))(first))


def zip_material():
    return material.load("Tidewell-kit.zip", make_zip({"logos/light.png": fake_png(seed=1), "logos/dark.png": fake_png(seed=2),
                                                        "photos/people.png": fake_png(seed=3), "photos/rule.png": fake_png(seed=4),
                                                        "book.pdf": make_pdf(BIBLE_PAGES)}))


def test_the_candidate_is_the_schemas_shape_with_stable_ids_and_logos_with_files():
    m = zip_material()
    b = build.Build(Model(), m, "Original").read()
    c = b.candidate
    valid(resolve_assets(c, {n: f"human/assets/x-{n}" for n in b.uploads}))   # valid once the host has named the files
    v = c["visual"]
    assert [x["id"] for x in v["colours"]] == ["tide-blue", "foam", "ink"]
    assert [x["hex"] for x in v["colours"]] == ["#0A6BA0", "#F4F6F7", "#1C2630"]
    assert v["colours"][0]["role"] == "accent"       # 'Bad one' (hex "blue") is dropped, never repaired
    assert [(t["family"], t["role"]) for t in v["typography"]] == [("Tidewell Serif", "head"), ("Tidewell Sans", "body")]
    assert [(l["id"], l["variant"]) for l in v["logos"]] == [("wordmark-light-ground", "light"), ("wordmark-dark-ground", "dark")]
    assert all(ID.match(x["id"]) for x in v["logos"] + v["colours"] + c["voice"]["rules"])
    assert c["voice"]["tone"] == "Warm, plain, never shouty."
    assert [r["kind"] for r in c["voice"]["rules"]] == ["do", "dont"]
    assert c["imagery"]["bans"] == ["Stock handshakes"]
    assert [e["note"] for e in c["imagery"]["examples"]] == ["People by the water"]
    assert "gaps" not in c
    assert sorted(b.uploads) == ["example-example.png", "logo-wordmark-dark-ground.png", "logo-wordmark-light-ground.png"]


def test_pieces_merge_without_repeats_and_a_later_other_never_overrides():
    cand, _ = assemble("Original", [recorded("piece-1.json"), recorded("piece-2.json")], [], {}, False)
    v = cand["visual"]
    assert [(c["id"], c["role"]) for c in v["colours"]] == [("tide-blue", "accent"), ("foam", "paper"), ("ink", "ink"), ("sand", "panel")]   # "Tide Blue" #0A6BA0 is the same colour
    assert [t["family"] for t in v["typography"]] == ["Tidewell Serif", "Tidewell Sans"]                                                       # "tidewell serif" is the same face
    assert [r["text"] for r in cand["voice"]["rules"]] == ["Write in short sentences.", "Do not use exclamation marks."]                     # the repeat is one rule
    assert cand["imagery"]["bans"] == ["Stock handshakes", "Neon filters"]
    assert cand["voice"]["tone"] == "Warm, plain, never shouty."                                                                              # the first piece that has one


def test_a_picture_the_model_never_saw_and_an_other_are_never_kept():
    b = build.Build(Model(), zip_material(), "Original").read()
    assert not any("ghost" in json.dumps(b.candidate) for _ in [0])
    assert len(b.uploads) == 3        # f4 (use: other) and the invented "ghost" are not uploaded


def test_ids_are_the_same_on_every_build():
    one = build.Build(Model(), zip_material(), "Original").read().candidate
    two = build.Build(Model(), zip_material(), "Original").read().candidate
    assert one == two


def test_a_section_the_file_lacks_is_omitted_and_listed_in_gaps():
    m = material.load("book.pdf", make_pdf(BIBLE_PAGES))
    b = build.Build(Model("pictures-none.json", lambda a: "piece-empty.json"), m, "Original").read()
    assert not b.has_content
    assert [g["area"] for g in b.candidate["gaps"]] == ["logos", "colours", "typography", "voice", "imagery"]
    assert b.candidate["gaps"][0]["note"] == "The file held no pictures to take a logo from."
    valid(b.candidate)


def test_a_file_with_only_colours_has_content_and_the_other_sections_are_gaps():
    m = material.load("book.pdf", make_pdf(BIBLE_PAGES))
    only = {"colours": [{"name": "Tide", "hex": "#0a6ba0", "role": "accent"}], "typography": [], "tone": "", "rules": [], "imagery_style": "", "imagery_bans": [], "logo_note": ""}
    class M(Model):
        def structured(self, purpose, *a, **k):
            return only if purpose == build.PIECE else super().structured(purpose, *a, **k)
    b = build.Build(M("pictures-none.json"), m, "Original").read()
    assert b.has_content and set(b.candidate) == {"name", "visual", "gaps"} and set(b.candidate["visual"]) == {"colours"}
    assert [g["area"] for g in b.candidate["gaps"]] == ["logos", "typography", "voice", "imagery"]


def test_pieces_are_runs_of_pages_each_sent_as_its_own_pdf():
    pages = [f"Page {i}" for i in range(1, 36)]
    m = material.load("big.pdf", make_pdf(pages))
    model = Model(piece_for=lambda a: "piece-empty.json")
    b = build.Build(model, m, "Original")
    assert b.ranges() == [(1, 15), (16, 30), (31, 35)] and b.units() == 3
    b.read()
    pieces = [c for c in model.calls if c[0] == build.PIECE]
    assert sorted(c[1]["pages"] for c in pieces) == ["1-15", "16-30", "31-35"]
    assert all(c[2]["images"][0]["media_type"] == "application/pdf" and c[2]["vision"] for c in pieces)
    assert all("text" not in c[1] for c in pieces)          # the PDF carries the text: no second copy
    # and the sub-PDF holds exactly those pages
    from pypdf import PdfReader
    import base64, io
    assert [len(PdfReader(io.BytesIO(base64.b64decode(c[2]["images"][0]["data"]))).pages) for c in sorted(pieces, key=lambda c: int(c[1]["pages"].split("-")[0]))] == [15, 15, 5]


def test_a_file_with_no_pdf_goes_as_text():
    m = material.load("book.docx", make_zip({"word/document.xml": "<w:document><w:p><w:t>Colour palette</w:t></w:p></w:document>"}))
    model = Model("pictures-none.json", lambda a: "piece-empty.json")
    build.Build(model, m, "Original").read()
    purpose, payload, kw = model.calls[0]
    assert purpose == build.PIECE and "Colour palette" in payload["text"]["1"] and not kw["images"] and not kw["vision"]


def test_pictures_go_in_batches_with_their_page_text_and_svgs_by_name():
    files = {f"logos/l{i}.png": fake_png(seed=i) for i in range(1, 14)}
    files["logos/mark.svg"] = "<svg xmlns='http://www.w3.org/2000/svg'><circle r='4'/></svg>"
    m = material.load("kit.zip", make_zip(files))
    model = Model("pictures-none.json")
    build.Build(model, m, "Original").read()
    calls = [c for c in model.calls if c[0] == build.PICTURES]
    assert [len(c[1]["pictures"]) for c in calls] == [12, 2]
    svg = next(p for c in calls for p in c[1]["pictures"] if p["name"] == "mark.svg")
    assert svg["viewable"] is False and len(calls[1][2]["images"]) == 1   # the SVG is named, not shown


def test_a_cancelled_or_failed_call_spends_no_more():
    pages = [f"Page {i}" for i in range(1, 100)]
    m = material.load("big.pdf", make_pdf(pages))
    class Boom(Model):
        def structured(self, purpose, system, payload, schema, **kw):
            self.calls.append(purpose)
            raise RuntimeError("model down")
    model = Boom()
    with pytest.raises(RuntimeError):
        build.Build(model, m, "Original").read()
    assert 1 <= len(model.calls) <= build.Build(model, m, "x").units()


def test_asset_paths_are_swapped_in_from_what_the_host_named():
    cand, uploads = assemble("Original", [recorded("piece-1.json")], [{"image_id": "f1", "use": "logo", "label": "Wordmark", "variant": "light", "note": ""}],
                             {"f1": material.Image("f1", "a.png", "image/png", fake_png())}, True)
    out = resolve_assets(cand, {n: f"human/assets/x-{n}" for n in uploads})
    assert out["visual"]["logos"][0]["asset"] == "human/assets/x-logo-wordmark.png"
    valid(out)
    assert "upload:" in json.dumps(cand) and "upload:" not in json.dumps(out)


@pytest.mark.parametrize("v,want", [("#0a6ba0", "#0A6BA0"), ("0A6BA0", "#0A6BA0"), ("#abc", "#AABBCC"), ("blue", None), ("#12345", None), (None, None)])
def test_hex(v, want):
    assert hex_of(v) == want


def test_safe_name():
    assert safe_name("Tidewell brand/book (v2).pdf") == "Tidewell brand-book -v2-.pdf" and "/" not in safe_name("../../x")


def test_every_brand_purpose_is_confidential():
    assert all(confidential(p) for p in (build.PIECE, build.PICTURES, "brand_identify")) and not confidential("extract")
