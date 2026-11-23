import json,sys,subprocess,os
jid=sys.argv[1]; name=sys.argv[2]
b=json.load(open(f'jobs/{jid}.json'))
for i,o in enumerate(b.get('outputs') or []):
    ext={'image/png':'png','video/mp4':'mp4','image/jpeg':'jpg'}.get(o.get('mime'),'bin')
    p=f'media/{name}{"" if i==0 else "-"+str(i)}.{ext}'
    r=subprocess.run(['curl','-sS','-o',p,'-w','%{http_code}',o['url']],capture_output=True,text=True)
    print(p, r.stdout, os.path.getsize(p) if os.path.exists(p) else 0)
