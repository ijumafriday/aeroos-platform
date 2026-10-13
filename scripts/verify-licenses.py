#!/usr/bin/env python3
from pathlib import Path
import json,sys,datetime
if len(sys.argv) not in (2,3): raise SystemExit('usage: verify-licenses.py <pnpm-licenses-json> [governed-exceptions-json]')
policy=json.loads(Path('.github/security/license-policy.json').read_text())
allowed=set(policy['allowed']); today=datetime.date.today(); exceptions={}
for x in policy.get('exceptions',[]):
 exp=datetime.date.fromisoformat(x['expires'])
 if exp < today: raise SystemExit(f"FAIL  expired legacy license exception {x['package']}")
 exceptions[x['package']]=x
if len(sys.argv)==3:
 gov=json.loads(Path(sys.argv[2]).read_text())
 for x in gov.get('exceptions',[]):
  # governed finding is the exact package name for license findings
  exceptions[x['finding']]=x
report=json.loads(Path(sys.argv[1]).read_text()); bad=[]
for license_name, packages in report.items():
 if license_name in allowed: continue
 for pkg in packages if isinstance(packages,list) else []:
  name=pkg.get('name','unknown') if isinstance(pkg,dict) else str(pkg)
  if name not in exceptions: bad.append((name,license_name))
if bad:
 print('FAIL  unapproved licenses:'); [print(f'  {n}: {l}') for n,l in bad]; sys.exit(1)
print('PASS  dependency licenses comply with policy')
