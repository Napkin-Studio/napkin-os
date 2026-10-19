"""The local dev server (relay/local.py): it answers the browser's CORS preflight for every header the
web app sends (a header it leaves out makes the browser drop the request before it is sent), and every
request is the local person (identity.py, features/drop-hackathon-extras.clan)."""

import identity
import local


def allowed() -> set[str]:
    return {h.strip().lower() for h in local.CORS_ALLOW_HEADERS.split(",")}


def test_preflight_allows_the_headers_the_web_sends():
    assert {"authorization", "content-type", "x-clan-reason", "x-project-id", "x-project-name", "if-match"} <= allowed()


def test_the_default_local_config_runs_on_mock_and_is_valid():
    from contracts import Contracts
    cfg = local.default_config()
    assert set(cfg["routing"]["generate"]) == {"mock"}
    assert not Contracts().errors("config.schema.json", cfg)


def test_the_local_server_runs_as_the_local_person(tmp_path, monkeypatch):
    monkeypatch.setenv("NAPKIN_LOCAL_USER", "shrey@napkin")
    try:
        relay, _ = local.build(8798, tmp_path)
        status, me, _ = relay.http("GET", "/me", {}, None)
    finally:
        identity.use_local(None)
    assert status == 200 and (me["handle"], me["team"]) == ("shrey", "napkin")
    assert identity.who({}) is None  # off again: nothing else runs as anyone
