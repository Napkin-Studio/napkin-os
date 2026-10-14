"""The spend ledger (features/tenant-limits.clan): the only module that reads or writes spend.

Two counters in the quotas table, both in USD (attribute usd):

  spend                        the global total, reserved plus confirmed, for the life of the stack.
                               config.json spend.capUsd stops new paid jobs at it: the invisible
                               backstop (owner, 2026-10-13).
  spend#<tenantId>#<YYYY-MM>   the agency's month, by the UTC calendar (the same clock as the day's
                               quotas). Its cap, when the agency has chosen one, stops new paid jobs.

Every call moves both counters by the same amount, so what the agency's month records is exactly
what Napkin pays, failed or refused attempts that the provider bills included (owner, 2026-10-13:
charged silently). What the relay gives back (a job that never reached the provider, never ran, or
failed on our side) comes off both.

A reservation is admitted atomically: a conditional ADD on the agency's month (under its cap), then
a conditional ADD on the global total (under the stop), and the first is undone when the second
refuses. Two batches at once cannot both take the last of either. A reservation already held moves
with adjust() in the month it was made in (the job's _month), never in the current one.

Costs are recorded, never shown: no screen reads these counters (no prices in the UI).
"""

from __future__ import annotations

from datetime import datetime, timezone

GLOBAL = "spend"
ATTR = "usd"


class LimitReached(Exception):
    """The agency's month is at its cap."""


class SpendStop(Exception):
    """The global total is at the stop."""


def month_of(ts: float) -> str:
    """The UTC calendar month of a time: 'YYYY-MM'."""
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m")


def month_key(tenant: str, month: str) -> str:
    return f"{GLOBAL}#{tenant}#{month}"


class Ledger:
    def __init__(self, store, clock):
        self.store, self.clock = store, clock

    def month(self) -> str:
        return month_of(self.clock())

    def reserve(self, tenant: str, usd: float, *, cap_month: float | None, cap_global: float) -> str:
        """Admit `usd` of new spend for the agency in the current month; the month it was made in.
        Raises LimitReached (the agency's cap) or SpendStop (the global stop), leaving nothing behind."""
        month = self.month()
        if usd <= 0:
            return month
        key = month_key(tenant, month)
        if not self.store.incr(key, ATTR, usd, cap_month):
            raise LimitReached()
        if not self.store.incr(GLOBAL, ATTR, usd, cap_global):
            self.store.incr(key, ATTR, -usd)
            raise SpendStop()
        return month

    def adjust(self, tenant: str | None, month: str | None, delta: float) -> None:
        """Move a reservation already held: settle it at the provider's charge, give it back, or move
        it to a cheaper provider. No cap applies: the job was admitted. A job from before this ledger
        (no month) moves the global total only."""
        if not delta:
            return
        if tenant and month:
            self.store.incr(month_key(tenant, month), ATTR, delta)
        self.store.incr(GLOBAL, ATTR, delta)

    def month_used(self, tenant: str, month: str | None = None) -> float:
        return float(self.store.counters(month_key(tenant, month or self.month())).get(ATTR, 0))

    def total(self) -> float:
        return float(self.store.counters(GLOBAL).get(ATTR, 0))
