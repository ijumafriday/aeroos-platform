import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { TransitKeyService, verifyWithPublicKey } from './index';

/** A fake Transit engine speaking the real HTTP shapes, holding real Ed25519 keys. */
function fakeTransit(opts: { versions?: number; tamper?: boolean } = {}) {
  const versions = new Map<number, { priv: KeyObject; raw: Buffer }>();
  for (let v = 1; v <= (opts.versions ?? 1); v++) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const der = publicKey.export({ format: 'der', type: 'spki' });
    versions.set(v, { priv: privateKey, raw: der.subarray(der.length - 32) });
  }
  const calls: string[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? 'GET'} ${u}`);
    if ((init?.headers as Record<string, string>)['X-Vault-Token'] !== 'tok') return new Response('{}', { status: 403 });
    if (u.endsWith('/v1/transit/keys/aeroos-signing')) {
      const keys = Object.fromEntries([...versions].map(([v, k]) => [String(v), { public_key: k.raw.toString('base64') }]));
      return Response.json({ data: { type: 'ed25519', latest_version: versions.size, keys } });
    }
    if (u.endsWith('/v1/transit/sign/aeroos-signing')) {
      const body = JSON.parse(String(init!.body)) as { input: string; key_version: number };
      const k = versions.get(body.key_version)!;
      let sig = sign(null, Buffer.from(body.input, 'base64'), k.priv);
      if (opts.tamper) sig = Buffer.from(sig.map((b, i) => (i === 0 ? b ^ 1 : b)));
      return Response.json({ data: { signature: `vault:v${body.key_version}:${sig.toString('base64')}` } });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

const connect = (t: ReturnType<typeof fakeTransit>, token = 'tok') =>
  TransitKeyService.connect({ address: 'http://bao:8200', token, key: 'aeroos-signing', fetch: t.fetch });

describe('Transit (OpenBao / Vault) key service', () => {
  const payload = { card: 'TC-77901', step: 1, personnelId: 'P-4471' };
  const at = new Date('2026-10-08T12:00:00Z');

  test('signs through the engine; the key version is pinned in keyId', async () => {
    const t = fakeTransit({ versions: 2 });
    const ks = await connect(t);
    const env = await ks.sign(payload, at);
    assert.equal(env.keyId, 'transit:aeroos-signing:v2');
    assert.equal(await ks.verify(payload, env), true);
    assert.ok(t.calls.some(c => c.startsWith('POST') && c.includes('/sign/')));
  });

  test('auditors verify with the published public key alone', async () => {
    const ks = await connect(fakeTransit());
    const env = await ks.sign(payload, at);
    assert.equal(verifyWithPublicKey(await ks.publicKeyPem(), payload, env), true);
    assert.equal(verifyWithPublicKey(await ks.publicKeyPem(), { ...payload, step: 2 }, env), false);
  });

  test('signatures from an older key version remain verifiable after rotation', async () => {
    const t = fakeTransit({ versions: 2 });
    const ks = await connect(t);
    const v2 = await ks.sign(payload, at);
    // Simulate a signature made before rotation by re-labelling with v1 and signing via v1.
    const old = await (async () => {
      const r = await t.fetch('http://bao:8200/v1/transit/sign/aeroos-signing', {
        method: 'POST', headers: { 'X-Vault-Token': 'tok' },
        body: JSON.stringify({ input: Buffer.from(JSON.stringify({ keyId: 'transit:aeroos-signing:v1', payloadSha256: v2.payloadSha256, signedAt: v2.signedAt })).toString('base64'), key_version: 1 })
      });
      const sig = ((await r.json()) as { data: { signature: string } }).data.signature.split(':')[2];
      return { ...v2, keyId: 'transit:aeroos-signing:v1', signature: sig };
    })();
    assert.equal(await ks.verify(payload, old), true);
  });

  test('a signature that does not verify is never returned', async () => {
    const ks = await connect(fakeTransit({ tamper: true }));
    await assert.rejects(ks.sign(payload, at), /does not verify/);
  });

  test('a wrong token fails at start-up, not at the first CRS', async () => {
    await assert.rejects(connect(fakeTransit(), 'nope'), /not readable \(403\)/);
  });
});
