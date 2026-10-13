import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalKeyService, verifyWithPublicKey } from './index';

const payload = { kind: 'CRS', taskCardId: 'TC-1', personnelId: 'P-1', licence: 'NO.66.4471', rule: 'EASA@2026.1' };
const at = new Date('2026-10-08T12:00:00Z');

test('a signature verifies against the same payload', async () => {
  const k = LocalKeyService.generate('dev-1');
  const env = await k.sign(payload, at);
  assert.equal(await k.verify(payload, env), true);
});

test('changing any field of the payload invalidates the signature', async () => {
  const k = LocalKeyService.generate('dev-1');
  const env = await k.sign(payload, at);
  assert.equal(await k.verify({ ...payload, licence: 'NO.66.0000' }, env), false);
});

test('changing the signing time invalidates the signature', async () => {
  const k = LocalKeyService.generate('dev-1');
  const env = await k.sign(payload, at);
  assert.equal(await k.verify(payload, { ...env, signedAt: '2026-10-09T12:00:00.000Z' }), false);
});

test('auditors can verify with the public key alone', async () => {
  const k = LocalKeyService.generate('dev-1');
  const env = await k.sign(payload, at);
  assert.equal(verifyWithPublicKey(await k.publicKeyPem(), payload, env), true);
});

test('a different key cannot verify', async () => {
  const env = await LocalKeyService.generate('dev-1').sign(payload, at);
  assert.equal(await LocalKeyService.generate('dev-1').verify(payload, env), false);
});

test('keys survive a PEM round trip', async () => {
  const k = LocalKeyService.generate('dev-1');
  const env = await k.sign(payload, at);
  assert.equal(await LocalKeyService.fromPrivatePem('dev-1', k.exportPrivatePem()).verify(payload, env), true);
});
