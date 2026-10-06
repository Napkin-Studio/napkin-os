"""The director in use: director/claude.py's make() (the harness lane's
Director over the model port, when a model is configured), otherwise the
passthrough.

Two sets of names live here. The relay's hook is director.base (the
`Director` Protocol with `direct(job_request, sheet)`, PassthroughDirector,
new_id). The package's top-level `Director` is the harness lane's
(director/director.py); director/claude.py joins the two.
"""

from __future__ import annotations

import importlib
import logging

from director.base import PassthroughDirector, new_id  # noqa: F401
from director.director import Director, DirectorError, DirectorResult, bundle, load_schemas  # noqa: F401

log = logging.getLogger(__name__)


def load_director():
    for name in ("claude", "model"):
        try:
            module = importlib.import_module(f"{__name__}.{name}")
        except ModuleNotFoundError as e:
            if e.name == f"{__name__}.{name}":
                continue
            log.exception("director module %s failed to import", name)
            continue
        except Exception:
            log.exception("director module %s failed to import", name)
            continue
        if hasattr(module, "make"):
            return module.make()
    return PassthroughDirector()
