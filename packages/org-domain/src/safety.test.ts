import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeOccurrence, morDeadline, morOverdue, risk, triage, type Occurrence } from './index';

const at = new Date('2026-10-09T08:00:00Z');
const occ = (over: Partial<Occurrence> = {}): Occurrence => ({
  id: 'OR-1', status: 'REPORTED', reportedAt: at, mandatory: false, authorityReportedAt: null, probability: null, severity: null,
  investigator: null, findings: null, residualProbability: null, residualSeverity: null, version: 1, ...over
});

describe('Safety: risk and occurrences', () => {
  test('ICAO 5×5 tolerability', () => {
    assert.deepEqual(risk(4, 'B'), { index: '4B', tolerability: 'INTOLERABLE' });
    assert.equal(risk(3, 'C').tolerability, 'TOLERABLE');
    assert.equal(risk(2, 'D').tolerability, 'ACCEPTABLE');
    assert.equal(risk(1, 'A').tolerability, 'TOLERABLE');
  });
  test('MOR: 72 hours to the authority', () => {
    const o = occ({ mandatory: true });
    assert.equal(morDeadline(o).toISOString(), '2026-10-12T08:00:00.000Z');
    assert.equal(morOverdue(o, new Date('2026-10-12T09:00:00Z')), true);
    assert.equal(morOverdue({ ...o, authorityReportedAt: at }, new Date('2026-10-20')), false);
  });
  test('a risk that is not acceptable needs an investigation', () => {
    assert.throws(() => triage(occ(), { mandatory: false, probability: 3, severity: 'C', investigator: null }), /assign an investigator/);
    assert.equal(triage(occ(), { mandatory: false, probability: 3, severity: 'C', investigator: 'safety.manager' }).status, 'UNDER_INVESTIGATION');
    assert.equal(triage(occ(), { mandatory: false, probability: 2, severity: 'D', investigator: null }).status, 'TRIAGED');
  });
  test('closure: MOR filed, findings, actions verified, residual risk not intolerable', () => {
    const inv = triage(occ({ mandatory: true }), { mandatory: true, probability: 4, severity: 'C', investigator: 'safety.manager' });
    const res = { residualProbability: 2 as const, residualSeverity: 'C' as const, findings: 'Torque wrench out of calibration used on the wheel nuts.' };
    assert.throws(() => closeOccurrence(inv, res, []), /authority/);
    const filed = { ...inv, authorityReportedAt: at };
    assert.throws(() => closeOccurrence(filed, { ...res, findings: 'short' }, []), /findings/);
    assert.throws(() => closeOccurrence(filed, res, [{ status: 'DONE' }]), /not yet verified/);
    assert.throws(() => closeOccurrence(filed, { ...res, residualProbability: 5, residualSeverity: 'A' }, []), /intolerable/);
    assert.equal(closeOccurrence(filed, res, [{ status: 'VERIFIED' }]).status, 'CLOSED');
  });
});
