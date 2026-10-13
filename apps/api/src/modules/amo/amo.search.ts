import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import type { SearchResultDto } from '@aeroos/contracts';
import type { Principal } from '../../platform/auth/principal';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { likePattern, SearchRegistry } from '../../platform/search/search.registry';
import { taskCards } from './amo.module';
import { parts, tools } from './stores.service';

@Injectable()
export class AmoSearch implements OnModuleInit {
  constructor(@Inject(DB_TOKEN.amo) private readonly db: ModuleDb, private readonly registry: SearchRegistry, private readonly authz: AuthzService) {}

  onModuleInit() {
    this.registry.register({ name: 'amo', search: (p, q, limit) => this.search(p, q, limit) });
  }

  private async search(p: Principal, q: string, limit: number): Promise<SearchResultDto[]> {
    const like = likePattern(q);
    const [cards, stores] = await Promise.all([
      this.authz.decide(p, { kind: 'task_card', id: '*', attr: { operatorId: p.operatorId, status: 'OPEN', licenceCovered: false, allStepsStamped: false } }, ['read']),
      this.authz.decide(p, { kind: 'stores', id: '*', attr: { operatorId: p.operatorId } }, ['read'])
    ]);
    const out: SearchResultDto[] = [];
    if (cards.read) {
      const rows = await this.db.db.select().from(taskCards).where(and(eq(taskCards.operatorId, p.operatorId),
        or(ilike(taskCards.id, like), ilike(taskCards.tail, like), ilike(taskCards.title, like), ilike(taskCards.sourceId, like))))
        .orderBy(desc(taskCards.createdAt)).limit(limit);
      out.push(...rows.map(c => ({ type: 'Task card', id: c.id, title: `${c.id} · ${c.tail} · ${c.title}`, subtitle: `${c.status}${c.crs ? ` · ${c.crs.number}` : ''}`, link: `/amo/task-cards?card=${encodeURIComponent(c.id)}` })));
    }
    if (stores.read) {
      const [pr, tl] = await Promise.all([
        this.db.db.select().from(parts).where(or(ilike(parts.partNo, like), ilike(parts.description, like))).limit(limit),
        this.db.db.select().from(tools).where(and(eq(tools.operatorId, p.operatorId), or(ilike(tools.id, like), ilike(tools.description, like), ilike(tools.serial, like)))).limit(limit)
      ]);
      out.push(...pr.map(x => ({ type: 'Part', id: x.partNo, title: `${x.partNo} · ${x.description}`, subtitle: `min stock ${x.minStock} ${x.unit}`, link: `/amo/stores?part=${encodeURIComponent(x.partNo)}` })));
      out.push(...tl.map(x => ({ type: 'Tool', id: x.id, title: `${x.id} · ${x.description}`, subtitle: `s/n ${x.serial} · cal. due ${x.calibrationDue ?? 'n/a'}`, link: '/amo/stores' })));
    }
    return out;
  }
}
