#!/usr/bin/env python3
"""List relay jobs (cost = cost.confirmed, else estimate fields; last col = provider secs _submittedAt->_fetchedAt) since a UTC time with op, state, cost, timings, model, prompt.
usage: AWS_PROFILE=napkin python3 jobs.py 2026-11-21T12:00:00Z [--full JOBID]"""
import json, subprocess, sys
since = sys.argv[1]
full = sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "--full" else None
out = subprocess.run(["aws", "dynamodb", "scan", "--table-name", "napkin-hackathon-jobs",
    "--filter-expression", "createdAt >= :s", "--expression-attribute-values",
    json.dumps({":s": {"S": since}}), "--output", "json"], capture_output=True, text=True, check=True)
items = json.loads(out.stdout)["Items"]
tot = 0.0
rows = []
for it in items:
    b = json.loads(it["body"]["S"])
    if full and b.get("jobId") == full:
        print(json.dumps(b, indent=1)); sys.exit()
    c = b.get("cost") or {}
    cost = c.get("confirmed") if c.get("confirmed") is not None else (c.get("usd") or b.get("costUsd") or 0)
    try: cost = float(cost)
    except Exception: cost = 0
    tot += cost
    rows.append((b.get("createdAt",""), b.get("jobId"), b.get("op"), b.get("state"), cost,
                 b.get("model") or (b.get("provider") or {}).get("model"), b.get("startedBy"),
                 b.get("updatedAt"), b.get("participantId"),
                 (round(b["_fetchedAt"] - b["_submittedAt"], 1) if b.get("_fetchedAt") and b.get("_submittedAt") else None)))
for r in sorted(rows): print(*r, sep=" | ")
print(f"jobs={len(rows)} spend_usd={tot:.2f}")
