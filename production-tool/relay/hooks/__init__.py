"""Ordered hooks: how a later record adds behaviour to the relay without editing service.py
(features/production-platform-rules.clan, done_when 6).

One file per record in this folder, named NN_<record>.py (two digits, then the record's slug with
underscores): 10_media_tiers.py, 20_result_cache.py. They run in file-name order; there is no registry
and no priority but the name. A file defines either function, or both:

    before_submit(job, ctx) -> job      before the job is sent (its director call and its provider submit).
                                        Return the job, changed or not; raise service.ApiError to refuse
                                        it: the job fails with that code and line, nothing is sent and its
                                        reservation goes back.
    after_complete(job, result, ctx)    once a job has completed. result = {"outputs": [...]}. Its return is
                                        ignored and an error in it is logged, never the job's.

    ctx = {"tenant", "person", "job_number", "project", "env"}

The contract is fixed by tests/test_platform_rules.py. Records that read it: media-tiers, media-router,
result-cache, media-rules-gate, media-providers-adr, asset-provenance, ai-labels-marks,
spend-guard-unified, recipe-runner.
"""

from __future__ import annotations

import importlib.util
import logging
import re
from pathlib import Path
from types import ModuleType

log = logging.getLogger("relay.hooks")

HERE = Path(__file__).resolve().parent
NAME = re.compile(r"^\d\d_[a-z0-9_]+\.py$")


def load(folder: Path | None = None) -> list[ModuleType]:
    """Every hook file in `folder` (default: this one), in file-name order. A file that does not import stops
    the relay at start-up: a rule that silently did not load is worse than no start."""
    folder = Path(folder) if folder is not None else HERE
    out = []
    for path in sorted(p for p in folder.iterdir() if NAME.match(p.name)):
        spec = importlib.util.spec_from_file_location(f"relay_hooks.{path.stem}", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if not (callable(getattr(module, "before_submit", None)) or callable(getattr(module, "after_complete", None))):
            raise ImportError(f"hook {path.name} defines neither before_submit nor after_complete")
        out.append(module)
    if out:
        log.warning("hooks: %s", ", ".join(m.__name__.rsplit(".", 1)[-1] for m in out))
    return out


def before_submit(hooks: list[ModuleType], job: dict, ctx: dict) -> dict:
    """Each hook's before_submit in order; the job each returns goes to the next. ApiError passes through."""
    for hook in hooks:
        fn = getattr(hook, "before_submit", None)
        if fn is not None:
            out = fn(job, ctx)
            if not isinstance(out, dict):
                raise TypeError(f"hook {hook.__name__}: before_submit must return the job")
            job = out
    return job


def after_complete(hooks: list[ModuleType], job: dict, result: dict, ctx: dict) -> None:
    for hook in hooks:
        fn = getattr(hook, "after_complete", None)
        if fn is None:
            continue
        try:
            fn(job, result, ctx)
        except Exception:
            log.exception("hook %s: after_complete failed for %s", hook.__name__, job.get("jobId"))
