import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, sha256Hex } from './index';

test('canonical JSON is independent of key order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
});

test('canonical JSON drops undefined and serialises dates', () => {
  assert.equal(canonicalJson({ a: undefined, t: new Date('2026-10-08T00:00:00Z') }), '{"t":"2026-10-08T00:00:00.000Z"}');
});

test('canonical JSON rejects NaN', () => {
  assert.throws(() => canonicalJson({ x: Number.NaN }));
});

test('sha256 is stable', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
