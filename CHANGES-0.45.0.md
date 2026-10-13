# AeroOS 0.45.0 — Quality Domain Completion

This release continues the same domain-depth programme without resetting the roadmap. Quality was selected after Commercial because its existing audits/findings/CAPA workflow lacked a governed annual programme, risk-based surveillance execution, auditor competence/independence controls and management-assurance depth.

## Quality assurance and surveillance

- Added an annual compliance-monitoring programme with scope, objectives, risk basis, ownership and independent approval before activation.
- Added risk-ranked programme items covering internal, regulatory, customer, supplier, station, product and process surveillance, with requirement references, planned windows and lifecycle control.
- Added auditor qualification records with validity, scope, independence restrictions and independent approval.
- Added governed auditor assignments with qualification checks, explicit independence declarations, conflict-of-interest rejection and independent assignment approval.
- Added sampled surveillance visits with approved sample size, checklist evidence, non-compliance-to-finding linkage, completion evidence and independent review before programme-item closure.
- Added controlled finding due-date extensions with rationale and independent quality approval; approved extensions update the formal finding due date.
- Added source-SHA-256 assurance trend snapshots with computed NORMAL/WATCH/BREACH state and mandatory action reference on breach.
- Added quality management review records for programme coverage, overdue/repeated findings, trend breaches, conclusions and actions, with independent approval and controlled closure.
- Added one compact **Quality Assurance & Surveillance** workspace with Programme & Surveillance Plan, Surveillance Execution, Auditor Competence, and Assurance Review tabs. Existing Audits & Findings, Quality Actions, Compliance Matrix and Audit Trail remain intact.
- Added Cerbos authorization and FORCE RLS across all Quality completion tables.
- Added `QUALITY-DEPTH-REGISTER` with 108 measurable implemented software capabilities.

## Master deficiency register

D050 remains **PARTIAL** with materially stronger software evidence. It is not marked COMPLETE because representative operator surveillance history, authority/customer/supplier interactions, real auditor competence evidence, and retained production effectiveness trends remain external to this software baseline.

## Known release blocker

The existing P0 deterministic-build deficiency remains: an authentic `pnpm-lock.yaml` is still absent. This release does not claim that blocker is resolved.
