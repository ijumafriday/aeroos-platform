#!/usr/bin/env python3
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
data=json.loads((root/'docs/MASTER-DEFICIENCY-REGISTER.json').read_text())
allowed={'MISSING','PARTIAL','COMPLETE','EXTERNAL'}
items=data.get('items',[])
if len(items)<90: raise SystemExit(f'FAIL  deficiency register unexpectedly shrank to {len(items)} items')
ids=[x.get('id') for x in items]
if len(ids)!=len(set(ids)): raise SystemExit('FAIL  duplicate deficiency IDs')
expected=[f'D{i:03d}' for i in range(1,len(items)+1)]
if ids!=expected: raise SystemExit('FAIL  deficiency IDs must remain ordered and contiguous; append new IDs, never renumber old ones')
for x in items:
    for k in ('priority','domain','title','status','acceptance','evidence'):
        if k not in x: raise SystemExit(f"FAIL  {x.get('id')} missing {k}")
    if x['status'] not in allowed: raise SystemExit(f"FAIL  {x['id']} invalid status {x['status']}")
    if x['priority'] not in {'P0','P1','P2'}: raise SystemExit(f"FAIL  {x['id']} invalid priority")
    if len(x['acceptance'].strip())<30: raise SystemExit(f"FAIL  {x['id']} acceptance criterion is too weak")
    if x['status']=='COMPLETE':
        if not x['evidence']: raise SystemExit(f"FAIL  {x['id']} COMPLETE without evidence")
        missing=[rel for rel in x['evidence'] if not (root/rel).exists()]
        if missing: raise SystemExit(f"FAIL  {x['id']} COMPLETE evidence missing: {', '.join(missing)}")
md=(root/'docs/MASTER-DEFICIENCY-REGISTER.md').read_text()
for x in items:
    if x['id'] not in md or x['title'] not in md: raise SystemExit(f"FAIL  markdown register missing {x['id']}")
print(f"PASS  master deficiency register: {len(items)} items; " + ', '.join(f"{s}={sum(1 for x in items if x['status']==s)}" for s in ['MISSING','PARTIAL','COMPLETE','EXTERNAL']))
