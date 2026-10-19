"""Model stages for Deck Maker, run with ``run_deck --live`` (paid: Sai approves first). Each
stage returns (output_dict, usage) and its output is the same JSON the recorded stage files
hold, so the assembler cannot tell a live stage from a recorded one. Run live on six mock
briefs and a seed-round investor deck (2026-10-05); Lumen Water stages a-d and fit are still recorded stand-ins.

Models and effort are MODELS and EFFORT below (kickoff §4, ADR 0016). A judge never runs on
its writer's model.

| stage   | function       | job                                         | model             | effort |
|---------|----------------|---------------------------------------------|-------------------|--------|
| a0      | intake()       | fill missing brief fields, ask (<= 5 Qs)    | claude-sonnet-5-5 | medium |
| a       | requirements() | requirements + scoring read                 | claude-sonnet-5-5 | medium |
| b       | storyline()    | storyline, hero, human truth, voices        | claude-opus-5-5   | high   |
| c       | territories()  | three territories                           | claude-opus-5-5   | high   |
| c_judge | territories()  | blind territory ranking                     | claude-sonnet-5-5 | low    |
| d       | idea()         | idea, line, executions, messages            | claude-opus-5-5   | high   |
| d_criterion | criterion_answer() | tender: one written answer per scored criterion, a word budget from its weight (one call each) | claude-opus-5-5 | medium |
| i       | investor()     | investor deck story (kind=investor)         | claude-opus-5-5   | high   |
| insight_judge | insight_judge() | four yes/no tests and a paraphrase on each of stage b's three insight candidates, blind | claude-sonnet-5-5 | low |
| fit     | fit()          | does each headline's evidence support it    | claude-sonnet-5-5 | medium |
| e       | copy()         | tighten over-budget slides, and narrow `not`/`partly` headlines to their evidence (one call) | claude-sonnet-5-5 | low    |
| red_team | red_team()    | a skeptical buyer's objections to the finished deck (one call, after e) | claude-sonnet-5-5 | medium |

Not built yet: a2 (figures from image-only pages) and h (visual QA on rendered slides).

Calls go through ``brief_llm`` so transport (CLI login or API), retries, the Claude-only rule
(ADR 0006) and the token ledger are the engine's own.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from . import profiles, spec
from .inputs import BRIEF_FIELDS

ENGINE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ENGINE)]

PROMPTS = Path(__file__).parent / "prompts"
MODELS = {"a": "claude-sonnet-5-5", "b": "claude-opus-5-5", "c": "claude-opus-5-5",
          "c_judge": "claude-sonnet-5-5", "d": "claude-opus-5-5", "e": "claude-sonnet-5-5", "fit": "claude-sonnet-5-5"}
MODELS["e"] = "claude-sonnet-5-5"
MODELS["a0"] = "claude-sonnet-5-5"
MODELS["i"] = "claude-opus-5-5"
MODELS["red_team"] = "claude-sonnet-5-5"   # a Claude model, never the writer's (ADR 0006); a non-Claude red team is not wired here
MODELS["d_criterion"] = "claude-opus-5-5"   # one tender criterion's written answer: the writer's model, as stage d
MODELS["insight_judge"] = "claude-sonnet-5-5"   # never the writer's model (ADR 0006: Claude only; a non-Claude judge is not wired here)
EFFORT = {"a0": "medium", "a": "medium", "b": "high", "c": "high", "c_judge": "low", "d": "high", "fit": "medium", "e": "low", "i": "high", "insight_judge": "low", "red_team": "medium", "d_criterion": "medium"}   # copy tightening is mechanical: low effort (medium cost up to $1.27 a deck)
#: Slide types whose headlines make claims the fit judge reads.
JUDGED = ("real_question", "chart", "insight", "audience", "proposition", "measurement", "innovation",
          "problem", "why_now", "solution", "product", "market", "business_model", "traction", "competition", "gtm",
          "financials", "upside", "founders", "ask", "risks", "what_we_know")
CHUNK_CHARS = 60_000       # documents are split, never clipped (Sai: never drop input)


#: What a deck type's guidance block says about itself.
HOOK = ("Guidance for this kind of deck. It adds to the rules above, never overrides one, and never allows a fact, "
        "name, figure or legal line the inputs do not give.")


def _sysmsg(name: str, stage: str, profile: dict | None = None) -> str:
    """A stage's system prompt: its prompts/<name> file, with, when the deck type (profile) has guidance for the
    stage (profiles.guidance), a <type_guidance> block of those lines placed before the file's input rule
    ("Inputs are the only source"), so the rule still has the last word. With no profile, or none for the stage, the text is the file's own."""
    text = (PROMPTS / name).read_text()
    lines = profiles.guidance(profile, stage)
    if not lines:
        return text
    block = "<type_guidance>\n" + HOOK + "\n" + "\n".join(f"- {x}" for x in lines) + "\n</type_guidance>\n"
    body = text.rstrip("\n").split("\n")
    at = next((i for i, ln in enumerate(body) if ln.startswith("Inputs are the only source:")), len(body))
    return "\n".join(body[:at] + block.rstrip("\n").split("\n") + body[at:]) + "\n"


#: The repair call's system prompt: the bad reply goes in as data, the answer is the JSON alone.
REPAIR_SYSTEM = ("You repair a reply that was meant to be one JSON object but cannot be parsed. Return the same content as one "
                 "valid JSON object and nothing else: no prose, no code fence. Keep every field and every value as it was; "
                 "fix only the syntax (quotes, commas, brackets, truncation). Add nothing and drop nothing.")
#: How much of a bad reply the repair call is shown (the head and the tail are what break).
REPAIR_CHARS = 60_000


def _repair_user(bad: str) -> str:
    """The user turn of the repair call: the unusable reply, in a tag, as data."""
    bad = bad if len(bad) <= REPAIR_CHARS else bad[:REPAIR_CHARS // 2] + "\n...\n" + bad[-REPAIR_CHARS // 2:]
    return f"<unusable_reply>\n{bad}\n</unusable_reply>\nReturn that reply as one valid JSON object only."


def _call(stage: str, user: str, system: str) -> tuple[dict, dict]:
    """One JSON call on the stage's model at its effort; returns (obj, usage).

    Usage comes from a private ledger (brief_llm._stats_scope), not snapshots of the global one:
    _stats_snapshot() on a fresh process deadlocks (it takes the stats lock, then _ledger() resets
    the empty ledger under the same lock). The effort goes through BRIEF_CLI_EFFORT, the one
    setting a pinned-model call honours (route efforts apply to routed calls only).

    A reply that is not usable JSON gets one repair call (REPAIR_SYSTEM): the bad text goes back and valid JSON only is
    asked for (investor level A failed at stage i on this). The extra call's tokens are in the usage. ``usage['usd']`` is
    the ledger's real figure when the transport gives one, else an ESTIMATE from tokens (spec.estimate_usd, ``usd_estimated``)."""
    import brief_llm as L
    os.environ["BRIEF_CLI_EFFORT"] = EFFORT[stage]
    L.CLI_TIMEOUT_S = max(L.CLI_TIMEOUT_S, 600.0)   # a high-effort storyline can run past the 240 s default (read at import)
    t = time.time()
    bad: list = []

    def reader(raw):
        """Read a reply as one whole JSON object, keeping the text so a repair call can be shown it."""
        bad.append(raw)
        return L._loads_lenient(raw, whole=True)

    def ask(text, sysmsg, retries):
        """One JSON call on the stage's model, reading replies through ``reader``."""
        del bad[:]
        return L._json_call(text, system=sysmsg, model=MODELS[stage], only_model=True, parse=reader, max_tokens=16000, retries=retries)

    repaired = False
    with L._stats_scope() as led:
        obj = ask(user, system, 2)
        if obj is None and bad and str(bad[-1]).strip():
            repaired = True
            obj = ask(_repair_user(str(bad[-1])), REPAIR_SYSTEM, 0)
    if obj is None:
        raise L.NoClaudeAvailable(f"deck stage {stage}: no usable reply from {MODELS[stage]}" + (" (and the repair call failed)" if repaired else ""))
    usage = {k: int(led.get(k, 0) or 0) for k in ("prompt_tokens", "completion_tokens", "cache_read_tokens", "cache_creation_tokens")}
    usage.update(model=MODELS[stage], secs=round(time.time() - t, 1), calls=int(led.get("calls", 0) or 0))
    if repaired:
        usage["repaired"] = True
    real = led.get("usd") or led.get("cost_usd")
    if real:
        usage["usd"] = round(float(real), 4)
    else:
        usage.update(usd=spec.estimate_usd(MODELS[stage], usage["prompt_tokens"], usage["completion_tokens"], usage["cache_read_tokens"], usage["cache_creation_tokens"]), usd_estimated=True)
    return obj, usage

def _prompt_block(inp) -> str:
    """The person's prompt (sentences numbered, citable as prompt:<n>) and answers (answer:<qid>) as a
    block for a stage's input; empty when there is neither, so a brief-only run sends what it always sent."""
    from .refs import answer_text, prompt_sentences
    out = ""
    if inp.prompt_text.strip():
        out += "\n<prompt>\n" + "\n".join(f"[prompt:{i}] {t}" for i, t in enumerate(prompt_sentences(inp.prompt_text), 1)) + "\n</prompt>"
    ans = [f"[answer:{q}] {answer_text(inp, q)}" for q in inp.answers if answer_text(inp, q)]
    if ans:
        out += "\n<answers>\n" + "\n".join(ans) + "\n</answers>"
    return out


def _facts_block(inp, limit=None) -> str:
    """Research pins and findings as citable lines; rejected findings are never sent. A finding's ``so_what``
    (the research's own reading of why it matters) goes beside its statement when it has one."""
    lines = [f"[{f['id']}] {f['entity']} {f['key']} = {f['value']} {f.get('unit', '')} (as of {f.get('as_of')}, {f.get('confidence')})"
             for f in inp.facts.values() if f["id"] not in inp.rejected_pins]
    for f in inp.findings.values():
        if f.get("status") == "rejected":
            continue
        so_what = str(f.get("so_what") or "").strip()   # the finding's own reading of why it matters, beside its statement
        lines.append(f"[{f['id']}] FINDING ({f['status']}): {f['statement']}" + (f" SO WHAT: {so_what}" if so_what else ""))
    for k, f in inp.doc_facts.items():
        lines.append(f"[{k}] CLIENT DOCUMENT p{f.get('page')}: {f['label']} = {f['value']} {f.get('unit', '')}")
    return "\n".join(lines[:limit] if limit else lines)


#: A field kind's rank when two parts of the intake disagree: research, then document, then prompt.
_KIND_RANK = {"research": 0, "document": 1, "prompt": 2, "proposal": 3}


def _join_value(a, b):
    """Merge two values of one brief field read from different parts: strings are joined, lists
    concatenated without repeats, dicts filled where a key is empty; anything else keeps the first."""
    if isinstance(a, str) and isinstance(b, str):
        return a if b in a else f"{a} {b}"
    if isinstance(a, list) and isinstance(b, list):
        return a + [x for x in b if x not in a]
    if isinstance(a, dict) and isinstance(b, dict):
        return {**{k: v for k, v in b.items() if v}, **{k: v for k, v in a.items() if v}}
    return a


def merge_a0(parts: list, supplied: set, kind: str = "agency", inp=None) -> dict:
    """Merge the model's reads (one per document chunk, plus one of the prompt and research) into one
    a0_intake dict, in code. A field the brief supplies is dropped; a field read twice keeps the
    higher-ranked kind (research, document, prompt, proposal), same-kind reads are joined, and a
    prompt read a document disagrees with is noted in ``conflict``. ``abstained`` is every field to
    fill that no part wrote; ``gaps`` is computed by intake.gap_report, not by the model; questions
    are deduplicated and capped at intake.MAX_QUESTIONS."""
    from . import intake
    fields, conflicts, questions, seen = {}, [], [], set()
    for part in parts:
        for fid, f in (part.get("fields") or {}).items():
            if fid not in BRIEF_FIELDS or fid in supplied or not isinstance(f, dict) or intake._empty(f.get("value")):
                continue
            f = {"value": f["value"], "kind": f.get("kind") if f.get("kind") in intake.A0_KINDS else "proposal",
                 "refs": [r for r in f.get("refs") or [] if isinstance(r, str)], **({"conflict": f["conflict"]} if f.get("conflict") else {})}
            cur = fields.get(fid)
            if not cur:
                fields[fid] = f
                continue
            hi, lo = (cur, f) if _KIND_RANK[cur["kind"]] <= _KIND_RANK[f["kind"]] else (f, cur)
            if hi["kind"] == lo["kind"]:
                hi = {**hi, "value": _join_value(hi["value"], lo["value"])}
            elif hi["value"] != lo["value"] and lo["kind"] == "prompt":
                hi = {**hi, "conflict": hi.get("conflict") or f"the prompt said: {json.dumps(lo['value'], ensure_ascii=False)[:300]}"}
            fields[fid] = {**hi, "refs": list(dict.fromkeys(hi["refs"] + lo["refs"]))}
        conflicts += [c for c in part.get("conflicts") or [] if isinstance(c, dict) and c.get("field") in BRIEF_FIELDS]
        for q in part.get("questions") or []:
            qid = str(q.get("id") or "")
            if q.get("text") and q["text"] not in seen and str(q.get("address") or "").startswith("brief."):
                seen.add(q["text"])
                qid = qid if qid.startswith("q_") else f"q_{qid}" if qid else "q_"
                used = {x["id"] for x in questions}
                if qid in used or qid == "q_":   # parts are separate model calls and may reuse an id: keep ids unique
                    n = len(questions) + 1
                    while f"q_{n}" in used:
                        n += 1
                    qid = f"q_{n}"
                questions.append({"id": qid, "text": q["text"],
                                  "options": [o for o in q.get("options") or [] if isinstance(o, dict) and o.get("id") and o.get("label")][:4],
                                  "allow_text": bool(q.get("allow_text", True)), "address": q["address"]})
    out = {"stage": "a0_intake", "fields": fields,
           "abstained": [f for f in BRIEF_FIELDS if f not in supplied and f not in fields],
           "gaps": {}, "questions": questions[:intake.MAX_QUESTIONS]}
    if conflicts:
        out["conflicts"] = conflicts
    if inp is not None:
        out["gaps"] = intake.gap_report(inp, out, kind)
    return out


def intake(inp, kind: str = "agency", profile: dict | None = None) -> tuple[dict, dict]:
    """Stage a0: read the prompt, the research and EVERY document chunk (60k characters each, none
    clipped), fill only the brief fields the brief does not supply, write at most 5 skippable
    questions. One call for the prompt and research, one per document chunk; the reads are merged
    in code (merge_a0) and the gap report is computed in code. Paid when run live; the person
    answers the questions in the app and a skipped question never blocks the build."""
    from . import intake as _intake
    sysmsg = _sysmsg("a0_intake.md", "a0", profile)
    supplied = {fid for fid, f in inp.brief.items() if f.get("value") and not f.get("from_intake")}
    todo = [fid for fid in BRIEF_FIELDS if fid not in supplied]
    head = (f"<fields_to_fill>{json.dumps(todo)}</fields_to_fill>\n"
            f"<supplied_by_brief>\n{json.dumps({f: inp.brief[f]['value'] for f in sorted(supplied)}, ensure_ascii=False)}\n</supplied_by_brief>")
    parts, usage = [], []
    material = _prompt_block(inp) + (f"\n<research>\n{_facts_block(inp)}\n</research>" if inp.has_research() else "")
    if material.strip():
        obj, u = _call("a0", head + material, sysmsg)
        parts.append(obj); usage.append(u)
    for key, d in inp.docs.items():
        text = d["text"]
        for i in range(0, len(text), CHUNK_CHARS):
            part = text[i:i + CHUNK_CHARS]
            obj, u = _call("a0", head + f"\n<document key=\"{key}\" name=\"{d['name']}\" chars=\"{i}-{i + len(part)}\">\n{part}\n</document>", sysmsg)
            parts.append(obj); usage.append(u)
    out = merge_a0(parts, supplied, kind, inp)
    out["produced_by"] = f"live {MODELS['a0']}"
    _intake.add_type_question(out, _intake.type_card_for(inp), profile)   # the deck type comes first, computed in code
    errs = _intake.validate_a0(out)
    if errs:
        raise ValueError("a0 intake output is not valid: " + "; ".join(errs[:5]))
    return out, _sum(usage)


def requirements(inp, profile: dict | None = None) -> tuple[dict, dict]:
    """Stage a: every ask, score, page limit and mandatory, read chunk by chunk, merged by id."""
    sysmsg = _sysmsg("a_requirements.md", "a", profile)
    reqs, scoring, rules, usage = [], [], [], []
    for key, d in inp.docs.items():
        text = d["text"]
        for i in range(0, len(text), CHUNK_CHARS):
            part = text[i:i + CHUNK_CHARS]
            obj, u = _call("a", f"<document key=\"{key}\" name=\"{d['name']}\" chars=\"{i}-{i + len(part)}\">\n{part}\n</document>", sysmsg)
            reqs += obj.get("requirements", []); scoring += obj.get("scoring", []); rules += obj.get("rules", [])
            usage.append(u)
    if not inp.docs:  # brief-only: the brief's own mandatories and objectives are the requirements
        brief = json.dumps({k: v["value"] for k, v in inp.brief.items()}, ensure_ascii=False)
        obj, u = _call("a", f"<brief>\n{brief}\n</brief>{_prompt_block(inp)}", sysmsg)
        reqs, scoring, rules = obj.get("requirements", []), obj.get("scoring", []), obj.get("rules", [])
        usage.append(u)
    seen, merged = set(), []
    for r in reqs:
        if r.get("text") and r["text"].lower() not in seen:
            seen.add(r["text"].lower()); merged.append(r)
    for i, r in enumerate(merged, 1):
        r.setdefault("id", f"r_{i:02d}")
    return ({"stage": "a_requirements", "produced_by": f"live {MODELS['a']}", "requirements": merged,
             "scoring": scoring, "rules": rules}, _sum(usage))


def storyline(inp, st, profile: dict | None = None, retry_reasons: list | None = None) -> tuple[dict, dict]:
    """Stage b: reframe, evidence per slide, audience, three insight candidates and the chosen insight, proposition (Gate 1
    follows). ``retry_reasons``: on the one bounded retry after every candidate failed the insight judge, the judge's reasons,
    sent in an <insight_judge_reasons> block so the writer can fix what failed."""
    brief = {k: {"value": v["value"], "provenance": v["mark"]} for k, v in inp.brief.items()}
    user = (f"<brief>\n{json.dumps(brief, ensure_ascii=False)}\n</brief>\n<how_to_win>\n{json.dumps(inp.how_to_win, ensure_ascii=False)}\n</how_to_win>\n"
            f"<requirements>\n{json.dumps((st.get('a') or {}).get('requirements', []), ensure_ascii=False)}\n</requirements>\n"
            f"<evidence>\n{_facts_block(inp)}\n</evidence>{_prompt_block(inp)}")
    if retry_reasons:
        user += "\n<insight_judge_reasons>\nEvery insight candidate you wrote failed the judge. Write three new ones that fix this:\n" + "\n".join(f"- {r}" for r in retry_reasons) + "\n</insight_judge_reasons>"
    obj, u = _call("b", user, _sysmsg("b_storyline.md", "b", profile))
    obj.update(stage="b_storyline", produced_by=f"live {MODELS['b']}")
    return obj, u


def _candidate_evidence(inp, cands: list) -> str:
    """The text behind every ref the candidates cite (refs and from_refs), one line each through refs.Resolver.describe,
    so the judge can test 'follows'. A ref that resolves to nothing is listed as unresolved. Empty when there is no ``inp``."""
    if inp is None:
        return ""
    from .refs import Resolver
    R = Resolver(inp)
    ids = list(dict.fromkeys(r for c in cands for k in ("refs", "from_refs") for r in c.get(k) or [] if isinstance(r, str)))
    lines = []
    for r in ids:
        r = r.split(":", 1)[1] if r.startswith("finding:") else r   # a candidate may write 'finding:f3' for the id f3
        lines.append(R.describe(r) if R.kind(r) != "unknown" else f"[{r}] unresolved: no text for this ref")
    return "\n".join(lines)


def insight_judge(st, profile: dict | None = None, inp=None) -> tuple[dict, dict]:
    """The insight judge: one Sonnet call, never the writer's model. It reads the diagnosis (reframe, barrier, audience,
    from/to) and stage b's candidates BLIND (ids renamed j1.., no choice, no confidence, no swap-test text) and returns per
    candidate the four yes/no tests with a quoted reason (spec.INSIGHT_TESTS), a one-sentence paraphrase and an order. The
    pass or fail is computed in code from those answers (assemble.judge_verdicts), never taken from the model. Ids in the
    returned object are the writer's own. With ``inp`` the text behind each cited ref goes in an <evidence> block, so the
    'follows' test can be answered; without it the block says no evidence is given and the prompt makes 'follows' a no."""
    b = st.get("b") or {}
    cands = _valid(b)
    blind = {f"j{i}": c for i, c in enumerate(cands, 1)}
    shown = [{"id": j, **{k: c[k] for k in ("observation", "tension", "implication", "from", "refs") if c.get(k)}} for j, c in blind.items()]
    diag = {k: b.get(k) for k in ("reframe", "barrier", "audience", "from_to") if b.get(k)}
    ev = _candidate_evidence(inp, cands) or "(no evidence text is given)"
    user = (f"<diagnosis>\n{json.dumps(diag, ensure_ascii=False)}\n</diagnosis>\n<candidates>\n{json.dumps(shown, ensure_ascii=False)}\n</candidates>\n"
            f"<evidence>\n{ev}\n</evidence>")
    obj, u = _call("insight_judge", user, _sysmsg("insight_judge.md", "insight_judge", profile))
    back = {j: str(c["id"]) for j, c in blind.items()}
    obj["verdicts"] = [{**v, "id": back.get(str(v.get("id")), str(v.get("id")))} for v in obj.get("verdicts") or [] if isinstance(v, dict)]
    obj["order"] = [back.get(str(i), str(i)) for i in obj.get("order") or []]
    obj.update(stage="insight_judge", produced_by=f"live {MODELS['insight_judge']}")
    return obj, u


def _valid(b: dict) -> list:
    """Stage b's usable insight candidates (assemble.valid_candidates, imported late: assemble imports this package)."""
    from .assemble import valid_candidates
    return valid_candidates(b)


def territories(inp, st, profile: dict | None = None) -> tuple[dict, dict]:
    """Stage c: three distinct territories, then a blind ranking on a different model."""
    user = f"<storyline>\n{json.dumps(st.get('b'), ensure_ascii=False)}\n</storyline>"
    obj, u1 = _call("c", user, _sysmsg("c_territories.md", "c", profile))
    blind = [{"id": t["id"], "thought": t["thought"], "why": t["why"], "risks": t["risks"]} for t in obj.get("territories", [])]
    rank, u2 = _call("c_judge", f"<insight>{json.dumps((st.get('b') or {}).get('insight'), ensure_ascii=False)}</insight>\n<territories>{json.dumps(blind, ensure_ascii=False)}</territories>",
                     _sysmsg("c_judge.md", "c_judge", profile))
    obj.update(stage="c_tissue_session", produced_by=f"live {MODELS['c']}", ranking={**rank, "by": MODELS["c_judge"]},
               chosen=(rank.get("order") or [None])[0], chosen_by="default: the judge's first choice, flagged for Gate 2")
    return obj, _sum([u1, u2])


def idea(inp, st, profile: dict | None = None) -> tuple[dict, dict]:
    """Stage d: the line, the idea and 3-6 executions in the channels the brief names (after Gate 2)."""
    chosen = next((t for t in (st.get("c") or {}).get("territories", []) if t["id"] == (st.get("c") or {}).get("chosen")), None)
    user = (f"<storyline>{json.dumps(st.get('b'), ensure_ascii=False)}</storyline>\n<territory>{json.dumps(chosen, ensure_ascii=False)}</territory>\n"
            f"<requirements>{json.dumps((st.get('a') or {}).get('requirements', []), ensure_ascii=False)}</requirements>\n<evidence>\n{_facts_block(inp)}\n</evidence>{_prompt_block(inp)}")
    obj, u = _call("d", user, _sysmsg("d_idea.md", "d", profile))
    obj.update(stage="d_idea_and_executions", produced_by=f"live {MODELS['d']}")
    return obj, u


def criterion_answer(inp, st, criterion: dict, budget: int, profile: dict | None = None) -> tuple[dict, dict]:
    """One tender criterion's written answer: a single call (stage d_criterion) for ONE scored criterion, with a word budget from its
    weight (assemble.criterion_budgets). It reads the criterion, the buyer's requirements, the storyline and idea already written, the
    evidence, the person's prompt and answers, and the agency's documents (which may fill team, credentials and fees when attached,
    each point citing the document). The output is recorded as d_<criterion>.json; the deck slides are derived from it."""
    user = (f"<criterion>\n{json.dumps(criterion, ensure_ascii=False)}\n</criterion>\n<word_budget>{int(budget)}</word_budget>\n"
            f"<requirements>{json.dumps((st.get('a') or {}).get('requirements', []), ensure_ascii=False)}</requirements>\n"
            f"<storyline>{json.dumps(st.get('b'), ensure_ascii=False)}</storyline>\n<idea>{json.dumps(st.get('d'), ensure_ascii=False)}</idea>\n"
            f"<evidence>\n{_facts_block(inp)}\n</evidence>{_prompt_block(inp)}\n"
            + "\n".join(f"<document key=\"{k}\" name=\"{d['name']}\">\n{d['text']}\n</document>" for k, d in inp.docs.items()))
    obj, u = _call("d_criterion", user, _sysmsg("tender_answer.md", "d", profile))
    obj.update(stage="d_criterion", criterion=str(criterion.get("criterion") or ""), word_budget=int(budget), produced_by=f"live {MODELS['d_criterion']}")
    return obj, u


def fit(deck, inp, profile: dict | None = None) -> tuple[dict, dict]:
    """Fit judge: does each claiming slide's evidence support its headline? On Sonnet, so the
    storyline's writer (Opus) never judges itself. Verdicts are keyed by slide title."""
    from .assemble import slide_refs
    from .refs import Resolver
    from .validate import _texts
    R = Resolver(inp, list(deck.get("requirements", {}).values()))
    slides = [{"title": s["title"], "type": s["type"], "shows": [str(t) for t, _ in _texts(s, internal=False)[1:] if str(t).strip()],
               "evidence": [R.describe(r) for r in slide_refs(s)]}
              for s in (deck["slides"][x] for x in deck["order"]) if s["type"] in JUDGED]
    obj, u = _call("fit", f"<slides>\n{json.dumps(slides, ensure_ascii=False)}\n</slides>", _sysmsg("fit_judge.md", "fit", profile))
    obj.update(stage="fit", produced_by=f"live {MODELS['fit']}")
    return obj, u


def _narrow_candidates(deck, inp) -> list:
    """Presented slides of a judged type whose fit verdict is ``not`` or ``partly``, with the headline, what the slide shows, the
    evidence lines it cites and the judge's reason: what stage e's headline narrowing is shown (one entry per slide)."""
    from .assemble import slide_refs
    from .refs import Resolver
    from .validate import _texts, presented
    verdicts = {v.get("title"): v for v in (deck.get("fit") or {}).get("verdicts", []) if isinstance(v, dict)}
    R = Resolver(inp, list(deck.get("requirements", {}).values()))
    out = []
    for x in presented(deck):
        s = deck["slides"][x]
        v = verdicts.get(s["title"])
        if s["type"] in JUDGED and v and v.get("verdict") in ("not", "partly"):
            out.append({"slide": s["title"], "type": s["type"], "verdict": v["verdict"], "reason": v.get("reason", ""),
                        "shows": [str(t) for t, _ in _texts(s, internal=False)[1:] if str(t).strip()],
                        "evidence": [R.describe(r) for r in slide_refs(s)]})
    return out


def copy(deck, inp, profile: dict | None = None) -> tuple[dict, dict]:
    """Stage e, copy: tighten the presented slides whose on-screen text is past its word budget, and narrow the headline of every
    presented slide the fit judge called ``not`` or ``partly`` to what its evidence supports (one Sonnet call per deck for both).
    Returns ``edits`` keyed by slide title and field id (assemble.apply_copy) and ``narrowed``, one rewrite per slide with its
    reason (assemble.apply_narrowing, which rejects a headline that adds a number)."""
    from . import spec
    from .assemble import copy_fields
    from .validate import presented, words
    over = []
    for x in presented(deck):
        s = deck["slides"][x]
        budget, w = s.get("budget") or spec.SLIDE_TYPES[s["type"]]["words"], words(s)
        fields = copy_fields(s)
        if w > budget and fields:
            over.append({"slide": s["title"], "type": s["type"], "budget": budget, "words": w,
                         "fields": [{"id": f, "text": t} for f, t in fields]})
    narrow = _narrow_candidates(deck, inp)
    if not over and not narrow:
        return {"stage": "e_copy", "produced_by": "no slide over budget", "edits": []}, {"model": None, "secs": 0, "calls": 0}
    user = f"<slides>\n{json.dumps(over, ensure_ascii=False)}\n</slides>"
    if narrow:
        user += f"\n<narrow>\n{json.dumps(narrow, ensure_ascii=False)}\n</narrow>"
    obj, u = _call("e", user, _sysmsg("e_copy.md", "e", profile))
    obj.update(stage="e_copy", produced_by=f"live {MODELS['e']}")
    if narrow:
        asked = {n["slide"] for n in narrow}
        obj["narrowed"] = [n for n in obj.get("narrowed") or [] if isinstance(n, dict) and n.get("slide") in asked][:len(asked)]
    return obj, u


def red_team(deck, inp, profile: dict | None = None) -> tuple[dict, dict]:
    """The red team: one Sonnet call that reads the finished deck (the presented slides' titles and on-screen text, the client's
    requirements and the stated ask) as a skeptical buyer or investor and returns at most spec.RED_TEAM_MAX objections, each tied
    to a slide and to one suggested change (wording, order, a labelled placeholder, or a question for the person). It changes
    nothing: assemble.apply_red_team applies the few safe ones."""
    from .validate import _texts, presented
    shown = [{"slide": deck["slides"][x]["title"], "type": deck["slides"][x]["type"], "status": deck["slides"][x]["status"],
              "text": [str(t) for t, _ in _texts(deck["slides"][x], internal=False)[1:] if str(t).strip()]} for x in presented(deck)]
    reqs = [{"id": r["id"], "text": r.get("text", "")} for r in deck.get("requirements", {}).values()]
    user = (f"<deck kind=\"{deck['meta'].get('kind', '')}\">\n{json.dumps(shown, ensure_ascii=False)}\n</deck>\n"
            f"<requirements>\n{json.dumps(reqs, ensure_ascii=False)}\n</requirements>")
    obj, u = _call("red_team", user, _sysmsg("red_team.md", "red_team", profile))
    obj["objections"] = [o for o in obj.get("objections") or [] if isinstance(o, dict)][:spec.RED_TEAM_MAX]
    obj.update(stage="red_team", produced_by=f"live {MODELS['red_team']}")
    return obj, u


def investor(inp, st, profile: dict | None = None) -> tuple[dict, dict]:
    """Stage i: an investor (seed) deck's story in one call, from the brief, its research pins and the
    company's documents (page-marked so slides can cite doc:<key>#pN)."""
    brief = {k: v["value"] for k, v in inp.brief.items() if v["value"]}
    docs = "\n".join(f"<document key=\"{k}\" name=\"{d['name']}\">\n{d['text']}\n</document>" for k, d in inp.docs.items())
    user = (f"<brief>\n{json.dumps(brief, ensure_ascii=False)}\n</brief>\n<how_to_win>\n{json.dumps(inp.how_to_win, ensure_ascii=False)}\n</how_to_win>\n"
            f"<open_questions>\n{json.dumps([q['question'] for q in inp.open_questions], ensure_ascii=False)}\n</open_questions>\n"
            f"<research>\n{_facts_block(inp)}\n</research>{_prompt_block(inp)}\n{docs}")
    obj, u = _call("i", user, _sysmsg("i_investor.md", "i", profile))
    obj.update(stage="i_investor", produced_by=f"live {MODELS['i']}")
    return obj, u


def _sum(us: list) -> dict:
    """Add up usage rows."""
    out = {"calls": len(us), "secs": round(sum(u.get("secs", 0) for u in us), 1), "model": ",".join(sorted({u.get("model", "") for u in us}))}
    for k in ("prompt_tokens", "completion_tokens", "cache_read_tokens", "cache_creation_tokens"):
        out[k] = sum(u.get(k, 0) for u in us)
    if any("usd" in u for u in us):
        out["usd"] = round(sum(u.get("usd", 0) or 0 for u in us), 4)
        if any(u.get("usd_estimated") for u in us):
            out["usd_estimated"] = True
    if any(u.get("repaired") for u in us):
        out["repaired"] = True
    return out


def run_stage(k: str, inp, st: dict, profile: dict | None = None) -> tuple[dict, dict]:
    """Dispatch one stage by key (a0, a, b, c, d, i). ``profile`` is the deck type: its guidance for the
    stage is appended to the stage's prompt, and a stage it does not run is refused."""
    if profile and not profiles.runs(profile, k):
        raise ValueError(f"deck type {profile['id']} does not run stage {k}")
    return {"a0": lambda: intake(inp) if profile is None else intake(inp, profile["kind"], profile),
            "i": lambda: investor(inp, st, profile), "a": lambda: requirements(inp, profile), "b": lambda: storyline(inp, st, profile),
            "c": lambda: territories(inp, st, profile), "d": lambda: idea(inp, st, profile)}[k]()
