# AeroOS 0.26.0 — Scale & Resilience Assurance

This release adds executable production-assurance tooling rather than new business navigation.

- Major-airline mixed authenticated k6 profile across Platform, Operations, Crew, Maintenance/CAMO, Supply, Records, Engineering and Search.
- Four-hour/24-hour soak profile with release thresholds.
- Live dataset qualification against explicit minimum fleet/history volumes; performance claims fail qualification when the test database is too small.
- Concurrent POST/idempotency verification using a side-effect-safe command.
- Non-destructive PostgreSQL, Temporal and object-storage failure drills proving live/ready semantics and timed recovery.
- Database-pool and dead-letter observability for saturation and event-processing failure.
- Prometheus alerts for database connection waiting, stale outbox events and dead-letter accumulation.
- ADR-0038 makes measured evidence, not architectural assumption, the basis for scale claims.

The production dependency lock remains a mandatory promotion gate.
