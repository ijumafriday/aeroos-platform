import { BadRequestException, Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalJson, newId, sha256Hex } from '@aeroos/kernel';
import { CurrentPrincipal, actorOf, type Principal } from '../auth/principal';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { migrationJobs, migrationRows } from '../database/platform.tables';
import { ZodPipe } from '../http/http';

export type MigrationStrategy = 'INSERT_ONLY' | 'UPSERT';
export type MigrationRowResult = { ok: true; normalized: Record<string, unknown> } | { ok: false; error: string };
export interface MigrationApplyContext { operatorId: string; actor: string; strategy: MigrationStrategy; jobId: string; rowNo: number }
export interface MigrationAdapter {
  target: string;
  columns: { name: string; required: boolean; description: string }[];
  validate(row: Record<string, unknown>, operatorId: string, strategy: MigrationStrategy): Promise<MigrationRowResult>;
  key(row: Record<string, unknown>): string;
  apply(row: Record<string, unknown>, ctx: MigrationApplyContext): Promise<'APPLIED' | 'SKIPPED'>;
}

@Injectable()
export class MigrationRegistry {
  private readonly adapters = new Map<string, MigrationAdapter>();
  register(a: MigrationAdapter) { if (this.adapters.has(a.target)) throw new Error(`Duplicate migration adapter ${a.target}`); this.adapters.set(a.target, a); }
  get(target: string) { const a = this.adapters.get(target); if (!a) throw new BadRequestException(`Unsupported migration target ${target}`); return a; }
  list() { return [...this.adapters.values()].map(a => ({ target: a.target, columns: a.columns })); }
}

const createSchema = z.object({ target: z.string().trim().min(3).max(80), sourceName: z.string().trim().min(2).max(160), strategy: z.enum(['INSERT_ONLY','UPSERT']).default('INSERT_ONLY') });
const rowsSchema = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000) });

@Injectable()
export class MigrationService {
  constructor(@Inject(DB_TOKEN.platform) private readonly db: ModuleDb, private readonly registry: MigrationRegistry, private readonly audit: AuditService) {}

  targets() { return this.registry.list(); }
  list(operatorId: string) { return this.db.db.select().from(migrationJobs).where(eq(migrationJobs.operatorId, operatorId)).orderBy(desc(migrationJobs.createdAt)).limit(100); }
  async get(operatorId: string, id: string) {
    const [job] = await this.db.db.select().from(migrationJobs).where(and(eq(migrationJobs.id, id), eq(migrationJobs.operatorId, operatorId))).limit(1);
    if (!job) throw new BadRequestException('Migration job not found');
    const rows = await this.db.db.select().from(migrationRows).where(and(eq(migrationRows.jobId, id), eq(migrationRows.operatorId, operatorId))).orderBy(asc(migrationRows.rowNo)).limit(5000);
    return { ...job, rows };
  }

  async create(p: Principal, body: z.infer<typeof createSchema>) {
    this.registry.get(body.target);
    const row = { id: newId(), operatorId: p.operatorId, target: body.target, strategy: body.strategy, sourceName: body.sourceName, createdBy: actorOf(p) };
    await this.db.db.insert(migrationJobs).values(row); return row;
  }

  async stage(p: Principal, id: string, rows: Record<string, unknown>[]) {
    return this.db.transaction(async () => {
      const [job] = await this.db.db.select().from(migrationJobs).where(and(eq(migrationJobs.id, id), eq(migrationJobs.operatorId, p.operatorId))).for('update').limit(1);
      if (!job || job.status !== 'DRAFT') throw new BadRequestException('Only DRAFT jobs can receive rows');
      const [{ n }] = await this.db.db.select({ n: sql<number>`coalesce(max(${migrationRows.rowNo}), 0)` }).from(migrationRows).where(eq(migrationRows.jobId, id));
      const start = Number(n) + 1;
      await this.db.db.insert(migrationRows).values(rows.map((raw, i) => ({ jobId: id, operatorId: p.operatorId, rowNo: start + i, raw })));
      return { id, staged: rows.length, total: start + rows.length - 1 };
    });
  }

  async validate(p: Principal, id: string) {
    const [job] = await this.db.db.select().from(migrationJobs).where(and(eq(migrationJobs.id, id), eq(migrationJobs.operatorId, p.operatorId))).limit(1);
    if (!job || !['DRAFT','VALIDATED'].includes(job.status)) throw new BadRequestException('Migration job cannot be validated');
    const adapter = this.registry.get(job.target);
    const rows = await this.db.db.select().from(migrationRows).where(and(eq(migrationRows.jobId, id), eq(migrationRows.operatorId, p.operatorId))).orderBy(asc(migrationRows.rowNo));
    if (!rows.length) throw new BadRequestException('Stage at least one row before validation');
    let valid = 0, invalid = 0; const seen = new Set<string>();
    for (const row of rows) {
      const result = await adapter.validate(row.raw, p.operatorId, job.strategy as MigrationStrategy);
      if (result.ok && seen.has(adapter.key(result.normalized))) { invalid++; await this.db.db.update(migrationRows).set({ normalized: result.normalized, status: 'INVALID', error: `Duplicate source key ${adapter.key(result.normalized)}` }).where(and(eq(migrationRows.jobId,id),eq(migrationRows.rowNo,row.rowNo))); continue; }
      if (result.ok) { seen.add(adapter.key(result.normalized)); valid++; await this.db.db.update(migrationRows).set({ normalized: result.normalized, status: 'VALID', error: null }).where(and(eq(migrationRows.jobId,id),eq(migrationRows.rowNo,row.rowNo))); }
      else { invalid++; await this.db.db.update(migrationRows).set({ normalized: null, status: 'INVALID', error: result.error.slice(0,2000) }).where(and(eq(migrationRows.jobId,id),eq(migrationRows.rowNo,row.rowNo))); }
    }
    const status = invalid ? 'DRAFT' : 'VALIDATED';
    const sourceSha256 = sha256Hex(canonicalJson(rows.map(r => r.raw)));
    const summary = { total: rows.length, valid, invalid, sourceSha256 };
    await this.db.db.update(migrationJobs).set({ status, validatedBy: invalid ? null : actorOf(p), validatedAt: invalid ? null : new Date(), summary, error: invalid ? `${invalid} row(s) invalid` : null }).where(eq(migrationJobs.id,id));
    return { id, status, summary };
  }

  async apply(p: Principal, id: string) {
    const [job] = await this.db.db.select().from(migrationJobs).where(and(eq(migrationJobs.id,id),eq(migrationJobs.operatorId,p.operatorId))).limit(1);
    if (!job) throw new BadRequestException('Migration job not found');
    const staleApplying = job.status === 'APPLYING' && !!job.applyStartedAt && Date.now() - job.applyStartedAt.getTime() > 15 * 60_000;
    if (!['VALIDATED','FAILED'].includes(job.status) && !staleApplying) throw new BadRequestException('Only VALIDATED, FAILED, or stale APPLYING jobs can be applied');
    const adapter = this.registry.get(job.target);
    await this.db.db.update(migrationJobs).set({ status: 'APPLYING', appliedBy: actorOf(p), applyStartedAt: new Date(), error: null }).where(eq(migrationJobs.id,id));
    const rows = await this.db.db.select().from(migrationRows).where(and(eq(migrationRows.jobId,id),or(eq(migrationRows.status,'VALID'),eq(migrationRows.status,'FAILED')))).orderBy(asc(migrationRows.rowNo));
    let applied = 0, skipped = 0;
    try {
      for (const row of rows) {
        try {
          const outcome = await adapter.apply(row.normalized ?? row.raw, { operatorId: p.operatorId, actor: actorOf(p), strategy: job.strategy as MigrationStrategy, jobId: id, rowNo: row.rowNo });
          if (outcome === 'APPLIED') applied++; else skipped++;
          await this.db.db.update(migrationRows).set({ status: outcome, error: null }).where(and(eq(migrationRows.jobId,id),eq(migrationRows.rowNo,row.rowNo)));
        } catch (e) {
          await this.db.db.update(migrationRows).set({ status: 'FAILED', error: (e as Error).message.slice(0,2000) }).where(and(eq(migrationRows.jobId,id),eq(migrationRows.rowNo,row.rowNo)));
          throw e;
        }
      }
      const summary = { total: rows.length, applied, skipped, failed: 0 };
      await this.db.transaction(async () => {
        await this.db.db.update(migrationJobs).set({ status: 'APPLIED', appliedAt: new Date(), summary }).where(eq(migrationJobs.id,id));
        await this.audit.record(this.db, 'platform', { operatorId: p.operatorId, actor: actorOf(p), action: 'migration.applied', entityType: 'migration_job', entityId: id, data: { target: job.target, strategy: job.strategy, sourceName: job.sourceName, ...summary }, rule: 'PLATFORM-MIGRATION-01' });
      });
      return { id, status: 'APPLIED', summary };
    } catch (e) {
      const msg = (e as Error).message.slice(0,2000);
      await this.db.db.update(migrationJobs).set({ status: 'FAILED', error: msg, summary: { total: rows.length, applied, skipped, failed: rows.length-applied-skipped } }).where(eq(migrationJobs.id,id));
      throw e;
    }
  }
}

@Controller('v1/platform/migrations')
export class MigrationController {
  constructor(private readonly svc: MigrationService, private readonly authz: AuthzService) {}
  private permit(p: Principal, action: string, id='migration') { return this.authz.check(p, { kind:'platform_migration', id, attr:{ operatorId:p.operatorId } }, action); }
  @Get('targets') async targets(@CurrentPrincipal() p: Principal) { await this.permit(p,'read'); return this.svc.targets(); }
  @Get() async list(@CurrentPrincipal() p: Principal) { await this.permit(p,'read'); return this.svc.list(p.operatorId); }
  @Get(':id') async get(@CurrentPrincipal() p: Principal,@Param('id') id:string) { await this.permit(p,'read',id); return this.svc.get(p.operatorId,id); }
  @Post() async create(@CurrentPrincipal() p: Principal,@Body(new ZodPipe(createSchema)) b:z.infer<typeof createSchema>) { await this.permit(p,'manage'); return this.svc.create(p,b); }
  @Post(':id/rows') async rows(@CurrentPrincipal() p: Principal,@Param('id') id:string,@Body(new ZodPipe(rowsSchema)) b:z.infer<typeof rowsSchema>) { await this.permit(p,'manage',id); return this.svc.stage(p,id,b.rows); }
  @Post(':id/validate') async validate(@CurrentPrincipal() p: Principal,@Param('id') id:string) { await this.permit(p,'manage',id); return this.svc.validate(p,id); }
  @Post(':id/apply') async apply(@CurrentPrincipal() p: Principal,@Param('id') id:string) { await this.permit(p,'manage',id); return this.svc.apply(p,id); }
}
