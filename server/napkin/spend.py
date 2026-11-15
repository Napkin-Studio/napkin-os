"""The spend guard: one question before every paid request, `allow(amount, env, run)`.

    verdict = spend.allow(0.04, spend.environment(), job_id)
    if not verdict: refuse the call (verdict.reason says why; spend.check() raises SpendRefused)

It caps money, in euro, and holds one pause switch. No exchange rate exists here: a dollar price counts as the same
number of euro (the owner decides whether that is acceptable; it errs high while a dollar is worth less than a euro). It never calls a provider and never reads a key.
It fails CLOSED (features/production-platform-rules.clan): a paid call goes out only when the environment
says so in both of the first two settings. Nothing set, on a laptop or a server, means nothing is paid.

  NAPKIN_PAID_CALLS         on | off. One switch for every paid call. Unset, or anything but on: off.
  NAPKIN_SPEND_CAP_EUR      the most one environment spends in a UTC day. Paid calls stay off until it is
                            named. Unset, 0, or a value that is not a number: 0, which refuses every paid call.
  NAPKIN_SPEND_RUN_CAP_EUR  the most one run spends. Unset: no run cap (the day cap still applies).
  NAPKIN_ENV                the environment's name ("napkin-staging", ...), the key of its totals. It loosens
                            nothing: an unset or unknown name is held to the same two settings as any other.

A developer turns paid calls on by hand: NAPKIN_PAID_CALLS=on NAPKIN_SPEND_CAP_EUR=5. Napkin's own offline
provider and the passthrough director never ask, so tests and the e2e stack run free with nothing set. describe() is the
one line a process logs at start-up saying which mode the guard is in.

A refusal's reason is one plain line with no figure and no money word (the interface shows it); the cap
and the amount go to the log only.

Totals are kept in memory, per process: a second task counts its own spend, and a restart (a Lambda cold
start) begins at zero, so the cap is per process until the cost engine (Phase 3) keeps one ledger. That
engine can implement allow() with this signature. An estimate that is too high only refuses early; callers
pass a ceiling, never zero.

The relay runs a copy, production-tool/relay/director/spend.py, held in step by a test.
"""

from __future__ import annotations

import logging
import math
import os
import contextvars
import threading
import time
from dataclasses import dataclass

LOCAL = frozenset({"", "local", "dev", "development", "test"})
_ON = frozenset({"on"})   # only `on` turns paid calls on: 1, true and yes do not (the review of 25e7c870)
_OFF = frozenset({"0", "off", "false", "no"})

log = logging.getLogger("napkin.spend")

# The lines a person reads when a paid call is refused: no figure, no money word (Phase 3 test 79).
PAID_OFF = "Paid runs are off here. Nothing was sent."
DAY_LIMIT = "Paid runs have reached today's limit here. Nothing was sent."
RUN_LIMIT = "This run has reached its limit for paid calls. Nothing was sent."
NO_ESTIMATE = "This call could not be checked before sending, so nothing was sent."

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
    """A name a developer's machine uses. The guard does not read it: it loosens nothing (fails closed)."""
    return (env or "").strip().lower() in LOCAL


def _named_cap() -> bool:
    """NAPKIN_SPEND_CAP_EUR holds a number the environment chose (0 included)."""
    v = (os.environ.get("NAPKIN_SPEND_CAP_EUR") or "").strip()
    try:
        n = float(v)
    except ValueError:
        return False
    return math.isfinite(n) and n >= 0


def paid_calls_on(env: str | None = None) -> bool:
    """On only when NAPKIN_PAID_CALLS says on AND NAPKIN_SPEND_CAP_EUR names a cap, in every environment.
    Unset, unreadable or a cap left out: off."""
    v = (os.environ.get("NAPKIN_PAID_CALLS") or "").strip().lower()
    return v in _ON and _named_cap()


def _cap(name: str, unset: float | None) -> float | None:
    v = (os.environ.get(name) or "").strip()
    if not v:
        return unset
    try:
        n = float(v)
    except ValueError:
        return 0.0
    return n if math.isfinite(n) and n >= 0 else 0.0


def day_cap(env: str | None = None) -> float:
    """The day's cap in euro: unset or unreadable is 0 (refuses every paid call), never "no cap"."""
    return _cap("NAPKIN_SPEND_CAP_EUR", 0.0)


def run_cap(env: str | None = None) -> float | None:
    return _cap("NAPKIN_SPEND_RUN_CAP_EUR", None)


def describe(env: str | None = None) -> str:
    """One line for the start-up log: which mode the guard is in, and why."""
    env = environment() if env is None else env
    name = env if os.environ.get("NAPKIN_ENV") else f"{env} (NAPKIN_ENV unset)"
    if not paid_calls_on(env):
        why = ("NAPKIN_PAID_CALLS is not on" if (os.environ.get("NAPKIN_PAID_CALLS") or "").strip().lower() not in _ON
               else "NAPKIN_SPEND_CAP_EUR names no cap")
        return f"spend guard: environment {name}: paid calls OFF ({why}); every paid call is refused"
    rcap = run_cap(env)
    return (f"spend guard: environment {name}: paid calls ON, day cap {day_cap(env):g} euro, run cap "
            f"{'none' if rcap is None else f'{rcap:g} euro'}; totals are per process and start at zero")


def allow(amount: float, env: str, run: str) -> Verdict:
    """May a paid call that is expected to cost at most `amount` euro go out, for this
    environment and this run? An allowed call is counted at once."""
    env, run = (env or "local").strip().lower(), run or "-"
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return Verdict(False, NO_ESTIMATE)
    if not math.isfinite(amount) or amount < 0:
        return Verdict(False, NO_ESTIMATE)
    if not paid_calls_on(env):
        return Verdict(False, PAID_OFF)
    today = time.strftime("%Y-%m-%d", time.gmtime())
    with _lock:
        cap = day_cap(env)
        spent = _day.get((env, today), 0.0)
        if cap <= 0 or spent + amount > cap:
            log.warning("spend guard: %s refused %.4f: the day cap is %g euro, %.4f spent (NAPKIN_SPEND_CAP_EUR)",
                        env, amount, cap, spent)
            return Verdict(False, DAY_LIMIT)
        rcap = run_cap(env)
        rspent = _run.get((env, run), 0.0)
        if rcap is not None and (rcap <= 0 or rspent + amount > rcap):
            log.warning("spend guard: %s run %s refused %.4f: the run cap is %g euro, %.4f spent "
                        "(NAPKIN_SPEND_RUN_CAP_EUR)", env, run, amount, rcap, rspent)
            return Verdict(False, RUN_LIMIT)
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
