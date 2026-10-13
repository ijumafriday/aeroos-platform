import test from 'node:test';
import assert from 'node:assert/strict';
import type { EventEnvelope } from '@aeroos/contracts';
import { predicateMatches, ruleMatches } from './rules.service';

const event = { id:'00000000-0000-0000-0000-000000000001', occurredAt:new Date().toISOString(), operatorId:'AOC1', actor:'tester', correlationId:null, type:'ops.flight.delayed', data:{ flightId:'F1', flightNo:'AO101', tail:'5Y-AAA', etd:new Date().toISOString(), delayMinutes:45, reason:'WX', knockOn:[] } } as EventEnvelope<'ops.flight.delayed'>;

test('bounded rule predicates evaluate event data', () => {
  assert.equal(predicateMatches(event, { field:'delayMinutes', op:'EQ', value:45 }), true);
  assert.equal(predicateMatches(event, { field:'flightNo', op:'CONTAINS', value:'AO' }), true);
  assert.equal(predicateMatches(event, { field:'tail', op:'IN', value:['5Y-AAA','5Y-BBB'] }), true);
});

test('all predicates are hard AND and any predicates are OR', () => {
  assert.equal(ruleMatches(event, { all:[{field:'delayMinutes',op:'EQ',value:45}], any:[{field:'tail',op:'EQ',value:'5Y-AAA'},{field:'tail',op:'EQ',value:'5Y-ZZZ'}] }), true);
});
