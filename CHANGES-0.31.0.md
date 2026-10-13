# AeroOS 0.31.0 — P0 assurance controls

No business-domain feature expansion. This release advances only unresolved P0 master-register items.

- D086 COMPLETE: machine-checked forward-only database/application rollback compatibility policy.
- D085 PARTIAL advanced: automated PostgreSQL/PostGIS upgrade matrix covers every supported release boundary and verifies representative data preservation; retained application regression evidence remains blocked by D001.
- D087 PARTIAL advanced: mandatory SAST, secret, IaC, container and license-policy CI gates with governed exceptions; dependency-backed retained passing evidence remains blocked by D001.
- D002 PARTIAL advanced: deterministic source archives are provenance-attested, Sigstore-signed and retained; production evidence remains required.
- D004 remains PARTIAL pending independent validation and operational secret-rotation evidence.
- D001 remains MISSING until an authentic pnpm-lock.yaml can be resolved and frozen install/build/test succeeds.
