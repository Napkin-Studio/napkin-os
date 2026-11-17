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
PATCH = 28
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


def png_size(png: bytes) -> tuple:
    """(width, height) from a PNG header."""
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    return int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")


def estimate_input_tokens(png: bytes, text_chars: int) -> int:
    """Worst-case input estimate: the picture's 28 px patches plus the text, rounded up."""
    w, h = png_size(png)
    return -(-w // PATCH) * -(-h // PATCH) + int(text_chars / CHARS_PER_TOKEN) + 1


class Budget:
    """A dollar cap with reservations. ``reserve`` takes a call's worst case (input estimate + max_tokens out, every
    input token at full price) before the call starts and refuses when spent + reserved + worst would pass the cap;
    ``settle`` releases the reservation and books the real cost. Thread-safe."""

    def __init__(self, cap_usd: float):
        self.cap = float(cap_usd)
        self.spent = 0.0
        self.reserved = 0.0
        self._lock = threading.Lock()

    def reserve(self, model: str, est_in: int, max_out: int) -> float | None:
        worst = spec.estimate_usd(model, est_in, max_out)
        with self._lock:
            if self.spent + self.reserved + worst > self.cap + 1e-9:
                return None
            self.reserved += worst
            return worst

    def settle(self, reservation: float, actual_usd: float) -> None:
        with self._lock:
            self.reserved = max(0.0, self.reserved - reservation)
            self.spent += actual_usd


def reply_usd(r: Reply, model: str) -> float:
    return r.usd if r.usd is not None else spec.estimate_usd(model, r.tokens_in, r.tokens_out, r.cache_read, r.cache_creation)


class FakeTransport:
    """A stand-in with fixed usage that makes real (counted) calls: tests use it so a guard against live calls has
    something to trip on. ``replies`` maps nothing: ``respond(system, user_text, png, model)`` returns the reply text."""
    name = "fake"

    def __init__(self, respond=None, tokens_in: int = 1500, tokens_out: int = 400, delay: float = 0.0):
        self.respond = respond or (lambda *a: '{"answers":{}}')
        self.tokens_in, self.tokens_out, self.delay = tokens_in, tokens_out, delay
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
            return Reply(self.respond(system, user_text, image_png, model), self.tokens_in, self.tokens_out, 0, 0, self.delay, model, self.name)
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
            raise RuntimeError("ANTHROPIC_API_KEY is not set: client slides use the API key, never the Claude Code login")
        import anthropic
        client = anthropic.Anthropic()
        t0 = time.time()
        r = client.messages.create(
            model=model, max_tokens=max_tokens, output_config={"effort": self.effort},
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.standard_b64encode(image_png).decode()}},
                {"type": "text", "text": user_text}]}])
        if r.stop_reason in ("refusal", "max_tokens"):
            raise RuntimeError(f"model stopped: {r.stop_reason}")
        u = r.usage
        text = "".join(b.text for b in r.content if b.type == "text")
        return Reply(text, int(u.input_tokens or 0), int(u.output_tokens or 0), int(getattr(u, "cache_read_input_tokens", 0) or 0),
                     int(getattr(u, "cache_creation_input_tokens", 0) or 0), round(time.time() - t0, 2), model, self.name)


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
