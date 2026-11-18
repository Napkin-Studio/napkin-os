"""The deck visual checklist: one function per item of ``engine/deck/checklist.json``, read-only over a run folder.

    python3 -m deck.bench checklist RUN_DIR [RUN_DIR ...] --out checklist.json

A run folder holds deck.json (required) and, each optional, validation.json, qa.json, report.json, layouts.json (the
renderer's sidecar) and deck.pptx. A check that cannot be judged answers ``n/a`` with its reason, never ``yes``: a
vacuous "all pictures are fine" is not a pass, and ``summary.yes`` never counts an n/a. No model call and no network:
this module imports nothing from ``stages``.

Answers: ``yes`` / ``no`` / ``n/a`` for a yes-no item (a ``no`` names the failing ``slides`` by id, with ``measured`` and
``limit`` where there is a number), ``value`` for a metric. Thresholds come from checklist.json; numbers that spec,
theme or qa_render already name are read from there.
"""
from __future__ import annotations

import hashlib
import json
import math
import statistics
from collections import Counter
from pathlib import Path

from .. import images, issues, spec
from ..validate import presented as _presented, words as _words
from .judges import BenchError
from .packets import run_ids

DECK = Path(__file__).resolve().parents[1]
ITEMS_PATH = DECK / "checklist.json"
PER_SLIDE_PREFIXES = ("q_", "l_", "w_", "t_", "p_", "k_")   # checks that judge presented slides
CONTENT_EXCLUDED = ("title", "appendix", "close")   # content slides: presented slides other than these (Q7)
CREATIVE_TYPES = ("territory", "idea", "execution", "audience")   # look.pictures.on creative (contract 6.3)
COVER_TYPES = ("title", "appendix")                                # creative_cover adds these
FILLED = ("made", "flagged", "approved")                           # an image slot that holds a picture
NA_QA = "qa.json is missing (a --no-qa run) or holds only an unreadable deck"
NA_VALIDATION = "validation.json is missing or is not a list"
NA_PPTX = "deck.pptx is missing or cannot be opened"
NA_LAYOUT = "no layout record: neither deck.slides.<id>.layout nor layouts.json is in the run folder"
NA_NO_PICTURE = "no presented slide has a filled image slot (status made, flagged or approved)"


def load_items(path: Path = ITEMS_PATH) -> dict:
    """checklist.json: ``{version, items: [...]}``."""
    return json.loads(Path(path).read_text())


def _read(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


class Run:
    """One run folder, read once. Every attribute is None when its file is missing or unreadable."""

    def __init__(self, run_dir: Path, items: dict | None = None):
        self.dir = Path(run_dir)
        self.deck = _read(self.dir / "deck.json")
        if not isinstance(self.deck, dict) or "order" not in self.deck or "slides" not in self.deck:
            raise BenchError(f"{run_dir}: no readable deck.json")
        self.items = {i["id"]: i for i in (items or load_items())["items"]}
        self.validation = _read(self.dir / "validation.json")
        self.qa = _read(self.dir / "qa.json")
        self.report = _read(self.dir / "report.json")
        self.sidecar = _read(self.dir / "layouts.json")
        self.prs = None
        if (self.dir / "deck.pptx").exists():
            try:
                from pptx import Presentation
                self.prs = Presentation(str(self.dir / "deck.pptx"))
            except Exception:
                self.prs = None
        self.ids = list(self.deck["order"])
        self.presented = _presented(self.deck)
        self.content = [i for i in self.presented if self.deck["slides"][i]["type"] not in CONTENT_EXCLUDED]
        self._measures: dict = {}

    # -- inputs ------------------------------------------------------------------------------
    @property
    def validation_ok(self) -> bool:
        return isinstance(self.validation, list)

    @property
    def qa_ok(self) -> bool:
        """qa.json exists and is not the lone 'unreadable' finding under the key 'deck'."""
        if not isinstance(self.qa, dict) or not isinstance(self.qa.get("slides"), dict):
            return False
        s = self.qa["slides"]
        return not (list(s) == ["deck"] and all(f.get("check") == "unreadable" for f in s["deck"]))

    @property
    def qa_pixels(self) -> bool:
        return self.qa_ok and bool(self.qa.get("pixels"))

    def qa_findings(self, presented_only: bool = True):
        """``[(slide id, finding)]`` from qa.json, slide numbers mapped through deck.order (the 'deck' key kept as 'deck')."""
        out = []
        for key, fs in ((self.qa or {}).get("slides") or {}).items():
            sid = issues.slide_id_of(key, self.deck)
            if presented_only and sid != issues.DECK_KEY and sid not in self.presented:
                continue
            out += [(sid, f) for f in fs]
        return out

    # -- layouts -----------------------------------------------------------------------------
    def layouts(self):
        """``{slide id: {id, chosen, fallback, relaxed}}`` and the theme, from deck.slides.<id>.layout where every
        presented slide has one, else from layouts.json, else None."""
        if "layouts" in self._measures:
            return self._measures["layouts"]
        sl = self.deck["slides"]
        out = None
        if self.presented and all(isinstance(sl[i].get("layout"), dict) for i in self.presented):
            out = ({i: {"id": sl[i]["layout"]["id"], "chosen": sl[i]["layout"]["id"], "fallback": bool(sl[i]["layout"].get("fallback")),
                        "relaxed": bool((sl[i]["layout"].get("fit") or {}).get("relaxed"))} for i in self.ids if isinstance(sl[i].get("layout"), dict)},
                   (self.deck.get("meta") or {}).get("theme_name"))
        elif isinstance(self.sidecar, dict) and isinstance(self.sidecar.get("slides"), dict):
            out = (self.sidecar["slides"], self.sidecar.get("theme"))
        self._measures["layouts"] = out
        return out

    def number(self, sid: str) -> int:
        return self.ids.index(sid) + 1

    def image_slots(self):
        """``[(slide id, slot name, image dict)]`` for presented slides' image slots holding a picture."""
        out = []
        for sid in self.presented:
            for name, slot in (self.deck["slides"][sid].get("slots") or {}).items():
                img = slot.get("image") if isinstance(slot, dict) and slot.get("kind") == "image" else None
                if isinstance(img, dict) and img.get("status") in FILLED:
                    out.append((sid, name, img))
        return out


# ---------------------------------------------------------------- answers

def yes(**kw) -> dict:
    return {"answer": "yes", **kw}


def no(slides, measured=None, limit=None, **kw) -> dict:
    r = {"answer": "no", "slides": sorted(set(slides), key=lambda s: s if not isinstance(s, str) else s)}
    if measured is not None:
        r["measured"] = measured
    if limit is not None:
        r["limit"] = limit
    return {**r, **kw}


def na(reason: str) -> dict:
    return {"answer": "n/a", "reason": reason}


def value(v, **kw) -> dict:
    return {"answer": "value", "value": v, **kw}


def _verdict(failing: list, order: list, measured=None, limit=None) -> dict:
    """no (failing slide ids in deck order) when any, else yes."""
    if not failing:
        return yes()
    return no([i for i in order if i in set(failing)] or failing, measured, limit)


CHECKS: dict = {}


def check(fn):
    """Register a check under its own function name (the item id)."""
    CHECKS[fn.__name__] = fn
    return fn


def _thr(r: Run, item_id: str) -> dict:
    return r.items[item_id].get("threshold") or {}


# ---------------------------------------------------------------- gate

def _val_errors(r: Run) -> list:
    return [f for f in r.validation if isinstance(f, dict) and f.get("level") == "error"]


@check
def g_no_blocker(r: Run) -> dict:
    if not r.validation_ok:
        return na(NA_VALIDATION)
    if not r.qa_ok:
        return na(NA_QA)
    blockers = [(f.get("slide") or issues.DECK_KEY, f) for f in r.validation if isinstance(f, dict)
                if issues.severity(f.get("check", ""), f.get("level", ""), r.policy()) == "blocker"]
    blockers += [(sid, f) for sid, f in r.qa_findings() if issues.severity(f["check"], f["level"], r.policy()) == "blocker"]
    return _verdict([s for s, _ in blockers], r.ids + [issues.DECK_KEY], len(blockers), _thr(r, "g_no_blocker")["max_blockers"])


@check
def g_no_validator_error(r: Run) -> dict:
    if not r.validation_ok:
        return na(NA_VALIDATION)
    errs = _val_errors(r)
    return _verdict([f.get("slide") or issues.DECK_KEY for f in errs], r.ids + [issues.DECK_KEY], len(errs), 0)


@check
def g_no_qa_error(r: Run) -> dict:
    if not r.qa_ok:
        return na(NA_QA)
    errs = [(s, f) for s, f in r.qa_findings() if f["level"] == "error"]
    return _verdict([s for s, _ in errs], r.ids + [issues.DECK_KEY], len(errs), 0)


@check
def g_no_major(r: Run) -> dict:
    pol = r.policy()
    if not pol:
        return na("no repair policy with a severity map exists (engine/deck/policy/repair.yaml, deck-repair-loop): without one nothing is major")
    found = [(f.get("slide") or issues.DECK_KEY, f) for f in (r.validation or []) if isinstance(f, dict)]
    found += [(s, f) for s, f in r.qa_findings()]
    majors = [s for s, f in found if issues.severity(f.get("check", ""), f.get("level", ""), pol) == "major"]
    return _verdict(majors, r.ids + [issues.DECK_KEY], len(majors), 0)


@check
def g_checks_current(r: Run) -> dict:
    sha = (r.qa or {}).get("deck_sha") if isinstance(r.qa, dict) else None
    if not sha:
        return na("qa.json carries no deck_sha (deck-repair-loop adds it)")
    mine = hashlib.sha256((r.dir / "deck.json").read_bytes()).hexdigest()
    return yes() if mine.startswith(str(sha)) else no([issues.DECK_KEY], measured=str(sha), limit=mine[:12])


# ---------------------------------------------------------------- rendered QA (stage h)

def _qa_check(r: Run, name: str, need_pixels: bool = False) -> dict:
    if need_pixels:
        if not r.qa_pixels:
            return na("qa.json has no 'pixels' entries (no PDF: pixels skipped)")
    elif not r.qa_ok:
        return na(NA_QA)
    hits = [s for s, f in r.qa_findings() if f["check"] == name]
    return _verdict(hits, r.ids, len(hits), 0)


@check
def q_no_overflow(r: Run) -> dict:
    return _qa_check(r, "text_overflow")


@check
def q_no_overlap(r: Run) -> dict:
    return _qa_check(r, "text_overlap")


@check
def q_no_off_slide(r: Run) -> dict:
    return _qa_check(r, "off_slide")


@check
def q_margins_kept(r: Run) -> dict:
    return _qa_check(r, "margin")


@check
def q_body_floor(r: Run) -> dict:
    return _qa_check(r, "min_font")


@check
def q_contrast(r: Run) -> dict:
    return _qa_check(r, "contrast")


@check
def q_no_filler(r: Run) -> dict:
    return _qa_check(r, "placeholder")


@check
def q_not_empty(r: Run) -> dict:
    return _qa_check(r, "mostly_empty", need_pixels=True)


@check
def q_not_cornered(r: Run) -> dict:
    return _qa_check(r, "one_corner", need_pixels=True)


# ---------------------------------------------------------------- layout

def _layout_rows(r: Run, which: list | None = None):
    """``({slide id: record}, theme)`` for the presented slides, or None. ``which``: restrict to these ids."""
    lay = r.layouts()
    if not lay:
        return None
    rec, theme = lay
    return {i: rec[i] for i in (which if which is not None else r.presented) if i in rec}, theme


@check
def l_no_fallback_flow(r: Run) -> dict:
    lay = _layout_rows(r)
    if lay is None:
        return na(NA_LAYOUT)
    rows, theme = lay
    if theme == "classic":
        return na("the deck was drawn with the classic theme: every slide is flow by theme")
    bad = [i for i, x in rows.items() if x.get("fallback")]
    return _verdict(bad, r.ids, len(bad), 0)


@check
def l_no_rule_flow(r: Run) -> dict:
    lay = _layout_rows(r)
    if lay is None:
        return na(NA_LAYOUT)
    bad = [i for i, x in lay[0].items() if x.get("chosen") == spec.LAYOUT_FLOW]
    return _verdict(bad, r.ids, len(bad), 0)


@check
def l_not_relaxed(r: Run) -> dict:
    lay = _layout_rows(r)
    if lay is None:
        return na(NA_LAYOUT)
    bad = [i for i, x in lay[0].items() if x.get("relaxed")]
    return _verdict(bad, r.ids, len(bad), 0)


@check
def l_repeat_max2(r: Run) -> dict:
    lay = _layout_rows(r)
    if lay is None:
        return na(NA_LAYOUT)
    if len(r.content) < 3:
        return na("fewer than 3 presented content slides")
    rows, longest, bad = lay[0], 0, []
    limit = _thr(r, "l_repeat_max2")["max_run"]
    runs, run = [], []
    for i in r.content:   # runs of one layout among content slides, in order
        if run and rows.get(run[-1], {}).get("id") == rows.get(i, {}).get("id"):
            run.append(i)
        else:
            run = [i]
            runs.append(run)
    for run in runs:
        if len({r.deck["slides"][i]["type"] for i in run}) == 1:   # parallel slides of one type may look alike
            continue
        longest = max(longest, len(run))
        if len(run) > limit:
            bad += run
    return _verdict(bad, r.ids, longest, limit)


def _min_distinct(n: int, thr: dict) -> int:
    """Distinct layouts a window of n presented slides needs: 6 in 10, ceil(0.6 x n) for a shorter deck."""
    return thr["min_distinct"] if n >= thr["window"] else math.ceil(0.6 * n)


@check
def l_variety(r: Run) -> dict:
    lay = _layout_rows(r)
    if lay is None:
        return na(NA_LAYOUT)
    if len(r.content) < 5:
        return na("fewer than 5 presented content slides")
    if any(i not in lay[0] for i in r.content):
        return na("a presented content slide has no layout record: its layout is unknown, not a layout of its own")
    thr = _thr(r, "l_variety")
    seq = [lay[0].get(i, {}).get("id") for i in r.content]
    size = min(thr["window"], len(seq))
    need = _min_distinct(len(seq), thr)
    worst, bad = None, []
    for k in range(len(seq) - size + 1):
        d = len(set(seq[k:k + size]))
        if d < need:
            bad += r.content[k:k + size]
        worst = d if worst is None else min(worst, d)
    return _verdict(bad, r.ids, worst, need)


@check
def l_in_library(r: Run) -> dict:
    lay = _layout_rows(r)
    if lay is None:
        return na(NA_LAYOUT)
    known = set(spec.LAYOUT_IDS) | {spec.LAYOUT_FLOW}
    bad = [i for i, x in lay[0].items() if x.get("id") not in known]
    return _verdict(bad, r.ids, len(bad), 0)


@check
def l_one_dominant(r: Run) -> dict:
    lib = DECK / "layouts"
    files = sorted(lib.glob("*.yaml")) if lib.is_dir() else []
    if not files:
        return na("no layout library on disk (engine/deck/layouts/, deck-layout-library): no slot is marked dominant")
    import yaml
    dominant = {}
    for f in files:
        d = yaml.safe_load(f.read_text()) or {}
        dominant[d.get("id", f.stem)] = sum(1 for s in (d.get("slots") or {}).values() if isinstance(s, dict) and s.get("dominant")) \
            if isinstance(d.get("slots"), dict) else sum(1 for s in (d.get("slots") or []) if isinstance(s, dict) and s.get("dominant"))
    rec = (r.layouts() or ({}, None))[0]
    seen = [i for i in r.content if rec.get(i, {}).get("id") in dominant]
    if not seen:
        return na("no presented content slide uses a library layout")
    bad = [i for i in seen if dominant[rec[i]["id"]] > 1]
    return _verdict(bad, r.ids, max(dominant[rec[i]["id"]] for i in seen), 1)


@check
def l_alternatives(r: Run) -> dict:
    recs = {i: (r.deck["slides"][i].get("layout") or {}) for i in r.presented}
    if not any("alternatives" in x for x in recs.values()):
        return na("no slide records layout.alternatives (written by deck-layout-library)")
    bad = [i for i in r.content if not recs[i].get("alternatives")]
    return _verdict(bad, r.ids, len(r.content) - len(bad), len(r.content))


def _reserved_na(names: tuple) -> str | None:
    """The reason a check reading these finding names is n/a while every name is still reserved, else None."""
    if all(n in spec.RESERVED_CHECKS for n in names):
        return "its finding name is still in spec.RESERVED_CHECKS: no code raises it yet"
    return None


@check
def l_slots_clean(r: Run) -> dict:
    names = ("slot_limit", "slot_missing", "slot_unknown", "block_unbound", "slot_stale")
    if not any(r.deck["slides"][i].get("slots") for i in r.presented):
        return na("no presented slide has slots")
    if (why := _reserved_na(names)):
        return na(why)
    if not r.validation_ok:
        return na(NA_VALIDATION)
    hits = [f.get("slide") for f in r.validation if isinstance(f, dict) and f.get("check") in names and f.get("slide") in r.presented]
    return _verdict(hits, r.ids, len(hits), 0)


# ---------------------------------------------------------------- words

def _validation_check(r: Run, name: str) -> dict:
    if not r.validation_ok:
        return na(NA_VALIDATION)
    hits = [f.get("slide") or issues.DECK_KEY for f in r.validation if isinstance(f, dict) and f.get("check") == name
            and (f.get("slide") in r.presented or not f.get("slide") or name == "pitch_length")]
    return _verdict(hits, r.ids + [issues.DECK_KEY], len(hits), 0)


@check
def w_type_budget(r: Run) -> dict:
    return _validation_check(r, "word_budget")


@check
def w_density_met(r: Run) -> dict:
    pref = ((r.deck.get("meta") or {}).get("preferences") or {}).get("density")
    if not isinstance(pref, dict) or not pref.get("level"):
        return na("deck.meta.preferences.density is absent: the build applied no density")
    level = pref["level"]
    if not r.content:
        return na("no presented content slide")
    bad, top = [], 0
    for i in r.content:
        n = _words(r.deck["slides"][i])
        cap = spec.DENSITY_WORDS.get(level, spec.SLIDE_TYPES.get(r.deck["slides"][i]["type"], {}).get("words", n))
        top = max(top, n)
        if n > cap:
            bad.append(i)
    return _verdict(bad, r.ids, top, spec.DENSITY_WORDS.get(level, "type budget"))


@check
def w_pitch_length(r: Run) -> dict:
    if not r.validation_ok:
        return na(NA_VALIDATION)
    hits = [f for f in r.validation if isinstance(f, dict) and f.get("check") == "pitch_length"]
    return yes() if not hits else no([issues.DECK_KEY], len(r.presented), spec.PITCH_MAX)


@check
def w_takeaway_titles(r: Run) -> dict:
    return _validation_check(r, "action_title")


@check
def w_line_length(r: Run) -> dict:
    if r.prs is None:
        return na(NA_PPTX)
    from .. import qa_render
    thr = _thr(r, "w_line_length")
    bad, widest, seen = [], 0.0, 0
    slides = list(r.prs.slides)
    for i in r.presented:
        if r.number(i) > len(slides):
            continue
        for col in qa_render.body_columns(slides[r.number(i) - 1]):
            seen += 1
            if col["lines"] > 1:
                widest = max(widest, col["chars"])
                if col["chars"] > (thr.get("by_role") or {}).get(col["role"], thr["max_chars"]):
                    bad.append(i)
    if not seen:
        return na("no body text frame on a presented slide: nothing measured")
    return _verdict(bad, r.ids, round(widest), thr["max_chars"])


def words_sha(deck: dict) -> str:
    """The one hash of a deck's words: 12 hex of the SHA-256 of its slide ids, titles, blocks and notes in slide order (nothing else:
    not layout, slots, assets, theme or preferences). The checklist's w_words_sha and the frames tests both use THIS function, so a
    picture, a look or a kit can be shown to have changed no word."""
    blob = json.dumps(_words_of(deck), sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:12]


def _words_of(deck: dict) -> list:
    """What the words check hashes: per slide in order, the title, the blocks and the notes (nothing else)."""
    return [[sid, s.get("title"), s.get("blocks"), s.get("notes")] for sid in deck["order"] for s in [deck["slides"][sid]]]


@check
def w_words_sha(r: Run) -> dict:
    if not r.presented:
        return na("no presented slide")
    return value(words_sha(r.deck))


@check
def w_notes_kept(r: Run) -> dict:
    from .. import layouts
    moved = [i for i in r.presented if (((r.deck["slides"][i].get("layout") or {}).get("fit") or {}).get("moved"))]
    if not moved:
        return na("no slide records layout.fit.moved (written by deck-layout-library)")
    if r.prs is None:
        return na(NA_PPTX)
    slides = list(r.prs.slides)
    bad = []
    for i in moved:   # every moved point is in the speaker notes of the pptx: one line, verbatim, with its refs
        n = r.number(i)
        notes = slides[n - 1].notes_slide.notes_text_frame.text if n <= len(slides) and slides[n - 1].has_notes_slide else ""
        if not all(layouts.moved_line(t, refs) in notes for t, refs in layouts.moved_texts(r.deck["slides"][i])):
            bad.append(i)
    return _verdict(bad, r.ids, len(moved) - len(bad), len(moved))


def _content_words(r: Run) -> list:
    return [_words(r.deck["slides"][i]) for i in r.content]


def _share(r: Run, cap: int) -> dict:
    w = _content_words(r)
    if not w:
        return na("no presented content slide")
    return value(round(sum(1 for x in w if x <= cap) / len(w), 3), n=len(w), words=cap)


@check
def m_share_le_30(r: Run) -> dict:
    return _share(r, spec.DENSITY_WORDS["lean"])


@check
def m_share_le_60(r: Run) -> dict:
    return _share(r, spec.DENSITY_WORDS["standard"])


@check
def m_median_words(r: Run) -> dict:
    w = _content_words(r)
    return value(statistics.median(w), n=len(w)) if w else na("no presented content slide")


# ---------------------------------------------------------------- type

def _title_boxes(r: Run) -> dict:
    """``{slide id: {left_in, top_in, size_pt}}`` for presented slides with a Title shape."""
    from .. import qa_render
    slides = list(r.prs.slides)
    out = {}
    for i in r.presented:
        if r.number(i) <= len(slides):
            box = qa_render.title_box(slides[r.number(i) - 1])
            if box:
                out[i] = box
    return out


@check
def t_title_one_place(r: Run) -> dict:
    if r.prs is None:
        return na(NA_PPTX)
    lay = _layout_rows(r)
    if lay is None:
        return na(NA_LAYOUT)
    thr = _thr(r, "t_title_one_place")
    boxes, groups = _title_boxes(r), {}
    for i, b in boxes.items():
        if i in lay[0]:
            groups.setdefault(lay[0][i]["id"], []).append(i)
    groups = {k: v for k, v in groups.items() if len(v) >= 2}
    if not groups:
        return na("no layout has 2 or more presented slides with a Title shape")
    bad, worst = [], 0.0
    for ids in groups.values():
        pos = max(max(boxes[i][k] for i in ids) - min(boxes[i][k] for i in ids) for k in ("left_in", "top_in"))
        sizes = [boxes[i]["size_pt"] for i in ids if boxes[i]["size_pt"] is not None]
        size = (max(sizes) - min(sizes)) if sizes else 0.0
        worst = max(worst, pos)
        if pos > thr["pos_in"] + 1e-9 or size > thr["size_pt"] + 1e-9:
            bad += ids
    return _verdict(bad, r.ids, round(worst, 3), thr["pos_in"])


@check
def t_title_range(r: Run) -> dict:
    if r.prs is None:
        return na(NA_PPTX)
    thr = _thr(r, "t_title_range")
    boxes = _title_boxes(r)
    sized = {i: boxes[i]["size_pt"] for i in r.content if i in boxes and boxes[i]["size_pt"] is not None}
    if not sized:
        return na("no presented content slide has a sized Title shape: nothing measured")
    bad = [i for i, s in sized.items() if not thr["min_pt"] <= s <= thr["max_pt"]]
    return _verdict(bad, r.ids, [min(sized.values(), default=None), max(sized.values(), default=None)], [thr["min_pt"], thr["max_pt"]])


@check
def t_cover_title(r: Run) -> dict:
    if r.prs is None:
        return na(NA_PPTX)
    covers = [i for i in r.presented if r.deck["slides"][i]["type"] == "title"]
    if not covers:
        return na("no presented slide of type title")
    boxes = _title_boxes(r)
    cover = {i: boxes[i]["size_pt"] for i in covers if i in boxes and boxes[i]["size_pt"] is not None}
    content = [boxes[i]["size_pt"] for i in r.content if i in boxes and boxes[i]["size_pt"] is not None]
    if not cover or not content:
        return na("the cover or the content slides have no sized Title shape")
    base = statistics.median(content)
    ratio = _thr(r, "t_cover_title")["min_ratio"]
    got = min(cover.values()) / base
    return _verdict([i for i, sz in cover.items() if sz / base < ratio], r.ids, round(got, 2), ratio)


@check
def t_two_families(r: Run) -> dict:
    if r.prs is None:
        return na(NA_PPTX)
    from .. import qa_render
    fams = qa_render.font_families(r.prs)
    used = sorted({f for i in r.presented for f in fams.get(r.number(i), [])})
    limit = _thr(r, "t_two_families")["max_families"]
    if not used:
        return na("no explicit font name on a presented slide: nothing measured")
    if len(used) <= limit:
        return yes(measured=used)
    return no([i for i in r.presented if fams.get(r.number(i))], used, limit)


# ---------------------------------------------------------------- pictures

def _no_picture(r: Run) -> dict | None:
    return None if r.image_slots() else na(NA_NO_PICTURE)


@check
def p_where_asked(r: Run) -> dict:
    pic = ((r.deck.get("meta") or {}).get("preferences") or {}).get("pictures")
    if not isinstance(pic, dict) or pic.get("on") in (None, "none"):
        return na("deck.meta.preferences.pictures is absent or 'none': the build was not asked for pictures")
    on = pic["on"]
    if on == "custom":
        wanted = [i for i in r.presented if (pic.get("slides") or {}).get(i)]
    else:
        types = CREATIVE_TYPES + (COVER_TYPES if on == "creative_cover" else ())
        wanted = [i for i in r.presented if spec.picture_of(r.deck["slides"][i])[0] in types]
    if not wanted:
        return na("the picture preference asks for no picture on any presented slide")
    have = {s for s, _, _ in r.image_slots()}
    bad = [i for i in wanted if i not in have]
    return _verdict(bad, r.ids, len(wanted) - len(bad), len(wanted))


@check
def m_creative_pictured(r: Run) -> dict:
    ids = [i for i in r.presented if spec.picture_of(r.deck["slides"][i])[0] in spec.PICTURE_SLIDE_TYPES]
    if not ids:
        return na("no presented slide of a picture type")
    have = {s for s, _, _ in r.image_slots()}
    return value(round(sum(1 for i in ids if i in have) / len(ids), 3), n=len(ids))


@check
def p_only_creative(r: Run) -> dict:
    return _no_picture(r) or _verdict([s for s, _, _ in r.image_slots() if spec.picture_of(r.deck["slides"][s])[0] not in spec.PICTURE_SLIDE_TYPES],
                                      r.ids, None, 0)


@check
def p_all_approved(r: Run) -> dict:
    """A metric: the share of placed pictures a person approved (approval naming the slot's own asset). A review build
    shows it as a number; a client build needs 1.0."""
    slots = r.image_slots()
    if not slots:
        return na(NA_NO_PICTURE)
    ok = [1 for _, _, im in slots if im.get("status") == "approved" and isinstance(im.get("approval"), dict)
          and im["approval"].get("decision") == "approve" and im["approval"].get("asset") == im.get("asset")]
    return value(round(len(ok) / len(slots), 3), n=len(slots), audience=(r.deck.get("meta") or {}).get("audience"))


@check
def p_client_approved(r: Run) -> dict:
    if (r.deck.get("meta") or {}).get("audience") != "client":
        return na("the build is not for the client (deck.meta.audience): p_all_approved shows the share instead")
    slots = r.image_slots()
    if not slots:
        return na(NA_NO_PICTURE)
    return _verdict([s for s, _, im in slots if not _approved(im)], r.ids, None, 0)


def _approved(im: dict) -> bool:
    a = im.get("approval")
    return im.get("status") == "approved" and isinstance(a, dict) and a.get("decision") == "approve" and a.get("asset") == im.get("asset") and bool(a.get("by"))


@check
def p_one_style(r: Run) -> dict:
    """One picture style per deck. A hash that differs from the current pack's (``meta.preferences.style_pack.hash``, when the build
    records it) is STALE: counted on its own (``stale``), never as a second style. The rest must agree."""
    cur = (((r.deck.get("meta") or {}).get("preferences") or {}).get("style_pack") or {}).get("hash")
    hashes = {(s, n): (im.get("style") or {}).get("hash") for s, n, im in r.image_slots() if (im.get("style") or {}).get("hash")}   # per picture, not per slide: a territory slide holds four
    if len(hashes) < 2 and not (cur and hashes):
        return na("fewer than 2 placed pictures carry a style hash")
    stale = [k for k, h in hashes.items() if cur and h != cur]
    fresh = {k: h for k, h in hashes.items() if k not in stale}
    if len(set(fresh.values())) > 1:
        return no([k[0] for k in fresh], len(set(fresh.values())), 1, stale=len(stale))
    return yes(stale=len(stale)) if cur else yes()


@check
def p_assets_resolve(r: Run) -> dict:
    if (x := _no_picture(r)):
        return x
    assets = r.deck.get("assets") or {}
    client = (r.deck.get("meta") or {}).get("audience") == "client"
    slots = [x for x in r.image_slots() if not client or _approved(x[2])]   # a client folder holds only the approved pictures it draws
    if not slots:
        return na("a client build with no approved picture: nothing is drawn, so no file is expected")
    where = (lambda rec: images.derived_path(rec)) if client else (lambda rec: rec.get("file") or "\0")   # a client folder holds the derived JPEGs only
    bad = [s for s, _, im in slots if im.get("asset") not in assets or not (r.dir / where(assets[im["asset"]])).is_file()]
    return _verdict(bad, r.ids, len(bad), 0)


@check
def p_rights_ok(r: Run) -> dict:
    if (x := _no_picture(r)):
        return x
    assets = r.deck.get("assets") or {}
    bad = [s for s, _, im in r.image_slots() if (assets.get(im.get("asset")) or {}).get("rights") == "reference_only"]
    return _verdict(bad, r.ids, len(bad), 0)


@check
def p_alt_text(r: Run) -> dict:
    if (x := _no_picture(r)):
        return x
    return _verdict([s for s, _, im in r.image_slots() if not (im.get("alt") or "").strip()], r.ids, None, 0)


def _picture_qa(r: Run, name: str) -> dict:
    if (x := _no_picture(r)):
        return x
    if (why := _reserved_na((name,))):
        return na(why)
    if not r.qa_ok:
        return na(NA_QA)
    hits = [s for s, f in r.qa_findings() if f["check"] == name]
    return _verdict(hits, r.ids, len(hits), 0)


@check
def p_no_stretch(r: Run) -> dict:
    return _picture_qa(r, "picture_stretch")


@check
def p_no_lowres(r: Run) -> dict:
    return _picture_qa(r, "picture_lowres")


@check
def p_text_on_image(r: Run) -> dict:
    return _picture_qa(r, "text_on_image_contrast")


# ---------------------------------------------------------------- kit (the look the deck wears)

def _theme(r: Run):
    t = (r.deck.get("meta") or {}).get("theme")
    return t if isinstance(t, dict) else None


@check
def k_palette_only(r: Run) -> dict:
    th = _theme(r)
    if not th or not isinstance(th.get("colors"), dict):
        return na("deck.meta.theme is absent (the runner writes it)")
    if r.prs is None:
        return na(NA_PPTX)
    from .. import qa_render
    allowed = {str(c).upper().lstrip("#") for c in th["colors"].values() if isinstance(c, str)}
    for c in th["colors"].get("chart") or []:
        allowed.add(str(c).upper().lstrip("#"))
    allowed |= {str(c).upper().lstrip("#") for c in (th.get("semantic") or {}).values()}
    slides = list(r.prs.slides)
    bad, stray = [], set()
    for i in r.presented:
        if r.number(i) <= len(slides):
            out = qa_render.slide_colors(slides[r.number(i) - 1]) - allowed
            if out:
                bad.append(i)
                stray |= out
    return _verdict(bad, r.ids, sorted(stray), "meta.theme.colors")


@check
def k_logo_cover(r: Run) -> dict:
    logo = (_theme(r) or {}).get("logo")
    if not isinstance(logo, dict) or not logo.get("asset") or logo.get("placement") == "none":
        return na("deck.meta.theme.logo is absent, has no asset or placement none")
    if r.prs is None:
        return na(NA_PPTX)
    covers = [i for i in r.presented if r.deck["slides"][i]["type"] == "title"]
    if not covers:
        return na("no presented slide of type title")
    from .. import qa_render
    slides = list(r.prs.slides)
    bad = [i for i in covers if r.number(i) > len(slides) or not qa_render.has_picture(slides[r.number(i) - 1])]
    return _verdict(bad, r.ids, len(covers) - len(bad), len(covers))


# ---------------------------------------------------------------- run

@check
def m_usd(r: Run) -> dict:
    if not isinstance(r.report, dict) or "usd_total" not in r.report:
        return na("report.json is missing")
    return value(r.report["usd_total"], **({"basis": r.report["usd_basis"]} if r.report.get("usd_basis") else {}))


@check
def m_seconds(r: Run) -> dict:
    if not isinstance(r.report, dict) or "wall_secs" not in r.report:
        return na("report.json is missing")
    return value(r.report["wall_secs"], stages={k: (v or {}).get("secs") for k, v in (r.report.get("stages") or {}).items()})


# ---------------------------------------------------------------- the run folder as a whole

def _policy(r: Run):
    """The repair policy (engine/deck/policy/repair.yaml) when deck-repair-loop has written one, else None."""
    p = DECK / "policy" / "repair.yaml"
    if not p.is_file():
        return None
    import yaml
    try:
        d = yaml.safe_load(p.read_text())
    except Exception:
        return None
    return d if isinstance(d, dict) and isinstance(d.get("severity"), dict) else None


Run.policy = lambda self: self._measures.setdefault("policy", _policy(self))


def run_checklist(run_dir: Path, items: dict | None = None, deck_id: str | None = None) -> dict:
    """Every item answered for one run folder: ``{run_dir, inputs, presented, results, summary}``."""
    items = items or load_items()
    r = Run(run_dir, items)
    results = {}
    for it in items["items"]:
        if not r.presented and it["id"].startswith(PER_SLIDE_PREFIXES):   # nothing presented: nothing to pass
            results[it["id"]] = na("no presented slide")
            continue
        res = CHECKS[it["id"]](r)
        if it["kind"] == "metric" and res["answer"] == "yes":
            raise AssertionError(f"{it['id']}: a metric never answers yes")
        results[it["id"]] = res
    count = Counter(v["answer"] for v in results.values())
    return {"run_dir": Path(run_dir).name,
            "inputs": {"deck": True, "validation": r.validation_ok, "qa": r.qa_ok, "qa_pixels": r.qa_pixels,
                       "layouts": r.layouts() is not None, "report": isinstance(r.report, dict), "pptx": r.prs is not None},
            "presented": len(r.presented), "content": len(r.content),
            "results": results,
            "summary": {"yes": count["yes"], "no": count["no"], "na": count["n/a"],
                        "metrics": {k: v["value"] for k, v in results.items() if v["answer"] == "value"}}}


def run_all(runs: list, items: dict | None = None) -> dict:
    """The checklist file: ``{version, items_version, decks: {deck id: result}}``; deck ids as the bench names runs."""
    items = items or load_items()
    return {"version": 1, "items_version": items["version"],
            "decks": {i: run_checklist(Path(p), items) for i, p in zip(run_ids(runs), runs)}}
