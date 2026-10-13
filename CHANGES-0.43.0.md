# AeroOS 0.43.0 — Engineering Domain Completion

This release continues the domain-depth programme without resetting the roadmap. Engineering was selected after Crew because configuration/effectivity, software/cabin configuration, engineering-order lifecycle, service-bulletin campaigns and structural-damage visualization remained materially shallower than the completed operational domains.

## Engineering control and configuration

- Added controlled software, cabin-layout, equipment and modification-package configuration items with revision/effectivity, optional SHA-256 content identity, independent approval and supersession-ready state.
- Added governed part interchangeability with one-way/two-way direction, conditions, modification prerequisites, effectivity and independent approval.
- Added Engineering Order authoring, review, independent approval, release, tail-specific embodiment planning, accomplishment evidence, independent conformity verification and evidence-gated closure.
- Added Service Bulletin technical and commercial disposition, classification, compliance basis, kit references, controlled fleet applicability/campaign states and tail-level embodiment tracking.
- Added spatial structural-damage records using normalized aircraft-map coordinates with ATA/zone/surface, SRM and inspection references, dimensions, repair/monitoring disposition, photographic evidence references and controlled closure.
- Added one compact **Engineering Control & Configuration** workspace with Configuration & Interchangeability, Engineering Orders, SB Campaigns and Structural Damage Map tabs. Existing Aircraft Configuration, AD/SB/EO, Components, and Engine Health screens remain intact.
- Added Cerbos authorization plus FORCE RLS across all Engineering completion tables.
- Added `ENGINEERING-DEPTH-REGISTER` with 136 measurable implemented software capabilities.

## Master deficiency register

D058 moves from **MISSING** to **PARTIAL**. D009, D055, D056 and D057 remain **PARTIAL** with materially stronger software evidence. None are marked COMPLETE because approved OEM/operator datasets, real fleet effectivity/interchangeability decisions, production embodiment campaigns, licensed structural references and operational acceptance evidence remain outside this source package.

## Known release blocker

The existing P0 deterministic-build deficiency remains: an authentic `pnpm-lock.yaml` is still absent. This release does not claim that blocker is resolved.
