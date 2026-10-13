import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthGuard } from './platform/auth/guards';
import { RateLimitGuard } from './platform/http/rate-limit.guard';
import { ErrorFilter, IdempotencyInterceptor } from './platform/http/http';
import { PlatformModule } from './platform/platform.module';
import { TenantContextInterceptor } from './platform/database/tenant-context.interceptor';
import { ApiLifecycleInterceptor } from './platform/integrations/api-lifecycle.interceptor';
import { AmoModule } from './modules/amo/amo.module';
import { CamoModule } from './modules/camo/camo.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { DevModule } from './modules/dev/dev-seed';
import { OrgModule } from './modules/org/org.module';
import { OpsModule } from './modules/ops/ops.module';
import { ExecModule } from './modules/exec/exec.module';
import { EngineeringModule } from './modules/engineering/engineering.module';
import { RecordsModule } from './modules/records/records.module';

/**
 * Modular monolith. Each domain module owns a PostgreSQL schema and role; modules call each other
 * only through exported query services (synchronous reads) or events (state changes).
 */
@Module({
  imports: [PlatformModule, ComplianceModule, OrgModule, CamoModule, EngineeringModule, RecordsModule, AmoModule, OpsModule, ExecModule, DevModule],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ApiLifecycleInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter }
  ]
})
export class AppModule {}
