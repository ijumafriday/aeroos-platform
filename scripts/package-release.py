#!/usr/bin/env python3
"""Create a deterministic AeroOS source release plus a file-hash manifest.

The archive uses sorted paths and a fixed ZIP timestamp. Dependency reproducibility is reported
explicitly rather than faked: dependencyLock is true only when pnpm-lock.yaml is present.
"""
from __future__ import annotations
import hashlib, json, os, stat, sys, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
OUT=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT.parent/f'aeroos-platform-{VERSION}-complete.zip'
EXCLUDED={'.git','node_modules','dist','coverage','security-report','.nx','__pycache__'}
MANIFEST=ROOT/'RELEASE-MANIFEST.json'

def files():
    for p in sorted(ROOT.rglob('*')):
        if not p.is_file(): continue
        rel=p.relative_to(ROOT)
        if any(part in EXCLUDED for part in rel.parts): continue
        if p==MANIFEST: continue
        yield p,rel

def sha(p:Path):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

entries=[{'path':str(rel).replace(os.sep,'/'),'sha256':sha(p),'bytes':p.stat().st_size} for p,rel in files()]
manifest={
    'product':'AeroOS Platform','version':VERSION,'format':1,
    'dependencyLock':(ROOT/'pnpm-lock.yaml').exists(),
    'dependencyLockPolicy':'Mandatory for every dependency-resolving build and production promotion; this source archive is non-promotable while absent.',
    'files':entries,
}
MANIFEST.write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
all_files=list(files())+[(MANIFEST,Path('RELEASE-MANIFEST.json'))]
OUT.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(OUT,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p,rel in sorted(all_files,key=lambda x:str(x[1])):
        zi=zipfile.ZipInfo(f'aeroos-platform/{str(rel).replace(os.sep,"/")}',date_time=(2026,1,1,0,0,0))
        zi.compress_type=zipfile.ZIP_DEFLATED
        zi.external_attr=(0o755 if os.access(p,os.X_OK) else 0o644)<<16
        z.writestr(zi,p.read_bytes())
print(OUT)
print(hashlib.sha256(OUT.read_bytes()).hexdigest())
