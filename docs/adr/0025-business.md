# ADR-0025 — Business: enterprise structure, third-party billing, general ledger, executive dashboard

**Status:** accepted · **Date:** 2026-10

## Placement
- **Enterprise structure and the general ledger** live in Organization (`org` schema, `org_svc`): legal entities
  (group, AOC, Part-145 …) with their approvals, cost centres, chart of accounts, periods, journal entries.
- **Third-party maintenance billing** lives in the AMO (`amo` schema, `amo_svc`): customers, orders, booked work,
  invoices, payments. It publishes `amo.invoice.issued` and `amo.payment.received`; supply publishes
  `amo.goods.received`. The ledger posts from these events — no module reads another's schema.
- **Executive dashboard** (`exec` module) composes figures from per-module query services, each reading only its
  own schema with its own database role.

## Billing rules (`packages/mro-domain/src/billing.ts`)
Integer cents of the order currency; half-up rounding (float noise snapped first). Labour at the customer rate,
parts and services at cost plus mark-up; VAT once on the net. Order: quote → customer approval (their PO, credit
check: open receivables + this quote ≤ limit, serialised per customer) → work booked → completed → invoice. Invoicing
more than 10 % above the quote needs the customer's recorded approval of the overrun (cleared when an invoice is
credited). Credit notes credit a whole unpaid invoice. Invoice and credit-note numbers are gap-free per issuing
operator, series and year (counter row updated in the issuing transaction) and carry the issuer: INV-NKX-2026-0007.

## Ledger rules (`packages/org-domain/src/ledger.ts`)
- Double entry in base-currency cents, original currency and rate kept on the entry; a deferred constraint trigger
  rejects an unbalanced entry at commit.
- Invoice: receivable = total converted once; revenue by kind and VAT converted separately, the rounding difference
  to the largest revenue line. The payment that settles an invoice posts what is left of its receivable, so it clears
  exactly; FX differences on settlement are left to the ERP.
- Goods receipt: inventory against payables (accrued until the supplier invoice in the ERP).
- Idempotent per (source, source reference) on top of the inbox; zero-value postings are skipped; a missing cost
  centre makes the event retry and dead-letter (replayable), never silently dropped. Revenue goes to an active
  MRO-sales cost centre of the operator's own entities only.
- Periods close in order; every month up to the latest closed one is closed; a late posting lands in the next open
  month with a note; manual journals must be dated in an open month.
- Journal export (CSV, `;`-separated) for the operator's ERP — this is an operational sub-ledger, not statutory accounts.

## Roles
`finance_controller` (new realm role, user `finance`): customers, invoicing, payments, ledger, period close. The
dashboard is read by managers (occ_controller, camo_manager, quality_manager, auditor, finance_controller).

## Limitations
Single base currency (USD); no supplier invoices, FX revaluation, tax returns or consolidation; a payment replayed
from the dead-letter queue after the settling payment can leave a residue on the receivable.
