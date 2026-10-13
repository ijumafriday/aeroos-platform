import test from 'node:test';
import assert from 'node:assert/strict';
import { effectivityMatches, validateConfiguration, assertNoPositionCycle, assertEffectivityValid } from './configuration';

test('effectivity accepts exact tails and MSN ranges', () => {
  assert.equal(effectivityMatches({ tails: ['5Y-ABC'] }, { tail: '5Y-ABC', msn: '1234' }), true);
  assert.equal(effectivityMatches({ msnRanges: [{ from: '1200', to: '1299' }] }, { tail: '5Y-XYZ', msn: '1234' }), true);
  assert.equal(effectivityMatches({ msnRanges: [{ from: '1200', to: '1299' }] }, { tail: '5Y-XYZ', msn: '1300' }), false);
});

test('configuration validation finds missing, non-allowable and modification issues', () => {
  const positions = [
    { id: 'p1', code: 'ENG-1', parentId: null, ata: '71', title: 'Engine 1', required: true, maxQty: 1, effectivity: {} },
    { id: 'p2', code: 'APU', parentId: null, ata: '49', title: 'APU', required: true, maxQty: 1, effectivity: {} }
  ];
  const issues = validateConfiguration({ tail: '5Y-ABC', msn: '1234' }, positions,
    [{ positionId: 'p1', partNo: 'CFM56-7B', requiredMods: ['SB-72-001'] }],
    [{ id: 'i1', positionId: 'p1', partNo: 'CFM56-7B', serial: 'E001', mods: [] }]);
  assert.deepEqual(issues.map(i => i.code).sort(), ['REQUIRED_MOD_MISSING', 'REQUIRED_POSITION_EMPTY']);
});

test('configuration hierarchy cycles are rejected', () => {
  assert.throws(() => assertNoPositionCycle([
    { id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }
  ]), /cycle/i);
});


test('effectivity rejects reversed MSN ranges and duplicate tails', () => {
  assert.throws(() => assertEffectivityValid({ msnRanges: [{ from: '1300', to: '1200' }] }), /reversed/i);
  assert.throws(() => assertEffectivityValid({ tails: ['5Y-ABC', '5Y-ABC'] }), /duplicates/i);
});
