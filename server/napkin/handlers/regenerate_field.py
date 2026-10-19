"""regenerate_field@1 — Brief Maker: redraft one field, then judge it (middleware-api.md §10.10).

On a planned brief (NAPKIN_BRIEF_FLOW planned, the default) the field is redrafted the way fix_parts
fixes a part (owner, 2026-10-19): a one-part FixPartsJob, so the rewrite reads the brief's evidence and
passes through provenance.clean_parts like every other write; the guidance is the planner's steer. The
open questions, and the field-by-field flow, keep the per-field drafter and judge."""

from ..brief.fields import KEYS, LABELS, locked
from ..brief.job import BriefJob
from ..doc import ctx_data
from ..util import bad

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "regenerate_field", "regenerate_field", "1.0", "brief", 1


def start(req, caps, settings, jid):
    data = ctx_data(req.clan)
    if data.get("locked") is True:
        raise bad("the brief is locked: nothing may be redrafted")
    field = req.inp.get("field")
    if not isinstance(field, str) or field not in KEYS:
        raise bad(f"input.field must be one of the eighteen Brief Maker fields")
    if locked(data, field):
        raise bad(f"the field is locked (data.locked_fields)")
    guidance = req.inp.get("guidance")
    if guidance is not None and not isinstance(guidance, str):
        raise bad("input.guidance must be a string")
    guidance = (guidance or "").strip() or None
    if getattr(settings, "brief_flow", "planned") == "planned" and field != "open_questions":
        from ..brief.fix import FixPartsJob
        from ..brief.fields import last_writer
        from ..doc import ctx_decisions
        # the problem cites what wrote the field (or the field itself), so a steer stating a figure is cited
        problem = [{"by": "a person", "decision": last_writer(req.doc, ctx_decisions(req.clan), field)
                    or f"{req.doc}#{field}",
                    "text": guidance or f"Redraft the {LABELS.get(field, field)}: make it sharper and better grounded."}]
        return FixPartsJob(jid, TASK, req.handler, req, caps, field=field, parts=[field], problem=problem,
                           guidance=guidance, research_max=min(2, getattr(settings, "brief_research_max", 3)),
                           judge=getattr(settings, "brief_judge", "review"))
    return BriefJob(jid, TASK, req.handler, req, caps, field=field, guidance=guidance)
