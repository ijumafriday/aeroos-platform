# AeroOS 0.19.0 — Tenant Boundary & Workload Trust

This release hardens the platform boundary without adding business navigation or workflow modules.

## Completed

- PostgreSQL row-level security is enabled automatically for every AeroOS table carrying `operator_id`.
- Every Drizzle query receives a transaction-local tenant/system database context; the database is now an independent tenant-isolation layer in addition to application scoping and Cerbos.
- Human requests bind the selected authenticated operator to the DB context for the entire request.
- Internal background calls no longer use `INTERNAL_TOKEN` / `x-internal-token`.
- TypeScript worker and Python optimiser use OIDC client-credentials access tokens.
- The API validates workload JWT issuer/audience and requires the `service_worker` realm role.
- Keycloak development realm contains separate confidential identities for the worker and optimiser.
- Kubernetes consumes distinct worker/optimiser client secrets and allows the optimiser through the internal API network boundary.
- Added an authenticated, side-effect-free internal identity probe plus service-identity smoke test.
- Added a PostgreSQL RLS smoke test that proves tenant A cannot read tenant B.
- Static integration checks fail if the shared internal-token mechanism reappears or the DB RLS/context wiring disappears.
- API telemetry now uses normalized route labels; Prometheus includes fast/slow error-budget and p95-latency alerts.
- Added an executable k6 authenticated-read load profile with explicit failure/latency thresholds.

## Production gate still open

`pnpm-lock.yaml` is still required for production promotion. It has not been fabricated because this build environment cannot resolve the workspace against the npm registry. `scripts/release-check.sh` continues to fail a production release when the lockfile is absent.
