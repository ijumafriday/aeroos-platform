# Static integration checks

`pnpm check` reads the source with the TypeScript compiler API — no build, no running stack — and cross-checks
the places where separately written parts must agree:

| Check | Catches |
|---|---|
| `contracts` | a web, worker or optimiser call to an API path/method that no controller serves; two handlers on one route |
| `authz` | a Cerbos resource kind or action the API checks that no policy grants (would deny everyone); unknown roles |
| `events` | event types declared but never produced; a module reacting to an event without subscribing to its topic |
| `schema` | a Drizzle table or column that no migration creates (ORM ↔ SQL drift) |
| `matrix` | a compliance-matrix reference (test, rulepack decision, policy, screen, audit action) that does not exist |
| `security` | a route open without its own guard; a request body without a validation pipe |

They run in CI before the build. They are deliberately conservative: a pattern they cannot resolve statically
fails the check rather than passing silently.
