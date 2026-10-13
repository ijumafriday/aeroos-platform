# ADR-0022 — Flight dispatch: load & balance, fuel, flight plan, permits, release

**Status:** accepted · **Date:** 2026-10

## Placement
Dispatch is part of Flight Ops (`ops` schema, `ops_svc`). It reuses the flight's operational state from the
OCC (airworthiness/MEL warnings, crew FTL status, nearest alternate) and adds reference data: type data, aircraft
weighing records, runway-limited weights, routes with the countries they cross, overflight permit rules and
permits, and per-operator contract fuel prices.

## Rules (pure functions in `packages/ops-domain/src/dispatch.ts`)
- **Mass & balance (CAT.POL.MAB.100/105):** standard masses (all-adult 84 kg, child 35 kg; flight crew 85,
  cabin crew 75; checked bags 11 / 13 / 15 kg domestic / European / intercontinental). DOW, ZFW, TOW = ZFW + take-off
  fuel, LW = TOW − trip. Limits: MZFW, MTOW or the lower runway-regulated take-off weight at departure, MLW or
  the lower landing-regulated weight at the destination, tank capacity, seats, infants ≤ adults. Centre of gravity
  in %MAC at zero-fuel, take-off and landing mass against the envelope. Reweighing every 4 years.
- **Fuel (CAT.OP.MPA.181, basic scheme):** taxi + trip + contingency (max of 5 % trip and 5 min holding) +
  alternate (nearest, at cruise speed + 10 min) + final reserve (30 min holding) + extra ≤ block.
- **Tankering:** carry fuel for the return when the price gap beats the extra burn (3 % of the carried mass per
  flight hour), limited by landing/take-off margins and tanks.
- **ICAO flight plan (Doc 4444):** callsign from the operator designator and flight number, type and wake,
  EOBT from the estimated off-block time, cruise speed/level and route, EET, alternates, PBN/DOF/REG. Cruise
  levels in the reference routes follow the semicircular rule.
- **Overflight permits:** every country on the route that requires a permit needs a valid one for the date and type.

## Release
- Released only when every check passes: flight scheduled/delayed, aircraft dispatchable, captain and first officer
  rostered and legal, weighing record and type data, fuel ≥ required, load sheet within limits, flight plan filed
  and unchanged since, permits valid. The flight row is locked while preparing or releasing.
- **Last-minute changes:** after release, a change keeps the release only if every check still passes and it is
  within 500 kg / 10 passengers; otherwise the release is withdrawn (notification).
- **Flight changes withdraw the release** in the same transaction as the change: tail swap, cancellation, or a new
  estimated off-block time before departure. A release that stops passing its checks before departure (a new MEL
  item, an FTL breach) is withdrawn when the flight is next opened, and never comes back by itself.
- Known limits: type data in the migration is illustrative (replace with the operator's approved manuals);
  performance is represented by stored regulated weights, not computed; the flight plan is recorded as filed (an
  AFTN/IFPS gateway is an integration still to connect); the board shows a withdrawn-on-check state once the
  flight's dispatch page has been opened; captains acknowledge the briefing package outside the system for now.
