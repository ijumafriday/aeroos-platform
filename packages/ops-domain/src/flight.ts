import { DomainError } from '@aeroos/kernel';
import type { DomainEvent, FlightStatus } from '@aeroos/contracts';

const MIN = 60_000;

export interface Flight {
  id: string;
  operatorId: string;
  flightNo: string;
  /** Operating date (UTC) of the scheduled departure, YYYY-MM-DD. */
  date: string;
  dep: string;
  arr: string;
  std: Date;
  sta: Date;
  etd: Date;
  eta: Date;
  tail: string;
  aircraftType: string;
  status: FlightStatus;
  /** Where the aircraft actually ended up when not at `arr` (diversion, forced return). */
  actualArr?: string | null;
  /** Diversion announced (EA to another station) but not yet confirmed by an arrival at that station. */
  divertingTo?: string | null;
  /** Passengers booked (reservation system). Positioning crew need a free seat (or a jump seat). */
  bookedPax?: number;
  delayMinutes: number;
  delayReason: string | null;
  version: number;
}

export const blockMinutes = (f: Pick<Flight, 'std' | 'sta'>) => Math.round((f.sta.getTime() - f.std.getTime()) / MIN);
export const isLive = (f: Flight) => f.status !== 'CANCELLED';
/** Where the aircraft is after this flight. */
export const endStation = (f: Pick<Flight, 'arr' | 'actualArr' | 'divertingTo'>) => f.actualArr ?? f.divertingTo ?? f.arr;
export const canChange = (f: Flight) => f.status === 'SCHEDULED' || f.status === 'DELAYED';

function requireChangeable(f: Flight) {
  if (!canChange(f)) throw new DomainError('FLIGHT_NOT_CHANGEABLE', `${f.flightNo} is ${f.status.toLowerCase()}`, 409);
}

const withDelay = (f: Flight, delayMinutes: number, reason: string | null): Flight => {
  const etd = new Date(f.std.getTime() + delayMinutes * MIN);
  return {
    ...f,
    etd,
    eta: new Date(etd.getTime() + blockMinutes(f) * MIN),
    delayMinutes,
    delayReason: delayMinutes > 0 ? reason : null,
    status: delayMinutes > 0 ? 'DELAYED' : 'SCHEDULED',
    version: f.version + 1
  };
};

/**
 * Set the departure delay (total, relative to STD). Then push every later flight of the same tail
 * that no longer has its minimum turn — the knock-on the OCC would otherwise compute by hand.
 */
export function delayFlight(f: Flight, rotation: Flight[], delayMinutes: number, reason: string, minTurnMinutes: number): {
  flight: Flight; knockOn: Flight[]; event: DomainEvent<'ops.flight.delayed'>;
} {
  requireChangeable(f);
  if (!Number.isInteger(delayMinutes) || delayMinutes < 0 || delayMinutes > 24 * 60) {
    throw new DomainError('DELAY_INVALID', 'Delay must be a whole number of minutes between 0 and 1440');
  }
  if (delayMinutes > 0 && reason.trim().length < 3) throw new DomainError('REASON_REQUIRED', 'Give a delay reason (IATA code or text)');
  const flight = withDelay(f, delayMinutes, reason.trim());
  const knockOn = propagate(flight, rotation, minTurnMinutes);
  return {
    flight,
    knockOn,
    event: {
      type: 'ops.flight.delayed',
      data: { flightId: f.id, flightNo: f.flightNo, tail: f.tail, etd: flight.etd.toISOString(), delayMinutes, reason: reason.trim(), knockOn: knockOn.map(k => k.id) }
    }
  };
}

/** Later flights of the same tail, re-timed so each keeps `minTurn` after the previous arrival. */
export function propagate(changed: Flight, rotation: Flight[], minTurnMinutes: number): Flight[] {
  const later = rotation
    .filter(x => x.id !== changed.id && isLive(x) && x.tail === changed.tail && x.std.getTime() > changed.std.getTime())
    .sort((a, b) => a.std.getTime() - b.std.getTime());
  const out: Flight[] = [];
  let prev: Flight = changed;
  for (const x of later) {
    if (!canChange(x)) break;
    const earliest = prev.eta.getTime() + minTurnMinutes * MIN;
    if (x.etd.getTime() >= earliest) break; // the delay is absorbed here
    const delay = Math.ceil((earliest - x.std.getTime()) / MIN);
    const next = withDelay(x, delay, `Knock-on from ${changed.flightNo}`);
    out.push(next);
    prev = next;
  }
  return out;
}

export function cancelFlight(f: Flight, reason: string): { flight: Flight; event: DomainEvent<'ops.flight.cancelled'> } {
  requireChangeable(f);
  if (reason.trim().length < 3) throw new DomainError('REASON_REQUIRED', 'Give a cancellation reason');
  return {
    flight: { ...f, status: 'CANCELLED', delayReason: reason.trim(), version: f.version + 1 },
    event: { type: 'ops.flight.cancelled', data: { flightId: f.id, flightNo: f.flightNo, tail: f.tail, reason: reason.trim() } }
  };
}

/** Same aircraft type only; dispatchability is checked by the caller against the CAMO projection. */
export function changeTail(f: Flight, to: { reg: string; type: string; dispatchable: boolean; reasons: string[] }): {
  flight: Flight; event: DomainEvent<'ops.flight.tail_changed'>;
} {
  requireChangeable(f);
  if (to.reg === f.tail) throw new DomainError('SAME_TAIL', `${f.flightNo} is already on ${f.tail}`);
  if (to.type !== f.aircraftType) throw new DomainError('TYPE_MISMATCH', `${to.reg} is a ${to.type}; ${f.flightNo} is planned on a ${f.aircraftType}`);
  if (!to.dispatchable) throw new DomainError('NOT_DISPATCHABLE', `${to.reg} is not dispatchable: ${to.reasons.join('; ')}`);
  return {
    flight: { ...f, tail: to.reg, version: f.version + 1 },
    event: { type: 'ops.flight.tail_changed', data: { flightId: f.id, flightNo: f.flightNo, tail: to.reg, from: f.tail } }
  };
}

/** Problems in one tail's sequence of flights: short turns, overlaps and broken continuity. */
export function rotationIssues(flights: Flight[], minTurnMinutes: number): Map<string, string[]> {
  const issues = new Map<string, string[]>();
  const add = (id: string, m: string) => issues.set(id, [...(issues.get(id) ?? []), m]);
  const seq = flights.filter(isLive).sort((a, b) => a.etd.getTime() - b.etd.getTime());
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1];
    const b = seq[i];
    const turn = Math.round((b.etd.getTime() - a.eta.getTime()) / MIN);
    if (turn < 0) add(b.id, `Overlaps ${a.flightNo} on ${b.tail}`);
    else if (turn < minTurnMinutes) add(b.id, `Turn after ${a.flightNo} is ${turn} min (minimum ${minTurnMinutes})`);
    const at = endStation(a);
    if (at !== b.dep) {
      add(b.id, a.actualArr
        ? `${b.tail} is at ${at} after ${a.flightNo} (${a.actualArr === a.dep ? 'returned' : 'diverted'}) but ${b.flightNo} departs ${b.dep}`
        : a.divertingTo
          ? `${a.flightNo} is diverting to ${at} (unconfirmed) but ${b.flightNo} departs ${b.dep}`
          : `${b.tail} arrives ${a.arr} on ${a.flightNo} but ${b.flightNo} departs ${b.dep}`);
    }
  }
  return issues;
}

/** Passenger seats and seats usable by positioning crew when the cabin is full (cockpit/cabin jump seats). */
export const CABIN: Record<string, { seats: number; jumpSeats: number }> = {
  'B737-800': { seats: 186, jumpSeats: 2 },
  'B737 MAX 8': { seats: 189, jumpSeats: 2 },
  'A320neo': { seats: 180, jumpSeats: 2 },
  'A330-300': { seats: 300, jumpSeats: 3 },
  'DHC-8-400': { seats: 78, jumpSeats: 1 },
  'E195-E2': { seats: 136, jumpSeats: 1 },
  'ATR 72-600': { seats: 70, jumpSeats: 1 }
};
export const cabinOf = (type: string) => CABIN[type] ?? { seats: 100, jumpSeats: 1 };
