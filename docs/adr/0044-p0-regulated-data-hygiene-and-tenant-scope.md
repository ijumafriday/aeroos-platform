# ADR 0044 — P0 regulated-data hygiene and tenant-scope correction

## Decision

Production must not start against a database that has ever been demo-seeded or that still contains
unprovenanced aircraft-type performance/mass or engine-limit rows. Historical generic values are
classified and removed when unreferenced by migration 0042; any retained legacy row is explicitly
untrusted and fails the production startup hygiene check.

The review also found that several operator-approved dispatch reference tables (`ops.aircraft_types`,
`ops.runway_limits`, `ops.routes`, `ops.permit_rules`) are globally keyed. Those values can differ by
operator, so D003 (tenant isolation) is reopened as PARTIAL until those references are moved to
operator-owned keys with RLS and all dispatch/hash queries consume the tenant-owned versions.

## Consequences

* Demo data remains available only through `SEED_DEMO=true` and is tagged as DEMO where historical
  migrations had previously supplied generic values.
* A demo-seeded database cannot later be promoted to production.
* Existing production-like databases with legacy generic rows must replace them using an explicit
  forward data migration with approved source references before startup can succeed.
* No new P1/P2 capability is introduced by this release.
