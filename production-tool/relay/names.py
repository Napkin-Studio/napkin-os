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
- a `@name` the job has no ref for is an error the participant can fix, not a silent drop.

shot_list is left alone: its output goes back into the document, which keeps people's names.
"""

from __future__ import annotations

import copy
import re

TAG = re.compile(r"^[a-z][a-z0-9_]{2,15}$")
# A mention: @ then key_variant (common.schema.json#/$defs/refName), not inside a word or an address.
MENTION = re.compile(r"(?<![\w@])@([a-z][a-z0-9]{1,23}_[a-z0-9][a-z0-9-]{0,31})")
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


def _rewrite(text: str, by_name: dict[str, str]) -> str:
    def sub(m: re.Match) -> str:
        name = m.group(1)
        # "@maya_front-on" may be @maya_front followed by "-on": take the longest known name.
        while name not in by_name and "-" in name:
            name = name.rsplit("-", 1)[0]
        if name not in by_name:
            raise UnknownName(f"@{m.group(1)} is not one of the images this step was given.")
        return "@" + by_name[name] + m.group(1)[len(name):]
    return MENTION.sub(sub, text)


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
        missing = [n for n in shot.get("refs") or [] if n not in by_name]
        if missing:
            raise UnknownName(f"The shot names @{missing[0]}, but no image has that name.")
        shot["refs"] = [by_name[n] for n in shot.get("refs") or []]
    return out
