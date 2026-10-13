# ADR-0032 — Engineering configuration ownership and maintenance planning depth

## Decision

Aircraft allowable and actual configuration is owned by a distinct **Engineering** domain. It is not stored as generic CAMO workflow state. Engineering owns revisioned baselines, position hierarchy, effectivity, allowable parts/modification state, approval/effectiveness and installed-configuration history. Actual installations retain a stable position code so physical aircraft history remains addressable across baseline revisions.

Continuing Airworthiness may consume configuration state for applicability and compliance decisions but does not duplicate the configuration source of truth.

Maintenance owns hangar resources, work-package planning, labour readiness, task dependencies and scope freeze. Planning is performed against the CAMO work-package object because the package originates from approved maintenance requirements; release creates Part-145 task cards. Dependency constraints are copied into those task cards and are enforced during execution, so release does not discard the approved production sequence.

Cross-domain orchestration remains an implementation mechanism, not a navigation structure. Engineering and Maintenance remain durable top-level domains; approval, freeze, install, remove, release and certification are contextual actions on their objects rather than top-level workflow destinations.

## Controls

Configuration baselines require independent approval before they can become effective. Actual installation/removal requires traceable evidence references. Engineering tables use tenant RLS and the dedicated `engineering_svc` database role. Configuration changes use the engineering audit chain.

Work packages cannot be released until they have a configured collision-free hangar slot, planned labour meeting derived demand, a valid acyclic dependency graph and a frozen scope. Reopening the scope requires an audited reason. AMO signing checks predecessor certification.

## Consequences

This design preserves AeroOS's modular-monolith philosophy while adding domain depth. Future capabilities such as interchangeability, assembly configuration, engineering orders and maintenance-resource optimization extend these domain objects rather than creating additional workflow menus.
