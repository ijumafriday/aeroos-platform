# AeroOS 0.17.0 — Safety / Quality domain separation

This release separates Safety (SMS) from Quality (compliance monitoring) without changing the shared platform design philosophy or turning navigation into workflow lists.

## Domain ownership

- Safety is a first-class top-level domain with **Reports & Investigations** and **Safety Actions**.
- Quality remains a separate top-level domain with **Audits & Findings**, **Quality Actions**, **Compliance Matrix**, and audit verification.
- Safety occurrences moved from `/quality/safety` and `/quality/occurrences` to `/safety/reports` and `/safety/occurrences`.
- Corrective actions remain a shared implementation primitive, but are domain-owned by their source and are exposed through `/safety/actions` or `/quality/actions` only.
- Domain checks prevent a Safety action from being completed or verified through a Quality endpoint and vice versa.

## Authorization

- Added a dedicated `safety_manager` role for SMS occurrence triage, investigation governance, MOR control, safety-action verification, and fatigue-report review.
- `quality_manager` retains quality audit, finding, CAPA and compliance-monitoring authority; it no longer implicitly grants Safety authority.
- Added distinct Cerbos resources `safety_action` and `quality_action` with independent verification authority.
- Added policy tests proving Safety and Quality do not inherit each other's management rights.

## Domain code

- Split pure domain rules into `safety.ts`, `quality.ts`, and a shared `corrective-action.ts` primitive.
- Split Safety and Quality tests accordingly.
- Compliance evidence mapping now points at the correct Safety/Quality policies and routes.

## Demo identity

- Added `safety.manager` / `safety_manager` to the Keycloak demo realm and personnel register.
