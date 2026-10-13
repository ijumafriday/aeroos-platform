import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { currentTenantContext } from './tenant-context';
import { Metrics } from '../observability/metrics';

export type ModuleName = 'platform' | 'compliance' | 'org' | 'camo' | 'engineering' | 'records' | 'amo' | 'ops';

export const MODULE_ROLE: Record<ModuleName, string> = {
  platform: 'platform_svc', compliance: 'compliance_svc', org: 'org_svc', camo: 'camo_svc', engineering: 'engineering_svc', records: 'records_svc', amo: 'amo_svc', ops: 'ops_svc'
};

export type Db = NodePgDatabase;
const context = new AsyncLocalStorage<Map<ModuleName, Db>>();

async function setDbContext(client: Pick<PoolClient, 'query'>) {
  const ctx = currentTenantContext();
  await client.query(`select set_config('aeroos.operator_id', $1, true), set_config('aeroos.system', $2, true)`, [ctx?.operatorId ?? '', ctx?.system ? 'true' : 'false']);
}

/**
 * Makes non-transactional Drizzle queries RLS-safe. Each query gets a dedicated short transaction,
 * applies the request tenant with SET LOCAL, executes the statement, then releases the connection.
 */
function tenantAwareQueryPool(pool: Pool): Pool {
  const proxy = Object.create(pool) as Pool;
  proxy.query = (async (...args: any[]) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setDbContext(client);
      const result = await (client.query as any)(...args);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }) as Pool['query'];
  return proxy;
}

export class ModuleDb {
  private readonly root: Db;

  constructor(readonly module: ModuleName, private readonly pool: Pool) {
    this.root = drizzle(tenantAwareQueryPool(pool));
    Metrics.dbPoolTotal.addCallback(r => r.observe(pool.totalCount, { module }));
    Metrics.dbPoolIdle.addCallback(r => r.observe(pool.idleCount, { module }));
    Metrics.dbPoolWaiting.addCallback(r => r.observe(pool.waitingCount, { module }));
  }

  get db(): Db { return context.getStore()?.get(this.module) ?? this.root; }
  get inTransaction(): boolean { return context.getStore()?.has(this.module) ?? false; }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await setDbContext(client);
      const store = new Map(context.getStore() ?? []);
      store.set(this.module, drizzle(client));
      const result = await context.run(store, fn);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally { client.release(); }
  }

  requireTransaction(what: string) {
    if (!this.inTransaction) throw new Error(`${what} must run inside a ${this.module} transaction`);
  }

  async ping() { await this.pool.query('select 1'); }
  end() { return this.pool.end(); }
}

export const DB_TOKEN: Record<ModuleName, string> = {
  platform: 'DB_PLATFORM', compliance: 'DB_COMPLIANCE', org: 'DB_ORG', camo: 'DB_CAMO', engineering: 'DB_ENGINEERING', records: 'DB_RECORDS', amo: 'DB_AMO', ops: 'DB_OPS'
};
