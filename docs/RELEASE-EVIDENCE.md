# Release evidence

A production AeroOS release is not represented only by a version string. CI retains a deterministic source archive, SHA-256, Sigstore source signature bundle, four immutable production image digests, and successful signature-verification output for each image. The final `release-evidence.json` binds these artifacts to one platform version.

`scripts/release/verify-release-evidence.py <evidence-directory>` verifies the retained bundle structurally and cryptographically checks hashes. With `--cosign`, it also verifies the source Sigstore bundle and image signatures against the registry.

This evidence is required for D002 completion; workflow configuration alone is not considered production proof.
