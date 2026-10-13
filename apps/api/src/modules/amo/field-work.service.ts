import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { DomainError } from '@aeroos/kernel';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { ZodPipe } from '../../platform/http/http';

const amo = pgSchema('amo');
const fieldNotes = amo.table('task_card_field_notes', {
  id: uuid('id').primaryKey(), operatorId: text('operator_id').notNull(), taskCardId: text('task_card_id').notNull(),
  authorSubject: text('author_subject').notNull(), body: text('body').notNull(), clientMutationId: uuid('client_mutation_id').notNull(),
  clientCreatedAt: timestamp('client_created_at', { withTimezone: true, mode: 'date' }).notNull(), createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull()
});
const createSchema = z.object({
  clientMutationId: z.string().uuid(), body: z.string().trim().min(1).max(4000), clientCreatedAt: z.string().datetime()
});

@Injectable()
export class FieldWorkService {
  constructor(@Inject(DB_TOKEN.amo) private readonly db: ModuleDb, private readonly authz: AuthzService, private readonly audit: AuditService) {}

  private async card(operatorId: string, id: string) {
    const r = await this.db.db.execute<{ id: string; operator_id: string; status: string }>(sql`select id, operator_id, status from amo.task_cards where operator_id=${operatorId} and id=${id} limit 1`);
    const c = r.rows[0];
    if (!c) throw new DomainError('TASK_CARD_NOT_FOUND', `Task card ${id} not found`, 404);
    return { id: c.id, operatorId: c.operator_id, status: c.status };
  }

  async list(p: Principal, id: string) {
    const c = await this.card(p.operatorId, id);
    await this.authz.check(p, { kind: 'task_card', id, attr: { operatorId: c.operatorId, status: c.status, licenceCovered: false, allStepsStamped: false } }, 'read');
    return (await this.db.db.select().from(fieldNotes).where(and(eq(fieldNotes.operatorId, p.operatorId), eq(fieldNotes.taskCardId, id))).orderBy(asc(fieldNotes.createdAt)))
      .map(n => ({ id: n.id, body: n.body, authorSubject: n.authorSubject, clientMutationId: n.clientMutationId, clientCreatedAt: n.clientCreatedAt.toISOString(), createdAt: n.createdAt.toISOString() }));
  }

  async create(p: Principal, id: string, body: z.infer<typeof createSchema>) {
    return this.db.transaction(async () => {
      const c = await this.card(p.operatorId, id);
      await this.authz.check(p, { kind: 'task_card', id, attr: { operatorId: c.operatorId, status: c.status, licenceCovered: false, allStepsStamped: false } }, 'field_note');
      if (c.status === 'CERTIFIED') throw new DomainError('TASK_CARD_CERTIFIED', 'Certified task cards cannot receive new field notes', 409);
      const existing = await this.db.db.select().from(fieldNotes).where(and(eq(fieldNotes.operatorId, p.operatorId), eq(fieldNotes.clientMutationId, body.clientMutationId))).limit(1);
      if (existing[0]) return { ...existing[0], clientCreatedAt: existing[0].clientCreatedAt.toISOString(), createdAt: existing[0].createdAt.toISOString() };
      const [row] = await this.db.db.insert(fieldNotes).values({ id: crypto.randomUUID(), operatorId: p.operatorId, taskCardId: id, authorSubject: p.subject, body: body.body, clientMutationId: body.clientMutationId, clientCreatedAt: new Date(body.clientCreatedAt), createdAt: new Date() }).returning();
      await this.audit.record(this.db, 'amo', { operatorId: p.operatorId, actor: actorOf(p), action: 'task_card.field_note_added', entityType: 'task_card', entityId: id, data: { noteId: row.id, clientMutationId: row.clientMutationId } });
      return { ...row, clientCreatedAt: row.clientCreatedAt.toISOString(), createdAt: row.createdAt.toISOString() };
    });
  }
}

@Controller('amo/task-cards')
export class FieldWorkController {
  constructor(private readonly field: FieldWorkService) {}
  @Get(':id/field-notes') list(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.field.list(p, id); }
  @Post(':id/field-notes') create(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) { return this.field.create(p, id, body); }
}
