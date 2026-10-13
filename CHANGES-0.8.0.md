# AeroOS 0.8.0 — what changed since 0.7.0

## Before you unzip (protects your local fixes)

```bash
cd /c/Projects/aeroos-platform
git add -A && git commit -m "local state before 0.8.0"     # or: git stash
# unzip aeroos-platform-0.8.0.zip over the folder (replace files)
git status                      # exactly the files listed below should show up
git diff                        # review; keep a local fix with:  git checkout -p -- <file>
```

The zip contains **no `pnpm-lock.yaml`**, so your lockfile is never overwritten. No dependency changed in
this round: the `package.json` changes are the version number only (`0.7.0` → `0.8.0`), and
`apps/api/package.json` keeps your exact OpenTelemetry pins and `@temporalio/interceptors-opentelemetry ^1.24.0`.
`pnpm install --frozen-lockfile` therefore still matches your lockfile.

Then:

```bash
docker compose up -d --build     # migration 0020 runs automatically
scripts/smoke.sh                 # should report AeroOS 0.8.0
scripts/verify-all.sh            # writes verify-report.txt — send me that file
```

## Changed files (A = added, M = modified)

**Verification**
- A `scripts/verify-all.sh` — repo install/check/build/typecheck/test/lint, optimiser (CP-SAT), Cerbos, Helm, Playwright → `verify-report.txt`
- A `e2e/docker/forward.mjs` — lets the Playwright container reach the stack on the compose network
- A `e2e/tests/00-reset.spec.ts` — removes passkeys left over by an interrupted run before the journeys
- M `e2e/tests/helpers.ts`, `e2e/tests/passkeys.spec.ts` — passkey journey uses quality.manager and revokes its own key
- M `scripts/doctor.sh` — lockfile-in-sync check, port detection, CRLF as a warning (same as the fix you already have)
- M `.gitignore` — `verify-report.txt`, `e2e-results/`

**Passkeys for step stamps, MEL extensions; safer revocation**
- A `apps/api/db/migrations/0020_passkey_purposes_and_loads.sql`
- M `apps/api/src/config.ts` — `PASSKEY_REQUIRED_FOR` (default `stamp,mel_extension`)
- M `apps/api/src/platform/passkeys/passkeys.service.ts` — `requireConfirmation`; revoke needs a passkey or a fresh sign-in, and notifies
- M `apps/api/src/modules/amo/amo.module.ts` — `POST /amo/task-cards/:id/steps/:n/sign/challenge`; stamps confirmed with the passkey
- M `apps/api/src/modules/camo/mel.service.ts`, `camo.module.ts` — `POST /camo/mel-items/:id/extension/challenge`
- M `apps/web/src/lib/passkey.ts`, `features/taskcards/TaskCardDrawer.tsx`, `features/mel/MelDrawer.tsx`, `features/account/Passkeys.tsx`

**Seat-aware crew positioning**
- M `packages/ops-domain/src/flight.ts` (cabin/jump seats per type, `bookedPax`), `crew-recovery.ts`, `demo.ts` (demo loads), `crew-recovery.test.ts`
- M `packages/contracts/src/index.ts` — `FlightDto.load`, `CrewRecoveryProblem.seats`
- M `apps/api/src/modules/ops/ops.tables.ts`, `ops.repository.ts`, `ops.module.ts` (demo loads, backfilled for existing demo flights), `crew-recovery.service.ts` (seats tallied at accept)
- M `services/optimiser/aeroos_optimiser/crew.py`, `tests/test_crew.py` — greedy, CP-SAT and checker respect seats
- M `apps/web/src/features/ops/FlightDrawer.tsx` — **Load** row

**Docs and version**
- A `docs/adr/0018-passkeys-everywhere-seats-verify-all.md`; M `docs/adr/0017-…md`, `docs/delivery-plan.md`, `README.md`, this file
- M version 0.8.0: `package.json`, `apps/{api,web,worker}/package.json`, `packages/*/package.json`, `e2e/package.json`, `apps/worker/src/otel.ts`, `deploy/helm/aeroos/Chart.yaml`, `values.yaml`

No files were deleted.

## Behaviour changes to know
- A user who **has** a passkey must now confirm step stamps and MEL extensions with it (set `PASSKEY_REQUIRED_FOR=` empty to turn this off).
- Revoking a passkey asks for the passkey; if the device is lost, sign in again with the password and revoke within two minutes.
