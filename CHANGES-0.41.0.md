# AeroOS 0.41.0 — Safety Domain Completion

This release continues the domain-depth programme without changing the roadmap. Safety was selected as the next shallow major operational domain because D049, D051 and D052 were all still MISSING in 0.40.0.

## Safety assurance and response

- Added tenant-isolated hazard register and bow-tie control persistence with preventive/recovery control classification, control assurance, degraded-state handling and residual-risk acceptance gates.
- Added governed SPI/SPT definitions with direction-aware target/warning/breach thresholds, measurement frequency, hazard linkage, period-bounded samples and SHA-256 provenance.
- Added a formal Management of Change lifecycle covering scope, affected domains, structured risk assessment, phased actions, creator/approver separation, independent action verification, implementation, monitoring and evidence-gated closure.
- Added emergency-response scenarios with activation criteria, commander/communications/contact controls, independent approval, live activation/event logging, stand-down, debrief and lessons-learned closure.
- Added one compact **Safety Assurance & Response** workspace with Risk & Bow-tie, SPI / SPT, Management of Change, and Emergency Response tabs. Existing occurrence reporting and Safety Actions remain unchanged.
- Added Cerbos policy for Safety control read/manage/approve actions and RLS/FORCE RLS on all new Safety tables.
- Added `SAFETY-DEPTH-REGISTER` and release-gate verification with 96 measurable implemented capabilities.

## Master deficiency register

D049, D051 and D052 move from **MISSING** to **PARTIAL**. They are not marked complete because production operator datasets, drills, authority contacts, trend history and retained real-world acceptance evidence remain external/operational obligations.

## Known release blocker

The existing P0 deterministic-build deficiency remains: an authentic `pnpm-lock.yaml` is still absent. This release does not claim that blocker is resolved.
