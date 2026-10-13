#!/usr/bin/env python3
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]
reg=json.loads((ROOT/'docs/OPS-DEPTH-REGISTER.json').read_text()); items=reg.get('items',[]); errs=[]
if len(items)<75: errs.append(f'expected at least 75 Operations capabilities, found {len(items)}')
if [x.get('id') for x in items] != [f'OPS-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Operations capability IDs are not continuous')
for x in items:
    if x.get('status')!='IMPLEMENTED': errs.append(f"{x.get('id')} is not IMPLEMENTED")
    for e in x.get('evidence',[]):
        if not (ROOT/e).exists(): errs.append(f"{x.get('id')} missing evidence {e}")
mig=(ROOT/'apps/api/db/migrations/0047_operations_completion.sql').read_text()
for t in ['integration_providers','airac_cycles','efb_packages','efb_distributions','load_control_messages','runway_operational_states','acmi_contracts','tech_logs','tech_log_events']:
    if f'CREATE TABLE ops.{t}' not in mig: errs.append(f'missing Operations table {t}')
for token in ['FORCE ROW LEVEL SECURITY','source_sha256','content_sha256','payload_sha256','continuity_token','operational_control_party','offline_revision']:
    if token not in mig: errs.append(f'Operations migration invariant missing {token}')
svc=(ROOT/'apps/api/src/modules/ops/operations-control.service.ts').read_text()
for token in ['INDEPENDENT_AIRAC_APPROVAL','INDEPENDENT_EFB_RELEASE','INDEPENDENT_ACMI_APPROVAL','OFFLINE_REVISION_CONFLICT','TECHLOG_SIGNATURE_REQUIRED','consecutiveFailures','SUPERSEDED','ACKNOWLEDGED']:
    if token not in svc: errs.append(f'Operations service invariant missing {token}')
ui=(ROOT/'apps/web/src/features/ops/OperationsControl.tsx').read_text()
for tab in ["['providers','Providers']","['airac','AIRAC']","['efb','EFB']","['load','Load / DCS']","['runways','Runways']","['acmi','ACMI']","['techlog','Tech Log']"]:
    if tab not in ui: errs.append(f'compact Operations workspace tab missing {tab}')
shell=(ROOT/'apps/web/src/app/Shell.tsx').read_text().split('export function Shell')[0]
if shell.count("key: 'ops'")!=1: errs.append('Operations domain duplicated in top-level navigation')
for prohibited in ['AIRAC Lifecycle','EFB Distribution','ACMI Contracts','Tech Log Continuity']:
    if prohibited in shell: errs.append(f'Operations workflow leaked into main navigation: {prohibited}')
policy=(ROOT/'infra/cerbos/policies/ops_control.yaml').read_text()
for role in ['occ_controller','quality_manager']:
    if role not in policy: errs.append(f'Operations authorization role missing {role}')
if errs:
    print('FAIL  Operations depth register'); print('\n'.join(' - '+e for e in errs)); sys.exit(1)
print(f"PASS  Operations depth register: {len(items)}/{len(items)} capabilities implemented")
