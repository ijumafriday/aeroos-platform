# Runbook — Backup, restore and the monthly restore drill

**Owner:** platform on-call · **Evidence kept by:** quality manager · **Review:** yearly, or after any real restore

## What is backed up

| Data | How | Where it lives |
|---|---|---|
| PostgreSQL `aeroos`: every module schema, the audit chains, outbox/inbox, anchors register | `pg_dump -Fc`, ownership and grants included | `backups/<UTC>/aeroos.dump` |
| Audit chain heads at backup time | `heads.live.json`, taken *before* the dump | same folder |
| Documents bucket (`aeroos-documents`) — uploads and CRS PDFs | `mc mirror` | `backups/<UTC>/objects/aeroos-documents/` |
| Write-once anchors bucket (`aeroos-audit-anchors`) | `mc mirror` (read only) | `backups/<UTC>/objects/aeroos-audit-anchors/` |
| Integrity of the backup itself | SHA-256 of every file | `MANIFEST.sha256` |

Not backed up here: Kafka (events are rebuilt from the outbox and from module state; consumers are idempotent),
Temporal history (workflows are restarted by the API at boot), Keycloak (export the realm separately; the
demo realm is in `infra/keycloak`), OpenBao/Vault (back up with its own tooling — **losing the Transit key
means losing the ability to sign; old signatures stay verifiable with the published public keys**).

## Schedule (production)

- Database: daily dump plus continuous WAL archiving / point-in-time recovery from the managed service or
  CloudNativePG. This script is the portable baseline and the drill tool; it does not replace PITR.
- Object storage: bucket replication to a second site, Object Lock retention ≥ the regulatory retention.
- Copy every backup off-site. Keep at least 35 daily, 12 monthly.

## Take a backup

```bash
scripts/dr/backup.sh                   # → backups/<UTC timestamp>/
```

## Restore

1. **Stop writers:** `docker compose stop api worker optimiser` (Kubernetes: scale the Deployments to 0).
2. Check the backup: `restore.sh` refuses if any file does not match `MANIFEST.sha256`.
3. Restore:
   ```bash
   scripts/dr/restore.sh backups/<UTC> aeroos --replace --objects
   ```
   Without `--replace` the script will not touch the live database; without a target it restores into
   `aeroos_restore` for inspection.
4. **Prove it before reopening:**
   ```bash
   docker compose up -d api && docker compose stop worker      # api only, so nothing new is written yet
   docker compose cp backups/<UTC>/heads.live.json api:/tmp/heads.json
   docker compose cp backups/<UTC>/objects/aeroos-audit-anchors api:/tmp/anchors
   docker compose exec -e PGHOST=postgres -e PGUSER=postgres -e PGPASSWORD=postgres -e PGDATABASE=aeroos \
     api node dist/tools/verify-chains.js --expect /tmp/heads.json --anchors-dir /tmp/anchors
   ```
   Every chain must say *chain intact*, *backup head present* and *anchors match write-once copies*. Add
   `--keys keys.json` (from an evidence pack) to verify every anchor signature as well. The write-once copy is
   what makes this meaningful: whoever could rewrite the database could not rewrite those objects.
   After `--objects`, re-apply Object Lock retention to the restored anchors (mirror does not carry it):
   `mc retention set --recursive compliance <days>d <alias>/aeroos-audit-anchors`.
5. Start the stack. The outbox relay republishes anything unpublished; consumers skip what they already
   processed (inbox).
6. Record the restore (who, when, which backup, verify output) in the quality system. Anything entered after
   the backup was taken must be re-entered from source records; the audit trail shows exactly where the
   restored state ends.

## Monthly restore drill

```bash
scripts/dr/drill.sh
```

Backs up the running stack, restores into a scratch database `aeroos_drill`, verifies every audit chain against
the heads recorded at backup time and every anchor against its write-once copy, always drops the scratch
database (it holds every operator's data), and writes `drill-report.txt`. Exit code 0 = pass. A backup whose
anchors bucket could not be copied fails (override with `AEROOS_ALLOW_NO_OBJECTS=1` only for testing). File the report with the quality records; a failed drill is a finding.

Outside docker compose (managed PostgreSQL, Kubernetes), run the same scripts with `AEROOS_LOCAL=1` and the
usual `PGHOST`/`PGUSER`/`PGPASSWORD`, plus `AEROOS_S3_URL`/`AEROOS_S3_KEY`/`AEROOS_S3_SECRET` and a local `mc`.

## If verification fails

Do **not** reopen the system. Follow [audit-chain-broken.md](audit-chain-broken.md).
