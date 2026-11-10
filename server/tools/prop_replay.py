#!/usr/bin/env python3
"""Phase 0 of features/brief-proposition-candidates.clan (P0): an offline replay of the candidate step.

    cd server && uv run --frozen python tools/prop_replay.py <command> [options]

    inputs    fix the set by the mechanical rule and copy what is needed from the award A/B's stored runs
              (read-only) into <out>/inputs/; writes inputs/selection.json BEFORE any model call
    replay    for each input: generate 4 candidates, pool them with the stored first draft, rank, gate, choose
              (napkin.brief.candidates.pick). No match call, no Brief Maker job, no judge. Writes results/,
              blocks/ (the first draft's block and the winner's block per brief), blocks.md and the cost log
    packets   blinded rater packets: packets/order1.json and order2.json (the pair in both orders, A/B swapped,
              the arm hidden), packets/sameidea.json, and key.json (kept apart, read only by `analyse`)
    rate      the raters (Sonnet 5.5 and Opus 5.5, `claude -p`, one fresh call per judgement) over the packets
    analyse   unblind the ratings and apply the pre-registered P0 rule exactly; writes analysis.json
    smoke     ONE tiny model call through the same path as `replay`, to prove it works (logs its cost)

How model calls are made (replay): napkin.model.ModelPort, the middleware's own port, with the routes of
server/model-routes.example.json (what staging runs) plus candidates_smp at effort medium (the file gains that
line only in phase 1), over a thin Anthropic-SDK-shaped client that runs `claude -p` exactly as the mock backend
does (mock-backend/common.py claude_argv: no tools, no session, no settings, the system prompt on a pipe, --effort
from the route). So the prompts, schema-in-prompt mode, validation and one retry are the middleware's, the model
is claude-sonnet-5-5, and cost is the CLI's own total_cost_usd. Raters go through `claude -p` from a folder
outside any repository, as the award A/B's rate.py does.

Nothing here reads or writes client material. Outputs go under runs/metrics/ (gitignored).
"""

from __future__ import annotations

import argparse
import hashlib
import json
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

SRC_DEFAULT = Path("/Users/saieeshwar/Projects/Work/work/napkin/napkin-studio-os/runs/metrics/award-ab-2026-11-10")
OUT_DEFAULT = REPO / "runs/metrics/prop-replay-2026-11-10"
CLAUDE = os.environ.get("CLAUDE_BIN") or str(Path.home() / ".local/bin/claude")
RATER_CWD = Path.home() / ".cache" / "napkin-raters"
RATERS = {"sonnet": "claude-sonnet-5-5", "opus": "claude-opus-5-5"}
N_JOBS = 20
SALT = "prop-replay-2026-11-10"
# The candidates are written at the effort staging gives the brief writers; rank_smp stays at the default (low).
CANDIDATES_ROUTE = {"effort": "medium"}

# ============================================================================ P0: the pre-registered rule
P0_MIN_NET = 6        # (a) W - L >= 6
P0_MIN_WINS = 8       # (a) and W >= 8
P0_MIN_MEDIAN_IDEAS = 3   # (c)
P0_MAX_EXTRA_AND = 2      # (d) winners carry the flag in at most 2 more jobs than the first drafts

# ============================================================================ the frozen rating prompts
PAIR_PROMPT = """You are a senior advertising planner. A client wrote the brief below. Two planners each wrote an insight and a single-minded proposition (their reasons to believe and the objection the proposition has to beat are left out here). Decide which PROPOSITION is better for this brief, reading each with its own insight. Do not pick a draft because its insight is more interesting: judge the proposition alone.

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

SAME_IDEA_PROMPT = """Here are {n} propositions written for the same brief. Put together the ones that say the same thing in different words. JSON only: {{"groups": [[numbers], ...]}}

{listing}"""


# ============================================================================ pure: selection
def select_runs(entries: list[dict], n: int = N_JOBS) -> list[str]:
    """The mechanical rule: of the runs of the off and thin arms, in folder-name order, the first `n` that ended
    'done'. `entries`: [{"name": "c01-off", "state": "done" | ...}]. A run still being written has no state."""
    ok = [e["name"] for e in sorted(entries, key=lambda e: e["name"])
          if e.get("state") == "done" and re.search(r"-(off|thin)$", e["name"])]
    if len(ok) < n:
        raise ValueError(f"only {len(ok)} done runs of the off and thin arms, need {n}")
    return ok[:n]


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
    """What the replay needs of one stored run: the draft_brief_whole payload and the first draft it wrote."""
    evs = [json.loads(l) for l in runlog_lines if '"draft_brief_whole"' in l]
    evs = [e for e in evs if e.get("ev") == "model" and e.get("purpose") == "draft_brief_whole"]
    if len(evs) != 1:
        raise ValueError(f"{name}: expected one draft_brief_whole call, found {len(evs)}")
    e = evs[0]
    payload, reply = e["payload"]["payload"], e["reply"]
    for k in ("insight", "single_minded_proposition"):
        if not isinstance((reply.get(k) or {}).get("value"), str):
            raise ValueError(f"{name}: the first draft has no {k}")
    return {"name": name, "brief_text": payload["client_said"], "strategy": (payload.get("plan") or {}).get("strategy"),
            "facts": payload.get("facts") or [], "findings": payload.get("findings") or [],
            "client_words": payload.get("client_words") or [], "library": payload.get("library") or [],
            "first_draft": {k: (v or {}).get("value") for k, v in reply.items() if isinstance(v, dict)},
            "source_call": {"secs": e.get("secs"), "cost": e.get("cost"), "in_tokens": e.get("in_tokens"),
                            "out_tokens": e.get("out_tokens")}}


# ============================================================================ pure: blocks, blinding
def tidy(text) -> str:
    """A proposition as a rater sees it: no 'To confirm:' mark, no trailing full stop (a style tell between a
    candidate and a first draft), no surrounding space."""
    t = re.sub(r"(?i)^\s*to confirm:\s*", "", str(text or "")).strip()
    return t[:-1].rstrip() if t.endswith(".") and not t.endswith("..") else t


def coin(*parts) -> int:
    return hashlib.sha256("|".join((SALT,) + tuple(str(p) for p in parts)).encode()).digest()[0] & 1


def opaque(*parts) -> str:
    return hashlib.sha256("|".join((SALT, "id") + tuple(str(p) for p in parts)).encode()).hexdigest()[:8]


def render_pair(brief: str, insight: str, x: str, y: str) -> str:
    return PAIR_PROMPT.format(brief=brief.strip(), x_insight=insight, y_insight=insight, x_smp=x, y_smp=y)


def build_packets(rows: list[dict]):
    """Blinded rater packets and the key. `rows`: one per brief with `name`, `brief_text`, `insight`,
    `first` (the first draft's proposition), `winner_source`, `winner` (its words; None when the first draft stands
    or nothing cleared) and `pool` ([{source, value}]). A pair is made only where a new candidate won.
    -> (order1, order2, sameidea, key). Which position holds which side is a seeded coin per brief; order 2 is
    order 1 swapped; item ids are opaque and the items are in a seeded shuffle, so neither the item id nor the
    place in the file says anything. The packets name no arm, source or seed."""
    pairs1, pairs2, ideas, key = [], [], [], {"pairs": {}, "sameidea": {}}
    for r in rows:
        if r["winner"] is not None and r["winner_source"] != "first_draft":
            first, win = tidy(r["first"]), tidy(r["winner"])
            swap = coin("pos", r["name"])
            for order, bucket in ((1, pairs1), (2, pairs2)):
                win_is_x = (swap == 0) == (order == 1)
                x, y = (win, first) if win_is_x else (first, win)
                item = f"o{order}-{opaque('pair', r['name'], order)}"
                bucket.append({"item": item, "kind": "pair", "prompt": render_pair(r["brief_text"], tidy(r["insight"]), x, y)})
                key["pairs"][item] = {"job": r["name"], "order": order, "X": "winner" if win_is_x else "first_draft",
                                      "Y": "first_draft" if win_is_x else "winner"}
        if len(r["pool"]) >= 2:
            order = sorted(range(len(r["pool"])), key=lambda i: hashlib.sha256(f"{SALT}|idea|{r['name']}|{i}".encode()).hexdigest())
            item = f"s-{opaque('idea', r['name'])}"
            listing = "\n".join(f"{k + 1}. {tidy(r['pool'][i]['value'])}" for k, i in enumerate(order))
            ideas.append({"item": item, "kind": "sameidea", "prompt": SAME_IDEA_PROMPT.format(n=len(order), listing=listing)})
            key["sameidea"][item] = {"job": r["name"], "n": len(order),
                                     "numbers": {str(k + 1): r["pool"][i]["source"] for k, i in enumerate(order)}}
    def shuf(items, tag):
        return sorted(items, key=lambda it: hashlib.sha256(f"{SALT}|{tag}|{it['item']}".encode()).hexdigest())
    return ({"order": 1, "items": shuf(pairs1, 1)}, {"order": 2, "items": shuf(pairs2, 2)},
            {"order": None, "items": shuf(ideas, 3)}, key)


# ============================================================================ pure: the rule's arithmetic
def pair_sum(scores: list) -> int | None:
    """Four judgements (two raters x two orders), each +1 winner, -1 first draft, 0 no real difference; None = a
    judgement that failed, which is never a score."""
    return None if any(s is None for s in scores) else sum(scores)


def distinct_ideas(groups, n: int) -> int | None:
    """The number of distinct ideas a rater's grouping leaves among numbers 1..n; a number left out is its own
    idea, a number named twice counts in its first group. None when the answer is not a list of lists."""
    if not isinstance(groups, list) or not all(isinstance(g, list) for g in groups):
        return None
    seen, count = set(), 0
    for g in groups:
        fresh = {x for x in g if isinstance(x, int) and 1 <= x <= n} - seen
        if fresh:
            count += 1
            seen |= fresh
    return count + (n - len(seen))


def apply_rule(jobs: dict, ideas: dict, flags: list[tuple[bool, bool]]) -> dict:
    """P0 exactly as pre-registered.

    jobs   {job: {"sonnet": [o1, o2], "opus": [o1, o2]}} for each job where a NEW candidate won; each score is
           +1 (the winner is better), -1 (the first draft is), 0 (no real difference) or None (no usable answer).
    ideas  {job: {"sonnet": count|None, "opus": count|None}} for each job that had a pool.
    flags  [(first draft has the 'and' flag, the job's winner has it)] over ALL jobs (a job whose first draft
           stands has the same flag on both sides).

    (a) W - L >= 6 and W >= 8, W = jobs the winner beats the first draft (pair sum +2 or more), L the reverse;
    (b) each rater alone has W > L (that rater's pair goes to a side only when both orders pick it);
    (c) the median distinct ideas is at least 3;
    (d) winners carry the flag in at most 2 more jobs than the first drafts.
    Jobs where the first draft wins or nothing clears are ties: they are in no pair. Any missing judgement makes
    the verdict INCOMPLETE, never a pass or a drop."""
    W = L = 0
    per = {"sonnet": [0, 0], "opus": [0, 0]}
    missing = []
    for job, by in sorted(jobs.items()):
        s = pair_sum([x for r in ("sonnet", "opus") for x in by[r]])
        if s is None:
            missing.append(job)
            continue
        W += s >= 2
        L += s <= -2
        for r in per:
            t = sum(by[r])
            per[r][0] += t == 2
            per[r][1] += t == -2
    counts = []
    for job, by in sorted(ideas.items()):
        c = [by.get("sonnet"), by.get("opus")]
        if any(x is None for x in c):
            missing.append(job + ":ideas")
        else:
            counts.append(min(c))
    median = statistics.median(counts) if counts else None
    extra = sum(w for _, w in flags) - sum(f for f, _ in flags)
    conds = {
        "a_net_and_wins": {"W": int(W), "L": int(L), "net": int(W - L), "ok": bool(W - L >= P0_MIN_NET and W >= P0_MIN_WINS)},
        "b_each_rater": {"sonnet": per["sonnet"], "opus": per["opus"], "ok": all(w > l for w, l in per.values())},
        "c_median_ideas": {"median": median, "n": len(counts), "ok": median is not None and median >= P0_MIN_MEDIAN_IDEAS},
        "d_and_flag": {"first_drafts": int(sum(f for f, _ in flags)), "winners": int(sum(w for _, w in flags)),
                       "extra": int(extra), "ok": extra <= P0_MAX_EXTRA_AND},
    }
    verdict = "INCOMPLETE" if missing else ("PASS" if all(c["ok"] for c in conds.values()) else "DROP")
    return {"verdict": verdict, "missing": missing, "conditions": conds, "pairs_rated": len(jobs),
            "ties_or_unrated": len(flags) - len(jobs)}


# ============================================================================ the call path
class BudgetExceeded(RuntimeError):
    pass


class CostLog:
    """The per-call cost log (cost_log.jsonl) and a spending cap checked before every call."""

    def __init__(self, path: Path, max_usd: float):
        self.path, self.max_usd, self.spent, self.lock = path, max_usd, 0.0, threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            self.spent = sum(json.loads(l).get("cost_usd") or 0 for l in path.read_text().splitlines() if l.strip())

    def check(self):
        if self.spent >= self.max_usd:
            raise BudgetExceeded(f"spent {self.spent:.2f} USD, cap {self.max_usd:.2f}")

    def add(self, rec: dict):
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()), **rec}
        with self.lock:
            self.spent += rec.get("cost_usd") or 0
            with self.path.open("a") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _child_env() -> dict:
    env = dict(os.environ)
    for k in ("ANTHROPIC_BASE_URL", "OPENAI_BASE_URL"):
        env.pop(k, None)
    return env


def run_claude(argv: list[str], stdin: str, system: str | None, timeout: float, cwd_root: Path) -> dict:
    """One fresh `claude -p`, in an empty directory outside any repository; the parsed envelope. The system prompt
    goes over a pipe, never argv or disk, as the mock backend does."""
    cwd_root.mkdir(parents=True, exist_ok=True)
    rfd = wfd = None
    if system is not None:
        rfd, wfd = os.pipe()
        argv = argv + ["--system-prompt-file", f"/dev/fd/{rfd}"]
    # variadic flags last, so the prompt on stdin is never swallowed
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
                raise RuntimeError(f"the claude CLI did not answer within {timeout:g}s") from None
    finally:
        for fd in (rfd, wfd):
            if fd is not None:
                os.close(fd)
    try:
        env = json.loads(out)
    except json.JSONDecodeError:
        raise RuntimeError(f"the claude CLI exited {proc.returncode} without a JSON result: {(err or '').strip()[-200:]}") from None
    if not isinstance(env, dict):
        raise RuntimeError("the claude CLI result is not an object")
    return env


def _usage(env: dict) -> tuple[int, int]:
    u = env.get("usage") if isinstance(env.get("usage"), dict) else {}
    n = lambda k: u.get(k) if isinstance(u.get(k), int) and not isinstance(u.get(k), bool) and u.get(k) >= 0 else 0
    return n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens"), n("output_tokens")


class CliClient:
    """An Anthropic-SDK-shaped client (`.with_options(...).messages.create(**body)`) that answers with `claude -p`,
    as the mock backend does, so napkin.model.ModelPort can drive it unchanged. Every call goes to the cost log."""

    def __init__(self, cost: CostLog, cwd_root: Path = RATER_CWD):
        self.cost, self.cwd_root, self.local = cost, cwd_root, threading.local()
        self.messages = self

    def tag(self, job: str):
        self.local.job = job

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
        self.cost.check()
        sys_text = "".join(b["text"] for b in system) if isinstance(system, list) else system
        argv = [CLAUDE, "-p", "--model", model, "--output-format", "json", "--no-session-persistence", "--setting-sources", "",
                "--strict-mcp-config", "--disable-slash-commands", "--max-turns", "4"]
        oc = output_config or {}
        if oc.get("format"):
            argv += ["--json-schema", json.dumps(oc["format"]["schema"], separators=(",", ":"))]
        if oc.get("effort"):
            argv += ["--effort", oc["effort"]]
        first = messages[0]["content"] if isinstance(messages[0]["content"], str) else ""
        m = re.match(r"Task: (\w+)", first)
        rec = {"job": getattr(self.local, "job", None), "purpose": m.group(1) if m else None, "model": model,
               "effort": oc.get("effort"), "turns": len(messages), "via": "ModelPort/claude -p"}
        t0 = time.monotonic()
        try:
            env = run_claude(argv, self._flatten(messages), sys_text, 900, self.cwd_root)
        except Exception as e:
            self.cost.add({**rec, "secs": round(time.monotonic() - t0, 2), "ok": False, "error": str(e)[:200], "cost_usd": 0})
            raise
        i, o = _usage(env)
        ok = not env.get("is_error") and isinstance(env.get("result"), str)
        self.cost.add({**rec, "secs": round(time.monotonic() - t0, 2), "in_tokens": i, "out_tokens": o,
                       "cost_usd": env.get("total_cost_usd") or 0, "ok": ok,
                       "error": None if ok else str(env.get("result") or env.get("subtype"))[:200]})
        if not ok:
            raise RuntimeError(f"claude CLI: {str(env.get('result') or env.get('subtype'))[:300]}")
        text = env["result"]
        # The CLI has no output cap: a reply longer than max_tokens is cut as a real call would (mock-backend cut_off)
        if isinstance(env.get("num_turns"), int) and env["num_turns"] <= 2 and o > max_tokens:
            text, stop = text[:len(text) * max_tokens // o], "max_tokens"
        else:
            stop = "end_turn"
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason=stop,
                               usage=SimpleNamespace(input_tokens=i, output_tokens=o, cache_creation_input_tokens=0,
                                                     cache_read_input_tokens=0))


def routes_doc() -> dict:
    """The routes staging runs (server/model-routes.example.json) plus candidates_smp at effort medium."""
    doc = json.loads((REPO / "server/model-routes.example.json").read_text())
    doc["purposes"].setdefault("candidates_smp", CANDIDATES_ROUTE)
    return doc


def make_port(cost: CostLog):
    from napkin.model import AnthropicWire, ModelPort
    from napkin.model_routes import Routes
    client = CliClient(cost)
    routes = Routes("anthropic", "sonnet-5.5", None, source=json.dumps(routes_doc()))
    return ModelPort(AnthropicWire(client), "sonnet-5.5", timeout=900, routes=routes), client


def make_call(port: ModelPort, client: CliClient, job: str, max_tokens: int = 12000):
    """`call(purpose, system, payload, schema)`, the shape napkin.brief.candidates takes."""
    from napkin.model import Usage

    def call(purpose, system, payload, schema):
        client.tag(job)
        return port.call(purpose, system, payload, schema, usage=Usage(), attribution=f"prop_replay/{job}", max_tokens=max_tokens)
    return call


# ============================================================================ commands
def cmd_inputs(a):
    out, src = Path(a.out), Path(a.src)
    if (out / "inputs/selection.json").exists():
        sys.exit("inputs/selection.json exists: the set is fixed once and never re-selected")
    sel = select_runs(list_source(src))
    (out / "inputs").mkdir(parents=True, exist_ok=True)
    rows = []
    for name in sel:
        lines = (src / "runs" / name / "runlog.jsonl").read_text().splitlines()
        inp = extract_input(name, lines)
        (out / "inputs" / f"{name}.json").write_text(json.dumps(inp, indent=1, ensure_ascii=False))
        rows.append({"name": name, "source_runlog_sha256": hashlib.sha256("\n".join(lines).encode()).hexdigest()})
    (out / "inputs" / "selection.json").write_text(json.dumps({
        "rule": f"the first {N_JOBS} runs, in folder-name order, of the off and thin arms that ended 'done' when phase 0 began",
        "source": str(src), "selected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "runs": rows}, indent=1))
    print(f"{len(sel)} runs fixed: {', '.join(sel)}")


def _load_inputs(out: Path, only=None):
    sel = json.loads((out / "inputs/selection.json").read_text())["runs"]
    return [json.loads((out / "inputs" / f"{r['name']}.json").read_text()) for r in sel if not only or r["name"] in only]


FAILED = ("generate_failed", "rank_failed", "budget_stopped", "harness_error")


def block(insight, smp):
    return {"insight": tidy(insight), "single_minded_proposition": tidy(smp), "reasons_to_believe": "", "objection": ""}


def cmd_replay(a):
    from napkin.brief import candidates
    out = Path(a.out)
    cost = CostLog(out / "cost_log.jsonl", a.max_usd)
    port, client = make_port(cost)
    (out / "results").mkdir(exist_ok=True)
    (out / "blocks").mkdir(exist_ok=True)

    def one(inp):
        name, fd = inp["name"], inp["first_draft"]
        parts = {k: fd.get(k) for k in candidates.FROM_PARTS}
        try:
            res = candidates.pick(make_call(port, client, name), name, insight=fd["insight"],
                                  first_value=fd["single_minded_proposition"], parts=parts, strategy=inp["strategy"],
                                  facts=inp["facts"], findings=inp["findings"], client_words=inp["client_words"],
                                  library=inp["library"])
        except Exception as e:   # pick() catches model errors itself; this is a fault in the harness
            res = {"outcome": "harness_error", "error": f"{type(e).__name__}: {e}"[:300], "pool": [], "winner": None, "winner_source": None}
        if "BudgetExceeded" in (res.get("error") or ""):
            res["outcome"] = "budget_stopped"
        pool, w = res["pool"], res["winner"]
        first = fd["single_minded_proposition"]
        win_value = pool[w]["value"] if w is not None else None
        res.update(name=name, first_value=tidy(first), first_flag=candidates.standalone_and(tidy(first)),
                   winner_value=win_value, winner_flag=bool(pool[w]["and_flag"]) if w is not None else candidates.standalone_and(tidy(first)),
                   shown_sources=[pool[i]["source"] for i in res.get("shown", [])],
                   ranked_sources=[pool[i]["source"] for i in res.get("order", [])])
        (out / "results" / f"{name}.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))
        (out / "blocks" / f"{name}.json").write_text(json.dumps({
            "outcome": res["outcome"], "winner_source": res["winner_source"],
            "first_draft": block(fd["insight"], first),
            "winner": block(fd["insight"], win_value if win_value is not None else first)}, indent=1, ensure_ascii=False))
        print(f"{name}: {res['outcome']} {res['winner_source'] or ''} (spent {cost.spent:.2f} USD)", flush=True)
        return res

    def settled(name):   # a result that ran to an outcome is kept; a failed one is run again
        p = out / "results" / f"{name}.json"
        return p.exists() and json.loads(p.read_text())["outcome"] not in FAILED

    inputs = [i for i in _load_inputs(out, a.only) if a.force or not settled(i["name"])]
    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(one, inputs))
    md = ["# Phase 0 replay: first draft against winner, same insight\n"]
    for i in _load_inputs(out):
        p = out / "blocks" / f"{i['name']}.json"
        if p.exists():
            b = json.loads(p.read_text())
            md += [f"## {i['name']}: {b['outcome']} ({b['winner_source']})", f"Insight: {b['first_draft']['insight']}",
                   f"- first draft: {b['first_draft']['single_minded_proposition']}",
                   f"- winner: {b['winner']['single_minded_proposition']}\n"]
    (out / "blocks.md").write_text("\n".join(md))
    print(f"done, {cost.spent:.2f} USD in the cost log")


def _rows(out: Path) -> list[dict]:
    rows = []
    for inp in _load_inputs(out):
        r = json.loads((out / "results" / f"{inp['name']}.json").read_text())
        rows.append({"name": inp["name"], "brief_text": inp["brief_text"], "insight": inp["first_draft"]["insight"],
                     "first": r["first_value"], "winner": r["winner_value"], "winner_source": r["winner_source"],
                     "pool": r["pool"], "outcome": r["outcome"], "first_flag": r["first_flag"], "winner_flag": r["winner_flag"]})
    return rows


def cmd_packets(a):
    out = Path(a.out)
    o1, o2, ideas, key = build_packets(_rows(out))
    (out / "packets").mkdir(exist_ok=True)
    for name, doc in (("order1", o1), ("order2", o2), ("sameidea", ideas)):
        (out / "packets" / f"{name}.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    (out / "key.json").write_text(json.dumps(key, indent=1))
    (out / "rating_prompts.md").write_text("# Frozen prompts (phase 0)\n\n## Pair\n\n" + PAIR_PROMPT + "\n\n## Same idea\n\n" + SAME_IDEA_PROMPT + "\n")
    print(f"{len(o1['items'])} pairs x 2 orders, {len(ideas['items'])} same-idea items; judgements: "
          f"{(len(o1['items']) * 2 + len(ideas['items'])) * 2}")


def rater_call(rater: str, prompt: str, cost: CostLog, job: str):
    cost.check()
    argv = [CLAUDE, "-p", "--model", RATERS[rater], "--output-format", "json", "--no-session-persistence",
            "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands"]
    t0 = time.monotonic()
    rec = {"job": job, "purpose": "rate", "model": RATERS[rater], "effort": None, "via": "claude -p"}
    try:
        env = run_claude(argv, prompt, None, 600, RATER_CWD)
    except Exception as e:
        cost.add({**rec, "secs": round(time.monotonic() - t0, 2), "ok": False, "error": str(e)[:200], "cost_usd": 0})
        raise
    i, o = _usage(env)
    m = re.search(r"\{.*\}", env.get("result") or "", re.S)
    obj = None
    if m:
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    cost.add({**rec, "secs": round(time.monotonic() - t0, 2), "in_tokens": i, "out_tokens": o,
              "cost_usd": env.get("total_cost_usd") or 0, "ok": obj is not None})
    return obj


def cmd_rate(a):
    out = Path(a.out)
    cost = CostLog(out / "cost_log.jsonl", a.max_usd)
    (out / "ratings").mkdir(exist_ok=True)
    jobs = []
    for pk in ("order1", "order2", "sameidea"):
        for it in json.loads((out / "packets" / f"{pk}.json").read_text())["items"]:
            for r in RATERS:
                if r in a.raters and not (out / "ratings" / f"{r}-{it['item']}.json").exists():
                    jobs.append((r, it))

    def one(j):
        r, it = j
        try:
            obj = rater_call(r, it["prompt"], cost, it["item"])
        except BudgetExceeded:
            return
        except Exception as e:
            obj = None
            print(f"{r} {it['item']}: {e}", file=sys.stderr)
        if obj is not None:   # a failed call leaves no file: it is retried by the next run, never scored
            (out / "ratings" / f"{r}-{it['item']}.json").write_text(json.dumps({"rater": r, "item": it["item"], **obj}))

    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(one, jobs))
    print(f"{len(jobs)} judgements attempted, {cost.spent:.2f} USD in the cost log")


def cmd_analyse(a):
    out = Path(a.out)
    key = json.loads((out / "key.json").read_text())
    rows = _rows(out)

    def rating(r, item):
        p = out / "ratings" / f"{r}-{item}.json"
        return json.loads(p.read_text()) if p.exists() else None

    jobs: dict = {}
    for item, k in key["pairs"].items():
        for r in RATERS:
            x = rating(r, item)
            pick_ = (x or {}).get("better")
            side = {"X": k["X"], "Y": k["Y"]}.get(pick_)
            s = None if pick_ is None else (0 if pick_ == "no real difference" else (1 if side == "winner" else -1 if side == "first_draft" else None))
            jobs.setdefault(k["job"], {r2: [None, None] for r2 in RATERS})[r][k["order"] - 1] = s
    ideas: dict = {}
    for item, k in key["sameidea"].items():
        for r in RATERS:
            x = rating(r, item)
            ideas.setdefault(k["job"], {})[r] = distinct_ideas((x or {}).get("groups"), k["n"]) if x else None
    res = apply_rule(jobs, ideas, [(r["first_flag"], r["winner_flag"]) for r in rows])
    res["jobs"] = {r["name"]: {"outcome": r["outcome"], "winner_source": r["winner_source"], "first_flag": r["first_flag"],
                              "winner_flag": r["winner_flag"], "scores": jobs.get(r["name"]), "ideas": ideas.get(r["name"])} for r in rows}
    failed = [r["name"] for r in rows if r["outcome"] in FAILED]
    if failed:   # a run that failed is infrastructure, not a tie: run `replay` again for it before the rule is read
        res["verdict"], res["missing"] = "INCOMPLETE", res["missing"] + [f"{n}:run failed" for n in failed]
    res["not_part_of_the_rule"] = {"outcomes": {o: sum(1 for r in rows if r["outcome"] == o) for o in sorted({r["outcome"] for r in rows})}}
    (out / "analysis.json").write_text(json.dumps(res, indent=1))
    print(json.dumps({k: res[k] for k in ("verdict", "missing", "conditions", "pairs_rated", "ties_or_unrated")}, indent=1))


def cmd_smoke(a):
    out = Path(a.out)
    cost = CostLog(out / "cost_log.jsonl", a.max_usd)
    port, client = make_port(cost)
    call = make_call(port, client, "smoke", max_tokens=2000)
    got = call("smoke", "Answer with the JSON asked for.", {"say": "ok"},
               {"type": "object", "additionalProperties": False, "required": ["word"], "properties": {"word": {"type": "string"}}})
    print(got, f"{cost.spent:.4f} USD in the cost log")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(OUT_DEFAULT))
    ap.add_argument("--max-usd", type=float, default=4.0, help="stop before a call once the cost log reaches this")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("inputs"); s.add_argument("--src", default=str(SRC_DEFAULT)); s.set_defaults(f=cmd_inputs)
    s = sub.add_parser("replay"); s.add_argument("--workers", type=int, default=4); s.add_argument("--only", nargs="*")
    s.add_argument("--force", action="store_true"); s.set_defaults(f=cmd_replay)
    sub.add_parser("packets").set_defaults(f=cmd_packets)
    s = sub.add_parser("rate"); s.add_argument("--workers", type=int, default=4)
    s.add_argument("--raters", nargs="*", default=list(RATERS)); s.set_defaults(f=cmd_rate)
    sub.add_parser("analyse").set_defaults(f=cmd_analyse)
    sub.add_parser("smoke").set_defaults(f=cmd_smoke)
    a = ap.parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    main()
