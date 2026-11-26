"""The Territories document contract, as code: ONE validator the engine, the host adapters and the tests all call.

The shape is written once, in ``app/templates/territories/schema.json`` (draft-07, the file the host validates a document
against). Nothing here restates an enum, a limit or an id pattern: they are read from that file, so the engine can never
disagree with the host (LESSONS 12). The members, who writes and who reads each: ``docs/contracts/territories.md``.

What the engine and every later feature calls::

    from territory import contract

    contract.validate(doc)                       # raises ContractError (.problems, .words) on the first bad document
    contract.problems(doc)                       # schema problems only, as [Problem]
    contract.check(doc, facts=f, findings=fi)    # schema + the rules a schema cannot say (ids resolve, bands, gates, text, prices)
    contract.validate_shape("territory", card)   # one emitted shape: insight, expedition, territory, world, check, picture, ...
    contract.enum("band") / contract.limit("territories") / contract.pattern("id_territory")   # read from the schema
    contract.mint("territory", seed)             # a deterministic id (same seed, same id: a resumed run never re-mints)
    contract.refusal_error(problems, "develop")  # a host refusal as run.error, in words a person can read
    contract.lint(doc)                           # text leaks and prices outside the history

Run ``python -m territory.contract lock`` after an additive schema change to refresh ``schema.lock.json``.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
# Territories runs in-process in the middleware (owner, 2026-11-23): the middleware image must carry this folder's schema.json;
# an image that does not sets NAPKIN_TERRITORIES_TEMPLATE to where it was copied.
TEMPLATE = Path(os.environ.get("NAPKIN_TERRITORIES_TEMPLATE") or REPO / "app" / "templates" / "territories")
SCHEMA_PATH = TEMPLATE / "schema.json"
LOCK_PATH = TEMPLATE / "schema.lock.json"
EXAMPLE_DIR = TEMPLATE / "example"
STATES_DIR = EXAMPLE_DIR / "states"

# Text that must never reach a person (LESSONS 15). Checked in every string of a document.
TEXT_LEAKS = ("(to confirm)", "~~", "field is null", "**", "{{", "}}", "[object", "undefined", "NaN", "Traceback", "TODO")
LEAK_WORDS = re.compile(r"^\s*(None|null|nan|undefined)\s*$|\bis (null|None)\b")
# Prices live in the decision history only (umbrella decision 6; costs are for the Napkin team, never the product).
PRICE_KEY = re.compile(r"(cost|price|usd|eur|spend|spent|budget_cap|cap_usd|dollar)", re.I)


# ---------------------------------------------------------------- the schema


@lru_cache(maxsize=1)
def schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def _defs() -> dict:
    return schema()["definitions"]


def enum(name: str) -> tuple:
    """The values of the enum definition ``name`` (e.g. ``band``, ``tier``, ``check_kind``)."""
    d = _defs()[name]
    if "enum" not in d:
        raise KeyError(f"{name} is not an enum in the Territories schema")
    return tuple(d["enum"])


def pattern(name: str) -> re.Pattern:
    """The compiled id pattern of ``name`` (e.g. ``id_territory``, ``cite``)."""
    return re.compile(_defs()[name]["pattern"])


def ID_KINDS() -> dict[str, str]:
    """kind -> definition name for every id the engine mints: ``territory`` -> ``id_territory``."""
    return {k[3:]: k for k in _defs() if k.startswith("id_")}


def limit(*path: str, what: str = "maxItems") -> int:
    """A schema maximum by member path, e.g. ``limit("territories")``, ``limit("focus", "insights")``,
    ``limit("expedition", "routes")`` (a definition name first), ``limit("world", "lines")``.
    The engine clamps to these BEFORE it writes: the host refuses a list over its maximum, and the run must never get that far."""
    node = schema()["properties"].get(path[0]) or _resolve({"$ref": f"#/definitions/{path[0]}"})
    for key in path[1:]:
        node = _resolve(node)
        node = _resolve((node.get("properties") or {})[key])
    node = _resolve(node)
    if what in node:
        return node[what]
    if node.get("type") == "array" and what.startswith("max") and "maxItems" in node:
        return node["maxItems"]
    raise KeyError(f"{'.'.join(path)} has no {what}")


def _resolve(node: dict) -> dict:
    while "$ref" in node:
        node = _defs()[node["$ref"].rsplit("/", 1)[1]]
    return node


def band_of(distance: float) -> str:
    """The band a measured distance falls in (the schema's ``x-edges``): the engine sets ``band`` with this, never by hand."""
    edges = _defs()["band"]["x-edges"]
    for name, (lo, hi) in edges.items():
        if lo <= distance < hi or (hi == 1.0 and distance == 1.0):
            return name
    raise ValueError(f"distance {distance} is outside 0..1")


def mint(kind: str, seed: str) -> str:
    """A deterministic id of ``kind`` (``territory`` -> ``t_3fa9c1d2``) from a seed string, so a resumed run never mints a second id
    for the same thing and a recorded fixture keeps its ids."""
    name = ID_KINDS()[kind]
    prefix = _defs()[name]["pattern"][1:].split("_", 1)[0]
    hexed = hashlib.sha1(f"{kind}:{seed}".encode()).hexdigest()
    if kind == "picture":
        return f"{prefix}_{hexed[:10]}"
    if kind in ("find", "fact", "finding"):
        return f"{prefix}_{hexed[:8].upper()}"
    return f"{prefix}_{hexed[:8]}"


# ---------------------------------------------------------------- schema problems, in words


@dataclass(frozen=True)
class Problem:
    path: str          # for tests and logs: territories[3].world.lines
    rule: str          # the schema keyword that failed
    words: str         # for the person: never a field name, never a raw status


class ContractError(ValueError):
    def __init__(self, problems: list[Problem]):
        self.problems = problems
        self.words = [p.words for p in problems]
        super().__init__("; ".join(f"{p.path}: {p.words}" for p in problems[:5]))


# Plain names for members. A member not listed reads as "an entry": a field name is never shown.
NOUN = {"territories": "route", "crew": "crew member", "expeditions": "trail", "insights": "insight", "greenlit": "greenlit route",
        "asks": "question", "actions": "action", "lookups": "look-up", "notes": "note", "sends": "send", "finds": "find",
        "sources": "source", "world": "campaign world", "checks": "check", "pictures": "picture", "routes": "route", "way": "stop",
        "journey": "journey stop", "run": "run", "focus": "pick", "spread": "spread check"}
LIST_NAME = {"lines": "lines", "tv": "TV frames", "radio": "radio lines", "crm": "email lines", "refs": "references", "not": "'not this' notes",
             "risks": "risks", "references": "references", "territories": "routes", "insights": "insights", "crew": "crew members",
             "expeditions": "trails", "routes": "routes", "evidence": "sources", "checks": "checks", "pictures": "pictures",
             "greenlit": "greenlit routes", "notes": "notes", "actions": "actions", "way": "stops", "frames": "frames",
             "proof_cases": "proof cases", "stages": "steps", "refused": "refusals", "close": "close pairs", "gaps": "gaps", "starred": "starred lines",
             "sources": "sources", "finds": "finds", "lookups": "look-ups", "asks": "questions", "sends": "sends", "decisions": "decisions"}
VALUE_NAME = {"id": "an id", "band": "a distance band", "tier": "a risk tier", "kind": "a kind", "status": "a status", "font": "a typeface",
              "scene": "a scene", "touchpoint": "a touchpoint", "rights": "a rights choice", "crew": "a crew member", "state": "a state",
              "evidence": "a source", "cite": "a source", "direction": "a heading", "voice": "a voice", "strength": "an evidence strength"}


def _place(path) -> str:
    """territories[3].world.lines -> 'route 4'. The first list member names the thing; its index counts from 1."""
    parts = list(path)
    if not parts:
        return "The document"
    head = parts[0]
    if head in ("focus", "run", "spread", "review") and len(parts) > 1 and parts[1] in NOUN and len(parts) > 2 and isinstance(parts[2], int):
        return f"{NOUN[parts[1]].capitalize()} {parts[2] + 1}"
    if len(parts) > 1 and isinstance(parts[1], int):
        return f"{NOUN.get(head, 'entry').capitalize()} {parts[1] + 1}"
    return {"focus": "The pick", "run": "The run", "spread": "The spread check", "review": "The review", "journey": "The journey",
            "upstream": "The carried sources"}.get(head, "The document")


def _words(err) -> str:
    where = _place(err.absolute_path)
    last = next((p for p in reversed(list(err.absolute_path)) if isinstance(p, str)), "")
    name = LIST_NAME.get(last, "entries")
    value = VALUE_NAME.get(last, "a value")
    v = err.validator
    if v == "maxItems":
        return f"{where} has {len(err.instance)} {name}; the most allowed is {err.validator_value}."
    if v == "minItems":
        return f"{where} has too few {name}; at least {err.validator_value} needed."
    if v == "maxLength":
        return f"{where} has {value} that is too long: {len(err.instance)} characters, the most allowed is {err.validator_value}."
    if v in ("minLength",):
        return f"{where} has {value} that is empty."
    if v == "required":
        return f"{where} is missing something it needs."
    if v in ("pattern",):
        return f"{where} has {value} that the app does not recognise."
    if v in ("enum", "const"):
        return f"{where} has {value} that is not one of the allowed ones."
    if v == "additionalProperties":
        return f"{where} has something the app does not know how to show."
    if v in ("type", "oneOf", "anyOf", "allOf"):
        return f"{where} has {value} in the wrong form."
    if v in ("minimum", "maximum"):
        return f"{where} has {value} outside its range."
    return f"{where} has {value} the app cannot use."


def _path(err) -> str:
    out = ""
    for p in err.absolute_path:
        out += f"[{p}]" if isinstance(p, int) else (("." if out else "") + str(p))
    return out or "(document)"


def _validator(node: dict):
    import jsonschema
    return jsonschema.Draft7Validator(node)


def _iter(node: dict, value) -> list[Problem]:
    errs = sorted(_validator(node).iter_errors(value), key=lambda e: list(map(str, e.absolute_path)))
    out: list[Problem] = []
    for e in errs:
        if e.validator in ("oneOf", "anyOf", "allOf") and e.context:    # report the leaf cause, not the combinator
            e = min(e.context, key=lambda c: len(list(c.absolute_path)) * -1)
        out.append(Problem(_path(e), e.validator, _words(e)))
    seen, uniq = set(), []
    for p in out:
        if (p.path, p.rule) not in seen:
            seen.add((p.path, p.rule))
            uniq.append(p)
    return uniq


def problems(doc: dict) -> list[Problem]:
    """Schema problems of a whole document (what the host would refuse)."""
    return _iter(schema(), doc)


def validate(doc: dict) -> None:
    ps = problems(doc)
    if ps:
        raise ContractError(ps)


def validate_shape(kind: str, value, *, index: int | None = None) -> list[Problem]:
    """Problems of ONE emitted shape against its definition. ``kind`` is a definition name: insight, expedition, crew_member, territory, world,
    check, picture, greenlit, ask, action, lookup, note, send, find, journey, spread, gate, run. Empty list = valid.
    The engine calls this on every shape before it writes, so a bad one is caught where it is made."""
    node = {"$ref": f"#/definitions/{kind}", "definitions": _defs()}
    ps = _iter(node, value)
    if index is not None:
        ps = [Problem(f"[{index}]{p.path if p.path != '(document)' else ''}", p.rule, p.words) for p in ps]
    return ps


def validate_all(kind: str, values: list) -> list[Problem]:
    return [p for i, v in enumerate(values) for p in validate_shape(kind, v, index=i)]


# ---------------------------------------------------------------- the rules a schema cannot say


def _walk(node, path=()):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _walk(v, path + (k,))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _walk(v, path + (i,))
    else:
        yield path, node


def lint(doc: dict) -> list[Problem]:
    """Text leaks (LESSONS 15) and prices outside the decision history (LESSONS 19). ``upstream`` and ``projection`` are carried, not ours: skipped."""
    out: list[Problem] = []
    body = {k: v for k, v in doc.items() if k not in ("upstream", "projection")}
    for path, val in _walk(body):
        label = "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in path).lstrip(".")
        for p in path:
            if isinstance(p, str) and PRICE_KEY.search(p):
                out.append(Problem(label, "price", f"{_place(path)} carries a price. Prices stay in the decision history, never in the document."))
                break
        if isinstance(val, str):
            if any(t in val for t in TEXT_LEAKS) or LEAK_WORDS.search(val) or val.lstrip().startswith("# "):
                out.append(Problem(label, "leak", f"{_place(path)} has text that is not meant for people: {val[:40]!r}."))
            if re.search(r"(€|\$|£)\s?\d|\b(USD|EUR|GBP)\b", val) and "spend" in label:
                out.append(Problem(label, "price", f"{_place(path)} shows a price."))
    return out


def _lum(hexc: str) -> float:
    def ch(c):
        c = int(c, 16) / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(hexc[i:i + 2]) for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: str, b: str) -> float:
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def _brief_value(src: dict, name: str):
    try:
        from territory import carried
    except ImportError:   # run as a script from engine/territory
        import carried  # type: ignore
    return carried.brief_value(src, name)


def known_cites(doc: dict, facts=None, findings=None) -> set[str]:
    """Every id a claim in ``doc`` may cite: brief fields held by an upstream brief, the carried pins and findings, the document's own finds.
    ``facts`` and ``findings`` are the carried members (a list, or wrapped in ``{"facts": [...]}``)."""
    known = {f["id"] for f in doc.get("finds") or []}
    for src in (doc.get("upstream") or {}).values():
        if isinstance(src, dict):
            # a real Brief Maker document keeps a part under its own key (single_minded_proposition): carried.brief_value reads both
            known |= {f"brief:{k}" for k in enum("brief_field") if _brief_value(src, k) is not None}
    for rows, key in ((facts, "facts"), (findings, "findings")):
        rows = rows.get(key) if isinstance(rows, dict) else rows
        known |= {r["id"] for r in rows or []}
    return known


def check(doc: dict, *, facts=None, findings=None) -> list[Problem]:
    """Everything the host would refuse plus what only the contract knows. ``facts``/``findings`` given: ids f_ and fi_ must resolve
    in them (LESSONS 7: upstream content must arrive and be read); omitted: only brief: and x_ ids are resolved."""
    ps = problems(doc)
    if ps:
        return ps          # structure first: the rules below assume a well-formed document
    out: list[Problem] = list(lint(doc))

    def bad(path, rule, words):
        out.append(Problem(path, rule, words))

    terr = {t["id"]: t for t in doc["territories"]}
    crew = {c["id"]: c for c in doc["crew"]}
    for kind, rows in (("territory", doc["territories"]), ("crew member", doc["crew"]), ("insight", doc["focus"]["insights"]),
                       ("trail", doc["expeditions"]), ("question", doc.get("asks", [])), ("action", doc.get("actions", [])),
                       ("look-up", doc.get("lookups", [])), ("note", doc.get("notes", [])), ("send", doc.get("sends", [])),
                       ("find", doc.get("finds", []))):
        ids = [r["id"] for r in rows]
        for dup in sorted({i for i in ids if ids.count(i) > 1}):
            bad(f"{kind}:{dup}", "unique", f"Two {kind}s share an id ({dup}).")
    insight_ids = {i["id"] for i in doc["focus"]["insights"]}
    known = known_cites(doc, facts, findings)
    resolve_all = facts is not None and findings is not None

    def cite_ok(c: str) -> bool:
        if c.startswith(("f_", "fi_")) and not resolve_all:
            return True
        return c in known

    for i, t in enumerate(doc["territories"]):
        where = f"territories[{i}]"
        if t["crew"] not in crew:
            bad(where + ".crew", "ref", f"Route {i + 1} names a crew member who is not in the crew.")
        if band_of(t["distance"]) != t["band"]:
            bad(where + ".band", "band", f"Route {i + 1} is marked {t['band']} but its distance puts it in {band_of(t['distance'])}.")
        for c in t["evidence"]:
            if not cite_ok(c):
                bad(where + ".evidence", "cite", f"Route {i + 1} cites a source the document does not hold ({c}).")
        if t["state"] == "developed":
            w = t["world"]
            p = w["palette"]
            if contrast(p["ink"], p["bg"]) < 4.5:
                bad(where + ".world.palette", "contrast", f"Route {i + 1}: the text colour is too faint on its background (under 4.5 to 1).")
            hashes = [x["sha256"] for x in t["pictures"] if x.get("sha256")]
            if len(hashes) != len(set(hashes)):
                bad(where + ".pictures", "dup_picture", f"Route {i + 1} uses the same picture in two slots.")
            finals = [x["touchpoint"] for x in t["pictures"] if x.get("final")]
            if len(finals) != len(set(finals)):
                bad(where + ".pictures", "final", f"Route {i + 1} has two pictures marked Final for the same place.")
            for slot in t["pictures"]:
                if slot.get("final") and slot["kind"] != "frame":
                    bad(where + ".pictures", "final", f"Route {i + 1}: only a picture can be marked Final.")
                if slot["kind"] == "frame" and slot["image"] != "sha256:" + slot["sha256"] and slot["image"].startswith("sha256:"):
                    bad(where + ".pictures", "hash", f"Route {i + 1}: a picture's link does not match its hash.")
                if slot["kind"] == "sketch" and slot["touchpoint"] in ("story", "poster", "seat", "email") and \
                        slot.get("scene") != w["scenes"][slot["touchpoint"]]:
                    bad(where + ".pictures", "scene", f"Route {i + 1}: a picture does not show the scene its touchpoint calls for.")
            for ck in t["checks"]:
                for c in ck.get("cite", []):
                    if not cite_ok(c):
                        bad(where + ".checks", "cite", f"Route {i + 1}: a check cites a source the document does not hold ({c}).")
        elif "world" in t:
            bad(where + ".world", "state", f"Route {i + 1} has a world but is not marked developed.")
    hashes_all = [(t["id"], s["sha256"]) for t in doc["territories"] for s in t.get("pictures", []) if s.get("sha256")]
    seen: dict[str, str] = {}
    for tid, h in hashes_all:
        if h in seen and seen[h] != tid:
            bad("territories", "dup_picture", "The same picture is used for two different routes.")
        seen.setdefault(h, tid)
    for i, ins in enumerate(doc["focus"]["insights"]):
        for c in ins["evidence"]:
            if not cite_ok(c):
                bad(f"focus.insights[{i}].evidence", "cite", f"Insight {i + 1} cites a source the document does not hold ({c}).")
    for src in doc["focus"]["sources"]:
        if not cite_ok(src["id"]):
            bad("focus.sources", "cite", f"A source marked in or out of play is not in the document ({src['id']}).")
    for i, e in enumerate(doc["expeditions"]):
        if e["crew"] not in crew:
            bad(f"expeditions[{i}].crew", "ref", f"Trail {i + 1} names a crew member who is not in the crew.")
        for j in e["insights"]:
            if j not in insight_ids:
                bad(f"expeditions[{i}].insights", "ref", f"Trail {i + 1} explores an insight that is not on the pick.")
        for w in e["way"]:
            if w.get("cite") and not cite_ok(w["cite"]):
                bad(f"expeditions[{i}].way", "cite", f"Trail {i + 1} picked up a source the document does not hold ({w['cite']}).")
        for r in e["routes"]:
            t = terr.get(r["territory_id"])
            if not t:
                bad(f"expeditions[{i}].routes", "ref", f"Trail {i + 1} ends in a route that does not exist.")
            elif t["crew"] != e["crew"]:
                bad(f"expeditions[{i}].routes", "ref", f"Trail {i + 1} ends in a route that belongs to another crew member.")
            elif abs(t["distance"] - r["distance"]) > 1e-9:
                bad(f"expeditions[{i}].routes", "distance", f"Trail {i + 1} and its route disagree about how far out it is.")
    findings_rows = (findings.get("findings") if isinstance(findings, dict) else findings) or []
    derived = {f["id"] for f in findings_rows if f.get("status") == "proposed"}
    sensitive = (doc.get("review") or {}).get("sensitive") or {}
    run = doc["run"]
    pending = False
    for i, g in enumerate(doc["greenlit"]):
        t = terr.get(g["territory_id"])
        if not t:
            bad(f"greenlit[{i}]", "ref", f"Greenlit route {i + 1} does not exist.")
            continue
        if t["state"] != "developed" or t["status"] != "live":
            bad(f"greenlit[{i}]", "state", f"Greenlit route {i + 1} is not a live, developed route.")
        need = sorted(c for c in t["evidence"] if c in derived) if findings is not None else None
        if need is not None and sorted(set(need) - set(g["rests_on_derived"])):
            bad(f"greenlit[{i}].rests_on_derived", "derived", f"Greenlit route {i + 1} rests on a derived finding it does not list.")
        if g["rests_on_derived"] and g["derived_resolution"] == "pending":
            pending = True
        if not g["rests_on_derived"] and g["derived_resolution"] != "verified":
            bad(f"greenlit[{i}].derived_resolution", "derived", f"Greenlit route {i + 1} rests on no derived finding, so there is nothing to settle.")
    sent_ids = {tid for s in doc.get("sends", []) if s["status"] in ("sent",) for tid in s["territory_ids"]}
    for i, s in enumerate(doc.get("sends", [])):
        green = {g["territory_id"] for g in doc["greenlit"]}
        for tid in s["territory_ids"]:
            if tid not in green:
                bad(f"sends[{i}]", "ref", f"Send {i + 1} carries a route that was not greenlit.")
        for tid in s["not_chosen"]:
            if tid in green or tid not in terr:
                bad(f"sends[{i}]", "ref", f"Send {i + 1} lists a route as not chosen that is greenlit or does not exist.")
    if pending and sent_ids:
        bad("sends", "gate", "Routes were sent while a greenlit route still rests on an unchecked derived finding.")
    if sensitive.get("required") and sensitive.get("status") != "done" and sent_ids:
        bad("sends", "gate", "Routes were sent before the sensitive-topic review was done.")
    gate = run.get("gate")
    if gate and gate["id"] == "greenlight":
        kinds = {b["kind"] for b in gate.get("blocked_by", [])}
        if pending and "derived_evidence" not in kinds and run["state"] == "gate":
            bad("run.gate.blocked_by", "gate", "A greenlit route rests on an unchecked derived finding but the gate does not say so.")
        if sensitive.get("required") and sensitive.get("status") != "done" and "sensitive_review" not in kinds and run["state"] == "gate":
            bad("run.gate.blocked_by", "gate", "The sensitive-topic review is missing but the gate does not say so.")
    if run["state"] == "failed" and "error" not in run:
        bad("run", "error", "The run failed but says nothing about why.")
    if run["state"] == "done" and run.get("gate"):
        bad("run", "state", "The run is done but a gate is still open.")
    if run["state"] == "gate" and not run.get("gate"):
        bad("run", "state", "The run is waiting at a gate but no gate is open.")
    return out


def refusal_error(ps: list[Problem], stage: str = "develop") -> dict:
    """A host refusal of an engine reply as ``run.error``: plain words, never a field name, with the refusals listed (done_when 4).
    The run is ``failed`` and ``retryable``; the engine writes this instead of dropping the reply."""
    words = [p.words for p in ps][: limit("run", "error", "refused")]
    head = "The result could not be saved because it did not fit what the app can show."
    if words:
        head += f" {len(ps)} thing{'s' if len(ps) != 1 else ''} to fix."
    return {"stage": stage, "message": head[:400], "retryable": True, "refused": [w[:300] for w in words]}


# ---------------------------------------------------------------- additive-only lock


def _sig(node: dict) -> dict:
    node = _resolve(node)
    s: dict = {}
    t = node.get("type")
    if "enum" in node:
        s["enum"] = sorted(map(str, node["enum"]))
    if "const" in node:
        s["const"] = node["const"]
    if t:
        s["type"] = t if isinstance(t, str) else sorted(t)
    return s


def snapshot(node: dict | None = None, path: str = "", out: dict | None = None, req: dict | None = None, depth: int = 0) -> dict:
    """Every member path with its type (and enum values), plus the required sets: what the lock file records."""
    first = out is None
    out, req = ({}, {}) if first else (out, req)
    node = _resolve(node or schema())
    if depth > 12:
        return {"paths": out, "required": req}
    for key, sub in (node.get("properties") or {}).items():
        p = f"{path}.{key}" if path else key
        out[p] = _sig(sub)
        snapshot(sub, p, out, req, depth + 1)
    if node.get("type") == "array" and "items" in node:
        p = path + "[]"
        out[p] = _sig(node["items"])
        snapshot(node["items"], p, out, req, depth + 1)
    if node.get("required"):
        req[path or "(document)"] = sorted(node["required"])
    for k in ("oneOf",):
        for alt in node.get(k) or []:
            snapshot(alt, path, out, req, depth + 1)
    return {"paths": out, "required": req}


def lock_problems() -> list[str]:
    """What an edit broke of the additive-only rule: a member removed or retyped, an enum value dropped, a member newly required."""
    locked = json.loads(LOCK_PATH.read_text())
    now = snapshot()
    msgs = []
    for p, sig in locked["paths"].items():
        cur = now["paths"].get(p)
        if cur is None:
            msgs.append(f"removed: {p}")
            continue
        if sig.get("type") != cur.get("type"):
            msgs.append(f"retyped: {p} {sig.get('type')} -> {cur.get('type')}")
        if set(sig.get("enum", [])) - set(cur.get("enum", [])):
            msgs.append(f"enum value dropped: {p} {sorted(set(sig['enum']) - set(cur.get('enum', [])))}")
        if "const" in sig and sig["const"] != cur.get("const"):
            msgs.append(f"const changed: {p}")
    for p, req in now["required"].items():
        new = set(req) - set(locked["required"].get(p, []))
        if new:
            msgs.append(f"newly required: {p} {sorted(new)}")
    return msgs


def write_lock() -> None:
    LOCK_PATH.write_text(json.dumps(snapshot(), indent=1, sort_keys=True) + "\n")


# ---------------------------------------------------------------- fixtures


def example(name: str = "data") -> dict:
    """A fixture by name: ``data`` (the finished Linea run), ``facts``, ``findings``, or a state under ``states/`` (``pick``, ``explore``, ...)."""
    p = EXAMPLE_DIR / f"{name}.json"
    if not p.exists():
        p = STATES_DIR / f"{name}.json"
    return json.loads(p.read_text())


def example_states() -> list[str]:
    return sorted(p.stem for p in STATES_DIR.glob("*.json"))


if __name__ == "__main__":
    if sys.argv[1:] == ["lock"]:
        write_lock()
        print(f"wrote {LOCK_PATH}")
    elif sys.argv[1:2] == ["check"] and len(sys.argv) > 2:
        d = json.loads(Path(sys.argv[2]).read_text())
        ps = check(d, facts=example("facts"), findings=example("findings")) if "--with-example-upstream" in sys.argv else check(d)
        for p in ps:
            print(f"{p.path}: {p.words}")
        sys.exit(1 if ps else 0)
    else:
        print(__doc__)
