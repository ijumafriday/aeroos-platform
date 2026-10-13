# Runbook — An audit chain does not verify

Triggered by: *Verify chain* in Quality → Audit showing **Chain broken**, an anchor mismatch, `verify-chains`
failing after a restore, or an inspector's offline verifier failing on an evidence pack.

1. **Preserve.** Do not repair anything. Take a backup (`scripts/dr/backup.sh`) and keep it read-only; note
   the time and who noticed.
2. **Contain.** If the break is in live data (not a restore copy), restrict write access: stop `api` and
   `worker` or put the API behind maintenance. Regulated releases (CRS) must not be issued from a system
   whose trail cannot be shown intact.
3. **Locate.** The verifier names the first broken sequence number and the reason:
   - `HASH_MISMATCH` — the content of that entry changed after it was written;
   - `LINK_BROKEN` — an entry before it was removed or inserted;
   - anchor mismatch — the chain no longer contains the hash that was signed into write-once storage.
   Compare with the last good anchor (`aeroos-audit-anchors` bucket) and the most recent backup that verifies.
4. **Explain.** Database logs (who connected as a superuser, DDL that disabled the append-only trigger),
   infrastructure access logs, recent restores.
5. **Report.** Quality manager informs the accountable manager; occurrence reporting per the operator's
   procedures (and to the competent authority where required, e.g. Reg. (EU) 376/2014).
6. **Recover.** Restore from the last backup that verifies (backup-and-restore.md), re-enter later records
   from source documents, and record the gap. Never "re-hash" a chain to make it pass.
