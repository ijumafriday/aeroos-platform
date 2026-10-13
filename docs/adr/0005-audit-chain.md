# ADR-0005 — Tamper-evident audit trail as a hash chain

**Status:** accepted · **Date:** 2026-10

## Context
Part-CAMO, Part-145 and authority audits require that maintenance and airworthiness records cannot be silently altered.
An `updated_at` column and application logs do not demonstrate that.

## Decision
- `platform.audit_log` is **append-only**: a trigger rejects `UPDATE` and `DELETE`; the API role has `INSERT`/`SELECT` only.
- Each module writes to its own **chain** (`camo`, `amo`, `org`…). Each entry stores `prev_hash` and `hash = sha256(canonicalJson(entry))`.
  `UNIQUE(chain, prev_hash)` makes forks impossible; a per-chain advisory lock serialises appends.
- Entries record actor, action, entity, the **before/after**, and any compliance `Decision`s used.
- `packages/audit.verifyChain` is an independent verifier (no database code). `GET /api/platform/audit/verify?chain=camo` runs it; the UI's
  Quality → Audit page shows the result.
- **External anchors (Delivery 2):** every hour a Temporal cron workflow signs each chain head (`{chain, seq, hash, anchoredAt}`) with the
  KeyService and writes it to an **S3 Object Lock bucket in COMPLIANCE mode** (write-once; not even the bucket owner can shorten retention).
  `platform.audit_anchors` records it (also append-only). Verification reports whether the live chain still contains the anchored entry
  unchanged *and* the stored object's signature verifies.

## Consequences
- A DBA with superuser rights could rebuild a chain consistently, but not rewrite an anchored object or forge its signature, so any
  rewrite before the latest anchor is detected. Changes after the latest anchor are protected by the chain alone until the next anchor
  (at most an hour). That is what "tamper-evident" means here.
- Retention: `ANCHOR_RETENTION_DAYS` is 1 day in Docker Compose so a dev stack can be cleaned; set it to the record-retention period
  (e.g. 3650 days) in production. The bucket is created by the API on first use with that default retention.
