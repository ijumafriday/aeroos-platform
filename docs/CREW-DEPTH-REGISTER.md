# AeroOS Crew Depth Register

Baseline: **0.42.0**

Software-depth capabilities: **{len(items)}/{len(items)} implemented**.

| ID | Area | Capability | Status |
|---|---|---|---|
| CREW-001 | Governance | Dedicated Crew depth register | IMPLEMENTED |
| CREW-002 | Governance | Tenant RLS across Crew completion tables | IMPLEMENTED |
| CREW-003 | Governance | Crew control authorization policy | IMPLEMENTED |
| CREW-004 | Governance | Compact single-workspace Crew planning UI | IMPLEMENTED |
| CREW-005 | Governance | Audit-chain recording for governed Crew changes | IMPLEMENTED |
| CREW-006 | Governance | Independent approvals for bid, training and payroll decisions | IMPLEMENTED |
| CREW-007 | Governance | Crew master-record validation before governed transactions | IMPLEMENTED |
| CREW-008 | Governance | Operator isolation on every Crew control query | IMPLEMENTED |
| CREW-009 | Positioning & surface transport | Surface positioning leg persistence | IMPLEMENTED |
| CREW-010 | Positioning & surface transport | Taxi positioning mode | IMPLEMENTED |
| CREW-011 | Positioning & surface transport | Bus positioning mode | IMPLEMENTED |
| CREW-012 | Positioning & surface transport | Rail positioning mode | IMPLEMENTED |
| CREW-013 | Positioning & surface transport | Ferry positioning mode | IMPLEMENTED |
| CREW-014 | Positioning & surface transport | Hotel-transfer positioning mode | IMPLEMENTED |
| CREW-015 | Positioning & surface transport | Other ground-transport mode | IMPLEMENTED |
| CREW-016 | Positioning & surface transport | Provider and booking reference capture | IMPLEMENTED |
| CREW-017 | Positioning & surface transport | Origin/destination capture | IMPLEMENTED |
| CREW-018 | Positioning & surface transport | Scheduled departure/arrival validation | IMPLEMENTED |
| CREW-019 | Positioning & surface transport | Actual departure/arrival capture | IMPLEMENTED |
| CREW-020 | Positioning & surface transport | Connection-flight linkage | IMPLEMENTED |
| CREW-021 | Positioning & surface transport | Minimum connection-time control | IMPLEMENTED |
| CREW-022 | Positioning & surface transport | Duty-impact minute capture | IMPLEMENTED |
| CREW-023 | Positioning & surface transport | Unavailability conflict detection | IMPLEMENTED |
| CREW-024 | Positioning & surface transport | Connection-flight existence validation | IMPLEMENTED |
| CREW-025 | Positioning & surface transport | Connection-gap legality evaluation | IMPLEMENTED |
| CREW-026 | Positioning & surface transport | At-risk connection state | IMPLEMENTED |
| CREW-027 | Positioning & surface transport | Illegal connection state | IMPLEMENTED |
| CREW-028 | Positioning & surface transport | Delay-minute capture | IMPLEMENTED |
| CREW-029 | Positioning & surface transport | Delay-driven legality recalculation | IMPLEMENTED |
| CREW-030 | Positioning & surface transport | Disruption reason capture | IMPLEMENTED |
| CREW-031 | Positioning & surface transport | Positioning lifecycle status | IMPLEMENTED |
| CREW-032 | Positioning & surface transport | Crew-specific positioning timeline | IMPLEMENTED |
| CREW-033 | Bid & award | Formal bid-period persistence | IMPLEMENTED |
| CREW-034 | Bid & award | Roster-period bounds | IMPLEMENTED |
| CREW-035 | Bid & award | Bid opening/closing window | IMPLEMENTED |
| CREW-036 | Bid & award | Frozen contract-rule snapshot | IMPLEMENTED |
| CREW-037 | Bid & award | Frozen seniority snapshot | IMPLEMENTED |
| CREW-038 | Bid & award | Configurable award scoring method | IMPLEMENTED |
| CREW-039 | Bid & award | Independent bid-period opening | IMPLEMENTED |
| CREW-040 | Bid & award | Open-window enforcement for submissions | IMPLEMENTED |
| CREW-041 | Bid & award | Crew identity validation for bids | IMPLEMENTED |
| CREW-042 | Bid & award | Pairing preferences | IMPLEMENTED |
| CREW-043 | Bid & award | Day-off preferences | IMPLEMENTED |
| CREW-044 | Bid & award | Base preferences | IMPLEMENTED |
| CREW-045 | Bid & award | Route preferences | IMPLEMENTED |
| CREW-046 | Bid & award | Reserve preferences | IMPLEMENTED |
| CREW-047 | Bid & award | Training preferences | IMPLEMENTED |
| CREW-048 | Bid & award | Avoid-pairing preferences | IMPLEMENTED |
| CREW-049 | Bid & award | Weighted bid priority | IMPLEMENTED |
| CREW-050 | Bid & award | Rank-order capture | IMPLEMENTED |
| CREW-051 | Bid & award | Bid audit attribution | IMPLEMENTED |
| CREW-052 | Bid & award | Award generation from active bids | IMPLEMENTED |
| CREW-053 | Bid & award | Seniority-aware scoring | IMPLEMENTED |
| CREW-054 | Bid & award | Rule-trace persistence per award | IMPLEMENTED |
| CREW-055 | Bid & award | Source-bid traceability | IMPLEMENTED |
| CREW-056 | Bid & award | Proposed award lifecycle | IMPLEMENTED |
| CREW-057 | Bid & award | Independent award approval | IMPLEMENTED |
| CREW-058 | Bid & award | Award decision note | IMPLEMENTED |
| CREW-059 | Bid & award | Approved award lifecycle | IMPLEMENTED |
| CREW-060 | Bid & award | Roster publication reference | IMPLEMENTED |
| CREW-061 | Bid & award | Published award lifecycle | IMPLEMENTED |
| CREW-062 | Bid & award | Publication actor/time evidence | IMPLEMENTED |
| CREW-063 | Training resources | Training-resource master persistence | IMPLEMENTED |
| CREW-064 | Training resources | Instructor resources | IMPLEMENTED |
| CREW-065 | Training resources | Simulator resources | IMPLEMENTED |
| CREW-066 | Training resources | Classroom resources | IMPLEMENTED |
| CREW-067 | Training resources | Aircraft resources | IMPLEMENTED |
| CREW-068 | Training resources | Training-device resources | IMPLEMENTED |
| CREW-069 | Training resources | Resource qualification tags | IMPLEMENTED |
| CREW-070 | Training resources | Resource capacity | IMPLEMENTED |
| CREW-071 | Training resources | Resource base/location | IMPLEMENTED |
| CREW-072 | Training resources | Out-of-service/retired lifecycle support | IMPLEMENTED |
| CREW-073 | Training resources | Training-session persistence | IMPLEMENTED |
| CREW-074 | Training resources | Course code/name | IMPLEMENTED |
| CREW-075 | Training resources | Qualification linkage | IMPLEMENTED |
| CREW-076 | Training resources | Recurrent interval capture | IMPLEMENTED |
| CREW-077 | Training resources | Session time-window validation | IMPLEMENTED |
| CREW-078 | Training resources | Session location/capacity | IMPLEMENTED |
| CREW-079 | Training resources | Required-resource linkage | IMPLEMENTED |
| CREW-080 | Training resources | Resource existence/active validation | IMPLEMENTED |
| CREW-081 | Training resources | Resource booking conflict detection | IMPLEMENTED |
| CREW-082 | Training resources | Independent session approval | IMPLEMENTED |
| CREW-083 | Training resources | Crew enrollment persistence | IMPLEMENTED |
| CREW-084 | Training resources | Qualification-expiry demand date | IMPLEMENTED |
| CREW-085 | Training resources | Expiry/initial/upgrade/recurrent/remedial/voluntary demand reasons | IMPLEMENTED |
| CREW-086 | Training resources | Session capacity enforcement | IMPLEMENTED |
| CREW-087 | Training resources | Crew flight-roster conflict detection | IMPLEMENTED |
| CREW-088 | Training resources | Training attendance/result lifecycle | IMPLEMENTED |
| CREW-089 | Training resources | Training result evidence note | IMPLEMENTED |
| CREW-090 | Pay interface | Crew pay-event persistence | IMPLEMENTED |
| CREW-091 | Pay interface | Roster-actual pay source | IMPLEMENTED |
| CREW-092 | Pay interface | Flight-actual pay source | IMPLEMENTED |
| CREW-093 | Pay interface | Positioning pay source | IMPLEMENTED |
| CREW-094 | Pay interface | Training pay source | IMPLEMENTED |
| CREW-095 | Pay interface | Allowance pay source | IMPLEMENTED |
| CREW-096 | Pay interface | Adjustment pay source | IMPLEMENTED |
| CREW-097 | Pay interface | Pay code and units | IMPLEMENTED |
| CREW-098 | Pay interface | Hours/sectors/days/count/currency unit types | IMPLEMENTED |
| CREW-099 | Pay interface | Optional monetary amount/currency validation | IMPLEMENTED |
| CREW-100 | Pay interface | Evidence reference required | IMPLEMENTED |
| CREW-101 | Pay interface | Duplicate source/pay-code prevention | IMPLEMENTED |
| CREW-102 | Pay interface | Independent pay-event approval | IMPLEMENTED |
| CREW-103 | Pay interface | Payroll batch period | IMPLEMENTED |
| CREW-104 | Pay interface | Approved-event-only batching | IMPLEMENTED |
| CREW-105 | Pay interface | Single-currency batch control | IMPLEMENTED |
| CREW-106 | Pay interface | Batch event count and totals | IMPLEMENTED |
| CREW-107 | Pay interface | Payroll provider reference | IMPLEMENTED |
| CREW-108 | Pay interface | Independent payroll export approval | IMPLEMENTED |
| CREW-109 | Pay interface | Deterministic export payload | IMPLEMENTED |
| CREW-110 | Pay interface | SHA-256 export digest | IMPLEMENTED |
| CREW-111 | Pay interface | Event-to-batch linkage | IMPLEMENTED |
| CREW-112 | Pay interface | Exported event lifecycle | IMPLEMENTED |
| CREW-113 | Pay interface | External payroll acknowledgement reference | IMPLEMENTED |
| CREW-114 | Pay interface | Reconciliation note | IMPLEMENTED |
| CREW-115 | Pay interface | Batch reconciliation actor/time | IMPLEMENTED |
| CREW-116 | Pay interface | Reconciled event lifecycle | IMPLEMENTED |
