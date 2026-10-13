# AeroOS Platform

> **0.27.0 P0 Closure — Regulated Data Governance:** approved/effective master-data envelopes, fail-closed operational gates, reproducible-build verification and signed release images. See `CHANGES-0.27.0.md`.

> **0.25.0 Enterprise Controls:** domain-owned federated search with saved/faceted queries, governed staged migrations with concrete aircraft/personnel adapters, and bounded event rules that can notify but cannot override regulated domain logic. See `CHANGES-0.25.0.md`.


> **0.21.0 Domain Depth — Configuration & Maintenance Planning:** Engineering now owns approved/effective aircraft configuration baselines, effectivity, allowable parts/mod status, actual installed configuration and conformity. Maintenance planning now owns configured hangar resources, labour readiness, task dependencies and scope freeze carried through Part-145 execution. Navigation remains domain/object-centric. See `CHANGES-0.21.0.md`.

> **0.20.0 Open Platform:** versioned integration API, OpenAPI/AsyncAPI contracts, tenant-scoped durable signed webhooks, platform-admin integration boundary, retry/failure history, and production SSRF protections. See `CHANGES-0.20.0.md`.

> **0.19.0 Tenant Boundary & Workload Trust:** PostgreSQL RLS for tenant business tables, request-bound database tenant context, OIDC client-credentials identities for background workloads (shared internal token removed), operator-scoped audit entity reads, stronger SLO alerts, and executable tenant/service-identity smoke tests. See `CHANGES-0.19.0.md`.



> **0.18.0 Production Integrity:** distributed API rate limiting, enforcing CSP, separate liveness/readiness, Kubernetes autoscaling/PDBs/topology spreading/egress controls, unprivileged web runtime, immutable image-digest support, release provenance tooling and SLO alerts. See `CHANGES-0.18.0.md`. A production promotion intentionally remains blocked until `pnpm-lock.yaml` is generated from a trusted registry and committed; no synthetic lockfile is shipped.

An aviation enterprise platform organized around durable business domains rather than workflow menus. Domain modules run in one application, own their data boundaries, and coordinate through events and explicit cross-domain references. The primary domains are **Operations, Crew, Continuing Airworthiness, Engineering, Maintenance, Supply Chain, Organization, Commercial / Finance, Safety, Quality, and Technical Records**, with shared capabilities kept in **Platform / Administration**.

This package contains Deliveries 1–4 plus rounds 5–12, complete. Round 5 added movement messages, crew recovery, multiple operators and observability. Round 6 added irregular movements, crew positioning, authority evidence packs and disaster recovery. Round 7 added passkey-signed CRS, static integration checks and first-run tooling. Round 8 added one-command verification (`scripts/verify-all.sh`), passkeys for step stamps and MEL extensions, and seat-aware crew positioning. Round 9 added AD/SB intake, component back-to-birth history and document & manual control. Round 10 added safety reports (SMS), quality audits and findings, corrective actions, non-conforming parts and scrapping, and required reading enforced at signing. Round 11 added the supply chain: approved suppliers, purchasing, receiving, customs, warranty, exchanges and power-by-the-hour. Round 12 adds flight dispatch: load sheet and balance, fuel and tankering, ICAO flight plans, overflight permits and the dispatch release. The remaining rounds are listed in `docs/delivery-plan.md`.

| Area | What it does |
|---|---|
| **Flight Ops / OCC** | Live timeline for each aircraft, with:<ul><li>**actual times from IATA MVT and ACARS OOOI messages** (authenticated per-operator integration endpoint, Type B envelopes accepted; simulation only as fallback), including **diversions, forced returns (FR) and returns to ramp (RR)**;</li><li>delays and knock-on, cancellations, tail swaps;</li><li>a disruption board and diversion alternates;</li><li>crew flight-time limitations checked on every change;</li><li>**dispatch**: load sheet with standard masses and centre of gravity, runway-limited weights, fuel plan (basic scheme) with tankering advice, ICAO flight plan, overflight permits, and a release that needs every check to pass and is withdrawn when the flight changes;</li><li>a **disruption-recovery optimiser** for aircraft and a **crew-recovery optimiser** that re-crews from standby/reserve, **positioning crew to outstation hand-overs** on the operator's own flights — in a free seat, or a jump seat when the flight is full — (rulepack decides legality, Python + OR-Tools CP-SAT chooses).</li></ul> |
| **CAMO** | MEL deferrals with rule-based deadlines and escalation. **Due list** of tasks, ADs, SBs and life-limited parts by hours, cycles or days. **AD/SB intake** with per-aircraft applicability and four-eyes incorporation. **Component back-to-birth history.** Work packages. Airworthiness state. Reliability programme. |
| **AMO / Part-145** | Task cards with licence-, currency- and required-reading-checked electronic stamps, **non-conforming parts and witnessed scrapping**, **procurement & supply chain** (approved suppliers, purchase orders with approval limits, receiving against release certificates, customs bond, warranty, exchanges, PBH), calibrated tools, parts reservation and issue, a signed CRS PDF, and the hangar plan. |
| **Organization Core** | Personnel, licences, training, company authorisations with their lifecycle, currency, and expiry warnings. **Document & manual control** (exposition, manuals, procedures) with approved revisions and read-and-acknowledge. **Safety** as a separate SMS domain with occurrence reporting, risk, investigation and safety actions. **Quality** separately owns audits, findings, compliance monitoring and quality CAPA. |
| **Platform** | <ul><li>Keycloak OIDC, plus re-login before a CRS;</li><li>Cerbos permissions;</li><li>hash-chained audit trail, anchored into write-once storage, exportable as a **signed evidence pack** that an inspector verifies offline;</li><li>OpenBao signing;</li><li>S3 documents;</li><li>Kafka outbox/inbox;</li><li>Temporal;</li><li>OpenTelemetry traces end to end (API → Temporal → TS/Python workers) and Grafana dashboards as code;</li><li>several operators (AOCs) per user, with a switcher;</li><li>**backup / restore / restore-drill scripts** that prove a restore is complete and untampered.</li><li>Cmd+K search across every domain.</li></ul> |

The regulations live in versioned **rulepacks**: EASA (approved) and FAA (draft). Every regulatory decision shows the rule that made it.

---

## 1. Run it (Docker Desktop + VS Code)

**Requirements:**

- Docker Desktop with **about 10–12 GB of RAM** assigned.
- These ports free: 5432, 7233, 8080, 8081, 8200, 8233, 3592, 9000, 9001 and 29092.

```bash
scripts/doctor.sh          # 30 s pre-flight: Docker memory, ports, line endings, architecture
docker compose up --build
scripts/smoke.sh           # once it is up: checks every service and a signed-in journey per role
```

**Full verification (round 8):** with the stack up, run

```bash
scripts/verify-all.sh      # 15–30 min the first time; add --no-e2e to skip the browser journeys
```

It runs in Docker everything the build environment cannot: a clean install, `pnpm check / build / typecheck /
test / lint`, the optimiser tests with OR-Tools, the Cerbos policy tests, Helm lint for both profiles and the
Playwright journeys. It writes **`verify-report.txt`** — send me that file.

On Windows run the scripts from Git Bash or WSL. **If anything fails, send me the full output of
`scripts/smoke.sh`**: it names the broken piece and appends the relevant log lines.

The first build takes 5–10 minutes. The stack is ready when `aeroos-api` logs `AeroOS API listening` and `web` starts.

**Coming from an earlier delivery?** Run `docker compose down` first, which keeps your data, then `docker compose up --build`:

- The `db-roles` step adds any new database role.
- Migrations up to 0024 upgrade the schema in place (0012–0024 are new since Delivery 4).
- Keycloak re-imports the realm, including the second operator group (FJR). If your Keycloak volume keeps the old realm, run `docker compose down -v` or add the group in the admin console.

To start completely fresh, run `docker compose down -v`.

**Object storage image.** MinIO's community images were removed from Docker Hub in 2026, so `minio/minio` no longer pulls. The stack uses **Silo** (`pgsty/silo`) instead. It is a maintained MinIO fork with the same S3 API, settings and on-disk format, so your existing `minio-data` volume is reused as it is. To use another MinIO-compatible image, set `S3_IMAGE`.

| What | URL |
|---|---|
| **AeroOS** | http://localhost:8080 (press **Ctrl K** anywhere to search) |
| Temporal UI (deferral timers, sweeps, anchoring, movement, optimiser runs) | http://localhost:8233 |
| Keycloak admin (admin / admin) | http://localhost:8081 |
| Object storage console — Silo, a MinIO-compatible fork (aeroos / aeroos-dev-secret) | http://localhost:9001 |
| Grafana (`docker compose --profile observability up`) — folder **AeroOS**: Platform health, Operations | http://localhost:3001 |

### Demo users (password `aeroos`)

| User | Role | Use it for |
|---|---|---|
| `occ.controller` | OCC controller, **NKX and FJR** | Timeline, movement messages, delays and swaps, aircraft and crew recovery, AOC switch |
| `camo.engineer` | CAMO engineer | Deferrals, engineering orders, due list, work packages |
| `camo.manager` | CAMO manager, NKX and FJR | All of the above, plus MEL extensions, reliability and audit |
| `k.mwangi` | Certifying staff (B1.1 + B2, current) | Stamping steps (with tools) and issuing CRSs |
| `j.otieno` | Certifying staff, **training lapsed** | Refused by the currency rule |
| `a.saleh` | Certifying staff, **licence expired** | Refused by the licence rule |
| `safety.manager` | Safety manager, NKX and FJR | SMS occurrence triage, investigations, safety actions and FRM review |
| `quality.manager` | Quality manager, NKX and FJR | Quality audits, findings/CAPA, authorisations, compliance and audit checkpoints |
| `platform.admin` | Platform administrator, NKX | Governed migrations, integration controls and bounded event rules; no business-domain authority is implied |
| `storekeeper` | Stores | Receiving stock |
| `auditor` | Auditor, NKX and FJR | Read-only access and audit-trail verification |
| `finance` | Finance controller (NKX) | Customers, invoices, payments, general ledger, period close (installs from 0.14 or earlier: run `scripts/add-finance-user.sh` once) |
| `ola.hansen` | Flight crew (captain CPT-01A, NKX) | Own roster, roster changes, fatigue reports (installs from 0.12 or earlier: run `scripts/add-crew-user.sh` once) |

---

## 2. Demo script (about 20 minutes)

**A. OCC and crew (`occ.controller`).**

1. Open Flight Ops → **OCC**. The timeline shows every aircraft:
   - **LN-RKG is AOG**, so its flights carry warnings.
   - Purple hatching marks planned maintenance, once CAMO plans a work package (step 5).
   - Red ticks are MEL deadlines.
2. Open **NK682** (LHR–OSL on LN-NGX, a day that hasn't flown yet) and set a **delay of 150 min**:
   - The knock-on delay is applied to the rest of the rotation.
   - The drawer shows the **FTL impact**: the crew's flight duty period now exceeds the EASA ORO.FTL.205 limit, but only within the commander's discretion.
   - At **250 min** it becomes a hard violation.
   - See Flight Ops → **Crew & FTL**.
3. Click **Run optimiser**. The Python CP-SAT solver, running as a Temporal worker, proposes how to recover LN-RKG's day: swaps onto LN-RKF, delays and, if needed, cancellations.
   - The API re-checks the proposal independently.
   - **Accept** applies it. If you changed one of its flights in the meantime, it is marked **stale** instead.

**A2. Movement messages, crew recovery, second operator (`occ.controller`).**

- Open a flight that is due to leave, then in the drawer under **Actual times** click **Fill template** → **Send MVT**. The flight becomes DEPARTED and the times appear. A cyan underline on the timeline marks reported flights. A second identical message is logged as *ignored*, and a conflicting one without `COR` is *rejected*. The log sits under the actual times.
- A gateway posts the same way (each operator has its own key; compose sets `FJR=dev-movement-key-change-me`):

  ```bash
  curl -X POST http://localhost:8080/api/integrations/movements/mvt -H 'x-api-key: dev-movement-key-nkx-change-me' \
       -H 'content-type: text/plain' --data-binary $'MVT\nNK601/'$(date -u +%d)$'.LNABC.OSL\nAD0535/0547\nDL93/0005'
  curl -X POST http://localhost:8080/api/integrations/movements/acars -H 'x-api-key: dev-movement-key-nkx-change-me' \
       -H 'content-type: application/json' -d '{"events":[{"flightNo":"NK601","day":'$(date -u +%-d)',"reg":"LN-ABC","event":"IN","time":"0633"}]}'
  ```
  Times must not be in the future, so pick a flight that has left. Actual airborne time is what CAMO counts as flight hours.
- After step 2's **250 min** delay on NK682, go to Flight Ops → **Crew & FTL** → **Find cover**:
  - Both pilots hand over at Oslo after the London turn.
  - The late **B737 airport standby** crew (12:00–22:00Z) is the cheapest *legal* cover. The early standby is excluded because it is still in its rest period.
  - **Accept and re-crew** re-checks against the rulepack at that moment.
- Switch **AOC** (top bar) to **FJR**: two Dash 8s out of Bergen and nothing of NKX. `camo.engineer` only belongs to NKX and has no switch.

**A3. Irregular operations and evidence (round 6).**

- **Diversion.** In a departed flight's drawer, send an MVT naming another station on blocks:
  ```
  MVT
  NK682/08.LNNGX.BGO
  AA1150/1158
  ```
  - The flight becomes **DIVERTED** and the timeline shows `↯`.
  - The next leg is flagged because the aircraft is in Bergen.
  - The aircraft optimiser starts from Bergen.
  - `EA1205 BGO` only *announces* a diversion (shown as "diverting to … (announced)").
  - `RR` returns a taxiing aircraft to the gate.
  - `FR` is a forced return to the departure station.
- **Positioning.** When the best hand-over point is away from base, crew recovery positions the replacement there on our own flights and brings the original crew member home. On the flight drawer these crew carry the tag `DH`.
- **Evidence pack.** As `quality.manager` or `auditor`, go to Quality → Audit Trail → **Export evidence pack**. Then, on any computer:
  ```bash
  unzip aeroos-evidence-NKX-*.zip -d pack && node pack/verify-evidence.mjs pack --fingerprint <fingerprint shown on the same page>
  ```
- **Restore drill.** Run `scripts/dr/drill.sh`. It backs up the stack, restores a scratch copy, and proves every audit chain and anchor against the write-once copies. See `docs/runbooks/`.

**A4. Passkey-signed CRS (round 7).**

- As `k.mwangi`, use **Passkeys** (top bar) → **Add a passkey**. Use your phone, Windows Hello or Touch ID, or a security key. Browsers allow passkeys on `localhost`.
- Then issue a CRS. The drawer first shows *exactly* what you are about to sign. Your device then signs a challenge bound to that card at that version.
- The evidence is in the `crs.issued` audit entry: nonce, challenge, authenticator data and signature.
- Once you have a passkey, password re-login no longer works for a CRS. A second passkey must be approved with the first.
- **Round 8:** with a passkey, every **step stamp** and every **MEL extension** is confirmed on your device too, bound to that step and those tools (or that deferral and that exact justification). Revoking a passkey needs the passkey itself, or a password sign-in from the last two minutes if the device is lost; you are notified either way.

**A5. Seats for positioning crew (round 8).** Open any flight on the OCC timeline: **Load** shows booked passengers against seats. When crew recovery positions a reserve to an outstation, it picks a flight with a free seat; on a sold-out flight it uses a jump seat and says so in the option ("jump seat — flight full"), and it never books more positioning crew than seats left.

**A6. CAMO engineering and document control (round 9).**

- As `camo.engineer`, open CAMO → **AD / SB & Engineering Orders**. **EASA AD 2026-0217** applies to LN-ABC only (MSN range). Open it and press **Record evaluation**. You cannot also incorporate it: sign in as `camo.manager` and **Incorporate**. It appears on the due list for LN-ABC, counting from its effective date.
- Try to close it as *not applicable* by overriding LN-ABC: it waits for a second signature.
- CAMO → **Components & Rotable History**: life-limited parts per aircraft with life left; open one for its history. Serial **GWN0Y388** is a spare that left LN-ABD at TSN 21,950 / CSN 14,650 — try installing it with less: refused.
- Organization → **Document & Manual Control**: as `k.mwangi`, read and acknowledge **MOE revision 2**. As `quality.manager`, attach a file to the **PROC-07** draft; `camo.manager` approves it (not the author, not the uploader) with an effective date.

**A7. Safety and Quality (independent domains).**

- As anyone (e.g. `k.mwangi`), Safety → **Reports & Investigations** → **Report an occurrence**; tick *confidential*. Colleagues never see your name; `safety.manager` does.
- As `safety.manager`: triage **OR-2026-0003** on the risk matrix (pick a yellow cell — it needs an investigator); **OR-2026-0002** is a mandatory report already filed; verify the linked safety action (done by its owner) and close the occurrence when its controls are effective.
- Quality → **Audits & Findings**: **QA-2026-07** has a level 2 finding — record its root cause; `storekeeper` completes **CA-0001** under Quality → **Quality Actions**; `quality.manager` independently verifies effectiveness.
- AMO → **Non-conforming Parts & Scrap**: **NCR-0001** — as `camo.engineer` choose *scrap*; as `storekeeper` record the mutilation (the same person cannot do both).
- **Required reading:** `k.mwangi` cannot sign task cards until **MOE revision 2** is acknowledged (Organization → Document & Manual Control) — the task card says so.

**A8. Supply chain (round 11).** AMO → **Procurement & Supply Chain**.

- As `storekeeper`: **RQ-0001** (hydraulic filters) has two quotes — award one. **PO-0002** (24 filters, about 7,600 USD) waits for approval: `storekeeper` cannot approve it; `camo.manager` can.
- **PO-0001**: half the slat-track bolts arrived from Germany and sit in the **bonded store** until customs clears them — clear them and they go into stock (and to any task card short of them).
- Try receiving an order with a certificate of conformity for a part that is not a standard part, or in worse condition than ordered: refused.
- Warranty: **WC-0001** (an IDG that failed 140 days after overhaul) was filed by `camo.engineer`; `storekeeper` records the supplier's decision. Exchanges: **EX-0001**'s core is overdue. PBH: the monthly statement for the B737 APU and wheels & brakes contract.

**A9. Dispatch (round 12).** As `occ.controller`, Flight Ops → **Dispatch & Load Control**, pick tomorrow and open a flight.

- Enter the load (booked passengers are pre-filled) and block fuel: the load sheet shows ZFW/TOW/LW against the limits and the centre of gravity in %MAC; the fuel plan shows trip, contingency, alternate and final reserve; tankering advice compares fuel prices.
- **File the flight plan** (the ICAO message is shown), then **Release** — possible only when every check is green. Change the load by more than 500 kg, swap the tail on the OCC timeline or delay the flight: the release is withdrawn.
- The Tromsø flights hit a runway-limited take-off weight; the Gran Canaria flights cross Moroccan airspace and need the overflight permit listed under *Overflight permits* (it expires in about 25 days).
- **Print briefing package** gives the crew's copy.

**A10. Crew rostering and fatigue (round 13).** As `occ.controller`, Flight Ops → **Crew Rostering**.

- Pick a period from +3 days: those flights have no crew yet. **Build roster proposal**: each pairing gets a captain and a first officer (rank, type rating, base, FTL rulepack; nobody on leave or standby; flying spread fairly; a fatigue index per duty). Open pairings say why. **Accept** books it — refused if anything changed meanwhile.
- **FO-02B** is on leave from day +5: the builder never uses them then. Record sickness or days off under *Leave, days off…*; if it clashes with rostered flights the OCC is told to re-crew.
- **Publish** the period: less than 14 days ahead needs a reason (ORO.FTL.110). From then on every change is logged for the crew member.
- As `ola.hansen` (lands on **My Roster & Briefing**): duties with report times, fatigue index, dispatch status and briefing link; roster changes to acknowledge; **Report fatigue** (KSS, Samn-Perelli).
- As `safety.manager`, Flight Ops → **Fatigue Reports**: review the reports (not your own). The OCC cannot see them.

**A11. Engineering health (round 14).** As `camo.engineer`, CAMO → **Engine Health & Structural Damage**.

- *Engines*: **896230** (LN-ABC #2) shows an EGT step shift — borescope recommended; **41077** (LN-RTA #1) has a low EGT margin and a removal forecast; **600118** (LN-NGX #1) burns oil above the alert level. Open one for the trend charts; close an alert with the action taken (it stays quiet for 30 days unless it turns red). `k.mwangi` can record an oil uplift.
- *Structural damage*: LN-ABD has two dents close together — each allowable, assessed together they need a repair (temporary doubler, valid for 400 FC). LN-FNX has a lightning strike beyond the SRM: engineering records approved repair data, then a certifying engineer (not the same person) records the repair. Record a new dent beyond the allowable limits on any aircraft: it grounds that aircraft on the OCC timeline until repaired.

**A12. Business (round 15).**

- As `camo.manager`, AMO → **Third-party Maintenance & Billing**: orders for other operators. **CO-0003** (Baltic Wings) waits for the customer's approval — recording it runs a credit check; **CO-0002** (Arctic Charter) is in work; **CO-0004** is completed. Create a quote, record the customer's PO, let `k.mwangi` book labour and parts against it.
- As `finance`: issue the invoice (more than 10 % over the quote needs the customer's recorded approval of the overrun), record payments, credit an unpaid invoice. Organization → **Enterprise Structure** shows the group, legal entities with their approvals and cost centres.
- Finance & Business → **General Ledger**: every invoice, payment and goods receipt is posted automatically (double entry, base currency USD); trial balance, P&L by cost centre, manual journals, month close in order (a late posting goes to the next open month) and the CSV journal export for the ERP.
- Finance & Business → **Executive Dashboard**: punctuality and completion, fleet availability, deferrals, engine and structural alerts, crew and fatigue, safety and quality, revenue and receivables — each module reports its own figures.

**A13. Certification readiness (delivery 5).** As `quality.manager` or `auditor`, Quality → **Compliance Matrix**: every regulatory requirement the system touches with its exposition section, status (enforced / recorded / needs approved data / organisation only), how it is met and the evidence — tests, rulepack decisions, access policies, screens and how often its audit actions were recorded in the last year. Export it as CSV; it is also inside every evidence pack. The checklist for going live is in `docs/certification/README.md`; `scripts/security-scan.sh` runs a ZAP baseline scan, a dependency audit and a header check before a penetration test.

**B. Maintenance programme (`camo.engineer`).**

4. Go to CAMO → **Due List**:
   - **LN-ABD**: the A-check is *in tolerance* and gear lubrication is *due soon*.
   - **LN-NGX**: EASA AD 2026-0123 has **3 cycles left**. Hours and cycles arrive as flights land, so during today's flying the AD goes **OVERDUE**, CAMO declares the aircraft **not airworthy**, and the OCC shows it as non-dispatchable. Run the optimiser again.
   - The **reliability** chart shows defect rates per 1000 FH against the alert levels.
5. Tick LN-ABD's items, then **Create work package** → **Plan** into OSL-H2 → confirm labour readiness → **Freeze scope** → **Release to AMO**:
   - The OCC timeline now shows the slot.
   - The AMO **hangar plan** shows it too.
   - One task card per item appears on the hangar floor, with parts reserved.

**C. Hangar (`k.mwangi`, `j.otieno`, `a.saleh`, `storekeeper`).**

6. As `j.otieno`, open a card: you are refused because your continuation training has lapsed. As `a.saleh`, you are refused because your licence has expired.
7. As `k.mwangi`, open the A-check card:
   - Tick **T-TQ-07** (out of calibration) and try to sign: refused under **Part-145.A.40**.
   - Tick **T-TQ-08** instead and sign every step (acknowledge **MOE revision 2** first if the card says so — round 10).
   - **Issue CRS**. You may be asked to sign in again first.
   - Parts are issued from stock, the **CRS PDF** appears, and back in CAMO the item's interval has **reset** from the CRS.
8. As `storekeeper`, go to AMO → **Stores** and receive stock for any part marked *low* or *short*. For example, the slat-track bolts are below their minimum at Oslo.

**D. Earlier flows.**

9. Raise an MEL deferral → engineering order → task card → CRS → the deferral closes (Delivery 1).
10. As `quality.manager`:
    - In personnel, record training for Otieno so he becomes current again, and suspend or reinstate an authorisation.
    - Under Quality → Audit, use **Anchor now** and **Verify chain**. Try the `ops` and `camo` chains.

---

## 3. Develop locally

```bash
corepack enable && pnpm install         # commit the generated pnpm-lock.yaml
pnpm infra:up                           # databases, Kafka, Temporal, Keycloak, Cerbos, MinIO, OpenBao
pnpm dev                                # API :3000, TS worker, web :5173
cd services/optimiser && pip install -r requirements.txt && python -m aeroos_optimiser.worker
```

Checks:

```bash
pnpm check && pnpm build && pnpm typecheck && pnpm test && pnpm lint
(cd services/optimiser && python -m unittest discover -s tests -t .)
pnpm policies:test
pnpm e2e        # against a running stack; first: pnpm --filter @aeroos/e2e e2e:install
```

---

## 4. Repository map

```
packages/   framework-free core (lint-enforced): kernel, compliance (rulepacks), audit, signing,
            mro-domain (MEL, task cards, due-list engine, work packages, tools/stores),
            org-domain (authorisations, currency), ops-domain (flights, duties, recovery contract), contracts
apps/api    NestJS modular monolith: platform, compliance, org, camo, amo, ops (one schema + role each)
apps/worker Temporal worker (TS): deferral escalation, org sweep, audit anchoring, CAMO airworthiness, movement fallback, upload sweep
services/optimiser  Temporal worker (Python + OR-Tools): aircraft disruption recovery, crew recovery
apps/web    React app — OCC, crew, MEL, due list, work packages, task cards, stores, personnel, audit, Cmd+K
e2e/        Playwright journeys across all domains
infra/      Postgres init/upgrade, Keycloak realm, Cerbos policies + tests, observability
deploy/helm umbrella chart: values-cloud.yaml | values-selfhosted.yaml
docs/adr    0001–0017 · docs/runbooks · docs/delivery-plan.md
scripts/    doctor.sh · smoke.sh · dr/ (backup, restore, drill)
checks/     static integration checks (pnpm check)
```

**How domains talk** (no module reads another's tables):

- **CAMO → AMO:** `camo.eo.released`, `camo.wp.released`.
- **AMO → CAMO:** `amo.crs.issued`, which closes deferrals and records compliance.
- **Ops → CAMO:** `ops.flight.arrived` (from MVT/ACARS, airborne time when reported), which provides hours and cycles.
- **Ops → everyone:** `ops.flight.departed`, `ops.flight.delayed`, `ops.crew.reassigned`.
- **CAMO → Ops:** `camo.mel.*`, `camo.airworthiness.changed` and `camo.wp.planned`, which drive dispatchability and maintenance slots.
- **AMO → Org:** `amo.taskcard.step_signed`, which counts as maintenance experience.

---

## 5. Kubernetes

```bash
helm dependency update deploy/helm/aeroos
helm install aeroos deploy/helm/aeroos -f deploy/helm/aeroos/values-cloud.yaml      # or values-selfhosted.yaml
```

Secrets the chart expects:

- `aeroos-db-passwords` (all roles, including `DB_PASSWORD_OPS_SVC`)
- `aeroos-s3-credentials`
- `aeroos-transit-token`
- `aeroos-internal-token`
- `aeroos-movement-key` (key `MOVEMENT_API_KEYS`, `"NKX=…,FJR=…"`; leave `api.movementKeySecret` empty to disable the integration endpoint)

Set `api.defaultOperator` for users in several operators. The optimiser runs as its own Deployment (`optimiser.*` values).

---

## 6. Verification status — read this

- **Verified before delivery:**
  - **281 automated tests pass** (plus 3 CP-SAT tests that need OR-Tools; `verify-all.sh` runs them):

    | Package | Tests |
    |---|---|
    | compliance (incl. EASA/FAA FTL golden tests) | 47 |
    | ops-domain (schedule, MVT/ACARS incl. diversions/RR/FR/Type B, crew recovery incl. positioning and seats, second operator, dispatch, rostering & fatigue) | 63 |
    | mro-domain (incl. AD/SB rules, component life, scrapping, supply chain, engine trends, oil, structural damage, billing) | 63 |
    | org-domain (incl. document control, safety risk, findings, corrective actions, ledger & periods) | 27 |
    | signing (incl. WebAuthn verifier driven by a software authenticator: ES256/EdDSA/RS256, forged and weak keys, replay, evidence re-verification) | 19 |
    | Python optimiser (model, checker, greedy, crew assignment incl. seats, telemetry) | 14 |
    | audit (incl. evidence packs run through the shipped offline verifier, tamper and forged-signer cases, inspector files) | 11 |
    | worker | 5 |
    | kernel | 4 |
    | CRS PDF | 3 |
    | static integration checks (routes, authorisation, events, ORM ↔ SQL, compliance matrix, security posture, plus self-tests) | 25 |

  - Strict TypeScript typecheck of every core package.
  - **All migrations (0001–0024) and seeds ran on PostgreSQL 16**, both as a fresh install and as an upgrade from Delivery 4. Every module role's permissions were exercised, including the movement log (append-only for the service), crew recovery runs, standby, audit operator tagging and the hangar-plan backfill.
  - The API, workers and web were checked for internal type errors against stand-in library types.
  - **The restore drill ran end to end** against PostgreSQL in local mode:
    - backup, then restore into a scratch database;
    - the chain verification passed;
    - a tampered entry was detected;
    - a tampered write-once anchor was detected;
    - the scratch copy was dropped afterwards.
  - The evidence-pack ZIP was checked with `unzip -t` and Python's `zipfile`.
  - **The static integration checks found no mismatches.** They covered:
    - 62 web calls against 76 API routes;
    - 66 authorisation checks against the Cerbos policies and Keycloak roles;
    - every event against its producer, consumers and topic subscriptions;
    - 36 Drizzle tables (308 columns) against the migrations.
  - An independent review of each round's code found operator-scoping gaps (maintenance slots, audit view, reliability hours, work-package requirements, hangar plan), crew-recovery accept checks and movement-log issues (round 5). It also found weaknesses in the evidence-pack trust model, completeness and key handling, plus movement and crew-positioning edge cases (round 6). In round 8 it found that a stolen session could revoke a user's passkeys and then sign without one, plus e2e repeatability and client retry gaps. In round 9 it found that superseding an AD could reset its clock, that one person could close an applicable AD, that re-evaluation could drop overrides, and that a document approver could supply the file they approved. In round 10 it found that quarantine could take reserved stock, that report notifications revealed confidential titles, and that a scrap could block another operator's serial. In round 11 it found that the purchase-order approval limit could be avoided by currency or by splitting orders, that a worse condition than ordered could be received, and that one person could file and credit a warranty claim. In round 12 it found that a release could survive a fuel cut, a tail swap or a cancellation, that the landing centre of gravity was not checked, and that fuel prices were shared between operators. **All were fixed** before packaging.
  - `docker compose config` validates.
- **Run on your machine:** `doctor.sh` and `smoke.sh` passed on the 0.7 stack (Docker Desktop, Windows).
- **Not run before delivery** (the package registries and Docker Hub are unreachable from the build environment; `scripts/verify-all.sh` runs all of them):
  - `pnpm install` and the image builds;
  - the running stack;
  - Helm;
  - the Cerbos policy tests;
  - the CP-SAT tests (they run when OR-Tools is installed, including in the optimiser's Docker build);
  - the browser journeys;
  - the Grafana dashboards against live data.

  Send me `verify-report.txt`; problems, if any, will be in integration code rather than the regulated core.
- **Other limits:**
  - Two parts of the PostGIS work are not exercised: the alternates query and the geography column. The sandbox had no PostGIS, so they were tested with a stand-in type.
  - Movement messages:
    - ACARS carries no station, so a diversion is confirmed only by an MVT from the alternate.
  - Crew recovery:
    - positioning counts cabin and jump seats against booked passengers, but not seat class or surface transport;
    - models airport standby only.
  - The DR scripts ran in local mode only; the docker-compose mode (`docker compose exec`, the MinIO client container) has not run here.
  - Passkeys were verified against a software authenticator and Chromium's virtual authenticator (e2e), not yet against physical devices.
  - Passkeys gate the CRS, step stamps and MEL extensions (`PASSKEY_REQUIRED_FOR`); other signatures still use the session or a fresh sign-in.
  - The FAA rulepack is a draft.
  - All credentials are local-only. OpenBao runs in dev mode (in memory), so restart `api` if you restart `openbao`.

## Scale and resilience assurance

AeroOS 0.26.0 treats scale as measured release evidence. `tests/assurance/scale-targets.json` defines the qualifying major-airline data floor; `scripts/assurance/qualify-dataset.py` verifies a performance database before results may be labelled against that profile. Authenticated mixed-load and soak tests live in `tests/load/`, concurrency/idempotency is exercised by `scripts/assurance/concurrency-idempotency.sh`, and non-destructive dependency-loss drills are in `scripts/assurance/failure-drill.sh`. See ADR-0038.

## Product deficiency register

AeroOS tracks unresolved product, assurance and operational-depth gaps in `docs/MASTER-DEFICIENCY-REGISTER.md` (machine-readable source: `docs/MASTER-DEFICIENCY-REGISTER.json`). Release checks treat this as an append-only scope-control register; capabilities are not considered complete merely because source code exists.
