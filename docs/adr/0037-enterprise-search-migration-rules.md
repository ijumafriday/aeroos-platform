# ADR-0037: Enterprise search, governed migration and bounded rules

**Status:** Accepted — 0.25.0

## Decision

Search remains federated. AeroOS will not create a global copy of regulated or confidential business records merely to improve discovery. Every domain search provider authorizes the principal and queries its own schema; Platform parses filters, ranks and merges results.

Historical-data migration is a Platform orchestration capability with domain adapters. Platform owns staging, validation state and job provenance. The adapter owned by each business domain owns validation against domain invariants and the final write using that domain's database role. A migration is never allowed to bypass RLS, domain validation or audit history.

Customer-configurable rules are intentionally bounded. They may evaluate versioned domain events and raise notifications, but they may not modify domain records or override hard safety/regulatory logic. MEL limits, FTL, dispatch gates, configuration conformity, airworthiness status, Part-145 certification and comparable constraints remain code/rulepack-controlled domain invariants.

## Consequences

- Search security follows the same authorization boundary as the object being found.
- Migration can be expanded one concrete domain adapter at a time without a privileged "write anywhere" importer.
- Rule configuration remains useful for local operating practices while being structurally incapable of weakening regulated logic.
- Platform administration does not become a new business domain in the main rail.
