#!/usr/bin/env python3
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]; errs=[]
reg=json.loads((ROOT/'docs/ANALYTICS-DEPTH-REGISTER.json').read_text()); items=reg['items']
if len(items)<120: errs.append(f'expected at least 120 Analytics capabilities, found {len(items)}')
if [x['id'] for x in items] != [f'ANA-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Analytics IDs not continuous')
for x in items:
 if x.get('status')!='IMPLEMENTED': errs.append(f"{x['id']} not IMPLEMENTED")
 for e in x.get('evidence',[]):
  if not (ROOT/e).exists(): errs.append(f"{x['id']} missing evidence {e}")
mig=(ROOT/'apps/api/db/migrations/0055_analytics_completion.sql').read_text()
for t in ['analytics_datasets','analytics_dataset_snapshots','analytics_semantic_models','analytics_reports','analytics_report_versions','analytics_report_runs','analytics_report_schedules']:
 if f'CREATE TABLE platform.{t}' not in mig: errs.append(f'missing Analytics table {t}')
for token in ['FORCE ROW LEVEL SECURITY','source_sha256 char(64)','schema_sha256 char(64)','result_sha256 char(64)',"current_setting('aeroos.operator_id'",'DROP POLICY IF EXISTS authority_profiles_tenant']:
 if token not in mig: errs.append(f'Analytics migration invariant missing {token}')
svc=(ROOT/'apps/api/src/platform/analytics/analytics.service.ts').read_text()
for token in ['INDEPENDENT_DATASET_APPROVAL','INDEPENDENT_SNAPSHOT_VERIFICATION','INDEPENDENT_SEMANTIC_MODEL_APPROVAL','ACTIVE_SEMANTIC_MODEL_REQUIRED','REPORT_DIMENSION_NOT_ALLOWED','REPORT_METRIC_NOT_ALLOWED','INDEPENDENT_REPORT_APPROVAL','VERIFIED_DATASET_SNAPSHOT_REQUIRED','COUNT_DISTINCT','resultSha256','INDEPENDENT_SCHEDULE_APPROVAL']:
 if token not in svc: errs.append(f'Analytics service invariant missing {token}')
if 'sql' in svc.lower() and 'direct sql' not in svc.lower(): pass
ui=(ROOT/'apps/web/src/features/analytics/AnalyticsControl.tsx').read_text()
for tab in ["['models','Semantic Layer']","['snapshots','Dataset Snapshots']","['reports','Report Designer']","['runs','Runs & Schedules']"]:
 if tab not in ui: errs.append(f'compact Analytics workspace tab missing {tab}')
policy=(ROOT/'infra/cerbos/policies/analytics_control.yaml').read_text()
for action in ['"read", "run"','"manage"','"approve"']:
 if action not in policy: errs.append(f'Analytics policy action missing {action}')
master=json.loads((ROOT/'docs/MASTER-DEFICIENCY-REGISTER.json').read_text()); d=next(x for x in master['items'] if x['id']=='D076')
if d['status']!='PARTIAL': errs.append('D076 must remain PARTIAL pending production adapters/scale/scheduled delivery evidence')
if errs:
 print('FAIL  Analytics depth register'); print('\n'.join(' - '+e for e in errs)); sys.exit(1)
print(f'PASS  Analytics depth register: {len(items)}/{len(items)} capabilities implemented')
