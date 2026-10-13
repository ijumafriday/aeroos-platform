#!/usr/bin/env python3
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]; errs=[]; reg=json.loads((ROOT/'docs/QUALITY-DEPTH-REGISTER.json').read_text(encoding='utf-8')); items=reg['items']
if len(items)<120: errs.append(f'expected at least 120 Quality capabilities, found {len(items)}')
if [x['id'] for x in items] != [f'QUA-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Quality IDs not continuous')
for x in items:
 if x.get('status')!='IMPLEMENTED': errs.append(f"{x['id']} not IMPLEMENTED")
 for e in x.get('evidence',[]):
  if not (ROOT/e).exists(): errs.append(f"{x['id']} missing evidence {e}")
mig=(ROOT/'apps/api/db/migrations/0052_quality_completion.sql').read_text(encoding='utf-8')
for t in ['quality_programmes','quality_programme_items','quality_auditor_qualifications','quality_auditor_assignments','quality_surveillance_visits','quality_checklist_results','quality_finding_extensions','quality_assurance_trends','quality_management_reviews']:
 if f'CREATE TABLE org.{t}' not in mig: errs.append(f'missing Quality table {t}')
for token in ['FORCE ROW LEVEL SECURITY','risk_score integer','conflict_of_interest boolean','sample_size integer','finding_id text','requested_due timestamptz','source_sha256 char(64)','programme_coverage_pct']:
 if token not in mig: errs.append(f'Quality migration invariant missing {token}')
svc=(ROOT/'apps/api/src/modules/org/quality-control.service.ts').read_text(encoding='utf-8')
for token in ['INDEPENDENT_PROGRAMME_APPROVAL','APPROVED_PROGRAMME_REQUIRED','QUALIFIED_AUDITOR_REQUIRED','AUDITOR_INDEPENDENCE_REQUIRED','INDEPENDENT_ASSIGNMENT_APPROVAL','SURVEILLANCE_SAMPLE_REQUIRED','SURVEILLANCE_CHECKLIST_REQUIRED','SURVEILLANCE_EVIDENCE_REQUIRED','INDEPENDENT_SURVEILLANCE_REVIEW','INDEPENDENT_EXTENSION_APPROVAL','QUALITY_BREACH_ACTION_REQUIRED','INDEPENDENT_TREND_APPROVAL','INDEPENDENT_MANAGEMENT_REVIEW_APPROVAL','sha256']:
 if token not in svc: errs.append(f'Quality service invariant missing {token}')
ui=(ROOT/'apps/web/src/features/quality/QualityControl.tsx').read_text(encoding='utf-8')
for tab in ["['programme','Programme & Surveillance Plan']","['surveillance','Surveillance Execution']","['competence','Auditor Competence']","['assurance','Assurance Review']"]:
 if tab not in ui: errs.append(f'compact Quality workspace tab missing {tab}')
shell=(ROOT/'apps/web/src/app/Shell.tsx').read_text(encoding='utf-8').split('export function Shell')[0]
if shell.count("key: 'quality'")!=1: errs.append('Quality domain duplicated in navigation')
policy=(ROOT/'infra/cerbos/policies/quality_control.yaml').read_text(encoding='utf-8')
for role in ['quality_manager','auditor','accountable_manager']:
 if role not in policy: errs.append(f'Quality role missing {role}')

riskmig=(ROOT/'apps/api/db/migrations/0057_quality_risk_finding_engine.sql').read_text(encoding='utf-8')
for token in ['likelihood integer','impact integer','risk_score integer','risk_class text','classification_basis text','containment_action text','recurrence boolean','findings_quality_tracker']:
 if token not in riskmig: errs.append(f'Quality risk/finding migration invariant missing {token}')
qdomain=(ROOT/'packages/org-domain/src/quality.ts').read_text(encoding='utf-8')
for token in ['assessQualityRisk','QualityRiskClass','CRITICAL','qualityResponseWindowDays']:
 if token not in qdomain: errs.append(f'Quality risk engine invariant missing {token}')
legacy=(ROOT/'apps/api/src/modules/org/safety-quality.service.ts').read_text(encoding='utf-8')
for token in ['listFindings','classifyFinding','CONTAINMENT_REQUIRED','QUALITY_RISK_CLASSIFICATION_REQUIRED','finding.risk_classified']:
 if token not in legacy: errs.append(f'Finding tracker/risk invariant missing {token}')
audits=(ROOT/'apps/web/src/features/quality/Audits.tsx').read_text(encoding='utf-8')
for token in ['Finding & Non-Compliance Tracker','Risk classification','Classification basis','riskClass','quality-findings']:
 if token not in audits: errs.append(f'Quality finding UI invariant missing {token}')

if errs:
 print('FAIL  Quality depth register'); print('\n'.join(' - '+e for e in errs)); sys.exit(1)
print(f'PASS  Quality depth register: {len(items)}/{len(items)} capabilities implemented')
