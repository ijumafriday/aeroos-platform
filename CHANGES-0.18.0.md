# AeroOS 0.18.0 — Production Integrity

This release hardens the 0.17 domain model without adding navigation or workflow clutter. The work is deliberately platform-level: business records remain owned by their existing domains.

## Runtime and API protection

- Added a distributed PostgreSQL-backed API rate limiter. Counters are shared across API replicas and identities are hashed before storage.
- Added `GET /api/health/live` (dependency-free liveness) and `GET /api/health/ready` (database, Temporal and object-storage readiness). Existing `/api/health` remains for compatibility and diagnostics.
- Added API request-count/latency OpenTelemetry instruments and rate-limit rejection telemetry.
- Enforced the browser Content Security Policy instead of report-only mode.
- Added HSTS and Permissions-Policy headers to direct API responses; HSTS is also emitted by the web edge.

## Kubernetes resilience and isolation

- Added PDBs for worker, web and optimiser in addition to the API PDB.
- Added autoscaling/v2 HPAs for API, worker, web and optimiser with conservative scale-down stabilization.
- Added zone topology spreading to all workloads.
- Added RuntimeDefault seccomp profiles and read-only root filesystems where applicable.
- Moved the web image to unprivileged nginx on port 8080.
- Added opt-out default-deny egress NetworkPolicy plus explicit same-namespace, DNS and configured external-service egress.
- Helm can now pin each AeroOS image by immutable sha256 digest; tags remain a development fallback.

## Release assurance

- Added a production release workflow that requires the release gate, frozen pnpm install, full tests/policies, BuildKit SBOM/provenance, registry publication and GitHub build-provenance attestations.
- Added `scripts/release-check.sh` for production-promotion invariants.
- Added `scripts/package-release.py`, which creates a deterministic source ZIP and `RELEASE-MANIFEST.json` containing SHA-256 and byte length for every shipped source file.
- Added Prometheus alert rules for sustained API 5xx rates and rate-limit saturation.

## Known release gate

`pnpm-lock.yaml` is still absent from the historical source set. 0.18 does **not** fabricate one. `scripts/release-check.sh` therefore blocks a production promotion until a lockfile is generated from the declared dependency graph against the organization's trusted npm registry and committed. Development/source evaluation remains possible using the existing install behavior.
