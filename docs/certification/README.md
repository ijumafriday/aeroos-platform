# Certification readiness

What it takes to use AeroOS for regulated records under an AOC, a Part-CAMO and a Part-145 approval, what the
platform already provides, and what the organisation must do. The authority approves the **organisation** and
accepts its **procedures and tools** through the expositions; software is not "certified" on its own. This folder
is the starting point for that acceptance.

## 1. The traceability matrix
Quality → **Compliance Matrix** (also `GET /api/compliance/matrix`, CSV export, and `compliance-matrix.json` inside
every evidence pack). Source: `packages/compliance/src/matrix.ts`; every reference in it (test, rulepack decision,
access policy, screen, audit action) is checked at build time by `checks/matrix.test.ts`.

| Status | Meaning | What to do |
|---|---|---|
| IMPLEMENTED | The system enforces it and records it | Describe the tool in the exposition section named; sample the audit actions |
| SUPPORTED | Recorded and tracked; your procedure decides | Write the procedure; the system is the record |
| DATA | Logic in place, needs your approved data | Replace the illustrative data (list in the matrix and below) |
| PROCEDURAL | Outside the system | Your own procedure, facilities, people |

## 2. Before operational use — the organisation's checklist
1. **Approve the operator master data** (Quality → Compliance Matrix → Regulated master data). Migration 0038 registers legacy/demo values as DRAFT; operational gates remain closed until an independently validated and approved revision is EFFECTIVE: type mass &
   balance and performance data, weighing records, runway limits, routes and permit rules, the maintenance
   programme, SRM limits, engine trend limits, the operator MEL, the FTL scheme values.
2. **Rulepacks.** A qualified compliance person reviews and signs off each rulepack version used (EASA 2026.1;
   the FAA rulepack is a draft and is refused in production until approved). Record the approval in Document
   Control.
3. **Expositions.** Add the sections named in the matrix to the CAME, MOE, OM-A and SMM: electronic records and
   signatures (MOE 2.14 / CAME 1.3), back-up and restore (MOE 2.14.2), access for the authority (evidence packs),
   information security (Part-IS). Submit for approval / acceptance.
4. **Signing key.** Publish the platform signing-key fingerprint (Quality → Audit Trail) to the authority through
   a separate channel; inspectors verify evidence packs with `--fingerprint`.
5. **Users and roles.** Map every person to a role; certifying staff enrol passkeys; remove the demo users and
   change all default passwords and secrets (Keycloak admin, database, OpenBao, MinIO, movement API keys).
6. **Restore drill.** Run `scripts/dr/drill.sh` monthly and keep the reports (runbook: backup-and-restore.md).
7. **Security.** Run `scripts/security-scan.sh`, then commission the penetration test described in
   [pentest-scope.md](pentest-scope.md); close the findings.
8. **Acceptance testing.** Run `scripts/verify-all.sh` on the release you deploy and keep `verify-report.txt`
   with the release record; the browser journeys are the user acceptance baseline.
9. **Parallel run.** Run the system alongside the current records for an agreed period before switching over.

## 3. Evidence an inspector can check without trusting AeroOS
- **Evidence pack** (Quality → Audit Trail → export): signed ZIP with the operator's audit trail for a period, the
  hash links around it, signed anchors, the document register and the compliance matrix with that period's
  evidence counts; verified offline with the included `verify-evidence.mjs` (runbook: evidence-pack.md).
- **Write-once anchors** of every audit chain each hour (Object Lock).
- **Rulepack decisions** carry the rulepack version and regulatory basis in the audit record.

## 4. Release and change control
- Each release lists its changes (`CHANGES-x.y.z.md`) and architecture decisions (`docs/adr`).
- Static checks, unit tests, policy tests, Helm lint and the browser journeys run in `verify-all.sh`.
- Database migrations are append-only (an applied migration is never changed); every regulated record keeps its
  history on the audit chain.
