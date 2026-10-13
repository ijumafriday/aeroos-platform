# AeroOS 0.13.0 — Round 13: Crew (update over 0.12.0)

## Apply
```bash
cd /c/Projects/aeroos-platform
git add -A && git commit -m "local state before 0.13.0"
# unzip aeroos-0.13.0-update.zip over the folder (replace files) — it contains only the files below
git status && git diff          # keep a local fix with:  git checkout -p -- <file>
docker compose up -d --build    # migration 0025 runs; the demo adds flights for days +3..+9 (uncrewed) and links CPT-01A
scripts/add-crew-user.sh        # once, on an existing install: adds the crew sign-in ola.hansen (new installs have it)
scripts/smoke.sh                # reports AeroOS 0.13.0, checks the roster grid and the crew hub
scripts/verify-all.sh           # writes verify-report.txt — send it to me
```
Needs 0.12.0 applied first. No dependency changed; your `pnpm-lock.yaml` still matches.

## New
- **Flight Ops → Crew Rostering:** roster grid per period with FTL status, block hours and a fatigue index per
  duty; the roster builder proposes captain + first officer for uncrewed flights (rank, type rating, base, leave,
  standby, FTL rulepack, fair spread); accept/reject with stale checks; leave / sickness / days off / training;
  publication with the 14-day rule (ORO.FTL.110) and a change log.
- **Flight Ops → Fatigue Reports (FRM):** confidential KSS / Samn-Perelli reports, reviewed by the quality manager.
- **Crew → My Roster & Briefing** (`ola.hansen`): own duties, dispatch status and briefing link, roster changes to
  acknowledge, fatigue reporting. Flight crew may now also file safety reports.
- Demo fix: demo crew are no longer re-added on top of a crew-recovery hand-over.

## Files (A = added, M = modified)
- A `apps/api/db/migrations/0025_ops_crew_rostering.sql`
- A `apps/api/src/modules/ops/rostering.service.ts`; M `ops.module.ts`, `ops.repository.ts`, `ops.tables.ts`
- M `apps/api/src/platform/authz/authz.service.ts`
- A `apps/web/src/features/ops/Roster.tsx`, `Fatigue.tsx`, `apps/web/src/features/crew/CrewHub.tsx`; M `apps/web/src/app/router.tsx`, `Shell.tsx`
- A `packages/ops-domain/src/rostering.ts`, `rostering.test.ts`; M `index.ts`
- M `packages/contracts/src/index.ts`
- A `infra/cerbos/policies/crew_hub.yaml`, `fatigue_report.yaml`, `tests/crew_test.yaml`; M `crew_roster.yaml`, `occurrence.yaml`
- M `infra/keycloak/aeroos-realm.json` (user `ola.hansen`)
- A `e2e/tests/crew-rostering.spec.ts`; A `scripts/add-crew-user.sh`; M `scripts/smoke.sh`
- A `docs/adr/0023-crew-rostering-fatigue.md`; M `docs/delivery-plan.md`, `README.md`, this file
- M version 0.13.0: `package.json`, `apps/{api,web,worker}/package.json`, `packages/*/package.json`, `e2e/package.json`, `apps/worker/src/otel.ts`, `deploy/helm/aeroos/Chart.yaml`, `values.yaml`

No files deleted.
