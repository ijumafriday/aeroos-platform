import { Injectable } from '@nestjs/common';
import type { RosterViolation } from '@aeroos/compliance';
import type { CrewDetailDto, CrewImpactDto, CrewSummaryDto, DutyDto, FtlStatus, RosterViolationDto } from '@aeroos/contracts';
import { buildDuties, DEFAULT_SCHEME, type Duty, type DutyScheme, type RosterJudge } from '@aeroos/ops-domain';
import type { Principal } from '../../platform/auth/principal';
import { AuthzService } from '../../platform/authz/authz.service';
import { ComplianceService } from '../compliance/compliance.module';
import { OpsRepository } from './ops.repository';

const DAY = 86_400_000;

export const ftlStatus = (v: RosterViolation[]): FtlStatus =>
  v.some(x => x.severity === 'violation') ? 'VIOLATION' : v.length ? 'DISCRETION' : 'OK';

const violationDto = (v: RosterViolation): RosterViolationDto => ({ ...v });

const dutyDto = (d: Duty): DutyDto => ({
  id: d.id, report: d.report.toISOString(), fdpEnd: d.fdpEnd.toISOString(), dutyEnd: d.dutyEnd.toISOString(), sectors: d.sectors,
  flightMinutes: d.flightMinutes,
  legs: d.legs.map(l => ({ flightId: l.id, flightNo: l.flightNo, dep: l.dep, arr: l.arr, etd: l.etd.toISOString(), eta: l.eta.toISOString(), status: l.status }))
});

/**
 * Crew flight and duty time limitations. Duties are rebuilt from the *current estimated* schedule
 * every time, so a delay entered in the OCC immediately shows its FTL consequence for every crew
 * member on the affected legs. The limits come from the rulepack (ORO.FTL / Part 117).
 */
@Injectable()
export class CrewService {
  constructor(private readonly repo: OpsRepository, private readonly compliance: ComplianceService, private readonly authz: AuthzService) {}

  private async scheme(homeBase: string): Promise<DutyScheme> {
    return (await this.schemes())(homeBase);
  }

  /** Duty scheme per home base (airport time zones loaded once). */
  async schemes(): Promise<(homeBase: string) => DutyScheme> {
    const zones = new Map((await this.repo.airports()).map(a => [a.icao, a.timeZone]));
    return homeBase => ({ ...DEFAULT_SCHEME, homeBase, zoneOf: icao => zones.get(icao) ?? 'UTC' });
  }

  violations(operatorId: string, duties: Duty[], now: Date): RosterViolation[] {
    return this.compliance.engine.rosterCheck(operatorId, { duties }, now).value;
  }

  /** The rulepack's verdict on a roster, in the form crew recovery needs. */
  judge(operatorId: string, now: Date): RosterJudge {
    return duties => {
      const v = this.compliance.engine.rosterCheck(operatorId, { duties }, now).value;
      const worst = v.find(x => x.severity === 'violation') ?? v[0];
      return { status: ftlStatus(v), message: worst?.message ?? null };
    };
  }

  /** Duties and FTL findings for crew members, over the look-back the cumulative limits need. */
  async evaluate(operatorId: string, crew: { id: string; base: string }[], now = new Date()) {
    const legs = await this.repo.legsFor(crew.map(c => c.id), new Date(now.getTime() - 365 * DAY), new Date(now.getTime() + 7 * DAY));
    const out = new Map<string, { duties: Duty[]; violations: RosterViolation[]; rule: string; basis: string }>();
    for (const c of crew) {
      const duties = buildDuties(legs.filter(l => l.crewId === c.id), await this.scheme(c.base));
      const d = this.compliance.engine.rosterCheck(operatorId, { duties }, now);
      out.set(c.id, { duties, violations: d.value, rule: d.rule, basis: d.basis });
    }
    return out;
  }

  private resource(p: Principal, id = '*') {
    return { kind: 'crew_roster' as const, id, attr: { operatorId: p.operatorId } };
  }

  async list(p: Principal): Promise<CrewSummaryDto[]> {
    await this.authz.check(p, this.resource(p), 'read');
    const crew = await this.repo.crew(p.operatorId);
    const now = new Date();
    const ev = await this.evaluate(p.operatorId, crew, now);
    return crew.map(c => {
      const e = ev.get(c.id)!;
      const next = e.duties.find(d => d.dutyEnd.getTime() > now.getTime());
      return {
        id: c.id, name: c.name, rank: c.rank as CrewSummaryDto['rank'], base: c.base, qualifications: c.qualifications,
        status: ftlStatus(e.violations), findings: e.violations.length,
        nextDuty: next ? { report: next.report.toISOString(), legs: next.legs.map(l => l.flightNo).join(' · ') } : null
      };
    });
  }

  async detail(p: Principal, id: string): Promise<CrewDetailDto> {
    await this.authz.check(p, this.resource(p, id), 'read');
    const c = await this.repo.crewMember(id, p.operatorId);
    const now = new Date();
    const e = (await this.evaluate(p.operatorId, [c], now)).get(c.id)!;
    const next = e.duties.find(d => d.dutyEnd.getTime() > now.getTime());
    const recent = e.duties.filter(d => d.dutyEnd.getTime() > now.getTime() - 28 * DAY);
    return {
      id: c.id, name: c.name, rank: c.rank as CrewSummaryDto['rank'], base: c.base, qualifications: c.qualifications,
      status: ftlStatus(e.violations), findings: e.violations.length,
      nextDuty: next ? { report: next.report.toISOString(), legs: next.legs.map(l => l.flightNo).join(' · ') } : null,
      duties: recent.map(dutyDto), violations: e.violations.map(violationDto), rule: e.rule, basis: e.basis
    };
  }

  /** FTL position of everyone rostered on these flights (after a change has been applied). */
  async impact(operatorId: string, flightIds: string[]): Promise<CrewImpactDto[]> {
    const rows = await this.repo.crewOnFlights(flightIds);
    const crew = new Map<string, { id: string; name: string; base: string }>();
    for (const r of rows) crew.set(r.c.id, r.c);
    const list = [...crew.values()];
    const ev = await this.evaluate(operatorId, list);
    return list.map(c => {
      const e = ev.get(c.id)!;
      return { crewId: c.id, name: c.name, status: ftlStatus(e.violations), findings: e.violations.map(violationDto) };
    });
  }
}
