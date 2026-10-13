"""Where the locked contracts live: bundled next to the code in the Lambda zip
(contracts/), or production-tool/contracts in the repository."""

import importlib.util
import os
from functools import lru_cache
from pathlib import Path
from types import ModuleType

_HERE = Path(__file__).resolve().parent


def contracts_dir() -> Path:
    env = os.environ.get("CONTRACTS_DIR")
    if env:
        return Path(env)
    bundled = _HERE / "contracts"
    if (bundled / "relay-api.schema.json").exists():
        return bundled
    return _HERE.parent / "contracts"


@lru_cache(maxsize=None)
def pricing() -> ModuleType:
    """contracts/pricing.py, the one price function (features/runway-sheet-sync.clan), loaded from
    the same contracts as the sheets: bundled in the Lambda zip, or the repository's."""
    path = contracts_dir() / "pricing.py"
    spec = importlib.util.spec_from_file_location("napkin_contracts_pricing", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"no price function at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
