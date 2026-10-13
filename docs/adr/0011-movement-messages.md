# ADR-0011 — Actual times come from movement messages; simulation is only a fallback

**Status:** accepted · **Date:** 2026-10

## Context
Flight status, crew duty, aircraft utilisation (hours and cycles that drive the CAMO due list) all depend on when aircraft actually
moved. Until now a simulation marked flights departed/arrived at their estimated times. Airlines receive the real times as IATA MVT
messages (Type B, via SITA/ARINC) and as ACARS OOOI events (OUT/OFF/ON/IN) from the aircraft datalink.

## Decision
- **Parser in the core** (`packages/ops-domain/movement.ts`): MVT / COR MVT with AD, AA, ED, EA, NI, DL (codes and minutes) and SI;
  ACARS OOOI as JSON. Times `hhmm` or `ddhhmm` UTC resolve to the instant nearest the schedule (±18 h, across midnight).
- **Rules:** registration must match the planned tail (swap first in the OCC); a different time for an already-reported event needs a
  correction (COR); repeats are ignored (idempotent); actual times more than 10 min in the future are refused; status never goes backwards.
- **One path for all sources:** `POST /api/integrations/movements/{mvt,acars}` for gateways and `POST /api/ops/movements` for a controller
  typing an MVT phoned in by a station (Cerbos `flight:manage`). Gateways authenticate with a **per-operator key** (`X-Api-Key`,
  `MOVEMENT_API_KEYS="NKX=…,FJR=…"`, timing-safe, 503 when none configured); a key can only report its own operator's flights, and the log
  and audit record which key was used.
- **Effects:** actual off-block fixes ETD; a late departure re-times the rest of the rotation (knock-on), each re-timed flight audited and
  published as `ops.flight.delayed` exactly like a manual delay; `ops.flight.departed` / `ops.flight.arrived` go out through the outbox. CAMO books **airborne time** (takeoff→landing) as flight hours when the message carries
  it, block time otherwise.
- **Evidence:** every message is kept in `ops.movements` as received, per operator, with APPLIED / IGNORED / REJECTED and the reason,
  written in the same transaction as the change it caused. The table is append-only for the service role. Applied messages are also on the `ops` audit chain.
- **Simulation** (`MOVEMENT_SIMULATION`, on in compose, off in Helm) only moves flights that have received no message, and lands
  flights whose arrival message is still missing 3 h after ETA (so utilisation is not lost).

## Consequences
- A wrong registration is rejected rather than silently swapping the aircraft: the OCC decides tail changes.
- Not yet handled: diversions (MVT `RR`/`FR` and arrival at a different station), return to stand, and Type B addressing/acknowledgement —
  the endpoint expects the gateway to strip the Type B envelope.
