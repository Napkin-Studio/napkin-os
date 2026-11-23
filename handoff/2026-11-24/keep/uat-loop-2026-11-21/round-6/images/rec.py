#!/usr/bin/env python3
"""rec.py JOBID 'notes-json' : append one line to jobs.jsonl from jobs/JOBID.json + .log + requests.jsonl + my notes."""
import json, sys
D = "/home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/round-6/images"
jid = sys.argv[1]; notes = json.loads(sys.argv[2])
b = json.load(open(f"{D}/jobs/{jid}.json"))
web = None
for l in open(f"{D}/requests.jsonl"):
    r = json.loads(l)
    if "/api/jobs" in r["u"] and jid in r.get("body", ""):
        try: web = {"t": r["t"], "body": json.loads(r["body"])}
        except Exception: web = {"t": r["t"], "raw": r["body"][:3000]}
stages, submit, dex = [], None, []
for l in open(f"{D}/jobs/{jid}.log"):
    i = l.find('{"')
    if '"evt"' not in l or i < 0: continue
    try: e = json.loads(l[i:])
    except Exception: continue
    if e["evt"] == "job_stage": stages.append({k: e.get(k) for k in ("stage", "ms", "totalMs", "costUsd")})
    elif e["evt"] == "provider_submit": submit = {k: e.get(k) for k in ("model", "endpoint", "promptText", "ratio", "taskId", "refs", "other")}
    else: dex.append({k: v for k, v in e.items() if k != "jobId"})
d = b.get("director") or {}
row = {"op": b.get("op"), "jobId": jid, **notes, "web_post": web,
       "director": {"model": d.get("model"), "promptVersion": d.get("promptVersion"), "latencyMs": d.get("latencyMs"), "input": d.get("input"), "output": d.get("output"), "rationale": d.get("rationale")},
       "dex_events": dex, "provider_submit": submit, "stages": stages, "state": b.get("state"), "cost": b.get("cost"),
       "createdAt": b.get("createdAt"), "updatedAt": b.get("updatedAt"), "error": b.get("error")}
open(f"{D}/jobs.jsonl", "a").write(json.dumps(row) + "\n")
print("ok", jid)
