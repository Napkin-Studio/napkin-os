"""Stage h: rendered-slide QA. Deterministic, no model, no new dependency (ADR 0016, NAPKIN-EDGE gap 9).

    python3 -m deck.qa_render deck.pptx [--pdf deck.pdf] [--out DIR] [--validation validation.json]

Reads the finished ``.pptx`` (python-pptx) and, when a PDF is given, a low-resolution render of it
(``pdftoppm`` writes a P6 PPM that a tiny pure-Python parser reads: no Pillow). Findings are
``{check, level: warn|error, message}`` per slide. A QA finding never fails a build: ``run`` never
raises, and a pptx it cannot open becomes one error under the key ``"deck"``.

Checks (geometry, from the pptx):
  off_slide       a shape reaches outside the slide
  margin          a text frame closer than MARGIN_IN to a slide edge (footer furniture is exempt: it
                  sits in the margin on purpose)
  text_overlap    the estimated text of two frames overlaps
  text_overflow   estimated text height clearly over its frame, or running off the slide bottom
  min_font        a run under its floor: title 24 pt, body 12 pt, caption 10 pt, footer 9 pt. The floors
                  are theme.Scale's (title_min, body_floor, caption_floor, foot_floor), the same numbers the
                  renderer clamps to, so a layout theme cannot trip them by construction. A frame named
                  "Caption" is a label (floor 10); the frames in CHROME (footer, slide number, source keys,
                  DRAFT and CHECK FAILED marks) answer to the footer floor only: a named allowance, not a
                  blanket exemption
  placeholder     '[Agency]', 'lorem', 'TBD', 'XXX' on a presented slide (a slide the validator already
                  flags for the [Agency] placeholder is skipped)
  contrast        WCAG ratio of a run's colour on its shape fill or the slide background, where both
                  are known: 4.5:1 text, 3:1 large text (18 pt, or 14 pt bold)
Pixels (from the render):
  mostly_empty    almost nothing but background
  one_corner      the content sits in one corner (share of non-background area per third of the slide)

The text-height estimate is a character-count one (average glyph width as a share of the font size),
so it flags only what is clearly over. Hidden slides (the appendix) are checked for geometry but not
for placeholders, and are not in the PDF, so they get no pixel check.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

from .theme import Scale

EMU_IN = 914400
MARGIN_IN = 0.5
#: Minimum point sizes by role, read from the theme's scale (one source of truth with the renderer).
_SCALE = Scale()
FLOORS = {"title": float(_SCALE.title_min), "body": float(_SCALE.body_floor),
          "caption": float(_SCALE.caption_floor), "foot": float(_SCALE.foot_floor)}
#: Frames that are footer or watermark furniture: they sit in the margin by design and may be set as small
#: as the footer floor (9-10 pt). This is the named allowance for footer and source lines.
CHROME = {"Watermark", "SlideNumber", "Footnotes", "Section", "CheckFailed"}
#: Frames that are labels (a tag over a card, a kicker, an illustrative note): the caption floor.
CAPTION_NAMES = {"Caption"}
#: Left-over filler. [Agency] is skipped on a slide the validator already flags.
FILLER = (
    ("[Agency]", re.compile(r"\[Agency\]")),
    ("lorem ipsum", re.compile(r"\blorem\b|\bipsum\b", re.I)),
    ("TBD", re.compile(r"\bTBD\b")),
    ("XXX", re.compile(r"\bXXX+\b")),
)
SERIF = ("cambria", "georgia", "times", "garamond")
PIXEL_DPI = 30
#: Share of the slide that is not background, below which it reads as empty (warn) or blank (error).
EMPTY_WARN, EMPTY_ERROR = 0.02, 0.004
#: Share of the content in one third (both ways) above which it reads as one corner.
CORNER_SHARE = 0.8


# ---------------------------------------------------------------- colour

def _lum(c) -> float:
    """WCAG relative luminance of an (r, g, b) tuple of 0-255 values."""
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def contrast_ratio(a, b) -> float:
    """WCAG contrast ratio (1 to 21) between two (r, g, b) colours."""
    la, lb = _lum(a), _lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


# ---------------------------------------------------------------- pptx helpers

def _hidden(slide) -> bool:
    """True when the slide is hidden from the slideshow (the appendix is)."""
    return slide._element.get("show") == "0"


def _bg_rgb(slide):
    """The slide's solid background colour as (r, g, b), or None when it is not a plain solid colour."""
    try:
        ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main",
              "p": "http://schemas.openxmlformats.org/presentationml/2006/main"}
        el = slide._element.find("p:cSld/p:bg/p:bgPr/a:solidFill/a:srgbClr", ns)
        if el is not None:
            h = el.get("val")
            return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        pass
    return None


def _solid_fill(shape):
    """A shape's solid fill colour as (r, g, b), or None (no fill, gradient, theme colour, no fill property)."""
    try:
        f = shape.fill
        if f.type == 1:   # MSO_FILL.SOLID
            return tuple(f.fore_color.rgb)
    except Exception:
        pass
    return None


def _run_rgb(run):
    """A run's explicit text colour as (r, g, b), or None when inherited or a theme colour."""
    try:
        return tuple(run.font.color.rgb)
    except Exception:
        return None


def _para_size(p, default=18.0) -> float:
    """The largest explicit run size in a paragraph, in points, else the default."""
    sizes = [r.font.size.pt for r in p.runs if r.font.size]
    return max(sizes) if sizes else default


def _est_height_in(tf, width_in: float) -> float:
    """Estimated rendered height of a text frame in inches (see ``_est_size``)."""
    return _est_size(tf, width_in)[0]


def _est_size(tf, width_in: float):
    """Estimated rendered (height, widest line) of a text frame in inches, by character count.

    Glyph width is taken as 0.5 of the font size (0.56 bold, +0.02 serif), words wrap greedily,
    a line is 1.2 times the size (times the paragraph's line spacing) and paragraph spacing is added.
    """
    avail_pt = max((width_in - (tf.margin_left + tf.margin_right) / EMU_IN) * 72, 10.0)
    total_pt = (tf.margin_top + tf.margin_bottom) / EMU_IN * 72
    widest = 0.0
    for p in tf.paragraphs:
        text = "".join(r.text for r in p.runs)
        sz = _para_size(p)
        bold = any(r.font.bold for r in p.runs)
        name = next((r.font.name for r in p.runs if r.font.name), "") or ""
        k = (0.56 if bold else 0.5) + (0.02 if name.lower().startswith(SERIF) else 0)
        per_line = max(int(avail_pt / (sz * k)), 1)
        lines, cur = 1, 0
        widest = max(widest, min(len(text) * sz * k, avail_pt))
        for w in text.split():
            n = len(w)
            if cur and cur + 1 + n > per_line:
                lines, cur = lines + 1, n
            else:
                cur = cur + 1 + n if cur else n
            while cur > per_line:   # a word longer than the line breaks across lines
                lines, cur = lines + 1, cur - per_line
        ls = p.line_spacing if isinstance(p.line_spacing, float) else 1.0
        total_pt += lines * sz * 1.2 * ls
        total_pt += (p.space_after.pt if p.space_after else 0) + (p.space_before.pt if p.space_before else 0)
    return total_pt / 72, (widest + (tf.margin_left + tf.margin_right) / EMU_IN * 72) / 72


def _role(shape) -> str:
    """title, foot, caption or body: which font-size floor a text frame answers to."""
    name = shape.name or ""
    if name == "Title" or "title" in name.lower():
        return "title"
    if name in CHROME:
        return "foot"
    if name in CAPTION_NAMES:
        return "caption"
    return "body"


def _add(out: list, check: str, level: str, message: str) -> None:
    """Append one finding."""
    out.append({"check": check, "level": level, "message": message})


def _clip(text: str, n: int = 40) -> str:
    """A single-line excerpt of text for a message."""
    t = " ".join(text.split())
    return t if len(t) <= n else t[:n - 1] + "…"


# ---------------------------------------------------------------- per-slide geometry

#: The one fixed label that may carry the word DRAFT: the watermark render_pptx adds.
DRAFT_MARK = re.compile(r"DRAFT · (?:needs a person|\d+ slides need a person)")


def _is_draft_mark(shape, txt: str) -> bool:
    """True only for the fixed DRAFT watermark: the shape named Watermark holding exactly its label."""
    return (shape.name or "") == "Watermark" and bool(DRAFT_MARK.fullmatch(txt.strip()))


def _scan_filler(txt: str, out: list, validated_leak: bool) -> None:
    """Add a placeholder error for each kind of filler found in txt."""
    for label, rx in FILLER:
        if rx.search(txt) and not (label == "[Agency]" and validated_leak):
            _add(out, "placeholder", "error", f"left-over '{label}' on a presented slide: \"{_clip(txt, 40)}\"")


def _walk(shapes):
    """Yield every shape, descending into groups."""
    for sh in shapes:
        yield sh
        if getattr(sh, "shape_type", None) == 6 and hasattr(sh, "shapes"):   # MSO_SHAPE_TYPE.GROUP
            yield from _walk(sh.shapes)


def _scan_hidden_text(slide, out: list, validated_leak: bool) -> None:
    """Filler in grouped shapes (text and tables) and in the speaker notes of a presented slide."""
    for sh in _walk(slide.shapes):
        if sh.shape_type == 6:
            continue
        if sh.element.getparent() is slide.shapes._spTree:
            continue   # top-level shapes are scanned by _check_slide
        if getattr(sh, "has_table", False) and sh.has_table:
            for row in sh.table.rows:
                for c in row.cells:
                    _scan_filler(c.text_frame.text, out, validated_leak)
        elif sh.has_text_frame and not _is_draft_mark(sh, sh.text_frame.text):
            _scan_filler(sh.text_frame.text, out, validated_leak)
    if slide.has_notes_slide:
        _scan_filler(slide.notes_slide.notes_text_frame.text, out, validated_leak)

def _check_slide(slide, W: int, H: int, validated_leak: bool) -> list:
    """Geometry, font, placeholder and contrast findings for one slide."""
    out: list = []
    bg = _bg_rgb(slide)
    presented = not _hidden(slide)
    fills = []   # (x, y, w, h, rgb) of earlier filled shapes: what later text sits on
    ext = []     # estimated text extents for the overlap check
    tol = 9144   # 0.01 in
    for sh in slide.shapes:
        if sh.left is None or sh.top is None or sh.width is None or sh.height is None:
            continue
        x, y, w, h = sh.left, sh.top, sh.width, sh.height
        if x < -tol or y < -tol or x + w > W + tol or y + h > H + tol:
            _add(out, "off_slide", "error", f"'{sh.name}' reaches outside the slide")
        own = _solid_fill(sh)
        has_text = sh.has_text_frame and sh.text_frame.text.strip()
        if own and not has_text:
            fills.append((x, y, w, h, own))
        if getattr(sh, "has_table", False) and sh.has_table:
            _check_table(sh, slide, out, H, bg)
            if presented:
                for row in sh.table.rows:
                    for c in row.cells:
                        _scan_filler(c.text_frame.text, out, validated_leak)
            continue
        if not has_text:
            continue
        tf = sh.text_frame
        txt = tf.text.strip()
        role = _role(sh)
        wi, hi = w / EMU_IN, h / EMU_IN
        # margins
        if sh.name not in CHROME:
            for side, d in (("left", x / EMU_IN), ("right", (W - x - w) / EMU_IN),
                            ("top", y / EMU_IN), ("bottom", (H - y - h) / EMU_IN)):
                if 0 <= d < MARGIN_IN - 0.005:
                    _add(out, "margin", "warn", f"'{sh.name}' is {d:.2f} in from the {side} edge (under {MARGIN_IN} in): \"{_clip(txt, 24)}\"")
        # font floors
        floor = FLOORS[role]
        for p in tf.paragraphs:
            for r in p.runs:
                if r.font.size and r.text.strip() and r.font.size.pt < floor - 1e-6:
                    lvl = "error" if r.font.size.pt < floor - 2 else "warn"
                    _add(out, "min_font", lvl, f"{r.font.size.pt:g} pt {role} text (floor {floor:g}): \"{_clip(r.text, 30)}\"")
        # overflow
        est, used_w = _est_size(tf, wi)
        top_in = y / EMU_IN
        if top_in + est > H / EMU_IN + 0.02:
            _add(out, "text_overflow", "error", f"'{sh.name}' text runs off the slide bottom (about {est:.1f} in tall from {top_in:.1f} in): \"{_clip(txt, 24)}\"")
        elif est > hi * 1.6 and est - hi > 0.4:
            _add(out, "text_overflow", "error", f"'{sh.name}' text is about {est:.1f} in tall in a {hi:.1f} in frame: \"{_clip(txt, 24)}\"")
        elif est > hi * 1.3 and est - hi > 0.2:
            _add(out, "text_overflow", "warn", f"'{sh.name}' text is about {est:.1f} in tall in a {hi:.1f} in frame: \"{_clip(txt, 24)}\"")
        # extents for overlap
        anchor = tf.vertical_anchor
        t = top_in
        if anchor == 3:
            t = top_in + (hi - est) / 2
        elif anchor == 4:
            t = top_in + hi - est
        left = x / EMU_IN
        al = tf.paragraphs[0].alignment
        uw = min(used_w, wi)
        if al == 3:      # PP_ALIGN.RIGHT
            left += wi - uw
        elif al == 2:    # PP_ALIGN.CENTER
            left += (wi - uw) / 2
        ext.append((sh.name, left, t, uw, est, txt))
        # filler on a presented slide
        if presented and not _is_draft_mark(sh, txt):
            _scan_filler(txt, out, validated_leak)
        # contrast
        under = own
        if under is None:
            cx, cy = x + w // 2, y + h // 2
            for fx, fy, fw, fh, fc in fills:
                if fx <= cx <= fx + fw and fy <= cy <= fy + fh:
                    under = fc
        if under is None:
            under = bg
        if under is not None:
            _check_contrast(tf, under, out)
    if presented:
        _scan_hidden_text(slide, out, validated_leak)
    for i in range(len(ext)):
        for j in range(i + 1, len(ext)):
            a, b = ext[i], ext[j]
            ox = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
            oy = min(a[2] + a[4], b[2] + b[4]) - max(a[2], b[2])
            if ox > 0.1 and oy > 0.1:
                _add(out, "text_overlap", "warn", f"text of '{a[0]}' and '{b[0]}' overlaps: \"{_clip(a[5], 20)}\" / \"{_clip(b[5], 20)}\"")
    return out


def _check_contrast(tf, under, out: list) -> None:
    """Contrast findings for the runs of one text frame on a known colour."""
    seen = set()
    for p in tf.paragraphs:
        for r in p.runs:
            fg = _run_rgb(r)
            if fg is None or not r.text.strip():
                continue
            sz = r.font.size.pt if r.font.size else 18.0
            large = sz >= 18 or (sz >= 14 and bool(r.font.bold))
            need = 3.0 if large else 4.5
            cr = contrast_ratio(fg, under)
            key = (fg, round(cr, 2))
            if cr < need and key not in seen:
                seen.add(key)
                _add(out, "contrast", "error" if cr < 2.0 else "warn",
                     f"contrast {cr:.1f}:1 (needs {need:g}:1) for \"{_clip(r.text, 30)}\" #{'%02X%02X%02X' % fg} on #{'%02X%02X%02X' % tuple(under)}")


def _check_table(sh, slide, out: list, H: int, bg) -> None:
    """Font floor, contrast and bottom-edge findings for a table."""
    tbl = sh.table
    rows_h = 0.0
    for row in tbl.rows:
        need = row.height / EMU_IN
        for ci, c in enumerate(row.cells):
            cw = tbl.columns[ci].width / EMU_IN
            need = max(need, _est_height_in(c.text_frame, cw))
            for p in c.text_frame.paragraphs:
                for r in p.runs:
                    if r.font.size and r.text.strip() and r.font.size.pt < FLOORS["body"] - 1e-6:
                        lvl = "error" if r.font.size.pt < FLOORS["body"] - 2 else "warn"
                        _add(out, "min_font", lvl, f"{r.font.size.pt:g} pt table text (floor {FLOORS['body']:g}): \"{_clip(r.text, 30)}\"")
            under = None
            try:
                if c.fill.type == 1:
                    under = tuple(c.fill.fore_color.rgb)
            except Exception:
                pass
            under = under or bg
            if under is not None:
                _check_contrast(c.text_frame, under, out)
        rows_h += need
    if sh.top / EMU_IN + rows_h > H / EMU_IN + 0.02:
        _add(out, "text_overflow", "error", f"table runs off the slide bottom (about {sh.top / EMU_IN + rows_h:.1f} in)")


# ---------------------------------------------------------------- pixels

def read_ppm(path: Path):
    """Parse a binary P6 PPM: (width, height, bytes of r, g, b triples). Raises ValueError otherwise."""
    data = Path(path).read_bytes()
    pos, toks, n = 0, [], len(data)
    while len(toks) < 4:
        while pos < n and data[pos:pos + 1].isspace():
            pos += 1
        if pos >= n:
            raise ValueError("truncated PPM header")
        if data[pos:pos + 1] == b"#":
            while pos < n and data[pos:pos + 1] != b"\n":
                pos += 1
            continue
        end = pos
        while end < n and not data[end:end + 1].isspace():
            end += 1
        if end >= n:
            raise ValueError("truncated PPM header")
        toks.append(data[pos:end])
        pos = end
    if toks[0] != b"P6" or not all(t.isdigit() for t in toks[1:]) or int(toks[3]) != 255:
        raise ValueError("not an 8-bit P6 PPM")
    pos += 1   # the single whitespace byte after maxval
    w, h = int(toks[1]), int(toks[2])
    px = data[pos:pos + w * h * 3]
    if len(px) != w * h * 3:
        raise ValueError("truncated PPM")
    return w, h, px


def ink_shares(w: int, h: int, px: bytes, tol: int = 48) -> dict:
    """Share of non-background area, total and per third of the slide.

    The background is the commonest colour on the image border. A pixel is ink when its channels
    differ from it by more than ``tol`` in total. Returns ``{ink, h3: [l, m, r], v3: [t, m, b]}``
    where the thirds are shares of the slide's area.
    """
    border = Counter()
    for x in range(w):
        for y in (0, h - 1):
            i = (y * w + x) * 3
            border[px[i:i + 3]] += 1
    for y in range(h):
        for x in (0, w - 1):
            i = (y * w + x) * 3
            border[px[i:i + 3]] += 1
    br, bg_, bb = border.most_common(1)[0][0]
    hc, vc = [0, 0, 0], [0, 0, 0]
    for y in range(h):
        row = y * w * 3
        vy = min(3 * y // h, 2)
        for x in range(w):
            i = row + x * 3
            if abs(px[i] - br) + abs(px[i + 1] - bg_) + abs(px[i + 2] - bb) > tol:
                hc[min(3 * x // w, 2)] += 1
                vc[vy] += 1
    area = w * h
    return {"ink": round(sum(hc) / area, 4), "h3": [round(c / area * 3, 3) for c in hc], "v3": [round(c / area * 3, 3) for c in vc],
            "_counts": (hc, vc)}


def _check_pixels(m: dict) -> list:
    """Findings from one slide's ink shares."""
    out: list = []
    ink = m["ink"]
    hc, vc = m["_counts"]
    if ink < EMPTY_ERROR:
        _add(out, "mostly_empty", "error", f"slide is blank: {ink * 100:.2f}% of it is not background")
    elif ink < EMPTY_WARN:
        _add(out, "mostly_empty", "warn", f"slide is almost empty: {ink * 100:.1f}% of it is not background")
    total = sum(hc)
    if total and ink >= EMPTY_ERROR and max(hc) / total >= CORNER_SHARE and max(vc) / total >= CORNER_SHARE:
        hn, vn = ("left", "middle", "right")[hc.index(max(hc))], ("top", "middle", "bottom")[vc.index(max(vc))]
        _add(out, "one_corner", "warn", f"content sits in one corner ({vn} {hn}): {max(hc) / total * 100:.0f}% of it in the {hn} third, {max(vc) / total * 100:.0f}% in the {vn} third")
    return out


def render_ppm(pdf: Path, workdir: Path, dpi: int = PIXEL_DPI) -> list:
    """Render a PDF to PPM files with pdftoppm at a low resolution; returns the page paths in order."""
    exe = shutil.which("pdftoppm") or "/opt/homebrew/bin/pdftoppm"
    subprocess.run([exe, "-r", str(dpi), str(pdf), str(workdir / "p")], check=True, capture_output=True, timeout=120)
    return sorted(workdir.glob("p-*.ppm"))


# ---------------------------------------------------------------- driver

def check_pptx(pptx: Path, pdf: Path | None = None, validation: list | None = None) -> dict:
    """QA one deck. Returns ``{"slides": {n: [findings]}, "pixels": {n: shares}, "summary": {...}}``.

    Never raises: an unreadable pptx is one error under ``"deck"``. ``validation`` is the validator's
    findings list, used to skip an [Agency] placeholder it already flags.
    """
    slides: dict = {}
    pixels: dict = {}
    notes: list = []
    try:
        from pptx import Presentation
        prs = Presentation(str(pptx))
        W, H = prs.slide_width, prs.slide_height
        leaks = {f.get("slide_no") for f in (validation or []) if f.get("check") == "internal_leak"}
        presented = []
        for n, sl in enumerate(prs.slides, 1):
            try:
                found = _check_slide(sl, W, H, n in leaks)
            except Exception as e:   # one odd slide never stops the rest
                found = [{"check": "qa_internal", "level": "warn", "message": f"slide could not be checked: {type(e).__name__}: {e}"}]
            if found:
                slides[str(n)] = found
            if not _hidden(sl):
                presented.append(n)
        if pdf and Path(pdf).exists():
            tmp = Path(tempfile.mkdtemp(prefix="qa_ppm_"))
            try:
                pages = render_ppm(Path(pdf), tmp)
                if len(pages) != len(presented):
                    notes.append(f"pixels skipped: {len(pages)} rendered pages for {len(presented)} presented slides")
                else:
                    for n, pg in zip(presented, pages):
                        m = ink_shares(*read_ppm(pg))
                        found = _check_pixels(m)
                        m.pop("_counts")
                        pixels[str(n)] = m
                        if found:
                            slides.setdefault(str(n), []).extend(found)
            except Exception as e:
                notes.append(f"pixels skipped: {type(e).__name__}: {e}")
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        else:
            notes.append("pixels skipped: no PDF")
    except Exception as e:
        slides = {"deck": [{"check": "unreadable", "level": "error", "message": f"the pptx could not be checked: {type(e).__name__}: {e}"}]}
    return {"slides": slides, "pixels": pixels, "summary": summarise(slides, notes)}


def summarise(slides: dict, notes: list | None = None) -> dict:
    """Counts of errors, warnings and findings by check, plus a one-line text."""
    allf = [f for fs in slides.values() for f in fs]
    errors = sum(1 for f in allf if f["level"] == "error")
    by = Counter(f["check"] for f in allf)
    s = {"errors": errors, "warnings": len(allf) - errors, "total": len(allf), "slides_flagged": len(slides),
         "by_check": dict(sorted(by.items()))}
    if notes:
        s["notes"] = notes
    s["line"] = (f"QA: {errors} errors, {len(allf) - errors} warnings on {len(slides)} slides"
                 + (" (" + ", ".join(f"{k} {v}" for k, v in sorted(by.items(), key=lambda kv: -kv[1])) + ")" if by else ""))
    return s


def run(pptx: Path, pdf: Path | None, out_dir: Path, validation: list | None = None) -> dict:
    """Run the QA, write ``out_dir/qa.json`` and return its content. Never raises."""
    try:
        res = check_pptx(pptx, pdf, validation)
    except Exception as e:   # belt and braces: check_pptx already catches
        res = {"slides": {"deck": [{"check": "unreadable", "level": "error", "message": str(e)}]}, "pixels": {}, "summary": summarise({"deck": [{"check": "unreadable", "level": "error"}]})}
    try:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        (Path(out_dir) / "qa.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))
    except OSError as e:
        res["summary"].setdefault("notes", []).append(f"qa.json not written: {e}")
    return res


def main(argv=None) -> int:
    """CLI: QA one pptx, print the summary and the findings, write qa.json when --out is given. Always exits 0."""
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pptx", type=Path)
    ap.add_argument("--pdf", type=Path, help="the deck's PDF, for the pixel checks")
    ap.add_argument("--out", type=Path, help="directory to write qa.json into")
    ap.add_argument("--validation", type=Path, help="validation.json from the same run")
    a = ap.parse_args(argv)
    val = json.loads(a.validation.read_text()) if a.validation and a.validation.exists() else None
    res = run(a.pptx, a.pdf, a.out, val) if a.out else check_pptx(a.pptx, a.pdf, val)
    print(res["summary"]["line"])
    for n, fs in res["slides"].items():
        for f in fs:
            print(f"  slide {n} {f['level']:5} {f['check']}: {f['message']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
