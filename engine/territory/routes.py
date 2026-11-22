"""Step 2 of Territories (feature territories-engine-routes): the crew goes out. Five agents, each on its own heading, read the same brief and
the ticked insights IN PARALLEL and each bring back 2-3 routes. Code measures how far each route sits from the brief, finds routes that
are really one idea and directions nobody went, and the Review agent fixes that itself (every fix has Undo).

    from territory import routes
    doc = routes.explore(doc, llm, facts=facts, findings=findings)         # the stage: gates.drive({"explore": routes.stage(llm, ...)})
    doc, refusals = routes.steer(doc, llm, "cr_feel", "further", "Shrey")   # re-runs ONE heading; every instruction is on record
    doc, refusals = routes.undo(doc, "act_1a2b3c4d", "Shrey")               # takes an automatic fix back (no model call)

``llm`` is ``llm(stage, system, user) -> (obj, usage)``; give it ``Spend.wrap(...)`` so every call is capped and never paid twice. A stage is
``route_<direction>`` per heading (so a heading is cached, timed and re-run alone), ``kill`` and ``sort`` (develop's own, reused),
``distance`` and ``spread_repair``. A heading's user message holds nothing that changes between a run and its resume, so a resume (or a
retry after one heading timed out) re-pays nothing that finished.

What the model writes: a route's words and its cites. What the CODE does: drops a route that cites an id not in play (and says why in
``dropped``), keeps the words within the schema's lengths, mints ids, sets ``band`` from the measured ``distance`` (``contract.band_of``),
records a route resting on a finding nobody checked (in its risks, in words), clamps to ``contract.limit``, validates every shape and the
whole result against the contract before it writes, and turns every failure into ``run.error`` in plain words.

The measure. ``distance`` of a route from the brief is rated by ONE small blind call (no author, no heading, a fixed three-band scale) for all
routes together: the owner's open question (embeddings or a model rating) is answered with the rating, v1, because an embedding in the cloud
needs another service; ``distance_of`` is the one place to change. Two routes are close when ``pair_distance`` is under ``CONFIG.threshold``:
the same idea group (develop's sort step) or word overlap (``diversity.jaccard``, the pipeline's own near-duplicate rule). Gaps: a distance band
nobody landed in, and a bearing wider than ``CONFIG.arc`` with no route.

The Review agent fixes at most ``CONFIG.max_pair_fixes`` close pairs and sends at most ``CONFIG.max_gap_agents`` agent into a gap: a close pair is fixed by rewriting ONE route outward (the
original is PARKED, not deleted; Undo parks the new one and brings the original back); a gap is fixed by sending one new crew member there
(Undo removes it). Both are recorded in ``actions``. Everything undone stays undone: a later steer does not re-fix a pair a person took back.

Dev harness: ``python -m territory.routes --doc data.json --facts f.json --findings fi.json [--live] [--baseline]``.
"""
from __future__ import annotations

import copy
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from . import carried, compare, contract, diversity, gates, insights, pipeline
from .llm import prompt


@dataclass(frozen=True)
class Config:
    """Tunables, in one place (LESSONS: thresholds are recorded, not guessed in the middle of code). Tuned on two briefs in the live check."""
    threshold: float = 0.25      # pairs closer than this (0 identical .. 1 apart) are one idea
    overlap_same: float = 0.4    # word overlap that counts as the same idea (the pipeline's own near-duplicate rule)
    arc: float = 140.0           # a bearing gap wider than this, with no route, is a direction nobody explored
    per_heading: int = 3         # routes kept from one heading (the schema holds 4 per trail)
    max_routes: int = 16         # live routes after the crew is back (about 10-16)
    min_keep: int = 10           # the kill check never leaves fewer than this (about 10-16 routes) (it restores the strongest, and says so)
    max_pair_fixes: int = 2      # close pairs rewritten per run
    max_gap_agents: int = 1      # agents sent into a gap per run (its own budget: a gap is not left open because pairs were fixed)


CONFIG = Config()

#: The default crew. Headings are about the brief in general, never one brief; the planner may edit them (crew is a member of the document).
CREW = [
    {"id": "cr_core", "direction": "core", "role": "strategy", "name": "Close to the core", "short": "Core", "angle": 250, "colour": "#8C8577",
     "heading": "Stay on the proposition. Say it as plainly and truly as possible."},
    {"id": "cr_feel", "direction": "feel", "role": "idea", "name": "Towards a feeling", "short": "Feeling", "angle": 185, "colour": "#E07A5F",
     "heading": "Go towards the feeling the brief points at and make that feeling the whole idea."},
    {"id": "cr_opposite", "direction": "opposite", "role": "copy", "name": "The opposite pole", "short": "Opposite", "angle": 5, "colour": "#3D5AFE",
     "heading": "Go the other way from the tone the brief points at. Stay inside its mandatories."},
    {"id": "cr_adjacent", "direction": "adjacent", "role": "research", "name": "Next door", "short": "Next door", "angle": 105, "colour": "#E3A21A",
     "heading": "Look at neighbouring categories and bring back a device this category does not use."},
    {"id": "cr_outside", "direction": "outside", "role": "synthesis", "name": "Far outside", "short": "Outside", "angle": 318, "colour": "#8E5CF0",
     "heading": "Leap out of the category entirely: take the idea from a world that has nothing to do with it, not a variation of the category's own situation. Then come back with something the brief could use."},
]

#: What the Review agent says to a person, by band, and the heading it sends a new agent on.
BAND_WORDS = {"core": "No route stays close to the brief.", "stretch": "No route sits between the brief and the far reaches.",
              "far_out": "No route went far out from the brief."}
BAND_SENT = {"core": "Nothing stayed close to the brief, so an agent was sent to say it plainly.",
             "stretch": "Nothing sat next door to the brief, so an agent was sent there.",
             "far_out": "Nobody had gone far out from the brief, so an agent was sent there."}
BAND_HEADING = {"core": ("Close to the brief", "Close", "Stay on the proposition and say it as plainly and truly as possible. Do not repeat what the others brought back."),
                "stretch": ("Next door to the brief", "Next door", "Take the same job through a different door: another angle, device or tone, but still plainly this brand."),
                "far_out": ("Far out from the brief", "Far out", "Go much further from the brief than the others: leave the category's usual world, format and tone, then come back with something the brief could use.")}
ARC_HEADING = ("Where nobody went", "Unexplored", "Go where none of the others went: choose a direction away from every route they brought back and say it plainly.")

CHECK_WORDS = {"off_brief": "It does not answer the job the brief sets", "say_it_out_loud": "The line is hard to say out loud",
               "generic": "It would read the same for any brand in the category", "thin_tension": "The tension it rests on is thin"}
UNCHECKED = "It rests on a finding nobody has checked yet."
RESTORED = "The first check rated this route weak; it is kept so the crew still brings back enough."
CORE_FIELDS = ("smp", "objectives", "insight", "audience")


class NotReady(RuntimeError):
    """``explore`` was called while the gates do not say Explore may run. The message is a sentence for a person."""


# ---------------------------------------------------------------- words and shapes


def _fit(text, n: int) -> str:
    """Plain text within ``n`` characters: cut at the last sentence end, else the last word. Never a half word, never a mark."""
    t = insights._plain(text)
    if len(t) <= n:
        return t
    cut = t[:n]
    for stop in (". ", "? ", "! "):
        i = cut.rfind(stop)
        if i >= n * 0.5:
            return cut[:i + 1]
    return cut.rsplit(" ", 1)[0].rstrip(",;:- ")


def _angle(a) -> float:
    return float(a) % 360


def _gap_arc(angles: list[float]) -> tuple[float, float]:
    """(width, middle bearing) of the widest arc between occupied bearings."""
    if not angles:
        return 360.0, 0.0
    pts = sorted({_angle(a) for a in angles})
    best = (0.0, 0.0)
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        w = (b - a) % 360 or 360.0
        if w > best[0]:
            best = (w, (a + w / 2) % 360)
    return best


def _marks(marks) -> list[str]:
    """The Confidential parts as plain strings (the brief's ``marks``: [{path, text, kind}], or the strings themselves). Short ones are ignored: a word
    is not a secret, and matching one would withhold half the brief."""
    out = []
    for m in marks or []:
        t = m.get("text") if isinstance(m, dict) else m
        t = " ".join(str(t or "").split())
        if len(t) >= 12:
            out.append(t)
    return out


def _scrub(node, marks: list[str]):
    """Every string of what a model is sent with the marked parts taken out (the marked text never leaves)."""
    if isinstance(node, str):
        for m in marks:
            while m.lower() in " ".join(node.split()).lower():
                node = " ".join(node.split())
                i = node.lower().find(m.lower())
                node = node[:i] + node[i + len(m):]
        return node
    if isinstance(node, list):
        return [_scrub(x, marks) for x in node]
    if isinstance(node, dict):
        return {k: _scrub(v, marks) for k, v in node.items()}
    return node


def _leaks(text: str, marks: list[str]) -> bool:
    flat = " ".join(str(text).split()).lower()
    return any(m.lower() in flat for m in marks)


# ---------------------------------------------------------------- what the crew reads


class Ctx:
    """What every heading reads: the carried input narrowed to what is IN PLAY, the ticked insights, an index of what may be cited."""

    def __init__(self, doc: dict, facts, findings, sources, marks):
        inp = carried.engine_input(doc, facts, findings, sources)
        play = {s["id"] for s in (doc.get("focus") or {}).get("sources") or [] if s.get("in_play")}
        has_play = bool((doc.get("focus") or {}).get("sources"))
        keep = (lambda i: i in play) if has_play else (lambda i: True)
        inp = {**inp, "brief": {k: v for k, v in inp["brief"].items() if keep(f"brief:{k}")},
               "facts": [p for p in inp["facts"] if keep(p["id"])], "findings": [f for f in inp["findings"] if keep(f["id"])]}
        self.inp, self.marks = inp, _marks(marks)
        self.ix = insights._index(inp)
        self.ticked = [i for i in (doc.get("focus") or {}).get("insights") or [] if i.get("ticked")]
        base = insights.payload(inp)
        base["insights"] = [{"id": i["id"], "kind": i["kind"], "text": i["text"], "evidence": i.get("evidence") or []} for i in self.ticked]
        self.payload = _scrub(base, self.marks)
        core = {f"brief:{k}": inp["brief"][k] for k in CORE_FIELDS if inp["brief"].get(k)}
        self.core = _scrub(core or {"insights": [i["text"] for i in self.ticked]}, self.marks)

    def derived(self, cites) -> bool:
        return any(self.ix[c]["derived"] for c in cites if c in self.ix)


class _Calls:
    """Counts the model calls a stage made (``run.calls.model``); a cached answer counts too, the count is of asks, not of charges."""

    def __init__(self, llm):
        self.llm, self.n, self.lock = llm, 0, threading.Lock()

    def __call__(self, stage, system, user):
        with self.lock:
            self.n += 1
        return self.llm(stage, system, user)


def _dump(o) -> str:
    return json.dumps(o, ensure_ascii=False, sort_keys=True)


# ---------------------------------------------------------------- one heading


def start_from(ctx: Ctx, crew: list[dict], member_id: str) -> list[str]:
    """The ticked insights a member begins from: the picks dealt out round the crew (member k takes picks k, k+5, ...), so five agents reading the same
    brief do not all start from the strongest finding and land on one idea. Every member gets at least one. The rest of the picks stay in view as context."""
    ids = [i["id"] for i in ctx.ticked]
    ids_crew = [c["id"] for c in crew]
    k = ids_crew.index(member_id) if member_id in ids_crew else 0
    if not ids:
        return []
    n = len(ids_crew)
    return [ids[k % len(ids)], *[ids[i] for i in range(k + n, len(ids), n)]]


def _heading_user(ctx: Ctx, member: dict, avoid: list[dict], steer: dict | None, start: list[str] | None = None, redo: str | None = None) -> str:
    u = {"heading": {"name": member["name"], "go": member["heading"]}, "avoid": avoid, **ctx.payload}
    if start:
        u["start_from"] = start
    if steer:
        u["steer"] = steer
    if redo:
        u["redo"] = redo
    return _dump(u)


def _avoid(crew: list[dict], me: str, landed: dict | None = None) -> list[dict]:
    """What each OTHER member was sent to do, and (when it is already known: a re-run) what they brought back. In the first, parallel pass
    nothing has landed yet, so the avoid list is each other heading's remit."""
    out = []
    for c in crew:
        if c["id"] == me:
            continue
        row = {"member": c["short"], "sent_to": c["heading"]}
        if landed and landed.get(c["id"]):
            row["brought_back"] = landed[c["id"]]
        out.append(row)
    return out


def shape_route(raw, member: dict, ctx: Ctx, origin: dict, taken: set) -> tuple[dict | None, str]:
    """One raw route -> a route of the contract, or ``(None, why)``. The words are the model's; everything else is code's."""
    if not isinstance(raw, dict):
        return None, "not a route"
    name, thought = _fit(raw.get("name"), 80), _fit(raw.get("thought"), 240)
    if not name or not thought:
        return None, "a route needs a name and a thought"
    cites = [str(c) for c in raw.get("cites") or []]
    by_insight = {i["id"]: i.get("evidence") or [] for i in ctx.ticked}
    cites = list(dict.fromkeys(e for c in cites for e in (by_insight[c] if c in by_insight else [c])))   # a pick named instead of its sources: its sources
    if not cites:
        return None, "a route with no cites is not shown"
    bad = [c for c in cites if c not in ctx.ix]
    if bad:
        return None, "cites an id that is not in play: " + ", ".join(bad)
    why, tension, sketch, risk = _fit(raw.get("why"), 400), _fit(raw.get("tension"), 400), _fit(raw.get("sketch"), 240) or thought, _fit(raw.get("risk"), 300)
    for text in (name, thought, why, tension, sketch, risk):
        if insights._ID_IN_TEXT.search(text):
            return None, "text names an internal id"
        if _leaks(text, ctx.marks):
            return None, "text repeats a part marked Confidential"
    risks = [r for r in (risk, UNCHECKED if ctx.derived(cites) else "") if r]
    rid = contract.mint("territory", f"{member['id']}:{name.lower()}")
    if rid in taken:
        rid = contract.mint("territory", f"{member['id']}:{name.lower()}:{thought.lower()}")
    if rid in taken:
        return None, "duplicate"
    t = {"id": rid, "name": name, "thought": thought, "why": why, "mood": "", "references": [], "risks": risks, "sketch": sketch,
         "tier": "stretch", "band": "stretch", "distance": 0.5, "crew": member["id"], "origin": origin, "state": "found", "status": "live",
         "evidence": cites[:12]}
    if tension:
        t["tension"] = tension
    if contract.lint({"territories": [t]}):
        return None, "text that is not meant for people"
    return t, ""


def run_heading(llm, ctx: Ctx, member: dict, crew: list[dict], *, landed=None, steer=None, origin=None, stage=None, system=None, cancel=None,
                taken=None, start=None) -> dict:
    """One member's trip. Returns ``{member, state, way, turn, routes, dropped, error}``. Never raises: a failure is data (``error`` in words)."""
    out = {"member": member, "state": "back", "way": [], "turn": "", "routes": [], "dropped": [], "error": None}
    if cancel is not None and cancel.is_set():
        return {**out, "state": "stopped", "turn": "Stopped before setting out."}
    stage = stage or f"route_{member['direction']}"
    avoid = _avoid(crew, member["id"], landed)
    origin = origin or {"kind": "crew", "from": [member["id"]]}
    used = set(taken or ())
    obj: dict = {}
    redo = None
    for attempt in range(2):
        try:
            got, _ = llm(stage, system or prompt("route"), _heading_user(ctx, member, avoid, steer, start, redo))
        except BaseException as e:   # noqa: BLE001: a heading's failure must not take the others with it
            if e.__class__.__name__ == "CapReached":
                msg = str(e)
            elif isinstance(e, TimeoutError):
                msg = f"The crew member “{member['name']}” is taking longer than expected."
            else:
                msg = f"The crew member “{member['name']}” stopped before it finished."
            return {**out, "state": "stopped", "error": msg[:400], "cap": e.__class__.__name__ == "CapReached"}
        obj = got if isinstance(got, dict) else {}
        out["dropped"] = []
        for raw in (obj.get("routes") or [])[:CONFIG.per_heading + 2]:
            t, why = shape_route(raw, member, ctx, origin, used)
            if t is None:
                out["dropped"].append({"crew": member["id"], "text": _fit((raw or {}).get("name") if isinstance(raw, dict) else raw, 60), "reason": why})
            elif len(out["routes"]) < CONFIG.per_heading:
                used.add(t["id"])
                out["routes"].append(t)
        if out["routes"] or not out["dropped"]:
            break
        # every route was thrown away (a missing cite, an id in the text): ask ONCE more, naming why; a different message, so it is paid for once
        redo = "Every route you wrote was thrown away: " + "; ".join(sorted({d["reason"] for d in out["dropped"]})) + \
               ". Write them again; every route must carry its own \"cites\" list of ids from the input."
    pu = [p for p in obj.get("picked_up") or [] if isinstance(p, dict) and _fit(p.get("text"), 160)][:4]
    out["way"] = [{"at": round((n + 1) / (len(pu) + 1), 2), "text": _fit(p["text"], 160),
                   **({"cite": p["cite"]} if p.get("cite") in ctx.ix else {})} for n, p in enumerate(pu)]
    out["turn"] = _fit(obj.get("turn"), 400) or ("Came back with " + str(len(out["routes"])) + " route" + ("" if len(out["routes"]) == 1 else "s") + "."
                                                 if out["routes"] else "Found nothing on this heading that held up.")
    return out


# ---------------------------------------------------------------- the checks every route passes: kill, tier and group, distance


def _seed(t: dict, heading: str | None = None) -> dict:
    s = {"id": t["id"], "line": f"{t['name']}: {t['thought']}", "tension": t.get("tension") or t["why"], "mechanism": t["why"] or t["sketch"]}
    return {**s, "heading": heading} if heading else s


def _kill_check(llm, ctx: Ctx, cands: list[dict], min_keep: int, crew: list[dict]) -> tuple[dict, dict]:
    """Develop's own kill gate (``pipeline._kill``) over the candidates, with the crew's wording (``prompts/kill_crew.md``): the same four tests, but
    a route is not killed for going where its heading sent it. Returns ({id: reason} killed, {id} restored)."""
    if not cands:
        return {}, set()
    assumed = {"fields": [{"key": k, "text": v, "tag": "given"} for k, v in ctx.payload["brief"].items()]}
    tensions = [{"id": i["id"], "x_but_y": i["text"]} for i in ctx.payload["insights"]]
    head = {c["id"]: c["heading"] for c in crew}
    _, killed, restored = pipeline._kill(llm, {}, assumed, tensions, [_seed(t, head.get(t["crew"])) for t in cands], min_keep=min_keep,
                                         system=prompt("kill_crew"), keys=("id", "line", "tension", "mechanism", "heading"))
    why = {}
    for k in killed:
        fails = [(n, (v or {}).get("reason")) for n, v in ((k.get("kill_gate") or {}).get("tests") or {}).items() if (v or {}).get("fails")]
        n, r = fails[0] if fails else ("", "")
        words = CHECK_WORDS.get(n, "The first check rated it too weak to carry on")
        why[k["id"]] = _fit(f"{words}. {r}" if r else f"{words}.", 300)
    return why, {r["id"] for r in restored}


def _sort_all(llm, cands: list[dict]) -> dict:
    """Develop's sort step (``pipeline._sort``): tier, and the idea group (routes that are versions of one idea share a label)."""
    if not cands:
        return {}
    return {s["id"]: (s["tier"], s["group"]) for s in pipeline._sort(llm, [_seed(t) for t in cands])}


def distance_of(llm, ctx: Ctx, cands: list[dict]) -> tuple[dict, list]:
    """({id: distance 0..1}, ids rated by word overlap) by ONE blind rating of all routes against the brief's core. A route the model did not rate gets a measure from
    word overlap with the core (never a made-up middle) and is listed in the second value."""
    if not cands:
        return {}, []
    u = {"brief": ctx.core, "routes": [{"id": t["id"], "name": t["name"], "thought": t["thought"], "sketch": t["sketch"]} for t in cands]}
    obj, _ = llm("distance", prompt("distance"), _dump(u))
    got = {}
    for r in (obj or {}).get("routes") or []:
        try:
            d = float(r.get("distance"))
        except (TypeError, ValueError, AttributeError):
            continue
        if r.get("id") and 0 <= d <= 1:
            got[r["id"]] = round(d, 2)
    missing = [t["id"] for t in cands if t["id"] not in got]
    core = " ".join(str(v) for v in ctx.core.values()) if isinstance(ctx.core, dict) else str(ctx.core)
    for t in cands:
        if t["id"] in missing:
            overlap = diversity.jaccard(f"{t['name']} {t['thought']} {t['sketch']}", core)
            got[t["id"]] = round(min(0.95, max(0.1, 1 - min(1.0, overlap / 0.25))), 2)
    return got, missing


def _checks(llm, ctx: Ctx, cands: list[dict], crew: list[dict], context: list[dict] | None = None, min_keep: int = 0, kill: bool = True) -> dict:
    """Kill, sort and distance are independent of each other: three calls at once. ``context`` are routes already on the compass: they join the
    sort call so a new route's group can match an old one (their own tier and group are not changed)."""
    with ThreadPoolExecutor(max_workers=3) as ex:
        fk = ex.submit(_kill_check, llm, ctx, cands, min_keep, crew) if kill else None
        fs = ex.submit(_sort_all, llm, [*(context or []), *cands])
        fd = ex.submit(distance_of, llm, ctx, cands)
        killed, restored = fk.result() if fk else ({}, set())
        sorted_, (dist, unrated) = fs.result(), fd.result()
    return {"killed": killed, "restored": restored, "sort": sorted_, "distance": dist, "unrated": unrated}


def _apply(t: dict, res: dict) -> dict:
    t = dict(t)
    tier, _ = res["sort"].get(t["id"], ("stretch", ""))
    t["tier"] = tier
    t["distance"] = res["distance"][t["id"]]
    t["band"] = contract.band_of(t["distance"])
    if t["id"] in res["killed"]:
        t["status"], t["kill_reason"] = "killed", res["killed"][t["id"]]
    elif t["id"] in res["restored"]:
        t["risks"] = [*t["risks"], RESTORED][:contract.limit("territory", "risks")]
    return t


# ---------------------------------------------------------------- the spread


#: Words that carry no idea: left out before overlap is counted, so two routes are not "close" for sharing "the" and "and".
STOP = frozenset("the and for with that this from into your you our are was were will would could can not but its their they them what when "
                 "how who why all any one out off over about than then there here have has had been being also just more most only some such "
                 "very new way make made get got say says".split())


def _text(t: dict) -> str:
    """What a route says, for word overlap: name, thought and sketch, without the words that carry no idea."""
    return " ".join(w for w in f"{t['name']} {t['thought']} {t['sketch']}".split() if w.lower().strip(".,;:!?\"'") not in STOP)


def pair_distance(a: dict, b: dict, groups: dict) -> float:
    """0 (one idea) .. 1 (apart): the same idea group is 0; otherwise word overlap against the pipeline's own near-duplicate overlap."""
    ga, gb = groups.get(a["id"]), groups.get(b["id"])
    if ga and ga == gb:
        return 0.0
    return round(1 - min(1.0, diversity.jaccard(_text(a), _text(b)) / CONFIG.overlap_same), 2)


def _live(ts: list[dict]) -> list[dict]:
    return [t for t in ts if t["status"] == "live"]


def close_pairs(ts: list[dict], groups: dict) -> list[dict]:
    live = _live(ts)
    pairs = [{"a": a["id"], "b": b["id"], "distance": pair_distance(a, b, groups)} for i, a in enumerate(live) for b in live[i + 1:]]
    return sorted([p for p in pairs if p["distance"] < CONFIG.threshold], key=lambda p: (p["distance"], p["a"], p["b"]))[:contract.limit("spread", "close")]


def gaps_of(ts: list[dict], crew: list[dict]) -> list[dict]:
    """Where nobody went: a distance band with no live route, then a bearing wider than ``CONFIG.arc`` with no route."""
    live = _live(ts)
    by = {c["id"]: c for c in crew}
    angles = [by[c]["angle"] for c in {t["crew"] for t in ts} if c in by]       # a member that came back explored its bearing, even if its routes were killed
    width, mid = _gap_arc(angles)
    out = [{"angle": round(mid, 1), "text": BAND_WORDS[b], "band": b} for b in ("far_out", "core", "stretch") if not any(t["band"] == b for t in live)]
    if width > CONFIG.arc and not out:
        out.append({"angle": round(mid, 1), "text": "Nothing was explored in this direction.", "band": None})
    return out[:contract.limit("spread", "gaps")]


def spread_record(ts: list[dict], crew: list[dict], groups: dict) -> dict:
    gaps = [{"angle": g["angle"], "text": g["text"]} for g in gaps_of(ts, crew)]
    return {"threshold": CONFIG.threshold, "close": close_pairs(ts, groups), "gaps": gaps}


# ---------------------------------------------------------------- the Review agent's fixes


def _undone_pairs(doc: dict) -> set:
    """Pairs (the route that was moved, the route it was too close to) of fixes a person took back: not fixed again."""
    return {frozenset((a["territory_ids"][0], a["territory_ids"][2])) for a in doc.get("actions") or []
            if a.get("kind") == "spread_fix" and a.get("undone") and len(a["territory_ids"]) > 2}


def _mover(a: dict, b: dict, order: dict) -> tuple[dict, dict]:
    """Of a close pair, the route to move: the one with fewer cites, then the one whose heading is later in the crew."""
    key = lambda t: (len(t["evidence"]), -order.get(t["crew"], 0))   # noqa: E731
    return (a, b) if key(a) <= key(b) else (b, a)


def _repair_user(ctx: Ctx, mover: dict, other: dict, member: dict) -> str:
    keep = ("name", "thought", "why", "tension", "sketch")
    return _dump({"route_to_rewrite": {k: mover[k] for k in keep}, "too_close_to": {k: other[k] for k in keep},
                  "heading": {"name": member["name"], "go": member["heading"]}, **ctx.payload})


def _fix_pair(llm, ctx: Ctx, mover: dict, other: dict, crew_by: dict, taken: set) -> dict | None:
    member = crew_by[mover["crew"]]
    try:
        obj, _ = llm("spread_repair", prompt("spread_repair"), _repair_user(ctx, mover, other, member))
    except Exception:   # noqa: BLE001: a fix that cannot be made is not made; the spread says what is still close
        return None
    raw = (obj or {}).get("route") if isinstance(obj, dict) else None
    t, _ = shape_route(raw, member, ctx, {"kind": "further", "from": [mover["id"]]}, taken)
    if t is None or diversity.jaccard(_text(t), _text(other)) > diversity.jaccard(_text(mover), _text(other)):
        return None            # it did not get further from the other route: not an improvement, so not taken
    return t


def _new_member(band: str | None, angle: float, gap_n: int) -> dict:
    name, short, heading = BAND_HEADING[band] if band else ARC_HEADING
    return {"id": contract.mint("crew", f"gap:{band or 'arc'}:{gap_n}"), "direction": "custom", "role": "idea", "name": name, "short": short,
            "heading": heading, "angle": round(_angle(angle), 1), "colour": "#7C6F64"}


def _action(kind: str, text: str, ids: list[str], seed: str) -> dict:
    return {"id": contract.mint("action", seed), "agent": "review", "kind": kind, "text": _fit(text, 300), "at": gates.now(), "territory_ids": ids[:8],
            "undone": False}


def _review(llm, ctx: Ctx, doc: dict, crew: list[dict], ts: list[dict], groups: dict, *, only: set | None = None, allow_gap: bool = True) -> dict:
    """The Review agent's pass: fix close pairs (``only``: just pairs that touch these route ids), then one gap. Returns
    ``{routes, crew, actions, groups, dropped, new_expedition?}``; ``ts`` is what is on the compass now. A fix is made only if it improves the spread."""
    crew_by, order = {c["id"]: c for c in crew}, {c["id"]: n for n, c in enumerate(crew)}
    by = {t["id"]: t for t in ts}
    taken = set(by)
    skip = _undone_pairs(doc)
    pairs = [p for p in close_pairs(ts, groups) if frozenset((p["a"], p["b"])) not in skip and (only is None or p["a"] in only or p["b"] in only)]
    jobs, claimed = [], set()
    for p in pairs:
        if len(jobs) >= CONFIG.max_pair_fixes:
            break
        mover, other = _mover(by[p["a"]], by[p["b"]], order)
        if mover["id"] in claimed or other["id"] in claimed or mover["crew"] not in crew_by:
            continue
        claimed |= {mover["id"], other["id"]}
        jobs.append((mover, other))
    gap_job = None
    gaps = gaps_of(ts, crew) if (allow_gap and CONFIG.max_gap_agents > 0 and len(_live(ts)) < CONFIG.max_routes - 1 and len(crew) < contract.limit("crew")) else []
    if gaps:
        g = gaps[0]
        gap_job = _new_member(g["band"], g["angle"], len([a for a in doc.get("actions") or [] if a.get("kind") == "sent_agent"]) + 1), g
    made = {"fix": [], "agent": None}
    with ThreadPoolExecutor(max_workers=max(1, len(jobs) + 1)) as ex:
        fix_f = [(m, o, ex.submit(_fix_pair, llm, ctx, m, o, crew_by, taken)) for m, o in jobs]
        agent_f = ex.submit(run_heading, llm, ctx, gap_job[0], [*crew, gap_job[0]], landed=_landed(ts), stage="spread_repair", taken=taken) if gap_job else None
        for m, o, f in fix_f:
            t = f.result()
            if t is not None:
                made["fix"].append((m, o, t))
        if agent_f is not None:
            made["agent"] = agent_f.result()
    new_routes = [t for _, _, t in made["fix"]]
    agent = made["agent"]
    if agent and agent["routes"] and not agent["error"]:
        agent["routes"] = agent["routes"][:max(1, CONFIG.max_routes - len(_live(ts)))]
        new_routes += agent["routes"]
    else:
        agent = None
    res = _checks(llm, ctx, new_routes, crew, context=[t for t in _live(ts) if t["id"] not in {m["id"] for m, _, _ in made["fix"]}], kill=False) if new_routes else {"sort": {}, "distance": {}, "killed": {}, "restored": set(), "unrated": []}
    # the sort call that tiers the new routes also saw the live ones, so one label means one idea across old and new
    out = {"routes": list(ts), "crew": list(crew), "actions": [], "groups": {**groups, **{k: v[1] for k, v in res["sort"].items()}},
           "dropped": list(agent["dropped"]) if agent else []}
    for m, o, t in made["fix"]:
        t = _apply(t, res)
        out["routes"] = [dict(x, status="parked") if x["id"] == m["id"] else x for x in out["routes"]] + [t]
        out["actions"].append(_action("spread_fix", f"Two routes sat close together; {m['name']} was moved outward and its first version is parked.",
                                      [m["id"], t["id"], o["id"]], f"fix:{m['id']}:{t['id']}"))
    if agent:
        mem, gap = gap_job[0], gap_job[1]
        rs = [_apply(t, res) for t in agent["routes"]]
        out["routes"] += rs
        out["crew"].append(mem)
        out["new_expedition"] = (mem, agent, rs)
        out["actions"].append(_action("sent_agent", BAND_SENT[gap["band"]] if gap["band"] else "Nobody had explored one direction, so an agent was sent there.",
                                      [r["id"] for r in rs], f"agent:{mem['id']}"))
    return out


def _landed(ts: list[dict]) -> dict:
    out: dict = {}
    for t in _live(ts):
        out.setdefault(t["crew"], []).append({"name": t["name"], "thought": t["thought"]})
    return out


# ---------------------------------------------------------------- assembling and validating


def _expedition(member: dict, hd: dict, rs: list[dict], insight_ids: list[str], steer: list | None = None) -> dict:
    """One trail: what the member picked up, what it said, and the routes it ended in (``_refs``)."""
    e = {"id": "ex_" + member["id"][3:], "crew": member["id"], "state": hd["state"], "insights": insight_ids[:contract.limit("expedition", "insights")],
         "way": hd["way"][:contract.limit("expedition", "way")], "turn": hd["turn"],
         "routes": [{"territory_id": t["id"], "distance": t["distance"]} for t in rs][:contract.limit("expedition", "routes")]}
    if steer:
        e["steer"] = steer
    return e


def _problems(doc: dict, members: dict, facts, findings) -> list:
    """What the host would refuse in what this stage wrote: every shape, then the cites and text rules of ``contract.check`` on the whole result."""
    ps = []
    for kind, key in (("crew_member", "crew"), ("expedition", "expeditions"), ("territory", "territories"), ("action", "actions")):
        ps += contract.validate_all(kind, members[key])
    ps += contract.validate_shape("spread", members["spread"])
    if ps:
        return ps
    base = contract.example()
    cand = {**base, "upstream": doc.get("upstream") or {}, "finds": doc.get("finds") or [], "focus": doc["focus"], **members}
    cand["territories"] = [{k: v for k, v in t.items() if k not in ("world", "checks", "marks", "pictures", "blind", "rank")} for t in members["territories"]]
    cand["territories"] = [dict(t, state="found") if t.get("state") == "developed" else t for t in cand["territories"]]
    cand["greenlit"], cand["sends"] = [], []
    own = ("territories", "expeditions", "crew", "spread", "actions")
    return [p for p in contract.check(cand, facts=facts or [], findings=findings or []) if str(p.path).split("[")[0].split(".")[0] in own]


def _fail(doc: dict, members: dict, message: str, refused: list | None = None, retryable: bool = True) -> dict:
    d = {**copy.deepcopy(doc), **copy.deepcopy(members)}
    d.setdefault("run", {"state": "building"})
    d = gates._fail(d, "explore", message, retryable)
    if refused:
        d["run"]["error"]["refused"] = [r[:300] for r in refused][:contract.limit("run", "error", "refused")]
    return d


def _members(doc: dict, crew, expeditions, territories, actions, spread) -> dict:
    keep = [a for a in doc.get("actions") or [] if a.get("kind") not in ("spread_fix", "sent_agent")]
    return {"crew": crew, "expeditions": expeditions, "territories": territories, "actions": [*keep, *actions], "spread": spread}


def _finish(doc: dict, members: dict, calls: int) -> dict:
    d = copy.deepcopy(doc)
    d.update(copy.deepcopy(members))
    d.setdefault("run", {"state": "building"})
    c = d["run"].setdefault("calls", {"model": 0, "lookups": 0})
    c["model"] = int(c.get("model") or 0) + calls
    return d


# ---------------------------------------------------------------- the stage


def ready(doc: dict, *, findings=None) -> tuple[bool, str]:
    """Whether the gates let Explore run now (``gates.next_step``), and if not, why in words. The pick approval is pressing Explore."""
    n = gates.next_step(doc, findings=findings)
    return (n["do"] == "run" and n["stage"] == "explore"), n["words"]


def explore_ex(doc: dict, llm, *, facts=None, findings=None, sources=None, marks=None, cancel=None, on_progress=None, force: bool = False) -> tuple[dict, dict]:
    """The crew goes out. ``doc`` must be at the point ``gates.next_step`` says Explore runs (``force`` for a dev harness). Returns
    ``(doc, info)``: the document with ``crew``, ``expeditions``, ``territories`` (the routes), ``spread`` and ``actions`` written, or the same
    document with ``run.error`` in words when it could not finish (what finished is kept in the spend record, so a retry re-pays nothing that
    finished). ``info`` is for the log and the live check: ``dropped`` (routes refused, with why), ``unrated``, ``groups``, ``calls``."""
    ok, why = ready(doc, findings=findings)
    if not (ok or force):
        raise NotReady(why)
    info: dict = {"dropped": [], "unrated": [], "groups": {}, "calls": 0}
    ctx = Ctx(doc, facts, findings, sources, marks)
    counted = _Calls(llm)
    if not ctx.ticked:
        return _fail(doc, {}, "Nothing is picked yet, so the crew has nothing to explore. Tick an insight and try again."), info
    crew = [dict(c) for c in (doc.get("crew") or CREW)]
    ps = contract.validate_all("crew_member", crew)
    if ps:
        return _fail(doc, {}, contract.refusal_error(ps, "explore")["message"], [p.words for p in ps]), info
    insight_ids = [i["id"] for i in ctx.ticked]
    starts = {m["id"]: start_from(ctx, crew, m["id"]) for m in crew}
    results: dict[str, dict] = {}
    lock = threading.Lock()

    def go(m):
        r = run_heading(counted, ctx, m, crew, cancel=cancel, start=starts[m["id"]])
        with lock:
            results[m["id"]] = r
            if on_progress:
                on_progress({"crew": m["id"], "state": r["state"], "routes": len(r["routes"])})
        return r

    with ThreadPoolExecutor(max_workers=len(crew)) as ex:
        list(ex.map(go, crew))
    info["dropped"] = [d for m in crew for d in results[m["id"]]["dropped"]]
    failed = [results[m["id"]] for m in crew if results[m["id"]]["error"]]
    cands = []
    for m in crew:
        cands += [t for t in results[m["id"]]["routes"] if t["id"] not in {c["id"] for c in cands}]
    if failed:
        msg = failed[0]["error"] if failed[0].get("cap") else (
            "The crew did not all come back: " + "; ".join(f["error"].rstrip(".") for f in failed)[:300] +
            ". What came back is kept; try again and only the unfinished trails are paid for again.")
        return _fail(doc, {}, msg), info
    if not cands:
        stopped = cancel is not None and cancel.is_set()
        return _fail(doc, {}, "The run was stopped before any route came back." if stopped else
                     "The crew came back with nothing that rests on what was carried, so no routes were made. Try again.", retryable=True), info
    try:
        res = _checks(counted, ctx, cands, crew, min_keep=CONFIG.min_keep)
        tcs = [_apply(t, res) for t in cands]
        groups = {k: v[1] for k, v in res["sort"].items()}
        rev = _review(counted, ctx, doc, crew, tcs, groups)
    except Exception as e:   # noqa: BLE001
        msg = str(e) if e.__class__.__name__ == "CapReached" else "The checks on the routes stopped before they finished. What the crew brought back is kept; try again."
        return _fail(doc, {}, msg), info
    tcs, crew2, groups = rev["routes"], rev["crew"], rev["groups"]
    live = _live(tcs)
    if len(live) > CONFIG.max_routes:        # never above the plan: the least-cited extras are parked, not deleted
        gone = {t["id"] for t in sorted(live, key=lambda t: (len(t["evidence"]), t["id"]))[:len(live) - CONFIG.max_routes]}
        tcs = [dict(t, status="parked") if t["id"] in gone else t for t in tcs]
    hds = {**results, **({rev["new_expedition"][0]["id"]: rev["new_expedition"][1]} if rev.get("new_expedition") else {})}
    exps = [_expedition(m, hds[m["id"]], _refs(tcs, m["id"]), starts.get(m["id"]) or insight_ids) for m in crew2]
    members = _members(doc, crew2, exps, tcs, rev["actions"], spread_record(tcs, crew2, groups))
    ps = _problems(doc, members, facts, findings)
    if ps:
        return _fail(doc, {}, contract.refusal_error(ps, "explore")["message"], [p.words for p in ps]), info
    out = _finish(doc, members, counted.n)
    out["run"].pop("error", None)
    info.update(dropped=info["dropped"] + rev["dropped"], unrated=res["unrated"], groups=groups, calls=counted.n)
    return out, info


def explore(doc: dict, llm, **kw) -> dict:
    """``explore_ex`` without the info: the stage function for ``gates.drive``."""
    return explore_ex(doc, llm, **kw)[0]


def stage(llm, **kw):
    """The ``explore`` entry for ``gates.drive``: ``drive(doc, {"explore": routes.stage(llm, facts=.., findings=..)})``."""
    return lambda doc: explore(doc, llm, **kw)


def _refs(ts: list[dict], crew_id: str) -> list[dict]:
    """The routes a trail ended in: its live and killed routes, not a parked one."""
    return [t for t in ts if t["crew"] == crew_id and t["status"] != "parked"]


# ---------------------------------------------------------------- steering

MAX_STEER = contract.limit("expedition", "steer")


def _steer_text(kind: str, mine: list[dict], other: dict | None) -> dict:
    prev = [{"name": t["name"], "thought": t["thought"], "distance": t["distance"]} for t in mine]
    if kind == "further":
        return {"kind": "further", "earlier": prev,
                "words": "Go clearly further from the brief than your earlier routes. Bring back different ideas, not the same ones pushed a little."}
    if kind == "pull":
        return {"kind": "pull", "earlier": prev,
                "words": "Come back closer to the brief than your earlier routes. Keep what was good in your heading, but land nearer the proposition."}
    return {"kind": "cross", "earlier": prev, "other": {"member": other["short"], "go": other["heading"]},
            "words": "Cross your own heading with the other member's heading and bring back routes that could only come from both."}


def steer(doc: dict, llm, crew_id: str, kind: str, by: str, *, with_: str | None = None, facts=None, findings=None, sources=None, marks=None,
          at: str | None = None) -> tuple[dict, list[str]]:
    """A person's instruction to ONE crew member: ``further``, ``pull``, ``cross`` (with ``with_``) or ``stop``. Only that heading goes out
    again: every other call is one the run already made (or is not made), so nothing else is paid for. Routes of that heading that are only found
    are replaced; a route with a world is parked, never thrown away. Returns ``(doc, refusals in words)``; never raises. The instruction is on
    record in the trail (``expeditions[].steer``) and, for the decision history, ``steer_decision``."""
    def refuse(*w):
        return doc, list(w)

    who = gates._who(by)
    if not who:
        return refuse("A steer needs a named person: say who is giving it.")
    if kind not in contract.enum("steer_kind"):
        return refuse("That is not something a crew member can be told. Say further, pull back, cross or stop.")
    crew = {c["id"]: c for c in doc.get("crew") or []}
    if crew_id not in crew or not any(e["crew"] == crew_id for e in doc.get("expeditions") or []):
        return refuse("That crew member has no trail in this run to steer.")
    other = crew.get(with_ or "") if kind == "cross" else None
    if kind == "cross" and (other is None or with_ == crew_id):
        return refuse("To cross two crew members, say which other one.")
    entry = {"kind": kind, "by": who, "at": at or gates.now(), **({"with": with_} if kind == "cross" else {})}
    d = copy.deepcopy(doc)
    e = next(x for x in d["expeditions"] if x["crew"] == crew_id)
    e["steer"] = [*(e.get("steer") or []), entry][-MAX_STEER:]
    if kind == "stop":
        e["state"] = "stopped"
        return d, []
    ctx, counted = Ctx(doc, facts, findings, sources, marks), _Calls(llm)
    member, ts = crew[crew_id], d["territories"]
    others_live = [t for t in ts if t["crew"] != crew_id]
    origin = {"kind": kind, "from": [crew_id, with_] if kind == "cross" else [crew_id]}
    start = start_from(ctx, list(crew.values()), crew_id) if member["direction"] != "custom" else None
    hd = run_heading(counted, ctx, member, list(crew.values()), landed=_landed(others_live), origin=origin, taken={t["id"] for t in others_live}, start=start,
                     steer=_steer_text(kind, [t for t in ts if t["crew"] == crew_id and t["status"] == "live"], other))
    if hd["error"]:
        return refuse(hd["error"].rstrip(".") + ". Nothing was changed.")
    if not hd["routes"]:
        return refuse("That trail came back with nothing that rests on what was carried. Nothing was changed.")
    try:
        res = _checks(counted, ctx, hd["routes"], list(crew.values()), context=_live(others_live), min_keep=1)
    except Exception as ex:   # noqa: BLE001
        return refuse((str(ex) if ex.__class__.__name__ == "CapReached" else "The checks on the new routes stopped before they finished.") + " Nothing was changed.")
    new = [_apply(t, res) for t in hd["routes"]]
    mine_now = [dict(t, status="parked") if t.get("state") == "developed" else None for t in ts if t["crew"] == crew_id]
    d["territories"] = [*others_live, *[t for t in mine_now if t], *new]
    groups = {k: v[1] for k, v in res["sort"].items()}
    rev = _review(counted, ctx, d, list(crew.values()), d["territories"], groups, only={n["id"] for n in new}, allow_gap=False)
    d["territories"], groups = rev["routes"], rev["groups"]
    d["actions"] = [*(d.get("actions") or []), *rev["actions"]]
    for x in d["expeditions"]:
        if x["crew"] == crew_id:
            x.update(_expedition(member, {**hd, "state": "back"}, _refs(d["territories"], crew_id), start or [i["id"] for i in ctx.ticked]))
        else:
            x["routes"] = [{"territory_id": t["id"], "distance": t["distance"]} for t in _refs(d["territories"], x["crew"])][:contract.limit("expedition", "routes")]
    d["spread"] = spread_record(d["territories"], list(crew.values()), groups)
    c = d.setdefault("run", {"state": "building"}).setdefault("calls", {"model": 0, "lookups": 0})
    c["model"] = int(c.get("model") or 0) + counted.n
    ps = _problems(d, {k: d[k] for k in ("crew", "expeditions", "territories", "actions", "spread")}, facts, findings)
    if ps:
        return doc, [p.words for p in ps][:contract.limit("run", "error", "refused")]
    return d, []


def steer_decision(crew_id: str, entry: dict) -> dict:
    """The instruction as an entry for the decision history (``clan patch-decision``): who told which crew member what, and when."""
    return {"action": f"steer: {entry['kind']} {crew_id}", "by": entry["by"], "at": entry["at"], "with": entry.get("with")}


# ---------------------------------------------------------------- Undo (no model call)


def undo(doc: dict, action_id: str, by: str) -> tuple[dict, list[str]]:
    """Take one of the Review agent's automatic fixes back. ``spread_fix``: the new route goes and the original comes back. ``sent_agent``: the
    agent, its trail and its routes go. The action stays, marked undone (never deleted), and a later steer will not fix that pair again."""
    who = gates._who(by)
    if not who:
        return doc, ["Taking something back needs a named person: say who is doing it."]
    act = next((a for a in doc.get("actions") or [] if a["id"] == action_id), None)
    if act is None:
        return doc, ["That action is not in this run."]
    if act["undone"]:
        return doc, ["That was already taken back."]
    d = copy.deepcopy(doc)
    terr, ids = {t["id"]: t for t in d["territories"]}, act["territory_ids"]
    if act["kind"] == "spread_fix":
        if len(ids) < 2 or ids[0] not in terr or ids[1] not in terr:
            return doc, ["The routes this fix touched are not there any more, so it cannot be taken back."]
        terr[ids[0]]["status"] = "live"
        d["territories"] = [t for t in d["territories"] if t["id"] != ids[1]]
        for e in d["expeditions"]:
            if e["crew"] == terr[ids[0]]["crew"]:
                e["routes"] = [{"territory_id": t["id"], "distance": t["distance"]} for t in _refs(d["territories"], e["crew"])][:contract.limit("expedition", "routes")]
        d["spread"] = spread_record(d["territories"], d["crew"], {})
    elif act["kind"] == "sent_agent":
        crews = {terr[i]["crew"] for i in ids if i in terr}
        if len(crews) != 1:
            return doc, ["The routes this agent brought back are not there any more, so it cannot be taken back."]
        cid = crews.pop()
        d["crew"] = [c for c in d["crew"] if c["id"] != cid]
        d["expeditions"] = [e for e in d["expeditions"] if e["crew"] != cid]
        d["territories"] = [t for t in d["territories"] if t["crew"] != cid]
        d["spread"] = spread_record(d["territories"], d["crew"], {})
    else:
        return doc, ["That kind of action cannot be taken back here."]
    for a in d["actions"]:
        if a["id"] == action_id:
            a["undone"], a["undone_by"] = True, who
    return d, []


# ---------------------------------------------------------------- the baseline arm, for the blind comparison


def cards(doc: dict, n: int = 3) -> list[dict]:
    """``n`` live routes as cards for ``compare.blind_pack``: one from each heading in crew order first, then the next of each, so the crew is
    shown by its spread and not by one heading. The plain prompt writes three; the pack holds the same number of each."""
    live = _live(doc.get("territories") or [])
    queues = [[t for t in live if t["crew"] == c["id"]] for c in doc.get("crew") or []]
    out = []
    while len(out) < n and any(queues):
        for q in queues:
            if q and len(out) < n:
                out.append(q.pop(0))
    return out


# ---------------------------------------------------------------- dev harness


def pick_doc(upstream_doc: dict, facts, findings, rows: list[dict]) -> dict:
    """A document at the pick gate, approved by ``harness``, from a spun-off one (``upstream``) and the insights made for it: what the middleware
    would hold when the person presses Explore. Dev harness and live checks only."""
    d = copy.deepcopy(contract.example("pick"))
    d.update(upstream=copy.deepcopy(upstream_doc.get("upstream") or {}), finds=[], crew=[], expeditions=[], territories=[], actions=[])
    inp = carried.engine_input(d, facts, findings)
    ids = [f"brief:{k}" for k in inp["brief"]] + [p["id"] for p in inp["facts"]] + [f["id"] for f in inp["findings"]]
    d["focus"] = {"sources": [{"id": i, "in_play": True} for i in ids], "insights": rows}
    d, _ = gates.approve(gates.open_gate(d, "pick", findings=findings), "pick", "harness", findings=findings)
    return d


def main(argv=None) -> int:
    import argparse
    from pathlib import Path
    from .spend import Spend
    ap = argparse.ArgumentParser(prog="territory.routes", description="Dev harness: the crew explores a spun-off or picked document.")
    ap.add_argument("--doc", required=True, help="data.json: a document with ticked insights (Explore runs on it) or a spun-off one (insights are made first)")
    ap.add_argument("--facts"), ap.add_argument("--findings"), ap.add_argument("--category"), ap.add_argument("--market")
    ap.add_argument("--live", action="store_true", help="paid calls through the model backend the environment names")
    ap.add_argument("--baseline", action="store_true", help="also run the plain one-prompt arm (compare.baseline) on the same brief")
    ap.add_argument("--max-usd", type=float, default=1.0)
    ap.add_argument("--out", help="where to write the result and the spend log")
    a = ap.parse_args(argv)
    load = lambda p: json.loads(Path(p).read_text()) if p else None   # noqa: E731
    doc, facts, findings = load(a.doc), load(a.facts), load(a.findings)
    if not a.live:
        import price_table
        from . import cost
        n = len(CREW) + 5
        est = sum(round(price_table.usd(__import__("territory.llm", fromlist=["x"]).STAGE_MODEL[s], 8000, 2500) * cost.CALIBRATION, 3) for s in
                  [f"route_{c['direction']}" for c in CREW] + ["kill", "sort", "distance", "spread_repair", "spread_repair"])
        print(f"Dry run: no model call made. About {n} calls, estimated ${est:.2f}.")
        return 0
    from .llm import LiveLLM
    sp = Spend(cap_usd=a.max_usd, store=Path(a.out).with_suffix(".spend.json") if a.out else None)
    llm = sp.wrap(LiveLLM(approved=True))
    if not [i for i in (doc.get("focus") or {}).get("insights") or [] if i.get("ticked")]:
        made = insights.run(doc, llm, facts=facts, findings=findings, category=a.category, market=a.market)
        if made.get("error") or not made.get("insights"):
            print("insights:", made.get("error") or made.get("words"))
            return 1
        doc = pick_doc(doc, facts, findings, made["insights"])
    elif not doc.get("run"):
        doc = pick_doc(doc, facts, findings, doc["focus"]["insights"])
    out, info = explore_ex(doc, llm, facts=facts, findings=findings, force=True)
    err = out["run"].get("error")
    if err:
        print("ERROR:", err)
    names = {c["id"]: c["short"] for c in out.get("crew", [])}
    for t in out.get("territories", []):
        print(f"[{names.get(t['crew'], t['crew']):<9} {t['band']:<8} {t['distance']:.2f} {t['status']:<6} {t['tier']}] {t['name']}: {t['thought']}  {t['evidence']}"
              + (f"  KILLED: {t['kill_reason']}" if t["status"] == "killed" else ""))
    print("spread:", json.dumps(out.get("spread")))
    for x in out.get("actions", []):
        print("action:", x["kind"], x["text"])
    print("dropped:", json.dumps(info["dropped"]), "unrated:", info["unrated"])
    if a.baseline:
        task = {"fields": carried.engine_input(doc, facts, findings)["brief"], "prompt": "", "category": a.category, "market": a.market}
        base = compare.baseline(task, llm)
        for b in base:
            print(f"[plain] {b.get('name')}: {b.get('thought')}  / {b.get('tension')}")
    if a.out:
        Path(a.out).write_text(json.dumps({"doc": out, "info": info}, indent=1, ensure_ascii=False))
    print(f"calls {len(sp.lines)}, spent ${sp.total():.3f}")
    return 1 if err else 0


if __name__ == "__main__":
    raise SystemExit(main())
