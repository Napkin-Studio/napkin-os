"""The fit check (picture plan, section 5): after the text-and-logo guard, each generated deck picture gets one look that asks whether it
shows the scene card's key visual in its setting. Pass: ``shows_idea`` and ``setting_fits`` are true and ``wrong_cues`` is empty. Anything
else, an unreadable answer included, is a fail; the caller retries once with a correction line, then drops the picture (never a fallback).

Route: the local Ollama vision model first (visuals.guard's URL and model), else Claude Haiku. Never Gemini: deck pictures come from client
material. Only the picture and its linted scene card are sent, never the brief. No network in tests: both routes are injectable.
"""
from __future__ import annotations

import base64
import io
import json

QUESTION = ("Look at this picture. Does it show {key_visual} in {setting}? Things that must not be in it: {must_not}.\n"
            "Answer JSON only: {{\"shows_idea\": true or false, \"setting_seen\": \"the place you see, under 8 words\", "
            "\"setting_fits\": true or false, \"wrong_cues\": [any of the things that must not be in it that you see]}}")
KEYS = ("shows_idea", "setting_seen", "setting_fits", "wrong_cues")
#: An execution's picture (deck mock-ups, spec.MOCKUPS) fills the visual area of an ad the deck draws around it: the same look, plus one
#: question: is the picture itself a photograph of an advert (a poster, billboard, phone, screen, shelf card) or does it carry words?
QUESTION_EXECUTION = ("Look at this picture. It will fill the picture area of an advert ({format}) that is drawn around it, so it must be "
                      "the scene alone. Does it show {key_visual} in {setting}? Things that must not be in it: {must_not}.\n"
                      "Answer JSON only: {{\"shows_idea\": true or false, \"setting_seen\": \"the place you see, under 8 words\", "
                      "\"setting_fits\": true or false, \"wrong_cues\": [any of the things that must not be in it that you see], "
                      "\"shows_an_ad\": true if the picture shows a poster, billboard, phone, screen, shelf card or advert, or readable words, "
                      "else false}}")


def question(card: dict) -> str:
    """The one question for a picture, from its scene card (key_visual, setting, must_not; an execution's card: its format too)."""
    nots = [str(x) for x in card.get("must_not") or [] if str(x).strip()]
    if card.get("role") == "execution":
        return QUESTION_EXECUTION.format(format=str(card.get("format") or "the work").strip() or "the work",
                                         key_visual=str(card.get("key_visual") or "the scene described").strip().rstrip("."),
                                         setting=str(card.get("setting") or "the setting described").strip().rstrip("."),
                                         must_not=", ".join(nots) or "nothing listed")
    return QUESTION.format(key_visual=str(card.get("key_visual") or "the scene described").strip().rstrip("."),
                           setting=str(card.get("setting") or "the setting described").strip().rstrip("."),
                           must_not=", ".join(nots) or "nothing listed")


def parse(text) -> dict | None:
    """The answer as a dict with every key, or None when it is unreadable."""
    if isinstance(text, dict):
        got = text
    else:
        s = str(text or "")
        a, b = s.find("{"), s.rfind("}")
        try:
            got = json.loads(s[a:b + 1]) if a >= 0 <= b else None
        except ValueError:
            return None
    if not isinstance(got, dict) or any(k not in got for k in KEYS):
        return None
    wc = got.get("wrong_cues")
    got["wrong_cues"] = [str(x) for x in wc] if isinstance(wc, list) else ([str(wc)] if wc else [])
    return got


def verdict(answer: dict | None) -> dict:
    """``{pass, reason, setting_seen}`` from a parsed answer (None: unreadable, a fail)."""
    if answer is None:
        return {"pass": False, "reason": "the fit check's answer was unreadable", "setting_seen": ""}
    ok = answer.get("shows_idea") is True and answer.get("setting_fits") is True and not answer["wrong_cues"] and answer.get("shows_an_ad") is not True
    why = []
    if answer.get("shows_an_ad") is True:
        why.append("it shows an advert or words itself, not the scene for the ad's picture area")
    if answer.get("shows_idea") is not True:
        why.append("it does not show the idea")
    if answer.get("setting_fits") is not True:
        why.append(f"the setting reads as {answer.get('setting_seen') or 'something else'}")
    if answer["wrong_cues"]:
        why.append("it shows " + ", ".join(answer["wrong_cues"][:3]))
    return {"pass": ok, "reason": "; ".join(why), "setting_seen": str(answer.get("setting_seen") or "")[:80]}


def correction(card: dict, v: dict) -> str:
    """The line a retry adds to the prompt: what the last frame showed, and what it must be."""
    seen = v.get("setting_seen") or "another place"
    if card.get("role") == "execution" and "advert or words" in str(v.get("reason") or ""):
        return f"The last frame showed an advert or words; this must be the scene alone, in {str(card.get('setting') or 'the setting described').rstrip('.')}, with no frame, device or words."
    return f"The last frame showed {seen}; this must be {str(card.get('setting') or 'the setting described').rstrip('.')}."


def _jpeg(data: bytes) -> bytes:
    """The picture as a JPEG at most 1024 px (Pillow); the bytes unchanged when Pillow cannot read them."""
    try:
        from PIL import Image, ImageOps   # noqa: PLC0415
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        im.thumbnail((1024, 1024))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        return buf.getvalue()
    except Exception:   # noqa: BLE001
        return data


def ollama_route(jpeg: bytes, q: str, post=None):
    """The local route: the parsed-or-raw answer, or None when Ollama is not reachable."""
    import urllib.error   # noqa: PLC0415
    from visuals import guard   # noqa: PLC0415
    body = {"model": guard.MODEL, "stream": False, "think": False, "format": "json",
            "messages": [{"role": "user", "content": q, "images": [base64.b64encode(jpeg).decode()]}]}
    try:
        reply = (post or guard._post)(guard.OLLAMA, body)
    except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
        return None
    except ValueError:
        return ""
    return ((reply or {}).get("message") or {}).get("content") or ""


def haiku_route(jpeg: bytes, q: str):
    """Claude Haiku through brief_llm's Anthropic client: the answer text, or None with no key or on a failed call. Never Gemini."""
    try:
        import brief_llm as L   # noqa: PLC0415
        msg = L._anthropic_client().messages.create(model=L.HAIKU, max_tokens=300, messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(jpeg).decode()}},
            {"type": "text", "text": q}]}])
    except Exception:   # noqa: BLE001
        return None
    return next((b.text for b in msg.content if getattr(b, "type", None) == "text"), "")


def check(data: bytes, card: dict, ollama=None, haiku=None) -> dict:
    """One look at a picture against its scene card: ``{checked, pass, reason, setting_seen, route}``. Local Ollama first, else Haiku;
    neither reachable: ``checked`` false and not a pass (the caller drops an unchecked picture from a client render)."""
    q, jpeg = question(card), _jpeg(data)
    for name, fn in (("ollama", ollama or ollama_route), ("haiku", haiku or haiku_route)):
        got = fn(jpeg, q)
        if got is None:
            continue
        return {"checked": True, **verdict(parse(got)), "route": name}
    return {"checked": False, "pass": False, "reason": "no vision model reachable for the fit check", "setting_seen": "", "route": None}
