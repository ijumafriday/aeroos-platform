import { Controller, Get, Injectable, Module } from '@nestjs/common';
import type { ExecutiveDashboardDto, KpiDto } from '@aeroos/contracts';
import { CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuthzService } from '../../platform/authz/authz.service';
import { AmoModule } from '../amo/amo.module';
import { BillingService } from '../amo/billing.service';
import { CamoModule } from '../camo/camo.module';
import { CamoKpis } from '../camo/kpis';
import { OpsModule } from '../ops/ops.module';
import { OpsKpis } from '../ops/kpis';
import { OrgModule } from '../org/org.module';
import { FinanceService } from '../org/finance.service';

const usd = (c: number) => Math.round(c / 100);
const k = (key: string, label: string, value: number, unit: string, tone: KpiDto['tone'], detail: string, link: string | null = null): KpiDto => ({ key, label, value, unit, tone, detail, link });

/**
 * Executive dashboard (ADR-0025): one read model composed in process from each module's own figures — every module
 * reads only its own schema — for the accountable manager and the nominated persons.
 */
@Injectable()
export class ExecService {
  constructor(private readonly ops: OpsKpis, private readonly camo: CamoKpis, private readonly finance: FinanceService, private readonly billing: BillingService, private readonly authz: AuthzService) {}

  async dashboard(p: Principal): Promise<ExecutiveDashboardDto> {
    await this.authz.check(p, { kind: 'executive_dashboard', id: '*', attr: { operatorId: p.operatorId } }, 'read');
    const [o, c, f, b] = await Promise.all([this.ops.get(p.operatorId), this.camo.get(p.operatorId), this.finance.kpis(p.operatorId), this.billing.kpis(p.operatorId)]);
    const arrived = o.days.reduce((s, d) => s + d.arrived, 0), onTime = o.days.reduce((s, d) => s + d.on_time, 0);
    const otp = arrived ? Math.round((onTime / arrived) * 1000) / 10 : 0;
    const cancelled = o.days.reduce((s, d) => s + d.cancelled, 0), flown = o.days.reduce((s, d) => s + d.flights, 0);
    const available = c.fleet - Math.max(c.aog, c.unairworthy);
    const mtd = f.revenueByMonth[f.revenueByMonth.length - 1]?.revenueCents ?? 0;
    return {
      generatedAt: new Date().toISOString(), operatorId: p.operatorId,
      sections: [
        { key: 'operations', title: 'Operations', kpis: [
          k('otp', 'On-time performance (7 days)', otp, '%', !arrived ? '' : otp >= 85 ? 'green' : otp >= 75 ? 'amber' : 'red', `${onTime} of ${arrived} arrivals within 15 min`, '/ops/occ'),
          k('flights_today', 'Flights today', o.today, '', '', `${o.delayed_now} delayed now`, '/ops/occ'),
          k('cancellations', 'Cancellations (7 days)', cancelled, '', cancelled ? 'amber' : 'green', `${flown} flights scheduled`, '/ops/occ')
        ] },
        { key: 'technical', title: 'Technical', kpis: [
          k('availability', 'Aircraft available', available, `of ${c.fleet}`, available === c.fleet ? 'green' : available >= c.fleet - 1 ? 'amber' : 'red', `${c.aog} AOG · ${c.unairworthy} not airworthy`, '/camo/programme'),
          k('mel', 'Open MEL deferrals', c.mel_open, '', c.mel_cat_a ? 'amber' : '', `${c.mel_cat_a} category A`, '/camo/mel'),
          k('engine_alerts', 'Engine health alerts', c.engine_alerts, '', c.engine_red ? 'red' : c.engine_alerts ? 'amber' : 'green', `${c.engine_red} red`, '/camo/health'),
          k('damage', 'Grounded by structural damage', c.damage_grounding, 'aircraft', c.damage_grounding ? 'red' : 'green', 'unrepaired damage, lapsed temporary repair or overdue repeat inspection', '/camo/health')
        ] },
        { key: 'safety', title: 'Safety & quality', kpis: [
          k('occurrences', 'Open safety reports', f.openOccurrences, '', f.openOccurrences ? 'amber' : 'green', 'reported, triaged or under investigation', '/safety/reports'),
          k('findings', 'Open audit findings', f.openFindings, '', f.overdueFindings ? 'red' : f.openFindings ? 'amber' : 'green', `${f.overdueFindings} past their due date`, '/quality/audits'),
          k('actions', 'Overdue corrective actions', f.overdueActions, '', f.overdueActions ? 'red' : 'green', '', '/quality/actions')
        ] },
        { key: 'crew', title: 'Crew', kpis: [
          k('open_crew', 'Flights without full crew (7 days)', o.open_crew, '', o.open_crew ? 'amber' : 'green', 'build the roster', '/ops/roster'),
          k('fatigue', 'Fatigue reports to review', o.fatigue_open, '', o.fatigue_high ? 'red' : o.fatigue_open ? 'amber' : 'green', `${o.fatigue_high} high`, '/ops/fatigue')
        ] },
        { key: 'commercial', title: 'Commercial & finance (USD)', kpis: [
          k('revenue_mtd', 'Maintenance revenue this month', usd(mtd), 'USD', '', 'from the ledger', '/finance/ledger'),
          k('receivables', 'Receivables open', usd(b.receivablesCents), 'USD', b.overdueCents ? 'amber' : 'green', `${usd(b.overdueCents).toLocaleString('en-GB')} USD overdue`, '/amo/billing'),
          k('orders', 'Open customer orders', b.openOrders, '', b.toInvoice ? 'amber' : '', `${b.toInvoice} completed, not invoiced`, '/amo/billing')
        ] }
      ],
      otpByDay: o.days.map(d => ({ date: d.d, flights: d.flights, onTimePct: d.arrived ? Math.round((d.on_time / d.arrived) * 1000) / 10 : null })),
      revenueByMonth: f.revenueByMonth
    };
  }
}

@Controller('exec')
export class ExecController {
  constructor(private readonly s: ExecService) {}
  @Get('dashboard') dashboard(@CurrentPrincipal() p: Principal) { return this.s.dashboard(p); }
}

@Module({
  imports: [OpsModule, CamoModule, OrgModule, AmoModule],
  providers: [ExecService],
  controllers: [ExecController]
})
export class ExecModule {}
