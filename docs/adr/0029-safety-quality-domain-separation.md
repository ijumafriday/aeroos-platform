# ADR-0029 — Safety and Quality are independent top-level domains

**Status:** accepted in 0.17.0

## Decision

Safety and Quality are separate business domains. Safety owns SMS occurrence reporting, hazard/risk handling, investigations, MOR control, residual-risk closure and safety actions. Quality owns compliance monitoring, audit programmes, findings, root cause, CAPA and effectiveness verification.

Corrective actions are implemented as a shared platform/domain primitive, but every action retains its originating domain. API routes, authorization resources and navigation are source-domain scoped; one domain cannot act on the other's action through its endpoints.

## Navigation rule

Top-level navigation names durable business domains and primary objects, not individual workflows. Safety therefore exposes Reports & Investigations and Safety Actions; Quality exposes Audits & Findings, Quality Actions and Compliance. Workflow state remains inside the relevant object rather than becoming additional navigation entries.

## Authorization rule

`safety_manager` and `quality_manager` are independent roles. A person may hold both roles where an operator's approved organization structure permits it, but neither role implies the other.
