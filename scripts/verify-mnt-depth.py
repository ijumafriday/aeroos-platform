#!/usr/bin/env python3
from pathlib import Path
import json,re,sys
ROOT=Path(__file__).resolve().parents[1]
reg=json.loads((ROOT/'docs/MNT-DEPTH-REGISTER.json').read_text())
items=reg.get('items',[])
errors=[]
expected=[f'MNT-{i:03d}' for i in range(1,60)]
ids=[x.get('id') for x in items]
if ids!=expected: errors.append(f'MNT IDs must be contiguous MNT-001..MNT-059; got {len(ids)} items')
for x in items:
    if x.get('status')!='IMPLEMENTED': errors.append(f"{x.get('id')} is not IMPLEMENTED")
    ev=x.get('evidence') or []
    if not ev: errors.append(f"{x.get('id')} has no evidence")
    for e in ev:
        if not (ROOT/e).exists(): errors.append(f"{x.get('id')} evidence missing: {e}")

mig=(ROOT/'apps/api/db/migrations/0044_mnt_completion.sql').read_text()
expected_tables=['maintenance_station_capabilities','work_orders','line_visits','shift_handovers','handover_items','tool_assets','tool_movements','tool_reservations','shop_orders','shop_findings','shop_piece_parts','task_execution_records','aog_cases','aog_updates','work_package_zones','work_package_access_panels','work_order_assignments','outsourced_work','customer_progress_reports','maintenance_contracts','material_kits','material_kit_items']
for t in expected_tables:
    if not re.search(rf'create\s+table\s+(?:if\s+not\s+exists\s+)?amo\.{re.escape(t)}\b',mig,re.I): errors.append(f'migration missing table amo.{t}')
    # RLS is intentionally applied through the migration's audited table loop.
    if f"'{t}'" not in mig: errors.append(f'amo.{t} missing from RLS table loop')
if "ENABLE ROW LEVEL SECURITY" not in mig or "FORCE ROW LEVEL SECURITY" not in mig or "CREATE POLICY aeroos_tenant_isolation" not in mig:
    errors.append('migration missing dynamic RLS enforcement loop')

svc=(ROOT/'apps/api/src/modules/amo/maintenance-control.service.ts').read_text()
for token in ['STATION_CAPABILITY','STATION_STAFFING','STATION_TOOLS','TOOLS_OUT','OUTSOURCE_OPEN','MATERIAL_KIT_OPEN','SHOP_FINDINGS_OPEN','SHOP_PIECE_PARTS_OPEN','INDEPENDENT_INSPECTION','AOG_RTS_REQUIRED','PANELS_OPEN']:
    if token not in svc: errors.append(f'service enforcement missing {token}')

ui=(ROOT/'apps/web/src/features/maintenance/MaintenanceControl.tsx').read_text()
for token in ['Maintenance Control','Workforce','Material kitting','Tool crib & reservations','Piece-parts / teardown trace','Maintenance contracts & SLA']:
    if token not in ui: errors.append(f'Maintenance UI missing {token!r}')

shell=(ROOT/'apps/web/src/app/Shell.tsx').read_text()
for token in ['Maintenance Control','Planning & Work Packages','Task Cards & Certification']:
    if token not in shell: errors.append(f'Maintenance nav missing {token!r}')
# These capabilities must remain contextual rather than main rail entries.
for bad in ["label: 'Tool Crib'","label: 'AOG'","label: 'Shops'","label: 'Line Maintenance'","label: 'Shift Handover'"]:
    if bad in shell: errors.append(f'workflow/navigation clutter detected: {bad}')

policy=(ROOT/'infra/cerbos/policies/maintenance_control.yaml').read_text()
for role in ['maintenance_planner','maintenance_supervisor','mechanic','tool_controller','certifying_staff']:
    if role not in policy: errors.append(f'policy missing role {role}')
realm=(ROOT/'infra/keycloak/aeroos-realm.json').read_text()
for role in ['maintenance_planner','maintenance_supervisor','mechanic','tool_controller']:
    if role not in realm: errors.append(f'identity realm missing role {role}')

drawer=(ROOT/'apps/web/src/features/taskcards/TaskCardDrawer.tsx').read_text()
if '/amo/maintenance/task-cards/' not in drawer or 'execution' not in drawer: errors.append('task-card execution evidence UI not integrated')
wp=(ROOT/'apps/web/src/features/programme/WorkPackages.tsx').read_text()
if '/amo/maintenance/work-packages/' not in wp or '/floor' not in wp: errors.append('work-package floor/zone control not integrated')

if errors:
    print('MNT depth verification FAILED')
    for e in errors: print(' -',e)
    sys.exit(1)
print(f"MNT depth verification PASS: {len(items)} implemented capabilities; domain navigation remains compact")
