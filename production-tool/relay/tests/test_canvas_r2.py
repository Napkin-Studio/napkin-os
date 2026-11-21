"""UAT round 2, canvas and Dex (features/pt-canvas-r2.clan): Dex reads the sheet cut to its op and gets more time,
in one try, for many pictures (R2-3); what Dex was given is kept when it fails (R2-3); a generate or a frame paints no
other brands (R2-13); a frame with the shot before draws a new moment (R2-4); long names become tags that still read
(R2-14); an extend's master is laid back over its edge on a ramp, its seed grained like its edge (IMG-9)."""

from __future__ import annotations

import io
import json

from PIL import Image

import formats
from director.claude import ClaudeDirector
from director.director import (BRAND_FREE_OPS, CALL_MAX_S, NO_OTHER_BRANDS, PREVIOUS_IS_NOT_A_COPY, Director,
                               DirectorError, call_timeout, sheet_for, _add_line, _no_other_brands,
                               _previous_is_not_a_copy, _within_budget)
from director.model import AnthropicWire, ModelError, ModelPort
from names import TAG, fit_tag, wire_tags
from providers.types import load_sheet
from test_director import PROMPTS

RUNWAY = load_sheet("runway")
A = "sha256:" + "a" * 64


def refs(n):
    return [{"id": f"r{i}", "tag": f"in_{i}", "role": "other", "asset": {"sha256": "sha256:" + f"{i:064x}"}} for i in range(n)]


# ── R2-3: what Dex reads, and for how long ───────────────────────────────────

def test_the_sheet_dex_reads_is_its_op_and_that_ops_models_only():
    cut = sheet_for("generate", RUNWAY, {})
    assert set(cut["ops"]) == {"generate"}
    assert set(cut["models"]) == {"gemini_image3_pro", "gemini_image3.1_flash"}
    assert "sources" not in cut and "concurrency" not in cut and all("pricing" not in m for m in cut["models"].values())
    assert cut["refs"] == RUNWAY["refs"] and cut["tagSyntax"] == RUNWAY["tagSyntax"]
    assert len(json.dumps(cut)) < len(json.dumps(RUNWAY)) / 4
    # A clip keeps every model it may run on (their ratios), and a Change this frame the ops it runs as.
    assert set(sheet_for("clip", RUNWAY, {})["models"]) >= {"veo3.1", "klingO3_pro"}
    assert set(sheet_for("frame_edit", RUNWAY, {})["ops"]) == {"frame_edit", "frame", "region_edit"}


def test_more_pictures_get_more_seconds_up_to_a_cap():
    assert call_timeout(20, {"refs": refs(2)}) == 20
    assert call_timeout(20, {"refs": refs(4)}) == 20
    assert call_timeout(20, {"refs": refs(8)}) == 28
    assert call_timeout(20, {"refs": refs(14)}) == 40 == CALL_MAX_S


class Client:
    """An SDK-shaped client: with_options says what it was given."""

    def __init__(self, opts=None):
        self.opts = opts or {}

    def with_options(self, **kw):
        return Client({**self.opts, **kw})


class Wire(AnthropicWire):
    def __init__(self, client, reply):
        super().__init__(client, "bedrock")
        self.reply, self.sent = reply, []

    def send(self, **kw):
        self.sent.append((self.client.opts, kw["timeout"]))
        if isinstance(self.reply, Exception):
            raise self.reply
        from director.model import Reply
        return Reply(json.dumps(self.reply), "ok", (10, 5))


GENERATE = {"op": "generate", "providerJob": {"provider": "runway", "model": "gemini_image3_pro", "prompt": "a red coat",
                                              "refs": [], "ratio": "896:1152", "outputs": 1},
            "question": None, "rationale": "As written.", "confidence": 0.9}


def director(reply):
    wire = Wire(Client(), reply)
    d = Director(ModelPort(wire, "m", timeout=20), PROMPTS, {"runway": RUNWAY}, prompt_version="director.v16")
    return d, wire


def test_a_long_call_runs_once_with_no_sdk_retry_and_a_short_one_as_before():
    d, wire = director(GENERATE)
    d.run("generate", {"text": "a red coat", "ratio": "4:5"}, "runway")
    d.run("generate", {"text": "a red coat", "ratio": "4:5", "refs": refs(14)}, "runway")
    (short_opts, short_s), (long_opts, long_s) = wire.sent
    assert short_s == 20 and "max_retries" not in short_opts
    assert long_s == 40 and long_opts == {"max_retries": 0}
    assert d.port.timeout == 20  # the shared port is untouched


def test_what_dex_was_given_is_kept_when_it_times_out():
    d, _ = director(ModelError("director: the model call timed out", "timeout"))
    cd = ClaudeDirector(d)
    out = cd.direct({"jobId": "job_x", "op": "generate", "input": {"text": "a red coat", "ratio": "4:5", "refs": refs(3)}},
                    RUNWAY)
    assert out["_model"] == "passthrough"
    assert out["_input"]["text"] == "a red coat" and len(out["_input"]["refs"]) == 3


# ── R2-13 and R2-4: the relay's own lines ────────────────────────────────────

def test_a_generate_and_a_frame_paint_no_other_brands_once():
    for op in BRAND_FREE_OPS:
        job = {"model": "gemini_image3_pro", "prompt": "Two friends at a café table.", "refs": []}
        _no_other_brands(job, op, RUNWAY)
        _no_other_brands(job, op, RUNWAY)
        assert job["prompt"].count(NO_OTHER_BRANDS) == 1
    edit = {"model": "ideogram_4_5", "prompt": "make the door red", "refs": []}
    _no_other_brands(edit, "region_edit", RUNWAY)
    assert NO_OTHER_BRANDS not in edit["prompt"]


def test_a_frames_closing_sentence_stays_last():
    job = {"model": "gemini_image3_pro", "prompt": "A wide street. Full-bleed cinematic image; no text, captions, borders or panels.", "refs": []}
    _add_line(job, NO_OTHER_BRANDS, RUNWAY)
    assert job["prompt"] == f"A wide street. {NO_OTHER_BRANDS} Full-bleed cinematic image; no text, captions, borders or panels."


def test_a_frame_with_the_shot_before_draws_a_new_moment():
    job = {"model": "gemini_image3_pro", "prompt": "Mia kneels by the puppy. Keep the setting of @anchor.",
           "refs": [{"sha256": A, "name": "previous", "role": "object"}]}
    _previous_is_not_a_copy(job, "frame", RUNWAY)
    assert PREVIOUS_IS_NOT_A_COPY in job["prompt"]
    alone = {"model": "gemini_image3_pro", "prompt": "Mia kneels.", "refs": []}
    _previous_is_not_a_copy(alone, "frame", RUNWAY)
    assert alone["prompt"] == "Mia kneels."


def test_the_relays_lines_are_outside_dexs_budget():
    words = "a red coat"
    job = {"prompt": f"{words}. {NO_OTHER_BRANDS} {PREVIOUS_IS_NOT_A_COPY} " + "x" * 200}
    _within_budget(job, "generate", {"text": words})  # 200 added, under 250 × 1.5
    job["prompt"] += "y" * 200
    try:
        _within_budget(job, "generate", {"text": words})
    except DirectorError:
        pass
    else:
        raise AssertionError("400 added should be refused")


def test_v16_says_the_new_lines():
    text = (PROMPTS / "director.v16.md").read_text()
    assert NO_OTHER_BRANDS in text and "not a copy of it" in text
    assert "continue from @previous" not in text and "continue from @previous" in (PROMPTS / "director.v15.md").read_text()


# ── R2-14: tags that read ────────────────────────────────────────────────────

def test_long_names_keep_every_word_readable_within_sixteen():
    assert fit_tag("marco_three-quarter") == "marco_3q"  # round 3: short forms before vowels (pt-canvas-r3)
    for name in ("maya_over-the-shoulder", "supercalifragilistic_front", "elizabeth_three-quarter-left"):
        tag = fit_tag(name)
        assert TAG.match(tag) and len(tag) <= 16, (name, tag)
    tags = wire_tags([{"id": "a", "name": "marco_three-quarter"}, {"id": "b", "name": "marco_three-quarters"}])
    assert len(set(tags.values())) == 2 and all(TAG.match(t) for t in tags.values())


# ── IMG-9: the extend's seam ─────────────────────────────────────────────────

def png(img):
    b = io.BytesIO()
    img.save(b, format="PNG")
    return b.getvalue()


def test_the_extend_lands_with_the_master_laid_back_on_a_ramp():
    master = Image.new("RGB", (320, 180), (200, 200, 200))
    plan = formats.pad_plan(320, 180, 21, 9)
    at, o = plan["at"], formats.overlap_px(plan)
    painted = Image.new("RGB", (plan["canvas"]["w"], plan["canvas"]["h"]), (0, 0, 0))
    out = Image.open(io.BytesIO(formats.feathered(png(painted), png(master), plan))).convert("RGB")
    y = at["y"] + at["h"] // 2
    assert out.getpixel((at["x"] - 2, y)) == (0, 0, 0)  # the band is the model's
    assert out.getpixel((at["x"] + at["w"] // 2, y)) == (200, 200, 200)  # inside is the master's own
    ramp = [out.getpixel((at["x"] + i, y))[0] for i in range(o)]
    assert ramp == sorted(ramp) and 0 < ramp[o // 2] < 200  # across the overlap one fades into the other
    # A result of another size is fitted to the canvas first.
    small = painted.resize((painted.width // 2, painted.height // 2))
    assert Image.open(io.BytesIO(formats.feathered(png(small), png(master), plan))).size == painted.size


def test_the_seed_is_grained_like_the_masters_edge():
    flat = Image.new("RGB", (320, 180), (40, 40, 60))
    stars = flat.copy()
    for i in range(0, 320 * 180, 37):
        stars.putpixel((i % 320, i // 320), (255, 255, 255))
    plan = formats.pad_plan(320, 180, 21, 9)
    assert formats.edge_texture(stars, plan) > formats.edge_texture(flat, plan) + 5

