"""DynamoStore and S3Blobs against moto (no network), and the Lambda handler end to end."""

import base64
import hashlib
import json
import time

import boto3
import pytest

from conftest import envelope
from moto import mock_aws

from blobs import S3Blobs
from store import DynamoStore


def make_tables(ddb):
    ddb.create_table(
        TableName="jobs", BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[{"AttributeName": n, "AttributeType": "S"} for n in ("jobId", "participantId", "createdAt", "queue")],
        KeySchema=[{"AttributeName": "jobId", "KeyType": "HASH"}],
        GlobalSecondaryIndexes=[
            {"IndexName": "participant", "Projection": {"ProjectionType": "ALL"},
             "KeySchema": [{"AttributeName": "participantId", "KeyType": "HASH"}, {"AttributeName": "createdAt", "KeyType": "RANGE"}]},
            {"IndexName": "active", "Projection": {"ProjectionType": "ALL"},
             "KeySchema": [{"AttributeName": "queue", "KeyType": "HASH"}, {"AttributeName": "createdAt", "KeyType": "RANGE"}]},
        ])
    ddb.create_table(TableName="quotas", BillingMode="PAY_PER_REQUEST",
                     AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
                     KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}])
    ddb.create_table(TableName="blocked", BillingMode="PAY_PER_REQUEST",
                     AttributeDefinitions=[{"AttributeName": "handle", "AttributeType": "S"}],
                     KeySchema=[{"AttributeName": "handle", "KeyType": "HASH"}])
    ddb.create_table(TableName="tenants", BillingMode="PAY_PER_REQUEST",
                     AttributeDefinitions=[{"AttributeName": "tenantId", "AttributeType": "S"}],
                     KeySchema=[{"AttributeName": "tenantId", "KeyType": "HASH"}])


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-1")
    with mock_aws():
        ddb = boto3.client("dynamodb", region_name="eu-west-1")
        make_tables(ddb)
        from blobs import s3_client

        s3 = s3_client("eu-west-1")
        s3.create_bucket(Bucket="napkin-test", CreateBucketConfiguration={"LocationConstraint": "eu-west-1"})
        yield ddb, s3


def job(jid, queue="q", created="2026-10-07T10:00:00Z"):
    return {"jobId": jid, "participantId": "p_abcdef", "createdAt": created, "state": "queued", "_queue": queue, "cost": {"reserved": 0.07}}


def test_dynamo_create_is_conditional_and_save_is_optimistic(aws):
    ddb, _ = aws
    st = DynamoStore("jobs", "quotas", "blocked", client=ddb)
    a = job("job_1")
    assert st.create_job(a) is True
    assert st.create_job(job("job_1")) is False
    stale = st.get_job("job_1")
    fresh = st.get_job("job_1")
    fresh["state"] = "submitted"
    assert st.save_job(fresh) is True
    stale["state"] = "cancelled"
    assert st.save_job(stale) is False
    assert st.get_job("job_1")["state"] == "submitted"
    assert st.get_job("job_1")["cost"]["reserved"] == 0.07


def test_dynamo_active_index_lists_in_order(aws):
    ddb, _ = aws
    st = DynamoStore("jobs", "quotas", "blocked", client=ddb)
    st.create_job(job("job_b", created="2026-10-07T10:00:02Z"))
    st.create_job(job("job_a", created="2026-10-07T10:00:01Z"))
    st.create_job(job("job_r", queue="r"))
    done = job("job_d")
    done["_queue"] = None
    st.create_job(done)
    assert [j["jobId"] for j in st.list_active("q")] == ["job_a", "job_b"]
    assert [j["jobId"] for j in st.list_active("r")] == ["job_r"]


def test_dynamo_counters_are_atomic_with_a_limit(aws):
    ddb, _ = aws
    st = DynamoStore("jobs", "quotas", "blocked", client=ddb)
    assert st.incr("slots#runway#image", "n", 1, 2)
    assert st.incr("slots#runway#image", "n", 1, 2)
    assert not st.incr("slots#runway#image", "n", 1, 2)
    assert st.incr("slots#runway#image", "n", -1)
    assert st.counters("slots#runway#image") == {"n": 1.0}
    assert st.incr("spend", "usd", 0.028)
    assert st.incr("spend", "usd", 0.042)
    assert st.counters("spend")["usd"] == pytest.approx(0.07)
    assert st.counters("nothing") == {}


@pytest.mark.parametrize("make", ["memory", "dynamo"])
def test_a_claim_has_one_owner_until_it_is_released_or_expires(aws, make):
    """Fix this moment's one patch per take (features/clip-moment-edit.clan), on both stores."""
    from store import MemoryStore
    st = MemoryStore() if make == "memory" else DynamoStore("jobs", "quotas", "blocked", client=aws[0])
    assert st.claim("patch#t", "job_a", until=100, now=0)
    assert st.claim("patch#t", "job_a", until=120, now=10)  # its owner may claim it again (an answered ask)
    assert not st.claim("patch#t", "job_b", until=130, now=20) and st.claimed_by("patch#t", 20) == "job_a"
    st.release("patch#t", "job_b")  # not theirs: nothing happens
    assert st.claimed_by("patch#t", 20) == "job_a"
    st.release("patch#t", "job_a")
    assert st.claimed_by("patch#t", 20) is None and st.claim("patch#t", "job_b", until=200, now=21)
    assert st.claimed_by("patch#t", 200) is None  # a missed release frees itself at its time
    assert st.claim("patch#t", "job_c", until=400, now=200)
    st.release("patch#t", "job_b")  # the expired owner's late release leaves the new claim alone
    assert st.claimed_by("patch#t", 202) == "job_c"


def test_dynamo_blocked(aws):
    ddb, _ = aws
    ddb.put_item(TableName="blocked", Item={"handle": {"S": "mallory"}})
    st = DynamoStore("jobs", "quotas", "blocked", client=ddb)
    assert st.is_blocked("Mallory") and not st.is_blocked("alice")


def test_dynamo_tenants(aws):
    ddb, _ = aws
    st = DynamoStore("jobs", "quotas", "blocked", client=ddb, tenants_table="tenants")
    assert st.tenant("t-1") is None
    st.put_tenant({"tenantId": "t-1", "agency": "napkin", "enabled": True, "by": "shrey"})
    assert st.tenant("t-1") == {"tenantId": "t-1", "agency": "napkin", "enabled": True, "by": "shrey"}
    assert [t["agency"] for t in st.all_tenants()] == ["napkin"]
    # No TENANTS_TABLE: nobody is on (fail closed).
    assert DynamoStore("jobs", "quotas", "blocked", client=ddb).tenant("t-1") is None


def test_s3_blobs(aws):
    _, s3 = aws
    b = S3Blobs("napkin-test", "https://cdn.test", client=s3)
    assert not b.exists("in/x")
    b.put("in/x", b"data", "image/png")
    assert b.exists("in/x") and b.fetch("https://cdn.test/in/x") == b"data"
    url = b.presign_put("in/y", "image/png")
    assert url.startswith("https://napkin-test.s3.eu-west-1.amazonaws.com/in/y?") and "X-Amz-Signature" in url
    assert b.get_json("ads/none.json") is None
    b.put("ads/j.json", b'{"ok": true}', "application/json")
    assert b.get_json("ads/j.json") == {"ok": True}


def test_lambda_handler_end_to_end(aws, monkeypatch):
    _, s3 = aws
    from contracts_dir import contracts_dir

    cfg = json.loads((contracts_dir() / "examples" / "config.testing.json").read_text())
    s3.put_object(Bucket="napkin-test", Key="config.json", Body=json.dumps(cfg).encode())
    for k, v in {"BUCKET": "napkin-test", "PUBLIC_BASE_URL_PARAM": "/napkin-test/public-base-url", "JOBS_TABLE": "jobs",
                 "QUOTAS_TABLE": "quotas", "BLOCKED_TABLE": "blocked", "TENANTS_TABLE": "tenants"}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("TOKEN_SECRET", raising=False)
    monkeypatch.delenv("SECRET_ARNS", raising=False)
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    boto3.client("ssm", region_name="eu-west-1").put_parameter(
        Name="/napkin-test/public-base-url", Value="https://cdn.test", Type="String")
    import handler
    import identity

    monkeypatch.setattr(handler, "_relay", None)

    key = "k" * 40
    monkeypatch.setattr(identity, "_refresh", None)

    def assertion(method, path, query, raw, agency="blue"):
        now = int(time.time())
        return identity.sign({"u": f"alice@{agency}", "a": agency, "t": identity.tenant_id(agency), "aud": "relay",
                              "iat": now, "exp": now + 60, "m": method, "p": path + (f"?{query}" if query else ""),
                              "bh": hashlib.sha256(raw).hexdigest()}, key)

    def http(method, path, body=None, query="", sign=True):
        raw = json.dumps(body).encode() if body is not None else b""
        headers = {"authorization": "Bearer anything"}
        if sign:
            headers["x-napkin-identity"] = assertion(method, path, query, raw)
        event = {"rawPath": path, "rawQueryString": query, "requestContext": {"http": {"method": method}},
                 "headers": headers, "body": raw.decode() if body is not None else None, "isBase64Encoded": False}
        r = handler.handler(event, None)
        return r["statusCode"], json.loads(r["body"]) if "body" in r else None

    # No TOKEN_SECRET on the Lambda: every route but health and config is a 401 (fails closed), signed or not.
    for method, path in (("GET", "/api/me"), ("POST", "/api/jobs"), ("GET", "/api/projects")):
        status, out = http(method, path, {} if method == "POST" else None)
        assert status == 401 and out["error"]["code"] == "unauthorised", path
    assert http("GET", "/api/health")[0] == 200
    assert http("GET", "/api/config")[0] == 200

    # With the key: no assertion is still a 401; a signed person whose agency is not on is a 403.
    monkeypatch.setenv("TOKEN_SECRET", key)
    assert http("GET", "/api/me", sign=False)[0] == 401
    status, out = http("GET", "/api/me", query="a=1")
    assert status == 403 and out["error"]["code"] == "flag_off" and "not on for your agency" in out["error"]["message"]

    # Turn the agency on (scripts/tenants.py's write), with a fresh relay (the tenant cache is 30 s).
    DynamoStore("jobs", "quotas", "blocked", tenants_table="tenants").put_tenant(
        {"tenantId": identity.tenant_id("blue"), "agency": "blue", "enabled": True})
    monkeypatch.setattr(handler, "_relay", None)
    status, me = http("GET", "/api/me", query="a=1")
    assert status == 200 and me["tenant"] == {"id": identity.tenant_id("blue"), "agency": "blue"}
    assert me["workspace"] == identity.tenant_id("blue")
    status, up = http("POST", "/api/uploads", {"sha256": "sha256:" + "d" * 64, "mime": "image/png", "bytes": 5})
    assert status == 200 and up["exists"] is False and up["url"].startswith("https://cdn.test/in/")
    # no adapters exist yet in this lane: routing finds no provider
    req = {**envelope("generate", "job_01K6XA7Q3M9V2D4R8T0B5C1E6F"), "input": {"text": "x"}}
    status, out = http("POST", "/api/jobs", req)
    assert status == 422 and out["error"]["code"] == "capability_missing"
    assert handler.handler({"source": "aws.events"}, None) == {"advanced": 0}

    # A saved project comes back as its bytes (base64, as a Function URL wants them) with its ETag.
    project, data = "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", b"PK\x03\x04" + bytes(range(256))
    headers = {"x-project-id": project, "x-napkin-identity": assertion("POST", "/api/clan", "", data)}
    r = handler.handler({"rawPath": "/api/clan", "requestContext": {"http": {"method": "POST"}}, "headers": headers,
                         "body": base64.b64encode(data).decode(), "isBase64Encoded": True}, None)
    assert r["statusCode"] == 200
    etag = json.loads(r["body"])["project"]["etag"]
    status, listed = http("GET", "/api/projects")
    assert status == 200 and [p["id"] for p in listed["projects"]] == [project]
    headers = {"x-napkin-identity": assertion("GET", f"/api/clan/{project}", "", b"")}
    r = handler.handler({"rawPath": f"/api/clan/{project}", "requestContext": {"http": {"method": "GET"}},
                         "headers": headers}, None)
    assert r["statusCode"] == 200 and r["isBase64Encoded"] is True
    assert base64.b64decode(r["body"]) == data
    assert r["headers"]["Content-Type"] == "application/vnd.clan+zip" and r["headers"]["ETag"] == f'"{etag}"'
    status, me = http("GET", "/api/me")
    assert status == 200 and me["projects"] == 1
    saved = s3.list_objects_v2(Bucket="napkin-test", Prefix=f"tenants/{identity.tenant_id('blue')}/projects/")
    assert saved["KeyCount"] >= 3  # index.json, the timed copy and latest.clan


def test_s3_blobs_get_list_and_delete(aws):
    _, s3 = aws
    b = S3Blobs("napkin-test", "https://cdn.test", client=s3)
    assert b.get("clan/p_x/none") is None
    for k in ("clan/p_x/a.clan", "clan/p_x/b.clan", "clan/p_y/c.clan"):
        b.put(k, b"data", "application/vnd.clan+zip")
    rows = b.list_keys("clan/p_x/")
    assert [r["key"] for r in rows] == ["clan/p_x/a.clan", "clan/p_x/b.clan"] and rows[0]["bytes"] == 4
    assert rows[0]["modified"].endswith("Z")
    assert b.get("clan/p_x/a.clan") == b"data"
    b.delete(["clan/p_x/a.clan", "clan/p_x/b.clan"])
    assert [r["key"] for r in b.list_keys("clan/")] == ["clan/p_y/c.clan"]
