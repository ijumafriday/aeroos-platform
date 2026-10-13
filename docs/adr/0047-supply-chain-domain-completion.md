# ADR 0047 — Supply Chain domain completion

**Status:** Accepted  
**Release:** AeroOS 0.38.0

## Decision

Supply Chain owns procurement, material custody, warehouse execution, fulfillment, replenishment, approved-source selection, warranty recovery and logistics custody. Maintenance owns technical work and the technical AOG case; Quality owns supplier approval/surveillance; Commercial/Finance owns accounting. Supply references those authoritative objects rather than duplicating them.

The UI remains one Supply domain with three durable rail entries. Procurement & Logistics is internally grouped into five workspaces: Procurement, Inventory Control, Logistics & AOG, Planning & Sources, and Warranty & Contracts. Individual process steps do not become navigation items.

## Completion evidence

`docs/SUPPLY-DEPTH-REGISTER.json` defines the software-depth scope and `scripts/verify-supply-depth.py` enforces it during release validation. Master deficiency items remain PARTIAL until their separate runtime or operator-acceptance criteria are satisfied.
