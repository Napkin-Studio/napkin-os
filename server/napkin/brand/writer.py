"""Writing the result through the host, as `process:brand_build` (contract 7). This module is the only place the job leaves the middleware.

  create(client, body)             -> the View of the new Brand Clan (`create`: {name, candidate, source, from}); the candidate names its files
  put_asset(doc, name, data, type) -> the path the host gave a file (`asset.put`, into an existing document)
  proposal_set(doc, body)          -> the View with `pending` (`proposal.set`: {candidate, source, from})

Order (contract 7): a first build is `create` with the candidate naming each file `human/assets/<sha10>-<name>` (`asset_path`), then `asset.put` each
file into the new document; an update is `asset.put` into the existing document, then `proposal.set`.

`HttpWriter` speaks the routes of contract section 5 on napkin-web, with the service credential (`Authorization: Bearer NAPKIN_BRAND_HOST_TOKEN`, no cookie); a test gives the job a fake that records the calls. The actor is
named on the request (`X-Napkin-Actor: process:brand_build`) and the host records it from its context, never from the body. A write
that fails raises `HostWriteError`; the job then ends `failed` with the host's status and the reason, and nothing was half-made on
the middleware's side."""

import hashlib

import httpx

ACTOR = "process:brand_build"


def asset_path(name: str, data: bytes) -> str:
    """The host's naming rule for a file (contract 7): `human/assets/<sha10>-<name>`, sha10 the first 10 hex digits of the SHA-256 of its bytes."""
    return f"human/assets/{hashlib.sha256(data).hexdigest()[:10]}-{name}"


class HostWriteError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


class HttpWriter:
    def __init__(self, base_url: str, tenant: str, token: str, timeout: float = 120.0, transport=None):
        self.base, self.tenant = base_url.rstrip("/"), tenant
        self.http = httpx.Client(timeout=timeout, transport=transport, headers={"X-Napkin-Actor": ACTOR, "Authorization": f"Bearer {token}"})

    def _url(self, path: str) -> str:
        return f"{self.base}/api/t/{self.tenant}{path}"

    def _ok(self, r: httpx.Response) -> dict:
        if r.status_code >= 300:
            try:
                msg = (r.json().get("error") or {}).get("message") if r.headers.get("content-type", "").startswith("application/json") else None
            except ValueError:
                msg = None
            raise HostWriteError(r.status_code, msg or "the host refused the write")
        return r.json()

    def put_asset(self, doc: str, name: str, data: bytes, media_type: str) -> str:
        r = self.http.post(self._url(f"/brand-clans/{doc}/assets"), params={"name": name}, content=data,
                           headers={"Content-Type": media_type or "application/octet-stream"})
        return self._ok(r)["path"]

    def create(self, client: str, body: dict) -> dict:
        return self._ok(self.http.post(self._url(f"/clients/{client}/brand-clans"), json=body))

    def proposal_set(self, doc: str, body: dict) -> dict:
        return self._ok(self.http.post(self._url(f"/brand-clans/{doc}/proposal"), json=body))


def writer_for(settings, workspace: str):
    """The writer for one agency's workspace (the `{tenant}` of the path), or None when no host or service token is configured
    (brand_build is then refused 503 before it spends)."""
    token = getattr(settings, "brand_host_token", None)
    if not getattr(settings, "brand_host_url", None) or not token or len(token) < 32:
        return None
    return HttpWriter(settings.brand_host_url, workspace, token)
