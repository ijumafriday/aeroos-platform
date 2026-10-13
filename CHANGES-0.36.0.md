# AeroOS 0.36.0 — P0 Tenant-Scoped Regulated Operations Data

Advances **D003** after the 0.35 audit reopened it; the implementation defect is corrected, but runtime PostgreSQL evidence is still required before COMPLETE status. Regulated Operations references are now operator-owned and FORCE-RLS protected; dispatch and canonical regulatory hashing use only tenant-scoped rows. Migration 0043 re-keys aircraft type data, runway limits, routes and permit rules with `operator_id` and the runtime RLS suite verifies differing values cannot cross tenants.

No P1/P2 feature work is included. D001 remains unresolved and production promotion remains blocked without an authentic `pnpm-lock.yaml`.
