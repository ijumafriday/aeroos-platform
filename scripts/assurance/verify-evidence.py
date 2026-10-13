#!/usr/bin/env python3
import argparse, json, pathlib, sys
ap=argparse.ArgumentParser(); ap.add_argument('files', nargs='+'); a=ap.parse_args()
required={'schema','control','target','environment','recordedAtEpoch','platformVersion','runner','result','outcome'}
for fn in a.files:
    p=pathlib.Path(fn); d=json.loads(p.read_text())
    miss=required-set(d)
    if miss: raise SystemExit(f'{fn}: missing {sorted(miss)}')
    if d['schema']!='aeroos.assurance.evidence/v1': raise SystemExit(f'{fn}: bad schema')
    if d['outcome'] not in ('PASS','FAIL'): raise SystemExit(f'{fn}: bad outcome')
    if d['outcome']=='PASS' and d['result'].get('exitCode') != 0: raise SystemExit(f'{fn}: PASS with nonzero exit')
    if d['outcome']=='FAIL' and d['result'].get('exitCode') == 0: raise SystemExit(f'{fn}: FAIL with zero exit')
print(f'PASS verified {len(a.files)} evidence file(s)')
