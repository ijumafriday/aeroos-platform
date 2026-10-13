#!/usr/bin/env python3
from pathlib import Path
import argparse,json,hashlib

def sha(p):
 h=hashlib.sha256(); h.update(p.read_bytes()); return h.hexdigest()
ap=argparse.ArgumentParser(); ap.add_argument('root',type=Path); ap.add_argument('--version',required=True); a=ap.parse_args()
root=a.root
srcs=list(root.glob('aeroos-platform-*.zip'))
if len(srcs)!=1: raise SystemExit(f'expected one source zip, got {len(srcs)}')
s=srcs[0]; bundle=Path(str(s)+'.sigstore.json')
if not bundle.exists(): raise SystemExit('source sigstore bundle missing')
imgs=[]
for p in sorted(root.glob('image-meta-*.json')):
 x=json.loads(p.read_text()); vf=root/x['verificationFile']
 if not vf.exists(): raise SystemExit(f'missing {vf.name}')
 imgs.append(x)
idx={'schemaVersion':1,'version':a.version,'source':{'file':s.name,'sha256':sha(s),'sigstoreBundle':bundle.name},'images':imgs}
(root/'release-evidence.json').write_text(json.dumps(idx,indent=2,sort_keys=True)+'\n')
print('PASS  release evidence index built')
