"""A fixture hook (tests/test_platform_rules.py): it hears each completed job, and its own error is never the job's."""
DONE: list = []


def after_complete(job, result, ctx):
    DONE.append((job["jobId"], len(result["outputs"]), ctx["tenant"]))
    raise RuntimeError("an after_complete error is logged, never the job's")
