# AeroOS 0.32.0 — P0 regulated-data integrity and authority governance

This release stays on the master deficiency register's P0 sequence. It advances only D005 and D021 while leaving evidence- or registry-blocked P0 items open.

## D005 — regulated master-data integrity

- Production startup now rejects `SEED_DEMO=true`, `ALLOW_DRAFT_RULEPACKS=true`, and `MOVEMENT_SIMULATION=true`.
- Core regulated datasets are catalogued centrally.
- Migration `0041_regulated_data_integrity.sql` provides a canonical per-operator SHA-256 of the live dataset actually used by production actions.
- Activation of a governed revision verifies its approved SHA-256 against the live data.
- Every later `assertEffective` call re-verifies the live hash, so post-approval edits fail closed as `REGULATED_DATASET_DRIFT` until a new revision is validated/approved/activated.
- Readiness now reports both effectivity and integrity.

D005 remains PARTIAL: historical migration rows marked as illustrative/template data still exist in the source history and a real production tenant must replace them with operator-approved data before acceptance can be claimed.

## D021 — FAA / multi-authority compliance

- Each shipped authority-rulepack source artifact now has an explicit SHA-256 fingerprint.
- Release validation fails if a rulepack source changes without updating the governed artifact manifest.
- In production, every operator must have an EFFECTIVE approval record for the exact authority/version artifact SHA-256 before the compliance engine starts.
- Draft rulepacks are prohibited in production by configuration.
- No KCAA or other authority pack has been invented to make the matrix appear complete.

D021 advances from MISSING to PARTIAL. The FAA candidate remains draft and still requires independent regulatory validation/approval before production qualification.
