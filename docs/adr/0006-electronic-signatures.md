# ADR-0006 — Electronic signatures through a KeyService

**Status:** accepted · Transit provider delivered in Delivery 2 · **Date:** 2026-10

## Context
Task-card step stamps and the Certificate of Release to Service (CRS) are legal signatures (Part-145.A.50, 14 CFR 43.9). They must bind
**who** (authenticated, authorised and licence-covered at that instant) to **exactly what** (the content hash) **when**.

## Decision
- Signing goes through the `KeyService` interface (`packages/signing`): `sign(payload) → SignatureEnvelope { alg, keyId, signedAt, payloadSha256, signature }`
  and `verify`.
- The signer must pass, at signing time: OIDC authentication, Cerbos `sign_step` / `issue_crs`, and the compliance engine's `canCertify`
  (licence category, type rating, company authorisation, validity dates). The `Decision` is stored with the stamp.
- **`TransitKeyService`** (Delivery 2, production path): the Transit secrets engine of **OpenBao** (open source) or HashiCorp Vault holds an
  ed25519 key; the API sends the message to `/transit/sign` and never sees the private key. One HTTP protocol everywhere, so no
  cloud-specific KMS adapter is needed (ADR-0003). **HSM custody** is a property of the OpenBao/Vault cluster (PKCS#11 seal or managed keys),
  so the same adapter serves cloud and on-premises. The key version is pinned at start-up and embedded in `keyId`
  (`transit:aeroos-signing:v3`), so a rotation never changes what an old signature means; every version remains verifiable.
  Each signature is verified locally before it is returned.
- **`LocalKeyService`** (Ed25519, key file) remains for development only. In `NODE_ENV=production` the API refuses to start with it unless
  `ALLOW_LOCAL_SIGNING=true` is set explicitly.
- **Step-up for the CRS** (Delivery 2): issuing a CRS requires an OIDC `auth_time` no older than `STEP_UP_MAX_AGE_SECONDS` (default 5 min).
  The web app answers `STEP_UP_REQUIRED` with a forced re-login (`prompt=login`) and returns the user to the card. Making that re-login a
  WebAuthn/passkey ceremony is a Keycloak authentication-flow setting, with no application change.
- Not done: per-person signing keys. The organisational key signs on behalf of a strongly authenticated, rule-checked person; the stamp
  records who. Per-person keys can be added behind the same interface if an authority requires them.

## Consequences
- Signatures are verifiable offline with the published public key (`GET /api/platform/signing-key`).
- Switching a stack from `local` to `transit` (as the Docker Compose stack does in Delivery 2) starts a new key; stamps made with the old
  local key remain verifiable with that key's public PEM, which must be archived when switching.
- The Docker Compose stack runs OpenBao in dev mode (in memory). Restarting the `openbao` container creates a new key; the API then refuses
  to sign (its self-check fails) until it is restarted too. Production OpenBao is persistent and sealed.
- Changing provider changes key custody, not the data model.
