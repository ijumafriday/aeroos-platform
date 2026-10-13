import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessAll, assessDamage, checkRepair, damageGrounding, engineAlerts, interactions, linearFit, oilConsumption, requireUplift, shift,
  type Damage, type DamageState, type EngineLimits, type EngineSnapshot, type SrmLimit
} from './index';

const L: EngineLimits = { egtMarginAmber: 25, egtMarginRed: 10, egtShift: 10, n2Shift: 1, ffShift: 2, vibMax: 3, oilAlertQph: 0.3, oilMaxQph: 0.5 };
const snaps = (n: number, f: (i: number) => Partial<EngineSnapshot>): EngineSnapshot[] =>
  Array.from({ length: n }, (_, i) => ({ at: new Date(Date.UTC(2026, 8, 1) + i * 86_400_000), fh: 20000 + i * 8, egtDev: 0, n2Dev: 0, ffDevPct: 0, vib: 1, egtMargin: 60, ...f(i) }));

describe('Engine trend monitoring', () => {
  test('fit and shift helpers', () => {
    assert.deepEqual(linearFit([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]), { slope: 2, intercept: 1 });
    assert.equal(linearFit([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }]), null);
    assert.equal(shift([1, 1, 1, 1, 1, 5, 5, 5, 5, 5]), 4);
    assert.equal(shift([1, 2, 3]), null);
  });

  test('a healthy engine raises nothing; noise does not either', () => {
    assert.deepEqual(engineAlerts(snaps(40, i => ({ egtDev: (i % 3) - 1, egtMargin: 60 + (i % 2) })), L), []);
  });

  test('an EGT step shift is flagged, twice the limit is red', () => {
    const a = engineAlerts(snaps(20, i => ({ egtDev: i >= 15 ? 12 : 0 })), L).find(x => x.code === 'EGT_SHIFT');
    assert.equal(a?.level, 'AMBER');
    assert.match(a!.action, /Borescope/);
    assert.equal(engineAlerts(snaps(20, i => ({ egtDev: i >= 15 ? 25 : 0 })), L).find(x => x.code === 'EGT_SHIFT')?.level, 'RED');
  });

  test('EGT margin limits and the margin trend forecast', () => {
    assert.equal(engineAlerts(snaps(10, () => ({ egtMargin: 20 })), L).find(x => x.code === 'EGT_MARGIN')?.level, 'AMBER');
    assert.equal(engineAlerts(snaps(10, () => ({ egtMargin: 8 })), L).find(x => x.code === 'EGT_MARGIN')?.level, 'RED');
    // 0.25 °C per 8 FH ≈ 3.1 °C / 100 FH, now about 20 °C: about 330 FH to 10 °C
    const t = engineAlerts(snaps(60, i => ({ egtMargin: 35 - i * 0.25 })), L).find(x => x.code === 'EGT_MARGIN_TREND');
    assert.ok(t, 'trend alert');
    assert.match(t!.message, /reaches 10 °C in about \d+ FH/);
    assert.equal(engineAlerts(snaps(60, i => ({ egtMargin: 90 - i * 0.05 })), L).find(x => x.code === 'EGT_MARGIN_TREND'), undefined);
  });

  test('vibration', () => {
    assert.equal(engineAlerts(snaps(5, () => ({ vib: 3.5 })), L)[0].code, 'VIBRATION');
    assert.equal(engineAlerts(snaps(5, () => ({ vib: 5 })), L)[0].level, 'RED');
  });
});

describe('Oil consumption', () => {
  const up = (pairs: [number, number][]) => pairs.map(([fh, q], i) => ({ at: new Date(Date.UTC(2026, 9, 1) + i * 86_400_000), fh, quarts: q }));
  test('rate per uplift and over a window of at least 20 h', () => {
    const r = oilConsumption(up([[1000, 1], [1010, 1], [1020, 1], [1030, 1]]), L);
    assert.equal(r.rates.length, 3);
    assert.equal(r.rates[0].qph, 0.1);
    assert.ok(Math.abs(r.current! - 0.1) < 1e-9);
    assert.deepEqual(r.alerts, []);
  });
  test('alert, limit and doubling', () => {
    assert.equal(oilConsumption(up([[1000, 1], [1010, 3.5], [1020, 3.5]]), L).alerts[0].level, 'AMBER');
    assert.equal(oilConsumption(up([[1000, 1], [1010, 6], [1020, 6]]), L).alerts[0].level, 'RED');
    const rising = oilConsumption(up([[1000, 1], [1010, 0.8], [1020, 0.8], [1030, 2], [1040, 2]]), L);
    assert.equal(rising.alerts[0]?.code, 'OIL_RISING');
    assert.equal(oilConsumption(up([[1000, 1], [1005, 3]]), L).current, null, 'too few hours');
  });
  test('uplift validation', () => {
    assert.throws(() => requireUplift(0, 10, null), /between 0 and 20/);
    assert.throws(() => requireUplift(1, 10, 20), /before the last uplift/);
    assert.doesNotThrow(() => requireUplift(1.5, 30, 20));
  });
});

const SRM: SrmLimit[] = [
  { zone: '200', damageType: 'DENT', srmRef: 'SRM 53-00-01', allowableDepthMm: 2, allowableLengthMm: 50, repairableDepthMm: 6, repairableLengthMm: 150, minSpacingMm: 100, inspectFc: 1000 },
  { zone: '200', damageType: 'CRACK', srmRef: 'SRM 53-00-02', allowableDepthMm: null, allowableLengthMm: 0, repairableDepthMm: null, repairableLengthMm: 25, minSpacingMm: 150, inspectFc: null }
];
const dmg = (over: Partial<Damage>): Damage => ({ id: 'SD-1', zone: '200', side: 'L', damageType: 'DENT', xMm: 10000, yMm: 500, lengthMm: 30, widthMm: 30, depthMm: 1, ...over });

describe('Structural damage', () => {
  test('allowable, repair, refer; cracks never allowable; unknown zone refers', () => {
    assert.equal(assessDamage(dmg({}), SRM).disposition, 'ALLOWABLE');
    assert.equal(assessDamage(dmg({}), SRM).inspectFc, 1000);
    assert.equal(assessDamage(dmg({ depthMm: 4 }), SRM).disposition, 'REPAIR');
    assert.equal(assessDamage(dmg({ depthMm: 8 }), SRM).disposition, 'REFER');
    assert.equal(assessDamage(dmg({ damageType: 'CRACK', lengthMm: 10, depthMm: 0 }), SRM).disposition, 'REPAIR');
    assert.equal(assessDamage(dmg({ damageType: 'CRACK', lengthMm: 40, depthMm: 0 }), SRM).disposition, 'REFER');
    assert.match(assessDamage(dmg({ zone: '500' }), SRM).reason, /No SRM limits/);
  });

  test('two allowable dents close together are assessed as one', () => {
    const a = dmg({ id: 'SD-1' }), b = dmg({ id: 'SD-2', xMm: 10060 });
    const x = interactions([a, b], SRM);
    assert.equal(x.length, 1);
    assert.equal(x[0].gapMm, 30);
    const m = assessAll([a, b], SRM);
    assert.equal(m.get('SD-1')!.disposition, 'REPAIR');
    assert.match(m.get('SD-2')!.reason, /assessed together/);
    assert.equal(interactions([a, dmg({ id: 'SD-3', xMm: 10300 })], SRM).length, 0);
    // a shallow scratch next to a dent: each type judged with its own depth (no mixing) — repair, not refer
    const lim = [...SRM, { zone: '200', damageType: 'SCRATCH' as const, srmRef: 'SRM 53-00-03', allowableDepthMm: 0.1, allowableLengthMm: 100, repairableDepthMm: 0.5, repairableLengthMm: 300, minSpacingMm: 50, inspectFc: null }];
    const mixed = interactions([dmg({ id: 'SD-5', depthMm: 1.5 }), dmg({ id: 'SD-6', damageType: 'SCRATCH', depthMm: 0.05, xMm: 10040, lengthMm: 20 })], lim);
    assert.equal(mixed[0].combined.disposition, 'REPAIR');
    assert.equal(interactions([a, dmg({ id: 'SD-4', xMm: 10060, side: 'R' })], SRM).length, 0);
  });

  test('grounding: unrepaired, temporary repair limits, overdue repeat inspection', () => {
    const now = new Date('2026-10-12T00:00:00Z');
    const s = (over: Partial<DamageState>): DamageState => ({ id: 'SD-1', disposition: 'ALLOWABLE', repair: null, nextInspectionFc: null, approvedData: null, ...over });
    assert.equal(damageGrounding(s({}), 100, now), null);
    assert.match(damageGrounding(s({ disposition: 'REPAIR' }), 100, now)!, /not repaired/);
    assert.equal(damageGrounding(s({ disposition: 'REPAIR', repair: { kind: 'TEMPORARY', untilFc: 200, untilDate: null } }), 100, now), null);
    assert.match(damageGrounding(s({ disposition: 'REPAIR', repair: { kind: 'TEMPORARY', untilFc: 200, untilDate: null } }), 200, now)!, /expired/);
    assert.equal(damageGrounding(s({ disposition: 'REFER', repair: { kind: 'PERMANENT', untilFc: null, untilDate: null } }), 100, now), null);
    assert.match(damageGrounding(s({ nextInspectionFc: 90 }), 100, now)!, /inspection overdue/);
  });

  test('repairs need covering data and temporary limits', () => {
    const now = new Date('2026-10-12T00:00:00Z');
    const refer: DamageState = { id: 'SD-9', disposition: 'REFER', repair: null, nextInspectionFc: null, approvedData: null };
    assert.throws(() => checkRepair(refer, { kind: 'PERMANENT', dataRef: 'SRM 53-00-01' }, 100, now), /approved repair data first/);
    assert.doesNotThrow(() => checkRepair({ ...refer, approvedData: 'TCH RDAS 737-53-1182' }, { kind: 'PERMANENT', dataRef: 'TCH RDAS 737-53-1182' }, 100, now));
    const rep: DamageState = { ...refer, disposition: 'REPAIR' };
    assert.throws(() => checkRepair(rep, { kind: 'TEMPORARY', dataRef: 'SRM 53-00-01' }, 100, now), /needs a limit/);
    assert.throws(() => checkRepair(rep, { kind: 'TEMPORARY', dataRef: 'SRM 53-00-01', untilFc: 90 }, 100, now), /already reached/);
    assert.doesNotThrow(() => checkRepair(rep, { kind: 'TEMPORARY', dataRef: 'SRM 53-00-01', untilFc: 600 }, 100, now));
  });
});
