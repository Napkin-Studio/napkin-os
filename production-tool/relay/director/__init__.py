"""The director in use: the harness lane's (director/claude.py with make()) when
it exists, otherwise the passthrough."""

from __future__ import annotations

import importlib
import logging

from director.base import Director, PassthroughDirector, new_id  # noqa: F401

log = logging.getLogger(__name__)


def load_director() -> Director:
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
