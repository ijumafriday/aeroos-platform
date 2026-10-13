import { OpsKpis } from './kpis';
import { Body, Controller, Get, Inject, Injectable, Logger, Module, OnApplicationBootstrap, Param, Post, Query, UseGuards, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { TOPICS, type CrewRecoverySolution, type RecoverySolution } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { DEMO_CREW, DEMO_ROTATIONS, DEMO_STANDBY_CREW, demoDay, demoStandby, FJR_CREW, FJR_ROTATIONS } from '@aeroos/ops-domain';
import { CONFIG, type Config } from '../../config';
import { CurrentPrincipal, Public, type Principal } from '../../platform/auth/principal';
import { InternalGuard } from '../../platform/auth/guards';
import { KafkaService } from '../../platform/events/kafka.service';
import { ZodPipe } from '../../platform/http/http';
import { CamoModule } from '../camo/camo.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { CrewRecoveryService } from './crew-recovery.service';
import { CrewService } from './crew.service';
import { FlightOpsService } from './flight-ops.service';
import { OpsRepository } from './ops.repository';
import { DispatchController, DispatchService } from './dispatch.service';
import { FlightWatchController, FlightWatchService } from './flight-watch.service';
import { CrewHubController, CrewHubService, FatigueController, FatigueService, RosterController, RosteringService } from './rostering.service';
import { Integration, MovementKeyGuard, MovementService, type IntegrationCaller } from './movement.service';
import { RecoveryService } from './recovery.service';
import { OpsSearch } from './ops.search';
import { OpsCrewMigration, OpsFlightScheduleMigration } from './ops.migration';
import { OperationalPlanningController, OperationalPlanningService, OpsPlanningIntegrationController, FrmsIntegrationController, OpsProviderKeyGuard, FrmsProviderKeyGuard } from './operational-planning.service';
import { OperationsControlController, OperationsControlService } from './operations-control.service';
import { CrewControlController, CrewControlService } from './crew-control.service';

const H = 3_600_000;
const delaySchema = z.object({ delayMinutes: z.number().int().min(0).max(1440), reason: z.string().trim().max(200) });
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(200) });
const tailSchema = z.object({ tail: z.string().min(2).max(10) });
const recoverySchema = z.object({ hours: z.number().int().min(2).max(48).optional() });
const mvtSchema = z.object({ text: z.string().trim().min(10).max(4000) });
/** Raw MVT text from a datalink provider (Content-Type: text/plain), validated with the gateway's error codes. */
class MvtTextPipe implements PipeTransform<unknown, string> {
  transform(body: unknown): string {
    if (typeof body !== 'string' || !body.trim()) throw new DomainError('MVT_EMPTY', 'Send MVT text with Content-Type: text/plain');
    if (body.length > 64_000) throw new DomainError('MVT_TOO_LARGE', 'At most 64 kB per request');
    return body;
  }
}
const acarsSchema = z.object({
  events: z.array(z.object({
    flightNo: z.string().regex(/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/), day: z.number().int().min(1).max(31), reg: z.string().min(2).max(10),
    event: z.enum(['OUT', 'OFF', 'ON', 'IN']), time: z.string().regex(/^\d{4}(\d{2})?$|^\d{6}$/)
  })).min(1).max(200)
});
const resultSchema = z.object({ solution: z.any().optional(), error: z.string().max(2000).optional() });
const solverMeta = { runId: z.string(), solver: z.enum(['cp-sat', 'greedy']), status: z.enum(['OPTIMAL', 'FEASIBLE']), objective: z.number(), wallSeconds: z.number() };
const crewResultSchema = z.object({
  solution: z.object({ ...solverMeta, assignments: z.array(z.object({ taskId: z.string(), crewId: z.string() })).max(1000) }).optional(),
  error: z.string().max(2000).optional()
});

const parseDate = (v: string | undefined, fallback: Date) => {
  if (!v) return fallback;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new DomainError('BAD_DATE', `Not a date: ${v}`);
  return d;
};

@Controller('ops')
export class OpsController {
  constructor(private readonly flights: FlightOpsService, private readonly crew: CrewService, private readonly recovery: RecoveryService, private readonly repo: OpsRepository, private readonly movements: MovementService,
    private readonly crewRecovery: CrewRecoveryService) {}

  @Get('airports')
  airports() {
    return this.repo.airports();
  }

  /** Default window: 6 h back, 30 h ahead. */
  @Get('timeline')
  timeline(@CurrentPrincipal() p: Principal, @Query('from') from?: string, @Query('to') to?: string) {
    const now = Date.now();
    return this.flights.timeline(p, parseDate(from, new Date(now - 6 * H)), parseDate(to, new Date(now + 30 * H)));
  }

  @Get('flights/:id')
  flight(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.flights.detail(p, id);
  }

  @Post('flights/:id/delay')
  delay(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(delaySchema)) body: z.infer<typeof delaySchema>) {
    return this.flights.delay(p, id, body);
  }

  @Post('flights/:id/cancel')
  cancel(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return this.flights.cancel(p, id, body.reason);
  }

  @Post('flights/:id/tail')
  tail(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(tailSchema)) body: z.infer<typeof tailSchema>) {
    return this.flights.swapTail(p, id, body.tail);
  }

  /** OCC: a controller pastes an MVT (e.g. one phoned in by the station). */
  @Post('movements')
  movement(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(mvtSchema)) body: z.infer<typeof mvtSchema>) {
    return this.movements.ingestFromOcc(p, body.text);
  }

  @Get('movements')
  movementLog(@CurrentPrincipal() p: Principal, @Query('flight') flight?: string) {
    return this.movements.log(p, flight);
  }

  @Get('crew-recovery')
  crewRuns(@CurrentPrincipal() p: Principal) {
    return this.crewRecovery.list(p);
  }

  @Post('crew-recovery')
  startCrewRecovery(@CurrentPrincipal() p: Principal) {
    return this.crewRecovery.start(p);
  }

  @Post('crew-recovery/:id/accept')
  acceptCrew(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.crewRecovery.accept(p, id);
  }

  @Post('crew-recovery/:id/reject')
  rejectCrew(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.crewRecovery.reject(p, id);
  }

  @Get('crew')
  crewList(@CurrentPrincipal() p: Principal) {
    return this.crew.list(p);
  }

  @Get('crew/:id')
  crewMember(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.crew.detail(p, id);
  }

  @Get('recovery')
  runs(@CurrentPrincipal() p: Principal) {
    return this.recovery.list(p);
  }

  @Post('recovery')
  startRecovery(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(recoverySchema)) body: z.infer<typeof recoverySchema>) {
    return this.recovery.start(p, body);
  }

  @Get('recovery/:id')
  run(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.recovery.get(p, id);
  }

  @Post('recovery/:id/accept')
  accept(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.recovery.accept(p, id);
  }

  @Post('recovery/:id/reject')
  reject(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.recovery.reject(p, id);
  }
}

/** For the Python optimiser workflow only. */
@Public()
@UseGuards(InternalGuard)
@Controller('internal/ops')
export class OpsInternalController {
  constructor(private readonly recovery: RecoveryService, private readonly flights: FlightOpsService, private readonly crewRecovery: CrewRecoveryService) {}

  /** Every 5 minutes: simulated movement for flights no MVT/ACARS has reported (MOVEMENT_SIMULATION=true). */
  @Post('progress')
  progress() {
    return this.flights.progress();
  }

  @Post('recovery/:id/result')
  result(@Param('id') id: string, @Body(new ZodPipe(resultSchema)) body: z.infer<typeof resultSchema>) {
    return this.recovery.result(id, { solution: body.solution as RecoverySolution | undefined, error: body.error });
  }

  @Post('crew-recovery/:id/result')
  crewResult(@Param('id') id: string, @Body(new ZodPipe(crewResultSchema)) body: z.infer<typeof crewResultSchema>) {
    return this.crewRecovery.result(id, { solution: body.solution as CrewRecoverySolution | undefined, error: body.error });
  }
}

/**
 * Movement messages from the network: a Type B gateway (SITA/ARINC) posts MVT text, an ACARS
 * datalink provider posts OOOI events. Authenticated per operator with the X-Api-Key header (MOVEMENT_API_KEYS).
 */
@Public()
@UseGuards(MovementKeyGuard)
@Controller('integrations/movements')
export class MovementIntegrationController {
  constructor(private readonly movements: MovementService) {}

  /** Content-Type text/plain: one or more MVT messages. */
  @Post('mvt')
  mvt(@Integration() caller: IntegrationCaller, @Body(new MvtTextPipe()) body: string) {
    return this.movements.ingestMvt(body, caller);
  }

  @Post('acars')
  acars(@Integration() caller: IntegrationCaller, @Body(new ZodPipe(acarsSchema)) body: z.infer<typeof acarsSchema>) {
    return this.movements.ingestAcars(body.events, caller);
  }
}

@Injectable()
export class OpsConsumers implements OnApplicationBootstrap {
  private readonly log = new Logger('OpsConsumers');
  constructor(private readonly kafka: KafkaService, private readonly flights: FlightOpsService) {}

  onApplicationBootstrap() {
    // From the beginning of the CAMO topic: a new deployment rebuilds the dispatch projection.
    this.kafka.start('ops.dispatch', [TOPICS.camo], env => this.flights.onCamoEvent(env));
    this.log.log('consumers started');
  }
}

/**
 * Demo schedule (SEED_DEMO=true): makes sure yesterday, today and the next two days exist, so the
 * OCC always has a live day. Idempotent (natural keys); never touches flights that already exist.
 */
@Injectable()
export class OpsDemoSchedule implements OnApplicationBootstrap {
  private readonly log = new Logger('OpsDemoSchedule');
  constructor(@Inject(CONFIG) private readonly config: Config, private readonly repo: OpsRepository) {}

  async onApplicationBootstrap() {
    if (!this.config.SEED_DEMO) return;
    try {
      await this.ensure();
    } catch (e) {
      this.log.warn(`demo schedule not created: ${(e as Error).message}`);
    }
    setInterval(() => void this.ensure().catch(() => undefined), 6 * H).unref();
  }

  private async ensure() {
    const networks = [
      { operatorId: 'NKX', rotations: DEMO_ROTATIONS, prefix: '', crew: [...DEMO_CREW, ...DEMO_STANDBY_CREW], standby: true },
      { operatorId: 'FJR', rotations: FJR_ROTATIONS, prefix: 'FJR-', crew: FJR_CREW, standby: false }
    ];
    let created = 0;
    for (const n of networks) {
      await this.repo.insertCrewIfAbsent(n.crew.map(c => ({ ...c, operatorId: n.operatorId, active: true })));
      // Yesterday to +2 days come crewed (the OCC's live days); +3 to +9 are left for the roster builder.
      for (let i = -1; i <= 9; i++) {
        const date = new Date(Date.now() + i * 24 * H).toISOString().slice(0, 10);
        const day = demoDay(date, n.rotations, n.prefix);
        created += await this.repo.insertFlightsIfAbsent(day.flights.map(f => ({
          id: f.id, operatorId: n.operatorId, flightNo: f.flightNo, opDate: f.date, dep: f.dep, arr: f.arr, std: f.std, sta: f.sta, etd: f.std, eta: f.sta,
          tail: f.tail, aircraftType: f.aircraftType, bookedPax: f.bookedPax
        })));
        await this.repo.backfillDemoLoads(day.flights.map(f => ({ id: f.id, bookedPax: f.bookedPax })));
        if (n.standby) await this.repo.insertStandbyIfAbsent(demoStandby(date).map(s => ({ crewId: s.crewId, startAt: s.start, endAt: s.end, base: 'ENGM', operatorId: n.operatorId, status: 'AVAILABLE' })));
        // Demo crew only for a day nobody has crewed yet: never on top of a roster or a crew-recovery hand-over.
        if (i <= 2 && !(await this.repo.dayHasCrew(n.operatorId, date))) {
          await this.repo.insertAssignmentsIfAbsent(day.assignments.map(a => ({ crewId: a.crewId, flightId: a.flightId, role: a.role, dutyKey: a.dutyKey })));
        }
      }
    }
    const d = (n: number) => new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + n * 24 * H);
    await this.repo.ensureCrewDemo('NKX', { crewId: 'CPT-01A', username: 'ola.hansen' }, { crewId: 'FO-02B', start: d(5), end: d(8) });
    if (created) this.log.log(`created ${created} demo flights`);
  }
}

@Module({
  imports: [ComplianceModule, CamoModule],
  providers: [OpsRepository, CrewService, FlightOpsService, RecoveryService, CrewRecoveryService, MovementService, MovementKeyGuard, DispatchService, FlightWatchService, RosteringService, FatigueService, CrewHubService, OpsKpis, OpsConsumers, OpsDemoSchedule, OpsSearch, OperationalPlanningService, OpsProviderKeyGuard, FrmsProviderKeyGuard, OpsCrewMigration, OpsFlightScheduleMigration, OperationsControlService, CrewControlService],
  controllers: [OpsController, OpsInternalController, MovementIntegrationController, DispatchController, FlightWatchController, RosterController, FatigueController, CrewHubController, OperationalPlanningController, OpsPlanningIntegrationController, FrmsIntegrationController, OperationsControlController, CrewControlController],
  exports: [OpsKpis]
})
export class OpsModule {}
