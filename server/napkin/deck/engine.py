"""The Deck Maker engine port (middleware-api.md §12): the middleware's one way to reach engine/deck/server.py.

  POST <url>/run          {doc, inputs, approvals, render?}  start the next segment of the document's run (202)
  GET  <url>/run/<doc>    {state, run, notices, payload?, error?}  poll it: state is building, gate, done or failed
  POST <url>/production   {doc, name, data_b64}  keep a Production .clan or export zip for the document (deck-prod-picker)

The engine keeps each run's stage outputs in a cache of its own, so a segment resumes where the last one stopped; this port holds
no state. A failing, slow or unreadable engine is an `EngineError` carrying what it said (or why it could not be read); the job
turns it into a failed job with that message and never into a made-up success.
"""
from __future__ import annotations

import httpx

# Seconds to wait for one HTTP call to the engine. A segment is polled, so no call waits for a model.
TIMEOUT = 30.0
# An httpx transport for the engine port (a test double sets it); None in service.
TRANSPORT = None


class EngineError(Exception):
    """The engine could not run or answer: `status` (0 when it did not answer at all), `etype`, and its message."""

    def __init__(self, status: int, etype: str, message: str):
        super().__init__(message)
        self.status, self.etype, self.message = status, etype, message


class DeckEnginePort:
    def __init__(self, url: str, timeout: float = TIMEOUT, transport=None):
        self.url = url.rstrip("/")
        self.client = httpx.Client(timeout=timeout, transport=transport)

    def _call(self, method: str, path: str, body=None, run: bool = True) -> dict:
        try:
            r = self.client.request(method, self.url + path, json=body)
        except httpx.TimeoutException as e:
            raise EngineError(0, "engine_timeout", "the deck engine did not answer in time") from e
        except httpx.HTTPError as e:
            raise EngineError(0, "engine_unreachable", f"the deck engine could not be reached ({type(e).__name__})") from e
        try:
            data = r.json()
        except ValueError as e:
            raise EngineError(r.status_code, "engine_garbage", f"the deck engine's answer was not JSON (HTTP {r.status_code})") from e
        if not 200 <= r.status_code < 300:
            err = data.get("error") if isinstance(data, dict) else None
            if isinstance(err, dict) and err.get("message"):
                raise EngineError(r.status_code, str(err.get("type") or "engine_error"), str(err["message"]))
            raise EngineError(r.status_code, "engine_error", f"the deck engine answered HTTP {r.status_code}")
        if not run:
            if not isinstance(data, dict) or not data.get("ok"):
                raise EngineError(r.status_code, "engine_garbage", "the deck engine's answer was not a stored file")
            return data
        if not isinstance(data, dict) or data.get("state") not in ("building", "gate", "done", "failed") or not isinstance(data.get("run"), dict):
            raise EngineError(r.status_code, "engine_garbage", "the deck engine's answer was not a run")
        return data

    def start(self, body: dict) -> dict:
        return self._call("POST", "/run", body)

    def poll(self, doc: str) -> dict:
        return self._call("GET", f"/run/{doc}")

    def store_production(self, body: dict) -> dict:
        """Hand the engine a Production file for one document: ``{ok, sha256, name, kind, rows, eligible}``."""
        return self._call("POST", "/production", body, run=False)


def port_for(settings) -> DeckEnginePort | None:
    """The engine port when NAPKIN_DECK_ENGINE_URL is set, else None (build_deck then says no engine is configured)."""
    url = getattr(settings, "deck_engine_url", None)
    return DeckEnginePort(url, TIMEOUT, transport=TRANSPORT) if url else None
