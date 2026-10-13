import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { canonicalJson } from '@aeroos/kernel';
import { b64url, boundChallenge, decodeCbor, verifyAssertion, verifyPasskeyEvidence, verifyRegistration, type RelyingParty } from './webauthn';

/* A software authenticator, built from the spec, to drive the verifier. */
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('unsupported');
}
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();
const RP: RelyingParty = { rpId: 'localhost', origins: ['http://localhost:8080'], requireUserVerification: true };

class Authenticator {
  readonly id = randomBytes(16);
  counter = 0;
  constructor(readonly kind: 'ES256' | 'EdDSA' = 'ES256', private readonly keys = kind === 'ES256' ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : generateKeyPairSync('ed25519')) {}
  private cose(): Map<number, unknown> {
    const jwk = this.keys.publicKey.export({ format: 'jwk' }) as { x: string; y?: string };
    return this.kind === 'ES256'
      ? new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]])
      : new Map<number, unknown>([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x, 'base64url')]]);
  }
  private authData(rpId: string, flags: number, attested: boolean) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(this.counter);
    const parts: Buffer[] = [sha(rpId), Buffer.from([flags | (attested ? 0x40 : 0)]), c];
    if (attested) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.id.length);
      parts.push(Buffer.alloc(16), len, this.id, cbor(this.cose()));
    }
    return Buffer.concat(parts);
  }
  register(challenge: Buffer, o: { origin?: string; rpId?: string; flags?: number; fmt?: string } = {}) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: b64url(challenge), origin: o.origin ?? 'http://localhost:8080' }));
    const att = new Map<string, unknown>([['fmt', o.fmt ?? 'none'], ['attStmt', new Map()], ['authData', this.authData(o.rpId ?? 'localhost', o.flags ?? 0x05, true)]]);
    return { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(cbor(att)) };
  }
  assert(challenge: Buffer, o: { origin?: string; flags?: number; bump?: number; key?: KeyObject } = {}) {
    this.counter += o.bump ?? 1;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: b64url(challenge), origin: o.origin ?? 'http://localhost:8080' }));
    const authData = this.authData('localhost', o.flags ?? 0x05, false);
    const data = Buffer.concat([authData, sha(clientDataJSON)]);
    const signature = this.kind === 'ES256' ? sign('sha256', data, o.key ?? this.keys.privateKey) : sign(null, data, o.key ?? this.keys.privateKey);
    return { credentialId: b64url(this.id), clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature) };
  }
}

describe('WebAuthn relying party', () => {
  const attWith = (cose: Map<number, unknown>, ch: Buffer) => {
    const id = randomBytes(16);
    const len = Buffer.alloc(2); len.writeUInt16BE(16);
    const authData = Buffer.concat([sha('localhost'), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, id, cbor(cose)]);
    return {
      clientDataJSON: b64url(Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: b64url(ch), origin: 'http://localhost:8080' }))),
      attestationObject: b64url(cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])))
    };
  };

  test('RSA keys: weak exponent and short (zero-padded) moduli are refused; a proper 2048-bit key is accepted', () => {
    const ch = randomBytes(32);
    const good = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' }) as { n: string; e: string };
    const n = Buffer.from(good.n, 'base64url');
    assert.equal(verifyRegistration(RP, ch, attWith(new Map<number, unknown>([[1, 3], [3, -257], [-1, n], [-2, Buffer.from(good.e, 'base64url')]]), ch)).alg, -257);
    assert.throws(() => verifyRegistration(RP, ch, attWith(new Map<number, unknown>([[1, 3], [3, -257], [-1, n], [-2, Buffer.from([1])]]), ch)), /exponent/);
    const small = Buffer.from((generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'jwk' }) as { n: string }).n, 'base64url');
    assert.throws(() => verifyRegistration(RP, ch, attWith(new Map<number, unknown>([[1, 3], [3, -257], [-1, Buffer.concat([Buffer.alloc(128), small])], [-2, Buffer.from([1, 0, 1])]]), ch)), /2048/);
  });

  test('malformed or cross-origin client data, non-canonical CBOR and duplicate byte-string keys are refused', () => {
    const ch = randomBytes(32);
    assert.throws(() => verifyRegistration(RP, ch, { clientDataJSON: b64url(Buffer.from('null')), attestationObject: '' }), /client data object/);
    const cross = b64url(Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: b64url(ch), origin: 'http://localhost:8080', crossOrigin: true })));
    assert.throws(() => verifyRegistration(RP, ch, { clientDataJSON: cross, attestationObject: '' }), /Cross-origin/);
    assert.throws(() => decodeCbor(Buffer.from([0x18, 0x05])), /Non-canonical/);
    assert.throws(() => decodeCbor(Buffer.from([0xa2, 0x41, 0x01, 0x00, 0x41, 0x01, 0x00])), /Duplicate/);
  });

  test('CBOR: decodes maps, negative keys, byte strings; rejects duplicates and indefinite lengths', () => {
    const v = decodeCbor(cbor(new Map<number, unknown>([[1, 2], [-1, Buffer.from([1, 2])]]))).value as Map<number, unknown>;
    assert.equal(v.get(1), 2);
    assert.deepEqual(v.get(-1), Buffer.from([1, 2]));
    assert.throws(() => decodeCbor(Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02])), /Duplicate/);
    assert.throws(() => decodeCbor(Buffer.from([0x9f, 0xff])), /Indefinite/);
  });

  for (const kind of ['ES256', 'EdDSA'] as const) {
    test(`${kind}: register, then sign in with user verification; the counter must increase`, () => {
      const a = new Authenticator(kind);
      const ch = randomBytes(32);
      const cred = verifyRegistration(RP, ch, a.register(ch));
      assert.equal(cred.credentialId, b64url(a.id));
      assert.equal(cred.alg, kind === 'ES256' ? -7 : -8);
      const ch2 = randomBytes(32);
      const r = verifyAssertion(RP, ch2, cred, a.assert(ch2));
      assert.equal(r.signCount, 1);
      assert.equal(r.userVerified, true);
      // Replaying the same assertion: counter no longer increases.
      const ch3 = randomBytes(32);
      const replay = a.assert(ch3, { bump: 0 });
      assert.throws(() => verifyAssertion(RP, ch3, { ...cred, signCount: 1 }, replay), /cloned/);
    });
  }

  test('wrong challenge, origin, site, missing user verification, foreign key, "packed" attestation: all refused', () => {
    const a = new Authenticator();
    const ch = randomBytes(32);
    const cred = verifyRegistration(RP, ch, a.register(ch));
    assert.throws(() => verifyRegistration(RP, randomBytes(32), a.register(ch)), /different challenge/);
    assert.throws(() => verifyRegistration(RP, ch, a.register(ch, { origin: 'https://evil.example' })), /not allowed/);
    assert.throws(() => verifyRegistration(RP, ch, a.register(ch, { rpId: 'evil.example' })), /different site/);
    assert.throws(() => verifyRegistration(RP, ch, a.register(ch, { flags: 0x01 })), /PIN or biometric/);
    assert.throws(() => verifyRegistration(RP, ch, a.register(ch, { fmt: 'packed' })), /not accepted/);
    const c2 = randomBytes(32);
    assert.throws(() => verifyAssertion(RP, c2, cred, a.assert(c2, { key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey })), /does not verify/);
    const c3 = randomBytes(32);
    assert.throws(() => verifyAssertion(RP, randomBytes(32), cred, a.assert(c3)), /different challenge/);
    const c4 = randomBytes(32);
    assert.throws(() => verifyAssertion(RP, c4, cred, a.assert(c4, { flags: 0x01 })), /PIN or biometric/);
    const c5 = randomBytes(32);
    assert.throws(() => verifyAssertion(RP, c5, { ...cred, credentialId: 'other' }, a.assert(c5)), /Unknown credential/);
  });

  test('a signature over different content (tampered authenticator data) is refused', () => {
    const a = new Authenticator();
    const ch = randomBytes(32);
    const cred = verifyRegistration(RP, ch, a.register(ch));
    const c2 = randomBytes(32);
    const r = a.assert(c2);
    const ad = Buffer.from(r.authenticatorData, 'base64url');
    ad[36] ^= 0x01; // change the counter
    assert.throws(() => verifyAssertion(RP, c2, cred, { ...r, authenticatorData: b64url(ad) }), /does not verify/);
  });

  test('stored evidence re-verifies later, and only for the record that was approved', () => {
    const a = new Authenticator();
    const reg = randomBytes(32);
    const cred = verifyRegistration(RP, reg, a.register(reg));
    const nonce = randomBytes(32);
    const context = { taskCardId: 'TC-1', version: 7 };
    const challenge = boundChallenge(nonce, { purpose: 'crs', subject: 'u1', context }, canonicalJson);
    const r = a.assert(challenge);
    verifyAssertion(RP, challenge, cred, r);
    const evidence = { purpose: 'crs', subject: 'u1', context, nonce: b64url(nonce), challenge: b64url(challenge), ...r };
    verifyPasskeyEvidence(RP, evidence, cred, canonicalJson);
    assert.throws(() => verifyPasskeyEvidence(RP, { ...evidence, context: { taskCardId: 'TC-2', version: 7 } }, cred, canonicalJson), /does not match/);
  });
});
