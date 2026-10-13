# AeroOS 0.34.0 — P0 supply-chain verification and security exception governance

This release stays within the P0 master-deficiency plan.

- D002 remains PARTIAL, but production release CI now retains a consolidated evidence set binding the deterministic source archive, source SHA-256 and Sigstore bundle to all four immutable production image digests and successful signature-verification output. A verifier can independently validate the retained bundle.
- D004 remains PARTIAL. Security exception governance is now explicit and narrow: CodeQL/SAST and secret-detection findings are non-waivable.
- D087 remains PARTIAL. Trivy and license exceptions must identify an exact finding, narrow scope, tracking ticket, security approver and expiry of at most 90 days. CI materializes the exact ignore inputs from the governed register.
- No P1/P2 capability work is included.
- D001 remains MISSING and continues to block production promotion until an authentic `pnpm-lock.yaml` exists.
