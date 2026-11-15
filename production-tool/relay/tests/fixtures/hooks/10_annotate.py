"""A fixture hook (tests/test_platform_rules.py): it marks the job, and later hooks see the mark."""
SEEN: list = []


def before_submit(job, ctx):
    SEEN.append(("10_annotate", ctx))
    return {**job, "_hooks": [*(job.get("_hooks") or []), "10_annotate"]}
