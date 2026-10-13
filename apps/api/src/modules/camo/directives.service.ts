import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DirectiveDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import {
  applicability, applyOverrides, confirmNotApplicable, daysToEffective, evaluate, incorporate, OPEN_DIRECTIVE, supersede, supersedingStart, toRequirement,
  type Directive, type DirectiveDecision, type DirectiveKind, type DirectiveStatus, type Interval, type TailApplicability
} from '@aeroos/mro-domain';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { FleetQuery } from './camo.repository';
import { compliance, directives, directiveTails, requirements, requirementStart } from './programme.tables';
import { ProgrammeService } from './programme.service';

const CHAIN = 'camo';
const OPEN: DirectiveStatus[] = OPEN_DIRECTIVE;
const link = (id: string) => `/camo/directives?directive=${encodeURIComponent(id)}`;

type Row = typeof directives.$inferSelect;

const toDomain = (r: Row): Directive => ({
  id: r.id, operatorId: r.operatorId, kind: r.kind as DirectiveKind, ref: r.ref, revision: r.revision, authority: r.authority, title: r.title, ata: r.ata,
  types: r.types, msnRanges: r.msnRanges ?? null, effective: r.effective, action: r.action, interval: r.interval, repetitive: r.repetitive,
  estimatedHours: r.estimatedHours, steps: r.steps, supersedes: r.supersedes, status: r.status as DirectiveStatus, decision: (r.decision as DirectiveDecision | null) ?? null,
  decisionReason: r.decisionReason, evaluatedBy: r.evaluatedBy, evaluatedAt: r.evaluatedAt, incorporatedBy: r.incorporatedBy, incorporatedAt: r.incorporatedAt,
  confirmedBy: r.confirmedBy, confirmedAt: r.confirmedAt, requirementId: r.requirementId, version: r.version
});

export interface ReceiveDirective {
  kind: DirectiveKind; ref: string; revision: string; authority: string; title: string; ata: string; types: string[];
  msnRanges: { from: string; to: string }[] | null; effective: string; action: string; interval: Interval; repetitive: boolean;
  estimatedHours: number; steps: string[]; supersedes: string | null;
}

/**
 * AD / SB intake (ADR-0019): received → evaluated per aircraft → incorporated into the maintenance programme by
 * a second person, where the due list tracks it like any other AD or task. Applicable ADs cannot be rejected.
 */
@Injectable()
export class DirectivesService {
  constructor(
    @Inject(DB_TOKEN.camo) private readonly db: ModuleDb,
    private readonly fleet: FleetQuery,
    private readonly programme: ProgrammeService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  private resource(operatorId: string, id = '*') {
    return { kind: 'directive' as const, id, attr: { operatorId } };
  }

  private async dto(rows: Row[], operatorId: string): Promise<DirectiveDto[]> {
    if (!rows.length) return [];
    const [tails, fleet] = await Promise.all([
      this.db.db.select().from(directiveTails).where(inArray(directiveTails.directiveId, rows.map(r => r.id))).orderBy(asc(directiveTails.tail)),
      this.fleet.list(operatorId)
    ]);
    const tailInfo = new Map(fleet.map(f => [f.reg, f]));
    const now = new Date();
    return rows.map(r => {
      const t = tails.filter(x => x.directiveId === r.id).map(x => ({
        tail: x.tail, type: tailInfo.get(x.tail)?.type ?? '', msn: tailInfo.get(x.tail)?.msn ?? '', applicable: x.applicable, reason: x.reason, overridden: x.overridden
      }));
      return {
        id: r.id, kind: r.kind as DirectiveKind, ref: r.ref, revision: r.revision, authority: r.authority, title: r.title, ata: r.ata, types: r.types,
        msnRanges: r.msnRanges ?? null, effective: r.effective, daysToEffective: daysToEffective(r, now), action: r.action,
        interval: { fh: r.interval.fh, fc: r.interval.fc, days: r.interval.days }, repetitive: r.repetitive, estimatedHours: r.estimatedHours, steps: r.steps,
        supersedes: r.supersedes, status: r.status as DirectiveStatus, decision: (r.decision as DirectiveDecision | null) ?? null, decisionReason: r.decisionReason,
        receivedBy: r.receivedBy, receivedAt: r.receivedAt.toISOString(), evaluatedBy: r.evaluatedBy, evaluatedAt: r.evaluatedAt?.toISOString() ?? null,
        incorporatedBy: r.incorporatedBy, incorporatedAt: r.incorporatedAt?.toISOString() ?? null, confirmedBy: r.confirmedBy, confirmedAt: r.confirmedAt?.toISOString() ?? null,
        requirementId: r.requirementId, version: r.version,
        tails: t, affected: t.filter(x => x.applicable).length
      };
    });
  }

  private async row(id: string, opts: { lock?: boolean } = {}): Promise<Row> {
    const q = this.db.db.select().from(directives).where(eq(directives.id, id));
    const [r] = opts.lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('NOT_FOUND', `No directive ${id}`, 404);
    return r;
  }

  async list(p: Principal, scope: 'open' | 'closed' | 'all'): Promise<DirectiveDto[]> {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    const where = scope === 'all' ? eq(directives.operatorId, p.operatorId)
      : scope === 'open' ? and(eq(directives.operatorId, p.operatorId), inArray(directives.status, OPEN))
        : and(eq(directives.operatorId, p.operatorId), sql`${directives.status} not in ('RECEIVED', 'EVALUATED', 'DEFERRED', 'NOT_APPLICABLE_PENDING')`);
    const rows = await this.db.db.select().from(directives).where(where).orderBy(asc(directives.effective), desc(directives.receivedAt)).limit(500);
    return this.dto(rows, p.operatorId);
  }

  async get(p: Principal, id: string): Promise<DirectiveDto> {
    const r = await this.row(id);
    await this.authz.check(p, this.resource(r.operatorId, id), 'read');
    return (await this.dto([r], r.operatorId))[0];
  }

  async receive(p: Principal, body: ReceiveDirective): Promise<DirectiveDto> {
    await this.authz.check(p, this.resource(p.operatorId), 'receive');
    const fleet = await this.fleet.list(p.operatorId);
    if (!body.types.some(t => fleet.some(f => f.type === t))) throw new DomainError('TYPE_NOT_OPERATED', `None of ${body.types.join(', ')} is in the fleet — file it as not applicable outside the system`, 422);
    if (body.supersedes) {
      const prev = await this.row(body.supersedes);
      if (prev.operatorId !== p.operatorId) throw new DomainError('NOT_FOUND', `No directive ${body.supersedes}`, 404);
    }
    const auto = applicability(body, fleet.map(f => ({ reg: f.reg, type: f.type, msn: f.msn })));
    const id = await this.db.transaction(async () => {
      const n = await this.db.db.execute<{ n: string }>(sql`select nextval('camo.directive_seq')::text as n`);
      const id = `DIR-${n.rows[0].n}`;
      const exists = await this.db.db.select({ id: directives.id }).from(directives)
        .where(and(eq(directives.operatorId, p.operatorId), eq(directives.ref, body.ref), eq(directives.revision, body.revision)));
      if (exists.length) throw new DomainError('DUPLICATE', `${body.ref}${body.revision ? ` R${body.revision}` : ''} is already recorded as ${exists[0].id}`, 409);
      await this.db.db.insert(directives).values({
        id, operatorId: p.operatorId, kind: body.kind, ref: body.ref, revision: body.revision, authority: body.authority, title: body.title, ata: body.ata,
        types: body.types, msnRanges: body.msnRanges, effective: body.effective, action: body.action, interval: body.interval, repetitive: body.repetitive,
        estimatedHours: body.estimatedHours, steps: body.steps, supersedes: body.supersedes, status: 'RECEIVED', receivedBy: actorOf(p), version: 1
      });
      await this.db.db.insert(directiveTails).values(auto.map(a => ({ directiveId: id, ...a })));
      await this.audit.record(this.db, CHAIN, {
        operatorId: p.operatorId, actor: actorOf(p), action: 'directive.received', entityType: 'directive', entityId: id,
        data: { kind: body.kind, ref: body.ref, revision: body.revision, effective: body.effective, affected: auto.filter(a => a.applicable).map(a => a.tail) }
      });
      const days = daysToEffective(body, new Date());
      const affected = auto.filter(a => a.applicable).length;
      if (body.kind === 'AD' && affected > 0) {
        await this.notifications.raise(this.db, {
          operatorId: p.operatorId, actor: 'system:camo', severity: days <= 14 ? 'red' : 'amber', link: link(id),
          title: `${body.ref} received — ${affected} aircraft`, body: `${body.title}. Effective ${days <= 0 ? 'already' : `in ${days} days`}; evaluate it.`
        });
      }
      return id;
    });
    return this.get(p, id);
  }

  /**
   * `overrides` is the complete set of per-aircraft overrides wanted after this evaluation; omitted = keep the
   * ones already recorded (a re-evaluation never drops an override silently).
   */
  async evaluate(p: Principal, id: string, body: { decision: DirectiveDecision; reason: string | null; overrides?: { tail: string; applicable: boolean; reason: string }[]; version: number }): Promise<DirectiveDto> {
    const first = await this.row(id);
    await this.authz.check(p, this.resource(first.operatorId, id), 'evaluate');
    await this.db.transaction(async () => {
      const r = await this.row(id, { lock: true });
      if (r.version !== body.version) throw new DomainError('CHANGED', `${r.ref} was changed by someone else — reload`, 409);
      const fleet = await this.fleet.list(r.operatorId);
      // Overrides apply to the automatic applicability (a re-evaluation starts again from the published ranges,
      // and includes aircraft added to the fleet since the directive was received).
      const auto = applicability(toDomain(r), fleet.map(f => ({ reg: f.reg, type: f.type, msn: f.msn })));
      const kept = (await this.db.db.select().from(directiveTails).where(and(eq(directiveTails.directiveId, id), eq(directiveTails.overridden, true))))
        .map(t => ({ tail: t.tail, applicable: t.applicable, reason: t.reason }));
      // Aircraft that have left the fleet (sold, transferred) are not re-evaluated; their overrides are dropped.
      const inFleet = new Set(fleet.map(f => f.reg));
      const wanted = (body.overrides ?? kept).filter(o => inFleet.has(o.tail));
      const dropped = (body.overrides ?? kept).filter(o => !inFleet.has(o.tail)).map(o => o.tail);
      const tails: TailApplicability[] = applyOverrides(auto, wanted);
      const next = evaluate(toDomain(r), body.decision, body.reason, tails, actorOf(p), new Date());
      await this.db.db.update(directives).set({
        status: next.status, decision: next.decision, decisionReason: next.decisionReason, evaluatedBy: next.evaluatedBy, evaluatedAt: next.evaluatedAt,
        confirmedBy: null, confirmedAt: null, version: next.version
      }).where(eq(directives.id, id));
      for (const t of tails) {
        await this.db.db.insert(directiveTails).values({ directiveId: id, ...t })
          .onConflictDoUpdate({ target: [directiveTails.directiveId, directiveTails.tail], set: { applicable: t.applicable, reason: t.reason, overridden: t.overridden } });
      }
      await this.audit.record(this.db, CHAIN, {
        operatorId: r.operatorId, actor: actorOf(p), action: 'directive.evaluated', entityType: 'directive', entityId: id,
        data: { ref: r.ref, decision: next.decision, reason: next.decisionReason, status: next.status, applicable: tails.filter(t => t.applicable).map(t => t.tail),
          overrides: tails.filter(t => t.overridden).map(t => ({ tail: t.tail, applicable: t.applicable, reason: t.reason })), droppedOverrides: dropped }
      });
      if (next.status === 'NOT_APPLICABLE_PENDING') {
        await this.notifications.raise(this.db, {
          operatorId: r.operatorId, actor: 'system:camo', severity: 'amber', link: link(id),
          title: `${r.ref}: "not applicable" needs a second signature`, body: `Overridden on ${tails.filter(t => t.overridden && !t.applicable).map(t => t.tail).join(', ')} — confirm or re-evaluate.`
        });
      }
    });
    return this.get(p, id);
  }

  /** Second person: confirm an AD is not applicable where its published applicability was overridden. */
  async confirmNotApplicable(p: Principal, id: string, version: number): Promise<DirectiveDto> {
    const first = await this.row(id);
    await this.authz.check(p, this.resource(first.operatorId, id), 'incorporate');
    await this.db.transaction(async () => {
      const r = await this.row(id, { lock: true });
      if (r.version !== version) throw new DomainError('CHANGED', `${r.ref} was changed by someone else — reload`, 409);
      const next = confirmNotApplicable(toDomain(r), actorOf(p), new Date());
      await this.db.db.update(directives).set({ status: next.status, confirmedBy: next.confirmedBy, confirmedAt: next.confirmedAt, version: next.version }).where(eq(directives.id, id));
      await this.audit.record(this.db, CHAIN, {
        operatorId: r.operatorId, actor: actorOf(p), action: 'directive.not_applicable_confirmed', entityType: 'directive', entityId: id,
        data: { ref: r.ref, evaluatedBy: r.evaluatedBy, reason: r.decisionReason }
      });
    });
    return this.get(p, id);
  }

  /** Second person: the AD/SB becomes a maintenance-programme requirement for the applicable aircraft. */
  async incorporate(p: Principal, id: string, version: number): Promise<DirectiveDto> {
    const first = await this.row(id);
    await this.authz.check(p, this.resource(first.operatorId, id), 'incorporate');
    const operatorId = await this.db.transaction(async () => {
      const r = await this.row(id, { lock: true });
      if (r.version !== version) throw new DomainError('CHANGED', `${r.ref} was changed by someone else — reload`, 409);
      const reqId = `R-${r.id}`;
      const next = incorporate(toDomain(r), reqId, actorOf(p), new Date());
      const req = toRequirement(next, reqId);
      const tails = (await this.db.db.select().from(directiveTails).where(and(eq(directiveTails.directiveId, id), eq(directiveTails.applicable, true)))).map(t => t.tail);
      const clash = await this.db.db.select({ id: requirements.id }).from(requirements).where(and(eq(requirements.operatorId, r.operatorId), eq(requirements.ref, req.ref)));
      if (clash.length) throw new DomainError('ALREADY_IN_PROGRAMME', `${req.ref} is already in the maintenance programme (${clash[0].id})`, 409);
      await this.db.db.insert(requirements).values({
        id: reqId, operatorId: r.operatorId, kind: req.kind, ref: req.ref, title: req.title, ata: req.ata, types: req.types, interval: req.interval,
        repetitive: req.repetitive, steps: req.steps, estimatedHours: req.estimatedHours, tools: req.tools, parts: req.parts, active: true, tails
      });
      // A superseded directive stops being tracked; whatever state it was in, it is closed as superseded.
      const prev = r.supersedes ? await this.row(r.supersedes, { lock: true }) : null;
      const prevLast = new Map<string, { at: Date; fh: number; fc: number }>();
      if (prev?.requirementId && r.repetitive && prev.repetitive) {
        // Repetitive: its last compliance (or its own start) per aircraft carries over, so the clock is never reset.
        // One-time: the new revision counts from its own effective date (whether earlier compliance satisfies it
        // is an engineering decision recorded as compliance, never assumed).
        const comp = await this.db.db.select().from(compliance).where(eq(compliance.requirementId, prev.requirementId));
        for (const c of comp) { const x = prevLast.get(c.tail); if (!x || c.doneAt > x.at) prevLast.set(c.tail, { at: c.doneAt, fh: c.fh, fc: c.fc }); }
        const starts = await this.db.db.select().from(requirementStart).where(eq(requirementStart.requirementId, prev.requirementId));
        for (const st of starts) if (!prevLast.has(st.tail)) prevLast.set(st.tail, { at: st.at, fh: st.fh, fc: st.fc });
      }
      // Counting starts on the effective date (or from the previous AD's compliance, if earlier).
      const effectiveAt = new Date(`${r.effective}T00:00:00Z`);
      const estimated: string[] = [];
      for (const tail of tails) {
        const c = await this.programme.countersAt(tail, effectiveAt);
        if (!c) continue;
        if (c.estimated) estimated.push(tail);
        const start = supersedingStart({ at: c.at, fh: c.fh, fc: c.fc }, prevLast.get(tail) ?? null);
        await this.db.db.insert(requirementStart).values({ requirementId: reqId, tail, at: start.at, fh: start.fh, fc: start.fc });
      }
      let superseded: string | null = null;
      if (prev) {
        if (prev.requirementId) {
          await this.db.db.update(requirements).set({ active: false }).where(eq(requirements.id, prev.requirementId));
          superseded = prev.requirementId;
        }
        const closed = supersede(toDomain(prev));
        await this.db.db.update(directives).set({ status: closed.status, version: closed.version }).where(eq(directives.id, prev.id));
        await this.audit.record(this.db, CHAIN, {
          operatorId: r.operatorId, actor: actorOf(p), action: 'directive.superseded', entityType: 'directive', entityId: prev.id,
          data: { ref: prev.ref, by: r.id, previousStatus: prev.status, requirementDeactivated: superseded, carriedOver: [...prevLast.keys()] }
        });
      }
      await this.db.db.update(directives).set({ status: next.status, incorporatedBy: next.incorporatedBy, incorporatedAt: next.incorporatedAt, requirementId: reqId, version: next.version })
        .where(eq(directives.id, id));
      await this.audit.record(this.db, CHAIN, {
        operatorId: r.operatorId, actor: actorOf(p), action: 'directive.incorporated', entityType: 'directive', entityId: id,
        data: { ref: r.ref, requirementId: reqId, tails, interval: req.interval, repetitive: req.repetitive, evaluatedBy: r.evaluatedBy, supersededRequirement: superseded,
          // Effective before the aircraft's records start here: start counters back-estimated from utilisation.
          estimatedStart: estimated }
      });
      return r.operatorId;
    });
    // The new requirement may already be due (or overdue) on some aircraft.
    await this.programme.sweepAirworthiness(operatorId);
    return this.get(p, id);
  }

  /**
   * Hourly: aircraft that joined the fleet after a directive was evaluated get their applicability worked out.
   * An incorporated AD/SB starts being tracked on a newly affected aircraft at once (from its effective date —
   * the safe side) and CAMO is told to confirm; a closed "not applicable" decision is reopened for evaluation.
   */
  async reviewFleet(): Promise<{ reopened: string[]; extended: string[]; failed: string[] }> {
    const out = { reopened: [] as string[], extended: [] as string[], failed: [] as string[] };
    const rows = await this.db.db.select().from(directives).where(sql`${directives.status} not in ('REJECTED', 'SUPERSEDED')`);
    const fleets = new Map<string, { reg: string; type: string; msn: string }[]>();
    for (const r of rows) {
      if (!fleets.has(r.operatorId)) fleets.set(r.operatorId, (await this.fleet.list(r.operatorId)).map(f => ({ reg: f.reg, type: f.type, msn: f.msn })));
      const fleet = fleets.get(r.operatorId)!;
      const knownTails = async () => new Set((await this.db.db.select({ tail: directiveTails.tail }).from(directiveTails).where(eq(directiveTails.directiveId, r.id))).map(t => t.tail));
      const before = await knownTails();
      if (!fleet.some(f => !before.has(f.reg))) continue;
      try { await this.db.transaction(async () => {
        const cur = await this.row(r.id, { lock: true });
        // Recomputed under the lock: an evaluation in between may already have covered the new aircraft.
        const known = await knownTails();
        const fresh = applicability(toDomain(cur), fleet.filter(f => !known.has(f.reg)));
        if (!fresh.length) return;
        for (const t of fresh) await this.db.db.insert(directiveTails).values({ directiveId: r.id, ...t }).onConflictDoNothing();
        const affected = fresh.filter(t => t.applicable).map(t => t.tail);
        if (!affected.length) return;
        if (cur.status === 'INCORPORATED' && cur.requirementId) {
          const [req] = await this.db.db.select().from(requirements).where(eq(requirements.id, cur.requirementId)).for('update');
          if (req?.tails) await this.db.db.update(requirements).set({ tails: [...new Set([...req.tails, ...affected])] }).where(eq(requirements.id, req.id));
          for (const tail of affected) {
            const c = await this.programme.countersAt(tail, new Date(`${cur.effective}T00:00:00Z`));
            if (c) await this.db.db.insert(requirementStart).values({ requirementId: cur.requirementId, tail, at: c.at, fh: c.fh, fc: c.fc }).onConflictDoNothing();
          }
          out.extended.push(cur.id);
        } else if (cur.status === 'NOT_APPLICABLE' || cur.status === 'NOT_APPLICABLE_PENDING' || cur.status === 'EVALUATED' || cur.status === 'DEFERRED') {
          await this.db.db.update(directives).set({ status: 'RECEIVED', version: cur.version + 1, confirmedBy: null, confirmedAt: null }).where(eq(directives.id, cur.id));
          out.reopened.push(cur.id);
        }
        await this.audit.record(this.db, CHAIN, {
          operatorId: cur.operatorId, actor: 'system:camo', action: 'directive.fleet_changed', entityType: 'directive', entityId: cur.id,
          data: { ref: cur.ref, newlyAffected: affected, previousStatus: cur.status, tracked: cur.status === 'INCORPORATED' }
        });
        await this.notifications.raise(this.db, {
          operatorId: cur.operatorId, actor: 'system:camo', severity: 'red', link: link(cur.id),
          title: `${cur.ref} applies to ${affected.join(', ')}`,
          body: cur.status === 'INCORPORATED' ? 'Now tracked on the due list from its effective date — confirm the applicability.' : 'Aircraft added to the fleet: evaluate it again.'
        });
      }); } catch (e) {
        // One bad directive must not stop the review of the others; it is retried next hour.
        out.failed.push(`${r.id}: ${(e as Error).message}`);
      }
    }
    return out;
  }
}
