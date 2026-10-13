# AeroOS 0.21.0 — Domain Depth: Configuration & Maintenance Planning

This release deepens two existing business domains without creating workflow-oriented top-level navigation.

## Engineering — aircraft configuration and effectivity

- Introduces a dedicated `engineering` PostgreSQL schema and least-privilege `engineering_svc` database role.
- Adds revisioned configuration baselines with `DRAFT → APPROVED → EFFECTIVE → SUPERSEDED` lifecycle and independent approval.
- Models hierarchical configuration positions, ATA ownership, required/optional positions, maximum installed quantity, tail/MSN effectivity, allowable part numbers and required modification status.
- Records actual installed configuration with serial number, installation/removal evidence references and immutable history rather than overwriting prior state.
- Keeps a stable position code on actual installations so a new allowable-baseline revision does not orphan the physical aircraft build.
- Validates conformity against the effective baseline and reports missing required positions, non-allowable parts, missing modifications, quantity breaches and retired position definitions.
- Serial installation and position-capacity checks are protected against concurrent writes with a transaction-scoped advisory lock and database uniqueness.
- Configuration records are tenant-RLS protected, Cerbos-authorized and hash-chain audited.
- Adds domain search for configuration baselines and actual aircraft configuration.
- Adds an object-centric Engineering UI for baseline authoring, effectivity, approval/effectiveness and actual installation/removal with mandatory evidence references.

## Maintenance — planning and production control

- Adds operator-owned hangar/bay master data with activation/deactivation rather than hard-coded UI resources.
- Adds work-package check type and operational priority.
- Derives required labour by trade from the actual task scope; clients can commit availability but cannot rewrite required demand.
- Adds directed task dependencies with validation for unknown tasks, self-dependencies and cycles.
- Requires a valid configured bay, collision-free slot, sufficient planned labour and explicit scope freeze before release to Part-145 execution.
- Supports audited unfreeze/replanning with a mandatory reason.
- Carries work-package predecessor requirements into AMO task cards; step/CRS signing is blocked until predecessor task cards are certified.
- Backfills labour demand for existing work packages in migration `0033`.

## Information architecture

Engineering owns allowable/actual configuration and applicability. Continuing Airworthiness consumes that configuration where required for compliance. Maintenance owns planning and production control; Part-145 execution remains the execution authority. Shared mechanisms such as audit, authorization, search and events remain Platform capabilities.

The web navigation therefore adds no workflow pile: **Engineering → Aircraft Configuration** and **Maintenance → Work Packages / Task Cards** remain durable object-oriented destinations.

## Database

- `0032_engineering_configuration.sql`
- `0033_maintenance_planning.sql`

The production dependency lock policy introduced in 0.18 remains unchanged: `pnpm-lock.yaml` is still required before production promotion and is not fabricated when trusted registry resolution is unavailable.
