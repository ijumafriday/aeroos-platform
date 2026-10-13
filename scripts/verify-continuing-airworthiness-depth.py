#!/usr/bin/env python3
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1];errs=[];reg=json.loads((ROOT/'docs/CONTINUING-AIRWORTHINESS-DEPTH-REGISTER.json').read_text());items=reg['items']
if len(items)<128: errs.append(f'expected at least 128 Continuing Airworthiness capabilities, found {len(items)}')
if [x['id'] for x in items] != [f'CAW-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Continuing Airworthiness IDs not continuous')
for x in items:
 if x.get('status')!='IMPLEMENTED': errs.append(f"{x['id']} not IMPLEMENTED")
 for e in x.get('evidence',[]):
  if not (ROOT/e).exists(): errs.append(f"{x['id']} missing evidence {e}")
mig=(ROOT/'apps/api/db/migrations/0053_continuing_airworthiness_completion.sql').read_text()
for t in ['reliability_programmes','reliability_metrics','reliability_measurements','reliability_alerts','reliability_investigations','condition_sources','condition_thresholds','condition_readings','condition_alerts','reliability_reviews']:
 if f'CREATE TABLE camo.{t}' not in mig: errs.append(f'missing Continuing Airworthiness table {t}')
for token in ['FORCE ROW LEVEL SECURITY','normalization_factor numeric','minimum_exposure numeric','source_sha256 char(64)','persistence_count integer','programme_change_required boolean']:
 if token not in mig: errs.append(f'Continuing Airworthiness migration invariant missing {token}')
svc=(ROOT/'apps/api/src/modules/camo/reliability-control.service.ts').read_text()
for token in ['INDEPENDENT_RELIABILITY_PROGRAMME_APPROVAL','APPROVED_RELIABILITY_METRICS_REQUIRED','INDEPENDENT_RELIABILITY_METRIC_APPROVAL','INDEPENDENT_RELIABILITY_MEASUREMENT_APPROVAL','RELIABILITY_INVESTIGATION_REQUIRED','RELIABILITY_CLOSURE_EVIDENCE_REQUIRED','INDEPENDENT_CONDITION_SOURCE_APPROVAL','CONDITION_PARAMETER_NOT_GOVERNED','INDEPENDENT_CONDITION_THRESHOLD_APPROVAL','CONDITION_ALERT_ACTION_EVIDENCE_REQUIRED','INDEPENDENT_CONDITION_ALERT_CLOSURE','INDEPENDENT_RELIABILITY_REVIEW_APPROVAL','sha256']:
 if token not in svc: errs.append(f'Continuing Airworthiness service invariant missing {token}')
ui=(ROOT/'apps/web/src/features/programme/ReliabilityControl.tsx').read_text()
for tab in ["['programme','Reliability Programme']","['metrics','Metrics & Alerts']","['condition','Condition Monitoring']","['review','Reliability Review']"]:
 if tab not in ui: errs.append(f'compact Continuing Airworthiness workspace tab missing {tab}')
shell=(ROOT/'apps/web/src/app/Shell.tsx').read_text().split('export function Shell')[0]
if shell.count("key: 'airworthiness'")!=1: errs.append('Continuing Airworthiness domain duplicated in navigation')
policy=(ROOT/'infra/cerbos/policies/reliability_control.yaml').read_text()
for role in ['camo_engineer','camo_manager','accountable_manager']:
 if role not in policy: errs.append(f'Continuing Airworthiness role missing {role}')
if errs:
 print('FAIL  Continuing Airworthiness depth register');print('\n'.join(' - '+e for e in errs));sys.exit(1)
print(f'PASS  Continuing Airworthiness depth register: {len(items)}/{len(items)} capabilities implemented')
