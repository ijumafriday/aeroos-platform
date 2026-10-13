# AeroOS 0.28.0 — P1 Closure

This release closes the remaining P1 implementation gaps identified in the original AeroOS deficiency programme. It does not add new top-level business domains or workflow-oriented navigation.

## Platform / integrations
- Added a publishable `@aeroos/sdk` package for the stable `/api/v1` integration boundary and signed webhooks.
- Added typed provider submission helpers for operational flight plans and external FRMS assessments.
- Extended OpenAPI with the provider-backed OFP and FRMS ingestion endpoints.
- Extended governed migration with `ops.crew`, `ops.flight_schedule`, and `amo.stock_lot` adapters in addition to existing fleet/personnel adapters.

## Maintenance
- Added released-work-package production control with station shifts, per-trade capacity and work-package allocations.
- Prevents concurrent checks from over-allocating the same shift/trade capacity.
- Persists the released task/dependency plan and computes the work package critical path.
- Adds production milestones, task material/tool/predecessor readiness, non-routines and labour actuals.
- Production start requires the package's planned labour demand to be allocated.
- Non-routine closure/cancellation requires a traceable disposition.

## Supply Chain
- Added controlled warehouse/bin management, including quarantine bins.
- Added serialized/lot stock with condition, certificate and shelf-life controls.
- Added explicit serviceable/quarantine/unserviceable/consumed lifecycle transitions.
- Added borrow/loan lifecycle with due-back dates, references and controlled return to quarantine.
- Added a governed stock-lot migration adapter and corrected aggregate stock movement across stations on migrated serial updates.

## Operations
- Added provider-backed operational flight plans with route, level, alternate, EDTO/redispatch, fuel, mass and source-data provenance.
- OFP ingestion is accepted only for an EFFECTIVE approved provider master-data key (`ops.ofp_provider.<provider>`).
- Dispatch release now requires a current OFP and uses the provider route/level/alternate in the generated flight-plan package.
- Existing approved operator route/permit data remains the authority for overflight permit applicability.

## Crew
- Added SCCM/CC to the crew master and migration model.
- Added aircraft-type cabin complement requirements and FTL-checked cabin staffing.
- Cabin duty keys follow approved pairing duty periods so multi-sector FDP/rest is evaluated as a duty, not isolated flights.
- Dispatch and roster publication fail closed on cabin-complement gaps.
- Added external FRMS assessment ingestion with provider/model/version/source provenance.
- FRMS results are accepted only when the exact provider/model/version has an EFFECTIVE CREW master-data approval (`crew.frms_model.<provider>.<model>.<version>`).
- Latest CRITICAL validated FRMS assessments block roster publication.
- The existing heuristic fatigue indicator remains advisory and is not represented as a validated biomathematical model.
- Flight-deck disruption recovery remains explicitly CPT/FO-only.

## Design constraints preserved
- Engineering, Maintenance, Supply, Operations and Crew retain authoritative ownership of their records.
- Platform SDK/migration capabilities remain outside the business-domain navigation rail.
- No generic workflow domain was introduced.
- The genuine `pnpm-lock.yaml` remains an explicit P0 production-promotion blocker; this release does not weaken or bypass that gate.
