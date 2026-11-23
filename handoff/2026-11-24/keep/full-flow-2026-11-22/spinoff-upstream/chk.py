import zipfile,yaml,glob,sys
f=glob.glob('stack/relay-data/tenants/*/projects/prj_01M82BSYY55DX8BX9EV49GC2N0/latest.clan')[0]
z=zipfile.ZipFile(f); d=yaml.safe_load(z.read('shared/data.yaml'))
print(list(d.keys()))
print('briefs',[ (k,list(v['spine'].keys())) for k,v in d.get('briefs',{}).items()])
up=d['upstream']; print({k:sorted(v.keys()) for k,v in up.items()})
print(list(up.values())[0]['objectives'])
