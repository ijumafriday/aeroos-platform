#!/usr/bin/env python3
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]; errs=[]; reg=json.loads((ROOT/'docs/ENGINEERING-DEPTH-REGISTER.json').read_text(encoding='utf-8')); items=reg['items']
if len(items)<130: errs.append(f'expected at least 130 Engineering capabilities, found {len(items)}')
if [x['id'] for x in items] != [f'ENG-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Engineering IDs not continuous')
for x in items:
 if x.get('status')!='IMPLEMENTED': errs.append(f"{x['id']} not IMPLEMENTED")
 for e in x.get('evidence',[]):
  if not (ROOT/e).exists(): errs.append(f"{x['id']} missing evidence {e}")
mig=(ROOT/'apps/api/db/migrations/0050_engineering_completion.sql').read_text(encoding='utf-8')
for t in ['config_items','interchangeability_rules','engineering_orders','eo_embodiments','sb_campaigns','sb_fleet_status','structural_damage']:
 if f'CREATE TABLE engineering.{t}' not in mig: errs.append(f'missing Engineering table {t}')
for token in ['FORCE ROW LEVEL SECURITY','checksum_sha256','effectivity jsonb','conformity_verified_by','technical_disposition','commercial_disposition','x_pct','y_pct','srm_ref','photo_evidence']:
 if token not in mig: errs.append(f'Engineering migration invariant missing {token}')
svc=(ROOT/'apps/api/src/modules/engineering/engineering-control.service.ts').read_text(encoding='utf-8')
for token in ['INDEPENDENT_CONFIG_APPROVAL','INDEPENDENT_INTERCHANGE_APPROVAL','INDEPENDENT_EO_APPROVAL','INDEPENDENT_CONFORMITY_VERIFICATION','EO_CLOSURE_EVIDENCE_REQUIRED','EO_EMBODIMENTS_OPEN','INDEPENDENT_SB_APPROVAL','DAMAGE_DISPOSITION_REQUIRED','sha256']:
 if token not in svc: errs.append(f'Engineering service invariant missing {token}')
ui=(ROOT/'apps/web/src/features/engineering/EngineeringControl.tsx').read_text(encoding='utf-8')
for tab in ["['configuration','Configuration & Interchangeability']","['orders','Engineering Orders']","['sb','SB Campaigns']","['damage','Structural Damage Map']"]:
 if tab not in ui: errs.append(f'compact Engineering workspace tab missing {tab}')
shell=(ROOT/'apps/web/src/app/Shell.tsx').read_text(encoding='utf-8').split('export function Shell')[0]
if shell.count("key: 'engineering'")!=1: errs.append('Engineering domain duplicated in navigation')
policy=(ROOT/'infra/cerbos/policies/engineering_control.yaml').read_text(encoding='utf-8')
for role in ['engineering_engineer','engineering_manager','camo_manager']:
 if role not in policy: errs.append(f'Engineering role missing {role}')
if errs:
 print('FAIL  Engineering depth register'); print('\n'.join(' - '+e for e in errs)); sys.exit(1)
print(f'PASS  Engineering depth register: {len(items)}/{len(items)} capabilities implemented')
