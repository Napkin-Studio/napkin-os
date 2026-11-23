import json,sys,subprocess
j=sys.argv[1]; name=sys.argv[2] if len(sys.argv)>2 else None
subprocess.run(['python3','jobtrace.py',j],capture_output=True)
b=json.load(open(f'jobs/{j}.json'))
print(b['state'], 'cost', b.get('cost'), 'model', b.get('model'))
d=b.get('director') or {}
print('DEX rationale:', d.get('rationale'))
print('DEX input keys:', list((d.get('input') or {}).keys()) if isinstance(d.get('input'),dict) else type(d.get('input')))
for l in open(f'jobs/{j}.log'):
    if '"evt"' in l:
        e=json.loads(l[l.find('{'):])
        if e['evt']=='provider_submit': print('SUBMIT', json.dumps({k:v for k,v in e.items() if k!='refs'})[:3000]); print('  refs', [ (r.get('tag'), r.get('subject'), r.get('uri','')[-12:]) for r in e.get('refs') or []])
        elif e['evt']=='job_stage': print('STAGE', e.get('stage'), e.get('ms'), e.get('totalMs'), e.get('costUsd',''), e.get('model',''))
        else: print(e['evt'], json.dumps(e)[:400])
if name:
    for i,o in enumerate(b.get('outputs') or []):
        u=o.get('url')
        ext={'image/png':'png','video/mp4':'mp4'}.get(o.get('mime'),'bin')
        p=f'media/{name}{"" if i==0 else "-"+str(i)}.{ext}'
        subprocess.run(['curl','-sS','-o',p,u]); print('saved',p)
