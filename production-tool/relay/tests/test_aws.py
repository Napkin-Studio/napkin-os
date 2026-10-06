"""DynamoStore and S3Blobs against moto (no network), and the Lambda handler end to end."""

import json

import boto3
import pytest
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
    assert st.incr("slots#fal#image", "n", 1, 2)
    assert st.incr("slots#fal#image", "n", 1, 2)
    assert not st.incr("slots#fal#image", "n", 1, 2)
    assert st.incr("slots#fal#image", "n", -1)
    assert st.counters("slots#fal#image") == {"n": 1.0}
    assert st.incr("spend", "usd", 0.028)
    assert st.incr("spend", "usd", 0.042)
    assert st.counters("spend")["usd"] == pytest.approx(0.07)
    assert st.counters("nothing") == {}


def test_dynamo_blocked(aws):
    ddb, _ = aws
    ddb.put_item(TableName="blocked", Item={"handle": {"S": "mallory"}})
    st = DynamoStore("jobs", "quotas", "blocked", client=ddb)
    assert st.is_blocked("Mallory") and not st.is_blocked("alice")


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
    for k, v in {"BUCKET": "napkin-test", "PUBLIC_BASE_URL_PARAM": "/napkin-hackathon/public-base-url", "JOBS_TABLE": "jobs",
                 "QUOTAS_TABLE": "quotas", "BLOCKED_TABLE": "blocked",
                 "EVENT_CODES": '{"participant": ["HACK"]}', "TOKEN_SECRET": "x" * 32}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    boto3.client("ssm", region_name="eu-west-1").put_parameter(
        Name="/napkin-hackathon/public-base-url", Value="https://cdn.test", Type="String")
    import handler

    monkeypatch.setattr(handler, "_relay", None)

    def http(method, path, body=None, token=None):
        event = {"rawPath": path, "requestContext": {"http": {"method": method}},
                 "headers": {"authorization": f"Bearer {token}"} if token else {},
                 "body": json.dumps(body) if body is not None else None, "isBase64Encoded": False}
        r = handler.handler(event, None)
        return r["statusCode"], json.loads(r["body"]) if "body" in r else None

    status, sess = http("POST", "/api/session", {"eventCode": "HACK", "handle": "alice"})
    assert status == 200
    status, up = http("POST", "/api/uploads", {"sha256": "sha256:" + "d" * 64, "mime": "image/png", "bytes": 5}, sess["token"])
    assert status == 200 and up["exists"] is False and up["url"].startswith("https://cdn.test/in/")
    # no adapters exist yet in this lane: routing finds no provider
    req = {"contractVersion": "1", "jobId": "job_01K6XA7Q3M9V2D4R8T0B5C1E6F", "op": "generate", "parentIds": [],
           "input": {"text": "x"}}
    status, out = http("POST", "/api/jobs", req, sess["token"])
    assert status == 422 and out["error"]["code"] == "capability_missing"
    assert handler.handler({"source": "aws.events"}, None) == {"advanced": 0}
