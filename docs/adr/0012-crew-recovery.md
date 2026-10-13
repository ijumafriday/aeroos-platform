# ADR-0012 — Crew recovery: the rulepack decides legality, the solver only chooses

**Status:** accepted · **Date:** 2026-10

## Context
A delay can push a crew member past a flight-time limitation (ORO.FTL.205 FDP, .235 rest, .210 cumulative). The OCC must then find
someone who can legally take over. Legality is regulated and must be explainable; picking the cheapest combination is an optimisation.

## Decision
- **Tasks** (`crewTasks`): for every duty with a `violation` finding, hand over as late as possible — the shortest tail of the duty that
  starts with a leg out of the crew member's base and leaves the original crew member legal. If no hand-over point helps (a rest or
  cumulative breach), the whole remaining duty is re-crewed.
- **Options** (`buildCrewProblem`): every crew member with the same rank and type rating at that base is tried by adding the legs to their
  roster and running the **same rulepack check** used everywhere else. Only legal (OK or within commander's discretion) pairs are listed.
  Airport standby is modelled per ORO.FTL.225(b): standby beyond 4 h reduces the FDP allowance (by moving report time back); someone
  whose standby ended less than 12 h before report is not available. Costs: standby 10, reserve call-out 40, discretion +25, uncovered 1000.
- **Solver** (Python, Temporal queue `optimiser`, `CrewRecoveryWorkflow`): CP-SAT assignment (at most one crew member per task, each crew
  member at most once), greedy fallback (most-constrained task first). It never sees the rules.
- **Trust boundary:** the API re-checks the answer (`checkCrewSolution`). On acceptance it re-runs the **same legality function**
  (`coverVerdict`) against the roster *as it is then*, refuses legs that have departed, been cancelled or are past ETD, checks that nobody's
  assignment on those flights changed (snapshot), and refuses proposals older than 60 minutes. Otherwise the run is STALE.
- Each candidate covers at most one task per run: two extra duties for one person need a joint check, which the next run performs.

## Consequences
- Every re-crewing is on the `ops` audit chain (`crew.reassigned`) with the reason and the rule that triggered it, and as
  `ops.crew.reassigned` on Kafka.
- Not modelled: positioning (deadheading) crew to an outstation, split duty, augmented crew, and standby types other than airport standby.
