# ADR-0019 — AD/SB intake, component history, document & manual control

**Status:** accepted · **Date:** 2026-10

## AD / SB intake (CAMO.A.315(b)(4), M.A.301, M.A.303)
- A directive is **received** (reference, revision, types, MSN ranges, effective date, action, compliance time),
  **evaluated** per aircraft, and **incorporated** into the maintenance programme by a second person, where the
  existing due-list engine tracks it like any AD or task (`requirements.kind` gains `SB`).
- **Applicability** is computed from type and MSN range; the engineer may override an aircraft only with a
  reason. A re-evaluation keeps recorded overrides unless they are explicitly removed.
- **Mandatory means mandatory:** an applicable AD cannot be deferred or rejected. Closing an AD as not
  applicable *because aircraft inside its published applicability were overridden* needs a second signature
  (`NOT_APPLICABLE_PENDING` → confirmed by a different person). Incorporation is four-eyes too.
- **Per-aircraft tracking:** the requirement lists the applicable registrations (`requirements.tails`); counting
  starts at the counters on the effective date (`requirement_start`). Before the aircraft's records start in
  this system the counters are back-estimated at a high utilisation, so items fall due early, never late.
- **Supersedure:** incorporating a revision closes the earlier directive (`SUPERSEDED`, whatever its state),
  deactivates its requirement and starts the new one no later than the earlier one's last compliance per
  aircraft — an overdue AD stays overdue under its replacement.
- **Fleet changes:** the hourly sweep evaluates directives against aircraft that joined the fleet later. An
  incorporated directive is tracked on a newly affected aircraft at once and CAMO is alerted; a "not
  applicable" (or pending) decision is reopened.

## Component history (CAMO.A.315, M.A.305(d))
- Every installation and removal of a tracked (life-limited) part is an append-only event with TSN/CSN; the
  life of a serial is reconstructable back to birth. TSN/CSN at removal are computed from aircraft counters.
- An installation is refused if it would **reduce** the life a serial had at its last removal, if the serial
  is still installed elsewhere (also a unique index), if the part has reached its life limit, or if a part
  with no history has no release certificate (EASA Form 1 / 8130-3) reference.

## Document & manual control (CAMO.A.300, 145.A.70, ORO.MLR.100)
- Controlled documents (exposition, manuals, procedures, forms) with an audience of roles.
- Revision: drafted with a summary of changes → approved by a nominated person who is neither its author nor
  the uploader of its file, naming the file's sha256 they reviewed (pinned on the revision) → effective on its
  date (status settles by date, not by a click) → the previous revision superseded.
- Everyone in the audience acknowledges the effective revision; acknowledgements are audited with the file
  hash, and the quality manager sees who has and has not.
- Not yet: blocking certifying staff who have not acknowledged the current exposition (planned with the
  Safety & Quality round).
