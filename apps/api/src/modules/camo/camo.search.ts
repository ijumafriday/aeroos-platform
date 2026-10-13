import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import type { SearchResultDto } from '@aeroos/contracts';
import type { Principal } from '../../platform/auth/principal';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { likePattern, SearchRegistry } from '../../platform/search/search.registry';
import { fleet, melItems } from './camo.tables';
import { requirements, workPackages } from './programme.tables';

@Injectable()
export class CamoSearch implements OnModuleInit {
  constructor(@Inject(DB_TOKEN.camo) private readonly db: ModuleDb, private readonly registry: SearchRegistry, private readonly authz: AuthzService) {}

  onModuleInit() {
    this.registry.register({ name: 'camo', search: (p, q, limit) => this.search(p, q, limit) });
  }

  private async search(p: Principal, q: string, limit: number): Promise<SearchResultDto[]> {
    const like = likePattern(q);
    const [mel, prog] = await Promise.all([
      this.authz.decide(p, { kind: 'mel_item', id: '*', attr: { operatorId: p.operatorId, status: 'OPEN' } }, ['read']),
      this.authz.decide(p, { kind: 'maintenance_programme', id: '*', attr: { operatorId: p.operatorId } }, ['read'])
    ]);
    const out: SearchResultDto[] = [];
    if (mel.read) {
      const [items, tails] = await Promise.all([
        this.db.db.select().from(melItems).where(and(eq(melItems.operatorId, p.operatorId),
          or(ilike(melItems.id, like), ilike(melItems.tail, like), ilike(melItems.title, like), ilike(melItems.melRef, like), ilike(melItems.description, like))))
          .orderBy(desc(melItems.raisedAt)).limit(limit),
        this.db.db.select().from(fleet).where(and(eq(fleet.operatorId, p.operatorId), or(ilike(fleet.reg, like), ilike(fleet.aircraftType, like)))).limit(limit)
      ]);
      out.push(...tails.map(t => ({ type: 'Aircraft', id: t.reg, title: `${t.reg} · ${t.aircraftType}`, subtitle: `MSN ${t.msn} · ${t.status}`, link: `/camo/programme?tail=${encodeURIComponent(t.reg)}` })));
      out.push(...items.map(m => ({ type: 'Deferral', id: m.id, title: `${m.id} · ${m.tail} · ${m.title}`, subtitle: `MEL ${m.melRef} Cat ${m.category} · ${m.status}`, link: `/camo/mel?item=${encodeURIComponent(m.id)}` })));
    }
    if (prog.read) {
      const [reqs, wps] = await Promise.all([
        this.db.db.select().from(requirements).where(and(eq(requirements.operatorId, p.operatorId), or(ilike(requirements.ref, like), ilike(requirements.title, like)))).limit(limit),
        this.db.db.select().from(workPackages).where(and(eq(workPackages.operatorId, p.operatorId), or(ilike(workPackages.id, like), ilike(workPackages.tail, like), ilike(workPackages.title, like)))).limit(limit)
      ]);
      out.push(...reqs.map(r => ({ type: r.kind === 'AD' ? 'Airworthiness directive' : r.kind === 'SB' ? 'Service bulletin' : r.kind === 'LLP' ? 'Life-limited part' : 'Programme task', id: r.id, title: `${r.ref} · ${r.title}`, subtitle: `ATA ${r.ata} · ${r.types.join(', ')}`, link: `/camo/programme?ref=${encodeURIComponent(r.ref)}` })));
      out.push(...wps.map(w => ({ type: 'Work package', id: w.id, title: `${w.id} · ${w.tail} · ${w.title}`, subtitle: `${w.status} · ${w.items.length} item(s)`, link: `/camo/work-packages?wp=${encodeURIComponent(w.id)}` })));
    }
    return out;
  }
}
