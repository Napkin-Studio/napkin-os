import json, re
Q = json.load(open('quality.json')) if __import__('os').path.exists('quality.json') else {}
posts = {}
for l in open('requests.jsonl'):
    o = json.loads(l)
    if o['u'].endswith('/api/jobs'):
        b = json.loads(o['body']); posts[b['jobId']] = (o['t'], b)
out = open('jobs.jsonl', 'w')
for jid, (t, b) in posts.items():
    try: rec = json.load(open(f'jobs/{jid}.json'))
    except Exception: rec = {}
    log = open(f'jobs/{jid}.log').read() if __import__('os').path.exists(f'jobs/{jid}.log') else ''
    ev = [json.loads(x[x.find('{'):]) for x in log.split('\n') if '"evt"' in x]
    sub = next((e for e in ev if e['evt'] == 'provider_submit'), {})
    stages = {e.get('stage'): e.get('totalMs') for e in ev if e['evt'] == 'job_stage'}
    dexe = next((e for e in ev if e['evt'] == 'director'), {})
    d = rec.get('director') or {}
    i = b.get('input', {})
    ask, score, why = Q.get(jid, ("", None, ""))
    out.write(json.dumps({
        "op": b['op'], "jobId": jid, "asked": ask, "postedAt": t,
        "sent": {"modelChoice": b.get('modelChoice'), "mode": i.get('mode'), "refs": [(r.get('name') or r.get('label'), r.get('role'), r.get('optional')) for r in i.get('refs', [])], "keys": list(i.keys())},
        "dex": {"promptVersion": d.get('promptVersion'), "latencyMs": dexe.get('latencyMs'), "usage": dexe.get('usage'), "rationale": d.get('rationale')},
        "provider": {"model": sub.get('model') or rec.get('model'), "promptText": sub.get('promptText'), "duration": sub.get('duration'), "audio": (sub.get('other') or {}).get('audio'), "refsSent": len(sub.get('refs') or [])},
        "timings": {"relayTotalMs": stages.get('landed'), "stages": stages, "createdAt": rec.get('createdAt'), "updatedAt": rec.get('updatedAt')},
        "cost": rec.get('cost'), "state": rec.get('state'),
        "outputs": [(o.get('durationS'), o.get('mime')) for o in rec.get('outputs') or []],
        "quality": score, "judgement": why}) + "\n")
print(len(posts))
