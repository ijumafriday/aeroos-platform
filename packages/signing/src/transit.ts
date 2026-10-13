import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { canonicalJson, sha256Hex } from '@aeroos/kernel';
import type { KeyService, SignatureEnvelope } from './index';

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow it. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export const ed25519PublicKeyFromRaw = (raw: Buffer): KeyObject =>
  createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });

export interface TransitOptions {
  /** e.g. http://openbao:8200 */
  address: string;
  token: string;
  /** Secrets-engine mount, default "transit". */
  mount?: string;
  /** Name of an ed25519 key in the engine. */
  key: string;
  fetch?: typeof fetch;
}

interface KeyInfo { type: string; latest_version: number; keys: Record<string, { public_key: string }> }

const message = (keyId: string, signedAt: string, payloadSha256: string) =>
  Buffer.from(canonicalJson({ keyId, payloadSha256, signedAt }), 'utf8');

/**
 * KeyService backed by the Transit secrets engine of OpenBao (open source) or HashiCorp Vault —
 * one HTTP protocol, so it is portable across clouds and on-premises (ADR-0003). The private key
 * never leaves the engine; when the engine is sealed by an HSM (PKCS#11 seal) or uses managed keys,
 * the root of trust is the HSM. Signatures are ordinary Ed25519, verifiable with the public key alone.
 *
 * The key version is pinned at start-up and is part of keyId, so a rotation never changes what an
 * existing signature means: older versions stay verifiable.
 */
export class TransitKeyService implements KeyService {
  private constructor(
    private readonly o: Required<Omit<TransitOptions, 'fetch'>> & { fetch: typeof fetch },
    readonly keyId: string,
    private readonly version: number,
    private readonly pubByVersion: Map<number, KeyObject>
  ) {}

  static async connect(opts: TransitOptions): Promise<TransitKeyService> {
    const o = { mount: 'transit', fetch: globalThis.fetch, ...opts };
    const info = await TransitKeyService.readKey(o);
    if (info.type !== 'ed25519') throw new Error(`Transit key ${o.key} is ${info.type}; an ed25519 key is required`);
    const keys = new Map<number, KeyObject>();
    for (const [v, k] of Object.entries(info.keys)) keys.set(Number(v), ed25519PublicKeyFromRaw(Buffer.from(k.public_key, 'base64')));
    const version = info.latest_version;
    return new TransitKeyService(o as never, `transit:${o.key}:v${version}`, version, keys);
  }

  private static async readKey(o: { address: string; token: string; mount: string; key: string; fetch: typeof fetch }): Promise<KeyInfo> {
    const res = await o.fetch(`${o.address.replace(/\/$/, '')}/v1/${o.mount}/keys/${encodeURIComponent(o.key)}`, {
      headers: { 'X-Vault-Token': o.token }, signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`Transit key ${o.key} not readable (${res.status})`);
    return ((await res.json()) as { data: KeyInfo }).data;
  }

  async sign(payload: unknown, signedAt: Date): Promise<SignatureEnvelope> {
    const payloadSha256 = sha256Hex(canonicalJson(payload));
    const at = signedAt.toISOString();
    const input = message(this.keyId, at, payloadSha256).toString('base64');
    const res = await this.o.fetch(`${this.o.address.replace(/\/$/, '')}/v1/${this.o.mount}/sign/${encodeURIComponent(this.o.key)}`, {
      method: 'POST',
      headers: { 'X-Vault-Token': this.o.token, 'content-type': 'application/json' },
      body: JSON.stringify({ input, key_version: this.version }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`Transit signing failed (${res.status}); nothing was signed`);
    const sig = ((await res.json()) as { data: { signature: string } }).data.signature; // "vault:v<n>:<base64>"
    const m = /^vault:v(\d+):(.+)$/.exec(sig);
    if (!m || Number(m[1]) !== this.version) throw new Error(`Unexpected transit signature format or version: ${sig.slice(0, 16)}…`);
    const env: SignatureEnvelope = { alg: 'Ed25519', keyId: this.keyId, signedAt: at, payloadSha256, signature: m[2] };
    // Never hand back a signature we cannot verify ourselves.
    if (!(await this.verify(payload, env))) throw new Error('Transit returned a signature that does not verify');
    return env;
  }

  async verify(payload: unknown, env: SignatureEnvelope): Promise<boolean> {
    const m = /^transit:(.+):v(\d+)$/.exec(env.keyId);
    if (env.alg !== 'Ed25519' || !m || m[1] !== this.o.key) return false;
    const pub = this.pubByVersion.get(Number(m[2]));
    if (!pub) return false;
    if (sha256Hex(canonicalJson(payload)) !== env.payloadSha256) return false;
    return verify(null, message(env.keyId, env.signedAt, env.payloadSha256), pub, Buffer.from(env.signature, 'base64'));
  }

  async publicKeyPem(): Promise<string> {
    return this.pubByVersion.get(this.version)!.export({ format: 'pem', type: 'spki' }).toString();
  }

  async publicKeys(): Promise<{ keyId: string; publicKeyPem: string }[]> {
    return [...this.pubByVersion.entries()].sort((a, b) => a[0] - b[0])
      .map(([v, k]) => ({ keyId: `transit:${this.o.key}:v${v}`, publicKeyPem: k.export({ format: 'pem', type: 'spki' }).toString() }));
  }
}
