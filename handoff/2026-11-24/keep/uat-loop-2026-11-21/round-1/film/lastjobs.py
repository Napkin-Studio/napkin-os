import json,sys
n=int(sys.argv[1]) if len(sys.argv)>1 else 3
L=[json.loads(l) for l in open('/home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/round-1/film/requests.jsonl')]
J=[(o['t'],json.loads(o['body'])) for o in L if o['u'].endswith('/api/jobs')]
for t,b in J[-n:]: print(t, b['jobId'], b['op'], b.get('purpose'))
