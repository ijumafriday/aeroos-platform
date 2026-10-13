# ADR-0038 — Scale and resilience assurance as release evidence

**Status:** Accepted — 0.26.0

AeroOS does not claim production scale from architecture alone. Performance and resilience claims must be backed by repeatable evidence against a qualified dataset.

## Decision

1. The `major-airline` assurance profile is valid only when `scripts/assurance/qualify-dataset.py` passes the data-volume floor in `tests/assurance/scale-targets.json`.
2. Mixed authenticated load spans the durable domains rather than benchmarking only `/health` or one dashboard.
3. Release evidence records k6 threshold results; default targets are <0.5% failures, p95 <1.2 s and p99 <3 s for the mixed read profile.
4. Soak testing is a separate profile. Four hours is the release minimum; 24 hours is required before a major production upgrade.
5. Concurrent POST/idempotency behavior is tested independently from throughput.
6. Dependency-loss drills must demonstrate that liveness remains up, readiness fails closed, and readiness recovers inside the declared RTO.
7. Disaster-recovery restore evidence remains governed by `scripts/dr/drill.sh`; a successful failover drill does not substitute for a restore drill.
8. Tests must not manufacture regulatory approvals, signatures or certification evidence merely to increase data volume.

## Navigation

Assurance tooling is operational infrastructure. It has no end-user navigation entry and does not become a business domain.
