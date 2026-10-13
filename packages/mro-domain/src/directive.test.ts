import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applicability, applyOverrides, checkInstallation, confirmNotApplicable, supersede, supersedingStart, daysToEffective, evaluate, incorporate, lifeNow, removal, toRequirement, type ComponentEvent, type Directive, type Installed } from './index';

const fleet = [
  { reg: 'LN-ABC', type: 'B737-800', msn: '41234' },
  { reg: 'LN-ABD', type: 'B737-800', msn: '42890' },
  { reg: 'LN-NGX', type: 'B737 MAX 8', msn: '61001' }
];
const at = new Date('2026-10-09T08:00:00Z');
const ad = (over: Partial<Directive> = {}): Directive => ({
  id: 'DIR-1', operatorId: 'NKX', kind: 'AD', ref: 'EASA AD 2026-0201', revision: '', authority: 'EASA', title: 'Elevator tab rod — inspection', ata: '27',
  types: ['B737-800'], msnRanges: [{ from: '40000', to: '42000' }], effective: '2026-10-20', action: 'Inspect the tab control rod per SB 737-27-1350',
  interval: { fc: 3000, toleranceFc: 100 }, repetitive: true, estimatedHours: 3, steps: [], supersedes: null, status: 'RECEIVED', decision: null,
  decisionReason: null, evaluatedBy: null, evaluatedAt: null, incorporatedBy: null, incorporatedAt: null, confirmedBy: null, confirmedAt: null, requirementId: null, version: 1, ...over
});

describe('AD / SB intake', () => {
  test('applicability by type and MSN range', () => {
    const a = applicability(ad(), fleet);
    assert.deepEqual(a.map(x => [x.tail, x.applicable]), [['LN-ABC', true], ['LN-ABD', false], ['LN-NGX', false]]);
    assert.match(a[1].reason, /outside/);
    assert.equal(applicability(ad({ msnRanges: null }), fleet).filter(x => x.applicable).length, 2);
  });
  test('overrides need a reason and are marked', () => {
    const auto = applicability(ad(), fleet);
    assert.throws(() => applyOverrides(auto, [{ tail: 'LN-ABC', applicable: false, reason: 'x' }]), /reason/);
    const t = applyOverrides(auto, [{ tail: 'LN-ABC', applicable: false, reason: 'Mod 27-0099 embodied at production' }]);
    assert.equal(t[0].applicable, false);
    assert.equal(t[0].overridden, true);
  });
  test('an applicable AD is mandatory: no defer, no reject, no "not applicable"', () => {
    const tails = applicability(ad(), fleet);
    assert.throws(() => evaluate(ad(), 'DEFER', 'Waiting for parts from Boeing', tails, 'camo.engineer', at), /mandatory/);
    assert.throws(() => evaluate(ad(), 'REJECT', 'Not needed on our routes', tails, 'camo.engineer', at), /mandatory/);
    assert.throws(() => evaluate(ad(), 'NOT_APPLICABLE', 'We think not', tails, 'camo.engineer', at), /still marked applicable/);
    const e = evaluate(ad(), 'COMPLY', null, tails, 'camo.engineer', at);
    assert.equal(e.status, 'EVALUATED');
    assert.equal(e.version, 2);
  });
  test('an SB may be deferred or rejected with a justification', () => {
    const sb = ad({ kind: 'SB', ref: 'SB 737-25-1820' });
    const tails = applicability(sb, fleet);
    assert.throws(() => evaluate(sb, 'REJECT', 'no', tails, 'camo.engineer', at), /justification/);
    assert.equal(evaluate(sb, 'REJECT', 'Cabin mod not wanted by the operator', tails, 'camo.engineer', at).status, 'REJECTED');
    assert.equal(evaluate(sb, 'DEFER', 'Embody at next C-check in 2027', tails, 'camo.engineer', at).status, 'DEFERRED');
    assert.throws(() => evaluate(sb, 'COMPLY', null, tails, 'camo.engineer', at), /embodied/);
  });
  test('incorporation needs a second person and an evaluation', () => {
    const e = evaluate(ad(), 'COMPLY', null, applicability(ad(), fleet), 'camo.engineer', at);
    assert.throws(() => incorporate(ad(), 'AD-X', 'camo.manager', at), /evaluated/);
    assert.throws(() => incorporate(e, 'AD-X', 'camo.engineer', at), /different people/);
    const i = incorporate(e, 'AD-X', 'camo.manager', at);
    assert.equal(i.status, 'INCORPORATED');
    assert.throws(() => evaluate(i, 'COMPLY', null, [], 'x', at), /incorporated/);
  });
  test('an AD overridden away on its applicable aircraft needs a second person to close', () => {
    const tails = applyOverrides(applicability(ad(), fleet), [{ tail: 'LN-ABC', applicable: false, reason: 'Mod 27-0099 embodied at production' }]);
    const e = evaluate(ad(), 'NOT_APPLICABLE', 'Mod embodied on the only affected aircraft', tails, 'camo.engineer', at);
    assert.equal(e.status, 'NOT_APPLICABLE_PENDING');
    assert.throws(() => confirmNotApplicable(e, 'camo.engineer', at), /different people/);
    assert.equal(confirmNotApplicable(e, 'camo.manager', at).status, 'NOT_APPLICABLE');
    // No published applicability overridden (types/MSN exclude the fleet): one person may close it.
    const none = ad({ msnRanges: [{ from: '1', to: '2' }] });
    assert.equal(evaluate(none, 'NOT_APPLICABLE', 'MSN range excludes our fleet', applicability(none, fleet), 'camo.engineer', at).status, 'NOT_APPLICABLE');
  });
  test('a superseding AD starts no later than the previous compliance', () => {
    const own = { at: new Date('2026-10-20'), fh: 21500, fc: 14250 };
    assert.deepEqual(supersedingStart(own, { at: new Date('2025-01-01'), fh: 18000, fc: 11000 }), { at: new Date('2025-01-01'), fh: 18000, fc: 11000 });
    assert.deepEqual(supersedingStart(own, null), own);
    assert.equal(supersede(ad({ status: 'INCORPORATED' })).status, 'SUPERSEDED');
  });
  test('the requirement carries no tolerance for an AD', () => {
    const r = toRequirement(ad({ revision: '1' }), 'R-AD');
    assert.equal(r.kind, 'AD');
    assert.equal(r.ref, 'EASA AD 2026-0201 R1');
    assert.equal(r.interval.toleranceFc, undefined);
    assert.deepEqual(r.steps, ['Inspect the tab control rod per SB 737-27-1350']);
    assert.equal(daysToEffective(ad(), at), 11);
  });
});

describe('Component history (back to birth)', () => {
  const inst: Installed = { partNo: 'CFM56-7B-LLP-HPT1', serial: 'HPT-0042', tail: 'LN-ABC', position: 'ENG 1', installedAt: new Date('2025-01-01T00:00:00Z'), aircraftAtInstall: { fh: 20000, fc: 13000 }, tsnAtInstall: 15000, csnAtInstall: 9000 };
  test('life now = life at installation + what the aircraft flew since', () => {
    assert.deepEqual(lifeNow(inst, { at, fh: 21450.55, fc: 14210 }), { tsn: 16450.6, csn: 10210 });
    assert.throws(() => lifeNow(inst, { at, fh: 19000, fc: 12000 }), /below/);
  });
  test('removal records TSN/CSN and needs a reference', () => {
    assert.throws(() => removal(inst, { at, fh: 21000, fc: 14000 }, 'SCHEDULED', ''), /reference/);
    const r = removal(inst, { at, fh: 21000, fc: 14000 }, 'SCHEDULED', 'WO-778');
    assert.equal(r.type, 'REMOVED');
    assert.equal(r.csn, 10000);
  });
  test('installation cannot lose time, double-install, or skip the certificate', () => {
    const hist: ComponentEvent[] = [
      { partNo: 'P', serial: 'S', type: 'INSTALLED', tail: 'LN-ABC', position: 'ENG 1', at: new Date('2025-01-01'), tsn: 100, csn: 50, reason: null, reference: 'F1-1' },
      { partNo: 'P', serial: 'S', type: 'REMOVED', tail: 'LN-ABC', position: 'ENG 1', at: new Date('2026-01-01'), tsn: 900, csn: 600, reason: 'UNSERVICEABLE', reference: 'TC-1' }
    ];
    assert.throws(() => checkInstallation(hist, { partNo: 'P', serial: 'S', tsn: 800, csn: 600, reference: 'x' }), /cannot be installed with less/);
    assert.throws(() => checkInstallation(hist.slice(0, 1), { partNo: 'P', serial: 'S', tsn: 900, csn: 600, reference: 'x' }), /still installed/);
    assert.throws(() => checkInstallation([], { partNo: 'Q', serial: 'N', tsn: 0, csn: 0, reference: '' }), /release certificate/);
    assert.throws(() => checkInstallation(hist, { partNo: 'P', serial: 'S', tsn: 900, csn: 20000, reference: 'x' }, { fc: 20000 }), /life limit/);
    assert.equal(checkInstallation(hist, { partNo: 'P', serial: 'S', tsn: 950, csn: 610, reference: 'Form 1 77812' }).previous?.type, 'REMOVED');
  });
});
