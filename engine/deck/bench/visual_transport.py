"""Transports and the cost cap for the vision critic bench (feature deck-vision-critic, phase 1).

``Transport.call`` takes one slide picture and its questions and returns a ``Reply``. The only live transport here is
``ApiTransport`` (the Napkin API key through the Anthropic SDK): client slides never go through the Claude Code login.
Nothing in tests reaches the network: ``FakeTransport`` makes calls and counts them, and ``block_network`` patches
sockets to raise. ``Budget`` reserves each call's worst case before it starts, so parallel calls cannot pass the cap.
"""
from __future__ import annotations

import base64
import os
import socket
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field

from .. import spec

#: Image tokens are about one per 28 x 28 pixel patch; text is estimated at 3.5 characters a token.
PIXELS_PER_TOKEN = 750   # image tokens are about width x height / 750
CHARS_PER_TOKEN = 3.5


@dataclass
class Reply:
    text: str
    tokens_in: int = 0
    tokens_out: int = 0
    cache_read: int = 0
    cache_creation: int = 0
    secs: float = 0.0
    model: str = ""
    transport: str = ""
    usd: float | None = None   # a figure the transport itself reported, else None (estimate_usd prices the tokens)
    stop: str | None = None    # a stop_reason that ends the answer (max_tokens, refusal): the call was paid for, the answer is unjudgeable


class NoCharge(RuntimeError):
    """A failure before anything was sent (no key): the only failure that books $0. Any other failed call books its reserved worst case."""


def png_size(png: bytes) -> tuple:
    """(width, height) from a PNG header."""
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    return int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")


def estimate_input_tokens(png: bytes, text_chars: int) -> int:
    """Input estimate: the picture at width x height / 750 tokens plus the text, rounded up."""
    w, h = png_size(png)
    return -(-w * h // PIXELS_PER_TOKEN) + int(text_chars / CHARS_PER_TOKEN) + 1


def worst_case_usd(model: str, est_in: int, max_out: int) -> float:
    """A call's worst case: every input token priced as a cache write (1.25x input), every output token used."""
    return spec.estimate_usd(model, 0, max_out, 0, est_in)


class Budget:
    """A dollar cap with reservations, global and per group (a deck). ``reserve`` takes a call's worst case before the
    call starts and refuses (returning None, with ``why`` set) when the global or the group cap would be passed;
    ``settle`` releases the reservation and books what the call really cost, even when that is more than reserved
    (``overruns`` counts those). Thread-safe."""

    def __init__(self, cap_usd: float, group_cap_usd: float | None = None):
        self.cap = float(cap_usd)
        self.group_cap = None if group_cap_usd is None else float(group_cap_usd)
        self.spent = 0.0
        self.reserved = 0.0
        self.groups: dict = {}      # group -> [spent, reserved]
        self.overruns = 0
        self.why = ""
        self._lock = threading.Lock()

    def reserve(self, model: str, est_in: int, max_out: int, group: str = "") -> float | None:
        worst = worst_case_usd(model, est_in, max_out)
        with self._lock:
            g = self.groups.setdefault(group, [0.0, 0.0])
            if self.spent + self.reserved + worst > self.cap + 1e-9:
                self.why = "over the --max-usd cap: not started"
                return None
            if self.group_cap is not None and g[0] + g[1] + worst > self.group_cap + 1e-9:
                self.why = "over the per-deck cap: not started"
                return None
            self.reserved += worst
            g[1] += worst
            return worst

    def settle(self, reservation: float, actual_usd: float, group: str = "") -> None:
        with self._lock:
            g = self.groups.setdefault(group, [0.0, 0.0])
            self.reserved = max(0.0, self.reserved - reservation)
            g[1] = max(0.0, g[1] - reservation)
            self.spent += actual_usd
            g[0] += actual_usd
            if actual_usd > reservation + 1e-9:
                self.overruns += 1

    def group_spent(self) -> dict:
        return {k: round(v[0], 4) for k, v in self.groups.items() if k}


def reply_usd(r: Reply, model: str, worst: float | None = None) -> float:
    """What a reply cost: the figure the transport reported, else its tokens priced. A reply with no usage at all is
    priced at ``worst`` (the reserved worst case) when given, never $0."""
    if r.usd is not None:
        return r.usd
    if not (r.tokens_in or r.tokens_out or r.cache_read or r.cache_creation) and worst is not None:
        return worst
    return spec.estimate_usd(model, r.tokens_in, r.tokens_out, r.cache_read, r.cache_creation)


class FakeTransport:
    """A stand-in with fixed usage that makes real (counted) calls: tests use it so a guard against live calls has
    something to trip on. ``replies`` maps nothing: ``respond(system, user_text, png, model)`` returns the reply text."""
    name = "fake"

    def __init__(self, respond=None, tokens_in: int = 1500, tokens_out: int = 400, delay: float = 0.0, stop: str | None = None):
        self.respond = respond or (lambda *a: '{"answers":{}}')
        self.tokens_in, self.tokens_out, self.delay, self.stop = tokens_in, tokens_out, delay, stop
        self.calls = 0
        self.in_flight = 0
        self.max_in_flight = 0
        self._lock = threading.Lock()

    def call(self, *, system: str, user_text: str, image_png: bytes, model: str, max_tokens: int) -> Reply:
        with self._lock:
            self.calls += 1
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
        try:
            if self.delay:
                time.sleep(self.delay)
            return Reply(self.respond(system, user_text, image_png, model), self.tokens_in, self.tokens_out, 0, 0, self.delay, model, self.name, stop=self.stop)
        finally:
            with self._lock:
                self.in_flight -= 1


class ApiTransport:
    """The live transport: the Anthropic Messages API with the Napkin API key (ANTHROPIC_API_KEY, read by the SDK from
    the environment and never printed). The system prompt is cached; effort is low. Paid: only behind --live --yes-cost."""
    name = "api"

    def __init__(self, effort: str = "low"):
        self.effort = effort

    def call(self, *, system: str, user_text: str, image_png: bytes, model: str, max_tokens: int) -> Reply:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise NoCharge("ANTHROPIC_API_KEY is not set: client slides use the API key, never the Claude Code login")
        import anthropic
        client = anthropic.Anthropic()
        t0 = time.time()
        r = client.messages.create(
            model=model, max_tokens=max_tokens, output_config={"effort": self.effort},
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.standard_b64encode(image_png).decode()}},
                {"type": "text", "text": user_text}]}])
        u = r.usage
        text = "".join(b.text for b in r.content if b.type == "text")
        return Reply(text, int(getattr(u, "input_tokens", 0) or 0), int(getattr(u, "output_tokens", 0) or 0), int(getattr(u, "cache_read_input_tokens", 0) or 0),
                     int(getattr(u, "cache_creation_input_tokens", 0) or 0), round(time.time() - t0, 2), model, self.name,
                     stop=r.stop_reason if r.stop_reason in ("refusal", "max_tokens") else None)


@contextmanager
def block_network():
    """Make every new socket connection raise, for the length of the block (tests)."""
    real = socket.socket.connect

    def refuse(self, *a, **k):
        raise AssertionError("network blocked: a live call was attempted")
    socket.socket.connect = refuse
    try:
        yield
    finally:
        socket.socket.connect = real
