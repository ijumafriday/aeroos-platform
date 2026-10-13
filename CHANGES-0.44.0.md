# AeroOS 0.44.0 — Commercial / Finance Domain Completion

This release continues the domain-depth programme without resetting the roadmap. Commercial / Finance was selected after Engineering because aviation contract management remained missing and management-accounting depth remained partial.

## Commercial contract and cost control

- Added governed aviation commercial contracts covering maintenance, ACMI, charter, ground handling, supply, lease and other agreements with controlled terms SHA-256 identity, effective dates, notice periods, liability caps and lifecycle state.
- Added independent contract approval, approved-rate-card gating before activation, versioned amendments and superseding rate-card revisions.
- Added contract obligation/SLA ownership, due dates, recurrence, evidence requirements, met/breached/waived state and evidence-gated closure.
- Added source-bound cost allocations across cost centres/accounts with activity, tail, flight and work-order dimensions plus controlled FX conversion to base currency.
- Added accrual creation, independent approval, posting-reference control and later-period reversal.
- Added inventory valuation snapshots with weighted-average/FIFO/specific-identification methods, provisions, source SHA-256 and independent approval.
- Added controlled FX rates with source SHA-256, independent approval, currency exposure capture and approved-rate revaluation with unrealized gain/loss.
- Added one compact **Commercial Contract & Cost Control** workspace with Contracts & Obligations, Revenue & Costing, Accruals & Valuation, and FX & Reconciliation tabs. Existing Maintenance Billing, Executive Dashboard and General Ledger remain intact.
- Added Cerbos authorization and FORCE RLS across all Commercial completion tables.
- Added `COMMERCIAL-DEPTH-REGISTER` with 112 measurable implemented software capabilities.

## Master deficiency register

D063 moves from **MISSING** to **PARTIAL**. D064 remains **PARTIAL** with materially stronger software evidence. Neither is marked COMPLETE because live negotiated contracts, counterparty acceptance, certified ERP interfaces, tax/statutory accounting and production close/reconciliation evidence remain outside this source package.

## Known release blocker

The existing P0 deterministic-build deficiency remains: an authentic `pnpm-lock.yaml` is still absent. This release does not claim that blocker is resolved.
