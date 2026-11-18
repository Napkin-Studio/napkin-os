"""build_deck@1 — Deck Maker: one segment of a run, through the deck engine (middleware-api.md §12).

The document's prompt (inputs.prompt), kind, format and picked deck type (inputs.deck_type) go to the engine with the person's approvals (run.approvals, which the app
writes); the engine runs to the next gate, or on to the finished deck once the last gate is approved. With NAPKIN_DECK_ENGINE_URL
unset there is no engine: the task says so, and writes nothing."""

import re

from ..deck import engine as eng
from ..deck.job import DeckJob
from ..doc import ctx_data
from ..util import TaskError, bad

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "build_deck", "build_deck", "1.0", "deck", 1


def _flat(v) -> str:
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return " ".join(_flat(x) for x in v.values())
    if isinstance(v, (list, tuple)):
        return " ".join(_flat(x) for x in v)
    return "" if v is None else str(v)


def _at(data, path):
    cur = data
    for part in re.findall(r"[^.\[\]]+", str(path)):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return None
    return cur


def marks_of(data: dict, chain: list) -> list:
    """The parts a person marked Confidential, with their text, for the engine's picture step (it never sends them to a picture model and holds back
    any prompt that would draw on one): the Deck's own and each upstream brief's ``confidential_fields``, a ``classify`` decision that is
    ``model: false`` or ``corpus: false`` on a path of one of those, and materials whose licence is ``client-confidential``. Always a list:
    an empty one says the document was checked and nothing is marked (the engine refuses pictures when the key is absent)."""
    out, seen = [], set()
    scopes = [("", data)] + [(f"upstream.{k}.", v) for k, v in (data.get("upstream") or {}).items() if isinstance(v, dict)]

    def add(path, text, kind):
        text = _flat(text).strip()
        if text and (path, kind) not in seen:
            seen.add((path, kind))
            out.append({"path": path, "text": text, "kind": kind})
    for prefix, d in scopes:
        for path in d.get("confidential_fields") or []:
            add(prefix + str(path), _at(d, path), "confidential_field")
        mats = d.get("materials")
        for mid, m in (mats.items() if isinstance(mats, dict) else [(x.get("id"), x) for x in mats or [] if isinstance(x, dict)]):
            if isinstance(m, dict) and str(m.get("licence") or "").lower() == "client-confidential":
                add(f"{prefix}materials[{mid}]", f"{m.get('name') or ''} {m.get('text') or ''}", "licence")
    for d in chain or []:
        if not isinstance(d, dict) or d.get("kind") != "classify" or d.get("superseded_by"):
            continue
        lic = d.get("licence") if isinstance(d.get("licence"), dict) else {}
        if lic.get("model", False) and lic.get("corpus", False):
            continue
        for tg in d.get("targets") or []:
            if isinstance(tg, str) and "#" in tg:
                path = tg.split("#", 1)[1]
                for prefix, sc in scopes:
                    v = _at(sc, path)
                    if v is not None:
                        add(prefix + path, v, "classify")
    return out


#: deck-types: the model stages a Change-sheet confirmation may name (inputs.deck_type.confirmed_stages).
MODEL_STAGES = ("a", "b", "c", "d", "i")


def deck_type_of(inputs: dict) -> dict | None:
    """The person's explicit pick on the type picker, as the engine takes it: ``{id, confirmed_stages?}`` from ``inputs.deck_type``; None when
    there is no pick ('Not sure', null or absent). The engine checks the id (an unknown or switched-off type is its 400)."""
    v = inputs.get("deck_type")
    if not isinstance(v, dict) or not isinstance(v.get("id"), str) or not v["id"].strip():
        return None
    out = {"id": v["id"].strip()}
    conf = [s for s in (v.get("confirmed_stages") or []) if s in MODEL_STAGES]
    if conf:
        out["confirmed_stages"] = conf
    return out


def start(req, caps, settings, jid):
    """Validate now (a 400 before any job, a 503 with no engine); build the job (the caller starts it)."""
    data = ctx_data(req.clan)
    inputs = data.get("inputs") if isinstance(data.get("inputs"), dict) else {}
    prompt = inputs.get("prompt") if isinstance(inputs.get("prompt"), dict) else {}
    if not str(prompt.get("text") or "").strip():
        raise bad("give the deck something to build from: inputs.prompt.text is empty")
    port = eng.port_for(settings)
    if port is None:
        raise TaskError(503, "engine_unavailable", "no deck engine is configured for this middleware (NAPKIN_DECK_ENGINE_URL)")
    run = data.get("run") if isinstance(data.get("run"), dict) else {}
    approvals = run.get("approvals") if isinstance(run.get("approvals"), dict) else {}
    body = {"doc": req.doc,
            "inputs": {"prompt": {k: prompt.get(k) or "" for k in ("text", "client", "project", "agency")},
                       "kind": inputs.get("kind") or "agency", "format": inputs.get("format") or "pitch"},
            "approvals": approvals, "render": bool(getattr(settings, "deck_render", True)),
            "marks": marks_of(data, ((req.clan or {}).get("decision_chain") or {}).get("decisions") or [])}
    dt = deck_type_of(inputs)
    if dt:   # deck-types: the person's pick on the type picker (and any new writing they confirmed): the engine builds that type, not the kind's default
        body["inputs"]["deck_type"] = dt
    if inputs.get("text_mode") in ("condense", "preserve"):   # the person's choice: condense lets the repair loop move points to the notes and shorten
        body["inputs"]["text_mode"] = inputs["text_mode"]
    if isinstance(data.get("review"), dict) and data["review"]:   # the person's whole review (pictures and pins): the picture step reads it, the engine takes the pins from it
        body["review"] = data["review"]
        if data["review"].get("pinned"):   # the slides the person pinned: the repair loop leaves them alone
            body["inputs"]["review"] = {"pinned": data["review"]["pinned"]}
    approver = str((((inputs.get("pictures") or {}).get("approval") or {}).get("user")) or "")
    if approver:
        body["approver"] = approver
    return DeckJob(jid, TASK, req.handler, req, caps, port=port, body=body)
