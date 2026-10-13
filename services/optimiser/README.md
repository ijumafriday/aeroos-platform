# AeroOS recovery optimiser

Python service, Temporal task queue `optimiser`. Workflow `RecoveryWorkflow(problem)` → activity
`solve_recovery` (OR-Tools CP-SAT, greedy fallback and warm start) → activity `report_result`
(POST `/api/internal/ops/recovery/:id/result`). No database access; the API re-checks every plan.

```bash
python -m unittest discover -s tests -t .      # model, checker, greedy (+ CP-SAT when OR-Tools is installed)
python -m aeroos_optimiser.worker              # needs TEMPORAL_ADDRESS, API_URL, OIDC_TOKEN_URL, SERVICE_CLIENT_ID, SERVICE_CLIENT_SECRET
```

The problem/solution JSON contract is `RecoveryProblem` / `RecoverySolution` in `packages/contracts`.
`tests/fixtures/demo_rkg_aog.json` is generated from the TypeScript demo schedule, so both checkers are
tested against the same data.
