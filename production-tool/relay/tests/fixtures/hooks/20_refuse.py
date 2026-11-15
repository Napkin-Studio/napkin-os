"""A fixture hook (tests/test_platform_rules.py): it refuses a job whose words say so, after 10_annotate ran."""
from service import ApiError


def before_submit(job, ctx):
    assert job.get("_hooks") == ["10_annotate"], "hooks run in file-name order"
    if "refuse me" in ((job.get("_req") or {}).get("input") or {}).get("text", ""):
        raise ApiError("not_allowed", "A rule refused this job.")
    return {**job, "_hooks": [*job["_hooks"], "20_refuse"]}
