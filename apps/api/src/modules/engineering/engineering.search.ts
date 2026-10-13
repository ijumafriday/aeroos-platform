import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import type { SearchResultDto } from '@aeroos/contracts';
import type { Principal } from '../../platform/auth/principal';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { likePattern, SearchRegistry } from '../../platform/search/search.registry';
import { configurationBaselines, installedItems } from './configuration.tables';

@Injectable()
export class EngineeringSearch implements OnModuleInit {
  constructor(@Inject(DB_TOKEN.engineering) private readonly db: ModuleDb, private readonly registry: SearchRegistry, private readonly authz: AuthzService) {}

  onModuleInit() {
    this.registry.register({ name: 'engineering', search: (p, q, limit) => this.search(p, q, limit) });
  }

  private async search(p: Principal, q: string, limit: number): Promise<SearchResultDto[]> {
    const allowed = await this.authz.decide(p, { kind: 'aircraft_configuration', id: '*', attr: { operatorId: p.operatorId } }, ['read']);
    if (!allowed.read) return [];
    const like = likePattern(q);
    const [baselines, actual] = await Promise.all([
      this.db.db.select().from(configurationBaselines).where(and(eq(configurationBaselines.operatorId, p.operatorId), or(ilike(configurationBaselines.id, like), ilike(configurationBaselines.aircraftType, like), ilike(configurationBaselines.name, like)))).orderBy(desc(configurationBaselines.revision)).limit(limit),
      this.db.db.select().from(installedItems).where(and(eq(installedItems.operatorId, p.operatorId), isNull(installedItems.removedAt), or(ilike(installedItems.tail, like), ilike(installedItems.partNo, like), ilike(installedItems.serial, like), ilike(installedItems.positionCode, like)))).orderBy(desc(installedItems.installedAt)).limit(limit)
    ]);
    const seenTail = new Set<string>();
    const results: SearchResultDto[] = baselines.map(b => ({ type: 'Configuration baseline', id: b.id, title: `${b.id} · ${b.aircraftType} · ${b.name}`, subtitle: `Revision ${b.revision} · ${b.status}`, link: '/engineering/configuration' }));
    for (const item of actual) {
      if (seenTail.has(item.tail)) continue;
      seenTail.add(item.tail);
      results.push({ type: 'Aircraft configuration', id: item.tail, title: `${item.tail} · ${item.aircraftType}`, subtitle: `${item.positionCode} · ${item.partNo} · S/N ${item.serial}`, link: `/engineering/configuration?tail=${encodeURIComponent(item.tail)}` });
    }
    return results.slice(0, limit);
  }
}
