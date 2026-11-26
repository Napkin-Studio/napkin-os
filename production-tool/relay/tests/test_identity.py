"""napkin-web's service credential (docs/contracts/production-tool-identity.md,
features/production-jobs-via-host.clan): the relay's Function URL is public, so a missing or wrong bearer,
a bad signature, an expired claim or a claim bound to another request is no person (401), and a good
credential whose claim names a tenant that is not its agency's is a 403. The shared vector keeps napkin-web's
signer and this verifier in step. The assets pass (aud "assets", TOKEN_SECRET) is tested at the end."""

import hashlib
import json

import pytest

import identity
from contracts_dir import contracts_dir
from identity import Forbidden, sign, sign_user, tenant_id, verify_assertion, verify_service
from runtime import EnvSecrets

KEY = "k" * 40
KEY2 = "s" * 40
NOW = 1_791_360_000
BODY = b'{"op":"generate"}'
PQ = "/api/jobs?x=1"


def claims(**over):
    c = {"u": "visionary@napkin", "a": "napkin", "t": tenant_id("napkin"), "n": "Laurance", "doc": "doc_1",
         "iat": NOW, "exp": NOW + 60}
    c.update(over)
    return {k: v for k, v in c.items() if v is not None}


def creds(cl=None, key=KEY, bearer=None, method="POST", pq=PQ, body=BODY):
    return "Bearer " + (bearer or key), sign_user(cl or claims(), key, method, pq, body)


def check(cred, method="POST", pq=PQ, body=BODY, keys=(KEY,), now=NOW + 5):
    auth, user = cred
    return verify_service(auth, user, method, pq, body, list(keys), now)


def test_the_shared_vector():
    vec = json.loads((contracts_dir() / "examples" / "service-credential.vector.json").read_text())
    assert sign_user(vec["claims"], vec["key"], vec["method"], vec["pathAndQuery"], vec["body"].encode()) == vec["userHeader"]
    who = verify_service(vec["authorization"], vec["userHeader"], vec["method"], vec["pathAndQuery"],
                         vec["body"].encode(), [vec["key"]], vec["now"])
    assert who == vec["person"]


def test_a_good_credential_names_the_person_and_tenant():
    who = check(creds())
    assert (who["h"], who["t"], who["name"], who["doc"]) == ("visionary", "napkin", "Laurance", "doc_1")
    assert who["tenant"] == {"id": tenant_id("napkin"), "agency": "napkin"}
    assert who["pid"] == identity.person("visionary", "napkin")["pid"]
    bare = check(creds(claims(n=None, doc=None)))
    assert "name" not in bare and "doc" not in bare


@pytest.mark.parametrize("auth,user", [
    (None, None), ("", ""), ("Bearer", "x.y"), ("Basic abc", "x.y"), ("Bearer " + KEY, None), ("Bearer " + KEY, ""),
    ("Bearer " + KEY, "x"), ("Bearer " + KEY, "x.y.z"), ("Bearer " + KEY, "!!!.???"), (None, "x.y"),
])
def test_malformed_is_nobody(auth, user):
    assert verify_service(auth, user, "POST", PQ, BODY, [KEY], NOW) is None


def test_no_bearer_or_a_wrong_bearer_is_nobody():
    auth, user = creds()
    assert verify_service(None, user, "POST", PQ, BODY, [KEY], NOW) is None
    assert check(("Bearer " + "x" * 40, user)) is None
    assert check((auth, user), keys=()) is None
    # a valid bearer does not rescue a claim signed under another key, and the reverse
    assert check(("Bearer " + KEY, sign_user(claims(), KEY2, "POST", PQ, BODY))) is None
    assert check(("Bearer " + KEY2, sign_user(claims(), KEY, "POST", PQ, BODY)), keys=(KEY, KEY2)) is None


def test_a_claim_without_the_signature_for_it_is_nobody():
    auth, user = creds()
    head, sig = user.split(".")
    swapped = sign_user(claims(u="engineer@napkin"), KEY, "POST", PQ, BODY).split(".")[0]
    assert check((auth, f"{swapped}.{sig}")) is None  # claims swapped under the old signature


def test_rotation_takes_new_and_old_and_dropping_old_refuses_it():
    old, new = "old-" + "o" * 32, "new-" + "n" * 32
    assert check(creds(key=old), keys=(new, old)) is not None
    assert check(creds(key=new), keys=(new, old)) is not None
    assert check(creds(key=old), keys=(new,)) is None


def test_time_is_checked_with_30_s_of_skew():
    c = creds()
    assert check(c, now=NOW + 60 + 30) is not None
    assert check(c, now=NOW + 60 + 31) is None  # expired
    assert check(c, now=NOW - 30) is not None
    assert check(c, now=NOW - 31) is None  # issued in the future
    assert check(creds(claims(exp=NOW + 121))) is None  # longer than the relay allows
    assert check(creds(claims(exp=NOW + 120))) is not None


@pytest.mark.parametrize("over", [{"iat": None}, {"exp": None}, {"u": "@napkin"}, {"u": None}, {"a": ""}, {"t": None}])
def test_claims_that_do_not_make_a_person_are_nobody(over):
    assert check(creds(claims(**over))) is None


def test_a_claim_for_another_agency_is_forbidden_not_unauthorised():
    # t is another agency's tenant id: the signature and bearer are good, so this is 403, not 401
    for over in ({"t": tenant_id("other")}, {"a": "other"}):
        with pytest.raises(Forbidden):
            check(creds(claims(**over)))
    # but a forged signature never reaches that check: 401
    assert check(("Bearer " + KEY, sign_user(claims(a="other"), KEY2, "POST", PQ, BODY))) is None


def test_the_claim_is_bound_to_this_request():
    c = creds()
    assert check(c, method="GET") is None
    assert check(c, pq="/api/jobs") is None  # the query was dropped
    assert check(c, pq="/api/jobs?x=2") is None
    assert check(c, pq="/api/me?x=1") is None
    assert check(c, body=b'{"op":"clip"}') is None
    assert check(c, body=None) is None
    empty = creds(claims(), method="GET", pq="/api/me", body=None)
    assert check(empty, method="GET", pq="/api/me", body=None) is not None
    # no replay protection beyond that: the same request inside 60 s is accepted again (the contract has no nonce);
    # a job's own id makes a replayed POST /jobs the same job (relay idempotency, test_relay.py)
    assert check(c) is not None and check(c) is not None


def test_a_short_service_key_is_no_key(monkeypatch):
    monkeypatch.setattr(identity, "_refresh", None)
    monkeypatch.setenv("SERVICE_KEY", "short, PLACEHOLDER")
    assert identity.service_keys() == []
    monkeypatch.setenv("SERVICE_KEY", f" {KEY} , {KEY2}")
    assert identity.service_keys() == [KEY, KEY2]


def test_who_reads_the_headers_and_the_secret(monkeypatch):
    monkeypatch.setattr(identity, "_local", None)
    monkeypatch.setattr(identity, "_refresh", None)
    monkeypatch.setenv("SERVICE_KEY", f" {KEY} , PLACEHOLDER")
    monkeypatch.delenv("TOKEN_SECRET", raising=False)
    auth, user = creds()
    heads = {"Authorization": auth, "X-Napkin-User": user}
    assert identity.who("POST", PQ, heads, BODY, now=NOW)["h"] == "visionary"
    assert identity.who("POST", PQ, {}, BODY, now=NOW) is None
    assert identity.who("POST", PQ, {"Authorization": auth}, BODY, now=NOW) is None  # no user claim
    assert identity.who("POST", PQ, {"X-Napkin-User": user}, BODY, now=NOW) is None  # no bearer
    monkeypatch.delenv("SERVICE_KEY")
    assert identity.who("POST", PQ, heads, BODY, now=NOW) is None


def test_the_retired_relay_assertion_is_nobody(monkeypatch):
    """The per-user X-Napkin-Identity (aud "relay") is gone: no key, no route, even a well-formed one."""
    monkeypatch.setattr(identity, "_local", None)
    monkeypatch.setattr(identity, "_refresh", None)
    monkeypatch.setenv("TOKEN_SECRET", KEY)
    monkeypatch.delenv("SERVICE_KEY", raising=False)
    old = sign({"u": "visionary@napkin", "a": "napkin", "t": tenant_id("napkin"), "aud": "relay", "iat": NOW,
                "exp": NOW + 60, "m": "POST", "p": PQ, "bh": hashlib.sha256(BODY).hexdigest()}, KEY)
    assert verify_assertion(old, "POST", PQ, BODY, [KEY], NOW + 5) is None
    assert identity.who("POST", PQ, {"X-Napkin-Identity": old}, BODY, now=NOW + 5) is None


def test_the_local_person_only_under_local_py(monkeypatch):
    monkeypatch.setattr(identity, "_local", None)
    monkeypatch.delenv("TOKEN_SECRET", raising=False)
    monkeypatch.delenv("SERVICE_KEY", raising=False)
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
    monkeypatch.setenv("SECRET_ARNS", json.dumps({"SERVICE_KEY": "arn:service"}))
    monkeypatch.setenv("SERVICE_KEY", "")  # so the value EnvSecrets writes is undone after the test
    monkeypatch.setattr(identity, "_local", None)
    secrets = EnvSecrets(sm_client=sm, clock=lambda: t[0])
    monkeypatch.setattr(identity, "_refresh", secrets)
    assert identity.service_keys() == ["first-" + "a" * 32]
    sm.value = "second-" + "b" * 32 + ",first-" + "a" * 32
    t[0] += 299
    assert identity.service_keys() == ["first-" + "a" * 32]  # cached
    t[0] += 2
    assert identity.service_keys() == ["second-" + "b" * 32, "first-" + "a" * 32]  # 301 s later, no rebuild
    assert sm.calls == 2


# -- aud "assets": a read-only pass for GET /assets/{sha256}[?w=] (features/production-spinoff.clan) ----------------

SHA = "a" * 64
EMPTY = hashlib.sha256(b"").hexdigest()


def assets_claims(**over):
    c = {"u": "visionary@napkin", "a": "napkin", "t": tenant_id("napkin"), "n": "Laurance", "aud": "assets",
         "iat": NOW, "exp": NOW + 1800, "m": "GET", "p": "/api/assets/*", "bh": EMPTY, **over}
    return {k: v for k, v in c.items() if v is not None}


def assets_check(token, method="GET", pq=f"/api/assets/sha256:{SHA}?w=2400", body=None, now=NOW + 5):
    return verify_assertion(token, method, pq, body, [KEY], now)


def test_an_assets_pass_names_the_tenant_for_any_picture():
    token = sign(assets_claims(), KEY)
    who = assets_check(token)
    assert who["tenant"] == {"id": tenant_id("napkin"), "agency": "napkin"}
    # one pass, many pictures and widths: it is not bound to one path
    assert assets_check(token, pq=f"/assets/sha256:{'b' * 64}") is not None
    assert assets_check(token, pq=f"/api/assets/{SHA}") is not None
    assert assets_check(token, pq=f"/api/assets/sha256%3A{SHA}?w=1200") is not None


@pytest.mark.parametrize("method,pq,body", [
    ("POST", f"/api/assets/{SHA}", None), ("DELETE", f"/api/assets/{SHA}", None),
    ("GET", "/api/uploads", None),
    ("GET", "/api/jobs/job_1", None), ("GET", "/api/me", None), ("GET", "/api/library/x/y", None),
    ("GET", "/api/assets/", None), ("GET", f"/api/assets/{SHA}/more", None), ("GET", f"/api/x/assets/{SHA}", None),
    ("GET", f"/api/assets/{SHA}", b"x"),
])
def test_an_assets_pass_is_refused_everywhere_but_get_assets(method, pq, body):
    assert assets_check(sign(assets_claims(), KEY), method=method, pq=pq, body=body) is None


def test_an_assets_pass_expires_and_has_a_ceiling():
    token = sign(assets_claims(), KEY)
    assert assets_check(token, now=NOW + 1800 + 30) is not None
    assert assets_check(token, now=NOW + 1800 + 31) is None
    assert assets_check(sign(assets_claims(exp=NOW + 3601), KEY)) is None  # a pass longer than an hour is not one of ours
    assert assets_check(sign(assets_claims(exp=NOW + 3600), KEY)) is not None


def test_an_assets_pass_needs_its_own_audience_and_agency():
    own = sign(assets_claims(aud="relay", m="GET", p=f"/api/assets/{SHA}"), KEY)
    assert assets_check(own, pq=f"/api/assets/{SHA}") is None  # the "relay" audience is retired
    assert assets_check(sign(assets_claims(t=tenant_id("other")), KEY)) is None
