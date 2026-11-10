"""Several proposition candidates before one is chosen (features/brief-proposition-candidates.clan, phase 0).

Pure functions, no job and no I/O: each takes `call(purpose, system, payload, schema) -> object`, the same
shape as Drafter._call, so the offline replay (tools/prop_replay.py) and, in phase 1, the planned flow's
hook drive the same code.

    generate   one call (purpose candidates_smp): n new propositions, one per angle seed, written from Dara's
               drafted insight, plan, facts and client words. The first-draft proposition is NOT shown, so the
               new ones are not rewordings of it.
    rank       one call (purpose rank_smp): the pool in an order shuffled by a seed from the job id, each with its
               word count and 'and' flag, ranked on the smp rubric's judged tests (drafters.rank).
    choose     in code: the best-ranked candidate that clears rubric.auto_gate, with one tie-break (below).
    pick       the three in a row, with an outcome code and nothing applied anywhere.

The tie-break is not a ban (ADR 0034). Code already sends back a proposition with a standalone 'and'
(checks.revisions), so a flagged winner is rewritten straight after and its place in the brief is wasted: if the
chosen candidate carries the flag and the next gate-clearing candidate below it in the ranking does not, that
one is taken; otherwise the flagged one stands.
"""

from __future__ import annotations

import hashlib
import random

from . import checks
from .drafters import SMP_ANGLE_SEEDS, _clean_value, _obj, field_system, rank
from .rubric import and_flag, auto_gate

RID = "smp"
KEY = "single_minded_proposition"
N_CANDIDATES = 4
FIRST_DRAFT = "first_draft"

# Dara's drafted parts the candidates are written from (values only), and the ranker's context.
FROM_PARTS = ("job", "background", "barrier", "objectives.commercial", "objectives.behavioural",
              "objectives.attitudinal", "audience", "competitor_context", "reasons_to_believe")
RANK_PARTS = ("job", "audience", "competitor_context", "reasons_to_believe")

REASON_FROM = ("Reason from the drafted insight, the plan, the facts and the client's words, and the precedent "
               "passages if any are given.")
METHOD_NOTE = (
    "HOW TO FIND IT. List the product truths in the facts (the reasons to believe). Ladder each: feature, "
    "functional benefit, emotional benefit. Choose the altitude that is both motivating to the person and "
    "ownable by this brand: \"Too low (a feature) and it is forgettable and copyable; too high (a universal "
    "emotion) and it belongs to any brand in any category.\" State each draft as one plain thought. "
    "The input gives an angle for each draft, in order: pull the idea that way and do not name the angle. "
    "For each draft also return `angle` (the angle you were given, in a few words), `rests_on` (one line: what in "
    "the input it rests on) and `cites` (the ids it rests on: fact ids f_..., capture ids cap_..., passage ids "
    "psg_..., exactly as they appear in the input; [] when it rests on none). A figure in a draft must come from a "
    "fact in the input.")


def unmarked(v) -> str:
    """The words of a part without the 'To confirm:' mark (the mark is not part of what is said)."""
    return checks._spoken(v)


def standalone_and(text) -> bool:
    """The 'and' flag exactly as Jude is told it (checks.facts): a name with an ampersand is one thing."""
    return and_flag(checks._NAMES.sub(" ", str(text or "")))


def words(text) -> int:
    return len(str(text or "").split())


def seed_for(job_id: str) -> int:
    """A seed that is the same in every process (hashlib, not hash())."""
    return int(hashlib.sha256(str(job_id).encode()).hexdigest()[:16], 16)


def shuffled(n: int, job_id: str) -> list[int]:
    """The order the ranker is shown the pool in: a permutation of range(n) fixed by the job id."""
    order = list(range(n))
    random.Random(seed_for(job_id)).shuffle(order)
    return order


# ------------------------------------------------------------------------------------------ generate

def candidate_schema(n: int) -> dict:
    cand = _obj({"value": {"type": "string", "minLength": 1}, "angle": {"type": "string"},
                 "rests_on": {"type": "string"}, "cites": {"type": "array", "items": {"type": "string"}}})
    return _obj({"candidates": {"type": "array", "minItems": 1, "maxItems": n, "items": cand}})


def generate_system(n: int) -> str:
    return field_system(RID, n, grounds=False, reason_from=REASON_FROM) + "\n" + METHOD_NOTE


def generate_payload(*, insight, strategy, parts: dict, facts, findings, client_words, library, n: int) -> dict:
    """What the candidates are written from. `insight`: Dara's drafted insight (the mark comes off);
    `parts`: her drafted parts by key (values only); `facts`, `findings`: the evidence the draft saw;
    `client_words`: the client's captured words; `library`: the precedent passages the draft saw."""
    seeds = [SMP_ANGLE_SEEDS[i % len(SMP_ANGLE_SEEDS)] for i in range(n)]
    return {"insight": unmarked(insight), "plan_strategy": strategy,
            "drafted": {k: unmarked(parts[k]) for k in FROM_PARTS if unmarked(parts.get(k))},
            "facts": facts, "findings": findings, "client_words": client_words, "library": library,
            "angles": seeds, "write": n}


def generate(call, payload: dict, n: int = N_CANDIDATES) -> list[dict]:
    """One call. -> [{value, angle, rests_on, cites, seed}] cleaned (empty values dropped), in the order the model
    wrote them; `seed` is the index of the angle seed it was written to (the draft's place in the list)."""
    raw = call("candidates_smp", generate_system(n), payload, candidate_schema(n))
    out = []
    for i, c in enumerate(raw.get("candidates") or []):
        v = _clean_value(RID, unmarked(c.get("value")))
        if v:
            out.append({"value": v, "angle": c.get("angle") or "", "rests_on": c.get("rests_on") or "",
                        "cites": [x for x in c.get("cites") or [] if isinstance(x, str)], "seed": i % len(SMP_ANGLE_SEEDS)})
    return out


# ---------------------------------------------------------------------------------------------- pool

def build_pool(first_value, new: list[dict]) -> list[dict]:
    """The new candidates, exact duplicates dropped (a copy of the first draft too), then the first draft.
    Each: {value, source, words, and_flag, gate_ok, gate_fails}. Source is 'seed:<i>' or 'first_draft'."""
    first = _clean_value(RID, unmarked(first_value))
    seen = {first} if first else set()
    pool = []
    for c in new:
        if c["value"] in seen:
            continue
        seen.add(c["value"])
        pool.append({"value": c["value"], "source": f"seed:{c['seed']}", "angle": c.get("angle", ""),
                     "rests_on": c.get("rests_on", ""), "cites": c.get("cites", [])})
    if first:
        pool.append({"value": first, "source": FIRST_DRAFT})
    for p in pool:
        p["words"], p["and_flag"] = words(p["value"]), standalone_and(p["value"])
        p["gate_ok"], p["gate_fails"] = auto_gate(RID, p["value"])
    return pool


# ----------------------------------------------------------------------------------------------- rank

def rank_context(parts: dict, insight) -> dict:
    ctx = {"insight": unmarked(insight)}
    ctx.update({k: unmarked(parts[k]) for k in RANK_PARTS if unmarked(parts.get(k))})
    return ctx


def rank_pool(call, pool: list[dict], context: dict, job_id: str):
    """One call. The pool is shown in the job's shuffled order, each with its word count and 'and' flag.
    -> (order, why_winner, losers, shown): `order` indexes `pool` best first, `shown` is the order the ranker saw."""
    shown = shuffled(len(pool), job_id)
    cands = [{"value": pool[i]["value"], "words": pool[i]["words"], "and_flag": pool[i]["and_flag"]} for i in shown]
    order, why, losers = rank(call, RID, cands, context=context)
    return [shown[i] for i in order], why, {shown[i]: w for i, w in losers.items()}, shown


# --------------------------------------------------------------------------------------------- choose

def choose(pool: list[dict], order: list[int]) -> int | None:
    """The index into `pool` of the winner, or None when nothing clears the auto gate. The best-ranked candidate
    that clears auto_gate; when it carries the 'and' flag and the next gate-clearing candidate below it in the
    ranking does not, that one. Nothing else is ever dropped for the flag."""
    ok = [i for i in order if pool[i]["gate_ok"]]
    if not ok:
        return None
    top = ok[0]
    if pool[top]["and_flag"] and len(ok) > 1 and not pool[ok[1]]["and_flag"]:
        return ok[1]
    return top


# ---------------------------------------------------------------------------------------------- pick

def pick(call, job_id: str, *, insight, first_value, parts: dict, strategy, facts, findings, client_words, library,
         n: int = N_CANDIDATES) -> dict:
    """Generate, pool, rank, choose. Nothing is applied. -> a result with an outcome code:
    chosen_new | first_draft_won | no_gate | pool_small | generate_failed | rank_failed.
    `error` carries the exception text of a failed call. The calls made are the caller's to log."""
    res = {"outcome": None, "pool": [], "shown": [], "order": [], "winner": None, "winner_source": None, "error": None}
    payload = generate_payload(insight=insight, strategy=strategy, parts=parts, facts=facts, findings=findings,
                               client_words=client_words, library=library, n=n)
    try:
        new = generate(call, payload, n)
    except Exception as e:  # a failed or empty generation leaves everything as it was
        res.update(outcome="generate_failed", error=f"{type(e).__name__}: {str(e)[:300]}")
        return res
    if not new:
        res["outcome"] = "generate_failed"
        res["error"] = "no usable candidate"
        return res
    pool = build_pool(first_value, new)
    res["pool"] = pool
    if len(pool) < 2:
        res["outcome"] = "pool_small"
        return res
    try:
        order, why, losers, shown = rank_pool(call, pool, rank_context(parts, insight), job_id)
    except Exception as e:
        res.update(outcome="rank_failed", error=f"{type(e).__name__}: {str(e)[:300]}")
        return res
    res.update(order=order, shown=shown, why_winner=why, losers=losers)
    w = choose(pool, order)
    if w is None:
        res["outcome"] = "no_gate"
        return res
    res["winner"], res["winner_source"] = w, pool[w]["source"]
    res["outcome"] = "first_draft_won" if pool[w]["source"] == FIRST_DRAFT else "chosen_new"
    return res
