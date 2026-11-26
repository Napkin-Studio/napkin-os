"""The Deck Maker's run, as the app reads it: the engine's stage files turned into the ``run`` object, the three gates'
payloads, and, once a deck is built, the deck, validation, evidence, report and exports.

Pure functions over what ``run_deck`` leaves on disk (the --stages folder and the --out folder). Nothing here runs the
engine, calls a model or holds state: the server (``deck/server.py``) says what is happening (``state``, ``current``,
``held``) and this says what the screens show. The mapping is ported from Sai's local demo harness
(``Run`` in harness.py, 2026-11-04), cut to functions of the files; the shapes are those of
``docs/contracts/deck-maker.md`` and ``app/templates/deck-maker/schema.json``. No time or percentage is ever invented:
a step that runs long is flagged ``slow``, never timed.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import assemble

#: The Build screen's rows: id, name, the line under it while it waits. The ids are the app's own (STAGE_AGENT).
DISPLAY = [
    ("inputs", "Read the inputs", "Brief, research, requirements"),
    ("scans", "Read image-only pages", "Figures pulled from scans"),
    ("storyline", "Storyline", "You approve it"),
    ("territories", "Territories", "Judged blind, you pick"),
    ("idea", "One idea and its work", "Executions, channels"),
    ("copy", "Slide copy", "Every claim gets a source"),
    ("check", "Check", "Numbers, rules, length"),
    ("review", "You review the deck", "Then present or export"),
]
ROW_IDS = [r[0] for r in DISPLAY]

#: The three gates: the engine stage each follows, in order. Review is the screen after the last gate, not a gate.
GATES = (("b", "storyline"), ("c", "territories"), ("d", "idea"))
GATE_N = {"storyline": 1, "territories": 2, "idea": 3}
#: An investor deck's story is one stage (i): its gate is the storyline.
STORY_STAGES = ("b", "i")
GATE_AFTER = {"b": "storyline", "i": "storyline", "c": "territories", "d": "idea"}
GATE_ROW = {"storyline": "storyline", "territories": "territories", "idea": "idea"}

#: The row an engine step belongs to.
STEP_ROW = {"load": "inputs", "a0": "inputs", "a": "inputs", "b": "storyline", "i": "storyline", "insight_judge": "storyline",
            "c": "territories", "d": "idea", "fit": "copy", "e": "copy", "red_team": "copy",
            "validate": "check", "render_pptx": "check", "render_web": "check", "pdf": "check", "png": "check", "qa": "check", "repair": "check"}
#: The agent and what it is doing at each step, and the order the agents are numbered in.
STEP_AGENT = {"load": ("brief", "read"), "a0": ("brief", "read"), "a": ("brief", "read"), "b": ("strategy", "write"),
              "i": ("strategy", "write"), "insight_judge": ("strategy", "check"), "c": ("strategy", "write"), "d": ("idea", "write"),
              "fit": ("copy", "check"), "e": ("copy", "write"), "red_team": ("copy", "check"), "validate": ("review", "check"),
              "render_pptx": ("deck", "work"), "render_web": ("deck", "work"), "pdf": ("deck", "work"), "png": ("deck", "work"),
              "qa": ("review", "check"), "repair": ("review", "work")}
#: The agent each Build row belongs to (STEP_AGENT's, by row): a failure names the agent of the row that failed, never a default (acceptance
#: A45: the idea stage failed and the row read "Brief agent · Writes the brief · Failed, retrying").
ROW_AGENT = {"inputs": "brief", "scans": "brief", "storyline": "strategy", "territories": "strategy", "idea": "idea", "copy": "copy",
             "check": "review", "review": "review"}
STEP_OF = {"brief": 1, "strategy": 2, "idea": 3, "copy": 4, "deck": 5, "review": 6, "approval": 7}
STEP_TOTAL = 7
DONE_SUB = {"inputs": "Read", "scans": "Read", "storyline": "Approved", "territories": "Picked", "idea": "Approved", "copy": "Done", "check": "Done"}
#: Seconds each stage took in the recorded live runs: (min, max). A step running past the max is flagged slow, never timed.
SLOW_AFTER = {"a0": 62.7, "a": 49.5, "b": 136.4, "insight_judge": 12.4, "c": 56.1, "d": 518.5, "fit": 25.7, "e": 463.1, "red_team": 14.7, "i": 123.5}

KIND_WORD = {"prompt": "your prompt", "brief": "brief", "finding": "research finding", "fact": "research", "doc": "document",
             "docfig": "document", "answer": "your answer", "req": "requirement", "calc": "calculation"}
FILES = (("web", "deck.html"), ("pptx", "deck.pptx"), ("pdf", "deck.pdf"))


def read_json(path: Path) -> dict | None:
    """A stage file, or None when it is missing or unreadable."""
    try:
        return json.loads(path.read_text()) if path.exists() else None
    except (OSError, ValueError):
        return None


def stage_file(stages: Path, name: str) -> dict | None:
    return read_json(stages / name)


def file_sha(path: Path) -> str | None:
    """The sha256 of a stage file's bytes (deck-beat-editor: the storyline a person's edit was made against); None when missing."""
    from .storyline_edit import sha_bytes
    try:
        return sha_bytes(path.read_bytes())
    except OSError:
        return None


# ── what the run read ───────────────────────────────────────────────────────────────────────────────────────────────
def inputs_summary(inp, brief_given: bool = False) -> dict:
    """What the run reads, from the engine's loaded Inputs: the rows under 'Read the inputs' and the first checks."""
    from . import intake, refs
    return {
        "prompt_sentences": len(refs.prompt_sentences(inp.prompt_text)), "brief_given": bool(brief_given),
        "brief_filled": sum(1 for f in inp.brief.values() if f.get("value")), "brief_total": len(inp.brief),
        "facts": len(inp.facts), "findings": len(inp.findings), "sources": len(inp.sources),
        "docs": [{"name": d.get("name"), "pages": d.get("pages")} for d in inp.docs.values()],
        "tier": (intake.tier(inp) or {}).get("tier"), "gaps": intake.gap_report(inp),
    }


def _names(rows, key, n):
    return ", ".join(str(g.get(key, "")).replace("_", " ") for g in rows[:n])


def checks_list(summary: dict | None, stages: Path, validation: dict | None = None) -> list[dict]:
    """The 'Checked so far' list: what the inputs gave, what the intake left open, the insight judge, the code checks."""
    out: list[dict] = []
    s = summary or {}
    a0 = stage_file(stages, "a0_intake.json")
    gaps = (a0 or {}).get("gaps") or s.get("gaps") or {}
    if s.get("tier"):
        out.append({"ok": True, "text": f"Built from: {s['tier']}" + ("+production" if s.get("production") else "")})   # a deck spun off a Production project says so
    left = gaps.get("brief_fields") or []
    if a0:
        out.append({"ok": not left, "text": (f"After the intake, {len(left)} brief fields are still empty or only proposed: {_names(left, 'field', 6)}")
                    if left else "After the intake, every brief field is filled"})
    elif left:
        out.append({"ok": False, "text": f"{len(left)} brief fields nothing given supports: {_names(left, 'field', 6)}"})
    thin = gaps.get("slide_types") or []
    if thin:
        out.append({"ok": False, "text": (f"After the intake, {len(thin)}" if a0 else f"{len(thin)}") + f" slide types have no evidence: {_names(thin, 'type', 5)}"})
    b, j = stage_file(stages, "b_storyline.json"), stage_file(stages, "insight_judge.json")
    if b and j and assemble.valid_candidates(b):
        v = assemble.judge_verdicts(j)
        n, p = len(v), sum(1 for x in v.values() if x["pass"])
        out.append({"ok": p > 0, "text": f"Insight judge: {p} of {n} insight candidates passed" + ("" if p else ", so the insight slide needs you")})
    if validation is not None:
        e, w = validation.get("errors", 0), validation.get("warnings", 0)
        out.append({"ok": not e, "text": f"Code checks: {e} error{'s' if e != 1 else ''}, {w} warnings"})
    return out


# ── the gates ───────────────────────────────────────────────────────────────────────────────────────────────────────
def beats(b: dict | None, requirements: list | None = None) -> list[dict]:
    """The storyline's beats for gate 1, from stage b: each titled section, with where its words came from, in the story's order.
    Each carries its section ``key`` (deck-beat-editor: the page edits beats by it; None for a beat the person added), ``words``
    (agents, or yours once the person reworded or added it) and, with ``requirements``, the mandatories it cites (``carries``)."""
    from . import storyline_edit as se
    person = se.person_of(b)
    reworded, mine = set(person.get("reworded") or []), {str(x.get("id")): x for x in person.get("beats") or [] if isinstance(x, dict)}
    rows = {}
    for key in se.section_keys(b):
        v = b[key]
        refs = se.section_refs(v)
        kinds = {r.split(":")[0] if ":" in r else r[:2] for r in refs}
        if not refs:
            basis, src = "proposal", "No source: our proposal"
        else:
            research = any(r.startswith(("f_", "fi_")) for r in refs)
            basis = "research" if research else "brief"
            said = [w for w, hit in (("research", research), ("brief fields", "brief" in kinds), ("your prompt", "prompt" in kinds),
                                     ("requirements", "req" in kinds), ("your documents", "doc" in kinds), ("your answers", "answer" in kinds)) if hit]
            src = "Cites " + ", ".join(said) + f" · {len(set(refs))} ref{'s' if len(set(refs)) != 1 else ''}"
        row = {"key": key, "title": str(v["title"]).strip(), "src": src, "basis": basis, "words": "agents"}
        if key in reworded or v.get("person_words"):
            row.update(words="yours", src="Your words · " + ("evidence kept: " + src.removeprefix("Cites ") if refs else "no source yet"))
        if requirements is not None:
            carries = se.mandatories(v, requirements)
            if carries:
                row["carries"] = carries
        rows[key] = row
    for pid, x in mine.items():
        rows[pid] = {"key": None, "title": se.clean_title(x.get("title")), "src": "Your words · no source yet", "basis": "yours", "words": "yours"}
    order = [k for k in person.get("order") or [] if k in rows] + [k for k in rows if k not in (person.get("order") or [])]
    out = [rows[k] for k in order]
    for i, row in enumerate(out, 1):
        row["n"] = f"{i:02d}"
    return out


def gate_payload(gate: str, stages: Path) -> dict:
    """The open gate: what the person is asked to approve, from the stage files."""
    g: dict = {"id": gate, "n": GATE_N[gate], "of": 3}
    if gate == "storyline":
        g["agent"] = "strategy"
        b = stage_file(stages, "b_storyline.json")
        reqs = (stage_file(stages, "a_requirements.json") or {}).get("requirements") or []
        g["beats"] = beats(b, reqs) if b else beats(stage_file(stages, "i_investor.json"))
        if b:   # deck-beat-editor: the beats can be edited, against this very file (an investor deck's story, stage i, cannot yet)
            g["editable"], g["base"] = True, file_sha(stages / "b_storyline.json")
    elif gate == "territories":
        c = stage_file(stages, "c_territories.json") or {}
        g["agent"] = "strategy"
        g["territories"] = [{"id": t.get("id"), "n": i + 1, "name": t.get("name"), "thought": t.get("thought"), "why": t.get("why")}
                            for i, t in enumerate(c.get("territories") or [])]
        first = ((c.get("ranking") or {}).get("order") or [None])[0]
        if first:
            g["first_pick"] = first
    elif gate == "idea":
        d, c = stage_file(stages, "d_idea.json") or {}, stage_file(stages, "c_territories.json") or {}
        chosen = c.get("chosen")
        tname = next((t.get("name") for t in c.get("territories") or [] if t.get("id") == chosen), None)
        g["agent"] = "idea"
        g["idea"] = {"line": d.get("campaign_line") or d.get("idea") or "", "basis": "proposal", "territory_id": chosen,
                     "executions": [{"n": i + 1, "channel": x.get("channel"), "summary": x.get("role") or ""} for i, x in enumerate(d.get("executions") or [])]}
        if tname:
            g["idea"]["territory_name"] = tname
    return {k: v for k, v in g.items() if v is not None}


# ── the rows' items, from the stage files ───────────────────────────────────────────────────────────────────────────
def _item(text: str, status: str) -> dict:
    return {"text": text, "status": status}


def items_for(row: str, stages: Path, summary: dict | None, current: str | None, validation: dict | None, written: list[str]) -> list[dict]:
    """The content box of the running row: what is done, what is under way, what is still to come."""
    s = summary or {}
    out: list[dict] = []
    if row == "inputs":
        n = s.get("prompt_sentences") or 0
        out.append(_item(f"Your prompt · {n} sentence{'s' if n != 1 else ''}" if n else "Your prompt · none given", "done"))
        if s.get("brief_given"):
            out.append(_item(f"Brief · {s.get('brief_filled', 0)} of {s.get('brief_total', 0)} fields filled", "done"))
        if s.get("facts") or s.get("findings"):
            # A brief carries its research and pins of its own: the deck counts both, the research page only its own (acceptance A36: "87 pins,
            # 31 sources" beside a research page of 45 and 16). The row says so.
            both = " (the research's and the brief's own together)" if s.get("brief_given") else ""
            out.append(_item(f"Research · {s.get('facts', 0)} pins, {s.get('findings', 0)} findings, {s.get('sources', 0)} sources{both}", "done"))
        for d in s.get("docs") or []:
            out.append(_item(f"{d.get('name')} · {d.get('pages') or '?'} pages", "done"))
        a0 = stage_file(stages, "a0_intake.json")
        if a0:
            nf, nq = len(a0.get("fields") or {}), len(a0.get("questions") or [])
            out.append(_item(f"Intake · {nf} brief field{'s' if nf != 1 else ''} filled from what you gave, {nq} questions for you", "done"))
        elif current == "a0":
            out.append(_item("Intake · fills empty brief fields, asks up to five questions", "now"))
        a = stage_file(stages, "a_requirements.json")
        if a:
            reqs = a.get("requirements") or []
            out.append(_item(f"Requirements · {len(reqs)} read", "done"))
            out.extend(_item(f"{r.get('text')} · {r.get('id')}, {r.get('kind')}", "done") for r in reqs[:8])
        elif current == "a":
            out.append(_item("Requirements · what the inputs ask for", "now"))
    elif row == "storyline":
        b = stage_file(stages, "b_storyline.json")
        if b:
            out.extend(_item(x["title"] + " · " + x["src"], "done") for x in beats(b))
            j = stage_file(stages, "insight_judge.json")
            if j and assemble.valid_candidates(b):
                v = assemble.judge_verdicts(j)
                p = sum(1 for x in v.values() if x["pass"])
                t = f"Insight judge · {p} of {len(v)} candidates passed all four tests"
                if b.get("insight_retry"):
                    t += "; the storyline was rewritten once after the first verdict"
                out.append(_item(t, "done"))
            elif current == "insight_judge":
                out.append(_item("Insight judge · testing the insight candidates blind now", "now"))
        else:
            out.append(_item("The storyline · writing now", "now"))
            out.append(_item("Insight judge · tests the insight candidates blind", "pending"))
    elif row == "territories":
        c = stage_file(stages, "c_territories.json")
        if c:
            out.extend(_item(f"{t.get('name')} · {t.get('id')}, written", "done") for t in c.get("territories") or [])
            rk = c.get("ranking") or {}
            first = (rk.get("order") or [None])[0]
            if first:
                name = next((t.get("name") for t in c.get("territories") or [] if t.get("id") == first), first)
                out.append(_item(f"Blind judge · put {name} first ({rk.get('by') or 'a second model'})", "done"))
        else:
            out.append(_item("Three territories, then a blind ranking · writing now", "now"))
    elif row == "idea":
        d = stage_file(stages, "d_idea.json")
        if d:
            if d.get("campaign_line"):
                out.append(_item(f"The idea line · {d['campaign_line']}", "done"))
            if d.get("idea"):
                out.append(_item(f"The idea · {d['idea']}", "done"))
            out.extend(_item(f"{x.get('channel')} · {x.get('role') or ''}", "done") for x in d.get("executions") or [])
        else:
            out.append(_item("The idea line and its executions · writing now", "now"))
    elif row == "copy":
        for key, fn, label in (("fit", "fit.json", "Fit judge"), ("e", "e_copy.json", "Copy"), ("red_team", "red_team.json", "Red team")):
            f = stage_file(stages, fn)
            if f is None:
                out.append(_item({"fit": "Fit judge · does each headline's evidence hold it up", "e": "Copy · tighten long slides, narrow weak headlines",
                                  "red_team": "Red team · a skeptical buyer reads the deck"}[key], "now" if current == key else "pending"))
            elif key == "fit":
                c: dict = {}
                for x in f.get("verdicts") or []:
                    c[x.get("verdict")] = c.get(x.get("verdict"), 0) + 1
                out.append(_item(f"Fit judge · {len(f.get('verdicts') or [])} headlines judged: " + ", ".join(f"{n} {k}" for k, n in c.items()), "done"))
            elif key == "e":
                out.append(_item(f"Copy · {len(f.get('edits') or [])} edits, {len(f.get('narrowed') or [])} narrower headlines offered", "done"))
            else:
                out.append(_item(f"Red team · {len(f.get('objections') or [])} objections", "done"))
    elif row == "check":
        if validation is not None:
            out.append(_item(f"All checks · {validation.get('errors', 0)} errors, {validation.get('warnings', 0)} warnings", "done"))
        else:
            out.append(_item("The engine's code checks · checking the whole deck now", "now"))
        out.extend(_item(f"{w}: written", "done") for w in written)
    return out


# ── the run object ──────────────────────────────────────────────────────────────────────────────────────────────────
def run_object(*, state: str, stages: Path, summary: dict | None = None, current: str | None = None, held: str | None = None,
               cost: float | None = None, error: dict | None = None, validation: dict | None = None, written: list[str] | None = None,
               slow: bool = False, done: dict | None = None) -> dict:
    """The ``run`` the screens read. ``state`` is draft, building, gate, done or failed; ``current`` is the engine step under way
    (a0, a, b, insight_judge, c, d, fit, e, red_team, validate, render_pptx ...); ``held`` the gate that waits for the person.
    The keys the app writes (approvals, decisions, gate_requests) are never here."""
    if state == "draft":
        return {"state": "draft", "stages": [], "gate": None}
    active = ({"gate": GATE_ROW.get(held or ""), "done": "review"}.get(state)) or STEP_ROW.get(current or "load", "inputs")
    if state == "failed":
        active = (error or {}).get("stage") if (error or {}).get("stage") in ROW_IDS else STEP_ROW.get(current or "load", "inputs")
    idx = ROW_IDS.index(active)
    rows = []
    for i, (rid, name, sub) in enumerate(DISPLAY):
        row = {"id": rid, "name": name, "sub": sub, "status": "next"}
        if i < idx:
            row["status"], row["sub"] = "done", DONE_SUB.get(rid, "Done")
        elif i == idx:
            if state == "done":
                row["status"], row["sub"] = "now", "Next"
            elif state == "gate":
                row["status"], row["sub"] = "now", "Needs you · you pick" if held == "territories" else "Needs you · you approve it"
            elif state == "failed":
                row["status"], row["sub"] = "failed", "Stopped"
            else:
                row["status"], row["sub"] = "now", "Writing" if rid in ("storyline", "territories", "idea") else "Reading" if rid == "inputs" else "Checking"
                items = items_for(rid, stages, summary, current, validation, written or [])
                if items:
                    row["items"] = items
        if rid == "scans" and row["status"] in ("done", "now") and not (summary or {}).get("docs"):
            row["sub"] = "No documents attached"
        rows.append(row)
    agent = None
    if state == "building":
        key, act = STEP_AGENT.get(current or "load", ("brief", "read"))
        agent = {"key": key, "activity": act, "step_index": STEP_OF[key], "step_total": STEP_TOTAL}
        if slow:
            agent["slow"] = True
    elif state == "done":
        agent = {"key": "review", "activity": "complete", "step_index": STEP_OF["review"], "step_total": STEP_TOTAL}
    elif state == "failed":
        step = STEP_AGENT.get(current or "")
        key = step[0] if step and STEP_ROW.get(current) == ROW_IDS[idx] else ROW_AGENT.get(ROW_IDS[idx], "deck")   # the agent of the row that failed
        agent = {"key": key, "activity": "error"}
    run = {"state": state, "stage": ROW_IDS[idx], "stages": rows, "gate": gate_payload(held, stages) if state == "gate" and held else None,
           "agent": agent, "checks": checks_list(summary, stages, validation) or None, "error": error if state == "failed" else None,
           "done": done if state == "done" else None, "cost_usd": round(cost, 4) if cost is not None else None}
    # The app's schema takes no null for these (only the gate may be null): a key with nothing to say is left out. The writer that turns
    # this into a change for the host sets a key the run no longer has to null, as a merge patch does.
    return {k: v for k, v in run.items() if v is not None or k == "gate"}


def is_slow(step: str | None, elapsed: float) -> bool:
    """A step that has run longer than any recorded run of it: said as a flag, never as a time."""
    return bool(step in SLOW_AFTER and elapsed > SLOW_AFTER[step])


def spent(stages: Path) -> float:
    """What the stage files in this folder cost: the engine's own figure per stage (usage.usd), or 0 where it gave none."""
    total = 0.0
    for p in stages.glob("*.json"):
        u = (read_json(p) or {}).get("usage") or {}
        try:
            total += float(u.get("usd") or 0)
        except (TypeError, ValueError):
            pass
    return round(total, 4)


# ── a built deck ────────────────────────────────────────────────────────────────────────────────────────────────────
def app_deck(deck: dict) -> dict:
    """deck.json in the app's shape: ``order`` is the presented story (before the Appendix divider), ``appendix_ids`` the slides
    behind it (the divider itself is neither), ``appendix_count`` their number. Slides and meta are the engine's own."""
    order = list(deck.get("order") or [])
    slides = deck.get("slides") or {}
    cut = next((i for i, sid in enumerate(order) if (slides.get(sid) or {}).get("type") == "appendix"), None)
    shown = order if cut is None else order[:cut]
    behind = [] if cut is None else order[cut + 1:]
    out = {k: v for k, v in deck.items() if k != "order"}
    out.update(order=shown, appendix_ids=behind, appendix_count=len(behind))
    return out


def validation_summary(findings: list[dict]) -> dict:
    """The validation the app reads: counts, and the findings by slide."""
    by_slide: dict = {}
    for f in findings:
        if f.get("slide"):
            by_slide.setdefault(f["slide"], []).append({"level": f.get("level"), "message": f.get("message"), "check": f.get("check")})
    return {"errors": sum(f.get("level") == "error" for f in findings), "warnings": sum(f.get("level") == "warn" for f in findings), "findings": by_slide}


def evidence_for(deck: dict, inp) -> dict:
    """What each ref on a slide points at, in words, for the Evidence tab. A ref that resolves to nothing is left out: the app
    says 'not found', never a made-up line."""
    from . import refs
    evidence: dict = {}
    reqs = list((deck.get("requirements") or {}).values()) if isinstance(deck.get("requirements"), dict) else deck.get("requirements") or []
    R = refs.Resolver(inp, reqs)
    for s in (deck.get("slides") or {}).values():
        for b in (s.get("blocks") or []) + (s.get("claims") or []):
            for r in b.get("refs") or []:
                if r in evidence or not isinstance(r, str):
                    continue
                k = R.kind(r)
                if k == "unknown":
                    continue
                if k == "req":
                    text = str((R.reqs.get(r[4:]) or {}).get("text") or "")
                elif k == "doc":
                    text = "Client document: " + str(inp.docs.get(r[4:].split("#")[0], {}).get("name") or r)
                elif k == "calc":
                    text = "Calculated: " + r[5:]
                elif k == "prompt":
                    text = refs.prompt_sentences(inp.prompt_text)[int(r[7:]) - 1]
                elif k == "answer":
                    text = refs.answer_text(inp, r[7:])
                elif k == "brief":
                    val = R.brief_value(r[6:])
                    text = ("; ".join(f"{a}: {b2}" for a, b2 in val.items() if b2) if isinstance(val, dict)
                            else "; ".join(map(str, val)) if isinstance(val, list) else str(val or "")).strip()
                    bf = inp.brief.get(r[6:].split(".")[0]) or {}
                    mark = bf.get("mark") or bf.get("kind")
                    text = (text + (" (filled by the intake from what you gave)" if mark == "intake" else "")) if text \
                        else "This brief field is empty: nothing given states it."
                else:
                    d = R.describe(r)
                    text = d.split("] ", 1)[1] if d.startswith("[") and "] " in d else d
                evidence[r] = {"kind": KIND_WORD.get(k, k), "text": text}
    return evidence


def exports_for(out: Path) -> dict:
    """The finished files, as names and sizes: the big files stay on disk beside the engine, the document holds only these."""
    return {key: {"file": fn, "bytes": (out / fn).stat().st_size} for key, fn in FILES if (out / fn).exists()}


def done_line(deck: dict, rep: dict) -> dict:
    """The done box: how many slides, and how many still need the person."""
    ad = app_deck(deck)
    shown = ad["order"]
    need = [sid for sid in shown if (deck["slides"].get(sid) or {}).get("status") == "needs_human"]
    v = rep.get("validation") or {}
    e, w = v.get("errors", 0), v.get("warnings", 0)
    summary = (f"{len(shown)} pitch slides and {ad['appendix_count']} appendix slides. The checks found {e} error{'s' if e != 1 else ''} "
               f"and {w} warnings; {len(need)} pitch slide{'s' if len(need) != 1 else ''} still need{'s' if len(need) == 1 else ''} you.")
    line = {"summary": summary, "slides": len(shown), "appendix": ad["appendix_count"], "to_supply": len(need)}
    rr = rep.get("repair")
    if rr and rr.get("rounds"):   # the repair count, said in the done box
        fixed = sum(x.get("fixed", 0) for x in rr["rounds"] if x.get("kept"))
        line["summary"] += f" {fixed} fixed by repair, {len(rr.get('left_for_person') or [])} left for you."
    return line


def payload(out: Path, rep: dict, inp, live: bool) -> dict:
    """What the app reads once the run is done: deck, validation, evidence, report, exports and the done line."""
    deck = json.loads((out / "deck.json").read_text())
    findings = json.loads((out / "validation.json").read_text())
    tokens = sum(int((v or {}).get(x) or 0) for v in rep.get("stages", {}).values() if isinstance(v, dict)
                 for x in ("prompt_tokens", "completion_tokens", "cache_read_tokens", "cache_creation_tokens", "tokens_in", "tokens_out"))
    report = {"seconds": rep.get("wall_secs"), "tokens": tokens, "cost_usd": rep.get("usd_total") if live else 0,   # a replay spends nothing
              "engine_usd_total": rep.get("usd_total"), "usd_basis": rep.get("usd_basis"), "qa": rep.get("qa"), "mode": "live" if live else "replay"}
    out_p = {"deck": app_deck(deck), "validation": validation_summary(findings), "evidence": evidence_for(deck, inp) if inp is not None else {},
             "report": report, "exports": exports_for(out), "done": done_line(deck, rep)}
    out_p.update(repair_payload(out, deck, rep))
    pv = production_payload(rep)
    if pv:
        out_p["production"] = pv
    return out_p


def production_payload(rep: dict) -> dict | None:
    """``production`` for the document (template schema; deck-prod-picker P6): the picker's card line, each picked slot with its candidates
    (label, reach, rights, status; never a location) and the opt-in switches as the run had them. None when the run used no Production file."""
    pk = (rep.get("production") or {}).get("picker")
    if not isinstance(pk, dict):
        return None
    f = pk.get("fetch") or {}
    return {"card": (rep.get("production") or {}).get("card") or "", "source": {k: (pk.get("source") or {}).get(k) for k in ("kind", "name")},
            "picks": pk.get("picks") or [], "not_reachable": [{k: n.get(k) for k in ("slot", "key", "reason")} for n in pk.get("not_reachable") or []],
            "fetch": {"on": bool(f.get("on")), "allow_list_empty": bool(f.get("allow_list_empty", not f.get("allow_list"))),
                      **({"refused": f["refused"]} if f.get("refused") else {})},
            "tie_break": {"on": bool((pk.get("tie_break") or {}).get("on"))}, "look": {"on": bool((pk.get("look") or {}).get("on"))}}


def repair_payload(out: Path, deck: dict, rep: dict) -> dict:
    """``qa`` and ``repair`` for the document (template schema): the issues the checks raised, keyed by id, with the hash of the deck.json they read, and the
    rounds the repair loop ran. Present only when the loop wrote issues.json (it did not run under --no-repair or --no-qa); ``repair`` only when a round ran."""
    iss_p, qa_p = out / "issues.json", out / "qa.json"
    if not iss_p.exists() or not qa_p.exists():
        return {}
    issues = json.loads(iss_p.read_text())
    qa = json.loads(qa_p.read_text())
    pres = set(app_deck(deck)["order"])
    counts = {"blocker": 0, "major": 0, "minor": 0}
    for i in issues:
        if i["status"] != "fixed" and i["source"] != "critic" and (i["slide"] in pres or i["slide"] == "deck"):
            counts[i["severity"]] += 1
    res = {"qa": {"deck_sha": str(qa.get("deck_sha") or ""), "current": True, "summary": {**counts, "slides_checked": len(pres)}, "issues": {i["id"]: i for i in issues}}}
    rp = out / "repair.json"
    if rp.exists():
        r = json.loads(rp.read_text())
        secs = {x["n"]: x.get("seconds") for x in (rep.get("repair") or {}).get("rounds", [])}
        res["repair"] = {"rounds": [{"n": x["n"], "kept": x["kept"], "why": x.get("why", "")[:160], "fixed": x["fixed"], "open": x["open"], "usd": x["usd"],
                                     "seconds": secs.get(x["n"]) or 0, "before": x["before"], "after": x["after"]} for x in r["rounds"]],
                         "left_for_person": len(r["left_for_person"]), "stopped": r["stopped"], "skipped": len(r["skipped"])}
    return res
