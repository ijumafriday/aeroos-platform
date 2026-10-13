# Security exception governance

AeroOS security gates are blocking by default. CodeQL/SAST and secret-detection findings are non-waivable. A time-limited exception may be used only for an exact Trivy finding or license-policy finding where remediation cannot be completed before a controlled release.

Every exception in `.github/security/exceptions.json` must name the exact finding, a narrow file/image/package scope, reason, tracking ticket, approving security owner, approval date and expiry date. Exceptions expire after at most 90 days and wildcards are rejected. `scripts/security/verify-exceptions.py` validates the register and materializes the exact scanner ignore inputs used by CI.

An exception does not make a finding acceptable permanently. Renewal requires a new review and a new dated record. Production release evidence must retain the exception register hash alongside security scan outputs when any active exception exists.
