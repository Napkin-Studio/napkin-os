"""Optional local guard check on a saved frame: a vision model on this machine (Ollama) lists any readable text, logos or
brand names, and any banned imagery for a safe-messaging category. A frame that fails is FLAGGED ("needs a person"), never
silently used. If Ollama is not running the check is skipped cleanly and the frame shows as "not checked".
Real precedent: a real brand's logo slipped into a frame that said no brand names."""
from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request

OLLAMA = "http://127.0.0.1:11434/api/chat"
MODEL = "qwen3.5:9b"
QUESTION = ("Look at this image. List any readable text, logos or brand names visible anywhere in it (signs, labels, packaging, "
            "clothing, screens). Answer with JSON only: {\"readable_text\": [strings], \"logos_or_brands\": [strings]}. "
            "Use empty lists when there are none.")


def _post(url: str, body: dict, timeout: float = 180.0) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _items(v) -> list[str]:
    if not v:
        return []
    return [str(x) for x in (v if isinstance(v, list) else [v]) if str(x).strip() and str(x).strip().lower() not in ("none", "n/a")]


def check_image(png: bytes, banned: list[str] | None = None, post=_post, url: str = OLLAMA, model: str = MODEL, name: str = "Ollama") -> dict:
    """Returns {checked, flagged, found, reason}. ``post`` is injectable so tests run with a fake Ollama. ``name`` is the checker the reason names;
    an error that carries its own ``reason`` (the cloud check's) is quoted as it is."""
    q = QUESTION
    if banned:
        q = q.replace("{\"readable_text\"", "{\"banned_imagery\": [strings], \"readable_text\"") + " Also list any of these if shown: " + ", ".join(banned) + "."
    body = {"model": model, "stream": False, "think": False, "format": "json",
            "messages": [{"role": "user", "content": q, "images": [base64.b64encode(png).decode()]}]}
    try:
        reply = post(url, body)
    except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
        return {"checked": False, "flagged": False, "found": {}, "reason": getattr(e, "reason", None) if isinstance(getattr(e, "reason", None), str) else f"skipped: {name} not reachable ({type(e).__name__})"}
    except ValueError:                                  # the checker answered with something that is not JSON
        return {"checked": False, "flagged": False, "found": {}, "reason": f"skipped: {name}'s answer was not JSON"}
    text = ((reply or {}).get("message") or {}).get("content") or ""
    unreadable = {"checked": True, "flagged": True, "found": {}, "reason": "the vision model's reply was not readable: needs a person"}
    try:
        got = json.loads(text)
    except ValueError:
        return unreadable
    # fail closed: a reply that does not answer every question asked ({} or a chatty object) is NOT a clean bill
    want = ["readable_text", "logos_or_brands"] + (["banned_imagery"] if banned else [])
    if not isinstance(got, dict) or any(k not in got for k in want):
        return unreadable
    found = {k: _items(got.get(k)) for k in ("readable_text", "logos_or_brands", "banned_imagery")}
    found = {k: v for k, v in found.items() if v}
    return {"checked": True, "flagged": bool(found), "found": found,
            "reason": "needs a person: " + "; ".join(f"{k.replace('_', ' ')}: {', '.join(v)}" for k, v in found.items()) if found else "clean"}
