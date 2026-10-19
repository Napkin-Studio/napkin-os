"""reconsider@2 — a person reviewed the research (verified or rejected a fact or a finding, corrected a fact):
bring the document in step with it, writing again only what rests on what they reviewed (long task). One job per
document at a time: a second is refused while one runs, and the view queues reviews into the next."""

from ..pipeline.reconsider import Reconsider, validate

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "reconsider", "reconsider", "2.0", "long", 1


def prepare(req, caps, settings):
    events = validate(req.clan, req.inp)
    r = Reconsider(req.doc, req.base, req.clan, req.handler, caps, events, settings)

    def work():
        return r.run(progress=lambda done: caps.jobs.progress(done))
    return 4, work
