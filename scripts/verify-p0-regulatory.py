#!/usr/bin/env python3
from pathlib import Path
root=Path(__file__).resolve().parents[1]
config=(root/'apps/api/src/config.ts').read_text()
for needle in ['SEED_DEMO=true is forbidden in production','ALLOW_DRAFT_RULEPACKS=true is forbidden in production','MOVEMENT_SIMULATION=true is forbidden in production']:
    if needle not in config: raise SystemExit(f'FAIL  production guard missing: {needle}')
master=(root/'apps/api/src/modules/compliance/master-data.service.ts').read_text()
for needle in ['REGULATED_DATASET_DRIFT','current_regulated_dataset_sha256','REGULATED_MASTER_DATA_KEYS']:
    if needle not in master: raise SystemExit(f'FAIL  regulated-data integrity control missing: {needle}')
comp=(root/'apps/api/src/modules/compliance/compliance.service.ts').read_text()
for needle in ['rulepackArtifact','EFFECTIVE independently-approved','artifact.sha256']:
    if needle not in comp: raise SystemExit(f'FAIL  rulepack production governance missing: {needle}')

hyg=(root/'apps/api/db/migrations/0042_regulated_data_hygiene.sql').read_text()
for needle in ['production_regulated_data_hygiene','ILLUSTRATIVE_MIGRATION','demoSeedsApplied','data_origin']:
    if needle not in hyg: raise SystemExit(f'FAIL  regulated-data hygiene control missing: {needle}')
for needle in ['assertProductionDataHygiene','production_regulated_data_hygiene','untrustedAircraftTypes','untrustedEngineTypes']:
    if needle not in comp: raise SystemExit(f'FAIL  production regulated-data startup guard missing: {needle}')
seed_dispatch=(root/'apps/api/db/seeds/9010_dispatch.sql').read_text()
seed_engine=(root/'apps/api/db/seeds/9011_engineering_health.sql').read_text()
if "'DEMO','AeroOS demo dataset'" not in seed_dispatch or "'DEMO','AeroOS demo dataset'" not in seed_engine:
    raise SystemExit('FAIL  demo regulated values are not explicitly owned by demo seeds')

print('PASS  P0 regulated-data and authority-rulepack governance controls')
