#!/usr/bin/env python3
from pathlib import Path
import json,re,sys
root=Path(__file__).resolve().parents[1]
policy=json.loads((root/'docs/release/SCHEMA-COMPATIBILITY.json').read_text(encoding='utf-8'))
entries=policy['migrations']
files=sorted((root/'apps/api/db/migrations').glob('*.sql'))
tracked=[p.name for p in files if int(p.name[:4])>=38]
missing=[x for x in tracked if x not in entries]
extra=[x for x in entries if x not in tracked]
if missing or extra:
 print('FAIL  schema compatibility coverage',{'missing':missing,'extra':extra}); sys.exit(1)
for name,meta in entries.items():
 if not isinstance(meta.get('backwardCompatible'),bool) or not isinstance(meta.get('reversible'),bool) or len(meta.get('strategy',''))<10:
  raise SystemExit(f'FAIL  invalid schema compatibility metadata for {name}')
print(f'PASS  schema compatibility policy covers {len(tracked)} migrations')
