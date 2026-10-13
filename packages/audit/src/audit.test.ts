import { test } from 'node:test';
import assert from 'node:assert/strict';
import { link, verifyChain, type AuditRecord, type ChainEntry } from './index';

function build(n: number): ChainEntry[] {
  const out: ChainEntry[] = [];
  for (let i = 0; i < n; i++) {
    const record: AuditRecord = {
      chain: 'camo', at: `2026-10-08T10:0${i}:00.000Z`, actor: 'user:camo.engineer', action: 'mel.deferred',
      entityType: 'mel_item', entityId: `DD-${i}`, data: { category: 'C', tail: 'LN-ABC' }, rule: 'EASA@2026.1'
    };
    const l = link(out[out.length - 1] ?? null, record);
    out.push({ seq: (i + 1) * 10, record, ...l });
  }
  return out;
}

test('an untouched chain verifies', () => {
  const r = verifyChain('camo', build(5));
  assert.equal(r.ok, true);
  assert.equal(r.count, 5);
});

test('editing a past record is detected at that record', () => {
  const c = build(5);
  c[2] = { ...c[2], record: { ...c[2].record, data: { category: 'D', tail: 'LN-ABC' } } };
  assert.deepEqual(verifyChain('camo', c), { ok: false, count: 2, brokenAtSeq: 30, reason: 'HASH_MISMATCH' });
});

test('deleting a record breaks the next link', () => {
  const c = build(5);
  c.splice(1, 1);
  const r = verifyChain('camo', c);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'LINK_BROKEN');
});

test('recomputing one hash does not hide tampering from later entries', () => {
  const c = build(4);
  const tampered = { ...c[1].record, actor: 'user:someone.else' };
  c[1] = { ...c[1], record: tampered, ...link(c[0], tampered) };
  const r = verifyChain('camo', c);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.brokenAtSeq, 30);
});

test('sequence gaps from rolled-back transactions are allowed', () => {
  assert.equal(verifyChain('camo', build(3)).ok, true);
});
