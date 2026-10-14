"""The local dev server (relay/local.py): it answers the browser's CORS preflight for every header the
web app sends (a header it leaves out makes the browser drop the request before it is sent), and every
request is the local person (identity.py, features/drop-hackathon-extras.clan)."""

import identity
import local


def allowed() -> set[str]:
    return {h.strip().lower() for h in local.CORS_ALLOW_HEADERS.split(",")}


def test_preflight_allows_the_headers_the_web_sends():
    assert {"content-type", "x-clan-reason", "x-project-id", "x-project-name", "if-match"} <= allowed()
    assert "x-amz-checksum-sha256" in allowed()  # the upload's putHeaders (features/tenant-limits.clan)


def test_local_agencies_take_the_limits_named_in_the_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("NAPKIN_LOCAL_USER", "shrey@acme")
    monkeypatch.delenv("TOKEN_SECRET", raising=False)
    monkeypatch.delenv("NAPKIN_LOCAL_TENANTS", raising=False)
    monkeypatch.setenv("NAPKIN_LOCAL_LIMITS", '{"dailyQuotas": true, "allow": {"claude": false, "makers": ["runway"]}}')
    try:
        relay, _ = local.build(8797, tmp_path)
        status, me, _ = relay.http("GET", "/me", {}, None)
    finally:
        identity.use_local(None)
    assert status == 200 and me["allow"] == {"claude": False, "makers": ["runway"]} and me["quotas"]["image"] > 0


def test_the_default_local_config_runs_on_mock_and_is_valid():
    from contracts import Contracts
    cfg = local.default_config()
    assert set(cfg["routing"]["generate"]) == {"mock"}
    assert not Contracts().errors("config.schema.json", cfg)


def test_the_local_server_runs_as_the_local_person(tmp_path, monkeypatch):
    monkeypatch.setenv("NAPKIN_LOCAL_USER", "shrey@acme")
    monkeypatch.delenv("TOKEN_SECRET", raising=False)
    monkeypatch.delenv("NAPKIN_LOCAL_TENANTS", raising=False)
    try:
        relay, _ = local.build(8798, tmp_path)
        status, me, _ = relay.http("GET", "/me", {}, None)
    finally:
        identity.use_local(None)
    assert status == 200 and (me["handle"], me["team"]) == ("shrey", "acme")
    assert me["tenant"] == {"id": identity.tenant_id("acme"), "agency": "acme"}  # the local agency is on
    assert identity.who("GET", "/me", {}, None) is None  # off again: nothing else runs as anyone


def test_behind_napkin_web_the_local_server_checks_assertions(tmp_path, monkeypatch):
    """The full-stack dev path: TOKEN_SECRET set, so no local person; napkin enabled, others not."""
    import hashlib
    import time

    key = "dev-secret-" + "x" * 32
    monkeypatch.setenv("TOKEN_SECRET", key)
    monkeypatch.delenv("NAPKIN_LOCAL_TENANTS", raising=False)
    monkeypatch.setattr(identity, "_refresh", None)
    relay, _ = local.build(8799, tmp_path)
    assert relay.http("GET", "/me", {}, None)[0] == 401

    def signed(agency):
        now = int(time.time())
        claims = {"u": f"engineer@{agency}", "a": agency, "t": identity.tenant_id(agency), "aud": "relay",
                  "iat": now, "exp": now + 60, "m": "GET", "p": "/api/me", "bh": hashlib.sha256(b"").hexdigest()}
        return {"X-Napkin-Identity": identity.sign(claims, key)}

    status, me, _ = relay.http("GET", "/api/me", signed("napkin"), None)
    assert status == 200 and (me["handle"], me["tenant"]["agency"]) == ("engineer", "napkin")
    status, out, _ = relay.http("GET", "/api/me", signed("otheragency"), None)
    assert status == 403 and out["error"]["code"] == "flag_off"
