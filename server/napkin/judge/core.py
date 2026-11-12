"""The judge_work logic: assemble the input from an allow list, answer the code tests in code, answer
the rest from the backend, and return exactly the rubric's test ids. Never a total, never a number."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from pathlib import Path

from .. import client_ai, spend
from ..brief.judge import clip, sentence
from ..util import TaskError, bad
from . import rubric

log = logging.getLogger("napkin.judge")

BACKENDS = ("fixture", "llm-judge")
DEFAULT_FIXTURE = Path(__file__).with_name("fixtures") / "default.json"
DEFAULT_PRICE_EUR = 0.05
EVIDENCE_MAX = 240
PURPOSES = {"idea": "judge_idea", "craft": "judge_craft", "effect": "judge_effect"}

# The allow lists: what Judge reads of the work and of the brief. A field not here is never sent on.
BRIEF_FIELDS = ("background", "objectives", "audience", "competitor_context", "insight", "single_minded_proposition",
                "job", "barrier", "objection", "reasons_to_believe", "desired_response", "tone_and_world",
                "measurement", "mandatories", "media_roles", "budget_and_scope")
BEAT_FIELDS = ("id", "kind", "role", "text", "visual_action", "voiceover", "dialogue", "on_screen_text",
               "sound_intention", "duration_s")
CARD_FIELDS = ("text", "kind")
FRAME_FIELDS = ("caption", "asset")


def _pick(src, keys):
    return {k: src[k] for k in keys if isinstance(src, dict) and k in src}


def _list_of(src, keys, limit=200):
    return [_pick(x, keys) for x in (src if isinstance(src, list) else [])[:limit] if isinstance(x, dict)]


def work_content(kind: str, c: dict) -> dict:
    c = c if isinstance(c, dict) else {}
    if kind == "script":
        out = _pick(c, ("format", "slot_s", "proposition", "cast"))
        script = c.get("script") if isinstance(c.get("script"), dict) else {}
        out["script"] = {"beats": _list_of(script.get("beats"), BEAT_FIELDS)}
        checks = c.get("checks") if isinstance(c.get("checks"), dict) else {}
        out["checks"] = {k: _list_of(checks.get(k), ("text", "source")) for k in ("mandatory", "banned")}
        return out
    if kind == "idea_route":
        out = {"route": _pick(c.get("route"), ("name", "bet")), "cards": []}
        for card in (c.get("cards") if isinstance(c.get("cards"), list) else [])[:200]:
            if not isinstance(card, dict):
                continue
            n = _pick(card, CARD_FIELDS)
            n["brief_link"] = _pick(card.get("brief_link"), ("insight", "proposition"))
            bm = (card.get("tests") or {}).get("banned_match") if isinstance(card.get("tests"), dict) else None
            n["tests"] = {"banned_match": _pick(bm, ("banned",))} if isinstance(bm, dict) else {}
            out["cards"].append(n)
        return out
    out = {"territory": _pick(c.get("territory"), ("name", "line", "source")), "proposition": c.get("proposition", ""),
           "tone": c.get("tone") if isinstance(c.get("tone"), list) else [],
           "must_show": c.get("must_show") if isinstance(c.get("must_show"), list) else [],
           "never_show": c.get("never_show") if isinstance(c.get("never_show"), list) else []}
    frames = c.get("reference_frames") if isinstance(c.get("reference_frames"), dict) else {}
    out["reference_frames"] = {k: _pick(frames[k], FRAME_FIELDS) for k in ("a", "b", "c") if isinstance(frames.get(k), dict)}
    return out


def assemble_input(inp: dict) -> dict:
    """The one place the request's input is built from: {work{kind, content}, brief{approved fields}, rubric_version}.
    An allow list at every level; anything else in the request is dropped before a model or a check sees it."""
    work = inp.get("work")
    if not isinstance(work, dict) or work.get("kind") not in rubric.kinds():
        raise bad(f"work.kind must be one of {', '.join(rubric.kinds())}")
    kind = work["kind"]
    if not isinstance(work.get("content"), dict):
        raise bad("work.content must be an object")
    brief = inp.get("brief") if isinstance(inp.get("brief"), dict) else {}
    ver = inp.get("rubric_version")
    if ver is not None and str(ver) != rubric.version():
        raise bad(f"rubric_version {ver!r} is not the one in force ({rubric.version()})")
    return {"work": {"kind": kind, "content": work_content(kind, work["content"])},
            "brief": {k: brief[k] for k in BRIEF_FIELDS if k in brief}, "rubric_version": rubric.version()}


# -- tests answered in code ------------------------------------------------------------------------

def _words(s) -> int:
    return len(str(s or "").split())


def _spoken(beats):
    voice = [b for b in beats if b.get("kind") == "voice" and str(b.get("text") or "").strip()]
    return voice or [b for b in beats if str(b.get("text") or "").strip()]


def _res(ok: bool, evidence: str) -> dict:
    return {"value": "pass" if ok else "fail", "evidence": clip(evidence, EVIDENCE_MAX)}


def _idea_line(kind, c) -> str:
    if kind == "idea_route":
        return str((c.get("route") or {}).get("bet") or "")
    if kind == "visual_brief":
        return str((c.get("territory") or {}).get("line") or "")
    return str(c.get("proposition") or (_spoken(c["script"]["beats"]) or [{}])[0].get("text") or "")


def code_answer(tid: str, kind: str, c: dict) -> dict:
    if tid == "idea.not_banned":
        hit = [x["tests"]["banned_match"].get("banned") for x in c.get("cards", []) if x.get("tests", {}).get("banned_match")]
        return _res(not hit, f"The Banned list matched: {hit[0]}." if hit else "No Banned-list match is recorded on the work.")
    if tid == "idea.tellable_short":
        line = _idea_line(kind, c)
        n = _words(line)
        return _res(0 < n <= 30, f"The idea line is {n} words." if n else "There is no idea line to count.")
    if kind == "script":
        beats = c["script"]["beats"]
        text = " ".join(str(b.get("text") or "") for b in beats)
        if tid == "craft.script.mandatory_present":
            must = [m.get("text", "") for m in c["checks"]["mandatory"] if m.get("text")]
            miss = [m for m in must if m.lower() not in text.lower()]
            return _res(not miss, f"Missing: {miss[0]}." if miss else (f"All {len(must)} mandatory lines are in the script." if must else "The script lists no mandatory lines."))
        if tid == "craft.script.no_banned_word":
            hit = [b["text"] for b in c["checks"]["banned"] if b.get("text") and re.search(r"\b" + re.escape(b["text"]) + r"\b", text, re.I)]
            return _res(not hit, f"The banned word {hit[0]!r} is in the script." if hit else "No banned word appears.")
        if tid == "craft.script.fits_the_slot":
            slot = c.get("slot_s")
            if c.get("format") not in ("radio", "tv") or not isinstance(slot, (int, float)) or slot <= 0:
                return _res(True, "This format has no time slot.")
            secs = _words(" ".join(str(b.get("text") or "") for b in _spoken(beats))) / 2.5
            return _res(secs <= slot - 1, f"{round(secs)} seconds against a {int(slot)} second slot.")
        if tid == "craft.script.no_dash":
            return _res(not re.search("[—–]", text), "A dash is in the script." if re.search("[—–]", text) else "No em or en dash.")
        if tid == "craft.script.spoken_line":
            n = len([b for b in beats if str(b.get("text") or "").strip()])
            return _res(n > 0, f"{n} beats have words." if n else "No beat has words.")
    if kind == "idea_route":
        r, cards = c.get("route") or {}, c.get("cards", [])
        if tid == "craft.idea_route.has_bet":
            return _res(bool(str(r.get("bet") or "").strip()), "The route states its bet." if r.get("bet") else "The route has no bet.")
        if tid == "craft.idea_route.has_cards":
            return _res(bool(cards), f"The route holds {len(cards)} cards.")
        if tid == "craft.idea_route.team_made":
            other = [x for x in cards if x.get("kind") != "team"]
            return _res(bool(cards) and not other, f"{len(other)} of {len(cards)} cards were not first written by the team.")
        if tid == "craft.idea_route.named":
            n = _words(r.get("name"))
            return _res(1 <= n <= 6, f"The route's name is {n} words.")
        if tid == "craft.idea_route.bet_short":
            n = _words(r.get("bet"))
            return _res(0 < n <= 35, f"The bet is {n} words.")
    if kind == "visual_brief":
        t = c.get("territory") or {}
        if tid == "craft.visual_brief.has_territory":
            return _res(bool(t.get("name") and t.get("line")), "The territory has a name and a line." if t.get("name") and t.get("line") else "The territory lacks a name or a line.")
        for key, tid_ in (("must_show", "must_show"), ("never_show", "never_show"), ("tone", "tone")):
            if tid == f"craft.visual_brief.{tid_}":
                n = len([x for x in c.get(key, []) if str(x).strip()])
                return _res(n > 0, f"{n} {key.replace('_', '-')} lines are written.")
        if tid == "craft.visual_brief.frame":
            n = len(c.get("reference_frames", {}))
            return _res(n > 0, f"{n} reference frames are attached.")
    raise TaskError(500, "internal", f"no code check for {tid}")


# -- backends --------------------------------------------------------------------------------------

def backend_name() -> str:
    b = (os.environ.get("NAPKIN_JUDGE_BACKEND") or "").strip().lower()
    if b not in BACKENDS:
        raise TaskError(503, "not_configured", "Judge is not set up: NAPKIN_JUDGE_BACKEND names no backend "
                                              "(fixture or llm-judge).")
    return b


def price_eur(backend: str) -> float:
    if backend == "fixture":
        return 0.0
    try:
        return float(os.environ.get("NAPKIN_JUDGE_PRICE_EUR") or DEFAULT_PRICE_EUR)
    except ValueError:
        return DEFAULT_PRICE_EUR


def quote(backend: str) -> dict:
    return {"price_eur": price_eur(backend), "backend": backend, "tests": 30}


def _fixture_file() -> dict:
    path = Path(os.environ.get("NAPKIN_JUDGE_FIXTURE") or DEFAULT_FIXTURE)
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        raise TaskError(503, "not_configured", "Judge's fixture file cannot be read (NAPKIN_JUDGE_FIXTURE).") from None


def fixture_answers(kind: str, pending: list[dict]) -> dict:
    f = _fixture_file()
    fails = set((f.get("kinds", {}).get(kind) or f.get("default") or {}).get("fail", []))
    ev = f.get("evidence", {})
    return {t["id"]: {"value": "fail" if t["id"] in fails else "pass",
                      "evidence": clip(ev.get(t["id"]) or f"Fixture answer for {t['id']}.", EVIDENCE_MAX)} for t in pending}


SYSTEM = ("You are Judge, a strict creative reviewer. You answer yes or no tests about ONE piece of work against "
          "an approved brief. For each test give value pass or fail and ONE line of evidence that quotes the work or "
          "names the brief point it was tested against. Be strict: a reading of the evidence is not the evidence. "
          "Never give a score or a number. Test each independently.")


def _schema(ids: list[str]) -> dict:
    one = {"type": "object", "additionalProperties": False, "required": ["value", "evidence"],
           "properties": {"value": {"type": "string", "enum": ["pass", "fail"]}, "evidence": {"type": "string"}}}
    return {"type": "object", "additionalProperties": False, "required": list(ids), "properties": {i: one for i in ids}}


def prompt_hash(kind: str) -> str:
    pending = [(t["id"], t["question"], t["pass_when"]) for t in rubric.tests_for(kind) if t["method"] == "llm"]
    return hashlib.sha256(json.dumps([SYSTEM, pending, rubric.version()]).encode()).hexdigest()[:8]


def _model_port(caps):
    return getattr(caps.model, "_port", None)


def check_route(caps) -> str:
    """The judge's route must be EU-pinned; the model alias it resolves to. A refusal is `not_eu`."""
    port = _model_port(caps)
    if port is None:
        raise TaskError(503, "not_configured", "Judge's model is not configured.")
    routes = port.routes
    pinned = routes.pin == "eu" or (os.environ.get("NAPKIN_MODEL_PIN") or "").strip().lower() == "eu" \
        or not spend.is_local(spend.environment())
    alias = None
    for p in PURPOSES.values():
        r = routes.resolve(p)
        alias = alias or r.alias or r.model
        if pinned and (r.model.startswith("global.") or routes.api not in ("bedrock",)
                       or not r.model.startswith("eu.")):
            raise TaskError(403, "not_eu", "Judge's model route is not EU-pinned, so client work is not sent to it.")
    return alias


def llm_answers(caps, work: dict, brief: dict, pending: list[dict]) -> dict:
    from ..model import ModelError
    out = {}
    for dim, purpose in PURPOSES.items():
        mine = [t for t in pending if t["dim"] == dim]
        if not mine:
            continue
        payload = {"work": work, "tests": [{"id": t["id"], "question": t["question"], "pass_when": t["pass_when"],
                                            "brief": {k: brief[k] for k in t["brief_fields"] if k in brief}} for t in mine]}
        try:
            got = caps.model.structured(purpose, SYSTEM, payload, _schema([t["id"] for t in mine]), private=True)
        except ModelError as e:
            if e.kind == "invalid_output":      # the port's schema check failed: a test missing, doubled or unknown
                raise TaskError(502, "judge_malformed", "Judge's answer did not hold exactly the rubric's tests.") from None
            raise TaskError(502, "provider_error", "Judge's model did not answer.") from None
        out.update(_clean(got, [t["id"] for t in mine]))
    return out


def _clean(got, ids: list[str]) -> dict:
    if not isinstance(got, dict) or set(got) != set(ids):
        raise TaskError(502, "judge_malformed", "Judge's answer did not hold exactly the rubric's tests.")
    out = {}
    for i in ids:
        a = got[i]
        ev = clip(a.get("evidence", ""), EVIDENCE_MAX) if isinstance(a, dict) else ""
        if not isinstance(a, dict) or a.get("value") not in ("pass", "fail") or not ev:
            raise TaskError(502, "judge_malformed", "Judge's answer for a test was not pass or fail with evidence.")
        out[i] = {"value": a["value"], "evidence": ev}
    return out


def merge(kind: str, code: dict, other: dict) -> list[dict]:
    """Exactly the rubric's tests for the kind, in rubric order: a missing, doubled or unknown id is an error."""
    ids = [t["id"] for t in rubric.tests_for(kind)]
    both = {**other, **code}
    if set(both) != set(ids):
        raise TaskError(502, "judge_malformed", "Judge's answer did not hold exactly the rubric's tests.")
    return [{"id": i, "value": both[i]["value"], "evidence": both[i]["evidence"]} for i in ids]


def run(req, caps) -> tuple[dict, None, list]:
    backend = backend_name()                       # unset is an error; it never falls through
    if (req.inp or {}).get("quote") is True:
        return {"quote": quote(backend)}, None, []
    given = assemble_input(req.inp)
    kind, content = given["work"]["kind"], given["work"]["content"]
    tests = rubric.tests_for(kind)
    pending = [t for t in tests if t["method"] == "llm"]
    code = {t["id"]: code_answer(t["id"], kind, content) for t in tests if t["method"] == "code"}
    model, phash = None, None
    if backend == "fixture":
        other = fixture_answers(kind, pending)
    else:
        if not client_ai.written_yes_recorded(caps.scope, None):
            raise TaskError(403, "ai_off", "AI is off for this client: no written yes is recorded.")
        model = check_route(caps)
        price = price_eur(backend)
        v = spend.allow(price, spend.environment(), req.doc)
        if not v:
            raise TaskError(429, "spend_refused", sentence(v.reason))
        other = llm_answers(caps, given["work"], given["brief"], pending)
        phash = prompt_hash(kind)
    result = {"tests": merge(kind, code, other), "backend": backend, "model": model, "rubric_version": rubric.version(),
              "prompt_hash": phash, "price_eur": price_eur(backend)}
    log.info("judge_work kind=%s backend=%s tests=%d fails=%d", kind, backend, len(result["tests"]),
             sum(t["value"] == "fail" for t in result["tests"]))
    return result, None, []
