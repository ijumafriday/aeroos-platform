# ADR 0043 — Master deficiency register and scope-control gate

Status: Accepted — AeroOS 0.30.0

## Context

AeroOS accumulated substantial capability between 0.17 and 0.29, but release-by-release closure language became broader than the evidence justified. Several important airline/MRO capabilities were omitted from the compact priority table, while other areas were marked "substantially complete" even though material production depth or external assurance remained outstanding.

This creates two risks: scope loss and false closure.

## Decision

AeroOS maintains `docs/MASTER-DEFICIENCY-REGISTER.json` as the machine-readable authoritative product-gap register and `docs/MASTER-DEFICIENCY-REGISTER.md` as the human-readable view.

Every deficiency has a stable ID, priority, owning domain, status and explicit acceptance criterion. Allowed statuses are:

- `MISSING`: no production-complete capability exists.
- `PARTIAL`: capability exists but acceptance is not fully met.
- `COMPLETE`: acceptance is met and repository/runtime evidence exists.
- `EXTERNAL`: closure depends on operator, authority, assessor, vendor or external-system evidence; AeroOS must still define the boundary.

IDs are append-only. Existing items may not be deleted or renumbered to improve apparent completion. `COMPLETE` requires evidence paths that exist. Release validation runs `scripts/verify-deficiency-register.py`.

The register is deliberately conservative. Code presence alone is not sufficient for `COMPLETE`; runtime proof, operational depth and required external acceptance remain part of the acceptance criterion.

## Navigation and domain rule

The register is a Platform governance artifact only. It must not create a user-facing business domain, workflow menu, or navigation hierarchy. Deficiency implementation remains owned by the domain named in the register.

## Consequences

Future releases must state exactly which deficiency IDs they change and why. Unrelated scope may not be silently declared closed. New discoveries are appended with new IDs rather than folded into vague existing items.
