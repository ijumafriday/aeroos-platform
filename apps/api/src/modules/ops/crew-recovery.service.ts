import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CrewRecoveryProblem, CrewRecoveryRunDto, CrewRecoverySolution, RecoveryRunStatus } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { buildCrewProblem, buildDuties, canChange, checkCrewSolution, coverVerdict, crewTasks, occupancyOf, positionHome, type CrewRecord, type CrewRosterLeg } from '@aeroos/ops-domain';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { OutboxService } from '../../platform/events/outbox';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { TemporalService } from '../../platform/workflows/temporal.service';
import { CrewService } from './crew.service';
import { CHAIN } from './flight-ops.service';
import { Metrics } from '../../platform/observability/metrics';
import { OpsRepository } from './ops.repository';

const DAY = 86_400_000;
const STALE_RUNNING_MS = 10 * 60_000;
const PROPOSAL_TTL_MS = 60 * 60_000;
type RunRow = Awaited<ReturnType<OpsRepository['crewRun']>>;

const runDto = (r: RunRow): CrewRecoveryRunDto => {
  const p = r.problem;
  const chosen = new Map<string, string>((r.solution?.assignments ?? []).map(a => [a.taskId, a.crewId]));
  const cand = new Map<string, CrewRecoveryProblem['candidates'][number]>(p.candidates.map(c => [c.crewId, c]));
  return {
    id: r.id, status: r.status as RecoveryRunStatus, requestedBy: r.requestedBy, createdAt: r.createdAt.toISOString(),
    solver: r.solver, objective: r.objective, wallSeconds: r.wallSeconds, error: r.error, decidedBy: r.decidedBy,
    tasks: p.tasks.map(t => {
      const crewId = chosen.get(t.id);
      const o = crewId ? p.options.find(x => x.taskId === t.id && x.crewId === crewId) : undefined;
      const c = crewId ? cand.get(crewId) : undefined;
      return { ...t, options: p.options.filter(x => x.taskId === t.id).length, cover: o && c ? { crewId: c.crewId, name: c.name, kind: c.kind, ftl: o.ftl, note: o.note } : null };
    })
  };
};

/**
 * Crew recovery: find duties that now break a flight-time limitation, list every standby/reserve crew
 * member who could legally take over (the rulepack decides, here), let the optimiser pick the cheapest
 * combination, re-check, and re-crew on acceptance — only if nobody's roster changed in between.
 */
@Injectable()
export class CrewRecoveryService {
  private readonly log = new Logger('CrewRecovery');

  constructor(
    @Inject(DB_TOKEN.ops) private readonly db: ModuleDb,
    private readonly repo: OpsRepository,
    private readonly crew: CrewService,
    private readonly temporal: TemporalService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService
  ) {}

  private resource(operatorId: string, id = '*') {
    return { kind: 'crew_roster' as const, id, attr: { operatorId } };
  }

  private async rosters(operatorId: string, now: Date) {
    const crew: CrewRecord[] = (await this.repo.crew(operatorId)).map(c => ({ id: c.id, name: c.name, rank: c.rank as 'CPT' | 'FO', base: c.base, qualifications: c.qualifications }));
    const legs = await this.repo.legsFor(crew.map(c => c.id), new Date(now.getTime() - 365 * DAY), new Date(now.getTime() + 7 * DAY));
    const rosters = new Map<string, CrewRosterLeg[]>(crew.map(c => [c.id, []]));
    for (const l of legs) rosters.get(l.crewId)?.push({ crewId: l.crewId, role: l.role as 'CPT' | 'FO', dutyKey: l.dutyKey, positioning: l.positioning, flight: l.flight });
    // The operator's own flights in the next two days: seats for positioning crew to an outstation hand-over.
    const network = await this.repo.flightsBetween(operatorId, now, new Date(now.getTime() + 2 * DAY));
    return { crew, rosters, network };
  }

  async start(p: Principal): Promise<CrewRecoveryRunDto> {
    await this.authz.check(p, this.resource(p.operatorId), 'recover');
    const now = new Date();
    const { crew, rosters, network } = await this.rosters(p.operatorId, now);
    const schemes = await this.crew.schemes();
    const judge = this.crew.judge(p.operatorId, now);
    const violations = new Map(crew.map(c => [c.id, this.crew.violations(p.operatorId, buildDuties(rosters.get(c.id)!, schemes(c.base)), now)]));
    const tasks = crewTasks(crew, rosters, violations, now, schemes, judge);
    if (!tasks.length) throw new DomainError('NOTHING_TO_RECOVER', 'No upcoming crew duty breaks a flight-time limitation', 422);
    const standby = (await this.repo.standbyBetween(crew.map(c => c.id), new Date(now.getTime() - DAY), new Date(now.getTime() + 3 * DAY)))
      .map(s => ({ crewId: s.crewId, start: s.startAt, end: s.endAt }));
    const id = await this.repo.nextCrewRunId();
    const problem = buildCrewProblem(id, tasks, crew, rosters, standby, schemes, judge, undefined, network, now);
    await this.repo.insertCrewRun({ id, operatorId: p.operatorId, status: 'RUNNING', problem, requestedBy: actorOf(p) });
    try {
      await this.temporal.startCrewRecovery(id, problem);
    } catch (e) {
      await this.repo.updateCrewRun(id, { status: 'FAILED', error: `Could not start the optimiser workflow: ${(e as Error).message}` });
    }
    return runDto(await this.repo.crewRun(id));
  }

  private async expireStale(r: RunRow): Promise<RunRow> {
    // A proposal is about a moment in the operation; after an hour it is no longer a basis for re-crewing.
    if (r.status === 'PROPOSED' && Date.now() - r.createdAt.getTime() > PROPOSAL_TTL_MS) {
      await this.repo.updateCrewRun(r.id, { status: 'STALE', error: 'Proposal older than 60 minutes; run crew recovery again' }, 'PROPOSED');
      return this.repo.crewRun(r.id);
    }
    if (r.status === 'RUNNING' && Date.now() - r.createdAt.getTime() > STALE_RUNNING_MS) {
      await this.repo.updateCrewRun(r.id, { status: 'FAILED', error: 'The optimiser did not answer within 10 minutes (is the optimiser worker running?)' }, 'RUNNING');
      return this.repo.crewRun(r.id);
    }
    return r;
  }

  async list(p: Principal): Promise<CrewRecoveryRunDto[]> {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    return Promise.all((await this.repo.crewRuns(p.operatorId)).map(async r => runDto(await this.expireStale(r))));
  }

  /** Internal: the Python workflow reports here. */
  async result(id: string, body: { solution?: CrewRecoverySolution; error?: string }) {
    const r = await this.repo.crewRun(id);
    if (r.status !== 'RUNNING') return { accepted: false, reason: `run is ${r.status}` };
    if (body.error || !body.solution) {
      await this.repo.updateCrewRun(id, { status: 'FAILED', error: body.error ?? 'No solution returned' }, 'RUNNING');
      Metrics.recoveryRuns.add(1, { kind: 'crew', status: 'FAILED' });
      return { accepted: false };
    }
    const issues = checkCrewSolution(r.problem, body.solution);
    if (issues.length) {
      this.log.warn(`rejected crew solver result for ${id}: ${issues.join('; ')}`);
      await this.repo.updateCrewRun(id, { status: 'FAILED', error: `Solver result failed the independent check: ${issues.slice(0, 3).join('; ')}`, solution: body.solution }, 'RUNNING');
      Metrics.recoveryRuns.add(1, { kind: 'crew', status: 'CHECK_FAILED' });
      return { accepted: false };
    }
    const s = body.solution;
    await this.db.transaction(async () => {
      if (!(await this.repo.updateCrewRun(id, { status: 'PROPOSED', solution: s, solver: s.solver, objective: s.objective, wallSeconds: s.wallSeconds }, 'RUNNING'))) return;
      const uncovered = r.problem.tasks.length - s.assignments.length;
      await this.notifications.raise(this.db, {
        operatorId: r.operatorId, actor: 'system:optimiser', severity: uncovered ? 'amber' : 'cyan', link: `/ops/crew?run=${id}`,
        title: `Crew recovery ${id} ready`, body: `${s.assignments.length} of ${r.problem.tasks.length} duties covered${uncovered ? ` · ${uncovered} need a decision` : ''}`
      });
    });
    Metrics.recoveryRuns.add(1, { kind: 'crew', status: 'PROPOSED' });
    return { accepted: true };
  }

  async accept(p: Principal, id: string): Promise<CrewRecoveryRunDto> {
    const r0 = await this.repo.crewRun(id);
    await this.authz.check(p, this.resource(r0.operatorId, id), 'recover');
    const actor = actorOf(p);
    const now = new Date();
    await this.db.transaction(async () => {
      await this.repo.lockCrewRecovery(r0.operatorId);
      const r = await this.repo.crewRun(id, { lock: true });
      if (r.status === 'PROPOSED' && now.getTime() - r.createdAt.getTime() > PROPOSAL_TTL_MS) {
        await this.repo.updateCrewRun(id, { status: 'STALE', decidedBy: actor, decidedAt: now, error: 'Proposal older than 60 minutes; run crew recovery again' });
        return;
      }
      if (r.status !== 'PROPOSED' || !r.solution) throw new DomainError('RUN_NOT_PROPOSED', `${id} is ${r.status.toLowerCase()}`, 409);
      const flightIds = r.problem.tasks.flatMap(t => t.flightIds);
      const current = (await this.repo.assignmentsOn(flightIds, { lock: true })).map(a => `${a.flightId}|${a.crewId}`).sort();
      const snapshot = r.problem.snapshot.map(a => `${a.flightId}|${a.crewId}`).sort();
      const stale = (reason: string) => this.repo.updateCrewRun(id, { status: 'STALE', decidedBy: actor, decidedAt: now, error: reason });
      if (current.join() !== snapshot.join()) {
        await stale('Crew on these flights changed since the proposal; run crew recovery again');
        return;
      }
      // Legality is re-judged against the schedule as it is now (a delay since the proposal can change it),
      // with the same function that built the options.
      const { crew, rosters, network } = await this.rosters(r.operatorId, now);
      const byId = new Map(crew.map(c => [c.id, c]));
      const positioningFor = new Map<string, string[]>();
      const windows = (await this.repo.standbyBetween(r.solution.assignments.map(a => a.crewId), new Date(now.getTime() - 2 * DAY), new Date(now.getTime() + 3 * DAY)))
        .map(w => ({ crewId: w.crewId, start: w.startAt, end: w.endAt }));
      const schemes = await this.crew.schemes();
      const judge = this.crew.judge(r.operatorId, now);
      // Seats are tallied as each cover is confirmed: two covers cannot both take the last seat on a flight.
      const occupancy = occupancyOf([...rosters.values()].flat());
      const take = (ids: string[]) => { for (const f of ids) occupancy.set(f, (occupancy.get(f) ?? 0) + 1); };
      for (const a of r.solution.assignments) {
        const t = r.problem.tasks.find(x => x.id === a.taskId)!;
        const legs = (rosters.get(t.crewId) ?? []).filter(l => t.flightIds.includes(l.flight.id) && !l.positioning).map(l => l.flight).sort((x, y) => x.etd.getTime() - y.etd.getTime());
        const cand = byId.get(a.crewId);
        if (legs.length !== t.flightIds.length || !cand) {
          await stale(`The duty ${t.flightNos.join('/')} or ${a.crewId} changed since the proposal`);
          return;
        }
        // Only legs that have not left and are not cancelled can be re-crewed.
        const gone = legs.filter(l => !canChange(l) || l.etd.getTime() <= now.getTime());
        if (gone.length) {
          await stale(`${gone.map(l => l.flightNo).join(', ')} can no longer be re-crewed (${gone[0].status.toLowerCase()} or past departure)`);
          return;
        }
        const verdict = coverVerdict({ dutyKey: t.dutyKey, legs }, cand, rosters.get(a.crewId) ?? [], windows.filter(w => w.crewId === a.crewId), schemes, judge, undefined, network, now, occupancy);
        if (!verdict) {
          await stale(`${a.crewId} is no longer a legal cover for ${t.flightNos.join('/')} under the current schedule`);
          return;
        }
        positioningFor.set(a.taskId, verdict.positioning.map(f => f.id));
        take(verdict.positioning.map(f => f.id));
      }
      for (const a of r.solution.assignments) {
        const t = r.problem.tasks.find(x => x.id === a.taskId)!;
        await this.repo.reassign(t.crewId, a.crewId, t.flightIds, `${t.dutyKey}:cover:${a.crewId}`);
        const positioning = positioningFor.get(a.taskId) ?? [];
        await this.repo.addPositioning(a.crewId, positioning, t.rank, `${t.dutyKey}:cover:${a.crewId}`);
        // Handed over away from base: bring the original crew member home when a legal flight exists.
        const original = byId.get(t.crewId);
        const legsNow = (rosters.get(t.crewId) ?? []).filter(l => t.flightIds.includes(l.flight.id) && !l.positioning).map(l => l.flight).sort((x, y) => x.etd.getTime() - y.etd.getTime());
        // The original crew member's positioning in this duty after the hand-over no longer applies.
        const obsolete = (rosters.get(t.crewId) ?? []).filter(l => l.positioning && l.dutyKey === t.dutyKey && legsNow[0] && l.flight.etd.getTime() >= legsNow[0].etd.getTime());
        await this.repo.dropPositioning(t.crewId, t.dutyKey, obsolete.map(l => l.flight.id));
        for (const l of obsolete) occupancy.set(l.flight.id, Math.max(0, (occupancy.get(l.flight.id) ?? 0) - 1));
        const home = original ? positionHome({ dutyKey: t.dutyKey, legs: legsNow }, original, rosters.get(t.crewId) ?? [], network, schemes, judge, occupancy) : null;
        if (home) take([home.id]);
        if (home) await this.repo.addPositioning(t.crewId, [home.id], t.rank, t.dutyKey);
        await this.audit.record(this.db, CHAIN, { operatorId: r.operatorId,
          actor, action: 'crew.reassigned', entityType: 'crew_duty', entityId: t.dutyKey,
          data: { runId: id, flights: t.flightNos, role: t.rank, from: t.crewId, to: a.crewId, reason: t.reason, positioning, originalHome: home?.flightNo ?? null }
        });
        await this.outbox.add(this.db, { type: 'ops.crew.reassigned', data: { runId: id, flightIds: t.flightIds, fromCrew: t.crewId, toCrew: a.crewId, role: t.rank } },
          { operatorId: r.operatorId, actor, correlationId: id });
      }
      await this.repo.updateCrewRun(id, { status: 'ACCEPTED', decidedBy: actor, decidedAt: now });
      await this.audit.record(this.db, CHAIN, { operatorId: r.operatorId, actor, action: 'crew_recovery.accepted', entityType: 'crew_recovery_run', entityId: id, data: { solver: r.solver, objective: r.objective, covered: r.solution.assignments.length } });
    });
    return runDto(await this.repo.crewRun(id));
  }

  async reject(p: Principal, id: string): Promise<CrewRecoveryRunDto> {
    const r = await this.repo.crewRun(id);
    await this.authz.check(p, this.resource(r.operatorId, id), 'recover');
    if (!(await this.repo.updateCrewRun(id, { status: 'REJECTED', decidedBy: actorOf(p), decidedAt: new Date() }, 'PROPOSED'))) {
      throw new DomainError('RUN_NOT_PROPOSED', `${id} is ${r.status.toLowerCase()}`, 409);
    }
    return runDto(await this.repo.crewRun(id));
  }
}
