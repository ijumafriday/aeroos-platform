import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CONFIG, type Config } from '../../config';
import type { Principal } from '../auth/principal';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { Metrics } from '../observability/metrics';
import { normalizeRateLimitRoute, rateLimitIdentity } from './rate-limit';

/**
 * Distributed fixed-window limiter. Counters live in PostgreSQL so a caller cannot evade the
 * limit by landing on a different API replica. Buckets deliberately hash identities/IPs before
 * storage; the table is operational state, not an identity log.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private cleanupAt = 0;
  constructor(@Inject(CONFIG) private readonly config: Config, @Inject(DB_TOKEN.platform) private readonly db: ModuleDb) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http' || !this.config.RATE_LIMIT_ENABLED) return true;
    const req = ctx.switchToHttp().getRequest<{
      method: string;
      url: string;
      ip?: string;
      headers: Record<string, string | string[] | undefined>;
      principal?: Principal;
    }>();
    // Probes must remain available to the orchestrator even during an abusive client burst.
    if (req.url === '/api/health/live' || req.url === '/api/health/ready') return true;

    const principal = req.principal;
    const rawIdentity = principal ? `u:${principal.subject}:${principal.operatorId}` : `ip:${req.ip ?? 'unknown'}`;
    const identity = rateLimitIdentity(rawIdentity);
    const route = normalizeRateLimitRoute(req.url);
    const bucket = `${identity}:${req.method}:${route}`;
    const seconds = this.config.RATE_LIMIT_WINDOW_SECONDS;
    const limit = principal ? this.config.RATE_LIMIT_AUTHENTICATED : this.config.RATE_LIMIT_ANONYMOUS;

    const r = await this.db.db.execute<{ count: number; retry_after: number }>(sql`
      with w as (
        select to_timestamp(floor(extract(epoch from now()) / ${seconds}) * ${seconds}) as start_at
      ), up as (
        insert into platform.rate_limit_windows(bucket, window_start, count)
        select ${bucket}, start_at, 1 from w
        on conflict (bucket, window_start) do update set count = platform.rate_limit_windows.count + 1
        returning count, window_start
      )
      select count, greatest(1, ceil(extract(epoch from (window_start + (${seconds} || ' seconds')::interval - now()))))::int as retry_after
      from up
    `);
    const row = r.rows[0];
    if (row && Number(row.count) > limit) {
      Metrics.rateLimitRejected.add(1, { authenticated: String(Boolean(principal)), method: req.method });
      throw new HttpException(`Rate limit exceeded; retry in ${row.retry_after} seconds`, 429);
    }

    // Opportunistic bounded cleanup; no timer and no cross-replica coordination required.
    const now = Date.now();
    if (now > this.cleanupAt) {
      this.cleanupAt = now + 5 * 60_000;
      void this.db.db.execute(sql`delete from platform.rate_limit_windows where window_start < now() - interval '1 day'`).catch(() => undefined);
    }
    return true;
  }
}
