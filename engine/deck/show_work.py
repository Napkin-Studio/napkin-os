"""Show the work (spec.SHOW_WORK): the presented story in agency order, so the idea and the work reach the first ten slides.

Round 3 of the blind judging (three client briefs, six decks, two passes) found the decks "stop before the work": stage d wrote 4-6
executions per deck, yet none reached slides 1-10 of a full deck, and a sketch deck trimmed them first. Agencies present in a fixed order:
the brief read back briefly, the objective, the insight, a single-minded proposition, the routes considered with the one recommended, the
idea, then the work in the channels, then the ask. Everything else (competition, audience detail, measurement, risks, team, investment) is
backup unless the deck type needs it in front.

This module picks that story (``agency_story``) for the agency pitch and the creative work session, builds the one routes slide
(``routes_slide``), gives the proposition slide stage b's own line (``proposition_title``) and adds the checks validate runs
(``findings``). It never rewords a slide; a slide it does not present goes behind the Appendix divider in the built order.
"""
from __future__ import annotations

import re

#: Where each presented slide sits in the agency order (lower first). A type not here is never presented by agency_story; executions
#: keep their own order (the hero first), territories theirs.
RANK = {"title": 0, "brief_gaps": 1, "objective": 2, "real_question": 2.5, "chart": 2.7, "insight": 3, "audience": 3.5, "proposition": 4,
        "territory_choice": 5, "territory": 5.5, "idea": 6, "execution": 7, "concept": 8, "questions": 8.5, "next_step": 9, "ask": 9,
        "close": 9}
#: At least this many executions are presented after the idea, whatever the length (the keep set).
MIN_EXECUTIONS = 2
#: The words for a count of routes in the routes slide's title.
_COUNT = {2: "Two", 3: "Three", 4: "Four", 5: "Five"}


def present_mode(profile: dict | None) -> str | None:
    """Which agency order a deck type's story takes, read from its recipe, never its id: ``pitch`` for a type whose spine holds the idea
    and the work and keeps the routes in the appendix (an agency pitch), ``tissue`` for one that presents the routes (a work session), None
    for a type that keeps its own spine (a buyer's order or written answers, as in a tender; no idea, as in a credentials deck)."""
    if not profile:
        return "pitch"
    spine, appx = profile.get("spine") or [], set(profile.get("appendix") or [])
    if "idea" not in spine or "execution" not in spine or "criterion_answer" in spine or profile.get("buyer_order"):
        return None
    return "pitch" if "territory" in appx else "tissue"


def role(x: dict) -> str:
    """A slide's place in the agency order: the brief-gaps slide is its own role (its type is ``questions``)."""
    return "brief_gaps" if x.get("role") == "brief_gaps" else x["type"]


def keep_set(S: list, shown: list, routes: int = 1) -> set:
    """The slides no length cut may move (by identity): the idea, the first MIN_EXECUTIONS presented executions and the routes the
    client asked to see. A trim cuts setup slides before any of these."""
    keep = {id(x) for x in S if x["type"] == "idea"}
    keep |= {id(x) for x in shown[:MIN_EXECUTIONS]}
    if routes > 1:
        keep |= {id(x) for x in [x for x in S if x["type"] == "territory"][:routes]}
    return keep


#: SHOW_WORK's trim order: setup and plan slides leave first, the work last (the keep set never leaves).
TRIM_ORDER = ("process", "guardrails", "timeline", "innovation", "channel_roles", "upside", "gtm", "product", "credentials", "team",
              "investment", "measurement_plan", "measurement", "risks", "competition", "chart", "brief_restated", "scoring", "audience",
              "real_question", "territory", "questions", "territory_choice", "execution", "objective")


def _compact_gaps(x: dict, most: int = 3) -> None:
    """The brief-gaps slide, compact: its first ``most`` questions; the rest go to its notes (the appendix list asks every one)."""
    for b in x.get("blocks") or []:
        items = b.get("items")
        if b.get("kind") == "bullets" and isinstance(items, list) and len(items) > most:
            rest = [str(i.get("text") if isinstance(i, dict) else i) for i in items[most:]]
            b["items"] = items[:most]
            x["notes"] = "\n\n".join([n for n in [x.get("notes") or ""] if n.strip()] + ["Also asked (in the appendix list):\n" + "\n".join(f"- {r}" for r in rest)])


def agency_story(S: list, shown: list, size: int, routes: int = 1, mode: str = "pitch") -> tuple:
    """The presented story in agency order and the backup in built order: ``(story, backup)``.

    Always presented: the cover, the insight, the proposition, the idea, at least MIN_EXECUTIONS executions (``shown``, the hero first)
    and the ask, plus the routes the client asked to see (``routes``; every route in a creative work session, ``mode='tissue'``). Then,
    while the story is under ``size``: the objective, the routes slide, the brief gaps (compact), the next presented execution, the
    concept page, the client's questions (a work session), then the real question, the audience and the first chart to fill. Nothing
    else is presented: competition, measurement, risks, team and investment wait in the backup."""
    first = lambda t: next((x for x in S if role(x) == t), None)   # noqa: E731
    pick: list = []
    add = lambda x: pick.append(x) if x is not None and all(x is not y for y in pick) else None   # noqa: E731
    terr = [x for x in S if x["type"] == "territory"]
    asked = terr[:routes] if routes > 1 and mode != "tissue" else []
    ask = next((x for x in reversed(S) if x["type"] in ("next_step", "ask", "close")), None)
    for x in [first("title"), first("insight"), first("proposition"), first("idea"), *shown[:MIN_EXECUTIONS], ask, *asked]:
        add(x)
    if mode == "tissue":   # a work session: the routes slide always; every route's own slide when all of them fit, else none (the routes slide holds them)
        add(first("territory_choice"))
        if len(pick) + len(terr) <= size:
            for x in terr:
                add(x)
    client_qs = next((x for x in S if x["type"] == "questions" and x.get("role") not in ("brief_gaps", "client_asks")), None) if mode == "tissue" else None
    optional = [first("objective"), first("territory_choice"), first("brief_gaps"), *shown[MIN_EXECUTIONS:], first("concept"), client_qs,
                first("real_question"), first("audience"), first("chart")]
    for x in optional:
        if x is not None and len(pick) < size:
            add(x)
    gaps = first("brief_gaps")
    if gaps is not None and any(gaps is y for y in pick):
        _compact_gaps(gaps)
    at = {id(x): i for i, x in enumerate(S)}
    story = sorted(pick, key=lambda x: (RANK.get(role(x), 8), at.get(id(x), 0)))
    backup = [x for x in S if all(x is not y for y in story)]
    backup.sort(key=lambda x: x["type"] != "concept")   # the concept on a page, when it did not fit: first in the appendix (stable otherwise)
    return story, backup


def routes_slide(c: dict, slide) -> dict | None:
    """'Three routes, one recommendation': every territory stage c wrote on one slide, its one-line sketch beside its name, the chosen
    one marked, so the client can react as in a tissue session. The ranking's reasons go to the notes. None with under two routes.
    ``slide`` is assemble._slide."""
    ts = [t for t in (c or {}).get("territories") or [] if t.get("name")]
    if len(ts) < 2:
        return None
    chosen = next((t for t in ts if t.get("id") == c.get("chosen")), ts[0])
    rk = c.get("ranking") or {}
    order = [t for i in rk.get("order") or [] for t in ts if t.get("id") == i] + [t for t in ts if t.get("id") not in (rk.get("order") or [])]
    order = [chosen] + [t for t in order if t is not chosen]
    rows = [["Route", "In one line"]] + [[t["name"] + (" (our recommendation)" if t is chosen else ""), str(t.get("sketch") or t.get("thought") or "")]
                                         for t in order]
    reasons = rk.get("reasons") or {}
    notes = "\n".join(f"- {t['name']}: {reasons.get(t.get('id'), '')}".rstrip(": ") for t in order)
    title = f"{_COUNT.get(len(ts), str(len(ts)))} routes, one recommendation"
    sl = slide("territory_choice", title,
               [{"kind": "table", "rows": rows, "basis": "creative"},
                {"kind": "text", "text": f"We recommend '{chosen['name']}'. Which route feels closest to you, and why?", "basis": "proposal"},
                {"kind": "small", "text": f"Chosen by: {c.get('chosen_by', 'to confirm')}. Ranked by: {rk.get('by', 'to confirm')}.", "basis": "meta", "internal": True}],
               claims=[{"text": "Recommendation", "refs": [], "basis": "opinion"}], status="drafted",
               notes="Why each route (the ranking):\n" + notes)
    sl["role"] = "routes"
    return sl


def _norm(s: str) -> str:
    return re.sub(r"\W+", " ", str(s or "").lower()).strip()


def proposition_title(b: dict, brief_smp: str) -> tuple:
    """The proposition slide's title and where it came from: ``(title, source)``. ``proposition.line`` when it holds one: a person's edit at
    Gate 2 (written there by the handoffs branch; ``source`` 'person' when the edit names a human:<id>) or stage b's own (``source``
    'stage_b'); otherwise the brief's key message or stage b's 'to' line, verbatim,
    with ``source`` 'missing' (validate's proposition_line then fails the deck). Never a fallback label."""
    pr = (b or {}).get("proposition") if isinstance(b, dict) else None
    pr = pr if isinstance(pr, dict) else {}
    raw = pr.get("line")   # read defensively: a person's Gate 2 edit (the handoffs branch) writes here too, maybe as {text, by}
    if isinstance(raw, dict):
        raw = raw.get("text") or raw.get("line")
    line = " ".join(str(raw).split()) if isinstance(raw, (str, int, float)) and not isinstance(raw, bool) else ""
    if line:
        by = pr.get("edited_by") or pr.get("line_by") or ((pr.get("line") or {}).get("by") if isinstance(pr.get("line"), dict) else None)
        return line, ("person" if str(by or "").startswith("human:") else "stage_b")
    for alt in (brief_smp, ((b or {}).get("from_to") or {}).get("to")):
        if str(alt or "").strip() and str(alt).strip() != "To agree.":
            return str(alt).strip(), "missing"
    return "", "missing"


def findings(deck: dict, presented: list) -> list:
    """The checks for a deck built with SHOW_WORK: ``[(check, level, sid, message)]``.

    - proposition_line (error): stage b wrote no single-minded proposition, so the proposition slide has none of its own.
    - proposition_copied (warn): the proposition is the brief's key message read back.
    - work_in_first_ten (error, agency order types only): the idea and at least MIN_EXECUTIONS executions are not all in the first ten
      presented slides."""
    out = []
    sl = deck["slides"]
    for sid in deck["order"]:
        x = sl[sid]
        if x["type"] == "proposition" and x.get("proposition_source") == "missing":
            out.append(("proposition_line", "error", sid, "stage b wrote no single-minded proposition (proposition.line): run stage b again"))
        elif x["type"] == "proposition" and x.get("brief_smp") and _norm(x["title"]) == _norm(x["brief_smp"]):
            out.append(("proposition_copied", "warn", sid, "the proposition is the brief's key message read back: write the sharper thought"))
    if ((deck.get("meta") or {}).get("show_work") or {}).get("mode"):   # the deck took the agency order (assemble records it)
        ten = [sl[s]["type"] for s in presented[:10]]
        if any(sl[s]["type"] == "idea" for s in deck["order"]):
            n_exec = sum(1 for s in deck["order"] if sl[s]["type"] == "execution")
            want = min(MIN_EXECUTIONS, n_exec)
            if "idea" not in ten or ten.count("execution") < want:
                out.append(("work_in_first_ten", "error", None, f"the first ten presented slides hold {'the idea' if 'idea' in ten else 'no idea'} and "
                            f"{ten.count('execution')} execution(s); the agency order shows the idea and at least {want}"))
    return out


#: An execution's copy past this many words keeps its opening lines and its sign-off on the slide; the lines between go to the notes, verbatim
#: (the re-rendered decks: a 121-word question-and-answer notice ran off its slide).
COPY_ON_SLIDE = 75


def fit_copy(S: list) -> int:
    """Long copy on an execution slide: the opening lines while they fit COPY_ON_SLIDE words, and the last line (the sign-off), stay on the
    slide; the lines between move to the notes word for word ('The full copy continues'). Nothing is reworded. Returns how many slides moved
    lines."""
    n = 0
    for x in S:
        if x["type"] != "execution":
            continue
        for b in x.get("blocks") or []:
            lines = [str(ln) for ln in b.get("lines") or []] if b.get("kind") == "copy" else []
            if sum(len(ln.split()) for ln in lines) <= COPY_ON_SLIDE or len(lines) < 3:
                continue
            last, keep, used = lines[-1], [], len(lines[-1].split())
            for ln in lines[:-1]:
                if used + len(ln.split()) > COPY_ON_SLIDE and keep:
                    break
                keep.append(ln)
                used += len(ln.split())
            moved = lines[len(keep):-1]
            if not moved:
                continue
            b["lines"] = keep + [last]
            x["notes"] = "\n\n".join([t for t in [x.get("notes") or ""] if t.strip()] + ["The full copy continues (between the lines on the slide):\n" + "\n".join(moved)])
            n += 1
    return n

