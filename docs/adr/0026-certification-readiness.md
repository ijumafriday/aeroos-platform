# ADR-0026 — Certification readiness: traceability matrix, evidence, security posture

**Status:** accepted · **Date:** 2026-10

## Context
An authority accepts the organisation's procedures and tools through its expositions. It needs to see, for each
requirement, where the exposition covers it, how the tool meets it and what evidence exists — and that this
mapping is true of the software actually deployed.

## Decision
- **Traceability matrix as code** (`packages/compliance/src/matrix.ts`): requirement → exposition section → status
  (IMPLEMENTED / SUPPORTED / DATA / PROCEDURAL) → implementation → evidence (tests, rulepack decisions, Cerbos
  policies, screens, audit actions) → what the organisation must provide. `checks/matrix.test.ts` fails the build
  if any referenced test, decision, policy, screen or audit action does not exist, and requires a test for every
  IMPLEMENTED row and an organisation note for every DATA / PROCEDURAL row.
- **Live evidence**: the API counts each requirement's audit actions for the operator over a period; Quality →
  Compliance Matrix shows it, exports CSV, and every evidence pack carries `compliance-matrix.json` for its period
  (listed in the signed manifest like every other file).
- **Illustrative data register** (`DATA_TO_REPLACE`): the demo values that must be replaced with approved data.
- **Security posture checked at build** (`checks/security.test.ts`): every route requires a signed-in user unless
  @Public with its own guard (only the health probe is open); every request body passes a validation pipe.
- **Web headers**: one server-level header set in nginx (location-level `add_header` used to drop them);
  Permissions-Policy, COOP; a Content Security Policy in report-only mode with a browser journey that collects
  `securitypolicyviolation` events and fails on any — it becomes enforcing once that journey runs clean.
- **API headers**: the API sets nosniff, X-Frame-Options, Referrer-Policy and a deny-all CSP on every response
  itself, because on Kubernetes the ingress routes `/api` straight to it; behind the compose nginx those copies
  are hidden and nginx's set applies.
- **CSV exports defuse spreadsheet formulas** (a text cell starting with = + - @ gets a leading apostrophe; this
  applies to the ERP journal export too — memos rarely start with those characters, and safety wins).
- `scripts/security-scan.sh` (ZAP baseline, dependency audit, headers) and the penetration-test scope document.

## Consequences
- The matrix is maintained with the code: a renamed test or audit action breaks the build until the matrix is
  updated, which is the point.
- Section numbers follow the EASA templates; an operator edits the matrix rows to its own exposition numbering.
