"""report: data.report, composed from the document as the request holds it
(middleware-api.md §8.5, Contract 3 §17).

One model call writes the report with a free hand: the record (headline,
summary, per-lens claims) and the page it is read on (`html`). The record's
structure — sections, pins / finding / gap / contest blocks, `confirm`,
`not_researched`, `based_on` — is built here from the document, and the page is
checked by the layout rule (layout.py). Every claim the model wrote is checked in code before the change is
sent: its cites must be pins or non-rejected findings the document holds, and
it may state no figure absent from what it cites. A claim that fails is
dropped; a headline or summary that fails is replaced by a figure-free line
built here. The model's own confidence is never read.
"""

from __future__ import annotations

import json
import logging
import re

from ..doc import (CAMPAIGN_FIELDS, LENS_TITLES, LENSES, ctx_data, ctx_facts, ctx_findings, lens_of_key,
                   market_list, out_of_use)
from ..rules import layout as rule
from ..rules.cite import clean_claim
from ..util import bad, canon_sha, iso
from .. import reasoning as rsn
from ..aliases import Aliases
from . import layout

log = logging.getLogger("napkin.report")

SYSTEM = """You write the research report an advertising planner reads first, and lay out the page they read it
on, in one go, from pinned facts and proposed findings. Plain, specific sentences. Every sentence cites the pin
ids and/or finding ids it rests on. State no number that is not the value of a pin you cite (or written in a
finding you cite); the view renders every figure from the pins, so describing ("the larger market", "growing
fastest") is usually better than restating. Never cite anything not in the input. A claim cites pin ids (f_...)
and finding ids (fi_...) only: contest ids (ct_...) and gap ids (gap_...) belong to the page, never to a claim's
cites, so a claim about a disagreement or a missing measure cites the pins or the finding it rests on.

Return two things. The record: a headline, two to four summary lines, and for each lens section three to four
claims, each with its cites; these are the sentences you stand behind. And the page: `html`.

""" + layout.PAGE_RULES + """

The grounds are for the report as a whole: the pins and findings (by id) that support the headline and
summary, and the other headlines the input would allow and what in it rules each out.""" + rsn.GUIDE

PART_RULES = """

This time you write again only part of a report that already exists: a person reviewed the research (marked a
fact wrong, corrected one, rejected a finding) and what rests on it has changed; `changed` says what. Everything
you are not asked to write stays as it is, word for word, so keep its voice. Write claims only for the lenses in
`rewrite.sections` (their claims as they stand are in `now`: keep the wording of whatever still holds), the
headline only when `rewrite.headline` is true, the summary only when `rewrite.summary` is true, and for each part
of the page in `rewrite.page` its HTML again: the same place and role on the page, to the same rules, resting
only on the ids you are given. Other lenses are given only so a page part that spans them reads right."""

FIELD_LABELS = {"brand": "Brand", "client_org": "Client", "categories": "Categories", "markets": "Markets",
                "competitor_set": "Comparators", "audience": "The researched audience", "in_market": "In market",
                "constraints": "Constraints", "campaign_type": "Campaign type"}


def _obj(props: dict) -> dict:
    return {"type": "object", "additionalProperties": False, "required": list(props), "properties": props}


def schema(cite_ids: list[str], lenses: list[str]) -> dict:
    claim = _obj({"text": {"type": "string"}, "cites": {"type": "array", "items": {"type": "string",
                                                                                   "enum": cite_ids}}})
    return _obj({"headline": claim, "summary": {"type": "array", "items": claim},
                 "sections": {"type": "array", "items": _obj({"lens": {"type": "string", "enum": lenses or LENSES},
                                                              "claims": {"type": "array", "items": claim}})},
                 "html": {"type": "string"},
                 "grounds": rsn.MODEL_SCHEMA})


def part_schema(cite_ids: list[str], lenses: list[str], page: list[int], headline: bool, summary: bool) -> dict:
    """What the model writes when only part of the report is written again (`compose(part=...)`)."""
    claim = _obj({"text": {"type": "string"}, "cites": {"type": "array", "items": {"type": "string",
                                                                                   "enum": cite_ids}}})
    props = {}
    if headline:
        props["headline"] = claim
    if summary:
        props["summary"] = {"type": "array", "items": claim}
    if lenses:
        props["sections"] = {"type": "array", "items": _obj({"lens": {"type": "string", "enum": lenses},
                                                             "claims": {"type": "array", "items": claim}})}
    if page:
        props["page"] = {"type": "array", "items": _obj({"part": {"type": "integer", "enum": page},
                                                         "html": {"type": "string"}})}
    props["grounds"] = rsn.MODEL_SCHEMA
    return _obj(props)


def _ids(html: str) -> set:
    return set(re.findall(r"\b(?:f|fi|ct|gap)_[0-9A-Za-z_]+", html or ""))


def compose(doc, clan, handler, caps, part=None):
    """-> (report, cites, hits, reasoning). 400 when there is nothing to cite.

    With `part` = {old, sections, headline, summary, page, why}, only part of the report `old` is written again:
    the record sections whose ids are in `sections`, the headline and the summary when true, and the parts of
    the page (`rule.split(old.layout)`) whose indices are in `page`; `why` says what changed, for the model.
    Everything else is kept byte for byte, and what is written passes the same checks as a whole report. No model
    call when there is nothing to write."""
    data = ctx_data(clan)
    camp = data.get("campaign") or {}
    sel = data.get("selection") or {}
    # a fact a person marked wrong (excluded), or one a correction or a resolved contest replaced, is never cited
    excluded = out_of_use(clan)
    pins = [f for f in ctx_facts(clan) if re.fullmatch(r"f_[0-9A-Z]{6,}", str(f.get("id", "")))
            and f.get("id") not in excluded]
    pin_by = {f["id"]: f for f in pins}
    # nor a finding that rests on one: the finding worked out again in its place is used instead
    findings = [f for f in ctx_findings(clan) if f.get("status") in ("proposed", "verified")
                and re.fullmatch(r"fi_[0-9A-Z]{6,}", str(f.get("id", "")))
                and not set(f.get("cites") or []) & excluded]
    fi_by = {f["id"]: f for f in findings}
    if not pins and not findings:
        raise bad("nothing to cite: the document holds no pin and no finding, so no claim could be sourced")
    fval = lambda f: (camp.get(f) or {}).get("value")
    brand = (fval("brand") or {}).get("name") or fval("name") or "The campaign"
    markets = list(fval("markets") or [])
    names = [fval("name") or "", (fval("brand") or {}).get("name", "")] + \
        [c.get("name", "") for c in (fval("competitor_set") or []) if isinstance(c, dict)]

    roster = [f for f in pins if str(f.get("key", "")).startswith("roster.")]
    by_lens = {l: {"pins": [], "findings": [], "gaps": [], "contests": []} for l in LENSES}
    for f in pins:
        l = lens_of_key(f.get("key"))
        if l:
            by_lens[l]["pins"].append(f)
    for fi in findings:
        l = fi.get("lens") if fi.get("lens") in LENSES else next(
            (lens_of_key(pin_by[c]["key"]) for c in fi.get("cites") or [] if c in pin_by and
             lens_of_key(pin_by[c]["key"])), None)
        if l:
            by_lens[l]["findings"].append(fi)
    for g in sel.get("gaps") or []:
        l = g.get("lens") if g.get("lens") in LENSES else lens_of_key(str(g.get("key", "")).partition(":")[2])
        if l and re.fullmatch(r"[a-z0-9_]+", str(g.get("id", ""))):
            by_lens[l]["gaps"].append(g)
    for c in sel.get("contested") or []:
        l = lens_of_key(str(c.get("key", "")).partition(":")[2].partition("@")[0])
        if l and re.fullmatch(r"[a-z0-9_]+", str(c.get("id", ""))):
            by_lens[l]["contests"].append(c)
    lenses_with = [l for l in LENSES if by_lens[l]["pins"] or by_lens[l]["findings"]]

    # -- the model writes the prose ----------------------------------------------
    written = {"headline": None, "summary": [], "sections": {}}
    dropped = []
    raw = {}
    ask = {k: (camp[k] or {}).get("value") for k in ("problem", "objective", "audience_stated", "name")
           if isinstance(camp.get(k), dict) and isinstance((camp[k] or {}).get("value"), str)}
    person_wording = [re.sub(r"<[^>]+>", " ", h).strip() for k, h in (clan.get("edits") or {}).items()
                      if str(k).startswith("report:") and isinstance(h, str) and h.strip()][:40]
    # the page shows no finding that rests on a fact a person marked wrong
    all_findings = {f["id"]: f for f in ctx_findings(clan) if isinstance(f.get("id"), str)
                    and not set(f.get("cites") or []) & excluded}
    contested = {c["id"]: c for c in sel.get("contested") or [] if c.get("id")}
    gap_by = {g["id"]: g for g in sel.get("gaps") or [] if g.get("id")}
    old = part["old"] if part else None
    if part:
        redo = set(part.get("sections") or ())
        want_head, want_sum = bool(part.get("headline")), bool(part.get("summary"))
        pages = rule.split(old["layout"]) if isinstance(old.get("layout"), str) else []
        redo_page = sorted({i for i in part.get("page") or () if isinstance(i, int) and 0 <= i < len(pages)})
        write_lenses = [l for l in lenses_with if "s_" + l in redo]
        # a page part may span lenses: those it references are given too, to read, not to write claims for
        near = {lens_of_key(pin_by[i]["key"]) for j in redo_page for i in _ids(pages[j]) if i in pin_by} | \
            {fi_by[i].get("lens") for j in redo_page for i in _ids(pages[j]) if i in fi_by}
        # the headline and summary speak for the whole report: they are written from all of it
        given = lenses_with if want_head or want_sum else [l for l in lenses_with if l in write_lenses or l in near]
        asked = bool(write_lenses or redo_page or want_head or want_sum)
    else:
        given, asked = lenses_with, bool(lenses_with)
    if asked:
        pin_row = lambda p: {"id": p["id"], "label": layout.label(p), "entity": p["entity"], "key": p["key"],
                             "value": p["value"], "unit": p.get("unit"), "market": p.get("market"),
                             "as_of": p.get("as_of"), "has_quote": bool(p.get("quotes")),
                             "confidence": p.get("confidence")}
        payload = {"brand": brand, "markets": markets, "problem": fval("problem"), "objective": fval("objective"),
                   "ask": [{"ref": f"campaign.{k}", "value": v} for k, v in ask.items()],
                   "lenses": [{"lens": l, "title": LENS_TITLES[l],
                               "pins": [pin_row(p) for p in by_lens[l]["pins"]],
                               "findings": [{"id": f["id"], "statement": f["statement"], "status": f["status"]}
                                            for f in by_lens[l]["findings"]],
                               "open_contests": [{"id": c["id"], "key": c["key"],
                                                  "values": [v.get("value") for v in c.get("values") or []]}
                                                 for c in by_lens[l]["contests"] if c.get("status") == "open"],
                               "gaps": [{"id": g["id"], "wanted": g.get("wanted") or g.get("key"),
                                         "searched": g.get("searched")} for g in by_lens[l]["gaps"]]}
                              for l in given]}
        if roster:
            payload["identity_pins"] = [pin_row(p) for p in roster]
        if part:
            payload["changed"] = list(part.get("why") or [])
            payload["rewrite"] = {"sections": write_lenses, "headline": want_head, "summary": want_sum,
                                  "page": [{"part": i, "html": pages[i]} for i in redo_page]}
            payload["now"] = {"headline": (old.get("headline") or {}).get("text"),
                              "summary": [x.get("text") for x in old.get("summary") or []],
                              "claims": {l: [b.get("text") for sec in old.get("sections") or [] if sec.get("lens") == l
                                             for b in sec.get("blocks") or [] if b.get("kind") == "claim"]
                                         for l in write_lenses}}
        elif person_wording:
            payload["person_wording"] = person_wording
        try:
            # Low effort: replayed on the IBM run it cost ~22% less than the default and wrote as many claims
            # and as much prose, because the page rules ask for the depth outright (three to four claims per
            # section, a paragraph of three to five sentences per lens).
            al = Aliases(sorted(pin_by) + sorted(fi_by) + sorted(contested) + sorted(gap_by))
            if part:
                raw = al.decode(caps.model.structured(
                    "report_part", SYSTEM + PART_RULES, al.encode(payload, html=True),
                    part_schema(al.short(sorted(pin_by) + sorted(fi_by)), write_lenses, redo_page, want_head, want_sum),
                    max_tokens=16000, effort="low"))
            else:
                raw = al.decode(caps.model.structured("report", SYSTEM, al.encode(payload),
                                                      schema(al.short(sorted(pin_by) + sorted(fi_by)), lenses_with),
                                                      max_tokens=32000, effort="low"))
        except Exception as e:  # the structure still composes; the prose falls back to lines built here
            log.warning("report prose unavailable: %s", e)
            dropped.append(f"model: {e}")
            raw = {}
        h = raw.get("headline")
        if h:
            written["headline"], why = clean_claim(h.get("text"), h.get("cites"), pin_by, fi_by, names)
            if why:
                dropped.append(f"headline: {why}")
        for s in raw.get("summary") or []:
            c, why = clean_claim(s.get("text"), s.get("cites"), pin_by, fi_by, names)
            written["summary"].append(c) if c else dropped.append(f"summary: {why}")
        for sec in raw.get("sections") or []:
            if part and sec.get("lens") not in write_lenses:
                continue
            for s in sec.get("claims") or []:
                c, why = clean_claim(s.get("text"), s.get("cites"), pin_by, fi_by, names)
                if c:
                    written["sections"].setdefault(sec.get("lens"), []).append(c)
                else:
                    dropped.append(f"{sec.get('lens')}: {why}")

    def fcites(fi):
        return [fi["id"]] + [c for c in fi.get("cites") or [] if c in pin_by]

    sections = []
    if roster:
        ids = [f["id"] for f in roster]
        sections.append({"id": "s_identity", "title": "Brand and category", "blocks": [
            {"kind": "claim", "text": f"The categories and the client come from {brand}'s roster row in the brand "
                                      f"layer.", "cites": ids}, {"kind": "pins", "fact_ids": ids}]})
    for l in LENSES:
        g = by_lens[l]
        if not any(g.values()):
            continue
        blocks = [{"kind": "claim", **c} for c in written["sections"].get(l, [])[:3]]
        pm = sorted({p["market"] for p in g["pins"] if p.get("market")})
        if not blocks:
            if g["findings"]:
                fi = g["findings"][0]
                blocks.append({"kind": "claim", "text": fi["statement"], "cites": fcites(fi)})
            elif g["pins"]:
                where = f" for {market_list(pm)}" if pm else ""
                blocks.append({"kind": "claim", "text": f"{LENS_TITLES[l]}: what research pinned{where}; the values "
                                                        f"are shown below.", "cites": [p["id"] for p in g["pins"]]})
        if g["pins"]:
            blocks.append({"kind": "pins", "fact_ids": [p["id"] for p in g["pins"]]})
        blocks += [{"kind": "finding", "finding_id": fi["id"]} for fi in g["findings"]]
        blocks += [{"kind": "contest", "contest_id": c["id"]} for c in g["contests"]]
        blocks += [{"kind": "gap", "gap_id": x["id"]} for x in g["gaps"]]
        sec = {"id": "s_" + l, "title": LENS_TITLES[l], "lens": l, "blocks": blocks}
        mk = {x.get("market") for x in g["pins"] + g["gaps"]} - {None}
        if len(mk) == 1 and not any(not p.get("market") for p in g["pins"]):
            sec["market"] = mk.pop()
        sections.append(sec)
    if part:
        # only the sections asked for are new; every other one is the old report's, as it was
        new = {x["id"]: x for x in sections}
        sections = [new[x["id"]] if x["id"] in redo else x for x in old.get("sections") or []
                    if x["id"] not in redo or x["id"] in new]
        sections += [x for x in new.values() if x["id"] in redo and x not in sections]
    used = set()
    for sec in sections:
        for b in sec["blocks"]:
            used |= set(b.get("cites", [])) | set(b.get("fact_ids", []))
            if b["kind"] == "finding":
                used.add(b["finding_id"])

    summary = written["summary"][:4] if not part or want_sum else old["summary"]
    if not summary:
        summary = [{"text": fi["statement"], "cites": fcites(fi)} for l in LENSES for fi in by_lens[l]["findings"][:1]][:4]
    if not summary:
        for l in LENSES:
            if by_lens[l]["pins"] and len(summary) < 4:
                summary.append({"text": f"{LENS_TITLES[l]} rests on pinned facts; nothing has been synthesised from "
                                        f"them yet.", "cites": [p["id"] for p in by_lens[l]["pins"]]})
    if not summary:
        summary = [{"text": f"Only {brand}'s roster row is pinned so far; nothing has been researched yet.",
                    "cites": [f["id"] for f in roster] or [pins[0]["id"]]}]
    open_ct = [c for c in sel.get("contested") or [] if c.get("status") == "open"]
    headline = written["headline"] or (old["headline"] if part and not want_head else None) or {
        "text": f"{brand}{' in ' + market_list(markets) if markets else ''}: what the research found"
                + (", with values still contested" if open_ct else "") + ".",
        "cites": [findings[0]["id"]] if findings else [pins[0]["id"]]}

    report = {"built_at": iso(), "handler": handler, "based_on": based_on(clan),
              "headline": headline, "summary": summary, "sections": sections,
              "confirm": old.get("confirm", []) if part else confirm_list(doc, camp),
              "not_researched": old.get("not_researched", []) if part else not_researched(sel, markets)}
    if part:
        if pages:  # the parts of the page not asked for stay byte for byte
            report["layout"], ldropped = layout.splice(
                pages, redo_page, raw.get("page") if isinstance(raw, dict) else None, report, pin_by, all_findings,
                contested, gap_by, names, {f"campaign.{k}" for k in ask})
            report["layout_by"] = old.get("layout_by") or "agent"
        else:
            ldropped = []
    else:
        # How it looks: the page the same call wrote, checked in code (Contract 5), or one built from the record.
        report["layout"], report["layout_by"], ldropped = layout.finish(
            raw.get("html") if isinstance(raw, dict) else None, report, pin_by, all_findings, contested, gap_by, names,
            {f"campaign.{k}" for k in ask})
    if ldropped:
        log.info("report layout (%s): dropped %d: %s", report.get("layout_by"), len(ldropped),
                 json.dumps(ldropped)[:600])
    cites = list(dict.fromkeys(list(headline["cites"]) + [c for s in summary for c in s["cites"]] + sorted(used)))
    hits = [{"id": c, "scope": pin_by[c].get("layer", ""), "source": pin_by[c].get("origin", "")}
            for c in cites if c in pin_by]
    if dropped:
        log.info("report: dropped %d claim(s) by the cite rule: %s", len(dropped), json.dumps(dropped)[:600])
    why = report_reasoning(raw.get("grounds"), report, pin_by, fi_by, dropped, open_ct, brand)
    return report, cites, hits, why


def report_reasoning(raw, report, pin_by, fi_by, dropped, open_ct, brand) -> dict:
    """The report's reasoning: the model's points, cite-checked against the
    pins and findings it was given; certainty from the rules — the lowest
    derived confidence of what the headline and summary cite, one lower when
    the cite rule dropped any claim."""
    lead = list(dict.fromkeys(list(report["headline"]["cites"]) + [c for s in report["summary"] for c in s["cites"]]))
    conf = [(pin_by.get(c) or fi_by.get(c) or {}).get("confidence") for c in lead]
    level = rsn.lowest(conf, default="low")
    basis = f"the lowest derived confidence of what the headline and summary cite is {level}"
    if dropped:
        level = rsn.step_down(level)
        basis += f"; one lower because the cite rule dropped {len(dropped)} claim(s)"
    fallback = [rsn.point(f"The headline rests on what it cites: {report['headline']['text']}",
                          report["headline"]["cites"])]
    for sec in report["sections"]:
        ids = [i for b in sec["blocks"] for i in (b.get("fact_ids") or b.get("cites") or [])
               + ([b["finding_id"]] if b.get("finding_id") else [])]
        if ids:
            fallback.append(rsn.point(f"{sec['title']}: what the section cites", list(dict.fromkeys(ids))))
    rejected = [rsn.rej("state a figure the cited pins do not hold",
                        "every claim is checked: a figure must be the value of a pin it cites")]
    if dropped:
        rejected.append(rsn.rej(f"keep the {len(dropped)} claim(s) that failed the cite check",
                                "a claim that cites nothing, cites what the document does not hold, or states an "
                                "unsupported figure is dropped"))
    attention = []
    if open_ct:
        attention.append(f"{len(open_ct)} value(s) are still contested.")
    if report.get("not_researched"):
        attention.append("Some lenses were not researched; the report says which.")
    if dropped:
        attention.append(f"The cite rule dropped {len(dropped)} claim(s).")
    r, _ = rsn.from_model(
        raw, decided=f"Composed the report for {brand}: {len(report['sections'])} section(s), "
                     f"{len(report['confirm'])} field(s) to confirm.",
        known=set(pin_by) | set(fi_by), certainty_=rsn.certainty(level, basis), fallback=fallback,
        would_change_if="new pins or findings land, a contest is resolved, or a finding is verified or rejected",
        rejected=rejected, attention=" ".join(attention) or None)
    return r


def based_on(clan) -> dict:
    data = ctx_data(clan)
    bf = (data.get("projection") or {}).get("built_from") or {}
    ok = lambda v: v if re.fullmatch(r"sha256:[0-9a-f]{64}", str(v)) else None
    return {"version": str(clan.get("version")),
            "facts_sha256": ok(bf.get("facts_sha256")) or canon_sha({"facts": ctx_facts(clan)}),
            "findings_sha256": ok(bf.get("findings_sha256")) or canon_sha({"findings": ctx_findings(clan)})}


def confirm_list(doc, camp) -> list:
    """D3's four while extracted or proposed, then every other proposed field."""
    d3 = ["brand", "categories", "markets", "competitor_set"]
    order = [f for f in d3 if (camp.get(f) or {}).get("origin") in ("extracted", "proposed")] + \
        [f for f in CAMPAIGN_FIELDS if f not in d3 and (camp.get(f) or {}).get("origin") == "proposed"]
    out = []
    for f in order:
        env = camp[f]
        v = env.get("value")
        if f in ("brand", "client_org"):
            shown = v.get("name") if isinstance(v, dict) else str(v)
        elif f == "markets":
            shown = market_list(v or [])
        elif f == "competitor_set":
            shown = ", ".join(c.get("name", c.get("ref", "")) for c in v or [])
        elif f == "categories":
            shown = ", ".join(v or [])
        else:
            shown = None
        label = FIELD_LABELS.get(f, f.replace("_", " ").capitalize()) + (f": {shown}" if shown else "")
        why = ("Read from the material; a person has not confirmed it yet." if env.get("origin") == "extracted"
               else "Proposed from pinned facts; a person has not confirmed it yet.")
        out.append({"address": f"{doc}#campaign.{f}", "label": label, "why": why})
    return out


def not_researched(sel, markets) -> list:
    skipped = [s for s in sel.get("lenses_skipped") or [] if s.get("lens") in LENSES]
    nr = [{"lens": s["lens"], **({"market": s["market"]} if s.get("market") else {}), "reason": s["reason"]}
          for s in skipped]
    ran = {(r.get("lens"), r.get("market")) for r in sel.get("lenses_run") or []}
    for l in LENSES:
        for m in markets:
            if (l, m) in ran or any(s["lens"] == l and s.get("market") in (None, m) for s in skipped):
                continue
            nr.append({"lens": l, "market": m, "reason": "No research run covers it yet."})
    return list({json.dumps(x, sort_keys=True): x for x in nr}.values())
