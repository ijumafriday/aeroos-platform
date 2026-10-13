# ADR-0015 — Authority evidence packs, verifiable offline

**Status:** accepted · **Date:** 2026-10

## Context
Inspectors (competent authority, customer audits) need an operator's regulated records for a period in a form
they can check themselves. "Trust our database" is not evidence; a PDF report is not verifiable.

## Decision
- **Signed ZIP** built from the live chains (`packages/audit/evidence.ts`, own ZIP writer, no dependencies):
  the operator's entries with their hashes; the hash *links* of every entry from just before to just after the
  period (other operators' links carry time and operator but no content); the signed anchors in that range
  plus the one before it; the platform's own verification; the document register; all public key versions
  (`keys.json`); a manifest of SHA-256s, signed with the platform key (Vault/OpenBao Transit).
- **Audit records name their operator inside the hash** (`AuditRecord.operatorId`, from 0.5): an entry cannot
  be moved between operators without breaking the chain. Older entries have no operator and hash as before.
- **Offline verifier** (`verify-evidence.mjs`, Node 18+, no installation) recomputes everything and checks:
  manifest signature by `public-key.pem`; every file listed and nothing extra; each entry hashes correctly and
  sits on an unbroken run of links; every link of this operator inside the period is present with content;
  the run starts before and ends after the period (or at the chain's first entry / head); every anchor
  signature verifies with a key from `keys.json` (which the signed manifest vouches for).
- **The signer must be confirmed out of band.** A pack proves only internal consistency unless the inspector
  passes the signing key fingerprint obtained separately (`--fingerprint`, shown in Quality → Audit Trail).
  Exit codes: 0 verified, 3 consistent but signer not confirmed, 1 failed.
- The export is itself audited (`evidence.exported` on the `compliance` chain); Cerbos action
  `audit_chain:export` for auditors and quality managers of that operator only.

## Consequences
- Completeness rests on operator labels: the labels of the operator's own entries are hashed; for other
  operators' links the label is as recorded by the platform. An inspector who needs more asks for a full
  pack under the authority's own access.
- Document contents are not in the pack (only names and hashes); files are provided on request and checked
  against the hashes.
