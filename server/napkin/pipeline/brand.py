"""The Brand Clan's two tasks: identify a typed brand, seed an empty kit (brand-clan.md section 5).

Deterministic and read-mostly. The only layer writes are `note_brand` and `set_roster`, when a
person names a brand the agency has no roster row for and (optionally) says its categories.
"""

from __future__ import annotations

import re

from ..doc import ctx_data, decision, read_of
from ..layers import origin_uri
from ..rules.confidence import fact_confidence
from ..util import TaskError, bad, iso, slug, uid
from .. import reasoning as rsn
from .extract import roster_proposals

BRAND_APP = "ie.napkin.brand"
REF = re.compile(r"brand/[a-z0-9][a-z0-9._-]*")
LEAF = re.compile(r"[a-z0-9_]+\.[a-z0-9_]+")
HUMAN = re.compile(r"human:\S+")
MAX_CANDIDATES = 8
LICENCE_RANK = ("open", "licensed-internal", "client-confidential")
SOURCE_KEYS = ("uri", "title", "publisher", "published_at", "retrieved_at", "tier", "domain", "licence")


def ref_from_slug(name: str) -> str:
    s = slug(name)
    if not s:
        raise bad("input.name has no letter or digit to make a brand ref from")
    return f"brand/{s}"


def _org_ref(v) -> str | None:
    if isinstance(v, dict):
        v = v.get("ref")
    return v if isinstance(v, str) and v else None


def _text(inp, key, lo, hi) -> str:
    v = inp.get(key)
    if not isinstance(v, str) or not (lo <= len(v.strip()) <= hi):
        raise bad(f"input.{key} must be a string of {lo} to {hi} characters")
    return v.strip()


# -- identify -----------------------------------------------------------------------------------
def _rank(text: str, name: str) -> tuple:
    t, n = slug(text), slug(name)
    tier = 0 if n == t else 1 if n.startswith(t) else 2 if t in n else 3
    return (tier, len(n), n)


def identify(inp, layers):
    text = _text(inp, "text", 1, 200)
    found = {}
    for ref, name in layers.find_brands(text):
        found.setdefault(ref, name)
    ordered = sorted(found.items(), key=lambda kv: _rank(text, kv[1]))[:MAX_CANDIDATES]
    cands = []
    for ref, name in ordered:
        row = layers.roster(ref)
        cands.append({"ref": ref, "name": name, "categories": list((row or {}).get("categories") or []),
                      "client_org": _org_ref((row or {}).get("client_org"))})
    if not cands:
        summary = "no brand of this agency matches what was typed"
    elif len(cands) == 1:
        summary = f"one brand matches: {cands[0]['name']}"
    else:
        summary = f"{len(cands)} brands match: {', '.join(c['name'] for c in cands)}"
    return {"summary": summary, "candidates": cands}, None, []


# -- seed ---------------------------------------------------------------------------------------
def _pin(row, did, t):
    recs = row.get("source_records") or []
    lic = max((r.get("licence") or "open" for r in recs), key=LICENCE_RANK.index, default=row.get("licence") or "open")
    pin = {"id": row["id"], "entity": row["entity"], "key": row["key"], "value": row["value"], "unit": row["unit"],
           "as_of": row["as_of"], "retrieved_at": row["retrieved_at"], "sources": list(row["sources"]),
           "confidence": fact_confidence(recs), "licence": lic, "status": "active", "version": row["version"],
           "supersedes": row.get("supersedes"),
           "origin": origin_uri("brand", row["entity"], row["key"], row["version"]), "decision": did,
           "pinned_at": t, "pin_reason": f"{row['key']} from the brand layer, to seed the Brand Clan",
           "layer": "brand", "method": row.get("method") or "report"}
    quotes = {r["id"]: r["quote"] for r in recs if r.get("id") in pin["sources"]
              and isinstance(r.get("quote"), str) and r["quote"].strip()}
    if quotes:
        pin["quotes"] = quotes
    if row.get("market"):
        pin["market"] = row["market"]
    return pin


def _source_records(rows, pins):
    cited = {s for p in pins for s in p["sources"]}
    out, seen = [], set()
    for row in rows:
        for r in row.get("source_records") or []:
            if r.get("id") in cited and r["id"] not in seen and r.get("uri"):
                seen.add(r["id"])
                out.append({"id": r["id"], **{k: r[k] for k in SOURCE_KEYS if r.get(k) not in (None, "")}})
    return out


def seed(doc, base, clan, inp, handler, layers):
    app = clan.get("app")
    if not isinstance(app, dict) or app.get("app_id") != BRAND_APP:
        raise bad(f"brand_seed runs on a Brand Clan ({BRAND_APP}); this document is another app")
    data = ctx_data(clan)
    if isinstance((data.get("brand") or {}).get("ref"), str):
        raise TaskError(409, "already_seeded", "this Brand Clan already has a brand; brand_seed writes only an empty one")
    if ("ref" in inp) == ("name" in inp):
        raise bad("input takes exactly one of ref or name")
    if "ref" in inp:
        return _seed_ref(doc, base, data, inp, handler, layers)
    return _seed_name(doc, base, data, inp, handler, layers)


def _seed_ref(doc, base, data, inp, handler, layers):
    if set(inp) - {"ref"}:
        raise bad("input.ref comes alone: categories apply to a typed name")
    ref = inp["ref"]
    if not isinstance(ref, str) or not REF.fullmatch(ref):
        raise bad("input.ref must be brand/<slug>")
    row = layers.roster(ref)
    if not row:
        raise TaskError(404, "unknown_brand", "the agency's roster has no such brand; identify it first")
    name = row.get("name") or ref[len("brand/"):].replace("-", " ").title()
    t = iso()
    pin_did = uid("d_", doc, base, "brand_seed", "pin", ref)
    seed_did = uid("d_", doc, base, "brand_seed", "seed", ref)
    rows = {r["id"]: r for r in list(row.get("facts") or []) + list(layers.facts("brand", ref))
            if r.get("status", "active") == "active" and isinstance(r.get("value"), (str, int, float, bool))
            and r.get("sources")}
    rows = sorted(rows.values(), key=lambda r: (r["key"], r.get("market") or "", r["version"]))
    if not rows:
        raise TaskError(404, "unknown_brand", "the brand layer holds no pinnable fact for this brand")
    pins = [_pin(r, pin_did, t) for r in rows]
    roster_pins = [p for p in pins if p["key"].startswith("roster.")]
    prop = roster_proposals(pins, ref)
    name_ids = [p["id"] for p in roster_pins] or [pins[0]["id"]]
    brand = {"ref": ref, "name": {"value": name, "origin": "proposed", "fact_ids": name_ids, "decision": seed_did}}
    if "client_org" in prop:
        brand["client_org"] = {"value": prop["client_org"]["value"]["ref"], "origin": "proposed",
                               "fact_ids": prop["client_org"]["fact_ids"], "decision": seed_did}
    if "categories" in prop:
        brand["categories"] = {"value": prop["categories"]["value"], "origin": "proposed",
                               "fact_ids": prop["categories"]["fact_ids"], "decision": seed_did}
    patch = {"brand": brand, "kit": {"version": 1}}
    ids = [p["id"] for p in pins]
    lv = rsn.lowest(p["confidence"] for p in pins)
    pin_dec = decision(doc, pin_did, "pin", handler, "lookup",
                       f"Deterministic lookup of {name}'s roster row and brand facts: {len(pins)} pinned.",
                       [f"facts[{i}]" for i in ids], ids + [s for p in pins for s in p["sources"]],
                       reasoning=rsn.make(
                           f"Pinned {len(pins)} fact(s) the brand layer holds for {name}.",
                           [rsn.point(f"The brand layer holds {p['key']} = {p['value']}", p["id"], p["sources"])
                            for p in pins],
                           rsn.certainty(lv, f"lowest derived confidence of the pins ({lv})"),
                           "the brand layer's rows for this brand are revised, or a person corrects them",
                           rejected=[rsn.rej("research the brand on the web",
                                             "the owner's rule: a Brand Clan seeds from the roster and the "
                                             "brand layer only")]))
    fields = [f"brand.{k}" for k in brand] + ["kit.version"]
    seed_dec = decision(doc, seed_did, "edit", handler, "seed",
                        f"Seeded the Brand Clan for {name} from its roster row and brand-layer pins.",
                        fields, ids,
                        fields_changed=fields,
                        reasoning=rsn.make(
                            f"Wrote {name}'s identity from {len(roster_pins)} roster pin(s), as proposals.",
                            [rsn.point(f"{name} is the roster row's name", name_ids)]
                            + ([rsn.point("The roster row names the client organisation",
                                          prop["client_org"]["fact_ids"])] if "client_org" in prop else [])
                            + ([rsn.point("The roster row gives the categories",
                                          prop["categories"]["fact_ids"])] if "categories" in prop else []),
                            rsn.certainty(lv, f"every written value rests on a pin; the lowest is {lv} (derived)"),
                            "a person edits the brand's identity in the kit, or the roster row is revised",
                            only_option="a Brand Clan is seeded from one roster row; nothing else was on offer"))
    change = {"doc": doc, "base_version": base, "data_patch": patch, "read": read_of(data, patch),
              "facts_append": pins, "findings_append": [], "sources_append": _source_records(rows, pins),
              "decisions": [pin_dec, seed_dec]}
    hits = [{"id": p["id"], "scope": "brand", "source": p["origin"]} for p in pins]
    result = {"summary": f"Seeded the Brand Clan for {name}: {len(pins)} pin(s) from the roster and the brand layer.",
              "ref": ref, "name": name, "pins": len(pins), "fields": fields}
    return result, change, hits


def _seed_name(doc, base, data, inp, handler, layers):
    if set(inp) - {"name", "categories", "by"}:
        raise bad("input takes name, categories? and by?")
    name = _text(inp, "name", 1, 120)
    cats = inp.get("categories", [])
    if not isinstance(cats, list) or len(cats) > 2 or len(set(cats)) != len(cats) \
            or any(not isinstance(c, str) or not LEAF.fullmatch(c) for c in cats):
        raise bad("input.categories is up to two distinct <vertical>.<leaf> codes")
    by = inp.get("by", "human:unknown")
    if not isinstance(by, str) or not HUMAN.fullmatch(by):
        raise bad("input.by, when given, is human:<id>")
    ref = ref_from_slug(name)
    for r, n in layers.find_brands(name):
        if r == ref or n.strip().casefold() == name.casefold():
            raise bad(f"the agency already has {n} ({r}); seed it with input.ref")
    if layers.roster(ref):
        raise bad(f"the agency already has a roster row for {ref}; seed it with input.ref")
    if cats:
        known = {l["code"] for l in layers.leaves()}
        if any(c not in known for c in cats):
            raise bad("input.categories names a category leaf the taxonomy does not have")
    seed_did = uid("d_", doc, base, "brand_seed", "seed", ref)
    layers.note_brand(ref, name)
    if cats:
        src = layers.add_source({"uri": by, "tier": "reviewer-verified", "domain": by,
                                 "licence": "client-confidential", "title": "named in a new Brand Clan"})
        rdec = {"id": uid("d_", doc, base, "brand_seed", "roster-write", ref), "kind": "edit", "handler": handler,
                "action": "roster_confirmed", "rationale": f"{by} named {name} and its categories when making "
                                                           f"its Brand Clan.", "cites": [doc]}
        layers.set_roster(ref, name, cats, rdec, [src], None)
    patch = {"brand": {"ref": ref, "name": {"value": name, "origin": "stated", "by": by, "decision": seed_did}},
             "kit": {"version": 1}}
    fields = ["brand.ref", "brand.name", "kit.version"]
    dec = decision(doc, seed_did, "edit", handler, "seed",
                   f"Seeded the Brand Clan for {name}, as typed: the agency's layers have no row for it.",
                   fields, [], fields_changed=fields,
                   reasoning=rsn.make(
                       f"Wrote {name} as typed by {by}; no pin, since the agency's roster had no such brand.",
                       [rsn.point(f"{by} named the brand {name}", f"{doc}#brand.name")],
                       rsn.certainty("high", "the name is what the person typed, verbatim"),
                       "a person corrects the name in the kit",
                       rejected=[rsn.rej("look the brand up on the web", "the owner's rule: roster and brand "
                                                                          "layer only")]))
    change = {"doc": doc, "base_version": base, "data_patch": patch, "read": read_of(data, patch),
              "facts_append": [], "findings_append": [], "sources_append": [], "decisions": [dec]}
    result = {"summary": f"Seeded a Brand Clan for {name} with the typed name; the layers now know the brand"
                         + (f" and its categories {', '.join(cats)}." if cats else "."),
              "ref": ref, "name": name, "pins": 0, "fields": fields}
    return result, change, []
