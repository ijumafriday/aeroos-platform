# ADR-0021 — Supply chain: suppliers, purchasing, receiving, customs, warranty, exchanges, PBH

**Status:** accepted · **Date:** 2026-10

## Scope and placement
Purchasing and stores are part of the maintenance organisation (145.A.42 acceptance of components), so the
supply chain lives in the AMO module (`amo` schema, `amo_svc`) next to stock and reservations. Flight hours
for power-by-the-hour statements are projected from `ops.flight.arrived` into `amo.flight_hours`.

## Rules
- **Approved suppliers:** suspended or lapsed suppliers cannot be awarded, approved, received from or used for
  exchanges; the quality manager keeps the list.
- **Requisitions and quotes:** raised by stores or engineering (also one per task-card shortage); quotes from
  any supplier for comparison, award only from an approved one with a valid quote.
- **Approval limit:** orders at or above 5,000 USD need a second person (approver ≠ raiser, domain rule and CHECK).
  Other currencies are converted at maintained reference rates (`amo.fx_rates`, USD base; quotes in a currency
  without a rate are refused); recent open orders for the same part from the same supplier are added, and awards
  for the same supplier/part are serialised, so neither currency nor splitting avoids the limit.
- **Receiving (incoming inspection):** only issued orders; no over-delivery; EASA Form 1 / FAA 8130-3 with a
  tracking number — a certificate of conformity only for standard parts; "as removed" refused; the delivered
  condition must be the ordered one or better (NE > NS > OH > SV); one serial per unit.
- **Customs:** imported deliveries go into the bonded store, out of usable stock and reservations, until customs
  clears them; clearance puts them into stock and fills task-card shortages for that operator.
- **Warranty:** claimable within the supplier's warranty period from the day of receipt (whole dates, month-end
  clamped); one live claim per delivered unit; accepted/rejected/credited by someone other than the claimant.
- **Exchanges:** the core goes back by its due date; overdue cores are flagged.
- **PBH:** monthly statement = flight hours of the covered aircraft × rate.

Money is stored as numeric(12,2) and rounded to cents on input; amounts below 0.01 are refused.
