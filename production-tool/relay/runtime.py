"""Config and secrets with short caches, shared by the Lambda and the dev server."""

from __future__ import annotations

import json
import logging
import os
import threading
import time

from contracts import Contracts

log = logging.getLogger("relay")

CONFIG_TTL_S = 30
SECRETS_TTL_S = 300


class CachedConfig:
    """config.json, re-read every 30 s and validated against config.schema.json.
    A bad upload keeps the last good config (and logs loudly) instead of
    breaking every job."""

    def __init__(self, load, contracts: Contracts, ttl: float = CONFIG_TTL_S, clock=time.monotonic):
        self.load, self.contracts, self.ttl, self.clock = load, contracts, ttl, clock
        self.value: dict | None = None
        self.at = -1e9
        self.lock = threading.Lock()

    def __call__(self) -> dict:
        with self.lock:
            if self.value is None or self.clock() - self.at > self.ttl:
                try:
                    cfg = self.load()
                    errors = self.contracts.errors("config.schema.json", cfg)
                    if errors:
                        raise ValueError(f"config.json does not match its schema: {errors[0]}")
                    self.value = cfg
                except Exception:
                    log.exception("config.json could not be loaded; keeping the last good one")
                    if self.value is None:
                        raise
                self.at = self.clock()
            return self.value


def parse_event_codes(raw: str) -> dict:
    """{"participant": [...], "organiser": [...]} or a comma-separated list of
    participant codes."""
    raw = (raw or "").strip()
    if raw.startswith("{"):
        data = json.loads(raw)
        return {"participant": list(data.get("participant", [])), "organiser": list(data.get("organiser", []))}
    return {"participant": [c.strip() for c in raw.split(",") if c.strip()], "organiser": []}


class EnvSecrets:
    """EVENT_CODES and TOKEN_SECRET from the environment. On Lambda,
    SECRET_ARNS ({"NAME": "arn", ...}) names Secrets Manager entries that are
    copied into the environment and refreshed every 5 minutes, so the adapters
    can read RUNWAY_API_KEY, FAL_KEY, ... from os.environ."""

    def __init__(self, sm_client=None, clock=time.monotonic):
        self.sm, self.clock = sm_client, clock
        self.at = -1e9
        self.lock = threading.Lock()

    def refresh(self) -> None:
        arns = json.loads(os.environ.get("SECRET_ARNS") or "{}")
        if not arns:
            return
        if self.sm is None:
            import boto3

            self.sm = boto3.client("secretsmanager")
        for name, arn in arns.items():
            try:
                value = self.sm.get_secret_value(SecretId=arn).get("SecretString", "")
            except Exception:
                log.exception("secret %s could not be read", name)
                continue
            if value and value != "PLACEHOLDER":
                os.environ[name] = value

    def __call__(self) -> dict:
        with self.lock:
            if self.clock() - self.at > SECRETS_TTL_S:
                self.refresh()
                self.at = self.clock()
        secret = os.environ.get("TOKEN_SECRET", "")
        if len(secret) < 16:
            raise RuntimeError("TOKEN_SECRET is missing or shorter than 16 characters")
        return {"event_codes": parse_event_codes(os.environ.get("EVENT_CODES", "")), "token_secret": secret}
