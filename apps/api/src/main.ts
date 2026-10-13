import './otel'; // must be first: instruments libraries before they load
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { runMigrations } from './platform/database/migrate';
import { Metrics } from './platform/observability/metrics';

async function bootstrap() {
  const config = loadConfig();
  const log = new Logger('Bootstrap');

  // Schema first: the app never starts against a database it does not understand.
  await runMigrations(config, m => log.log(m));

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 256 * 1024 })
  );
  app.setGlobalPrefix('api');
  const started = new WeakMap<object, bigint>();
  app.getHttpAdapter().getInstance().addHook('onRequest', async (req: object) => { started.set(req, process.hrtime.bigint()); });
  app.getHttpAdapter().getInstance().addHook('onResponse', async (req: { method: string; routeOptions?: { url?: string } }, reply: { statusCode: number }) => {
    const begin = started.get(req as object);
    const durationMs = begin ? Number(process.hrtime.bigint() - begin) / 1_000_000 : 0;
    const attrs = { method: req.method, route: req.routeOptions?.url ?? 'unmatched', status: String(reply.statusCode) };
    Metrics.apiRequests.add(1, attrs);
    Metrics.apiLatencyMs.record(durationMs, attrs);
  });
  // Security headers on every API response, whichever way it is reached (compose: through the web nginx, which
  // replaces them with its own set; Kubernetes: the ingress routes /api straight here).
  app.getHttpAdapter().getInstance().addHook('onSend', async (_req: unknown, reply: { header(k: string, v: string): unknown }, payload: unknown) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    return payload;
  });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
  log.log(`AeroOS API listening on :${config.PORT} (instance ${config.INSTANCE_ID})`);
}

bootstrap().catch(err => {
  console.error(err);
  process.exit(1);
});
