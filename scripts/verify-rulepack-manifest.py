#!/usr/bin/env python3
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parents[1]
m=json.loads((root/'packages/compliance/rulepack-source-manifest.json').read_text(encoding='utf-8'))
for rule_id,row in m['packs'].items():
    p=root/'packages/compliance'/row['source']
    if not p.exists(): raise SystemExit(f'FAIL  {rule_id}: source missing {p}')
    got=hashlib.sha256(p.read_bytes()).hexdigest()
    if got!=row['sha256']: raise SystemExit(f'FAIL  {rule_id}: source fingerprint drift {got} != {row["sha256"]}')
ts=(root/'packages/compliance/src/rulepack-manifest.ts').read_text(encoding='utf-8')
for rule_id,row in m['packs'].items():
    if row['sha256'] not in ts or rule_id not in ts: raise SystemExit(f'FAIL  {rule_id}: TypeScript artifact manifest is not synchronized')
print(f'PASS  rulepack source manifest: {len(m["packs"])} artifacts')
