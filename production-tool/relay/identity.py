"""Who is asking: the one seam every route takes its person from (features/drop-hackathon-extras.clan,
features/os-sign-in.clan).

    who(method, path_and_query, headers, body) -> person | None
    person = {"pid", "h", "t", "name"?, "tenant": {"id", "agency"}}

pid is participant_id(agency, handle), h the handle, t the agency (the tenant), tenant.id the agency's
workspace id (UUIDv5 of "napkin:agency:<agency>", as napkin-web's TenantId::of_agency). None is no
identity: the relay answers 401 on every route but GET /health and GET /config. It fails closed: with
no source set, nobody is anyone.

Two sources:
- napkin-web's X-Napkin-Identity v1 assertion (docs/contracts/production-tool-identity.md), signed
  with a key in TOKEN_SECRET ("new,old" during a rotation). The keys are re-read through the
  refresher handler.py hands use_secrets() (Secrets Manager, at most every 5 minutes).
- The local person: relay/local.py with no TOKEN_SECRET calls use_local(local_person()).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import uuid

DEFAULT_LOCAL = ("local", "napkin")
HEADER = "x-napkin-identity"
AUDIENCE = "relay"
SKEW_S = 30
MAX_HEADER = 4096

_local: dict | None = None
_refresh = None  # () -> None: puts TOKEN_SECRET into os.environ when it is due (runtime.EnvSecrets)


def tenant_id(agency: str) -> str:
    """The agency's workspace id: napkin-web's TenantId::of_agency."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"napkin:agency:{agency}"))


def person(handle: str, team: str, name: str | None = None) -> dict:
    from service import participant_id  # service imports this module

    out = {"pid": participant_id(team, handle), "h": handle, "t": team,
           "tenant": {"id": tenant_id(team), "agency": team}}
    if name:
        out["name"] = name
    return out


def local_person(spec: str | None = None) -> dict:
    """The person local.py runs as: NAPKIN_LOCAL_USER ("handle@agency"), else local@napkin."""
    spec = (os.environ.get("NAPKIN_LOCAL_USER", "") if spec is None else spec).strip()
    handle, _, team = spec.partition("@")
    handle, team = handle.strip(), " ".join(team.split())
    if not handle or not team:
        handle, team = DEFAULT_LOCAL
    return person(handle, team)


def use_local(who: dict | None) -> None:
    """Every request is this person (local.py only; None turns it off)."""
    global _local
    _local = dict(who) if who else None


def use_secrets(refresh) -> None:
    """The refresher called before every verification (handler.py: its one EnvSecrets)."""
    global _refresh
    _refresh = refresh


def keys() -> list[str]:
    """The assertion keys, newest first."""
    if _refresh is not None:
        _refresh()
    raw = os.environ.get("TOKEN_SECRET", "")
    return [k.strip() for k in raw.split(",") if k.strip() and k.strip() != "PLACEHOLDER"]


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def sign(claims: dict, key: str) -> str:
    """An assertion over these claims (tests and the vector; napkin-web is the real signer)."""
    head = "v1." + _b64e(json.dumps(claims, separators=(",", ":"), ensure_ascii=False).encode())
    return head + "." + _b64e(hmac.new(key.encode(), head.encode(), hashlib.sha256).digest())


def verify_assertion(header: str | None, method: str, path_and_query: str, body: bytes | None,
                     keys: list[str], now: float) -> dict | None:
    """The person an X-Napkin-Identity v1 assertion names, or None when anything about it is wrong."""
    if not header or not keys or len(header) > MAX_HEADER:
        return None
    parts = header.split(".")
    if len(parts) != 3 or parts[0] != "v1":
        return None
    head = f"{parts[0]}.{parts[1]}".encode()
    try:
        sig = _b64d(parts[2])
    except ValueError:
        return None
    if not any(hmac.compare_digest(hmac.new(k.encode(), head, hashlib.sha256).digest(), sig) for k in keys):
        return None
    try:
        claims = json.loads(_b64d(parts[1]))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(claims, dict):
        return None
    try:
        u, a, t = str(claims["u"]), str(claims["a"]), str(claims["t"])
        iat, exp = float(claims["iat"]), float(claims["exp"])
    except (KeyError, TypeError, ValueError):
        return None
    if claims.get("aud") != AUDIENCE:
        return None
    if iat > now + SKEW_S or now > exp + SKEW_S:
        return None
    if claims.get("m") != method.upper() or claims.get("p") != path_and_query:
        return None
    if claims.get("bh") != hashlib.sha256(body or b"").hexdigest():
        return None
    handle = u.partition("@")[0].strip()
    if not handle or not a or t != tenant_id(a):
        return None
    name = claims.get("n")
    return person(handle, a, name if isinstance(name, str) and name.strip() else None)


def who(method: str, path_and_query: str, headers: dict, body: bytes | None, now: float | None = None) -> dict | None:
    if _local:
        return dict(_local)
    heads = {k.lower(): v for k, v in headers.items()}
    return verify_assertion(heads.get(HEADER), method, path_and_query, body, keys(),
                            time.time() if now is None else now)
