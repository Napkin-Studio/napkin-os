#!/usr/bin/env python3
"""japi.py JOBID [name]: job via the web API (driver page cookie) -> jobs/JOBID.json, output -> jobs/name.png; summary."""
import json, subprocess, sys
D = "/home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/round-5/images"
jid = sys.argv[1]; name = sys.argv[2] if len(sys.argv) > 2 else None
js = 'const x = await page.evaluate(async(id)=>{ const r = await fetch("/production/api/jobs/"+id); return await r.text(); }, "%s"); return x;' % jid
out = subprocess.run([f"{D}/d.sh", js], capture_output=True, text=True).stdout
b = json.loads(json.loads(out))
json.dump(b, open(f"{D}/jobs/{jid}.json", "w"), indent=1)
d = b.get("director") or {}
print("STATE", b.get("state"), b.get("op"), b.get("createdAt"), b.get("updatedAt"), "COST", json.dumps(b.get("cost")))
print("DIRECTOR", d.get("promptVersion"), "lat", d.get("latencyMs"), "usage", d.get("usage"))
o = d.get("output") or {}
pj = o.get("providerJob") or {}
print("PROMPT", pj.get("prompt"))
print("REFS", [(r.get("name"), r.get("role")) for r in pj.get("refs") or []], "Q", o.get("question"))
inp = d.get("input") or {}
print("INPUT keys", list(inp.keys()) if isinstance(inp, dict) else inp, "ctx", json.dumps(inp.get("context") if isinstance(inp, dict) else None)[:600])
if isinstance(inp, dict) and inp.get("text"): print("INPUT text", inp["text"][:500])
outs = b.get("outputs") or []
if name:
    for i, x in enumerate(outs):
        p = f"{D}/jobs/{name}{'' if i == 0 else '-'+str(i)}.png"
        subprocess.run(["curl", "-sS", "-o", p, x["url"]]); print("saved", p, x.get("w"), x.get("h"))
if b.get("error"): print("ERROR", b["error"])
