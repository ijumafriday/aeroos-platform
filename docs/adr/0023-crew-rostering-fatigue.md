# ADR-0023 — Crew rostering, fatigue risk management and the crew hub

**Status:** accepted · **Date:** 2026-10

## Placement
Part of Flight Ops (`ops` schema, `ops_svc`). Rostering writes the same `ops.crew_assignments` that the OCC, FTL
evaluation, crew recovery and dispatch already use, so a roster is immediately visible everywhere.

## Roster builder (pure functions in `packages/ops-domain/src/rostering.ts`)
- **Pairings:** each aircraft's day is cut into duties that start and end at the same station, cut at a ground
  gap of 90 min or a span over 9 h. A sequence that ends away from its start (night stop) is reported for manual
  planning (multi-day pairings are later work).
- **Assignment:** greedy in time order; per pairing a captain then a first officer. Eligible: rank, type rating,
  based at the pairing's station, not on leave/sickness/days off/training or a standby shift, not flying then,
  and the whole roster with the pairing added is not a VIOLATION for the FTL rulepack. Cost: block minutes flown in
  the period + 3 × fatigue index + a penalty for commander's discretion; ties by crew id (deterministic).
- **Proposal → accept:** a run stores the proposal with each flight's version. Accepting takes the operator's crew
  lock (shared with crew recovery), refuses if any flight changed, got crew or the crew member became unavailable,
  books the assignments under a run-unique duty key and re-judges every affected roster in the same transaction.

## Publication and changes
`roster_publications` records periods; less than 14 days ahead (ORO.FTL.110(b)) needs a recorded reason. A
trigger on `crew_assignments` logs every add/remove for flights inside a published period — whatever made the
change (builder, crew recovery, manual) — and the crew hub lists them until the crew member acknowledges.

## Fatigue
- **Fatigue index (planning aid, not a validated biomathematical model):** points for minutes in the window of
  circadian low (02:00–05:59 local of the report station), early starts, FDP over 10 h, more than 4 sectors,
  less than 12 h preceding rest and consecutive early starts; bands LOW/MODERATE/HIGH at 30/60.
- **Fatigue reports (ORO.FTL.120, AMC1):** KSS 1–9, Samn-Perelli 1–7, sleep in 24 h, narrative. Severity HIGH at
  KSS ≥ 8 or SP ≥ 6. Confidential: visible to the reporter, the quality manager and auditors only; the audit chain
  records a neutral actor; operator-wide notifications carry only the report number and severity; the reviewer
  must not be the reporter (Cerbos + DB check).

## Crew hub
`/crew/me` for the `flight_crew` role, matched to a crew record by Keycloak username: own duties (30 days),
FTL status, fatigue index, dispatch status and briefing link per flight, crew on board, leave, changes to
acknowledge, own fatigue reports.

## Limitations
Leave and days off are entered as UTC days. No multi-day pairings, reserve/standby rostering, preferences/bids,
or cabin crew rostering yet.
