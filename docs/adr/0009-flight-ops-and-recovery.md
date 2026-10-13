# ADR-0009 — Flight Ops: FTL from the rulepack, airworthiness by projection, recovery by an external solver

**Status:** accepted · **Date:** 2026-10

## Context
The OCC changes the schedule all day. Every change has regulatory consequences that belong to other
domains (crew flight-time limitations, aircraft airworthiness), and disruption recovery is an
optimisation problem that is better solved by a dedicated solver than by hand or by application code.

## Decision
- **Own schema `ops`, own role `ops_svc`.** Upgrades create the role idempotently (`infra/postgres/upgrade/ensure-roles.sql`,
  the `db-roles` one-shot service); CloudNativePG manages it declaratively in Kubernetes.
- **FTL limits are rulepack rules** (`rosterCheck`): EASA ORO.FTL.205 FDP by local report time and sectors (commander's discretion ≤ 2 h
  reported separately), ORO.FTL.235 rest, ORO.FTL.210 cumulative duty and flight time; FAA Part 117 as a draft. Duties are rebuilt from
  the *estimated* schedule each time, so a delay shows its FTL consequence immediately (the delay response returns the crew impact).
- **Airworthiness by projection, never by reading CAMO tables:** `ops.tail_mel` (from `camo.mel.*`), `ops.tail_airworthiness`
  (from `camo.airworthiness.changed`) and `ops.maintenance_slots` (from `camo.wp.*`). A new deployment rebuilds them by replaying the topic.
  The fleet list comes through the exported `FleetQuery`.
- **Movement is simulated** from estimated times (DEPARTED 10 min after ETD, ARRIVED at ETA, every 5 minutes on Temporal) and announced
  as `ops.flight.arrived`, which feeds CAMO's hours and cycles. MVT/ACARS integration replaces the simulation without changing consumers.
- **Recovery optimiser** (`services/optimiser`, Python, OR-Tools CP-SAT) runs as a Temporal worker on task queue `optimiser`; the API
  starts `RecoveryWorkflow` by name with a JSON problem (`RecoveryProblem` in contracts). The model: per aircraft a circuit over
  compatible flights with turn-time precedence, departure times within a maximum delay, cancel as an option; minimise weighted delay
  minutes, cancellations and swaps. A greedy heuristic provides the warm start and the fallback. The worker has no database access and
  reports through an internal endpoint.
- **Trust but verify:** the API re-checks every solution with an independent TypeScript checker before it is shown; a proposal is applied
  only if none of its flights changed since it was computed (flight versions are part of the problem), otherwise it becomes STALE.
- **Timeline:** a plain SVG component fed with the same shape a commercial scheduler would take, so Bryntum (or similar) can replace it
  without touching the page.

## Consequences
- The OCC can never dispatch onto an aircraft CAMO has grounded, and CAMO never needs to know who is on the schedule.
- Crew pairing / re-crewing is not in the optimiser yet; FTL is checked after a recovery is applied (the crew impact is visible).
