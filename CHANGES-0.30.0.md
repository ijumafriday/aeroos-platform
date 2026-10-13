# AeroOS 0.30.0 — Master Deficiency Control

This release freezes feature expansion long enough to make the full deficiency scope explicit and enforceable.

## Added

- Authoritative machine-readable deficiency register: `docs/MASTER-DEFICIENCY-REGISTER.json`.
- Human-readable full register: `docs/MASTER-DEFICIENCY-REGISTER.md`.
- 92 stable deficiency IDs spanning Platform, Operations, Crew, Maintenance, Engineering, Airworthiness, Technical Records, Supply Chain, Safety, Quality, Commercial/Finance and cross-domain UX.
- Explicit `MISSING`, `PARTIAL`, `COMPLETE`, and `EXTERNAL` status semantics.
- Acceptance criteria for every registered deficiency.
- Release validation that prevents the register from silently shrinking or being renumbered and prevents `COMPLETE` without repository evidence.
- ADR 0043 defining the scope-control policy.

## Baseline status

- MISSING: 45
- PARTIAL: 42
- COMPLETE: 1
- EXTERNAL: 4

The deliberately conservative baseline corrects earlier overstatement of closure. The authentic `pnpm-lock.yaml` remains missing, so deterministic dependency resolution remains `D001 MISSING` and production promotion remains blocked.
