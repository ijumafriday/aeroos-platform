# AeroOS 0.27.0 — P0 Closure: Regulated Data Governance

- Adds governed regulatory/master-data lifecycle: DRAFT → VALIDATED → APPROVED → EFFECTIVE → SUPERSEDED/WITHDRAWN.
- Records source reference, immutable content SHA-256, revision, effectivity and independent actors.
- Migrates legacy/seeded operational datasets as DRAFT, never as approved data.
- Fail-closes dispatch release/flight-plan filing, MEL changes, work-package release and roster publication when required approved data is absent.
- Adds Quality/Compliance governance UI and tenant RLS.
- Adds reproducible-build verification and keyless signing of published image digests in release CI.
- Keeps the real pnpm lockfile as a mandatory production-promotion gate; this source package does not fabricate one.
