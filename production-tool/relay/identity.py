"""Who is asking: the one seam every route takes its person from (features/drop-hackathon-extras.clan,
features/os-sign-in.clan).

    who(method, path_and_query, headers, body) -> person | None
    person = {"pid", "h", "t", "name"?, "tenant": {"id", "agency"}}

pid is participant_id(agency, handle), h the handle, t the agency (the tenant), tenant.id the agency's
workspace id (UUIDv5 of "napkin:agency:<agency>", as napkin-web's TenantId::of_agency). None is no
identity: the relay answers 401 on every route but GET /health and GET /config. It fails closed: with
no source set, nobody is anyone.

Three sources, tried in this order:
- napkin-web's service credential (docs/contracts/production-tool-identity.md, features/production-jobs-via-host.clan):
  `Authorization: Bearer <service key>` plus `X-Napkin-User: <b64url claims>.<b64url HMAC>` naming the
  person, bound to this one request. The key is SERVICE_KEY ("new,old" during a rotation), re-read through
  the refresher handler.py hands use_secrets(). No bearer, or a wrong one, is no identity (401); a good
  bearer with a bad, expired or other-request claim is 401; a good bearer and signature whose claim names
  a tenant that is not its agency's is Forbidden (403).
- napkin-web's read-only assets pass (X-Napkin-Identity v1, aud "assets", signed with TOKEN_SECRET): good
  for GET /assets/{sha256} and nothing else. The per-user "relay" assertion is gone.
- The local person: relay/local.py with no SERVICE_KEY calls use_local(local_person()).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
import uuid

DEFAULT_LOCAL = ("local", "napkin")
HEADER = "x-napkin-identity"  # the assets pass
USER_HEADER = "x-napkin-user"  # the service credential's user claim
USER_DOMAIN = "napkin-user-v1"  # the first line of what the claim's HMAC covers
USER_MAX_LIFE_S = 120  # napkin-web signs 60; a claim longer than this is refused
ASSETS_AUDIENCE = "assets"
ASSETS_PATH = re.compile(r"/(?:api/)?assets/[^/?]+")
ASSETS_MAX_LIFE_S = 3600  # a pass longer than this is refused; napkin-web signs 1800
SKEW_S = 30
MAX_HEADER = 4096
MIN_KEY = 32

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


class Forbidden(Exception):
    """A valid service credential carrying a claim the relay will not act on (403, not 401)."""


def use_secrets(refresh) -> None:
    """The refresher called before every verification (handler.py: its one EnvSecrets)."""
    global _refresh
    _refresh = refresh


def _env_keys(name: str) -> list[str]:
    if _refresh is not None:
        _refresh()
    raw = os.environ.get(name, "")
    return [k.strip() for k in raw.split(",") if k.strip() and k.strip() != "PLACEHOLDER"]


def keys() -> list[str]:
    """The assets-pass keys (TOKEN_SECRET), newest first."""
    return _env_keys("TOKEN_SECRET")


def service_keys() -> list[str]:
    """The service keys (SERVICE_KEY), newest first. A key shorter than 32 characters is no key."""
    return [k for k in _env_keys("SERVICE_KEY") if len(k) >= MIN_KEY]


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
    """The person an X-Napkin-Identity v1 assets pass names, or None when anything about it is wrong."""
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
    if claims.get("aud") != ASSETS_AUDIENCE:
        return None  # the per-user "relay" assertion is retired: napkin-web uses the service credential
    if iat > now + SKEW_S or now > exp + SKEW_S:
        return None
    # A read-only pass for one agency's pictures (docs/contracts/production-tool-identity.md): good for any
    # GET /assets/{sha256}[?w=] until it expires, and for nothing else, so it is not bound to one path.
    if exp - iat > ASSETS_MAX_LIFE_S or method.upper() != "GET" or body:
        return None
    if not ASSETS_PATH.fullmatch(path_and_query.partition("?")[0]):
        return None
    handle = u.partition("@")[0].strip()
    if not handle or not a or t != tenant_id(a):
        return None
    name = claims.get("n")
    return person(handle, a, name if isinstance(name, str) and name.strip() else None)


def user_mac(key: str, method: str, path_and_query: str, body: bytes | None, claims_b64: str) -> str:
    """The HMAC over the request and the claim: what X-Napkin-User's second part is (napkin-web signs it)."""
    msg = "\n".join([USER_DOMAIN, method.upper(), path_and_query, hashlib.sha256(body or b"").hexdigest(), claims_b64])
    return _b64e(hmac.new(key.encode(), msg.encode(), hashlib.sha256).digest())


def sign_user(claims: dict, key: str, method: str, path_and_query: str, body: bytes | None) -> str:
    """An X-Napkin-User value (tests and the vector; napkin-web is the real signer)."""
    c = _b64e(json.dumps(claims, separators=(",", ":"), ensure_ascii=False).encode())
    return c + "." + user_mac(key, method, path_and_query, body, c)


def verify_service(authorization: str | None, user: str | None, method: str, path_and_query: str,
                   body: bytes | None, keys: list[str], now: float) -> dict | None:
    """The person napkin-web's service credential names. None (401) when the bearer, the signature, the time
    or the binding to this request is wrong; Forbidden (403) when everything checks out but the claim's
    tenant is not the one its agency has."""
    if not authorization or not user or not keys or len(user) > MAX_HEADER:
        return None
    scheme, _, bearer = authorization.partition(" ")
    if scheme.lower() != "bearer" or not bearer:
        return None
    # Every key is tried (no early exit on the first match), so timing does not say which one was close.
    ok = [k for k in keys if hmac.compare_digest(k.encode(), bearer.strip().encode())]
    if not ok:
        return None
    parts = user.split(".")
    if len(parts) != 2:
        return None
    try:
        sig = _b64d(parts[1])
    except ValueError:
        return None
    if not hmac.compare_digest(_b64d(user_mac(ok[0], method, path_and_query, body, parts[0])), sig):
        return None
    try:
        claims = json.loads(_b64d(parts[0]))
        u, a, t = str(claims["u"]), str(claims["a"]), str(claims["t"])
        iat, exp = float(claims["iat"]), float(claims["exp"])
    except (KeyError, TypeError, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(claims, dict) or iat > now + SKEW_S or now > exp + SKEW_S or exp - iat > USER_MAX_LIFE_S:
        return None
    handle = u.partition("@")[0].strip()
    if not handle or not a:
        return None
    if t != tenant_id(a):
        raise Forbidden("The signed claim names a tenant that is not its agency's.")
    name, doc = claims.get("n"), claims.get("doc")
    who = person(handle, a, name if isinstance(name, str) and name.strip() else None)
    if isinstance(doc, str) and doc.strip():
        who["doc"] = doc.strip()[:200]
    return who


def who(method: str, path_and_query: str, headers: dict, body: bytes | None, now: float | None = None) -> dict | None:
    if _local:
        return dict(_local)
    heads = {k.lower(): v for k, v in headers.items()}
    now = time.time() if now is None else now
    if heads.get("authorization"):
        return verify_service(heads.get("authorization"), heads.get(USER_HEADER), method, path_and_query, body,
                              service_keys(), now)
    return verify_assertion(heads.get(HEADER), method, path_and_query, body, keys(), now)
