import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalJson, sha256Hex } from '@aeroos/kernel';

/**
 * Electronic signatures for regulated records (task-card stamps, CRS).
 *
 * The platform signs on behalf of a strongly authenticated user: the signed payload names the
 * person, licence, rulepack and instant, and the signature is made with an organisational key that
 * never leaves the key service. In production that key lives in a cloud KMS or an on-premises HSM;
 * both implement this same interface, so application code never changes between deployments.
 */

export interface SignatureEnvelope {
  alg: 'Ed25519';
  keyId: string;
  signedAt: string;
  payloadSha256: string;
  signature: string; // base64
}

export interface KeyService {
  readonly keyId: string;
  sign(payload: unknown, signedAt: Date): Promise<SignatureEnvelope>;
  verify(payload: unknown, envelope: SignatureEnvelope): Promise<boolean>;
  publicKeyPem(): Promise<string>;
  /** Every key version this service can verify (current and older), for offline verification. */
  publicKeys(): Promise<{ keyId: string; publicKeyPem: string }[]>;
}

const message = (keyId: string, signedAt: string, payloadSha256: string) =>
  Buffer.from(canonicalJson({ keyId, payloadSha256, signedAt }), 'utf8');

/** Development / test key service. Never use in production: the private key sits in process memory. */
export class LocalKeyService implements KeyService {
  private constructor(readonly keyId: string, private readonly priv: KeyObject, private readonly pub: KeyObject) {}

  static generate(keyId: string) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return new LocalKeyService(keyId, privateKey, publicKey);
  }

  static fromPrivatePem(keyId: string, pem: string) {
    const priv = createPrivateKey(pem);
    return new LocalKeyService(keyId, priv, createPublicKey(priv));
  }

  exportPrivatePem() {
    return this.priv.export({ format: 'pem', type: 'pkcs8' }).toString();
  }

  async sign(payload: unknown, signedAt: Date): Promise<SignatureEnvelope> {
    const payloadSha256 = sha256Hex(canonicalJson(payload));
    const at = signedAt.toISOString();
    const signature = sign(null, message(this.keyId, at, payloadSha256), this.priv).toString('base64');
    return { alg: 'Ed25519', keyId: this.keyId, signedAt: at, payloadSha256, signature };
  }

  async verify(payload: unknown, env: SignatureEnvelope): Promise<boolean> {
    if (env.alg !== 'Ed25519' || env.keyId !== this.keyId) return false;
    if (sha256Hex(canonicalJson(payload)) !== env.payloadSha256) return false;
    return verify(null, message(env.keyId, env.signedAt, env.payloadSha256), this.pub, Buffer.from(env.signature, 'base64'));
  }

  async publicKeyPem() {
    return this.pub.export({ format: 'pem', type: 'spki' }).toString();
  }

  async publicKeys() {
    return [{ keyId: this.keyId, publicKeyPem: await this.publicKeyPem() }];
  }
}

/**
 * Verify an envelope using only a public key — what an auditor or an independent tool does,
 * with no access to the signing service.
 */
export function verifyWithPublicKey(publicKeyPem: string, payload: unknown, env: SignatureEnvelope): boolean {
  if (sha256Hex(canonicalJson(payload)) !== env.payloadSha256) return false;
  return verify(null, message(env.keyId, env.signedAt, env.payloadSha256), createPublicKey(publicKeyPem), Buffer.from(env.signature, 'base64'));
}
export * from './transit';
export * from './webauthn';
