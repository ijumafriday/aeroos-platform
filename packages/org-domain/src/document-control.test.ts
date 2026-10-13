import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { approveRevision, asOf, canAcknowledge, draftRevision, effective, type Revision } from './index';

const now = new Date('2026-10-09T08:00:00Z');
const r1: Revision = { documentId: 'MOE', revision: 1, status: 'EFFECTIVE', summary: 'Initial issue', effectiveFrom: '2025-01-01', authoredBy: 'a', approvedBy: 'b', approvedAt: new Date('2024-12-01') };

describe('Document & manual control', () => {
  test('a new revision is numbered, needs a summary, one at a time', () => {
    assert.throws(() => draftRevision([r1], 'MOE', 'short', 'quality.manager'), /Summarise/);
    const d = draftRevision([r1], 'MOE', 'Chapter 2.13 — tool control updated', 'quality.manager');
    assert.equal(d.revision, 2);
    assert.throws(() => draftRevision([r1, d], 'MOE', 'Another change to chapter 3', 'x'), /already in draft/);
  });
  test('approval: second person, a file, today or later', () => {
    const d = draftRevision([r1], 'MOE', 'Chapter 2.13 — tool control updated', 'quality.manager');
    assert.throws(() => approveRevision(d, 'quality.manager', '2026-10-09', now, true), /other than its author/);
    assert.throws(() => approveRevision(d, 'accountable', '2026-10-09', now, false), /Attach/);
    assert.throws(() => approveRevision(d, 'accountable', '2026-10-01', now, true), /today or later/);
    assert.equal(approveRevision(d, 'accountable', '2026-10-15', now, true).status, 'APPROVED');
  });
  test('the newest approved revision whose date has come is effective; older ones are superseded', () => {
    const d = { ...draftRevision([r1], 'MOE', 'Chapter 2.13 — tool control updated', 'q'), status: 'APPROVED' as const, effectiveFrom: '2026-10-15', approvedBy: 'b' };
    assert.equal(effective([r1, d], now)?.revision, 1);
    const later = asOf([r1, d], new Date('2026-10-15T00:00:00Z'));
    assert.deepEqual(later.map(r => r.status), ['SUPERSEDED', 'EFFECTIVE']);
  });
  test('only the effective revision can be acknowledged, by its audience', () => {
    assert.throws(() => canAcknowledge([r1], 2, now, ['certifying_staff'], ['certifying_staff']), /not the effective/);
    assert.throws(() => canAcknowledge([r1], 1, now, ['certifying_staff'], ['storekeeper']), /not distributed/);
    assert.doesNotThrow(() => canAcknowledge([r1], 1, now, ['certifying_staff'], ['certifying_staff']));
  });
});
