#!/usr/bin/env python3
import json,re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
s=(root/'packages/contracts/src/index.ts').read_text(encoding='utf-8')
m=re.search(r'export const EVENT_TYPES = (\[.*?\]) as const;',s,re.S)
if not m: raise SystemExit('EVENT_TYPES missing')
events=json.loads(m.group(1))
asyncapi=json.loads((root/'apps/api/contracts/asyncapi.json').read_text(encoding='utf-8'))
openapi=json.loads((root/'apps/api/contracts/openapi.json').read_text(encoding='utf-8'))
contract_events=[]
for ch in asyncapi['channels'].values():
    contract_events += [msg['name'] for msg in ch.get('messages',{}).values()]
if sorted(events)!=sorted(contract_events): raise SystemExit('AsyncAPI event catalogue differs from EVENT_TYPES')
if openapi['info']['version'] != json.loads((root/'package.json').read_text(encoding='utf-8'))['version']: raise SystemExit('OpenAPI version mismatch')
required=['/v1/platform/integrations/webhooks','/v1/platform/integrations/webhooks/{id}','/v1/platform/integrations/webhooks/{id}/deliveries','/v1/platform/migrations','/v1/platform/migrations/{id}/validate','/v1/platform/migrations/{id}/apply','/v1/platform/rules','/v1/platform/rules/event-types','/v1/platform/rules/{id}/activate','/v1/integrations/ops-planning/ofp','/v1/integrations/frms/assessments']
missing=[p for p in required if p not in openapi['paths']]
if missing: raise SystemExit('OpenAPI missing paths: '+','.join(missing))
print(f'PASS  contracts: {len(events)} events, {len(openapi["paths"])} HTTP paths')
