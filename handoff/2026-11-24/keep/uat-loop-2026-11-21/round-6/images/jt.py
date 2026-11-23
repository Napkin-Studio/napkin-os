#!/usr/bin/env python3
"""jt.py JOBID [name]: save job record + relay/stitch log lines + outputs; print compact summary."""
import json, subprocess, sys, time, os
OUT = "/home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/round-6/images/jobs"
os.environ.setdefault('AWS_PROFILE', 'napkin')
def sh(a): return subprocess.run(a, capture_output=True, text=True).stdout
jid = sys.argv[1]; name = sys.argv[2] if len(sys.argv) > 2 else None
r = sh(["aws","dynamodb","get-item","--table-name","napkin-hackathon-jobs","--region","eu-west-1","--key",json.dumps({"jobId":{"S":jid}}),"--output","json"])
it = json.loads(r or '{}').get("Item")
b = json.loads(it["body"]["S"]) if it else {}
json.dump(b, open(f"{OUT}/{jid}.json","w"), indent=1)
start = int((time.time()-4*3600)*1000)
logs = ""
for g in ["/aws/lambda/napkin-hackathon-relay","/aws/lambda/napkin-hackathon-stitch"]:
    logs += f"## {g}\n" + sh(["aws","logs","filter-log-events","--region","eu-west-1","--log-group-name",g,"--start-time",str(start),
          "--filter-pattern",f'"{jid}"',"--query","events[].message","--output","text"])
open(f"{OUT}/{jid}.log","w").write(logs)
d = b.get("director") or {}
print("STATE", b.get("state"), "op", b.get("op"), "created", b.get("createdAt"), "updated", b.get("updatedAt"))
print("COST", json.dumps(b.get("cost")))
print("MODEL", b.get("model"), "| director", d.get("model"), d.get("promptVersion"), "lat", d.get("latencyMs"), "usage", json.dumps(d.get("usage"))[:300])
inp = d.get("input")
if inp is not None:
    s = json.dumps(inp)
    print("DIR.INPUT bytes", len(s), "keys", list(inp.keys()) if isinstance(inp, dict) else type(inp))
    if isinstance(inp, dict) and inp.get("context"): print("  CONTEXT", json.dumps(inp["context"])[:1500])
else: print("DIR.INPUT none")
out = d.get("output")
if out is not None: print("DIR.OUTPUT", json.dumps(out)[:2500])
print("RATIONALE", (d.get("rationale") or "")[:800])
if b.get("error"): print("ERROR", json.dumps(b.get("error"))[:800])
for l in logs.split("\n"):
    i = l.find('{"')
    if '"evt"' not in l or i < 0: continue
    try: e = json.loads(l[i:])
    except Exception: print("RAW", l[:300]); continue
    ev = e.get("evt")
    if ev == "provider_submit":
        print("SUBMIT", json.dumps({k: v for k, v in e.items() if k != "refs"})[:3000])
        print("  refs", json.dumps([{k: r.get(k) for k in ("tag","subject","role","kind") if k in r} for r in e.get("refs") or []])[:1500])
    elif ev == "job_stage": print("STAGE", e.get("stage"), e.get("ms"), e.get("totalMs"), {k: e[k] for k in e if k not in ("evt","stage","ms","totalMs","jobId","ts")} )
    else: print(ev, json.dumps(e)[:700])
outs = b.get("outputs") or b.get("output") or []
if isinstance(outs, dict): outs = [outs]
if name:
    for i, o in enumerate(outs):
        u = o.get("url") if isinstance(o, dict) else None
        k = o.get("key") or o.get("uri") if isinstance(o, dict) else None
        mime = (o.get("mime") or "") if isinstance(o, dict) else ""
        ext = {"image/png":"png","video/mp4":"mp4","image/jpeg":"jpg","image/webp":"webp"}.get(mime, "png")
        p = f"{OUT}/{name}{'' if i == 0 else '-'+str(i)}.{ext}"
        if u: subprocess.run(["curl","-sS","-o",p,u])
        elif k and str(k).startswith("s3://"): subprocess.run(["aws","s3","cp","--region","eu-west-1",k,p,"--quiet"])
        elif k: subprocess.run(["aws","s3","cp","--region","eu-west-1",f"s3://napkin-hackathon-741448934623/{k}",p,"--quiet"])
        print("saved", p, sh(["identify", "-format", "%wx%h", p]))
    if not outs: print("no outputs field; keys:", list(b.keys()))
