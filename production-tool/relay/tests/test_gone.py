"""The relay's document routes are retired (features/production-in-library.clan): projects live in the
library of Napkin OS. For one release every method on /clan* and /projects* answers 410 `gone`, signed in
or not, so a stale page learns where to go; the code is deleted after that."""

import pytest

GONE = {"error": {"code": "gone", "message": "Reload the page: projects now live in the library.", "retryable": False}}
A = "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N8"

ROUTES = [
    ("POST", "/clan"), ("GET", "/projects"), ("GET", f"/clan/{A}"), ("PUT", f"/clan/{A}"),
    ("GET", f"/clan/{A}/canvas"), ("PUT", f"/clan/{A}/canvas"), ("POST", "/clan/"), ("GET", f"/projects/{A}"),
    ("POST", "/projects"),
]


@pytest.mark.parametrize("method,path", ROUTES)
@pytest.mark.parametrize("prefix", ["", "/api"])
def test_every_document_route_is_gone(h, method, path, prefix):
    token = h.as_person()
    for headers in ({"Authorization": f"Bearer {token}", "X-Project-Id": A}, {}):
        status, out, _ = h.relay.http(method, prefix + path, headers, b"PK\x03\x04x")
        assert (status, out) == (410, GONE), (headers, status, out)
        assert not h.contracts.errors("relay-api.schema.json#/$defs/ErrorResponse", out), out


def test_nothing_is_stored_and_the_other_routes_stand(h):
    token = h.as_person()
    h.relay.http("POST", "/api/clan", {"Authorization": f"Bearer {token}", "X-Project-Id": A}, b"PK\x03\x04x")
    assert not [k for k in h.blobs.objects if k.startswith(("clan/", "tenants/"))]
    assert h.call("GET", "/me", None, token, expect=200)[1]["projects"] == 0
    h.call("GET", "/library/agency", None, token, expect=200)
    h.call("GET", "/health", expect=200)
    h.call("GET", "/clanx", None, token, expect=404)  # only the two prefixes
