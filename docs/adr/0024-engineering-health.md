# ADR-0024 — Engineering health: engine trends, oil consumption, structural damage

**Status:** accepted · **Date:** 2026-10

## Placement
CAMO (`camo` schema, `camo_svc`), as part of the reliability programme and continuing airworthiness. Rules are pure
functions in `packages/mro-domain/src/engine-health.ts` and `structural.ts`.

## Engine condition trend monitoring
- Input: stabilised-cruise snapshots corrected to standard day, as deltas from the engine's baseline (ΔEGT, ΔN2,
  ΔFF) plus vibration and take-off EGT margin, at aircraft flight hours. From the ECTM download, ACARS or by hand.
- Alerts: EGT margin at/below the amber or red limit (mean of the last 5); margin trend (least squares over the last
  1,000 FH) reaching the red limit within 500 FH — a removal forecast; step shift of ΔEGT/ΔN2/ΔFF between the last two
  5-flight averages (red at twice the limit); vibration above the limit. Each alert carries a recommended action.
- Oil: consumption between uplifts (oil added ÷ hours since the previous uplift); the current rate over the last
  uplifts covering ≥ 20 h; alert and maximum (AMM) limits; a doubling of the rate is flagged.
- Persisted alerts: one open alert per engine and code, notified once (again on amber → red). An engineer closes it
  with the action taken; the same condition stays quiet for 30 days unless it turns red. Engine alerts are advisory —
  they do not ground; the oil maximum's action says not to dispatch until the cause is found.
- Limits per engine type in `camo.engine_types` (demo values are illustrative).

## Structural damage
- Recorded by zone (ATA major zones), side, position (x/y mm), type and size. Assessed against `camo.srm_limits` per
  aircraft type, zone and type: ALLOWABLE (within allowable damage limits, optionally a repeat inspection in FC),
  REPAIR (within SRM repair limits), REFER (beyond the SRM: repair data approved under Part-21 needed). Cracks are
  never allowable. No limits for the zone/type → REFER.
- Interaction: two damages on the same zone and side closer (edge to edge) than the stricter spacing limit are
  assessed together — each against its own type limits with its own depth over the combined length; the worse
  result applies to both. Permanently repaired damage no longer interacts.
- Every change re-assesses all damage on the aircraft under a per-aircraft lock.
- Repairs: SRM data for REPAIR; approved data recorded first by a CAMO engineer for REFER (cleared if the damage grows)
  and the repair done by someone else; temporary repairs need an FC or date limit.
- Airworthiness: open REPAIR/REFER damage, an expired temporary repair or an overdue repeat inspection is a grounding
  reason in the existing airworthiness sweep (`camo.airworthiness.changed` → OCC dispatchability).

## Limitations
- Trend and oil history are per engine serial against aircraft hours; moving an engine between aircraft needs an
  install/remove flow with engine hours (later).
- Pairwise interactions only (a cluster of three is assessed pair by pair).
- A temporary repair suppresses grounding until its limit even if later measurements escalate the damage.
