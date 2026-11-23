import json,sys,time,urllib.request
D="/home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/deck-uat-fix"
B="http://127.0.0.1:20793"; DOC=sys.argv[1]
body=json.load(open(f"{D}/body.json")); body["doc"]=DOC
if len(sys.argv)>2: body["members"]=json.load(open(sys.argv[2]))
def call(path, data=None):
    req=urllib.request.Request(B+path, data=json.dumps(data).encode() if data is not None else None, headers={"content-type":"application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
approvals={}
for rounds in range(8):
    st,v=call("/run", {**body,"approvals":approvals})
    print("POST",st,str(v)[:200],flush=True)
    t0=time.time()
    while True:
        time.sleep(4)
        st,v=call("/run/"+DOC)
        s=v.get("state"); g=((v.get("run") or {}).get("gate") or {}).get("id")
        print(int(time.time()-t0),s,g,(v.get("run") or {}).get("stage"),(v.get("run") or {}).get("cost_usd"),flush=True)
        if s in ("gate","done","failed"): break
    json.dump(v,open(f"{D}/view-{rounds}.json","w"))
    if s=="failed": print(v.get("error")); break
    if s=="done": break
    if s=="gate":
        a={"decision":"approve","at":time.strftime("%Y-%m-%dT%H:%M:%SZ"),"by":"human:deck-uat-fix"}
        if g=="territories": a["picked"]="T1"
        approvals[g]=a
