#!/usr/bin/env python3
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]
reg=json.loads((ROOT/'docs/CREW-DEPTH-REGISTER.json').read_text()); items=reg.get('items',[]); errs=[]
if len(items)<100: errs.append(f'expected at least 100 Crew capabilities, found {len(items)}')
if [x.get('id') for x in items] != [f'CREW-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Crew capability IDs are not continuous')
for x in items:
    if x.get('status')!='IMPLEMENTED': errs.append(f"{x.get('id')} is not IMPLEMENTED")
    for e in x.get('evidence',[]):
        if not (ROOT/e).exists(): errs.append(f"{x.get('id')} missing evidence {e}")
mig=(ROOT/'apps/api/db/migrations/0049_crew_completion.sql').read_text()
for t in ['crew_surface_legs','crew_bid_periods','crew_bids','crew_awards','crew_training_resources','crew_training_sessions','crew_training_session_resources','crew_training_enrollments','crew_pay_events','crew_payroll_batches']:
    if f'CREATE TABLE ops.{t}' not in mig: errs.append(f'missing Crew table {t}')
for token in ['FORCE ROW LEVEL SECURITY','minimum_connection_minutes','seniority_snapshot','contract_rule_set','qualification_expires_on','export_sha256','RECONCILED']:
    if token not in mig: errs.append(f'Crew migration invariant missing {token}')
svc=(ROOT/'apps/api/src/modules/ops/crew-control.service.ts').read_text()
for token in ['SURFACE_TIME_ORDER','TRAINING_RESOURCE_CONFLICT','TRAINING_ROSTER_CONFLICT','INDEPENDENT_BID_PERIOD_APPROVAL','INDEPENDENT_AWARD_APPROVAL','INDEPENDENT_TRAINING_APPROVAL','INDEPENDENT_PAY_APPROVAL','INDEPENDENT_PAYROLL_EXPORT','PAY_EVENTS_REQUIRED','sha256']:
    if token not in svc: errs.append(f'Crew service invariant missing {token}')
ui=(ROOT/'apps/web/src/features/crew/CrewControl.tsx').read_text()
for tab in ["['surface','Positioning & Surface']","['bids','Bid & Award']","['training','Training Resources']","['pay','Pay Interface']"]:
    if tab not in ui: errs.append(f'compact Crew workspace tab missing {tab}')
shell=(ROOT/'apps/web/src/app/Shell.tsx').read_text().split('export function Shell')[0]
if shell.count("key: 'crew'")!=1: errs.append('Crew domain duplicated in top-level navigation')
for prohibited in ["label: 'Crew Bidding'","label: 'Training Resources'","label: 'Payroll Interface'","label: 'Surface Positioning'"]:
    if prohibited in shell: errs.append(f'Crew workflow leaked into main navigation: {prohibited}')
policy=(ROOT/'infra/cerbos/policies/crew_control.yaml').read_text()
for role in ['crew_planner','training_manager','finance_manager']:
    if role not in policy: errs.append(f'Crew authorization role missing {role}')
if errs:
    print('FAIL  Crew depth register'); print('\n'.join(' - '+e for e in errs)); sys.exit(1)
print(f"PASS  Crew depth register: {len(items)}/{len(items)} capabilities implemented")
