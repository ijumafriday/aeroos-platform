# ADR-0014 — End-to-end traces through Temporal, and dashboards as code

**Status:** accepted · **Date:** 2026-10

## Decision
- **Traces cross the workflow boundary.** The API's Temporal client uses `OpenTelemetryWorkflowClientInterceptor`; the TypeScript worker
  uses the activity/workflow interceptors (workflow spans leave the deterministic sandbox through a sink); the Python worker uses
  `temporalio.contrib.opentelemetry.TracingInterceptor` and adds `traceparent` to its report back to the API. One optimiser run is one
  trace: API request → workflow → solver → API result. All export OTLP/HTTP to any collector (ADR-0003). Off unless `OTEL_ENABLED=true`.
- **Business metrics** (OpenTelemetry API): `aeroos_outbox_backlog`, `aeroos_outbox_oldest_age_seconds`, `aeroos_events_published`,
  `aeroos_movement_messages{source,status}`, `aeroos_recovery_runs{kind,status}`, `aeroos_uploads_expired`.
- **Dashboards as code:** `infra/observability/grafana/dashboards/json/*.json`, provisioned read-only into the "AeroOS" folder
  (Platform health; Operations with a Tempo trace table). Changes go through review like any other code.
- **Upload hygiene:** an hourly workflow handles uploads still PENDING an hour after their 15-minute ticket: stored (hashed, audited) if the
  file arrived but the confirmation was lost, otherwise marked EXPIRED. Both outcomes are on the `documents` audit chain.

## Consequences
- HTTP metric names differ between OpenTelemetry semantic-convention versions; the dashboards match both spellings.
