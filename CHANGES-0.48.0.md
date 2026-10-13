# AeroOS 0.48.0 — Analytics Domain Completion

## Scope

Adds a governed cross-domain Analytics control plane without direct database access from report designers.

- Tenant-isolated dataset registry with controlled schemas and source ownership.
- Checksum-bound dataset snapshots with independent verification.
- Approved semantic models defining allow-listed dimensions, metrics and filters.
- Controlled report designer with versioned definitions, drilldowns, row limits and visualization intent.
- Real report execution against verified snapshots with grouping, filtering, aggregation, sorting, persisted output and SHA-256 result identity.
- Approval-controlled report schedules for in-app, email or webhook delivery configuration.
- Compact Analytics workspace with Semantic Layer, Dataset Snapshots, Report Designer, and Runs & Schedules tabs.
- Corrects the 0.47.0 Compliance RLS policy setting name to the platform-standard `aeroos.operator_id` tenant context.

## Master deficiency register

D076 moves **MISSING → PARTIAL**. Production source adapters, large-scale OLAP execution, schedule-worker delivery, governed export formats and certified management reporting remain outside this software-depth pass.

## Known release blocker

The authentic `pnpm-lock.yaml` remains absent. Dependency-resolving builds and production promotion remain blocked rather than fabricating a lockfile.
