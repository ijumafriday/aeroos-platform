import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AircraftConfigurationDto, ConfigurationBaselineDto, ConfigurationBaselineStatusDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { assertBaselineEditable, assertEffectivityValid, assertNoPositionCycle, effectivityMatches, validateConfiguration } from '@aeroos/mro-domain';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { FleetQuery } from '../camo/camo.repository';
import { allowableParts, configurationBaselines, configurationPositions, installedItems } from './configuration.tables';

const CHAIN = 'engineering';
const effectivity = (e: unknown) => (e && typeof e === 'object' ? e : {}) as { tails?: string[]; msnRanges?: { from: string; to: string }[] };

@Injectable()
export class ConfigurationService {
  constructor(@Inject(DB_TOKEN.engineering) private readonly db: ModuleDb, private readonly fleet: FleetQuery, private readonly authz: AuthzService, private readonly audit: AuditService) {}
  private resource(operatorId: string, id = '*') { return { kind: 'aircraft_configuration' as const, id, attr: { operatorId } }; }

  private async baselineRow(id: string, lock = false) {
    const q = this.db.db.select().from(configurationBaselines).where(eq(configurationBaselines.id, id)).limit(1);
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('BASELINE_NOT_FOUND', `Configuration baseline ${id} not found`, 404);
    return r;
  }
  private async baselineDto(r: typeof configurationBaselines.$inferSelect): Promise<ConfigurationBaselineDto> {
    const [ps, aps] = await Promise.all([
      this.db.db.select().from(configurationPositions).where(eq(configurationPositions.baselineId, r.id)).orderBy(asc(configurationPositions.code)),
      this.db.db.select().from(allowableParts).where(eq(allowableParts.operatorId, r.operatorId)).orderBy(asc(allowableParts.partNo))
    ]);
    return {
      id: r.id, aircraftType: r.aircraftType, name: r.name, revision: r.revision, status: r.status as ConfigurationBaselineStatusDto, effectiveFrom: r.effectiveFrom,
      createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), approvedBy: r.approvedBy, approvedAt: r.approvedAt?.toISOString() ?? null, version: r.version,
      positions: ps.map(p => ({ id: p.id, code: p.code, parentId: p.parentId, ata: p.ata, title: p.title, required: p.required, maxQty: p.maxQty, effectivity: effectivity(p.effectivity),
        allowableParts: aps.filter(a => a.positionId === p.id).map(a => ({ id: a.id, partNo: a.partNo, description: a.description, requiredMods: a.requiredMods })) }))
    };
  }

  async listBaselines(p: Principal, aircraftType?: string) {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    const where = aircraftType ? and(eq(configurationBaselines.operatorId, p.operatorId), eq(configurationBaselines.aircraftType, aircraftType)) : eq(configurationBaselines.operatorId, p.operatorId);
    const rows = await this.db.db.select().from(configurationBaselines).where(where).orderBy(asc(configurationBaselines.aircraftType), desc(configurationBaselines.revision));
    return Promise.all(rows.map(r => this.baselineDto(r)));
  }

  async createBaseline(p: Principal, body: { aircraftType: string; name: string }): Promise<ConfigurationBaselineDto> {
    await this.authz.check(p, this.resource(p.operatorId), 'design'); const actor = actorOf(p);
    return this.db.transaction(async () => {
      const v = await this.db.db.execute<{ revision: string }>(sql`select (coalesce(max(revision),0)+1)::text revision from engineering.configuration_baselines where operator_id=${p.operatorId} and aircraft_type=${body.aircraftType}`);
      const n = await this.db.db.execute<{ n: string }>(sql.raw(`select nextval('engineering.baseline_seq')::text n`));
      const row = { id: `CFG-${n.rows[0].n}`, operatorId: p.operatorId, aircraftType: body.aircraftType, name: body.name.trim(), revision: Number(v.rows[0].revision), status: 'DRAFT', effectiveFrom: null,
        createdBy: actor, approvedBy: null, approvedAt: null, version: 1 };
      const [saved] = await this.db.db.insert(configurationBaselines).values(row).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor, action: 'configuration.baseline.created', entityType: 'configuration_baseline', entityId: saved.id, data: { aircraftType: saved.aircraftType, revision: saved.revision } });
      return this.baselineDto(saved);
    });
  }

  async addPosition(p: Principal, baselineId: string, body: { code: string; parentId?: string | null; ata: string; title: string; required: boolean; maxQty: number; effectivity: { tails?: string[]; msnRanges?: { from: string; to: string }[] } }) {
    const b0 = await this.baselineRow(baselineId); await this.authz.check(p, this.resource(b0.operatorId, baselineId), 'design'); const actor = actorOf(p);
    return this.db.transaction(async () => {
      const b = await this.baselineRow(baselineId, true); assertBaselineEditable(b.status);
      const normalizedEffectivity = { tails: body.effectivity.tails?.map(x => x.trim().toUpperCase()).filter(Boolean), msnRanges: body.effectivity.msnRanges?.map(r => ({ from: r.from.trim(), to: r.to.trim() })) };
      assertEffectivityValid(normalizedEffectivity);
      if (body.parentId) { const [parent] = await this.db.db.select().from(configurationPositions).where(and(eq(configurationPositions.id, body.parentId), eq(configurationPositions.baselineId, baselineId))); if (!parent) throw new DomainError('PARENT_UNKNOWN', 'Parent position is not in this baseline'); }
      const n = await this.db.db.execute<{ n: string }>(sql.raw(`select nextval('engineering.position_seq')::text n`));
      const id = `POS-${n.rows[0].n}`;
      await this.db.db.insert(configurationPositions).values({ id, operatorId: b.operatorId, baselineId, code: body.code.trim(), parentId: body.parentId ?? null, ata: body.ata, title: body.title.trim(), required: body.required, maxQty: body.maxQty, effectivity: normalizedEffectivity });
      const ps = await this.db.db.select().from(configurationPositions).where(eq(configurationPositions.baselineId, baselineId));
      assertNoPositionCycle(ps.map(x => ({ ...x, effectivity: effectivity(x.effectivity) })));
      await this.db.db.update(configurationBaselines).set({ version: b.version + 1 }).where(eq(configurationBaselines.id, baselineId));
      await this.audit.record(this.db, CHAIN, { operatorId: b.operatorId, actor, action: 'configuration.position.added', entityType: 'configuration_baseline', entityId: baselineId, data: { id, code: body.code, ata: body.ata } });
      return this.baselineDto({ ...b, version: b.version + 1 });
    });
  }

  async addAllowablePart(p: Principal, baselineId: string, positionId: string, body: { partNo: string; description: string; requiredMods: string[] }) {
    const b0 = await this.baselineRow(baselineId); await this.authz.check(p, this.resource(b0.operatorId, baselineId), 'design'); const actor = actorOf(p);
    return this.db.transaction(async () => {
      const b = await this.baselineRow(baselineId, true); assertBaselineEditable(b.status);
      const [pos] = await this.db.db.select().from(configurationPositions).where(and(eq(configurationPositions.id, positionId), eq(configurationPositions.baselineId, baselineId)));
      if (!pos) throw new DomainError('POSITION_NOT_FOUND', 'Configuration position not found', 404);
      await this.db.db.insert(allowableParts).values({ operatorId: b.operatorId, positionId, partNo: body.partNo.trim(), description: body.description.trim(), requiredMods: [...new Set(body.requiredMods.map(x => x.trim()).filter(Boolean))] });
      await this.db.db.update(configurationBaselines).set({ version: b.version + 1 }).where(eq(configurationBaselines.id, baselineId));
      await this.audit.record(this.db, CHAIN, { operatorId: b.operatorId, actor, action: 'configuration.allowable_part.added', entityType: 'configuration_baseline', entityId: baselineId, data: { positionId, partNo: body.partNo } });
      return this.baselineDto({ ...b, version: b.version + 1 });
    });
  }

  async approve(p: Principal, id: string, version: number) {
    const b0 = await this.baselineRow(id); await this.authz.check(p, this.resource(b0.operatorId, id), 'approve'); const actor = actorOf(p);
    return this.db.transaction(async () => {
      const b = await this.baselineRow(id, true); assertBaselineEditable(b.status); if (b.version !== version) throw new DomainError('CONCURRENT_UPDATE', 'Baseline changed; reload before approval', 409);
      if (b.createdBy === actor) throw new DomainError('INDEPENDENT_APPROVAL_REQUIRED', 'The baseline author cannot approve the same revision', 409);
      const dto = await this.baselineDto(b); if (!dto.positions.length) throw new DomainError('BASELINE_EMPTY', 'A configuration baseline must contain at least one position');
      const noAllowable = dto.positions.filter(x => x.required && x.allowableParts.length === 0); if (noAllowable.length) throw new DomainError('ALLOWABLE_PART_REQUIRED', `Required positions need allowable parts: ${noAllowable.map(x => x.code).join(', ')}`);
      const [saved] = await this.db.db.update(configurationBaselines).set({ status: 'APPROVED', approvedBy: actor, approvedAt: new Date(), version: b.version + 1 }).where(and(eq(configurationBaselines.id, id), eq(configurationBaselines.version, version))).returning();
      if (!saved) throw new DomainError('CONCURRENT_UPDATE', 'Baseline changed; reload before approval', 409);
      await this.audit.record(this.db, CHAIN, { operatorId: b.operatorId, actor, action: 'configuration.baseline.approved', entityType: 'configuration_baseline', entityId: id, data: { revision: b.revision } });
      return this.baselineDto(saved);
    });
  }

  async activate(p: Principal, id: string, body: { effectiveFrom: string; version: number }) {
    const b0 = await this.baselineRow(id); await this.authz.check(p, this.resource(b0.operatorId, id), 'approve'); const actor = actorOf(p);
    return this.db.transaction(async () => {
      const b = await this.baselineRow(id, true); if (b.status !== 'APPROVED') throw new DomainError('BASELINE_NOT_APPROVED', 'Only an approved baseline can become effective', 409); if (b.version !== body.version) throw new DomainError('CONCURRENT_UPDATE', 'Baseline changed; reload before activation', 409);
      if (body.effectiveFrom > new Date().toISOString().slice(0, 10)) throw new DomainError('EFFECTIVE_DATE_FUTURE', 'A baseline can only be made effective on or before today; keep future revisions approved until their effective date', 409);
      await this.db.db.update(configurationBaselines).set({ status: 'SUPERSEDED', version: sql`${configurationBaselines.version} + 1` }).where(and(eq(configurationBaselines.operatorId, b.operatorId), eq(configurationBaselines.aircraftType, b.aircraftType), eq(configurationBaselines.status, 'EFFECTIVE')));
      const [saved] = await this.db.db.update(configurationBaselines).set({ status: 'EFFECTIVE', effectiveFrom: body.effectiveFrom, version: b.version + 1 }).where(eq(configurationBaselines.id, id)).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: b.operatorId, actor, action: 'configuration.baseline.effective', entityType: 'configuration_baseline', entityId: id, data: { aircraftType: b.aircraftType, effectiveFrom: body.effectiveFrom } });
      return this.baselineDto(saved);
    });
  }

  async aircraft(p: Principal, tail: string): Promise<AircraftConfigurationDto> {
    await this.authz.check(p, this.resource(p.operatorId, tail), 'read'); const ac = await this.fleet.get(tail);
    if (!ac || ac.operatorId !== p.operatorId) throw new DomainError('TAIL_UNKNOWN', `${tail} is not in the fleet`, 404);
    const [b] = await this.db.db.select().from(configurationBaselines).where(and(eq(configurationBaselines.operatorId, p.operatorId), eq(configurationBaselines.aircraftType, ac.type), eq(configurationBaselines.status, 'EFFECTIVE'))).limit(1);
    const rows = await this.db.db.select().from(installedItems).where(and(eq(installedItems.operatorId, p.operatorId), eq(installedItems.tail, tail), isNull(installedItems.removedAt))).orderBy(asc(installedItems.positionId));
    const perms = await this.authz.decide(p, this.resource(p.operatorId, tail), ['design','install','approve']);
    if (!b) return { tail, aircraftType: ac.type, msn: ac.msn, baseline: null, items: [], issues: [{ code: 'NO_EFFECTIVE_BASELINE', positionId: '', detail: `No effective configuration baseline for ${ac.type}` }], conforming: false, permissions: { design: perms.design, install: perms.install, approve: perms.approve } };
    const dto = await this.baselineDto(b); const posByCode = new Map(dto.positions.map(x => [x.code, x]));
    const items = rows.map(i => { const active = posByCode.get(i.positionCode); return ({ id: i.id, tail: i.tail, aircraftType: i.aircraftType, positionId: active?.id ?? i.positionId, positionCode: i.positionCode, positionTitle: active?.title ?? 'Position not present in effective baseline', partNo: i.partNo, serial: i.serial, mods: i.mods, installedAt: i.installedAt.toISOString(), installationRef: i.installationRef, installedBy: i.installedBy, removedAt: null, removalRef: null, removedBy: null }); });
    const mappedInstalled = rows.map(i => ({ id: i.id, positionId: posByCode.get(i.positionCode)?.id ?? `obsolete:${i.positionCode}`, partNo: i.partNo, serial: i.serial, mods: i.mods }));
    const issues = validateConfiguration({ tail, msn: ac.msn }, dto.positions.map(x => ({ ...x, effectivity: x.effectivity })), dto.positions.flatMap(x => x.allowableParts.map(a => ({ positionId: x.id, partNo: a.partNo, requiredMods: a.requiredMods }))), mappedInstalled);
    for (const item of rows.filter(i => !posByCode.has(i.positionCode))) issues.push({ code: 'PART_NOT_ALLOWABLE', positionId: item.positionId, itemId: item.id, detail: `${item.positionCode} is not present in the effective configuration baseline` });
    return { tail, aircraftType: ac.type, msn: ac.msn, baseline: dto, items, issues, conforming: issues.length === 0, permissions: { design: perms.design, install: perms.install, approve: perms.approve } };
  }


  async history(p: Principal, tail: string) {
    await this.authz.check(p, this.resource(p.operatorId, tail), 'read');
    const ac = await this.fleet.get(tail); if (!ac || ac.operatorId !== p.operatorId) throw new DomainError('TAIL_UNKNOWN', `${tail} is not in the fleet`, 404);
    const [b] = await this.db.db.select().from(configurationBaselines).where(and(eq(configurationBaselines.operatorId, p.operatorId), eq(configurationBaselines.aircraftType, ac.type), eq(configurationBaselines.status, 'EFFECTIVE'))).limit(1);
    const positions = b ? (await this.baselineDto(b)).positions : [];
    const posByCode = new Map(positions.map(x => [x.code, x]));
    const rows = await this.db.db.select().from(installedItems).where(and(eq(installedItems.operatorId, p.operatorId), eq(installedItems.tail, tail))).orderBy(desc(installedItems.installedAt));
    return rows.map(i => { const pos = posByCode.get(i.positionCode); return { id: i.id, tail: i.tail, aircraftType: i.aircraftType, positionId: pos?.id ?? i.positionId, positionCode: i.positionCode, positionTitle: pos?.title ?? i.positionCode, partNo: i.partNo, serial: i.serial, mods: i.mods, installedAt: i.installedAt.toISOString(), installationRef: i.installationRef, installedBy: i.installedBy, removedAt: i.removedAt?.toISOString() ?? null, removalRef: i.removalRef, removedBy: i.removedBy }; });
  }

  async install(p: Principal, tail: string, body: { positionId: string; partNo: string; serial: string; mods: string[]; installedAt: string; reference: string }) {
    const installedAt = new Date(body.installedAt); if (installedAt.getTime() > Date.now() + 5 * 60_000) throw new DomainError('INSTALLATION_DATE_FUTURE', 'Installation time cannot be in the future', 409);
    const ac = await this.aircraft(p, tail); await this.authz.check(p, this.resource(p.operatorId, tail), 'install'); if (!ac.baseline) throw new DomainError('NO_EFFECTIVE_BASELINE', `No effective configuration baseline for ${ac.aircraftType}`, 409);
    const pos = ac.baseline.positions.find(x => x.id === body.positionId); if (!pos || !effectivityMatches(pos.effectivity, { tail, msn: ac.msn })) throw new DomainError('POSITION_NOT_APPLICABLE', 'Position is not applicable to this aircraft', 409);
    const rule = pos.allowableParts.find(x => x.partNo === body.partNo); if (!rule) throw new DomainError('PART_NOT_ALLOWABLE', `${body.partNo} is not allowable at ${pos.code}`, 409);
    const missing = rule.requiredMods.filter(x => !body.mods.includes(x)); if (missing.length) throw new DomainError('REQUIRED_MOD_MISSING', `Required modification(s) missing: ${missing.join(', ')}`, 409);
    if (ac.items.filter(x => x.positionId === pos.id).length >= pos.maxQty) throw new DomainError('POSITION_FULL', `${pos.code} already has its maximum ${pos.maxQty} installed item(s)`, 409);
    const actor = actorOf(p); return this.db.transaction(async () => {
      await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`configuration:${tail}:${pos.code}`}))`);
      const current = await this.db.db.execute<{ n: string }>(sql`select count(*)::text n from engineering.installed_items where operator_id=${p.operatorId} and tail=${tail} and position_code=${pos.code} and removed_at is null`);
      if (Number(current.rows[0].n) >= pos.maxQty) throw new DomainError('POSITION_FULL', `${pos.code} already has its maximum ${pos.maxQty} installed item(s)`, 409);
      const n = await this.db.db.execute<{ n: string }>(sql.raw(`select nextval('engineering.item_seq')::text n`)); const id = `CFGITEM-${n.rows[0].n}`;
      await this.db.db.insert(installedItems).values({ id, operatorId: p.operatorId, tail, aircraftType: ac.aircraftType, positionId: pos.id, positionCode: pos.code, partNo: body.partNo.trim(), serial: body.serial.trim(), mods: [...new Set(body.mods)], installedAt, installationRef: body.reference.trim(), installedBy: actor });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor, action: 'configuration.item.installed', entityType: 'aircraft_configuration', entityId: tail, data: { id, position: pos.code, partNo: body.partNo, serial: body.serial, reference: body.reference } });
      return this.aircraft(p, tail);
    });
  }

  async remove(p: Principal, tail: string, itemId: string, body: { reference: string }) {
    await this.authz.check(p, this.resource(p.operatorId, tail), 'install'); const actor = actorOf(p);
    return this.db.transaction(async () => {
      const [item] = await this.db.db.select().from(installedItems).where(and(eq(installedItems.id, itemId), eq(installedItems.operatorId, p.operatorId), eq(installedItems.tail, tail), isNull(installedItems.removedAt))).for('update');
      if (!item) throw new DomainError('CONFIG_ITEM_NOT_FOUND', 'Installed configuration item not found', 404);
      const at = new Date(); await this.db.db.update(installedItems).set({ removedAt: at, removalRef: body.reference.trim(), removedBy: actor }).where(eq(installedItems.id, itemId));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor, action: 'configuration.item.removed', entityType: 'aircraft_configuration', entityId: tail, data: { itemId, partNo: item.partNo, serial: item.serial, reference: body.reference } });
      return this.aircraft(p, tail);
    });
  }
}
