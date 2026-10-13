# AeroOS 0.46.0 — Continuing Airworthiness domain completion

This release deepens Continuing Airworthiness without resetting the existing roadmap or absorbing Engineering/Maintenance responsibilities into CAMO.

## Reliability programme governance
- Adds revisioned reliability programmes with aircraft/ATA scope, methodology, review frequency and independent approval before activation.
- Adds governed fleet/type/tail/engine/component/system metrics with explicit numerator/denominator definitions, exposure units, normalisation, minimum exposure and direction-aware warning/alert thresholds.
- Adds traceable measurements with source identity and SHA-256 provenance, independent approval and automatic alert creation after approved threshold excursions.
- Adds alert investigation, root-cause/action traceability and evidence-backed independent closure.

## Condition monitoring
- Adds governed ACMS/QAR/FDR/engine-trend/HUMS/manual/lab/OEM sources with approved parameter sets, unit maps and calibration provenance where required.
- Adds independently approved condition thresholds and source-bound readings with quality state and SHA-256 provenance.
- Adds condition alerts with maintenance/engineering disposition, action/evidence references and independent closure.

## Reliability review
- Adds periodic reliability reviews tied to an active programme, open-alert counts, repeat-alert indicators, programme-change decisions, action references and hashed review evidence.
- Programme-change decisions cannot be recorded without traceable actions; review approval is independent.

## Register treatment
- D053 remains PARTIAL with stronger software evidence.
- D054 remains PARTIAL with stronger software evidence.
- Neither is marked COMPLETE because approved operator thresholds, live/certified data feeds, validated OEM/predictive models and retained production effectiveness evidence remain external acceptance items.

## Release status
All software-domain depth checks pass. Production promotion remains blocked by the pre-existing P0 requirement for an authentic `pnpm-lock.yaml`; this release does not fabricate one.
