# ADR-0010 — One due-list engine for tasks, ADs and life-limited parts; search by module fan-out

**Status:** accepted · **Date:** 2026-10

## Context
Continuing airworthiness needs a due list that combines the maintenance programme (AMP tasks), airworthiness directives and life-limited
parts, each limited by flight hours, cycles and/or calendar time, and a closed loop to the hangar so that compliance is recorded from the
certificate of release, not typed in. Users also need to find anything quickly across domains.

## Decision
- **One engine** (`packages/mro-domain/maintenance.ts`): requirement = interval in FH/FC/days ("whichever first") + optional approved
  tolerance (tasks only — never ADs or LLPs). Life-limited parts use the same arithmetic with a virtual "new" point
  (aircraft counters at installation minus the part's time/cycles since new). Status: OK / DUE_SOON / IN_TOLERANCE / OVERDUE / COMPLIED,
  with the limiting dimension and a forecast date from 30-day average utilisation.
- **Counters** = baseline (import) + utilisation from `ops.flight.arrived` (idempotent per flight).
- **Closed loop:** due items → work package (CAMO) → planned into a hangar bay (no double booking) → released as `camo.wp.released` →
  one AMO task card per item, parts reserved at the station → CRS (`amo.crs.issued`, `sourceType: 'WP'`) → CAMO records compliance at the
  counters of that moment → due list resets → `camo.wp.completed` when every item is certified. Parts are issued (stock decremented) in
  the same transaction as the CRS.
- **Airworthiness:** an OVERDUE AD, task or life limit makes the aircraft unairworthy; CAMO publishes `camo.airworthiness.changed`
  once per change (after utilisation, compliance, and hourly for calendar limits). Ops makes the tail non-dispatchable.
- **Tools:** steps may record the calibrated tools used; an out-of-calibration tool is refused at signing (Part-145.A.40).
- **Reliability:** defects (technical-log deferrals) per 1000 FH by ATA chapter against operator alert levels.
- **Search (Cmd+K):** each module registers a provider that searches *its own* tables under *its own* Cerbos rules; the platform fans out
  and merges. Chosen over a central OpenSearch index for now: no extra stateful service on developer machines, no projection to keep in
  step, and module boundaries hold. The provider interface allows an OpenSearch-backed implementation when data volume needs it.

## Consequences
- The CAMO due list is always derived, never edited: the only way an item resets is a CRS from the AMO (or an imported record).
- Search is ILIKE-based per module; relevance ranking and typo tolerance arrive with the OpenSearch provider.
