# ADR-0016 — Irregular movements, crew positioning, and proven restores

**Status:** accepted · **Date:** 2026-10

## Irregular movements
- MVT `RR` (return to ramp, before takeoff) puts the flight back at the gate as DELAYED, clears off-blocks
  and re-estimates; it is refused once airborne. `FR` (forced return) lands the aircraft back at its departure
  station. An `AA` sent by a station other than the destination is a **diversion**. New status DIVERTED.
- Two separate facts: `actualArr` (confirmed by an arrival message naming its station, or FR) and
  `divertingTo` (announced by `EA … XXX`). An arrival without a station (ACARS) confirms nothing; the
  announcement stays visible as unconfirmed. A confirmed arrival station changes only with `COR MVT`.
- Where the aircraft *is* (`endStation`) drives rotation warnings and the recovery optimiser's starting point.
- `ops.flight.diverted {kind: DIVERSION | FORCED_RETURN | RETURN_TO_RAMP}`; `ops.flight.arrived` carries the
  station and is emitted the first time both off- and on-blocks are known, so a late departure message
  still books utilisation (CAMO books each flight once).
- Type B envelopes (priority/addresses, originator line, SOH/STX/ETX, NNNN) are stripped; several messages
  per request are split on blank lines, end markers or ETX/SOH.

## Crew positioning (deadheading)
- `CrewLeg.positioning`: positioning before operating counts as FDP but not as a sector; after the last sector
  it is duty, not FDP (ORO.FTL.220 / .105). Stored as `crew_assignments.positioning`.
- Crew recovery may hand over at an outstation (base preferred): the replacement is positioned on the
  operator's own flights (latest that connects with 45 min), and home again when a flight exists; the
  original crew member's positioning after the hand-over is dropped and, where legal, they are positioned
  home. Positioning legs are never handed over as operating legs. Accepting is serialised per operator.
- Not modelled: seat availability, positioning by surface or other carriers.

## Disaster recovery
- `scripts/dr/backup.sh | restore.sh | drill.sh` (docker compose or `AEROOS_LOCAL=1`), runbooks in
  `docs/runbooks`. Chain heads are recorded *before* the dump; the backup fails if the write-once anchors
  bucket cannot be copied.
- `verify-chains` proves a restore: every chain recomputes, contains its backup head, and every anchor row
  matches its write-once object (and its signature with `--keys`). A database rewritten consistently still
  fails against the objects. The drill always drops its scratch copy.
