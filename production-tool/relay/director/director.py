"""The director: one job input plus the routed provider's capability sheet in, strict JSON out.

The output is director.schema.json (contract 3): one providerJob for an image or video op,
planned shots for shot_list, or instead a question for a person, plus rationale and confidence. The model port (model.py) enforces the
schema with one retry and then fails loudly; this module adds what a schema cannot say: the job
must pass the routed sheet (base.check_capabilities), name only refs it was given, and write
only @tags the adapter can rewrite.
"""

from __future__ import annotations

import copy
import json
import math
import re
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from providers import CapabilityMissing, ProviderJob, check_capabilities
from providers.types import CONTRACTS, prompt_max, utf16_units
from providers.tags import TAG as TAG_IN_TEXT, UnknownTag, rewrite_tags, unsent_in_words

import brief as briefs
import job_context
from . import record
from .base import fit_duration, prompt_number, require_prompt, view_angle, view_subject
from .model import AnthropicWire, ModelPort, Usage

BASE = "https://napkin.ie/production-tool/contracts/"
PURPOSE = "director"
TAG = re.compile(r"^[a-z][a-z0-9_]{2,15}$")
SHA = re.compile(r"sha256:[0-9a-f]{64}")
VIDEO_OPS = ("clip", "clip_edit", "clip_patch")

# What the provider's endpoint accepts that a schema or sheet cannot say (provider docs, checked 2026-10-06).
# Runway's image ratios are pixel pairs, a different list per model (openapi: text_to_image).
FLASH_RATIOS = frozenset("""
512:512 416:624 624:416 432:592 592:432 448:576 576:448 384:672 672:384 768:336 256:1024 1024:256
176:1408 1408:176 1024:1024 832:1248 1248:832 864:1184 1184:864 896:1152 1152:896 768:1344 1344:768
1536:672 512:2048 2048:512 352:2816 2816:352 2048:2048 1696:2528 2528:1696 1792:2400 2400:1792
1856:2304 2304:1856 1536:2752 2752:1536 3168:1344 1024:4096 4096:1024 704:5632 5632:704 4096:4096
3392:5056 5056:3392 3584:4800 4800:3584 3712:4608 4608:3712 3072:5504 5504:3072 6336:2688 2048:8192
8192:2048 1408:11264 11264:1408
""".split())
PRO_RATIOS = frozenset("""
1344:768 768:1344 1024:1024 1184:864 864:1184 1536:672 832:1248 1248:832 896:1152 1152:896 2048:2048
1696:2528 2528:1696 1792:2400 2400:1792 1856:2304 2304:1856 1536:2752 2752:1536 3168:1344 4096:4096
3392:5056 5056:3392 3584:4800 4800:3584 3712:4608 4608:3712 3072:5504 5504:3072 6336:2688
""".split())
RUNWAY_CLIP_RATIOS = frozenset(("1280:720", "720:1280", "1080:1920", "1920:1080"))
# Endpoints that take no usable ratio: the output keeps the input's shape (or the endpoint has no such field).
NO_RATIO = {("runway", "clip_edit"), ("runway", "clip_patch")}
# Models that keep the edited image's own size and take no ratio with a mask or preciseEdit
# (ideogram_4_5 on region_edit; providers.md fact 3, features/image-editor.clan).
NO_RATIO_MODELS = {"ideogram_4_5"}
# Longest prompt per provider and op kind; a longer one is a 400 from the provider.
KEYFRAME_MAX_S = 30  # Runway aleph2 keyframe seconds run 0 to 30
# director.v5 on (features/director-v5.clan): what the director may add beyond the participant's words,
# per op. The prompt states these; the code refuses past 1.5 times (the relay then makes the job as written).
TAKE_LINE_BUDGET = 120
ADD_BUDGET = {"generate": 250, "view": 200, "frame": 500, "region_edit": 250, "clip": 300, "clip_edit": 250, "clip_patch": 250}
# How long Dex may take (features/pt-canvas-r2.clan, UAT round 2 R2-3: a 14-picture Generate timed out at 20 s, twice):
# the port's own seconds for up to CALL_REFS_FREE pictures, CALL_S_PER_REF more for each one after, at most CALL_MAX_S
# (one try when longer than the port's, Director._port_for: the relay's Lambda runs 60 s and the provider submit follows).
CALL_REFS_FREE = 4
CALL_S_PER_REF = 2.0
CALL_MAX_S = 40.0
# The capability sheet Dex reads is cut to the op (R2-3: every job sent the whole 32 KB sheet, ~9k tokens): its own op
# entry, the models that op can run on, and the sheet's small facts; never the sources, prices' notes or other ops.
SHEET_DROP = ("sources", "concurrency", "checked", "usdPerCredit")
# A Change this frame runs as one of these (frameEdit.runAs): Dex reads their entries too.
RELATED_OPS = {"frame_edit": ("frame", "region_edit")}
MODEL_DROP = ("pricing",)
# Scenes painted real trademarks (R2-13: Fanta, Red Bull, Le Monde): a generate or a frame says none may appear but those asked
# for. The relay's own words, outside Dex's budget; said once.
NO_OTHER_BRANDS = "No other brands, logos or readable trademarks."
BRAND_FREE_OPS = ("generate", "frame")
_BRANDS_SAID = re.compile(r"\bno (?:other |real |visible )?(?:brands?|logos?|trademarks?)\b", re.I)
# A storyboard frame copied the one before and doubled its people (R2-4): @previous is for continuity only.
PREVIOUS_IS_NOT_A_COPY = ("@previous is the moment before, for continuity only: draw this shot's own new moment and "
                          "framing, not a copy of it, and show each person once.")
RELAY_LINES = (NO_OTHER_BRANDS, PREVIOUS_IS_NOT_A_COPY)
# A palette is accents (UAT round 3 R3-2: "Use only these colours" made every photo a flat 3-colour poster): unless the
# palette says Strict, the relay rewrites an "only these colours" Dex still writes into accents, whatever prompt version.
_ONLY_COLOURS = re.compile(r"\b(?:use |using |in |with )?only (?:these|the(?: brand(?:'s)?)?|its|our) (?:brand )?(?:colou?rs|palette)\b", re.I)
_KEEP_TO_PALETTE = re.compile(r"\b(?:keep(?:ing)? to|stick(?:ing)? to|stay(?:ing)? within|limit(?:ed)? to) the (?:brand(?:'s)? )?palette\b", re.I)
PALETTE_ROLE_LINE = "brand palette: keep to these colours"
PALETTE_ROLE_LINE_V17 = "brand palette: its colours as accents where the scene has room, never the only colours"
PALETTE_OPS = ("generate", "frame", "region_edit", "frame_edit", "clip", "clip_edit", "clip_patch")
# What Dex reads is its op's (round 3, R2-3: a words-only generate was 15.1k input tokens, the whole 18 KB director
# schema among them): the schema without other ops' fields, and the prompt without the sections its input cannot use.
IMAGE_OPS = ("generate", "frame", "view", "region_edit")
VIDEO_ONLY_FIELDS = ("firstFrame", "lastFrame", "keyframe", "keyframes", "video", "durationS", "audio", "strength")
# The shared sections a job without that input never needs.
SECTION_NEEDS = {"## Context: brand rules and documents": "context", "## The brief": "brief"}
# How hard Dex thinks, and how much it may write, per op (round 3 R3-11: a 1-ref frame took 34.8 s and 2,091 output
# tokens at the model's default effort, its thinking counted as output). A plan keeps the model's default.
EFFORT = {"generate": "low", "frame": "low", "view": "low", "region_edit": "low"}
MAX_TOKENS = {"shot_list": 6000, "frame": 2000, "view": 1500}
MAX_TOKENS_DEFAULT = 3000
_PREVIOUS_SAID = re.compile(r"not a copy of @previous|@previous is the moment before", re.I)
# A prompt file split by "<!-- ops: a b -->" markers: the part before the first is for every op.
SECTION = re.compile(r"^<!-- ops: ([a-z_ ]+) -->\s*$", re.M)
# Where a prompt's role lines go: one line per ref role, written from common.schema.json's
# refRoleTable at load, so the prompt and the role picker never differ (contract 3).
ROLE_LINES = "<!-- role-lines -->"
# Where director.v7's camera values and their words go, from common.schema.json's cameraWords
# (features/frame-change-edit.clan): the chips, the prompt and the passthrough's lexicon read one table.
CAMERA_WORDS = "<!-- camera-words -->"
# The shortest verbatim run of the shot's own text that counts as given, not added (_given_words).
QUOTE_MIN = 20
# Change this frame (features/frame-change-edit.clan): the readings, the ops it runs as, and the
# camera leaves that only move the camera (no new still).
READINGS = ("camera", "local", "both")
MOVE_LEAVES = {"movement", "movement_speed"}
# Words that name the continuity frames a frame_edit never has (the old framing would come back).
CONTINUITY_WORDS = re.compile(r"@(?:anchor|previous)\b|\b(?:anchor|previous) (?:frame|shot|picture|image)\b", re.I)
# An edit's closing line, which a redraw never says: it brings the old people back (features/frame-edit-or-redraw.clan).
EVERYTHING_STAYS = re.compile(r"everything else(?: in @[a-z0-9_]+)? stays(?: exactly)? as it is", re.I)
# A redraw's prompt places its people in the shot's framing (features/frame-edit-or-redraw.clan, 2026-11-17: shot 4,
# an insert, redrawn as "an Indian seller and Nigerian buyers" kept the old seller and put the new one on the buyers' side).
# A shot with no people places its main objects instead, in the same words or by what they rest on (owner
# 2026-11-18: an insert of a lamp was refused for want of a person to place; director.v14).
PLACE_WORDS = re.compile(
    r"\b(?:behind|in front of|beside|next to|between|opposite|facing|where\b[^.]{0,40}\b(?:stands?|stood|sits?|sat|is|was|were)"
    r"|(?:on top of|underneath|under|beneath|against|leaning on|across) the"
    r"|(?:on|to|at) the (?:left|right|far left|far right|centre|center|middle|back|front)"
    r"|(?:left|right) of|in the (?:centre|center|middle|foreground|background|front|back)"
    r"|foreground|background|frame (?:left|right))", re.I)
# The cast frame's tag (input.castFrame): a neighbouring shot's redrawn frame, for who the people are.
CAST_TAG = re.compile(r"@cast\b", re.I)
# A recast ask's options (frame_edit and the Image editor's region_edit on a shot's frame).
RECAST_VALUES = ("redraw", "edit")
# Words that take one thing from a picture: "like @x", "@x's", "the dress of @x", "from @x", "as in @x".
DONOR = re.compile(r"(?:\blike|\bfrom|\bas in|\bof)\s+@([a-z][a-z0-9_]{2,15})\b|@([a-z][a-z0-9_]{2,15})'s\b")



_VIEW_WORDS = {0: "front", 45: "three-quarter", 90: "side", 180: "back", 270: "side", 315: "three-quarter"}


def _drop_unusable(job: dict, op: str, sheet: dict) -> None:
    """Remove a camera angle the routed provider cannot take, instead of failing the job.

    The prompt tells the model not to send them, but it sometimes does (2026-10-07: Haiku sent a
    camera `angle` for a Runway view, which has no angle control, and the whole job failed).
    Dropping it is safe: a view is said in words instead. Other stray fields still fail, by design."""
    spec = sheet["ops"].get(op, {})
    if op == "clip" and "durationS" in job:
        job["durationS"] = fit_duration(job["durationS"], spec)
    if "angle" in job and not sheet.get("angles"):
        angle = job.pop("angle")
        if op == "view":
            word = _VIEW_WORDS.get(int(round(angle.get("horizontal", 0))) % 360)
            if word and word.split("-")[0] not in job["prompt"].lower():
                job["prompt"] = f"{job['prompt'].rstrip()} Show the {word} view."


def _clip_edit_source(job: dict, op: str, payload: dict) -> None:
    """A clip edit always carries the clip it changes, first, as `current`: the adapter finds it
    there (Runway by its video type). The model sometimes leaves it out (a recorded reply with
    refs []), and every such job failed (pathway matrix, 2026-10-08)."""
    video = payload.get("video")
    if op not in ("clip_edit", "clip_patch") or not video:
        return
    refs = [r for r in job.get("refs") or [] if r.get("sha256") != video["sha256"]]
    job["refs"] = [{"sha256": video["sha256"], "name": "current", "role": "current"}, *refs]


def _say_in_words(job: dict, refs: list, character: str) -> None:
    for ref in refs:
        words = character or ref["name"].split("_")[0] if ref["role"] == "character" else ref["name"].replace("_", " ")
        job["prompt"] = re.sub(rf"@{re.escape(ref['name'])}\b", words, job["prompt"])


def _clip_frame_only(job: dict, op: str, sheet: dict) -> None:
    """Called after the artifact checks, so a ref that is not in the input still fails.

    Which pictures a clip carries is the model's (features/runway-video-models.clan): with no frame, its
    refs where the sheet says video.refsWithoutFrame (Hailuo 3, Omni Flash 1.1, WAN 3, Seedance), with a
    frame where it says firstFrameWithRefs (Kling O3), each up to refs.max; elsewhere they are said in words."""
    words_only = op == "clip" and not job.get("firstFrame") and bool((sheet["ops"].get(op) or {}).get("textEndpoint"))
    if op == "clip" and job.get("refs") and _refs_go(op, job, sheet):
        limit = sheet["refs"]["max"]
        if len(job["refs"]) > limit:  # the first ones go (the shot's own, front first); the rest in words
            _say_in_words(job, job["refs"][limit:], "")
            job["refs"] = job["refs"][:limit]
        return
    if words_only and job.get("refs"):
        # A clip straight from the script (no frame, ui-behaviour 3.5) on a model whose text endpoint
        # takes no pictures (Veo, Kling): a location or object ref goes, its name said in words. A
        # character cannot survive this way (it comes out a generic person, not the mascot: the owner's
        # @on ad, 2026-11): refuse rather than bake it into words, so a storyboard frame is made first
        # (the web does this in the Make room; this is the relay's defence in depth).
        if any(ref["role"] == "character" for ref in job["refs"]):
            model = job.get("model") or (sheet["ops"].get("clip") or {}).get("model") or "this model"
            raise DirectorError(f"a clip with a character and no first frame cannot carry the character "
                                f"on {model}; make a storyboard frame first")
        for ref in job["refs"]:
            words = ref["name"].replace("_", " ")
            job["prompt"] = re.sub(rf"@{re.escape(ref['name'])}\b", words, job["prompt"])
        job["refs"] = []
        return
    if op == "clip" and job.get("firstFrame") and job.get("refs") and not sheet["video"]["firstFrameWithRefs"]:
        # 2026-10-07: every Runway clip failed ("cannot take a first frame together with refs").
        # The first frame is the storyboard frame, which already shows the character: keep it,
        # drop the refs, and say their names in words so the prompt names no missing ref.
        for ref in job["refs"]:
            words = "the character" if ref["role"] == "character" else ref["name"].replace("_", " ")
            job["prompt"] = re.sub(rf"@{re.escape(ref['name'])}\b", words, job["prompt"])
        job["refs"] = []


# The ops whose refs are a shot's (owner 2026-10-15, features/canvas-nodes.clan): the pictures its words
# name and those linked into it are required; the rest of its scope comes `optional`.
SHOT_OPS = ("frame", "clip")


def _refs_go(op: str, job: dict, sheet: dict) -> bool:
    """Whether this job can carry refs at all: a clip with a first frame only where the model takes
    both (video.firstFrameWithRefs: Kling O3), one from words alone only where its text endpoint takes
    references (video.refsWithoutFrame: Hailuo 3, Omni Flash 1.1, WAN 3, Seedance)."""
    if op != "clip":
        return True
    if job.get("firstFrame"):
        return bool(sheet["video"]["firstFrameWithRefs"])
    return bool(sheet["video"].get("refsWithoutFrame")) or not (sheet["ops"].get(op) or {}).get("textEndpoint")


def _hold_refs(op: str, job: dict, payload: dict, output: dict, sheet: dict) -> None:
    """The references a shot sends are the ones asked for (owner 2026-10-15: "instead of just using
    '@samurai' [it] used different references for the frames, unless it offers a definite advantage").

    - A frame or clip that can carry refs sends every required input ref (one without `optional`):
      an answer that leaves one out, or swaps it for another picture, is refused, and the relay then
      makes the job as written (the passthrough sends exactly the required refs).
    - An optional ref goes only with a reason in `added`; one sent without is taken out (its @tag is
      then said in words, below), and `added` keeps only the optional refs the job sends.
    """
    refs_in = payload.get("refs") or []
    optional = {r["asset"]["sha256"] for r in refs_in if r.get("optional")}
    if op in SHOT_OPS and _refs_go(op, job, sheet):
        sent = {r["sha256"] for r in job.get("refs") or []}
        missing = [r for r in refs_in if not r.get("optional") and r["asset"]["sha256"] not in sent]
        if missing:
            r = missing[0]
            raise DirectorError(f"left out @{r.get('tag') or r.get('name') or r['id']}, which the shot asks for")
    why = {a["name"]: a["why"].strip() for a in output.get("added") or [] if (a.get("why") or "").strip()}
    job["refs"] = [r for r in job.get("refs") or [] if r["sha256"] not in optional or r["name"] in why]
    added = [{"name": r["name"], "why": why[r["name"]][:120]} for r in job["refs"] if r["sha256"] in optional]
    if added:
        output["added"] = added
    else:
        output.pop("added", None)


def call_timeout(base: float, payload: dict) -> float:
    """Dex's seconds for this job: more pictures, more to read (R2-3)."""
    n = len(payload.get("refs") or [])
    return min(CALL_MAX_S, max(base, base + CALL_S_PER_REF * max(0, n - CALL_REFS_FREE)))


def sheet_for(op: str, sheet: dict, payload: dict) -> dict:
    """The capability sheet as Dex reads it for one op (R2-3): the op's own entry and the models it can run on (its
    model, region model, alternates and the one picked), without prices' notes; the checks still use the whole sheet."""
    ops = {o: (sheet.get("ops") or {}).get(o) for o in (op, *RELATED_OPS.get(op, ()))}
    ops = {o: spec for o, spec in ops.items() if spec}
    want = {payload.get("model")}
    for spec in ops.values():
        want |= {spec.get("model"), spec.get("regionModel"), *(a.get("model") for a in spec.get("alternates") or [])}
    models = {m: {k: v for k, v in body.items() if k not in MODEL_DROP}
              for m, body in (sheet.get("models") or {}).items() if m in want}
    out = {k: v for k, v in sheet.items() if k not in SHEET_DROP and k not in ("ops", "models")}
    out["ops"] = ops
    if models:
        out["models"] = models
    return out


# A frame's closing sentence ("Full-bleed cinematic image; no text…", or the on-screen words' "no other text…") stays last.
_CLOSING = re.compile(r"(?:^|(?<=[.!?]) )((?:Full-bleed cinematic image|[^.]*\bno other text\b)[^.]*\.)\s*$")


def _add_line(job: dict, line: str, sheet: dict) -> None:
    """One of the relay's own lines into the prompt, before a frame's closing sentence, when the prompt has room."""
    prompt = (job.get("prompt") or "").rstrip()
    m = _CLOSING.search(prompt)
    said = f"{prompt[:m.start(1)].rstrip()} {line} {m.group(1)}" if m else f"{prompt} {line}"
    said = said.strip()
    limit = prompt_max(sheet, job.get("model") or "")
    if limit is None or utf16_units(said) <= limit:
        job["prompt"] = said


def _no_other_brands(job: dict, op: str, sheet: dict) -> None:
    """A generate or a frame paints no brand the job did not ask for (R2-13). Not an edit of a picture (a frame_edit,
    a region_edit), which keeps what it has."""
    if op in BRAND_FREE_OPS and not _BRANDS_SAID.search(job.get("prompt") or ""):
        _add_line(job, NO_OTHER_BRANDS, sheet)


def _previous_is_not_a_copy(job: dict, op: str, sheet: dict) -> None:
    """A frame sent with the shot before (@previous) draws its own moment, never that picture again (R2-4)."""
    if op == "frame" and any(r.get("name") == "previous" for r in job.get("refs") or []) \
            and not _PREVIOUS_SAID.search(job.get("prompt") or ""):
        _add_line(job, PREVIOUS_IS_NOT_A_COPY, sheet)


def strict_palette(payload: dict) -> bool:
    """The job's palette is the only colours (its text says Strict:); otherwise it is accents."""
    return any(i.get("kind") == "palette" and str(i.get("text") or "").lstrip().lower().startswith("strict")
               for i in payload.get("context") or [])


def _palette_as_accents(job: dict, op: str, payload: dict) -> None:
    """A palette is the brand's accents, never the only colours, unless it says Strict (R3-2)."""
    if op not in PALETTE_OPS or strict_palette(payload) or not job.get("prompt"):
        return
    prompt = _ONLY_COLOURS.sub("with the brand colours as accents", job["prompt"])
    job["prompt"] = _KEEP_TO_PALETTE.sub("with touches of the brand palette as accents", prompt)


def schema_for(op: str, schema: dict, payload: Optional[dict] = None) -> dict:
    """The director schema as Dex reads it for one op (round 3, R2-3): only the fields its answer
    may hold (a plan's shots, a Change this frame's reading, a clip's video fields, the brief's flags when there is a
    brief). Every answer is still checked against the whole schema (_check)."""
    payload = payload or {}
    props = dict(schema.get("properties") or {})
    if op == "shot_list":
        for k in ("providerJob", "frameEdit", "added"):
            props.pop(k, None)
    else:
        props.pop("shots", None)
        if op != "frame_edit":
            props.pop("frameEdit", None)
    if not payload.get("brief"):
        props.pop("briefFlags", None)
    if op in IMAGE_OPS and isinstance(props.get("providerJob"), dict):
        pj = dict(props["providerJob"])
        pj["properties"] = {k: v for k, v in (pj.get("properties") or {}).items() if k not in VIDEO_ONLY_FIELDS}
        if pj.get("required"):
            pj["required"] = [k for k in pj["required"] if k in pj["properties"]]
        props["providerJob"] = pj
    out = {k: v for k, v in schema.items() if k not in ("properties", "allOf", "required")}
    out["properties"] = props
    out["required"] = [k for k in schema.get("required") or [] if k in props]
    if op == "frame_edit":
        out["allOf"] = schema.get("allOf") or []
    else:
        work = "shots" if op == "shot_list" else "providerJob"
        out["allOf"] = [{"if": {"properties": {"question": {"type": "null"}}}, "then": {"required": [work]}}]
    return out


def without_descriptions(node):
    """A schema without its descriptions: from director.v17 the prompt says what each field is (R2-3: they were
    4.4 KB of every ask). Validation keeps the whole schema."""
    if isinstance(node, list):
        return [without_descriptions(x) for x in node]
    if not isinstance(node, dict):
        return node
    return {k: without_descriptions(v) for k, v in node.items() if not (k == "description" and isinstance(v, str))}


def drop_sections(common: str, payload: Optional[dict]) -> str:
    """The shared part of a prompt without the sections this job's input has nothing for (no context, no brief)."""
    if payload is None:
        return common
    parts = re.split(r"(?m)^(?=## )", common)
    keep = [p for p in parts if not any(p.startswith(h) and not payload.get(need) for h, need in SECTION_NEEDS.items())]
    return "".join(keep)


def provider_sizes(provider: str, op: str, model: Optional[str] = None) -> Optional[frozenset]:
    """The sizes the provider's endpoint takes for this op and model, or None where it takes any W:H
    (or none). The one place the tables are read: provider_ratio, the relay mock and the crop all go
    through it (runway-sheet-sync will point it at the capability sheet)."""
    if provider != "runway" or (provider, op) in NO_RATIO:
        return None
    if op == "clip":
        return clip_sizes(model)
    pro = model == "gemini_image3_pro" or (model is None and op == "region_edit")
    return PRO_RATIOS if pro else FLASH_RATIOS


@lru_cache(maxsize=None)
def clip_sizes(model: Optional[str]) -> frozenset:
    """A Runway clip model's sizes, from the catalogue (features/runway-video-models.clan): pixel pairs
    (Veo, Kling, Omni Flash, WAN, Seedance) or aspect ratios (Hailuo 3, whose size is a resolution).
    Veo's four for the op's own model or one the catalogue does not list."""
    from providers.types import load_sheet
    m = (load_sheet("runway").get("models") or {}).get(model or "") or {}
    sizes = frozenset(r["ratio"] for r in m.get("ratios") or [] if re.fullmatch(r"[0-9]+:[0-9]+", r["ratio"]))
    return sizes or RUNWAY_CLIP_RATIOS


def provider_ratio(provider: str, op: str, ratio: Optional[str], model: Optional[str] = None,
                   aspect: Optional[dict] = None) -> Optional[str]:
    """The job's shape in the provider's form: `aspect` ({w, h}, a format's exact shape or the
    picture's own) when given, else `ratio` ('9:16'). None where the endpoint takes none; Runway's
    nearest allowed pixel pair for the model (Gemini 3 Pro and 3.1 Flash take different sizes),
    matched by shape whatever the terms (1080:1920, 191:100); W:H as it is for the others."""
    if aspect and aspect.get("w") and aspect.get("h"):
        target = f"{int(aspect['w'])}:{int(aspect['h'])}"
    else:
        target = ratio
    if not target or (provider, op) in NO_RATIO or model in NO_RATIO_MODELS:
        return None
    allowed = provider_sizes(provider, op, model)
    if allowed is None:
        return target
    return target if target in allowed else _nearest_ratio(target, allowed)


def _nearest_ratio(ratio: str, allowed) -> Optional[str]:
    """The allowed 'W:H' of nearly the same shape as `ratio` ('9:16', '1080:1920', '191:100') and
    closest to 1 MP. Every result is an allowed size, so any shape snaps (frame-aspect: the old cap
    of terms 32 or less left a format's exact size unsnapped, and the job failed)."""
    try:
        w, h = (int(x) for x in ratio.split(":"))
    except ValueError:
        return None
    if not allowed or w <= 0 or h <= 0:
        return None
    target = math.log(w / h)

    def shape(r: str) -> float:
        a, b = (int(x) for x in r.split(":"))
        return abs(math.log(a / b) - target)

    def area(r: str) -> float:
        a, b = (int(x) for x in r.split(":"))
        return abs(math.log(a * b / 1_048_576))

    best = min(shape(r) for r in allowed)
    return min((r for r in allowed if shape(r) <= best + 0.04), key=lambda r: (area(r), r))


# "of anchor", "from the previous frame": the anchor and previous frames named without their @ (v5, 2026-10-09).
_BARE_ANCHOR = re.compile(r"\b(of|from|in|as|with|like|match|matches|keep) (?:the )?(anchor|previous)(?: frame)?\b(?!-)")
_CHARACTER_LINE = re.compile(r"The character is @([a-z][a-z0-9_]{2,15}), exactly as in that picture\.\s*")


def _tag_anchors(job: dict) -> None:
    """The anchor and previous frames, when sent, are named by their tags, so the model ties the words to them."""
    sent = {r["name"] for r in job.get("refs") or []} & {"anchor", "previous"}
    if sent:
        job["prompt"] = _BARE_ANCHOR.sub(lambda m: f"{m.group(1)} @{m.group(2)}" if m.group(2) in sent else m.group(0), job["prompt"])


def _one_character_line(job: dict) -> None:
    """One line names every picture of the character, not one line per picture."""
    names = _CHARACTER_LINE.findall(job["prompt"])
    if len(names) < 2:
        return
    tags = ", ".join(f"@{n}" for n in names[:-1]) + f" and @{names[-1]}"
    first = True

    def once(m):
        nonlocal first
        if not first:
            return ""
        first = False
        return f"The character is {tags}, exactly as in those pictures. "
    job["prompt"] = _CHARACTER_LINE.sub(once, job["prompt"]).strip()


_CHARACTER_LIST = re.compile(r"The character is ((?:@[a-z][a-z0-9_]{2,15})(?:(?:, | and |, and )@[a-z][a-z0-9_]{2,15})+), exactly as in those pictures\.")


def _views_are_one(job: dict, op: str, payload: dict) -> None:
    """Views of one character are ONE character (owner 2026-11-04: @bolt's four views, named as "The
    character is @bolt_front, @bolt_three_quart, @bolt_side and @bolt_back", came back as four robots on
    one workbench). Input refs are `key_variant`; character refs that share a key are said once, as one
    character seen from different sides. A view job makes one view of one picture and is left alone."""
    if op == "view":
        return
    key_of = {r["asset"]["sha256"]: (r.get("name") or "").rsplit("_", 1)[0]
              for r in payload.get("refs") or [] if "_" in (r.get("name") or "") and r.get("asset")}
    groups: dict[str, list[str]] = {}
    for r in job.get("refs") or []:
        key = key_of.get(r["sha256"])
        if key and r.get("role") == "character":
            groups.setdefault(key, []).append(r["name"])
    for tags in (t for t in groups.values() if len(t) > 1):
        said = ", ".join(f"@{n}" for n in tags[:-1]) + f" and @{tags[-1]}"
        line = f"{said} are views of one single character from different sides: show exactly one of it, never copies."
        m = _CHARACTER_LIST.search(job["prompt"])
        if m and set(re.findall(r"@([a-z0-9_]+)", m.group(1))) == set(tags):
            job["prompt"] = job["prompt"][:m.start()] + f"The character is the one in {said}, exactly as in those pictures; they are views of one single character from different sides, so show exactly one of it, never copies." + job["prompt"][m.end():]
        else:
            job["prompt"] = f"{job['prompt'].rstrip()} {line}"


def _donors_are_objects(job: dict, payload: dict) -> None:
    """A picture the words take one thing from ("like @x", "@x's shirt") is an object, never a second
    character (2026-10-09: 'like @handyman_front' merged two people). Only while another character stays."""
    donors = {a or b for a, b in DONOR.findall(payload.get("text") or "")}
    refs = job.get("refs") or []
    for r in refs:
        if r["name"] in donors and r["role"] == "character" and any(
                o is not r and o["role"] == "character" for o in refs):
            r["role"] = "object"


def _quoted_spans(prompt: str, source: str, covered: set[int]) -> None:
    """Mark in `covered` every prompt position inside a verbatim run of QUOTE_MIN or more characters
    of `source`."""
    if len(source) < QUOTE_MIN or len(prompt) < QUOTE_MIN:
        return
    grams = {source[i:i + QUOTE_MIN] for i in range(len(source) - QUOTE_MIN + 1)}
    for i in range(len(prompt) - QUOTE_MIN + 1):
        if prompt[i:i + QUOTE_MIN] in grams:
            covered.update(range(i, i + QUOTE_MIN))


def _given_words(prompt: str, payload: dict) -> int:
    """How much of `prompt` the person gave rather than the director (features/frame-change-edit.clan):
    their words, plus whatever repeats the shot's own action, direction or condensed direction verbatim
    in runs of QUOTE_MIN characters or more. An overlap, not added lengths: a paraphrase counts as the
    director's, and a passage quoted twice counts once. One measure for every op, and the eval's
    `length` score uses it too."""
    prompt = prompt or ""
    text = (payload.get("text") or "").strip()
    shot = payload.get("shot") if isinstance(payload.get("shot"), dict) else {}
    covered: set[int] = set()
    at = prompt.find(text) if text else -1
    if at >= 0:
        covered.update(range(at, at + len(text)))
    # A take's shots and timed lines (features/connected-video.clan) are given words like the one shot's.
    shots = [shot, *(s for s in payload.get("shots") or [] if isinstance(s, dict))]
    for s in shots:
        for field in ("action", "direction", "direction_condensed"):
            _quoted_spans(prompt, s.get(field) or "", covered)
    for cut in payload.get("cuts") or []:
        _quoted_spans(prompt, cut.get("text") or "", covered)
    return len(covered) + (len(text) if text and at < 0 else 0)


def _within_budget(job: dict, op: str, payload: dict) -> None:
    """What the director added beyond the participant's words stays near the op's budget."""
    budget = ADD_BUDGET.get(op)
    if budget is None:
        return
    if op == "clip" and payload.get("mode") in ("take", "take_refs"):
        # A take's timed lines are Dex's own words, one per shot: the anchor block's 300 and 120 a line
        # (features/frame-edit-or-redraw.clan; a 3-shot take on Omni Flash fell back at 556 added, 2026-11-17).
        budget += TAKE_LINE_BUDGET * len(payload.get("shots") or [])
    prompt = job.get("prompt") or ""
    for line in RELAY_LINES:  # the relay's own lines, said by Dex or added after: outside the budget (v16)
        prompt = prompt.replace(line, "")
    added = len(prompt) - _given_words(prompt, payload)
    if added > budget * 1.5:
        raise DirectorError(f"the director added {added} characters to the words; {op} allows about {budget}")


def _plain(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def _starts_with(prompt: str, words: str) -> bool:
    """The prompt begins with the person's words (case, spacing and their closing stop aside)."""
    w = _plain(words).rstrip(".!?;, ")
    return not w or _plain(prompt).startswith(w)


def _common_const(name: str, contracts: Path = CONTRACTS):
    return json.loads((contracts / "common.schema.json").read_text())["$defs"][name]["const"]


def role_lines(contracts: Path = CONTRACTS) -> str:
    table = _common_const("refRoleTable", contracts)
    return "\n".join(f"- `{role}`: {row['prompt_line']}" for role, row in table.items())


def camera_words(contracts: Path = CONTRACTS) -> dict:
    """common.schema.json's cameraWords: {field: {value: {label, words}}} (features/frame-change-edit.clan)."""
    return _common_const("cameraWords", contracts)


def camera_lines(contracts: Path = CONTRACTS) -> str:
    """The camera values and the words that mean them, one line per field, for director.v7's prompt."""
    lines = []
    for field, values in camera_words(contracts).items():
        said = "; ".join(f"`{v}` ({', '.join(row['words'])})" for v, row in values.items() if v != "graphic")
        lines.append(f"  - `{field}`: {said}")
    lines.append("  - `lens_mm`: a focal length in mm (8 to 800); `macro`: true for a macro lens")
    return "\n".join(lines)


def load_prompt(path: Path, contracts: Path = CONTRACTS) -> str:
    """A prompt file with its role lines and camera words filled in."""
    return path.read_text().replace(ROLE_LINES, role_lines(contracts)).replace(CAMERA_WORDS, camera_lines(contracts))


# An @name in a script or shot: key_variant (refName) or a bare key (relay/names.py MENTION).
MENTION = re.compile(r"(?<![\w@])@([a-z][a-z0-9]{1,23}(?:_[a-z0-9][a-z0-9-]{0,31})?)")


def _keep_script_names(payload: dict, shots: list) -> None:
    """A plan keeps the script's @names (owner 2026-10-15): where the script says a bare @samurai, a
    shot that names one of its views the script never names (@samurai_back) goes back to @samurai,
    in its words and its refs. Applied to every answer, so no prompt version can swap them."""
    said = set(MENTION.findall(payload.get("script") or ""))
    for s in payload.get("shots") or []:  # a re-plan's shots are the script's words too
        said |= set(MENTION.findall(" ".join(str(s.get(f) or "") for f in ("action", "direction"))))
        said |= set(s.get("refs") or [])
    bare = {n for n in said if "_" not in n}

    def back(name: str) -> str:
        key = name.split("_", 1)[0]
        return key if "_" in name and key in bare and name not in said else name

    for shot in shots:
        for field in ("action", "direction"):
            if shot.get(field):
                shot[field] = MENTION.sub(lambda m: "@" + back(m.group(1)), shot[field])
        for beat in shot.get("beats") or []:
            if beat.get("text"):
                beat["text"] = MENTION.sub(lambda m: "@" + back(m.group(1)), beat["text"])
        if shot.get("refs"):
            refs: list = []
            for n in shot["refs"]:
                if back(n) not in refs:
                    refs.append(back(n))
            shot["refs"] = refs


class DirectorError(Exception):
    """The director's answer cannot be used: it breaks the routed sheet or the job's own facts."""


@dataclass
class DirectorResult:
    output: dict       # validated against director.schema.json
    agent_block: dict  # director.schema.json#/$defs/agentBlock, logged with the job
    usage: dict        # {"input_tokens", "output_tokens"} the model reported


def load_schemas(root: Path = CONTRACTS) -> dict:
    return {p.name: json.loads(p.read_text()) for p in root.glob("*.schema.json")}


def _inline(node, schemas: dict, file: str, stack: tuple = ()):
    """Copy of `node` with every $ref replaced by what it points at (the port's validator
    and the provider's strict mode take one self-contained schema, not a file set)."""
    if isinstance(node, list):
        return [_inline(x, schemas, file, stack) for x in node]
    if not isinstance(node, dict):
        return node
    if "$ref" not in node:
        return {k: _inline(v, schemas, file, stack) for k, v in node.items()}
    target_file, _, pointer = node["$ref"].partition("#")
    target_file = target_file or file
    if (target_file, pointer) in stack:
        raise ValueError(f"recursive $ref {node['$ref']}")
    target = schemas[target_file]
    for part in filter(None, pointer.split("/")):
        target = target[part]
    resolved = _inline(target, schemas, target_file, stack + ((target_file, pointer),))
    # Keywords beside a $ref (a description) override the target's.
    return {**resolved, **{k: _inline(v, schemas, file, stack) for k, v in node.items() if k != "$ref"}}


def bundle(schemas: dict, name: str = "director.schema.json") -> dict:
    out = _inline(schemas[name], schemas, name)
    for key in ("$id", "$defs"):
        out.pop(key, None)
    return out


def _hashes(node) -> set:
    return set(SHA.findall(json.dumps(node)))


SPOKEN = {"line", "vo"}


def _sound(job: dict, inp: dict, sheet: dict, spec: dict) -> None:
    """A clip's sound by the one rule (sound.py, features/pt-film-r1.clan): the audio switch, and with sound on the
    spoken lines said in the prompt, timed in the take when it is one."""
    import connected
    import sound
    from providers.types import prompt_max
    starts = connected.take_plan(inp, spec)[1] if connected.mode_of(inp) in connected.TAKE_MODES and inp.get("shots") else None
    sound.apply(job, inp, sheet, starts=starts, prompt_max=prompt_max(sheet, job.get("model") or spec.get("model", "")))


# Sheet facts the relay acts on alone, never Dex's to weigh: left out of what Dex reads, so its input is unchanged.
RELAY_ONLY = ("refAspect",)


def _sheet_for_dex(sheet: dict) -> dict:
    """The capability sheet as Dex reads it: without the relay-only facts (refAspect: the relay pads a picture into
    a model's shape range itself, pt-film-r2 F5)."""
    models = sheet.get("models")
    if not isinstance(models, dict) or not any(k in m for m in models.values() if isinstance(m, dict) for k in RELAY_ONLY):
        return sheet
    return {**sheet, "models": {n: ({k: v for k, v in m.items() if k not in RELAY_ONLY} if isinstance(m, dict) else m) for n, m in models.items()}}


def _onscreen(job: dict, inp: dict) -> None:
    """No clock time in a clip's or a frame's prompt unless a shot asks for words on screen (onscreen.py; UAT 2026-11-21,
    F11; round 4, R4-F10)."""
    import onscreen
    onscreen.apply(job, inp)


def _without_dialogue(op: str, payload: dict) -> dict:
    """Spoken words (a shot's line and VO beats) are never sent to an image or video model: a model
    told the words draws them (a "Dialogue - ..." caption box in a frame, then in every clip made from
    it; decided 2026-10-07). Moments, music, sound and camera beats stay."""
    if op == "shot_list":
        return payload
    quiet = lambda s: {**s, "beats": [b for b in s["beats"] if b.get("kind") not in SPOKEN]} if isinstance(s, dict) and s.get("beats") else s  # noqa: E731
    out = dict(payload)
    if isinstance(payload.get("shot"), dict) and payload["shot"].get("beats"):
        out["shot"] = quiet(payload["shot"])
    if payload.get("shots"):  # a take's shots too: the web sends a clip's lines for its sound (sound.py)
        out["shots"] = [quiet(s) for s in payload["shots"]]
    return out


class Director:
    def __init__(self, model_port: ModelPort, prompt_dir: Path, sheets: dict, *,
                 per_click_model: Optional[str] = None, shot_list_model: Optional[str] = None,
                 prompt_version: str = "director.v6", contracts: Path = CONTRACTS):
        """No model ids: the port's own (its default route, resolved for its wire), never a bare id that one
        wire refuses (UAT 2026-11-18: "claude-sonnet-5-5" is not a Bedrock id). The relay passes its own
        (director/claude.py PER_CLICK, SHOT_LIST)."""
        self.port = model_port
        self._one_try = None  # (the port's wire, the same wire with no SDK retry) for long calls
        self.sheets = sheets
        port_model = getattr(model_port, "model", None) if model_port is not None else None
        self.per_click_model = per_click_model or port_model
        self.shot_list_model = shot_list_model or port_model
        self.prompt_dir = Path(prompt_dir)
        require_prompt(prompt_version)
        self.prompt_version = prompt_version
        self.system = load_prompt(self.prompt_dir / f"{prompt_version}.md", contracts)
        if prompt_number(prompt_version) >= 17:  # a palette is accents (R3-2); the contract's role line says "keep to"
            self.system = self.system.replace(PALETTE_ROLE_LINE, PALETTE_ROLE_LINE_V17)
        schemas = load_schemas(contracts)
        self.schema = bundle(schemas)
        registry = Registry().with_resources((BASE + n, Resource.from_contents(s)) for n, s in schemas.items())
        self._validate = lambda name, pointer="": Draft202012Validator(
            {"$ref": BASE + name + pointer}, registry=registry, format_checker=FormatChecker())

    def _port_for(self, payload: dict):
        """The model port for this job: the shared one, or for a job with many pictures (R2-3) a copy with more
        seconds and no SDK retry, since two long tries would outrun the relay's Lambda (60 s). model.py is the
        middleware's copy and stays as it is."""
        base = getattr(self.port, "timeout", None)
        if not isinstance(base, (int, float)):
            return self.port
        seconds = call_timeout(base, payload)
        if seconds <= base:
            return self.port
        port = copy.copy(self.port)  # shares the routes and what the endpoint refused
        port.timeout = seconds
        wire = getattr(self.port, "wire", None)
        client = getattr(wire, "client", None)
        if isinstance(wire, AnthropicWire) and client is not None and hasattr(client, "with_options"):
            if self._one_try is None or self._one_try[0] is not wire:
                one = copy.copy(wire)
                one.client = client.with_options(max_retries=0)
                self._one_try = (wire, one)
            port.wire = self._one_try[1]
        return port

    @property
    def sectioned(self) -> bool:
        return bool(SECTION.search(self.system))

    def schema_sent(self, op: str, payload: Optional[dict] = None) -> dict:
        """The schema Dex answers in: the whole one for a prompt before director.v17 (sent as it was, for a rollback);
        from v17 its op's cut (schema_for), without descriptions."""
        if prompt_number(self.prompt_version) < 17:
            return self.schema
        return without_descriptions(schema_for(op, self.schema, payload))

    def system_for(self, op: str, payload: Optional[dict] = None) -> str:
        """The prompt for one op: all of an unsectioned file; else the shared part and this op's section,
        or the fallback prompt for an op the file has no section for. With the job's `payload`, the shared
        sections it has nothing for are left out (drop_sections)."""
        parts = SECTION.split(self.system)
        if len(parts) == 1:
            return self.system
        # From director.v17 on (older prompts are sent byte for byte, for a rollback).
        common, sections = (drop_sections(parts[0], payload) if prompt_number(self.prompt_version) >= 17 else parts[0]), {}
        for ops, body in zip(parts[1::2], parts[2::2]):
            for o in ops.split():
                sections[o] = body
        tail = "\n\nAnswer with the JSON only.\n"
        body = sections.get(op, "").replace("Answer with the JSON only.", "").strip()
        return common.rstrip() + ("\n\n" + body if body else "") + tail

    def run(self, op: str, payload: dict, provider_name: Optional[str] = None, job_id: str = "",
            extra_hashes: tuple = (), images: Optional[list] = None) -> DirectorResult:
        """`payload` is the job's input (relay-api.schema.json#/$defs/JobInput). shot_list needs
        no provider, so `provider_name` may be None for it. `extra_hashes` are artifacts the relay
        made itself and the job may name though the input does not (a clip_edit keyframe).
        `images`: the pictures the model sees ({media_type, data}); only a frame_edit sends one, its
        current frame (features/frame-change-edit.clan). Every other op sends none."""
        sheet = None
        if op != "shot_list":
            sheet = self.sheets.get(provider_name)
            if sheet is None:
                raise DirectorError(f"no capability sheet for provider {provider_name!r}")
            if op not in sheet["ops"]:
                raise DirectorError(f"{provider_name} does not support {op}")
        model = self.shot_list_model if op == "shot_list" else self.per_click_model
        raw = payload  # the input as it came: its spoken lines go into a clip made with sound (sound.py), never to Dex
        payload = _without_dialogue(op, payload)
        # A linked brief (features/brief-node.clan), cut to this op's budget; no brief: the input as it came.
        payload = briefs.for_op(op, payload)
        # The project's brand rules and linked documents (features/pt-dex-context.clan), cut to this op's kinds and budget.
        payload = job_context.for_op(op, payload)
        ask = {"op": op, "input": payload}
        if sheet:
            ask["provider"] = provider_name
            ask["sheet"] = sheet_for(op, _sheet_for_dex(sheet), payload)  # relay-only fields out, then cut to the op
        given = record.for_record(payload)  # kept on the job even when Dex fails (R2-3)

        usage = Usage()
        t0 = time.monotonic()
        # The job's id rides on the call (features/pt-relay-trace.clan): the model port's log and ledger lines
        # name it, so a job's Dex call is found by its jobId. Metadata only (peripherals.md §0.2).
        headers = {"X-Napkin-Handler": "relay.director", "X-Napkin-Job": job_id} if job_id else None
        try:
            output = self._port_for(payload).call(PURPOSE, self.system_for(op, payload), ask,
                                                  self.schema_sent(op, payload), usage=usage,
                                                  attribution=job_id or op, model=model, headers=headers,
                                                  max_tokens=MAX_TOKENS.get(op, MAX_TOKENS_DEFAULT), effort=EFFORT.get(op),
                                                  images=list(images or []) if op in ("frame_edit", "clip_patch") else None)
        except Exception as e:
            e.given = given
            raise
        latency_ms = round((time.monotonic() - t0) * 1000)

        if op in VIDEO_OPS and "providerJob" in output:
            output["providerJob"].setdefault("audio", False)  # explicit on every video request
        briefs.settle_flags(output, payload)  # only lines of the brief this job was given
        try:
            self._check(op, payload, provider_name, sheet, output, set(extra_hashes))
        except DirectorError as e:
            e.answer = output  # what Dex wrote, for the relay's director_rejected line
            e.given = given
            raise
        if op in ("clip", "frame") and "providerJob" in output:
            # No clock time in a frame's prompt either (UAT round 4, R4-F10: "1 a.m." reached frame 1's prompt).
            _onscreen(output["providerJob"], raw)
        if op == "clip" and "providerJob" in output:
            _sound(output["providerJob"], raw, sheet, sheet["ops"][op])
        # What Dex was given, after the relay's cuts, kept small on the job record (features/pt-canvas-r1.clan).
        agent_block = {"model": model, "promptVersion": self.prompt_version, "output": output,
                       "rationale": output["rationale"], "latencyMs": latency_ms, "input": given}
        errs = list(self._validate("director.schema.json", "#/$defs/agentBlock").iter_errors(agent_block))
        if errs:
            raise DirectorError(f"agent block: {errs[0].message}")
        return DirectorResult(output, agent_block, usage.as_dict())

    def _check(self, op, payload, provider_name, sheet, output, extra=frozenset()) -> None:
        asked = op  # a frame_edit runs as frame below; its refs are Dex's to choose (frame-change-edit)
        errs = sorted(self._validate("director.schema.json").iter_errors(output), key=lambda e: list(e.path))
        if errs:
            raise DirectorError("; ".join(f"{'/'.join(map(str, e.path)) or '$'}: {e.message}" for e in errs[:5]))
        if output["op"] != op:
            raise DirectorError(f"answered op {output['op']!r} for {op!r}")
        if "providerJob" not in output:
            output.pop("added", None)  # additions are refs a provider job sends
        if op == "shot_list":
            if output.get("question") is not None:
                if "shots" in output:
                    raise DirectorError("answered with a question and shots; send one or the other")
                return
            self._check_shots(payload, output["shots"])
            _keep_script_names(payload, output["shots"])
            return
        if "shots" in output:
            raise DirectorError(f"shots belong to shot_list, not {op}")
        if op == "frame_edit":
            # Dex's reading resolves the op the provider job runs as; every check below runs under it.
            run_as = self._check_frame_edit(payload, output)
            if run_as is None:
                return  # a question, or a change of camera movement only: nothing to draw
            if output["frameEdit"].get("maskUnused"):
                payload = {k: v for k, v in payload.items() if k not in ("region", "mask")}
            op = run_as
        if output.get("question") is not None:
            if "providerJob" in output or "shots" in output:
                raise DirectorError("answered with a question and a job; send one or the other")
            if output["question"]["kind"] == "recast":
                if op != "region_edit" or not payload.get("shot") or payload.get("region") or payload.get("mask"):
                    raise DirectorError("a recast ask is only for a change to a whole storyboard frame")
                if payload.get("answer"):
                    raise DirectorError("asked again after the person chose")
                self._check_recast_ask(output["question"])
            if op == "clip_patch":
                if payload.get("answer"):  # "fix" (or words) was chosen; "remake" never comes back to Dex
                    raise DirectorError("asked again after the person chose to fix this moment")
                values = {o["value"].get("route") for o in output["question"].get("options", [])
                          if isinstance(o.get("value"), dict)}
                if not {"fix", "remake"} <= values:
                    raise DirectorError("a clip_patch asks only 'fix this moment or remake the clip': options fix and remake")
            return  # a question for a person: the job waits in needs_input
        if "providerJob" not in output:
            raise DirectorError("answered with neither a job nor a question")
        job = output["providerJob"]
        if "ratio" not in job and (payload.get("ratio") or payload.get("aspect")) and (job.get("provider"), op) not in NO_RATIO:
            # 2026-10-07: Haiku sometimes leaves out the ratio it was given ("frame needs a ratio").
            # Take it from the request; the nearest-size mapping below makes it fit the model.
            aspect = payload.get("aspect")
            job["ratio"] = payload.get("ratio") or f"{aspect['w']}:{aspect['h']}"
        if "angle" not in job:
            # A model that leaves out a view's angle would fail the job on an angle-taking provider.
            angle = view_angle(op, payload, sheet)
            if angle:
                job["angle"] = angle
        _drop_unusable(job, op, sheet)
        _clip_edit_source(job, op, payload)
        if job["provider"] != provider_name:
            raise DirectorError(f"wrote a {job['provider']} job for the routed provider {provider_name}")
        models = {sheet["ops"][op]["model"], sheet["ops"][op].get("regionModel")}
        if job["model"] not in models:
            # The routing chose the model, not the director: a reply naming another one (an older
            # default, a recorded answer) runs on the sheet's (features/default-models.clan).
            job["model"] = sheet["ops"][op]["model"]
        stray = _hashes(job) - _hashes(payload) - extra
        if stray:
            raise DirectorError(f"the job names artifacts that are not in the input: {sorted(stray)[0]}")
        _clip_frame_only(job, op, sheet)
        _hold_refs(asked, job, payload, output, sheet)
        if op == "clip":
            # Defence in depth (the owner's @on ad came out a generic person, 2026-11): a clip that asks for
            # a character but has no first frame, on a model that cannot carry references without one, would
            # reach the model with the character dropped. Key on the INPUT refs, not the job's: a prompt-
            # obedient Dex already sent refs=[], so checking the output is too late. The web makes a storyboard
            # frame first (it carries the character); here we refuse rather than make a character-less clip.
            if not job.get("firstFrame") and not sheet["video"].get("refsWithoutFrame") and any(
                    r.get("role") == "character" and not r.get("optional") for r in payload.get("refs") or []):
                raise DirectorError(f"a clip with a character and no first frame cannot carry the character "
                                    f"on {job['model']}; make a storyboard frame first")
            # A take, a landing frame or a take's window (features/connected-video.clan): the frames, refs and
            # length are the mode's, whatever was written; a take prompt that does not time the plan is refused.
            import connected
            try:
                connected.shape(job, payload, sheet, sheet["ops"][op], passthrough=False)
            except ValueError as e:
                raise DirectorError(str(e)) from e
        names = [r["name"] for r in job["refs"]]
        if len(set(names)) != len(names) or not all(TAG.match(n) for n in names):
            raise DirectorError(f"ref names must be unique canonical tags: {names}")
        if any(r["role"].startswith("element") for r in job["refs"]):
            raise DirectorError(f"{provider_name} has no elements")
        if op == "clip_patch" and ("keyframe" in job or "keyframes" in job):
            # Fix this moment's keyframe follows the relay's policy (features/clip-moment-edit.clan).
            raise DirectorError("a clip_patch keyframe is the relay's; write the prompt only")
        if "keyframe" in job:
            if sheet["video"]["regionEdit"] != "temporal_keyframe":
                raise DirectorError(f"{provider_name} takes no keyframe edit")
            self._check_keyframe(job["keyframe"])
        if "strength" in job and sheet["video"]["feelEdit"] != "strength":
            raise DirectorError(f"{provider_name} takes no edit strength")
        if self.sectioned:
            _tag_anchors(job)
            _one_character_line(job)
            _donors_are_objects(job, payload)
            _within_budget(job, op, payload)
        _views_are_one(job, op, payload)  # the relay's own words: outside the director's budget
        _previous_is_not_a_copy(job, asked, sheet)
        _no_other_brands(job, asked, sheet)
        _palette_as_accents(job, asked, payload)
        view_subject(job, op, payload)  # a view of a person goes as a person, and says who (pt-canvas-r1)
        self._check_provider_limits(op, sheet, job, payload)
        # A named input picture this job does not send (a model that takes no refs, Veo 3.1 Fast) is said
        # in words. A name in none of the input, or @current/@anchor/@previous without their picture (the
        # frame would lose its continuity), is still refused, and the relay makes the job as written.
        given = {r.get("tag") for r in payload.get("refs") or [] if r.get("tag")}
        job["prompt"] = TAG_IN_TEXT.sub(
            lambda m: m.group(0) if m.group(1) in names or m.group(1) not in given else unsent_in_words(m.group(0), []),
            job["prompt"])
        try:
            rewrite_tags(job["prompt"], names, sheet["tagSyntax"])
            check_capabilities(sheet, ProviderJob.from_director(op, job))
        except (CapabilityMissing, UnknownTag) as e:
            raise DirectorError(str(e)) from e
        if op == "region_edit":
            self._check_region_edit(payload, sheet, job)

    def _check_frame_edit(self, payload: dict, output: dict) -> Optional[str]:
        """Change this frame (features/frame-change-edit.clan): hold Dex's reading of the words to what
        the schema cannot say, and resolve the op the job runs as (output.frameEdit.runAs). None when
        nothing is to be drawn: a question, or a change of camera movement only (its providerJob, if
        any, is dropped). Raises DirectorError, and the passthrough then makes the job."""
        edit, question = output.get("frameEdit"), output.get("question")
        answer = payload.get("answer") or {}
        value = answer.get("value")
        chosen = value if value in READINGS else None
        redraw = payload.get("mode") == "redraw" or value == "redraw"  # features/frame-edit-or-redraw.clan
        if question is not None:
            if redraw:
                raise DirectorError("a redraw never asks")
            if value:
                raise DirectorError(f"asked again after the person chose {value}")
            if edit is not None or "providerJob" in output:
                raise DirectorError("answered with a question and a reading; send one or the other")
            if question["kind"] == "recast":
                self._check_recast_ask(question)
            else:
                self._check_frame_edit_ask(question)
            return None
        if edit is None:
            raise DirectorError("a frame_edit answer needs frameEdit, its reading of the words")
        reading = edit["reading"]
        edit.pop("words_as_given", None)  # the passthrough's mark ("Dex sent your words as they are"), never Dex's
        if redraw:
            return self._check_redraw(payload, output, edit)
        if reading == "redraw":
            raise DirectorError("only a redraw is read as redraw; the person chose to edit")
        edit.pop("who", None)  # who is where: a redraw's line only
        if chosen and reading != chosen:
            raise DirectorError(f"read the words as {reading}, but the person chose {chosen}")
        patch = edit.get("camera") or {}
        if reading == "local":
            if patch:
                raise DirectorError("a local change changes no camera field")
            edit.pop("camera", None)
        else:
            was = ((payload.get("shot") or {}).get("camera")) or {}
            changed = {k: v for k, v in patch.items() if was.get(k) != v}
            if not changed:
                raise DirectorError(f"a {reading} change must change at least one camera field")
            edit["camera"] = changed  # a leaf that keeps its value is no change
        regioned = bool(payload.get("region") or payload.get("mask"))
        if reading == "local":
            run_as = "region_edit" if regioned else "frame"  # without a box: an instruction edit
        elif reading == "camera" and set(edit["camera"]) <= MOVE_LEAVES:
            run_as = "none"
        else:
            run_as = "frame"
        edit["runAs"] = run_as
        if reading != "local" and regioned:
            edit["maskUnused"] = True  # a camera change redraws the whole frame (Laurence's step 4)
        else:
            edit.pop("maskUnused", None)
        if run_as == "none":
            output.pop("providerJob", None)  # the still stays; the clip takes the new move
            return None
        job = output.get("providerJob")
        if job is None:
            raise DirectorError(f"a {reading} change runs as {run_as} and needs a providerJob")
        if CONTINUITY_WORDS.search(job["prompt"]):
            raise DirectorError("a changed frame names no anchor or previous frame")
        if not _starts_with(job["prompt"], payload.get("text") or ""):
            raise DirectorError("a frame_edit prompt starts with the person's words, as written")
        image = payload["image"]["sha256"]
        job["refs"] = [{"sha256": image, "name": "current", "role": "current"},
                       *[r for r in job.get("refs") or [] if r["sha256"] != image]]
        if edit.get("maskUnused"):
            job.pop("mask", None)
            job.pop("region", None)
        return run_as

    @staticmethod
    def _has_people(payload: dict) -> bool:
        """Whether the shot redrawn has people, as far as its input says: a character among its pictures, or a
        cast frame (a neighbouring shot redrawn with new people)."""
        return bool(payload.get("castFrame")) or any(isinstance(r, dict) and r.get("role") == "character"
                                                    for r in payload.get("refs") or [])

    @staticmethod
    def _check_redraw(payload: dict, output: dict, edit: dict) -> str:
        """Redraw frame (features/frame-edit-or-redraw.clan): drawn again from the shot and the words, as frame,
        with the current frame for its place and light only. Never a previous frame, an anchor or the edit's
        "everything else stays": the old people would come back (live test 2026-11-17, T1 against T3)."""
        if edit["reading"] != "redraw":
            raise DirectorError(f"a redraw is read as redraw, not {edit['reading']}")
        was = ((payload.get("shot") or {}).get("camera")) or {}
        changed = {k: v for k, v in (edit.get("camera") or {}).items() if was.get(k) != v}
        if changed:
            edit["camera"] = changed
        else:
            edit.pop("camera", None)
        edit["runAs"] = "frame"
        if payload.get("region") or payload.get("mask"):
            edit["maskUnused"] = True  # the whole frame is drawn again
        else:
            edit.pop("maskUnused", None)
        job = output.get("providerJob")
        if job is None:
            raise DirectorError("a redraw runs as frame and needs a providerJob")
        if CONTINUITY_WORDS.search(job["prompt"]):
            raise DirectorError("a redraw names no anchor or previous frame")
        if EVERYTHING_STAYS.search(job["prompt"]):
            raise DirectorError("a redraw never says everything else stays as it is")
        if not PLACE_WORDS.search(job["prompt"]):
            # The check is the same with no people: their place is the main objects' (owner 2026-11-18).
            if Director._has_people(payload):
                raise DirectorError("a redraw says where each person stands in the frame (behind the stall, on the left, …)")
            raise DirectorError("a redraw of a shot with no people says where its main objects sit in the frame "
                                "(on the side table on the right, in the foreground, …)")
        who = (edit.get("who") or "").strip()
        if not who:
            raise DirectorError("a redraw says who is where in frameEdit.who")
        edit["who"] = who
        cast = payload.get("castFrame")
        if cast and not CAST_TAG.search(job["prompt"]):
            raise DirectorError("a redraw with a cast frame says its people are the ones in @cast")
        if not cast and CAST_TAG.search(job["prompt"]):
            raise DirectorError("@cast names a cast frame this redraw was not sent")
        image = payload["image"]["sha256"]
        kept = [r for r in job.get("refs") or []
                if r["sha256"] != image and r.get("name") not in ("previous", "anchor", "cast")
                and (not cast or r["sha256"] != cast["sha256"])]
        job["refs"] = [{"sha256": image, "name": "current", "role": "current"},
                       *([{"sha256": cast["sha256"], "name": "cast", "role": "object"}] if cast else []), *kept]
        job.pop("mask", None)
        job.pop("region", None)
        return "frame"

    @staticmethod
    def _check_recast_ask(question: dict) -> None:
        """A recast (features/frame-edit-or-redraw.clan): the words swap who is in the picture, which an edit
        cannot do. Options redraw and edit, each id its value, redraw recommended, no typed answer, no cost."""
        options = question.get("options") or []
        values = [o.get("value") for o in options]
        if sorted(values) != sorted(RECAST_VALUES) or any(o["id"] != o.get("value") for o in options):
            raise DirectorError(f"a recast offers redraw and edit, each id its value: {values}")
        if question.get("recommended_option_id") != "redraw":
            raise DirectorError("a recast recommends redraw")
        question["options"] = sorted(({k: v for k, v in o.items() if k != "cost"} for o in options),
                                     key=lambda o: RECAST_VALUES.index(o["value"]))
        question["allow_text"] = False

    @staticmethod
    def _check_frame_edit_ask(question: dict) -> None:
        """Bigger how? is an ambiguity with fixed options camera / local / both (each id its value), no
        recommendation and no typed answer. Options carry no cost (owner decision 2026-10-13)."""
        if question["kind"] != "ambiguity":
            raise DirectorError(f"a frame_edit asks only when the words could mean two things, not a {question['kind']}")
        if question.get("recommended_option_id"):
            raise DirectorError("an ambiguity recommends no option")
        values = [o.get("value") for o in question["options"]]
        if (any(o["id"] != o.get("value") for o in question["options"]) or len(set(values)) != len(values)
                or not set(values) <= set(READINGS) or not {"camera", "local"} <= set(values)):
            raise DirectorError(f"a frame_edit question offers camera, local and maybe both, each id its value: {values}")
        question["options"] = sorted(({k: v for k, v in o.items() if k != "cost"} for o in question["options"]),
                                     key=lambda o: READINGS.index(o["value"]))
        question["allow_text"] = False

    @staticmethod
    def _check_keyframe(kf: dict) -> None:
        # aleph2 takes the range whole or not at all, end exclusive, and keyframe seconds 0..30.
        start, end, at = kf.get("startS"), kf.get("endS"), kf["atS"]
        if (start is None) != (end is None):
            raise DirectorError("keyframe startS and endS go together")
        if start is not None and not start <= at < end:
            raise DirectorError(f"keyframe atS {at} is outside the range {start}..{end} (end exclusive)")
        if at > KEYFRAME_MAX_S:
            raise DirectorError(f"keyframe atS {at} is past {KEYFRAME_MAX_S} s")

    @staticmethod
    def _check_region_edit(payload: dict, sheet: dict, job: dict) -> None:
        image = payload["image"]["sha256"]
        if not any(r["role"] == "current" and r["sha256"] == image for r in job["refs"]):
            raise DirectorError("a region edit needs the edited image as a ref with role current")
        region, mask = payload.get("region"), payload.get("mask")
        # Masked wherever the sheet takes masks, whatever the box's size
        # (features/harness-refusals.clan; the 25% rule is gone).
        masked = bool(region and mask and sheet["mask"] != "none")
        if masked and job.get("mask") != mask["sha256"]:
            raise DirectorError("a region with a mask on a sheet that takes masks is a masked inpaint: send the mask")
        if not masked and job.get("mask"):
            raise DirectorError("this region is a reference-based regenerate (no mask, or the sheet takes none): send no mask")
        if masked:
            # Only the image goes with a mask (director.v4): an edit model copies other pictures into
            # the mask, so the anchor and previous frames are dropped if the model sent them.
            anchors = {a["sha256"] for a in (payload.get("anchorFrame"), payload.get("previousFrame")) if a}
            dropped = {r["name"] for r in job["refs"] if r["role"] != "current" and r["sha256"] in anchors}
            job["refs"] = [r for r in job["refs"] if r["role"] == "current" or r["sha256"] not in anchors]
            for name in dropped:  # their @tags would name a picture the job no longer carries
                job["prompt"] = re.sub(rf"@{re.escape(name)}\b", f"the {name} frame", job["prompt"])

    @staticmethod
    def _check_provider_limits(op: str, sheet: dict, job: dict, payload: Optional[dict] = None) -> None:
        provider = job["provider"]
        # The model's own limit, from the catalogue, counted as Runway counts (UTF-16 code units).
        limit = prompt_max(sheet, job.get("model") or sheet["ops"][op]["model"])
        if limit and utf16_units(job["prompt"]) > limit:
            raise DirectorError(f"{provider} {op} prompt is {utf16_units(job['prompt'])} characters, over its {limit}")
        ratio = job.get("ratio")
        if ratio and ((provider, op) in NO_RATIO or job.get("model") in NO_RATIO_MODELS):
            # The model often copies the ratio it was given; the frame or clip sets the shape here,
            # so it is dropped rather than failing the job (2026-10-09).
            del job["ratio"]
        elif ratio and provider == "runway":
            # The model often writes the plain ratio it was given ('9:16'); map it to the nearest
            # size this model takes rather than failing the job (2026-10-07: storyboard frames).
            # The input's exact shape (frame-aspect) sets the size over what the model wrote: the
            # model may round a 191:100 banner to 2:1, and the relay crops to the input's shape.
            aspect = (payload or {}).get("aspect")
            fitted = provider_ratio(provider, op, ratio, job.get("model"), aspect=aspect)
            if not fitted:
                raise DirectorError(f"runway {op} does not take ratio {ratio!r}")
            job["ratio"] = fitted
        spec = sheet["ops"][op]
        if op == "clip" and "durationS" not in job and ("durationsS" in spec or "minS" in spec):
            raise DirectorError("a clip needs a durationS the sheet allows")
        if op == "clip_edit" and "durationS" in job and (
                job["model"] == spec.get("regionModel") != spec["model"] or sheet["video"]["regionEdit"] == "temporal_keyframe"):
            raise DirectorError(f"{provider} takes no duration for this clip edit")

    @staticmethod
    def _check_shots(payload: dict, shots: list) -> None:
        ids = [s["id"] for s in shots if s.get("id")]
        if len(set(ids)) != len(ids):
            raise DirectorError("shot ids must be unique")
        known = {r["name"] for r in payload.get("refs") or [] if r.get("name")}
        # A bare key names the whole character, and only a key with a front can be named bare.
        known |= {n.split("_", 1)[0] for n in known if n.endswith("_front")}
        for i, s in enumerate(shots, 1):
            unknown = [n for n in s.get("refs") or [] if n not in known]
            if unknown:
                raise DirectorError(f"shot {i} names {unknown[0]!r}, which is not an input ref")
            late = [b for b in s.get("beats") or [] if b["at_s"] > s["duration_s"]]
            if late:
                raise DirectorError(f"shot {i} has a beat at {late[0]['at_s']} s, past its {s['duration_s']} s")
        target = payload.get("targetS")
        total = sum(s["duration_s"] for s in shots)
        if target is not None and abs(total - target) > 0.5:
            raise DirectorError(f"shots add up to {total} s, not the {target} s asked for")
