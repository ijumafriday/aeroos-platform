/**
 * OpenTelemetry for the Temporal worker. With OTEL_ENABLED=true:
 *  - activities get spans (OpenTelemetryActivityInboundInterceptor) and their HTTP calls to the API carry
 *    the trace context, so a sweep shows up as one trace across worker and API;
 *  - workflow code, which runs in Temporal's deterministic sandbox, records spans through a sink
 *    (makeWorkflowExporter) that the worker exports outside the sandbox;
 *  - the trace started by the API when it starts a workflow continues here (context travels in headers).
 * Off by default: a no-op exporter is still registered so the workflow interceptors always have a sink.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const noopExporter: SpanExporter = {
  export: (_spans: ReadableSpan[], done: (r: { code: number }) => void) => done({ code: 0 }),
  shutdown: () => Promise.resolve()
};

export function startTelemetry(): { enabled: boolean; exporter: SpanExporter; resource: Resource; shutdown(): Promise<void> } {
  const resource = new Resource({ [ATTR_SERVICE_NAME]: 'aeroos-worker', [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.23.0' });
  if (process.env.OTEL_ENABLED !== 'true') return { enabled: false, exporter: noopExporter, resource, shutdown: () => Promise.resolve() };
  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318').replace(/\/$/, '');
  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });
  const sdk = new NodeSDK({
    resource,
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })]
  });
  sdk.start();
  return { enabled: true, exporter, resource, shutdown: () => sdk.shutdown() };
}
