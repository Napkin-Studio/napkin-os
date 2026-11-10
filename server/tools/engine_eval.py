#!/usr/bin/env python3
"""The offline replay harness for the pre-registered three-idea evaluation (runs/metrics/brief-engine-eval-2026-11-10/
PROTOCOL.md, with its "Review amendments" R1-R12, which win where they differ). Adapted from tools/prop_replay.py.

    cd server && uv sync --frozen && uv run --frozen python tools/engine_eval.py <command> [options]

    select          fix the 20 briefs by the mechanical rule, copy what is needed from the award A/B's stored runs
                    (read-only) into <out>/inputs/, write inputs/selection.json (sha256 of every run log, a
                    timestamp) BEFORE any model call; refuses to select twice          writes inputs/
    smoke           ONE tiny model call through the replay call path, its cost logged   writes cost_log.jsonl
    smoke-rate      ONE rater call on a made-up item, its cost logged                    writes rater_cost_log.jsonl
    pilot           briefs c01 and t01, every arm; then the projection (R5) and the cut decision
                                                                        writes arms/, cost_log.jsonl, pilot.json
    replay          every brief, every arm, per brief in the protocol's order; a settled arm is kept
                                                  writes arms/<id>/<arm>.json, cost_log.jsonl, changes.md (--force)
    packets         blinded rater batches, one question per judgement, items mixed across ideas
                                           writes packets/pNN.json, key.json, rating_prompts.md (frozen first)
    measure-raters  three calls per rater on one synthetic item; projects rater spend; refuses past the cap
                                                                        writes rater_cost_log.jsonl, rater_measure.json
    rate            one fresh `claude -p` per judgement, no tools, neutral system prompt, pinned effort (R1)
                                                      writes ratings/<rater>-<item>.json, rater_cost_log.jsonl
    analyse         unblind and apply sections 6-7 and R4-R11 exactly       writes analysis.json, analysis.md
    cost            the cost logs by purpose and by arm

Every owner's-call item is a named switch in CFG below; nothing else needs touching to change it before the run.
Replay calls go through napkin.model.ModelPort over `claude -p` (as make_port did in prop_replay.py); rater calls are
plain `claude -p`. Nothing here reads or writes client material. Outputs are under runs/metrics/ (gitignored).
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import random
import re
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "server"))

MAIN_CHECKOUT = Path("/Users/saieeshwar/Projects/Work/work/napkin/napkin-studio-os")
SRC_DEFAULT = MAIN_CHECKOUT / "runs/metrics/award-ab-2026-11-10"
OUT_DEFAULT = MAIN_CHECKOUT / "runs/metrics/brief-engine-eval-2026-11-10"
CLAUDE = os.environ.get("CLAUDE_BIN") or str(Path.home() / ".local/bin/claude")
RATER_CWD = Path.home() / ".cache" / "napkin-raters"
RATERS = {"sonnet": "claude-sonnet-5-5", "opus": "claude-opus-5-5"}
SALT = "brief-engine-eval-2026-11-10"

# ============================================================================ the config block (owner's calls)
CFG = {
    # R5: replay spend. HARD is the ceiling no flag raises; the working limit is --max-usd's default.
    "REPLAY_HARD_CAP_USD": 25.0,
    "REPLAY_WORKING_LIMIT_USD": 24.0,
    # R5: rater spend, enforced the same way, in rater_cost_log.jsonl.
    "RATER_HARD_CAP_USD": 40.0,
    # reserve held per rater call before it is made; a failed call is logged at it. Set from the measured cost
    # (rater_measure.json) if the defaults are wrong; the cap is never exceeded whatever they are.
    "RATER_RESERVE_USD": {"sonnet": 0.25, "opus": 0.50},
    # Idea 3 is included (owner). False skips J1 and idea 3's comparisons; J0 and J0' still run, because they are the
    # survival reviews' baseline (F2).
    "INCLUDE_IDEA3": True,
    # Idea 3's counter_argument pass rule: "reviewer" (default: the reviewer's alternative wording) or "protocol"
    # (the protocol's original wording).
    "IDEA3_COUNTER_ARGUMENT_RULE": "reviewer",
    # No plain best-of-8 insight arm (T1p) unless True. It costs about 4 USD more replay: the hard cap would have
    # to cover it (REPLAY_HARD_CAP_USD is the hard ceiling; there is no override here that exceeds the owner's 25).
    "INCLUDE_PLAIN_BEST_OF_8": False,
    # D0 v B (the stored default-effort draft against the medium baseline) is not rated unless True (80 judgements).
    "INCLUDE_D0_V_B": False,
    # The investigator does not see plan.strategy (as the protocol specifies) unless True.
    "INVESTIGATOR_SEES_STRATEGY": False,
    # R1: the raters.
    "RATER_EFFORT": "medium",
    "RATER_MAX_REASKS": 3,         # R2: an unusable answer is asked again at most 3 times
    "PACKET_SIZE": 40,
    "REPLAY_WORKERS": 2,           # calls in flight at once
    "RATER_WORKERS": 2,
    "CALL_TIMEOUT_S": 900,
    # F3: infrastructure errors (no envelope, is_error, auth, usage limit, overload, timeout) never count against an
    # arm or a rater; this many in a row stop the run cleanly. The wait between tries grows with the streak.
    "INFRA_STOP_AFTER": 3,
    "INFRA_BACKOFF_S": 20,
}
REPLAY_MODEL_ID = "claude-sonnet-5-5"

# R5: reserve per purpose, held before every replay call and released when it is logged.
RESERVE_USD = {"draft_brief_whole": 0.50, "explain_flags": 0.25, "rewrite_brief_parts": 0.25, "insight_hypotheses": 0.25}
RESERVE_DEFAULT_USD = 0.10
# Protocol section 8's planned calls per arm and purpose (the table's "calls per brief"; its rewrites row is "about 4" for
# the three review arms, so 4/3 each), and its per-call cost estimates, used only for a purpose the pilot never called.
ARM_PLAN = {"B": {"draft_brief_whole": 1}, "C1": {"draft_brief_whole": 1}, "T1": {"draft_brief_whole": 1},
            "H1": {"insight_hypotheses": 1, "rank_insight": 1},
            "L": {"candidates_smp": 1, "rank_smp": 1}, "L2": {"candidates_smp": 1, "rank_smp": 1}, "S": {"candidates_smp": 1, "rank_smp": 1},
            "J0": {"explain_flags": 1, "rewrite_brief_parts": 4 / 3}, "J0p": {"explain_flags": 1, "rewrite_brief_parts": 4 / 3},
            "J1": {"explain_flags": 1, "rewrite_brief_parts": 4 / 3},
            "SV1": {"explain_flags": 1}, "SV2": {"explain_flags": 1},
            "H1p": {"insight_hypotheses": 1, "rank_insight": 1}, "T1p": {"draft_brief_whole": 1}}
PROTOCOL_COST_ESTIMATE_USD = {"draft_brief_whole": 0.13, "insight_hypotheses": 0.07, "rank_insight": 0.011, "candidates_smp": 0.032,
                              "rank_smp": 0.011, "explain_flags": 0.035, "rewrite_brief_parts": 0.045}
# max_tokens per purpose (planned.py:568, checkloop.py:176, :221, and the saved make_call default for the rest)
MAX_TOKENS = {"draft_brief_whole": 16000, "explain_flags": 6000, "rewrite_brief_parts": 8000}
MAX_TOKENS_DEFAULT = 12000
# the effort routes: server/model-routes.example.json plus these two (protocol section 4)
EXTRA_ROUTES = {"insight_hypotheses": {"effort": "medium"}, "candidates_smp": {"effort": "medium"}}

# ============================================================================ the pre-registered numbers (fixed)
MIN_DECIDED = 5            # SR: W + L at least 5
MIN_WINS = 8               # SR: W at least 8
SIGN_ALPHA = 0.05
# the protocol's table (section 7); a test checks `sign_threshold` reproduces it from the binomial
SIGN_TABLE = {5: 5, 6: 6, 7: 7, 8: 7, 9: 8, 10: 9, 11: 9, 12: 10, 13: 10, 14: 11, 15: 12, 16: 12, 17: 13, 18: 13,
              19: 14, 20: 15}
COST_LINE_USD, COST_LINE_SECS = 0.15, 60.0
X_BIAS_MAX = 0.65
STEPS_MIN_OF_20 = 18
MARGIN_NET = 4             # net margins over a control
EXTRA_MAX = 2              # "at most 2 more briefs"
LENGTH_SHARE, LENGTH_BRIEFS = 0.75, 15   # R4
MEDIAN_IDEAS_MIN = 5
SUB_POOL_GAIN = 1
PROJECTION_MARGIN = 1.10
PROJECTION_CUT_USD = 23.0
INSIGHT_MAX_WORDS, SMP_MAX_WORDS, SENT_BACK_MARGIN = 50, 20, 1.15
PILOT_BRIEFS = ("c01", "t01")
SURVIVAL_ARMS = ("SV1", "SV2")

# ============================================================================ the frozen prompts
# R2: proposition items use the saved harness's PAIR_PROMPT verbatim (PREV/rating_prompts.md).
PROPOSITION_PROMPT = """You are a senior advertising planner. A client wrote the brief below. Two planners each wrote an insight and a single-minded proposition (their reasons to believe and the objection the proposition has to beat are left out here). Decide which PROPOSITION is better for this brief, reading each with its own insight. Do not pick a draft because its insight is more interesting: judge the proposition alone.

The tests. Single minded: one thought, not a thought with an and. True: supported by a reason to believe. Motivating: to the audience defined, not to the client. Ownable: the main competitor could not put their logo on it. Generative: ideas fall out of it; if only one ad fits it is too tight, if any ad fits it is too loose. Length and polish are not merits.

CLIENT BRIEF:
{brief}

DRAFT X
Insight: {x_insight}
Proposition: {x_smp}

DRAFT Y
Insight: {y_insight}
Proposition: {y_smp}

Answer with JSON only: {{"better": "X" | "Y" | "no real difference", "reason": "one sentence"}}"""

INSIGHT_PROMPT = """You are a senior advertising planner. A client wrote the brief below. Two planners each wrote an insight for it (the rest of each draft is left out here). Decide which INSIGHT is better for this brief.

The tests. True: the audience would nod and feel seen (you cannot check facts about an invented audience, only whether the brief supports it). About the audience: not a boast about the brand or a fact about the product. Fresh: not a category cliche anyone could have written. Role: it hands the product a role to play. Length and polish are not merits.

CLIENT BRIEF:
{brief}

DRAFT X
Insight: {x_insight}

DRAFT Y
Insight: {y_insight}

Answer with JSON only: {{"better": "X" | "Y" | "no real difference", "reason": "one sentence"}}"""

SAME_IDEA_PROMPT = """Here are {n} {kind} written for the same brief. Put together the ones that say the same thing in different words. JSON only: {{"groups": [[numbers], ...]}}

{listing}"""

RATER_SYSTEM = "You are an impartial judge. Answer only with the JSON asked for."

# ============================================================================ the added prompt text (protocol 5.1-5.3)
INSIGHT_REASON_FROM = ("Reason from the client's words, the captured parts, the facts and findings, and the precedent "
                       "passages if any are given.")
INVESTIGATOR_NOTE = (
    "For each insight: evidence, behavioural mechanism, tension, counterevidence, relevance, brand connection; no "
    "fabricated research. Any proposed insight describes a meaningful human mechanism, not just a market observation. "
    "No invented quotes, statistics, consumer interviews, market shares, or sources."
    " Return for each: value (the insight as it would stand in the brief), mechanism (one line: why people do this), "
    "tension (one line: the two things pulling against each other), counter_evidence (one line: the strongest thing in "
    "the input, or generally known, that says this is not true or not the reason; say \"none in the input\" when there "
    "is none), brand_role (one line: the role it hands the product) and cites (the ids it rests on: fact ids f_..., "
    "capture ids cap_..., passage ids psg_..., exactly as they appear in the input; [] when it rests on none). A figure "
    "must come from a fact in the input.")
INSIGHT_RANK_NOTE = (
    "The context holds what the candidates were written from. Each candidate carries its counter-evidence: weigh it. "
    "An insight its own counter-evidence defeats ranks last.")
RESET_MUST_SAY = "Follow from the insight in this plan."

MUST_BE_TRUE = ("What must be true for it to work? It fails when something that must be true is contradicted by the "
                "brief or the facts. Something that is only unproven or marked to confirm is a question for the "
                "client, not a fail.")
COUNTER_ARGUMENT = {
    "protocol": "What is the strongest counterargument? It fails when nothing in the brief answers it.",
    # the reviewer's alternative wording ("Not adopted / owner's call", item 3)
    "reviewer": ("What is the strongest counterargument? It fails when the counter-argument defeats the proposition "
                 "itself; a doubt the reasons to believe or the objection should answer is not a fail."),
}
JUDE_J1_SENTENCE = ("For the proposition also answer must_be_true and counter_argument, one sentence each, and use "
                    "them in your instruction.")

PROP, INS = "single_minded_proposition", "insight"
QPROP = "proposition"       # the question a pair item asks (the part key is PROP)


# ============================================================================ pure: selection (protocol 2)
def select_runs(entries: list[dict], ids: list[str] | None = None) -> list[str]:
    """The mechanical rule: every id of the briefs file in id order; for each, the run `<id>-off`, taken only when it
    ended 'done' (`list_source` decides that; `extract_input` the rest). `entries`: [{"name", "state"}]. A run that is
    not taken is left out here; `cmd_select` records why."""
    state = {e["name"]: e.get("state") for e in entries}
    ids = sorted(ids) if ids is not None else sorted({e["name"][:-4] for e in entries if re.search(r"-off$", e["name"])})
    return [f"{i}-off" for i in ids if state.get(f"{i}-off") == "done"]


def list_source(src: Path) -> list[dict]:
    out = []
    for d in sorted((src / "runs").iterdir()):
        if not d.is_dir():
            continue
        state = None
        try:
            s = json.loads((d / "summary.json").read_text())
            end = next((json.loads(l) for l in reversed((d / "runlog.jsonl").read_text().splitlines())
                        if '"job_end"' in l), None)
            if s.get("final_state") == "done" and end and end.get("state") == "done":
                state = "done"
        except (OSError, ValueError):
            pass
        out.append({"name": d.name, "state": state})
    return out


def extract_input(name: str, runlog_lines: list[str]) -> dict:
    """What the replay needs of one stored run: the draft_brief_whole payload as stored and the first draft (D0)."""
    evs = [json.loads(l) for l in runlog_lines if '"draft_brief_whole"' in l]
    evs = [e for e in evs if e.get("ev") == "model" and e.get("purpose") == "draft_brief_whole"]
    if len(evs) != 1:
        raise ValueError(f"{name}: expected one draft_brief_whole call, found {len(evs)}")
    e = evs[0]
    payload, reply = e["payload"]["payload"], e["reply"]
    for k in (INS, PROP):
        if not isinstance((reply.get(k) or {}).get("value"), str):
            raise ValueError(f"{name}: the first draft has no {k}")
    from napkin.brief.planned import DRAFT_SYSTEM
    return {"name": name, "id": name.rsplit("-", 1)[0], "brief_text": payload["client_said"], "payload": payload,
            "system_is_draft_system": e["payload"].get("system") == DRAFT_SYSTEM,
            "first_draft": {k: (v or {}).get("value") for k, v in reply.items() if isinstance(v, dict)},
            "source_call": {"secs": e.get("secs"), "cost": e.get("cost"), "in_tokens": e.get("in_tokens"),
                            "out_tokens": e.get("out_tokens")}}


# ============================================================================ pure: text, blinding
_LABEL = re.compile(r"(?i)^\s*(to confirm|draft for testing|draft for confirmation|working proposal|hypothesis to test|"
                    r"hypothesis|assumption|proposed)\s*:\s*")


def tidy(text) -> str:
    """A text as a rater sees it (R3): any leading label removed, repeatedly; the first character capitalised; one final
    full stop dropped; surrounding and doubled white space gone (a line break is a tell too)."""
    t = str(text or "")
    while True:
        u = _LABEL.sub("", t, count=1)
        if u == t:
            break
        t = u
    t = re.sub(r"\s+", " ", t).strip()
    if t:
        t = t[0].upper() + t[1:]
    return t[:-1].rstrip() if t.endswith(".") and not t.endswith("..") else t


_LEFT_LABEL = re.compile(r"^\s*(\S+\s+){0,4}?\S+:")


def leftover_label(text: str) -> bool:
    """R3's report: a shown text that still begins with four or fewer words followed by a colon."""
    return bool(re.match(r"^\s*(?:\S+\s+){0,3}\S+:", str(text or "")))


PRIMARY_COMPARISONS = ("T1vC1.ins", "SvO", "R1vR0")
LEFTOVER_ARMS = ("B", "C1", "T1", "S", "L", "L2", "J0", "J0p", "J1")
_SIDE_OF_ARM = {"J0": "R0", "J0p": "R0p", "J1": "R1"}


def words(text) -> int:
    return len(str(text or "").split())


def coin(*parts) -> int:
    return hashlib.sha256("|".join((SALT,) + tuple(str(p) for p in parts)).encode()).digest()[0] & 1


def opaque(*parts) -> str:
    return hashlib.sha256("|".join((SALT, "id") + tuple(str(p) for p in parts)).encode()).hexdigest()[:10]


def _shuf_key(tag, item) -> str:
    return hashlib.sha256(f"{SALT}|{tag}|{item}".encode()).hexdigest()


def render_pair(question: str, brief: str, x: tuple, y: tuple) -> str:
    """`x`, `y`: (insight, proposition), already tidy."""
    if question == "insight":
        return INSIGHT_PROMPT.format(brief=brief.strip(), x_insight=x[0], y_insight=y[0])
    return PROPOSITION_PROMPT.format(brief=brief.strip(), x_insight=x[0], y_insight=y[0], x_smp=x[1], y_smp=y[1])


def pair_items(brief: str, brief_text: str, comparison: str, question: str, a: tuple, b: tuple) -> list[dict]:
    """The two items (order 1 and its swapped twin) of one comparison, `a` the first-named side. `a`, `b`:
    (insight, proposition), tidy. Which side is X in order 1 is a seeded coin; order 2 swaps. The item carries no arm
    name; its id is a hash of the content; `key` (kept apart) holds the arm names."""
    swap = coin("pos", brief, comparison, question)
    out = []
    for order in (1, 2):
        a_is_x = (swap == 0) == (order == 1)
        x, y = (a, b) if a_is_x else (b, a)
        item = opaque("pair", brief, comparison, question, order, *x, *y)
        out.append({"item": item, "question": question, "prompt": render_pair(question, brief_text, x, y),
                    "meta": {"brief": brief, "comparison": comparison, "question": question, "order": order,
                             "a_is_x": a_is_x}})
    return out


def assign_packets(items: list[dict], size: int, twin_of) -> list[list[dict]]:
    """Seeded shuffle, then first fit into packets of at most `size`, an item and its swapped twin never together."""
    packets: list[list[dict]] = []
    for it in sorted(items, key=lambda i: _shuf_key("packet", i["item"])):
        for p in packets:
            if len(p) < size and all(twin_of(q) != twin_of(it) for q in p):
                p.append(it)
                break
        else:
            packets.append([it])
    return packets


# ============================================================================ pure: sign rule, outcomes, tallies
def sign_threshold(n: int) -> int:
    """c(n): the smallest count whose one-sided binomial chance under no effect (p = 1/2, n decided briefs) is 5% or
    less. Exact integer arithmetic."""
    tail = 0
    for k in range(n, -1, -1):
        tail += math.comb(n, k)
        if tail * 20 > 2 ** n:          # tail / 2^n > 0.05
            return k + 1
    return 0


def sign_rule(W: int, L: int) -> bool:
    n = W + L
    return n >= MIN_DECIDED and W >= MIN_WINS and W >= sign_threshold(n)


def score_sum(scores: dict) -> int | None:
    """Four judgements (two raters x two orders): +1 first-named side, -1 the other, 0 no real difference; None when
    any is missing (never a score)."""
    flat = [x for r in RATERS for x in scores.get(r, [None, None])]
    return None if any(x is None for x in flat) or len(flat) != 4 else sum(flat)


def brief_outcome(scores: dict) -> str | None:
    s = score_sum(scores)
    return None if s is None else ("W" if s >= 2 else "L" if s <= -2 else "T")


def rater_outcome(pair: list) -> str | None:
    """One rater alone: a win only when both orders pick the side."""
    if any(x is None for x in pair) or len(pair) != 2:
        return None
    t = sum(pair)
    return "W" if t == 2 else "L" if t == -2 else "T"


def tally(units: dict) -> dict:
    """`units`: {brief: {"tie": reason} | {"scores": {rater: [o1, o2]}}}. -> W, L, T, net, the briefs with a missing
    judgement, and the same count for each rater alone. A missing judgement is never a score: the brief is in
    `missing` and counted in no column."""
    t = {"W": 0, "L": 0, "T": 0, "missing": [], "per_rater": {r: {"W": 0, "L": 0, "T": 0} for r in RATERS}}
    for b, u in sorted(units.items()):
        if "tie" in u:
            t["T"] += 1
            for r in RATERS:
                t["per_rater"][r]["T"] += 1
            continue
        o = brief_outcome(u["scores"])
        if o is None:
            t["missing"].append(b)
            continue
        t[o] += 1
        for r in RATERS:
            t["per_rater"][r][rater_outcome(u["scores"][r])] += 1
    t["net"] = t["W"] - t["L"]
    return t


def each_rater_ahead(t: dict) -> bool:
    return all(v["W"] > v["L"] for v in t["per_rater"].values())


def swap_tally(t: dict) -> dict:
    """The same comparison read from the other side (W and L exchange)."""
    s = copy.deepcopy(t)
    s["W"], s["L"] = t["L"], t["W"]
    s["net"] = -t["net"]
    for v in s["per_rater"].values():
        v["W"], v["L"] = v["L"], v["W"]
    return s


# ============================================================================ pure: variety (same-idea items)
def _num(x):
    if isinstance(x, bool):
        return None
    if isinstance(x, float) and x == int(x):
        x = int(x)
    elif isinstance(x, str) and x.strip().isdigit():
        x = int(x.strip())
    return x if isinstance(x, int) else None


def distinct_ideas(groups, n: int, keep: set | None = None) -> int | None:
    """The number of distinct ideas a rater's grouping leaves among numbers 1..n; a number left out is its own idea; a
    number named twice counts in its first group. `keep`: derive the count for a sub-pool (R2): only those numbers
    are looked at, the others are ignored, a kept number left alone is its own idea. None when the answer cannot be
    read as lists of numbers 1..n (missing, never the most favourable count)."""
    if not isinstance(groups, list) or not all(isinstance(g, list) for g in groups):
        return None
    universe = set(range(1, n + 1)) if keep is None else set(keep)
    seen, count = set(), 0
    for g in groups:
        nums = set()
        for x in g:
            v = _num(x)
            if v is None or not 1 <= v <= n:
                return None
            nums.add(v)
        fresh = (nums & universe) - seen
        if fresh:
            count += 1
            seen |= fresh
    return count + len(universe - seen)


def median_of(vals):
    vals = list(vals)
    return statistics.median(vals) if vals else None


# ============================================================================ pure: code checks, send-backs
def code_flags(text, kind: str) -> dict:
    """What code can measure about a shown text (protocol section 6, "Code checks")."""
    from napkin.brief import candidates
    from napkin.brief.rubric import REVIEW, _sentences, _single_minded
    t = candidates.unmarked(text)
    n = words(t)
    lim = INSIGHT_MAX_WORDS if kind == "insight" else SMP_MAX_WORDS
    f = {"words": n, "over_limit": n > lim, "sent_back_length": n > lim * SENT_BACK_MARGIN}
    if kind != "insight":
        f.update({"multi_sentence": len(_sentences(t)) > 1, "standalone_and": candidates.standalone_and(t),
                  "single_minded_flag": _single_minded({}, t)[0] == REVIEW,
                  "colon_semicolon_dash": bool(re.search(r"[:;–—]|\s-\s", t))})
        f["fails_code_check"] = f["over_limit"] or f["multi_sentence"] or f["standalone_and"]
    else:
        f["fails_code_check"] = f["over_limit"]
    return f


def code_sendbacks(whole: dict) -> list[str]:
    from napkin.brief import checks
    return [x["part"] for x in checks.revisions(whole)]


# ============================================================================ pure: the plan edit, payloads (5.1)
def edit_plan(payload: dict, insight: str | None = None) -> dict:
    """C1 and T1 (protocol 5.1): the proposition's and the objection's `must_say` reset to the same line; T1 also gets
    the chosen insight as the insight's `must_say` (R8: only `must_say`; `rests_on` and `who_handles` stay)."""
    p = copy.deepcopy(payload)
    parts = p.setdefault("plan", {}).setdefault("parts", {})
    for k in (PROP, "objection"):
        parts.setdefault(k, {})["must_say"] = RESET_MUST_SAY
    if insight is not None:
        parts.setdefault(INS, {})["must_say"] = insight
    return p


def investigator_payload(payload: dict, sees_strategy: bool | None = None) -> dict:
    """What the investigator receives (5.1): from the stored draft payload, client_said, captured, client_words,
    facts, findings, research_upstream, library, and from the plan only brand, competitors and the audience,
    background and competitor_context parts. Not the strategy (unless the switch), the insight, nor the plan's
    other `must_say`s. Never the first draft."""
    sees = CFG["INVESTIGATOR_SEES_STRATEGY"] if sees_strategy is None else sees_strategy
    plan = payload.get("plan") or {}
    keep = {k: (plan.get("parts") or {}).get(k) for k in ("audience", "background", "competitor_context")}
    p = {k: payload.get(k) for k in ("client_said", "captured", "client_words", "facts", "findings",
                                     "research_upstream", "library")}
    p["plan"] = {"brand": plan.get("brand"), "competitors": plan.get("competitors"),
                 "parts": {k: v for k, v in keep.items() if v is not None}}
    if sees:
        p["plan"]["strategy"] = plan.get("strategy")
    p["write"] = 8
    return p


def hypothesis_schema(n: int = 8, plain: bool = False) -> dict:
    from napkin.brief.drafters import _obj
    props = {"value": {"type": "string", "minLength": 1}}
    if not plain:
        props.update({"mechanism": {"type": "string"}, "tension": {"type": "string"},
                      "counter_evidence": {"type": "string"}, "brand_role": {"type": "string"},
                      "cites": {"type": "array", "items": {"type": "string"}}})
    return _obj({"hypotheses": {"type": "array", "minItems": 1, "maxItems": n, "items": _obj(props)}})


def investigator_system(plain: bool = False) -> str:
    from napkin.brief.drafters import field_system
    s = field_system("insight", 8, grounds=False, reason_from=INSIGHT_REASON_FROM)
    return s if plain else s + "\n" + INVESTIGATOR_NOTE


def known_ids(payload: dict) -> set:
    ids = {x.get("id") for k in ("facts", "client_words", "library") for x in (payload.get(k) or []) if isinstance(x, dict)}
    return {i for i in ids if isinstance(i, str)}


def clean_hypotheses(raw: dict, plan_insight: str, ids: set) -> list[dict]:
    """The hypotheses as kept: `_clean_value` on each, empty values and exact duplicates dropped, and a copy of the
    plan's own insight too (it is in the pool already and never chosen). `cites` split into those that resolve."""
    from napkin.brief.drafters import _clean_value
    seen, out = {tidy(plan_insight)}, []
    for h in raw.get("hypotheses") or []:
        v = _clean_value("insight", h.get("value"))
        if not v or tidy(v) in seen:
            continue
        seen.add(tidy(v))
        cites = [c for c in h.get("cites") or [] if isinstance(c, str)]
        out.append({"value": v, "mechanism": h.get("mechanism", ""), "tension": h.get("tension", ""),
                    "counter_evidence": h.get("counter_evidence", ""), "brand_role": h.get("brand_role", ""),
                    "cites": cites, "cites_resolve": [c for c in cites if c in ids],
                    "cites_dangling": [c for c in cites if c not in ids]})
    return out


def rests_on_of(cites_resolve: list[str]) -> str:
    """What the chosen hypothesis's cites resolve to (recorded, not applied: R8)."""
    if any(c.startswith("f_") for c in cites_resolve):
        return "research"
    if any(c.startswith("psg_") for c in cites_resolve):
        return "library"
    return "assumption"


def insight_pool(hyps: list[dict], plan_insight: str) -> list[dict]:
    """The new hypotheses then the plan's insight, which carries no counter-evidence of its own (R8). Shown texts are
    tidy (R3)."""
    pool = [{"value": h["value"], "text": tidy(h["value"]), "source": f"hyp:{i}", "idx": i,
             "counter_evidence": h["counter_evidence"], "cites": h["cites"]} for i, h in enumerate(hyps)]
    pool.append({"value": plan_insight, "text": tidy(plan_insight), "source": "plan", "idx": None,
                 "counter_evidence": "", "cites": []})
    for p in pool:
        p["words"] = words(p["text"])
    return pool


def choose_insight(pool: list[dict], order: list[int]) -> int | None:
    """The best-ranked NEW hypothesis of at most 50 words; the plan's insight is ranked but never chosen."""
    for i in order:
        if pool[i]["source"] != "plan" and pool[i]["words"] <= INSIGHT_MAX_WORDS:
            return i
    return None


def rank_context_insight(payload: dict) -> dict:
    """{audience, background, competitor_context, client_said} from `captured`, else the plan's `must_say`."""
    cap = payload.get("captured") or {}
    parts = (payload.get("plan") or {}).get("parts") or {}
    ctx = {}
    for k in ("audience", "background", "competitor_context"):
        v = cap.get(k) or (parts.get(k) or {}).get("must_say")
        if v:
            ctx[k] = v
    ctx["client_said"] = str(payload.get("client_said") or "")[:8000]
    return ctx


# ============================================================================ pure: idea 3 (5.3, R10)
def jude_variant_payload(payload: dict, whole: dict, variant: str) -> tuple[dict, list, list]:
    """The review slice's payload (R10): `empty` = the parts of the brief that are not filled, open_questions excepted;
    `chain_holds` 0.8; nothing flagged. -> (payload, tested, ask). J1 adds the two entries to the proposition's tests."""
    from napkin.brief import checks
    from napkin.brief.fields import KEYS, filled
    values = {k: v["value"] for k, v in whole.items()}
    open_keys = list(payload["parts"])
    empty = [k for k in open_keys if not filled(values.get(k)) and k != "open_questions"]
    tested = [k for k in checks.TESTED if k in whole]
    pay = {"brief": {k: values.get(k) for k in KEYS if filled(values.get(k))},
           "client_said": str(payload.get("client_said") or "")[:8000], "flagged": {}, "empty": empty,
           "chain_holds": 0.8, "missing_dimensions": {}, "facts": payload.get("facts") or [],
           "findings": payload.get("findings") or [], "claims": {}, "tested": tested,
           "tests": checks.tests(tested), "part_checks": checks.facts(whole)}
    if variant == "J1" and PROP in pay["tests"]:
        pay["tests"][PROP] = {**pay["tests"][PROP], "must_be_true": MUST_BE_TRUE,
                              "counter_argument": COUNTER_ARGUMENT[CFG["IDEA3_COUNTER_ARGUMENT_RULE"]]}
    return pay, tested, empty


def jude_variant_schema(ask: list, tested: list, variant: str) -> dict:
    from napkin.brief import checkloop
    sch = checkloop.jude_schema(ask, tests=tested)
    if variant == "J1" and PROP in tested:
        node = sch["properties"]["tests"]["properties"][PROP]
        for k in ("must_be_true", "counter_argument"):
            node["properties"][k] = {"type": "string"}
            node["required"].append(k)
    return sch


def jude_variant_system(tested: list, variant: str) -> str:
    from napkin.brief import checkloop
    s = checkloop.jude_system(tested)
    return s + "\n" + JUDE_J1_SENTENCE if variant == "J1" else s


def todo_from_jude(jude: dict, ask: list, tested: list, whole: dict, open_keys: list) -> dict:
    """checkloop.run's logic from `todo = ...` to the end of the checks (checkloop.py:171-211), over Jude's whole
    answer: his part notes, the chain issue, the dimension fixes, then a failed test; then code's instruction only for
    a part he named nothing for. -> {"todo", "by", "unanswered", "failed", "sent"}."""
    from napkin.brief import checks
    todo = {k: v["instruction"] for k, v in (jude.get("parts") or {}).items()
            if k in ask and v.get("rework") and str(v.get("instruction") or "").strip()}
    by = {k: "jude" for k in todo}
    chain = jude.get("chain") or {}
    if chain.get("issue"):
        for k in chain.get("parts") or []:
            if k in open_keys and k != "open_questions":
                todo.setdefault(k, f"Make it follow the brief's one argument: {chain['issue']}")
                by.setdefault(k, "jude")
    for d in jude.get("dimensions") or []:
        ins = str(d.get("instruction") or "").strip()
        for k in d.get("parts") or []:
            if ins and k in open_keys and k != "open_questions":
                todo[k] = (todo[k] + " Also: " + ins) if k in todo else ins
                by.setdefault(k, "jude")
    unanswered, failed = [], []
    for k in tested:
        t = (jude.get("tests") or {}).get(k)
        if not isinstance(t, dict) or "pass" not in t:
            unanswered.append(k)
            continue
        ins = str(t.get("instruction") or "").strip() or (
            f"Fix what fails the {t['failed_test']} test." if str(t.get("failed_test") or "").strip() else "")
        if t["pass"] is False and ins:
            failed.append(k)
            todo[k] = (todo[k] + " Also: " + ins) if k in todo else ins
            by.setdefault(k, "jude")
    sent = checks.revisions(whole)
    extra = [x for x in sent if x["part"] not in todo]
    for x in extra:
        todo[x["part"]] = x["instruction"]
        by[x["part"]] = "code"
    for x in sent:
        if by.get(x["part"]) == "jude" and x["part"] not in [e["part"] for e in extra]:
            by[x["part"]] = "both"
    return {"todo": todo, "by": by, "unanswered": unanswered, "failed": failed, "sent": [x["part"] for x in sent]}


def jude_fails(jude: dict, key: str) -> bool:
    t = (jude.get("tests") or {}).get(key)
    return isinstance(t, dict) and t.get("pass") is False


def survival_counts(jude: dict, whole: dict) -> dict:
    sb = code_sendbacks(whole)
    return {"jude_fails_proposition": jude_fails(jude, PROP), "jude_fails_insight": jude_fails(jude, INS),
            "code_sends_proposition": PROP in sb, "code_sends_insight": INS in sb,
            "unanswered": [k for k in ("single_minded_proposition", "insight")
                           if not isinstance((jude.get("tests") or {}).get(k), dict)
                           or "pass" not in (jude.get("tests") or {}).get(k)]}


def substitute_proposition(whole: dict, value: str) -> dict:
    """The survival slice for S's winner (R9): the winner takes B's proposition entry (basis and cites), and the
    marking runs on the substituted brief as production would mark a placed proposition."""
    from napkin.brief import checks
    w = copy.deepcopy(whole)
    w[PROP] = {**w[PROP], "value": value}
    checks.mark_assumptions(w)
    return w


# ============================================================================ the cost log (R5)
class BudgetExceeded(RuntimeError):
    pass


class StopRun(Exception):
    """The run stops here and can be resumed (R5 budget, or an outage): not a failed arm."""


class InfraError(RuntimeError):
    """The CLI or the service is down or refusing (no JSON envelope, `is_error` with no model output, auth, usage
    limit or overload, a timeout). It says nothing about the model's work: it is never an arm failure and never uses
    up an arm's two runs or a rater's re-asks (R6, R2)."""


class InfraStop(StopRun, InfraError):
    """Too many infrastructure errors in a row (CFG INFRA_STOP_AFTER): the whole run stops, cleanly."""


class InfraGate:
    """Counts infrastructure errors in a row, across threads; any answer from the CLI resets it. At the limit it
    halts: every later call refuses at once (no spend), so every worker stops."""

    def __init__(self):
        self.streak, self.halted, self.recent, self.lock = 0, None, [], threading.Lock()

    def ok(self):
        with self.lock:
            self.streak = 0

    def check(self):
        if self.halted:
            raise InfraStop(self.halted)

    def hit(self, err: InfraError) -> InfraError:
        """Count one; -> the error to raise (an InfraStop at the limit)."""
        with self.lock:
            self.streak += 1
            self.recent = (self.recent + [str(err)[:200]])[-CFG["INFRA_STOP_AFTER"]:]
            if self.streak >= CFG["INFRA_STOP_AFTER"]:
                self.halted = (f"stopped after {self.streak} infrastructure errors in a row (the CLI or the service is not "
                               f"answering; last: {self.recent[-1]}). Nothing was marked failed and no arm or rating was "
                               f"used up: run the same command again when the CLI answers, and it resumes.")
                return InfraStop(self.halted)
        return err


class CostLog:
    """A cost log with a hard cap and reservation (R5): `reserve` refuses a call unless spent + reserved in flight +
    this call's reserve fits the cap, under the lock; `settle` releases the reserve and logs the call. The cost is the
    envelope's own `total_cost_usd` whenever it is a number, failed call or not; only a call with no envelope (or no
    usable figure) is logged at its reserve, not at 0, because the CLI may have spent."""

    def __init__(self, path: Path, max_usd: float, hard_cap: float, reserve_for):
        self.path, self.cap, self.reserve_for = path, min(max_usd, hard_cap), reserve_for
        self.spent, self.reserved, self.lock = 0.0, 0.0, threading.Lock()
        self.gate = InfraGate()
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            self.spent = sum(json.loads(l).get("cost_usd") or 0 for l in path.read_text().splitlines() if l.strip())

    def reserve(self, purpose: str) -> float:
        r = self.reserve_for(purpose)
        with self.lock:
            if self.spent + self.reserved + r > self.cap + 1e-9:
                raise BudgetExceeded(f"spent {self.spent:.2f} + in flight {self.reserved:.2f} + reserve {r:.2f} "
                                     f"would pass the cap {self.cap:.2f} USD")
            self.reserved += r
        return r

    def settle(self, held: float, rec: dict):
        cost = rec.get("cost_usd")
        assumed = not _is_cost(cost)
        if assumed:
            cost = held
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()), **rec, "cost_usd": cost,
               "cost_assumed_at_reserve": bool(assumed), "reserve_usd": held}
        with self.lock:
            self.reserved -= held
            self.spent += cost
            with self.path.open("a") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def replay_cost_log(out: Path, max_usd: float | None = None) -> CostLog:
    cap = CFG["REPLAY_WORKING_LIMIT_USD"] if max_usd is None else max_usd
    return CostLog(out / "cost_log.jsonl", cap, CFG["REPLAY_HARD_CAP_USD"],
                   lambda p: RESERVE_USD.get(p, RESERVE_DEFAULT_USD))


def rater_cost_log(out: Path) -> CostLog:
    # the reserve of a rater call depends on the model: carried in the purpose string "rate:<rater>"
    return CostLog(out / "rater_cost_log.jsonl", CFG["RATER_HARD_CAP_USD"], CFG["RATER_HARD_CAP_USD"],
                   lambda p: CFG["RATER_RESERVE_USD"].get(p.split(":", 1)[-1], 0.5))


def cost_summary(rows: list[dict]) -> dict:
    by: dict = {}
    for r in rows:
        k = r.get("purpose") or "?"
        d = by.setdefault(k, {"calls": 0, "usd": 0.0, "failed": 0, "assumed": 0})
        d["calls"] += 1
        d["usd"] = round(d["usd"] + (r.get("cost_usd") or 0), 6)
        d["failed"] += not r.get("ok", True)
        d["assumed"] += bool(r.get("cost_assumed_at_reserve"))
    return by


def planned_per_brief(include_survival: bool = True) -> dict:
    """Section 8's planned calls per brief, by purpose, for the arms this run will make."""
    skip = effective_skip(() if include_survival else SURVIVAL_ARMS)
    out: dict = {}
    for name, _, _ in arm_specs():
        if name not in skip:
            for p, n in ARM_PLAN.get(name, {}).items():
                out[p] = out.get(p, 0) + n
    return out


def project_replay(rows: list[dict], n_pilot: int, n_total: int, include_survival: bool = True) -> dict:
    """R5: the projection after the pilot. For each purpose, the median cost of the pilot's calls of that purpose times
    its planned calls for all briefs, plus 10%. Planned calls per brief = the larger of the pilot's own frequency (its
    calls of that purpose per pilot brief, retries included) and section 8's planned count, so a purpose the pilot
    happened to call less often (a rewrite no brief needed) is never projected below the protocol's plan. A purpose the
    pilot never called takes section 8's per-call estimate. The smoke call is excluded; survival rows (arm SV*) leave out
    when `include_survival` is false."""
    use = [r for r in rows if r.get("purpose") not in (None, "smoke") and r.get("job") != "smoke"
           and (include_survival or not str(r.get("arm") or "").startswith(SURVIVAL_ARMS))]
    by: dict = {}
    for r in use:
        by.setdefault(r["purpose"], []).append(r.get("cost_usd") or 0)
    plan = planned_per_brief(include_survival)
    per = {}
    total = 0.0
    for p in sorted(set(by) | set(plan)):
        costs = by.get(p, [])
        freq = len(costs) / n_pilot
        per_brief = max(freq, plan.get(p, 0))
        med = statistics.median(costs) if costs else PROTOCOL_COST_ESTIMATE_USD.get(p, RESERVE_USD.get(p, RESERVE_DEFAULT_USD))
        per[p] = {"median_usd": med, "median_from": "pilot" if costs else "protocol estimate", "pilot_calls": len(costs),
                  "pilot_per_brief": freq, "protocol_per_brief": plan.get(p, 0), "planned_calls": per_brief * n_total,
                  "usd": med * per_brief * n_total}
        total += per[p]["usd"]
    return {"per_purpose": per, "total_usd": round(total * PROJECTION_MARGIN, 4), "survival_included": include_survival}


def cut_decision(rows: list[dict], n_pilot: int, n_total: int) -> dict:
    """R5 cut order: above 23 USD drop the survival reviews; still above, stop. L2, J0', C1 and every primary arm are
    never cut."""
    full = project_replay(rows, n_pilot, n_total, True)
    if full["total_usd"] <= PROJECTION_CUT_USD:
        return {"decision": "run_all", "projection": full}
    lean = project_replay(rows, n_pilot, n_total, False)
    if lean["total_usd"] <= PROJECTION_CUT_USD:
        return {"decision": "drop_survival", "projection": full, "projection_without_survival": lean}
    return {"decision": "stop", "projection": full, "projection_without_survival": lean}


# ============================================================================ the call path
def _child_env() -> dict:
    env = dict(os.environ)
    for k in ("ANTHROPIC_BASE_URL", "OPENAI_BASE_URL"):
        env.pop(k, None)
    return env


def run_claude(argv: list[str], stdin: str, system: str | None, timeout: float, cwd_root: Path) -> dict:
    """One fresh `claude -p`, in an empty directory outside any repository; the parsed envelope. The system prompt
    goes over a pipe, never argv or disk (`--system-prompt-file /dev/fd/N`). `--tools ""` goes last."""
    cwd_root.mkdir(parents=True, exist_ok=True)
    rfd = wfd = None
    if system is not None:
        rfd, wfd = os.pipe()
        argv = argv + ["--system-prompt-file", f"/dev/fd/{rfd}"]
    argv = argv + ["--tools", ""]
    try:
        with tempfile.TemporaryDirectory(prefix="claude-", dir=cwd_root) as cwd:
            proc = subprocess.Popen(argv, cwd=cwd, env=_child_env(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, pass_fds=(rfd,) if rfd is not None else (),
                                    start_new_session=True, text=True, encoding="utf-8", errors="replace")
            if rfd is not None:
                os.close(rfd)
                rfd = None
                w, wfd = wfd, None

                def _write():
                    try:
                        with os.fdopen(w, "wb") as f:
                            f.write(system.encode("utf-8"))
                    except OSError:
                        pass
                threading.Thread(target=_write, daemon=True).start()
            try:
                out, err = proc.communicate(input=stdin, timeout=timeout)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(proc.pid, 9)
                except ProcessLookupError:
                    pass
                proc.communicate()
                raise InfraError(f"the claude CLI did not answer within {timeout:g}s (timeout)") from None
    finally:
        for fd in (rfd, wfd):
            if fd is not None:
                os.close(fd)
    try:
        env = json.loads(out)
    except json.JSONDecodeError:
        raise InfraError(f"the claude CLI exited {proc.returncode} without a JSON result (no envelope): "
                         f"{(err or '').strip()[-200:]}") from None
    if not isinstance(env, dict):
        raise InfraError("the claude CLI result is not an object (no envelope)")
    return env


# the CLI's own failures that are about the model's output, not the service: kept as model failures
MODEL_FAILURE_SUBTYPES = ("error_max_turns", "error_max_structured_output_retries")


def _is_cost(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x >= 0


def infra_reason(env: dict) -> str | None:
    """Why this envelope is an infrastructure error (F3), or None when it carries a model answer (or a failure of the
    model's own work: validation, truncation and a missing part are judged by the caller, never here). `is_error`
    with no model output (auth, usage limit, overload, an API error) is infrastructure; so is an envelope with no
    result at all."""
    if env.get("is_error"):
        if env.get("subtype") in MODEL_FAILURE_SUBTYPES:
            return None
        return f"is_error: {str(env.get('result') or env.get('subtype') or 'no detail')[:200]}"
    if not isinstance(env.get("result"), str):
        return "the envelope carries no result"
    return None


def _models_of(env: dict) -> list[str]:
    mu = env.get("modelUsage")
    return sorted(mu) if isinstance(mu, dict) else []


def _usage(env: dict) -> tuple[int, int]:
    u = env.get("usage") if isinstance(env.get("usage"), dict) else {}
    n = lambda k: u.get(k) if isinstance(u.get(k), int) and not isinstance(u.get(k), bool) and u.get(k) >= 0 else 0
    return n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens"), n("output_tokens")


_FIRST_ERR = re.compile(r"That output does not validate against the schema: (.*)\. Return the corrected JSON only\.", re.S)


class CliClient:
    """An Anthropic-SDK-shaped client that answers with `claude -p`, so napkin.model.ModelPort drives it unchanged.
    Every CLI call reserves its purpose's amount first (R5) and goes to the cost log, failed ones at the reserve; the
    attempts of the current port call are kept in thread-local `attempts` for the call record."""

    def __init__(self, cost: CostLog, cwd_root: Path | None = None):
        self.cost, self.cwd_root, self.local = cost, cwd_root or RATER_CWD, threading.local()
        self.messages = self

    def begin(self, job: str, arm: str):
        self.local.job, self.local.arm, self.local.attempts = job, arm, []

    def with_options(self, **_):
        return self

    @staticmethod
    def _flatten(msgs: list) -> str:
        texts = [(m["role"], m["content"] if isinstance(m["content"], str) else "") for m in msgs]
        if len(texts) == 1:
            return texts[0][1]
        lines = ["The conversation so far is below, oldest first. Write only the assistant's next reply to the final user turn.", ""]
        for role, text in texts:
            lines += [f"<{role}>", text, f"</{role}>", ""]
        return "\n".join(lines).rstrip() + "\n"

    def create(self, *, model, max_tokens, system, messages, output_config=None, **_):
        first = messages[0]["content"] if isinstance(messages[0]["content"], str) else ""
        m = re.match(r"Task: (\w+)", first)
        purpose = m.group(1) if m else "unknown"
        self.cost.gate.check()                  # a halted run (outage) refuses at once, no spend
        held = self.cost.reserve(purpose)       # raises BudgetExceeded before any spend
        sys_text = "".join(b["text"] for b in system) if isinstance(system, list) else system
        argv = [CLAUDE, "-p", "--model", model, "--output-format", "json", "--no-session-persistence", "--setting-sources", "",
                "--strict-mcp-config", "--disable-slash-commands", "--max-turns", "4"]
        oc = output_config or {}
        if oc.get("format"):
            argv += ["--json-schema", json.dumps(oc["format"]["schema"], separators=(",", ":"))]
        if oc.get("effort"):
            argv += ["--effort", oc["effort"]]
        last = messages[-1]["content"] if isinstance(messages[-1]["content"], str) else ""
        fe = _FIRST_ERR.search(last) if len(messages) == 3 else None
        rec = {"job": getattr(self.local, "job", None), "arm": getattr(self.local, "arm", None), "purpose": purpose,
               "model": model, "effort": oc.get("effort"), "turns": len(messages), "via": "ModelPort/claude -p"}
        t0 = time.monotonic()
        try:
            env = run_claude(argv, self._flatten(messages), sys_text, CFG["CALL_TIMEOUT_S"], self.cwd_root)
        except Exception as e:
            # no envelope: the cost is unknown, so the call is logged at its reserve; infrastructure, not the model
            err = e if isinstance(e, InfraError) else InfraError(f"{type(e).__name__}: {str(e)[:200]}")
            self.cost.settle(held, {**rec, "secs": round(time.monotonic() - t0, 2), "ok": False, "infra": True, "error": str(err)[:200]})
            self._note(rec, held, False, None, str(err)[:200], t0, fe)
            raise self.cost.gate.hit(err) from e
        i, o = _usage(env)
        cost = env.get("total_cost_usd") if _is_cost(env.get("total_cost_usd")) else None
        reason = infra_reason(env)
        if reason:      # the envelope's own figure is logged when there is one; the reserve only when there is none
            self.cost.settle(held, {**rec, "secs": round(time.monotonic() - t0, 2), "in_tokens": i, "out_tokens": o,
                                    "cost_usd": cost, "ok": False, "infra": True, "error": reason[:200]})
            self._note(rec, held, False, cost, reason[:200], t0, fe, i, o)
            raise self.cost.gate.hit(InfraError(reason))
        self.cost.gate.ok()
        ok = not env.get("is_error")
        err = None if ok else str(env.get("result") or env.get("subtype"))[:200]
        self.cost.settle(held, {**rec, "secs": round(time.monotonic() - t0, 2), "in_tokens": i, "out_tokens": o,
                                "cost_usd": cost, "ok": ok, "error": err})
        self._note(rec, held, ok, cost, err, t0, fe, i, o)
        if not ok:
            raise RuntimeError(f"claude CLI: {str(env.get('result') or env.get('subtype'))[:300]}")
        text = env["result"]
        if isinstance(env.get("num_turns"), int) and env["num_turns"] <= 2 and o > max_tokens:
            text, stop = text[:len(text) * max_tokens // o], "max_tokens"     # the CLI has no output cap
        else:
            stop = "end_turn"
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason=stop,
                               usage=SimpleNamespace(input_tokens=i, output_tokens=o, cache_creation_input_tokens=0,
                                                     cache_read_input_tokens=0))

    def _note(self, rec, held, ok, cost, err, t0, fe, i=None, o=None):
        att = getattr(self.local, "attempts", None)
        if att is not None:
            att.append({"ok": ok, "cost_usd": cost if cost is not None else held, "secs": round(time.monotonic() - t0, 2),
                        "error": err, "validation_error": fe.group(1)[:300] if fe else None, "in_tokens": i, "out_tokens": o})


def routes_doc() -> dict:
    """The routes staging runs plus insight_hypotheses and candidates_smp at medium (protocol section 4)."""
    doc = json.loads((REPO / "server/model-routes.example.json").read_text())
    for k, v in EXTRA_ROUTES.items():
        doc["purposes"].setdefault(k, v)
    return doc


def make_port(cost: CostLog):
    from napkin.model import AnthropicWire, ModelPort
    from napkin.model_routes import Routes
    client = CliClient(cost)
    routes = Routes("anthropic", "sonnet-5.5", None, source=json.dumps(routes_doc()))
    return ModelPort(AnthropicWire(client), "sonnet-5.5", timeout=CFG["CALL_TIMEOUT_S"], routes=routes), client


class Caller:
    """`call(purpose, system, payload, schema)`, the shape napkin.brief.candidates takes, for one arm. `records` keeps
    one entry per call: its attempts, the first validation error, cost and seconds, with the retries."""

    def __init__(self, port, client, job: str, arm: str):
        self.port, self.client, self.job, self.arm, self.records = port, client, job, arm, []

    def __call__(self, purpose, system, payload, schema):
        from napkin.model import Usage
        self.client.begin(self.job, self.arm)
        t0 = time.monotonic()
        err = None
        try:
            return self.port.call(purpose, system, payload, schema, usage=Usage(), attribution=f"engine_eval/{self.job}/{self.arm}",
                                  max_tokens=MAX_TOKENS.get(purpose, MAX_TOKENS_DEFAULT))
        except BaseException as e:
            err = f"{type(e).__name__}: {str(e)[:300]}"
            # the port wraps any client error in a ModelError: a budget stop must stay a budget stop, and an
            # infrastructure error an infrastructure error (never a model failure)
            cause = e if isinstance(e, (BudgetExceeded, InfraError)) else getattr(e, "__cause__", None)
            if isinstance(cause, (BudgetExceeded, InfraError)):
                raise cause from None
            raise
        finally:
            att = list(getattr(self.client.local, "attempts", []))
            self.records.append({"purpose": purpose, "attempts": len(att), "cost_usd": round(sum(a["cost_usd"] or 0 for a in att), 6),
                                 "secs": round(time.monotonic() - t0, 2),
                                 "first_validation_error": next((a["validation_error"] for a in att if a.get("validation_error")), None),
                                 "ok": err is None, "error": err})


# ============================================================================ the arms (5.1-5.4)
def draft_step(call, payload: dict) -> dict:
    """One `draft_brief_whole` call exactly as production sends it, then `checks.mark_assumptions` (code only)."""
    from napkin.brief import checks
    from napkin.brief.fields import filled
    from napkin.brief.planned import DRAFT_SYSTEM, draft_schema
    out = call("draft_brief_whole", DRAFT_SYSTEM, payload, draft_schema(list(payload["parts"])))
    whole = {k: v for k, v in out.items() if isinstance(v, dict) and filled(v.get("value"))}
    checks.mark_assumptions(whole)
    for k in (INS, PROP):
        if k not in whole:
            raise ValueError(f"the draft has no {k}")
    return {"whole": whole, "insight": checks.text_of(whole[INS]["value"]), "proposition": checks.text_of(whole[PROP]["value"])}


def arm_B(call, inp, deps):
    return draft_step(call, inp["payload"])


def arm_C1(call, inp, deps):
    return draft_step(call, edit_plan(inp["payload"]))


def arm_H1(call, inp, deps, plain: bool = False):
    """The investigator and its ranker (call 1 `insight_hypotheses`, call 2 `rank_insight`), then the choice in code."""
    from napkin.brief import candidates
    from napkin.brief.drafters import rank
    payload = inp["payload"]
    plan_insight = ((payload.get("plan") or {}).get("parts") or {}).get(INS, {}).get("must_say") or ""
    raw = call("insight_hypotheses", investigator_system(plain), investigator_payload(payload), hypothesis_schema(8, plain))
    hyps = clean_hypotheses(raw, plan_insight, known_ids(payload))
    if not hyps:
        raise ValueError("no usable hypothesis")
    pool = insight_pool(hyps, plan_insight)
    job_id = f"{inp['id']}:{'H1p' if plain else 'H1'}"
    shown = candidates.shuffled(len(pool), job_id)
    cands = [{"value": pool[i]["text"], "words": pool[i]["words"], **({} if plain else {"counter_evidence": pool[i]["counter_evidence"]})}
             for i in shown]
    order, why, losers = rank(call, "insight", cands, context=rank_context_insight(payload), note=INSIGHT_RANK_NOTE)
    order = [shown[i] for i in order]
    ci = choose_insight(pool, order)
    plan_i = next(i for i, p in enumerate(pool) if p["source"] == "plan")
    res = {"hypotheses": hyps, "pool": pool, "shown": shown, "order": order, "why_winner": why,
           "plan_rank": order.index(plan_i), "plan_insight": plan_insight,
           "plan_rank_note": "the plan's insight carries no counter-evidence of its own"}
    if ci is None:
        return {**res, "status": "no_gate", "chosen": None}
    ch = pool[ci]
    h = hyps[ci]       # hypotheses come first in the pool, in order
    res.update(chosen=ci, chosen_value=ch["value"], ranker_preferred=order.index(ci) < order.index(plan_i),
               chosen_rests_on=rests_on_of(h["cites_resolve"]))
    return res


def arm_H1p(call, inp, deps):
    return arm_H1(call, inp, deps, plain=True)


def arm_T1(call, inp, deps, key: str = "H1"):
    h = deps[key]
    if h.get("status") == "no_gate":
        return {"status": "no_gate"}
    return draft_step(call, edit_plan(inp["payload"], insight=h["chosen_value"]))


def arm_T1p(call, inp, deps):
    return arm_T1(call, inp, deps, key="H1p")


def arm_routes(call, inp, deps, arm: str, seeds) -> dict:
    """One of L, L2, S: 7 candidates written to `seeds`, pooled with B's proposition, ranked, `choose_new` in code."""
    from napkin.brief import candidates
    B = deps["B"]["whole"]
    payload = inp["payload"]
    parts = {k: (B.get(k) or {}).get("value") for k in candidates.FROM_PARTS}
    gen = candidates.generate_payload(insight=B[INS]["value"], strategy=(payload.get("plan") or {}).get("strategy"), parts=parts,
                                      facts=payload.get("facts") or [], findings=payload.get("findings") or [],
                                      client_words=payload.get("client_words") or [], library=payload.get("library") or [],
                                      n=7, seeds=seeds)
    new = candidates.generate(call, gen, 7, seeds=seeds)
    if not new:
        raise ValueError("no usable candidate")
    pool = candidates.build_pool(B[PROP]["value"], new)
    if len(pool) < 2:
        return {"status": "no_gate", "pool": pool, "order": [], "winner": None}
    order, why, losers, shown = candidates.rank_pool(call, pool, candidates.rank_context(parts, B[INS]["value"]), f"{inp['id']}:{arm}")
    w = candidates.choose_new(pool, order)
    first_i = next(i for i, p in enumerate(pool) if p["source"] == candidates.FIRST_DRAFT)
    res = {"pool": pool, "order": order, "shown": shown, "why_winner": why, "winner": w}
    if w is None:
        return {**res, "status": "no_gate"}
    return {**res, "winner_value": pool[w]["value"], "winner_seed": pool[w]["seed"], "winner_source": pool[w]["source"],
            "kept_by_ranker": order.index(first_i) < order.index(w)}


def arm_L(call, inp, deps):
    from napkin.brief.drafters import SMP_ANGLE_SEEDS
    return arm_routes(call, inp, deps, "L", SMP_ANGLE_SEEDS)


def arm_L2(call, inp, deps):
    from napkin.brief.drafters import SMP_ANGLE_SEEDS
    return arm_routes(call, inp, deps, "L2", SMP_ANGLE_SEEDS)


def arm_S(call, inp, deps):
    from napkin.brief.candidates import ROUTE_SEEDS
    return arm_routes(call, inp, deps, "S", ROUTE_SEEDS)


def _rewrite_payload(inp, whole, instruction, redraft: bool) -> dict:
    from napkin.brief.fields import KEYS, filled
    from napkin.brief.planned import WHAT
    payload = inp["payload"]
    base = {"client_said": payload.get("client_said") if redraft else str(payload.get("client_said") or "")[:8000],
            "plan": payload.get("plan"),
            "brief": {k: v["value"] for k, v in whole.items()} if redraft else {k: whole[k]["value"] for k in KEYS if k in whole and filled(whole[k]["value"])},
            "rewrite": {PROP: instruction}, "prior_claims": {PROP: []},
            "facts": payload.get("facts") or [], "findings": payload.get("findings") or [],
            "research_upstream": payload.get("research_upstream") or [], "library": payload.get("library") or [],
            "parts": {PROP: WHAT.get(PROP, PROP)}}
    if redraft:       # planned.py:650-657 carries these two as well
        base["captured"], base["client_words"] = payload.get("captured"), payload.get("client_words")
    return base


def rewrite_proposition(call, inp, whole: dict, instruction: str, redraft: bool):
    """Dara rewrites the proposition (purpose rewrite_brief_parts, effort low); `checks.mark_assumptions` after.
    -> the new whole, or the same one when the answer holds no proposition."""
    from napkin.brief import checks
    from napkin.brief.planned import DRAFT_SYSTEM, REWRITE_NOTE, draft_schema
    out = call("rewrite_brief_parts", DRAFT_SYSTEM + REWRITE_NOTE, _rewrite_payload(inp, whole, instruction, redraft),
               draft_schema([PROP]))
    e = (out or {}).get(PROP)
    if not isinstance(e, dict) or not checks.text_of(e.get("value")):
        return whole, False
    entries = {PROP: e}
    checks.mark_assumptions(entries, insight=whole.get(INS))
    w = dict(whole)
    w[PROP] = entries[PROP]
    return w, True


def arm_J(call, inp, deps, variant: str):
    """J0, J0', J1: the Jude call of the check loop (explain_flags, effort low) on B, then the proposition's
    instruction as production builds it, then at most two rewrites (R10)."""
    from napkin.brief import checks
    B = deps["B"]["whole"]
    pay, tested, ask = jude_variant_payload(inp["payload"], B, variant)
    jude = call("explain_flags", jude_variant_system(tested, variant), pay, jude_variant_schema(ask, tested, variant))
    tf = todo_from_jude(jude, ask, tested, B, list(inp["payload"]["parts"]))
    instr = tf["todo"].get(PROP)
    whole, rewrites = B, []
    if instr:
        whole, did = rewrite_proposition(call, inp, whole, instr, redraft=False)
        rewrites.append({"instruction": instr, "by": tf["by"].get(PROP), "changed": did})
        left = [x for x in checks.revisions(whole) if x["part"] == PROP]
        if left:
            whole, did = rewrite_proposition(call, inp, whole, left[0]["instruction"], redraft=True)
            rewrites.append({"instruction": left[0]["instruction"], "by": "code", "changed": did})
    prop_t = ((jude.get("tests") or {}).get(PROP) or {})
    return {"jude": jude, "tested": tested, "ask": ask, "sent_by": tf["by"].get(PROP), "instruction": instr,
            "unanswered": tf["unanswered"], "unanswered_proposition": PROP in tf["unanswered"],
            "jude_fails_proposition": jude_fails(jude, PROP), "jude_fails_insight": jude_fails(jude, INS),
            "proposition_answer": prop_t, "rewrites": rewrites, "rewritten": bool(rewrites),
            "proposition": checks.text_of(whole[PROP]["value"]), "whole_proposition_entry": whole[PROP],
            "questions": list(jude.get("questions") or []), "code_sendbacks_B": tf["sent"],
            "code_sendbacks_after": code_sendbacks(whole)}


def arm_J0(call, inp, deps):
    return arm_J(call, inp, deps, "J0")


def arm_J0p(call, inp, deps):
    return arm_J(call, inp, deps, "J0")


def arm_J1(call, inp, deps):
    return arm_J(call, inp, deps, "J1")


def _survival(call, inp, whole: dict) -> dict:
    pay, tested, ask = jude_variant_payload(inp["payload"], whole, "J0")
    jude = call("explain_flags", jude_variant_system(tested, "J0"), pay, jude_variant_schema(ask, tested, "J0"))
    return {"jude": jude, **survival_counts(jude, whole)}


def arm_SV1(call, inp, deps):
    t = deps["T1"]
    return {"status": "no_gate"} if t.get("status") == "no_gate" else _survival(call, inp, t["whole"])


def arm_SV2(call, inp, deps):
    s = deps["S"]
    if s.get("status") == "no_gate":
        return {"status": "no_gate"}
    return _survival(call, inp, substitute_proposition(deps["B"]["whole"], s["winner_value"]))


# name, dependencies, function, idea. Protocol order (section 3, step 4).
def arm_specs() -> list[tuple]:
    specs = [("B", (), arm_B), ("C1", (), arm_C1), ("H1", (), arm_H1), ("T1", ("H1",), arm_T1)]
    if CFG["INCLUDE_PLAIN_BEST_OF_8"]:
        specs += [("H1p", (), arm_H1p), ("T1p", ("H1p",), arm_T1p)]
    specs += [("L", ("B",), arm_L), ("L2", ("B",), arm_L2), ("S", ("B",), arm_S)]
    # J0 and J0' are the survival reviews' baseline (R10: "B's counts are J0's", J0 v J0' is Jude's own noise), so they
    # run whether or not idea 3 is included (F2); only J1 belongs to idea 3 alone
    specs += [("J0", ("B",), arm_J0), ("J0p", ("B",), arm_J0p)]
    if CFG["INCLUDE_IDEA3"]:
        specs += [("J1", ("B",), arm_J1)]
    specs += [("SV1", ("B", "T1"), arm_SV1), ("SV2", ("B", "S"), arm_SV2)]
    return specs


def effective_skip(skip: tuple = ()) -> tuple:
    """The arms a run leaves out. Dropping the survival reviews (R5) also drops J0 and J0' when idea 3 is not included:
    they are then nobody's baseline."""
    skip = tuple(skip)
    if set(SURVIVAL_ARMS) <= set(skip) and not CFG["INCLUDE_IDEA3"]:
        skip += ("J0", "J0p")
    return skip


OK_STATUS = ("ok", "no_gate")


def execute_arm(path: Path, fn, make_caller, deps: dict, force: bool = False, tries: int = 2) -> dict:
    """Run one arm at most twice, each with the port's own retry (R6). A settled arm (ok, no_gate, FAILED_final) is kept
    unless `force`. A budget stop is written as `budget_stopped` and raised as StopRun. An arm whose dependency
    failed for good is FAILED_final without a call. An infrastructure error (F3) is not a failed run: it writes
    nothing, does not use up a run, and is tried again after a wait; INFRA_STOP_AFTER in a row stop the whole run."""
    if path.exists() and not force:
        d = json.loads(path.read_text())
        if d["status"] in OK_STATUS + ("FAILED_final",):
            return d
    bad = [k for k, v in deps.items() if v.get("status") not in OK_STATUS]
    if bad:
        d = {"status": "FAILED_final", "runs": 0, "calls": [], "failed_runs": [], "error": f"dependency {', '.join(bad)} did not run to a result"}
        path.write_text(json.dumps(d, indent=1, ensure_ascii=False))
        return d
    failed, calls = [], []
    n, infra_here = 0, 0
    while n < tries:
        n += 1
        caller = make_caller()
        try:
            res = fn(caller, deps)
        except BudgetExceeded as e:
            calls += caller.records
            d = {"status": "budget_stopped", "runs": n, "calls": calls, "failed_runs": failed, "error": str(e)}
            path.write_text(json.dumps(d, indent=1, ensure_ascii=False))
            raise StopRun(str(e)) from e
        except InfraStop:
            raise       # the whole run stops; nothing is written: the arm is unsettled, not failed
        except InfraError as e:
            # an outage says nothing about the arm: this run does not count, nothing is written, and the same run is
            # tried again after a wait (F3); the gate has already counted it towards the stop
            infra_here += 1
            n -= 1
            if infra_here >= CFG["INFRA_STOP_AFTER"] + 1:       # a caller with no gate of its own: still never endless
                raise InfraStop(f"{infra_here} infrastructure errors on one arm: {e}") from e
            time.sleep(CFG["INFRA_BACKOFF_S"] * infra_here)
            continue
        except Exception as e:      # noqa: BLE001 - a failed arm: the second run, then FAILED_final
            calls += caller.records
            failed.append({"run": n, "error": f"{type(e).__name__}: {str(e)[:300]}"})
            continue
        calls += caller.records
        d = {"status": res.pop("status", "ok"), "runs": n, "calls": calls, "failed_runs": failed, **res}
        path.write_text(json.dumps(d, indent=1, ensure_ascii=False))
        return d
    d = {"status": "FAILED_final", "runs": tries, "calls": calls, "failed_runs": failed, "error": failed[-1]["error"]}
    path.write_text(json.dumps(d, indent=1, ensure_ascii=False))
    return d


def process_brief(out: Path, inp: dict, make_caller, force: bool = False, skip: tuple = ()) -> dict:
    """Every arm of one brief in the protocol's order. `make_caller(job, arm)` -> a Caller-shaped callable."""
    arms: dict = {}
    d = out / "arms" / inp["id"]
    d.mkdir(parents=True, exist_ok=True)
    skip = effective_skip(skip)
    for name, dep_names, fn in arm_specs():
        if name in skip:
            continue
        deps = {k: arms[k] for k in dep_names if k in arms}
        deps.update({k: {"status": "FAILED_final"} for k in dep_names if k not in arms})
        arms[name] = execute_arm(d / f"{name}.json", lambda caller, dp, fn=fn: fn(caller, inp, dp),
                                 lambda name=name: make_caller(inp["id"], name), deps, force)
    return arms


# ============================================================================ commands: select, smoke, pilot, replay
def load_inputs(out: Path, only=None) -> list[dict]:
    sel = json.loads((out / "inputs/selection.json").read_text())["runs"]
    return [json.loads((out / "inputs" / f"{r['id']}.json").read_text()) for r in sel if not only or r["id"] in only]


def cmd_select(a):
    out, src = Path(a.out), Path(a.src)
    if (out / "inputs/selection.json").exists():
        sys.exit("inputs/selection.json exists: the set is fixed once and never re-selected")
    briefs = json.loads((src / "briefs.json").read_text())
    ids = sorted(b["id"] for b in briefs)
    entries = list_source(src)
    chosen = select_runs(entries, ids)
    (out / "inputs").mkdir(parents=True, exist_ok=True)
    rows, excluded = [], []
    for name in chosen:
        lines = (src / "runs" / name / "runlog.jsonl").read_text().splitlines()
        try:
            inp = extract_input(name, lines)
        except ValueError as e:
            excluded.append({"name": name, "why": str(e)})
            continue
        (out / "inputs" / f"{inp['id']}.json").write_text(json.dumps(inp, indent=1, ensure_ascii=False))
        rows.append({"id": inp["id"], "name": name, "source_runlog_sha256": hashlib.sha256("\n".join(lines).encode()).hexdigest(),
                     "system_is_draft_system": inp["system_is_draft_system"]})
    excluded += [{"name": f"{i}-off", "why": "not done in summary.json and job_end"} for i in ids if f"{i}-off" not in chosen]
    (out / "inputs" / "selection.json").write_text(json.dumps({
        "rule": "every id of AWARD/briefs.json in id order; the run <id>-off when summary.json and the run log's job_end say done "
                "and it has exactly one draft_brief_whole event whose reply has a string insight.value and "
                "single_minded_proposition.value",
        "source": str(src), "briefs_in_file": len(ids), "selected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "briefs_file_sha256": hashlib.sha256((src / "briefs.json").read_bytes()).hexdigest(),
        "runs": rows, "excluded": excluded}, indent=1))
    print(f"{len(rows)} runs fixed: {', '.join(r['id'] for r in rows)}; excluded: {excluded or 'none'}")
    bad = [r["id"] for r in rows if not r["system_is_draft_system"]]
    if bad:
        print(f"WARNING: the stored system prompt differs from planned.DRAFT_SYSTEM for {bad} (protocol 4 says it equals it)")


def cmd_smoke(a):
    out = Path(a.out)
    cost = replay_cost_log(out, a.max_usd)
    port, client = make_port(cost)
    call = Caller(port, client, "smoke", "smoke")
    got = call("smoke", "Answer with the JSON asked for.", {"say": "ok"},
               {"type": "object", "additionalProperties": False, "required": ["word"], "properties": {"word": {"type": "string"}}})
    print(got, call.records, f"{cost.spent:.4f} USD in the cost log")


def _run_briefs(a, only, force=False, skip=()):
    out = Path(a.out)
    cost = replay_cost_log(out, a.max_usd)
    port, client = make_port(cost)
    stop = threading.Event()
    msg = []

    def one(inp):
        if stop.is_set():
            return
        try:
            arms = process_brief(out, inp, lambda job, arm: Caller(port, client, job, arm), force, skip)
        except StopRun as e:
            stop.set()
            msg.append(str(e))
            if isinstance(e, InfraStop):
                write_infra_stop(out, "replay", str(e), inp["id"])
            print(f"{inp['id']}: {'INFRASTRUCTURE STOP' if isinstance(e, InfraStop) else 'BUDGET STOP'}: {e}", flush=True)
            return
        print(f"{inp['id']}: " + " ".join(f"{k}={v['status']}" for k, v in arms.items()) + f"  (spent {cost.spent:.2f} USD)", flush=True)

    with ThreadPoolExecutor(CFG["REPLAY_WORKERS"]) as ex:
        list(ex.map(one, load_inputs(out, only)))
    print(f"spent {cost.spent:.2f} USD in the cost log" + (f"; STOPPED: {msg[0]}" if msg else ""))
    cost.stopped = msg[0] if msg else None
    return cost


# ---------------------------------------------------------------------------- the run's configuration (F5)
# knobs that change how fast or how patiently a run goes, never what it measures: recorded, not compared
OPERATIONAL_CFG = ("REPLAY_WORKERS", "RATER_WORKERS", "CALL_TIMEOUT_S", "INFRA_STOP_AFTER", "INFRA_BACKOFF_S")


def _git(*args: str) -> str | None:
    try:
        r = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout if r.returncode == 0 else None


def config_snapshot() -> dict:
    """Every CFG switch, the models, `git rev-parse HEAD`, and a hash of the tracked changes under server/ (uv.lock aside),
    so a harness edited after the pilot is as visible as a new commit."""
    head = _git("rev-parse", "HEAD")
    diff = _git("diff", "HEAD", "--", "server", ":!server/uv.lock")
    return {"cfg": json.loads(json.dumps(CFG)), "models": {"replay": REPLAY_MODEL_ID, "raters": dict(RATERS)},
            "git_head": head.strip() if head else None,
            "git_diff_sha256": hashlib.sha256(diff.encode()).hexdigest() if diff is not None else None,
            "taken_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


def config_mismatches(saved: dict, now: dict) -> list[str]:
    out = []
    for k in sorted(set(saved["cfg"]) | set(now["cfg"])):
        if k not in OPERATIONAL_CFG and saved["cfg"].get(k) != now["cfg"].get(k):
            out.append(f"CFG {k}: the pilot ran with {saved['cfg'].get(k)!r}, now {now['cfg'].get(k)!r}")
    if saved["models"] != now["models"]:
        out.append(f"models: the pilot ran with {saved['models']}, now {now['models']}")
    if saved["git_head"] != now["git_head"] or now["git_head"] is None:
        out.append(f"git HEAD: the pilot ran at {saved['git_head']}, now {now['git_head']}")
    if saved["git_diff_sha256"] != now["git_diff_sha256"]:
        out.append("the harness or the spike's code has uncommitted changes that differ from the pilot's")
    return out


def write_run_config(out: Path, note: str | None = None) -> dict:
    """The pilot's snapshot (R7's --force rerun writes a new one and keeps the old under `previous`)."""
    path = out / "run_config.json"
    snap = config_snapshot()
    if path.exists():
        old = json.loads(path.read_text())
        snap["previous"] = [{k: v for k, v in old.items() if k != "previous"}] + old.get("previous", [])
        snap["note"] = note
    path.write_text(json.dumps(snap, indent=1))
    return snap


def check_run_config(out: Path, what: str) -> dict:
    """Refuse `what` unless the harness is configured exactly as it was at the pilot."""
    path = out / "run_config.json"
    if not path.exists():
        sys.exit(f"{what} refused: no run_config.json. The pilot writes it before its first call (every CFG switch and the "
                 f"git HEAD); run `pilot` first.")
    saved = json.loads(path.read_text())
    bad = config_mismatches(saved, config_snapshot())
    if bad:
        sys.exit(f"{what} refused: the harness is not configured as it was at the pilot (run_config.json):\n  - " + "\n  - ".join(bad)
                 + "\nChange nothing after the pilot but R5's cuts and R7's fault fixes; a fault fix is re-snapshotted by "
                   "`replay --only c01 t01 --force --reason '<why>'` (it writes changes.md), otherwise restore the setting.")
    return saved


def write_infra_stop(out: Path, where: str, message: str, at: str | None = None):
    """The resumable state of an outage stop: what stopped, where, when. Settled arms and ratings are untouched; the
    unsettled one has no file, so the same command run again picks up exactly there."""
    (out / "infra_stop.json").write_text(json.dumps({"where": where, "at": at, "message": message,
                                                     "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                                     "resume": "run the same command again"}, indent=1))


def read_log(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()] if path.exists() else []


def _discard(out: Path, ids: list[str], reason: str):
    """R7: a rerun with --force moves the earlier arms to pilot_discarded/ (never rated) and writes the reason."""
    stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    for i in ids:
        src = out / "arms" / i
        if src.exists():
            dst = out / "pilot_discarded" / f"{i}-{stamp}"
            dst.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dst)
    with (out / "changes.md").open("a") as f:
        f.write(f"- {stamp}: rerun --force of {', '.join(ids)}. Reason: {reason}\n")


def pilot_unsettled(out: Path, ids) -> list[str]:
    """Pilot arms that are not `ok` or `no_gate` (FAILED-final, budget_stopped, missing): the pilot cannot decide."""
    arms = load_arms(out, list(ids))
    return [f"{i}:{n}={(arms.get(i, {}).get(n) or {}).get('status', 'missing')}" for i in ids for n, _, _ in arm_specs()
            if (arms.get(i, {}).get(n) or {}).get("status") not in OK_STATUS]


def cmd_pilot(a):
    out = Path(a.out)
    if (out / "pilot.json").exists():
        sys.exit("pilot.json exists: the pilot has run; change nothing but R5's cuts and R7's fault fixes (use replay --force --reason)")
    if (out / "run_config.json").exists():
        check_run_config(out, "pilot")
    else:
        write_run_config(out)
    cost = _run_briefs(a, set(PILOT_BRIEFS))
    bad = pilot_unsettled(out, PILOT_BRIEFS)
    if bad:
        sys.exit("NO PILOT DECISION WRITTEN: every pilot arm must be ok or no_gate, and these are not: " + ", ".join(bad)
                 + (f". The run stopped: {cost.stopped}" if getattr(cost, "stopped", None) else "")
                 + ". A FAILED-final or budget-stopped arm is a fault to find (R7): fix it, move the pilot aside with "
                   "`replay --only c01 t01 --force --reason '<why>'`, then run `pilot` again.")
    rows = read_log(out / "cost_log.jsonl")
    n_total = len(load_inputs(out))
    d = cut_decision(rows, len(PILOT_BRIEFS), n_total)
    d["pilot_briefs"], d["n_total"], d["at"] = list(PILOT_BRIEFS), n_total, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    (out / "pilot.json").write_text(json.dumps(d, indent=1))
    print(json.dumps({"decision": d["decision"], "projected_usd": d["projection"]["total_usd"],
                      "without_survival": (d.get("projection_without_survival") or {}).get("total_usd")}, indent=1))


def cmd_replay(a):
    out = Path(a.out)
    only = set(a.only) if a.only else None
    force = a.force
    if force:
        if not a.reason or not only:
            sys.exit("--force needs --only <ids> and --reason '<why>' (R7: a fault fix, written to changes.md)")
        if not (out / "run_config.json").exists():
            check_run_config(out, "replay")
        _discard(out, sorted(only), a.reason)
        write_run_config(out, note=f"R7 rerun --force: {a.reason}")      # the fix may have moved HEAD: a new snapshot, the old kept
    else:
        check_run_config(out, "replay")
    skip = ()
    if only is None or not only <= set(PILOT_BRIEFS):
        pj = out / "pilot.json"
        if not pj.exists():
            sys.exit("run `pilot` first: the projection and the cut decision (R5) come from it")
        dec = json.loads(pj.read_text())["decision"]
        if dec == "stop":
            sys.exit("the pilot projection is above 23 USD even without the survival reviews: stop and report (R5)")
        if dec == "drop_survival":
            skip = SURVIVAL_ARMS
    _run_briefs(a, only, force, skip)


def cmd_cost(a):
    out = Path(a.out)
    for name in ("cost_log.jsonl", "rater_cost_log.jsonl"):
        rows = read_log(out / name)
        print(f"{name}: {len(rows)} calls, {sum(r.get('cost_usd') or 0 for r in rows):.4f} USD")
        for p, d in sorted(cost_summary(rows).items()):
            print(f"  {p}: {d['calls']} calls, {d['usd']:.4f} USD, failed {d['failed']}, logged at reserve {d['assumed']}")
        by_arm: dict = {}
        for r in rows:
            k = r.get("arm") or "-"
            by_arm[k] = by_arm.get(k, 0) + (r.get("cost_usd") or 0)
        if name == "cost_log.jsonl" and by_arm:
            print("  by arm: " + ", ".join(f"{k} {v:.3f}" for k, v in sorted(by_arm.items())))


# ============================================================================ the arms as the analysis and packets read them
def load_arms(out: Path, ids: list[str]) -> dict:
    return {i: {p.stem: json.loads(p.read_text()) for p in sorted((out / "arms" / i).glob("*.json"))} for i in ids
            if (out / "arms" / i).exists()}


def arm_text(arms: dict, inp: dict, name: str):
    """(insight, proposition) of a compared side, raw; or (None, reason) when the side did not run to a result."""
    def need(*keys):
        bad = [k for k in keys if (arms.get(k) or {}).get("status") != "ok"]
        return (f"{', '.join(bad)} {(arms.get(bad[0]) or {}).get('status', 'missing')}" if bad else None)
    if name == "D0":
        fd = inp["first_draft"]
        return (fd[INS], fd[PROP]), None
    if name in ("B", "O"):
        r = need("B")
        return ((arms["B"]["insight"], arms["B"]["proposition"]), None) if not r else (None, r)
    if name in ("C1", "T1", "T1p"):
        r = need(name)
        return ((arms[name]["insight"], arms[name]["proposition"]), None) if not r else (None, r)
    if name in ("S", "L", "L2"):
        r = need("B", name)
        return ((arms["B"]["insight"], arms[name]["winner_value"]), None) if not r else (None, r)
    if name in ("R0", "R0p", "R1"):
        j = {"R0": "J0", "R0p": "J0p", "R1": "J1"}[name]
        r = need("B", j)
        return ((arms["B"]["insight"], arms[j]["proposition"]), None) if not r else (None, r)
    raise KeyError(name)


def comparisons() -> list[tuple]:
    """(name, idea, question, first-named side, other side). R2's list: 12 items a brief, D0 v B and T1p only on a switch."""
    c = [("T1vC1.ins", 1, INS, "T1", "C1"), ("C1vB.ins", 1, INS, "C1", "B"), ("T1vB.ins", 1, INS, "T1", "B"),
         ("T1vC1.prop", 1, QPROP, "T1", "C1"), ("C1vB.prop", 1, QPROP, "C1", "B"),
         ("SvO", 2, QPROP, "S", "O"), ("LvO", 2, QPROP, "L", "O"), ("L2vO", 2, QPROP, "L2", "O")]
    if CFG["INCLUDE_IDEA3"]:
        c += [("R1vR0", 3, QPROP, "R1", "R0"), ("R0pvR0", 3, QPROP, "R0p", "R0"), ("R1vO", 3, QPROP, "R1", "O"), ("R0vO", 3, QPROP, "R0", "O")]
    if CFG["INCLUDE_PLAIN_BEST_OF_8"]:
        c += [("T1vT1p.ins", 1, INS, "T1", "T1p")]
    if CFG["INCLUDE_D0_V_B"]:
        c += [("D0vB", 0, QPROP, "D0", "B")]
    return c


POOLS = (("H1", 1, "insights"), ("S", 2, "propositions"), ("L", 2, "propositions"), ("L2", 2, "propositions"))


def pool_entries(arms: dict, name: str):
    """The pool a same-idea item lists: [(text, source, idx)] or None when the arm has no pool."""
    a = arms.get(name) or {}
    if a.get("status") not in OK_STATUS or not a.get("pool"):
        return None
    if name == "H1":
        return [(p["text"], p["source"], p["idx"]) for p in a["pool"]]
    return [(tidy(p["value"]), p["source"], p.get("idx")) for p in a["pool"]]


def results_hash(out: Path) -> str:
    h = hashlib.sha256()
    for p in sorted((out / "arms").glob("*/*.json")):
        h.update(str(p.relative_to(out)).encode() + p.read_bytes())
    return h.hexdigest()


def build_packets(inputs: list[dict], arms_by: dict, size: int | None = None):
    """Blinded batches (R1: files for the harness only), the key and the automatic ties. -> (packets, key)."""
    size = size or CFG["PACKET_SIZE"]
    items, key = [], {"pairs": {}, "sameidea": {}, "auto_ties": {}}
    primary_left = []
    for inp in inputs:
        b, arms = inp["id"], arms_by.get(inp["id"], {})
        for cname, idea, question, first, second in comparisons():
            ta, ra = arm_text(arms, inp, first)
            tb, rb = arm_text(arms, inp, second)
            tk = f"{b}|{cname}"
            if ta is None or tb is None or (first == "T1" and arms.get("T1", {}).get("status") == "no_gate"):
                key["auto_ties"][tk] = ra or rb or "no_gate"
                continue
            a, c = (tidy(ta[0]), tidy(ta[1])), (tidy(tb[0]), tidy(tb[1]))
            # R2: "two texts identical after tidy are a tie without a rating": the texts being compared, so a proposition item
            # ties when the two propositions alone are identical, whatever their insights (F6)
            same = (a[0] == c[0]) if question == INS else (a[1] == c[1])
            if same:
                key["auto_ties"][tk] = "identical text"
                continue
            if cname in PRIMARY_COMPARISONS:      # R3: a text a rater sees must carry no label that could mark its arm
                for side, texts in ((first, a), (second, c)):
                    for part, t in (("insight", texts[0]), ("proposition", texts[1])):
                        if (question == QPROP or part == "insight") and leftover_label(t):
                            primary_left.append({"brief": b, "comparison": cname, "side": side, "part": part, "text": t[:80]})
            for it in pair_items(b, inp["brief_text"], cname, question, a, c):
                m = it["meta"]
                key["pairs"][it["item"]] = {"brief": b, "idea": idea, "comparison": cname, "question": question,
                                            "order": m["order"], "first": first, "second": second,
                                            "X": first if m["a_is_x"] else second, "Y": second if m["a_is_x"] else first,
                                            "len": {first: words(a[0] if question == INS else a[1]), second: words(c[0] if question == INS else c[1])}}
                items.append({"item": it["item"], "kind": "pair", "question": question, "prompt": it["prompt"], "twin": f"{b}|{cname}"})
        for pname, idea, kind in POOLS:
            ent = pool_entries(arms, pname)
            if not ent or len(ent) < 2:
                continue
            order = sorted(range(len(ent)), key=lambda i: _shuf_key(f"idea|{b}|{pname}", i))
            listing = "\n".join(f"{k + 1}. {ent[i][0]}" for k, i in enumerate(order))
            item = opaque("idea", b, pname, *[e[0] for e in ent])
            key["sameidea"][item] = {"brief": b, "idea": idea, "pool": pname, "n": len(order), "kind": kind,
                                     "numbers": {str(k + 1): {"source": ent[i][1], "idx": ent[i][2]} for k, i in enumerate(order)}}
            items.append({"item": item, "kind": "sameidea", "n": len(order), "twin": f"{b}|{pname}",
                          "prompt": SAME_IDEA_PROMPT.format(n=len(order), kind=kind, listing=listing)})
    pairs = [i for i in items if i["kind"] == "pair"]
    ideas = [i for i in items if i["kind"] == "sameidea"]
    key["leftover_labels"] = {"by_arm": leftover_by_arm(inputs, arms_by), "primary": primary_left}
    packets = assign_packets(pairs, size, lambda i: i["twin"]) + assign_packets(ideas, size, lambda i: i["item"])
    return [{"packet": f"p{n + 1:02d}", "items": [{k: v for k, v in it.items() if k != "twin"} for it in p]}
            for n, p in enumerate(packets)], key


def leftover_by_arm(inputs: list[dict], arms_by: dict) -> dict:
    """R3's report: per arm, the shown texts (insight and proposition, through tidy) that still begin with four or fewer
    words followed by a colon."""
    left = {}
    for a in LEFTOVER_ARMS:
        cnt = 0
        for inp in inputs:
            t, _ = arm_text(arms_by.get(inp["id"], {}), inp, _SIDE_OF_ARM.get(a, a))
            if t:
                cnt += sum(leftover_label(tidy(x)) for x in t)
        left[a] = cnt
    return left


def rating_prompts_text() -> str:
    return "\n\n".join([
        "# Frozen rater setup (R1, R2)", f"Effort: {CFG['RATER_EFFORT']} (pinned; never changes)",
        f"Models: {json.dumps(RATERS)}", "Calls: one fresh `claude -p` per judgement, from ~/.cache/napkin-raters, `--tools \"\"`, "
        "`--setting-sources \"\"`, `--no-session-persistence`, `--strict-mcp-config`, `--disable-slash-commands`, "
        "system prompt on a pipe.", "## System prompt\n\n" + RATER_SYSTEM, "## Proposition prompt\n\n" + PROPOSITION_PROMPT,
        "## Insight prompt\n\n" + INSIGHT_PROMPT, "## Same idea prompt\n\n" + SAME_IDEA_PROMPT]) + "\n"


def cmd_packets(a):
    out = Path(a.out)
    check_run_config(out, "packets")
    inputs = load_inputs(out)
    arms_by = load_arms(out, [i["id"] for i in inputs])
    expected = {n for n, _, _ in arm_specs()} - set(effective_skip(SURVIVAL_ARMS if _survival_dropped(out) else ()))
    short = [f"{i['id']}:{n}" for i in inputs for n in expected
             if (arms_by.get(i["id"], {}).get(n) or {}).get("status") not in OK_STATUS + ("FAILED_final",)]
    if short:
        sys.exit(f"packets refused: arms not settled (missing or budget_stopped): {', '.join(short)}; run replay first")
    packets, key = build_packets(inputs, arms_by)
    lo = key["leftover_labels"]
    print(f"leftover labels in shown texts (R3), by arm: {lo['by_arm']}; in the primary comparisons {', '.join(PRIMARY_COMPARISONS)}: "
          f"{len(lo['primary'])}")
    if lo["primary"]:
        sys.exit("packets refused: a shown text in a primary comparison still carries a leading label, which could mark its arm "
                 "(R3). Extend `tidy`'s label list (a fault fix, R7) or rerun the arm; nothing was written.\n  "
                 + "\n  ".join(f"{x['brief']} {x['comparison']} {x['side']} {x['part']}: {x['text']!r}" for x in lo["primary"][:20]))
    (out / "packets").mkdir(exist_ok=True)
    for p in (out / "packets").glob("p*.json"):
        p.unlink()
    for p in packets:
        (out / "packets" / f"{p['packet']}.json").write_text(json.dumps(p, indent=1, ensure_ascii=False))
    key["results_sha256"] = results_hash(out)
    (out / "key.json").write_text(json.dumps(key, indent=1))
    rp = out / "rating_prompts.md"
    if not rp.exists() or not read_log(out / "rater_cost_log.jsonl"):
        rp.write_text(rating_prompts_text())
    n_pairs, n_ideas = len(key["pairs"]), len(key["sameidea"])
    print(f"{len(packets)} packets; {n_pairs} pair items, {n_ideas} same-idea items; automatic ties {len(key['auto_ties'])}; "
          f"judgements: {n_pairs * 2 + n_ideas * 2}")


# ============================================================================ raters (R1, R2, R5)
def normalise_pick(v):
    """'X', 'Y' or 'no real difference' from a reply that may differ in case, spaces or a trailing full stop."""
    if not isinstance(v, str):
        return None
    t = v.strip().rstrip(".!").strip().lower()
    return {"x": "X", "y": "Y", "no real difference": "no real difference"}.get(t)


def usable(obj, kind: str, n: int | None = None) -> bool:
    if not isinstance(obj, dict):
        return False
    if kind == "pair":
        return normalise_pick(obj.get("better")) is not None
    return distinct_ideas(obj.get("groups"), n if n else 99) is not None


def rater_argv(rater: str) -> list[str]:
    return [CLAUDE, "-p", "--model", RATERS[rater], "--output-format", "json", "--no-session-persistence",
            "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--effort", CFG["RATER_EFFORT"]]


class ModelMismatch(RuntimeError):
    """The envelope's model usage does not name the model that was asked for (F9): the rating would be by another rater.
    Never retried, never scored: the run stops."""


def model_matches(env: dict, want: str) -> bool | None:
    """Whether the envelope's `modelUsage` names the requested model; None when it carries no usage to check."""
    seen = _models_of(env)
    return None if not seen else any(m == want or m.startswith(want) for m in seen)


def rater_call(rater: str, prompt: str, cost: CostLog, job: str, kind: str = "pair", n: int | None = None):
    """One fresh call. -> the answer, or None when it is unusable (the caller asks again). Raises BudgetExceeded before
    any spend; an infrastructure error (F3) as InfraError, which is not an unusable answer; ModelMismatch when another
    model answered (F9). A call with no envelope is logged at its reserve, one with an envelope at its own figure."""
    cost.gate.check()
    held = cost.reserve(f"rate:{rater}")
    t0 = time.monotonic()
    rec = {"job": job, "purpose": "rate", "rater": rater, "model": RATERS[rater], "effort": CFG["RATER_EFFORT"], "via": "claude -p"}
    try:
        env = run_claude(rater_argv(rater), prompt, RATER_SYSTEM, 600, RATER_CWD)
    except Exception as e:      # noqa: BLE001
        err = e if isinstance(e, InfraError) else InfraError(f"{type(e).__name__}: {str(e)[:200]}")
        cost.settle(held, {**rec, "secs": round(time.monotonic() - t0, 2), "ok": False, "infra": True, "error": str(err)[:200]})
        raise cost.gate.hit(err) from e
    i, o = _usage(env)
    c = env.get("total_cost_usd") if _is_cost(env.get("total_cost_usd")) else None
    reason = infra_reason(env)
    if reason:
        cost.settle(held, {**rec, "secs": round(time.monotonic() - t0, 2), "in_tokens": i, "out_tokens": o, "cost_usd": c,
                           "ok": False, "infra": True, "error": reason[:200]})
        raise cost.gate.hit(InfraError(reason))
    cost.gate.ok()
    matched = model_matches(env, RATERS[rater])
    rec.update(models_seen=_models_of(env), model_checked=matched is not None)
    if matched is False:
        cost.settle(held, {**rec, "secs": round(time.monotonic() - t0, 2), "in_tokens": i, "out_tokens": o, "cost_usd": c,
                           "ok": False, "error": "model mismatch"})
        raise ModelMismatch(f"asked {RATERS[rater]} for the {rater} rating but the envelope's model usage names "
                            f"{_models_of(env)}: the rating is not the {rater} rater's")
    m = re.search(r"\{.*\}", env.get("result") or "", re.S)
    obj = None
    if m and not env.get("is_error"):
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    good = usable(obj, kind, n)
    cost.settle(held, {**rec, "secs": round(time.monotonic() - t0, 2), "in_tokens": i, "out_tokens": o,
                       "cost_usd": c, "ok": good})
    return obj if good else None


def rate_item(rater: str, it: dict, cost: CostLog, caller=rater_call) -> tuple[dict | None, int]:
    """Ask, and ask again while the answer is unusable, at most RATER_MAX_REASKS more times (R2). -> (answer, calls).
    An infrastructure error is not an answer: it uses up no ask, waits and asks again (F3), and INFRA_STOP_AFTER in a
    row stop the run (InfraStop); a model mismatch or a budget stop goes straight through."""
    asks, infra = 0, 0
    while asks < CFG["RATER_MAX_REASKS"] + 1:
        try:
            obj = caller(rater, it["prompt"], cost, it["item"], it["kind"], it.get("n"))
        except (BudgetExceeded, ModelMismatch, InfraStop):
            raise
        except InfraError as e:
            infra += 1
            if infra > CFG["INFRA_STOP_AFTER"]:
                raise InfraStop(f"{infra} infrastructure errors on one judgement: {e}") from e
            print(f"{rater} {it['item']}: infrastructure error, waiting: {e}", file=sys.stderr)
            time.sleep(CFG["INFRA_BACKOFF_S"] * infra)
            continue
        except Exception as e:      # noqa: BLE001
            print(f"{rater} {it['item']}: {e}", file=sys.stderr)
            obj = None
        asks += 1
        if obj is not None:
            return obj, asks
    return None, asks


MADE_UP_BRIEF = ("Fleetwell makes electric vans for self-employed tradespeople who rent or lease. The vans are quiet, "
                 "cost less per mile to run and come with a three-year service plan. Fleetwell is a new name; most of its "
                 "customers drive a diesel van from a big brand. The client wants to be considered by plumbers and "
                 "electricians in their first year of business.")
MADE_UP_X = ("Insight: A plumber's van is the first thing a customer sees, so a van that lets him down lets the customer down.",
             "Proposition: The van that keeps your word")
MADE_UP_Y = ("Insight: Electric vans are better for the planet and cheaper to run.",
             "Proposition: Cheaper miles for working people")


def synthetic_item() -> dict:
    """The measuring item (R5): made up from the planning skill's van example, never one of the briefs."""
    return {"item": "synthetic", "kind": "pair", "question": PROP,
            "prompt": PROPOSITION_PROMPT.format(brief=MADE_UP_BRIEF, x_insight=MADE_UP_X[0].split(": ", 1)[1],
                                                y_insight=MADE_UP_Y[0].split(": ", 1)[1], x_smp=MADE_UP_X[1].split(": ", 1)[1],
                                                y_smp=MADE_UP_Y[1].split(": ", 1)[1])}


def cmd_smoke_rate(a):
    out = Path(a.out)
    cost = rater_cost_log(out)
    try:
        obj = rater_call(a.rater, synthetic_item()["prompt"], cost, "smoke-rate")
    except (InfraStop, ModelMismatch) as e:
        sys.exit(f"STOPPED: {e}")
    print(obj, f"{cost.spent:.4f} USD in the rater cost log")


def planned_judgements(out: Path) -> dict:
    key = json.loads((out / "key.json").read_text())
    return {r: len(key["pairs"]) + len(key["sameidea"]) for r in RATERS}


def project_rater(rows: list[dict], planned: dict) -> dict:
    """R5: projected rater spend = the median per-call cost per rater x that rater's planned judgements."""
    per = {}
    for r, n in planned.items():
        cs = [x["cost_usd"] for x in rows if x.get("rater") == r and x.get("job") == "synthetic" and x.get("cost_usd") is not None]
        per[r] = {"median_usd": statistics.median(cs) if cs else None, "calls_measured": len(cs), "judgements": n,
                  "usd": statistics.median(cs) * n if cs else None}
    total = sum(v["usd"] for v in per.values()) if all(v["usd"] is not None for v in per.values()) else None
    return {"per_rater": per, "total_usd": total, "cap_usd": CFG["RATER_HARD_CAP_USD"],
            "over_cap": total is not None and total > CFG["RATER_HARD_CAP_USD"]}


def cmd_measure_raters(a):
    out = Path(a.out)
    cost = rater_cost_log(out)
    it = synthetic_item()
    try:
        for r in RATERS:
            for _ in range(3):
                rater_call(r, it["prompt"], cost, "synthetic")
    except (InfraStop, ModelMismatch) as e:
        sys.exit(f"STOPPED: {e}")
    m = project_rater(read_log(out / "rater_cost_log.jsonl"), planned_judgements(out))
    (out / "rater_measure.json").write_text(json.dumps(m, indent=1))
    print(json.dumps(m, indent=1))
    if m["over_cap"]:
        print("projected rater spend is above the rater cap: STOP and report to the owner (R5); nothing is cut by the harness")


def cmd_rate(a):
    out = Path(a.out)
    check_run_config(out, "rate")
    mp = out / "rater_measure.json"
    if not mp.exists():
        sys.exit("run `measure-raters` first: rater cost is measured on a synthetic item before any real item is rated (R5)")
    if json.loads(mp.read_text())["over_cap"]:
        sys.exit("the measured rater projection is above the rater cap: report to the owner; set another cap in CFG first (R5)")
    rp = out / "rating_prompts.md"
    if not rp.exists() or rp.read_text() != rating_prompts_text():
        sys.exit("rating_prompts.md is missing or differs from the frozen prompts: run `packets` (it is written before the first rater call)")
    key = json.loads((out / "key.json").read_text())
    if key.get("results_sha256") != results_hash(out):
        sys.exit("key.json was built from different arms: run packets again")
    cost = rater_cost_log(out)
    (out / "ratings").mkdir(exist_ok=True)
    (out / "ratings_failed").mkdir(exist_ok=True)
    jobs = []
    for pf in sorted((out / "packets").glob("p*.json")):
        for it in json.loads(pf.read_text())["items"]:
            for r in a.raters:
                if not (out / "ratings" / f"{r}-{it['item']}.json").exists() and (a.retry_missing or not (out / "ratings_failed" / f"{r}-{it['item']}.json").exists()):
                    jobs.append((r, it))
    stop = threading.Event()
    fatal = []

    def one(j):
        r, it = j
        if stop.is_set():
            return
        try:
            obj, calls = rate_item(r, it, cost)
        except BudgetExceeded as e:
            stop.set()
            print(f"RATER BUDGET STOP: {e}", file=sys.stderr)
            return
        except InfraStop as e:      # nothing is written for this judgement: it is unrated, not failed
            stop.set()
            fatal.append(str(e))
            write_infra_stop(out, "rate", str(e), f"{r}-{it['item']}")
            print(f"INFRASTRUCTURE STOP: {e}", file=sys.stderr)
            return
        except ModelMismatch as e:
            stop.set()
            fatal.append(f"MODEL MISMATCH: {e}")
            print(f"MODEL MISMATCH: {e}", file=sys.stderr)
            return
        if obj is not None:
            (out / "ratings" / f"{r}-{it['item']}.json").write_text(json.dumps({"rater": r, "item": it["item"], **obj}))
        else:       # R2: missing after the re-asks; INCOMPLETE applies
            (out / "ratings_failed" / f"{r}-{it['item']}.json").write_text(json.dumps({"rater": r, "item": it["item"], "calls": calls}))

    with ThreadPoolExecutor(CFG["RATER_WORKERS"]) as ex:
        list(ex.map(one, jobs))
    print(f"{len(jobs)} judgements attempted, {cost.spent:.2f} USD in the rater cost log")
    if fatal:
        sys.exit(f"rate stopped: {fatal[0]}")


# ============================================================================ analysis (sections 6-7, R4-R11)
def gate_failures(*, failed_final_briefs: int, missing: list, x_share: dict, steps_ran: int, n: int) -> dict:
    """Validity gates, read first (7, R6, R10): missing data makes the verdict INCOMPLETE; a rater's position bias
    leaves no quality verdict."""
    incomplete, invalid = [], []
    if failed_final_briefs > EXTRA_MAX:
        incomplete.append(f"arms FAILED-final in {failed_final_briefs} briefs (more than 2)")
    if missing:
        incomplete.append(f"missing judgements: {', '.join(map(str, missing[:6]))}{'...' if len(missing) > 6 else ''}")
    need = STEPS_MIN_OF_20 if n == 20 else max(0, n - 2)
    if steps_ran < need:
        incomplete.append(f"only {steps_ran} of {n} steps ran to a result (need {need})")
    for r, s in x_share.items():
        if s is not None and s > X_BIAS_MAX:
            invalid.append(f"{r} picks position X in {s:.0%} of its non-tie answers")
    return {"incomplete": incomplete, "invalid": invalid}


NO_VERDICT = "NO VERDICT (validity gate)"


def verdict_of(gates: dict, go_conds: dict, drop_conds: dict, confounded: bool, extra_block: list) -> dict:
    """INCOMPLETE on missing data; NO VERDICT (validity gate) when a rater's position bias trips the gate, per idea as built
    (F8: it is not INCONCLUSIVE, which is a result); GO only when every GO
    condition holds, no length confound and nothing blocks it (survival not measured); else DROP when a DROP condition
    holds; else INCONCLUSIVE."""
    if gates["incomplete"]:
        return {"verdict": "INCOMPLETE", "why": gates["incomplete"]}
    if gates["invalid"]:
        return {"verdict": NO_VERDICT, "why": ["validity gate failed, no quality verdict: " + "; ".join(gates["invalid"])]}
    if all(go_conds.values()):
        if confounded:
            return {"verdict": "INCONCLUSIVE", "why": ["every GO condition holds but the primary result is confounded by length (R4)"]}
        if extra_block:
            return {"verdict": "INCONCLUSIVE", "why": extra_block}
        return {"verdict": "GO", "why": []}
    if any(drop_conds.values()):
        return {"verdict": "DROP", "why": [k for k, v in drop_conds.items() if v]}
    return {"verdict": "INCONCLUSIVE", "why": ["not every GO condition holds and no DROP condition does: " + ", ".join(k for k, v in go_conds.items() if not v)]}


def _within(treatment, baseline) -> bool:
    """A send-back guard: the treatment's count is at most 2 above the baseline's. A guard that was not measured (None)
    is not met: it never reads as 0 against 0."""
    return treatment is not None and baseline is not None and treatment - baseline <= EXTRA_MAX


def idea1_rules(d: dict) -> dict:
    """Idea 1 (7, R4, R8). `d` holds the tallies and measures; see `measures` for where they come from."""
    p, c, prop, ship = d["T1vC1.ins"], d["C1vB.ins"], d["T1vC1.prop"], d["T1vB.ins"]
    go = {"SR on T1 v C1 (insight)": sign_rule(p["W"], p["L"]),
          "Sonnet alone and Opus alone each W > L": each_rater_ahead(p),
          "net(T1 v C1) minus |net(C1 v B)| >= 4": p["net"] - abs(c["net"]) >= MARGIN_NET,
          "T1 v C1 on the proposition: W >= L": prop["W"] >= prop["L"],
          "T1 v B on the insight: W >= L": ship["W"] >= ship["L"],
          "median distinct ideas among the 9 >= 5": d["median_ideas"] is not None and d["median_ideas"] >= MEDIAN_IDEAS_MIN,
          "T1 over 57 words in at most 2 more briefs than C1": d["over57_t1"] - d["over57_c1"] <= EXTRA_MAX,
          "cost line": d["cost_ok"],
          "Jude fails T1's insight in at most 2 more briefs than B's (J0)": _within(d["jude_fail_ins_t1"], d["jude_fail_ins_b"]),
          "code sends T1's insight or proposition back in at most 2 more briefs than C1's": d["code_sb_t1"] - d["code_sb_c1"] <= EXTRA_MAX}
    drop = {"net(T1 v C1, insight) <= 2": p["net"] <= 2,
            "C1 passes SR against T1 on the proposition": sign_rule(prop["L"], prop["W"])}
    block = [] if d["survival_measured"] else ["the survival reviews were not measured (cut, or J0 or the review missing): at most INCONCLUSIVE"]
    r = verdict_of(d["gates"], go, drop, d["confounded"], block)
    r.update(go_conditions=go, drop_conditions=drop,
             guards_not_measured=[] if d["survival_measured"] else ["Jude fails T1's insight (v J0)"],
             plan_edit_alone_moves_the_draft={"C1vB.prop_SR_either_way": sign_rule(d["C1vB.prop"]["W"], d["C1vB.prop"]["L"]) or sign_rule(d["C1vB.prop"]["L"], d["C1vB.prop"]["W"]),
                                              "C1vB.ins_SR_either_way": sign_rule(c["W"], c["L"]) or sign_rule(c["L"], c["W"])})
    return r


def idea2_rules(d: dict) -> dict:
    """Idea 2 (7, R4, R9)."""
    s, l, l2 = d["SvO"], d["LvO"], d["L2vO"]
    go = {"SR on S v O": sign_rule(s["W"], s["L"]),
          "each rater alone W > L": each_rater_ahead(s),
          "net(S v O) at least 4 above the larger of net(L v O), net(L2 v O)": s["net"] - max(l["net"], l2["net"]) >= MARGIN_NET,
          "S's 8-pool median distinct ideas >= 5": d["median_s8"] is not None and d["median_s8"] >= MEDIAN_IDEAS_MIN,
          "S's first-4-plus-O median at least 1 above L's": d["median_s4"] is not None and d["median_l4"] is not None
          and d["median_s4"] - d["median_l4"] >= SUB_POOL_GAIN,
          "S winners fail a code check in at most 2 more briefs than O": d["code_fail_s"] - d["code_fail_o"] <= EXTRA_MAX,
          "Jude or code sends S's winner back in at most 2 more briefs than O": _within(d["sendback_s"], d["sendback_o"]),
          "cost line": d["cost_ok"]}
    drop = {"net(S v O) <= 2": s["net"] <= 2,
            "S's first-4-plus-O median no higher than L's": d["median_s4"] is not None and d["median_l4"] is not None and d["median_s4"] <= d["median_l4"]}
    block = [] if d["survival_measured"] else ["the survival reviews were not measured (cut, or J0 or the review missing): at most INCONCLUSIVE"]
    r = verdict_of(d["gates"], go, drop, d["confounded"], block)
    r.update(go_conditions=go, drop_conditions=drop,
             guards_not_measured=[] if d["survival_measured"] else ["Jude or code sends S's winner back (v J0)"])
    return r


def idea3_rules(d: dict) -> dict:
    """Idea 3 (7, R4, R10, R11): the 'GO via more send-backs' label rides on a GO."""
    p, ctl, a, b = d["R1vR0"], d["R0pvR0"], d["R1vO"], d["R0vO"]
    go = {"SR on R1 v R0": sign_rule(p["W"], p["L"]),
          "each rater alone W > L": each_rater_ahead(p),
          "net(R1 v R0) minus |net(R0' v R0)| >= 4": p["net"] - abs(ctl["net"]) >= MARGIN_NET,
          "net(R1 v O) >= net(R0 v O)": a["net"] >= b["net"],
          "R1 fails a code check in at most 2 more briefs than R0": d["code_fail_r1"] - d["code_fail_r0"] <= EXTRA_MAX,
          "cost line": d["cost_ok"]}
    drop = {"net(R1 v R0) <= 2": p["net"] <= 2, "net(R1 v O) 4 or more below net(R0 v O)": a["net"] <= b["net"] - 4}
    gates = copy.deepcopy(d["gates"])
    if d["unanswered_j1"] - d["unanswered_j0"] > EXTRA_MAX:
        gates["incomplete"].append("J1 leaves the proposition's tests unanswered in more than 2 more briefs than J0 (R10)")
    r = verdict_of(gates, go, drop, d["confounded"], [])
    wins = d["split"]
    only_r1 = wins.get("only_R1", 0)
    total_wins = sum(wins.values()) if wins else 0
    via = r["verdict"] == "GO" and total_wins > 0 and only_r1 > total_wins / 2
    if via:
        r["verdict"] = "GO via more send-backs"
    r.update(go_conditions=go, drop_conditions=drop, wins_by_rewrite_split=wins, go_via_more_sendbacks=via)
    return r


def length_confound(judgements: list[tuple], briefs_treatment_longer: int) -> dict:
    """R4. `judgements`: [(pick, words_of_first_named, words_of_other)] with pick +1, -1 or 0 for each judgement of the
    primary comparison. (a) the share of non-tie judgements won by the longer text, equal lengths left out; (b) the
    number of briefs where the treatment text is longer. Confounded when (a) >= 75% and (b) >= 15."""
    dec = [(p, a, b) for p, a, b in judgements if p != 0 and a != b]
    share = (sum(1 for p, a, b in dec if (p > 0) == (a > b)) / len(dec)) if dec else None
    return {"share_longer_wins": share, "n": len(dec), "treatment_longer_briefs": briefs_treatment_longer,
            "confounded": share is not None and share >= LENGTH_SHARE and briefs_treatment_longer >= LENGTH_BRIEFS}


def position_x_share(picks: list[str]) -> float | None:
    """Share of a rater's non-tie answers that pick position X."""
    nt = [p for p in picks if p in ("X", "Y")]
    return sum(p == "X" for p in nt) / len(nt) if nt else None


def order_agreement(pairs: list[list]) -> float | None:
    """Share of pairs, where both orders were answered, in which the two orders give the same score."""
    ok = [p for p in pairs if p[0] is not None and p[1] is not None]
    return sum(p[0] == p[1] for p in ok) / len(ok) if ok else None


def same_draft_picked(pairs: list[list]) -> float | None:
    """Share of pairs, where both orders were answered, in which both orders pick the same DRAFT (the same non-zero score:
    the same side first-named in both). Two 'no real difference' answers agree (order_agreement counts them) but pick no
    draft."""
    ok = [p for p in pairs if p[0] is not None and p[1] is not None]
    return sum(p[0] == p[1] != 0 for p in ok) / len(ok) if ok else None


def jude_noise(arms_by: dict, ids: list) -> dict:
    """R10: Jude's own noise, J0 against J0' (two runs of the same review): how often they disagree on failing the
    proposition or the insight, over the briefs where both ran. Read beside every send-back condition."""
    both = [b for b in ids if all((arms_by[b].get(j) or {}).get("status") == "ok" for j in ("J0", "J0p"))]
    dis = lambda k: sum(1 for b in both if bool(arms_by[b]["J0"][k]) != bool(arms_by[b]["J0p"][k]))
    return {"briefs": len(both), "disagree_on_failing_proposition": dis("jude_fails_proposition"),
            "disagree_on_failing_insight": dis("jude_fails_insight")}


def rewrite_split(pairs: list[tuple]) -> dict:
    """R10: R1 v R0's wins by (both rewritten, only R1, only R0, neither). `pairs`: [(outcome, r1_rewritten, r0_rewritten)]."""
    out = {"both": 0, "only_R1": 0, "only_R0": 0, "neither": 0}
    for o, r1, r0 in pairs:
        if o != "W":
            continue
        out["both" if r1 and r0 else "only_R1" if r1 else "only_R0" if r0 else "neither"] += 1
    return out


def read_rating(out: Path, rater: str, item: str):
    p = out / "ratings" / f"{rater}-{item}.json"
    return json.loads(p.read_text()) if p.exists() else None


def pair_scores(key: dict, ratings, ) -> tuple[dict, dict]:
    """-> (units {comparison: {brief: unit}}, picks {rater: [(pick, comparison, brief, order)]}). `ratings(rater, item)`
    -> the rating dict or None. A score is +1 when the picked side is the comparison's first-named side."""
    units: dict = {}
    picks = {r: [] for r in RATERS}
    for tk, why in key.get("auto_ties", {}).items():
        b, c = tk.split("|", 1)
        units.setdefault(c, {})[b] = {"tie": why}
    for item, k in key["pairs"].items():
        u = units.setdefault(k["comparison"], {}).setdefault(k["brief"], {"scores": {r: [None, None] for r in RATERS}})
        for r in RATERS:
            x = ratings(r, item)
            pk = normalise_pick((x or {}).get("better"))
            if pk is not None:
                side = {"X": k["X"], "Y": k["Y"]}.get(pk)
                u["scores"][r][k["order"] - 1] = 0 if pk == "no real difference" else (1 if side == k["first"] else -1)
            picks[r].append((pk, k["comparison"], k["brief"], k["order"]))
    return units, picks


def variety(key: dict, ratings, pool: str, keep_first4: bool = False) -> dict:
    """Distinct ideas per brief for one pool: the lower of the two raters' counts (R2: the first-4-plus-O sub-pool is
    derived from the same grouping by keeping those numbers). -> {brief: count | None, "missing": [...]}."""
    per, missing = {}, []
    for item, k in key["sameidea"].items():
        if k["pool"] != pool:
            continue
        keep = None
        if keep_first4:
            keep = {int(n) for n, v in k["numbers"].items() if v["source"] == "first_draft" or (v["idx"] is not None and v["idx"] < 4)}
        counts = []
        for r in RATERS:
            x = ratings(r, item)
            counts.append(distinct_ideas((x or {}).get("groups"), k["n"], keep) if x else None)
        if any(c is None for c in counts):
            missing.append(k["brief"])
        else:
            per[k["brief"]] = min(counts)
    return {"per_brief": per, "missing": missing, "median": median_of(per.values()),
            "min": min(per.values()) if per else None, "max": max(per.values()) if per else None}


def same_group(groups, a: int, b: int) -> bool | None:
    """Whether a rater put numbers a and b together; None when the grouping cannot be read."""
    if distinct_ideas(groups, max(a, b)) is None and not (isinstance(groups, list) and all(isinstance(g, list) for g in groups)):
        return None
    return any({_num(x) for x in g} >= {a, b} for g in groups)


def chosen_in_plan_group(key: dict, ratings, arms_by: dict) -> dict:
    """Idea 1, section 6: is the chosen hypothesis in the same group as the plan's own insight? Per rater, and by both."""
    per = {r: 0 for r in RATERS}
    both, n = 0, 0
    for item, k in key["sameidea"].items():
        h = (arms_by.get(k["brief"], {}).get("H1") or {})
        if k["pool"] != "H1" or h.get("status") != "ok" or h.get("chosen") is None:
            continue
        num = {v["source"]: int(i) for i, v in k["numbers"].items()}
        a, b = num.get("plan"), num.get(f"hyp:{h['chosen']}")
        if a is None or b is None:
            continue
        ans = {r: same_group((ratings(r, item) or {}).get("groups"), a, b) for r in RATERS}
        if any(v is None for v in ans.values()):
            continue
        n += 1
        for r, v in ans.items():
            per[r] += bool(v)
        both += all(ans.values())
    return {"briefs": n, "per_rater": per, "both_raters": both}


def _med(vals):
    return median_of([v for v in vals if v is not None])


def step_cost(arm: dict) -> tuple[float, float]:
    return (sum(c["cost_usd"] or 0 for c in arm.get("calls", [])), sum(c["secs"] or 0 for c in arm.get("calls", [])))


def cost_line_ok(costs: list[tuple]) -> dict:
    """The cost line (rule D5): the step's own calls cost at most 0.15 USD a brief at the median and take at most 60 s."""
    mc, ms = _med([c for c, _ in costs]), _med([s for _, s in costs])
    return {"median_usd": mc, "median_secs": ms, "max_usd": max((c for c, _ in costs), default=None),
            "max_secs": max((s for _, s in costs), default=None),
            "ok": mc is not None and mc <= COST_LINE_USD and ms <= COST_LINE_SECS}


def analyse(out: Path, inputs: list[dict], arms_by: dict, key: dict, ratings) -> dict:
    """Everything of sections 6-7 and R4-R11 from the arms, the key and the ratings. Pure given its arguments."""
    ids = [i["id"] for i in inputs]
    n = len(ids)
    inp_by = {i["id"]: i for i in inputs}
    units, picks = pair_scores(key, ratings)
    # a comparison never keyed has every brief an automatic tie already; briefs without a key entry stay absent
    T = {c: tally(units.get(c, {})) for c, *_ in comparisons()}
    res: dict = {"n_briefs": n, "tallies": T}

    def failed_final(arm_names):
        return sum(1 for b in ids if any((arms_by[b].get(a) or {}).get("status") == "FAILED_final" for a in arm_names if a in arms_by[b]))

    def x_shares(comps):
        return {r: position_x_share([p for p, c, *_ in picks[r] if c in comps]) for r in RATERS}

    def missing_of(comps):
        return sorted({f"{b}:{c}" for c in comps for b in T[c]["missing"]})

    def ran(arm, ok=OK_STATUS):
        return sum(1 for b in ids if (arms_by[b].get(arm) or {}).get("status") in ok)

    def per_arm_text(arm, kind, fn):
        out_ = {}
        for b in ids:
            t, _ = arm_text(arms_by[b], inp_by[b], arm)
            if t is not None:
                out_[b] = fn(t[0] if kind == INS else t[1])
        return out_

    def length_for(comp):
        _, idea, q, first, second = next(c for c in comparisons() if c[0] == comp)
        js = []
        longer = 0
        for item, k in key["pairs"].items():
            if k["comparison"] != comp:
                continue
            for r in RATERS:
                pk = normalise_pick((ratings(r, item) or {}).get("better"))
                if pk is None:
                    continue
                sc = 0 if pk == "no real difference" else (1 if {"X": k["X"], "Y": k["Y"]}[pk] == first else -1)
                js.append((sc, k["len"][first], k["len"][second]))
        for b in ids:
            ta, _ = arm_text(arms_by[b], inp_by[b], first)
            tb, _ = arm_text(arms_by[b], inp_by[b], second)
            if ta and tb:
                i = 0 if q == INS else 1
                longer += words(tidy(ta[i])) > words(tidy(tb[i]))
        return length_confound(js, longer)

    def order_ag(comp):
        out_ = {}
        for r in RATERS:
            out_[r] = order_agreement([units[comp][b]["scores"][r] for b in units.get(comp, {}) if "scores" in units[comp][b]])
        return out_

    def same_draft(comp):
        return {r: same_draft_picked([units[comp][b]["scores"][r] for b in units.get(comp, {}) if "scores" in units[comp][b]]) for r in RATERS}

    noise = jude_noise(arms_by, ids)

    # ---------------- idea 1
    h1, h1p = "H1", "H1p"
    v9 = variety(key, ratings, "H1")
    ok_ = lambda b, arm: (arms_by[b].get(arm) or {}).get("status") == "ok"
    over57_of = lambda arm, bs: sum(1 for b in bs if words(tidy(arms_by[b][arm]["insight"])) > INSIGHT_MAX_WORDS * SENT_BACK_MARGIN)
    over57 = lambda arm: over57_of(arm, [b for b in ids if ok_(b, arm)])
    # every guard compares a treatment with its baseline over the SAME briefs: those where both sides are ok (F1)
    pair_t1c1 = [b for b in ids if ok_(b, "T1") and ok_(b, "C1")]
    pair_sv1 = [b for b in ids if ok_(b, "SV1") and ok_(b, "J0")]
    sv1 = [arms_by[b]["SV1"] for b in ids if ok_(b, "SV1")]
    j0s = [arms_by[b]["J0"] for b in ids if ok_(b, "J0")]
    sb_any = lambda arm, bs: sum(1 for b in bs if {INS, PROP} & set(code_sendbacks(arms_by[b][arm]["whole"])))
    cost1 = cost_line_ok([step_cost(arms_by[b]["H1"]) for b in ids if (arms_by[b].get("H1") or {}).get("status") in OK_STATUS])
    # a step ran to a result when the hypotheses were ranked AND the T1 draft exists or is a no_gate
    steps1 = sum(1 for b in ids if (arms_by[b].get("H1") or {}).get("status") in OK_STATUS and (arms_by[b].get("T1") or {}).get("status") in OK_STATUS)
    sv1_measured = survival_measured(arms_by, ids, "SV1", out)
    g1 = gate_failures(failed_final_briefs=failed_final(("B", "C1", "H1", "T1", "SV1")), missing=g1_missing(T, v9, ["T1vC1.ins", "C1vB.ins", "T1vB.ins", "T1vC1.prop", "C1vB.prop"]),
                       x_share=x_shares({"T1vC1.ins", "C1vB.ins", "T1vB.ins", "T1vC1.prop", "C1vB.prop"}), steps_ran=steps1, n=n)
    d1 = {**{c: T[c] for c in ("T1vC1.ins", "C1vB.ins", "T1vB.ins", "T1vC1.prop", "C1vB.prop")}, "median_ideas": v9["median"],
          "over57_t1": over57_of("T1", pair_t1c1), "over57_c1": over57_of("C1", pair_t1c1), "cost_ok": cost1["ok"],
          "jude_fail_ins_t1": sum(bool(arms_by[b]["SV1"]["jude_fails_insight"]) for b in pair_sv1) if sv1_measured else None,
          "jude_fail_ins_b": sum(bool(arms_by[b]["J0"]["jude_fails_insight"]) for b in pair_sv1) if sv1_measured else None,
          "code_sb_t1": sb_any("T1", pair_t1c1), "code_sb_c1": sb_any("C1", pair_t1c1), "survival_measured": sv1_measured,
          "confounded": length_for("T1vC1.ins")["confounded"], "gates": g1}
    res["idea1"] = {"rules": idea1_rules(d1), "length": length_for("T1vC1.ins"), "variety_9": v9, "cost": cost1,
                    "order_agreement": order_ag("T1vC1.ins"), "same_draft_picked": same_draft("T1vC1.ins"), "jude_noise_J0_vs_J0p": noise, "x_share": x_shares({"T1vC1.ins", "C1vB.ins", "T1vB.ins", "T1vC1.prop", "C1vB.prop"}),
                    "no_gate": sum(1 for b in ids if (arms_by[b].get("H1") or {}).get("status") == "no_gate"),
                    "ranker_preferred": sum(1 for b in ids if (arms_by[b].get("H1") or {}).get("ranker_preferred")),
                    "ranker_preferred_subset_T1vC1": tally({b: u for b, u in units.get("T1vC1.ins", {}).items() if (arms_by[b].get("H1") or {}).get("ranker_preferred") is True}),
                    "chosen_in_plans_group": chosen_in_plan_group(key, ratings, arms_by),
                    "plan_rank": {b: (arms_by[b].get("H1") or {}).get("plan_rank") for b in ids},
                    "insight_over_50": {a: sum(per_arm_text(a, INS, lambda t: words(tidy(t)) > INSIGHT_MAX_WORDS).values()) for a in ("B", "C1", "T1")},
                    "insight_over_57": {a: over57(a) for a in ("B", "C1", "T1")},
                    "insight_basis_assumption": {a: sum(1 for b in ids if (arms_by[b].get(a) or {}).get("status") == "ok" and arms_by[b][a]["whole"][INS].get("basis") == "assumption") for a in ("B", "C1", "T1")},
                    "hypotheses_cite_nothing": sum(1 for b in ids for h in (arms_by[b].get("H1") or {}).get("hypotheses", []) if not h["cites"]),
                    "hypotheses_none_in_input": sum(1 for b in ids for h in (arms_by[b].get("H1") or {}).get("hypotheses", []) if "none in the input" in (h["counter_evidence"] or "").lower()),
                    "dangling_cites": sum(1 for b in ids for h in (arms_by[b].get("H1") or {}).get("hypotheses", []) if h["cites_dangling"]),
                    "survival": {"T1": _sv_counts(sv1), "B_via_J0": _sv_counts(j0s),
                                 "paired_briefs": len(pair_sv1), "paired_T1": _sv_counts([arms_by[b]["SV1"] for b in pair_sv1]),
                                 "paired_B_via_J0": _sv_counts([arms_by[b]["J0"] for b in pair_sv1])},
                    "guard_pairs": {"T1_C1_code_checks": len(pair_t1c1), "SV1_J0": len(pair_sv1)}, "step_ran": steps1,
                    "plain_best_of_8": T.get("T1vT1p.ins"), "D0vB": T.get("D0vB")}
    # ---------------- idea 2
    vs8, vl8, vl28 = variety(key, ratings, "S"), variety(key, ratings, "L"), variety(key, ratings, "L2")
    vs4, vl4, vl24 = variety(key, ratings, "S", True), variety(key, ratings, "L", True), variety(key, ratings, "L2", True)
    sv2 = [(b, arms_by[b]["SV2"]) for b in ids if ok_(b, "SV2")]
    pair_sv2 = [b for b in ids if ok_(b, "SV2") and ok_(b, "J0")]
    pair_so = [b for b in ids if ok_(b, "S") and ok_(b, "B")]
    s_win = per_arm_text("S", PROP, lambda t: code_flags(t, "smp"))
    o_win = per_arm_text("B", PROP, lambda t: code_flags(t, "smp"))
    sb = lambda x: bool(x["jude_fails_proposition"] or x["code_sends_proposition"])
    j0_sb_of = lambda b: bool(arms_by[b]["J0"]["jude_fails_proposition"] or PROP in arms_by[b]["J0"]["code_sendbacks_B"])
    j0_sb = sum(j0_sb_of(b) for b in pair_sv2)          # O's send-backs, on the briefs where S's survival review also ran
    s_sb = sum(sb(arms_by[b]["SV2"]) for b in pair_sv2)
    cost2 = cost_line_ok([step_cost(arms_by[b]["S"]) for b in ids if (arms_by[b].get("S") or {}).get("status") in OK_STATUS])
    steps2 = ran("S")
    c2 = ["SvO", "LvO", "L2vO"]
    sv2_measured = survival_measured(arms_by, ids, "SV2", out)
    g2 = gate_failures(failed_final_briefs=failed_final(("B", "S", "L", "L2", "SV2")), missing=g1_missing(T, vs8, c2) + [f"{b}:L pool" for b in vl8["missing"]],
                       x_share=x_shares(set(c2)), steps_ran=steps2, n=n)
    d2 = {"SvO": T["SvO"], "LvO": T["LvO"], "L2vO": T["L2vO"], "median_s8": vs8["median"], "median_s4": vs4["median"], "median_l4": vl4["median"],
          "code_fail_s": sum(1 for b in pair_so if s_win[b]["fails_code_check"]), "code_fail_o": sum(1 for b in pair_so if o_win[b]["fails_code_check"]),
          "sendback_s": s_sb if sv2_measured else None, "sendback_o": j0_sb if sv2_measured else None, "cost_ok": cost2["ok"],
          "survival_measured": sv2_measured, "confounded": length_for("SvO")["confounded"], "gates": g2}
    seeds = {}
    for b in ids:
        a = arms_by[b].get("S") or {}
        if a.get("status") == "ok":
            seeds[a["winner_seed"]] = seeds.get(a["winner_seed"], 0) + 1
    res["idea2"] = {"rules": idea2_rules(d2), "length": length_for("SvO"),
                    "variety": {"S8": vs8, "L8": vl8, "L28": vl28, "S4plusO": vs4, "L4plusO": vl4, "L24plusO": vl24},
                    "cost": cost2, "order_agreement": order_ag("SvO"), "same_draft_picked": same_draft("SvO"), "jude_noise_J0_vs_J0p": noise, "x_share": x_shares(set(c2)),
                    "no_gate": sum(1 for b in ids if (arms_by[b].get("S") or {}).get("status") == "no_gate"),
                    "kept_by_ranker_subset_SvO": _kept_subset(units.get("SvO", {}), arms_by, ids),
                    "winners_by_seed": seeds, "share_identity_or_social": ((seeds.get(2, 0) + seeds.get(5, 0)) / sum(seeds.values())) if seeds else None,
                    "code_checks": {"S": _count_flags(s_win), "O": _count_flags(o_win)},
                    "candidates_citing_nothing": {a: sum(1 for b in ids for p in (arms_by[b].get(a) or {}).get("pool", []) if p["source"] != "first_draft" and not p.get("cites"))
                                                  for a in ("S", "L", "L2")},
                    "send_backs": {"S_winner_in_B": s_sb, "O_via_J0": j0_sb, "paired_briefs": len(pair_sv2)},
                    "survival": {"S_winner": _sv_counts([x for _, x in sv2]), "B_via_J0": _sv_counts(j0s),
                                 "paired_briefs": len(pair_sv2), "paired_S_winner": _sv_counts([arms_by[b]["SV2"] for b in pair_sv2]),
                                 "paired_B_via_J0": _sv_counts([arms_by[b]["J0"] for b in pair_sv2])},
                    "guard_pairs": {"S_O_code_checks": len(pair_so), "SV2_J0": len(pair_sv2)}, "step_ran": steps2}
    # ---------------- idea 3
    if CFG["INCLUDE_IDEA3"]:
        c3 = ["R1vR0", "R0pvR0", "R1vO", "R0vO"]
        rw = []
        for b in ids:
            u = units.get("R1vR0", {}).get(b)
            if u and "scores" in u and (arms_by[b].get("J1") or {}).get("status") == "ok" and (arms_by[b].get("J0") or {}).get("status") == "ok":
                rw.append((brief_outcome(u["scores"]), arms_by[b]["J1"]["rewritten"], arms_by[b]["J0"]["rewritten"]))
        flags = {a: {b: code_flags(arms_by[b][j]["proposition"], "smp") for b in ids if (arms_by[b].get(j) or {}).get("status") == "ok"}
                 for a, j in (("R0", "J0"), ("R0p", "J0p"), ("R1", "J1"))}
        flags["O"] = o_win
        extra_costs = []
        for b in ids:
            if all((arms_by[b].get(j) or {}).get("status") == "ok" for j in ("J0", "J1")):
                c1_, s1_ = step_cost(arms_by[b]["J1"])
                c0_, s0_ = step_cost(arms_by[b]["J0"])
                extra_costs.append((c1_ - c0_, s1_ - s0_))
        cost3 = cost_line_ok(extra_costs)
        pair_r = [b for b in ids if ok_(b, "J1") and ok_(b, "J0")]       # F1: every guard on the briefs where both sides ran
        un = lambda j, bs=pair_r: sum(1 for b in bs if arms_by[b][j]["unanswered_proposition"])
        steps3 = sum(1 for b in ids if (arms_by[b].get("J1") or {}).get("status") == "ok")
        g3 = gate_failures(failed_final_briefs=failed_final(("B", "J0", "J0p", "J1")), missing=g1_missing(T, {"missing": []}, c3),
                           x_share=x_shares(set(c3)), steps_ran=steps3, n=n)
        d3 = {"R1vR0": T["R1vR0"], "R0pvR0": T["R0pvR0"], "R1vO": T["R1vO"], "R0vO": T["R0vO"],
              "code_fail_r1": sum(1 for b in pair_r if flags["R1"][b]["fails_code_check"]), "code_fail_r0": sum(1 for b in pair_r if flags["R0"][b]["fails_code_check"]),
              "cost_ok": cost3["ok"], "unanswered_j1": un("J1"), "unanswered_j0": un("J0"), "split": rewrite_split(rw),
              "confounded": length_for("R1vR0")["confounded"], "gates": g3}
        fail = lambda j, key_: sum(1 for b in ids if (arms_by[b].get(j) or {}).get("status") == "ok" and arms_by[b][j][key_])
        res["idea3"] = {"rules": idea3_rules(d3), "length": length_for("R1vR0"), "cost_j1_minus_j0": cost3,
                        "order_agreement": order_ag("R1vR0"), "same_draft_picked": same_draft("R1vR0"), "x_share": x_shares(set(c3)),
                        "code_checks": {a: _count_flags(f) for a, f in flags.items()},
                        "jude_fails_proposition": {j: fail(j, "jude_fails_proposition") for j in ("J0", "J0p", "J1")},
                        "code_alone_sends_back": {j: sum(1 for b in ids if (arms_by[b].get(j) or {}).get("status") == "ok" and arms_by[b][j]["sent_by"] == "code") for j in ("J0", "J0p", "J1")},
                        "unanswered": {j: un(j, [b for b in ids if ok_(b, j)]) for j in ("J0", "J0p", "J1")}, "guard_pairs": {"J1_J0": len(pair_r)},
                        "jude_noise_J0_vs_J0p": noise,
                        "rewrites_per_arm": {j: sum(len(arms_by[b][j]["rewrites"]) for b in ids if (arms_by[b].get(j) or {}).get("status") == "ok") for j in ("J0", "J0p", "J1")},
                        "client_questions": {j: sum(len(arms_by[b][j]["questions"]) for b in ids if (arms_by[b].get(j) or {}).get("status") == "ok") for j in ("J0", "J0p", "J1")},
                        "propositions_carrying_the_mark": {j: sum(1 for b in ids if (arms_by[b].get(j) or {}).get("status") == "ok" and str(arms_by[b][j]["whole_proposition_entry"]["value"]).lower().startswith("to confirm")) for j in ("J0", "J0p", "J1")},
                        "changed_by_R1_not_R0": sum(1 for b in ids if all((arms_by[b].get(j) or {}).get("status") == "ok" for j in ("J0", "J1")) and tidy(arms_by[b]["J1"]["proposition"]) != tidy(arms_by[b]["B"]["proposition"]) and tidy(arms_by[b]["J0"]["proposition"]) == tidy(arms_by[b]["B"]["proposition"])),
                        "changed_by_R0_not_R1": sum(1 for b in ids if all((arms_by[b].get(j) or {}).get("status") == "ok" for j in ("J0", "J1")) and tidy(arms_by[b]["J0"]["proposition"]) != tidy(arms_by[b]["B"]["proposition"]) and tidy(arms_by[b]["J1"]["proposition"]) == tidy(arms_by[b]["B"]["proposition"])),
                        "step_ran": steps3}
    # ---------------- all: shown-text labels (R3), arm failures, retries
    left = leftover_by_arm(inputs, arms_by)
    res["leftover_labels_in_shown_texts"] = left
    fails, retries = {}, []
    for b in ids:
        for name, a in arms_by[b].items():
            if a.get("status") == "FAILED_final":
                fails.setdefault(name, []).append(b)
            for c in a.get("calls", []):
                if c["attempts"] > 1 or not c["ok"]:
                    retries.append({"brief": b, "arm": name, "purpose": c["purpose"], "attempts": c["attempts"], "ok": c["ok"],
                                    "first_validation_error": c["first_validation_error"], "error": c["error"]})
    res["failed_final"] = fails
    res["retries"] = retries
    res["costs_by_arm_median_usd_secs"] = {name: {"usd": _med([step_cost(arms_by[b][name])[0] for b in ids if name in arms_by[b]]),
                                                  "secs": _med([step_cost(arms_by[b][name])[1] for b in ids if name in arms_by[b]])}
                                           for name in sorted({k for b in ids for k in arms_by[b]})}
    return res


def survival_measured(arms_by: dict, ids: list, sv_arm: str, out: Path) -> bool:
    """F1, F2: the send-back guards are measured only when the survival reviews were not cut (R5) and every brief's
    survival arm AND its baseline J0 are settled (ran to a result, or FAILED-final). A FAILED-final one is missing
    data under R6, counted by the gate's FAILED-final list, never read as 'measured and found nothing'."""
    done = OK_STATUS + ("FAILED_final",)
    return bool(ids) and not _survival_dropped(out) and all(
        (arms_by[b].get(a) or {}).get("status") in done for b in ids for a in (sv_arm, "J0"))


def g1_missing(T, v, comps):
    return sorted({f"{b}:{c}" for c in comps for b in T[c]["missing"]} | {f"{b}:pool" for b in v.get("missing", [])})


def _survival_dropped(out: Path) -> bool:
    p = out / "pilot.json"
    return p.exists() and json.loads(p.read_text())["decision"] == "drop_survival"


def _sv_counts(xs: list) -> dict:
    return {"briefs": len(xs), "jude_fails_proposition": sum(bool(x.get("jude_fails_proposition")) for x in xs),
            "jude_fails_insight": sum(bool(x.get("jude_fails_insight")) for x in xs),
            "code_sends_proposition": sum(bool(x.get("code_sends_proposition")) for x in xs)}


def _count_flags(fl: dict) -> dict:
    keys = ("over_limit", "sent_back_length", "multi_sentence", "standalone_and", "single_minded_flag", "colon_semicolon_dash", "fails_code_check")
    return {k: sum(1 for f in fl.values() if f.get(k)) for k in keys}


def _kept_subset(units: dict, arms_by: dict, ids: list) -> dict:
    sub = {b: u for b, u in units.items() if (arms_by[b].get("S") or {}).get("kept_by_ranker") is False}
    return tally(sub)


def _fmt_tally(t) -> str:
    if t is None:
        return "-"
    s = f"W {t['W']} / L {t['L']} / T {t['T']} (net {t['net']})"
    s += f"; Sonnet W{t['per_rater']['sonnet']['W']} L{t['per_rater']['sonnet']['L']}, Opus W{t['per_rater']['opus']['W']} L{t['per_rater']['opus']['L']}"
    return s + (f"; MISSING {len(t['missing'])}" if t["missing"] else "")


# R11, word for word: how the verdicts are to be read, printed at the head of analysis.md
R11_TEXT = (
    "The section 2 power table is for the sign rule alone; GO also needs each rater's W > L and the net margins, so GO's "
    "power is lower than the table.",
    "A true 70% effect ends in DROP (net 2 or less) in 11% of runs with no ties, 15% with 20% ties and 24% with 40% ties "
    "(exact multinomial). DROP therefore means \"no evidence of a large effect on 20 fictional, research-off briefs\", not "
    "\"the idea does not work\".",
    "40 briefs give 80% power at a true 70% only with no ties: 70% with 20% ties, 56% with 40%.",
    "Idea 3 can pass the sign rule only if W is at least 8 among briefs where R1 and R0 differ; where both paths leave the "
    "proposition alone the brief is a tie. If the paths differ in few briefs, GO is out of reach by construction.")
POWER_CAVEAT = (
    "Power (section 2, sign rule alone): with 20 briefs a true share of 60% for the treatment among the briefs raters can "
    "separate is found 13% of the time, 70% about 4 times in 10, 80% about 8 in 10 (no ties). With three ideas the chance "
    "that at least one passes by luck is 6% to 9%. A verdict here is a statement about a large effect on 20 fictional "
    "briefs, not about the idea.")


def _cost_cell(c: dict) -> str:
    f = lambda v, fmt: "-" if v is None else format(v, fmt)
    return (f"median {f(c.get('median_usd'), '.3f')} USD, {f(c.get('median_secs'), '.1f')} s; "
            f"max {f(c.get('max_usd'), '.3f')} USD, {f(c.get('max_secs'), '.1f')} s; "
            f"cost line {'met' if c.get('ok') else 'not met'}")


def render_md(r: dict) -> str:
    T = r["tallies"]
    L = [f"# Analysis ({r['n_briefs']} briefs)\n", "Verdicts are the pre-registered rules of section 7 with R4 to R11; nothing here is a judgement call.\n",
         "## How to read the verdicts (R11)\n"] + [f"- {x}" for x in R11_TEXT] + ["", POWER_CAVEAT, "",
         f"A position-bias trip is labelled {NO_VERDICT}, not INCONCLUSIVE: no quality verdict exists. It is read per idea as built, "
         "over each idea's own pair items.\n"]

    def table(title, rows):
        L.append(f"\n## {title}\n")
        L.append("| Row | Value |\n|---|---|")
        L.extend(f"| {a} | {str(b).replace('|', '/')} |" for a, b in rows)
    i1, i2 = r["idea1"], r["idea2"]
    table(f"Idea 1: insight investigator: {i1['rules']['verdict']}", [
        ("Verdict reasons", "; ".join(i1["rules"]["why"]) or "-"),
        ("Primary W/L/T: T1 v C1, insight", _fmt_tally(T["T1vC1.ins"])),
        ("Control: C1 v B, insight", _fmt_tally(T["C1vB.ins"])),
        ("Other: T1 v C1 proposition", _fmt_tally(T["T1vC1.prop"])), ("Other: T1 v B insight", _fmt_tally(T["T1vB.ins"])),
        ("Other: C1 v B proposition", _fmt_tally(T["C1vB.prop"])),
        ("Ranker-preferred subset: briefs / T1 v C1 insight W/L/T", f"{i1['ranker_preferred']} / {_fmt_tally(i1['ranker_preferred_subset_T1vC1'])}"),
        ("Is the chosen hypothesis in the plan's group (rater grouping)", i1["chosen_in_plans_group"]),
        ("Order agreement per rater (T1 v C1): both orders give the same answer", i1["order_agreement"]),
        ("Same draft picked in both orders (T1 v C1)", i1["same_draft_picked"]), ("Share of non-tie answers picking X", i1["x_share"]),
        ("Distinct ideas among the 9: median / min / max (lower rater)", f"{i1['variety_9']['median']} / {i1['variety_9']['min']} / {i1['variety_9']['max']}"),
        ("Code checks: insight over 50 / over 57 (B, C1, T1)", f"{i1['insight_over_50']} / {i1['insight_over_57']}"),
        ("Insight basis assumption (B, C1, T1)", i1["insight_basis_assumption"]),
        ("Hypotheses citing nothing / 'none in the input' / dangling cites", f"{i1['hypotheses_cite_nothing']} / {i1['hypotheses_none_in_input']} / {i1['dangling_cites']}"),
        ("Survival: T1 vs B (via J0)", i1["survival"]),
        ("Jude's own noise, J0 v J0', beside the send-back conditions", i1["jude_noise_J0_vs_J0p"]),
        ("Send-back guards not measured", i1["rules"]["guards_not_measured"] or "none"), ("Length confound (R4)", i1["length"]),
        ("USD and seconds of the step's own calls (median, max)", _cost_cell(i1["cost"])), ("Step ran to a result / no_gate", f"{i1['step_ran']} / {i1['no_gate']}"),
        ("Plan edit alone moves the draft (recorded apart)", i1["rules"]["plan_edit_alone_moves_the_draft"]),
        ("GO conditions", i1["rules"]["go_conditions"]), ("DROP conditions", i1["rules"]["drop_conditions"])])
    table(f"Idea 2: named routes as seeds: {i2['rules']['verdict']}", [
        ("Verdict reasons", "; ".join(i2["rules"]["why"]) or "-"),
        ("Primary W/L/T: S v O", _fmt_tally(T["SvO"])), ("Control: L v O", _fmt_tally(T["LvO"])), ("Control: L2 v O", _fmt_tally(T["L2vO"])),
        ("Other: S v O where the ranker did not keep O", _fmt_tally(i2["kept_by_ranker_subset_SvO"])),
        ("Order agreement per rater (S v O): both orders give the same answer", i2["order_agreement"]),
        ("Same draft picked in both orders (S v O)", i2["same_draft_picked"]), ("Share of non-tie answers picking X", i2["x_share"]),
        ("Distinct ideas, 8-pools median/min/max", {k: (v["median"], v["min"], v["max"]) for k, v in i2["variety"].items() if k in ("S8", "L8", "L28")}),
        ("Distinct ideas, first 4 plus O (R9)", {k: (v["median"], v["min"], v["max"]) for k, v in i2["variety"].items() if "4plusO" in k}),
        ("Code checks (S winners, O)", i2["code_checks"]), ("Candidates citing nothing (S, L, L2)", i2["candidates_citing_nothing"]),
        ("Send-backs: S winner v O", i2["send_backs"]), ("Survival", i2["survival"]),
        ("Jude's own noise, J0 v J0', beside the send-back conditions", i2["jude_noise_J0_vs_J0p"]),
        ("Send-back guards not measured", i2["rules"]["guards_not_measured"] or "none"), ("Length confound (R4)", i2["length"]),
        ("USD and seconds of the step's own calls (median, max)", _cost_cell(i2["cost"])), ("Step ran to a result / no_gate", f"{i2['step_ran']} / {i2['no_gate']}"),
        ("Winners by seed / share on identity or social meaning", f"{i2['winners_by_seed']} / {i2['share_identity_or_social']}"),
        ("GO conditions", i2["rules"]["go_conditions"]), ("DROP conditions", i2["rules"]["drop_conditions"])])
    if "idea3" in r:
        i3 = r["idea3"]
        table(f"Idea 3: the critic's two questions: {i3['rules']['verdict']}", [
            ("Verdict reasons", "; ".join(i3["rules"]["why"]) or "-"),
            ("Primary W/L/T: R1 v R0", _fmt_tally(T["R1vR0"])), ("Control: R0' v R0", _fmt_tally(T["R0pvR0"])),
            ("Other: R1 v O", _fmt_tally(T["R1vO"])), ("Other: R0 v O", _fmt_tally(T["R0vO"])),
            ("R1 v R0 wins by rewrite split (R10)", i3["rules"]["wins_by_rewrite_split"]),
            ("Order agreement per rater (R1 v R0): both orders give the same answer", i3["order_agreement"]),
            ("Same draft picked in both orders (R1 v R0)", i3["same_draft_picked"]), ("Share of non-tie answers picking X", i3["x_share"]),
            ("Code checks (O, R0, R0', R1)", i3["code_checks"]), ("Propositions carrying the mark", i3["propositions_carrying_the_mark"]),
            ("Client questions per arm", i3["client_questions"]), ("Jude fails the proposition (J0, J0', J1)", i3["jude_fails_proposition"]),
            ("Code alone sends back", i3["code_alone_sends_back"]), ("Unanswered proposition tests", i3["unanswered"]),
            ("Jude's own noise (J0 v J0')", i3["jude_noise_J0_vs_J0p"]), ("Rewrites per arm", i3["rewrites_per_arm"]),
            ("Changed by R1 but not R0 / reverse", f"{i3['changed_by_R1_not_R0']} / {i3['changed_by_R0_not_R1']}"),
            ("USD and seconds, J1 minus J0 (median, max)", _cost_cell(i3["cost_j1_minus_j0"])), ("Length confound (R4)", i3["length"]),
            ("Step ran to a result", i3["step_ran"]),
            ("GO conditions", i3["rules"]["go_conditions"]), ("DROP conditions", i3["rules"]["drop_conditions"])])
    if r.get("run_config"):
        rc = r["run_config"]
        L.append("\n## Run configuration (the pilot's snapshot, F5)\n")
        L.append(f"git HEAD {rc['git_head']}; uncommitted-changes hash {rc['git_diff_sha256']}; taken {rc['taken_at']}"
                 + (f"; re-snapshots: {len(rc.get('previous', []))}" if rc.get("previous") else ""))
        L.append("\n```json\n" + json.dumps({"cfg": rc["cfg"], "models": rc["models"]}, indent=1) + "\n```")
    L.append("\n## Shown texts that still begin with four or fewer words and a colon (R3), per arm\n")
    L.append(str(r["leftover_labels_in_shown_texts"]))
    L.append("\n## Arms FAILED-final (R6): every comparison needing one is a tie\n")
    L.append(str(r["failed_final"] or "none"))
    L.append("\n## Calls needing a second attempt or failing, with the first validation error\n")
    L.extend(f"- {x['brief']} {x['arm']} {x['purpose']}: attempts {x['attempts']}, ok {x['ok']}: {x['first_validation_error'] or x['error']}" for x in r["retries"])
    L.append("\n## Median USD and seconds of each arm's calls (retries included)\n")
    L.append(str(r["costs_by_arm_median_usd_secs"]))
    return "\n".join(L) + "\n"


def cmd_analyse(a):
    out = Path(a.out)
    snapshot = check_run_config(out, "analyse")
    inputs = load_inputs(out)
    arms_by = load_arms(out, [i["id"] for i in inputs])
    key = json.loads((out / "key.json").read_text())
    res = analyse(out, inputs, arms_by, key, lambda r, item: read_rating(out, r, item))
    res["run_config"] = snapshot
    res["stale_key"] = key.get("results_sha256") != results_hash(out)
    if res["stale_key"]:
        for k in ("idea1", "idea2", "idea3"):
            if k in res:
                res[k]["rules"].update(verdict="INCOMPLETE", why=["key.json was built from different arms: run packets, then rate, again"])
    (out / "analysis.json").write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str))
    (out / "analysis.md").write_text(render_md(res))
    print(json.dumps({k: res[k]["rules"]["verdict"] for k in ("idea1", "idea2", "idea3") if k in res}, indent=1))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(OUT_DEFAULT))
    ap.add_argument("--max-usd", type=float, default=CFG["REPLAY_WORKING_LIMIT_USD"],
                    help="replay cap; never above REPLAY_HARD_CAP_USD, whatever you pass")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("select"); s.add_argument("--src", default=str(SRC_DEFAULT)); s.set_defaults(f=cmd_select)
    sub.add_parser("smoke").set_defaults(f=cmd_smoke)
    s = sub.add_parser("smoke-rate"); s.add_argument("--rater", default="opus", choices=list(RATERS)); s.set_defaults(f=cmd_smoke_rate)
    sub.add_parser("pilot").set_defaults(f=cmd_pilot)
    s = sub.add_parser("replay"); s.add_argument("--only", nargs="*"); s.add_argument("--force", action="store_true")
    s.add_argument("--reason"); s.set_defaults(f=cmd_replay)
    sub.add_parser("packets").set_defaults(f=cmd_packets)
    sub.add_parser("measure-raters").set_defaults(f=cmd_measure_raters)
    s = sub.add_parser("rate"); s.add_argument("--raters", nargs="*", default=list(RATERS)); s.add_argument("--retry-missing", action="store_true")
    s.set_defaults(f=cmd_rate)
    sub.add_parser("analyse").set_defaults(f=cmd_analyse)
    sub.add_parser("cost").set_defaults(f=cmd_cost)
    a = ap.parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    main()
