import type { PasskeyAssertionDto, PasskeyAssertionOptionsDto, PasskeyRegistrationOptionsDto } from '@aeroos/contracts';
import { ApiRequestError } from './api';

/** WebAuthn in the browser: the API speaks base64url JSON, the browser API wants ArrayBuffers. */
const toBuf = (s: string): ArrayBuffer => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out.buffer;
};
const toB64url = (buf: ArrayBuffer): string => {
  let s = '';
  for (const x of new Uint8Array(buf)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const passkeysSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;

export async function createPasskey(o: PasskeyRegistrationOptionsDto): Promise<{ clientDataJSON: string; attestationObject: string }> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: toBuf(o.challenge),
      rp: o.rp,
      user: { id: toBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.pubKeyCredParams,
      timeout: o.timeout,
      excludeCredentials: o.excludeCredentials.map(c => ({ type: c.type, id: toBuf(c.id) })),
      authenticatorSelection: o.authenticatorSelection,
      attestation: o.attestation
    }
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No passkey was created');
  const r = cred.response as AuthenticatorAttestationResponse;
  return { clientDataJSON: toB64url(r.clientDataJSON), attestationObject: toB64url(r.attestationObject) };
}

export async function confirmWithPasskey(o: PasskeyAssertionOptionsDto): Promise<PasskeyAssertionDto> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: toBuf(o.challenge),
      rpId: o.rpId,
      allowCredentials: o.allowCredentials.map(c => ({ type: c.type, id: toBuf(c.id) })),
      userVerification: o.userVerification,
      timeout: o.timeout
    }
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('The passkey confirmation was cancelled');
  const r = cred.response as AuthenticatorAssertionResponse;
  return { credentialId: toB64url(cred.rawId), clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.authenticatorData), signature: toB64url(r.signature) };
}

/**
 * For signatures where a passkey is required once enrolled (stamps, MEL extensions): ask the server for a
 * challenge bound to exactly what is being signed, let the device sign it, and return the `passkey` field
 * for the request body. Returns undefined when the user has no passkey (the server then accepts the session).
 */
export async function passkeyFor(enrolled: boolean, challenge: () => Promise<PasskeyAssertionOptionsDto>) {
  if (!enrolled || !passkeysSupported()) return undefined;
  const o = await challenge();
  return { challengeId: o.challengeId, assertion: await confirmWithPasskey(o) };
}

type PasskeyField = { challengeId: string; assertion: PasskeyAssertionDto };

/**
 * Send a signature, confirmed with a passkey when the user has one. If the server still asks for a passkey
 * (the passkey list had not loaded yet, or a key was added on another device), fetch a challenge and retry once.
 */
export async function signWithPasskey<T>(enrolled: boolean, challenge: () => Promise<PasskeyAssertionOptionsDto>, send: (passkey?: PasskeyField) => Promise<T>): Promise<T> {
  const first = await passkeyFor(enrolled, challenge);
  try {
    return await send(first);
  } catch (e) {
    if (first || !(e instanceof ApiRequestError) || e.code !== 'PASSKEY_REQUIRED') throw e;
    if (!passkeysSupported()) throw new Error('This signature needs your passkey, but this browser does not support passkeys. Use a browser or device that does.');
    const o = await challenge();
    return send({ challengeId: o.challengeId, assertion: await confirmWithPasskey(o) });
  }
}
