"""The layout library as data, and the plan that binds a deck to it (deck-layout-library, slice 4).

``engine/deck/layouts/*.yaml`` hold 36 layouts (contract ``docs/contracts/deck-visuals.md`` section 5), checked on load
against ``schemas/layout.schema.json``. This module has:

* ``load`` / ``family`` / ``accepts``: the library, one file per layout.
* ``pick``: the rule table. ``render_pptx.choose_layout`` is a call into it, so there is one table (priority and ``when``).
* ``bind``: shown blocks to named slots (``slide.slots``), with ``block_unbound`` and ``slot_limit`` findings.
* ``capacity``: a slot's ``max_chars``, derived from its box (``Renderer.slot_boxes``) and the role's size.
* ``plan``: the measured fit ladder. Pure and deterministic, always from the base deck plus the cumulative fixes. It
  never edits a block, a note, a claim or the order: everything it decides is an overlay (``slide.layout`` with
  ``fit.moved``, ``slide.slots``, ``meta.layout_title_pt``). ``strip_plan`` removes exactly those keys.

The interface to slice 5 (the repair loop) is ``plan(base_deck, library, prefs, swaps, hooks, fixes) -> (deck, issues, pending)``.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
import sys
import time
from pathlib import Path

import yaml

from . import images, spec

DIR = Path(__file__).with_name("layouts")
#: deck-look steps 3-4: the layouts laid over the library under ``spec.LOOK_V3`` (new ids and reworks).
V3_DIR = DIR / "v3"
SCHEMA = Path(__file__).with_name("schemas") / "layout.schema.json"
#: The keys the plan owns: removed by ``strip_plan``, compared in golden_plan.json.
PLAN_KEYS = ("layout", "slots", "meta.layout_title_pt")
#: Slide types whose points never move to the notes (the evidence the buyer scores, the risks and guardrails, the ask and the numbers).
NEVER_MOVE_TYPES = ("criterion_answer", "scoring", "risks", "guardrails", "ask", "financials", "investment", "business_model", "measurement", "traction")
#: The words of a lean and a standard content slide, by density (spec.DENSITY_WORDS).
TITLE_SIZES = (36, 32, 30, 28)
_CACHE: dict = {}


class LibraryError(ValueError):
    """A layout file breaks the library's rules."""


# ---------------------------------------------------------------------------------------------------------- load
def load(directory: Path | None = None, force: bool = False) -> dict:
    """``{id: layout}`` in file order (priority breaks ties by it). Every file is validated against the schema and the
    library's own rules: id equals the file name, in ``spec.LAYOUT_IDS``, at most ``spec.LAYOUT_MAX``, ``for_types`` in
    ``spec.SLIDE_TYPES``, ``pick`` and ``family`` set, no ``max_line_in``, alternatives that exist.

    The default library under ``spec.LOOK_V3`` is the 36 files with ``layouts/v3`` laid over them (deck-look steps 3-4): a file there
    with a new id (``spec.LAYOUT_IDS_V3``) is added, one with an existing id replaces it. With the flag off it is the 36, unchanged."""
    v3 = directory is None and bool(spec.LOOK_V3)
    d = Path(directory) if directory else DIR
    key = str(d) + ("+v3" if v3 else "")
    if force:   # a forced reload re-reads the files: the recipe catalogue must not keep the old ones
        _CACHE.pop("catalogue", None)
    if key in _CACHE and not force:
        return _CACHE[key]
    import jsonschema
    schema = json.loads(SCHEMA.read_text())
    lib: dict = {}
    files = sorted(d.glob("*.yaml")) + (sorted(V3_DIR.glob("*.yaml")) if v3 else [])
    for f in files:
        lay = yaml.safe_load(f.read_text())
        try:
            jsonschema.validate(lay, schema)
        except jsonschema.ValidationError as e:
            raise LibraryError(f"{f.name}: {e.message}") from e
        if lay["id"] != f.stem:
            raise LibraryError(f"{f.name}: id {lay['id']!r} is not the file name")
        if lay["id"] not in spec.LAYOUT_IDS and not (f.parent == V3_DIR and lay["id"] in spec.LAYOUT_IDS_V3):
            raise LibraryError(f"{f.name}: {lay['id']} is not in spec.LAYOUT_IDS")
        for t in lay["for_types"]:
            if t not in spec.SLIDE_TYPES:
                raise LibraryError(f"{f.name}: unknown slide type {t}")
        for need in ("pick", "family"):
            if need not in lay:
                raise LibraryError(f"{f.name}: {need} is required")
        if any("max_line_in" in s for s in lay["slots"].values()):
            raise LibraryError(f"{f.name}: max_line_in is replaced by max_cpl")
        lib[lay["id"]] = lay
    if len(lib) > spec.LAYOUT_MAX:
        raise LibraryError(f"{len(lib)} layouts, at most {spec.LAYOUT_MAX}")
    for lay in lib.values():
        for ref in list(lay.get("alternatives") or []) + [lay.get("roomier"), lay.get("without_image")]:
            if ref and ref not in lib:
                raise LibraryError(f"{lay['id']}: {ref} is not a layout")
    _CACHE[key] = lib
    return lib


def catalogue() -> dict:
    """``{layout id: [slide types]}`` of every layout file, ``layouts/v3`` laid over the base whatever spec.LOOK_V3 says (deck-types: a
    recipe is checked against the whole catalogue, and a layout absent from the ACTIVE library is skipped at plan time). Read only: no
    schema pass and no cache shared with ``load``, so the active library is never touched. ``load(force=True)`` drops it, so it is read
    again after a forced reload."""
    key = "catalogue"
    if key not in _CACHE:
        out = {}
        for f in sorted(DIR.glob("*.yaml")) + sorted(V3_DIR.glob("*.yaml")):
            lay = yaml.safe_load(f.read_text()) or {}
            if isinstance(lay, dict) and lay.get("id"):
                out[lay["id"]] = list(lay.get("for_types") or [])
        _CACHE[key] = out
    return {k: list(v) for k, v in _CACHE[key].items()}


def family(layout_id: str, library: dict | None = None) -> str:
    """The family of a layout (``flow`` is its own)."""
    lay = (library or load()).get(layout_id)
    return lay["family"] if lay else layout_id


def image_slots(lay: dict) -> list:
    """``[(slot name, slot)]`` of a layout's image slots, a counted one expanded as the deck names it (frame_1 ... frame_4)."""
    return [(n, s) for n, s in lay["slots"].items() if s["kind"] == "image"]


# ---------------------------------------------------------------------------------------------------------- when.test
def _items(bl: dict) -> list:
    return bl.get("items") or []


def _item_text(i) -> str:
    return str(i.get("text", "")) if isinstance(i, dict) else str(i)


def has_target_figure(s: dict, bl: list) -> bool:
    """An objective whose own words hold a target figure (the rule behind objective_panel)."""
    from .render_pptx import _objective_facts
    kinds = [b["kind"] for b in bl]
    texts = [x for b in bl for x in ([b.get("text", "")] + [_item_text(i) for i in b.get("items", []) if kinds and b["kind"] == "bullets"])]
    return bool(_objective_facts(texts))


def has_human_item(s: dict, bl: list) -> bool:
    """A bullets item flagged for a person, or a type only a person can fill that still needs one."""
    human = any(isinstance(i, dict) and i.get("human") for b in bl if b["kind"] == "bullets" for i in b.get("items", []))
    return human or (s["type"] in spec.HUMAN_ONLY_TYPES and s.get("status") == "needs_human")


def compare_table(s: dict, bl: list) -> bool:
    """A three-column table flagged ``compare``."""
    return any(b.get("compare") and len(b["rows"][0]) == 3 for b in bl if b["kind"] == "table")


def role_rows(s: dict, bl: list) -> bool:
    """Steps on founders or team; or channel_roles with a two-column table and no steps block."""
    kinds = [b["kind"] for b in bl]
    if "steps" in kinds:
        return s["type"] in ("founders", "team")
    if "table" in kinds:
        tb = next(b for b in bl if b["kind"] == "table")
        return s["type"] == "channel_roles" and len(tb["rows"][0]) == 2
    return False


def picture_source(image: dict | None) -> bool:
    """The deck-image-gen hook: a slot planned for generation counts as a picture source while the layouts are chosen, so the picker measures the
    fit of the image layout and of its ``without_image`` and records both. After the image step a slide whose slot ended up unmade is planned again
    without it (``unmade_planned``)."""
    return isinstance(image, dict) and image.get("status") == "planned" and (image.get("from") or {}).get("kind") == "generated"


def unmade_planned(deck: dict) -> list:
    """The slots still ``planned`` once the image step is over: ``[(slide id, slot)]``."""
    return [(sid, name) for sid, name, im in images.image_slots(deck) if picture_source(im)]


def image_ready(lay: dict, ready: set | frozenset) -> bool:
    """Every required image slot of the layout can be drawn for this audience (``ready`` holds the slot names the slide has
    a drawable picture for: approved only for a client). A counted slot (frame_1 ... frame_4) needs all of them."""
    need = [n for n, sl in image_slots(lay) if sl.get("required")]
    return bool(need) and all(n in ready for n in need)


#: Block kinds a statement layout sets as one point each (bullets and kv: one point per item).
POINT_KINDS = ("bullets", "kv", "quote", "text", "statement", "small", "callout", "card")


def statement_points(bl: list) -> list | None:
    """The points a statement layout (statement_points) stacks, from the shown blocks, in order: ``[{heading, text, italic, caption}]``.
    A bullets or kv block gives one point per item (a kv item's key is its heading), a card its title as the heading, every other text
    block one point; the 'Illustrative line' label after an unsourced quote is that quote's caption, not a point; empty blocks are
    skipped. None when a block is of a kind a point cannot hold (a table, a chart, a from-to...). The words are the blocks' own."""
    out = []
    for b in bl:
        k = b["kind"]
        if k not in POINT_KINDS:
            return None
        if k == "small" and b.get("basis") == "meta" and b.get("text") == spec.ILLUSTRATIVE_QUOTE and out and out[-1]["italic"]:
            out[-1]["caption"] = b["text"]
            continue
        if k == "bullets":
            out += [{"heading": "", "text": _item_text(i).strip(), "italic": False, "caption": ""} for i in _items(b) if _item_text(i).strip()]
        elif k == "kv":
            out += [{"heading": str(i[0]).strip(), "text": str(i[1]).strip(), "italic": False, "caption": ""} for i in _items(b) if str(i[1]).strip()]
        elif str(b.get("text", "")).strip():
            out.append({"heading": str(b.get("title", "")).strip() if k == "card" else "", "text": str(b["text"]).strip(),
                        "italic": k == "quote", "caption": ""})
    return out


def points_2_3(s: dict, bl: list) -> bool:
    """Two or three points for a statement layout (``statement_points``): a slide with fewer is not padded and one with more is not cut;
    another layout is picked instead (deck-look, 'never pad')."""
    pts = statement_points(bl)
    return pts is not None and 2 <= len(pts) <= 3


#: The kinds a rows_aside column may hold beside the rows: the absorbed slide's own blocks (a list, a line, labelled pairs, the copy).
ASIDE_KINDS = ("bullets", "kv", "text", "statement", "copy", "callout", "card")


def rows_aside(s: dict, bl: list) -> bool:
    """A merged slide (deck-look step 5): exactly one table of two to four columns and one to four rows under its header, and at least
    one block beside it that the aside column holds (``ASIDE_KINDS``); every other block a small line. 'How it runs' (the channel table
    and an execution) and 'how we will know' (the measures and the guardrails). A table alone is not one: it keeps its own layout."""
    tables = [b for b in bl if b["kind"] == "table"]
    if len(tables) != 1:
        return False
    rows = tables[0].get("rows") or []
    if not (2 <= len(rows) <= 5 and all(2 <= len(r) <= 4 for r in rows)):
        return False
    rest = [b for b in bl if b is not tables[0]]
    return any(b["kind"] in ASIDE_KINDS for b in rest) and all(b["kind"] in ASIDE_KINDS + ("small",) for b in rest)


TESTS = {"has_target_figure": has_target_figure, "has_human_item": has_human_item, "compare_table": compare_table, "role_rows": role_rows,
         "points_2_3": points_2_3, "rows_aside": rows_aside}


def has_text_zone(s: dict) -> bool:
    """deck-look step 7: the slide's picture carries a passing zone from the finder (``images.text_zone`` recorded on the slot)."""
    im = (((s.get("slots") or {}).get("picture") or {}).get("image")) or {}
    return bool((im.get("text_zone") or {}).get("zone"))


def text_zone_fallback(s: dict) -> dict | None:
    """The finder's record when it found no zone for this slide's picture (the words stay beside it), else None."""
    im = (((s.get("slots") or {}).get("picture") or {}).get("image")) or {}
    tz = im.get("text_zone") or {}
    return tz if tz.get("none") else None


def bleed_ready(lay: dict, s: dict, ready) -> bool:
    """A bleed layout (cover_bleed, full_bleed_statement under the look) holds the slide: its picture can be drawn and the finder measured a
    zone where the words read (AA at the 10th percentile under a scrim of at most images.SCRIM_CAP)."""
    return image_ready(lay, ready) and has_text_zone(s)


_FIGURE = re.compile(r"[<>~≈]?(?:[€$£]|(?:EUR|USD|GBP)\s)\s?\d[\d,.]*(?:\s?(?:[kKmMbB]n?\b|million\b|billion\b))?|\d[\d,.]*\s?(?:%|per ?cent\b|×)")


#: accent_phrase: a word-only candidate shorter than this is never the accent (a figure may be). And single generic words that a bound
#: line can carry but that say nothing about the slide (a copy line "Today." or an item "Now" matched in the title).
ACCENT_MIN_CHARS = 5
ACCENT_STOP = frozenset({"today", "now", "tomorrow", "here", "there", "this", "that", "these", "those", "people", "everyone", "everything",
                         "always", "never", "more", "less", "better", "best", "new", "next", "first", "last", "yes", "no", "all", "every",
                         "our", "your", "their", "them", "they", "you", "we", "it", "its", "the", "and", "with", "from", "into", "about",
                         "real", "really", "very", "just", "only", "still", "again", "time", "year", "years", "week", "month", "day"})


def accent_phrase(s: dict, bl: list) -> str | None:
    """deck-look (rea-full A3, Pitch's highlight): the ONE phrase of a slide's action title set in the accent, or None. Only a phrase that
    is itself a bound field of the same slide: the 'to' of its from-to, a line of its copy, a figure one of its blocks gives, or the whole
    text of one of its short items (six words at most); never the whole title, matched on word boundaries, case-insensitive. The longest
    wins; nothing is reworded. At most one per slide (k_accent_marks counts it). Never from an internal block or a person's placeholder
    (``internal`` / ``human``, a ``placeholder`` basis), never a single generic word (ACCENT_STOP: "today", "now", "people") and never a
    word-only phrase under ACCENT_MIN_CHARS letters; a figure ("5%", "€2m") may be short."""
    title = str(s.get("title") or "")
    tl = title.lower()
    cands = []
    for b in bl:
        if b.get("internal") or b.get("human") or b.get("basis") == "placeholder":
            continue
        if b.get("kind") == "fromto" and str(b.get("to") or "").strip():
            cands.append(str(b["to"]))
        cands += [str(x) for x in b.get("lines") or []]
        texts = [str(b.get("text") or "")] + [_item_text(i) if not isinstance(i, (list, tuple)) else str(i[-1]) for i in b.get("items") or []]
        texts += [str(c) for r in (b.get("rows") or [])[1:] for c in r]
        cands += [t for t in texts if 0 < len(t.split()) <= 6]
        cands += [m.group(0) for t in texts for m in _FIGURE.finditer(t)]
    best = None
    for c in cands:
        c = c.strip().rstrip(".")
        if len(c) < 2 or c.lower() == tl.rstrip(".") or not re.search(r"\w", c):
            continue
        if not _FIGURE.fullmatch(c) and (len(c) < ACCENT_MIN_CHARS or c.lower() in ACCENT_STOP):
            continue
        m = re.search(r"(?<![\w])" + re.escape(c.lower()) + r"(?![\w])", tl)
        if m and (best is None or len(c) > len(best)):
            best = title[m.start():m.end()]
    return best


def picture_sides(deck: dict) -> dict:
    """``{slide id: "left" | "right"}`` for every slide planned on ``picture_column``, in deck order: the first column on the left, then
    alternating (design.layouts: picture columns alternate sides). One rule for the pptx and the web deck."""
    out, side = {}, "left"
    for sid in deck["order"]:
        if ((deck["slides"][sid].get("layout") or {}).get("id")) == "picture_column":
            out[sid] = side
            side = "right" if side == "left" else "left"
    return out


def caps_ok(text: str) -> bool:
    """A statement may be set in capitals: at most ``spec.CAPS_MAX_CHARS`` characters (the renderer also asks for two lines at most)."""
    return len(str(text).strip()) <= spec.CAPS_MAX_CHARS


def _matches(lay: dict, s: dict, bl: list, ready) -> bool:
    """Whether the layout's ``for_types`` and ``when`` accept the slide (the rule, not the fit)."""
    if s["type"] not in lay["for_types"]:
        return False
    w = lay.get("when") or {}
    kinds = [b["kind"] for b in bl]
    if "blocks_any" in w and not set(kinds) & set(w["blocks_any"]):
        return False
    if "blocks_all" in w and not set(w["blocks_all"]) <= set(kinds):
        return False
    if "blocks_only" in w and not set(kinds) <= set(w["blocks_only"]):
        return False
    if "max_blocks" in w and len(kinds) > w["max_blocks"]:
        return False
    if "min_items" in w or "max_items" in w:
        key = (w.get("blocks_any") or ["stats"])[0]
        blk = next((b for b in bl if b["kind"] == key), None)
        n = len(_items(blk)) if blk else 0
        if n < w.get("min_items", 0) or n > w.get("max_items", 99):
            return False
    if w.get("status") and s.get("status") != w["status"]:
        return False
    t = w.get("test")
    if t == "image_ready":
        return image_ready(lay, ready)
    if t == "bleed_ready":
        return bleed_ready(lay, s, ready)
    if t and not TESTS[t](s, bl):
        return False
    return True


#: Layouts a thin slide gives way from: a one-row table or a one-step timeline is a statement, not a table or a strip.
THIN_FROM = ("native_table", "timeline_strip", "timeline_rows")


def thin_blocks(b: dict):
    """``(statement, [support lines])`` for a one-row table (a header and one row: each cell as ``Header: value``) or a one-step timeline (the step, then its line);
    None for any other block. Every word of the block is in the result, in its order; only a colon joins a header to its cell."""
    if b.get("kind") == "table" and not b.get("compare"):
        rows = [[str(c) for c in r] for r in b.get("rows") or []]
        if len(rows) == 2 and len(rows[0]) == len(rows[1]):
            lines = [f"{h}: {v}" if h.strip() else v for h, v in zip(*rows)]
        elif len(rows) == 1:
            lines = [c for c in rows[0] if c.strip()]
        else:
            return None
        return (lines[0], lines[1:]) if lines else None
    if b.get("kind") == "steps" and len(b.get("items") or []) == 1:
        it = [str(x) for x in b["items"][0]]
        return (it[0], [x for x in it[1:] if x.strip()]) if it and it[0].strip() else None
    return None


def is_thin(bl: list) -> bool:
    """A slide whose one table or steps block is thin (``thin_blocks``) and whose other blocks are only text, small or statement lines."""
    thin = [b for b in bl if b["kind"] in ("table", "steps")]
    return len(thin) == 1 and thin_blocks(thin[0]) is not None and all(b["kind"] in ("text", "small", "statement") for b in bl if b is not thin[0])


def pick_planned(s: dict, audience: str = "review", library: dict | None = None, ready=frozenset(), prefer: dict | None = None) -> str:
    """What the plan picks: the rules' choice (``pick``), except that a thin table or timeline gives way to ``big_statement``. ``--no-layout-plan`` and the
    renderer's own fallback use ``pick`` alone, as before the plan. ``prefer``: as ``pick``."""
    lib = library or load()
    got = pick(s, audience, lib, ready, prefer=prefer)
    if got in THIN_FROM and "big_statement" in lib and is_thin(spec.shown_blocks(s, audience)):
        return "big_statement"
    return got


def preferred(s: dict, bl: list, lib: dict, ready=frozenset(), prefer: dict | None = None) -> str | None:
    """deck-types: the first layout a recipe prefers for this slide's type (``prefer``: ``{slide type: [layout id, ...]}``,
    profiles.recipe) that is in the active library and whose ``for_types``, ``when`` and ``accepts`` all take the slide's own blocks;
    None when there is none. A layout whose ``pick`` is ``offer`` is never preferred: an offer stays in the swap menu for a person until a
    gallery review promotes it to ``rule`` (a recipe naming one is a suggestion only). An id the active library lacks (not built yet, or
    LOOK_V3 off) is skipped. It never forces: the fit, the points kept and the hole are the plan's to check."""
    for lid in (prefer or {}).get(s.get("type")) or []:
        lay = lib.get(lid)
        if lay and lay.get("pick") == "rule" and _matches(lay, s, bl, ready) and accepts(lay, s, bl, ready):
            return lid
    return None


def pick(s: dict, audience: str = "review", library: dict | None = None, ready=frozenset(), offers: bool = False, prefer: dict | None = None) -> str:
    """The layout id the rules choose for one slide dict: highest priority first, first match wins, ``flow`` when none.
    Only layouts whose ``pick`` is ``rule`` take part (``offers=True`` lets the offered ones in too). Pure, no drawing.
    ``prefer`` (deck-types, a recipe's layout map): its layouts for the slide's type are tried first (``preferred``); None is today."""
    lib = library or load()
    bl = spec.shown_blocks(s, audience)
    if prefer:
        got = preferred(s, bl, lib, ready, prefer)
        if got:
            return got
    order = {k: i for i, k in enumerate(lib)}
    for lay in sorted(lib.values(), key=lambda l: (-l["priority"], order[l["id"]])):
        if lay["pick"] != "rule" and not offers:
            continue
        if lay["priority"] == 0 and not offers:
            continue
        if _matches(lay, s, bl, ready):
            return lay["id"]
    return spec.LAYOUT_FLOW


def accepts(lay: dict, s: dict, bl: list, ready=frozenset()) -> bool:
    """Whether the layout can hold this slide's blocks at all: its slide types, a slot for every block kind, and its required
    picture when it has one."""
    if s["type"] not in lay["for_types"]:
        return False
    if has_human_item(s, bl) and lay["family"] != "placeholder" and not lay.get("human_rows"):
        return False   # only the placeholder family (or a layout with human_rows: dashed To supply rows) may draw a human item
    take = {k for sl in lay["slots"].values() if sl["kind"] != "image" for k in (sl.get("from_blocks") or [])}
    if not {b["kind"] for b in bl} <= take:
        return False
    if image_slots(lay) and any(sl.get("required") for _, sl in image_slots(lay)) and not image_ready(lay, ready):
        return False
    w = lay.get("when") or {}
    if "blocks_any" in w and not {b["kind"] for b in bl} & set(w["blocks_any"]):
        return False
    t = w.get("test")
    if t == "bleed_ready" and not has_text_zone(s):
        return False
    if t in TESTS and t != "image_ready" and not TESTS[t](s, bl):
        return False
    return True


# ---------------------------------------------------------------------------------------------------------- binding
def shown_map(s: dict, audience: str = "review") -> list:
    """For each shown block (``spec.shown_blocks``), the index of the base block it came from (the label under an unsourced
    quote has none: None). Used to turn a slot's block indexes into base-deck field ids."""
    out = []
    for bi, b in enumerate(s["blocks"]):
        if b.get("internal") and audience == "client":
            continue
        out.append(bi)
        if b["kind"] == "quote" and not b.get("refs") and str(b.get("text", "")).strip():
            out.append(None)
    return out


def _words(v) -> int:
    return len(str(v).split())


def _chars_words(slot: dict) -> tuple:
    texts = []
    if "text" in slot:
        texts.append(slot["text"])
    for i in slot.get("items") or []:
        texts += [str(i.get("heading", "")), str(i.get("text", "")), str(i.get("value", ""))]
    for r in slot.get("rows") or []:
        texts += [str(c) for c in r]
    texts += [str(x) for x in slot.get("lines") or []]
    if slot.get("answer"):
        texts.append(slot["answer"])
    t = " ".join(x for x in texts if x)
    return len(t), len(t.split())


def _bound_value(kind: str, b: dict):
    """One shown block as the value part of a slot of ``kind`` (the words are the block's own)."""
    k = b["kind"]
    if kind == "text":
        if k in ("table", "steps") and thin_blocks(b):   # a thin table or timeline set as a statement (big_statement)
            return {"text": "\n".join([thin_blocks(b)[0], *thin_blocks(b)[1]])}
        return {"text": str(b.get("text", "")).strip()}
    if kind == "list":
        if k == "steps":
            return {"items": [{"heading": str(i[0]), "text": str(i[1]) if len(i) > 1 else ""} for i in _items(b)]}
        out = []
        for i in _items(b):
            if isinstance(i, dict):
                it = {"text": str(i.get("text", ""))}
                if i.get("human"):
                    it["human"] = True
                if i.get("refs"):
                    it["refs"] = i["refs"]
                out.append(it)
            else:
                out.append({"text": str(i)})
        if k in ("text", "small", "statement", "callout", "quote", "card"):
            out = [{"text": str(b.get("text", "")).strip()}] if str(b.get("text", "")).strip() else []
        return {"items": out}
    if kind == "group":
        if k == "kv":
            return {"items": [{"heading": str(i[0]), "text": str(i[1])} for i in _items(b)]}
        if k == "fromto":
            return {"items": [{"text": str(b.get("from", ""))}, {"text": str(b.get("to", ""))}]}
        if k == "card":
            it = {"text": str(b.get("text", ""))}
            if b.get("title"):
                it["heading"] = str(b["title"])
            return {"items": [it]}
        if k == "bullets":
            return {"items": [{"text": _item_text(i)} for i in _items(b)]}
        if k == "steps":
            return {"items": [{"heading": str(i[0]), "text": str(i[1]) if len(i) > 1 else ""} for i in _items(b)]}
        return {"items": [{"text": str(b.get("text", ""))}]}
    if kind == "stat":
        return {"items": [{"value": str(i.get("value", "")), "text": str(i.get("label", ""))} for i in _items(b)]}
    if kind == "table":
        return {"rows": [[str(c) for c in r] for r in b["rows"]]}
    if kind == "chart":
        return {"chart": b.get("chart") or {}}
    if kind == "copy":
        v = {"lines": [str(x) for x in b.get("lines", [])]}
        if b.get("answer"):
            v["answer"] = str(b["answer"])
        return v
    return {}


def bind(lay: dict, s: dict, bl: list) -> tuple:
    """Bind each shown block to one slot of the layout, in the order of the layout's ``from_blocks``: ``(slots, unbound)``. A text
    slot takes one block, then the next block of its kind goes to the next slot that takes it (or joins the last); a list, group,
    stat or table slot takes every block of its kinds. ``slots`` holds each value with ``blocks`` (indexes among the shown blocks),
    ``chars`` and ``words``; ``unbound`` is the list of shown block indexes no slot could take. The title slot binds ``slide.title``."""
    slots: dict = {}
    if "title" in lay["slots"]:
        slots["title"] = {"kind": "text", "text": s["title"], "blocks": []}
    unbound = []
    for i, b in enumerate(bl):
        cands = [(n, sl) for n, sl in lay["slots"].items() if n != "title" and sl["kind"] != "image" and b["kind"] in (sl.get("from_blocks") or [])]
        if not cands:
            unbound.append(i)
            continue
        target = None
        for n, sl in cands:
            if n not in slots:
                target = (n, sl)
                break
        if target is None:
            target = cands[-1]
        n, sl = target
        val = _bound_value(sl["kind"], b)
        if n not in slots:
            slots[n] = {"kind": sl["kind"], **val, "blocks": [i]}
        else:
            cur = slots[n]
            if sl["kind"] == "text":
                cur["text"] = (cur["text"] + "\n" + val["text"]).strip()
            elif sl["kind"] in ("list", "group", "stat"):
                cur["items"] = (cur["items"] + val["items"])[:8]
            elif sl["kind"] == "table":
                cur["rows"] += val["rows"]
            cur["blocks"].append(i)
        refs = b.get("refs")
        if refs and "refs" not in slots[n]:
            slots[n]["refs"] = list(refs)
        if b.get("basis") and "basis" not in slots[n]:
            slots[n]["basis"] = b["basis"]
    for n, v in slots.items():
        v["chars"], v["words"] = _chars_words(v)
    return slots, unbound


def slot_limit_issues(lay: dict, sid: str, slots: dict) -> list:
    """``slot_limit`` findings for a bound deck slide: a text slot over its ``max_chars``, a list or group over its item limits."""
    out = []
    for n, v in slots.items():
        sd = lay["slots"].get(n) or {}
        checks = []
        if sd.get("max_chars") and v["kind"] == "text" and len(v.get("text", "")) > sd["max_chars"]:
            checks.append((len(v["text"]), sd["max_chars"], "chars"))
        if sd.get("max_items") and v["kind"] in ("list", "group", "stat") and len(v["items"]) > sd["max_items"]:
            checks.append((len(v["items"]), sd["max_items"], "items"))
        item = sd.get("item") or {}
        if item.get("body_max_chars") and v["kind"] in ("list", "group"):
            worst = max((len(i.get("text", "")) for i in v["items"]), default=0)
            if worst > item["body_max_chars"]:
                checks.append((worst, item["body_max_chars"], "chars in an item"))
        for measured, limit, unit in checks:
            out.append(_issue(sid, n, "slot_limit", f"{n} holds {measured} {unit}, the layout's limit is {limit}", measured, limit, unit, {"kind": "shorten"}))
    return out


#: The check names the plan raises (the contract's reserved slot and layout names): in validation.json, warn (slot_missing: error).
PLAN_CHECKS = ("slot_limit", "slot_missing", "slot_unknown", "slot_stale", "block_unbound", "layout_unknown", "text_on_image_fallback")


def without_plan_findings(findings: list) -> list:
    """Findings with the plan's own removed (the assemble-level view the goldens hold)."""
    return [f for f in findings if f["check"] not in PLAN_CHECKS]


def without_plan_summary(summary: dict) -> dict:
    """A ``validate.summary`` with the plan's checks taken out and the counts adjusted."""
    out = json.loads(json.dumps(summary))
    for c in PLAN_CHECKS:
        for lvl, n in (out.get("by_check", {}).pop(c, None) or {}).items():
            key = "errors" if lvl == "error" else "warnings"
            out[key] = out.get(key, 0) - n
    return out


def _issue(sid, slot, check, msg, measured=None, limit=None, unit=None, fix=None, level="warn") -> dict:
    """One finding in issue.schema.json's shape (the runner stamps round)."""
    h = hashlib.sha256(f"validate|{check}|{sid}|{slot}|{measured}".encode()).hexdigest()[:8]
    out = {"id": f"i_{h}", "round": 0, "slide": sid, "source": "validate", "check": check, "level": level,
           "severity": "minor", "message": msg[:300], "status": "open"}
    if slot:
        out["slot"] = slot
    if measured is not None:
        out["evidence"] = {"measured": measured, "limit": limit, "unit": unit}
    if fix:
        out["fix"] = fix
    return out


def blocks_sha(s: dict, audience: str = "review") -> str:
    """See ``spec.blocks_sha``."""
    return spec.blocks_sha(s, audience)


def slide_words(s: dict, audience: str = "review") -> str:
    """A hash of the normalised words of the title, the blocks and the claims (``w_words_sha``): equal before and after a plan."""
    texts = [s["title"]]
    for b in s["blocks"]:
        texts += _block_texts(b)
    texts += [c.get("text", "") for c in s.get("claims") or []]
    norm = " ".join(" ".join(str(t).split()).lower() for t in texts)
    return hashlib.sha256(norm.encode()).hexdigest()[:12]


def _block_texts(b: dict) -> list:
    out = [str(b.get("text", ""))] if b.get("text") else []
    out += [str(b[k]) for k in ("title", "heading") if b.get(k)]
    for i in b.get("items") or []:
        out += [str(x) for x in i] if isinstance(i, list) else [_item_text(i) if not isinstance(i, dict) else " ".join(str(v) for k, v in i.items() if k in ("text", "value", "label"))]
    for r in b.get("rows") or []:
        out += [str(c) for c in r]
    out += [str(b[k]) for k in ("from", "to", "answer") if b.get(k)]
    out += [str(x) for x in b.get("lines") or []]
    return out


def order_sha(deck: dict, sid: str | None = None) -> str:
    """A hash of the slide order (or one slide's block kinds, in order)."""
    if sid:
        return hashlib.sha256(json.dumps([b["kind"] for b in deck["slides"][sid]["blocks"]]).encode()).hexdigest()[:12]
    return hashlib.sha256(json.dumps(deck["order"]).encode()).hexdigest()[:12]


def shown_sha(s: dict, audience: str = "review") -> str:
    """A hash of the words the slide shows (``w_shown_sha``): equal before and after a plan except where points moved to the notes."""
    texts = [s["title"]] + [t for b in spec.shown_blocks(s, audience) for t in _block_texts(b)]
    return hashlib.sha256(" ".join(" ".join(str(t).split()).lower() for t in texts).encode()).hexdigest()[:12]


def strip_plan(deck: dict, keep_density: bool = False) -> dict:
    """A copy of the deck without what the plan wrote: ``slide.layout``, the text slots (image slots stay) and
    ``meta.layout_title_pt`` (and ``meta.layout_plan``). The goldens stay at assemble level; golden_plan.json holds the plan."""
    d = copy.deepcopy(deck)
    for s in d["slides"].values():
        s.pop("layout", None)
        if "slots" in s:
            s["slots"] = {k: v for k, v in s["slots"].items() if v.get("kind") == "image"}
            if not s["slots"]:
                s.pop("slots")
    for k in ("layout_title_pt", "layout_plan"):
        d["meta"].pop(k, None)
    if not keep_density and "density" in (d["meta"].get("preferences") or {}):   # the density the plan ran at is stamped by run_deck, with its source
        d["meta"]["preferences"].pop("density")
        if not d["meta"]["preferences"]:
            d["meta"].pop("preferences")
    return d


def plan_record(deck: dict) -> dict:
    """The small golden: ``{slides: {id: {layout, chosen_by, alternatives, rung, moved}}, layout_title_pt}`` (golden_plan.json)."""
    out = {}
    for sid in deck["order"]:
        lay = deck["slides"][sid].get("layout") or {}
        fit = lay.get("fit") or {}
        out[sid] = {"layout": lay.get("id"), "chosen_by": lay.get("chosen_by"), "alternatives": lay.get("alternatives", []),
                    "rung": fit.get("rung"), "moved": [{"block": m["block"], "item": m["item"], "sha": m["sha"]} for m in fit.get("moved", [])]}
    return {"slides": out, "layout_title_pt": deck["meta"].get("layout_title_pt", {})}


# ---------------------------------------------------------------------------------------------------------- capacity
def capacity(layout_id: str, slot: str, library: dict | None = None) -> int | None:
    """The ``max_chars`` of a text slot, derived: floor(0.85 x characters per line x lines) from the slot's box
    (``Renderer.slot_boxes``), the role's size at the shrink floor and ``max_cpl``. None for a slot with no text measure."""
    from . import render_pptx
    lay = (library or load())[layout_id]
    sl = lay["slots"][slot]
    if sl["kind"] != "text":
        return None
    box = render_pptx.Renderer.slot_boxes(layout_id, lay).get(slot)
    if not box:
        return None
    return render_pptx.Renderer.box_capacity(box[0], box[1], sl.get("role", "body"), sl.get("max_cpl"))


def write_capacity(directory: Path | None = None) -> list:
    """Rewrite every derived ``max_chars`` in the layout files (the CLI's ``--write-capacity``); returns the files changed."""
    changed = []
    d = Path(directory) if directory else DIR
    lib = load(d, force=True)
    for f in sorted(d.glob("*.yaml")):
        lay = yaml.safe_load(f.read_text())
        dirty = False
        for n, sl in lay["slots"].items():
            if n == "title" or sl["kind"] != "text":
                continue
            cap = capacity(lay["id"], n, lib)
            if cap and sl.get("max_chars") != cap:
                sl["max_chars"] = cap
                dirty = True
        if dirty:
            f.write_text(yaml.safe_dump(lay, sort_keys=False, width=110, allow_unicode=True))
            changed.append(f.name)
    _CACHE.clear()
    return changed


# ---------------------------------------------------------------------------------------------------------- plan
def _fmt_refs(refs) -> str:
    return ",".join(str(r) for r in refs)


def moved_line(m_text: str, refs) -> str:
    """The notes line for one moved point: ``- <verbatim> [refs: a,b]`` (no refs: no bracket)."""
    one = " / ".join(x.strip() for x in str(m_text).splitlines() if x.strip())   # a note line is one line: a newline in a point becomes " / "
    return f"- {one}" + (f" [refs: {_fmt_refs(refs)}]" if refs else "")


def moved_texts(s: dict) -> list:
    """The verbatim text and refs of each moved point of a slide, in the order of ``layout.fit.moved``: ``[(text, refs)]``."""
    out = []
    for m in (((s.get("layout") or {}).get("fit") or {}).get("moved")) or []:
        b = s["blocks"][m["block"]]
        out.append((item_verbatim(b, m["item"]), m.get("refs") or []))
    return out


def item_verbatim(b: dict, item) -> str:
    """The verbatim text of an item of a block (a kv item reads ``key: value``), or of a whole block when ``item`` is None."""
    if item is None:
        return str(b.get("text", "")).strip()
    i = b["items"][item]
    if isinstance(i, list):
        return ": ".join(str(x) for x in i)
    return _item_text(i)


def _sha12(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()[:12]


_FIGURE_WORDS = re.compile(
    r"\b(?:Q[1-4]|H[12]|(?:19|20)\d\d|one in (?:\w+)|(?:a|one|two|three|four|five|six|seven|eight|nine|ten|\w+th) (?:third|quarter|half|fifth|tenth)s?|half|third|quarter|"
    r"(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen)"
    r"(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)\b", re.I)


def _has_figure(t: str) -> bool:
    """A figure: a digit figure (``refs.numbers_in``), a quarter or half-year, a year, a fraction (one in three, a third, half) or a number word up to a thousand and more."""
    from .refs import numbers_in
    return bool(numbers_in(t)) or bool(_FIGURE_WORDS.search(t))


def _movable(deck: dict, sid: str, s: dict, audience: str, cat_exempt: bool) -> list:
    """The points of a slide that may move to the notes, in the order they move (last first): ``[(block, item, text, refs)]``.
    Never: the title; statements, quotes, table rows, steps, stats, fromto, copy and charts; a human item; an internal block; a
    point holding a figure; the slide's last sourced point; anything on an exempt type or a slide that is not presented; for a
    client, a text matching ``spec.INTERNAL_PATTERNS``."""
    if cat_exempt or s["type"] in NEVER_MOVE_TYPES or s.get("pinned"):
        return []
    cands = []
    first_lead = next((i for i, b in enumerate(s["blocks"]) if b["kind"] in ("text", "statement", "quote", "callout")), None)
    for bi, b in enumerate(s["blocks"]):
        if b.get("internal") or b.get("human"):
            continue
        k = b["kind"]
        if k in ("bullets", "kv"):
            for ii, it in enumerate(b.get("items") or []):
                if ii == 0:
                    continue   # the first point of a list stays: a list never empties
                if isinstance(it, dict) and it.get("human"):
                    continue
                cands.append((bi, ii, item_verbatim(b, ii), (it.get("refs") if isinstance(it, dict) else None) or b.get("refs") or []))
        elif (k == "card" and not b.get("title") and not b.get("heading")) or (k in ("text", "small") and first_lead is not None and bi > first_lead):
            # a titled card stays on the slide: the notes line carries text only, and a title is a word of the deck
            if str(b.get("text", "")).strip():
                cands.append((bi, None, str(b["text"]).strip(), b.get("refs") or []))
    sourced = [c for c in cands if c[3]]
    # the slide's last sourced point: the last item or block that carries refs, in reading order, moved or not
    last = None
    for bi, b in enumerate(s["blocks"]):
        if b.get("internal"):
            continue
        its = b.get("items") if b["kind"] in ("bullets", "kv") else None
        if its:
            for ii, it in enumerate(its):
                if (it.get("refs") if isinstance(it, dict) else None) or b.get("refs"):
                    last = (bi, ii)
        elif b.get("refs"):
            last = (bi, None)
    out = []
    for c in cands:
        bi, ii, text, refs = c
        if last and (bi, ii) == last:
            continue
        if _has_figure(text):
            continue
        if audience == "client" and any(re.search(p[0] if isinstance(p, (tuple, list)) else p, text, re.I) for p in spec.INTERNAL_PATTERNS):
            continue
        out.append(c)
    return list(reversed(out))


def _cover_held(s: dict, audience: str, prefs: dict) -> list:
    """The cover's unresolved lines (``spec.unresolved_line``: the labelled placeholder, ``[Agency]``, ``[presenter and date]``) as whole-block moves to the
    speaker notes. A review only: a client render keeps them on the slide, where the leak check refuses the build, and no note of a client file may carry
    one. With no notes (``--no-notes``) nothing leaves the slide. The blocks are never edited: the plan overlays, so words_sha does not move."""
    if audience == "client" or prefs.get("notes") is False or s.get("pinned"):
        return []
    return [_moved_rec((bi, None, str(b["text"]).strip(), b.get("refs") or [])) for bi, b in enumerate(s["blocks"])
            if b["kind"] in ("text", "small") and not b.get("internal") and spec.unresolved_line(b.get("text"))]


def _with_moved(s: dict, moved: list) -> dict:
    lay = dict(s.get("layout") or {})
    fit = dict(lay.get("fit") or {})
    fit["moved"] = moved
    lay["fit"] = fit
    return {**s, "layout": lay}


def _moved_rec(c) -> dict:
    bi, ii, text, refs = c
    return {"block": bi, "item": ii, "sha": _sha12(text), "refs": list(refs)}


def title_sizes(deck: dict, ids: dict, probe, aud: str = "review") -> dict:
    """``{layout id: pt}``: per layout used, the largest of 36, 32, 30, 28 at which every slide of that layout takes its title in at most
    three lines and fits without relaxing (measured with the renderer; 28 pt when no size does). One size per layout per deck: titles of one
    layout no longer differ from slide to slide. A layout not used has the theme title size (not listed). Functional layouts that set their
    own display size (cover, close, emphasis_bar, big_statement, section, full_bleed_statement) are not stamped."""
    by: dict = {}
    for sid, lid in ids.items():
        by.setdefault(lid, []).append(sid)
    out = {}
    for lid, sids in by.items():
        if lid in ("flow", "cover", "cover_image", "close", "emphasis_bar", "big_statement", "full_bleed_statement", "section", "cover_bleed"):
            continue
        out[lid] = next((sz for sz in TITLE_SIZES if all(probe(deck["slides"][sid], lid, sz) for sid in sids)), TITLE_SIZES[-1])
    return out


def plan(base_deck: dict, library: dict | None = None, prefs: dict | None = None, swaps: dict | None = None,
         hooks: dict | None = None, fixes: dict | None = None) -> tuple:
    """Plan every slide of ``base_deck``: ``(deck, issues, pending)``.

    Pure and deterministic: the same arguments give the same bytes, and planning the result again changes nothing (a planned deck is not
    a base deck: it is refused). The plan only overlays: ``slide.layout`` (id, version, chosen_by, alternatives, why, fit with
    ``moved``, blocks_sha), ``slide.slots`` and ``meta.layout_title_pt``. It never edits a block, a note, a claim or the order.

    ``prefs``: ``density`` (lean, standard, detailed; None is detailed), ``text_mode`` (condense or preserve), ``repair`` (bool),
    ``prefer`` (deck-types: a recipe's ``{slide type: [layout id, ...]}``, profiles.recipe; None is today) and ``prefer_type`` (the type's
    id, for the why line). A preferred layout (``preferred``) replaces the rule pick only when it fits the slide, as density leaves it,
    at rung as_is or shrunk; at the ladder, if it no longer does, the rule pick takes the slide back, so a preference never moves a
    point the rule pick would keep and never draws past shrunk. chosen_by stays ``rule``; why names the recipe.
    ``swaps``: ``{slide id: layout id}`` a person chose. ``fixes``: ``{slides: {sid: {avoid, scale_max, layout, notes}}, images:
    {sid: {slot: {scrim, fit, focal}}}}`` from slice 5, cumulative. ``hooks``: ``{shorten: fn(sid, slot, limits, fields)}``
    returning ``{"deferred": True}``, ``{"text": {field id: text}}`` or None. ``pending``: the slots still over their limits when the
    pass stopped for slice 5 (condense and repair on), each with the rungs not yet run.
    """
    from . import render_pptx, validate
    t0 = time.time()
    lib = library or load()
    prefs, swaps, hooks = prefs or {}, swaps or {}, hooks or {}
    fx = (fixes or {}).get("slides") or {}
    density = prefs.get("density") or "detailed"
    deck = strip_plan(base_deck, keep_density=True)   # a planned deck is stripped first: the plan always starts from the base, so planning again changes nothing
    aud = deck["meta"].get("audience", "review")
    stop = prefs.get("text_mode") == "condense" and bool(prefs.get("repair"))
    story = set(validate.presented(deck))
    ready_all = images.drawn(deck, aud)
    ready_all = {**ready_all, **{(sid, slot): im for sid, slot, im in images.image_slots(deck) if picture_source(im)}}
    ready = {}
    for (sid, slot) in ready_all:
        ready.setdefault(sid, set()).add(slot)
    R = render_pptx.Renderer(deck, None)
    issues, pending = [], []
    rungs = {k: 0 for k in ("as_is", "shrunk", "switched", "overflow_moved", "relaxed", "no_fit")}
    look = spec.LOOK_V2

    def probe(sl_, lid, relaxed=False, cap=None, stamped=None, cpl=48):
        return R.probe(sl_, lid, relaxed=relaxed, scale_cap=cap, title_pt=stamped, cpl=cpl)

    def before_probe(sid_, s_, lid_):
        """``(exempt, base, moved)`` before the probe: the cover's held lines, then density (step 0 of the ladder) for layout ``lid_``."""
        exempt_ = sid_ not in story and deck["meta"].get("format", "pitch") == "pitch"
        base_ = {**s_}
        base_.pop("layout", None)
        moved_: list = _cover_held(s_, aud, prefs) if s_["type"] == "title" else []   # unresolved cover lines go to the notes, labelled, never dropped
        content_ = lid_ != "flow" and lib[lid_]["group"] == "content" and s_["type"] not in ("title", "close", "next_step")
        # 0. density: movable points past the target go to the notes
        if density in spec.DENSITY_WORDS and content_ and not exempt_ and s_["type"] not in ("appendix",) and prefs.get("text_mode") != "preserve":
            target = spec.DENSITY_WORDS[density]
            if spec.LOOK_V3 and density == "lean" and s_["type"] in spec.ROLE_OF_TYPE:   # deck-look (Q13): a pitch's lean density is the role
                target = max(target, spec.ROLE_WINDOWS[spec.ROLE_OF_TYPE[s_["type"]]][1])   # window's top: 35 a statement, 70 an argument
            cands = _movable(deck, sid_, base_, aud, exempt_)
            words = lambda sl_: sum(len(str(t).split()) for b in spec.shown_blocks(sl_, aud) if b["kind"] != "copy" for t in _block_texts(b))
            cur = _with_moved(base_, [])
            for c in cands:
                if words(cur) <= target:
                    break
                moved_.append(_moved_rec(c))
                cur = _with_moved(base_, moved_)
        return exempt_, base_, moved_

    # ---- the rule pass: a layout per slide
    prefer = prefs.get("prefer") or None
    pref_rule = {}   # deck-types: slide id -> (the rule's layout, its why) for a slide a recipe preference took
    ids, by, why = {}, {}, {}
    for sid in deck["order"]:
        s = deck["slides"][sid]
        f = {} if s.get("pinned") else (fx.get(sid) or {})
        rid = pick_planned(s, aud, lib, ready.get(sid, frozenset()))
        by[sid], why[sid] = "rule", "rule table"
        if prefer:
            pid = pick_planned(s, aud, lib, ready.get(sid, frozenset()), prefer=prefer)
            if pid != rid:
                _ex, b_, m_ = before_probe(sid, s, pid)
                _rx, _rb, m_rule = before_probe(sid, s, rid)
                sl_p = _with_moved(b_, m_) if m_ else b_
                shown_p = {**sl_p, "blocks": spec.shown_blocks(sl_p, aud)}
                rp = probe(shown_p, pid, cap=f.get("scale_max"))
                # kept only when it fits as is or shrunk, keeps at least as many points on the slide as the rule's layout (density moves no
                # more to the notes), and, under the look, opens no hole over the gate (the swap menu's own test); else the rule pick stands
                keeps = len(m_) <= len(m_rule)
                hole_ok = True
                if spec.LOOK_V3 and lib[pid]["group"] == "content":
                    hole = R.hole_estimate(shown_p, pid)
                    hole_ok = hole is not None and hole <= spec.HOLE_GATE
                if rp["ok"] and not rp["relaxed"] and keeps and hole_ok:
                    pref_rule[sid] = (rid, why[sid])
                    rid, why[sid] = pid, f"recipe {prefs.get('prefer_type') or 'deck type'}: prefers {pid} for {s['type']}"
        sw = swaps.get(sid)
        if sw:
            if sw in lib and accepts(lib[sw], s, spec.shown_blocks(s, aud), ready.get(sid, frozenset())):
                rid, by[sid], why[sid] = sw, "person", "chosen by a person"
            else:
                issues.append(_issue(sid, None, "layout_unknown", f"{sw} is not a layout that holds this slide; the rule's choice is used"))
        elif f.get("layout") and f["layout"] in lib and accepts(lib[f["layout"]], s, spec.shown_blocks(s, aud), ready.get(sid, frozenset())):
            rid, by[sid], why[sid] = f["layout"], "repair", "repair: layout " + f["layout"]
        elif rid in f.get("avoid", []):
            alts = [a for a in lib[rid].get("alternatives", []) if a not in f["avoid"] and accepts(lib[a], s, spec.shown_blocks(s, aud), ready.get(sid, frozenset()))]
            if alts:
                rid, by[sid], why[sid] = alts[0], "repair", "repair: avoid"
        ids[sid] = rid
        if sid in pref_rule and by[sid] != "rule":   # a person's swap or a repair fix beats a recipe preference
            pref_rule.pop(sid)
    # ---- variety (look change 4, advisory): families, not ids; a run of one slide type is exempt; functional layouts, a person's swap and a
    # pinned slide are never moved; a run with no other-family alternative that fits stays (and is listed by ``variety``)
    var_swaps = 0

    def alt_for(sid_, avoid_fams):
        s_ = deck["slides"][sid_]
        base_ = {k: v for k, v in s_.items() if k != "layout"}
        shown_ = {**base_, "blocks": spec.shown_blocks(base_, aud)}
        for a in _alternatives(lib, ids[sid_], base_, aud, ready.get(sid_, frozenset()), (fx.get(sid_) or {}).get("avoid", [])):
            if lib[a]["family"] in avoid_fams or lib[a]["group"] != "content":
                continue
            r = probe(shown_, a)
            if r["ok"] and not r["relaxed"] and R.title_fits(s_["title"], 36):
                return a
        return None

    def movable(sid_):
        return by[sid_] == "rule" and not deck["slides"][sid_].get("pinned") and ids[sid_] != "flow" and lib[ids[sid_]]["group"] == "content" \
            and sid_ not in pref_rule   # deck-types: variety never undoes a recipe's preference

    if look:
        seq = [sid for sid in validate.presented(deck) if ids[sid] != "flow" and lib[ids[sid]]["group"] == "content"
               and deck["slides"][sid]["type"] not in ("title", "appendix", "close", "next_step")]
        fam = lambda sid_: lib[ids[sid_]]["family"]
        for i in range(2, len(seq)):
            trio = seq[i - 2:i + 1]
            if len({fam(x) for x in trio}) == 1 and len({deck["slides"][x]["type"] for x in trio}) > 1 and movable(seq[i]):
                a = alt_for(seq[i], {fam(seq[i])})
                if a:
                    ids[seq[i]], why[seq[i]], var_swaps = a, "variety: three of one family in a row", var_swaps + 1
        for start in range(0, max(1, len(seq) - 9)):
            win = seq[start:start + 10]
            need = min(6, -(-len(win) * 6 // 10))
            fams = [fam(x) for x in win]
            if len(win) >= 5 and len(set(fams)) < need:
                top = max(sorted(set(fams)), key=fams.count)   # sorted: a tie must not depend on the hash seed
                for sid_ in reversed([x for x in win if fam(x) == top]):
                    if movable(sid_):
                        a = alt_for(sid_, set(fams))
                        if a:
                            ids[sid_], why[sid_], var_swaps = a, "variety: too few families in ten slides", var_swaps + 1
                            break
    # ---- stamped title sizes (one per layout used, after the rule pass, never recomputed)
    def fits_at(s_, lid_, sz):
        sh_ = {**{k: v for k, v in s_.items() if k != "layout"}}
        sh_["blocks"] = spec.shown_blocks(sh_, aud)
        r = probe(sh_, lid_, stamped=sz)
        return r["ok"] and not r["relaxed"] and R.title_fits(s_["title"], sz)
    pt = title_sizes(deck, ids, fits_at, aud) if look else {}
    if pt:
        deck["meta"]["layout_title_pt"] = pt
    # ---- the ladder, slide by slide
    for sid in deck["order"]:
        s = deck["slides"][sid]
        f = {} if s.get("pinned") else (fx.get(sid) or {})
        lid, chosen_by = ids[sid], by[sid]
        exempt, base, moved = before_probe(sid, s, lid)
        sl_ = _with_moved(base, moved) if moved else base
        shown = spec.shown_blocks(sl_, aud)
        sc_cap = f.get("scale_max")
        rung, scale, relaxed, why_, cpl_ = "as_is", 1.0, False, why[sid], 48
        res = probe({**sl_, "blocks": shown}, lid, cap=sc_cap, stamped=pt.get(lid)) if lid != "flow" else None
        if sid in pref_rule and not (res is not None and res["ok"] and not res["relaxed"]):   # deck-types: a preference holds only at as_is or shrunk
            lid, why_ = pref_rule[sid]
            ids[sid] = lid
            exempt, base, moved = before_probe(sid, s, lid)
            sl_ = _with_moved(base, moved) if moved else base
            shown = spec.shown_blocks(sl_, aud)
            res = probe({**sl_, "blocks": shown}, lid, cap=sc_cap, stamped=pt.get(lid)) if lid != "flow" else None
        alts_fit: list = []
        if res is not None and res["ok"] and not res["relaxed"]:
            rung, scale = ("as_is" if res["scale"] >= 1.0 else "shrunk"), res["scale"]
        else:
            switched = None
            if lid != "flow" and look and not (sid in swaps and by[sid] == "person"):
                rule_text = pick(base, aud, lib, frozenset())   # a picture layout that does not fit gives way to what the rules choose without the picture
                cands = ([rule_text] if rule_text != lid and rule_text in lib and image_slots(lib[lid]) else []) + _alternatives(lib, lid, base, aud, ready.get(sid, frozenset()), f.get("avoid", []))
                for a in cands:
                    ra = probe({**sl_, "blocks": shown}, a, cap=sc_cap, stamped=pt.get(a))
                    if ra["ok"] and not ra["relaxed"] and (pt.get(a) is None or R.title_fits(s["title"], pt.get(a))):
                        switched = (a, ra)
                        break
            if switched:
                lid, res = switched[0], switched[1]
                rung, scale, chosen_by, why_ = "switched", res["scale"], "fit_ladder", f"fit ladder: {ids[sid]} too full"
            elif stop and not exempt:
                rung = "no_fit"   # slice 5 shortens first; the rungs not yet run are listed in pending
            else:
                # notes rung: movable points, last first, until it fits (density detailed, preserve, a pinned slide and notes deny skip it)
                can = density != "detailed" and prefs.get("text_mode") != "preserve" and f.get("notes") != "deny" and lid != "flow"
                done = False
                if can:
                    cands = [c for c in _movable(deck, sid, base, aud, exempt) if _moved_rec(c) not in moved]
                    for c in cands:
                        moved.append(_moved_rec(c))
                        sl_ = _with_moved(base, moved)
                        shown = spec.shown_blocks(sl_, aud)
                        r2 = probe({**sl_, "blocks": shown}, lid, cap=sc_cap, stamped=pt.get(lid))
                        if r2["ok"] and not r2["relaxed"]:
                            rung, scale, res, done = "overflow_to_notes", r2["scale"], r2, True
                            break
                if not done and lid != "flow":   # lines of up to 60 characters before any type goes down to the caption floor
                    rw = probe({**sl_, "blocks": shown}, lid, cap=sc_cap, stamped=pt.get(lid), cpl=60)
                    if rw["ok"] and not rw["relaxed"]:
                        rung, scale, res, done, cpl_ = ("as_is" if rw["scale"] >= 1.0 else "shrunk"), rw["scale"], rw, True, 60
                if not done:
                    r3 = probe({**sl_, "blocks": shown}, lid, relaxed=True, cap=sc_cap, stamped=pt.get(lid)) if lid != "flow" else None
                    if r3 and r3["ok"]:
                        rung, scale, relaxed, res = "shrunk", r3["scale"], True, r3
                    else:
                        rung = "no_fit"
        lay = lib.get(lid)
        slots, unbound = _bind(lib, lid, sl_, aud) if lay else ({}, [])
        fit = {"rung": rung, "scale": round(min(1.6, max(0.6, scale)), 3), "relaxed": relaxed, "moved": moved}
        if cpl_ != 48:
            fit["cpl"] = cpl_
        def fits(a, _s={**sl_, "blocks": shown}, _cap=sc_cap):
            r = probe(_s, a, cap=_cap, stamped=pt.get(a))
            if not (r["ok"] and not r["relaxed"]):
                return False
            if spec.LOOK_V3 and lib[a]["group"] == "content":   # deck-look (rea-full A4): the menu offers no layout that opens a hole over the gate
                hole = R.hole_estimate(_s, a, title_pt=pt.get(a))
                return hole is not None and hole <= spec.HOLE_GATE
            return True
        alt_ids = _alternatives(lib, lid, base, aud, ready.get(sid, frozenset()), f.get("avoid", []), probe=fits) if lay else []
        layout = {"id": lid, "version": lay["version"] if lay else 1, "chosen_by": chosen_by, "alternatives": alt_ids[:4], "why": why_[:160],
                  "fit": fit, "blocks_sha": blocks_sha(base, aud)}
        s["layout"] = layout
        fb = text_zone_fallback(s) if spec.LOOK_V3 and s["type"] in images.TEXT_OVER_TYPES and "picture" in ready.get(sid, ()) else None
        if fb:   # deck-look step 7: no zone of the picture reads at AA under the capped scrim: the words sit beside it, and it is said
            best = fb.get("best") or {}
            issues.append(_issue(sid, "picture", "text_on_image_fallback",
                                 f"the words are set beside the picture ({lid}), not on it: {fb.get('reason', 'no calm zone')}"
                                 + (f" (best zone {best['zone']}: {best['p10']}:1 at the 10th percentile, s.d. {best['busy_sd']})" if best.get("zone") else ""),
                                 best.get("p10"), images.TEXT_ON_PICTURE_TARGET, "contrast"))
        if rung in rungs or rung == "overflow_to_notes":
            rungs["overflow_moved" if rung == "overflow_to_notes" else rung] += 1
        if relaxed:
            rungs["relaxed"] += 1
        # slots: text slots bound here, image slots kept as slice 3 wrote them
        old_img = {k: v for k, v in (s.get("slots") or {}).items() if v.get("kind") == "image"}
        for slot, patch in ((fixes or {}).get("images") or {}).get(sid, {}).items():
            if slot in old_img and isinstance(old_img[slot].get("image"), dict):
                old_img[slot] = {**old_img[slot], "image": {**old_img[slot]["image"], **patch}}
        if lay:
            s["slots"] = {**slots, **old_img}
            for i in unbound:
                issues.append(_issue(sid, None, "block_unbound", f"a {shown[i]['kind']} block has no slot in {lid}"))
            for slot, sd in lay["slots"].items():
                if sd.get("required") and sd["kind"] != "image" and slot not in slots:
                    issues.append(_issue(sid, slot, "slot_missing", f"{lid} needs {slot} and the slide has nothing for it", level="error"))
            lim = slot_limit_issues(lay, sid, slots)
            issues.extend(lim)
            if stop and rung == "no_fit" and not lim and slots:
                big = max((n for n in slots if n != "title"), key=lambda n: slots[n]["chars"], default=None)
                if big:
                    pending.append(_pend(sid, {"slot": big, "evidence": {"measured": slots[big]["chars"], "limit": (lay["slots"][big].get("max_chars") or slots[big]["chars"])}}))
            for x in lim:
                if stop:
                    pending.append(_pend(sid, x))
                elif hooks.get("shorten"):
                    ans = hooks["shorten"](sid, x["slot"], {"max_chars": x["evidence"]["limit"], "max_words": lay["slots"][x["slot"]].get("max_words") or max(1, x["evidence"]["limit"] // 6)},
                                           _field_texts(sl_, s["slots"], x["slot"], aud))
                    if ans and ans.get("deferred"):
                        pending.append(_pend(sid, x))
                    elif ans and ans.get("text"):
                        _apply_text(s["slots"][x["slot"]], ans["text"])
        elif s.get("slots"):
            s["slots"] = old_img
    deck["meta"]["layout_plan"] = {"density": density, "rungs": rungs, "variety_swaps": var_swaps}
    deck["meta"]["_plan_secs"] = round(time.time() - t0, 3)
    deck["meta"].pop("_plan_secs", None)
    return deck, issues, pending


def _pend(sid, x) -> dict:
    return {"slide": sid, "slot": x["slot"], "measured": x["evidence"]["measured"], "limit": x["evidence"]["limit"],
            "rungs": ["shorten", "overflow_to_notes", "relaxed", "no_fit"]}


def _fields(s: dict, slots: dict, slot: str, aud: str) -> list:
    """The words of a slot as base-deck field ids: ``[[block index, item index or None]]``."""
    m = shown_map(s, aud)
    out = []
    for i in slots[slot].get("blocks", []):
        bi = m[i] if i < len(m) else None
        if bi is None:
            continue
        b = s["blocks"][bi]
        if slots[slot]["kind"] in ("list", "group", "stat") and b.get("items"):
            out += [[bi, k] for k in range(len(b["items"]))]
        else:
            out.append([bi, None])
    return out


def _field_texts(s: dict, slots: dict, slot: str, aud: str) -> list:
    """The slot's fields as ``[{id, text}]``: ``id`` is ``"<block>"`` or ``"<block>.<item>"`` (base-deck field ids), ``text`` the verbatim words."""
    out = []
    for bi, ii in _fields(s, slots, slot, aud):
        b = s["blocks"][bi]
        out.append({"id": f"{bi}" if ii is None else f"{bi}.{ii}", "text": item_verbatim(b, ii)})
    return out


def _apply_text(val: dict, text: dict) -> None:
    """Bind the condensed fields a hook answered into the slot value only (blocks are never edited: slice 5 owns the guards on that
    text). A field id is ``"<block>"`` or ``"<block>.<item>"``, in the order the slot's fields were given."""
    keys = sorted(text, key=lambda k: tuple(int(x) if x.isdigit() else x for x in str(k).split(".")))   # "0.2" before "0.10"
    if val["kind"] == "text" and keys:
        val["text"] = text[keys[0]]
    elif val.get("items"):
        for n, k in enumerate(keys[: len(val["items"])]):
            val["items"][n]["text"] = text[k]
    val["chars"], val["words"] = _chars_words(val)


def _bind(lib, lid, sl_, aud):
    lay = lib.get(lid)
    if not lay:
        return {}, []
    return bind(lay, sl_, spec.shown_blocks(sl_, aud))


def _alternatives(lib, lid, s, aud, ready, avoid, probe=None) -> list:
    """The layout's own alternatives first, then the others that accept the slide (same purpose first, then priority); with
    ``probe``, only those that fit at as_is or shrink; at most 4. This is the swap menu."""
    if lid not in lib:
        return []
    bl = spec.shown_blocks(s, aud)
    lay = lib[lid]
    cand = [a for a in lay.get("alternatives", [])]
    rest = sorted((l for l in lib.values() if l["id"] != lid and l["id"] not in cand), key=lambda l: (l["purpose"] != lay["purpose"], -l["priority"]))
    out = []
    for a in cand + [l["id"] for l in rest]:
        if a in avoid or a == lid or a in out or a not in lib or lib[a]["group"] == "functional" and lay["group"] != "functional":
            continue
        if not accepts(lib[a], s, bl, ready):
            continue
        if probe is not None and not probe(a):
            continue
        out.append(a)
        if len(out) >= 4:
            break
    return out


# ---------------------------------------------------------------------------------------------------------- variety
def variety(deck: dict, lib: dict | None = None) -> list:
    """Advisory findings over the presented slides in order: more than two in a row of one family (a run of one slide type is
    exempt), and fewer than six distinct families in a window of ten. Returns ``[{check, slide, message}]``; never changes a layout."""
    lib = lib or load()
    from . import validate
    seq = [(sid, deck["slides"][sid]) for sid in validate.presented(deck)]
    out = []
    for i in range(2, len(seq)):
        trio = [seq[k] for k in (i - 2, i - 1, i)]
        fams = {family((x[1].get("layout") or {}).get("id", "flow"), lib) for x in trio}
        if len(fams) == 1 and len({x[1]["type"] for x in trio}) > 1 and list(fams)[0] != "flow":
            out.append({"check": "layout_repeat", "slide": trio[-1][0], "message": f"three slides in a row use the {list(fams)[0]} family"})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--write-capacity", action="store_true", help="rewrite the derived max_chars in engine/deck/layouts/*.yaml")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args(argv)
    if a.write_capacity:
        print(json.dumps(write_capacity()))
    if a.list:
        for l in load().values():
            print(f"{l['id']:22} {l['pick']:6} {l['family']:20} {l['priority']:3} {l['group']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
