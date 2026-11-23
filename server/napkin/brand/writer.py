"""Writing the result through the host, as `process:brand_build` (contract 7). This module is the only place the job leaves the middleware.

  put_asset(client, doc, name, data, media_type) -> the path `human/assets/<name>` the host gave it
  create(client, body)                           -> the View of the new Brand Clan (`create`: {name, candidate, source, from})
  proposal_set(doc, body)                        -> the View with `pending` (`proposal.set`: {candidate, source, from})

`HttpWriter` speaks the routes of contract section 5 on napkin-web; a test gives the job a fake that records the calls. The actor is
named on the request (`X-Napkin-Actor: process:brand_build`) and the host records it from its context, never from the body. A write
that fails raises `HostWriteError`; the job then ends `failed` with the host's status and the reason, and nothing was half-made on
the middleware's side."""

import httpx

ACTOR = "process:brand_build"


class HostWriteError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


class HttpWriter:
    def __init__(self, base_url: str, tenant: str, token: str | None = None, timeout: float = 120.0, transport=None):
        self.base, self.tenant = base_url.rstrip("/"), tenant
        self.http = httpx.Client(timeout=timeout, transport=transport,
                                 headers={"X-Napkin-Actor": ACTOR, **({"Authorization": f"Bearer {token}"} if token else {})})

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

    def put_asset(self, client: str, doc: str | None, name: str, data: bytes, media_type: str) -> str:
        url = self._url(f"/brand-clans/{doc}/assets" if doc else f"/clients/{client}/brand-clans/assets")
        r = self.http.post(url, params={"name": name}, content=data, headers={"Content-Type": media_type or "application/octet-stream"})
        return self._ok(r)["path"]

    def create(self, client: str, body: dict) -> dict:
        return self._ok(self.http.post(self._url(f"/clients/{client}/brand-clans"), json=body))

    def proposal_set(self, doc: str, body: dict) -> dict:
        return self._ok(self.http.post(self._url(f"/brand-clans/{doc}/proposal"), json=body))


def writer_for(settings):
    """The configured writer, or None (no host to write to: brand_build is refused 503 before it spends)."""
    if not getattr(settings, "brand_host_url", None):
        return None
    tenant = getattr(settings, "brand_tenant", None) or settings.org.rsplit("/", 1)[-1]
    return HttpWriter(settings.brand_host_url, tenant, getattr(settings, "brand_host_token", None))
