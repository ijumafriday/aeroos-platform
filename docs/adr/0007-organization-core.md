# ADR-0007 — Organization Core: authorisations, currency and experience as data, decided by the rulepack

**Status:** accepted · **Date:** 2026-10

## Context
Whether someone may sign a task card depends on more than a licence: a **company authorisation** that can be issued, suspended,
reinstated, revoked or expire (Part-145.A.35, MOE 3.4); **recent experience** (6 months in any 2 years, 145.A.35(c)); and
**continuation training** in each 2-year period, including human factors (145.A.35(d)). In Delivery 1, the authorisation was a single row
with a `suspended` flag, and currency was not checked.

## Decision
- **Authorisations are aggregates with a lifecycle** (`packages/org-domain`): `ACTIVE ⇄ SUSPENDED → REVOKED`, `→ EXPIRED`. Revoked and expired are
  terminal: a new authorisation is issued instead, so a reference printed on an old CRS always keeps its meaning. Every transition carries
  who, when and a mandatory reason; at most one live authorisation per person (unique partial index).
- **Scope is decided by the rulepack** (`authorisationScope`): EASA requires every aircraft type to be covered by a valid Part-66 type
  rating; FAA (draft) requires an A or P rating and has no type ratings. Organisation approval scope is checked first.
- **Currency is decided by the rulepack** (`currency`) from facts Org Core gathers: distinct months with recorded maintenance in the last
  24, and the latest continuation/human-factors training. `canCertify` checks currency before privileges whenever the facts are supplied —
  Org Core always supplies them through `PersonnelQuery.signer`.
- **Experience comes from the work itself:** Org Core consumes `amo.taskcard.step_signed` and records one experience entry per signed step
  (idempotent natural key). Historic experience is imported (`source_type = 'import'`).
- **Expiry:** an hourly Temporal cron workflow calls the Org sweep, which expires authorisations past their date and sends
  T-90 / T-30 / T-7 / EXPIRED warnings for authorisations, licences and continuation training — each exactly once per validity date
  (`org.expiry_notices`). A periodic sweep was chosen over one workflow per record: these dates are day-granular, and certification is
  blocked at the exact instant by the rulepack anyway.
- **Permissions** (Cerbos `personnel`): quality manager manages; quality manager, CAMO manager and auditors read the register; everyone reads
  their own file; nobody manages their own file.

## Consequences
- An engineer can hold a valid licence and authorisation and still be refused, with the rule and reason shown — as the regulation intends.
- Migration 0005 upgrades Delivery 1 data in place (authorisation rows carried over as `MIGRATED`).
