# Delivery plan

## Delivery 1 — Foundation + CAMO MEL reference flow (delivered)
- Monorepo (pnpm + Nx), CI, lint-enforced module boundaries, ADRs 0001–0006.
- Full stack in Docker Desktop: PostgreSQL/PostGIS, Kafka (KRaft), Temporal + UI, Keycloak, Cerbos, API, worker, web.
- Compliance engine with EASA rulepack (approved) and FAA rulepack (draft); 28 golden tests.
- Identity (Keycloak OIDC + PKCE), authorisation (Cerbos, fail-closed), hash-chained audit, Ed25519 signing (dev provider).
- **Reference flow:** raise MEL deferral → deadline from rulepack → Temporal escalation (T-24h / T-6h / expiry) → engineering order →
  AMO task card (event-driven) → licence-checked step stamps → CRS → MEL closed (event-driven) → audit chain verified.
- Helm umbrella chart with cloud and self-hosted profiles.

Every later module copies this pattern: own schema + role, rulepack decisions, Cerbos policy, outbox events, audit chain, Temporal for time.

## Delivery 2 — Organization Core + hardening (delivered)
- **Organization Core:** personnel register, Part-66 licences, training records, company authorisation lifecycle
  (issue / suspend / reinstate / revoke / expire) with reasons and history; scope checked by the rulepack.
- **Currency rules** (EASA 145.A.35(c)(d); FAA 65.83 draft): recent experience from signed task-card steps + continuation training,
  enforced at every signature. 10 new golden tests.
- **Expiry:** hourly Temporal sweep — T-90 / T-30 / T-7 / EXPIRED warnings for authorisations, licences and training; auto-expiry.
- **Documents:** S3-compatible object storage (MinIO), presigned direct uploads, SHA-256 recorded in the audit chain; signed CRS PDF generated
  from the CRS event.
- **Signing:** OpenBao/Vault Transit key service (HSM-capable), key versions pinned and verifiable; CRS step-up (fresh login ≤ 5 min).
- **Audit anchoring:** hourly signed checkpoints of every chain in a write-once (Object Lock) bucket; verification compares against them.
- **Observability:** OpenTelemetry in the API; optional collector + Tempo + Prometheus + Grafana profile.
- **E2E:** Playwright journey across CAMO → AMO → Org → Quality, run in CI against the full Docker stack.

## Delivery 3 — Flight Ops / OCC (delivered, in the same package as Delivery 4)
- Ops schema and role; schedule, crew roster, airports with PostGIS (diversion alternates).
- FTL in the rulepacks: EASA ORO.FTL.205 / 210 / 235 (FAA Part 117 draft); crew impact returned with every schedule change.
- OCC timeline (own SVG Gantt, Bryntum-ready props), delay with knock-on, cancel, tail swap, disruption board.
- Dispatch projection from CAMO events (MEL, airworthiness, maintenance slots).
- Recovery optimiser: Python + OR-Tools CP-SAT Temporal worker, greedy fallback, independent re-check, stale-safe apply.
- Simulated movement (until MVT/ACARS) feeding CAMO hours and cycles.

## Delivery 4 — CAMO & AMO depth (delivered)
- Maintenance programme due list: tasks, ADs, life-limited parts; FH / FC / days with tolerances and forecast.
- Work packages: plan into hangar bays, release to AMO, task cards per item with parts reservation, compliance from the CRS.
- Airworthiness state published to Ops (overdue items ground the aircraft).
- Reliability programme (defects per 1000 FH vs alert levels).
- Stores (stock, reservations, issue at CRS, receiving) and tools register with calibration enforced at signing.
- Cmd+K search across every domain the user may see.

## Round 5 — Real-world inputs and operating several AOCs (delivered)
- IATA MVT / COR MVT and ACARS OOOI ingestion through a per-operator authenticated endpoint and an OCC entry form; actual times drive
  status, knock-on and CAMO utilisation (airborne time); every message logged; simulation only as fallback (ADR-0011).
- Crew recovery: duties that break FTL are handed over at base to the cheapest legal standby/reserve crew; legality by the rulepack,
  assignment by CP-SAT, re-checked at acceptance (ADR-0012). Airport standby in the demo roster.
- Multiple operators per user: X-Operator selection, AOC switcher, second demo operator FJR; audit view, hangar plan and projections
  scoped per operator (ADR-0013).
- Traces across Temporal (TS + Python workers), business metrics, Grafana dashboards as code, abandoned-upload sweep (ADR-0014).

## Round 6 — Irregular operations, evidence and recovery (delivered)
- Diversions, forced returns (FR), returns to ramp (RR), announced vs confirmed diversion, Type B envelopes.
- Crew positioning (deadheading) to outstation hand-overs and home, under ORO.FTL.220.
- Signed authority evidence packs with an offline verifier; operator inside the audit hash (ADR-0015).
- Backup / restore / restore-drill scripts proving restores against the write-once anchors; runbooks (ADR-0016).

## Round 7 — Signature assurance and first-run safety (delivered)
- Passkey (WebAuthn) confirmation of the CRS with challenges bound to the card version; evidence in the audit trail (ADR-0017).
- Static integration checks in CI: routes, authorisation, events, ORM ↔ SQL.
- `scripts/doctor.sh` and `scripts/smoke.sh` for the first real run.

## Round 8 — Verification and signature coverage (delivered)
- First real run on Docker Desktop confirmed (doctor, smoke); lockfile and image fixes.
- `scripts/verify-all.sh`: repo checks, optimiser, Cerbos, Helm and the browser journeys in Docker → `verify-report.txt`.
- Passkeys for step stamps and MEL extensions; passkey revocation needs a passkey or a fresh sign-in (ADR-0018).
- Seat-aware crew positioning (cabin, then jump seat) with passenger loads; solvers respect seats left.

## Round 9 — CAMO engineering and document control (delivered)
- AD/SB intake: applicability per aircraft, mandatory-AD rules, four-eyes incorporation and N/A confirmation,
  supersedure that never resets the clock, fleet changes re-evaluated hourly (ADR-0019).
- Component back-to-birth history: removals/installations with TSN/CSN that can never go down.
- Document & manual control: revisions approved by a second person against a pinned file, effective by date,
  read-and-acknowledge by audience.

## Round 10 — Safety & Quality (delivered)
- Safety reports (confidential option, ICAO risk matrix, 72-hour MOR), investigations, closure with residual risk.
- Quality audits and findings by level with due dates; corrective actions verified by a second person.
- Non-conforming parts: quarantine of free stock, disposition, witnessed scrapping; scrapped serials never reinstalled.
- Required reading of the exposition enforced at signing (ADR-0020).

## Round 11 — Supply chain (delivered)
- Approved suppliers, requisitions and quotes, purchase orders with a currency-aware approval limit, receiving
  against release certificates, customs bond, warranty claims, exchanges with core returns, PBH statements (ADR-0021).

## Round 12 — Dispatch (delivered)
- Load sheet with standard masses and CG at ZFW/TOW/LW, runway-limited weights, basic fuel scheme, tankering
  advice, ICAO flight plan, overflight permits, dispatch release with LMC tolerance and automatic withdrawal;
  printable briefing package (ADR-0022).

## Round 13 — Crew (delivered)
- Pairings and a roster builder (rank, type rating, base, leave/standby, FTL rulepack, fair spread, fatigue
  penalty) with propose → accept under a lock; roster publication with the 14-day rule and a change log crew
  acknowledge; leave/sickness/days off/training; fatigue index per duty; confidential fatigue reports (KSS,
  Samn-Perelli) reviewed by the safety office; crew hub with own roster and briefing status (ADR-0023).

## Round 14 — Engineering health (delivered)
- Engine condition trend monitoring (ΔEGT/ΔN2/ΔFF step shifts, EGT margin limits and removal forecast, vibration)
  and oil consumption per uplift, with persisted alerts closed by an engineer with the action taken; structural
  damage chart with SRM allowable/repair/refer assessment, interacting damages, approved repair data, permanent and
  temporary repairs and repeat inspections — open damage beyond limits grounds the aircraft (ADR-0024).

## Round 15 — Business (delivered)
- Enterprise structure (group, legal entities with their approvals, cost centres); third-party maintenance billing
  (customers and terms, quote → customer approval with credit check → work → invoice with overrun approval →
  payments → credit notes, gap-free numbering per issuer); a double-entry general ledger posted from the AMO events,
  with period close in order, late postings to the next open month and an ERP journal export; an executive
  dashboard composed from each module's own figures (ADR-0025).

## Delivery 5 — Certification readiness (0.16, delivered)
- Compliance traceability matrix as code, checked at build, with live audit-trail evidence counts; in every
  evidence pack; illustrative-data register; build-time security checks (authentication on every route, validated
  bodies); web security headers and a report-only CSP checked by a browser journey; CSV formula defusing;
  `scripts/security-scan.sh`; certification readiness checklist and penetration-test scope (ADR-0026,
  docs/certification).
- Next: fixes from the `verify-all.sh` / `security-scan.sh` reports; switch the CSP to enforcing; the organisation's
  steps in docs/certification/README.md (rulepack sign-off, exposition sections, data replacement, penetration test).

## Later
- Crew pairing optimisation (multi-day pairings with night stops, CP-SAT); a validated biomathematical fatigue model; surface transport for positioning.
- ACMI/wet-lease (aircraft of one AOC operated for another); cross-operator group views with their own authorisation model.
- OpenSearch provider for search; AG Grid Enterprise where grouping/pivoting is needed; Bryntum for the OCC and hangar Gantt (licence).
- WebAuthn step-up flow.

## Delivery 5 — Certification readiness
- FAA rulepack review and approval by a qualified FAA compliance person; additional authorities as customers require.
- Exposition/MOE mapping, authority audit export packs, penetration test, DR runbooks and restore drills.
