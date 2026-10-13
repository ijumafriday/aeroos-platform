# AeroOS 0.25.0 — Enterprise Search, Governed Migration & Bounded Rules

## Enterprise search
- Federated search remains domain-owned: each provider queries only its own schema and authorizes before returning results.
- Added `type:` and `domain:` filters, deterministic relevance ranking and de-duplication.
- Added per-user, per-operator saved searches.
- Technical Records, controlled documents, Safety reports, Quality audits/findings, personnel, flights, crew, maintenance, stores, airworthiness and Engineering configuration participate without creating a permissive cross-domain data copy.

## Governed migration
- Added tenant-isolated migration jobs and staged rows with explicit lifecycle: DRAFT → VALIDATED → APPLYING → APPLIED/FAILED.
- Validation is separate from application; invalid rows cannot be applied.
- Failed applications are resumable without reapplying rows already committed.
- Added concrete, production-behaviour adapters for `camo.fleet` and `org.personnel`, supporting INSERT_ONLY and explicit UPSERT strategies.
- Domain writes use the owning service database role and emit domain audit-chain entries with migration provenance.
- Platform migration completion emits a summary audit entry; auditors can read jobs but only platform administrators can manage them.

## Bounded configurable rules
- Added version-like immutable rule records with DRAFT → ACTIVE → RETIRED lifecycle and audited activation/retirement reasons.
- Rules consume real AeroOS domain events from Kafka, are tenant-scoped, execute idempotently per rule/event pair, and keep execution history.
- The supported action is deliberately bounded to platform notifications. Rules cannot mutate operational, maintenance, airworthiness, crew, Safety, Quality, Engineering or certification state.
- Conditions support `EQ`, `NE`, `IN`, `CONTAINS` and `EXISTS` over event payload fields.
- `platform.notification.raised` cannot itself trigger a rule, preventing notification loops.

## Navigation
- No new business-domain navigation was added.
- Platform administration is accessible only to `platform_admin` users from the account/header area.
- Saved searches live inside the existing command palette.

## Database
- Added migration `0037_platform_search_migration_rules.sql` with RLS for saved searches, migration staging, rules and execution history.
