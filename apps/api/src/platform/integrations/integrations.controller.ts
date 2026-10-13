import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentPrincipal, actorOf, type Principal } from '../auth/principal';
import { AuthzService } from '../authz/authz.service';
import { ZodPipe } from '../http/http';
import { WebhookService } from './webhooks.service';

const createSchema = z.object({ name: z.string().trim().min(2).max(100), endpoint: z.string().url().max(2048), eventTypes: z.array(z.string().min(3).max(120)).min(1).max(100) });
const activeSchema = z.object({ active: z.boolean() });

@Controller('v1/platform/integrations/webhooks')
export class IntegrationsController {
  constructor(private readonly hooks: WebhookService, private readonly authz: AuthzService) {}
  private permit(p: Principal, action: string, id = 'webhooks') { return this.authz.check(p, { kind: 'integration', id, attr: { operatorId: p.operatorId } }, action); }

  @Get()
  async list(@CurrentPrincipal() p: Principal) { await this.permit(p, 'read'); return this.hooks.list(p.operatorId); }

  @Post()
  async create(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    await this.permit(p, 'manage'); return this.hooks.create(p.operatorId, actorOf(p), body);
  }

  @Patch(':id')
  async active(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(activeSchema)) body: z.infer<typeof activeSchema>) {
    await this.permit(p, 'manage', id); return this.hooks.setActive(p.operatorId, id, body.active);
  }

  @Get(':id/deliveries')
  async deliveries(@CurrentPrincipal() p: Principal, @Param('id') id: string) { await this.permit(p, 'read', id); return this.hooks.deliveries(p.operatorId, id); }
}
