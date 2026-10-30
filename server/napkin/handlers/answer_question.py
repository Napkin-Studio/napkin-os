"""answer_question@1 — the person's answer to a start_campaign question, or to a draft_brief's intake
questions; the reply describes the job it continues."""

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "answer_question", "answer_question", "1.0", "answer", 1


def answer(job, req):
    job.answer(req.clan, req.inp)
