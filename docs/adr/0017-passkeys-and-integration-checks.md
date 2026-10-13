# ADR-0017 — Passkeys for the CRS; static integration checks; first-run tooling

**Status:** accepted · **Date:** 2026-10

## Passkeys (WebAuthn) for regulated signatures
- **Why not a Keycloak step-up flow:** an authentication-flow change can lock every user out and cannot be
  exercised without a running Keycloak. The API is the WebAuthn relying party instead
  (`packages/signing/webauthn.ts`, node:crypto only): CBOR (canonical, bounded), authenticator data, COSE keys
  (ES256, EdDSA, RS256 ≥ 2048-bit with e = 65537), attestation "none", the §7.1/§7.2 checks (type, challenge,
  origin, no cross-origin, rpIdHash, UP and UV required, signature, increasing counter).
- **Bound challenges:** challenge = sha256(nonce ‖ canonical{purpose, subject, context}); single use, 2 minutes,
  tied to the user. For a CRS the context is {taskCardId, version}; the version is re-checked under lock when the
  CRS is issued. The full evidence (nonce, context, challenge, authenticator data, client data, signature,
  credential id) goes into the `crs.issued` audit entry; `verifyPasskeyEvidence` re-checks it later with the key
  recorded in `passkey.registered`.
- **Enrolment:** the first passkey needs a password sign-in from the last 2 minutes; every further passkey must
  be approved with an existing one; the user is notified of every enrolment. Revoking needs a passkey or a fresh
  sign-in since 0.8 (ADR-0018).
- **Policy:** once a user has a passkey, a CRS can only be confirmed with it; without one, a fresh password
  sign-in remains the step-up. Keycloak is unchanged.

## Static integration checks (`pnpm check`, CI)
TypeScript-compiler-API readers cross-check the parts written separately: web/worker/optimiser calls ↔ API
routes (method and path, no shadowed routes, nothing unreadable), Cerbos kinds/actions/roles ↔ code and realm,
event producers ↔ consumers ↔ topic subscriptions, Drizzle tables/columns ↔ the migrations (creates, adds,
drops, renames). They fail on anything they cannot resolve rather than passing silently.

## First-run tooling
`scripts/doctor.sh` (before building: Docker, memory, CPUs, architecture, ports, line endings) and
`scripts/smoke.sh` (after start: every container, every endpoint, signed-in journeys per role, the optimiser
round trip through Temporal and Python, the movement integration), printing the relevant logs on failure.
