"""fix_parts@1 — Brief Maker: the crew fixes a problem standing on the brief (middleware-api.md §10.15)."""

from ..brief.fix import FixPartsJob, standing_problem
from ..doc import ctx_data, ctx_decisions
from ..util import bad

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "fix_parts", "fix_parts", "1.0", "brief", 1


def start(req, caps, settings, jid):
    data = ctx_data(req.clan)
    if data.get("locked") is True:
        raise bad("the brief is locked: nothing may be fixed in it")
    vid = req.inp.get("verdict")
    if not isinstance(vid, str) or not vid:
        raise bad("input.verdict must be the id of a bad verdict on this brief")
    guidance = req.inp.get("guidance")
    if guidance is not None and not isinstance(guidance, str):
        raise bad("input.guidance must be a string")
    got = standing_problem(req.doc, ctx_decisions(req.clan), vid)
    if got is None:
        raise bad("input.verdict is not a bad verdict still standing on a part of this brief")
    parts, problem = got
    job = FixPartsJob(jid, TASK, req.handler, req, caps, parts=parts, problem=problem,
                      guidance=(guidance or "").strip() or None,
                      research_max=min(2, getattr(settings, "brief_research_max", 3)),
                      judge=getattr(settings, "brief_judge", "review"))
    if not job.parts:
        raise bad("every part the verdict names is locked (data.locked_fields)")
    return job
