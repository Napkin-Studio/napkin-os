"""The job ledger, the counters and the blocked list.

Two implementations with one interface: MemoryStore (tests, local dev) and
DynamoStore (Lambda). Every job write is optimistic: `save_job(job)` succeeds
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
import json
import threading
from decimal import Decimal


class MemoryStore:
    def __init__(self):
        self._jobs: dict[str, dict] = {}
        self._counters: dict[str, dict] = {}
        self.blocked: set[str] = set()
        self.tenants: dict[str, dict] = {}
        self.held: set[str] = set()
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
        with self._lock:
            self.held.add(f"has#{tenant}#{sha}")

    def holds(self, tenant: str, sha: str) -> bool:
        with self._lock:
            return f"has#{tenant}#{sha}" in self.held

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
