import { CamoKpis } from './kpis';
import { HealthController, HealthService } from './health.service';
import { Body, Controller, Get, Injectable, Logger, Module, OnApplicationBootstrap, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { TOPICS, type EventEnvelope, type FleetTailDto } from '@aeroos/contracts';
import { CurrentPrincipal, Public, type Principal } from '../../platform/auth/principal';
import { InternalGuard } from '../../platform/auth/guards';
import { KafkaService } from '../../platform/events/kafka.service';
import { assertionSchema } from '../../platform/passkeys/passkeys.service';
import { ZodPipe } from '../../platform/http/http';
import { TemporalService } from '../../platform/workflows/temporal.service';
import { ComplianceModule } from '../compliance/compliance.module';
import { FleetQuery, MelRepository } from './camo.repository';
import { MelService } from './mel.service';
import { ProgrammeService } from './programme.service';
import { DirectivesService } from './directives.service';
import { ComponentsService } from './components.service';
import { CamoSearch } from './camo.search';
import { CamoFleetMigration } from './camo.migration';
import { ReliabilityControlController, ReliabilityControlService } from './reliability-control.service';

/** Public query surface for other modules (AMO, Ops). */
export { FleetQuery } from './camo.repository';

const raiseSchema = z.object({
  tail: z.string().min(2).max(10),
  melRef: z.string().regex(/^\d{2}-\d{2}-\d{2}$/, 'MEL reference must look like 33-42-01'),
  description: z.string().min(3).max(500)
});
const justification = z.string().min(10, 'Give the operational justification (10+ characters)').max(1000);
const extensionSchema = z.object({ justification, passkey: z.object({ challengeId: z.string().uuid(), assertion: assertionSchema }).optional() });
const extensionChallengeSchema = z.object({ justification });
const escalationSchema = z.object({ level: z.enum(['T-24h', 'T-6h', 'EXPIRED']) });
const wpCreateSchema = z.object({
  tail: z.string().min(2).max(10), requirementIds: z.array(z.string().min(1)).min(1).max(50),
  title: z.string().trim().max(120).default(''), station: z.string().length(4).default('ENGM'), checkType: z.enum(['LINE','A_CHECK','C_CHECK','ENGINE','MOD','OTHER']).default('LINE'), priority: z.enum(['NORMAL','HIGH','AOG']).default('NORMAL')
});
const intervalSchema = z.object({ fh: z.number().positive().max(100_000).optional(), fc: z.number().int().positive().max(100_000).optional(), days: z.number().int().positive().max(36_500).optional() })
  .refine(i => i.fh !== undefined || i.fc !== undefined || i.days !== undefined, 'Give a compliance time in FH, FC and/or days');
const directiveSchema = z.object({
  kind: z.enum(['AD', 'SB']),
  ref: z.string().trim().min(4).max(60),
  revision: z.string().trim().max(10).default(''),
  authority: z.string().trim().min(2).max(40),
  title: z.string().trim().min(5).max(200),
  ata: z.string().regex(/^\d{2}$/, 'ATA chapter, two digits'),
  types: z.array(z.string().min(2).max(40)).min(1).max(20),
  msnRanges: z.array(z.object({ from: z.string().trim().min(1).max(20), to: z.string().trim().min(1).max(20) })).max(50).nullable().default(null),
  effective: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  action: z.string().trim().min(10).max(2000),
  interval: intervalSchema,
  repetitive: z.boolean(),
  estimatedHours: z.number().positive().max(2000).default(1),
  steps: z.array(z.string().trim().min(3).max(500)).max(50).default([]),
  supersedes: z.string().max(40).nullable().default(null)
});
const evaluateSchema = z.object({
  decision: z.enum(['COMPLY', 'EMBODY', 'DEFER', 'REJECT', 'NOT_APPLICABLE']),
  reason: z.string().trim().max(2000).nullable().default(null),
  // The complete set of overrides wanted; omit to keep those already recorded.
  overrides: z.array(z.object({ tail: z.string().min(2).max(10), applicable: z.boolean(), reason: z.string().max(500) })).max(200).optional(),
  version: z.number().int().positive()
});
const versionSchema = z.object({ version: z.number().int().positive() });
const removeSchema = z.object({ reason: z.enum(['UNSERVICEABLE', 'SCHEDULED', 'ROBBERY', 'LIFE_LIMIT', 'OTHER']), reference: z.string().trim().min(3).max(120) });
const installSchema = z.object({
  tail: z.string().min(2).max(10), position: z.string().trim().min(1).max(40), requirementId: z.string().min(1).max(40),
  partNo: z.string().trim().min(2).max(60), serial: z.string().trim().min(1).max(60), tsn: z.number().min(0).max(500_000), csn: z.number().int().min(0).max(500_000),
  reference: z.string().trim().max(120).default('')
});
const wpPlanSchema = z.object({ bay: z.string().min(1).max(20), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) });
const wpPlanningSchema = z.object({
  resources: z.array(z.object({ trade: z.enum(['MECHANICAL','POWERPLANT','AVIONICS','STRUCTURES']), requiredHours: z.number().min(0), availableHours: z.number().min(0).max(10000) })).max(10),
  dependencies: z.array(z.object({ beforeRequirementId: z.string().min(1), afterRequirementId: z.string().min(1) })).max(500).default([])
});
const baySchema = z.object({ station: z.string().length(4), code: z.string().trim().min(1).max(20), name: z.string().trim().min(2).max(100) });
const bayStateSchema = z.object({ active: z.boolean() });
const unfreezeSchema = z.object({ reason: z.string().trim().min(5).max(500) });


@Controller('camo')
export class CamoController {
  constructor(private readonly mel: MelService, private readonly fleet: FleetQuery) {}

  @Get('fleet')
  fleetList(@CurrentPrincipal() p: Principal): Promise<FleetTailDto[]> {
    return this.fleet.list(p.operatorId);
  }

  @Get('mel-items')
  list(@CurrentPrincipal() p: Principal, @Query('scope') scope?: string) {
    return this.mel.list(p, scope === 'closed' ? 'closed' : 'open');
  }

  @Get('mel-items/:id')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.mel.get(p, id);
  }

  @Post('mel-items')
  raise(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(raiseSchema)) body: z.infer<typeof raiseSchema>) {
    return this.mel.raise(p, body);
  }

  @Post('mel-items/:id/engineering-order')
  generateEo(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.mel.generateEngineeringOrder(p, id);
  }

  @Post('mel-items/:id/extension')
  extend(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(extensionSchema)) body: z.infer<typeof extensionSchema>) {
    return this.mel.approveExtension(p, id, body.justification, body.passkey);
  }

  @Post('mel-items/:id/extension/challenge')
  extensionChallenge(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(extensionChallengeSchema)) body: z.infer<typeof extensionChallengeSchema>) {
    return this.mel.extensionChallenge(p, id, body.justification);
  }
}

@Controller('camo')
export class EngineeringController {
  constructor(private readonly directives: DirectivesService, private readonly components: ComponentsService) {}

  @Get('directives')
  directiveList(@CurrentPrincipal() p: Principal, @Query('scope') scope?: string) {
    return this.directives.list(p, scope === 'closed' ? 'closed' : scope === 'all' ? 'all' : 'open');
  }

  @Get('directives/:id')
  directive(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.directives.get(p, id);
  }

  @Post('directives')
  receive(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(directiveSchema)) body: z.infer<typeof directiveSchema>) {
    return this.directives.receive(p, body);
  }

  @Post('directives/:id/evaluate')
  evaluate(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(evaluateSchema)) body: z.infer<typeof evaluateSchema>) {
    return this.directives.evaluate(p, id, body);
  }

  @Post('directives/:id/incorporate')
  incorporate(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(versionSchema)) body: z.infer<typeof versionSchema>) {
    return this.directives.incorporate(p, id, body.version);
  }

  @Post('directives/:id/confirm-not-applicable')
  confirmNotApplicable(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(versionSchema)) body: z.infer<typeof versionSchema>) {
    return this.directives.confirmNotApplicable(p, id, body.version);
  }

  @Get('components')
  componentList(@CurrentPrincipal() p: Principal, @Query('tail') tail?: string) {
    return this.components.installed(p, tail || undefined);
  }

  @Get('components/requirements')
  componentRequirements(@CurrentPrincipal() p: Principal, @Query('tail') tail: string) {
    return this.components.trackedRequirements(p, tail ?? '');
  }

  @Get('components/history')
  componentHistory(@CurrentPrincipal() p: Principal, @Query('partNo') partNo: string, @Query('serial') serial: string) {
    return this.components.history(p, partNo ?? '', serial ?? '');
  }

  @Post('components')
  install(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(installSchema)) body: z.infer<typeof installSchema>) {
    return this.components.install(p, body);
  }

  @Post('components/:id/remove')
  remove(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(removeSchema)) body: z.infer<typeof removeSchema>) {
    return this.components.remove(p, id, body);
  }
}

@Controller('camo')
export class ProgrammeController {
  constructor(private readonly programme: ProgrammeService) {}

  @Get('aircraft')
  aircraft(@CurrentPrincipal() p: Principal) {
    return this.programme.fleetStatus(p);
  }

  @Get('due')
  due(@CurrentPrincipal() p: Principal, @Query('tail') tail?: string) {
    return this.programme.dueList(p, tail || undefined);
  }

  @Get('reliability')
  reliability(@CurrentPrincipal() p: Principal, @Query('days') days?: string) {
    return this.programme.reliability(p, Math.min(365, Math.max(30, Number(days) || 90)));
  }

  @Get('planning/bays')
  bays(@CurrentPrincipal() p: Principal, @Query('station') station?: string) { return this.programme.listBays(p, station || undefined); }

  @Post('planning/bays')
  createBay(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(baySchema)) body: z.infer<typeof baySchema>) { return this.programme.createBay(p, body); }

  @Post('planning/bays/:id/state')
  setBayState(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(bayStateSchema)) body: z.infer<typeof bayStateSchema>) { return this.programme.setBayActive(p, id, body.active); }

  @Get('work-packages')
  wps(@CurrentPrincipal() p: Principal) {
    return this.programme.listWps(p);
  }

  @Get('work-packages/:id')
  wp(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.programme.getWp(p, id);
  }

  @Post('work-packages')
  createWp(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(wpCreateSchema)) body: z.infer<typeof wpCreateSchema>) {
    return this.programme.createWp(p, body);
  }

  @Post('work-packages/:id/plan')
  planWp(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(wpPlanSchema)) body: z.infer<typeof wpPlanSchema>) {
    return this.programme.planWp(p, id, body);
  }

  @Post('work-packages/:id/readiness')
  readiness(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(wpPlanningSchema)) body: z.infer<typeof wpPlanningSchema>) { return this.programme.setWpPlanning(p, id, body); }

  @Post('work-packages/:id/freeze')
  freeze(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.programme.freezeWp(p, id); }

  @Post('work-packages/:id/unfreeze')
  unfreeze(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(unfreezeSchema)) body: z.infer<typeof unfreezeSchema>) { return this.programme.unfreezeWp(p, id, body.reason); }

  @Post('work-packages/:id/release')
  releaseWp(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.programme.releaseWp(p, id);
  }
}

/** Endpoints for the Temporal worker only (service token, no user session). */
@Public()
@UseGuards(InternalGuard)
@Controller('internal/camo')
export class CamoInternalController {
  constructor(private readonly mel: MelService, private readonly programme: ProgrammeService, private readonly directives: DirectivesService, private readonly health: HealthService) {}

  /** Hourly: calendar-limited items fall due with time alone, not only with flying; new aircraft get AD/SB applicability. */
  @Post('airworthiness/sweep')
  async sweep() {
    // Airworthiness first: a problem in the directive review must never stop calendar items grounding aircraft.
    const result = await this.programme.sweepAll();
    const directives = await this.directives.reviewFleet();
    const health = await this.health.syncAll().catch((e: unknown) => ({ error: (e as Error).message }));
    return { ...result, directives, health };
  }

  @Post('mel-items/:id/escalations')
  escalate(@Param('id') id: string, @Body(new ZodPipe(escalationSchema)) body: z.infer<typeof escalationSchema>) {
    return this.mel.escalate(id, body.level);
  }
}

/** CAMO's reactions to events: close deferrals on CRS; drive the escalation workflows. */
@Injectable()
export class CamoConsumers implements OnApplicationBootstrap {
  private readonly log = new Logger('CamoConsumers');

  constructor(private readonly kafka: KafkaService, private readonly mel: MelService, private readonly temporal: TemporalService, private readonly programme: ProgrammeService,
    private readonly components: ComponentsService) {}

  onApplicationBootstrap() {
    this.kafka.start('camo.components', [TOPICS.amo], async env => {
      if (env.type === 'amo.part.scrapped') await this.components.onPartScrapped(env as EventEnvelope<'amo.part.scrapped'>);
    });
    this.kafka.start('camo.mel-closure', [TOPICS.amo], async env => {
      if (env.type === 'amo.crs.issued') await this.mel.closeFromCrs(env as EventEnvelope<'amo.crs.issued'>);
    });
    this.kafka.start('camo.wp-compliance', [TOPICS.amo], async env => {
      if (env.type === 'amo.crs.issued') await this.programme.onCrs(env as EventEnvelope<'amo.crs.issued'>);
    });
    this.kafka.start('camo.utilisation', [TOPICS.ops], async env => {
      if (env.type === 'ops.flight.arrived') await this.programme.onFlightArrived(env as EventEnvelope<'ops.flight.arrived'>);
    });

    // Workflow commands are idempotent (fixed workflow ids), so no inbox is needed here.
    this.kafka.start('camo.mel-workflows', [TOPICS.camo], async env => {
      switch (env.type) {
        case 'camo.mel.deferred': {
          const d = (env as EventEnvelope<'camo.mel.deferred'>).data;
          await this.temporal.startMelDeferral({ melItemId: d.melItemId, operatorId: env.operatorId, deadline: d.deadline });
          break;
        }
        case 'camo.mel.extended': {
          const d = (env as EventEnvelope<'camo.mel.extended'>).data;
          await this.temporal.signalMel(d.melItemId, 'extended', d.deadline);
          break;
        }
        case 'camo.mel.closed':
          await this.temporal.signalMel((env as EventEnvelope<'camo.mel.closed'>).data.melItemId, 'closed');
          break;
        default:
          break;
      }
    });
    this.log.log('consumers started');
  }
}

@Module({
  imports: [ComplianceModule],
  providers: [MelRepository, FleetQuery, MelService, ProgrammeService, DirectivesService, ComponentsService, HealthService, ReliabilityControlService, CamoKpis, CamoConsumers, CamoSearch, CamoFleetMigration],
  controllers: [CamoController, ProgrammeController, EngineeringController, HealthController, ReliabilityControlController, CamoInternalController],
  exports: [FleetQuery, MelService, CamoKpis]
})
export class CamoModule {}
