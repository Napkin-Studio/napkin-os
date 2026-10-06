"""Provider registry: every adapter module in this package that defines
`make() -> Provider`, paired with its capability sheet from
contracts/capabilities/<name>.json. A provider with a sheet but no adapter is
skipped by routing, as if its sheet supported nothing.
"""

from __future__ import annotations

import importlib
import json
import logging
import pkgutil

from contracts_dir import contracts_dir
from providers.base import CapabilityMissing, Moderated, Provider, ProviderError, Status  # noqa: F401

log = logging.getLogger(__name__)


class Registry:
    def __init__(self, providers: dict[str, Provider] | None = None, sheets: dict[str, dict] | None = None):
        self.providers: dict[str, Provider] = dict(providers or {})
        self.sheets: dict[str, dict] = dict(sheets or {})

    def register(self, provider: Provider, sheet: dict | None = None) -> None:
        self.providers[provider.name] = provider
        self.sheets[provider.name] = sheet if sheet is not None else provider.capabilities()

    def get(self, name: str) -> Provider | None:
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
        if mod.name == "base" or mod.name.startswith("_"):
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
