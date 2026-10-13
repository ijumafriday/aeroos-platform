# ADR-0008 — Documents in S3-compatible object storage, registered and hashed by the platform

**Status:** accepted · **Date:** 2026-10

## Context
Licence scans, training certificates, task-card photos and the CRS itself are evidence. They must be stored durably, outside the
database, and it must be provable later that a file is the one that was filed.

## Decision
- **S3 protocol only** (ADR-0003): MinIO in Docker Compose and self-hosted Kubernetes, Ceph RGW on-premises, any cloud S3.
- **Bytes never pass through the API.** Upload is three steps: register (`POST /documents/uploads` → presigned PUT, 15 min) → browser PUTs
  to object storage → confirm (`POST /documents/:id/confirm`), where the API streams the stored object, computes SHA-256 and size, marks it
  `STORED` and writes `document.stored` with the hash to the `documents` audit chain. Downloads use 5-minute presigned GET URLs.
- Two S3 clients: in-cluster endpoint for the API, public endpoint for signing browser URLs (a presigned signature covers the host).
- **Ownership:** every document has an owner (`task_card`, `crs`, `training_record`, `licence`, `personnel`); Cerbos `document` policy
  decides attach/read per owner type. Only PDF, PNG and JPEG up to 25 MB.
- **CRS PDF:** AMO consumes `amo.crs.issued`, renders the certificate (pdf-lib, standard fonts, includes signature, key id and payload
  hash), stores it as a *generated* document (one per card, idempotent), links it to the card and records its hash in the `amo` chain. The
  PDF is a rendering; the signed CRS record remains the legal record.
- AWS SDK v3 is pinned to an exact version: newer releases add default checksum behaviour that some S3-compatible stores and browser
  presigned uploads do not accept. Revisit when MinIO/Ceph versions in the field support it.

## Consequences
- Files scale independently of the database and can use the storage tier's own replication, lifecycle and WORM features.
- A pending upload that is never confirmed stays `PENDING` and is never shown; a cleanup job for stale pending objects is follow-up work.
