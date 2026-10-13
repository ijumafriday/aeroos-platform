# AeroOS 0.16.0 — hotfix 1

The API image failed to build (`health.service.ts(135,47): error TS2345 … 'EngineAlertCode'`): a set of alert codes
was typed too narrowly. One line changed; nothing else.

## Apply
```bash
# unzip aeroos-0.16.0-fix1.zip over the folder (replaces apps/api/src/modules/camo/health.service.ts)
docker compose up -d --build
scripts/smoke.sh
scripts/verify-all.sh
scripts/security-scan.sh
```
