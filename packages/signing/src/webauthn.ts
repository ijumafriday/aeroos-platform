import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from 'node:crypto';

/**
 * WebAuthn (passkeys) relying-party verification — W3C Web Authentication Level 2, §7.1 (registration)
 * and §7.2 (authentication) — implemented on node:crypto with no third-party code, because it gates the
 * certificate of release to service. Supported credential algorithms: ES256 (-7), EdDSA (-8), RS256 (-257).
 * Attestation: only "none" is accepted (the platform asks for none: it trusts the user's enrolment, made
 * while signed in, not the authenticator vendor).
 */

export class WebAuthnError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WebAuthnError';
  }
}

export const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
export const fromB64url = (s: string) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new WebAuthnError('ENCODING', 'Expected base64url');
  return Buffer.from(s, 'base64url');
};
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

/* ------------------------------------------------------------------ CBOR (RFC 8949), the subset WebAuthn uses */

type Cbor = number | bigint | Buffer | string | boolean | null | undefined | Cbor[] | Map<Cbor, Cbor>;

export function decodeCbor(buf: Buffer): { value: Cbor; length: number } {
  let pos = 0;
  const need = (n: number) => { if (pos + n > buf.length) throw new WebAuthnError('CBOR', 'Truncated CBOR'); };
  // Arguments must use the shortest form (CTAP2 canonical CBOR); anything else is refused.
  const shortest = (v: number, min: number) => { if (v < min) throw new WebAuthnError('CBOR', 'Non-canonical CBOR integer'); return v; };
  const readArg = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) { need(1); return shortest(buf[pos++], 24); }
    if (info === 25) { need(2); const v = buf.readUInt16BE(pos); pos += 2; return shortest(v, 0x100); }
    if (info === 26) { need(4); const v = buf.readUInt32BE(pos); pos += 4; return shortest(v, 0x10000); }
    if (info === 27) {
      need(8);
      const v = buf.readBigUInt64BE(pos);
      pos += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new WebAuthnError('CBOR', 'Integer too large');
      return shortest(Number(v), 0x100000000);
    }
    throw new WebAuthnError('CBOR', 'Indefinite lengths are not allowed');
  };
  const item = (depth: number): Cbor => {
    if (depth > 16) throw new WebAuthnError('CBOR', 'Nesting too deep');
    need(1);
    const ib = buf[pos++];
    const major = ib >> 5;
    const info = ib & 0x1f;
    switch (major) {
      case 0: return readArg(info);
      case 1: return -1 - readArg(info);
      case 2: { const n = readArg(info); need(n); const v = Buffer.from(buf.subarray(pos, pos + n)); pos += n; return v; }
      case 3: { const n = readArg(info); need(n); const v = buf.subarray(pos, pos + n).toString('utf8'); pos += n; return v; }
      case 4: { const n = readArg(info); if (n > 1024) throw new WebAuthnError('CBOR', 'Array too long'); return Array.from({ length: n }, () => item(depth + 1)); }
      case 5: {
        const n = readArg(info);
        if (n > 256) throw new WebAuthnError('CBOR', 'Map too large');
        const m = new Map<Cbor, Cbor>();
        const seen = new Set<string>(); // compare keys by value (byte-string keys are distinct objects)
        for (let i = 0; i < n; i++) {
          const k = item(depth + 1);
          const id = Buffer.isBuffer(k) ? `b:${k.toString('hex')}` : `${typeof k}:${String(k)}`;
          if (seen.has(id)) throw new WebAuthnError('CBOR', 'Duplicate map key');
          seen.add(id);
          m.set(k, item(depth + 1));
        }
        return m;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new WebAuthnError('CBOR', 'Floats are not used in WebAuthn');
      default:
        throw new WebAuthnError('CBOR', `Unsupported CBOR major type ${major}`);
    }
  };
  const value = item(0);
  return { value, length: pos };
}

/* ------------------------------------------------------------------ authenticator data (§6.1) */

export interface AuthenticatorData {
  rpIdHash: Buffer;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
  credential?: { aaguid: string; id: Buffer; publicKey: KeyObject; alg: number };
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;
const FLAG_ED = 0x80;

export function parseAuthenticatorData(data: Buffer): AuthenticatorData {
  if (data.length < 37) throw new WebAuthnError('AUTH_DATA', 'Authenticator data too short');
  const flags = data[32];
  const out: AuthenticatorData = {
    rpIdHash: data.subarray(0, 32), userPresent: !!(flags & FLAG_UP), userVerified: !!(flags & FLAG_UV), signCount: data.readUInt32BE(33)
  };
  let pos = 37;
  if (flags & FLAG_AT) {
    if (data.length < pos + 18) throw new WebAuthnError('AUTH_DATA', 'Attested credential data truncated');
    const aaguid = data.subarray(pos, pos + 16).toString('hex');
    const idLen = data.readUInt16BE(pos + 16);
    pos += 18;
    if (idLen > 1023 || data.length < pos + idLen) throw new WebAuthnError('AUTH_DATA', 'Credential id truncated');
    const id = Buffer.from(data.subarray(pos, pos + idLen));
    pos += idLen;
    const { value, length } = decodeCbor(data.subarray(pos));
    pos += length;
    out.credential = { aaguid, id, ...coseKey(value) };
  }
  if (flags & FLAG_ED) {
    const { length } = decodeCbor(data.subarray(pos)); // extensions: parsed for well-formedness, not used
    pos += length;
  }
  if (pos !== data.length) throw new WebAuthnError('AUTH_DATA', 'Trailing bytes in authenticator data');
  return out;
}

/** COSE_Key (RFC 9053) → public key. */
export function coseKey(v: Cbor): { publicKey: KeyObject; alg: number } {
  if (!(v instanceof Map)) throw new WebAuthnError('COSE', 'Credential public key is not a COSE map');
  const kty = v.get(1);
  const alg = v.get(3);
  const bytes = (k: number) => {
    const b = v.get(k);
    if (!Buffer.isBuffer(b)) throw new WebAuthnError('COSE', `COSE key parameter ${k} missing`);
    return b;
  };
  if (kty === 2 && alg === -7 && v.get(-1) === 1) {
    const x = bytes(-2);
    const y = bytes(-3);
    if (x.length !== 32 || y.length !== 32) throw new WebAuthnError('COSE', 'P-256 coordinates must be 32 bytes');
    return { alg, publicKey: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) }, format: 'jwk' }) };
  }
  if (kty === 1 && alg === -8 && v.get(-1) === 6) {
    const x = bytes(-2);
    if (x.length !== 32) throw new WebAuthnError('COSE', 'Ed25519 key must be 32 bytes');
    return { alg, publicKey: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64url(x) }, format: 'jwk' }) };
  }
  if (kty === 3 && alg === -257) {
    const publicKey = createPublicKey({ key: { kty: 'RSA', n: b64url(bytes(-1)), e: b64url(bytes(-2)) }, format: 'jwk' });
    // Leading zero bytes can pad a short modulus, and a tiny exponent (e=1) makes "signatures" forgeable:
    // check the parsed key, not the encoding.
    const d = publicKey.asymmetricKeyDetails;
    if (!d?.modulusLength || d.modulusLength < 2048) throw new WebAuthnError('COSE', 'RSA keys shorter than 2048 bits are not accepted');
    if (d.publicExponent !== 65537n) throw new WebAuthnError('COSE', 'RSA public exponent must be 65537');
    return { alg, publicKey };
  }
  throw new WebAuthnError('UNSUPPORTED_ALG', `Unsupported credential key (kty ${String(kty)}, alg ${String(alg)}); ES256, EdDSA and RS256 are accepted`);
}

/* ------------------------------------------------------------------ client data (§5.8.1) */

interface ClientData { type: string; challenge: string; origin: string; crossOrigin?: boolean }

function checkClientData(json: Buffer, type: 'webauthn.create' | 'webauthn.get', challenge: Buffer, origins: string[]): ClientData {
  let cd: ClientData;
  try {
    cd = JSON.parse(json.toString('utf8'));
  } catch {
    throw new WebAuthnError('CLIENT_DATA', 'clientDataJSON is not JSON');
  }
  if (!cd || typeof cd !== 'object' || typeof cd.challenge !== 'string' || typeof cd.origin !== 'string') {
    throw new WebAuthnError('CLIENT_DATA', 'clientDataJSON is not a client data object');
  }
  if (cd.type !== type) throw new WebAuthnError('CLIENT_DATA', `Expected ${type}, got ${cd.type}`);
  const got = fromB64url(cd.challenge ?? '');
  if (got.length !== challenge.length || !timingSafeEqual(got, challenge)) throw new WebAuthnError('CHALLENGE', 'The response is for a different challenge');
  if (!origins.includes(cd.origin)) throw new WebAuthnError('ORIGIN', `Origin ${cd.origin} is not allowed`);
  if (cd.crossOrigin) throw new WebAuthnError('ORIGIN', 'Cross-origin ceremonies are not allowed');
  return cd;
}

function checkRp(auth: AuthenticatorData, rpId: string, requireUV: boolean) {
  if (!timingSafeEqual(auth.rpIdHash, sha256(rpId))) throw new WebAuthnError('RP_ID', 'The credential belongs to a different site');
  if (!auth.userPresent) throw new WebAuthnError('USER_PRESENCE', 'User presence was not confirmed');
  if (requireUV && !auth.userVerified) throw new WebAuthnError('USER_VERIFICATION', 'The authenticator did not verify the user (PIN or biometric required)');
}

export interface RelyingParty { rpId: string; origins: string[]; requireUserVerification: boolean }

/* ------------------------------------------------------------------ registration (§7.1) */

export interface RegistrationResponse { clientDataJSON: string; attestationObject: string }
export interface RegisteredCredential { credentialId: string; publicKeyPem: string; alg: number; signCount: number; aaguid: string; userVerified: boolean }

export function verifyRegistration(rp: RelyingParty, challenge: Buffer, r: RegistrationResponse): RegisteredCredential {
  checkClientData(fromB64url(r.clientDataJSON), 'webauthn.create', challenge, rp.origins);
  const att = decodeCbor(fromB64url(r.attestationObject)).value;
  if (!(att instanceof Map)) throw new WebAuthnError('ATTESTATION', 'attestationObject is not a map');
  if (att.get('fmt') !== 'none') throw new WebAuthnError('ATTESTATION', `Attestation "${String(att.get('fmt'))}" not accepted; the platform requests "none"`);
  const stmt = att.get('attStmt');
  if (!(stmt instanceof Map) || stmt.size !== 0) throw new WebAuthnError('ATTESTATION', 'A "none" attestation must have an empty statement');
  const authData = att.get('authData');
  if (!Buffer.isBuffer(authData)) throw new WebAuthnError('ATTESTATION', 'authData missing');
  const auth = parseAuthenticatorData(authData);
  checkRp(auth, rp.rpId, rp.requireUserVerification);
  if (!auth.credential) throw new WebAuthnError('ATTESTATION', 'No credential in the registration response');
  return {
    credentialId: b64url(auth.credential.id),
    publicKeyPem: auth.credential.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    alg: auth.credential.alg,
    signCount: auth.signCount,
    aaguid: auth.credential.aaguid,
    userVerified: auth.userVerified
  };
}

/* ------------------------------------------------------------------ authentication (§7.2) */

export interface AssertionResponse { credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string }

/**
 * Verify an assertion against a stored credential. Returns the new signature counter. A counter that does
 * not increase (when the authenticator keeps one) signals a cloned authenticator and is refused.
 */
export function verifyAssertion(
  rp: RelyingParty, challenge: Buffer, cred: { credentialId: string; publicKeyPem: string; alg: number; signCount: number }, r: AssertionResponse
): { signCount: number; userVerified: boolean } {
  if (r.credentialId !== cred.credentialId) throw new WebAuthnError('CREDENTIAL', 'Unknown credential');
  const clientDataJSON = fromB64url(r.clientDataJSON);
  checkClientData(clientDataJSON, 'webauthn.get', challenge, rp.origins);
  const authData = fromB64url(r.authenticatorData);
  const auth = parseAuthenticatorData(authData);
  if (auth.credential) throw new WebAuthnError('AUTH_DATA', 'Unexpected attested credential data in an assertion');
  checkRp(auth, rp.rpId, rp.requireUserVerification);
  const signed = Buffer.concat([authData, sha256(clientDataJSON)]);
  const key = createPublicKey(cred.publicKeyPem);
  const sig = fromB64url(r.signature);
  const ok = cred.alg === -8 ? verify(null, signed, key, sig) : cred.alg === -7 || cred.alg === -257 ? verify('sha256', signed, key, sig) : false;
  if (!ok) throw new WebAuthnError('SIGNATURE', 'The passkey signature does not verify');
  if ((auth.signCount !== 0 || cred.signCount !== 0) && auth.signCount <= cred.signCount) {
    throw new WebAuthnError('COUNTER', 'Signature counter did not increase: possible cloned authenticator');
  }
  return { signCount: auth.signCount, userVerified: auth.userVerified };
}

/** A challenge bound to what is being approved: the authenticator signs over this exact content. */
export const boundChallenge = (nonce: Buffer, content: unknown, canonical: (v: unknown) => string) =>
  sha256(Buffer.concat([nonce, Buffer.from(canonical(content), 'utf8')]));

/**
 * Re-verify stored passkey evidence later (audit, authority inspection): the challenge really was derived
 * from what was approved, and the authenticator really signed it with the registered key.
 */
export function verifyPasskeyEvidence(
  rp: RelyingParty,
  e: { purpose: string; subject: string; context: Record<string, unknown>; nonce: string; challenge: string; credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string },
  key: { publicKeyPem: string; alg: number },
  canonical: (v: unknown) => string
): void {
  const expected = boundChallenge(fromB64url(e.nonce), { purpose: e.purpose, subject: e.subject, context: e.context }, canonical);
  if (b64url(expected) !== e.challenge) throw new WebAuthnError('EVIDENCE', 'The challenge does not match what was approved');
  verifyAssertion(rp, expected, { credentialId: e.credentialId, publicKeyPem: key.publicKeyPem, alg: key.alg, signCount: 0 }, e);
}
