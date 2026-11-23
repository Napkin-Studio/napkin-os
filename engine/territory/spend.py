"""The one place Territories adds up what a run costs (feature territories-costs).

Prices come from the shared table (engine/price_table.py), never from a constant here. Spend reaches people only as entries in the
document's decision history (``Spend.decisions``) and in the middleware's run log (``on_line``); it is never a member of the document
and never a word in the app (LESSONS 19; ``contract.lint`` and the grep test in tests/test_spend.py hold that).

    spend = Spend(cap_usd=..., doc="doc id", store=Path("runs/spend.json"), on_line=runlog_adapter)
    spend.ask(card)                 # the 'ask' entry: the estimate and the cap, named BEFORE the first paid call
    llm = spend.wrap(inner_llm)     # inner: llm(stage, system, user) -> (obj, usage); give this to pipeline.run
    spend.decisions()               # ask / spend / outcome entries for the history, oldest first

What the wrapper guarantees:

* the cap is checked under one lock before every call, against what is spent plus this call's estimate: a call that would pass it is not
  made and ``CapReached`` says why in plain words. Claude and picture spend are separate lines with separate caps (LESSONS 24).
* a call is keyed by (stage, system, user). A finished call is recorded at once; a call that timed out stays in flight and its late
  answer is recorded, so a retry or resume joins it or reads it and never pays twice (LESSONS 13).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import threading
import time
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from pathlib import Path

CLAUDE, PICTURES, SEARCH = "claude", "runway", "search"
#: Defaults, set in config (env), never in the UI, raised only by whoever owns the deployment (owner's proposal, territories-costs).
DEFAULT_CAP_USD, DEFAULT_IMAGES_CAP_USD = 3.00, 2.00
ENV_CAP, ENV_IMAGES_CAP = "NAPKIN_TERRITORY_MAX_USD", "NAPKIN_TERRITORY_IMAGES_MAX_USD"
#: Web look-ups (feature territories-lookups): a count cap (how many a document may run, the number the Booth's note can say) and a money cap
#: of their own, so a look-up never eats the model budget and the model budget never stops a look-up (LESSONS 24, 25).
DEFAULT_SEARCH_CAP_USD, DEFAULT_LOOKUPS_MAX = 0.50, 8
ENV_SEARCH_CAP, ENV_LOOKUPS_MAX = "NAPKIN_TERRITORY_SEARCH_MAX_USD", "NAPKIN_TERRITORY_LOOKUPS_MAX"
#: Size assumed for a stage the card does not list (a frames plan, a repair): the biggest listed stage, so an estimate is never low.
_FALLBACK_TOKENS = (5000, 4000)


class CapReached(RuntimeError):
    """A paid call was refused: it would pass the run's cap. The message is for a person; it carries no price."""

    def __init__(self, provider: str):
        if provider == SEARCH:
            super().__init__("This document reached the number of look-ups the team allows, so nothing was looked up. "
                             "What was found is saved; the limit is set by the team, not in the app.")
        else:
            what = "pictures" if provider == PICTURES else "model work"
            super().__init__(f"This run reached the limit set for {what}, so it stopped before the next paid step. "
                             "What was made is saved; the limit is set by the team, not in the app.")
        self.provider = provider


def _cap_from_env(name: str, default: float) -> float:
    try:
        v = float(os.environ.get(name) or default)
    except ValueError:
        return default
    return v if math.isfinite(v) and v > 0 else default     # nan, inf, zero and negatives never remove or zero the cap


def lookups_max() -> int:
    try:
        v = int(os.environ.get(ENV_LOOKUPS_MAX) or DEFAULT_LOOKUPS_MAX)
    except ValueError:
        return DEFAULT_LOOKUPS_MAX
    return v if v > 0 else DEFAULT_LOOKUPS_MAX


def caps() -> tuple[float, float]:
    return _cap_from_env(ENV_CAP, DEFAULT_CAP_USD), _cap_from_env(ENV_IMAGES_CAP, DEFAULT_IMAGES_CAP_USD)


def estimate_call(stage: str, model: str | None = None) -> float:
    """What one call of ``stage`` is expected to cost, from the card's token sizes and the price table. Advisory: the real figure is
    recorded after the call."""
    import price_table
    from . import cost
    row = cost.STAGES.get(stage) or cost.DEVELOP.get(stage)
    if row:
        _, tin, tout, m = row
        return round(price_table.usd(model or m, tin, tout) * cost.CALIBRATION, 4)
    from .llm import STAGE_MODEL
    return round(price_table.usd(model or STAGE_MODEL.get(stage), *_FALLBACK_TOKENS) * cost.CALIBRATION, 4)


def call_key(stage: str, system: str, user: str) -> str:
    return hashlib.sha256(json.dumps([stage, system, user], ensure_ascii=False).encode()).hexdigest()[:20]


def _usd(usage: dict, model: str | None) -> tuple[float, bool]:
    """(usd, estimated). A real figure from the transport is kept; else tokens are priced from the table and flagged estimated."""
    usage = usage or {}
    if usage.get("usd") is not None:
        return float(usage["usd"]), bool(usage.get("usd_estimated"))
    tin, tout = int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)
    if tin or tout:
        import price_table
        return price_table.usd(usage.get("model") or model, tin, tout, int(usage.get("cache_read_tokens") or 0),
                               int(usage.get("cache_creation_tokens") or 0)), True
    return 0.0, False


class Spend:
    def __init__(self, cap_usd: float | None = None, images_cap_usd: float | None = None, *, doc: str = "", store: Path | None = None,
                 on_line=None, clock=time.time, search_cap_usd: float | None = None, max_lookups: int | None = None):
        c, i = caps()
        self.cap = {CLAUDE: float(cap_usd) if cap_usd is not None else c, PICTURES: float(images_cap_usd) if images_cap_usd is not None else i,
                    SEARCH: float(search_cap_usd) if search_cap_usd is not None else _cap_from_env(ENV_SEARCH_CAP, DEFAULT_SEARCH_CAP_USD)}
        self.max_lookups = int(max_lookups) if max_lookups is not None else lookups_max()
        if self.max_lookups < 1:
            raise ValueError("the look-up count cap must be a whole number above 0")
        for p, v in self.cap.items():
            if not (math.isfinite(v) and v > 0):
                raise ValueError(f"the {p} cap must be a number above 0")
        self.doc, self.store, self.on_line, self.clock = doc, Path(store) if store else None, on_line, clock
        self.lock = threading.Lock()
        self.lines: list[dict] = []          # one per paid call, in order
        self.outputs: dict[str, dict] = {}   # call key -> finished output, kept for a resume
        self.inflight: dict[str, Future] = {}
        self._provider_of: dict[str, str] = {}
        self.events: list[dict] = []         # ask / outcome entries
        self.stops: list[str] = []           # this session only (never stored): the provider of each paid call the cap refused
        self.reused = 0                      # this session only: calls answered from the record or joined in flight, which paid nothing
        self._load()

    # ---------------------------------------------------------------- persistence (a resumed run reads what was paid for)
    def _load(self):
        if self.store and self.store.exists():
            d = json.loads(self.store.read_text())
            self.lines, self.outputs, self.events = d.get("lines", []), d.get("outputs", {}), d.get("events", [])

    def _save(self):
        if self.store:
            self.store.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.store.with_suffix(".tmp")
            tmp.write_text(json.dumps({"lines": self.lines, "outputs": self.outputs, "events": self.events}, ensure_ascii=False))
            tmp.replace(self.store)

    # ---------------------------------------------------------------- totals and the cap
    def total(self, provider: str | None = None) -> float:
        return round(sum(l["usd"] for l in self.lines if provider in (None, l["provider"])), 6)

    def count(self, provider: str) -> int:
        return sum(1 for l in self.lines if l["provider"] == provider)

    def inflight_of(self, provider: str) -> list:
        return [k for k in self.inflight if self._provider_of.get(k) == provider]

    def admit(self, provider: str, est_usd: float) -> None:
        """The cap check, for every paid call of either kind. Raises ``CapReached`` when spent plus the estimate passes the cap."""
        with self.lock:
            if self.total(provider) + est_usd > self.cap[provider]:
                self.stops.append(provider)
                raise CapReached(provider)

    def _record(self, provider, stage, model, usage, usd, estimated, key):
        line = {"provider": provider, "stage": stage, "model": model, "tokens_in": int((usage or {}).get("prompt_tokens") or 0),
                "tokens_out": int((usage or {}).get("completion_tokens") or 0), "usd": round(usd, 6),
                "estimated": estimated, "key": key, "at": self.clock()}
        self.lines.append(line)
        self._save()
        if self.on_line:
            self.on_line(self._runlog_kwargs(line, usage))
        return line

    @staticmethod
    def _runlog_kwargs(line: dict, usage: dict) -> dict:
        """Arguments for ``napkin.runlog.RunLog.model`` so the run ledger and this log agree."""
        u = usage or {}
        return {"purpose": f"territory:{line['stage']}", "model": line["model"], "secs": float(u.get("secs") or 0),
                "tin": line["tokens_in"], "tout": line["tokens_out"], "attempts": int(u.get("calls") or 1), "ok": True,
                "cache_read": int(u.get("cache_read_tokens") or 0), "cache_write": int(u.get("cache_creation_tokens") or 0)}

    # ---------------------------------------------------------------- the ask, the calls, the outcome
    def ask(self, card: dict, by: str = "engine") -> dict:
        """The cost card as a decision the person says yes to. It names both caps; it is the first entry of the run, before any call."""
        e = {"kind": "ask", "at": self.clock(), "by": by, "estimate_usd": card.get("est_usd"), "calls": card.get("calls"), "estimated": True,
             "cap_usd": {"claude": self.cap[CLAUDE], "pictures": self.cap[PICTURES]}}
        e.update({k: card[k] for k in ("what", "lookup") if k in card})
        with self.lock:
            self.events.append(e)
            self._save()
        return e

    def outcome(self, what: str, **counts) -> dict:
        """What the run came to (routes found, greenlit, sent): counts and words, plus the totals, for the history."""
        e = {"kind": "outcome", "at": self.clock(), "what": what, "counts": counts,
             "spent_usd": {"claude": self.total(CLAUDE), "pictures": self.total(PICTURES)}}
        with self.lock:
            self.events.append(e)
            self._save()
        return e

    def decisions(self) -> list[dict]:
        """History entries, oldest first: ask, then one spend per call, then outcomes. The only place a price is written."""
        spends = [{"kind": "spend", "at": l["at"], "provider": l["provider"], "stage": l["stage"], "model": l["model"], "tokens_in": l["tokens_in"],
                   "tokens_out": l["tokens_out"], "usd": l["usd"], "estimated": l["estimated"]} for l in self.lines]
        return sorted([*self.events, *spends], key=lambda e: (e["at"], e["kind"] != "ask"))

    def wrap(self, inner, *, timeout: float | None = None, model_of=None):
        """An ``llm(stage, system, user)`` that checks the cap, reuses recorded outputs and records spend. ``timeout`` (seconds, from
        measured latency in the run log, never guessed) abandons waiting, not the call: its answer is recorded when it lands."""
        if model_of is None:
            from .llm import STAGE_MODEL
            model_of = STAGE_MODEL.get
        return _Wrapped(self, inner, timeout, model_of)

    # ---------------------------------------------------------------- pictures (the provider's own cap and ledger)
    def charge_picture(self, key: str, est_usd: float, create):
        """Make one picture through ``create()`` -> (result, real usd) at most once per ``key``: a recorded one is returned, one in flight
        is joined, and a new one first passes the pictures cap."""
        return self._once(key, PICTURES, "picture", None, est_usd, create, None, picture=True)

    def charge_lookup(self, key: str, est_usd: float, run):
        """One web look-up through ``run()`` -> (result, real usd) at most once per ``key`` (a replay of the same approval reads the recorded
        result and pays nothing). A new one first passes the look-up count cap and the search cap."""
        return self._once(key, SEARCH, "lookup", None, est_usd, run, None, picture=True)

    def _once(self, key, provider, stage, model, est, run, timeout, picture=False):
        with self.lock:
            done = self.outputs.get(key)
            if done is not None:
                self.reused += 1
                return done["result"] if picture else (done["obj"], done["usage"])
            fut = self.inflight.get(key)
            if fut is not None:
                self.reused += 1
            if fut is None:
                if self.total(provider) + est > self.cap[provider] or (provider == SEARCH and self.count(SEARCH) + len(self.inflight_of(SEARCH)) >= self.max_lookups):
                    self.stops.append(provider)
                    raise CapReached(provider)
                fut = self.inflight[key] = Future()
                self._provider_of[key] = provider
                threading.Thread(target=self._work, args=(fut, key, provider, stage, model, run, picture), daemon=True).start()
        try:
            return fut.result(timeout)
        except FutureTimeout:
            raise TimeoutError(f"{stage} is taking longer than expected; it is still running and a retry will pick up its answer") from None

    def _work(self, fut, key, provider, stage, model, run, picture):
        try:
            got = run()
        except BaseException as e:                      # a failed call is not paid for, and may be tried again
            with self.lock:
                self.inflight.pop(key, None)
            fut.set_exception(e)
            return
        with self.lock:
            if picture:
                result, usd = got
                self.outputs[key] = {"result": result}
                self._record(provider, stage, "runway" if provider == PICTURES else provider, {}, float(usd or 0), False, key)
                out = result
            else:
                obj, usage = got
                usd, est = _usd(usage, model)
                self.outputs[key] = {"obj": obj, "usage": usage}
                self._record(provider, stage, (usage or {}).get("model") or model, usage, usd, est, key)
                out = (obj, usage)
            self.inflight.pop(key, None)
        fut.set_result(out)


class _Wrapped:
    def __init__(self, spend: Spend, inner, timeout, model_of):
        self.spend, self.inner, self.timeout, self.model_of = spend, inner, timeout, model_of

    @property
    def usage(self):
        return [{"stage": l["stage"], "model": l["model"], "usd": l["usd"], "usd_estimated": l["estimated"]} for l in self.spend.lines if l["provider"] == CLAUDE]

    def __call__(self, stage: str, system: str, user: str):
        key = call_key(stage, system, user)
        model = self.model_of(stage)
        obj, usage = self.spend._once(key, CLAUDE, stage, model, estimate_call(stage, model), lambda: self.inner(stage, system, user), self.timeout)
        return json.loads(json.dumps(obj)), usage
