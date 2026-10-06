"""AWS Lambda entry points.

  handler.handler   the relay, behind a Function URL (CloudFront /api/* → here)
                    and the EventBridge sweep (every minute)

Environment (infra/envs/hackathon/relay.tf):
  BUCKET, PUBLIC_BASE_URL (or PUBLIC_BASE_URL_PARAM, an SSM name), JOBS_TABLE, QUOTAS_TABLE, BLOCKED_TABLE,
  STITCH_FUNCTION, SECRET_ARNS, CONFIG_KEY (default config.json)
"""

from __future__ import annotations

import base64
import json
import logging
import os

import boto3

from blobs import S3Blobs, s3_client
from contracts import Contracts
from director import load_director
from providers import load_registry
from runtime import CachedConfig, EnvSecrets
from service import Relay
from store import DynamoStore

logging.getLogger().setLevel(logging.INFO)
log = logging.getLogger("relay")

_relay: Relay | None = None


def _build() -> Relay:
    s3 = s3_client()
    bucket = os.environ["BUCKET"]
    config_key = os.environ.get("CONFIG_KEY", "config.json")
    contracts = Contracts()
    lam = boto3.client("lambda")
    stitch_fn = os.environ.get("STITCH_FUNCTION")

    def start_stitch(payload: dict) -> None:
        lam.invoke(FunctionName=stitch_fn, InvocationType="Event", Payload=json.dumps(payload).encode())

    public_base = os.environ.get("PUBLIC_BASE_URL")
    if not public_base:
        name = os.environ["PUBLIC_BASE_URL_PARAM"]
        public_base = boto3.client("ssm").get_parameter(Name=name)["Parameter"]["Value"]

    secrets = EnvSecrets()
    secrets()  # keys into the environment before the adapters start
    return Relay(
        store=DynamoStore(os.environ["JOBS_TABLE"], os.environ["QUOTAS_TABLE"], os.environ["BLOCKED_TABLE"]),
        blobs=S3Blobs(bucket, public_base, client=s3),
        registry=load_registry(),
        director=load_director(),
        config=CachedConfig(lambda: json.loads(s3.get_object(Bucket=bucket, Key=config_key)["Body"].read()), contracts),
        secrets=secrets,
        contracts=contracts,
        stitch=start_stitch if stitch_fn else None,
    )


def relay() -> Relay:
    global _relay
    if _relay is None:
        _relay = _build()
    return _relay


def handler(event, context):
    if event.get("source") == "aws.events" or event.get("sweep"):
        n = relay().sweep()
        print(json.dumps({"kind": "sweep", "advanced": n}))
        return {"advanced": n}
    http = event.get("requestContext", {}).get("http", {})
    method, path = http.get("method", "GET"), event.get("rawPath", "/")
    body = event.get("body")
    if body is not None and event.get("isBase64Encoded"):
        body = base64.b64decode(body)
    elif isinstance(body, str):
        body = body.encode()
    status, out, ctx = relay().http(method, path, event.get("headers") or {}, body)
    ctx["kind"] = "request"
    print(json.dumps({k: v for k, v in ctx.items() if v is not None}, default=str))
    resp = {"statusCode": status, "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"}}
    if out is not None:
        resp["body"] = json.dumps(out)
    return resp
