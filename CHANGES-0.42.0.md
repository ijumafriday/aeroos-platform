# AeroOS 0.42.0 — Crew Domain Completion

This release continues the domain-depth programme without resetting the roadmap. Crew was selected after Safety because it retained four material P1 gaps: surface positioning, formal bid-and-award, training-resource planning and payroll interfaces.

## Crew planning and administration

- Added tenant-isolated surface positioning for taxi, bus, rail, ferry, hotel transfer and other ground movements, including provider/booking references, scheduled/actual times, connection-flight linkage, duty impact, unavailability checks, minimum-connection legality and delay-driven legality recalculation.
- Added formal bid periods with frozen contract-rule and seniority snapshots, governed bid windows, weighted/ranked preferences, traceable seniority-aware award generation, independent approval and roster-publication references.
- Added training resources for instructors, simulators, classrooms, aircraft and devices, with qualification tags, capacity, session planning, resource collision detection, crew roster-conflict checks, recurrent/expiry demand, enrollment and result lifecycle.
- Added crew pay events sourced from roster actuals, flight actuals, positioning, training, allowances and adjustments, with evidence references, independent approval, approved-event-only payroll batching, deterministic export payloads, SHA-256 digests and external reconciliation.
- Added one compact **Crew Planning & Administration** workspace with Positioning & Surface, Bid & Award, Training Resources and Pay Interface tabs. Existing My Roster, OCC crew recovery, rostering and fatigue screens remain unchanged.
- Added Cerbos authorization for Crew control read/manage/approve actions and RLS/FORCE RLS across all new Crew completion tables.
- Added `CREW-DEPTH-REGISTER` with 116 measurable implemented software capabilities.

## Master deficiency register

D026, D045, D047 and D048 move from **MISSING** to **PARTIAL**. D015 and D046 remain **PARTIAL** with stronger implementation evidence. None are marked COMPLETE because operator contract/CBA rules, live transport providers, approved curricula/simulator inventories, payroll-provider certification, representative cabin constraints and validated operational acceptance evidence remain outstanding.

## Known release blocker

The existing P0 deterministic-build deficiency remains: an authentic `pnpm-lock.yaml` is still absent. This release does not claim that blocker is resolved.
