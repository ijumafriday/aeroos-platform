import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assessQualityRisk, closeFinding, findingDue, qualityResponseWindowDays } from './index';

const at = new Date('2026-10-09T08:00:00Z');

describe('Quality: findings and CAPA closure', () => {
  test('due dates by level', () => {
    assert.equal(findingDue('LEVEL_1', at).toISOString().slice(0, 10), '2026-10-16');
    assert.equal(findingDue('LEVEL_2', at).toISOString().slice(0, 10), '2027-01-07');
  });
  test('finding closure needs a root cause and verified actions; level 1 by a second person', () => {
    const f = { id: 'F-1', level: 'LEVEL_1' as const, status: 'OPEN' as const, raisedBy: 'auditor', rootCause: null, version: 1 };
    assert.throws(() => closeFinding(f, [], 'quality.manager'), /root cause/);
    const rc = { ...f, rootCause: 'No recall system for calibration due dates' };
    assert.throws(() => closeFinding(rc, [], 'quality.manager'), /verified corrective action/);
    assert.throws(() => closeFinding(rc, [{ status: 'VERIFIED' }], 'auditor'), /someone other/);
    assert.equal(closeFinding(rc, [{ status: 'VERIFIED' }], 'quality.manager').status, 'CLOSED');
    assert.equal(closeFinding({ ...f, level: 'OBSERVATION' }, [], 'auditor').status, 'CLOSED');
  });

  test('quality risk matrix classifies 5x5 assurance risk and response windows', () => {
    assert.deepEqual(assessQualityRisk(5, 5), { likelihood: 5, impact: 5, score: 25, classification: 'CRITICAL' });
    assert.equal(assessQualityRisk(4, 3).classification, 'HIGH');
    assert.equal(assessQualityRisk(3, 2).classification, 'MEDIUM');
    assert.equal(assessQualityRisk(1, 5).classification, 'LOW');
    assert.equal(qualityResponseWindowDays('CRITICAL'), 1);
    assert.equal(qualityResponseWindowDays('HIGH'), 7);
    assert.throws(() => assessQualityRisk(0, 5), /Likelihood/);
  });
});
