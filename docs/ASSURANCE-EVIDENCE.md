# AeroOS assurance evidence

AeroOS distinguishes **test tooling** from **retained proof**. D080 and D089-D092 cannot be closed by scripts alone.

Runtime assurance evidence uses `aeroos.assurance.evidence/v1`. `scripts/assurance/evidence.py` runs a command and records the exact command, exit status, duration, target, environment, source release-manifest hash and CI identity. It never emits PASS for a non-zero command.

In CI, evidence JSON is validated, bundled, SHA-256 hashed, signed keylessly with Sigstore/cosign and uploaded together with its signature bundle. The signed artifact is the retained evidence. Production acceptance must retain the artifact according to the operator's quality/records policy.

Required evidence classes:

- `D080`: scheduled restore/failover exercise with measured recovery and remediation reference when failed.
- `D089`: qualified major-airline dataset plus benchmark percentiles/throughput and environment specification.
- `D090`: 24-72h soak result with SLO and resource-leak checks.
- `D091`: dependency-loss/chaos run showing liveness/readiness and recovery behavior.
- `D092`: measured backup/restore/failover RPO and RTO against declared targets.

A failed run is still retained evidence; it must not be rewritten or deleted to improve the record. Remediation is linked through a later run.
