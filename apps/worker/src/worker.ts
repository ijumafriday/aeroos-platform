// Telemetry first, so auto-instrumentation patches http/undici before anything else loads them.
import { startTelemetry } from './otel';
const telemetry = startTelemetry();

import { makeWorkflowExporter, OpenTelemetryActivityInboundInterceptor } from '@temporalio/interceptors-opentelemetry/lib/worker';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';

const ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';

async function connect(): Promise<NativeConnection> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await NativeConnection.connect({ address: ADDRESS });
    } catch (e) {
      if (attempt >= 60) throw e;
      console.log(`[worker] Temporal not ready at ${ADDRESS} (${(e as Error).message}); retrying`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function main() {
  const connection = await connect();
  // One worker per task queue: "camo" for deferral timers, "platform" for recurring sweeps and anchoring.
  // Separate queues let each be scaled and rate-limited independently.
  const workers = await Promise.all(['camo', 'platform'].map(taskQueue => Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
    sinks: { exporter: makeWorkflowExporter(telemetry.exporter, telemetry.resource) },
    interceptors: {
      workflowModules: [require.resolve('./workflows')],
      activityInbound: [ctx => new OpenTelemetryActivityInboundInterceptor(ctx)]
    }
  })));
  process.once('SIGTERM', () => {
    workers.forEach(w => w.shutdown());
    void telemetry.shutdown();
  });
  console.log(`[worker] polling task queues "camo", "platform" on ${ADDRESS}/${NAMESPACE}${telemetry.enabled ? ' (tracing on)' : ''}`);
  await Promise.all(workers.map(w => w.run()));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
