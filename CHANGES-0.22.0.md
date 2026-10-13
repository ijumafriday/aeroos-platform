# AeroOS 0.22.0 — Technical Records & Supply Depth

## Technical Records
- Adds a dedicated `records` domain/schema and least-privilege `records_svc` database role.
- Adds tenant-RLS protected record binders for aircraft, engines, APUs, components, work packages and leases.
- Adds explicit record requirements, immutable document-evidence links, completeness calculation and completion gates.
- Adds auditable redelivery, lease-transition, authority and archive package manifests.
- Reuses the shared object/document store for bytes and hashes while keeping records ownership in the Technical Records domain.
- Adds a compact Technical Records navigation domain with a single object-centric Record Binders workspace.

## Supply Chain
- Adds repair orders with controlled OPEN → SENT → AT_VENDOR/RETURNED → CLOSED state transitions and mandatory outbound/release-certificate references.
- Adds inter-station stock transfers with OPEN → IN_TRANSIT → RECEIVED lifecycle and atomic stock movement through a traceable transit location.
- Keeps these capabilities inside the existing Procurement & Logistics page rather than creating workflow navigation entries.
- Adds tenant RLS and audit events for repair orders and transfers.

## Architecture
- Migration sequence advances to `0034`.
- Technical Records is a first-class domain; shared document storage remains a Platform primitive.
