# Analytics Depth Register

**Platform:** 0.48.0  
**Capabilities:** 120/120 implemented

| ID | Category | Capability | Status |
|---|---|---|---|
| ANA-001 | Dataset governance | tenant-scoped dataset registry | IMPLEMENTED |
| ANA-002 | Dataset governance | domain ownership | IMPLEMENTED |
| ANA-003 | Dataset governance | source type classification | IMPLEMENTED |
| ANA-004 | Dataset governance | source reference | IMPLEMENTED |
| ANA-005 | Dataset governance | row grain declaration | IMPLEMENTED |
| ANA-006 | Dataset governance | schema definition | IMPLEMENTED |
| ANA-007 | Dataset governance | independent dataset approval | IMPLEMENTED |
| ANA-008 | Dataset governance | dataset suspension lifecycle | IMPLEMENTED |
| ANA-009 | Snapshot ingestion | approved-dataset gating | IMPLEMENTED |
| ANA-010 | Snapshot ingestion | captured timestamp | IMPLEMENTED |
| ANA-011 | Snapshot ingestion | period bounds | IMPLEMENTED |
| ANA-012 | Snapshot ingestion | row-count persistence | IMPLEMENTED |
| ANA-013 | Snapshot ingestion | source payload checksum | IMPLEMENTED |
| ANA-014 | Snapshot ingestion | schema checksum | IMPLEMENTED |
| ANA-015 | Snapshot ingestion | unknown-field rejection | IMPLEMENTED |
| ANA-016 | Snapshot ingestion | independent snapshot verification | IMPLEMENTED |
| ANA-017 | Semantic dimensions | dimension code | IMPLEMENTED |
| ANA-018 | Semantic dimensions | source-field binding | IMPLEMENTED |
| ANA-019 | Semantic dimensions | human label | IMPLEMENTED |
| ANA-020 | Semantic dimensions | data type declaration | IMPLEMENTED |
| ANA-021 | Semantic dimensions | dataset field validation | IMPLEMENTED |
| ANA-022 | Semantic dimensions | duplicate-code rejection | IMPLEMENTED |
| ANA-023 | Semantic dimensions | dimension allow-list | IMPLEMENTED |
| ANA-024 | Semantic dimensions | model-bound filter use | IMPLEMENTED |
| ANA-025 | Semantic metrics | metric code | IMPLEMENTED |
| ANA-026 | Semantic metrics | field binding | IMPLEMENTED |
| ANA-027 | Semantic metrics | COUNT aggregation | IMPLEMENTED |
| ANA-028 | Semantic metrics | SUM aggregation | IMPLEMENTED |
| ANA-029 | Semantic metrics | AVG aggregation | IMPLEMENTED |
| ANA-030 | Semantic metrics | MIN/MAX aggregation | IMPLEMENTED |
| ANA-031 | Semantic metrics | COUNT_DISTINCT aggregation | IMPLEMENTED |
| ANA-032 | Semantic metrics | metric allow-list | IMPLEMENTED |
| ANA-033 | Model governance | definition checksum | IMPLEMENTED |
| ANA-034 | Model governance | revision field | IMPLEMENTED |
| ANA-035 | Model governance | draft lifecycle | IMPLEMENTED |
| ANA-036 | Model governance | review lifecycle | IMPLEMENTED |
| ANA-037 | Model governance | independent approval | IMPLEMENTED |
| ANA-038 | Model governance | activation gate | IMPLEMENTED |
| ANA-039 | Model governance | retirement lifecycle | IMPLEMENTED |
| ANA-040 | Model governance | audit events | IMPLEMENTED |
| ANA-041 | Report design | active-model gating | IMPLEMENTED |
| ANA-042 | Report design | visualization selection | IMPLEMENTED |
| ANA-043 | Report design | dimension selection | IMPLEMENTED |
| ANA-044 | Report design | metric selection | IMPLEMENTED |
| ANA-045 | Report design | filter definition | IMPLEMENTED |
| ANA-046 | Report design | sort definition | IMPLEMENTED |
| ANA-047 | Report design | row limit | IMPLEMENTED |
| ANA-048 | Report design | drilldown dimensions | IMPLEMENTED |
| ANA-049 | Report validation | unknown dimension rejection | IMPLEMENTED |
| ANA-050 | Report validation | unknown metric rejection | IMPLEMENTED |
| ANA-051 | Report validation | unsafe SQL exclusion | IMPLEMENTED |
| ANA-052 | Report validation | filter allow-list | IMPLEMENTED |
| ANA-053 | Report validation | bounded row limit | IMPLEMENTED |
| ANA-054 | Report validation | controlled version creation | IMPLEMENTED |
| ANA-055 | Report validation | definition checksum | IMPLEMENTED |
| ANA-056 | Report validation | change note | IMPLEMENTED |
| ANA-057 | Report governance | draft lifecycle | IMPLEMENTED |
| ANA-058 | Report governance | review lifecycle | IMPLEMENTED |
| ANA-059 | Report governance | independent approval | IMPLEMENTED |
| ANA-060 | Report governance | activation gate | IMPLEMENTED |
| ANA-061 | Report governance | retirement lifecycle | IMPLEMENTED |
| ANA-062 | Report governance | creator identity | IMPLEMENTED |
| ANA-063 | Report governance | submission identity | IMPLEMENTED |
| ANA-064 | Report governance | approval identity | IMPLEMENTED |
| ANA-065 | Execution gating | active report required | IMPLEMENTED |
| ANA-066 | Execution gating | active semantic model required | IMPLEMENTED |
| ANA-067 | Execution gating | controlled version required | IMPLEMENTED |
| ANA-068 | Execution gating | verified snapshot required | IMPLEMENTED |
| ANA-069 | Execution gating | operator scope | IMPLEMENTED |
| ANA-070 | Execution gating | latest snapshot selection | IMPLEMENTED |
| ANA-071 | Execution gating | explicit snapshot selection | IMPLEMENTED |
| ANA-072 | Execution gating | run authorization | IMPLEMENTED |
| ANA-073 | Execution engine | group-by dimensions | IMPLEMENTED |
| ANA-074 | Execution engine | COUNT calculation | IMPLEMENTED |
| ANA-075 | Execution engine | SUM calculation | IMPLEMENTED |
| ANA-076 | Execution engine | AVG calculation | IMPLEMENTED |
| ANA-077 | Execution engine | MIN calculation | IMPLEMENTED |
| ANA-078 | Execution engine | MAX calculation | IMPLEMENTED |
| ANA-079 | Execution engine | COUNT_DISTINCT calculation | IMPLEMENTED |
| ANA-080 | Execution engine | filter evaluation | IMPLEMENTED |
| ANA-081 | Execution output | sort application | IMPLEMENTED |
| ANA-082 | Execution output | row limit enforcement | IMPLEMENTED |
| ANA-083 | Execution output | result persistence | IMPLEMENTED |
| ANA-084 | Execution output | result row count | IMPLEMENTED |
| ANA-085 | Execution output | result checksum | IMPLEMENTED |
| ANA-086 | Execution output | snapshot traceability | IMPLEMENTED |
| ANA-087 | Execution output | version traceability | IMPLEMENTED |
| ANA-088 | Execution output | requestor identity | IMPLEMENTED |
| ANA-089 | Schedule governance | active-report gating | IMPLEMENTED |
| ANA-090 | Schedule governance | daily cadence | IMPLEMENTED |
| ANA-091 | Schedule governance | weekly cadence | IMPLEMENTED |
| ANA-092 | Schedule governance | monthly cadence | IMPLEMENTED |
| ANA-093 | Schedule governance | timezone capture | IMPLEMENTED |
| ANA-094 | Schedule governance | delivery channel | IMPLEMENTED |
| ANA-095 | Schedule governance | delivery target | IMPLEMENTED |
| ANA-096 | Schedule governance | independent schedule approval | IMPLEMENTED |
| ANA-097 | Audit and security | forced RLS | IMPLEMENTED |
| ANA-098 | Audit and security | RLS WITH CHECK | IMPLEMENTED |
| ANA-099 | Audit and security | system bypass control | IMPLEMENTED |
| ANA-100 | Audit and security | Cerbos read permission | IMPLEMENTED |
| ANA-101 | Audit and security | Cerbos manage permission | IMPLEMENTED |
| ANA-102 | Audit and security | Cerbos approve permission | IMPLEMENTED |
| ANA-103 | Audit and security | Cerbos run permission | IMPLEMENTED |
| ANA-104 | Audit and security | audit logging | IMPLEMENTED |
| ANA-105 | User workspace | semantic-layer tab | IMPLEMENTED |
| ANA-106 | User workspace | dataset-snapshots tab | IMPLEMENTED |
| ANA-107 | User workspace | report-designer tab | IMPLEMENTED |
| ANA-108 | User workspace | runs-schedules tab | IMPLEMENTED |
| ANA-109 | User workspace | role-aware controls | IMPLEMENTED |
| ANA-110 | User workspace | status pills | IMPLEMENTED |
| ANA-111 | User workspace | run result preview | IMPLEMENTED |
| ANA-112 | User workspace | compact BI navigation | IMPLEMENTED |
| ANA-113 | Release assurance | migration compatibility declaration | IMPLEMENTED |
| ANA-114 | Release assurance | master deficiency evidence | IMPLEMENTED |
| ANA-115 | Release assurance | depth verification script | IMPLEMENTED |
| ANA-116 | Release assurance | aggregate release gate | IMPLEMENTED |
| ANA-117 | Release assurance | contract version alignment | IMPLEMENTED |
| ANA-118 | Release assurance | Helm version alignment | IMPLEMENTED |
| ANA-119 | Release assurance | Compliance RLS correction | IMPLEMENTED |
| ANA-120 | Release assurance | conservative PARTIAL status | IMPLEMENTED |
