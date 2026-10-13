import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { completeAction, verifyAction } from './index';

describe('Shared corrective-action primitive', () => {
  test('owner completes with evidence and a second person verifies', () => {
    const a = { id: 'CA-1', owner: 'k.mwangi', status: 'OPEN' as const, doneBy: null, version: 1 };
    assert.throws(() => completeAction(a, 'j.otieno', 'Recalibrated all wrenches', false), /assigned to/);
    assert.throws(() => completeAction(a, 'k.mwangi', 'done', false), /evidence/);
    const d = completeAction(a, 'k.mwangi', 'Recalibrated all torque wrenches, certs in tool crib file', false);
    assert.throws(() => verifyAction(d, 'k.mwangi', true), /someone other/);
    assert.equal(verifyAction(d, 'independent.manager', false).status, 'OPEN');
    assert.equal(verifyAction(d, 'independent.manager', true).status, 'VERIFIED');
  });
});
