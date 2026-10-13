# ADR 0048 — Technical Records domain completion

Status: Accepted

Technical Records is a durable AeroOS business domain, not a generic attachment browser. Immutable bytes remain owned by the Platform document store; Records owns classification, provenance, custody, completeness, historical ingestion, lease/redelivery requirements, back-to-birth trace verification, retention/legal hold decisions and delivery reconciliation.

The domain exposes four contextual workspaces inside the existing Technical Records navigation entry: Record Binders, Historical Intake, Lease & Redelivery, and Retention & Holds. These are not promoted to top-level navigation.

OCR is never simulated. Provider results must include provider/job/model provenance and a SHA-256 of extracted text, and extracted metadata cannot become accepted technical-record metadata until an authorized human review accepts it. A manual classification path remains available and is explicitly identified as human review.

Legal holds block disposition. Hold release, disposition approval, component-trace verification and package acknowledgement require independent authorized action where the action represents acceptance or release of custody/retention controls.
