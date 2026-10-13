#!/usr/bin/env python3
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]
reg=json.loads((ROOT/'docs/SAFETY-DEPTH-REGISTER.json').read_text(encoding='utf-8')); items=reg.get('items',[]); errs=[]
if len(items)<80: errs.append(f'expected at least 80 Safety capabilities, found {len(items)}')
if [x.get('id') for x in items] != [f'SAF-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Safety capability IDs are not continuous')
for x in items:
    if x.get('status')!='IMPLEMENTED': errs.append(f"{x.get('id')} is not IMPLEMENTED")
    for e in x.get('evidence',[]):
        if not (ROOT/e).exists(): errs.append(f"{x.get('id')} missing evidence {e}")
mig=(ROOT/'apps/api/db/migrations/0048_safety_completion.sql').read_text(encoding='utf-8')
for t in ['safety_hazards','safety_bowtie_controls','safety_indicators','safety_indicator_samples','safety_moc','safety_moc_actions','safety_erp_scenarios','safety_erp_activations','safety_erp_events']:
    if f'CREATE TABLE org.{t}' not in mig: errs.append(f'missing Safety table {t}')
for token in ['FORCE ROW LEVEL SECURITY','source_sha256','PREVENTIVE','RECOVERY','BREACH','PRE_IMPLEMENTATION','STOOD_DOWN','lessons_learned']:
    if token not in mig: errs.append(f'Safety migration invariant missing {token}')
svc=(ROOT/'apps/api/src/modules/org/safety-control.service.ts').read_text(encoding='utf-8')
for token in ['BOWTIE_INCOMPLETE','CONTROL_ASSURANCE_REQUIRED','INDICATOR_THRESHOLDS','INDEPENDENT_MOC_APPROVAL','MOC_PRE_ACTIONS_OPEN','INDEPENDENT_ACTION_VERIFICATION','INDEPENDENT_ERP_APPROVAL','ERP_SCENARIO_NOT_APPROVED','ERP_NOT_STOOD_DOWN']:
    if token not in svc: errs.append(f'Safety service invariant missing {token}')
ui=(ROOT/'apps/web/src/features/safety/SafetyControl.tsx').read_text(encoding='utf-8')
for tab in ["['risk','Risk & Bow-tie']","['indicators','SPI / SPT']","['moc','Management of Change']","['erp','Emergency Response']"]:
    if tab not in ui: errs.append(f'compact Safety workspace tab missing {tab}')
shell=(ROOT/'apps/web/src/app/Shell.tsx').read_text(encoding='utf-8').split('export function Shell')[0]
if shell.count("key: 'safety'")!=1: errs.append('Safety domain duplicated in top-level navigation')
for prohibited in ["label: 'Bow-tie'","label: 'Management of Change'","label: 'Emergency Response'"]:
    if prohibited in shell: errs.append(f'Safety workflow leaked into main navigation: {prohibited}')
policy=(ROOT/'infra/cerbos/policies/safety_control.yaml').read_text(encoding='utf-8')
for role in ['safety_manager','quality_manager','accountable_manager']:
    if role not in policy: errs.append(f'Safety authorization role missing {role}')
if errs:
    print('FAIL  Safety depth register'); print('\n'.join(' - '+e for e in errs)); sys.exit(1)
print(f"PASS  Safety depth register: {len(items)}/{len(items)} capabilities implemented")
