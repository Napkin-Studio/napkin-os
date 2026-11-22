"""People's names for images (key_variant, free variants) to the wire tags a provider job uses.

A participant names an image `maya_laughing` or `maya_three-quarter` and writes `@maya_laughing` in
an instruction, a shot's action, direction or beats. Providers need far less: Runway takes a tag of 3-16
characters from letters, digits and underscores, and the director's check holds every provider to
that (common.schema.json#/$defs/tag). This module is the one place that maps between the two, per
job, before the director sees it:

- each input ref gets a `tag`: its name when that is already a valid tag, else a short unique form;
  an unnamed input (a node the participant never named) is `in_1`, `in_2`… in input order;
- `@name` in `text`, the shot's `action`, `direction`, `direction_condensed` and beat texts becomes `@tag`,
  and `shot.refs` (contract 3's JobShot: names) becomes the
  tags (frame and clip send exactly the shot's refs);
- a bare `@key` (`@goremon`) is the whole character: it becomes its front's tag, and a bare key
  in `shot.refs` brings the tags of every picture of that key the job carries. A key with no front among the
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
# The words of a contract-3 JobShot that may name pictures.
SHOT_WORDS = ("action", "direction", "direction_condensed")


class UnknownName(ValueError):
    """The words name an image the job was not given."""


def _squeeze(word: str) -> str:
    return word[0] + re.sub(r"[aeiou]", "", word[1:])


# Short forms a reader knows, tried before any word loses its vowels (round 3, R2-14 leftover: ruby_back-three-quarter
# went as rby_bck_thr_qrtr): word runs first, then single words.
SHORT_RUNS = ((("three", "quarter"), "3q"), (("three", "quarters"), "3q"), (("over", "the", "shoulder"), "ots"),
              (("over", "shoulder"), "ots"), (("close", "up"), "cu"), (("extreme", "close", "up"), "ecu"),
              (("full", "body"), "full"), (("half", "body"), "half"))
SHORT_WORDS = {"quarter": "qtr", "quarters": "qtr", "background": "bg", "foreground": "fg", "closeup": "cu",
               "profile": "prof", "medium": "med", "portrait": "port", "standing": "stand", "sitting": "sit",
               "smiling": "smile", "laughing": "laugh", "walking": "walk", "running": "run", "looking": "look"}
FILLER = frozenset(("the", "a", "an", "of", "and", "with", "in", "on", "at", "view", "shot", "pose"))


def _shorter(words: list[str]) -> list[str]:
    """The key, then the variant's words with known runs and words in their short forms."""
    out, i = words[:1], 1
    while i < len(words):
        for run, short in SHORT_RUNS:
            if tuple(words[i:i + len(run)]) == run:
                out.append(short)
                i += len(run)
                break
        else:
            out.append(words[i])
            i += 1
    return out


def fit_tag(name: str) -> str:
    """A name as a tag of at most MAX characters (Runway's limit) that still reads (R2-14). In order, only while it is
    too long: the variant's filler words go (the, of, view), known runs and words take their short forms
    (back-three-quarter is back_3q, over-the-shoulder ots), then the variant's longest words lose their inner vowels,
    then the key's, then the longest words their last letters. The key is never dropped."""
    words = [w for w in re.split(r"[_\-\s]+", name.lower()) if w]
    size = lambda: len("_".join(words))  # noqa: E731
    if size() > MAX:
        kept = words[:1] + [w for w in words[1:] if w not in FILLER]
        words = kept if len(kept) > 1 or len(words) == 1 else words[:2]
    if size() > MAX:
        words = _shorter(words)
    for i in range(1, len(words)):
        if size() <= MAX:
            break
        words[i] = SHORT_WORDS.get(words[i], words[i])
    while size() > MAX:
        rest = [i for i in range(1, len(words)) if len(words[i]) > 3 and _squeeze(words[i]) != words[i]]
        if rest:
            i = max(rest, key=lambda j: len(words[j]))
        elif len(words[0]) > 3 and _squeeze(words[0]) != words[0]:
            i = 0
        else:
            i = -1
        if i >= 0:
            words[i] = _squeeze(words[i])
            continue
        longest = max(range(len(words)), key=lambda j: (len(words[j]), j))
        if len(words[longest]) > 2:
            words[longest] = words[longest][:-1]
        else:
            words.pop()
    return "_".join(words)


def _short(name: str, taken: set[str]) -> str:
    base = name.replace("-", "_")
    if not TAG.match(base):
        base = fit_tag(base).rstrip("_")
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
    words = [payload.get("text") or "", *(shot.get(f) or "" for f in SHOT_WORDS), *(b.get("text") or "" for b in shot.get("beats") or [])]
    named = {n for n in shot.get("refs") or [] if "_" in n}
    named |= {m for w in words for m in MENTION.findall(w) if "_" in m}
    return named


def fit_refs(op: str, payload: dict, sheet: dict | None) -> tuple[dict, list[str]]:
    """The job input with its character refs cut to what `sheet` takes (refs.maxCharacter, refs.maxObject, refs.max),
    and the names it dropped (features/harness-refusals.clan).

    A bare key (`@uberto`) brings its front and up to 3 more views, so two whole characters can be 8
    character refs where Runway takes 5. Only views the job does not name outright are dropped,
    last first: a front stays (a bare key stands for it), and so does any picture named in the shot's
    refs or its words. When that is not enough the input goes as it is and the sheet check refuses it.
    """
    limits = (sheet or {}).get("refs") or {}
    refs = payload.get("refs") or []
    if op == "shot_list" or not refs or not limits:
        return payload, []
    # anchorFrame, previousFrame and an edited image (region_edit, frame_edit's current frame) go as refs too.
    reserved = sum(1 for k in ("anchorFrame", "previousFrame") if payload.get(k)) + (op in ("region_edit", "frame_edit"))
    max_char = limits.get("maxCharacter", len(refs))
    max_all = max(limits.get("max", len(refs) + reserved) - reserved, 0)
    # The reserved pictures (anchor, previous, the edited image) all go as objects (features/pt-relay-trace.clan).
    max_obj = max(limits["maxObject"] - reserved, 0) if limits.get("maxObject") is not None else len(refs)
    named = _named(payload)
    kept = list(refs)
    dropped: list[str] = []

    def characters() -> int:
        return sum(r.get("role") == "character" for r in kept)

    def over() -> bool:
        return characters() > max_char or len(kept) > max_all or len(kept) - characters() > max_obj

    # An optional ref (offered, not asked for: owner 2026-10-15) goes before any the job asks for.
    for r in reversed(refs):
        if not over():
            break
        if r.get("optional"):
            kept.remove(r)
            dropped.append(r.get("name") or r["id"])
    for r in reversed(refs):
        if not over():
            break
        if r not in kept:
            continue
        name = r.get("name") or ""
        if "_" not in name or name.endswith("_front") or name in named:
            continue
        # A view goes only when its own kind (character or object) or the total is over.
        own_over = characters() > max_char if r.get("role") == "character" else len(kept) - characters() > max_obj
        if not own_over and len(kept) <= max_all:
            continue
        kept.remove(r)
        dropped.append(name)
    if not dropped:
        return payload, []
    return {**payload, "refs": kept}, dropped


def to_wire(op: str, payload: dict) -> dict:
    """A copy of the job input with wire tags on its refs and in its words. shot_list and write are
    unchanged: Dex and Skye read the person's own names, and an unknown @name is for Skye to ask about."""
    if op in ("shot_list", "write"):
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
    # A take's shots and their timed lines (features/connected-video.clan) name pictures as one shot does.
    for shot in [out["shot"]] if out.get("shot") else []:
        _shot_to_wire(shot, by_name)
    if op == "clip":
        for shot in out.get("shots") or []:
            _shot_to_wire(shot, by_name)
        for cut in out.get("cuts") or []:
            cut["text"] = _rewrite(cut["text"], by_name)
    return out


def _shot_to_wire(shot: dict, by_name: dict[str, str]) -> None:
    for field in SHOT_WORDS:
        if shot.get(field):
            shot[field] = _rewrite(shot[field], by_name)
    for beat in shot.get("beats") or []:
        if beat.get("text"):
            beat["text"] = _rewrite(beat["text"], by_name)
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
