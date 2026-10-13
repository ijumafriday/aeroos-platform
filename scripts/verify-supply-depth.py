#!/usr/bin/env python3
from pathlib import Path
import json,sys,re
ROOT=Path(__file__).resolve().parents[1]
reg=json.loads((ROOT/'docs/SUPPLY-DEPTH-REGISTER.json').read_text())
items=reg.get('items',[])
errs=[]
if len(items)<50: errs.append(f'expected at least 50 Supply capabilities, found {len(items)}')
ids=[x.get('id') for x in items]
if ids != [f'SUP-{i:03d}' for i in range(1,len(items)+1)]: errs.append('Supply capability IDs are not continuous')
for x in items:
    if x.get('status')!='IMPLEMENTED': errs.append(f"{x.get('id')} is not IMPLEMENTED")
    for e in x.get('evidence',[]):
        if not (ROOT/e).exists(): errs.append(f"{x.get('id')} missing evidence {e}")

mig=(ROOT/'apps/api/db/migrations/0045_supply_completion.sql').read_text()
required_tables=['inventory_count_sessions','inventory_count_lines','fulfillment_orders','fulfillment_items','fulfillment_picks','replenishment_policies','demand_forecasts','consignment_agreements','supplier_scorecards','supplier_quality_events','supplier_price_agreements','source_decisions','warranty_entitlements','warranty_recoveries','aog_shipments']
for t in required_tables:
    if f'CREATE TABLE amo.{t}' not in mig: errs.append(f'missing table {t}')
    if t not in mig.split('ENABLE ROW LEVEL SECURITY')[-1] and "FOREACH t IN ARRAY" not in mig: errs.append(f'RLS evidence missing for {t}')
for token in ['FORCE ROW LEVEL SECURITY','inventory_count_seq','fulfillment_seq','aog_shipment_seq','consignment_agreement_id']:
    if token not in mig: errs.append(f'migration invariant missing {token}')
svc=(ROOT/'apps/api/src/modules/amo/supply-control.service.ts').read_text()
for token in ['COUNT_STALE','PICK_AVAILABLE','FULFILLMENT_SHORT','weightedDemand','replenishmentProposal','supplierScore','warrantyEligible','SOURCE_SCORE','SOURCE_CONTRACT_PRICE','AOG_SHIPMENT_STATE','forecast_derived','supplier_quality_event','price_agreement_created','PRICE_OVERLAP','Superseded by new source decision']:
    if token not in svc: errs.append(f'Supply service invariant missing {token}')
ui=(ROOT/'apps/web/src/features/stores/Supply.tsx').read_text()
for tab in ["['procurement', 'Procurement']","['inventory', 'Inventory control']","['logistics', 'Logistics & AOG']","['planning', 'Planning & sources']","['commercial', 'Warranty & contracts']"]:
    if tab not in ui: errs.append(f'compact Supply workspace tab missing {tab}')
if ui.count("const TABS")!=1 or "['requisitions', 'Requisitions & quotes']" in ui: errs.append('legacy workflow-tab pile remains in Supply workspace')
shell=(ROOT/'apps/web/src/app/Shell.tsx').read_text()
if shell.count("key: 'supply'")!=1: errs.append('Supply top-level domain duplicated')
for prohibited in ['Cycle Count','Replenishment','AOG Logistics','Supplier Scorecards','Fulfillment']:
    # only inspect the DOMAINS declaration prefix, not incidental component text
    if prohibited in shell.split('export function Shell')[0]: errs.append(f'Supply workflow leaked into main navigation: {prohibited}')

domain=(ROOT/'packages/mro-domain/src/supply-control.ts').read_text()
for token in ['weightedDemand','replenishmentProposal','supplierScore','warrantyEligible','inventoryVariance']:
    if token not in domain: errs.append(f'pure Supply domain rule missing {token}')
if errs:
    print('FAIL  Supply depth register')
    print('\n'.join(' - '+e for e in errs));sys.exit(1)
print(f"PASS  Supply depth register: {len(items)}/{len(items)} capabilities implemented")
