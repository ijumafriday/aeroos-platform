import { metrics } from '@opentelemetry/api';

/**
 * AeroOS business and platform metrics (OpenTelemetry API; no-ops unless OTEL_ENABLED=true starts the
 * SDK in otel.ts). Exported via OTLP → collector → Prometheus, where counters gain a `_total` suffix.
 * Dashboards: infra/observability/grafana/dashboards/json.
 */
const meter = metrics.getMeter('aeroos');

export const Metrics = {
  /** HTTP request volume and latency for SLO/error-budget alerting. */
  apiRequests: meter.createCounter('aeroos_api_requests', { description: 'API HTTP requests by method and status' }),
  apiLatencyMs: meter.createHistogram('aeroos_api_latency_ms', { description: 'API HTTP response latency in milliseconds', unit: 'ms' }),
  rateLimitRejected: meter.createCounter('aeroos_rate_limit_rejected', { description: 'Requests rejected by the distributed rate limiter' }),
  /** Events relayed from the outbox to Kafka, by topic. */
  eventsPublished: meter.createCounter('aeroos_events_published', { description: 'Domain events published to Kafka' }),
  webhookDeliveries: meter.createCounter('aeroos_webhook_deliveries', { description: 'Outbound webhook delivery outcomes' }),
  /** Database pool pressure by module; waiting connections should normally remain zero. */
  dbPoolTotal: meter.createObservableGauge('aeroos_db_pool_total', { description: 'PostgreSQL pool connections by module' }),
  dbPoolIdle: meter.createObservableGauge('aeroos_db_pool_idle', { description: 'Idle PostgreSQL pool connections by module' }),
  dbPoolWaiting: meter.createObservableGauge('aeroos_db_pool_waiting', { description: 'Requests waiting for a PostgreSQL pool connection by module' }),
  /** MVT / ACARS / OCC movement messages by source and outcome (APPLIED, IGNORED, REJECTED). */
  movementMessages: meter.createCounter('aeroos_movement_messages', { description: 'Movement messages received' }),
  /** Optimiser runs by kind (flight, crew) and status reached. */
  recoveryRuns: meter.createCounter('aeroos_recovery_runs', { description: 'Recovery optimiser runs by outcome' }),
  /** Pending uploads removed by the cleanup sweep. */
  uploadsExpired: meter.createCounter('aeroos_uploads_expired', { description: 'Abandoned document uploads cleaned up' }),
  meter
};
