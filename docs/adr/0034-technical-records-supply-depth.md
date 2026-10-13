# ADR-0034: Technical Records ownership and supply logistics depth

## Decision
Technical Records is a first-class AeroOS domain. It owns record-set completeness, evidence requirements, retention and delivery manifests. It does not own file storage: immutable bytes, hashes and download controls remain in Platform Documents. A Records evidence row references a stored Platform document and records the authoritative source/log reference.

Supply Chain owns repair-order and stock-transfer lifecycles. Maintenance may create demand for material but does not own supplier repair or inter-station logistics state.

## Navigation
Technical Records has one object-centric entry point, **Record Binders**. Supply repair/transfer functions are tabs within the existing **Procurement & Logistics** surface. Lifecycle transitions remain actions on their objects and do not become navigation entries.

## Completeness rules
A binder cannot be marked COMPLETE and a delivery package cannot be generated while any mandatory requirement lacks accepted evidence. Evidence can only link to a stored document accessible to the same operator. Every lifecycle change is audit recorded.
