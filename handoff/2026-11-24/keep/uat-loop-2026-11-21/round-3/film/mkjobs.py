import json, re
Q = {
 "job_01M7XS1HZ4EQQ0M60PQD5NG980": ("Draft from the brief", 4, "14.1 s screenplay, end line kept"),
 "job_01M7XS29MV5ZA4T34BFJZXN2CV": ("ask1: whispered 'Good boy.' + snore", 4, "added WOMAN cue+paren+line"),
 "job_01M7XS2YFKDKK05RVFPC46YQJJ": ("ask2: Make it 10 seconds", 3, "9.6 s but dropped the asked line and toast; target offer shown"),
 "job_01M7XS43EAFYKWPEW2BJ8EK656": ("ask3: bring line back, name MAYA, stay 10 s", 4, "10.4 s"),
 "job_01M7XSH36PD7EMZTG2TFJKX7DR": ("Plan shots", 4, "5 shots + end card; 'Silence' sound beat on shot 3 is wrong"),
 "job_01M7XSK4EWE11XCZTQMR2T1MSV": ("Draw frame 1", 4, "dark kitchen, fridge light; a person added unasked"),
 "job_01M7XSMC23BKK92DKZ1X02AHWE": ("frame 2", 4, "Maya held, white kettle"),
 "job_01M7XSNSG82FZA2AE361HZXK63": ("frame 3 (insert)", 2, "insert became a medium with Maya: web sent frame 1 as required character"),
 "job_01M7XSQ7DF9V3WER56A469EETR": ("frame 4", 4, "Maya held; kettle now glass/blue (prop drift from frame 3)"),
 "job_01M7XSRRA678DRYJ0DWTS4RD48": ("frame 5", 3, "Maya at the wall, ok; in_1 and anchor same image sent twice"),
 "job_01M7XSXSC7DC3M8SVT3YEAH6WZ": ("Box 1 join shots 1+2, WAN 3", 4, "cut at 1.5 s, both frames followed, Maya held; Dex dropped maya_full"),
 "job_01M7XT6D1MCEWRPT6Z1NXQAME8": ("shot 1 separate, Omni", 4, "follows frame; 3 s take for 1.5 s shot"),
 "job_01M7XT7MXM1Q8411Q8QY12YTK7": ("shot 2 separate, WAN 3", 4, "i2v from frame, refs dropped (WAN refs xor frame)"),
 "job_01M7XTE9AS5RE61CJCXJRBZA9Z": ("shot 4 'Good boy.' Veo 3.1 audio", 4, "voiced 2-syllable burst 0.55-0.95 s, inside 0-1.5 s window; in ad at 6.1-6.4 s"),
 "job_01M7XTFGT48M3QP84QX9AC34R2": ("shot 3 Omni", 4, "kettle glows; Maya in frame (frame bug)"),
 "job_01M7XTGTDP4YF0GJBA0EVWAABP": ("shot 5 snoring WAN 3 audio", 3, "low rumble 0-1 s (-13 dB peak) snore-like"),
 "job_01M7XTSBFB1Y8JWM1PZZP9G49C": ("Render ad", 4, "13.52 s (11 s + studio card), caption in shot 4"),
 "job_01M7XV2E9ZFC1HTD1HKAYGX0WD": ("Plan the cuts 6 s 9:16", 3, "keeps shots 2+3 (2.4 s picture); crop free default"),
 "job_01M7XV38WR5SA48HV96A8C0WW6": ("Make 1 version 6 s 9:16", 3, "6.0 s 1080x1920; 2.25 s picture, super + end card repeat line, studio card ~2.3 s"),
 "job_01M7XV85J048AXWA2YG1FGEXCW": ("F7 words box: frame", 3, "Maya pouring tea"),
 "job_01M7XV9MDT6358Q4P1WWCH7V2R": ("F7 words box: clip (chained)", 3, "pours while holding mug, toast unclear; identity 4"),
 "job_01M7XVCV3P4GQD0HF8Q1TCCW9E": ("re-join 1+2 WAN 3 new take", 4, "landed in the cut in place; Dex again dropped maya_full"),
 "job_01M7XVNBR33Y6DE8SHQFF38MFH": ("ask4 after Plan shots: funnier snoring", 1, "agent got empty scene lines -> 'no snoring line yet' question"),
}
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
