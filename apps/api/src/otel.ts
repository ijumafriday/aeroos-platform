/**
 * OpenTelemetry bootstrap — imported first by main.ts so auto-instrumentation can patch http,
 * pg, kafkajs and fastify before they load. Off unless OTEL_ENABLED=true. Exports OTLP/HTTP to
 * any collector (the compose "observability" profile, or the cluster's collector), so there is no
 * dependency on a particular vendor (ADR-0003).
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

if (process.env.OTEL_ENABLED === 'true') {
  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318').replace(/\/$/, '');
  const sdk = new NodeSDK({
    resource: new Resource({ [ATTR_SERVICE_NAME]: 'aeroos-api', [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.23.0' }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }), exportIntervalMillis: 15_000 }),
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })]
  });
  sdk.start();
  process.once('SIGTERM', () => void sdk.shutdown());
}
