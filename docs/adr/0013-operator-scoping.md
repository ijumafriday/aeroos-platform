# ADR-0013 — One user, several operators: explicit selection per request

**Status:** accepted · **Date:** 2026-10

## Context
CAMOs, maintenance organisations and group OCCs often serve more than one air operator certificate (AOC). Data must never mix between
operators, and a user must always know which operator they are acting for.

## Decision
- Operator membership = Keycloak group (`/NKX`, `/FJR`), carried in the token's `operators` claim.
- The browser sends **`X-Operator`** on every call. The auth guard accepts it only if it is one of the user's groups (else 403) and sets
  `principal.operatorId`; without it, `DEFAULT_OPERATOR` (if the user belongs to it) or the first membership.
- Every service scopes queries by `principal.operatorId`, and every Cerbos rule checks `resource.attr.operatorId in
  principal.attr.operators` — where the API passes **only the selected operator**, so a user in two AOCs cannot open the other one's
  records by id without switching. Two independent locks.
- Projections and logs carry the operator too: audit entries (`platform.audit_log.operator_id`; the hash chains stay platform-wide),
  movement messages, the hangar plan; maintenance slots, utilisation and requirements are filtered by the operator's fleet/programme.
- **Shared by design:** the Part-145 stores (parts and stock levels) belong to the maintenance organisation, which serves several operators;
  stock is shown as totals, never with the other operator's task cards. Tools are per operator.
- The UI shows the switch only to multi-operator users; switching clears all cached data. Live events are delivered for all of the user's
  operators (the cache is invalidated); notification pop-ups only for the selected one.
- Demo: second operator **Fjell Regional (FJR)**, two Dash 8-400s out of Bergen; `occ.controller`, `camo.manager`, `quality.manager`
  and `auditor` belong to both.

## Consequences
- Background processes (sweeps, consumers) act per record with the record's own operator and are unaffected.
- Cross-operator views (a group dashboard over several AOCs) are deliberately not provided; they would need their own authorisation model.
