"""Assemble deck.json from the inputs and the recorded stage outputs. No model calls.

The assembler decides structure (which slides, in what order, what each must carry) from the
agency response-deck convention (PLAN.md §3) and fills each slide from the stages' outputs,
the brief and the research. Every slide records its claims with refs, its requirement ids and
its status. Human-only parts become labelled placeholders, never invented content.
"""
from __future__ import annotations

import datetime as _dt
import re

from . import intake, profiles, spec
from .refs import Resolver, answer_text, fmt

#: requirement kind -> slide types that answer it (stage b can override per requirement)
REQ_HOME = {
    "objective": ["objective", "brief_restated", "measurement"], "audience": ["audience"],
    "scope": ["channel_roles", "process"], "message": ["proposition", "idea"],
    "tone": ["guardrails"], "mandatory": ["guardrails"], "selection": ["credentials"],
    "commercial": ["investment"], "team": ["team"], "timing": ["timeline"],
}
REQ_OVERRIDE = {"r_scope_eval": ["measurement"], "r_scope_creative": ["territory_choice", "execution"],
                "r_scope_strategy": ["real_question", "audience", "proposition"],
                "r_pr_inhouse": ["channel_roles"], "r_phone_reluctance": ["audience", "execution", "innovation"],
                "r_aim": ["brief_restated"], "r_obj_misconceptions": ["real_question", "insight"],
                "r_framework": ["investment", "timeline"]}


def _normalize(st: dict) -> dict:
    """Stage outputs with refs in the deck's form: a live model sometimes writes a brief field as
    doc:brief#<field> or brief#<field> (both mean brief:<field>), or packs two refs into one string. Anything else is left for the
    validator to judge (unknown_ref)."""
    def ref(r):
        if isinstance(r, str):
            for pre in ("doc:brief#", "brief#"):
                if r.startswith(pre):
                    return "brief:" + r[len(pre):]
        return r
    def walk(x):
        if isinstance(x, dict):
            split = lambda v: [p.strip() for r in v for p in (re.split(r"[;,]\s*", r) if isinstance(r, str) else [r]) if p]   # "a; b" is two refs
            one = lambda v: ref(split([v])[0]) if isinstance(v, str) and v.strip() else v   # a single ref field keeps its first
            return {k: ([ref(r) for r in split(v)] if k.endswith("refs") and isinstance(v, list) else one(v) if k == "ref" else walk(v)) for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v) for v in x]
        return x
    return {k: walk(v) for k, v in st.items()}


#: Slide types that are structure, not claims: they keep their status when the input is thin.
STRUCTURAL_TYPES = ("appendix", "requirement_trace", "appendix_sources", "conflicts", "questions")


def _intake_apply(inp, st: dict) -> None:
    """Put stage a0's fields into the brief where it is empty (intake.apply_a0), once. A brief-only
    run has no a0 and nothing changes."""
    if st.get("a0"):
        if not inp.intake:
            inp.intake = st["a0"]
        intake.apply_a0(inp, st["a0"])


def _label_thin(S: list, inp) -> None:
    """A slide resting on thin input is drafted, never from_source: when the deck is built from a
    prompt (and documents) alone, every claim slide; otherwise a slide citing a brief field only an
    intake stage proposed. The status rules of the other slides are unchanged."""
    thin = intake.tier(inp)["tier"] in spec.THIN_TIERS
    proposed = {f"brief:{fid}" for fid, f in inp.brief.items() if f.get("from_intake") and f.get("kind") == "proposal"}
    for sl in S:
        if sl["status"] != "from_source" or sl["type"] in STRUCTURAL_TYPES or sl.get("supplied"):
            continue   # a slide the person supplied (answer or document) is their own input, however thin the rest is
        if thin or any(r.split(".")[0] in proposed for r in slide_refs(sl)):
            sl["status"] = "drafted"


def _slide(type_, title, blocks, claims=None, status="drafted", visual=None, notes="", reqs=None, label=None):
    """One slide record in the deck contract (deck.schema.json)."""
    claims = list(claims or [])
    blocks = _dedupe_blocks(title, blocks, claims)
    return {"type": type_, "section": spec.SLIDE_TYPES[type_]["section"], "title": title,
            "label": label or title[:80], "blocks": blocks, "claims": claims,
            "visual": visual or {"kind": "layout", "hint": type_}, "notes": notes,
            "status": status, "requirements": reqs or []}


def _objective_items(inp, reqs: list) -> list:
    """The objectives as cited bullet items: the requirements of kind objective (read from the client's documents),
    else the brief's objectives (a dict of kinds, a list, or one text). Words are the inputs' own."""
    objs = [r for r in reqs if r["kind"] == "objective"]
    if objs:
        return [{"text": r["text"], "refs": [r["ref"], "req:" + r["id"]]} for r in objs]
    o = (inp.brief.get("objectives") or {}).get("value") or {}
    if isinstance(o, dict):
        return [{"text": f"{k.capitalize()}: {v}", "refs": [f"brief:objectives.{k}"]} for k, v in o.items() if v]
    texts = [str(x) for x in (o if isinstance(o, list) else [o]) if str(x).strip()]
    return [{"text": t, "refs": ["brief:objectives"]} for t in texts]


def _objective_slide(inp, items: list):
    """The objective slide (50 words, position 2): what has to change, as the client's objectives and the
    person's own answer to the question about the number, its baseline and date (an answer addressed to
    ``brief.objectives``). Built only from those inputs, whole items, in order, until the word budget is
    reached (the rest stays in the brief_restated slide of the appendix); None when there is nothing to show."""
    budget = spec.SLIDE_TYPES["objective"]["words"]
    blocks, used = [], 0
    have = " ".join(spec.norm_text(i["text"]) for i in items)
    for q in (inp.intake or {}).get("questions") or []:
        if str(q.get("address") or "").split(".")[:2] == ["brief", "objectives"]:
            txt = answer_text(inp, q.get("id", "")).strip()
            if txt and spec.norm_text(txt) not in have:
                blocks.append({"kind": "callout", "text": "The number to move: " + txt, "refs": [f"answer:{q['id']}"]})
                used += len(blocks[-1]["text"].split())
                break
    keep = []
    for it in items:
        w = len(it["text"].split())
        if keep and used + w > budget:
            break
        keep.append(it)
        used += w
    if not keep and not blocks:
        return None
    if keep:
        blocks.append({"kind": "bullets", "items": keep})   # the number first, then the objectives behind it
    shown = " ".join([b.get("text", "") for b in blocks] + [i["text"] for b in blocks for i in b.get("items") or []])
    quantified = bool(re.search(r"\d", shown))   # a number, a baseline or a date in the person's words; else the slide does not promise one
    return _slide("objective", "What has to change, by how much and by when" if quantified else "What has to change", blocks, status="from_source")


def _dedupe_blocks(title: str, blocks: list, claims: list) -> list:
    """Say a sentence once on a slide: a text-bearing block (text, statement, quote, callout, small, card) whose
    words equal the slide's title, or an earlier such block's, is dropped. Refs it carried are kept as a claim,
    so the footnotes and the notes lose nothing. Placeholders, internal notes and ad copy are never touched."""
    seen, out = {spec.norm_text(title)}, []
    for b in blocks:
        t = spec.norm_text(b.get("text", "")) if b.get("kind") in ("text", "statement", "quote", "callout", "small", "card") else ""
        if t and not b.get("human") and not b.get("internal") and t in seen:
            if b.get("refs") and not any(set(b["refs"]) <= set(c.get("refs") or []) for c in claims):
                claims.append({"text": str(b["text"]), "refs": list(b["refs"]), "basis": "sourced"})
            continue
        if t:
            seen.add(t)
        out.append(b)
    return out


def _placeholder(what: str, proposal: str, confirm: str) -> str:
    """The labelled placeholder for anything the client or agency must supply (REQ-01 rule)."""
    return f"{spec.PLACEHOLDER_PREFIX} {proposal} [{what}]. To confirm: {confirm}."


#: The cards (intake.SUPPLY_CARDS) each human-only slide is filled from; investment reads two.
SUPPLY_FOR = {"why_now": ("q_supply_why_now",), "what_we_know": ("q_supply_what_we_know",), "team": ("q_supply_team",), "credentials": ("q_supply_credentials",),
              "investment": ("q_supply_budget", "q_supply_options"), "next_step": ("q_supply_decision_date",)}


#: Investor slide types that rest on one stated fact: with no source they are a gap to fill, not a presented slide.
GAP_TYPES = ("why_now", "what_we_know")


def _is_gap(sl: dict) -> bool:
    """A why_now or what_we_know slide still waiting for the person (see build_investor)."""
    return sl["type"] in GAP_TYPES and sl["status"] == "needs_human"


def investor_gaps(deck: dict) -> list:
    """The slide types of a built investor deck that are gaps: the question cards (intake.gap_questions) are for them."""
    return [sl["type"] for sl in deck["slides"].values() if sl and _is_gap(sl)]


def _fill_human_only(S: list, inp) -> list:
    """Fill the human-only slides (spec.HUMAN_ONLY_TYPES) with what the person supplied, in place; return the
    slide types filled. The engine never invents these parts, but it reads the person's own: their answers to the
    supply cards (cited ``answer:<qid>``) and, when there is no answer, the documents they attached where a document
    has a section for it (cited ``doc:<key>#pN``; intake.doc_supply). A filled slide is ``from_source``; its
    placeholders go, its words are the person's lines whole and in order, and ``slide.supplied`` records
    ``{basis, by, refs}`` ('supplied by <person>' or 'document'). A slide nothing supplies is left as it was: a
    labelled placeholder, ``needs_human``. With no answers and no document section the deck is unchanged."""
    done = []
    for sl in S:
        qids = SUPPLY_FOR.get(sl["type"])
        if not qids or sl["status"] != "needs_human":
            continue
        got = intake.human_fill(inp, sl["type"], qids)
        if not got:
            continue
        items = [{"text": t, "refs": [r], "basis": "sourced"} for t, r in got["items"]]
        claims = [{"text": i["text"], "refs": i["refs"], "basis": "sourced"} for i in items]
        if sl["type"] == "next_step":   # the agreement to ask for stays (a proposal); the date placeholder is replaced by the person's date
            keep = [it for b in sl["blocks"] for it in b.get("items") or [] if not it.get("human")]
            items = keep + [{"text": "Decision date: " + t, "refs": [r], "basis": "sourced"} for t, r in got["items"]]
            claims = [{"text": i["text"], "refs": i["refs"], "basis": "sourced"} for i in items if i.get("refs")]
            sl["blocks"] = [{"kind": "bullets", "items": items}]
        elif sl["type"] == "investment":   # the budget line the slide opens with stays; the placeholders give way to the person's split and options
            sl["blocks"] = [b for b in sl["blocks"] if b["kind"] != "bullets"] + [{"kind": "bullets", "items": items}]
        else:
            sl["blocks"] = [{"kind": "bullets", "items": items}]
        sl["claims"] = list(sl["claims"]) + claims
        sl["status"] = "from_source"
        sl["supplied"] = {"basis": got["basis"], "by": got["by"], "refs": sorted({r for _, r in got["items"]})}
        done.append(sl["type"])
    return done


def _brief_text(inp, fid, default=""):
    """A brief field as plain text, or the default when the field is empty."""
    v = (inp.brief.get(fid) or {}).get("value")
    if isinstance(v, dict):
        return " ".join(f"{k}: {x}" for k, x in v.items() if x)
    if isinstance(v, list):
        return "; ".join(map(str, v))
    return v or default


#: The chain stage d writes (DECK-CRAFT-PLAN 3.5): quoted phrases that tie the insight to the idea and the idea to its proof.
CHAIN_PHRASES = ("insight_phrase", "strategy_phrase", "idea_phrase", "proof_phrase")


def valid_candidates(b: dict) -> list:
    """Stage b's insight candidates that are usable: a dict with an id and the three lines (observation, tension,
    implication) as non-empty text. An old stage b file has none, and its insight is built the way it always was."""
    out = []
    for c in (b or {}).get("insight_candidates") or []:
        if isinstance(c, dict) and c.get("id") and all(str(c.get(k) or "").strip() for k in ("observation", "tension", "implication")):
            out.append(c)
    return out


def _yn(v) -> str:
    """A judge answer as 'yes' or 'no' (a bool, or text whose FIRST WORD is yes/true/pass or no/false/fail); '' when it is neither,
    so a vague or negated answer ('Not sure', 'none') never counts as a firm no."""
    if isinstance(v, dict):
        v = v.get("answer", v.get("verdict"))
    if isinstance(v, bool):
        return "yes" if v else "no"
    words = re.findall(r"[a-z]+", str(v or "").strip().lower())
    first = words[0] if words else ""   # the whole first word: 'Not sure', 'none' and 'nothing' are no firm answer
    return "yes" if first in ("yes", "true", "pass") else "no" if first in ("no", "false", "fail") else ""


def judge_verdicts(judge: dict | None) -> dict:
    """The insight judge's verdict per candidate id, computed in code from the recorded tests (a recorded ``pass`` is never
    trusted): ``{id: {"pass": bool, "failed": [test names], "reason": str, "paraphrase": str}}``. A candidate passes when each
    of spec.INSIGHT_TESTS has its passing answer and its paraphrase holds no number and does not read as 'X% of people do Y'."""
    out = {}
    for v in (judge or {}).get("verdicts") or []:
        if not (isinstance(v, dict) and v.get("id")):
            continue
        tests = v.get("tests") if isinstance(v.get("tests"), dict) else {}   # a malformed tests value fails every test, it never crashes the build
        failed = [t for t, want in spec.INSIGHT_TESTS.items() if _yn(tests.get(t)) != want]
        para = str(v.get("paraphrase") or "")
        if re.search(r"\d|\bper ?cent\b|\bpercent\b|%", para):
            failed.append("paraphrase")
        reasons = [str((tests.get(t) or {}).get("reason") or "") if isinstance(tests.get(t), dict) else "" for t in failed if t != "paraphrase"]
        out[str(v["id"])] = {"pass": not failed, "failed": failed, "paraphrase": para,
                             "reason": "; ".join(r for r in reasons if r) or ("paraphrase holds a number: a statistic, not an insight" if "paraphrase" in failed else str(v.get("reason") or ""))}
    return out


def passing_ids(b: dict, judge: dict | None) -> list:
    """Stage b's candidate ids that pass the insight judge, best first (the judge's order, then any unranked)."""
    by_id = {str(c["id"]) for c in valid_candidates(b)}
    verdicts = judge_verdicts(judge)
    ranked = [str(i) for i in (judge or {}).get("order") or []]
    order = [i for i in ranked if i in by_id] + [i for i in by_id if i not in ranked]
    return [i for i in order if verdicts.get(i, {}).get("pass")]


def _insight(b: dict, judge: dict | None, inp):
    """The insight slide and its record when stage b wrote candidates, else None (the old shape is built as it always was).
    The chosen candidate is the insight: the judge's first-ranked passing candidate (it may overrule the writer), else the
    writer's choice, which when every candidate fails marks the slide needs_human. The slide: the truth in three lines
    (people..., but..., so...) as a ``statement`` the deck owns, a fixed label saying what it rests on, the evidence as
    supporting ``small`` lines with their refs. Returns ``(slide, record, candidates)``."""
    cands = valid_candidates(b)
    if not cands:
        return None
    ins = b.get("insight") or {}
    by_id = {str(c["id"]): c for c in cands}
    writer = str(ins.get("writer_chosen_candidate_id") or ins.get("chosen_candidate_id") or "")   # the writer's own pick, kept when run_deck moved the choice to the judge's
    writer = writer if writer in by_id else str(cands[0]["id"])
    verdicts = judge_verdicts(judge)
    passing = passing_ids(b, judge)
    judged = bool(verdicts)
    chosen, by = (passing[0], "judge" if passing[0] != writer else "writer and judge agree") if passing else (writer, "writer")
    needs_human = judged and not passing
    c = by_id[chosen]
    sent = lambda t: str(t).strip() if str(t).strip()[-1:] in ".!?" else str(t).strip() + "."
    truth = " ".join(sent(c[k]) for k in ("observation", "tension", "implication"))
    refs = [r for r in dict.fromkeys(list(c.get("refs") or []) + list(c.get("from_refs") or [])) if isinstance(r, str)]
    ev = [e for e in ins.get("evidence") or [] if isinstance(e, dict) and str(e.get("text") or "").strip()]
    blocks = [{"kind": "statement", "text": truth, **({"refs": refs} if refs else {"basis": "opinion"})},
              {"kind": "small", "text": spec.INSIGHT_LABEL if refs else spec.INSIGHT_LABEL_UNSOURCED, "basis": "meta"}]
    blocks += [{"kind": "small", "text": e["text"], "refs": list(e.get("refs") or [])} for e in ev]
    v = verdicts.get(chosen)
    note = (f"Insight {chosen} of {len(cands)}, chosen by {by}." + (f" Writer's pick: {writer}." if writer != chosen else "")
            + (f" Why: {ins['why']}" if ins.get("why") else "") + (f" Judge: {v['paraphrase']}" if v and v["paraphrase"] else "")
            + (" Every candidate failed the judge: " + " | ".join(f"{i}: {x['reason']}" for i, x in verdicts.items()) if needs_human else "")
            + (" " + ins["note"] if ins.get("note") else ""))
    slide = _slide("insight", ins.get("title") or "The insight", blocks,
                   claims=[{"text": truth, "refs": refs, "basis": "sourced" if refs else "opinion"}] + [
                       {"text": e["text"], "refs": list(e.get("refs") or []), "basis": "sourced" if e.get("refs") else "opinion"} for e in ev],
                   status="needs_human" if needs_human else "drafted", notes=note.strip())
    record = {"chosen": chosen, "writer_choice": writer, "chosen_by": by, "why": ins.get("why", ""), "judged": judged,
              "judge_pass": bool(passing) if judged else None, "needs_human": needs_human}
    listed = [{**x, "chosen": str(x["id"]) == chosen, **({"judge": verdicts[str(x["id"])]} if str(x["id"]) in verdicts else {})} for x in cands]
    return slide, record, listed


def _fit_rows(rows: list, budget: int, per_row) -> list:
    """The leading whole rows whose words stay within ``budget`` (``per_row`` counts one row's words); the first row is always
    kept. Nothing is reworded: a row is kept whole or left out (the slide's notes say how many were left out)."""
    keep, used = [], 0
    for r in rows:
        w = per_row(r)
        if keep and used + w > budget:
            break
        keep.append(r)
        used += w
    return keep


def _risks_slide(d: dict):
    """The agency risks slide (presented, before the investment and the ask): named risks, each with its mitigation, as cards.
    Built only from stage d's ``risks`` (``[{risk, mitigation, refs, basis}]``), whole risks within the slide's word budget and at
    most four (a card each). With none written, a labelled placeholder asks the person: the code never writes a risk itself."""
    budget = spec.SLIDE_TYPES["risks"]["words"]
    rows = [x for x in d.get("risks") or [] if isinstance(x, dict) and str(x.get("risk") or "").strip() and str(x.get("mitigation") or "").strip()]
    rows = _fit_rows(rows, budget, lambda x: len(str(x["risk"]).split()) + len(str(x["mitigation"]).split()))[:4]
    if not rows:
        return _slide("risks", "What could go wrong, and what we would do about it",
                      [{"kind": "bullets", "items": [{"text": _placeholder("risks and mitigations", "the named risks to this plan and what we would do about each",
                                                                         "the risks the client already sees, and who would own each"), "human": True}]}],
                      status="needs_human")
    refs = sorted({r for x in rows for r in x.get("refs") or []})
    return _slide("risks", d.get("risks_title") or "What could go wrong, and what we would do about it",
                  [{"kind": "kv", "items": [[str(x["risk"]).strip(), str(x["mitigation"]).strip()] for x in rows], **({"refs": refs} if refs else {})}],   # no block basis: a figure in a risk is traced like any other
                  claims=[{"text": str(x["risk"]).strip(), "refs": list(x.get("refs") or []), "basis": x.get("basis") or ("sourced" if x.get("refs") else "proposal")} for x in rows],
                  status="drafted")


def _competition_slide(d: dict):
    """The agency competition slide: the alternatives the client could pick instead (named in the inputs) and the plan to win each.
    Built only from stage d's ``competition.alternatives`` (``[{name, why_chosen, how_we_win, refs}]``), keeping those that cite an
    input; the optional ``plan`` line follows. When the inputs name no alternative, a labelled placeholder asks the person."""
    comp = d.get("competition") if isinstance(d.get("competition"), dict) else {}
    budget = spec.SLIDE_TYPES["competition"]["words"]
    alts = [a for a in comp.get("alternatives") or [] if isinstance(a, dict) and str(a.get("name") or "").strip() and a.get("refs")
            and str(a.get("why_chosen") or "").strip() and str(a.get("how_we_win") or "").strip()]
    alts = _fit_rows(alts, budget, lambda a: sum(len(str(a[k]).split()) for k in ("name", "why_chosen", "how_we_win")))[:4]
    if not alts:
        return _slide("competition", "What else you could choose, and why you would choose us",
                      [{"kind": "bullets", "items": [{"text": _placeholder("the alternatives", "the options the client could pick instead of us, and the plan to win against each",
                                                                         "which alternatives the client is weighing"), "human": True}]}],
                      status="needs_human")
    rows = [["The alternative", "Why you might pick it", "How we win"]] + [[str(a["name"]).strip(), str(a["why_chosen"]).strip(), str(a["how_we_win"]).strip()] for a in alts]
    refs = sorted({r for a in alts for r in a["refs"]})
    blocks = [{"kind": "table", "rows": rows, "refs": refs, "compare": True}]
    claims = [{"text": str(a["name"]).strip() + ": " + str(a["why_chosen"]).strip(), "refs": list(a["refs"]), "basis": "sourced"} for a in alts]
    claims += [{"text": str(a["how_we_win"]).strip(), "refs": [], "basis": "proposal"} for a in alts]
    plan = str(comp.get("plan") or "").strip()
    if plan and sum(len(str(c).split()) for r in rows for c in r) + len(plan.split()) <= budget:
        blocks.append({"kind": "callout", "text": plan, "basis": "proposal"})
        claims.append({"text": plan, "refs": [], "basis": "proposal"})
    return _slide("competition", comp.get("title") or "What else you could choose, and why you would choose us", blocks, claims=claims, status="drafted")


def _measurement_plan_slide(d: dict, reqs: list):
    """The agency measurement plan (extends measurement): one row per KPI with its baseline, target, lag and confounders, built only
    from stage d's ``measurement_plan`` (``[{kpi, baseline, target, lag, confounders, refs, basis}]``), whole rows within the
    word budget. A baseline the inputs do not give reads 'None in the brief: set before launch' (as the measurement slide's does).
    None when stage d wrote no plan."""
    budget = spec.SLIDE_TYPES["measurement_plan"]["words"]
    base = lambda m: str(m.get("baseline") or "").strip() or "None in the brief: set before launch"
    cell = lambda m, k: str(m.get(k) or "").strip() or "To agree"
    rows = [m for m in d.get("measurement_plan") or [] if isinstance(m, dict) and str(m.get("kpi") or "").strip()]
    rows = _fit_rows(rows, budget, lambda m: sum(len(c.split()) for c in (str(m["kpi"]), base(m), cell(m, "target"), cell(m, "lag"), cell(m, "confounders"))))
    if not rows:
        return None
    table = [["KPI", "Baseline", "Target", "Lag", "Confounders"]] + [[str(m["kpi"]).strip(), base(m), cell(m, "target"), cell(m, "lag"), cell(m, "confounders")] for m in rows]
    refs = sorted({r for m in rows for r in m.get("refs") or []})
    return _slide("measurement_plan", d.get("measurement_plan_title") or "How each number is read, and what else could move it",
                  [{"kind": "table", "rows": table, "refs": refs + [r["ref"] for r in reqs if r["kind"] == "objective"]}],
                  claims=[{"text": str(m["kpi"]).strip() + " target " + cell(m, "target"), "refs": list(m.get("refs") or []),
                           "basis": m.get("basis") or ("sourced" if m.get("refs") else "proposal")} for m in rows], status="drafted")


def criterion_budgets(scoring: list) -> dict:
    """The word budget of the written answer to each scored criterion, ``{criterion: words}``: the criterion's weight's share of
    spec.ANSWER_WORDS_TOTAL (equal shares for a criterion whose weight the buyer does not state), never under spec.ANSWER_WORDS_MIN,
    and never past the buyer's own limit for it (a page limit counts spec.WORDS_PER_PAGE words a page; a word limit is the limit).
    The heaviest criterion gets the most words (the cap aside)."""
    num = lambda v: (lambda m: float(m.group(1)) if m else 0.0)(re.search(r"(\d+(?:\.\d+)?)", str(v or "")))
    names = [str(c.get("criterion")) for c in scoring if c.get("criterion")]
    w = {str(c["criterion"]): num(c.get("weight")) for c in scoring if c.get("criterion")}
    known = [v for v in w.values() if v > 0]
    fill = (sum(known) / len(known)) if known else 1.0
    w = {k: (v if v > 0 else fill) for k, v in w.items()}
    total = sum(w.values()) or 1.0
    out = {}
    for c in scoring:
        name = str(c.get("criterion") or "")
        if not name or name not in names:
            continue
        n = max(spec.ANSWER_WORDS_MIN, round(spec.ANSWER_WORDS_TOTAL * w[name] / total))
        lim = str(c.get("page_limit") or "")
        pages, wds = re.search(r"(\d+(?:\.\d+)?)\s*pages?", lim, re.I), re.search(r"(\d+)\s*words?", lim, re.I)
        cap = int(wds.group(1)) if wds else int(float(pages.group(1)) * spec.WORDS_PER_PAGE) if pages else None
        out[name] = min(n, cap) if cap else n
    return out


def _criterion_slides(st: dict, scoring: list) -> list:
    """One ``criterion_answer`` slide per scored criterion that has a recorded written answer (``st['d_criteria']['answers']``, one
    model call per criterion), in the buyer's order. The slide holds the answer's points, whole, within the criterion's word budget
    (criterion_budgets; what does not fit is kept in the notes, not shown). An answer that cites nothing it could use, or has no
    points, is a labelled placeholder (the person supplies it). Each slide records ``criterion`` and ``budget``."""
    answers = {str(x.get("criterion")): x for x in (st.get("d_criteria") or {}).get("answers") or [] if isinstance(x, dict) and x.get("criterion")}
    budgets = criterion_budgets(scoring)
    out = []
    for c in scoring:
        name, ans = str(c.get("criterion") or ""), answers.get(str(c.get("criterion") or ""))
        if not ans:
            continue
        budget = budgets.get(name, spec.SLIDE_TYPES["criterion_answer"]["words"])
        pts = [{"text": str(p["text"]).strip(), "refs": list(p.get("refs") or []), "basis": "sourced" if p.get("refs") else "opinion"}   # a point citing nothing is an opinion: its figures are still traced
               for p in ans.get("points") or [] if isinstance(p, dict) and str(p.get("text") or "").strip()]
        shown = _fit_rows(pts, budget, lambda p: len(p["text"].split()))
        if shown and sum(len(p["text"].split()) for p in shown) > budget:
            shown = []   # one point alone is past the budget: say so in the notes, never cut it
        title = ans.get("title") or name
        if not shown:
            sl = _slide("criterion_answer", title,
                        [{"kind": "bullets", "items": [{"text": _placeholder(name, str(ans.get("needs") or "the written answer to this criterion, from the agency's own material"),
                                                                             "what the agency has that answers this criterion"), "human": True}]}],
                        status="needs_human", label=name[:80])
        else:
            left = pts[len(shown):]
            sl = _slide("criterion_answer", title, [{"kind": "bullets", "items": shown}], claims=pts,
                        status="from_source" if all(p["refs"] for p in shown) else "drafted", label=name[:80],
                        notes=f"Written answer to '{name}' ({c.get('weight', '')}), budget {budget} words." + (f" {len(left)} further point(s) did not fit and are in the written response: " + " | ".join(p['text'] for p in left) if left else ""))
        sl["criterion"], sl["budget"] = name, budget
        out.append(sl)
    return out


def build(inp, st: dict, *, client: str, project: str, agency: str = "[Agency]", fmt: str = "pitch", fit: dict | None = None,
          profile: dict | None = None) -> dict:
    """Build the deck dict. ``st`` holds stage outputs keyed a, b, c, d (any may be absent);
    ``fmt``: spec.FORMATS, the agency pitch (default) or the full deck; ``fit``: the fit judge's
    verdicts, which decide the evidence a pitch presents; ``profile``: a deck type (profiles.load).
    With none, or an ``arrange: legacy`` one, the deck is built exactly as before types existed; an
    ``arrange: spine`` one orders and filters the slides by its spine (_arrange_spine)."""
    _intake_apply(inp, st)
    st = _normalize(st)
    a, b, c, d = st.get("a") or {}, st.get("b") or {}, st.get("c") or {}, st.get("d") or {}
    if not d.get("how_it_answers") and isinstance(d.get("answers_objection"), dict):   # a live stage d's shape
        d = {**d, "how_it_answers": d["answers_objection"].get("how", "")}
    reqs = a.get("requirements") or []
    R = Resolver(inp, reqs)
    S = []  # ordered slides

    # 1. Title
    S.append(_slide("title", f"{client}: {project}",
                    [{"kind": "text", "text": f"A response from {agency}"},
                     {"kind": "text", "text": _placeholder("presenter and date", "presented by the account lead and planner", "who presents, and the date"), "human": True}],
                    status="needs_human"))

    # 2. Brief restated
    items = _objective_items(inp, reqs)
    ob = _objective_slide(inp, items)
    if ob:   # 1b. Objective: the number that has to move, at slide 2 (the read-back of the whole brief stays in the appendix)
        S.append(ob)
    S.append(_slide("brief_restated", "What you asked us to do, in your words",
                    [{"kind": "bullets", "items": items},
                     {"kind": "callout", "text": "Success: " + (b.get("from_to", {}).get("to") or _brief_text(inp, "objectives")),
                      "refs": ["brief:objectives.attitudinal"]}],
                    status="from_source"))

    # 2b. The written answers, one per scored criterion (a type whose spine holds ``criterion_answer``: the tender response)
    if profile and "criterion_answer" in profile["spine"]:
        S += _criterion_slides(st, a.get("scoring") or [])

    # 3. Scoring (tenders only): the client's criteria as the deck's map; rows filled once numbered
    if a.get("scoring"):
        S.append(_slide("scoring", "Your criteria, and where this presentation answers each",
                        [{"kind": "table", "rows": [], "refs": [s["ref"] for s in a["scoring"]]},
                         {"kind": "callout", "text": "Only the written response boxes are scored. This deck is the presentation: everything that must score is also in the written response.",
                          "refs": [r["ref"] for r in a.get("rules", [])], "internal": True}],
                        status="from_source",
                        notes="Minimum scores and page limits: " + "; ".join(f"{s['criterion']}: min {s['min']}, {s['page_limit']}" for s in a["scoring"])))

    # 4. Real question
    if b.get("reframe"):
        rf = b["reframe"]
        S.append(_slide("real_question", rf["title"], [{"kind": "statement", "text": rf["line"]}], claims=rf.get("claims"), status="drafted"))

    # 5. Gap chart (only with numeric evidence)
    gc = b.get("gap_chart")
    if gc and gc.get("series") and all(R.kind(s["ref"]) in ("docfig", "fact") for s in gc["series"]):
        S.append(_slide("chart", gc["title"],
                        [{"kind": "chart", "chart": {"type": "bar", "series": gc["series"], **({"hero": gc["hero"]} if gc.get("hero") else {})}},
                         {"kind": "text", "text": gc["takeaway"], "refs": gc.get("takeaway_refs", [])}],
                        claims=[{"text": gc["takeaway"], "refs": gc.get("takeaway_refs", []), "basis": "sourced"}],
                        status="from_source", visual={"kind": "chart"}))

    # 6. Barrier + insight
    if b.get("barrier"):
        br = b["barrier"]
        blocks = [{"kind": "bullets", "items": [{"text": p["text"], "refs": p["refs"]} for p in br["points"]]}]
        if br.get("chart") and br["chart"].get("series") and all(R.kind(s["ref"]) in ("docfig", "fact") for s in br["chart"]["series"]):
            blocks.insert(0, {"kind": "chart", "chart": {"type": "bar", "title": br["chart"]["title"], "series": br["chart"]["series"]}})
        S.append(_slide("chart", br["title"], blocks, claims=br["points"], status="drafted", visual={"kind": "chart"}))
    ins = b.get("insight") or {}
    built = _insight(b, st.get("insight_judge"), inp)
    insight_meta = {}
    if built:   # three candidates, the chosen one as the three-line truth (DECK-CRAFT-PLAN 3.3)
        S.append(built[0])
        insight_meta = {"insight": built[1], "insight_candidates": built[2]}   # candidates for Gate 1 (the person picks, edits or retries)
    else:
        S.append(_slide("insight", ins.get("title") or "The insight",
                        [{"kind": "quote", "text": ins.get("human_truth") or _brief_text(inp, "insight"),
                          **({"refs": ins["human_truth_refs"]} if ins.get("human_truth_refs") else {"basis": "creative"})},
                         {"kind": "text", "text": _brief_text(inp, "insight", "To agree."), "refs": ["brief:insight"]},
                         {"kind": "bullets", "items": [{"text": e["text"], "refs": e["refs"]} for e in ins.get("evidence", [])]}],
                        claims=ins.get("evidence"), status="drafted",
                        notes=ins.get("note", "")))

    # 7. Audience
    au = b.get("audience") or {}
    S.append(_slide("audience", au.get("title") or "Who we are talking to",
                    [{"kind": "text", "text": au.get("primary") or _brief_text(inp, "audience"), "refs": au.get("refs", ["brief:audience"])},
                     {"kind": "text", "text": au.get("two_halves", "")},
                     *[{"kind": "quote", "text": v["text"], "refs": v["refs"]} for v in au.get("voices", []) if v.get("refs")],
                     {"kind": "card", "title": "Who the work is written for", "text": f"{au['persona']['name']}. {au['persona']['line']}"} if au.get("persona") else {"kind": "text", "text": ""},
                     {"kind": "small", "text": au.get("also", "")}],
                    status="drafted"))

    # 8. Proposition
    pr = b.get("proposition") or {}
    smp = _brief_text(inp, "smp", "To agree.")
    rtb_items = [{"text": r["text"], "refs": r["refs"]} for r in pr.get("rtbs", [])] or \
                [{"text": t, "refs": ["brief:reasons_to_believe"]} for t in ((inp.brief.get("reasons_to_believe") or {}).get("value") or [])]
    ft = b.get("from_to") or {}
    blocks = []   # the single thought is the slide's title (an action title, not a label)
    if ft:
        blocks.append({"kind": "fromto", "from": ft["from"], "to": ft["to"], "refs": ft.get("refs", [])})
    blocks.append({"kind": "bullets", "title": "Why they will believe it", "items": rtb_items})
    if b.get("objection") and not d.get("how_it_answers"):   # else the idea slide answers it (said once)
        blocks.append({"kind": "small", "text": f"The objection it must beat: {b['objection']['text']} {b['objection']['answer']}"})
    S.append(_slide("proposition", smp if smp != "To agree." else "The single thought", blocks, claims=rtb_items, status="drafted"))
    S.append(_competition_slide(d))   # the alternatives the client could pick, and the plan to win (a placeholder when the inputs name none)

    # 9. Territories
    for t in c.get("territories", []):
        S.append(_slide("territory", f"Territory: {t['name']}",
                        [{"kind": "statement", "text": t["thought"], "basis": "creative"},
                         {"kind": "kv", "items": [["Why it fits", t["why"]], ["Mood", t["mood"]], ["Risks", t["risks"]]], "basis": "creative"},
                         {"kind": "sketch", "text": t["sketch"], "basis": "creative"}],
                        claims=[{"text": t["thought"], "refs": [], "basis": "creative"}], status="drafted",
                        visual={"kind": "image_prompt", "prompt": f"Mood frame for '{t['name']}': {t['mood']}", "status": "illustrative, not final"},
                        label=f"Territory {t['name']}"))
    if c.get("territories"):
        rk = c.get("ranking") or {}
        names = {t["id"]: t["name"] for t in c["territories"]}
        named = lambda txt: re.sub(r"\b(" + "|".join(map(re.escape, names)) + r")\b", lambda m: f"'{names[m.group(1)]}'", txt)
        rows = [["Territory", "Why (or why not)"]] + [[names[tid], named(rk.get("reasons", {}).get(tid, ""))] for tid in rk.get("order", [])]
        chosen = next((t for t in c["territories"] if t["id"] == c.get("chosen")), c["territories"][0])
        S.append(_slide("territory_choice", f"We recommend '{chosen['name']}'",
                        [{"kind": "table", "rows": rows},
                         {"kind": "small", "text": f"Chosen by: {c.get('chosen_by', 'to confirm')}. Ranked by: {rk.get('by', 'to confirm')}.", "basis": "meta", "internal": True}],
                        claims=[{"text": "Recommendation", "refs": [], "basis": "opinion"}], status="drafted"))

    # 10. Idea
    if d.get("campaign_line"):
        S.append(_slide("idea", d["campaign_line"],
                        [{"kind": "statement", "text": d["idea"]}, {"kind": "text", "text": d.get("how_it_answers", "")}],
                        claims=[{"text": d["idea"], "refs": [], "basis": "creative"}], status="drafted"))
    # 11. Executions
    for x in d.get("executions", []):
        S.append(_slide("execution", x["channel"][:1].upper() + x["channel"][1:],
                        [{"kind": "text", "text": "Role: " + x["role"]},
                         {"kind": "copy", "lines": x["copy"], "answer": x["answer"], "basis": "creative"}],
                        claims=[{"text": " / ".join(x["copy"]), "refs": [], "basis": "creative"}], status="drafted",
                        visual=x.get("visual"), label=f"Execution {x['channel'][:60]}"))
    # 12. Channel roles
    if d.get("channel_roles"):
        rows = [["Channel", "Its one job"]] + [[r["channel"], r["role"]] for r in d["channel_roles"]]
        S.append(_slide("channel_roles", "Each channel has one job", [{"kind": "table", "rows": rows, "refs": [r["ref"] for r in reqs if r["kind"] in ("scope", "objective", "audience")]}], status="drafted",
                        notes="Scope check: the tender lists paid social, search, programmatic, broadcast radio and video, outdoor and print."))

    # 12b. Innovation and impact: what makes the plan work harder than its media list
    inn = d.get("innovation") or {}
    if inn.get("points"):
        S.append(_slide("innovation", inn["title"],
                        [{"kind": "bullets", "items": [{"text": x["text"], "refs": x.get("refs", []), "basis": x.get("basis", "proposal")} for x in inn["points"]]}],
                        claims=[{"text": x["text"], "refs": x.get("refs", []), "basis": x.get("basis", "proposal")} for x in inn["points"]],
                        status="drafted"))

    # 13. Guardrails (category safety + legal lines + tone)
    S.append(_guardrails(inp, st))

    # 14. Measurement
    if d.get("measurement"):
        base = lambda m: m.get("baseline") or "None in the brief: set before launch"
        rows = [["What we measure", "Baseline", "How"]] + [[m["kpi"], base(m), m.get("how", "")] for m in d["measurement"]]
        refs = sorted({r for m in d["measurement"] for r in m.get("refs", [])})
        S.append(_slide("measurement", d.get("measurement_title") or "How we will know it worked",
                        [{"kind": "table", "rows": rows, "refs": refs + [r["ref"] for r in reqs if r["kind"] == "objective"]}],
                        claims=[{"text": m["kpi"] + " baseline " + base(m), "refs": m.get("refs", []), "basis": m.get("basis", "sourced") if m.get("refs") else "proposal"} for m in d["measurement"]],
                        status="drafted"))
    mp = _measurement_plan_slide(d, reqs)   # 14b. the plan behind the measures: baseline, target, lag, confounders
    if mp:
        S.append(mp)
    # 15. Process
    if d.get("process"):
        S.append(_slide("process", "How we would run it with you",
                        [{"kind": "steps", "items": [[p["step"], p["text"]] for p in d["process"]], "basis": "proposal"}], status="drafted"))
    elif profile and profile["arrange"] == "spine" and "process" in profile["spine"] and not profiles.runs(profile, "d"):
        # a type that runs no stage d (a credentials deck) still shows how we work: a labelled placeholder a person fills
        S.append(_slide("process", "How we would work with you",
                        [{"kind": "bullets", "items": [
                            {"text": _placeholder(what, prop, confirm), "human": True} for what, prop, confirm in (
                                ("first weeks", "how we would start and who leads each step", "the first steps and the people who lead them"),
                                ("working rhythm", "how often we meet and who the client's one contact is", "the meeting rhythm and the named contact"),
                                ("how we decide", "how we bring the client into decisions", "who signs off at each step"))]}],
                        status="needs_human"))
    # 16. Timeline
    if d.get("timeline"):
        S.append(_slide("timeline", "From appointment to evaluation",
                        [{"kind": "steps", "items": [[t["phase"], t["when"]] for t in d["timeline"]], "refs": sorted({r for t in d["timeline"] for r in t.get("refs", [])})}],
                        claims=[{"text": t["when"], "refs": t.get("refs", []), "basis": t.get("basis", "sourced")} for t in d["timeline"]],
                        status="drafted"))
    # 16b. Risks: presented, before the investment and the ask (the deck does not end on them)
    S.append(_risks_slide(d))
    # 17-20. Human-only
    budget = _brief_text(inp, "budget_scope", "")
    inv_blocks = [{"kind": "text", "text": "Budget given: " + (budget or "not given"), "refs": ["brief:budget_scope"] if budget else []}]
    inv_blocks.append({"kind": "bullets", "items": [
        {"text": _placeholder("option A", "a working split of fees, production and media", "the split, from the agency's rate card"), "human": True},
        {"text": _placeholder("option B", "a media-weighted version", "whether the client wants a lean or a heavier option"), "human": True}]})
    S.append(_slide("investment", "Investment: options to agree", inv_blocks, status="needs_human"))
    S.append(_slide("team", "The team you would work with",
                    [{"kind": "bullets", "items": [{"text": _placeholder(role, "a named person", "name and one-page CV"), "human": True}
                                                   for role in ["project lead", "strategic planner", "creative lead", "digital lead", "media planning and buying lead"]]}],
                    status="needs_human"))
    S.append(_slide("credentials", "Work like this we have done before",
                    [{"kind": "bullets", "items": [{"text": _placeholder("case study 1", "a comparable integrated campaign with outcomes", "which campaign, its results and a referee"), "human": True},
                                                   {"text": _placeholder("case study 2", "a second comparable integrated campaign", "which campaign, its results and a referee"), "human": True}]}],
                    status="needs_human"))
    S.append(_slide("next_step", "What we would like to agree today",
                    [{"kind": "bullets", "items": [{"text": f"Agree '{d['campaign_line'].rstrip('.')}' as the campaign platform" if d.get("campaign_line") else "Agree the campaign platform", "basis": "proposal"},
                                                   {"text": _placeholder("decision date", "a date for the decision", "the date the client will decide"), "human": True}]}],
                    status="needs_human"))
    # 21. Questions
    qs = list(dict.fromkeys(q["question"] for q in inp.open_questions if q.get("question")))
    S.append(_slide("questions", "Questions we would settle in the first fortnight",
                    [{"kind": "bullets", "items": [{"text": q, "basis": "meta"} for q in qs[:10]]}], status="from_source",
                    notes=f"{len(qs)} open questions from the brief; {max(0, len(qs) - 10)} more in the brief itself."))

    _fill_human_only(S, inp)   # what the person supplied (answers to supply cards, their own documents) fills what a model never invents
    meta = {"client": client, "project": project, "agency": agency, "kind": "agency", "format": fmt,
            "stages": {k: (v or {}).get("produced_by") for k, v in st.items()}, **insight_meta}
    if isinstance(d.get("chain"), dict) and any(str(d["chain"].get(k) or "").strip() for k in CHAIN_PHRASES):
        meta["chain"] = d["chain"]   # stage d's written chain: the phrases validate.chain_links finds on the slides they name
    return _complete(S, reqs, R, inp, meta, fmt, fit, scoring=a.get("scoring") or [], messages=d.get("messages") or [], territories=c,
                     profile=profile, rules=a.get("rules") or [])


def _complete(S, reqs, R, inp, meta, fmt, fit, scoring=None, messages=None, territories=None, profile=None, rules=None) -> dict:
    """The work every deck kind shares once its slides exist: requirement mapping, the pitch arrangement,
    numbering, the requirement trace, the sources appendix and the scoring map. ``profile`` (a deck type)
    records ``built_from.type``; a spine profile also arranges the slides, records ``meta.profile``,
    ``meta.length`` (its limit, or the buyer's stated one) and ``meta.weights`` (the buyer's, or our default)."""
    inp.built_from = intake.tier(inp)
    if profile:
        inp.built_from = {**inp.built_from, "type": profile["id"]}
    _label_thin(S, inp)
    spine = bool(profile and profile["arrange"] == "spine")
    sketch = _sketch(inp)
    length = _length_for(profile or profiles.default_for_kind(meta.get("kind", "agency")), scoring or [], rules or [], inp, sketch)
    limited = length["source"] != "profile"   # a stated limit or a sketch holds the presented story to its length
    if spine:
        meta = {**meta, "profile": {"id": profile["id"], "label": profile["label"]},
                "length": length, "weights": profiles.weights(profile, scoring)}
    elif limited:
        meta = {**meta, "length": length}
    if sketch:
        meta = {**meta, "sketch": {"label": spec.SKETCH_LABEL, "tier": inp.built_from["tier"], "max_slides": spec.SKETCH_MAX_SLIDES,
                                   "why": "built from a prompt, or a prompt and a little document text, alone: a sketch to check and extend"}}
    cap = length["max_slides"] if limited and fmt == "pitch" else None
    deck = {"meta": {**meta, "built_at": _dt.datetime.now().isoformat(timespec="seconds"),
                     "research_doc_id": inp.research_doc_id, "coverage": inp.coverage, "built_from": inp.built_from},
            "requirements": {r["id"]: r for r in reqs}, "scoring": scoring or [], "messages": messages or [],
            "territories": territories or {}, "slides": {}, "order": []}
    if fit:
        deck["fit"] = fit

    # Requirement mapping, trace and sources slides go last (they read the slides above).
    for r in reqs:
        homes = r.get("homes") or REQ_OVERRIDE.get(r["id"]) or REQ_HOME.get(r["kind"], [])
        for sl in S:
            if sl["type"] in homes and r["id"] not in sl["requirements"]:
                sl["requirements"].append(r["id"])
    if spine:   # after mapping, so a slide dropped by the profile has already passed its requirements to the others
        S = _arrange_spine(S, profile, {v["title"] for v in (fit or {}).get("verdicts", []) if v["verdict"] == "supported"},
                           routes_asked(reqs), messages or [], scoring or [], fmt, cap)
    elif fmt == "pitch":   # after mapping, so merged slides carry both slides' requirements
        S = _arrange_pitch(S, {v["title"] for v in (fit or {}).get("verdicts", []) if v["verdict"] == "supported"}, routes_asked(reqs), messages or [], cap)
    if sketch:   # the cover says so, with a fixed label (like the DRAFT mark: no input words)
        cover = next((x for x in S if x["type"] == "title"), None)
        if cover:
            cover["blocks"] = cover["blocks"] + [{"kind": "small", "text": spec.SKETCH_LABEL, "basis": "meta"}]
    for i, sl in enumerate(S, 1):
        sid = f"s{i:02d}"
        deck["slides"][sid] = sl
        deck["order"].append(sid)
    if reqs:
        chunk = 14
        parts = [reqs[i:i + chunk] for i in range(0, len(reqs), chunk)]
        for i in range(len(parts)):
            _add(deck, None)  # reserve numbers first so the trace can cite later slides
        base = len(deck["order"]) - len(parts)
        for i, part in enumerate(parts):
            sl = _trace_slide(deck, part)
            if i:
                sl["title"] += ", continued"
            deck["slides"][deck["order"][base + i]] = sl
    _add(deck, _sources_slide(deck, R))
    _fill_scoring(deck)
    return deck


def build_investor(inp, st: dict, *, client: str, project: str, agency: str = "[Agency]", fmt: str = "pitch", fit: dict | None = None,
                   profile: dict | None = None) -> dict:
    """An investor (seed) deck from stage i: the cover, the sections in the order the story gives them,
    then a review-only appendix of brief/document conflicts and open questions. The brief's mandatories
    are its requirements, each answered by the slide types spec.INVESTOR_HOME names."""
    _intake_apply(inp, st)
    st = _normalize(st)
    i = st.get("i") or {}
    R = Resolver(inp, [])
    reqs = []
    for n, m in enumerate((inp.brief.get("mandatories") or {}).get("value") or [], 1):
        if re.match(r"\s*(avoid|never|do not|don't|if any|if the)\b", str(m), re.I):   # a rule for the whole deck, not a slide
            reqs.append({"id": f"m{n}", "kind": "rule", "text": str(m), "ref": "brief:mandatories"})
            continue
        homes = next((h for pat, h in spec.INVESTOR_HOME if re.search(pat, str(m), re.I)), ())
        reqs.append({"id": f"m{n}", "kind": "mandatory", "text": str(m), "ref": "brief:mandatories", "homes": list(homes)})
    R = Resolver(inp, reqs)
    cv = i.get("cover") or {}
    S = [_slide("title", cv.get("title") or client,
                [{"kind": "text", "text": cv.get("subtitle", ""), "refs": cv.get("refs", [])},
                 {"kind": "small", "text": cv.get("line", ""), "refs": cv.get("refs", [])}], status="drafted")]
    for sec in i.get("sections") or []:
        t = sec.get("type")
        if t not in spec.SLIDE_TYPES or t not in spec.INVESTOR_TYPES:
            continue
        blocks, claims = [], []
        if sec.get("statement"):
            blocks.append({"kind": "statement", "text": sec["statement"], "basis": "creative" if t == "close" else None})
        if sec.get("stats"):
            items = [{"value": str(x.get("value", "")), "label": x.get("label", ""), "refs": x.get("refs", [])} for x in sec["stats"][:3]]
            blocks.append({"kind": "stats", "items": items})
            claims += [{"text": f"{x['value']} {x['label']}", "refs": x["refs"], "basis": "sourced" if x["refs"] else "opinion"} for x in items]
        if sec.get("steps"):
            blocks.append({"kind": "steps", "items": [list(x)[:2] for x in sec["steps"] if len(x) >= 2]})
        if sec.get("points"):
            pts = [{"text": x["text"], "refs": x.get("refs", []), "basis": x.get("basis") or ("sourced" if x.get("refs") else "opinion")} for x in sec["points"]]
            blocks.append({"kind": "bullets", "items": pts})
            claims += pts
        if (sec.get("table") or {}).get("rows"):
            blocks.append({"kind": "table", "rows": sec["table"]["rows"], "refs": sec["table"].get("refs", [])})
        for q in sec.get("quotes") or []:
            blocks.append({"kind": "quote", "text": q["text"], **({"refs": q["refs"]} if q.get("refs") else {"basis": "creative"})})
            if q.get("who"):
                blocks.append({"kind": "small", "text": "— " + q["who"], "refs": q.get("refs", [])})
        sl = _slide(t, sec.get("title") or spec.SLIDE_TYPES[t]["section"], blocks, claims=claims,
                    status="from_source" if claims and all(c["refs"] for c in claims) else "drafted")
        if t in GAP_TYPES and not slide_refs(sl):   # only a placeholder: nothing in the inputs states it, so it is a gap, never presented
            sl.update(status="needs_human", label=("Gap to fill: " + sl["section"])[:80],
                      notes="Gap to fill: the inputs state nothing for this slide, so it sits behind the Appendix until the founders answer its question.")
        S.append(sl)
    if i.get("conflicts"):
        rows = [["Where", "The brief says", "The documents say", "The deck uses"]] + [[c.get("topic", ""), c.get("brief", ""), c.get("documents", ""), c.get("used", "")] for c in i["conflicts"]]
        S.append(_slide("conflicts", "Where the brief and the company's documents disagree",
                        [{"kind": "table", "rows": rows, "small": True, "basis": "meta", "internal": True}], status="needs_human",
                        notes="Re-run the brief tool with the company's documents as material to bring the brief in line."))
    _fill_human_only(S, inp)   # a gap the person has since answered (answer:<qid>) is sourced and presented again
    gaps = [c["text"] for c in intake.gap_questions([x["type"] for x in S if _is_gap(x)])]
    qs = list(dict.fromkeys([q for q in i.get("open_questions") or [] if q] + [q["question"] for q in inp.open_questions if q.get("question")] + gaps))
    if qs:
        S.append(_slide("questions", "Questions only the founders can answer", [{"kind": "bullets", "items": [{"text": q, "basis": "meta"} for q in qs[:10]]}], status="from_source"))
    meta = {"client": client, "project": project, "agency": agency, "kind": "investor", "format": fmt,
            "stages": {k: (v or {}).get("produced_by") for k, v in st.items()}}
    return _complete(S, reqs, R, inp, meta, fmt, fit, profile=profile)


def criteria_coverage(deck) -> list:
    """Per scored criterion: its weight, the slides answering it, and concepts no slide answers.

    A criterion's parts (or its own text) are read for the concepts in spec.CRITERIA_HOME; each
    concept is answered by any slide of a home type (that also says ``mention``, when set)."""
    out = []
    for c in deck.get("scoring") or []:
        texts = [p["text"] for p in c.get("parts") or []] or [c["criterion"]]
        sids, missing = [], []
        for t in texts:
            for pat, homes, mention, only in spec.CRITERIA_HOME:
                m = re.search(rf"\w*(?:{pat})\w*", t, re.I)
                if not m:
                    continue
                hit = [sid for sid in deck["order"] if deck["slides"][sid]["type"] in homes
                       and (not mention or mention in str(deck["slides"][sid]["blocks"]).lower())]
                if hit:
                    sids += [x for x in hit if x not in sids]
                elif m.group(0).lower() not in missing:
                    missing.append(m.group(0).lower())
                if only:
                    break
        own = [sid for sid in deck["order"] if deck["slides"][sid].get("criterion") == c["criterion"]]   # a written answer to this criterion answers all of it
        if own:
            sids, missing = sids + [x for x in own if x not in sids], []
        out.append({"criterion": c["criterion"], "weight": c["weight"], "slides": sorted(sids), "missing": missing})
    return out


def _fill_scoring(deck):
    """Fill the scoring slide's table: each criterion, its weight and the slides that answer it."""
    sid = next((x for x in deck["order"] if deck["slides"][x]["type"] == "scoring"), None)
    if not sid:
        return
    num = {x: i for i, x in enumerate(deck["order"], 1)}
    from . import validate   # late: validate imports this module
    share = {r["criterion"]: r for r in validate.weight_share_rows(deck)}
    rows = [["What you score", "Weight", "Share of our words", "Where we answer it"]]
    for c in criteria_coverage(deck):
        where = ", ".join(str(num[x]) for x in c["slides"])
        if c["missing"]:
            where = (where + "; " if where else "") + "not yet answered: " + ", ".join(c["missing"])
        sh = share.get(c["criterion"])
        rows.append([c["criterion"], c["weight"], f"{sh['words_share'] * 100:.0f}%" if sh else "", where])
    deck["slides"][sid]["blocks"][0].update(rows=rows, basis="meta")   # a deck map, like the trace


def routes_asked(reqs: list) -> int:
    """How many creative routes the client's requirements ask to see (2 directions, three concepts...);
    1 when none is stated, the one-recommended-idea default."""
    words = {"two": 2, "three": 3, "four": 4, "2": 2, "3": 3, "4": 4}
    for r in reqs:
        m = re.search(r"\b(two|three|four|[234])\s+(?:creative\s+|strategic\s+)?(?:directions|routes|territories|concepts|platforms|ideas)\b", r.get("text", ""), re.I)
        if m:
            return words[m.group(1).lower()]
    return 1


def _carried(slide: dict, messages: list) -> set:
    """The mandated messages (requirement ids) whose line appears in a slide's blocks."""
    text = spec.norm_text(" ".join(str(v) for b in slide["blocks"] for k, v in b.items() if k in ("text", "answer", "from", "to"))
                          + " " + " ".join(" ".join(map(str, b.get("lines") or [])) for b in slide["blocks"]))
    return {m["req"] for m in messages if any(p in text for p in spec.message_parts(m.get("line", "")))}


def _shown_executions(S: list, messages: list | None) -> list:
    """The executions a pitch presents: at most spec.PITCH_EXECUTIONS of the core (not optional) ones,
    greedily those that carry the most mandated messages not yet carried, kept in story order."""
    execs = [x for x in S if x["type"] == "execution"]
    core = [x for x in execs if not re.search(spec.OPTIONAL, str(x["blocks"][0].get("text", "")))]
    shown, covered = [], set()   # greedily the executions that carry the most mandated messages not yet carried
    for _ in range(min(spec.PITCH_EXECUTIONS, len(core))):
        pool = [i for i in range(len(core)) if all(core[i] is not y for y in shown)]   # by identity: equal slides are still two
        best = core[max(pool, key=lambda i: (len(_carried(core[i], messages or []) - covered), -i))]
        shown.append(best)
        covered |= _carried(best, messages or [])
    shown.sort(key=lambda x: next(i for i, y in enumerate(core) if y is x))
    return shown


def _shown_charts(S: list, supported: set | None) -> list:
    """The charts a pitch presents: the first, plus any the fit judge found supported, up to spec.PITCH_CHARTS."""
    charts = [x for x in S if x["type"] == "chart"]
    shown_charts = ([charts[0]] if charts else []) + [x for x in charts[1:] if x["title"] in (supported or set())]
    return shown_charts[:spec.PITCH_CHARTS]


def _arrange_pitch(S: list, supported: set | None = None, routes: int = 1, messages: list | None = None, limit: int | None = None) -> list:
    """The agency pitch: the presented story (merges applied, team before the ask), an Appendix
    divider, then the backup in story order. Numbering, the trace and footnotes follow this order.
    One recommended idea by default; as many routes as the brief asks for when it asks (routes);
    the presented executions are the ones that carry the most mandated messages (messages). ``limit``
    (a stated limit or a sketch's) moves the least needed slides behind the divider until the story fits (_trim)."""
    by_type = lambda t: next((x for x in S if x["type"] == t), None)
    for keep, into, title in spec.PITCH_MERGES:
        k, m = by_type(keep), by_type(into)
        if k and m:
            k["title"], k["label"] = title, title[:80]
            k["blocks"] = k["blocks"] + [{**b, "title": b.get("title") or m["title"]} if b["kind"] == "bullets" else b for b in m["blocks"]]
            k["claims"] += m["claims"]
            k["requirements"] += [r for r in m["requirements"] if r not in k["requirements"]]
            if m["status"] == "needs_human":
                k["status"] = "needs_human"
            if m.get("supplied"):   # what the person supplied to the absorbed slide still counts as supplied on the merged one
                ks = k.get("supplied")
                k["supplied"] = ({**ks, "refs": sorted(set(ks.get("refs") or []) | set(m["supplied"].get("refs") or []))} if ks else dict(m["supplied"]))
            S = [x for x in S if x is not m]
    shown = _shown_executions(S, messages)
    shown_charts = _shown_charts(S, supported)
    keep = {id(x) for x in shown_charts + shown}   # by identity: two slides can hold equal content
    if routes > 1:   # the client asked to see that many routes: present them, in the ranking's order
        keep |= {id(x) for x in [x for x in S if x["type"] == "territory"][:routes]}
    back = lambda x: ((x["type"] in spec.PITCH_APPENDIX_TYPES and id(x) not in keep) or (x["type"] in ("chart", "execution") and id(x) not in keep) or _is_gap(x))
    story, backup = [x for x in S if not back(x)], [x for x in S if back(x)]
    team, inv = by_type("team"), by_type("investment")
    if team in story and inv in story and story.index(team) > story.index(inv):
        story.remove(team)
        story.insert(story.index(inv), team)
    story, backup = _trim(S, story, backup, limit)
    if not backup:
        return story
    divider = _slide("appendix", "Appendix", [{"kind": "text", "text": "Backup for questions: everything this presentation rests on."}], status="from_source")
    return story + [divider] + backup


def _trim(S: list, story: list, backup: list, limit: int | None) -> tuple:
    """Hold a presented story to ``limit`` slides: while it is longer, the last slide of the first type in
    spec.TRIM_ORDER that the story holds moves behind the divider (the backup keeps the built order). A story
    with nothing left to move stays over the limit, and pitch_length says so. Nothing is reworded or dropped."""
    if not limit:
        return story, backup
    story, backup = list(story), list(backup)
    while len(story) > limit:
        for t in spec.TRIM_ORDER:
            hit = [x for x in story if x["type"] == t]
            if hit:
                story.remove(hit[-1])
                backup.append(hit[-1])
                break
        else:
            break
    at = {id(x): i for i, x in enumerate(S)}
    return story, sorted(backup, key=lambda x: at.get(id(x), len(S)))


_STATED_LIMIT = re.compile(r"\b(\d{1,3})[- ](?:slides?|pages?)\b", re.I)
#: A person's own limit: "N slides" (or "N-slide"), a slide or page limit with its number after it, a number of
#: minutes for the presentation. Pages count only beside a limit word (a "20 page tender" is not a limit on the deck).
_SLIDES_N = re.compile(r"\b(\d{1,3})[- ]slides?\b", re.I)
_LIMIT_THEN_N = re.compile(r"\b(?:slide|page)s?[- ](?:limit|cap|maximum|max)\b\D{0,15}?(\d{1,3})\b", re.I)
_N_PAGES = re.compile(r"\b(\d{1,3})[- ]pages?\b", re.I)
_N_THEN_LIMIT = re.compile(r"\b(\d{1,3})[- ](?:slide|page)s?[- ](?:limit|cap|maximum|max)\b", re.I)
_MINUTES = re.compile(r"\b(\d{1,3})[- ]?minutes?\b", re.I)
_LIMIT_CUE = re.compile(r"\b(?:no more than|not more than|maximum|max|at most|up to|limit(?:ed)?|not exceed\w*|no longer than|within|under|cap)\b", re.I)
#: Words that make a slide count a past or other deck's size rather than a limit.
_PAST_SIZE = re.compile(r"\b(?:was|were|last (?:year|time)|previous(?:ly)?|used to|too (?:long|many))\b", re.I)
#: What follows a slide count that is about the slides' content, not a limit on the deck ("3 slides of evidence").
_SLIDES_ABOUT = re.compile(r"\s*(?:of|on|about|for each|each|apiece)\b", re.I)
_PRESENT_CUE = re.compile(r"\b(?:presentation|presenting|present|pitch|slot|deck|talk|session)\b", re.I)


def _limits_in(text: str, own_words: bool) -> list:
    """Slide limits one text states, as (slides, derived) pairs: ``derived`` is true for a count worked out from minutes. ``own_words`` (the person's prompt or answer): a number
    of slides, a slide or page limit, a page count beside a limit word, minutes of presentation. Otherwise (a document or the
    brief) the same, but only in a sentence that also has a limit word, so a count of slides someone will supply is not a limit.
    Minutes become slides at spec.MINUTES_PER_SLIDE, at least spec.MIN_STATED_SLIDES."""
    out = []
    for sent in re.split(r"(?<=[.!?])\s+|\n+", str(text or "")):
        cue = bool(_LIMIT_CUE.search(sent))
        found = [int(m.group(1)) for m in _N_THEN_LIMIT.finditer(sent)] + [int(m.group(1)) for m in _LIMIT_THEN_N.finditer(sent)]
        if own_words and not _PAST_SIZE.search(sent):   # a past deck's size ("last year it was 40 slides") is not a limit
            found += [int(m.group(1)) for m in _SLIDES_N.finditer(sent)]
        elif cue and not own_words and not re.search(r"\bper\b", sent, re.I):   # a count of slides about something else ("3 slides of evidence per case") is not a limit on the deck
            found += [int(m.group(1)) for m in _SLIDES_N.finditer(sent) if not _SLIDES_ABOUT.match(sent[m.end():])]
        if cue and own_words and re.search(r"\bslides?\b|" + _PRESENT_CUE.pattern, sent, re.I):   # pages count only when the sentence is about the deck ("a tender response within 20 pages" is not)
            found += [int(m.group(1)) for m in _N_PAGES.finditer(sent)]
        out += [(n, False) for n in found if spec.LIMIT_BOUNDS[0] <= n <= spec.LIMIT_BOUNDS[1]]
        if _PRESENT_CUE.search(sent):
            out += [(max(spec.MIN_STATED_SLIDES, int(m.group(1)) // spec.MINUTES_PER_SLIDE), True) for m in _MINUTES.finditer(sent)]
    return out


def stated_limit(inp, scoring: list | None = None, rules: list | None = None) -> dict | None:
    """The tightest limit on the presentation any input states, ``{max_slides, source, derived}`` (``derived``: worked out from minutes), or None. Read from the buyer's
    rules and scored criteria (a rule or page limit that names a deck, presentation or slides), the brief's mandatories,
    the person's prompt and answers, and the documents. The tightest wins, whether it is tighter or looser than the
    profile's default, and ``source`` says where it was read."""
    found = []   # (slides, source, derived from minutes)
    for text in [str(r.get("text", "")) for r in rules or []] + [str(c.get("page_limit", "")) for c in scoring or []]:
        if re.search(r"slides?|presentation|deck", text, re.I):
            found += [(int(m.group(1)), "the buyer's stated limit", False) for m in _STATED_LIMIT.finditer(text)]
    if inp is not None:
        for m in ((inp.brief.get("mandatories") or {}).get("value") or []):
            found += [(n, "the brief's stated limit", d) for n, d in _limits_in(m, False)]
        found += [(n, "the prompt's stated limit", d) for n, d in _limits_in(inp.prompt_text, True)]
        found += [(n, "an answer's stated limit", d) for q in (inp.answers or {}) for n, d in _limits_in(answer_text(inp, q), True)]
        found += [(n, "a document's stated limit", d) for dk in inp.docs.values() for n, d in _limits_in(re.sub(r"\[p\d+\]", " ", dk["text"]), False)]
    found = [f for f in found if f[0] >= 1]
    return None if not found else (lambda f: {"max_slides": f[0], "source": f[1], "derived": f[2]})(min(found, key=lambda f: f[0]))


def _sketch(inp) -> bool:
    """True when the deck is a sketch: built from a prompt alone, or from a prompt and so little document text
    (under spec.SKETCH_DOC_CHARS characters in all) that it is still a prompt in practice."""
    t = intake.tier(inp)["tier"]
    return t == "prompt" or (t == "prompt+documents" and sum(len(d["text"]) for d in inp.docs.values()) < spec.SKETCH_DOC_CHARS)


def _length_for(profile: dict, scoring: list, rules: list, inp=None, sketch: bool = False) -> dict:
    """The presented length a deck is held to: the profile's ``length``, with ``max_slides`` replaced by a limit
    the inputs state for the presentation (stated_limit: the buyer's rules and criteria, the brief, the prompt, the
    answers, the documents) when the profile is ``respect_stated_limit``, and cut to spec.SKETCH_MAX_SLIDES for a
    ``sketch``. ``source`` says which (``profile`` when neither applies)."""
    L = profile["length"]
    out = {"max_slides": L["max_slides"], "minutes": L["minutes"], "source": "profile"}
    if L.get("min_slides"):
        out["min_slides"] = L["min_slides"]
    stated = stated_limit(inp, scoring, rules) if L.get("respect_stated_limit") else None
    if stated and not (stated["derived"] and stated["max_slides"] >= L["max_slides"]):   # an explicit limit is the real one, tighter or looser than our default; one worked out from minutes only ever tightens
        out.update(max_slides=stated["max_slides"], source=stated["source"])
    if sketch and spec.SKETCH_MAX_SLIDES < out["max_slides"]:
        out.update(max_slides=spec.SKETCH_MAX_SLIDES, source="a sketch: built from a short prompt alone")
    if out.get("min_slides", 0) > out["max_slides"]:
        del out["min_slides"]   # a limit under the profile's least wins: the deck cannot be asked to be both
    return out


def _criteria_rank(slide_type: str, scoring: list) -> int | None:
    """The index of the first scored criterion (the buyer's order) whose concepts this slide type answers
    (the same reading as criteria_coverage), or None when none does."""
    for i, c in enumerate(scoring):
        for t in [p["text"] for p in c.get("parts") or []] or [c["criterion"]]:
            for pat, homes, _mention, only in spec.CRITERIA_HOME:
                if not re.search(pat, t, re.I):
                    continue
                if slide_type in homes:
                    return i
                if only:
                    break
    return None


def _slide_rank(slide: dict, scoring: list) -> int | None:
    """The index of the scored criterion a slide answers: its own ``criterion`` (a written answer), else the first criterion its
    type answers (_criteria_rank); None when none."""
    if slide.get("criterion"):
        return next((i for i, c in enumerate(scoring) if c.get("criterion") == slide["criterion"]), None)
    return _criteria_rank(slide["type"], scoring)


def _arrange_spine(S: list, profile: dict, supported: set | None, routes: int, messages: list, scoring: list, fmt: str, limit: int | None = None) -> list:
    """Order and filter slides by a profile. Slides of a type outside ``spine`` and ``appendix`` are dropped
    (a requirement that only they answered is then reported by requirement_map, at the profile's level).
    The presented story follows the spine order (a repeated type keeps its built order); the types in
    ``buyer_order`` are put back into their slots in the buyer's order, the scored criterion each answers
    (_criteria_rank); a type answering no criterion keeps its spine slot. Types in ``appendix`` go behind an Appendix divider, as
    do charts and executions a pitch does not present (_shown_charts, _shown_executions) and routes not asked
    for. Format ``full`` presents everything in spine order and then the appendix types, with no divider.
    A stated limit or a sketch's (``limit``) moves the least needed slides behind the divider (_trim). Words are never
    changed and nothing is truncated: a story still over its limit is reported by pitch_length. Where a scored criterion has a written answer
    (a ``criterion_answer`` slide), the slides whose types answer that criterion (_criteria_rank) go behind the divider in a pitch (the answer is the
    criterion's presented slide; spec.ANSWER_KEEPS never move)."""
    spine, appx = profile["spine"], set(profile.get("appendix") or [])
    S = [x for x in S if x["type"] in spine or x["type"] in appx]
    pitch = fmt == "pitch"
    keep = {id(x) for x in _shown_charts(S, supported) + _shown_executions(S, messages)}
    if routes > 1:
        keep |= {id(x) for x in [x for x in S if x["type"] == "territory"][:routes]}
    answered = {x["criterion"] for x in S if x.get("criterion") and x.get("status") != "needs_human"}   # criteria with a written answer: the answer is their presented slide
    replaced = {id(x) for x in S if answered and x["type"] not in spec.ANSWER_KEEPS and not x.get("criterion")
                and (_criteria_rank(x["type"], scoring) is not None) and scoring[_criteria_rank(x["type"], scoring)].get("criterion") in answered}
    back = lambda x: pitch and ((x["type"] in appx and id(x) not in keep) or (x["type"] in ("chart", "execution") and id(x) not in keep) or id(x) in replaced or _is_gap(x))
    story = [x for x in S if not back(x)]
    backup = [x for x in S if back(x)]
    order_appx = list(profile.get("appendix") or [])
    def pos(x):
        """Sort position: the spine slot; an appendix-only type in the full format goes after the spine, in appendix order;
        in a pitch, a kept appendix-only type sits just after the proposition (or at the end)."""
        if x["type"] in spine:
            return spine.index(x["type"])
        if not pitch:
            return len(spine) + order_appx.index(x["type"])
        return spine.index("proposition") + 0.5 if "proposition" in spine else len(spine)
    story = [x for _, x in sorted(enumerate(story), key=lambda ix: (pos(ix[1]), ix[0]))]
    bo = set(profile.get("buyer_order") or [])
    if bo and scoring:
        slots = [i for i, x in enumerate(story) if x["type"] in bo and _slide_rank(x, scoring) is not None]
        ranked = sorted((story[i] for i in slots), key=lambda x: _slide_rank(x, scoring))   # stable: ties keep spine order
        for i, x in zip(slots, ranked):   # only slides that answer a scored criterion move, and only among their own slots
            story[i] = x
    if pitch:
        story, backup = _trim(S, story, backup, limit)
    if not pitch or not backup:
        return story
    divider = _slide("appendix", "Appendix", [{"kind": "text", "text": "Backup for questions: everything this presentation rests on."}], status="from_source")
    return story + [divider] + backup


def _add(deck, sl):  # sl may be None to reserve a number
    """Append a slide with the next id."""
    sid = f"s{len(deck['order']) + 1:02d}"
    deck["slides"][sid] = sl
    deck["order"].append(sid)


def _first_words(text: str, limit: int = 40) -> str:
    """Whole sentences from the start of a text, up to about ``limit`` words."""
    out = []
    for sent in re.split(r"(?<=[.!?])\s+", str(text).strip()):
        if out and len(" ".join(out + [sent]).split()) > limit:
            break
        out.append(sent)
    return " ".join(out)


def _guardrails(inp, st):
    """What the work must always carry and never do, from the inputs only: the client's mandatories
    and tone (stage a, read from their documents) and the research CLAN's clearance and category-code
    findings (rejected ones excluded). Nothing here comes from outside the brief and the research."""
    reqs = (st.get("a") or {}).get("requirements") or []
    items = [{"text": r["text"], "refs": [r["ref"], "req:" + r["id"]], "basis": "sourced"} for r in reqs if r["kind"] == "mandatory"]
    for f in inp.findings.values():
        if f.get("lens") in ("regulation_clearance", "category_codes") and f.get("status") != "rejected":
            items.append({"text": _first_words(f["statement"]), "refs": [f["id"]], "basis": "sourced"})
    tone = next((r for r in reqs if r["kind"] == "tone"), None)
    blocks = [{"kind": "bullets", "title": "What the work must always carry, and never do", "items": items or [{"text": "The brief and research set no rules here: to agree with the client.", "basis": "opinion"}]}]
    if tone:
        blocks.append({"kind": "small", "text": tone["text"], "refs": [tone["ref"], "req:" + tone["id"]]})
    return _slide("guardrails", "What the work must never do", blocks, status="from_source")

def _trace_slide(deck, reqs):
    """Every requirement and the slide numbers that carry it (validated: none unmapped)."""
    num = {sid: i for i, sid in enumerate(deck["order"], 1)}
    rows = [["Requirement", "Slides"]]
    for r in reqs:
        where = [str(num[sid]) for sid in deck["order"] if deck["slides"][sid] and r["id"] in deck["slides"][sid]["requirements"]]
        rows.append([r["text"], "a rule for the whole deck" if r.get("kind") == "rule" else (", ".join(where) or "NOT MAPPED")])
    return _slide("requirement_trace", "Every requirement, and where this deck answers it",
                  [{"kind": "table", "rows": rows, "small": True, "basis": "meta"}], status="from_source")


def _sources_slide(deck, R):
    """The sources appendix: every source any slide's refs footnote to, numbered as on the slides."""
    keys, labels = [], {}
    for sid in deck["order"]:
        sl = deck["slides"][sid]
        foot = []
        for ref in slide_refs(sl):
            k, lab, url = R.source_key(ref)
            if k == "unknown":
                continue
            if k not in labels:
                keys.append(k)
                labels[k] = lab + (f" {url}" if url else "")
            n = keys.index(k) + 1
            if n not in foot:
                foot.append(n)
        sl["footnotes"] = sorted(foot)
        sl["notes"] = (sl.get("notes", "") + "\n\nEvidence:\n" + "\n".join(R.describe(r) for r in slide_refs(sl))).strip()
    rows = [[f"[{i}]", labels[k]] for i, k in enumerate(keys, 1)]
    return _slide("appendix_sources", "Sources", [{"kind": "table", "rows": [["#", "Source"]] + rows, "small": True, "basis": "meta"}], status="from_source")


def slide_refs(sl) -> list:
    """Every ref on a slide: its claims and its blocks (items, series), in order, unique."""
    out = []
    def add(rs):
        for r in rs or []:
            if r not in out:
                out.append(r)
    for cl in sl.get("claims", []):
        add(cl.get("refs"))
    for bl in sl.get("blocks", []):
        add(bl.get("refs"))
        for it in bl.get("items", []) or []:
            if isinstance(it, dict):
                add(it.get("refs"))
        for s in (bl.get("chart") or {}).get("series", []):
            add([s["ref"]])
    return out


def copy_fields(sl: dict) -> list:
    """(field id, text) for every on-screen field stage e may tighten: block text, list items, key-value
    values, steps, table cells and from/to. Never the title, ad copy, placeholders or agency notes."""
    out = []
    for bi, b in enumerate(sl["blocks"]):
        if b["kind"] in ("copy", "chart") or b.get("human") or b.get("internal"):
            continue
        if str(b.get("text", "")).strip():
            out.append((f"b{bi}", b["text"]))
        for k in ("from", "to"):
            if b.get(k):
                out.append((f"b{bi}.{k}", b[k]))
        for ii, it in enumerate(b.get("items") or []):
            if isinstance(it, dict) and not it.get("human") and it.get("text"):
                out.append((f"b{bi}.i{ii}", it["text"]))
            elif isinstance(it, list) and len(it) == 2:
                out.append((f"b{bi}.i{ii}", it[1]))
        for ri, row in enumerate((b.get("rows") or [])[1:], 1):
            out += [(f"b{bi}.r{ri}.c{ci}", c) for ci, c in enumerate(row) if str(c).strip()]
    return out


def apply_copy(deck: dict, edits: list) -> int:
    """Apply stage e's edits (slide title + field id -> text) to the deck; returns how many applied.
    An edit whose slide title or field no longer exists is skipped (stale), never forced."""
    by_title = {deck["slides"][x]["title"]: deck["slides"][x] for x in deck["order"]}
    n = 0
    for e in edits:
        sl = by_title.get(e.get("slide"))
        valid = dict(copy_fields(sl)) if sl else {}
        if not sl or e.get("field") not in valid or not str(e.get("text", "")).strip():
            continue
        m = re.fullmatch(r"b(\d+)(?:\.(from|to)|\.i(\d+)|\.r(\d+)\.c(\d+))?", e["field"])
        b = sl["blocks"][int(m.group(1))]
        if m.group(2):
            b[m.group(2)] = e["text"]
        elif m.group(3):
            it = b["items"][int(m.group(3))]
            if isinstance(it, dict):
                it["text"] = e["text"]
            else:
                it[1] = e["text"]
        elif m.group(4):
            b["rows"][int(m.group(4))][int(m.group(5))] = e["text"]
        else:
            b["text"] = e["text"]
        n += 1
    return n



# ---------------------------------------------------------------- headline narrowing and the red team (DECK-CRAFT-PLAN 4.2)

#: A narrowed or red-team headline may be at most this many words longer than the one it replaces.
HEADLINE_GROWTH = 3


def _retitle(deck: dict, sid: str, new: str, narrowed: bool = False, reason: str = "") -> None:
    """Set a slide's title and keep the fit verdict that was keyed by the old title in step. If the fit result already holds a
    verdict under the NEW title (the judge was run again), that verdict wins and the old one is dropped; otherwise the old verdict
    is re-keyed: a narrowed headline becomes ``narrowed`` (not judged again, validate warns), any other rename keeps its verdict."""
    old = deck["slides"][sid]["title"]
    deck["slides"][sid]["title"] = new
    verdicts = (deck.get("fit") or {}).get("verdicts")
    if not isinstance(verdicts, list):
        return
    if any(v.get("title") == new for v in verdicts):
        verdicts[:] = [v for v in verdicts if v.get("title") != old]
        return
    for v in verdicts:
        if v.get("title") == old:
            v["title"] = new
            if narrowed and v.get("verdict") in ("supported", "partly", "not"):
                v.update(was=v["verdict"], was_reason=v.get("reason", ""), verdict="narrowed", reason=reason, narrowed_from=old)


def _headline_problem(old: str, new, slide_type: str, judged: tuple) -> str:
    """Why a replacement headline is refused, or '' when it is acceptable: it must be non-empty text that differs from the old,
    not be longer by more than HEADLINE_GROWTH words, and carry no number the old headline did not (the numbers_trace guard: a
    narrowed claim keeps its figures and never gains one). Only a judged (claiming) slide type takes a new headline."""
    from .refs import numbers_in
    if slide_type not in judged:
        return "this slide type's headline is not a claim"
    new = str(new or "").strip()
    if not new:
        return "empty headline"
    if new == old:
        return "unchanged"
    if len(new.split()) > len(old.split()) + HEADLINE_GROWTH:
        return "longer than the original"
    extra = numbers_in(new) - numbers_in(old)
    if extra:
        return "adds a number not in the original headline: " + ", ".join(f"{n:g}" for n in sorted(extra))
    return ""


def apply_narrowing(deck: dict, narrowed: list) -> dict:
    """Apply stage e's headline rewrites (``[{slide, headline, reason}]``, keyed by the current title). A rewrite is applied only
    to a presented slide of a judged type whose fit verdict is ``not`` or ``partly``, and only if it passes _headline_problem
    (a headline that introduces a number not in the original is rejected and the original stays). Every applied or rejected one
    is recorded in ``deck.meta.narrowing`` with its reason, the slide's verdict is re-keyed by _retitle, and the result is
    ``{applied, rejected}`` counts. With no rewrites the deck is not touched at all."""
    from .stages import JUDGED
    from .validate import presented
    out = {"applied": 0, "rejected": 0}
    if not narrowed:
        return out
    ids = {deck["slides"][x]["title"]: x for x in presented(deck)}
    verdicts = {v.get("title"): v.get("verdict") for v in (deck.get("fit") or {}).get("verdicts", []) if isinstance(v, dict)}
    log = []
    for n in narrowed:
        old, new = str((n or {}).get("slide", "")), str((n or {}).get("headline", "")).strip()
        sid = ids.get(old)
        if not sid:
            problem = "no presented slide has this title (stale)"
        elif verdicts.get(old) not in ("not", "partly"):
            problem = "the fit verdict is not 'not' or 'partly'"
        else:
            problem = _headline_problem(old, new, deck["slides"][sid]["type"], JUDGED)
        row = {"slide": old, "from": old, "to": new, "reason": str(n.get("reason", "")), "verdict": verdicts.get(old)}
        if problem:
            out["rejected"] += 1
            log.append({**row, "applied": False, "rejected_because": problem})
            continue
        _retitle(deck, sid, new, narrowed=True, reason=row["reason"])
        ids[new] = ids.pop(old)
        out["applied"] += 1
        log.append({**row, "applied": True})
    deck["meta"]["narrowing"] = log
    return out


def _rt_wording(deck: dict, sid, ch: dict) -> tuple:
    """A red-team wording change: only the headline (title) of a presented slide that is not a placeholder or a human-owned slide,
    of a judged type, through _headline_problem (no new number, not longer, not a quote). Returns (applied, why, from, to)."""
    from .stages import JUDGED
    sl = deck["slides"][sid]
    new = str(ch.get("text") or "").strip()
    if sl["status"] == "needs_human" or any(b.get("human") or b.get("kind") == "quote" for b in sl["blocks"]):
        return False, "the slide is a placeholder, human-written or a quote: left for the person", sl["title"], new
    bad = _headline_problem(sl["title"], new, sl["type"], JUDGED)
    if bad:
        return False, bad + ": left for the person", sl["title"], new
    old = sl["title"]
    _retitle(deck, sid, new, narrowed=True, reason="reworded by the red team")
    return True, "headline reworded", old, new


def _rt_order(deck: dict, sid, ch: dict, ids: dict) -> tuple:
    """A red-team order change: move a presented slide to sit after another presented slide. The cover and the objective never
    move, and nothing moves out of the presented story. Returns (applied, why, from, to) with positions as 1-based numbers."""
    from .validate import presented
    pres = presented(deck)
    tgt = ids.get(str(ch.get("after") or ""))
    if deck["slides"][sid]["type"] in spec.RED_TEAM_FIXED:
        return False, "the cover and the objective stay where they are: left for the person", None, None
    if tgt is None or tgt not in pres or sid not in pres or tgt == sid:
        return False, "the slide to sit after is not a different presented slide: left for the person", None, None
    before = pres.index(sid) + 1
    rest = [x for x in deck["order"] if x != sid]
    deck["order"] = rest[:rest.index(tgt) + 1] + [sid] + rest[rest.index(tgt) + 1:]
    after = presented(deck).index(sid) + 1
    if after == before:
        return False, "already there", before, after
    return True, "slide moved", before, after


def apply_red_team(deck: dict, rt: dict) -> list:
    """Store and, where safe, apply the red team's objections. At most spec.RED_TEAM_MAX are kept, each tied to a slide and one
    change type. At most ONE revision per objection is applied, by code, and only when it is a ``wording`` change (a headline,
    never a number, placeholder or quote, no number added) or an ``order`` change on an existing presented slide; a
    ``placeholder`` or ``ask`` suggestion, and any change that fails its guard, is left for the person. Nothing here adds a
    fact. The objections go to ``deck.meta.red_team`` (shown at Gate 1 and Gate 3); the returned list holds one decision per
    objection, each saying what was done or that it was left for the person (run_deck writes them to report.json)."""
    ids = {sl["title"]: x for x, sl in deck["slides"].items()}
    kept, decisions = [], []
    for i, o in enumerate([o for o in (rt or {}).get("objections") or [] if isinstance(o, dict) and str(o.get("objection", "")).strip()][:spec.RED_TEAM_MAX], 1):
        ch = o.get("change") if isinstance(o.get("change"), dict) else {}
        kind = o.get("kind") if o.get("kind") in spec.RED_TEAM_KINDS else "claim_unsupported"
        ctype = ch.get("type") if ch.get("type") in spec.RED_TEAM_CHANGES else "ask"
        title = str(o.get("slide") or "")
        sid = ids.get(title)
        rec = {"id": f"o{i}", "kind": kind, "objection": str(o["objection"]).strip(), "slide": title, "change": {"type": ctype, **{k: ch[k] for k in ("text", "after", "note") if ch.get(k)}}}
        applied, why, frm, to = False, "left for the person", None, None
        if not sid:
            why = "no slide has this title: left for the person"
        elif ctype == "wording":
            applied, why, frm, to = _rt_wording(deck, sid, ch)
        elif ctype == "order":
            applied, why, frm, to = _rt_order(deck, sid, ch, ids)
        if applied:
            ids = {sl["title"]: x for x, sl in deck["slides"].items()}
        rec.update(applied=applied, outcome="applied" if applied else "left for the person", why=why)
        kept.append(rec)
        decisions.append({"by": "red_team", "objection": rec["id"], "slide": title, "type": ctype, "applied": applied, "why": why,
                          **({"from": frm, "to": to} if applied else {})})
    deck["meta"]["red_team"] = {"objections": kept, "max": spec.RED_TEAM_MAX, "reads": "the finished deck",
                                "shown_at": ["gate_1", "gate_3"], "applied": sum(d["applied"] for d in decisions)}
    return decisions
