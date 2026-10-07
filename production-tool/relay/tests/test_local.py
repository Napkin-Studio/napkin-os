"""The local dev server (relay/local.py) answers the browser's CORS preflight for every header the
web app sends; a header it leaves out makes the browser drop the request before it is sent."""

import local
import own_keys


def allowed() -> set[str]:
    return {h.strip().lower() for h in local.CORS_ALLOW_HEADERS.split(",")}


def test_preflight_allows_the_own_keys_header():
    # 2026-10-07: POST /jobs with X-Own-Keys never reached the local relay ("Could not reach the server").
    assert own_keys.HEADER.lower() in allowed()


def test_preflight_allows_the_other_headers_the_web_sends():
    assert {"authorization", "content-type", "x-clan-reason"} <= allowed()


def test_the_default_local_config_takes_own_keys_and_is_valid():
    from contracts import Contracts
    cfg = local.default_config()
    assert cfg["flags"]["ownKeys"] is True
    assert set(cfg["routing"]["generate"]) == {"mock"}  # no key: mock, as before
    assert not Contracts().errors("config.schema.json", cfg)
