#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, re, subprocess, sys
from pathlib import Path

DIGEST=re.compile(r'^sha256:[0-9a-f]{64}$')

def sha256(p:Path):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser(description='Verify AeroOS retained release evidence bundle')
    ap.add_argument('evidence',type=Path)
    ap.add_argument('--cosign',action='store_true',help='also cryptographically verify Sigstore bundles with cosign')
    a=ap.parse_args(); root=a.evidence
    idx=root/'release-evidence.json'
    if not idx.is_file(): raise SystemExit('FAIL  release-evidence.json missing')
    d=json.loads(idx.read_text())
    for k in ['version','source','images']:
        if k not in d: raise SystemExit(f'FAIL  evidence index missing {k}')
    src=d['source']; z=root/src['file']
    if not z.is_file(): raise SystemExit('FAIL  source archive missing')
    if sha256(z)!=src['sha256']: raise SystemExit('FAIL  source archive SHA-256 mismatch')
    sb=root/src['sigstoreBundle']
    if not sb.is_file(): raise SystemExit('FAIL  source Sigstore bundle missing')
    if not isinstance(d['images'],list) or len(d['images'])<4: raise SystemExit('FAIL  evidence requires all four production images')
    apps=set()
    for x in d['images']:
        for k in ['app','ref','digest','verificationFile']:
            if not x.get(k): raise SystemExit(f'FAIL  image evidence missing {k}')
        if not DIGEST.match(x['digest']): raise SystemExit(f'FAIL  invalid digest for {x["app"]}')
        vf=root/x['verificationFile']
        if not vf.is_file() or not vf.read_text().strip(): raise SystemExit(f'FAIL  signature verification missing for {x["app"]}')
        apps.add(x['app'])
    if apps!={'api','worker','web','optimiser'}: raise SystemExit(f'FAIL  incomplete image set {sorted(apps)}')
    if a.cosign:
        subprocess.run(['cosign','verify-blob','--bundle',str(sb),str(z)],check=True)
        for x in d['images']:
            subprocess.run(['cosign','verify',f"{x['ref']}@{x['digest']}"],check=True,stdout=subprocess.DEVNULL)
    print(f"PASS  release evidence verified for {d['version']}: source + {len(d['images'])} images")
if __name__=='__main__': main()
