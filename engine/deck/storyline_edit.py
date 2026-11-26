"""The person's storyline at Gate 1 (deck-beat-editor): their beats, reworded, reordered, taken out or added, applied to stage b.

The page writes ``run.storyline_edit`` ``{base, beats: [{key, title, words}], by, at}`` as the person's decision; the middleware hands
it to the engine beside the approvals; on the storyline's approval the server applies it here to ``b_storyline.json`` before stage c
runs. No model is called: what the person wrote is what the deck says.

- ``base`` is the sha256 of the ``b_storyline.json`` the person edited. An edit made against another storyline is refused in words
  (StaleEdit), never guessed onto it; one already applied is recognised (``person.edit_sha``) and left alone.
- A beat with a ``key`` is one of stage b's titled sections (run_state.beats). Its title becomes the person's words when they
  changed it; its claims, evidence and refs stay (owner, 2026-11-25: "a reworded beat keeps its section's evidence").
- A section whose key is missing from the beats is taken out of the storyline. The agents' whole file is kept beside it once, as
  ``b_storyline.agents.json``, so nothing the agents wrote is lost.
- A beat with no key is the person's own: it becomes a ``person_beat`` slide titled with their words (assemble), which the
  pitch's cap never moves (owner: "never moved by the 12-slide cap, even at 13-14 slides").
- The beats' order is the story's order: assemble puts the presented story slides in it, within their slots (the investment
  and the ask stay last).
"""
from __future__ import annotations

import copy
import hashlib
import json
import re

#: The longest beat the page lets a person write (a slide title, not a paragraph).
TITLE_MAX = 300
#: The most beats a storyline holds (a pitch's story, with room for the person's own).
BEATS_MAX = 20
#: Where a mandatory a taken-out beat cites is still said (assemble._guardrails lists every mandatory).
MANDATORY_HOME = "the guardrails slide"
MANDATORY_HOME_NOTES = "the guardrails slide's notes"


class EditRefused(ValueError):
    """An edit that cannot be applied as written: the message says why, in the person's terms."""


class StaleEdit(EditRefused):
    """The storyline changed after the person edited it."""


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def section_keys(b: dict | None) -> list[str]:
    """Stage b's beats, in the file's order: each section with a title (run_state.beats reads the same)."""
    return [k for k, v in (b or {}).items() if isinstance(v, dict) and str(v.get("title") or "").strip()]


def section_refs(v) -> list[str]:
    """Every ref a section cites, in order (its claims, its evidence, a chart's series), never its ``basis`` words."""
    refs: list[str] = []

    def walk(x):
        if isinstance(x, dict):
            for kk, vv in x.items():
                if kk == "refs" and isinstance(vv, list):
                    refs.extend(r for r in vv if isinstance(r, str))
                elif kk == "ref" and isinstance(vv, str) and vv:   # a chart's series cite one ref each (acceptance A35)
                    refs.append(vv)
                elif kk != "basis":
                    walk(vv)
        elif isinstance(x, list):
            for vv in x:
                walk(vv)
    walk(v)
    return refs


def clean_title(t) -> str:
    return re.sub(r"\s+", " ", str(t or "")).strip()


def check(edit) -> dict:
    """The edit, checked for shape: ``{base, beats: [{key: str | None, title}], by, at}``. Raises EditRefused."""
    if not isinstance(edit, dict):
        raise EditRefused("the storyline edit must be an object {base, beats, by, at}")
    base = str(edit.get("base") or "")
    if not re.fullmatch(r"[0-9a-f]{64}", base):
        raise EditRefused("the storyline edit names no storyline it was made against (base must be the sha256 of b_storyline.json)")
    beats = edit.get("beats")
    if not isinstance(beats, list) or not beats:
        raise EditRefused("the storyline needs at least one beat")
    if len(beats) > BEATS_MAX:
        raise EditRefused(f"a storyline holds at most {BEATS_MAX} beats")
    out, seen = [], set()
    for i, x in enumerate(beats, 1):
        if not isinstance(x, dict):
            raise EditRefused(f"beat {i} is not an object")
        key = x.get("key")
        if key is not None and (not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,40}", key)):
            raise EditRefused(f"beat {i} names no section the storyline can have")
        if key is not None and key in seen:
            raise EditRefused(f"beat {i} repeats the section '{key}'")
        title = clean_title(x.get("title"))
        if not title:
            raise EditRefused(f"beat {i} has no words")
        if len(title) > TITLE_MAX:
            raise EditRefused(f"beat {i} is longer than {TITLE_MAX} characters: a beat is a slide's title")
        seen.add(key)
        out.append({"key": key, "title": title})
    return {"base": base, "beats": out, "by": str(edit.get("by") or "")[:120], "at": str(edit.get("at") or "")[:40]}


def edit_sha(edit: dict) -> str:
    """The edit's own fingerprint (base and beats only), so the same edit is applied once."""
    e = check(edit)
    return sha_bytes(json.dumps({"base": e["base"], "beats": e["beats"]}, sort_keys=True, ensure_ascii=False).encode())


def applied(b: dict | None, edit: dict) -> bool:
    """True when this very edit is already in the storyline."""
    return bool(isinstance(b, dict) and isinstance(b.get("person"), dict) and b["person"].get("edit_sha") == edit_sha(edit))


def apply(b: dict, edit: dict, current_sha: str) -> dict:
    """Stage b with the person's storyline in it (a new dict; ``b`` is not changed). ``current_sha``: the sha256 of the file ``b``
    was read from. Raises StaleEdit when the edit was made against another storyline, EditRefused when it names a section the
    storyline does not have."""
    e = check(edit)
    if e["base"] != current_sha:
        raise StaleEdit("the storyline changed since you edited it: your edit is kept on the page; check it against the new beats and approve again")
    keys = section_keys(b)
    unknown = [x["key"] for x in e["beats"] if x["key"] is not None and x["key"] not in keys]
    if unknown:
        raise EditRefused("your storyline names beats this storyline does not have (" + ", ".join(unknown) + "): reload the page and edit again")
    new = copy.deepcopy(b)
    order, mine, reworded, n = [], [], [], 0
    for x in e["beats"]:
        if x["key"] is None:
            n += 1
            pid = f"p{n}"
            mine.append({"id": pid, "title": x["title"]})
            order.append(pid)
            continue
        k = x["key"]
        if x["title"] != clean_title(b[k].get("title")):
            new[k]["title"] = x["title"]
            new[k]["person_words"] = True   # the section's claims and refs stay: the person's words, the agents' evidence
            reworded.append(k)
        order.append(k)
    given = {x["key"] for x in e["beats"] if x["key"] is not None}
    deleted = [k for k in keys if k not in given]
    for k in deleted:
        new.pop(k, None)
    new["person"] = {"base": e["base"], "edit_sha": edit_sha(edit), "by": e["by"], "at": e["at"], "order": order, "beats": mine,
                     "reworded": reworded, "deleted": deleted}
    return new


def person_of(b: dict | None) -> dict:
    """The person's storyline record in stage b (``{}`` when they changed nothing)."""
    p = (b or {}).get("person")
    return p if isinstance(p, dict) else {}


def mandatories(section, requirements: list) -> list[dict]:
    """The mandatories a section cites (``req:<id>`` in its refs): ``[{id, text, to}]``, ``to`` saying where each is still said
    once the section is taken out (every mandatory is listed on the guardrails slide; a clearance rule in its notes)."""
    from .assemble import _CLEARANCE_RULE   # late: assemble imports this module
    by_id = {str(r.get("id")): r for r in requirements or [] if isinstance(r, dict) and r.get("kind") == "mandatory"}
    out, seen = [], set()
    for ref in section_refs(section):
        rid = ref[4:] if ref.startswith("req:") else None
        r = by_id.get(rid or "")
        if r is None or rid in seen:
            continue
        seen.add(rid)
        txt = str(r.get("text") or "")
        out.append({"id": rid, "text": txt, "to": MANDATORY_HOME_NOTES if _CLEARANCE_RULE.search(txt) else MANDATORY_HOME})
    return out
