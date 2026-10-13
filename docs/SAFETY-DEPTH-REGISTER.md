# Safety Depth Register — AeroOS 0.41.0

Software-complete Safety/SMS control-depth baseline. Operator ERP exercises, real-world SPI data quality and authority/operator acceptance remain governed by the master deficiency register.

**Software-depth baseline:** 96/96 capabilities implemented.

| ID | Area | Capability | Status |
|---|---|---|---|
| SAF-001 | Governance | Dedicated Safety depth register | IMPLEMENTED |
| SAF-002 | Governance | Tenant RLS across Safety control tables | IMPLEMENTED |
| SAF-003 | Governance | Safety control authorization policy | IMPLEMENTED |
| SAF-004 | Governance | Compact single-workspace Safety assurance UI | IMPLEMENTED |
| SAF-005 | Governance | Audit-chain recording for governed Safety changes | IMPLEMENTED |
| SAF-006 | Governance | Independent approval controls for regulated Safety decisions | IMPLEMENTED |
| SAF-007 | Hazard & bow-tie | Hazard register with owner/category/source | IMPLEMENTED |
| SAF-008 | Hazard & bow-tie | Initial probability/severity capture | IMPLEMENTED |
| SAF-009 | Hazard & bow-tie | Hazard review-date control | IMPLEMENTED |
| SAF-010 | Hazard & bow-tie | Bow-tie preventive control persistence | IMPLEMENTED |
| SAF-011 | Hazard & bow-tie | Bow-tie recovery control persistence | IMPLEMENTED |
| SAF-012 | Hazard & bow-tie | Control type classification | IMPLEMENTED |
| SAF-013 | Hazard & bow-tie | Control owner assignment | IMPLEMENTED |
| SAF-014 | Hazard & bow-tie | Control assurance method | IMPLEMENTED |
| SAF-015 | Hazard & bow-tie | Control effectiveness lifecycle | IMPLEMENTED |
| SAF-016 | Hazard & bow-tie | Control degraded-state handling | IMPLEMENTED |
| SAF-017 | Hazard & bow-tie | Control assurance evidence | IMPLEMENTED |
| SAF-018 | Hazard & bow-tie | Independent control assurance | IMPLEMENTED |
| SAF-019 | Hazard & bow-tie | Residual risk probability/severity | IMPLEMENTED |
| SAF-020 | Hazard & bow-tie | Residual risk acceptance basis | IMPLEMENTED |
| SAF-021 | Hazard & bow-tie | Bow-tie completeness gate before acceptance | IMPLEMENTED |
| SAF-022 | Hazard & bow-tie | Control-assurance gate before acceptance | IMPLEMENTED |
| SAF-023 | Hazard & bow-tie | Hazard acceptance identity/timestamp | IMPLEMENTED |
| SAF-024 | Hazard & bow-tie | Hazard versioning | IMPLEMENTED |
| SAF-025 | Hazard & bow-tie | Occurrence/source reference linkage | IMPLEMENTED |
| SAF-026 | SPI / SPT | SPI definition and ownership | IMPLEMENTED |
| SAF-027 | SPI / SPT | SPT definition and ownership | IMPLEMENTED |
| SAF-028 | SPI / SPT | Directionality lower-is-better | IMPLEMENTED |
| SAF-029 | SPI / SPT | Directionality higher-is-better | IMPLEMENTED |
| SAF-030 | SPI / SPT | Target threshold | IMPLEMENTED |
| SAF-031 | SPI / SPT | Warning threshold | IMPLEMENTED |
| SAF-032 | SPI / SPT | Breach threshold | IMPLEMENTED |
| SAF-033 | SPI / SPT | Threshold ordering validation | IMPLEMENTED |
| SAF-034 | SPI / SPT | Measurement unit | IMPLEMENTED |
| SAF-035 | SPI / SPT | Measurement frequency | IMPLEMENTED |
| SAF-036 | SPI / SPT | Hazard linkage | IMPLEMENTED |
| SAF-037 | SPI / SPT | Period-bounded measurements | IMPLEMENTED |
| SAF-038 | SPI / SPT | Measurement provenance reference | IMPLEMENTED |
| SAF-039 | SPI / SPT | Measurement SHA-256 provenance | IMPLEMENTED |
| SAF-040 | SPI / SPT | Automatic NORMAL state | IMPLEMENTED |
| SAF-041 | SPI / SPT | Automatic WARNING state | IMPLEMENTED |
| SAF-042 | SPI / SPT | Automatic BREACH state | IMPLEMENTED |
| SAF-043 | SPI / SPT | Measurement recorder/timestamp | IMPLEMENTED |
| SAF-044 | SPI / SPT | Indicator status lifecycle | IMPLEMENTED |
| SAF-045 | SPI / SPT | Latest performance visibility | IMPLEMENTED |
| SAF-046 | Management of Change | Formal MoC object | IMPLEMENTED |
| SAF-047 | Management of Change | Change reason and scope | IMPLEMENTED |
| SAF-048 | Management of Change | Affected-domain register | IMPLEMENTED |
| SAF-049 | Management of Change | MoC owner | IMPLEMENTED |
| SAF-050 | Management of Change | Planned effectivity | IMPLEMENTED |
| SAF-051 | Management of Change | Post-change monitoring due date | IMPLEMENTED |
| SAF-052 | Management of Change | Structured risk assessment | IMPLEMENTED |
| SAF-053 | Management of Change | Assessment lifecycle state | IMPLEMENTED |
| SAF-054 | Management of Change | Pre-implementation action register | IMPLEMENTED |
| SAF-055 | Management of Change | Implementation action register | IMPLEMENTED |
| SAF-056 | Management of Change | Monitoring action register | IMPLEMENTED |
| SAF-057 | Management of Change | Action owner/due date | IMPLEMENTED |
| SAF-058 | Management of Change | Action evidence completion | IMPLEMENTED |
| SAF-059 | Management of Change | Independent action verification | IMPLEMENTED |
| SAF-060 | Management of Change | Creator/approver separation | IMPLEMENTED |
| SAF-061 | Management of Change | Risk-assessment gate before approval | IMPLEMENTED |
| SAF-062 | Management of Change | Pre-implementation action requirement | IMPLEMENTED |
| SAF-063 | Management of Change | Pre-implementation verification gate | IMPLEMENTED |
| SAF-064 | Management of Change | Implementation start event | IMPLEMENTED |
| SAF-065 | Management of Change | Effective timestamp | IMPLEMENTED |
| SAF-066 | Management of Change | Monitoring lifecycle | IMPLEMENTED |
| SAF-067 | Management of Change | All-action verification closure gate | IMPLEMENTED |
| SAF-068 | Management of Change | Closure effectiveness evidence | IMPLEMENTED |
| SAF-069 | Management of Change | MoC closure identity/timestamp | IMPLEMENTED |
| SAF-070 | Emergency Response | ERP scenario register | IMPLEMENTED |
| SAF-071 | Emergency Response | Emergency scenario type classification | IMPLEMENTED |
| SAF-072 | Emergency Response | Activation criteria | IMPLEMENTED |
| SAF-073 | Emergency Response | Commander role definition | IMPLEMENTED |
| SAF-074 | Emergency Response | Communications plan | IMPLEMENTED |
| SAF-075 | Emergency Response | Authority contact set | IMPLEMENTED |
| SAF-076 | Emergency Response | Stakeholder contact set | IMPLEMENTED |
| SAF-077 | Emergency Response | Scenario versioning | IMPLEMENTED |
| SAF-078 | Emergency Response | Exercise due date | IMPLEMENTED |
| SAF-079 | Emergency Response | Independent ERP approval | IMPLEMENTED |
| SAF-080 | Emergency Response | Approved-scenario activation gate | IMPLEMENTED |
| SAF-081 | Emergency Response | Activation commander | IMPLEMENTED |
| SAF-082 | Emergency Response | Activation summary/location/reference | IMPLEMENTED |
| SAF-083 | Emergency Response | Automatic activation log event | IMPLEMENTED |
| SAF-084 | Emergency Response | Chronological ERP event log | IMPLEMENTED |
| SAF-085 | Emergency Response | ERP action event support | IMPLEMENTED |
| SAF-086 | Emergency Response | Authority-notification event support | IMPLEMENTED |
| SAF-087 | Emergency Response | Stakeholder-notification event support | IMPLEMENTED |
| SAF-088 | Emergency Response | Decision/resource/status events | IMPLEMENTED |
| SAF-089 | Emergency Response | Event owner/due/external reference | IMPLEMENTED |
| SAF-090 | Emergency Response | Stand-down control | IMPLEMENTED |
| SAF-091 | Emergency Response | Stand-down identity/timestamp | IMPLEMENTED |
| SAF-092 | Emergency Response | Debrief required for closure | IMPLEMENTED |
| SAF-093 | Emergency Response | Lessons-learned required for closure | IMPLEMENTED |
| SAF-094 | Emergency Response | Scenario exercise-history update | IMPLEMENTED |
| SAF-095 | Emergency Response | Active-emergency visibility | IMPLEMENTED |
| SAF-096 | Emergency Response | Exercise-overdue visibility | IMPLEMENTED |
