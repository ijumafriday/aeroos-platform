import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { ZodPipe } from '../../platform/http/http';
import { CamoModule } from '../camo/camo.module';
import { ConfigurationService } from './configuration.service';
import { EngineeringSearch } from './engineering.search';
import { EngineeringControlController, EngineeringControlService } from './engineering-control.service';

const effectivity = z.object({ tails: z.array(z.string().min(2).max(10)).max(500).optional(), msnRanges: z.array(z.object({ from: z.string().min(1).max(30), to: z.string().min(1).max(30) })).max(100).optional() }).default({});
const baseline = z.object({ aircraftType: z.string().trim().min(2).max(40), name: z.string().trim().min(3).max(120) });
const position = z.object({ code: z.string().trim().min(1).max(60), parentId: z.string().max(40).nullable().optional(), ata: z.string().regex(/^\d{2}$/), title: z.string().trim().min(2).max(160), required: z.boolean().default(true), maxQty: z.number().int().min(1).max(50).default(1), effectivity });
const part = z.object({ partNo: z.string().trim().min(2).max(80), description: z.string().trim().max(200).default(''), requiredMods: z.array(z.string().trim().min(1).max(80)).max(100).default([]) });
const approve = z.object({ version: z.number().int().positive() });
const activate = z.object({ version: z.number().int().positive(), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const install = z.object({ positionId: z.string().min(1).max(40), partNo: z.string().trim().min(2).max(80), serial: z.string().trim().min(1).max(80), mods: z.array(z.string().trim().min(1).max(80)).max(100).default([]), installedAt: z.string().datetime({ offset: true }), reference: z.string().trim().min(2).max(160) });
const remove = z.object({ reference: z.string().trim().min(2).max(160) });

@Controller('engineering/configuration')
class ConfigurationController {
  constructor(private readonly svc: ConfigurationService) {}
  @Get('baselines') baselines(@CurrentPrincipal() p: Principal, @Query('aircraftType') type?: string) { return this.svc.listBaselines(p, type || undefined); }
  @Post('baselines') create(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(baseline)) body: z.infer<typeof baseline>) { return this.svc.createBaseline(p, body); }
  @Post('baselines/:id/positions') addPosition(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(position)) body: z.infer<typeof position>) { return this.svc.addPosition(p, id, body); }
  @Post('baselines/:id/positions/:positionId/allowable-parts') addPart(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Param('positionId') positionId: string, @Body(new ZodPipe(part)) body: z.infer<typeof part>) { return this.svc.addAllowablePart(p, id, positionId, body); }
  @Post('baselines/:id/approve') approveBaseline(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(approve)) body: z.infer<typeof approve>) { return this.svc.approve(p, id, body.version); }
  @Post('baselines/:id/activate') activateBaseline(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(activate)) body: z.infer<typeof activate>) { return this.svc.activate(p, id, body); }
  @Get('aircraft/:tail') aircraft(@CurrentPrincipal() p: Principal, @Param('tail') tail: string) { return this.svc.aircraft(p, tail); }
  @Get('aircraft/:tail/history') history(@CurrentPrincipal() p: Principal, @Param('tail') tail: string) { return this.svc.history(p, tail); }
  @Post('aircraft/:tail/items') install(@CurrentPrincipal() p: Principal, @Param('tail') tail: string, @Body(new ZodPipe(install)) body: z.infer<typeof install>) { return this.svc.install(p, tail, body); }
  @Post('aircraft/:tail/items/:itemId/remove') remove(@CurrentPrincipal() p: Principal, @Param('tail') tail: string, @Param('itemId') itemId: string, @Body(new ZodPipe(remove)) body: z.infer<typeof remove>) { return this.svc.remove(p, tail, itemId, body); }
}

@Module({ imports: [CamoModule], providers: [ConfigurationService, EngineeringSearch, EngineeringControlService], controllers: [ConfigurationController, EngineeringControlController], exports: [ConfigurationService] })
export class EngineeringModule {}
