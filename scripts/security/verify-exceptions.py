#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime as dt, json, re, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
DEFAULT=ROOT/'.github/security/exceptions.json'
WAIVABLE={'trivy-config','trivy-container','license'}
NON_WAIVABLE={'codeql','gitleaks'}
ID=re.compile(r'^[A-Z0-9][A-Z0-9._:-]{2,127}$')

def load(path:Path):
    d=json.loads(path.read_text(encoding='utf-8'))
    if d.get('schemaVersion')!=1 or not isinstance(d.get('exceptions'),list):
        raise SystemExit('FAIL  security exception document must use schemaVersion=1 and exceptions[]')
    return d['exceptions']

def validate(items, today:dt.date):
    seen=set(); active=[]
    for i,x in enumerate(items,1):
        req=['id','scanner','finding','scope','reason','ticket','approvedBy','approvedOn','expiresOn']
        miss=[k for k in req if not str(x.get(k,'')).strip()]
        if miss: raise SystemExit(f'FAIL  exception #{i} missing {", ".join(miss)}')
        if x['id'] in seen: raise SystemExit(f'FAIL  duplicate exception id {x["id"]}')
        seen.add(x['id'])
        if x['scanner'] in NON_WAIVABLE: raise SystemExit(f'FAIL  {x["scanner"]} findings are non-waivable')
        if x['scanner'] not in WAIVABLE: raise SystemExit(f'FAIL  unsupported scanner {x["scanner"]}')
        if not ID.match(x['finding']) or '*' in x['finding']: raise SystemExit(f'FAIL  exception {x["id"]} must name an exact finding id')
        if x['scope'] in ('*','all','.') or '*' in x['scope']: raise SystemExit(f'FAIL  exception {x["id"]} scope must be specific')
        ap=dt.date.fromisoformat(x['approvedOn']); ex=dt.date.fromisoformat(x['expiresOn'])
        if ex < ap: raise SystemExit(f'FAIL  exception {x["id"]} expires before approval')
        if (ex-ap).days>90: raise SystemExit(f'FAIL  exception {x["id"]} exceeds 90-day maximum')
        if ex>=today: active.append(x)
    return active

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--file',type=Path,default=DEFAULT)
    ap.add_argument('--emit-trivyignore',type=Path)
    ap.add_argument('--emit-license-json',type=Path)
    a=ap.parse_args(); items=load(a.file); active=validate(items,dt.date.today())
    if a.emit_trivyignore:
        lines=sorted({x['finding'] for x in active if x['scanner'].startswith('trivy-')})
        a.emit_trivyignore.write_text(('\n'.join(lines)+'\n') if lines else '')
    if a.emit_license_json:
        vals=[x for x in active if x['scanner']=='license']
        a.emit_license_json.write_text(json.dumps({'schemaVersion':1,'exceptions':vals},indent=2,sort_keys=True)+'\n')
    print(f'PASS  security exceptions valid: total={len(items)} active={len(active)}')
if __name__=='__main__': main()
