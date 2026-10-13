# AeroOS 0.9.0 — Round 9: CAMO engineering and document control (update over 0.8.0)

## Apply
```bash
cd /c/Projects/aeroos-platform
git add -A && git commit -m "local state before 0.9.0"
# unzip aeroos-0.9.0-update.zip over the folder (replace files) — it contains only the files below
git status && git diff          # keep a local fix with:  git checkout -p -- <file>
docker compose up -d --build    # migration 0021 + demo seed 9007 run automatically
scripts/smoke.sh                # reports AeroOS 0.9.0 and checks the three new areas
scripts/verify-all.sh           # writes verify-report.txt — send it to me
```
No dependency changed (`package.json` edits are the version number only); your `pnpm-lock.yaml` still matches.

## New
- **CAMO → AD / SB & Engineering Orders** — record ADs and SBs, applicability per aircraft (type + MSN range,
  overrides with reasons), engineering decision, four-eyes incorporation into the due list, second signature
  for "not applicable" overrides, supersedure without resetting the clock, new aircraft re-evaluated hourly.
- **CAMO → Components & Rotable History** — life-limited parts per aircraft with life left, back-to-birth
  history, removal and installation (TSN/CSN can never go down; certificate needed for parts without history).
- **Organization → Document & Manual Control** — exposition, manuals and procedures; revisions approved by a
  second person against the exact file (sha256) reviewed; effective by date; read-and-acknowledge by role.

## Files (A = added, M = modified)
- A `apps/api/db/migrations/0021_camo_engineering_documents.sql`, `apps/api/db/seeds/9007_engineering_documents.sql`
- A `apps/api/src/modules/camo/directives.service.ts`, `components.service.ts`; M `camo.module.ts`, `camo.search.ts`, `programme.service.ts`, `programme.tables.ts`
- A `apps/api/src/modules/org/document-control.service.ts`; M `org.module.ts`, `org.tables.ts`
- M `apps/api/src/platform/authz/authz.service.ts`, `apps/api/src/platform/storage/documents.service.ts`
- A `apps/web/src/features/engineering/Directives.tsx`, `Components.tsx`, `apps/web/src/features/org/Documents.tsx`; M `apps/web/src/app/router.tsx`, `Shell.tsx`, `features/programme/Programme.tsx`
- A `packages/mro-domain/src/directive.ts`, `component.ts`, `directive.test.ts`; M `index.ts`, `maintenance.ts`
- A `packages/org-domain/src/document-control.ts`, `document-control.test.ts`; M `index.ts`
- M `packages/contracts/src/index.ts`
- A `infra/cerbos/policies/directive.yaml`, `controlled_document.yaml`, `tests/engineering_documents_test.yaml`; M `document.yaml`, `maintenance_programme.yaml`
- A `e2e/tests/engineering.spec.ts`; M `scripts/smoke.sh`
- A `docs/adr/0019-ad-sb-components-document-control.md`; M `docs/delivery-plan.md`, `README.md`, this file
- M version 0.9.0: `package.json`, `apps/{api,web,worker}/package.json`, `packages/*/package.json`, `e2e/package.json`, `apps/worker/src/otel.ts`, `deploy/helm/aeroos/Chart.yaml`, `values.yaml`

No files deleted.
