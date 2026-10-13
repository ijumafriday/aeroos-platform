#!/usr/bin/env python3
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]; errs=[]; reg=json.loads((ROOT/'docs/COMMERCIAL-DEPTH-REGISTER.json').read_text()); items=reg['items']
if len(items)<110: errs.append(f'expected at least 110 Commercial capabilities, found {len(items)}')
if [x['id'] for x in items] != [f'COM-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Commercial IDs not continuous')
for x in items:
 if x.get('status')!='IMPLEMENTED': errs.append(f"{x['id']} not IMPLEMENTED")
 for e in x.get('evidence',[]):
  if not (ROOT/e).exists(): errs.append(f"{x['id']} missing evidence {e}")
mig=(ROOT/'apps/api/db/migrations/0051_commercial_completion.sql').read_text()
for t in ['commercial_contracts','commercial_contract_amendments','commercial_rate_cards','commercial_obligations','commercial_cost_allocations','commercial_accruals','inventory_valuation_snapshots','fx_rates','fx_exposures']:
 if f'CREATE TABLE org.{t}' not in mig: errs.append(f'missing Commercial table {t}')
for token in ['FORCE ROW LEVEL SECURITY','terms_sha256','rate_basis jsonb','evidence_required','allocation_basis','reversal_period','source_sha256','unrealized_gain_loss']:
 if token not in mig: errs.append(f'Commercial migration invariant missing {token}')
svc=(ROOT/'apps/api/src/modules/org/commercial-control.service.ts').read_text()
for token in ['INDEPENDENT_COMMERCIAL_APPROVAL','APPROVED_RATE_CARD_REQUIRED','INDEPENDENT_AMENDMENT_APPROVAL','INDEPENDENT_RATE_APPROVAL','OBLIGATION_EVIDENCE_REQUIRED','INDEPENDENT_COST_APPROVAL','INDEPENDENT_ACCRUAL_APPROVAL','INDEPENDENT_VALUATION_APPROVAL','INDEPENDENT_FX_APPROVAL','FX_RATE_CURRENCY_MISMATCH','sha256']:
 if token not in svc: errs.append(f'Commercial service invariant missing {token}')
ui=(ROOT/'apps/web/src/features/business/CommercialControl.tsx').read_text()
for tab in ["['contracts','Contracts & Obligations']","['costing','Revenue & Costing']","['finance','Accruals & Valuation']","['fx','FX & Reconciliation']"]:
 if tab not in ui: errs.append(f'compact Commercial workspace tab missing {tab}')
shell=(ROOT/'apps/web/src/app/Shell.tsx').read_text().split('export function Shell')[0]
if shell.count("key: 'commercial'")!=1: errs.append('Commercial domain duplicated in navigation')
policy=(ROOT/'infra/cerbos/policies/commercial_control.yaml').read_text()
for role in ['finance_controller','accountable_manager','amo_manager']:
 if role not in policy: errs.append(f'Commercial role missing {role}')
if errs:
 print('FAIL  Commercial depth register'); print('\n'.join(' - '+e for e in errs)); sys.exit(1)
print(f'PASS  Commercial depth register: {len(items)}/{len(items)} capabilities implemented')
