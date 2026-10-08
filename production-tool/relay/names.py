"""People's names for images (key_variant, free variants) to the wire tags a provider job uses.

A participant names an image `maya_laughing` or `maya_three-quarter` and writes `@maya_laughing` in
an instruction, a shot's action or its dialogue. Providers need far less: Runway takes a tag of 3-16
characters from letters, digits and underscores, and the director's check holds every provider to
that (common.schema.json#/$defs/tag). This module is the one place that maps between the two, per
job, before the director sees it:

- each input ref gets a `tag`: its name when that is already a valid tag, else a short unique form;
  an unnamed input (a node the participant never named) is `in_1`, `in_2`… in input order;
- `@name` in `text`, `shot.action` and `shot.dialogue` becomes `@tag`, and `shot.refs` becomes the
  tags (frame and clip send exactly the shot's refs);
- a bare `@key` (`@goremon`) is the whole character: it becomes its front's tag (on fal the front
  leads the key's Kling element, so the tag stands for the element), and a bare key in `shot.refs`
  brings the tags of every picture of that key the job carries. A key with no front among the
  job's refs cannot be named bare (the owner's choice, 2026-10-07): set a front first;
- a `@name` the job has no ref for is an error the participant can fix, not a silent drop.

shot_list is left alone: its output goes back into the document, which keeps people's names.
"""

from __future__ import annotations

import copy
import re

TAG = re.compile(r"^[a-z][a-z0-9_]{2,15}$")
# A mention: @ then key_variant (refName) or a bare key, not inside a word or an address.
MENTION = re.compile(r"(?<![\w@])@([a-z][a-z0-9]{1,23}(?:_[a-z0-9][a-z0-9-]{0,31})?)")
MAX = 16


class UnknownName(ValueError):
    """The words name an image the job was not given."""


def _short(name: str, taken: set[str]) -> str:
    base = name.replace("-", "_")
    if not TAG.match(base):
        key, _, variant = base.partition("_")
        base = f"{key[:6]}_{variant}"[:MAX].rstrip("_")
    if base not in taken and TAG.match(base):
        return base
    for n in range(2, 100):
        cand = f"{base[:MAX - len(str(n))].rstrip('_')}{n}"
        if cand not in taken:
            return cand
    raise ValueError(f"no free tag for {name}")


def wire_tags(refs: list[dict]) -> dict[str, str]:
    """Ref id -> wire tag, stable for the same refs in the same order."""
    taken: set[str] = set()
    out: dict[str, str] = {}
    unnamed = 0
    # Named refs first, so a name that is already a valid tag keeps it.
    for r in refs:
        if r.get("name"):
            tag = _short(r["name"], taken)
            taken.add(tag)
            out[r["id"]] = tag
    for r in refs:
        if not r.get("name"):
            unnamed += 1
            tag = f"in_{unnamed}"
            while tag in taken:
                unnamed += 1
                tag = f"in_{unnamed}"
            taken.add(tag)
            out[r["id"]] = tag
    return out


def _front_tag(key: str, by_name: dict[str, str]) -> str:
    """The tag a bare @key stands for: its front's."""
    if f"{key}_front" in by_name:
        return by_name[f"{key}_front"]
    if any(n.split("_", 1)[0] == key for n in by_name):
        raise UnknownName(f"Set a front for {key} first: @{key} stands for the whole character, led by its front.")
    raise UnknownName(f"@{key} is not one of the images this step was given.")


def _rewrite(text: str, by_name: dict[str, str]) -> str:
    def sub(m: re.Match) -> str:
        name = m.group(1)
        if "_" not in name:
            return "@" + _front_tag(name, by_name)
        # "@maya_front-on" may be @maya_front followed by "-on": take the longest known name.
        while name not in by_name and "-" in name:
            name = name.rsplit("-", 1)[0]
        if name not in by_name:
            raise UnknownName(f"@{m.group(1)} is not one of the images this step was given.")
        return "@" + by_name[name] + m.group(1)[len(name):]
    return MENTION.sub(sub, text)


def _named(payload: dict) -> set[str]:
    """Every key_variant the job names outright: in the shot's refs, its words or the instruction."""
    shot = payload.get("shot") or {}
    words = [payload.get("text") or "", shot.get("action") or "", shot.get("dialogue") or ""]
    named = {n for n in shot.get("refs") or [] if "_" in n}
    named |= {m for w in words for m in MENTION.findall(w) if "_" in m}
    return named


def fit_refs(op: str, payload: dict, sheet: dict | None) -> tuple[dict, list[str]]:
    """The job input with its character refs cut to what `sheet` takes (refs.maxCharacter, refs.max),
    and the names it dropped (features/harness-refusals.clan).

    A bare key (`@uberto`) brings its front and up to 3 more views, so two whole characters can be 8
    character refs where fal and Runway take 5. Only views the job does not name outright are dropped,
    last first: a front stays (a bare key stands for it), and so does any picture named in the shot's
    refs or its words. When that is not enough the input goes as it is and the sheet check refuses it.
    """
    limits = (sheet or {}).get("refs") or {}
    refs = payload.get("refs") or []
    if op == "shot_list" or not refs or not limits:
        return payload, []
    # anchorFrame, previousFrame and a region edit's image go as refs too (director.v4).
    reserved = sum(1 for k in ("anchorFrame", "previousFrame") if payload.get(k)) + (op == "region_edit")
    max_char = limits.get("maxCharacter", len(refs))
    max_all = max(limits.get("max", len(refs) + reserved) - reserved, 0)
    named = _named(payload)
    kept = list(refs)
    dropped: list[str] = []

    def over() -> bool:
        return sum(r.get("role") == "character" for r in kept) > max_char or len(kept) > max_all

    for r in reversed(refs):
        if not over():
            break
        name = r.get("name") or ""
        if "_" not in name or name.endswith("_front") or name in named:
            continue
        if r.get("role") != "character" and len(kept) <= max_all:
            continue
        kept.remove(r)
        dropped.append(name)
    if not dropped:
        return payload, []
    return {**payload, "refs": kept}, dropped


def to_wire(op: str, payload: dict) -> dict:
    """A copy of the job input with wire tags on its refs and in its words. shot_list is unchanged."""
    if op == "shot_list":
        return payload
    out = copy.deepcopy(payload)
    refs = out.get("refs") or []
    tags = wire_tags(refs)
    by_name = {}
    for r in refs:
        r["tag"] = tags[r["id"]]
        if r.get("name"):
            by_name[r["name"]] = r["tag"]
    if out.get("text"):
        out["text"] = _rewrite(out["text"], by_name)
    shot = out.get("shot")
    if shot:
        for field in ("action", "dialogue"):
            if shot.get(field):
                shot[field] = _rewrite(shot[field], by_name)
        tags: list[str] = []
        for n in shot.get("refs") or []:
            if "_" in n:
                if n not in by_name:
                    raise UnknownName(f"The shot names @{n}, but no image has that name.")
                found = [by_name[n]]
            else:  # a whole character: its front first, then its other pictures in this job
                found = [_front_tag(n, by_name)] + [t for m, t in by_name.items() if m.split("_", 1)[0] == n and m != f"{n}_front"]
            tags += [t for t in found if t not in tags]
        shot["refs"] = tags
    return out
