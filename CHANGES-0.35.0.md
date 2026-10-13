# AeroOS 0.35.0 — P0 Regulated-Data Hygiene Correction

This release remains P0-only and corrects a deficiency discovered while closing D005.

## D005 — regulated data hygiene advanced

* Historical generic aircraft-type and engine-limit rows are classified by migration `0042`.
* Unreferenced historical illustrative defaults are removed on upgrade/fresh install.
* Demo environments explicitly reintroduce demo-only values from seed files and tag them `DEMO`.
* Production startup rejects any database with demo seed history or unprovenanced retained aircraft/engine master rows.
* Existing legacy records are never silently treated as approved/provenanced.

## D003 — status correction

D003 is reopened from COMPLETE to PARTIAL. Several operator-approved dispatch reference tables are still globally keyed.
They must become operator-owned/RLS-protected and all dispatch/hash queries must consume the tenant-scoped records before
D003 can honestly return to COMPLETE.

No P1 or P2 capability work is included.
