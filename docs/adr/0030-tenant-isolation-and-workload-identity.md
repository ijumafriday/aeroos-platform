# ADR 0030 — database tenant isolation and workload identity

## Status
Accepted in AeroOS 0.19.0.

## Decision
Tenant isolation is enforced at both the application and PostgreSQL layers. The authenticated operator selected for an HTTP request is bound to an AsyncLocalStorage request context. `ModuleDb` applies that context to every SQL statement with transaction-local PostgreSQL settings. Migration 0030 enables row-level security on tenant tables carrying `operator_id`; reads and writes are permitted only for the bound operator. The existing global `platform.audit_log` is intentionally exempt because ADR-0005 uses one hash chain per module across operators; filtering the append head would fork the chain. Every user-facing audit read therefore applies an explicit operator predicate, which is statically reviewed and tested.

Background workloads are different from human tenant requests because scheduled sweeps can legitimately span operators. A guarded internal request receives a narrowly established system DB context after workload authentication; ordinary user requests can never establish it. Workloads authenticate as confidential OIDC clients using the client-credentials grant. The API verifies the issuer, audience and `service_worker` role before binding a system database context. The old shared `INTERNAL_TOKEN` header is removed.

The migration owner (`aeroos_owner`) remains the PostgreSQL table owner and therefore retains the normal PostgreSQL owner bypass needed for schema migration and controlled administrative recovery. Application service roles do not own tables and are subject to RLS.

## Consequences
A forgotten `operator_id` predicate in application SQL is no longer sufficient to leak another operator's rows. Cross-operator background processing is possible only through a verified service identity and guarded internal route. Direct access with application database roles without a request/system context returns no tenant rows and cannot write tenant rows.
