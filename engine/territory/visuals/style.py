"""The style pack: the ONLY input Laurence controls.

A folder holding ``style.yaml`` (look words, palette, this-not-that, rough or photo-real, banned imagery) and up to
14 reference images. Changing anything in it changes the style hash, which names a new version folder
(``frames/v<N>-<hash>/``); the territory text and the frame plan are never touched."""
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
from dataclasses import dataclass, field
from pathlib import Path

import yaml

MAX_REFERENCES = 14                      # Runway: referenceImages holds up to 14 for the gemini image models
MAX_DATA_URI = 5 * 1024 * 1024           # Runway: a data URI may be at most 5MB (the encoded string)
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
FINISHES = ("rough", "photo-real")
KNOWN_KEYS = ("look", "palette", "this_not_that", "finish", "banned_imagery", "notes")
DEFAULT_SOURCE = "default until Laurence answers"   # shown on the board and in the manifest; Laurence's pack replaces it (--style <folder>)
GUARD_VERSION = "1"                      # bump when the guard rails below change: it moves the style hash

#: always in the prompt, whatever the style pack says (a real brand's logo once slipped into a frame)
GUARD_RAILS = "No logos, no brand names, no readable signage or text anywhere in the frame."

DEFAULT = {"look": ["natural light", "unstaged", "documentary stills"], "palette": [], "this_not_that": [],
           "finish": "photo-real", "banned_imagery": [], "notes": ""}


class StyleError(ValueError):
    pass


@dataclass
class Style:
    look: list = field(default_factory=list)
    palette: list = field(default_factory=list)
    this_not_that: list = field(default_factory=list)
    finish: str = "photo-real"
    banned_imagery: list = field(default_factory=list)
    notes: str = ""
    references: list = field(default_factory=list)       # Paths actually sent, at most 14, sorted by file name
    ignored_references: list = field(default_factory=list)   # names beyond the cap
    source: str = DEFAULT_SOURCE
    hash: str = ""

    def summary(self) -> dict:
        return {"source": self.source, "hash": self.hash, "finish": self.finish, "look": self.look, "palette": self.palette,
                "this_not_that": self.this_not_that, "banned_imagery": self.banned_imagery, "notes": self.notes,
                "references": [p.name for p in self.references], "ignored_references": self.ignored_references}


def _list(raw, key) -> list:
    if raw is None or raw == "":
        return []
    if isinstance(raw, str):
        return [raw.strip()]
    if isinstance(raw, list):
        out = []
        for x in raw:
            if isinstance(x, dict):                       # this_not_that entries may be {this: .., not: ..}
                this, nope = x.get("this"), x.get("not")
                if not (this and nope):
                    raise StyleError(f"style.yaml: each {key} entry given as a map needs both 'this' and 'not'")
                out.append(f"{this}, not {nope}")
            else:
                out.append(str(x).strip())
        return [x for x in out if x]
    raise StyleError(f"style.yaml: {key} must be a list of words or lines")


def _hash(d: dict, refs: list[Path]) -> str:
    h = hashlib.sha256()
    h.update(json.dumps({"style": d, "guard": GUARD_VERSION, "refs": [[p.name, hashlib.sha256(p.read_bytes()).hexdigest()] for p in refs]},
                        sort_keys=True, ensure_ascii=False).encode())
    return h.hexdigest()[:8]


def load(style_dir: str | Path | None) -> Style:
    """Read a style pack. ``None`` or a missing folder gives the default pack (no references; labelled "default until Laurence answers"): the first run, before
    Laurence's pack arrives. A folder that exists but has no style.yaml is an error: a half-made pack must not pass silently."""
    if style_dir is None:
        raw, refs, src = dict(DEFAULT), [], DEFAULT_SOURCE
    else:
        d = Path(style_dir)
        if not d.is_dir():
            raise StyleError(f"style folder not found: {d}")
        yml = d / "style.yaml"
        if not yml.is_file():
            raise StyleError(f"{d} has no style.yaml")
        raw = yaml.safe_load(yml.read_text()) or {}
        if not isinstance(raw, dict):
            raise StyleError("style.yaml must be a map of look, palette, this_not_that, finish, banned_imagery, notes")
        unknown = sorted(set(raw) - set(KNOWN_KEYS))
        if unknown:
            raise StyleError(f"style.yaml: unknown key(s) {unknown}; known keys are {list(KNOWN_KEYS)}")
        refs = sorted((p for p in d.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_TYPES and not p.name.startswith(".")),
                      key=lambda p: p.name.lower())
        src = str(d)
    finish = str(raw.get("finish") or DEFAULT["finish"]).strip().lower().replace("_", "-").replace("photoreal", "photo-real")
    if finish not in FINISHES:
        raise StyleError(f"style.yaml: finish must be one of {FINISHES}, got {finish!r}")
    norm = {"look": _list(raw.get("look"), "look"), "palette": _list(raw.get("palette"), "palette"),
            "this_not_that": _list(raw.get("this_not_that"), "this_not_that"), "finish": finish,
            "banned_imagery": _list(raw.get("banned_imagery"), "banned_imagery"), "notes": str(raw.get("notes") or "").strip()}
    used, ignored = refs[:MAX_REFERENCES], [p.name for p in refs[MAX_REFERENCES:]]
    return Style(**norm, references=used, ignored_references=ignored, source=src, hash=_hash(norm, used))


def reference_images(style: Style) -> list[dict]:
    """The Runway ``referenceImages`` array: data URIs, tagged ref01.., never more than 14, each under the 5MB data-URI limit."""
    out = []
    for i, p in enumerate(style.references[:MAX_REFERENCES], 1):
        mime = IMAGE_TYPES.get(p.suffix.lower()) or mimetypes.guess_type(p.name)[0] or "image/png"
        uri = f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()
        if len(uri) > MAX_DATA_URI:
            raise StyleError(f"reference image {p.name} is too large for Runway as a data URI (over 5MB encoded): shrink it")
        out.append({"uri": uri, "tag": f"ref{i:02d}"})
    return out


def style_block(style: Style, extra_banned: list[str] | None = None) -> str:
    parts = []
    if style.look:
        parts.append("Look: " + ", ".join(style.look) + ".")
    if style.palette:
        parts.append("Palette: " + ", ".join(style.palette) + ".")
    parts.append("Finish: " + ("rough, unpolished, like a quick storyboard frame." if style.finish == "rough" else "photo-real, like a real photograph or film still."))
    if style.this_not_that:
        parts.append("This, not that: " + "; ".join(style.this_not_that) + ".")
    if style.notes:
        parts.append(style.notes if style.notes.endswith(".") else style.notes + ".")
    if style.references:
        parts.append("Match the visual style of the reference images (look, light, colour, finish), not their subject.")
    banned = list(dict.fromkeys([*style.banned_imagery, *(extra_banned or [])]))
    if banned:
        parts.append("Never show: " + ", ".join(banned) + ".")
    return " ".join(parts)


def frame_prompt(shot: dict, style: Style, extra_banned: list[str] | None = None) -> str:
    """Shot description + style.yaml + guard rails. The on-screen line is NOT in the prompt: asking a picture model for
    words puts words in the picture (the deck puts the line on the slide)."""
    desc = " ".join(s.rstrip(".") + "." for s in (shot.get("framing"), shot.get("camera"), shot.get("action")) if s)
    return f"{desc} {style_block(style, extra_banned)} {GUARD_RAILS}"
