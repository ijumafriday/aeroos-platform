#!/usr/bin/env python3
"""Qualify a live AeroOS database against an assurance scale profile.

Uses psql so the exact production schema is measured rather than a generated approximation.
DATABASE_URL must point to a read-only-capable PostgreSQL identity with visibility of aggregate counts.
"""
from __future__ import annotations
import json, os, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
targets=json.loads((ROOT/'tests/assurance/scale-targets.json').read_text(encoding='utf-8'))
url=os.environ.get('DATABASE_URL')
if not url:
    raise SystemExit('DATABASE_URL is required')
queries={
 'operators': 'select count(*) from compliance.operator_profiles',
 'aircraft': 'select count(*) from camo.fleet',
 'personnel': 'select count(*) from org.personnel',
 'flights': 'select count(*) from ops.flights',
 'audit_entries': 'select count(*) from platform.audit_log',
 'documents': 'select count(*) from platform.documents',
 'components': 'select count(*) from camo.components',
 'work_packages': 'select count(*) from camo.work_packages'
}
actual={}
for name,sql in queries.items():
    p=subprocess.run(['psql',url,'-AtX','-c',sql],text=True,capture_output=True)
    if p.returncode:
        print(p.stderr,file=sys.stderr); raise SystemExit(p.returncode)
    actual[name]=int(p.stdout.strip())
minimums=targets['minimums']
checks={k:{'actual':actual[k],'minimum':minimums[k],'pass':actual[k]>=minimums[k]} for k in minimums}
result={'profile':targets['profile'],'checks':checks,'pass':all(v['pass'] for v in checks.values())}
print(json.dumps(result,indent=2))
raise SystemExit(0 if result['pass'] else 2)
