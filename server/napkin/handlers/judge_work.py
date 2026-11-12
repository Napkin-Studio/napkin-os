"""judge_work@1 — Judge: the rubric's thirty yes or no tests answered for one piece of work (short task).
Returns test answers only; the host adds them up. docs/contracts/middleware-api.md."""

from ..judge.core import run as _run

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "judge_work", "judge_work", "1.0", "short", 1


def run(req, caps):
    """-> (result, change, hits)."""
    return _run(req, caps)
