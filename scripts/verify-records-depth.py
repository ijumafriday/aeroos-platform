#!/usr/bin/env python3
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]
reg=json.loads((ROOT/'docs/RECORDS-DEPTH-REGISTER.json').read_text()); items=reg.get('items',[]); errs=[]
if len(items)<55: errs.append(f'expected at least 55 Records capabilities, found {len(items)}')
if [x.get('id') for x in items] != [f'REC-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Records capability IDs are not continuous')
for x in items:
    if x.get('status')!='IMPLEMENTED': errs.append(f"{x.get('id')} is not IMPLEMENTED")
    for e in x.get('evidence',[]):
        if not (ROOT/e).exists(): errs.append(f"{x.get('id')} missing evidence {e}")
mig=(ROOT/'apps/api/db/migrations/0046_records_completion.sql').read_text()
for t in ['record_classes','ingest_batches','ingest_items','document_profiles','custody_events','lease_projects','lease_requirements','component_trace_entries','retention_policies','legal_holds','disposition_cases','package_deliveries']:
    if f'CREATE TABLE records.{t}' not in mig: errs.append(f'missing Records table {t}')
for token in ['FORCE ROW LEVEL SECURITY','source_manifest_sha256','extracted_text_sha256','previous_entry_id','legal_basis','acknowledgement_ref']:
    if token not in mig: errs.append(f'Records migration invariant missing {token}')
svc=(ROOT/'apps/api/src/modules/records/records-control.service.ts').read_text()
for token in ['DUPLICATE_RECORD','OCR_HASH_MISMATCH','pageIssues','LEASE_INCOMPLETE','traceIssues','INDEPENDENT_RELEASE','LEGAL_HOLD','INDEPENDENT_DISPOSITION','INDEPENDENT_ACK']:
    if token not in svc: errs.append(f'Records service invariant missing {token}')
ui=(ROOT/'apps/web/src/features/records/TechnicalRecords.tsx').read_text()
for tab in ["['binders','Record Binders']","['intake','Historical Intake']","['lease','Lease & Redelivery']","['retention','Retention & Holds']"]:
    if tab not in ui: errs.append(f'compact Records workspace tab missing {tab}')
shell=(ROOT/'apps/web/src/app/Shell.tsx').read_text().split('export function Shell')[0]
if shell.count("key: 'records'")!=1: errs.append('Technical Records domain duplicated in top-level navigation')
for prohibited in ['Historical Intake','Lease & Redelivery','Legal Hold','OCR Review']:
    if prohibited in shell: errs.append(f'Records workflow leaked into main navigation: {prohibited}')
policy=(ROOT/'infra/cerbos/policies/technical_record.yaml').read_text()
for role in ['records_officer','records_manager']:
    if role not in policy: errs.append(f'Records authorization role missing {role}')
if errs:
    print('FAIL  Technical Records depth register'); print('\n'.join(' - '+e for e in errs)); sys.exit(1)
print(f"PASS  Technical Records depth register: {len(items)}/{len(items)} capabilities implemented")
