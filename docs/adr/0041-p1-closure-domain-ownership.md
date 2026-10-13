# ADR 0041 — Close P1 depth without workflow-domain sprawl

## Status
Accepted — AeroOS 0.28.0

## Context
The original AeroOS deficiency programme left several P1 areas only partially complete: developer SDK support, heavy/base-maintenance production control, aviation supply depth, provider-backed flight planning, cabin crew/FRMS depth, and migration adapter breadth.

AeroOS navigation and ownership must remain domain/object-centric. Cross-domain operational processes must not become new source-of-truth "workflow" domains.

## Decision
1. `@aeroos/sdk`, OpenAPI integration endpoints and migration adapters remain Platform capabilities.
2. Work-package production control remains in Maintenance and is anchored to the released Work Package / Task Card objects.
3. Warehouse, lot/serial and loan records remain Supply Chain records.
4. OFP packages remain Operations records and may affect dispatch release only after provider approval through the governed master-data envelope.
5. Pairing, cabin complement and fatigue/FRMS remain Crew records. External FRMS results are accepted only for independently approved provider/model/version master data.
6. Flight-deck recovery remains CPT/FO-specific even though the crew master contains cabin ranks.
7. Configurable workflows/rules may notify or route work but do not own these records or override hard domain/regulatory constraints.

## Consequences
- Main navigation remains stable and domain-oriented.
- Operational depth appears contextually on Work Packages, Supply, Dispatch and Crew Rostering rather than as process menu entries.
- Provider calculations carry provenance and are governed before they can influence dispatch/roster release.
- The platform can extend migration and SDK coverage without granting generic database-write access.
