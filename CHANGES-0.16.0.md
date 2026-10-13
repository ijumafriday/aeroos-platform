# AeroOS 0.16.0 — Delivery 5: Certification readiness (update over 0.15.0)

## Apply
```bash
cd /c/Projects/aeroos-platform
git add -A && git commit -m "local state before 0.16.0"
# unzip aeroos-0.16.0-update.zip over the folder (replace files) — it contains only the files below
git status && git diff          # keep a local fix with:  git checkout -p -- <file>
docker compose up -d --build    # migration 0028 (an index) runs automatically
scripts/smoke.sh                # reports AeroOS 0.16.0 and checks the compliance matrix
scripts/verify-all.sh           # writes verify-report.txt — send it to me
scripts/security-scan.sh        # new: ZAP baseline, dependency audit, headers → send security-report/summary.txt
```
Needs 0.15.0 applied first. No dependency changed; your `pnpm-lock.yaml` still matches.

## New
- **Quality → Compliance Matrix**: every regulatory requirement the system touches (Part-CAMO, Part-M, Part-21,
  Part-145, Part-ORO, Part-CAT, platform) → exposition section → status (enforced / recorded / needs approved data /
  organisation only) → how it is met → evidence: tests, rulepack decisions, access policies, screens, and how often
  its audit actions were recorded. CSV export; included (for the pack's period and chains) in every evidence pack.
- The matrix is code and is **checked at build** (`checks/matrix.test.ts`): a reference to a missing test, rule,
  policy, screen or audit action fails the build.
- **Security posture checked at build** (`checks/security.test.ts`): every route needs a signed-in user unless public
  with its own guard; every request body is validated.
- **Security headers** on every web and API response (nginx used to drop them on pages with a cache header);
  Permissions-Policy, COOP; a Content Security Policy in report-only mode, with a browser journey that fails on any
  violation (to be switched to enforcing once it runs clean on your stack).
- CSV exports defuse spreadsheet formulas.
- `docs/certification/README.md` (go-live checklist for the organisation) and `pentest-scope.md`.
- Fix: the compliance service had a circular import that could leave the evidence-pack service without its
  dependency at start-up.

## Files (A = added, M = modified)
- A `packages/compliance/src/matrix.ts`; M `packages/compliance/src/index.ts`
- A `apps/api/src/modules/compliance/compliance.service.ts`, `matrix.service.ts`; M `compliance.module.ts`, `evidence.ts`
- M `apps/api/src/main.ts`, `apps/api/src/modules/ops/ops.module.ts`, `apps/api/src/platform/authz/authz.service.ts`
- A `apps/api/db/migrations/0028_audit_action_index.sql`
- M `packages/audit/src/evidence.ts`, `evidence.test.ts`; M `packages/org-domain/src/ledger.ts`, `ledger.test.ts`
- M `packages/contracts/src/index.ts`
- A `apps/web/src/features/quality/Compliance.tsx`; M `apps/web/src/app/router.tsx`, `Shell.tsx`, `apps/web/nginx.conf.template`
- A `checks/matrix.test.ts`, `checks/security.test.ts`; M `checks/README.md`
- A `infra/cerbos/policies/compliance_matrix.yaml`, `tests/certification_test.yaml`
- A `e2e/tests/zz-security.spec.ts`; A `scripts/security-scan.sh`; M `scripts/smoke.sh`, `.gitignore`
- A `docs/adr/0026-certification-readiness.md`, `docs/certification/README.md`, `docs/certification/pentest-scope.md`; M `docs/delivery-plan.md`, `docs/runbooks/README.md`, `README.md`, this file
- M version 0.16.0: `package.json`, `apps/{api,web,worker}/package.json`, `packages/*/package.json`, `e2e/package.json`, `apps/worker/src/otel.ts`, `deploy/helm/aeroos/Chart.yaml`, `values.yaml`

No files deleted. Note: `OIDC_AUTHORITY` must not end with a slash (it is used in the CSP).
