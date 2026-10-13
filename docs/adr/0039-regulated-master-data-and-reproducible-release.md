# ADR-0039 — Regulated master data and reproducible release closure

## Decision
A value being present in an AeroOS operational table does not make it approved data. Regulated master data is governed independently with source provenance, SHA-256 content identity, revision, independent validation, independent approval, activation/effectivity, supersession and withdrawal.

Legacy and demonstration operational values are registered as **DRAFT** during migration 0038. They are never grandfathered to EFFECTIVE. Dispatch release/flight-plan filing, MEL deferral/extension, work-package release, and roster publication fail closed when their required governed dataset is not effective.

The domain owning the operational record remains unchanged. Compliance owns only the approval/effectivity envelope around the source package; it does not duplicate aircraft, MEL, maintenance-programme, performance or crew records.

Production release reproducibility requires the repository's real `pnpm-lock.yaml`, the exact `packageManager` version, frozen dependency installation, build/test gates, deterministic source packaging, SBOM/provenance for containers, and signed published container digests. Missing dependency lock is a release blocker, not a warning in production.

## Consequences
Operators must explicitly approve migrated master data before regulated production actions can resume. Development seeds remain useful for demonstration but carry no implied operational approval. Changes to approved datasets create a new revision rather than editing the effective record in place.
