import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RecoveryRunDto, RecoverySolution } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { buildProblem, cancelFlight, changeTail, checkSolution, delayFlight, solutionChanges, type Flight } from '@aeroos/ops-domain';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { OutboxService } from '../../platform/events/outbox';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { TemporalService } from '../../platform/workflows/temporal.service';
import { CHAIN, FlightOpsService, MIN_TURN_MINUTES } from './flight-ops.service';
import { Metrics } from '../../platform/observability/metrics';
import { OpsRepository } from './ops.repository';

const H = 3_600_000;
const STALE_RUNNING_MS = 10 * 60_000;
type RunRow = Awaited<ReturnType<OpsRepository['run']>>;

const runDto = (r: RunRow): RecoveryRunDto => ({
  id: r.id, status: r.status as RecoveryRunDto['status'], requestedBy: r.requestedBy, createdAt: r.createdAt.toISOString(),
  window: { from: r.windowFrom.toISOString(), to: r.windowTo.toISOString() }, solver: r.solver, objective: r.objective,
  wallSeconds: r.wallSeconds, changes: r.changes, error: r.error, decidedBy: r.decidedBy
});

/**
 * Disruption recovery. The OCC asks; the Python optimiser (OR-Tools CP-SAT, Temporal task queue
 * "optimiser") proposes; this service re-checks the proposal independently; a controller accepts it;
 * it is applied only if none of the flights changed in the meantime (versions are in the problem).
 */
@Injectable()
export class RecoveryService {
  private readonly log = new Logger('Recovery');

  constructor(
    @Inject(DB_TOKEN.ops) private readonly db: ModuleDb,
    private readonly repo: OpsRepository,
    private readonly flights: FlightOpsService,
    private readonly temporal: TemporalService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService
  ) {}

  private resource(operatorId: string, id = '*') {
    return { kind: 'recovery' as const, id, attr: { operatorId } };
  }

  async start(p: Principal, body: { hours?: number }): Promise<RecoveryRunDto> {
    await this.authz.check(p, this.resource(p.operatorId), 'run');
    const now = new Date();
    const window = { from: now, to: new Date(now.getTime() + Math.min(48, Math.max(2, body.hours ?? 24)) * H) };
    const [flights, tails] = await Promise.all([
      this.repo.flightsBetween(p.operatorId, new Date(now.getTime() - 24 * H), window.to),
      this.flights.tails(p.operatorId, now)
    ]);
    const id = await this.repo.nextRunId();
    const problem = buildProblem(id, flights, [...tails.values()].map(t => ({ reg: t.reg, type: t.type, dispatchable: t.dispatchable, base: 'ENGM' })), window,
      { minTurnMinutes: MIN_TURN_MINUTES, maxDelayMinutes: 240 });
    if (!problem.flights.length) throw new DomainError('NOTHING_TO_RECOVER', 'No changeable flights in the window', 422);
    await this.repo.insertRun({
      id, operatorId: p.operatorId, status: 'RUNNING', windowFrom: window.from, windowTo: window.to, problem, changes: [], requestedBy: actorOf(p)
    });
    try {
      await this.temporal.startRecovery(id, problem);
    } catch (e) {
      await this.repo.updateRun(id, { status: 'FAILED', error: `Could not start the optimiser workflow: ${(e as Error).message}` });
    }
    return runDto(await this.repo.run(id));
  }

  private async expireStale(r: RunRow): Promise<RunRow> {
    if (r.status === 'RUNNING' && Date.now() - r.createdAt.getTime() > STALE_RUNNING_MS) {
      await this.repo.updateRun(r.id, { status: 'FAILED', error: 'The optimiser did not answer within 10 minutes (is the optimiser worker running?)' }, 'RUNNING');
      return this.repo.run(r.id);
    }
    return r;
  }

  async list(p: Principal): Promise<RecoveryRunDto[]> {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    const rows = await this.repo.runs(p.operatorId);
    return Promise.all(rows.map(async r => runDto(await this.expireStale(r))));
  }

  async get(p: Principal, id: string): Promise<RecoveryRunDto> {
    const r = await this.repo.run(id);
    await this.authz.check(p, this.resource(r.operatorId, id), 'read');
    return runDto(await this.expireStale(r));
  }

  /** Internal: the Python workflow reports its result (or failure) here. */
  async result(id: string, body: { solution?: RecoverySolution; error?: string }) {
    const r = await this.repo.run(id);
    if (r.status !== 'RUNNING') return { accepted: false, reason: `run is ${r.status}` };
    if (body.error || !body.solution) {
      await this.repo.updateRun(id, { status: 'FAILED', error: body.error ?? 'No solution returned' }, 'RUNNING');
      Metrics.recoveryRuns.add(1, { kind: 'flight', status: 'FAILED' });
      return { accepted: false };
    }
    const issues = checkSolution(r.problem, body.solution);
    if (issues.length) {
      this.log.warn(`rejected solver result for ${id}: ${issues.join('; ')}`);
      await this.repo.updateRun(id, { status: 'FAILED', error: `Solver result failed the independent check: ${issues.slice(0, 3).join('; ')}`, solution: body.solution }, 'RUNNING');
      Metrics.recoveryRuns.add(1, { kind: 'flight', status: 'CHECK_FAILED' });
      return { accepted: false };
    }
    const changes = solutionChanges(r.problem, body.solution);
    await this.db.transaction(async () => {
      if (!(await this.repo.updateRun(id, {
        status: 'PROPOSED', solution: body.solution, changes, solver: body.solution!.solver, objective: body.solution!.objective, wallSeconds: body.solution!.wallSeconds
      }, 'RUNNING'))) return;
      await this.outbox.add(this.db, { type: 'ops.recovery.proposed', data: { runId: id, solver: body.solution!.solver, objective: body.solution!.objective, changes: changes.length } },
        { operatorId: r.operatorId, actor: 'system:optimiser' });
      await this.notifications.raise(this.db, {
        operatorId: r.operatorId, actor: 'system:optimiser', severity: 'cyan', link: `/ops/occ?run=${id}`,
        title: `Recovery proposal ${id} ready`, body: `${changes.length} change(s) · ${body.solution!.solver} · ${body.solution!.status.toLowerCase()}`
      });
    });
    Metrics.recoveryRuns.add(1, { kind: 'flight', status: 'PROPOSED' });
    return { accepted: true };
  }

  async accept(p: Principal, id: string): Promise<RecoveryRunDto> {
    const r0 = await this.repo.run(id);
    await this.authz.check(p, this.resource(r0.operatorId, id), 'decide');
    const actor = actorOf(p);
    const tails = await this.flights.tails(r0.operatorId);
    await this.db.transaction(async () => {
      const r = await this.repo.run(id, { lock: true });
      if (r.status !== 'PROPOSED') throw new DomainError('RUN_NOT_PROPOSED', `${id} is ${r.status.toLowerCase()}`, 409);
      // Every flight the solver reasoned about must be as it was: a change to any of them (not only the
      // ones the proposal touches) can make the plan infeasible.
      const current = new Map((await this.repo.flightsByIds(r.problem.flights.map(f => f.id), { lock: true })).map(f => [f.id, f]));
      const changed = r.problem.flights.filter(pf => current.get(pf.id)?.version !== pf.version);
      if (changed.length) {
        await this.repo.updateRun(id, { status: 'STALE', decidedBy: actor, decidedAt: new Date(), error: `Schedule changed since the proposal (${changed.map(c => c.flightNo).join(', ')}); run the optimiser again` });
        return;
      }
      for (const c of r.changes) {
        let f: Flight = current.get(c.flightId)!;
        const before = f.version;
        if (c.kind === 'CANCEL') {
          const x = cancelFlight(f, `Recovery ${id}`);
          f = x.flight;
          await this.outbox.add(this.db, x.event, { operatorId: f.operatorId, actor, correlationId: id });
        } else {
          if (c.toTail && c.toTail !== f.tail) {
            const t = tails.get(c.toTail);
            if (!t) throw new DomainError('TAIL_UNKNOWN', `${c.toTail} is not in the fleet`, 404);
            const x = changeTail(f, t);
            f = x.flight;
            await this.outbox.add(this.db, x.event, { operatorId: f.operatorId, actor, correlationId: id });
          }
          if (c.delayMinutes !== f.delayMinutes) {
            const x = delayFlight(f, [], c.delayMinutes, `Recovery ${id}`, MIN_TURN_MINUTES);
            f = x.flight;
            await this.outbox.add(this.db, x.event, { operatorId: f.operatorId, actor, correlationId: id });
          }
        }
        await this.repo.updateFlight(f, before);
        await this.audit.record(this.db, CHAIN, { operatorId: f.operatorId,
          actor, action: 'flight.recovered', entityType: 'flight', entityId: f.id,
          data: { runId: id, kind: c.kind, fromTail: c.fromTail, toTail: c.toTail, delayMinutes: c.delayMinutes }
        });
      }
      await this.repo.updateRun(id, { status: 'ACCEPTED', decidedBy: actor, decidedAt: new Date() });
      await this.audit.record(this.db, CHAIN, { operatorId: r.operatorId,
        actor, action: 'recovery.accepted', entityType: 'recovery_run', entityId: id,
        data: { solver: r.solver, objective: r.objective, changes: r.changes.length }
      });
      await this.outbox.add(this.db, { type: 'ops.recovery.applied', data: { runId: id, changes: r.changes.length } }, { operatorId: r.operatorId, actor });
    });
    return runDto(await this.repo.run(id));
  }

  async reject(p: Principal, id: string): Promise<RecoveryRunDto> {
    const r = await this.repo.run(id);
    await this.authz.check(p, this.resource(r.operatorId, id), 'decide');
    if (!(await this.repo.updateRun(id, { status: 'REJECTED', decidedBy: actorOf(p), decidedAt: new Date() }, 'PROPOSED'))) {
      throw new DomainError('RUN_NOT_PROPOSED', `${id} is ${r.status.toLowerCase()}`, 409);
    }
    return runDto(await this.repo.run(id));
  }
}
