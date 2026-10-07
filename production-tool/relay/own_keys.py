"""A participant's own provider keys (features/production-tool-own-keys.clan).

The browser sends `X-Own-Keys: {"fal": "...", "heygen": "..."}` on POST /jobs
only. A step one of those providers can do runs there on that key; any other
step runs on the event's routing (Runway) as before. The relay keeps the key a
job needs on the job item, sealed with AES-GCM under a key derived from
TOKEN_SECRET, so status polls, cancels and the sweep work with the tab closed.
A key is never logged, returned, or stored readable.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import threading
from collections import OrderedDict

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

HEADER = "x-own-keys"
# Preference order: a clip goes to HeyGen before fal; HeyGen does nothing else.
PROVIDERS = ("heygen", "fal")
NAMES = {"fal": "fal", "heygen": "HeyGen"}
# Ops a provider takes on an own key only as the backup to another own key:
# a fal key alone leaves clips on the event's routing; with a HeyGen key too,
# fal takes a clip HeyGen cannot.
BACKUP_ONLY = {"fal": ("clip",)}
MAX_KEY_LEN = 512
_INFO = b"production-tool own-keys v1"


class BadKeys(ValueError):
    """The header is malformed. The message never contains a key."""


def parse(raw: str | None) -> dict[str, str]:
    """The header's keys, by provider. Empty when the header is absent or blank."""
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        raise BadKeys("X-Own-Keys is not JSON.") from None
    if not isinstance(data, dict):
        raise BadKeys('X-Own-Keys must be an object like {"fal": "…", "heygen": "…"}.')
    keys = {}
    for provider, value in data.items():
        if provider not in PROVIDERS:
            raise BadKeys(f"X-Own-Keys takes keys for {' and '.join(sorted(PROVIDERS))} only.")
        if value is None or value == "":
            continue
        if not isinstance(value, str) or len(value) > MAX_KEY_LEN or not value.isprintable() or value != value.strip():
            raise BadKeys(f"The {NAMES[provider]} key does not look like a key.")
        keys[provider] = value
    return keys


class Sealer:
    """AES-GCM under HKDF(TOKEN_SECRET). The job id and provider are bound in as
    associated data, so a sealed key cannot be moved to another job."""

    def __init__(self, secret: str):
        derived = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_INFO).derive(secret.encode())
        self._aead = AESGCM(derived)

    @staticmethod
    def _aad(job_id: str, provider: str) -> bytes:
        return f"{job_id}\n{provider}".encode()

    def seal(self, key: str, job_id: str, provider: str) -> str:
        nonce = os.urandom(12)
        ct = self._aead.encrypt(nonce, key.encode(), self._aad(job_id, provider))
        return "v1:" + base64.b64encode(nonce + ct).decode()

    def open(self, sealed: str, job_id: str, provider: str) -> str | None:
        """The key, or None when it cannot be read (TOKEN_SECRET rotated, tampered)."""
        if not sealed.startswith("v1:"):
            return None
        try:
            raw = base64.b64decode(sealed[3:])
            return self._aead.decrypt(raw[:12], raw[12:], self._aad(job_id, provider)).decode()
        except (InvalidTag, ValueError):
            return None


def refused(provider: str, code: str, message: str, provider_code: str | None) -> bool:
    """The provider said the key itself is wrong (fal and HeyGen adapters, 401/403)."""
    if code != "provider_failed":
        return False
    if provider_code in ("401", "403"):
        return True
    return provider == "fal" and message == "fal rejected the API key"


def _make(provider: str, key: str):
    from providers import _seam

    if provider == "fal":
        from providers.fal import FalProvider

        return _seam.Adapted(FalProvider(key, _seam.Resolver()))
    if provider == "heygen":
        from providers.heygen import HeyGenProvider

        return _seam.Adapted(HeyGenProvider(key, _seam.Resolver()))
    raise ValueError(f"no own-key adapter for {provider}")


class OwnAdapters:
    """Adapters built on a participant's key, kept per (provider, hash of key)
    for the life of the process so polls reuse the adapter that submitted."""

    def __init__(self, sheets: dict[str, dict] | None = None, make=_make, limit: int = 256):
        if sheets is None:
            from providers import load_sheets

            sheets = load_sheets()
        self.sheets = {p: s for p, s in sheets.items() if p in PROVIDERS}
        self.make, self.limit = make, limit
        self._cache: OrderedDict[tuple[str, str], object] = OrderedDict()
        self._lock = threading.Lock()

    def sheet(self, provider: str) -> dict | None:
        return self.sheets.get(provider)

    def supports(self, provider: str, op: str) -> bool:
        sheet = self.sheet(provider)
        return bool(sheet) and op in sheet.get("ops", {})

    def get(self, provider: str, key: str):
        ident = (provider, hashlib.sha256(key.encode()).hexdigest())
        with self._lock:
            adapter = self._cache.get(ident)
            if adapter is None:
                adapter = self.make(provider, key)
                self._cache[ident] = adapter
                while len(self._cache) > self.limit:
                    self._cache.popitem(last=False)
            else:
                self._cache.move_to_end(ident)
            return adapter
