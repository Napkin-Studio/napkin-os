"""fix_parts: a problem standing on a brief, fixed by the crew in one job (middleware-api.md §10.15).

  context   Sam reads the problem (Jude's note, and what people marked wrong on the same parts)
            against the brief and every fact it holds: what each named part must now say, and
            the research it still lacks. That research runs as draft_brief's does (the Research
            Tool's units, jev's already-held skip, capped), pinned into the brief with its sources.
  draft     Dara rewrites the named parts together, from the problem, Sam's instructions and the
            facts. Nothing else in the brief is written.
  judge     Jude checks the brief again, as draft_brief's judge does, on the named parts only;
            what he still finds goes back to Dara once, and what stands after that is a new note.

Why (the owner, 2026-10-19): a note Jude leaves on a brief often turns on facts the brief does
not have; the planner should be able to ask the crew to find them and fix the parts, not
reword one part at a time.
"""
from __future__ import annotations

from .. import reasoning as rsn
from .. import runlog
from ..doc import LENSES
from .checkloop import FLAG_AT
from .fields import KEYS, LABELS, filled, get
from .planned import DRAFT_SYSTEM, WHAT, PlannedBriefJob, _obj, _S, _short, draft_schema, plan_schema

FIX_PLAN_SYSTEM = """You are the lead strategic planner at an advertising agency. A creative brief has a problem
standing on some of its parts: the brief's judge, or a person, said what is wrong. Your job is to plan the
fix before the writer rewrites those parts.

You get the brief as it stands, the parts to fix, the problem in the judge's or the person's own words,
the facts and findings the brief holds (each fact with its id, value, quote and source), and the research
the agency can run: lenses (research angles) and category codes.

Plan:
- strategy: the brief's strategy in one or two sentences, as it should stand once the problem is fixed.
- parts: for EVERY part to fix, `instruction`: what the rewrite must change so the problem is gone,
  naming the facts it should rest on. Keep what already works.
- brand and competitors: the client's brand and the competitors that matter (named brands, up to five).
- research: only what the fix needs and the facts given do not answer: a claim still to verify, a
  competitor's current price or claim, a number the argument turns on. Each with a lens from the list,
  an ISO 3166-1 alpha-2 market, `focus` naming the brands and the thing to find, why, and the parts it
  serves. Best first. List none when the facts given are enough.
- category: the category code from the list that fits the brief best, or null.
- ask_client: what only the client can answer for this fix, each with the part it serves.
Never invent a figure. Plain British English."""

FIX_NOTE = """

You are fixing a problem on this brief. Rewrite ONLY the parts in `rewrite`, together, so they make one
argument with the rest of the brief and the problem in `problem` is gone. Follow each part's instruction.
Rest every claim on the facts given, citing their ids; a claim no fact supports starts with "To confirm:"
or is left out. Never use a figure that is not in a cited fact."""


def fix_plan_schema(keys, lens_codes, cat_codes):
    s = plan_schema(keys, lens_codes, cat_codes)
    s["properties"]["parts"] = _obj({k: _obj({"instruction": _S}) for k in keys})
    return s


class FixPartsJob(PlannedBriefJob):
    """fix_parts@1 (module docstring). `parts`: the brief keys the problem names; `problem`:
    [{"by", "text", "decision"}], Jude's note first, then what people said on those parts."""

    def __init__(self, *a, parts, problem, **kw):
        super().__init__(*a, **kw)
        self.stages = ["context", "draft", "judge"]
        self.parts = [k for k in parts if k in KEYS and k not in self.locked]
        self.problem = problem
        for k in self.parts:
            self.fields[k] = {"state": "waiting", "by": None}
            # A person's bad verdict on a part is in the problem they asked the crew to fix: it is
            # answered by the fix, not a reason to propose (§10.5). A part a person wrote stays held.
            if self.held.get(k) == "a person's bad verdict on it is unanswered":
                self.held[k] = None

    # -- what every call sees: the named parts, and the client's words as captured -----------
    def _open_keys(self):
        return list(self.parts)

    def _said(self):
        if self.mats:
            return super()._said()
        items = (self.W.get("capture") or {}).get("items") or {}
        return "\n".join(str(i.get("quote") or i.get("value") or "") for i in items.values()
                         if isinstance(i, dict))[:12000]

    def _regen_summary(self, fields):
        st = [fields.get(k, {}).get("state") for k in self.parts]
        n = len(self.parts)
        return (f"Fixed {st.count('done')} of {n} part(s), {st.count('proposed')} proposed"
                f"{', ' + str(len(self.new_pins)) + ' new fact(s) found' if self.new_pins else ''}.")

    def _brief(self):
        return {k: get(self.W, k) for k in KEYS if filled(get(self.W, k))}

    def _problem_cites(self):
        return [p["decision"] for p in self.problem if p.get("decision")]

    # =========================================================================================
    # context: Sam plans the fix, then the research it needs
    # =========================================================================================
    def stage_context(self):
        rl = self.caps.runlog
        keys = self._open_keys()
        self.set_state(keys, "drafting", "synthesis")
        leaves = []
        try:
            leaves = [{"code": x["code"], "name": x.get("name")} for x in self.caps.layers.leaves()]
        except Exception as e:  # noqa: BLE001 - no research to run, the plan still stands
            rl.note("leaves", error=f"{type(e).__name__}: {str(e)[:200]}")
        ev = self._evidence()
        payload = {"brief": self._brief(), "client_said": self._said(),
                   "parts_to_fix": {k: WHAT.get(k, LABELS.get(k, k)) for k in keys},
                   "problem": [{"by": p["by"], "said": p["text"]} for p in self.problem],
                   "facts": ev["facts"], "findings": ev["findings"], "research_upstream": ev["research"],
                   "lenses": LENSES if leaves else [], "categories": leaves,
                   "research_budget": self.research_max if leaves else 0}
        if self.guidance:
            payload["planner_guidance"] = self.guidance
        plan = self.caps.model.structured("plan_fix", FIX_PLAN_SYSTEM, payload,
                                          fix_plan_schema(keys, LENSES, [x["code"] for x in leaves]), max_tokens=6000)
        self.plan_out = plan
        rl.note("plan_fix", parts=keys, research=plan.get("research"), category=plan.get("category"),
                strategy=plan.get("strategy") if runlog.bodies() else None)
        cites = self._problem_cites()
        pts = [rsn.point(f"The problem: {_short(self.problem[0]['text'], 300)}", cites)] if self.problem else []
        pts += [rsn.point(f"{LABELS.get(k, k)}: {_short(((plan.get('parts') or {}).get(k) or {}).get('instruction'), 240)}",
                          cites) for k in keys]
        r = rsn.make(f"Planned the fix of {', '.join(LABELS.get(k, k) for k in keys)}.", pts,
                     rsn.certainty("medium", "a planner's reading of the problem against the facts the brief holds"),
                     "the problem is answered another way, or the facts change",
                     only_option="a person asked the crew to fix this problem")
        self.plan_dec = self.dec(("plan",), "edit", "plan", [], cites, r, "synthesise")
        decisions = [self.plan_dec] + self._research_asked(plan)
        self.add_chunk("context", {}, decisions, facts=self.new_pins, sources=self.new_sources)
        self.set_state(keys, "waiting", "drafter")

    # =========================================================================================
    # draft: Dara rewrites the named parts together
    # =========================================================================================
    def stage_draft(self):
        keys = self._open_keys()
        self.set_state(keys, "drafting", "drafter")
        ev = self._evidence()
        plan = self.plan_out or {}
        said = " ".join(p["text"] for p in self.problem)
        rewrite = {k: (str(((plan.get("parts") or {}).get(k) or {}).get("instruction") or "").strip()
                       or f"Fix it so this no longer holds: {_short(said, 400)}") for k in keys}
        payload = {"client_said": self._said(), "captured": self._captured(),
                   "plan": {"strategy": plan.get("strategy")}, "brief": self._brief(),
                   "problem": [{"by": p["by"], "said": p["text"]} for p in self.problem], "rewrite": rewrite,
                   "facts": ev["facts"], "findings": ev["findings"], "research_upstream": ev["research"],
                   "library": [], "parts": {k: WHAT.get(k, LABELS.get(k, k)) for k in keys}}
        if self.guidance:
            payload["planner_guidance"] = self.guidance
        out = self.caps.model.structured("fix_brief_parts", DRAFT_SYSTEM + FIX_NOTE, payload, draft_schema(keys),
                                         max_tokens=8000)
        self.whole = {k: {**v, "revised": True} for k, v in self._clean_whole(out, ev).items() if k in keys}
        self.set_state([k for k in keys if k in self.whole], "waiting", "drafter")
        self.set_state([k for k in keys if k not in self.whole], "failed", "drafter")
        self.caps.runlog.note("fix_draft", written=sorted(self.whole), empty=[k for k in keys if k not in self.whole],
                              basis={k: v["basis"] for k, v in self.whole.items()})

    # -- judge: draft_brief's, on the named parts (planned.stage_judge); placing differs here ----
    def stage_judge(self):
        if not self.whole:  # Dara wrote nothing: there is nothing to check, and the problem stands
            self.caps.runlog.note("fix_nothing", detail="the rewrite gave none of the parts")
            return
        super().stage_judge()

    def _note_stands(self, res):
        """After a rewrite, Jude's issue stands only if jev still doubts the argument."""
        read = res.get("after") or res.get("before")
        return not res.get("rewritten") or read is None or read["chain"] < FLAG_AT

    def _place(self, rv, ev):
        # Jude's notes on parts the fix did not touch are not this job's to place
        rv = {**rv, "notes": [n for n in rv.get("notes") or [] if set(n.get("parts") or []) & set(self.parts)]}
        super()._place(rv, ev)

    def _passed(self, decisions):
        """Jude's pass on the parts the fix wrote that no new note names: a good verdict with
        a reason, which answers the old note as the Judge passing a redraft does."""
        noted = {t.split("#", 1)[1] for d in decisions if d["kind"] == "verdict" and d.get("polarity") == "bad"
                 for t in d["targets"]}
        ok = [k for k in self.whole if k not in noted and not self.held.get(k) and k in self.writer]
        if not ok:
            return []
        cites = [self.writer[k] for k in ok] + self._problem_cites()
        r = rsn.make(f"Checked the fix: the problem no longer holds for {', '.join(LABELS.get(k, k) for k in ok)}.",
                     [rsn.point(f"The problem was: {_short(self.problem[0]['text'], 300)}", self._problem_cites()),
                      rsn.point("Jude checked the rewritten parts and left no note on them",
                                [self.writer[k] for k in ok])],
                     rsn.certainty("medium", "a model checked the rewritten parts against the brief"),
                     "the parts change again, or a person says otherwise", only_option="the fix passed the check")
        return [self.dec(("passed",), "verdict", "judge", ok, cites, r, "judge", polarity="good",
                         taxonomy_version="reason-codes/1")]

    def _question_seed(self):
        """The questions the brief holds; the fix only adds to them."""
        have = get(self.W, "open_questions")
        return list(have) if isinstance(have, list) else []

    def _unwritten_outcome(self, k):
        """A part the fix did not touch keeps its entry from the last review."""
        prev = (((self.W.get("review") or {}).get("judge") or {}).get("fields") or {}).get(k)
        if isinstance(prev, dict) and "outcome" in prev:
            return prev
        return {"outcome": "kept" if filled(get(self.W, k)) else "absent", "checks": []}


def standing_problem(doc: str, chain: list, verdict_id: str) -> tuple[list, list] | None:
    """(parts, problem) for a bad verdict that still stands on a brief, else None. `chain` is
    newest first (the host's order). Its parts are the brief keys it targets that no later
    edit has written; the problem is its own words, then those of people's bad verdicts
    still standing on the same parts."""
    from .fields import _is_human, wrote
    idx = next((i for i, d in enumerate(chain) if d.get("id") == verdict_id), None)
    if idx is None:
        return None
    v = chain[idx]
    if v.get("kind") != "verdict" or v.get("polarity") != "bad" or v.get("superseded_by"):
        return None

    def keys_of(d):
        out = []
        for t in d.get("targets") or []:
            if isinstance(t, str) and t.startswith(f"{doc}#") and t.split("#", 1)[1] in KEYS:
                out.append(t.split("#", 1)[1])
        return out

    def open_parts(i, d):
        later = chain[:i]  # newer than d
        return [k for k in keys_of(d) if not any(e.get("kind") in ("edit", "resolve") and e.get("action") != "propose"
                                                 and wrote(e, doc, k) for e in later)]

    parts = open_parts(idx, v)
    if not parts:
        return None

    def words(d):
        r = d.get("reasoning") or {}
        txt = r.get("decided") or d.get("rationale") or ""
        more = [p.get("point") for p in r.get("because") or [] if isinstance(p, dict) and p.get("point")]
        more = [m for m in more if m and m not in txt]
        return " ".join([txt] + more[:3]).strip()

    who = "a person" if _is_human(v) else "Jude"
    problem = [{"by": who, "text": words(v), "decision": v["id"]}]
    for i, d in enumerate(chain):
        if d is v or d.get("kind") != "verdict" or d.get("polarity") != "bad" or d.get("superseded_by") \
                or not _is_human(d):
            continue
        if set(open_parts(i, d)) & set(parts) and words(d):
            problem.append({"by": "a person", "text": words(d), "decision": d["id"]})
    return parts, problem

