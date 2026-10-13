# AeroOS 0.38.0 — Supply Chain domain completion

This release applies the domain-depth completion method to Supply Chain while preserving AeroOS's object/domain navigation philosophy.

## Supply completion

- Inventory cycle and physical counts with snapshotted expected quantities, discrepancy reasons, stale-count protection and reconciled lot/aggregate stock.
- Lot-specific pick reservations, packing, shipment custody, tracking and receipt acknowledgement.
- Min/max/reorder policies, explainable forecasts, derived AeroOS demand signals and governed replenishment requisitions.
- Consignment agreements bound to actual stock lots.
- Supplier receipt-quality events, performance scorecards, approved-source decisions, controlled supersession and governed price agreements.
- Warranty entitlement and commercial recovery reconciliation.
- AOG courier/AWB/ETA/cost tracking linked to the authoritative Maintenance AOG case.
- Compact Supply workspace: Procurement, Inventory Control, Logistics & AOG, Planning & Sources, Warranty & Contracts.

## Assurance

- `docs/SUPPLY-DEPTH-REGISTER.json` defines 57 implemented Supply software capabilities.
- `scripts/verify-supply-depth.py` is part of the production release gate.
- Migration `0045_supply_completion.sql` adds tenant-RLS protected Supply control records.
- The master deficiency register remains conservative: implemented Supply deficiencies move to PARTIAL until runtime/operator acceptance evidence exists.

The existing D001 dependency-lock production gate remains unresolved and unchanged.
