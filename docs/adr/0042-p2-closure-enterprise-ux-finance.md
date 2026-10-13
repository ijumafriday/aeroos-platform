# ADR 0042 — P2 closure: enterprise UX and finance integration

Status: Accepted — AeroOS 0.29.0

## Context

The original deficiency plan left two P2 areas after the P0/P1 closure work: enterprise UX and deeper Commercial/Finance integration. Both can easily damage the product philosophy if implemented as new workflow navigation or as a second general-purpose ERP.

## Decision

AeroOS keeps durable business domains as the primary information architecture.

Enterprise UX is implemented as a role-aware Home, user-owned saved views of existing routes/query state, and conservative bulk tools inside dense registers. A saved view never owns business data and cannot bypass the target domain's authorization. Bulk mutation of regulated records is not introduced as a generic capability.

Commercial/Finance remains an aviation operational sub-ledger. External statutory/enterprise accounting systems are integrated through versioned ERP export profiles. Exports can only be generated from closed periods, retain their exact exported content and SHA-256 checksum, and remain outstanding until an external acknowledgement or rejection reference is reconciled in AeroOS. Account and cost-centre mappings are explicit and tenant/entity scoped.

## Consequences

- No Workspace, Workflow, or ERP top-level business domain is added.
- Users can return to role-relevant domains and saved filters without duplicating records.
- AeroOS does not attempt to replace statutory GL, tax, consolidation, treasury or corporate accounting systems.
- ERP handoff is auditable and reproducible rather than an ad-hoc CSV download.
- Generic mass-changing of regulated records remains prohibited; domain-specific bulk operations require explicit domain rules and authorization.
