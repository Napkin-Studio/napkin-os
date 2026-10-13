"""Fractional order keys (common rank): the only order of scenes, shots, beats, boards,
sizes and cut items. A port of rocicorp/fractional-indexing (CC0) in base 62; the twin
of production-tool/clan-store/src/rank.ts. Both pass contracts/examples/ranks.json."""

from __future__ import annotations

DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
ZERO = DIGITS[0]
SMALLEST_INTEGER = "A" + ZERO * 26


class RankError(ValueError):
    pass


def _midpoint(a: str, b: str | None) -> str:
    if b is not None and a >= b:
        raise RankError(f"{a} >= {b}")
    if a[-1:] == ZERO or (b is not None and b[-1:] == ZERO):
        raise RankError("trailing zero")
    if b is not None:
        n = 0
        while (a[n] if n < len(a) else ZERO) == b[n]:
            n += 1
        if n > 0:
            return b[:n] + _midpoint(a[n:], b[n:])
    digit_a = DIGITS.index(a[0]) if a else 0
    digit_b = DIGITS.index(b[0]) if b is not None else len(DIGITS)
    if digit_b - digit_a > 1:
        return DIGITS[int(0.5 * (digit_a + digit_b) + 0.5)]  # JS Math.round, not banker's rounding
    if b is not None and len(b) > 1:
        return b[:1]
    return DIGITS[digit_a] + _midpoint(a[1:], None)


def _integer_length(head: str) -> int:
    if "a" <= head <= "z":
        return ord(head) - ord("a") + 2
    if "A" <= head <= "Z":
        return ord("Z") - ord(head) + 2
    raise RankError(f"invalid order key head: {head}")


def _integer_part(key: str) -> str:
    n = _integer_length(key[0])
    if n > len(key):
        raise RankError(f"invalid order key: {key}")
    return key[:n]


def validate(key: str) -> None:
    """Raise RankError unless key is a valid order key."""
    if not key or key == SMALLEST_INTEGER:
        raise RankError(f"invalid order key: {key!r}")
    if any(c not in DIGITS for c in key):
        raise RankError(f"invalid order key: {key!r}")
    i = _integer_part(key)
    if key[len(i):][-1:] == ZERO:
        raise RankError(f"invalid order key: {key}")


def is_valid(key: str) -> bool:
    try:
        validate(key)
        return True
    except (RankError, IndexError):
        return False


def _increment(x: str) -> str | None:
    head, digs = x[0], list(x[1:])
    carry = True
    i = len(digs) - 1
    while carry and i >= 0:
        d = DIGITS.index(digs[i]) + 1
        if d == len(DIGITS):
            digs[i] = ZERO
        else:
            digs[i] = DIGITS[d]
            carry = False
        i -= 1
    if not carry:
        return head + "".join(digs)
    if head == "Z":
        return "a" + ZERO
    if head == "z":
        return None
    h = chr(ord(head) + 1)
    if h > "a":
        digs.append(ZERO)
    else:
        digs.pop()
    return h + "".join(digs)


def _decrement(x: str) -> str | None:
    head, digs = x[0], list(x[1:])
    borrow = True
    i = len(digs) - 1
    while borrow and i >= 0:
        d = DIGITS.index(digs[i]) - 1
        if d == -1:
            digs[i] = DIGITS[-1]
        else:
            digs[i] = DIGITS[d]
            borrow = False
        i -= 1
    if not borrow:
        return head + "".join(digs)
    if head == "a":
        return "Z" + DIGITS[-1]
    if head == "A":
        return None
    h = chr(ord(head) - 1)
    if h < "Z":
        digs.append(DIGITS[-1])
    else:
        digs.pop()
    return h + "".join(digs)


def between(a: str | None, b: str | None) -> str:
    """A key that sorts after a and before b (None: no bound on that side)."""
    if a is not None:
        validate(a)
    if b is not None:
        validate(b)
    if a is not None and b is not None and a >= b:
        raise RankError(f"{a} >= {b}")
    if a is None:
        if b is None:
            return "a" + ZERO
        ib = _integer_part(b)
        fb = b[len(ib):]
        if ib == SMALLEST_INTEGER:
            return ib + _midpoint("", fb)
        if ib < b:
            return ib
        res = _decrement(ib)
        if res is None:
            raise RankError("cannot decrement any more")
        return res
    if b is None:
        ia = _integer_part(a)
        fa = a[len(ia):]
        i = _increment(ia)
        return ia + _midpoint(fa, None) if i is None else i
    ia = _integer_part(a)
    fa = a[len(ia):]
    ib = _integer_part(b)
    fb = b[len(ib):]
    if ia == ib:
        return ia + _midpoint(fa, fb)
    i = _increment(ia)
    if i is None:
        raise RankError("cannot increment any more")
    if i < b:
        return i
    return ia + _midpoint(fa, None)


def n_between(a: str | None, b: str | None, n: int) -> list[str]:
    """n keys in order between a and b, spread evenly (fractional-indexing's generateNKeysBetween)."""
    if n == 0:
        return []
    if n == 1:
        return [between(a, b)]
    if b is None:
        c = between(a, b)
        out = [c]
        for _ in range(n - 1):
            c = between(c, b)
            out.append(c)
        return out
    if a is None:
        c = between(a, b)
        out = [c]
        for _ in range(n - 1):
            c = between(a, c)
            out.append(c)
        return list(reversed(out))
    mid = n // 2
    c = between(a, b)
    return [*n_between(a, c, mid), c, *n_between(c, b, n - mid - 1)]
