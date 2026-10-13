# ADR 0045 — Operator-owned regulated Operations references

Status: Accepted — 0.36.0

## Decision
Aircraft type performance/mass reference data, runway limits, filed-route references and permit rules are operator-owned regulated data. Their keys include `operator_id`, PostgreSQL FORCE RLS is mandatory, and application reads additionally scope by the acting operator.

There is no global fallback. Existing global rows are copied forward only into operator namespaces during migration 0043. Aircraft-type and runway records are copied only for aircraft types already approved in that operator profile; route/permit continuity rows are copied per existing operator and immediately become independently governed by that operator's regulated-data hash and approval lifecycle.

## Consequences
* Two AOCs may maintain different approved performance, route or permit data for the same aircraft type/city pair/country.
* Dispatch cannot accidentally consume another operator's reference values even if an application predicate regresses; database RLS is the second boundary.
* Migration 0043 is a contract migration and application rollback across it is prohibited. A forward fix is required.
* The canonical regulated-data digest is tenant-specific for all four reference datasets.
