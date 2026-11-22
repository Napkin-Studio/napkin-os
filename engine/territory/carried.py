"""What a spin-off carried into a Territories document, and the one reading of it (feature territories-spinoff-in).

A document spun off from a Brief Maker or a Research Tool document holds the source whole, frozen at ``data.upstream.<source document id>``
(Contract 4 section 5: fields, decisions in the chain, asset links). The research's pins, findings and sources are merged into the
document's own members (``shared/facts.yaml``, ``findings.yaml``, ``sources.yaml``) and the host builds ``data.projection`` from them.

This module is the ONE place that reads that shape, for the engine (``engine_input``) and for the screen's counts (``read``), so a field that
arrives is a field somebody reads (LESSONS 7). It has no dependency outside the standard library (it runs in the middleware image).

Names. The contract cites a brief field as ``brief:<name>`` with the engine's names (``smp``). Brief Maker stores the same part under its own
key (``single_minded_proposition``). ``BRIEF_KEYS`` maps one to the other, and ``brief_value`` tries both, so a cite resolves against a real
Brief Maker document and against a fixture alike. ``engine/deck/inputs.py`` CLAN_FIELDS is the same mapping; a test keeps them equal.
"""
from __future__ import annotations

#: contract name (``brief:<name>``) -> Brief Maker's data key
BRIEF_KEYS: dict[str, str] = {
    "background": "background", "objectives": "objectives", "audience": "audience", "competitor_context": "competitor_context",
    "insight": "insight", "smp": "single_minded_proposition", "reasons_to_believe": "reasons_to_believe",
    "desired_response": "desired_response", "tone_world_assets": "tone_and_world", "budget_scope": "budget_and_scope",
    "mandatories": "mandatories",
}

#: a field's name as a person reads it (never the key: LESSONS 15)
LABELS: dict[str, str] = {
    "background": "Background", "objectives": "Objectives", "audience": "Audience", "competitor_context": "Competitors",
    "insight": "Insight", "smp": "Single-minded proposition", "reasons_to_believe": "Reasons to believe",
    "desired_response": "Desired response", "tone_world_assets": "Tone and world", "budget_scope": "Budget and scope",
    "mandatories": "Mandatories",
}

#: the fields the first screen shows in full, in this order (the rest are counted)
KEY_FIELDS = ("insight", "smp", "objectives", "audience", "mandatories")


def _obj(v) -> dict:
    return v if isinstance(v, dict) else {}


def text_of(v) -> str:
    """A field's value as plain text: a bare string, ``{value: ...}`` (a Brief field with its provenance), a list (one line each) or a map."""
    if isinstance(v, dict) and "value" in v:
        v = v["value"]
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, (int, float, bool)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return "\n".join(t for t in (text_of(x) for x in v) if t)
    if isinstance(v, dict):
        return "\n".join(t for t in (text_of(x) for x in v.values()) if t)
    return ""


def brief_value(src: dict, name: str):
    """The value of brief field ``name`` (a contract name) in a frozen brief: under the contract name, else under Brief Maker's key."""
    src = _obj(src)
    for key in (name, BRIEF_KEYS.get(name)):
        if key and text_of(src.get(key)):
            return src[key]
    return None


def is_brief(src) -> bool:
    return isinstance(src, dict) and any(brief_value(src, n) is not None for n in BRIEF_KEYS)


def title_of(src: dict) -> str:
    src = _obj(src)
    for cand in (src.get("title"), src.get("project_name"), _obj(src.get("campaign")).get("name")):
        t = text_of(cand)
        if t:
            return t
    return ""


def split(upstream: dict | None) -> tuple[tuple[str, dict] | None, tuple[str, dict] | None]:
    """((brief id, brief), (research id, research)) from ``data.upstream``; either is None. A kit (a Style Pack or Brand Clan) is neither."""
    brief = research = None
    for did, src in (upstream or {}).items():
        if not isinstance(src, dict) or not src or isinstance(src.get("kit"), dict):
            continue
        if brief is None and is_brief(src):
            brief = (did, src)
        elif research is None and not is_brief(src):
            research = (did, src)
    return brief, research


def _rows(members, key: str) -> list | None:
    if members is None:
        return None
    rows = members.get(key) if isinstance(members, dict) else members
    return [r for r in rows or [] if isinstance(r, dict)]


def read(doc: dict, facts=None, findings=None, sources=None) -> dict:
    """What arrived, for the screen and the engine.

    ``doc`` is ``shared/data.yaml``; ``facts``, ``findings`` and ``sources`` are the carried members (a list or wrapped in its key). With
    the members the counts are exact; without them the counts come from ``doc['projection']`` (what the app has), and are ``None`` (never a
    made-up 0) when neither is there.
    """
    brief_src, research_src = split(_obj(doc).get("upstream"))
    out: dict = {"brief": None, "research": None, "from": "none"}
    if brief_src:
        did, src = brief_src
        fields = [{"id": n, "label": LABELS[n], "text": text_of(brief_value(src, n))} for n in BRIEF_KEYS if brief_value(src, n) is not None]
        out["brief"] = {"id": did, "title": title_of(src), "filled": len(fields), "total": len(BRIEF_KEYS), "fields": fields,
                        "key_fields": [f for n in KEY_FIELDS for f in fields if f["id"] == n],
                        "mandatories": len([x for x in text_of(brief_value(src, "mandatories")).split("\n") if x])}
    proj = _obj(_obj(doc).get("projection"))
    pins, found, srcs = _rows(facts, "facts"), _rows(findings, "findings"), _rows(sources, "sources")
    if pins is None and "pins" in proj:
        pins = list(_obj(proj["pins"]).values())
    if found is None and "findings" in proj:
        found = list(_obj(proj["findings"]).values())
    if srcs is None and "sources" in proj:
        srcs = list(_obj(proj["sources"]).values())
    if research_src or pins or found:
        did, src = research_src or ("", {})
        status = [f.get("status") for f in found or []]
        out["research"] = {"id": did, "title": title_of(src), "pins": None if pins is None else len(pins),
                           "findings": None if found is None else len(found),
                           "verified": None if found is None else status.count("verified"),
                           "proposed": None if found is None else status.count("proposed"),
                           "rejected": None if found is None else status.count("rejected"),
                           "sources": None if srcs is None else len(srcs)}
    out["from"] = "+".join(k for k in ("brief", "research") if out[k]) or "none"
    return out


def engine_input(doc: dict, facts=None, findings=None, sources=None) -> dict:
    """The one JSON the engine reads of what was carried: every brief field that arrived (by contract name, with its text), the pins and
    the findings that are not rejected (rejected ones are listed apart and never used), and what each is called. Nothing is summarised
    away: the engine cites ``brief:<name>``, ``f_`` and ``fi_`` ids against this."""
    seen = read(doc, facts, findings, sources)
    brief = {f["id"]: f["text"] for f in (seen["brief"] or {}).get("fields", [])}
    pins = _rows(facts, "facts") or []
    found = _rows(findings, "findings") or []
    return {
        "from": seen["from"],
        "brief": brief,
        "brief_title": (seen["brief"] or {}).get("title", ""),
        "research_title": (seen["research"] or {}).get("title", ""),
        "facts": pins,
        "findings": [f for f in found if f.get("status") != "rejected"],
        "rejected_findings": [f["id"] for f in found if f.get("status") == "rejected"],
        "sources": _rows(sources, "sources") or [],
    }




def spunoff_dir():
    from pathlib import Path
    return Path(__file__).resolve().parents[2] / "app" / "templates" / "territories" / "example" / "spunoff"


if __name__ == "__main__":
    # `python -m territory.carried write` refreshes example/spunoff/seen.json from data.json (the fixture the host test writes).
    import json
    import sys
    d = spunoff_dir()
    if sys.argv[1:] == ["write"]:
        (d / "seen.json").write_text(json.dumps(read(json.loads((d / "data.json").read_text())), indent=1, ensure_ascii=False) + "\n")
        print("wrote", d / "seen.json")
