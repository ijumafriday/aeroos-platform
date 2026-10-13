import { EnterpriseController, FinanceController, FinanceService } from './finance.service';
import { BadRequestException, Body, Controller, Get, Query, Injectable, Logger, Module, OnApplicationBootstrap, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { TOPICS, type EventEnvelope, type MeDto } from '@aeroos/contracts';
import { CurrentPrincipal, Public, type Principal } from '../../platform/auth/principal';
import { InternalGuard } from '../../platform/auth/guards';
import { KafkaService } from '../../platform/events/kafka.service';
import { ZodPipe } from '../../platform/http/http';
import { ComplianceModule } from '../compliance/compliance.module';
import { OrgRepository, PersonnelQuery } from './org.repository';
import { OrgService } from './org.service';
import { OrgSearch } from './org.search';
import { OrgPersonnelMigration } from './org.migration';
import { DocumentControlService } from './document-control.service';
import { SafetyQualityService } from './safety-quality.service';
import { SafetyControlController, SafetyControlService } from './safety-control.service';
import { CommercialControlController, CommercialControlService } from './commercial-control.service';
import { QualityControlController, QualityControlService } from './quality-control.service';

export { PersonnelQuery } from './org.repository';

const issueSchema = z.object({
  reference: z.string().trim().min(3).max(40),
  aircraftTypes: z.array(z.string().min(2).max(40)).min(1).max(20),
  validUntil: z.string().datetime({ offset: true })
});
const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(1000) });
const trainingSchema = z.object({
  course: z.enum(['CONTINUATION', 'HUMAN_FACTORS', 'TYPE', 'FUEL_TANK_SAFETY', 'EWIS']),
  title: z.string().trim().min(3).max(200),
  completedAt: z.string().datetime({ offset: true })
});

@Controller('me')
export class MeController {
  constructor(private readonly personnelQuery: PersonnelQuery) {}

  @Get()
  async me(@CurrentPrincipal() p: Principal): Promise<MeDto> {
    const r = await this.personnelQuery.byUsername(p.username, p.operatorId);
    return {
      subject: p.subject,
      username: p.username,
      name: p.name,
      roles: p.roles.filter(x => !x.startsWith('default-roles') && x !== 'offline_access' && x !== 'uma_authorization'),
      operatorId: p.operatorId,
      operators: p.operators,
      personnel: r ? {
        id: r.person.id,
        licenceNo: r.person.licenceNo,
        privileges: r.privs.map(x => ({ authority: x.authority, category: x.category, typeRatings: x.typeRatings, validUntil: x.validUntil.toISOString() }))
      } : null
    };
  }
}

@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('personnel')
  list(@CurrentPrincipal() p: Principal) {
    return this.org.list(p);
  }

  @Get('personnel/:id')
  detail(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.org.detail(p, id);
  }

  @Post('personnel/:id/authorisations')
  issue(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(issueSchema)) body: z.infer<typeof issueSchema>) {
    return this.org.issue(p, id, body);
  }

  @Post('authorisations/:id/suspend')
  suspend(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return this.org.changeStatus(p, id, 'suspend', body.reason);
  }

  @Post('authorisations/:id/reinstate')
  reinstate(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return this.org.changeStatus(p, id, 'reinstate', body.reason);
  }

  @Post('authorisations/:id/revoke')
  revoke(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return this.org.changeStatus(p, id, 'revoke', body.reason);
  }

  @Post('personnel/:id/training')
  training(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(trainingSchema)) body: z.infer<typeof trainingSchema>) {
    return this.org.recordTraining(p, id, body);
  }
}

const docCreateSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Code: capitals, digits and dashes, e.g. MOE or PROC-07'),
  title: z.string().trim().min(5).max(200),
  category: z.enum(['EXPOSITION', 'MANUAL', 'PROCEDURE', 'FORM']),
  audience: z.array(z.enum(['certifying_staff', 'camo_engineer', 'camo_manager', 'quality_manager', 'safety_manager', 'storekeeper', 'occ_controller', 'auditor'])).min(1).max(8),
  requiredForCertification: z.boolean().default(false)
});
const draftSchema = z.object({ summary: z.string().trim().min(10).max(2000) });
const approveSchema = z.object({ effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 of the file you reviewed') });

@Controller('org/documents')
export class DocumentControlController {
  constructor(private readonly docs: DocumentControlService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal) {
    return this.docs.list(p);
  }

  @Get(':id')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.docs.get(p, id);
  }

  @Post()
  create(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(docCreateSchema)) body: z.infer<typeof docCreateSchema>) {
    return this.docs.create(p, body);
  }

  @Post(':id/revisions')
  draft(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(draftSchema)) body: z.infer<typeof draftSchema>) {
    return this.docs.draft(p, id, body.summary);
  }

  @Post(':id/revisions/:rev/approve')
  approve(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Param('rev') rev: string, @Body(new ZodPipe(approveSchema)) body: z.infer<typeof approveSchema>) {
    return this.docs.approve(p, id, revNo(rev), body.effectiveFrom, body.sha256);
  }

  @Post(':id/revisions/:rev/acknowledge')
  acknowledge(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Param('rev') rev: string) {
    return this.docs.acknowledge(p, id, revNo(rev));
  }
}

const prob = z.number().int().min(1).max(5) as unknown as z.ZodType<1 | 2 | 3 | 4 | 5>;
const sev = z.enum(['A', 'B', 'C', 'D', 'E']);
const reportSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  station: z.string().trim().max(4).nullable().default(null),
  tail: z.string().trim().max(10).nullable().default(null),
  flightNo: z.string().trim().max(10).nullable().default(null),
  category: z.enum(['TECHNICAL', 'MAINTENANCE', 'OPERATIONAL', 'GROUND', 'CABIN', 'SECURITY', 'OTHER']),
  title: z.string().trim().min(5).max(160),
  description: z.string().trim().min(20, 'Describe what happened (20+ characters)').max(5000),
  confidential: z.boolean().default(false)
});
const triageSchema = z.object({ mandatory: z.boolean(), probability: prob, severity: sev, investigator: z.string().trim().min(2).max(60).nullable().default(null), version: z.number().int().positive() });
const morSchema = z.object({ authorityRef: z.string().trim().min(3).max(60), reportedAt: z.string().datetime({ offset: true }) });
const closeOccSchema = z.object({ residualProbability: prob, residualSeverity: sev, findings: z.string().trim().max(5000).nullable().default(null), version: z.number().int().positive() });
const auditSchema = z.object({ title: z.string().trim().min(5).max(160), area: z.string().trim().min(3).max(120), reference: z.string().trim().min(3).max(120), plannedFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const findingSchema = z.object({ level: z.enum(['LEVEL_1', 'LEVEL_2', 'OBSERVATION']), requirement: z.string().trim().min(3).max(80), description: z.string().trim().min(10).max(3000), likelihood: z.number().int().min(1).max(5), impact: z.number().int().min(1).max(5), classificationBasis: z.string().trim().min(10).max(2000), containmentAction: z.string().trim().max(2000).nullable().optional(), recurrence: z.boolean().default(false) });
const qualityRiskSchema = findingSchema.pick({ likelihood:true, impact:true, classificationBasis:true, containmentAction:true, recurrence:true });
const rootCauseSchema = z.object({ rootCause: z.string().trim().min(10).max(3000) });
const actionBodySchema = z.object({
  sourceId: z.string().min(2).max(40), description: z.string().trim().min(10).max(2000),
  owner: z.string().trim().min(2).max(60), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});
const evidenceSchema = z.object({ evidence: z.string().trim().min(10).max(3000) });
const verifySchema = z.object({ effective: z.boolean(), note: z.string().trim().max(2000).default('') });

@Controller('safety')
export class SafetyController {
  constructor(private readonly sq: SafetyQualityService) {}

  @Get('occurrences')
  occurrences(@CurrentPrincipal() p: Principal) { return this.sq.listOccurrences(p); }

  @Get('occurrences/:id')
  occurrence(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.sq.getOccurrence(p, id); }

  @Post('occurrences')
  report(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(reportSchema)) b: z.infer<typeof reportSchema>) { return this.sq.report(p, b); }

  @Post('occurrences/:id/triage')
  triage(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(triageSchema)) b: z.infer<typeof triageSchema>) { return this.sq.triage(p, id, b); }

  @Post('occurrences/:id/mor')
  mor(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(morSchema)) b: z.infer<typeof morSchema>) { return this.sq.recordMor(p, id, b); }

  @Post('occurrences/:id/close')
  closeOcc(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(closeOccSchema)) b: z.infer<typeof closeOccSchema>) { return this.sq.closeOccurrence(p, id, b); }

  @Get('actions')
  actions(@CurrentPrincipal() p: Principal, @Query('scope') scope?: string) { return this.sq.listActions(p, scope === 'open' ? 'open' : 'mine', 'OCCURRENCE'); }

  @Post('actions')
  addAction(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(actionBodySchema)) b: z.infer<typeof actionBodySchema>) { return this.sq.addAction(p, { sourceType: 'OCCURRENCE', ...b }); }

  @Post('actions/:id/complete')
  complete(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(evidenceSchema)) b: z.infer<typeof evidenceSchema>) { return this.sq.completeActionInDomain(p, id, 'OCCURRENCE', b.evidence); }

  @Post('actions/:id/verify')
  verify(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(verifySchema)) b: z.infer<typeof verifySchema>) { return this.sq.verifyActionInDomain(p, id, 'OCCURRENCE', b.effective, b.note); }
}

@Controller('quality')
export class QualityController {
  constructor(private readonly sq: SafetyQualityService) {}

  @Get('audits')
  audits(@CurrentPrincipal() p: Principal) { return this.sq.listAudits(p); }

  @Post('audits')
  plan(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(auditSchema)) b: z.infer<typeof auditSchema>) { return this.sq.planAudit(p, b); }

  @Post('audits/:id/findings')
  finding(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(findingSchema)) b: z.infer<typeof findingSchema>) { return this.sq.raiseFinding(p, id, b); }

  @Get('findings')
  findings(@CurrentPrincipal() p: Principal) { return this.sq.listFindings(p); }

  @Post('findings/:id/classify')
  classify(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(qualityRiskSchema)) b: z.infer<typeof qualityRiskSchema>) { return this.sq.classifyFinding(p, id, b); }

  @Post('findings/:id/root-cause')
  rootCause(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(rootCauseSchema)) b: z.infer<typeof rootCauseSchema>) { return this.sq.setRootCause(p, id, b.rootCause); }

  @Post('findings/:id/close')
  closeFinding(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.sq.closeFinding(p, id); }

  @Get('actions')
  actions(@CurrentPrincipal() p: Principal, @Query('scope') scope?: string) { return this.sq.listActions(p, scope === 'open' ? 'open' : 'mine', 'FINDING'); }

  @Post('actions')
  addAction(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(actionBodySchema)) b: z.infer<typeof actionBodySchema>) { return this.sq.addAction(p, { sourceType: 'FINDING', ...b }); }

  @Post('actions/:id/complete')
  complete(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(evidenceSchema)) b: z.infer<typeof evidenceSchema>) { return this.sq.completeActionInDomain(p, id, 'FINDING', b.evidence); }

  @Post('actions/:id/verify')
  verify(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(verifySchema)) b: z.infer<typeof verifySchema>) { return this.sq.verifyActionInDomain(p, id, 'FINDING', b.effective, b.note); }
}

const revNo = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException('revision must be a positive integer');
  return n;
};

/** For the Temporal worker only. */
@Public()
@UseGuards(InternalGuard)
@Controller('internal/org')
export class OrgInternalController {
  constructor(private readonly org: OrgService) {}

  @Post('sweep')
  sweep() {
    return this.org.sweep();
  }
}

@Injectable()
export class OrgConsumers implements OnApplicationBootstrap {
  private readonly log = new Logger('OrgConsumers');

  constructor(private readonly kafka: KafkaService, private readonly org: OrgService, private readonly finance: FinanceService) {}

  onApplicationBootstrap() {
    this.kafka.start('org.experience', [TOPICS.amo], async env => {
      if (env.type === 'amo.taskcard.step_signed') await this.org.experienceFromStep(env as EventEnvelope<'amo.taskcard.step_signed'>);
    });
    // From the beginning of the AMO topic: postings are idempotent per source document.
    this.kafka.start('org.ledger', [TOPICS.amo], env => this.finance.onAmoEvent(env));
    this.log.log('consumers started');
  }
}

@Module({
  imports: [ComplianceModule],
  providers: [OrgRepository, PersonnelQuery, OrgService, OrgConsumers, OrgSearch, OrgPersonnelMigration, DocumentControlService, SafetyQualityService, SafetyControlService, QualityControlService, CommercialControlService, FinanceService],
  controllers: [MeController, OrgController, DocumentControlController, SafetyController, SafetyControlController, QualityController, QualityControlController, CommercialControlController, FinanceController, EnterpriseController, OrgInternalController],
  exports: [PersonnelQuery, FinanceService]
})
export class OrgModule {}
