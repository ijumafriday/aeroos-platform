# AeroOS 0.33.0 — P0 retained-assurance evidence

P0-only release. No P1/P2 business capability is added.

- Adds canonical assurance evidence records that cannot report PASS for failed commands.
- Adds scheduled/manual GitHub Actions evidence runs for benchmark, soak, dependency-failure and DR profiles.
- Signs retained evidence keylessly with Sigstore/cosign and uploads it as a CI artifact.
- Adds an operational secret-rotation verification drill; the script does not rotate secrets itself, so it proves the configured secret controller actually propagated the change.
- Advances D004, D006 and D080 controls without falsely closing them.
- D089-D092 remain MISSING until real retained passing evidence exists.
- D001 remains MISSING and blocks dependency-backed evidence CI until an authentic pnpm-lock.yaml exists.
