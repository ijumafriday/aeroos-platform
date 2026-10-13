# Operations Depth Register

**Version:** 0.40.0  
**Definition:** Software-complete Operations control-depth baseline. Production provider, EFB, DCS, AIRAC and aircraft/offline acceptance remains governed by the master deficiency register.

Implemented capabilities: **84/84**.

| ID | Area | Capability | Status |
|---|---|---|---|
| OPS-001 | Governance | Dedicated Operations depth register | IMPLEMENTED |
| OPS-002 | Governance | Tenant RLS across new Operations control tables | IMPLEMENTED |
| OPS-003 | Governance | Operations control authorization policy | IMPLEMENTED |
| OPS-004 | Governance | Compact single-workspace Operations control UI | IMPLEMENTED |
| OPS-005 | Governance | Audit-chain recording for governed changes | IMPLEMENTED |
| OPS-006 | Provider & failover | Provider registry by operational capability | IMPLEMENTED |
| OPS-007 | Provider & failover | Credential-vault reference retention | IMPLEMENTED |
| OPS-008 | Provider & failover | Provider priority for failover ordering | IMPLEMENTED |
| OPS-009 | Provider & failover | Provider SLA threshold capture | IMPLEMENTED |
| OPS-010 | Provider & failover | Provider success/failure health history | IMPLEMENTED |
| OPS-011 | Provider & failover | Consecutive-failure tracking | IMPLEMENTED |
| OPS-012 | Provider & failover | Automatic degraded/failed state after repeated failures | IMPLEMENTED |
| OPS-013 | Provider & failover | Weather provider lifecycle | IMPLEMENTED |
| OPS-014 | Provider & failover | NOTAM provider lifecycle | IMPLEMENTED |
| OPS-015 | Provider & failover | Navigation-data provider lifecycle | IMPLEMENTED |
| OPS-016 | Provider & failover | Flight-plan provider lifecycle | IMPLEMENTED |
| OPS-017 | Provider & failover | DCS provider lifecycle | IMPLEMENTED |
| OPS-018 | Provider & failover | EFB provider lifecycle | IMPLEMENTED |
| OPS-019 | Provider & failover | ACARS/AFTN provider lifecycle | IMPLEMENTED |
| OPS-020 | AIRAC / nav data | AIRAC cycle staging | IMPLEMENTED |
| OPS-021 | AIRAC / nav data | Provider-version provenance | IMPLEMENTED |
| OPS-022 | AIRAC / nav data | Source SHA-256 provenance | IMPLEMENTED |
| OPS-023 | AIRAC / nav data | Effective-from/effective-until control | IMPLEMENTED |
| OPS-024 | AIRAC / nav data | Structured validation report | IMPLEMENTED |
| OPS-025 | AIRAC / nav data | Named validator evidence | IMPLEMENTED |
| OPS-026 | AIRAC / nav data | Independent AIRAC approval | IMPLEMENTED |
| OPS-027 | AIRAC / nav data | Approved-to-active transition | IMPLEMENTED |
| OPS-028 | AIRAC / nav data | Automatic supersession of prior active cycle | IMPLEMENTED |
| OPS-029 | AIRAC / nav data | Active-cycle portfolio visibility | IMPLEMENTED |
| OPS-030 | EFB distribution | EFB package revision control | IMPLEMENTED |
| OPS-031 | EFB distribution | Package content SHA-256 | IMPLEMENTED |
| OPS-032 | EFB distribution | AIRAC binding for nav packages | IMPLEMENTED |
| OPS-033 | EFB distribution | Effective-dated EFB content | IMPLEMENTED |
| OPS-034 | EFB distribution | Independent EFB release | IMPLEMENTED |
| OPS-035 | EFB distribution | Targeted device/crew/aircraft/fleet distribution | IMPLEMENTED |
| OPS-036 | EFB distribution | Distribution delivery reference | IMPLEMENTED |
| OPS-037 | EFB distribution | Acknowledgement evidence | IMPLEMENTED |
| OPS-038 | EFB distribution | Offline synchronization timestamp | IMPLEMENTED |
| OPS-039 | EFB distribution | Package recall | IMPLEMENTED |
| OPS-040 | EFB distribution | Recall propagation to distributions | IMPLEMENTED |
| OPS-041 | Load control / DCS | DCS/load message ingestion | IMPLEMENTED |
| OPS-042 | Load control / DCS | Baggage/cargo/ULD/special-load message types | IMPLEMENTED |
| OPS-043 | Load control / DCS | Trim-sheet and loadsheet message types | IMPLEMENTED |
| OPS-044 | Load control / DCS | Provider message idempotency key | IMPLEMENTED |
| OPS-045 | Load control / DCS | Payload SHA-256 provenance | IMPLEMENTED |
| OPS-046 | Load control / DCS | Validation findings | IMPLEMENTED |
| OPS-047 | Load control / DCS | Validated-before-acknowledgement control | IMPLEMENTED |
| OPS-048 | Load control / DCS | Controlled acknowledgement reference | IMPLEMENTED |
| OPS-049 | Load control / DCS | Flight association | IMPLEMENTED |
| OPS-050 | Airport / runway data | Runway operational-state history | IMPLEMENTED |
| OPS-051 | Airport / runway data | Open/closed/restricted states | IMPLEMENTED |
| OPS-052 | Airport / runway data | Contamination and braking-action capture | IMPLEMENTED |
| OPS-053 | Airport / runway data | Declared-distance overrides | IMPLEMENTED |
| OPS-054 | Airport / runway data | NOTAM/airport/authority source type | IMPLEMENTED |
| OPS-055 | Airport / runway data | Source reference and SHA-256 | IMPLEMENTED |
| OPS-056 | Airport / runway data | Effective window | IMPLEMENTED |
| OPS-057 | Airport / runway data | Named approval evidence | IMPLEMENTED |
| OPS-058 | ACMI / wet lease | ACMI contract register | IMPLEMENTED |
| OPS-059 | ACMI / wet lease | Lessor/lessee AOC identities | IMPLEMENTED |
| OPS-060 | ACMI / wet lease | Aircraft scope | IMPLEMENTED |
| OPS-061 | ACMI / wet lease | Effective dates | IMPLEMENTED |
| OPS-062 | ACMI / wet lease | Operational-control responsibility | IMPLEMENTED |
| OPS-063 | ACMI / wet lease | Crew responsibility | IMPLEMENTED |
| OPS-064 | ACMI / wet lease | Maintenance responsibility | IMPLEMENTED |
| OPS-065 | ACMI / wet lease | Continuing-airworthiness responsibility | IMPLEMENTED |
| OPS-066 | ACMI / wet lease | Records responsibility | IMPLEMENTED |
| OPS-067 | ACMI / wet lease | Occurrence-reporting responsibility | IMPLEMENTED |
| OPS-068 | ACMI / wet lease | Authority approval reference | IMPLEMENTED |
| OPS-069 | ACMI / wet lease | Independent activation | IMPLEMENTED |
| OPS-070 | Electronic tech / journey log | Electronic technical-log header | IMPLEMENTED |
| OPS-071 | Electronic tech / journey log | Tail/date continuity uniqueness | IMPLEMENTED |
| OPS-072 | Electronic tech / journey log | Continuity token | IMPLEMENTED |
| OPS-073 | Electronic tech / journey log | Offline revision control | IMPLEMENTED |
| OPS-074 | Electronic tech / journey log | Sector events | IMPLEMENTED |
| OPS-075 | Electronic tech / journey log | Defect events | IMPLEMENTED |
| OPS-076 | Electronic tech / journey log | Fluid uplift/consumption events | IMPLEMENTED |
| OPS-077 | Electronic tech / journey log | Maintenance-action events | IMPLEMENTED |
| OPS-078 | Electronic tech / journey log | Authenticated signature events | IMPLEMENTED |
| OPS-079 | Electronic tech / journey log | Shift/aircraft handover events | IMPLEMENTED |
| OPS-080 | Electronic tech / journey log | Offline sync events | IMPLEMENTED |
| OPS-081 | Electronic tech / journey log | Append-only event chronology | IMPLEMENTED |
| OPS-082 | Electronic tech / journey log | Signature-required closure | IMPLEMENTED |
| OPS-083 | Electronic tech / journey log | Closing station/hours/cycles capture | IMPLEMENTED |
| OPS-084 | Electronic tech / journey log | Audit evidence for log events and closure | IMPLEMENTED |
