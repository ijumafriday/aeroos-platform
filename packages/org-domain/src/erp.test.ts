import test from 'node:test';
import assert from 'node:assert/strict';
import { erpExportContent } from './erp';
import type { JournalDto } from '@aeroos/contracts';

const journals:JournalDto[]=[{id:'JE-2',entityId:'E1',date:'2026-09-30',period:'2026-09',source:'manual',sourceRef:'M2',memo:'Parts, external',postedBy:'user:a',postedAt:'2026-09-30T10:00:00Z',lines:[{account:'5000',accountName:'Parts',costCentre:'MRO',debitCents:100,creditCents:0}]},{id:'JE-1',entityId:'E1',date:'2026-09-30',period:'2026-09',source:'manual',sourceRef:'M1',memo:'Revenue',postedBy:'user:a',postedAt:'2026-09-30T09:00:00Z',lines:[{account:'4000',accountName:'Revenue',costCentre:'MRO',debitCents:0,creditCents:100}]}];

test('ERP JSON export is deterministic and applies explicit maps',()=>{
  const a=erpExportContent({format:'JSON_JOURNAL_V1',entityId:'E1',entityName:'Entity',period:'2026-09',baseCurrency:'USD',journals,accountMap:{'4000':'REV'},costCentreMap:{MRO:'TECH'}});
  const b=erpExportContent({format:'JSON_JOURNAL_V1',entityId:'E1',entityName:'Entity',period:'2026-09',baseCurrency:'USD',journals:[...journals].reverse(),accountMap:{'4000':'REV'},costCentreMap:{MRO:'TECH'}});
  assert.equal(a,b); assert.match(a,/"account": "REV"/); assert.match(a,/"costCentre": "TECH"/); assert.ok(a.indexOf('JE-1')<a.indexOf('JE-2'));
});

test('ERP CSV quotes commas and preserves unmapped account codes',()=>{
  const csv=erpExportContent({format:'CSV_JOURNAL_V1',entityId:'E1',entityName:'Entity',period:'2026-09',baseCurrency:'USD',journals,accountMap:{},costCentreMap:{}});
  assert.match(csv,/"Parts, external"/); assert.match(csv,/"5000"/); assert.ok(csv.endsWith('\n'));
});
