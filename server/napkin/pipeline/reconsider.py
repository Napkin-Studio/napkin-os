"""reconsider: a person reviewed the research, and the document is brought in step with what they said.

A review changes only the document and what rests on it; nothing is written to the knowledge layers
(review-in-document). The host has already recorded each review (facts[].review, findings[].verification or
rejection, a correction's new pin and the old pin's `replaced_by`); one run takes every review event the view
queued since the last, together:

  fact_rejected     the fact is excluded (selection.excluded, with the person's reason), and each finding citing
                    it is checked without it: with nothing else left it falls; otherwise jev says whether what
                    remains still supports it (without jev it is reworked, to be safe).
  fact_corrected    each finding citing the old pin is checked the same way against the person's value.
  fact_verified     nothing is judged again: the findings citing it are worth more, a fact a person verified
                    counting as reviewer-verified (high).
  finding_rejected  no finding is written again; the answers and report parts resting on it are.
  finding_verified  nothing is written again: a finding's confidence comes from its pins, and the page renders
                    its status from the record. No model call.

A finding that still stands is carried forward as a new proposal citing what now holds it up, with the same
statement; one that falls is written again from what remains (ONE call for all of them, cite-checked, a new
proposal for a person to verify), or is said no longer to stand. The old finding is left as it was: findings are
append-only, and rejecting one is a person's (os-layer). It is out of the report from here on, because nothing
cites a finding resting on a pin out of use (doc.out_of_use); the host flags it until a person settles it.

Then every answer to a question citing a changed item, directly or through a finding, is answered again, and only
the report sections and page parts citing one are written again (report.compose(part=...)). A page part holding a
person's wording (shared/edits.yaml) is never rewritten: it is held, and the decision says so. Confidence is
recomputed (rules/confidence.py) for every finding citing a reviewed fact. No model call when nothing cites what
was reviewed.
"""

from __future__ import annotations

import copy
import re

from ..doc import CONF, LENSES, ctx_data, ctx_decisions, ctx_facts, ctx_findings, decision, field_value, \
    lens_of_key, out_of_use, read_of
from ..jev import JevError, noul
from ..rules import layout as rule
from ..rules.cite import clean_claim
from ..rules.confidence import finding_confidence
from ..util import bad, iso, uid
from .. import reasoning as rsn
from . import report as report_stage
from .ask import Asker

STANDS = 0.6
FACT_EVENTS = ("fact_verified", "fact_rejected", "fact_corrected")
FINDING_EVENTS = ("finding_verified", "finding_rejected")
MAX_EVENTS = 100

SYSTEM = """You rework research findings for an advertising planner after a person reviewed the facts they rested
on: marked one wrong, or corrected its value. For each finding you are given, what changed, and the facts that now
stand. Write the finding again so it rests only on the facts that stand and says only what they support, citing
the ids it rests on; or, when they do not support any version of it, give null. Plain, specific sentences. State
no number that is not the value of a pin you cite."""


def _obj(props: dict) -> dict:
    return {"type": "object", "additionalProperties": False, "required": list(props), "properties": props}


def schema(ids: list[str], pins: list[str]) -> dict:
    return _obj({"findings": {"type": "array", "items": _obj({
        "id": {"type": "string", "enum": ids or ["(none)"]},
        "statement": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "cites": {"type": "array", "items": {"type": "string", "enum": pins or ["(none)"]}},
        "why": {"type": "string"}})}})


def _line(p) -> str:
    where = f" ({p['market']})" if p.get("market") else ""
    return f"{p.get('key')} = {p.get('value')}{where}"


def validate(clan: dict, inp: dict) -> list[dict]:
    """input.events -> the events, one per item and kind (the last of a repeat wins), in the order given."""
    events = inp.get("events")
    if not isinstance(events, list) or not events:
        raise bad("input.events is required: the reviews to bring the document in step with")
    if len(events) > MAX_EVENTS:
        raise bad(f"input.events holds at most {MAX_EVENTS} reviews")
    facts = {f.get("id"): f for f in ctx_facts(clan)}
    findings = {f.get("id") for f in ctx_findings(clan)}
    out = {}
    for i, e in enumerate(events):
        kind, iid = (e.get("kind"), e.get("id")) if isinstance(e, dict) else (None, None)
        if kind not in FACT_EVENTS + FINDING_EVENTS:
            raise bad(f"input.events[{i}].kind is one of {', '.join(FACT_EVENTS + FINDING_EVENTS)}")
        if not isinstance(e.get("decision"), str) or not re.fullmatch(r"d_[0-9A-Z]{6,}", e["decision"]):
            raise bad(f"input.events[{i}].decision is required: the decision that recorded the review")
        if kind in FACT_EVENTS and iid not in facts:
            raise bad(f"input.events[{i}].id: {iid} is not a pin in this document")
        if kind in FINDING_EVENTS and iid not in findings:
            raise bad(f"input.events[{i}].id: {iid} is not a finding in this document")
        if kind == "fact_corrected":
            new = e.get("replaced_by")
            if new not in facts or new == iid:
                raise bad(f"input.events[{i}].replaced_by is required: the pin the correction made")
        ev = {"kind": kind, "id": iid, "decision": e["decision"]}
        if kind == "fact_corrected":
            ev["replaced_by"] = e["replaced_by"]
        out.pop((kind, iid), None)
        out[(kind, iid)] = ev
    return list(out.values())


def page_hash(text: str) -> str:
    """The view's key for a layout's wording (clan-fields.html `hash`): djb2 over UTF-16 code units, base 36."""
    h = 5381
    b = text.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h = ((h << 5) + h + (b[i] | b[i + 1] << 8)) & 0xFFFFFFFF
    digits = ""
    while True:
        h, r = divmod(h, 36)
        digits = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + digits
        if not h:
            return digits


def held_parts(edits: dict, pages: list[str]) -> tuple[dict[int, list[str]], bool]:
    """The page parts holding a person's wording -> ({part: the edit keys on it}, whether wording is keyed to the
    whole page). The view keys report wording `report:<hash>:b<n>`. A key whose hash is one part's holds that
    part. One whose hash is the whole page's holds the whole page: any change to the page, even an addition,
    would leave that wording behind."""
    keys = [k for k, h in (edits or {}).items() if str(k).startswith("report:") and isinstance(h, str) and h.strip()]
    if not keys or not pages:
        return {}, False
    whole = page_hash("".join(pages))
    per = {page_hash(p): i for i, p in enumerate(pages)}
    held: dict[int, list[str]] = {}
    on_whole = False
    for k in keys:
        h = str(k).split(":")[1]
        if h == whole:
            on_whole = True
            for i in range(len(pages)):
                held.setdefault(i, []).append(k)
        elif h in per:
            held.setdefault(per[h], []).append(k)
    return held, on_whole


class Reconsider:
    def __init__(self, doc, base, clan, handler, caps, events, settings):
        self.doc, self.base, self.clan, self.handler, self.caps = doc, base, clan, handler, caps
        self.events, self.settings = events, settings
        self.data = ctx_data(clan)
        self.facts = {f.get("id"): f for f in ctx_facts(clan)}
        self.chain = {d.get("id"): d for d in ctx_decisions(clan)}
        self.of = lambda kind: [e for e in events if e["kind"] == kind]

    def why(self, e) -> str:
        """The person's words for a review: the rationale of the decision that recorded it."""
        r = (self.chain.get(e["decision"]) or {}).get("rationale")
        return r.strip()[:500] if isinstance(r, str) and r.strip() else "A person marked it wrong."

    def effective(self, p) -> dict:
        """A pin as a finding's confidence counts it: one a person verified is reviewer-verified, high."""
        return dict(p, confidence="high") if (p.get("review") or {}).get("verdict") == "verified" else p

    # -- does it still stand? --------------------------------------------------------
    def stands(self, f, remaining, pin_by, changed) -> tuple[bool, float | None, str]:
        if not remaining:
            return False, None, "nothing else it cites remains"
        if not self.caps.jev.configured:
            return False, None, "not checked by jev (no key): reworked, to be safe"
        state = {"finding": f.get("statement"), "facts_that_stand": [_line(pin_by[c]) for c in remaining],
                 "what_changed": changed}
        try:
            p = self.caps.jev.ask(state, {"stands": noul(
                "Do the facts that stand, on their own, still support the finding as it is written?",
                "They support it as written", "Without the changed fact it says more than they support")},
                "reconsider")["stands"]
        except JevError as e:
            return False, None, f"not checked by jev ({str(e)[:120]}): reworked, to be safe"
        return p >= STANDS, p, f"jev: still supported {p:.2f}"

    # -- the job ------------------------------------------------------------------------
    def run(self, progress=None):
        doc, handler, t = self.doc, self.handler, iso()
        rejected = {e["id"]: e for e in self.of("fact_rejected")}
        corrected = {e["id"]: e for e in self.of("fact_corrected")}
        verified = {e["id"] for e in self.of("fact_verified")}
        fi_rejected = {e["id"] for e in self.of("finding_rejected")}
        did = uid("d_", doc, self.base, "reconsider", [(e["kind"], e["id"], e["decision"]) for e in self.events])

        # 1. the document as the review left it: each fact marked wrong excluded, with the person's reason
        sel = self.data.get("selection") or {}
        excluded = [x for x in sel.get("excluded") or [] if isinstance(x, dict) and x.get("fact_id") not in rejected]
        excluded += [{"fact_id": fid, "reason": self.why(e), "decision": did} for fid, e in rejected.items()]
        data2 = copy.deepcopy(self.data)
        if rejected:
            data2.setdefault("selection", {})["excluded"] = excluded
        clan2 = dict(self.clan, data=data2)
        gone = out_of_use(clan2)
        pin_by = {f["id"]: self.effective(f) for f in ctx_facts(clan2) if str(f.get("id", "")).startswith("f_")
                  and f["id"] not in gone and f.get("confidence") in CONF}
        live = [f for f in ctx_findings(self.clan) if f.get("status") in ("proposed", "verified")
                and f.get("id") not in fi_rejected]
        changed_lines = [f"{_line(self.facts[fid])} was marked wrong: {self.why(e)}" for fid, e in rejected.items()] + \
            [f"{_line(self.facts[fid])} was corrected to {self.facts[e['replaced_by']].get('value')}"
             for fid, e in corrected.items()]

        # 2. what rests on a fact marked wrong or corrected: does it still stand?
        checked, standing, fallen = [], [], []
        for f in live:
            cites = f.get("cites") or []
            if not set(cites) & (set(rejected) | set(corrected)):
                continue
            now = list(dict.fromkeys(corrected[c]["replaced_by"] if c in corrected else c for c in cites))
            remaining = [c for c in now if c in pin_by]
            ok, p, how = self.stands(f, remaining, pin_by, changed_lines)
            checked.append({"id": f["id"], "statement": f.get("statement"), "stands": ok, "p": p, "how": how})
            (standing if ok else fallen).append((f, remaining))
        if progress:
            progress(1)

        brand = field_value(self.data, "brand") or {}
        names = [brand.get("name", "")] + [c.get("name", "") for c in field_value(self.data, "competitor_set") or []
                                           if isinstance(c, dict)]
        existing = {tuple(sorted(x.get("cites") or [])) for x in ctx_findings(self.clan)}
        new_findings, new_decs, reworked = [], [], {}

        def propose(old, statement, cites, why, rework: bool):
            cites = sorted(cites)
            cited = [pin_by[x] for x in cites]
            lens = old.get("lens") or lens_of_key(cited[0].get("key"))
            nid = uid("fi_", doc, lens, cites)
            ndid = uid("d_", doc, self.base, "rework" if rework else "carry", old["id"], nid)
            fi = {"id": nid, "statement": statement, "cites": cites, "method": "synthesis", "status": "proposed",
                  "derived_by": handler, "confidence": finding_confidence(cited), "derived_at": t, "decision": ndid}
            if lens in LENSES:
                fi["lens"] = lens
            mk = sorted({p["market"] for p in cited if p.get("market")})
            if mk:
                fi["markets"] = mk
            new_findings.append(fi)
            existing.add(tuple(cites))
            reworked[old["id"]] = {"new": nid, "statement": statement, "carried": not rework}
            dropped = [c for c in old.get("cites") or [] if c not in cites]
            new_decs.append(decision(doc, ndid, "finding", handler, "synthesise_finding", "", [f"findings[{nid}]"],
                                     cites, timestamp=t, reasoning=rsn.make(
                                         (f"Worked out again in place of {old['id']}, after a person's review of what "
                                          f"it rested on." if rework else
                                          f"Carried {old['id']} forward: it still stands on what a person's review "
                                          f"left."),
                                         [rsn.point(f"The old finding said: {old.get('statement')}", old["id"]),
                                          rsn.point(why, cites)],
                                         rsn.certainty(fi["confidence"], "the lowest derived confidence of what it cites"),
                                         "a cited fact is revised or excluded, or a person rejects it",
                                         rejected=[rsn.rej(f"keep citing {', '.join(dropped)}",
                                                           "a person marked it wrong or corrected it")],
                                         attention=f"A new finding in place of {old['id']}: verify this one, and "
                                                   f"reject the old one.")))

        # 3a. what still stands is carried forward on what now holds it up
        for f, remaining in standing:
            c, why = clean_claim(f.get("statement"), remaining, pin_by, {}, names)
            if c and tuple(sorted(c["cites"])) in existing:
                reworked[f["id"]] = {"why": "a finding on those facts is already in the document"}
            elif c:
                propose(f, c["text"], c["cites"], "It still stands on the facts that remain", rework=False)
            else:  # it states what the facts that stand no longer hold (a corrected figure): written again
                fallen.append((f, remaining))
                next(x for x in checked if x["id"] == f["id"]).update(stands=False, how=f"{why}: reworked")

        # 3b. what fell is written again, in one call
        if fallen:
            lenses = {f.get("lens") or next((lens_of_key(pin_by[c]["key"]) for c in rem), None) for f, rem in fallen}
            pool = [p for p in pin_by.values() if lens_of_key(p.get("key")) in lenses] or list(pin_by.values())
            pool = pool[:160]
            payload = {"what_changed": changed_lines,
                       "findings": [{"id": f["id"], "statement": f.get("statement"), "lens": f.get("lens")}
                                    for f, _ in fallen],
                       "facts_that_stand": [{"id": p["id"], "entity": p.get("entity"), "key": p.get("key"),
                                             "value": p.get("value"), "unit": p.get("unit"), "market": p.get("market")}
                                            for p in pool]}
            try:
                raw = self.caps.model.structured("rework_findings", SYSTEM, payload,
                                                 schema([f["id"] for f, _ in fallen], [p["id"] for p in pool]),
                                                 max_tokens=4000)
            except Exception as e:  # noqa: BLE001 - the fallen findings stay flagged for a person; nothing halts
                raw = {"findings": []}
                for f, _ in fallen:
                    reworked[f["id"]] = {"why": f"could not be reworked: {str(e)[:160]}"}
            by_old = {f["id"]: f for f, _ in fallen}
            for item in raw.get("findings") or []:
                old = by_old.get(item.get("id"))
                if not old or item["id"] in reworked:
                    continue
                if not item.get("statement"):
                    reworked[old["id"]] = {"why": item.get("why") or "the facts that stand do not support it"}
                    continue
                c, why = clean_claim(item.get("statement"), item.get("cites"), pin_by, {}, names)
                if not c or tuple(sorted(c["cites"])) in existing:
                    reworked[old["id"]] = {"why": why or "a finding on those facts is already in the document"}
                    continue
                propose(old, c["text"], c["cites"], item.get("why") or "It now rests only on the facts that stand",
                        rework=True)
            for f, _ in fallen:
                reworked.setdefault(f["id"], {"why": "the agent did not write it again"})
        if progress:
            progress(2)

        # 4. confidence, for every finding citing a reviewed fact
        reviewed = verified | set(rejected) | set(corrected)
        confidence = {}
        for f in live:
            if not set(f.get("cites") or []) & reviewed or f["id"] in reworked:
                continue
            cited = [pin_by[c] for c in f.get("cites") or [] if c in pin_by]
            now = finding_confidence(cited) if cited else None
            if now != f.get("confidence"):
                confidence[f["id"]] = {"was": f.get("confidence"), "now": now}

        # what changed, directly or through a finding
        changed = set(rejected) | set(corrected) | {e["replaced_by"] for e in corrected.values()} | fi_rejected | \
            set(reworked) | {x["id"] for x in new_findings}
        touched = changed | {f["id"] for f in ctx_findings(self.clan) if set(f.get("cites") or []) & changed}
        clan3 = dict(clan2, findings=list(ctx_findings(self.clan)) + new_findings)

        # 5. answers that cite a changed item
        asks_patch, ask_decs, answers = {}, [], []
        for aid, a in ((self.data.get("asks") or {}).items()):
            if not isinstance(a, dict) or not {c for s in a.get("answer") or [] if isinstance(s, dict)
                                               for c in s.get("cites") or []} & touched:
                continue
            asker = Asker(doc, self.base, clan3, handler, self.caps, a.get("question") or "", a.get("lens"), self.settings)
            asker.aid = aid
            pb, fb = asker.evidence(a.get("lens"))
            try:
                sentences, missing, _, _, _ = asker.answer(a.get("lens"), pb, fb)
            except Exception as e:  # noqa: BLE001 - the old answer stays, flagged by the decision
                answers.append({"id": aid, "question": a.get("question"), "error": str(e)[:160]})
                continue
            j, _ = asker.check(sentences, pb, fb)
            status = ("answered" if j["answers"] >= 0.6 else ("partial" if sentences else "not_found")) if j else \
                ("answered" if sentences and not missing else ("partial" if sentences else "not_found"))
            adid = uid("d_", doc, self.base, "reanswer", aid, did)
            asks_patch[aid] = dict(a, answer=sentences, missing=missing, status=status, answered_at=iso(), decision=adid)
            answers.append({"id": aid, "question": a.get("question"), "status": status})
            ask_decs.append(decision(doc, adid, "edit", handler, "ask_research", "", [f"asks[{aid}]"],
                                     [c for s in sentences for c in s["cites"]], fields_changed=["asks"], reasoning=rsn.make(
                                         f"Answered “{(a.get('question') or '')[:100]}” again after a person's review.",
                                         [rsn.point(s["text"], s["cites"]) for s in sentences]
                                         or [rsn.point("Nothing that stands answers it", [f"{doc}#asks[{aid}]"])],
                                         rsn.certainty("medium" if sentences else "low", "from the facts that stand"),
                                         "new facts land on the question",
                                         rejected=[rsn.rej("keep the old answer",
                                                           f"it cites {', '.join(sorted(touched & {c for s in a.get('answer') or [] for c in s.get('cites') or []}))}, which a review changed")])))
        if progress:
            progress(3)

        # 6. the report: only the parts that cite a changed item
        report_patch, rep_decs, rep_hits, held, redone = None, [], [], {}, {}
        rep = self.data.get("report")
        if isinstance(rep, dict) and isinstance(rep.get("sections"), list):
            def refs_of(sec):
                return {i for b in sec.get("blocks") or [] for i in list(b.get("cites") or []) +
                        list(b.get("fact_ids") or []) + ([b["finding_id"]] if b.get("finding_id") else [])}
            sections = {s["id"] for s in rep["sections"] if refs_of(s) & touched}
            head = bool(set((rep.get("headline") or {}).get("cites") or []) & touched)
            summ = any(set(s.get("cites") or []) & touched for s in rep.get("summary") or [])
            pages = rule.split(rep["layout"]) if isinstance(rep.get("layout"), str) else []
            held, whole = held_parts(self.clan.get("edits") or {}, pages)
            hit = [i for i, h in enumerate(pages) if report_stage._ids(h) & touched or (head and "cl-title" in h)]
            page = [i for i in hit if i not in held]
            held = {i: keys for i, keys in held.items() if i in hit}
            if whole:
                page = []
            if sections or head or summ or page:
                try:
                    report, cites, rep_hits, why = report_stage.compose(
                        doc, clan3, handler, self.caps,
                        part={"old": rep, "sections": sections, "headline": head, "summary": summ,
                              "page": None if whole else page,
                              "why": changed_lines + [f"finding {x} was rejected by a person" for x in sorted(fi_rejected)]})
                    report_patch = report
                    redone = {"sections": sorted(sections), "headline": head, "summary": summ, "page": page}
                    rdid = uid("d_", doc, self.base, "report-reconsider", did)
                    rep_decs.append(decision(doc, rdid, "edit", handler, "compose_report",
                                             "Wrote again only the parts of the report a person's review changed.",
                                             ["report"], cites, fields_changed=["report"], reasoning=why))
                except Exception as e:  # noqa: BLE001 - the old report stays; Refresh report will say it is out of date
                    answers.append({"id": "report", "error": str(e)[:160]})
        if progress:
            progress(4)

        # -- the record ------------------------------------------------------------------------
        because = []
        for e in self.events:
            p = self.facts.get(e["id"])
            what = {"fact_verified": "verified", "fact_rejected": f"marked wrong: {self.why(e)}",
                    "fact_corrected": f"corrected to {self.facts.get(e.get('replaced_by'), {}).get('value')}",
                    "finding_verified": "verified", "finding_rejected": "rejected"}[e["kind"]]
            label = _line(p) if p else e["id"]
            because.append(rsn.point(f"A person {what}: {label}", [e["id"]] + ([e["replaced_by"]] if e.get("replaced_by") else [])))
        for c in checked:
            r = reworked.get(c["id"], {})
            because.append(rsn.point(
                f"“{(c['statement'] or '')[:140]}” " + (("still stands, carried forward as " + r["new"]) if r.get("carried")
                                                        else ("worked out again as " + r["new"]) if r.get("new") else
                                                        ("no longer stands: " + r.get("why", ""))) + f" ({c['how']})",
                [c["id"]] + ([r["new"]] if r.get("new") else [])))
        for fid, cf in confidence.items():
            because.append(rsn.point(f"{fid}'s confidence is now {cf['now'] or 'none'} (was {cf['was']})", fid))
        if asks_patch:
            because.append(rsn.point(f"{len(asks_patch)} answer(s) to questions cited a changed item and were answered "
                                     f"again", [f"{doc}#asks[{a}]" for a in asks_patch]))
        if report_patch is not None:
            because.append(rsn.point(f"The report parts citing a changed item were written again "
                                     f"({len(redone['sections'])} section(s), {len(redone['page'])} page part(s)); "
                                     f"the rest is as it was", [f"{doc}#report"]))
        if held:
            because.append(rsn.point(f"{len(held)} page part(s) rest on a changed item but hold a person's wording: "
                                     f"kept as they are", [f"{doc}#report"]))
        if len(because) == len(self.events):
            because.append(rsn.point("Nothing the crew wrote needs writing again", [e["id"] for e in self.events]))
        fell = sum(1 for v in reworked.values() if not v.get("new"))
        summary = (f"{len(self.events)} review(s): {len(checked)} finding(s) checked, "
                   f"{sum(1 for v in reworked.values() if v.get('carried'))} carried forward, "
                   f"{sum(1 for v in reworked.values() if v.get('new') and not v.get('carried'))} worked out again, "
                   f"{fell} no longer stand"
                   + (f"; {len(confidence)} confidence(s) changed" if confidence else "")
                   + (f"; {len(asks_patch)} answer(s) redone" if asks_patch else "")
                   + ("; the report parts resting on it were written again" if report_patch is not None else "")
                   + (f"; {len(held)} page part(s) held for a person's wording" if held else "") + ".")
        attention = []
        if new_findings:
            attention.append("Verify the new finding(s), and reject the old one(s) they replace.")
        if held:
            attention.append(f"{len(held)} part(s) of the report hold your own wording and rest on something the "
                             f"review changed: they were not rewritten; check them.")
        r = rsn.make(f"Brought the document in step with a person's review: {summary}", because,
                     rsn.certainty("medium" if self.caps.jev.configured or not checked else "low",
                                   "jev judged whether each finding still stands" if self.caps.jev.configured
                                   else ("without jev, every finding resting on a changed fact was reworked" if checked
                                         else "no finding was judged again")),
                     "a person reviews these items again",
                     rejected=[rsn.rej("leave the conclusions as they are", "they rest on what a person reviewed")],
                     attention=" ".join(attention) or None)
        targets = [f"facts[{e['id']}]" if e["kind"] in FACT_EVENTS else f"findings[{e['id']}]" for e in self.events]
        targets += [f"selection.excluded[{fid}]" for fid in rejected]
        rd = decision(doc, did, "edit", handler, "reconsider", "", list(dict.fromkeys(targets)),
                      [e["id"] for e in self.events], fields_changed=["selection.excluded"] if rejected else [],
                      reasoning=r)
        patch = {}
        if rejected:
            patch["selection"] = {"excluded": excluded}
        if asks_patch:
            patch["asks"] = asks_patch
        if report_patch is not None:
            patch["report"] = report_patch
        change = {"doc": doc, "base_version": self.base, "read": read_of(self.data, patch), "data_patch": patch,
                  "facts_append": [], "findings_append": new_findings, "decisions": [rd] + new_decs + ask_decs + rep_decs}
        result = {"summary": summary, "events": self.events, "checked": checked, "reworked": reworked,
                  "confidence": confidence, "answers": answers, "report": redone or None,
                  "held": [{"part": i, "edits": keys} for i, keys in sorted(held.items())]}
        return result, change, rep_hits
