#!/usr/bin/env python3
"""ledger.py: my jobs (participant p_fa41965754) since start: provider (cost.confirmed) and Claude (cost.agentUsd) separately."""
import json, subprocess, sys
since = open('/home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/round-4/film/start.txt').read().strip()
out = subprocess.run(["aws","dynamodb","scan","--table-name","napkin-hackathon-jobs","--filter-expression","createdAt >= :s",
    "--expression-attribute-values", json.dumps({":s":{"S":since}}), "--output","json"], capture_output=True, text=True, check=True)
rows=[]; P=A=0.0
for it in json.loads(out.stdout)["Items"]:
    b=json.loads(it["body"]["S"])
    if b.get("participantId")!="p_fa41965754": continue
    c=b.get("cost") or {}
    p=float(c.get("confirmed") or 0); a=float(c.get("agentUsd") or 0)
    P+=p; A+=a
    rows.append((b.get("createdAt"), b.get("jobId"), b.get("op"), b.get("state"), f"prov={p:.2f}", f"est={c.get('estimate')}", f"claude={a:.4f}", (b.get("model") or "") if isinstance(b.get("model"),str) else "", (b.get("error") or {}).get("message","")[:80] if isinstance(b.get("error"),dict) else (b.get("error") or "")))
for r in sorted(rows): print(*r, sep=" | ")
print(f"jobs={len(rows)} provider_usd={P:.2f} claude_usd={A:.4f}")
