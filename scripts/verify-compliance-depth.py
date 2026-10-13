#!/usr/bin/env python3
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]; errs=[]
reg=json.loads((ROOT/'docs/COMPLIANCE-DEPTH-REGISTER.json').read_text()); items=reg['items']
if len(items)<124: errs.append(f'expected at least 124 Compliance capabilities, found {len(items)}')
if [x['id'] for x in items] != [f'COM-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Compliance IDs not continuous')
for x in items:
 if x.get('status')!='IMPLEMENTED': errs.append(f"{x['id']} not IMPLEMENTED")
 for e in x.get('evidence',[]):
  if not (ROOT/e).exists(): errs.append(f"{x['id']} missing evidence {e}")
mig=(ROOT/'apps/api/db/migrations/0054_compliance_completion.sql').read_text()
for t in ['authority_profiles','regulatory_requirements','requirement_applicability','requirement_evidence','regulatory_changes','regulatory_change_assessments','compliance_reviews']:
 if f'CREATE TABLE compliance.{t}' not in mig: errs.append(f'missing Compliance table {t}')
for token in ['FORCE ROW LEVEL SECURITY','source_sha256 char(64)','AUTHORITY_ACCEPTANCE','CONDITIONAL','action_refs jsonb','evidence_sha256 char(64)']:
 if token not in mig: errs.append(f'Compliance migration invariant missing {token}')
svc=(ROOT/'apps/api/src/modules/compliance/compliance-control.service.ts').read_text()
for token in ['INDEPENDENT_AUTHORITY_PROFILE_APPROVAL','APPROVED_AUTHORITY_PROFILE_REQUIRED','INDEPENDENT_REQUIREMENT_APPROVAL','INDEPENDENT_APPLICABILITY_APPROVAL','INDEPENDENT_EVIDENCE_VERIFICATION','REGULATORY_CHANGE_ACTION_REQUIRED','INDEPENDENT_REGULATORY_CHANGE_APPROVAL','IMPLEMENTED_ASSESSMENT_REQUIRED','INDEPENDENT_COMPLIANCE_REVIEW_APPROVAL','sha256']:
 if token not in svc: errs.append(f'Compliance service invariant missing {token}')
ui=(ROOT/'apps/web/src/features/quality/ComplianceControl.tsx').read_text()
for tab in ["['authorities','Authority Profiles']","['requirements','Applicability & Requirements']","['changes','Regulatory Change']","['reviews','Compliance Review']"]:
 if tab not in ui: errs.append(f'compact Compliance workspace tab missing {tab}')
policy=(ROOT/'infra/cerbos/policies/compliance_control.yaml').read_text()
for role in ['auditor','quality_manager','accountable_manager']:
 if role not in policy: errs.append(f'Compliance role missing {role}')
master=json.loads((ROOT/'docs/MASTER-DEFICIENCY-REGISTER.json').read_text()); d21=next(x for x in master['items'] if x['id']=='D021'); d22=next(x for x in master['items'] if x['id']=='D022')
if d21['status']!='PARTIAL': errs.append('D021 must remain PARTIAL pending independent authority qualification')
if d22['status']!='EXTERNAL': errs.append('D022 must remain EXTERNAL')
if errs:
 print('FAIL  Compliance depth register'); print('\n'.join(' - '+e for e in errs)); sys.exit(1)
print(f'PASS  Compliance depth register: {len(items)}/{len(items)} capabilities implemented')
