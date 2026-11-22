"""A person's hand in the run at the gates (deck-handoffs): edit, retry and bring-your-own at gates 1-3. No model call here.

The app records each ask as a gate request ``{id, gate, kind: edit|retry|own, by, at, edits?, note?, own?}`` (run.gate_requests); the
middleware forwards the waiting ones and the engine server hands them to ``apply``, which acts on the recorded stage files:

* **edit** changes words in the open gate's stage file (the proposition or insight title at the storyline, a territory's name, thought,
  why, sketch or mood at the territories, the idea line or sentence at the idea). Nothing upstream changes; every stage file downstream
  of the edited one is removed, so only those stages run again, and the gates they hold are re-opened (an approval made before the edit
  no longer counts for them).
* **retry** removes that stage's file (and everything downstream) and queues the person's note for one new call of that stage. Only a
  live run can write a stage again: a replay refuses it, saying so.
* **own** (bring your own) adds the person's own route at the territories gate (it becomes the pick) or pins their own idea at the idea
  gate: stage d is written again around it (live), or the line and sentence are put into the recording (replay), with a notice.

Every change is in the ledger ``<stages>/human_edits.json`` with who, when, the words before and after, and the request it came from.
``reapply`` puts every human edit back over a stage file after the stage ran again, so a model never overwrites a person's words.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

LEDGER = "human_edits.json"
GATE_STAGE = {"storyline": "b", "territories": "c", "idea": "d"}
STAGE_GATE = {v: k for k, v in GATE_STAGE.items()}
STAGE_FILE = {"b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
#: What a stage's run also wrote beside its file (removed with it, so it is written again with it).
COMPANIONS = {"b": ("insight_judge.json",), "c": (), "d": ()}
#: The files after stage d: copy, fit, red team and the repair loop's records (the same list as the server's ``final`` step).
FINAL = ("fit.json", "e_copy.json", "red_team.json", "e_repair_1.json", "e_repair_2.json", "repair_record.json")
ORDER = ("b", "c", "d")
KINDS = ("edit", "retry", "own")
TEXT_MAX = 600
NOTE_MAX = 1000
TERRITORY_FIELDS = ("name", "thought", "why", "sketch", "mood")
#: The words a person may change at each gate: key -> (path into the stage file, label). A territory's key is territory.<id>.<field>.
EDITABLE = {
    "storyline": {"proposition": (("proposition", "line"), "the proposition"), "insight": (("insight", "title"), "the insight"),
                  "reframe": (("reframe", "title"), "the reframe")},
    "idea": {"line": (("campaign_line",), "the idea line"), "idea": (("idea",), "the idea in a sentence"),
             "how_it_answers": (("how_it_answers",), "how it answers the objection")},
}


class EditError(ValueError):
    """A request the engine cannot act on: the message says why, in words a person reads."""


# ------------------------------------------------------------------------------------------------ the ledger

def read_ledger(stages: Path) -> dict:
    p = Path(stages) / LEDGER
    try:
        v = json.loads(p.read_text())
    except (OSError, ValueError):
        v = {}
    v = v if isinstance(v, dict) else {}
    return {"edits": list(v.get("edits") or []), "requests": dict(v.get("requests") or {}), "reopened": dict(v.get("reopened") or {}),
            "notes": dict(v.get("notes") or {})}


def write_ledger(stages: Path, ledger: dict) -> None:
    Path(stages).mkdir(parents=True, exist_ok=True)
    (Path(stages) / LEDGER).write_text(json.dumps(ledger, indent=1, ensure_ascii=False))


def _read(stages: Path, stage: str) -> dict | None:
    try:
        v = json.loads((Path(stages) / STAGE_FILE[stage]).read_text())
    except (OSError, ValueError):
        return None
    return v if isinstance(v, dict) else None


def _write(stages: Path, stage: str, obj: dict) -> None:
    (Path(stages) / STAGE_FILE[stage]).write_text(json.dumps(obj, indent=1, ensure_ascii=False))


# ------------------------------------------------------------------------------------------------ checking a request

def check_request(r) -> dict:
    """One gate request, checked and trimmed to what the engine reads; raises EditError for one it will not take."""
    if not isinstance(r, dict):
        raise EditError("a gate request must be an object")
    rid = str(r.get("id") or "")
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", rid):
        raise EditError("a gate request needs an id (letters, digits, dots, dashes, colons; at most 80)")
    gate, kind = r.get("gate"), r.get("kind")
    if gate not in GATE_STAGE:
        raise EditError(f"gate request {rid}: the gate must be one of {', '.join(GATE_STAGE)}")
    if kind not in KINDS:
        raise EditError(f"gate request {rid}: the kind must be edit, retry or own")
    out = {"id": rid, "gate": gate, "kind": kind, "by": str(r.get("by") or "a person")[:120], "at": str(r.get("at") or "")[:40]}
    if kind == "edit":
        edits = r.get("edits")
        if not isinstance(edits, dict) or not edits:
            raise EditError(f"gate request {rid}: an edit names the words it changes (edits: {{key: text}})")
        clean = {}
        for k, v in edits.items():
            if not isinstance(v, str) or not v.strip():
                raise EditError(f"gate request {rid}: the new words for {k} are empty")
            if len(v) > TEXT_MAX:
                raise EditError(f"gate request {rid}: the new words for {k} are over {TEXT_MAX} characters")
            _key(gate, str(k))   # raises for a key the gate does not offer
            clean[str(k)] = v.strip()
        out["edits"] = clean
    if r.get("note") is not None:
        if not isinstance(r["note"], str) or len(r["note"]) > NOTE_MAX:
            raise EditError(f"gate request {rid}: the note must be text of at most {NOTE_MAX} characters")
        out["note"] = r["note"].strip()
    if kind == "own":
        own = r.get("own")
        if gate not in ("territories", "idea") or not isinstance(own, dict):
            raise EditError(f"gate request {rid}: your own route goes in at the territories gate, your own idea at the idea gate (own: {{...}})")
        need = ("name", "thought") if gate == "territories" else ("line", "idea")
        got = {k: str(own.get(k) or "").strip() for k in ("name", "thought", "why", "sketch", "mood", "line", "idea", "how_it_answers")}
        if not all(got[k] for k in need):
            raise EditError(f"gate request {rid}: your own {'route' if gate == 'territories' else 'idea'} needs {' and '.join(need)}")
        if any(len(v) > TEXT_MAX for v in got.values()):
            raise EditError(f"gate request {rid}: keep each part under {TEXT_MAX} characters")
        out["own"] = {k: v for k, v in got.items() if v}
    return out


def _key(gate: str, key: str) -> tuple:
    """``(stage path, label)`` of an edit key at a gate; a territory key is ``territory.<id>.<field>``. Raises EditError."""
    if gate == "territories":
        m = re.fullmatch(r"territory\.([A-Za-z0-9_-]{1,40})\.(\w+)", key)
        if not m or m.group(2) not in TERRITORY_FIELDS:
            raise EditError(f"at the territories gate you can change a territory's {', '.join(TERRITORY_FIELDS)} (territory.<id>.<field>), not {key!r}")
        return ("territories", m.group(1), m.group(2)), f"territory {m.group(1)}'s {m.group(2)}"
    keys = EDITABLE.get(gate) or {}
    if key not in keys:
        raise EditError(f"at the {gate} gate you can change {', '.join(keys)}, not {key!r}")
    return keys[key]


# ------------------------------------------------------------------------------------------------ reading and writing a path

def _get(obj: dict, path: tuple):
    if path and path[0] == "territories":
        t = next((t for t in obj.get("territories") or [] if isinstance(t, dict) and t.get("id") == path[1]), None)
        return None if t is None else t.get(path[2])
    cur = obj
    for p in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


def _set(obj: dict, path: tuple, value) -> bool:
    if path and path[0] == "territories":
        t = next((t for t in obj.get("territories") or [] if isinstance(t, dict) and t.get("id") == path[1]), None)
        if t is None:
            return False
        t[path[2]] = value
        return True
    cur = obj
    for p in path[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {} if nxt is None else {"text": nxt}
            cur[p] = nxt
        cur = nxt
    cur[path[-1]] = value
    return True


# ------------------------------------------------------------------------------------------------ acting on the requests

def downstream(stage: str) -> list:
    """Every file written after ``stage``: the later stages' files (and their companions) and the final step's."""
    i = ORDER.index(stage)
    out = []
    for s in ORDER[i + 1:]:
        out += [STAGE_FILE[s], *COMPANIONS[s]]
    return out + list(FINAL)


def _drop(stages: Path, names) -> list:
    gone = []
    for n in names:
        p = Path(stages) / n
        if p.exists():
            p.unlink()
            gone.append(n)
    return gone


def _reopen(ledger: dict, gone: list, at: str, also: str | None = None) -> None:
    """The gates whose stage file was removed (``gone``), and ``also``, wait again: an approval given before ``at`` stops counting for them.
    A gate whose stage had not been written yet is not touched: nothing was approved there."""
    stages = {s for s, fn in STAGE_FILE.items() if fn in gone} | ({also} if also else set())
    for s in stages:
        g = STAGE_GATE[s]
        if at and at > str(ledger["reopened"].get(g) or ""):
            ledger["reopened"][g] = at


def apply(stages: Path, requests: list, live: bool) -> dict:
    """Act on the gate requests not handled yet, in order. Returns ``{handled: [ids], notes: {stage: text}, notices: [..]}``: ``notes`` is
    what the next call of each stage reads (a retry's note, the person's own idea, once). A request whose stage has not been written yet
    waits (it is acted on once it has). Each handled request is in the ledger with its status and message."""
    stages = Path(stages)
    ledger = read_ledger(stages)
    out = {"handled": [], "notes": {}, "notices": []}
    for raw in requests or []:
        try:
            r = check_request(raw)
        except EditError as e:
            rid = str((raw or {}).get("id") or "") if isinstance(raw, dict) else ""
            if rid and rid not in ledger["requests"]:
                ledger["requests"][rid] = {"status": "refused", "message": str(e)}
                out["handled"].append(rid)
            continue
        if r["id"] in ledger["requests"]:
            continue
        stage = GATE_STAGE[r["gate"]]
        obj = _read(stages, stage)
        if obj is None:
            continue   # its stage is not written yet: it waits
        try:
            msg = _act(stages, ledger, r, stage, obj, live, out)
            ledger["requests"][r["id"]] = {"status": "done", "gate": r["gate"], "kind": r["kind"], "by": r["by"], "at": r["at"], "message": msg}
        except EditError as e:
            ledger["requests"][r["id"]] = {"status": "refused", "gate": r["gate"], "kind": r["kind"], "by": r["by"], "at": r["at"], "message": str(e)}
            out["notices"].append(str(e))
        out["handled"].append(r["id"])
    ledger["notes"] = {**ledger.get("notes", {}), **out["notes"]}
    write_ledger(stages, ledger)
    return out


def _record(ledger: dict, r: dict, stage: str, key: str, path: tuple, before, after, kind: str = "edit") -> None:
    ledger["edits"] = [e for e in ledger["edits"] if not (e.get("stage") == stage and tuple(e.get("path") or ()) == tuple(path))]
    ledger["edits"].append({"gate": r["gate"], "stage": stage, "key": key, "path": list(path), "before": before, "after": after,
                            "by": r["by"], "at": r["at"], "request": r["id"], "kind": kind})


def _act(stages: Path, ledger: dict, r: dict, stage: str, obj: dict, live: bool, out: dict) -> str:
    kind = r["kind"]
    if kind == "edit":
        for key, text in r["edits"].items():
            path, label = _key(r["gate"], key)
            before = _get(obj, path)
            if not _set(obj, path, text):
                raise EditError(f"there is no territory {path[1]} to change")
            _record(ledger, r, stage, key, path, before, text)
        _write(stages, stage, obj)
        _reopen(ledger, _drop(stages, downstream(stage)), r["at"])
        return f"changed {', '.join(_key(r['gate'], k)[1] for k in r['edits'])}; the steps after it run again"
    if kind == "retry":
        if not live:
            raise EditError("a replay cannot write a stage again: asking the Deck agent to try again needs a live run")
        _reopen(ledger, _drop(stages, [STAGE_FILE[stage], *COMPANIONS[stage], *downstream(stage)]), r["at"], also=stage)
        out["notes"][stage] = _note_text(r["gate"], r.get("note") or "")
        return "the stage is written again once, with your note" if r.get("note") else "the stage is written again once"
    # own
    own = r["own"]
    if r["gate"] == "territories":
        ids = {t.get("id") for t in obj.get("territories") or [] if isinstance(t, dict)}
        n = 1
        while f"t_own_{n}" in ids:
            n += 1
        tid = f"t_own_{n}"
        terr = {"id": tid, "name": own["name"], "thought": own["thought"], "why": own.get("why") or "Brought by the agency's own team.",
                "sketch": own.get("sketch") or own["name"], "mood": own.get("mood") or "", "origin": "human"}
        obj.setdefault("territories", []).append(terr)
        before_pick = obj.get("chosen")
        obj["chosen"], obj["chosen_by"] = tid, f"brought by {r['by']} at gate 2 (their own route)"
        _write(stages, stage, obj)
        _record(ledger, r, stage, f"territory.{tid}", ("territories", tid, "*"), None, terr, kind="own")
        _record(ledger, r, stage, "chosen", ("chosen",), before_pick, tid, kind="own")
        _reopen(ledger, _drop(stages, downstream(stage)), r["at"])
        return f"added your route '{own['name']}' and picked it; the idea is written from it"
    # own idea at gate 3: pinned as human edits; live writes stage d again around it
    for key, field in (("line", "line"), ("idea", "idea"), ("how_it_answers", "how_it_answers")):
        if own.get(field):
            path, _ = _key("idea", key)
            _record(ledger, r, stage, key, path, _get(obj, path), own[field], kind="own")
    if live:
        _reopen(ledger, _drop(stages, [STAGE_FILE[stage], *downstream(stage)]), r["at"], also=stage)
        out["notes"][stage] = own_idea_note(own, r.get("note") or "")
        return "your idea is pinned; the executions are written again around it"
    write_ledger(stages, ledger)   # reapply reads the ledger from disk
    reapply(stages)
    _reopen(ledger, _drop(stages, downstream(stage)), r["at"])
    out["notices"].append("Replay: your idea's line and sentence are in, but the executions are the recording's; a live run writes them around your idea.")
    return "your idea's line and sentence are in (replay: the executions are the recording's)"


def _note_text(gate: str, note: str) -> str:
    base = f"\n\n<person_note gate=\"{gate}\">\n{note}\n</person_note>\nA person at the agency asked for this stage again" + \
           (" with the note above. Follow it wherever it does not break a rule above." if note else ". Write it afresh.")
    return base


def own_idea_note(own: dict, note: str = "") -> str:
    """The person's own idea, as stage d reads it: build on it, keep the line and the sentence exactly."""
    parts = [f"Line: {own['line']}", f"Idea: {own['idea']}"] + ([f"How it answers the objection: {own['how_it_answers']}"] if own.get("how_it_answers") else [])
    return ("\n\n<persons_own_idea>\n" + "\n".join(parts) + "\n</persons_own_idea>\nA person at the agency wrote this idea. Build the "
            "executions, channel roles and everything else on it. Keep the campaign line and the idea sentence exactly as written."
            + (f"\n<person_note>{note}</person_note>" if note else ""))


def take_notes(stages: Path) -> dict:
    """The queued notes ({stage: text}), each read once: they are cleared from the ledger as they are taken."""
    ledger = read_ledger(stages)
    notes = dict(ledger.get("notes") or {})
    if notes:
        ledger["notes"] = {}
        write_ledger(stages, ledger)
    return notes


def reapply(stages: Path) -> list:
    """Put every human edit back over its stage file (after a stage ran again): the person's words always win. Returns the keys put back."""
    ledger = read_ledger(stages)
    back = []
    by_stage: dict = {}
    for e in ledger["edits"]:
        by_stage.setdefault(e.get("stage"), []).append(e)
    for stage, edits in by_stage.items():
        if stage not in STAGE_FILE:
            continue
        obj = _read(stages, stage)
        if obj is None:
            continue
        changed = False
        for e in edits:
            path = tuple(e.get("path") or ())
            if path and path[0] == "territories" and path[2] == "*":
                if not any(isinstance(t, dict) and t.get("id") == path[1] for t in obj.get("territories") or []):
                    obj.setdefault("territories", []).append(dict(e["after"]))
                    changed = True
                    back.append(e["key"])
                continue
            if path and _get(obj, path) != e.get("after"):
                if _set(obj, path, e.get("after")):
                    changed = True
                    back.append(e["key"])
        if changed:
            _write(stages, stage, obj)
    return back


def approval_counts(gate: str, approval: dict | None, reopened: dict) -> bool:
    """An approval goes on only when it is an approve and, for a gate an edit re-opened, it was given after the edit."""
    if not approval or approval.get("decision", "approve") != "approve":
        return False
    since = str((reopened or {}).get(gate) or "")
    return not since or str(approval.get("at") or "") > since


def view(stages: Path) -> dict:
    """``run.human``: every human edit (who, when, what, before and after) and every handled request's status, for the screens."""
    ledger = read_ledger(stages)
    edits = [{k: e.get(k) for k in ("gate", "stage", "key", "before", "after", "by", "at", "request", "kind")} for e in ledger["edits"]]
    reqs = {k: {kk: vv for kk, vv in v.items() if kk in ("status", "message", "gate", "kind")} for k, v in ledger["requests"].items()}
    return {"edits": edits, "requests": reqs} if edits or reqs else {}
