import zipfile,yaml,glob,sys
f=glob.glob(sys.argv[1])[0]
z=zipfile.ZipFile(f); d=yaml.safe_load(z.read('shared/data.yaml'))
up=d['upstream']; print({k:sorted(v.keys())[:8] for k,v in up.items()})
for k,v in up.items():
    if 'objectives' in v: print('OBJECTIVES under',k, v['objectives'])
    if v.get('app')=='production-tool': print('prod briefs spine keys', [list(b['spine']) for b in v.get('briefs',{}).values()])
