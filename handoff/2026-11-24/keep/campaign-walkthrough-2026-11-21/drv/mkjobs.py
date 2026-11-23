#!/usr/bin/env python3
"""mkjobs.py SINCE-UTC > jobs.jsonl : one line per relay job of this project (cost, Claude cost, model, Dex, timings, prompt)."""
import json, subprocess, sys, os
os.environ.setdefault('AWS_PROFILE', 'napkin')
since = sys.argv[1]
proj_filter = sys.argv[2] if len(sys.argv) > 2 else None
out = subprocess.run(["aws", "dynamodb", "scan", "--region", "eu-west-1", "--table-name", "napkin-hackathon-jobs",
    "--filter-expression", "createdAt >= :s", "--expression-attribute-values",
    json.dumps({":s": {"S": since}}), "--output", "json"], capture_output=True, text=True, check=True)
items = json.loads(out.stdout)["Items"]
rows = []
tot_p = tot_c = 0.0
for it in items:
    b = json.loads(it["body"]["S"])
    if b.get("startedBy") != "human:p_fa41965754":
        continue
    c = b.get("cost") or {}
    prov = c.get("confirmed") if c.get("confirmed") is not None else 0
    agent = c.get("agentUsd") or 0
    d = b.get("director") or {}
    inp = b.get("input") or {}
    row = {
        "op": b.get("op"), "jobId": b.get("jobId"), "state": b.get("state"),
        "createdAt": b.get("createdAt"), "updatedAt": b.get("updatedAt"),
        "model": b.get("model") or (b.get("provider") or {}).get("model"),
        "providerUsd": prov, "claudeUsd": agent,
        "providerSecs": round(b["_fetchedAt"] - b["_submittedAt"], 1) if b.get("_fetchedAt") and b.get("_submittedAt") else None,
        "asked": (inp.get("text") or inp.get("prompt") or inp.get("ask") or "")[:400] if isinstance(inp, dict) else None,
        "modelChoice": inp.get("modelChoice") if isinstance(inp, dict) else None,
        "audio": inp.get("audio") if isinstance(inp, dict) else None,
        "dex": {"model": d.get("model"), "promptVersion": d.get("promptVersion"), "latencyMs": d.get("latencyMs"),
                "usage": d.get("usage"), "rationale": (d.get("rationale") or "")[:400],
                "prompt": json.dumps(d.get("output"))[:800] if d.get("output") is not None else None},
        "error": b.get("error"),
    }
    tot_p += float(prov or 0); tot_c += float(agent or 0)
    rows.append(row)
rows.sort(key=lambda r: r["createdAt"] or "")
for r in rows:
    print(json.dumps(r))
print(f"# jobs={len(rows)} provider_usd={tot_p:.2f} claude_usd={tot_c:.3f}", file=sys.stderr)
