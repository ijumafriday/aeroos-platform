import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import type { SearchResultDto } from '@aeroos/contracts';
import type { Principal } from '../../platform/auth/principal';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { likePattern, SearchRegistry } from '../../platform/search/search.registry';
import { crewMembers, flights } from './ops.tables';

@Injectable()
export class OpsSearch implements OnModuleInit {
  constructor(@Inject(DB_TOKEN.ops) private readonly db: ModuleDb, private readonly registry: SearchRegistry, private readonly authz: AuthzService) {}

  onModuleInit() {
    this.registry.register({ name: 'ops', search: (p, q, limit) => this.search(p, q, limit) });
  }

  private async search(p: Principal, q: string, limit: number): Promise<SearchResultDto[]> {
    const like = likePattern(q);
    const [flt, crew] = await Promise.all([
      this.authz.decide(p, { kind: 'flight', id: '*', attr: { operatorId: p.operatorId } }, ['read']),
      this.authz.decide(p, { kind: 'crew_roster', id: '*', attr: { operatorId: p.operatorId } }, ['read'])
    ]);
    const out: SearchResultDto[] = [];
    if (flt.read) {
      const rows = await this.db.db.select().from(flights).where(and(eq(flights.operatorId, p.operatorId),
        or(ilike(flights.flightNo, like), ilike(flights.tail, like), ilike(flights.dep, like), ilike(flights.arr, like))))
        .orderBy(asc(flights.etd)).limit(limit);
      out.push(...rows.map(f => ({ type: 'Flight', id: f.id, title: `${f.flightNo} ${f.dep}–${f.arr} · ${f.tail}`, subtitle: `${f.opDate} ${f.etd.toISOString().slice(11, 16)}Z · ${f.status}${f.delayMinutes ? ` +${f.delayMinutes}` : ''}`, link: `/ops/occ?flight=${encodeURIComponent(f.id)}` })));
    }
    if (crew.read) {
      const rows = await this.db.db.select().from(crewMembers).where(and(eq(crewMembers.operatorId, p.operatorId), or(ilike(crewMembers.name, like), ilike(crewMembers.id, like)))).limit(limit);
      out.push(...rows.map(c => ({ type: 'Crew', id: c.id, title: `${c.name} · ${c.rank}`, subtitle: `${c.qualifications.join(', ')} · base ${c.base}`, link: `/ops/crew?crew=${encodeURIComponent(c.id)}` })));
    }
    return out;
  }
}
