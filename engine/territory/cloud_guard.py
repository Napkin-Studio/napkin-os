"""The cloud frame check: one Claude Haiku vision call per picture, through Bedrock (feature territories-pictures-frames, owner 2026-11-23).

The local guard (``visuals/guard.py``) asks a vision model on the machine (Ollama). The cloud has none, so in the middleware the same question goes to
Claude Haiku in Amazon Bedrock, through the client every other model step uses (``brief_llm._anthropic_client``, NAPKIN_MODEL_API=bedrock, the task
role, no API key). It plugs in where Ollama did: ``Frames`` binds it to its ``Spend`` and hands ``guard.check_image`` a ``post(url, body)`` that answers
in the Ollama reply shape, so the readable-text / logo / banned-imagery reading and the fail-closed rules stay in ONE place.

* one call per frame, asking for the readable text (the words, for the on-screen-line comparison), logos or brands, and the banned imagery of the guard rules;
* the call is under the CLAUDE cap (never the picture cap), checked before it is made and recorded in the spend ledger as stage ``frame_check``; the same
  picture and question are never paid for twice (the ledger's call key);
* a call that fails, times out, or is refused by the cap raises ``GuardUnavailable`` (an OSError): ``check_image`` then answers ``checked: False`` with the
  reason and the frame is HELD for a person. Nothing here ever turns a failure into a clean bill.

Choice by config: ``NAPKIN_TERRITORY_GUARD`` = ``bedrock`` or ``local``; unset means ``bedrock`` when NAPKIN_MODEL_API=bedrock, else ``local`` (Ollama).
"""
from __future__ import annotations

import base64
import hashlib
import os
import time

ENV_GUARD = "NAPKIN_TERRITORY_GUARD"
#: server/napkin/model_routes.py ALIASES["haiku-4.5"]: the Anthropic id (priced in engine/prices.json); brief_llm's Bedrock client maps it to the profile.
MODEL = "claude-haiku-4-5"
STAGE = "frame_check"
MAX_TOKENS = 600
TIMEOUT = 90.0
SYSTEM = "You check one picture for a safety review. Answer with JSON only, exactly the keys asked for, and no other words."


class GuardUnavailable(OSError):
    """The check could not be made. ``reason`` is the sentence the held frame carries."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _media_type(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _bedrock_client():
    try:
        import brief_llm
        if not brief_llm._bedrock_on():
            raise GuardUnavailable("skipped: the cloud check needs Claude in Bedrock (NAPKIN_MODEL_API=bedrock), which this workspace does not use")
        return brief_llm._anthropic_client()
    except GuardUnavailable:
        raise
    except Exception as e:      # noqa: BLE001 - a missing SDK or credentials is a held frame, not a crash
        raise GuardUnavailable(f"skipped: the Claude vision check is not available ({type(e).__name__})") from e


def _unfence(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[-1] if "\n" in t else t[3:]
        t = t.rsplit("```", 1)[0]
    return t.strip()


class CloudGuard:
    """``bind(spend)`` -> the ``post(url, body)`` ``guard.check_image`` takes. ``client`` is injectable (a test passes a fake Bedrock client)."""

    name = "the Claude vision check"

    def __init__(self, client=None, model: str = MODEL, timeout: float = TIMEOUT):
        self._client, self.model, self.timeout = client, model, timeout

    def client(self):
        return self._client or _bedrock_client()

    def estimate(self) -> float:
        from . import spend as sp
        return sp.estimate_call(STAGE, self.model)

    def bind(self, spend):
        from . import spend as sp
        def post(_url: str, body: dict) -> dict:
            msg = (body.get("messages") or [{}])[0]
            question, image = msg.get("content") or "", (msg.get("images") or [""])[0]
            png = base64.b64decode(image)
            key_text = hashlib.sha256(png).hexdigest() + "|" + hashlib.sha256(question.encode()).hexdigest()

            def call(_stage, _system, _user):
                t0 = time.time()
                r = self.client().messages.create(
                    model=self.model, max_tokens=MAX_TOKENS, system=SYSTEM,
                    messages=[{"role": "user", "content": [{"type": "image", "source": {"type": "base64", "media_type": _media_type(png), "data": image}},
                                                           {"type": "text", "text": question}]}])
                text = "".join(getattr(b, "text", "") for b in (getattr(r, "content", None) or []) if getattr(b, "type", "text") == "text")
                u = getattr(r, "usage", None)
                usage = {"prompt_tokens": int(getattr(u, "input_tokens", 0) or 0), "completion_tokens": int(getattr(u, "output_tokens", 0) or 0),
                         "cache_read_tokens": int(getattr(u, "cache_read_input_tokens", 0) or 0), "model": self.model, "secs": round(time.time() - t0, 3), "calls": 1}
                return {"text": text}, usage

            try:
                obj, _usage = self._wrapped(spend, call)(STAGE, SYSTEM, key_text)
            except sp.CapReached as e:
                raise GuardUnavailable("skipped: " + str(e)) from e
            except GuardUnavailable:
                raise
            except Exception as e:      # noqa: BLE001 - Bedrock errors, throttling, timeouts: all fail closed
                raise GuardUnavailable(f"skipped: the Claude vision check failed ({type(e).__name__})") from e
            return {"message": {"content": _unfence(obj.get("text"))}}

        return post

    def _wrapped(self, spend, call):
        return spend.wrap(call, timeout=self.timeout, model_of=lambda _s: self.model)


def choose(environ=None):
    """The cloud guard when config says so, else ``None`` (the local Ollama guard)."""
    env = os.environ if environ is None else environ
    want = str(env.get(ENV_GUARD) or "").strip().lower()
    if not want:
        want = "bedrock" if str(env.get("NAPKIN_MODEL_API") or "").strip().lower() == "bedrock" else "local"
    if want not in ("bedrock", "local"):
        raise ValueError(f"{ENV_GUARD} must be bedrock or local")
    return CloudGuard() if want == "bedrock" else None
