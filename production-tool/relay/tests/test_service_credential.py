"""napkin-web's service credential through the whole relay (features/production-jobs-via-host.clan, S3-2 and S3-4):
no credential and a wrong one are 401, a good bearer with a claim for another agency is 403, a good credential
is 200, and a job started under it is counted in the same agency month, the same cap and the same global stop as
any other. The ledger, reservation and durable-job suites are untouched; this file only changes who asks."""

import json

import pytest

import identity
from conftest import job_request
from director import new_id
from identity import sign_user, tenant_id
from test_ledger import month_used, runway_only, total

KEY = "service-key-" + "x" * 32


@pytest.fixture
def h(monkeypatch):
    """The relay under the real identity seam, keyed by SERVICE_KEY, with time from the test clock."""
    monkeypatch.setattr(identity, "_local", None)
    monkeypatch.setattr(identity, "_refresh", None)
    monkeypatch.setenv("SERVICE_KEY", KEY)
    monkeypatch.delenv("TOKEN_SECRET", raising=False)
    h = runway_only()
    h.relay.who = lambda m, p, hd, b: identity.who(m, p, hd, b, now=h.clock())
    return h


def ask(h, method, path, body=None, agency="blue", handle="alice", bearer=KEY, key=KEY, claim=None, user=True):
    raw = json.dumps(body).encode() if body is not None else None
    now = int(h.clock())
    c = {"u": f"{handle}@{agency}", "a": agency, "t": tenant_id(agency), "doc": "doc_1", "iat": now, "exp": now + 60}
    c.update(claim or {})
    p, _, query = path.partition("?")
    headers = {"Authorization": f"Bearer {bearer}"}
    if user:
        headers["X-Napkin-User"] = sign_user(c, key, method, path, raw)
    status, out, _ = h.relay.http(method, p, headers, raw, query)
    return status, out


def job(h, **kw):
    return ask(h, "POST", "/jobs", job_request("generate", new_id("job")), **kw)


def test_no_credential_and_wrong_credentials_are_401(h):
    h.tenant("blue")
    for method, path in (("GET", "/me"), ("POST", "/jobs"), ("GET", "/jobs/job_x"), ("GET", "/library")):
        status, out, _ = h.relay.http(method, path, {}, b"{}" if method == "POST" else None)
        assert status == 401 and out["error"]["code"] == "unauthorised", path
    assert ask(h, "GET", "/me", bearer="not-the-key")[0] == 401  # wrong bearer
    assert ask(h, "GET", "/me", user=False)[0] == 401  # bearer alone names nobody
    assert ask(h, "GET", "/me", key="another-key-" + "y" * 32)[0] == 401  # claim signed with another key
    assert ask(h, "GET", "/me", claim={"exp": int(h.clock()) - 100, "iat": int(h.clock()) - 160})[0] == 401  # expired
    assert not h.store.all_jobs()


def test_a_claim_for_another_agency_is_403_a_good_one_is_200(h):
    h.tenant("blue")
    h.tenant("green")
    status, out = ask(h, "GET", "/me", claim={"t": tenant_id("green")})  # blue's name, green's tenant
    assert status == 403 and out["error"]["code"] == "not_allowed"
    status, out = ask(h, "POST", "/jobs", job_request("generate", new_id("job")), claim={"a": "green"})
    assert status == 403 and not h.store.all_jobs()
    status, me = ask(h, "GET", "/me")
    assert status == 200 and me["tenant"] == {"id": tenant_id("blue"), "agency": "blue"} and me["handle"] == "alice"
    assert job(h)[0] == 200


def test_one_agency_cannot_read_anothers_job_under_the_credential(h):
    h.tenant("blue")
    h.tenant("green")
    _, made = job(h)
    assert ask(h, "GET", f"/jobs/{made['jobId']}")[0] == 200
    assert ask(h, "GET", f"/jobs/{made['jobId']}", agency="green")[0] == 404
    assert ask(h, "DELETE", f"/jobs/{made['jobId']}", agency="green")[0] == 404


def test_the_credential_is_bound_to_the_request(h):
    h.tenant("blue")
    raw = json.dumps(job_request("generate", new_id("job"))).encode()
    now = int(h.clock())
    c = {"u": "alice@blue", "a": "blue", "t": tenant_id("blue"), "iat": now, "exp": now + 60}
    headers = {"Authorization": f"Bearer {KEY}", "X-Napkin-User": sign_user(c, KEY, "POST", "/jobs", raw)}
    assert h.relay.http("POST", "/jobs", headers, raw)[0] == 200
    other = json.dumps(job_request("generate", new_id("job"))).encode()
    assert h.relay.http("POST", "/jobs", headers, other)[0] == 401  # same header, another body
    assert h.relay.http("DELETE", "/jobs/x", headers, None)[0] == 401  # same header, another call


def test_a_job_under_the_credential_is_counted_in_the_agency_cap(h):
    h.limits("blue", capUsdMonthly=0.5)
    assert job(h)[0] == 200 and job(h)[0] == 200
    status, out = job(h)
    assert status == 429 and out["error"]["code"] == "limit_reached"
    assert month_used(h, "blue") == pytest.approx(0.4) == total(h)
    assert job(h, handle="sai")[0] == 429  # the cap is the agency's, not the person's
    assert job(h, agency="green", handle="sai")[0] == 403  # green is not on: no job, no spend
    h.tenant("green")
    assert job(h, agency="green", handle="sai")[0] == 200  # another agency is untouched


def test_a_job_under_the_credential_is_counted_in_the_global_stop(monkeypatch):
    monkeypatch.setattr(identity, "_local", None)
    monkeypatch.setattr(identity, "_refresh", None)
    monkeypatch.setenv("SERVICE_KEY", KEY)
    h = runway_only(spend={"capUsd": 0.3, "warnUsd": 0.2})
    h.relay.who = lambda m, p, hd, b: identity.who(m, p, hd, b, now=h.clock())
    h.tenant("blue")
    h.tenant("green")
    assert job(h)[0] == 200
    status, out = job(h, agency="green", handle="sai")  # green has headroom; the global total does not
    assert status == 503 and out["error"]["code"] == "spend_stop" and month_used(h, "green") == 0
    assert total(h) == pytest.approx(0.2)
