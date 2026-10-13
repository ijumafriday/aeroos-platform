#!/usr/bin/env python3
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]; errs=[]
reg=json.loads((ROOT/'docs/INTEGRATION-MIGRATION-DEPTH-REGISTER.json').read_text(encoding='utf-8')); items=reg['items']
if len(items)<132: errs.append(f'expected at least 132 Integration/Migration capabilities, found {len(items)}')
if [x['id'] for x in items] != [f'INT-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Integration/Migration IDs not continuous')
for x in items:
 if x.get('status')!='IMPLEMENTED': errs.append(f"{x['id']} not IMPLEMENTED")
 for e in x.get('evidence',[]):
  if not (ROOT/e).exists(): errs.append(f"{x['id']} missing evidence {e}")
mig=(ROOT/'apps/api/db/migrations/0056_integration_migration_platform.sql').read_text(encoding='utf-8')
for t in ['migration_adapter_profiles','connector_catalog','connector_instances','connector_health_checks','api_lifecycle_policies','event_schema_subjects','event_schema_versions','workflow_definitions','workflow_versions','workflow_migration_plans']:
 if f'CREATE TABLE platform.{t}' not in mig: errs.append(f'missing integration table {t}')
for token in ['FORCE ROW LEVEL SECURITY',"current_setting('aeroos.operator_id'",'source_system','deprecation_window_days','schema_sha256 char(64)','patch_ids text[]']:
 if token not in mig: errs.append(f'integration migration invariant missing {token}')
svc=(ROOT/'apps/api/src/platform/integrations/integration-control.service.ts').read_text(encoding='utf-8')
for token in ['INDEPENDENT_ADAPTER_APPROVAL','INDEPENDENT_CONNECTOR_APPROVAL','PRODUCTION_HEALTH_GATE','DEPRECATION_WINDOW_REQUIRED','SCHEMA_VERSION_SEQUENCE','INDEPENDENT_SCHEMA_APPROVAL','WORKFLOW_PATCH_ID_REQUIRED','APPROVED_WORKFLOW_MIGRATION_REQUIRED','INDEPENDENT_WORKFLOW_VERSION_APPROVAL']:
 if token not in svc: errs.append(f'integration service invariant missing {token}')
inter=(ROOT/'apps/api/src/platform/integrations/api-lifecycle.interceptor.ts').read_text(encoding='utf-8')
for token in ["'Deprecation'","'Sunset'",'successor-version','routePrefix']:
 if token not in inter: errs.append(f'API lifecycle runtime header missing {token}')
worker=(ROOT/'apps/worker/src/workflows.ts').read_text(encoding='utf-8')
if "patched('mel-deferral-extension-reset-v2')" not in worker: errs.append('Temporal workflow patch/version marker missing')
ui=(ROOT/'apps/web/src/features/platform/IntegrationControl.tsx').read_text(encoding='utf-8')
for tab in ["['adapters','Migration Adapters']","['connectors','Connector Catalog']","['lifecycle','API Lifecycle']","['schemas','Event Schemas']","['workflows','Workflow Versions']"]:
 if tab not in ui: errs.append(f'compact platform control tab missing {tab}')
master=json.loads((ROOT/'docs/MASTER-DEFICIENCY-REGISTER.json').read_text(encoding='utf-8'))
for did in ['D066','D068','D071','D083','D084']:
 d=next(x for x in master['items'] if x['id']==did)
 if d['status']!='PARTIAL': errs.append(f'{did} must remain PARTIAL pending production/vendor/evidence closure')
if errs:
 print('FAIL  Integration & Migration depth register'); print('\n'.join(' - '+e for e in errs)); sys.exit(1)
print(f'PASS  Integration & Migration depth register: {len(items)}/{len(items)} capabilities implemented')
