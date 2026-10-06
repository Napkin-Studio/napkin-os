"""Provider registry: every adapter module in this package that defines
`make() -> base.Provider`, paired with its capability sheet from
contracts/capabilities/<name>.json. A provider with a sheet but no adapter is
skipped by routing, as if its sheet supported nothing.

Two sets of types live here. The relay speaks providers/base.py (a providerJob
dict in, base.Status out, base.ProviderError); import those from providers.base.
The harness adapters speak providers/types.py (ProviderJob, ProviderOutput,
AssetRef, their own ProviderError); this package's top-level names are those.
providers/_seam.py joins the two, and each adapter's make() goes through it.
"""

from __future__ import annotations

import importlib
import json
import logging
import pkgutil

from contracts_dir import contracts_dir
from providers.types import (  # noqa: F401  the harness adapters' types
    AssetRef, CapabilityMissing, Provider, ProviderError, ProviderJob, ProviderOutput, Ref, Status,
    check_capabilities, load_sheet, video_audio,
)
from providers.base import Provider as RelayProvider  # noqa: E402

log = logging.getLogger(__name__)


class Registry:
    def __init__(self, providers: dict[str, RelayProvider] | None = None, sheets: dict[str, dict] | None = None):
        self.providers: dict[str, RelayProvider] = dict(providers or {})
        self.sheets: dict[str, dict] = dict(sheets or {})

    def register(self, provider: RelayProvider, sheet: dict | None = None) -> None:
        self.providers[provider.name] = provider
        self.sheets[provider.name] = sheet if sheet is not None else provider.capabilities()

    def get(self, name: str) -> RelayProvider | None:
        return self.providers.get(name)

    def sheet(self, name: str) -> dict | None:
        return self.sheets.get(name) if name in self.providers else None

    def supports(self, name: str, op: str) -> bool:
        sheet = self.sheet(name)
        return bool(sheet) and op in sheet.get("ops", {})


def load_sheets() -> dict[str, dict]:
    sheets = {}
    for path in sorted((contracts_dir() / "capabilities").glob("*.json")):
        sheet = json.loads(path.read_text())
        sheets[sheet["provider"]] = sheet
    return sheets


def load_registry() -> Registry:
    """Import every adapter module present (providers/<name>.py with make())."""
    sheets = load_sheets()
    reg = Registry()
    for mod in pkgutil.iter_modules(__path__):
        if mod.name in ("base", "types", "tags") or mod.name.startswith("_"):
            continue
        try:
            module = importlib.import_module(f"{__name__}.{mod.name}")
        except Exception:  # a broken adapter must not take the relay down
            log.exception("provider module %s failed to import", mod.name)
            continue
        make = getattr(module, "make", None)
        if make is None:
            continue
        try:
            provider = make()
        except Exception:
            log.exception("provider %s failed to start", mod.name)
            continue
        reg.register(provider, sheets.get(provider.name) or provider.capabilities())
    return reg


try:  # the harness tests import it from here; a missing Pillow must not take the registry down
    from providers.mock import MockProvider  # noqa: E402,F401
except ImportError:  # pragma: no cover
    log.exception("providers.mock failed to import")
