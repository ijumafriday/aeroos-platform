import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { FlightDto, MovementLogDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { acarsMovement, applyMovement, matchesFlight, parseMvt, propagate, stripTypeB, type Movement } from '@aeroos/ops-domain';
import { CONFIG, type Config } from '../../config';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { OutboxService } from '../../platform/events/outbox';
import { CHAIN, MIN_TURN_MINUTES } from './flight-ops.service';
import { Metrics } from '../../platform/observability/metrics';
import { flightToDto, OpsRepository } from './ops.repository';

/** The operator a gateway request was authenticated for (set by MovementKeyGuard). */
export interface IntegrationCaller { operatorId: string; name: string }

/**
 * Integration endpoints (SITA/ARINC Type B gateway, ACARS datalink) authenticate with a per-operator key
 * (X-Api-Key). The key decides which operator's flights the request may report.
 */
@Injectable()
export class MovementKeyGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  canActivate(ctx: ExecutionContext): boolean {
    const keys = this.config.MOVEMENT_API_KEYS ?? [];
    if (!keys.length) throw new ServiceUnavailableException('Movement integration is not configured (MOVEMENT_API_KEYS)');
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; integration?: IntegrationCaller }>();
    const got = Buffer.from(req.headers['x-api-key'] ?? '');
    // Compare against every key (no early exit) so timing does not reveal which operator a key belongs to.
    let match: { operatorId: string } | null = null;
    for (const k of keys) {
      const want = Buffer.from(k.key);
      if (got.length === want.length && timingSafeEqual(got, want)) match = k;
    }
    if (!match) throw new UnauthorizedException('Invalid movement integration key');
    req.integration = { operatorId: match.operatorId, name: `gateway:${match.operatorId}` };
    return true;
  }
}

export const Integration = createParamDecorator((_: unknown, ctx: ExecutionContext): IntegrationCaller => {
  const req = ctx.switchToHttp().getRequest<{ integration?: IntegrationCaller }>();
  if (!req.integration) throw new UnauthorizedException('Integration key required');
  return req.integration;
});

export interface AcarsEvent { flightNo: string; day: number; reg: string; event: 'OUT' | 'OFF' | 'ON' | 'IN'; time: string }

/**
 * Movement messages → actual times. Every message is logged (applied, ignored as a repeat, or rejected
 * with the reason) so a duty manager can see exactly what the network sent. A late departure re-times
 * the rest of the rotation, exactly as a delay entered by hand would.
 */
@Injectable()
export class MovementService {
  constructor(
    @Inject(DB_TOKEN.ops) private readonly db: ModuleDb,
    private readonly repo: OpsRepository,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService
  ) {}

  /** From the integration gateway: one or more MVT messages separated by blank lines or "=" (Type B end). */
  async ingestMvt(raw: string, caller: IntegrationCaller): Promise<{ applied: number; ignored: number; rejected: { message: string; reason: string }[] }> {
    // Separate messages: blank lines, NNNN / '=' end markers, or Type B framing (SOH starts, ETX ends a message).
    const soh = String.fromCharCode(1);
    const etx = String.fromCharCode(3);
    const framed = raw.replace(/\r/g, '').split(etx).join('\n\n').split(soh).join(`\n\n${soh}`);
    const messages = framed.split(/\n\s*\n|^=+$|^NNNN$/m).map(m => m.trim()).filter(Boolean);
    const out = { applied: 0, ignored: 0, rejected: [] as { message: string; reason: string }[] };
    for (const text of messages) {
      try {
        const r = await this.apply(parseMvt(stripTypeB(text)), text, 'MVT', caller.name, caller.operatorId);
        if (r.changed) out.applied++; else out.ignored++;
      } catch (e) {
        // Unparseable text never reached apply(): log it here so the operator can see what arrived.
        if (!(e instanceof AppliedError)) await this.repo.logMovement({ operatorId: caller.operatorId, source: 'MVT', raw: text, flightId: null, status: 'REJECTED', detail: (e as Error).message, receivedBy: caller.name }).catch(() => undefined);
        out.rejected.push({ message: text.split('\n').slice(0, 2).join(' / '), reason: (e as Error).message });
      }
    }
    return out;
  }

  async ingestAcars(events: AcarsEvent[], caller: IntegrationCaller) {
    const out = { applied: 0, ignored: 0, rejected: [] as { message: string; reason: string }[] };
    for (const e of events) {
      const raw = JSON.stringify(e);
      try {
        const r = await this.apply(acarsMovement(e), raw, 'ACARS', caller.name, caller.operatorId);
        if (r.changed) out.applied++; else out.ignored++;
      } catch (err) {
        if (!(err instanceof AppliedError)) await this.repo.logMovement({ operatorId: caller.operatorId, source: 'ACARS', raw, flightId: null, status: 'REJECTED', detail: (err as Error).message, receivedBy: caller.name }).catch(() => undefined);
        out.rejected.push({ message: raw, reason: (err as Error).message });
      }
    }
    return out;
  }

  /** From the OCC (a controller pastes or types an MVT). Errors go back to the user. */
  async ingestFromOcc(p: Principal, raw: string): Promise<FlightDto> {
    const m = parseMvt(stripTypeB(raw));
    await this.authz.check(p, { kind: 'flight', id: '*', attr: { operatorId: p.operatorId } }, 'manage');
    try {
      const r = await this.apply({ ...m, source: 'OCC' }, raw, 'OCC', actorOf(p), p.operatorId);
      return flightToDto(r.flight);
    } catch (e) {
      throw e instanceof AppliedError ? e.original : e; // keep the domain error's HTTP status for the controller
    }
  }

  async log(p: Principal, flightId?: string): Promise<MovementLogDto[]> {
    await this.authz.check(p, { kind: 'flight', id: flightId ?? '*', attr: { operatorId: p.operatorId } }, 'read');
    const rows = await this.repo.movementLog(p.operatorId, flightId);
    return rows.map(r => ({ id: r.id, receivedAt: r.receivedAt.toISOString(), source: r.source as MovementLogDto['source'], raw: r.raw, flightId: r.flightId, status: r.status as MovementLogDto['status'], detail: r.detail }));
  }

  private async find(m: Movement, operatorId: string) {
    const candidates = (await this.repo.flightsByNumber(m.flightNo, new Date(), operatorId)).filter(f => matchesFlight(f, m));
    if (candidates.length !== 1) {
      throw new DomainError('FLIGHT_NOT_FOUND', candidates.length ? `${m.flightNo}/${m.day} matches ${candidates.length} flights` : `No flight ${m.flightNo} on day ${m.day} within ±3 days`, 404);
    }
    return candidates[0];
  }

  private async apply(m: Movement, raw: string, source: 'MVT' | 'ACARS' | 'OCC', receivedBy: string, operatorId: string) {
    let flightId: string | null = null;
    try {
      const target = await this.find(m, operatorId);
      flightId = target.id;
      // Messages name stations by IATA code; the schedule uses ICAO.
      m = { ...m, stationIcao: await this.repo.icaoOf(m.station), estimatedArrivalStationIcao: await this.repo.icaoOf(m.estimatedArrivalStation) };
      if (m.estimatedArrivalStation && !m.estimatedArrivalStationIcao) throw new DomainError('MVT_STATION', `Unknown station ${m.estimatedArrivalStation}`);
      if ((m.touchdown || m.onBlock) && m.station && !m.stationIcao) throw new DomainError('MVT_STATION', `Unknown arrival station ${m.station}`);
      const now = new Date();
      // The log row is written in the same transaction as the change, so "applied" is never reported for a
      // change that rolled back, nor "rejected" for one that committed.
      return await this.db.transaction(async () => {
        const f = await this.repo.flight(target.id, { lock: true });
        const r = applyMovement(f, m, now);
        if (!r.changed) {
          await this.repo.logMovement({ operatorId, source, raw, flightId, status: 'IGNORED', detail: 'Repeat of an earlier message', receivedBy });
          Metrics.movementMessages.add(1, { source, status: 'IGNORED' });
          return r;
        }
        const actor = `${source.toLowerCase()}:${receivedBy}`;
        await this.repo.updateFlight(r.flight, f.version);
        // A late (or early) actual/estimated time re-times the rest of the rotation, audited like a manual delay.
        const knockOn: string[] = [];
        if (r.flight.eta.getTime() !== f.eta.getTime()) {
          const rotation = await this.repo.rotation(f.tail, f.date);
          for (const k of propagate(r.flight, rotation, MIN_TURN_MINUTES)) {
            await this.repo.updateFlight(k, rotation.find(x => x.id === k.id)!.version);
            knockOn.push(k.id);
            await this.audit.record(this.db, CHAIN, {
              operatorId: k.operatorId, actor, action: 'flight.delayed', entityType: 'flight', entityId: k.id,
              data: { flightNo: k.flightNo, delayMinutes: k.delayMinutes, etd: k.etd.toISOString(), reason: `Knock-on from ${f.flightNo} (${source})` }
            });
            await this.outbox.add(this.db, {
              type: 'ops.flight.delayed',
              data: { flightId: k.id, flightNo: k.flightNo, tail: k.tail, etd: k.etd.toISOString(), delayMinutes: k.delayMinutes, reason: `Knock-on from ${f.flightNo}`, knockOn: [] }
            }, { operatorId: k.operatorId, actor: `system:${source.toLowerCase()}` });
          }
        }
        await this.audit.record(this.db, CHAIN, {
          operatorId: f.operatorId, actor, action: 'flight.movement', entityType: 'flight', entityId: f.id,
          data: {
            source, correction: m.correction, raw, knockOn,
            offBlock: r.flight.offBlock?.toISOString() ?? null, airborne: r.flight.airborne?.toISOString() ?? null,
            touchdown: r.flight.touchdown?.toISOString() ?? null, onBlock: r.flight.onBlock?.toISOString() ?? null,
            etd: r.flight.etd.toISOString(), eta: r.flight.eta.toISOString(), delayCodes: r.flight.delayCodes
          }
        });
        for (const e of r.events) {
          const ev = e.type === 'ops.flight.delayed' ? { ...e, data: { ...e.data, knockOn } } : e;
          await this.outbox.add(this.db, ev, { operatorId: f.operatorId, actor: `system:${source.toLowerCase()}` });
        }
        await this.repo.logMovement({ operatorId, source, raw, flightId, status: 'APPLIED', detail: knockOn.length ? `Knock-on: ${knockOn.length} later flight(s) re-timed` : null, receivedBy });
        Metrics.movementMessages.add(1, { source, status: 'APPLIED' });
        return r;
      });
    } catch (e) {
      await this.repo.logMovement({ operatorId, source, raw, flightId, status: 'REJECTED', detail: (e as Error).message, receivedBy }).catch(() => undefined);
      Metrics.movementMessages.add(1, { source, status: 'REJECTED' });
      throw new AppliedError((e as Error).message, e);
    }
  }
}

/** An error already logged by apply() (so callers do not log it twice); keeps the original for HTTP mapping. */
class AppliedError extends Error {
  constructor(message: string, readonly original: unknown) {
    super(message);
  }
}
