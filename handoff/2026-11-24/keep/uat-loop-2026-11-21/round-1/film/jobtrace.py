#!/usr/bin/env python3
"""jobtrace.py JOBID [JOBID...]: save job record + relay/stitch log lines; print a compact summary."""
import json, subprocess, sys, time, os
OUT = os.path.dirname(os.path.abspath(__file__)) + '/jobs'
os.environ.setdefault('AWS_PROFILE', 'napkin')
def sh(a): return subprocess.run(a, capture_output=True, text=True).stdout
for jid in sys.argv[1:]:
    r = ""

    items = json.loads(r or '{"Items":[]}')["Items"]
    if not items:
        r = sh(["aws","dynamodb","get-item","--table-name","napkin-hackathon-jobs","--key",json.dumps({"jobId":{"S":jid}}),"--output","json"])
        it = json.loads(r or '{}').get("Item")
        items = [it] if it else []
    b = json.loads(items[0]["body"]["S"]) if items else {}
    json.dump(b, open(f"{OUT}/{jid}.json","w"), indent=1)
    start = int((time.time()-6*3600)*1000)
    logs = ""
    for g in ["/aws/lambda/napkin-hackathon-relay","/aws/lambda/napkin-hackathon-stitch"]:
        logs += f"## {g}\n" + sh(["aws","logs","filter-log-events","--log-group-name",g,"--start-time",str(start),
              "--filter-pattern",f'"{jid}"',"--query","events[].message","--output","text"])
    open(f"{OUT}/{jid}.log","w").write(logs)
    d = b.get("director") or {}
    summ = {"jobId": jid, "op": b.get("op"), "state": b.get("state"), "createdAt": b.get("createdAt"), "updatedAt": b.get("updatedAt"),
            "cost": b.get("cost"), "model": b.get("model") or (b.get("provider") or {}), "director_model": d.get("model"),
            "director_prompt": d.get("promptVersion"), "director_latency": d.get("latencyMs"), "rationale": (d.get("rationale") or "")[:600],
            "error": b.get("error"), "outputs": [o.get("uri") or o.get("key") or o for o in (b.get("outputs") or [])][:4],
            "evts": [l[l.find('{"evt"'):][:400] for l in logs.split('\n') if '"evt"' in l]}
    print(json.dumps(summ, indent=1)[:6000])
