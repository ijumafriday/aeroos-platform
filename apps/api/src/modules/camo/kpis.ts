import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';

/** Technical figures for the executive dashboard (CAMO schema only). */
@Injectable()
export class CamoKpis {
  constructor(@Inject(DB_TOKEN.camo) private readonly db: ModuleDb) {}

  async get(operatorId: string) {
    const r = await this.db.db.execute<{ fleet: number; aog: number; unairworthy: number; mel_open: number; mel_cat_a: number; engine_alerts: number; engine_red: number; damage_grounding: number }>(sql`
      select
        (select count(*)::int from camo.fleet f where f.operator_id = ${operatorId}) as fleet,
        (select count(*)::int from camo.fleet f where f.operator_id = ${operatorId} and f.status = 'AOG') as aog,
        (select count(*)::int from camo.airworthiness a join camo.fleet f on f.reg = a.reg where f.operator_id = ${operatorId} and not a.airworthy) as unairworthy,
        (select count(*)::int from camo.mel_items m where m.operator_id = ${operatorId} and m.status = 'OPEN') as mel_open,
        (select count(*)::int from camo.mel_items m where m.operator_id = ${operatorId} and m.status = 'OPEN' and m.category = 'A') as mel_cat_a,
        (select count(*)::int from camo.health_alerts h where h.operator_id = ${operatorId} and h.status = 'OPEN') as engine_alerts,
        (select count(*)::int from camo.health_alerts h where h.operator_id = ${operatorId} and h.status = 'OPEN' and h.level = 'RED') as engine_red,
        (select count(*)::int from camo.airworthiness a join camo.fleet f on f.reg = a.reg
           where f.operator_id = ${operatorId} and not a.airworthy
             and exists (select 1 from jsonb_array_elements_text(a.reasons) x where x like 'SD-%')) as damage_grounding`);
    return r.rows[0];
  }
}
