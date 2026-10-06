"""Where the locked contracts live: bundled next to the code in the Lambda zip
(contracts/), or production-tool/contracts in the repository."""

import os
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def contracts_dir() -> Path:
    env = os.environ.get("CONTRACTS_DIR")
    if env:
        return Path(env)
    bundled = _HERE / "contracts"
    if (bundled / "relay-api.schema.json").exists():
        return bundled
    return _HERE.parent / "contracts"
