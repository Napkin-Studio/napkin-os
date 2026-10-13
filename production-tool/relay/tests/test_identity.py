"""napkin-web's X-Napkin-Identity v1 assertion (docs/contracts/production-tool-identity.md,
features/os-sign-in.clan): the relay's Function URL is public, so anything wrong about an assertion
is no person (401), and the shared vector keeps the signer and the verifier in step."""

import hashlib
import json

import pytest

import identity
from contracts_dir import contracts_dir
from identity import sign, tenant_id, verify_assertion
from runtime import EnvSecrets

KEY = "k" * 40
NOW = 1_791_360_000
BODY = b'{"op":"generate"}'


def claims(**over):
    c = {"u": "visionary@napkin", "a": "napkin", "t": tenant_id("napkin"), "n": "Laurance", "aud": "relay",
         "iat": NOW, "exp": NOW + 60, "m": "POST", "p": "/api/jobs?x=1", "bh": hashlib.sha256(BODY).hexdigest()}
    c.update(over)
    return {k: v for k, v in c.items() if v is not None}


def check(token, method="POST", pq="/api/jobs?x=1", body=BODY, keys=(KEY,), now=NOW + 5):
    return verify_assertion(token, method, pq, body, list(keys), now)


def test_the_shared_vector():
    vec = json.loads((contracts_dir() / "examples" / "identity-assertion.vector.json").read_text())
    assert sign(vec["claims"], vec["key"]) == vec["assertion"]
    who = verify_assertion(vec["assertion"], vec["method"], vec["pathAndQuery"], vec["body"].encode(),
                           [vec["key"]], vec["now"])
    assert who == vec["person"]


def test_a_good_assertion_names_the_person_and_tenant():
    who = check(sign(claims(), KEY))
    assert (who["h"], who["t"], who["name"]) == ("visionary", "napkin", "Laurance")
    assert who["tenant"] == {"id": tenant_id("napkin"), "agency": "napkin"}
    assert who["pid"] == identity.person("visionary", "napkin")["pid"]
    assert "name" not in check(sign(claims(n=None), KEY))


@pytest.mark.parametrize("token", [
    None, "", "v1", "v1.x", "v2.e30.e30", "v1.e30.e30", "v1.!!!.???",
])
def test_malformed_is_nobody(token):
    assert check(token) is None


def test_a_wrong_or_missing_key_is_nobody():
    assert check(sign(claims(), "another-key-" + "x" * 30)) is None
    assert check(sign(claims(), KEY), keys=()) is None
    good = sign(claims(), KEY)
    head, body, sig = good.split(".")
    tampered = sign(claims(u="engineer@napkin"), KEY).split(".")[1]
    assert check(f"{head}.{tampered}.{sig}") is None  # claims swapped under the old signature


def test_rotation_takes_new_and_old_and_dropping_old_refuses_it():
    old, new = "old-" + "o" * 32, "new-" + "n" * 32
    assert check(sign(claims(), old), keys=(new, old)) is not None
    assert check(sign(claims(), new), keys=(new, old)) is not None
    assert check(sign(claims(), old), keys=(new,)) is None


def test_time_is_checked_with_30_s_of_skew():
    token = sign(claims(), KEY)
    assert check(token, now=NOW + 60 + 30) is not None
    assert check(token, now=NOW + 60 + 31) is None  # expired
    assert check(token, now=NOW - 30) is not None
    assert check(token, now=NOW - 31) is None  # issued in the future


@pytest.mark.parametrize("over", [
    {"aud": "collab"}, {"aud": None}, {"t": tenant_id("other")}, {"a": "other"}, {"u": "@napkin"},
    {"iat": None}, {"exp": None},
])
def test_wrong_claims_are_nobody(over):
    assert check(sign(claims(**over), KEY)) is None


def test_the_assertion_is_bound_to_this_request():
    token = sign(claims(), KEY)
    assert check(token, method="GET") is None
    assert check(token, pq="/api/jobs") is None  # the query was dropped
    assert check(token, pq="/api/jobs?x=2") is None
    assert check(token, pq="/api/me?x=1") is None
    assert check(token, body=b'{"op":"clip"}') is None
    assert check(token, body=None) is None
    empty = sign(claims(m="GET", p="/api/me", bh=hashlib.sha256(b"").hexdigest()), KEY)
    assert check(empty, method="GET", pq="/api/me", body=None) is not None


def test_who_reads_the_header_and_the_secret(monkeypatch):
    monkeypatch.setattr(identity, "_local", None)
    monkeypatch.setattr(identity, "_refresh", None)
    monkeypatch.setenv("TOKEN_SECRET", f" {KEY} , PLACEHOLDER")
    token = sign(claims(), KEY)
    assert identity.who("POST", "/api/jobs?x=1", {"X-Napkin-Identity": token}, BODY, now=NOW)["h"] == "visionary"
    assert identity.who("POST", "/api/jobs?x=1", {}, BODY, now=NOW) is None
    monkeypatch.delenv("TOKEN_SECRET")
    assert identity.who("POST", "/api/jobs?x=1", {"X-Napkin-Identity": token}, BODY, now=NOW) is None


def test_the_local_person_only_under_local_py(monkeypatch):
    monkeypatch.setattr(identity, "_local", None)
    monkeypatch.delenv("TOKEN_SECRET", raising=False)
    assert identity.who("GET", "/me", {}, None) is None
    identity.use_local(identity.local_person("ann@acme"))
    try:
        who = identity.who("GET", "/me", {}, None)
        assert (who["h"], who["tenant"]["agency"]) == ("ann", "acme")
    finally:
        identity.use_local(None)


class FakeSM:
    def __init__(self):
        self.value, self.calls = "first-" + "a" * 32, 0

    def get_secret_value(self, SecretId):
        self.calls += 1
        return {"SecretString": self.value}


def test_a_warm_instance_picks_up_a_rotated_secret(monkeypatch):
    """The verifier calls the shared EnvSecrets each request, so its 5-minute TTL actually fires."""
    t = [1000.0]
    sm = FakeSM()
    monkeypatch.setenv("SECRET_ARNS", json.dumps({"TOKEN_SECRET": "arn:token"}))
    monkeypatch.setenv("TOKEN_SECRET", "")  # so the value EnvSecrets writes is undone after the test
    monkeypatch.setattr(identity, "_local", None)
    secrets = EnvSecrets(sm_client=sm, clock=lambda: t[0])
    monkeypatch.setattr(identity, "_refresh", secrets)
    assert identity.keys() == ["first-" + "a" * 32]
    sm.value = "second-" + "b" * 32 + ",first-" + "a" * 32
    t[0] += 299
    assert identity.keys() == ["first-" + "a" * 32]  # cached
    t[0] += 2
    assert identity.keys() == ["second-" + "b" * 32, "first-" + "a" * 32]  # 301 s later, no rebuild
    assert sm.calls == 2
