"""The job ledger, the counters and the blocked list.

Three implementations with one interface: MemoryStore (tests), FileStore (the
local relay: MemoryStore kept under its --data dir, so a restart loses nothing)
and DynamoStore (Lambda). Every job write is optimistic: `save_job(job)` succeeds
only if nobody saved a newer version (`_ver`) meanwhile, and `create_job` is a
conditional put on the jobId, which is what makes POST /jobs idempotent.

Counters are atomic: `incr(key, attr, delta, limit)` refuses to go above
`limit`, so two clicks at once can't both take the last quota or slot.

Tables (infra/envs/hackathon):
  jobs    pk jobId; GSI participant (participantId, createdAt);
          sparse GSI active (queue, createdAt): queue = "q" while queued,
          "r" while at a provider, absent once finished
  quotas  pk pk: "<participantId>#<day>" (image/video/render used),
          "inflight#<participantId>" (n), "slots#<provider>#<class>" (n),
          "spend" (usd: reserved + confirmed, the global stop) and "spend#<tenantId>#<YYYY-MM>"
          (usd: the agency's month), both written only by ledger.py (features/tenant-limits.clan),
          "has#<tenantId>#<sha256>" (the agency holds these bytes, so it may be told they exist)
  blocked pk handle (lowercase)
  tenants pk tenantId (features/os-sign-in.clan): agency, enabled, updatedAt, by, and from
          tenant-limits capUsdMonthly (number or null), dailyQuotas (bool) and allow {claude, makers};
          a field the item lacks is contracts/spend-policy.json's. The relay only reads it (GetItem);
          scripts/tenants.py writes it with a person's credentials.
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import re
import threading
from decimal import Decimal
from pathlib import Path

log = logging.getLogger("relay.store")


class MemoryStore:
    def __init__(self, held_file: Path | None = None):
        self._jobs: dict[str, dict] = {}
        self._counters: dict[str, dict] = {}
        self.blocked: set[str] = set()
        self.tenants: dict[str, dict] = {}
        self.held: set[str] = set()
        # Which agency holds which bytes outlives a restart when the bytes do (local.py keeps them on
        # disk): kept only in memory, every picture of every saved project read as missing after a
        # restart, so no other browser could open them (features/picture-storage.clan).
        self._held_file = Path(held_file) if held_file else None
        if self._held_file and self._held_file.exists():
            self.held.update(line.strip() for line in self._held_file.read_text().splitlines() if line.strip())
        self._claims: dict[str, dict] = {}
        self._lock = threading.Lock()

    def get_job(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return copy.deepcopy(job) if job else None

    def create_job(self, job: dict) -> bool:
        with self._lock:
            if job["jobId"] in self._jobs:
                return False
            job["_ver"] = 1
            self._jobs[job["jobId"]] = copy.deepcopy(job)
            return True

    def save_job(self, job: dict) -> bool:
        with self._lock:
            cur = self._jobs.get(job["jobId"])
            if cur is None or cur["_ver"] != job["_ver"]:
                return False
            job["_ver"] += 1
            self._jobs[job["jobId"]] = copy.deepcopy(job)
            return True

    def list_active(self, queue: str) -> list[dict]:
        with self._lock:
            jobs = [copy.deepcopy(j) for j in self._jobs.values() if j.get("_queue") == queue]
        return sorted(jobs, key=lambda j: j["createdAt"])

    def incr(self, key: str, attr: str, delta: float, limit: float | None = None) -> bool:
        with self._lock:
            row = self._counters.setdefault(key, {})
            cur = row.get(attr, 0)
            if limit is not None and delta > 0 and cur + delta > limit:
                return False
            row[attr] = cur + delta
            return True

    def counters(self, key: str) -> dict:
        with self._lock:
            return dict(self._counters.get(key, {}))

    def is_blocked(self, handle: str) -> bool:
        return handle.lower() in self.blocked

    # ── which agency holds which bytes (features/tenant-limits.clan) ──
    def hold(self, tenant: str, sha: str) -> None:
        key = f"has#{tenant}#{sha}"
        with self._lock:
            if key in self.held:
                return
            self.held.add(key)
            if self._held_file:
                with self._held_file.open("a") as f:
                    f.write(key + "\n")

    def holds(self, tenant: str, sha: str) -> bool:
        with self._lock:
            return f"has#{tenant}#{sha}" in self.held

    # ── claims (features/clip-moment-edit.clan): one owner per key until it releases or `until` passes ──
    def claim(self, key: str, owner: str, until: float, now: float) -> bool:
        """Take `key` for `owner` until `until`: only when nobody holds it, its holder's time has passed,
        or `owner` holds it already. A missed release can never hold a key past `until`."""
        with self._lock:
            row = self._claims.get(key)
            if row and row["owner"] != owner and row["until"] > now:
                return False
            self._claims[key] = {"owner": owner, "until": until}
            return True

    def claimed_by(self, key: str, now: float) -> str | None:
        with self._lock:
            row = self._claims.get(key)
            return row["owner"] if row and row["until"] > now else None

    def release(self, key: str, owner: str) -> None:
        """Give `key` back, only when `owner` holds it."""
        with self._lock:
            row = self._claims.get(key)
            if row and row["owner"] == owner:
                del self._claims[key]

    # ── tenants (features/os-sign-in.clan) ──
    def tenant(self, tenant_id: str) -> dict | None:
        with self._lock:
            item = self.tenants.get(tenant_id)
            return copy.deepcopy(item) if item else None

    def put_tenant(self, item: dict) -> None:
        with self._lock:
            self.tenants[item["tenantId"]] = copy.deepcopy(item)

    def all_tenants(self) -> list[dict]:
        with self._lock:
            return [copy.deepcopy(t) for t in self.tenants.values()]

    # ── for scripts/prune_workspaces.py ──
    def all_jobs(self) -> list[dict]:
        with self._lock:
            return [copy.deepcopy(j) for j in self._jobs.values()]

    def delete_job(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)

    def counter_keys(self) -> list[str]:
        with self._lock:
            return sorted(self._counters)

    def delete_counter(self, key: str) -> None:
        with self._lock:
            self._counters.pop(key, None)


class FileStore(MemoryStore):
    """MemoryStore kept under a directory, for the local relay (features/relay-durable-jobs.clan):
    a restart reloads every job, counter (quotas, in-flight, slots, spend), hold and claim, so a job
    at a provider is polled again and lands. One file per job (state/jobs/<jobId>.json) and one for
    the rest (state/ledger.json); every write is a temp file, fsync, then rename, so a crash leaves
    the old file whole. Tenants and the blocked list are not kept: local.py sets them at each start.

    Each write takes the disk lock, then copies the current in-memory value under the store lock, so
    two threads saving the same job can never leave an older version on disk."""

    def __init__(self, root):
        super().__init__()
        from pathlib import Path

        self.root = Path(root) / "state"
        self.jobs_dir = self.root / "jobs"
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self._disk = threading.Lock()
        self._load()

    # ── load ──
    def _read(self, path):
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            log.exception("%s is unreadable: set aside as %s.bad", path, path.name)
            try:
                path.replace(path.with_name(path.name + ".bad"))
            except OSError:
                pass
            return None

    def _load(self) -> None:
        for path in sorted(self.jobs_dir.glob("*.json")):
            job = self._read(path)
            if isinstance(job, dict) and job.get("jobId"):
                self._jobs[job["jobId"]] = job
        ledger = self.root / "ledger.json"
        row = self._read(ledger) if ledger.exists() else None
        if isinstance(row, dict):
            self._counters = row.get("counters") or {}
            self.held = set(row.get("held") or [])
            self._claims = row.get("claims") or {}
        # Holds an earlier local relay kept in held.txt (MemoryStore(held_file=...), features/picture-storage.clan)
        # join the ledger, so pictures saved under that build stay openable.
        legacy = self.root.parent / "held.txt"
        if legacy.exists():
            extra = {line.strip() for line in legacy.read_text().splitlines() if line.strip()} - self.held
            if extra:
                self.held |= extra
                self._keep_ledger()

    # ── write ──
    @staticmethod
    def _write(path, data) -> None:
        import os

        tmp = path.with_name(f".{path.name}.{threading.get_ident()}.tmp")
        with open(tmp, "w") as f:
            json.dump(data, f, separators=(",", ":"), default=str)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)

    @staticmethod
    def _file_of(job_id: str) -> str:
        """The job's file name: its id when that is a plain name, else the id's hash."""
        if re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}", job_id):
            return f"{job_id}.json"
        return hashlib.sha256(job_id.encode()).hexdigest() + ".json"

    def _keep_job(self, job_id: str) -> None:
        path = self.jobs_dir / self._file_of(job_id)
        with self._disk:
            with self._lock:
                job = copy.deepcopy(self._jobs.get(job_id))
            if job is None:
                path.unlink(missing_ok=True)
            else:
                self._write(path, job)

    def _keep_ledger(self) -> None:
        with self._disk:
            with self._lock:
                row = {"counters": copy.deepcopy(self._counters), "held": sorted(self.held),
                       "claims": copy.deepcopy(self._claims)}
            self._write(self.root / "ledger.json", row)

    # ── every MemoryStore write, then its file ──
    def create_job(self, job: dict) -> bool:
        ok = super().create_job(job)
        if ok:
            self._keep_job(job["jobId"])
        return ok

    def save_job(self, job: dict) -> bool:
        ok = super().save_job(job)
        if ok:
            self._keep_job(job["jobId"])
        return ok

    def delete_job(self, job_id: str) -> None:
        super().delete_job(job_id)
        self._keep_job(job_id)

    def incr(self, key: str, attr: str, delta: float, limit: float | None = None) -> bool:
        ok = super().incr(key, attr, delta, limit)
        if ok:
            self._keep_ledger()
        return ok

    def delete_counter(self, key: str) -> None:
        super().delete_counter(key)
        self._keep_ledger()

    def hold(self, tenant: str, sha: str) -> None:
        super().hold(tenant, sha)
        self._keep_ledger()

    def claim(self, key: str, owner: str, until: float, now: float) -> bool:
        ok = super().claim(key, owner, until, now)
        if ok:
            self._keep_ledger()
        return ok

    def release(self, key: str, owner: str) -> None:
        super().release(key, owner)
        self._keep_ledger()


class DynamoStore:
    def __init__(self, jobs_table: str, quotas_table: str, blocked_table: str, client=None,
                 tenants_table: str | None = None):
        import boto3

        self.ddb = client or boto3.client("dynamodb")
        self.jobs_table = jobs_table
        self.quotas_table = quotas_table
        self.blocked_table = blocked_table
        self.tenants_table = tenants_table

    # The whole job is one JSON string; only what conditions and indexes need
    # is a top-level attribute. tenantId, op, usd and month are for the audit (features/tenant-limits.clan:
    # who in which agency made what, at what cost, in which month), which tenant-ops indexes by tenant.
    @staticmethod
    def _item(job: dict) -> dict:
        item = {
            "jobId": {"S": job["jobId"]},
            "participantId": {"S": job["participantId"]},
            "createdAt": {"S": job["createdAt"]},
            "state": {"S": job["state"]},
            "ver": {"N": str(job["_ver"])},
            "body": {"S": json.dumps(job, separators=(",", ":"))},
        }
        if job.get("_queue"):
            item["queue"] = {"S": job["_queue"]}
        tenant = job.get("_tenant") or job.get("tenantId")
        if tenant:
            item["tenantId"] = {"S": tenant}
        if job.get("op"):
            item["op"] = {"S": job["op"]}
        cost = job.get("cost") or {}
        usd = cost.get("confirmed", cost.get("reserved"))
        if usd is not None:
            item["usd"] = {"N": str(Decimal(str(usd)))}
        if job.get("_month"):
            item["month"] = {"S": job["_month"]}
        return item

    def get_job(self, job_id: str) -> dict | None:
        r = self.ddb.get_item(TableName=self.jobs_table, Key={"jobId": {"S": job_id}}, ConsistentRead=True)
        item = r.get("Item")
        return json.loads(item["body"]["S"]) if item else None

    def create_job(self, job: dict) -> bool:
        job["_ver"] = 1
        try:
            self.ddb.put_item(TableName=self.jobs_table, Item=self._item(job),
                              ConditionExpression="attribute_not_exists(jobId)")
            return True
        except self.ddb.exceptions.ConditionalCheckFailedException:
            return False

    def save_job(self, job: dict) -> bool:
        expected = job["_ver"]
        job["_ver"] = expected + 1
        try:
            self.ddb.put_item(TableName=self.jobs_table, Item=self._item(job),
                              ConditionExpression="ver = :v", ExpressionAttributeValues={":v": {"N": str(expected)}})
            return True
        except self.ddb.exceptions.ConditionalCheckFailedException:
            job["_ver"] = expected
            return False

    def list_active(self, queue: str) -> list[dict]:
        out, start = [], None
        while True:
            kw = dict(TableName=self.jobs_table, IndexName="active",
                      KeyConditionExpression="#q = :q", ExpressionAttributeNames={"#q": "queue"},
                      ExpressionAttributeValues={":q": {"S": queue}})
            if start:
                kw["ExclusiveStartKey"] = start
            r = self.ddb.query(**kw)
            out += [json.loads(i["body"]["S"]) for i in r.get("Items", [])]
            start = r.get("LastEvaluatedKey")
            if not start:
                break
        # The index is eventually consistent: drop rows that have moved on.
        return sorted((j for j in out if j.get("_queue") == queue), key=lambda j: j["createdAt"])

    def incr(self, key: str, attr: str, delta: float, limit: float | None = None) -> bool:
        kw = dict(TableName=self.quotas_table, Key={"pk": {"S": key}},
                  UpdateExpression="ADD #a :d", ExpressionAttributeNames={"#a": attr},
                  ExpressionAttributeValues={":d": {"N": str(Decimal(str(delta)))}})
        if limit is not None and delta > 0:
            kw["ConditionExpression"] = "attribute_not_exists(#a) OR #a <= :max"
            kw["ExpressionAttributeValues"][":max"] = {"N": str(Decimal(str(limit - delta)))}
        try:
            self.ddb.update_item(**kw)
            return True
        except self.ddb.exceptions.ConditionalCheckFailedException:
            return False

    def counters(self, key: str) -> dict:
        r = self.ddb.get_item(TableName=self.quotas_table, Key={"pk": {"S": key}}, ConsistentRead=True)
        item = r.get("Item") or {}
        return {k: float(v["N"]) for k, v in item.items() if "N" in v}

    def is_blocked(self, handle: str) -> bool:
        r = self.ddb.get_item(TableName=self.blocked_table, Key={"handle": {"S": handle.lower()}})
        return "Item" in r

    # ── which agency holds which bytes (features/tenant-limits.clan): rows in the quotas table ──
    def hold(self, tenant: str, sha: str) -> None:
        self.ddb.put_item(TableName=self.quotas_table, Item={"pk": {"S": f"has#{tenant}#{sha}"}})

    def holds(self, tenant: str, sha: str) -> bool:
        r = self.ddb.get_item(TableName=self.quotas_table, Key={"pk": {"S": f"has#{tenant}#{sha}"}},
                              ConsistentRead=True)
        return "Item" in r

    # ── claims: a conditional put on the quotas table (pk "claim#<key>"), never a counter ──
    def claim(self, key: str, owner: str, until: float, now: float) -> bool:
        try:
            self.ddb.put_item(
                TableName=self.quotas_table,
                Item={"pk": {"S": f"claim#{key}"}, "owner": {"S": owner}, "until": {"N": str(Decimal(str(until)))}},
                ConditionExpression="attribute_not_exists(pk) OR #u <= :now OR #o = :me",
                ExpressionAttributeNames={"#u": "until", "#o": "owner"},
                ExpressionAttributeValues={":now": {"N": str(Decimal(str(now)))}, ":me": {"S": owner}})
            return True
        except self.ddb.exceptions.ConditionalCheckFailedException:
            return False

    def claimed_by(self, key: str, now: float) -> str | None:
        r = self.ddb.get_item(TableName=self.quotas_table, Key={"pk": {"S": f"claim#{key}"}}, ConsistentRead=True)
        item = r.get("Item")
        if not item or float(item["until"]["N"]) <= now:
            return None
        return item["owner"]["S"]

    def release(self, key: str, owner: str) -> None:
        try:
            self.ddb.delete_item(TableName=self.quotas_table, Key={"pk": {"S": f"claim#{key}"}},
                                 ConditionExpression="#o = :me", ExpressionAttributeNames={"#o": "owner"},
                                 ExpressionAttributeValues={":me": {"S": owner}})
        except self.ddb.exceptions.ConditionalCheckFailedException:
            pass  # someone else holds it now (ours expired): theirs to release

    # ── tenants (features/os-sign-in.clan): the whole item is one JSON string, as jobs are ──
    def tenant(self, tenant_id: str) -> dict | None:
        """The tenant's item, or None (also with no TENANTS_TABLE: nobody is on, fail closed)."""
        if not self.tenants_table:
            return None
        r = self.ddb.get_item(TableName=self.tenants_table, Key={"tenantId": {"S": tenant_id}}, ConsistentRead=True)
        item = r.get("Item")
        return json.loads(item["body"]["S"]) if item else None

    def put_tenant(self, item: dict) -> None:
        self.ddb.put_item(TableName=self.tenants_table, Item={
            "tenantId": {"S": item["tenantId"]}, "agency": {"S": item["agency"]},
            "enabled": {"BOOL": bool(item.get("enabled"))},
            "body": {"S": json.dumps(item, separators=(",", ":"))}})

    def all_tenants(self) -> list[dict]:
        return [json.loads(i["body"]["S"]) for i in self._scan(self.tenants_table)]

    # ── for scripts/prune_workspaces.py (a person's credentials, not the relay's role) ──
    def _scan(self, table: str, **kw) -> list[dict]:
        out, start = [], None
        while True:
            if start:
                kw["ExclusiveStartKey"] = start
            r = self.ddb.scan(TableName=table, ConsistentRead=True, **kw)
            out += r.get("Items", [])
            start = r.get("LastEvaluatedKey")
            if not start:
                return out

    def all_jobs(self) -> list[dict]:
        return [json.loads(i["body"]["S"]) for i in self._scan(self.jobs_table)]

    def delete_job(self, job_id: str) -> None:
        self.ddb.delete_item(TableName=self.jobs_table, Key={"jobId": {"S": job_id}})

    def counter_keys(self) -> list[str]:
        return sorted(i["pk"]["S"] for i in self._scan(self.quotas_table, ProjectionExpression="pk"))

    def delete_counter(self, key: str) -> None:
        self.ddb.delete_item(TableName=self.quotas_table, Key={"pk": {"S": key}})
