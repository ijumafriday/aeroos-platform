import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, resetAfterExtension, type Level } from './schedule';

const H = 3_600_000;
const deadline = Date.parse('2026-10-19T00:00:00Z');

test('waits until 24 hours before the deadline', () => {
  const now = deadline - 5 * 24 * H;
  assert.deepEqual(plan(deadline, now, new Set()), { send: null, markSent: [], waitMs: 4 * 24 * H });
});

test('sends T-24h when it falls due', () => {
  assert.equal(plan(deadline, deadline - 23 * H, new Set()).send, 'T-24h');
});

test('a deferral raised with 4 hours left gets a single T-6h alert', () => {
  const r = plan(deadline, deadline - 4 * H, new Set());
  assert.equal(r.send, 'T-6h');
  assert.deepEqual(r.markSent, ['T-24h', 'T-6h']);
});

test('expiry fires at the deadline and then nothing is left', () => {
  const sent = new Set<Level>(['T-24h', 'T-6h']);
  assert.equal(plan(deadline, deadline, sent).send, 'EXPIRED');
  sent.add('EXPIRED');
  assert.deepEqual(plan(deadline, deadline + H, sent), { send: null, markSent: [], waitMs: null });
});

test('an extension re-arms thresholds that are in the future again', () => {
  const sent = new Set<Level>(['T-24h', 'T-6h']);
  const extended = deadline + 10 * 24 * H;
  resetAfterExtension(extended, deadline - 2 * H, sent);
  assert.equal(sent.size, 0);
  assert.equal(plan(extended, deadline - 2 * H, sent).send, null);
});
