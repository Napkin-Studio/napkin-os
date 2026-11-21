"""UAT round 3, canvas and Dex (features/pt-canvas-r3.clan): Dex reads only its op's schema and the prompt sections its
input can use, at a lower effort for small jobs (R2-3, R3-11); a palette is accents (R3-2, director.v17); a frame keeps
@anchor's setting only in its place (R3-12, v17); long names read (R2-14); an extend grows in steps, each seeded from
real pixels with no grain (IMG-9)."""

from __future__ import annotations

import io
import json

import pytest
from PIL import Image, ImageStat

import formats
from director.director import (EFFORT, MAX_TOKENS, MAX_TOKENS_DEFAULT, Director, _palette_as_accents, drop_sections,
                               schema_for, sheet_for, _sheet_for_dex, strict_palette, without_descriptions)
from director.model import ModelPort, Reply
from names import TAG, fit_tag, wire_tags
from providers.types import load_sheet
from test_director import PROMPTS

RUNWAY = load_sheet("runway")
GENERATE = {"op": "generate", "providerJob": {"provider": "runway", "model": "gemini_image3_pro", "prompt": "a cottage at midday",
                                              "refs": [], "ratio": "896:1152", "outputs": 1},
            "question": None, "rationale": "As written.", "confidence": 0.9}


class Wire:
    api = "anthropic"

    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def send(self, **kw):
        self.calls.append(kw)
        return Reply(json.dumps(self.reply), "ok", (100, 50))


def director(reply=GENERATE, version="director.v17"):
    wire = Wire(reply)
    return Director(ModelPort(wire, "m", timeout=20), PROMPTS, {"runway": RUNWAY}, prompt_version=version), wire


def ask_parts(d: Director, op: str, payload: dict) -> dict:
    """What a director call sends, by part, in characters (the test's log of where the input tokens go)."""
    sheet = sheet_for(op, _sheet_for_dex(RUNWAY), payload) if op != "shot_list" else None
    return {"system": len(d.system_for(op, payload)),
            "schema": len(json.dumps(d.schema_sent(op, payload), separators=(",", ":"))),
            "sheet": len(json.dumps(sheet, separators=(",", ":"))) if sheet else 0,
            "input": len(json.dumps(payload, separators=(",", ":")))}


# ── R2-3: where the tokens went, and what is left ─────────────────────────────

def test_a_words_only_generate_asks_far_less_than_round_three_measured():
    words = {"text": "a cottage at midday, photo", "ratio": "4:5"}
    v16, _ = director(version="director.v16")
    v17, _ = director()
    before, after = ask_parts(v16, "generate", words), ask_parts(v17, "generate", words)
    print("generate ask by part (characters): v16", before, "v17", after)
    assert before["schema"] > 17000 and before["system"] > 13000  # round 3's 15.1k tokens: the whole schema, every section
    assert after["schema"] < 5500 and after["system"] < 12500
    assert sum(after.values()) < 0.62 * sum(before.values())


def test_the_schema_holds_only_the_ops_fields_and_validation_keeps_the_whole_one():
    d, _ = director()
    gen = schema_for("generate", d.schema, {})
    assert "shots" not in gen["properties"] and "frameEdit" not in gen["properties"] and "briefFlags" not in gen["properties"]
    assert not {"firstFrame", "lastFrame", "keyframes", "audio", "durationS"} & set(gen["properties"]["providerJob"]["properties"])
    plan = schema_for("shot_list", d.schema, {"brief": {"title": "x"}})
    assert "providerJob" not in plan["properties"] and "shots" in plan["properties"] and "briefFlags" in plan["properties"]
    assert "frameEdit" in schema_for("frame_edit", d.schema, {})["properties"]
    assert "firstFrame" in schema_for("clip", d.schema, {})["properties"]["providerJob"]["properties"]
    assert "description" not in json.dumps(without_descriptions(gen))
    # A prompt before v17 is sent with the whole schema, as it was, for a rollback.
    old, _ = director(version="director.v16")
    assert old.schema_sent("generate", {}) is old.schema


def test_the_shared_sections_go_only_with_the_input_they_are_for():
    d, _ = director()
    bare = d.system_for("generate", {"text": "x"})
    assert "## Context: brand rules and documents" not in bare and "## The brief" not in bare
    full = d.system_for("generate", {"text": "x", "context": [{"kind": "palette", "text": "Accents: Navy #0A1F44"}],
                                     "brief": {"title": "t"}})
    assert "## Context: brand rules and documents" in full and "## The brief" in full and "## References" in full
    assert drop_sections("## A\nx\n## The brief\ny\n", None) == "## A\nx\n## The brief\ny\n"


def test_small_jobs_think_less_and_a_frame_writes_less():
    d, wire = director()
    d.run("generate", {"text": "a cottage at midday", "ratio": "4:5"}, "runway")
    sent = wire.calls[0]
    assert sent["effort"] == EFFORT["generate"] == "low"
    assert sent["max_tokens"] == MAX_TOKENS_DEFAULT
    assert EFFORT.get("shot_list") is None and MAX_TOKENS["frame"] == 2000 and MAX_TOKENS["shot_list"] == 6000


# ── R3-2: a palette is accents ────────────────────────────────────────────────

ACCENTS = [{"kind": "palette", "title": "@harbour_palette", "text": "Accents: Navy #0A1F44, Sand #E8DCC4, Coral #FF6F59"}]
STRICT = [{"kind": "palette", "title": "@harbour_palette", "text": "Strict: Navy #0A1F44, Sand #E8DCC4"}]


@pytest.mark.parametrize("prompt", [
    "A cottage at midday. Use only these colours: #E8DCC4, #0A1F44, #FF6F59.",
    "A cottage at midday, keep to the palette.",
    "A cottage at midday in only the brand colours.",
])
def test_only_these_colours_becomes_accents_unless_the_palette_is_strict(prompt):
    job = {"prompt": prompt}
    _palette_as_accents(job, "generate", {"context": ACCENTS})
    assert "only these colours" not in job["prompt"].lower() and "keep to the palette" not in job["prompt"].lower()
    assert "accent" in job["prompt"]
    kept = {"prompt": prompt}
    _palette_as_accents(kept, "generate", {"context": STRICT})
    assert kept["prompt"] == prompt and strict_palette({"context": STRICT}) and not strict_palette({"context": ACCENTS})
    view = {"prompt": prompt}
    _palette_as_accents(view, "view", {"context": ACCENTS})
    assert view["prompt"] == prompt  # a view reads no context


def test_v17_says_accents_and_the_anchors_setting_only_in_its_place():
    v16 = (PROMPTS / "director.v16.md").read_text()
    v17 = (PROMPTS / "director.v17.md").read_text()
    assert '"use only these colours"' in v16
    assert "accent colours, not the only colours" in v17 and "Strict:" in v17
    assert "never write \"use only these colours\"" in v17
    assert "keep the setting, light and style of @anchor" in v16 and "keep the setting, light and style of @anchor" not in v17
    assert "\"and its setting\" only when this shot happens where @anchor does" in v17
    changed = [b for a, b in zip(v16.splitlines(), v17.splitlines()[2:]) if a != b]
    assert len(v17.splitlines()) == len(v16.splitlines()) + 2 and len(changed) <= len(v16.splitlines())


def test_a_generate_with_a_palette_lands_with_accents():
    reply = {**GENERATE, "providerJob": {**GENERATE["providerJob"], "prompt": "A cottage at midday. Use only these colours: #0A1F44."}}
    d, _ = director(reply)
    res = d.run("generate", {"text": "A cottage at midday", "ratio": "4:5", "context": ACCENTS}, "runway")
    assert "only these colours" not in res.output["providerJob"]["prompt"]


# ── R2-14: tags that read ─────────────────────────────────────────────────────

@pytest.mark.parametrize("name, tag", [
    ("ruby_back-three-quarter", "ruby_back_3q"),
    ("marco_three-quarter", "marco_3q"),
    ("maya_over-the-shoulder", "maya_ots"),
    ("maya_view-of-the-back", "maya_back"),
    ("ruby_front", "ruby_front"),
])
def test_long_names_take_short_forms_before_losing_vowels(name, tag):
    assert fit_tag(name) == tag and TAG.match(tag)


def test_short_tags_stay_unique():
    tags = wire_tags([{"id": "a", "name": "ruby_back-three-quarter"}, {"id": "b", "name": "ruby_back-three-quarters"},
                      {"id": "c", "name": "ruby_back"}])
    assert len(set(tags.values())) == 3 and all(TAG.match(t) for t in tags.values())


# ── IMG-9: stepped outpainting ────────────────────────────────────────────────

def png(img) -> bytes:
    b = io.BytesIO()
    img.save(b, format="PNG")
    return b.getvalue()


def sunset(w=1536, h=864):
    img = Image.new("RGB", (w, h))
    for y in range(h):
        c = (255 - y * 120 // h, 140 - y * 60 // h, 60 + y * 80 // h)
        for x in range(w):
            img.putpixel((x, y), c)
    return img


@pytest.mark.parametrize("master, aspect, steps", [
    ((1536, 864), (21, 9), 1),   # 16:9 to 21:9 grows 1.31x: one step
    ((1536, 864), (32, 9), 3),   # 3.56:1 grows 2x: steps of at most 35 %
    ((1536, 864), (9, 16), 3),   # 3.16x: capped at EXTEND_STEPS_MAX
    ((1024, 1024), (4, 5), 1),
    ((1024, 1024), (1, 1), 1),
])
def test_how_many_steps_an_extend_takes(master, aspect, steps):
    assert formats.step_count(*master, *aspect) == steps
    plans = formats.step_plans(formats.pad_plan(*master, *aspect))
    assert len(plans) == steps


def test_every_step_grows_from_the_one_before_and_ends_on_the_sizes_canvas():
    plan = formats.pad_plan(1536, 864, 32, 9)
    steps = formats.step_plans(plan)
    assert steps[-1]["canvas"] == plan["canvas"]
    prev = (plan["at"]["w"], plan["at"]["h"])
    for s in steps:
        at, c = s["at"], s["canvas"]
        assert (at["w"], at["h"]) == prev  # the step's input is the step before, at its size
        assert at["x"] >= 0 and at["x"] + at["w"] <= c["w"] and at["y"] == 0 and c["h"] == 864
        assert c["w"] / at["w"] <= 1 + formats.STEP_GROWTH + 0.01
        prev = (c["w"], c["h"])


def test_a_step_is_seeded_with_real_pixels_and_no_grain():
    master = sunset(320, 180)
    plan = formats.step_plans(formats.pad_plan(320, 180, 21, 9))[0]
    canvas, mask = formats.padded_step(png(master), plan)
    seed = Image.open(io.BytesIO(canvas)).convert("RGB")
    m = Image.open(io.BytesIO(mask))
    at = plan["at"]
    assert seed.size == m.size == (plan["canvas"]["w"], plan["canvas"]["h"])
    # The band continues the sky's colours row by row (the mirror of its edge), with no speckle in it.
    band = seed.crop((0, 0, at["x"], at["h"]))
    for y in (10, 90, 170):
        a, b = seed.getpixel((at["x"] // 2, y)), master.getpixel((0, y))
        assert all(abs(p - q) < 24 for p, q in zip(a, b)), (y, a, b)
    rows = band.crop((0, 60, band.width, 61))
    assert max(ImageStat.Stat(rows).stddev) < 6  # one row of the band is one colour: no grain
    # White over the band and the overlap, black on the picture it grows from.
    o = formats.overlap_px(plan)
    assert m.getpixel((1, 90)) == 255 and m.getpixel((at["x"] + o - 1, 90)) == 255 and m.getpixel((at["x"] + at["w"] // 2, 90)) == 0


def test_a_later_step_grows_the_step_before_and_lands_on_a_ramp():
    plan = formats.pad_plan(320, 180, 32, 9)
    s1, s2 = formats.step_plans(plan)[:2]
    grown = Image.new("RGB", (s1["canvas"]["w"], s1["canvas"]["h"]), (200, 200, 200))
    canvas, _ = formats.padded_step(png(grown), s2)
    assert Image.open(io.BytesIO(canvas)).size == (s2["canvas"]["w"], s2["canvas"]["h"])
    painted = Image.new("RGB", (s2["canvas"]["w"], s2["canvas"]["h"]), (0, 0, 0))
    out = Image.open(io.BytesIO(formats.feathered(png(painted), png(grown), s2))).convert("RGB")
    at = s2["at"]
    assert out.getpixel((at["x"] + at["w"] // 2, 90)) == (200, 200, 200) and out.getpixel((1, 90)) == (0, 0, 0)


def test_each_steps_request_is_an_ideogram_mask_edit_of_its_own_canvas():
    """The shape of every provider request a stepped extend sends (the paid check compares these with Runway's)."""
    from conftest import CDN
    from test_campaign import finish_job, paid_harness, png as plain, size_input
    h = paid_harness()
    token = h.as_person()
    inp = size_input(h, "extend")
    inp["aspect"] = {"w": 32, "h": 9}
    inp["delivery"] = {"width": 3200, "height": 900}
    inp.pop("safeArea")
    inp["resize"]["protect"] = []
    _, job = h.post_job(token, op="resize", expect=200, **inp)
    runway = h.providers["runway"]
    steps = formats.step_plans(formats.pad_plan(320, 180, 32, 9))
    assert job["cost"]["reserved"] == pytest.approx(0.25 * len(steps))
    shas = []
    for k, step in enumerate(steps, 1):
        sent = runway.submits[-1]
        canvas = h.blobs.fetch(f"{CDN}/ads/scratch/{job['jobId']}/canvas-{k}.jpg")
        mask = h.blobs.fetch(f"{CDN}/ads/scratch/{job['jobId']}/mask-{k}.png")
        import hashlib
        assert sent["model"] == "ideogram_4_5" and sent["prompt"] == formats.EXTEND_PROMPT and "ratio" not in sent
        assert sent["refs"] == [{"sha256": "sha256:" + hashlib.sha256(canvas).hexdigest(), "name": "current", "role": "current"}]
        assert sent["mask"] == "sha256:" + hashlib.sha256(mask).hexdigest()
        shas.append(sent["mask"])
        done = finish_job(h, token, {x: v for x, v in job.items() if x != "requestId"}, plain(step["canvas"]["w"], step["canvas"]["h"]))
    assert len(set(shas)) == len(steps) == len(runway.submits)
    assert done["state"] == "completed" and done["cost"]["confirmed"] == pytest.approx(0.25 * len(steps))
