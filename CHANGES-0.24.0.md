# AeroOS 0.24.0 — Flight Operations & Crew Depth

This release deepens Flight Operations and Crew without creating new workflow-centric top-level navigation.

## Flight Operations

- Added tenant-scoped operational weather records (METAR/TAF) with validity windows, raw provider text and mandatory source provenance.
- Added tenant-scoped NOTAM records with active windows, categories, severity and provenance.
- Added CTOT/flow-slot records with tolerance windows and replacement of prior active slots.
- Added flight-watch computation for departure/arrival weather coverage, watch-level weather hazards, active closing NOTAMs and CTOT conformance.
- Dispatch release checks now include the current flight-watch assessment; a previously released flight is withdrawn if a new operational condition makes it unreleasable.
- Added OCC UI for recording provider-sourced weather, NOTAM and CTOT data and for displaying the operational briefing inside the flight object.
- AeroOS does not synthesize weather/NOTAM provider feeds: operational data must arrive with a real source/reference.

## Crew

- Added approved multi-day pairing objects with ordered legs and inferred duty boundaries for night-stop/rest periods.
- Pairings require route continuity, one aircraft qualification family, return to base, bounded duration and independent approval.
- The roster builder consumes approved pairings before auto-generated single-day pairings.
- Added weighted crew preferences (`PREFER_OFF`, `PREFER_FLY`, `PREFER_EARLY`, `PREFER_LATE`, `AVOID_NIGHT`) as soft optimisation costs. They never override FTL, qualification, base or availability constraints.
- Added tenant-owned reserve/standby periods with `AVAILABLE` / `CALLED` / `RELEASED` lifecycle fields and auditable flight callout.
- Reserve callout deliberately does not bypass legality: assignment still goes through crew-recovery/rostering checks.
- Crew pairing, preferences and reserve controls remain inside **Crew Rostering** rather than becoming new navigation sections.

## Tenant boundary

- New weather, NOTAM, flow-slot, pairing, preference and reserve data is protected by PostgreSQL row-level security.
- Legacy standby rows are assigned to the operator of their crew record during migration; migration fails rather than guessing if ownership cannot be resolved.

## Migration

- `0036_ops_flightwatch_crew_depth.sql`
