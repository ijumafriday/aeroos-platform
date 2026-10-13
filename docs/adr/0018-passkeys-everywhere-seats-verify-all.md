# ADR-0018 — Passkeys for stamps and MEL extensions; seat-aware positioning; one-command verification

**Status:** accepted · **Date:** 2026-10 · Amends ADR-0017 (passkey revocation) and ADR-0016 (positioning)

## Passkeys beyond the CRS
- **Purposes:** `stamp` (task-card step) and `mel_extension`, gated by `PASSKEY_REQUIRED_FOR`
  (default `stamp,mel_extension`). Once a user has a passkey, a listed signature without a passkey assertion is
  refused (`PASSKEY_REQUIRED`); users without one keep signing on their session, as before.
- **Bound context:** a stamp signs {taskCardId, version, step, tools (sorted)}; an extension signs
  {melItemId, version, sha256(justification)}. The version is re-checked under lock in the signing
  transaction, so a confirmation for a card or deferral that changed in between is rejected. The audit entry
  records `confirmation: passkey` with the full evidence, or `session`.
- **Revocation (amends ADR-0017):** revoking lowered the bar for every later signature, so a stolen session
  could revoke the keys and then sign on the session alone. Revoking now needs approval with one of the user's
  passkeys (purpose `revoke`, bound to the credential id) **or** a password sign-in from the last 2 minutes —
  the lost-device path. The user is notified of every revocation, as of every enrolment.
- **Client:** if the server still asks for a passkey (list not loaded yet, a key added on another device), the
  client fetches a challenge and retries once; a browser without WebAuthn gets a clear message.

## Seat-aware positioning (amends ADR-0016)
- `ops.flights.booked_pax` (reservation feed; demo: deterministic 70–100 %, about one flight in six sold out).
  Cabin and jump seats per type live in `CABIN` (ops-domain).
- A positioning crew member needs a free cabin seat (seats − booked − positioning crew already rostered) or,
  when the cabin is full, a jump seat; the option note says "jump seat — flight full". No seat → another
  flight, or no option.
- The problem carries `seats` left per flight; greedy and CP-SAT never put more positioning crew on a flight,
  and both checkers (TS and Python) reject a solution that does. Accept re-judges every cover with seats tallied
  one cover at a time (under the per-operator lock), including the original crew member's flight home.
- Not modelled: seat class, crew-rest seat requirements, surface transport.

## One-command verification (`scripts/verify-all.sh`)
Everything the build environment cannot run, in Docker on the user's machine, into `verify-report.txt`:
clean-copy install (frozen lockfile when present), `pnpm check / build / typecheck / test / lint`, optimiser
tests with OR-Tools, Cerbos compile and policy tests, Helm lint/template for both profiles, and the Playwright
journeys on the compose network (`--no-e2e` to skip). The e2e run resets passkeys left by an interrupted run
first, and the passkey journey revokes its own key, so the suite can be repeated against the same stack.
