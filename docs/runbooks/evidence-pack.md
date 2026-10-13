# Runbook — Evidence pack for an authority inspection

1. Sign in as `quality.manager` or `auditor` for the operator being inspected (AOC switch in the top bar).
2. Quality → Audit Trail → **Evidence pack for the authority**, choose the period (UTC, *to* is exclusive),
   **Export evidence pack**. The export is itself recorded on the `compliance` chain (`evidence.exported`).
3. Before handing it over, check it yourself on any computer with Node.js 18+:
   ```bash
   unzip aeroos-evidence-NKX-2026-09-01_2026-10-01.zip -d pack
   node pack/verify-evidence.mjs pack --fingerprint <fingerprint shown in Quality → Audit Trail>
   ```
   Exit 0 = verified; 3 = consistent but no fingerprint given; 1 = failed.
4. Give the inspector the ZIP and, **through a separate channel** (letter, phone, the authority portal),
   the signing key fingerprint. Without it the pack proves only that it is internally consistent: anyone
   could build and sign a consistent pack with their own key.
5. If the end of the range shows *NOT yet anchored*, either wait for the hourly anchor (or press *Anchor now*)
   and export again, or tell the inspector which part is not yet covered by an anchor.

What the pack does not contain: document *contents* (only names and SHA-256 — provide files on request and
the inspector checks them against the hashes), and other operators' data (only their hash links, without content).
