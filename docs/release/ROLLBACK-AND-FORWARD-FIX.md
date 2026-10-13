# AeroOS rollback and forward-fix policy

AeroOS database migrations are immutable and forward-only. Production never executes destructive down-migrations automatically.

An application image may be rolled back only when every database migration introduced since that image is marked `backwardCompatible: true` in `SCHEMA-COMPATIBILITY.json`. A migration that renames/removes data, tightens a constraint against old writes, changes meaning, or performs irreversible transformation must be staged using expand/migrate/contract across separate releases and is marked incompatible until the older application can no longer be deployed.

If an incompatible migration has reached production, recovery is a forward fix. Database restore is reserved for disaster recovery and requires the DR procedure and RPO/RTO evidence; it is not a routine application rollback mechanism.

The CI gate `scripts/verify-schema-compatibility.py` requires every migration at or after 0038 to be classified. `scripts/upgrade-assurance.sh` verifies supported historical schemas upgrade to current while preserving representative data.
