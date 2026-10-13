import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';

/** Operations and crew figures for the executive dashboard (ops schema only). On time = on blocks ≤ 15 min after STA. */
@Injectable()
export class OpsKpis {
  constructor(@Inject(DB_TOKEN.ops) private readonly db: ModuleDb) {}

  async get(operatorId: string) {
    const days = await this.db.db.execute<{ d: string; flights: number; arrived: number; on_time: number; cancelled: number }>(sql`
      select to_char(g.d, 'YYYY-MM-DD') as d,
        count(f.id)::int as flights,
        count(f.id) filter (where f.status = 'ARRIVED')::int as arrived,
        count(f.id) filter (where f.status = 'ARRIVED' and coalesce(f.on_block, f.eta) <= f.sta + interval '15 minutes')::int as on_time,
        count(f.id) filter (where f.status = 'CANCELLED')::int as cancelled
      from generate_series(current_date - 6, current_date, interval '1 day') g(d)
      left join ops.flights f on f.operator_id = ${operatorId} and f.op_date = g.d::date
      group by g.d order by g.d`);
    const r = await this.db.db.execute<{ today: number; delayed_now: number; open_crew: number; fatigue_open: number; fatigue_high: number }>(sql`
      select
        (select count(*)::int from ops.flights where operator_id = ${operatorId} and op_date = current_date) as today,
        (select count(*)::int from ops.flights where operator_id = ${operatorId} and status = 'DELAYED' and etd > now() - interval '6 hours') as delayed_now,
        (select count(*)::int from ops.flights f where f.operator_id = ${operatorId} and f.status in ('SCHEDULED', 'DELAYED')
           and f.op_date between current_date and current_date + 7
           and (select count(distinct a.role) from ops.crew_assignments a where a.flight_id = f.id and not a.positioning) < 2) as open_crew,
        (select count(*)::int from ops.fatigue_reports where operator_id = ${operatorId} and status = 'OPEN') as fatigue_open,
        (select count(*)::int from ops.fatigue_reports where operator_id = ${operatorId} and status = 'OPEN' and severity = 'HIGH') as fatigue_high`);
    return { days: days.rows, ...r.rows[0] };
  }
}
