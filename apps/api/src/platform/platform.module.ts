import { Global, Module, OnApplicationShutdown, Inject, type Provider } from '@nestjs/common';
import { Pool } from 'pg';
import { CONFIG, loadConfig, type Config } from '../config';
import { TokenVerifier } from './auth/token-verifier';
import { InternalGuard } from './auth/guards';
import { RateLimitGuard } from './http/rate-limit.guard';
import { AuthzService } from './authz/authz.service';
import { AuditQuery, AuditService } from './audit/audit.service';
import { DB_TOKEN, MODULE_ROLE, ModuleDb, type ModuleName } from './database/module-db';
import { KafkaService } from './events/kafka.service';
import { InboxService, OutboxRelay, OutboxService } from './events/outbox';
import { keyServiceProvider, KEY_SERVICE } from './keys/keys.provider';
import { LiveGateway } from './live/live.gateway';
import { NotificationsService } from './notifications/notifications.service';
import { AuditController, HealthController, NotificationsController, PlatformInternalController } from './platform.controllers';
import { AnchorService } from './audit/anchor.service';
import { DocumentsController } from './storage/documents.controller';
import { DocumentsService } from './storage/documents.service';
import { PasskeyController, PasskeyService } from './passkeys/passkeys.service';
import { ObjectStore } from './storage/object-store';
import { SearchController, SearchRegistry, UserViewsController } from './search/search.registry';
import { RecurringWorkflows, TemporalService } from './workflows/temporal.service';
import { WebhookService } from './integrations/webhooks.service';
import { IntegrationsController } from './integrations/integrations.controller';
import { ContractsController } from './integrations/contracts.controller';
import { MigrationController, MigrationRegistry, MigrationService } from './migrations/migration.service';
import { RuleController, RuleService } from './rules/rules.service';
import { AnalyticsController, AnalyticsService } from './analytics/analytics.service';
import { IntegrationControlController, IntegrationControlService } from './integrations/integration-control.service';
import { ApiLifecycleInterceptor } from './integrations/api-lifecycle.interceptor';

const MODULES: ModuleName[] = ['platform', 'compliance', 'org', 'camo', 'engineering', 'records', 'amo', 'ops'];

const dbProviders: Provider[] = MODULES.map(m => ({
  provide: DB_TOKEN[m],
  inject: [CONFIG],
  useFactory: (c: Config) => new ModuleDb(m, new Pool({
    host: c.DB_HOST,
    port: c.DB_PORT,
    database: c.DB_NAME,
    user: MODULE_ROLE[m],
    password: c.dbPassword(MODULE_ROLE[m]),
    max: c.DB_POOL_SIZE,
    application_name: `aeroos-api:${m}`
  }))
}));

/** Cross-cutting platform services shared by every domain module. */
@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    ...dbProviders,
    keyServiceProvider,
    TokenVerifier,
    InternalGuard,
    RateLimitGuard,
    AuthzService,
    AuditService,
    AuditQuery,
    KafkaService,
    OutboxService,
    OutboxRelay,
    InboxService,
    NotificationsService,
    TemporalService,
    LiveGateway,
    ObjectStore,
    DocumentsService,
    AnchorService,
    PasskeyService,
    RecurringWorkflows,
    SearchRegistry,
    WebhookService,
    MigrationRegistry, MigrationService, RuleService, AnalyticsService, IntegrationControlService, ApiLifecycleInterceptor
  ],
  controllers: [HealthController, AuditController, NotificationsController, PlatformInternalController, DocumentsController, SearchController, UserViewsController, PasskeyController, IntegrationsController, ContractsController, MigrationController, RuleController, AnalyticsController, IntegrationControlController],
  exports: [
    CONFIG, ...MODULES.map(m => DB_TOKEN[m]), KEY_SERVICE, TokenVerifier, InternalGuard, AuthzService, AuditService, AuditQuery,
    KafkaService, OutboxService, InboxService, NotificationsService, TemporalService, ObjectStore, DocumentsService, SearchRegistry, AnchorService, PasskeyService, WebhookService, MigrationRegistry, MigrationService, RuleService, AnalyticsService, IntegrationControlService, ApiLifecycleInterceptor
  ]
})
export class PlatformModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_TOKEN.platform) private readonly p: ModuleDb,
    @Inject(DB_TOKEN.compliance) private readonly c: ModuleDb,
    @Inject(DB_TOKEN.org) private readonly o: ModuleDb,
    @Inject(DB_TOKEN.camo) private readonly cm: ModuleDb,
    @Inject(DB_TOKEN.engineering) private readonly e: ModuleDb,
    @Inject(DB_TOKEN.records) private readonly r: ModuleDb,
    @Inject(DB_TOKEN.amo) private readonly a: ModuleDb,
    @Inject(DB_TOKEN.ops) private readonly op: ModuleDb
  ) {}

  async onApplicationShutdown() {
    await Promise.allSettled([this.p, this.c, this.o, this.cm, this.e, this.r, this.a, this.op].map(d => d.end()));
  }
}
