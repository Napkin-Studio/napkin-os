"""The spend guard: one question before every paid request, `allow(amount, env, run)`.

    verdict = spend.allow(0.04, spend.environment(), job_id)
    if not verdict: refuse the call (verdict.reason says why; spend.check() raises SpendRefused)

It caps money, in euro, and holds one pause switch. It never calls a provider and never reads a key.

  NAPKIN_PAID_CALLS         on | off. One switch for every paid call. Unset: on locally, off when deployed.
  NAPKIN_SPEND_CAP_EUR      the most one environment spends in a UTC day. Unset: no cap locally, 0 when
                            deployed. 0 refuses every paid call. A value that is not a number counts as 0.
  NAPKIN_SPEND_RUN_CAP_EUR  the most one run spends. Unset: no run cap (the day cap still applies).
  NAPKIN_ENV                the environment's name ("napkin-staging", ...). Unset, "local", "dev" and "test"
                            are local; any other name is deployed.

Totals are kept in memory, per process: a second task counts its own spend, so the cap is per
task until the cost engine (Phase 3) keeps one ledger. That engine can implement allow() with
this signature. An estimate that is too high only refuses early; callers pass a ceiling, never zero.

The relay runs a copy, production-tool/relay/director/spend.py, held in step by a test.
"""

from __future__ import annotations

import math
import os
import contextvars
import threading
import time
from dataclasses import dataclass

LOCAL = frozenset({"", "local", "dev", "development", "test"})
_ON = frozenset({"1", "on", "true", "yes"})
_OFF = frozenset({"0", "off", "false", "no"})

_lock = threading.Lock()
_day: dict[tuple[str, str], float] = {}   # (environment, UTC date) -> euro
_run: dict[tuple[str, str], float] = {}   # (environment, run) -> euro


class SpendRefused(Exception):
    """A paid call the guard refused, before anything left the server."""


@dataclass(frozen=True)
class Verdict:
    ok: bool
    reason: str = ""

    def __bool__(self) -> bool:
        return self.ok


# The run a caller is working for, when it does not pass one (the relay sets it per job).
_current_run: contextvars.ContextVar[str] = contextvars.ContextVar("spend_run", default="-")


def set_run(run: str) -> None:
    _current_run.set(run or "-")


def current_run() -> str:
    return _current_run.get()


def environment() -> str:
    return (os.environ.get("NAPKIN_ENV") or "local").strip().lower()


def is_local(env: str) -> bool:
    return (env or "").strip().lower() in LOCAL


def paid_calls_on(env: str) -> bool:
    v = (os.environ.get("NAPKIN_PAID_CALLS") or "").strip().lower()
    if v in _ON:
        return True
    if v in _OFF:
        return False
    return is_local(env)      # unset: on locally, off when deployed; an unreadable value is "off" when deployed


def _cap(name: str, env: str, deployed_default: float | None) -> float | None:
    v = (os.environ.get(name) or "").strip()
    if not v:
        return None if is_local(env) else deployed_default
    try:
        n = float(v)
    except ValueError:
        return 0.0
    return n if math.isfinite(n) and n >= 0 else 0.0


def day_cap(env: str) -> float | None:
    return _cap("NAPKIN_SPEND_CAP_EUR", env, 0.0)


def run_cap(env: str) -> float | None:
    return _cap("NAPKIN_SPEND_RUN_CAP_EUR", env, None)


def allow(amount: float, env: str, run: str) -> Verdict:
    """May a paid call that is expected to cost at most `amount` euro go out, for this
    environment and this run? An allowed call is counted at once."""
    env, run = (env or "local").strip().lower(), run or "-"
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return Verdict(False, "the call has no cost estimate, so it is not sent")
    if not math.isfinite(amount) or amount < 0:
        return Verdict(False, "the call has no cost estimate, so it is not sent")
    if not paid_calls_on(env):
        return Verdict(False, "paid calls are switched off (NAPKIN_PAID_CALLS)")
    today = time.strftime("%Y-%m-%d", time.gmtime())
    with _lock:
        cap = day_cap(env)
        spent = _day.get((env, today), 0.0)
        if cap is not None and (cap <= 0 or spent + amount > cap):
            return Verdict(False, f"the daily spend cap for {env} is {cap:g} euro (NAPKIN_SPEND_CAP_EUR)")
        rcap = run_cap(env)
        rspent = _run.get((env, run), 0.0)
        if rcap is not None and (rcap <= 0 or rspent + amount > rcap):
            return Verdict(False, f"the spend cap for this run is {rcap:g} euro (NAPKIN_SPEND_RUN_CAP_EUR)")
        _day[(env, today)] = spent + amount
        _run[(env, run)] = rspent + amount
    return Verdict(True)


def check(amount: float, run: str | None = None, env: str | None = None) -> None:
    """allow() for an adapter: raises SpendRefused when the call must not go out."""
    v = allow(amount, environment() if env is None else env, _current_run.get() if run is None else run)
    if not v:
        raise SpendRefused(v.reason)


# A ceiling for a model call when no price is known: the dearest tier, per million tokens (in, out).
CEILING_PER_MTOK = (15.0, 75.0)
IMAGE_TOKENS = 1600        # one picture, as input tokens
DOCUMENT_TOKENS = 12000    # one PDF


def model_rates(model: str | None):
    """The model's (input, output) price per million tokens from the middleware's runlog table, or None
    where there is no such table (the relay's copy) or the model is not in it."""
    try:
        from . import runlog
        pin, pout = runlog.price(model, 1_000_000, 0), runlog.price(model, 0, 1_000_000)
    except (ImportError, AttributeError):
        return None
    return (pin, pout) if pin is not None and pout is not None else None


def model_ceiling(chars: int, images: int, documents: int, max_tokens: int, rates=None) -> float:
    """What a model call costs at most, in euro: its input (about three characters a token, pictures and
    documents at a fixed size) plus the whole max_tokens as output, at `rates` (euro per million tokens, in and
    out) or the dearest tier. Dollar rates stand in for euro; that only errs high."""
    pi, po = rates or CEILING_PER_MTOK
    tin = chars / 3 + images * IMAGE_TOKENS + documents * DOCUMENT_TOKENS
    return round(tin / 1e6 * pi + max(0, max_tokens) / 1e6 * po, 6)


def reset() -> None:
    """Forget every total (tests)."""
    with _lock:
        _day.clear()
        _run.clear()
