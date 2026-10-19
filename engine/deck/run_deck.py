"""napkin-deck: build a pitch deck from a prompt, documents, a brief, research, or any mix (ADR 0028).

    python3 -m deck.run_deck [--brief brief_object.json] [--research X.clan] [--prompt-text T | --prompt-file F] \
        [--doc KEY=PATH ...] --stages DIR \
        --client "Lumen Water" --project "National awareness campaign" --out DIR [--master agency.potx]

At least one of a prompt (``--prompt-text`` or ``--prompt-file``), a document (``--doc``), a brief or
research must be given; the run refuses otherwise. ``--answers FILE`` is the person's answers to the
intake questions (``{qid: {text|option_id, at, skipped?}}``).

``--stages DIR`` holds the recorded stage outputs (a0_intake.json, a_requirements.json, doc_facts.json,
b_storyline.json, c_territories.json, d_idea.json, fit.json). With ``--live`` the missing ones are produced
by the model stages (stages.py) and written there first; without it the run makes no model call.
Every run writes deck.json, validation.json, report.json (time, tokens and cost per stage,
slide count, coverage), deck.pptx, deck.pdf, slide PNGs and deck.html (the animated web deck).
``--kind agency|investor|tender|credentials`` picks the deck type (a profile, profiles/<id>.yaml: tender is profile
tender_response); without it the person's answer to the question q_deck_type decides, and a skipped or missing answer
means agency_pitch, recorded in ``meta.built_from.profile``. ``--format full`` keeps every slide in the story (default ``pitch``: at most 18 presented, then an
appendix); ``--audience client`` renders for the room (agency notes dropped, leaks fail the gate);
``--animate auto|click`` adds native PowerPoint animations; ``--hyperframes`` also writes a
HyperFrames slideshow project (``--builds`` for one click per block).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

from . import assemble, inputs, intake, profiles, qa_render, render_hyperframes, render_pptx, render_web, spec, validate

#: Stage a0 (intake) comes first: it fills the brief fields the brief does not supply.
STAGE_FILES = {"a0": "a0_intake.json", "a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
#: An investor deck's story is one stage.
INVESTOR_STAGE_FILES = {"a0": "a0_intake.json", "i": "i_investor.json"}


def _soffice() -> str:
    """The LibreOffice binary on this machine (Linux VM or macOS app)."""
    for c in ("soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"):
        if shutil.which(c) or Path(c).exists():
            return c
    raise RuntimeError("LibreOffice not found: the PDF cannot be made")


def _stamp_type(deck: dict, profile: dict, choice: dict) -> None:
    """Record the deck type in the deck: ``meta.built_from.type`` (the profile id) and ``.profile`` (id,
    label, how it was chosen and why), and ``meta.profile`` when the person was asked (answered or skipped)
    or the type is not a legacy one. A plain default agency or investor deck stays as it always was."""
    rec = {"id": profile["id"], "label": profile["label"], "source": choice["source"], "note": choice["note"]}
    deck["meta"]["built_from"] = {**deck["meta"]["built_from"], "type": profile["id"], "profile": rec}
    if profile["arrange"] == "spine" or choice["source"] in ("answer", "skipped"):
        deck["meta"]["profile"] = rec


def _qa_line(summary: dict, n_slides: int) -> str:
    """The stage h line for the report: the summary's counts, said against the slides that were checked. The summary's own
    line counts only the slides it flagged ('on 0 slides' for a clean deck), which reads as if nothing was checked."""
    line = str(summary.get("line", ""))
    tail = line[line.index(" ("):] if " (" in line else ""   # the by-check counts, as the summary wrote them
    return (f"QA: {summary.get('errors', 0)} errors, {summary.get('warnings', 0)} warnings on {n_slides} slides checked "
            f"({summary.get('slides_flagged', 0)} flagged)" + tail)


def _price_stage(row: dict) -> dict:
    """A stage's report row with its dollars filled in. A ``usd`` the transport reported is kept as it is. Otherwise, where
    the row names a model and holds tokens (``prompt_tokens``/``completion_tokens``, or ``tokens_in``/``tokens_out``), usd is
    an ESTIMATE from the price table (spec.estimate_usd) and ``usd_estimated`` says so. Rows with no tokens stay at 0."""
    if row.get("usd") or not row.get("model"):
        return row
    tin = row.get("prompt_tokens") or row.get("tokens_in") or 0
    tout = row.get("completion_tokens") or row.get("tokens_out") or 0
    usd = spec.estimate_usd(row["model"], tin, tout, row.get("cache_read_tokens") or 0, row.get("cache_creation_tokens") or 0)
    return {**row, "usd": usd, "usd_estimated": True} if usd else row


def _needs_intake(inp) -> bool:
    """True when stage a0 has something to do: a brief field the brief leaves empty, and a prompt,
    a document or research to read it from. A complete brief runs no intake call."""
    return bool(intake.gap_report(inp)["brief_fields"]) and bool(inp.prompt_text.strip() or inp.docs or inp.has_research())


def _slug(name: str) -> str:
    """A criterion's file stem: lower-case words joined by ``_``, for ``d_<criterion>.json``. A name whose stem is over 40 characters
    is cut to 32 and given an 8-character hash of the whole stem, so two long names that share their first 40 characters never share a file;
    a stem of 40 or fewer is unchanged (recorded files keep their names)."""
    full = re.sub(r"[^a-z0-9]+", "_", str(name).lower()).strip("_")
    if len(full) <= 40:
        return full or "criterion"
    return full[:31].rstrip("_") + "_" + hashlib.sha1(full.encode()).hexdigest()[:8]


def _criterion_answers(a, inp, st: dict, profile: dict, rep: dict) -> None:
    """The per-criterion answer step (a deck type whose spine holds ``criterion_answer``: the tender response): for each scored
    criterion of stage a, with its word budget from its weight (assemble.criterion_budgets), read the recorded ``d_<criterion>.json``;
    with none recorded and no --live that criterion is skipped quietly (``skipped: no recorded output``), so every older stage directory
    rebuilds as before. With --live one call (stages.criterion_answer) is made and recorded first. The answers go to ``st['d_criteria']``,
    where the assembler derives the deck's answer slides from them; the report row says which were recorded, live or skipped."""
    scoring = (st.get("a") or {}).get("scoring") or []
    if "criterion_answer" not in profile["spine"] or not scoring or not profiles.runs(profile, "d"):
        return
    budgets = assemble.criterion_budgets(scoring)
    answers, rows, usages = [], {}, []
    for c in scoring:
        name = str(c.get("criterion") or "")
        if not name:
            continue
        p = a.stages / f"d_{_slug(name)}.json"
        if p.exists():
            obj = json.loads(p.read_text())
            rows[name] = {"source": "recorded", "produced_by": obj.get("produced_by"), "budget": budgets[name], **(obj.get("usage") or {})}
            if obj.get("usage"):
                usages.append(obj["usage"])   # a recorded call's tokens count in the stage's total too, so a recorded run is priced
        elif a.live:
            from . import stages
            obj, usage = stages.criterion_answer(inp, st, c, budgets[name], profile)
            obj["usage"] = usage
            p.write_text(json.dumps(obj, indent=1, ensure_ascii=False))
            rows[name] = {"source": "live", "budget": budgets[name], **usage}
            usages.append(usage)
        else:
            rows[name] = {"source": "skipped: no recorded output", "budget": budgets[name]}
            continue
        obj.setdefault("criterion", name)
        answers.append(obj)
    if answers:
        st["d_criteria"] = {"stage": "d_criteria", "produced_by": "; ".join(sorted({str(x.get("produced_by")) for x in answers})), "answers": answers}
    got = [r["source"] for r in rows.values()]
    rep["stages"]["d_criteria"] = {"source": "skipped: no recorded output" if not answers else "recorded" if all(g == "recorded" for g in got if not g.startswith("skipped")) else "live",
                                   "criteria": len(rows), "answered": len(answers), "per_criterion": rows}
    if usages:   # the calls' tokens and dollars, recorded or live, count in the run's total (the per-criterion rows keep their own)
        from . import stages
        rep["stages"]["d_criteria"].update(stages._sum(usages))


def _judge_insight(a, inp, st: dict, profile: dict, rep: dict) -> None:
    """The insight judge step: when stage b wrote insight candidates, read the recorded ``insight_judge.json`` into ``st``.
    With none recorded and no --live the step is skipped quietly (``skipped: no recorded output``) and the deck is built
    with the writer's choice. With --live the judge runs once (stages.insight_judge) and its output is recorded; when every
    candidate fails and stage b was itself live this run, stage b is re-run ONCE with the judge's reasons, its candidates
    judged again, and the retry is logged in ``b['insight_retry']``. A deck whose stage b has no candidates runs nothing and
    adds no row to the report, so an old recorded stage directory is reported as it always was."""
    from . import stages
    if not assemble.valid_candidates(st.get("b") or {}) or not profiles.runs(profile, "b"):
        return
    jp, bp = a.stages / "insight_judge.json", a.stages / STAGE_FILES["b"]

    def live_judge():
        """Judge the current candidates, record the output, and return its report row."""
        obj, usage = stages.insight_judge(st, profile, inp)
        obj["usage"] = usage
        jp.write_text(json.dumps(obj, indent=1, ensure_ascii=False))
        st["insight_judge"] = obj
        return {"source": "live", **usage}

    b_live = (rep["stages"].get("b") or {}).get("source") == "live"
    if jp.exists() and not b_live:   # verdicts are keyed by candidate id: a recorded file never describes candidates written this run
        st["insight_judge"] = json.loads(jp.read_text())
        rep["stages"]["insight_judge"] = {"source": "recorded", "produced_by": st["insight_judge"].get("produced_by"), **(st["insight_judge"].get("usage") or {})}
        return
    if not a.live:
        rep["stages"]["insight_judge"] = {"source": "skipped: no recorded output"}
        return
    rep["stages"]["insight_judge"] = live_judge()
    verdicts = assemble.judge_verdicts(st["insight_judge"])
    if verdicts and not any(v["pass"] for v in verdicts.values()) and (rep["stages"].get("b") or {}).get("source") == "live" and not st["b"].get("insight_retry"):
        reasons = [f"{i}: {v['reason'] or ', '.join(v['failed'])}" for i, v in verdicts.items()]
        first = [str(c["id"]) for c in assemble.valid_candidates(st["b"])]
        st["b"], usage = stages.storyline(inp, st, profile, retry_reasons=reasons)
        st["b"].update(usage=usage, insight_retry={"reasons": reasons, "first_candidates": first})   # a logged decision, bounded to one
        bp.write_text(json.dumps(st["b"], indent=1, ensure_ascii=False))
        rep["stages"]["insight_retry"] = {"source": "live", **usage}
        rep["stages"]["insight_judge"] = live_judge()


def _follow_judge(a, st: dict, rep: dict) -> None:
    """When stage b was written live this run and the judge's first passing candidate is not the writer's pick, make it the
    insight stages c and d are written against: ``insight.chosen_candidate_id`` becomes the judge's, the writer's own pick is
    kept as ``insight.writer_chosen_candidate_id`` (assemble reads it back), and stage b is re-recorded. A recorded stage b is
    never rewritten, and nothing happens without a passing candidate."""
    b = st.get("b") or {}
    if (rep["stages"].get("b") or {}).get("source") != "live" or not st.get("insight_judge"):
        return
    passing = assemble.passing_ids(b, st["insight_judge"])
    ins = b.setdefault("insight", {})
    writer = str(ins.get("writer_chosen_candidate_id") or ins.get("chosen_candidate_id") or "")
    if passing and passing[0] != str(ins.get("chosen_candidate_id") or ""):
        ins.update(writer_chosen_candidate_id=writer, chosen_candidate_id=passing[0])
        (a.stages / STAGE_FILES["b"]).write_text(json.dumps(b, indent=1, ensure_ascii=False))


def _red_team(a, deck: dict, inp, profile: dict, rep: dict) -> None:
    """The red-team step, after stage e on the finished deck: read the recorded ``red_team.json``; with none recorded and no
    --live it is skipped quietly (``skipped: no recorded output``) and the deck is untouched. With --live one Sonnet call
    (stages.red_team) is made and recorded first. The objections go to ``deck.meta.red_team`` and each is a decision in
    ``report.json`` (``decisions``), applied by assemble.apply_red_team only when safe. The report carries a cost note."""
    rp = a.stages / "red_team.json"
    if rp.exists():
        rt = json.loads(rp.read_text())
        row = {"source": "recorded", "produced_by": rt.get("produced_by"), **(rt.get("usage") or {})}
    elif a.live:
        from . import stages
        rt, usage = stages.red_team(deck, inp, profile)
        rt["usage"] = usage
        rp.write_text(json.dumps(rt, indent=1, ensure_ascii=False))
        row = {"source": "live", **usage}
    else:
        rep["stages"]["red_team"] = {"source": "skipped: no recorded output"}
        return
    decisions = assemble.apply_red_team(deck, rt)
    row.update(objections=len(decisions), applied=sum(d["applied"] for d in decisions),
               cost_note="one Sonnet call on the finished deck; the plan's budget is under $1.75 a deck in all")
    rep["stages"]["red_team"] = row
    rep["decisions"] = [*rep.get("decisions", []), *decisions]


def _read_answers(path) -> tuple:
    """The person's answers and verify decisions from ``--answers FILE``: ``(answers, verified)``. The file is the
    flat ``{qid: {text|option_id, at, skipped?}}`` it always was, or an ``intake`` object as the app keeps it
    (``{answers: {...}, verified: {<ref>: {by, at}}}``). No file: both empty."""
    if not path:
        return {}, {}
    raw = json.loads(Path(path).read_text())
    if isinstance(raw, dict) and set(raw) & {"answers", "verified"} and all(isinstance(raw.get(k), dict) for k in set(raw) & {"answers", "verified"}) \
            and not any(str(k).startswith("q_") for k in raw):
        return raw.get("answers") or {}, raw.get("verified") or {}
    return raw, {}


def main(argv=None):
    """Run the pipeline end to end and print the report."""
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--brief", type=Path, help="the brief tool's output (optional: a prompt, documents or research alone build a deck)")
    ap.add_argument("--prompt-text", help="the person's prompt, any length (cited prompt:<n>)")
    ap.add_argument("--prompt-file", type=Path, help="a text file holding the person's prompt")
    ap.add_argument("--answers", type=Path, help="JSON of the person's answers to the intake questions: {qid: {text|option_id, at, skipped?}}")
    ap.add_argument("--research", type=Path)
    ap.add_argument("--stages", required=True, type=Path)
    ap.add_argument("--client", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--agency", default="[Agency]")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--master", type=Path)
    ap.add_argument("--live", action="store_true", help="run missing model stages (paid)")
    ap.add_argument("--format", choices=("pitch", "full"), default="pitch",
                    help="pitch (default): the presented story, then an appendix; full: every slide in story order")
    ap.add_argument("--audience", choices=("review", "client"), default="review",
                    help="client: drop agency notes and fail the gate on any agency-only text left on screen")
    ap.add_argument("--animate", choices=("auto", "click"), help="native PowerPoint animations: builds play on their own, or one per click")
    ap.add_argument("--hyperframes", action="store_true", help="also write a HyperFrames slideshow project (hyperframes/)")
    ap.add_argument("--builds", action="store_true", help="HyperFrames: one click per block instead of one per slide")
    ap.add_argument("--kind", choices=tuple(profiles.KIND_TO_PROFILE), default=None,
                    help="the deck type: agency (default, unless the person's answer to q_deck_type chooses), investor (seed) pitch, "
                         "tender (a tender response, profile tender_response) or credentials (a chemistry-meeting deck)")
    ap.add_argument("--doc", action="append", default=[], metavar="KEY=PATH",
                    help="a client document (PDF page by page, or text), cited as doc:KEY#pN; repeatable")
    ap.add_argument("--brand", type=Path, help="brand JSON: name, colors (THEME keys, accent_ink), head/body fonts, logo files")
    ap.add_argument("--no-qa", action="store_true", help="skip stage h, the rendered-slide QA (qa.json)")
    a = ap.parse_args(argv)
    if a.prompt_text and a.prompt_file:
        ap.error("give --prompt-text or --prompt-file, not both")
    prompt_text = (a.prompt_file.expanduser().read_text(encoding="utf-8", errors="replace") if a.prompt_file else a.prompt_text or "").strip()
    if not (prompt_text or a.doc or a.brief or a.research):
        ap.error("nothing to build a deck from: give a prompt (--prompt-text or --prompt-file), a document (--doc), a brief (--brief) or research (--research)")
    a.out.mkdir(parents=True, exist_ok=True)
    rep = {"stages": {}, "started": time.strftime("%Y-%m-%dT%H:%M:%S")}
    t0 = time.time()

    t = time.time()
    docs = []
    for d in a.doc:
        key, eq, path = d.partition("=")
        if not (eq and key.strip() and path.strip()):
            ap.error(f"--doc needs KEY=PATH, got {d!r}")
        if key in {k for k, _ in docs}:
            ap.error(f"--doc key {key!r} is given twice: each document needs its own key")
        docs.append((key, Path(path).expanduser()))
    answers, verified = _read_answers(a.answers)
    inp = inputs.load(a.brief, a.research, a.stages / "doc_facts.json", docs, prompt_text=prompt_text, answers=answers, verified=verified)
    rep["stages"]["inputs"] = {"secs": round(time.time() - t, 2), "model": None, "tokens_in": 0, "tokens_out": 0, "usd": 0}
    choice = intake.chosen_type(inp, a.kind)   # an explicit --kind wins, then the person's answer, then the stated default
    profile = profiles.load(choice["type"])
    kind = profile["kind"]                     # which assembler: agency or investor
    rep["type"] = {"id": profile["id"], "source": choice["source"], "note": choice["note"]}
    rep["type_question"] = intake.type_card_for(inp)   # computed in code: it exists even when no a0 stage ran
    supply = intake.supply_questions(inp, kind, profile if profile["arrange"] == "spine" else None)   # computed in code: what only the person knows
    rep["supply_questions"] = supply
    rep["coverage"] = inp.coverage
    pages = {k: d["pages"] for k, d in inp.docs.items() if d.get("pages")}
    if pages:
        rep["doc_pages"] = pages   # every page of every document read (never dropped)

    st = {}
    for k, fn in profiles.stage_names(profile, INVESTOR_STAGE_FILES if kind == "investor" else STAGE_FILES).items():
        p = a.stages / fn
        if k == "a0" and not p.exists() and not (a.live and _needs_intake(inp)):
            continue   # intake adds no stage, and no cost, when the brief supplies everything or there is nothing else to read
        if p.exists():
            st[k] = json.loads(p.read_text())
            if k == "a0":
                errs = intake.validate_a0(st[k])
                if errs:
                    raise SystemExit(f"{p} is not a valid a0 intake: " + "; ".join(errs[:5]))
            rep["stages"][k] = {"source": "recorded", "produced_by": st[k].get("produced_by"),
                                **(st[k].get("usage") or {"tokens_in": 0, "tokens_out": 0, "usd": 0, "secs": 0})}
        elif a.live:
            from . import stages
            st[k], usage = stages.run_stage(k, inp, st, profile)
            st[k]["usage"] = usage   # kept with the output, so a later recorded run still reports its cost
            p.write_text(json.dumps(st[k], indent=1, ensure_ascii=False))
            rep["stages"][k] = {"source": "live", **usage}
        else:
            rep["stages"][k] = {"source": "missing"}
        if k == "b" and k in st:   # the insight is judged BEFORE territories (c) and the idea (d) are written, so they are written against the insight the deck shows
            _judge_insight(a, inp, st, profile, rep)
            _follow_judge(a, st, rep)
        if k == "a0" and k in st:   # later stages and the build read the brief with the intake's fields in it
            st[k]["gaps"] = intake.gap_report(inp, st[k], kind)
            asked = len(st[k]["questions"])   # the stage's own questions, before the deck type question joins them
            intake.add_type_question(st[k], intake.type_card_for(inp), profile if profile["arrange"] == "spine" else None)   # the deck type is always the first question; a legacy type adds none of its own, so its deck is unchanged
            intake.add_supply_questions(st[k], supply)   # after the type question and the stage's own, within the five-question cap
            inp.intake = st[k]
            rep["intake"] = {"applied": intake.apply_a0(inp, st[k]), "gaps": st[k]["gaps"], "questions": asked,
                             "questions_total": len(st[k]["questions"])}

    _criterion_answers(a, inp, st, profile, rep)

    t = time.time()
    fp = a.stages / "fit.json"   # the fit judge reads an assembled deck; its verdicts decide what a pitch presents
    fit = json.loads(fp.read_text()) if fp.exists() else None
    builder = assemble.build_investor if kind == "investor" else assemble.build
    build = lambda f: builder(inp, st, client=a.client, project=a.project, agency=a.agency, fmt=a.format, fit=f, profile=profile)
    deck = build(fit)
    if fit:
        rep["stages"]["fit"] = {"source": "recorded", "produced_by": fit.get("produced_by"), **(fit.get("usage") or {})}
    elif a.live and profiles.runs(profile, "fit"):
        from . import stages
        fit, usage = stages.fit(deck, inp, profile)
        fit["usage"] = usage
        fp.write_text(json.dumps(fit, indent=1, ensure_ascii=False))
        rep["stages"]["fit"] = {"source": "live", **usage}
        deck = build(fit)
    else:
        rep["stages"]["fit"] = {"source": "missing"}
    deck["meta"]["audience"] = a.audience
    if kind == "investor":   # a slide with no source is held behind the Appendix: its question card joins the supply cards
        have = {c["id"] for c in supply}
        rep["supply_questions"] = supply + [c for c in intake.gap_questions(assemble.investor_gaps(deck)) if c["id"] not in have]
    rep["confirm"] = intake.confirm_summary(deck, intake.stamp_confirm(deck, inp))   # what to confirm, and how much a person has verified or supplied
    _stamp_type(deck, profile, choice)
    if a.brand:   # colours, fonts and logos: the logo files are read here so the deck carries them
        brand = json.loads(a.brand.read_text())
        for k in ("logo_dark_svg", "logo_light_svg"):
            if brand.get(k) and Path(brand[k]).expanduser().exists():
                brand[k] = Path(brand[k]).expanduser().read_text()
        for k in ("logo_dark_png", "logo_light_png"):
            if brand.get(k):
                brand[k] = str(Path(brand[k]).expanduser())
        deck["meta"]["brand"] = brand
    ep = a.stages / "e_copy.json"   # stage e: tighten over-budget presented slides; recorded edits are re-applied by title
    if ep.exists():
        ecopy = json.loads(ep.read_text())
        rep["stages"]["e"] = {"source": "recorded", "produced_by": ecopy.get("produced_by"), **(ecopy.get("usage") or {})}
    elif a.live and profiles.runs(profile, "e"):
        from . import stages
        ecopy, usage = stages.copy(deck, inp, profile)
        ecopy["usage"] = usage
        ep.write_text(json.dumps(ecopy, indent=1, ensure_ascii=False))
        rep["stages"]["e"] = {"source": "live", **usage}
    else:
        ecopy = None
        rep["stages"]["e"] = {"source": "missing"}
    if ecopy:
        rep["stages"]["e"]["applied"] = assemble.apply_copy(deck, ecopy.get("edits") or [])
        if ecopy.get("narrowed"):   # headline narrowing: a recorded e_copy.json without it changes nothing
            rep["stages"]["e"]["narrowing"] = assemble.apply_narrowing(deck, ecopy["narrowed"])
    _red_team(a, deck, inp, profile, rep)
    rep["stages"]["assemble"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}

    t = time.time()
    findings = validate.run(deck, inp, a.audience)
    rep["validation"] = validate.summary(findings)
    ws = validate.weight_share_report(deck)   # the buyer's weights against the words spent on each criterion: record only
    if ws["rows"]:
        rep["weight_share"] = ws
    relay = validate.relay_test(deck)   # record only: no model, never blocks
    if relay:
        rep["relay_test"] = relay
    if deck["meta"].get("insight"):
        rep["insight"] = {**deck["meta"]["insight"], "candidates": len(deck["meta"].get("insight_candidates") or [])}
    rep["stages"]["validate"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}
    (a.out / "deck.json").write_text(json.dumps(deck, indent=1, ensure_ascii=False, default=str))
    (a.out / "validation.json").write_text(json.dumps(findings, indent=1, ensure_ascii=False))

    t = time.time()
    pptx = render_pptx.render(deck, inp, a.out / "deck.pptx", a.master, findings, animate=a.animate or False)
    rep["stages"]["render_pptx"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}

    t = time.time()
    render_web.render(deck, inp, a.out / "deck.html", findings)
    if a.hyperframes:
        render_hyperframes.render(deck, inp, a.out / "hyperframes", findings, builds=a.builds)
    rep["stages"]["render_web"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}

    t = time.time()
    subprocess.run([_soffice(), "--headless", "--convert-to", "pdf", "--outdir", str(a.out), str(pptx)],
                   check=True, capture_output=True, timeout=180)
    (a.out / "png").mkdir(exist_ok=True)   # pdftoppm overwrites by name; nothing is deleted
    subprocess.run(["pdftoppm", "-png", "-r", "60", str(a.out / "deck.pdf"), str(a.out / "png" / "slide")], check=True)
    rep["stages"]["render_pdf_png"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}

    # ---- stage h: rendered-slide QA (qa_render.py). It never blocks the build: a finding is only reported. ----
    if not a.no_qa:
        t = time.time()
        qa = qa_render.run(pptx, a.out / "deck.pdf", a.out, findings)
        rep["qa"] = _qa_line(qa["summary"], len(deck["order"]))
        rep["stages"]["qa_render"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}
        print(rep["qa"])
    # ---- end stage h ----

    rep["slides"] = len(deck["order"])
    rep["slides_by_status"] = {s: sum(1 for x in deck["slides"].values() if x["status"] == s) for s in ("from_source", "drafted", "needs_human")}
    rep["wall_secs"] = round(time.time() - t0, 1)
    rep["stages"] = {k: _price_stage(v or {}) for k, v in rep["stages"].items()}   # the CLI transport reports tokens, not dollars
    rep["usd_total"] = round(sum((v or {}).get("usd", 0) or 0 for v in rep["stages"].values()), 4)
    if any(v.get("usd_estimated") for v in rep["stages"].values()):
        rep["usd_basis"] = spec.USD_BASIS
    (a.out / "report.json").write_text(json.dumps(rep, indent=1, ensure_ascii=False))
    print(json.dumps({k: rep[k] for k in ("slides", "slides_by_status", "validation", "wall_secs", "usd_total")}, indent=1))
    return rep


if __name__ == "__main__":
    main()
