#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
check() { if "$@"; then printf 'PASS  %s\n' "$*"; else printf 'FAIL  %s\n' "$*"; fail=1; fi; }

printf 'AeroOS production release checks\n'
if [ -f pnpm-lock.yaml ]; then
  echo 'PASS  pnpm-lock.yaml present'
else
  echo 'FAIL  pnpm-lock.yaml missing — all build/release paths are blocked'
  fail=1
fi

python - <<'PY' || fail=1
from pathlib import Path
import json,sys
root=Path('.')
v=json.loads((root/'package.json').read_text())['version']
paths=[root/'apps/api/package.json',root/'apps/web/package.json',root/'apps/worker/package.json',root/'e2e/package.json']+list((root/'packages').glob('*/package.json'))
bad=[]
for p in paths:
    if p.exists() and json.loads(p.read_text()).get('version') != v: bad.append(str(p))
chart=(root/'deploy/helm/aeroos/Chart.yaml').read_text()
values=(root/'deploy/helm/aeroos/values.yaml').read_text()
if f'appVersion: "{v}"' not in chart: bad.append('Chart.yaml appVersion')
if f'tag: "{v}"' not in values: bad.append('values.yaml image.tag')
if bad:
    print('FAIL  version mismatch:', ', '.join(bad)); sys.exit(1)
print('PASS  versions aligned at',v)
PY

python - <<'PY' || fail=1
from pathlib import Path
import yaml,sys
for p in Path('infra/cerbos/policies').rglob('*.yaml'):
    yaml.safe_load(p.read_text())
for p in [Path('deploy/helm/aeroos/values.yaml'),Path('deploy/helm/aeroos/values-cloud.yaml'),Path('deploy/helm/aeroos/values-selfhosted.yaml')]:
    yaml.safe_load(p.read_text())
print('PASS  YAML parses')
PY

python scripts/verify-contracts.py || fail=1

python - <<'PYLOCK' || fail=1
from pathlib import Path
import re,sys
roots=[Path('.github'),Path('apps'),Path('scripts'),Path('.vscode')]
bad=[]
patterns=[r'--no-frozen-lockfile',r'else\s+pnpm install',r'npm install --no-save']
for root in roots:
    if not root.exists(): continue
    for p in root.rglob('*'):
        if not p.is_file() or p.name=='release-check.sh': continue
        try: text=p.read_text()
        except UnicodeDecodeError: continue
        for pat in patterns:
            if re.search(pat,text): bad.append(f'{p}: {pat}')
if bad:
    print('FAIL  unlocked dependency fallback remains:'); print('\n'.join(bad)); sys.exit(1)
print('PASS  no unlocked JavaScript dependency-install fallback remains')
PYLOCK


python - <<'PYMASTER' || fail=1
from pathlib import Path
m=Path('apps/api/db/migrations/0038_regulated_master_data.sql').read_text()
svc=Path('apps/api/src/modules/compliance/master-data.service.ts').read_text()
required=['DRAFT','VALIDATED','APPROVED','EFFECTIVE','SUPERSEDED','WITHDRAWN']
if not all(x in m and x in svc for x in required): raise SystemExit('FAIL  master-data lifecycle incomplete')
for gate in ['ops.aircraft_types','camo.mel','camo.maintenance_programme','camo.srm_limits','camo.engine_limits','compliance.ftl']:
    if gate not in ''.join(p.read_text() for p in [Path('apps/api/src/modules/ops/dispatch.service.ts'),Path('apps/api/src/modules/camo/mel.service.ts'),Path('apps/api/src/modules/camo/programme.service.ts'),Path('apps/api/src/modules/camo/health.service.ts'),Path('apps/api/src/modules/ops/rostering.service.ts')]):
        raise SystemExit('FAIL  missing regulated-data gate '+gate)
print('PASS  governed master-data lifecycle and fail-closed operational gates')
PYMASTER


python - <<'PYASSURE' || fail=1
from pathlib import Path
import json,sys
cfg=json.loads(Path('tests/assurance/scale-targets.json').read_text())
required={'operators','aircraft','personnel','flights','audit_entries','documents','components','work_packages'}
if set(cfg.get('minimums',{})) != required:
    print('FAIL  assurance scale profile is incomplete'); sys.exit(1)
for f in ['tests/load/major-airline.k6.js','tests/load/soak.k6.js','scripts/assurance/qualify-dataset.py','scripts/assurance/concurrency-idempotency.sh','scripts/assurance/failure-drill.sh']:
    if not Path(f).is_file(): print('FAIL  missing assurance artifact',f); sys.exit(1)
print('PASS  scale/resilience assurance profile is complete')
PYASSURE

python scripts/verify-deficiency-register.py || fail=1

python scripts/verify-schema-compatibility.py || fail=1


if grep -R --line-number -E 'Content-Security-Policy-Report-Only' apps/web deploy/helm >/dev/null; then
  echo 'FAIL  report-only CSP remains in production assets'; fail=1
else echo 'PASS  CSP is enforcing'; fi

if grep -R --line-number -E 'TODO_PLACEHOLDER|DUMMY_IMPLEMENTATION|NOT_IMPLEMENTED_PLACEHOLDER' apps packages services >/dev/null; then
  echo 'FAIL  placeholder marker found'; fail=1
else echo 'PASS  no prohibited placeholder markers'; fi

python - <<'PYP1' || fail=1
from pathlib import Path
import json,sys
required=[
 'apps/api/db/migrations/0039_p1_closure.sql','packages/sdk/src/index.ts','packages/sdk/README.md',
 'apps/api/src/modules/amo/production.service.ts','apps/api/src/modules/amo/warehouse-control.service.ts',
 'apps/api/src/modules/ops/operational-planning.service.ts','apps/api/src/modules/ops/ops.migration.ts'
]
missing=[x for x in required if not Path(x).is_file()]
if missing: print('FAIL  P1 closure files missing:',','.join(missing)); sys.exit(1)
sql=Path('apps/api/db/migrations/0039_p1_closure.sql').read_text()
for table in ['work_package_shift_allocations','non_routines','labour_entries','stock_lots','part_loans','ofp_packages','cabin_requirements','frms_assessments']:
    if table not in sql: print('FAIL  P1 migration missing',table); sys.exit(1)
ops=Path('apps/api/src/modules/ops/operational-planning.service.ts').read_text()
for gate in ['ops.ofp_provider.','crew.frms_model.','cabinDutyKey']:
    if gate not in ops: print('FAIL  P1 operational governance missing',gate); sys.exit(1)
mig=Path('apps/api/src/modules/ops/ops.migration.ts').read_text()+Path('apps/api/src/modules/amo/amo.migration.ts').read_text()
for target in ["target='ops.crew'","target='ops.flight_schedule'","target='amo.stock_lot'"]:
    if target not in mig: print('FAIL  P1 migration adapter missing',target); sys.exit(1)
sdk=json.loads(Path('packages/sdk/package.json').read_text())
if sdk.get('private') is True or sdk.get('version')!=json.loads(Path('package.json').read_text())['version']:
    print('FAIL  SDK is not publishable/version aligned'); sys.exit(1)
print('PASS  remaining P1 closure controls are present')
PYP1


python - <<'PYP2' || fail=1
from pathlib import Path
import sys
required=[
 'apps/api/db/migrations/0040_p2_closure.sql','apps/web/src/features/business/Home.tsx','apps/web/src/components/WorkspaceViews.tsx',
 'docs/adr/0042-p2-closure-enterprise-ux-finance.md'
]
missing=[x for x in required if not Path(x).is_file()]
if missing: print('FAIL  P2 closure files missing:',','.join(missing)); sys.exit(1)
sql=Path('apps/api/db/migrations/0040_p2_closure.sql').read_text()
for table in ['platform.user_views','org.erp_profiles','org.erp_export_batches']:
    if table not in sql: print('FAIL  P2 migration missing',table); sys.exit(1)
if sql.count('ENABLE ROW LEVEL SECURITY') < 3: print('FAIL  P2 tenant isolation incomplete'); sys.exit(1)
finance=Path('apps/api/src/modules/org/finance.service.ts').read_text()
for invariant in ['ERP_PERIOD_OPEN','ERP_UNBALANCED','contentSha256','erp.export.acknowledged','erp.export.rejected']:
    if invariant not in finance: print('FAIL  ERP integration invariant missing',invariant); sys.exit(1)
home=Path('apps/web/src/features/business/Home.tsx').read_text()
views=Path('apps/web/src/components/WorkspaceViews.tsx').read_text()
if 'Role-aware landing page' not in home or '/preferences/views' not in views: print('FAIL  enterprise UX closure incomplete'); sys.exit(1)
shell=Path('apps/web/src/app/Shell.tsx').read_text()
for prohibited in ["label: 'Workflow'","label: 'Workspace'","label: 'ERP'"]:
    if prohibited in shell: print('FAIL  P2 introduced workflow/platform navigation clutter',prohibited); sys.exit(1)
print('PASS  remaining P2 closure controls are present')
PYP2

python - <<'PYEVIDENCE' || fail=1
from pathlib import Path
import sys
required=['scripts/assurance/evidence.py','scripts/assurance/verify-evidence.py','scripts/security/secret-rotation-drill.sh','.github/workflows/assurance-evidence.yml','docs/ASSURANCE-EVIDENCE.md']
missing=[x for x in required if not Path(x).is_file()]
if missing: print('FAIL  P0 evidence controls missing:', ','.join(missing)); sys.exit(1)
wf=Path('.github/workflows/assurance-evidence.yml').read_text()
for token in ['cosign sign-blob','actions/upload-artifact@v4','retention-days','scripts/dependency-gate.sh','D089','D090','D091','D092']:
    if token not in wf: print('FAIL  assurance evidence workflow missing',token); sys.exit(1)
rot=Path('scripts/security/secret-rotation-drill.sh').read_text()
for token in ['resourceVersion','podsReplaced=true','rollout status']:
    if token not in rot: print('FAIL  secret rotation proof missing',token); sys.exit(1)
print('PASS  retained assurance-evidence and secret-rotation controls are present')
PYEVIDENCE

python3 scripts/security/verify-exceptions.py || fail=1

python - <<'PYSUPPLY' || fail=1
from pathlib import Path
import sys
required=['scripts/release/build-evidence-index.py','scripts/release/verify-release-evidence.py','docs/RELEASE-EVIDENCE.md','.github/security/exceptions.json','docs/SECURITY-EXCEPTIONS.md']
missing=[x for x in required if not Path(x).is_file()]
if missing: print('FAIL  P0 supply-chain/security governance artifacts missing:',','.join(missing)); sys.exit(1)
rel=Path('.github/workflows/release.yml').read_text()
for token in ['aggregate-release-evidence','image-verify-${APP}.json','release-evidence.json','retention-days: 365']:
    if token not in rel: print('FAIL  release evidence workflow missing',token); sys.exit(1)
sec=Path('.github/workflows/security.yml').read_text()
for token in ['security-exception-inputs','scripts/security/verify-exceptions.py','trivyignores: .trivyignore']:
    if token not in sec: print('FAIL  governed security exception integration missing',token); sys.exit(1)
print('PASS  P0 release-evidence and security-exception governance controls are present')
PYSUPPLY

python3 scripts/verify-rulepack-manifest.py || fail=1
python3 scripts/verify-p0-regulatory.py || fail=1


python - <<'PYD003' || fail=1
from pathlib import Path
import sys
m=Path('apps/api/db/migrations/0043_ops_reference_tenant_scope.sql').read_text()
svc=Path('apps/api/src/modules/ops/dispatch.service.ts').read_text()
test=Path('tests/integration/tenant-rls.sql').read_text()
for table in ['aircraft_types','runway_limits','routes','permit_rules']:
    if f'ON ops.{table}' not in m and 'ON ops.%I' not in m:
        print('FAIL D003 missing tenant policy for',table); sys.exit(1)
for token in ['operator_id text NOT NULL','FORCE ROW LEVEL SECURITY','WHERE t.operator_id=p_operator','WHERE r.operator_id=p_operator']:
    if token not in m: print('FAIL D003 migration invariant missing',token); sys.exit(1)
for token in ['eq(aircraftTypes.operatorId, operatorId)','eq(runwayLimits.operatorId, p.operatorId)','eq(routes.operatorId, p.operatorId)','eq(permitRules.operatorId, p.operatorId)']:
    if token not in svc: print('FAIL D003 dispatch query not tenant scoped',token); sys.exit(1)
for table in ['ops.aircraft_types','ops.runway_limits','ops.routes','ops.permit_rules']:
    if table not in test: print('FAIL D003 runtime RLS test missing',table); sys.exit(1)
print('PASS  D003 regulated Operations references are tenant-owned and runtime RLS coverage is present')
PYD003

python scripts/verify-mnt-depth.py || fail=1
python scripts/verify-supply-depth.py || fail=1
python scripts/verify-records-depth.py || fail=1
python scripts/verify-ops-depth.py || fail=1
python scripts/verify-safety-depth.py || fail=1
python scripts/verify-crew-depth.py || fail=1
python scripts/verify-engineering-depth.py || fail=1
python scripts/verify-commercial-depth.py || fail=1
python scripts/verify-quality-depth.py || fail=1
python scripts/verify-continuing-airworthiness-depth.py || fail=1
python scripts/verify-compliance-depth.py || fail=1
python scripts/verify-analytics-depth.py || fail=1
python scripts/verify-integration-migration-depth.py || fail=1

exit "$fail"
