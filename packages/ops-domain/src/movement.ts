import { DomainError } from '@aeroos/kernel';
import type { DomainEvent } from '@aeroos/contracts';
import { blockMinutes, type Flight } from './flight';

/**
 * Aircraft movement messages.
 *
 *  - IATA MVT (AHM 780), as sent by ground handling / SITA Type B:
 *        MVT
 *        NK682/08.LNNGX.LHR
 *        AD0712/0724 EA0915 OSL
 *        DL93/0020
 *    AD = off-blocks/airborne, AA = touchdown/on-blocks, ED = estimated departure, EA = estimated arrival,
 *    DL = delay codes and durations, NI = next information, SI = free text. "COR MVT" corrects a previous message.
 *    Irregular: RR = return to ramp (before takeoff), FR = forced return (landed back at origin); an AA sent by a
 *    station other than the destination is a diversion; EA with another station announces one.
 *    Messages may arrive inside a Type B envelope (priority/addresses, originator line), see stripTypeB.
 *  - ACARS OOOI events from the datalink gateway: OUT (off-blocks), OFF (airborne), ON (touchdown), IN (on-blocks).
 *
 * Times in messages are UTC "hhmm" or "ddhhmm"; they are resolved against the flight's schedule.
 */

export interface DelayCode { code: string; minutes: number | null }

export interface Movement {
  source: 'MVT' | 'ACARS' | 'OCC';
  correction: boolean;
  flightNo: string;
  /** UTC day of month of the scheduled departure. */
  day: number;
  reg: string | null;
  station: string | null;
  offBlock?: string;
  airborne?: string;
  touchdown?: string;
  onBlock?: string;
  estimatedDeparture?: string;
  estimatedArrival?: string;
  estimatedArrivalStation?: string;
  nextInformation?: string;
  /** RR: returned to the ramp before takeoff (on-blocks back at the gate). */
  returnToRamp?: string;
  /** FR: forced return — airborne, landed back at the departure station (touchdown / on-blocks). */
  forcedReturn?: { touchdown: string; onBlock?: string };
  delays: DelayCode[];
  supplementary?: string;
  /** Set by the caller from the airport table (messages use IATA codes, the schedule ICAO). */
  stationIcao?: string | null;
  estimatedArrivalStationIcao?: string | null;
}

const TIME = /^(\d{2})?(\d{2})(\d{2})$/;

/** Parse one MVT message. Throws a DomainError naming the line it could not read. */
export function parseMvt(text: string): Movement {
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new DomainError('MVT_EMPTY', 'Empty movement message');
  let i = 0;
  let correction = false;
  if (/^(COR\s+)?MVT$/.test(lines[0])) {
    correction = lines[0].startsWith('COR');
    i++;
  }
  const id = /^([A-Z0-9]{2,3}\d{1,4}[A-Z]?)\/(\d{2})(?:\.([A-Z0-9]{3,8}))?(?:\.([A-Z]{3,4}))?$/.exec(lines[i] ?? '');
  if (!id) throw new DomainError('MVT_FLIGHT_LINE', `Cannot read the flight line "${lines[i] ?? ''}" (expected e.g. NK682/08.LNNGX.LHR)`);
  i++;
  const m: Movement = { source: 'MVT', correction, flightNo: id[1], day: Number(id[2]), reg: id[3] ?? null, station: id[4] ?? null, delays: [] };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const tokens = line.split(/\s+/);
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];
      let x: RegExpExecArray | null;
      if ((x = /^AD(\d{4,6})(?:\/(\d{4,6}))?$/.exec(tok))) {
        m.offBlock = x[1];
        if (x[2]) m.airborne = x[2];
      } else if ((x = /^AA(\d{4,6})(?:\/(\d{4,6}))?$/.exec(tok))) {
        m.touchdown = x[1];
        if (x[2]) m.onBlock = x[2];
      } else if ((x = /^ED(\d{4,6})$/.exec(tok))) {
        m.estimatedDeparture = x[1];
      } else if ((x = /^EA(\d{4,6})$/.exec(tok))) {
        m.estimatedArrival = x[1];
        if (tokens[t + 1] && /^[A-Z]{3,4}$/.test(tokens[t + 1])) m.estimatedArrivalStation = tokens[++t];
      } else if ((x = /^RR(\d{4,6})$/.exec(tok))) {
        m.returnToRamp = x[1];
      } else if ((x = /^FR(\d{4,6})(?:\/(\d{4,6}))?$/.exec(tok))) {
        m.forcedReturn = { touchdown: x[1], onBlock: x[2] };
      } else if ((x = /^NI(\d{4,6})$/.exec(tok))) {
        m.nextInformation = x[1];
      } else if (/^DL/.test(tok)) {
        // DL93/0020, DL93/41/0020/0015, DL93 (no duration)
        const parts = tok.slice(2).split('/').filter(Boolean);
        const codes = parts.filter(p => /^[0-9A-Z]{2}$/.test(p));
        const mins = parts.filter(p => /^\d{4}$/.test(p)).map(p => Number(p.slice(0, 2)) * 60 + Number(p.slice(2)));
        if (!codes.length) throw new DomainError('MVT_DELAY', `Cannot read delay "${tok}"`);
        codes.forEach((code, k) => m.delays.push({ code, minutes: mins[k] ?? null }));
      } else if (tok === 'SI') {
        m.supplementary = tokens.slice(t + 1).join(' ');
        break;
      } else if (/^SI\S/.test(tok)) {
        m.supplementary = [tok.slice(2), ...tokens.slice(t + 1)].join(' ');
        break;
      } else {
        throw new DomainError('MVT_ELEMENT', `Unknown element "${tok}" in line "${line}"`);
      }
    }
  }
  if (!m.offBlock && !m.touchdown && !m.estimatedDeparture && !m.estimatedArrival && !m.delays.length && !m.returnToRamp && !m.forcedReturn) {
    throw new DomainError('MVT_NO_CONTENT', 'The message has no departure, arrival, estimate or delay element');
  }
  return m;
}

/**
 * Remove a SITA/ARINC Type B envelope, if present:
 *   <SOH>QU OSLKKNK LHRKKNK        priority + destination addresses (may continue on further lines)
 *   .LHRKKBA 081012                originator + filing time
 *   <STX>MVT ... <ETX>             the message text
 * Also drops the NNNN end-of-message marker. Text without an envelope is returned unchanged.
 */
export function stripTypeB(raw: string): string {
  let unframed = raw;
  for (const code of [1, 2, 3, 4]) unframed = unframed.split(String.fromCharCode(code)).join('\n');
  const lines = unframed.replace(/\r/g, '').split('\n').map(l => l.trim());
  let i = 0;
  while (i < lines.length && !lines[i]) i++;
  if (/^Q[A-Z]\s+[A-Z0-9]{7}(\s+[A-Z0-9]{7})*$/.test(lines[i] ?? '')) {
    i++;
    while (i < lines.length && /^[A-Z0-9]{7}(\s+[A-Z0-9]{7})*$/.test(lines[i])) i++; // more addresses
    if (!/^\.[A-Z0-9]{7}(\s|$)/.test(lines[i] ?? '')) throw new DomainError('TYPEB_ENVELOPE', 'Type B envelope without an originator line (".XXXXXXX ddhhmm")');
    i++;
  }
  const body = lines.slice(i).filter(l => l !== 'NNNN');
  return body.join('\n').trim();
}

/** ACARS OOOI event as delivered by the datalink gateway. */
export function acarsMovement(e: { flightNo: string; day: number; reg: string; event: 'OUT' | 'OFF' | 'ON' | 'IN'; time: string }): Movement {
  if (!TIME.test(e.time)) throw new DomainError('ACARS_TIME', `Time "${e.time}" must be hhmm or ddhhmm UTC`);
  const m: Movement = { source: 'ACARS', correction: false, flightNo: e.flightNo, day: e.day, reg: e.reg.replace('-', ''), station: null, delays: [] };
  if (e.event === 'OUT') m.offBlock = e.time;
  if (e.event === 'OFF') m.airborne = e.time;
  if (e.event === 'ON') m.touchdown = e.time;
  if (e.event === 'IN') m.onBlock = e.time;
  return m;
}

/** Resolve "hhmm" / "ddhhmm" (UTC) to the instant nearest the reference (within ±18 h, across midnight). */
export function resolveTime(t: string, reference: Date): Date {
  const x = TIME.exec(t);
  if (!x) throw new DomainError('MVT_TIME', `Time "${t}" must be hhmm or ddhhmm UTC`);
  const [, dd, hh, mm] = x;
  if (Number(hh) > 23 || Number(mm) > 59) throw new DomainError('MVT_TIME', `Time "${t}" is not a valid UTC time`);
  const ref = reference.getTime();
  const candidates: number[] = [];
  for (const dayOffset of [-1, 0, 1]) {
    const d = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate() + dayOffset, Number(hh), Number(mm)));
    if (dd && d.getUTCDate() !== Number(dd)) continue;
    candidates.push(d.getTime());
  }
  if (!candidates.length) throw new DomainError('MVT_TIME', `Day ${dd} in "${t}" is not near the scheduled date`);
  const best = candidates.sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref))[0];
  if (Math.abs(best - ref) > 18 * 3_600_000) throw new DomainError('MVT_TIME', `Time "${t}" is more than 18 h from the schedule`);
  return new Date(best);
}

export interface Actuals { offBlock: Date | null; airborne: Date | null; touchdown: Date | null; onBlock: Date | null; delayCodes: DelayCode[] }
export type FlightWithActuals = Flight & Actuals;

const norm = (reg: string) => reg.replace('-', '').toUpperCase();

type MovementEvent = DomainEvent<'ops.flight.departed'> | DomainEvent<'ops.flight.arrived'> | DomainEvent<'ops.flight.delayed'> | DomainEvent<'ops.flight.diverted'>;

const GATE_TURN_MINUTES = 20;

/**
 * Apply a movement to a flight. Returns the updated flight and the facts to publish. Idempotent for
 * repeated identical messages; a correction ("COR MVT") may replace earlier actual times. Status never
 * goes backwards, except a return to ramp, which by definition puts a departed aircraft back at the gate.
 */
export function applyMovement(f: FlightWithActuals, m: Movement, now?: Date): {
  flight: FlightWithActuals;
  events: MovementEvent[];
  changed: boolean;
} {
  if (f.status === 'CANCELLED') throw new DomainError('FLIGHT_CANCELLED', `${f.flightNo} is cancelled`, 409);
  if (m.reg && norm(m.reg) !== norm(f.tail)) {
    throw new DomainError('REG_MISMATCH', `Message reports ${m.reg} but ${f.flightNo} is planned on ${f.tail}; swap the tail in the OCC first`, 409);
  }
  const landed = f.status === 'ARRIVED' || f.status === 'DIVERTED';
  if (m.returnToRamp && (landed || f.airborne || m.airborne)) {
    throw new DomainError('MVT_RR_AIRBORNE', `${f.flightNo} is already airborne or landed; a return after takeoff is FR (forced return) or a diversion`, 409);
  }
  const ref = f.std;
  const next: FlightWithActuals = { ...f, delayCodes: [...f.delayCodes], actualArr: f.actualArr ?? null, divertingTo: f.divertingTo ?? null };
  const set = <K extends 'offBlock' | 'airborne' | 'touchdown' | 'onBlock'>(k: K, t: string | undefined) => {
    if (!t) return;
    const v = resolveTime(t, k === 'touchdown' || k === 'onBlock' ? f.eta : ref);
    if (next[k] && !m.correction && next[k]!.getTime() !== v.getTime()) {
      throw new DomainError('ALREADY_REPORTED', `${f.flightNo} ${k} already reported as ${next[k]!.toISOString().slice(11, 16)}Z; send a COR MVT to correct it`, 409);
    }
    next[k] = v;
  };
  set('offBlock', m.offBlock);
  set('airborne', m.airborne);
  set('touchdown', m.touchdown ?? m.forcedReturn?.touchdown);
  set('onBlock', m.onBlock ?? m.forcedReturn?.onBlock);

  const events: MovementEvent[] = [];
  const block = blockMinutes(f);

  // Return to ramp: the aircraft is back at the gate; the off-block time no longer stands.
  let rampAt: Date | null = null;
  if (m.returnToRamp && !next.offBlock && f.status === 'DELAYED') {
    // Already back at the gate (a repeated RR): nothing to do.
  } else if (m.returnToRamp) {
    if (!next.offBlock) throw new DomainError('MVT_RR_NOT_DEPARTED', `${f.flightNo} has no off-block time; nothing to return from`, 409);
    rampAt = resolveTime(m.returnToRamp, ref);
    if (rampAt < next.offBlock) throw new DomainError('MVT_SEQUENCE', 'Return-to-ramp time is before off-blocks');
    next.offBlock = null;
    next.airborne = null;
  }

  // Where did (or will) the aircraft end up? A confirmed station (FR, or an arrival message naming its station)
  // sets actualArr; an announcement (EA to another station) only sets divertingTo. An arrival without a
  // station (ACARS) confirms nothing: an announced diversion then stays visible as unconfirmed.
  const reported = m.stationIcao ?? null;
  const arrival = !!(m.touchdown || m.onBlock || m.forcedReturn);
  let confirmed: string | null | undefined; // undefined = no statement about the station
  if (m.forcedReturn) {
    if (!next.offBlock) throw new DomainError('MVT_FR_NOT_DEPARTED', `${f.flightNo} has no off-block time; a forced return needs a departure first`, 409);
    confirmed = f.dep;
  } else if (arrival && reported) {
    confirmed = reported === f.arr ? null : reported;
  }
  if (confirmed !== undefined) {
    const current = f.actualArr ?? null;
    if (landed && f.onBlock && confirmed !== current && !m.correction) {
      throw new DomainError('ALREADY_REPORTED', `${f.flightNo} already reported on blocks at ${current ?? f.arr}; send a COR MVT to change the arrival station`, 409);
    }
    next.actualArr = confirmed;
    next.divertingTo = null;
  } else if (m.estimatedArrivalStationIcao && !next.onBlock) {
    next.divertingTo = m.estimatedArrivalStationIcao === f.arr ? null : m.estimatedArrivalStationIcao; // diversion announced
  }

  // Actual times cannot be in the future (10 min tolerance for clock skew between station and server).
  if (now) {
    for (const [k, v] of [['offBlock', next.offBlock], ['airborne', next.airborne], ['touchdown', next.touchdown], ['onBlock', next.onBlock], ['return to ramp', rampAt]] as const) {
      if (v && v.getTime() > now.getTime() + 10 * 60_000) {
        throw new DomainError('MVT_FUTURE', `${f.flightNo} ${k} ${v.toISOString().slice(11, 16)}Z is in the future`);
      }
    }
  }
  if (next.airborne && next.offBlock && next.airborne < next.offBlock) throw new DomainError('MVT_SEQUENCE', 'Airborne time is before off-blocks');
  if (next.touchdown && next.airborne && next.touchdown < next.airborne) throw new DomainError('MVT_SEQUENCE', 'Touchdown is before airborne');
  if (next.onBlock && next.touchdown && next.onBlock < next.touchdown) throw new DomainError('MVT_SEQUENCE', 'On-blocks time is before touchdown');

  // Estimates before departure.
  if (m.estimatedDeparture && !next.offBlock) {
    const ed = resolveTime(m.estimatedDeparture, ref);
    next.etd = ed;
    next.eta = new Date(ed.getTime() + block * 60_000);
  } else if (rampAt) {
    // Back at the gate: no new estimate yet; assume a short turn-around at the gate.
    next.etd = new Date(Math.max(f.etd.getTime(), rampAt.getTime() + GATE_TURN_MINUTES * 60_000));
    next.eta = new Date(next.etd.getTime() + block * 60_000);
  }
  if (m.delays.length) next.delayCodes = m.delays;
  // Actual departure fixes ETD; EA (or block time) gives ETA.
  if (next.offBlock) next.etd = next.offBlock;
  if (m.estimatedArrival) next.eta = resolveTime(m.estimatedArrival, f.eta);
  else if (next.offBlock && !next.onBlock && !f.offBlock) next.eta = new Date(next.offBlock.getTime() + block * 60_000);
  if (next.onBlock) next.eta = next.onBlock;

  next.delayMinutes = Math.max(0, Math.round((next.etd.getTime() - f.std.getTime()) / 60_000));
  if (next.delayMinutes > 0 && !next.delayReason) next.delayReason = next.delayCodes.map(d => d.code).join('/') || 'MVT';
  const wasDeparted = f.status === 'DEPARTED' || landed;
  const elsewhere = !!next.actualArr && next.actualArr !== f.arr;
  if (next.onBlock) next.status = elsewhere ? 'DIVERTED' : 'ARRIVED';
  else if (next.offBlock) next.status = landed ? f.status : 'DEPARTED'; // never backwards (e.g. after simulated arrival)
  else if (rampAt) next.status = 'DELAYED';
  else next.status = wasDeparted ? f.status : next.delayMinutes > 0 ? 'DELAYED' : 'SCHEDULED';

  if (!wasDeparted && next.offBlock) {
    events.push({ type: 'ops.flight.departed', data: { flightId: f.id, flightNo: f.flightNo, tail: f.tail, offBlock: next.offBlock.toISOString(), airborne: next.airborne?.toISOString() ?? null, delayMinutes: next.delayMinutes, delayCodes: next.delayCodes.map(d => d.code) } });
  } else if (!next.offBlock && next.etd.getTime() !== f.etd.getTime()) {
    events.push({ type: 'ops.flight.delayed', data: { flightId: f.id, flightNo: f.flightNo, tail: f.tail, etd: next.etd.toISOString(), delayMinutes: next.delayMinutes, reason: next.delayReason ?? 'MVT', knockOn: [] } });
  }
  if (rampAt) {
    events.push({ type: 'ops.flight.diverted', data: { flightId: f.id, flightNo: f.flightNo, tail: f.tail, kind: 'RETURN_TO_RAMP', plannedArr: f.arr, station: f.dep, at: rampAt.toISOString() } });
  }
  // Diverted / returned: when the aircraft is first on blocks somewhere else, or a correction moves it.
  if (next.onBlock && elsewhere && (!f.onBlock || (f.actualArr ?? null) !== next.actualArr)) {
    events.push({ type: 'ops.flight.diverted', data: { flightId: f.id, flightNo: f.flightNo, tail: f.tail, kind: next.actualArr === f.dep ? 'FORCED_RETURN' : 'DIVERSION', plannedArr: f.arr, station: next.actualArr!, at: next.onBlock.toISOString() } });
  }
  // Arrived (utilisation for CAMO): the first time both off-blocks and on-blocks are known — even when the
  // departure message came late, after a simulated or station-less arrival. CAMO books each flight once.
  if (next.onBlock && next.offBlock && !(f.onBlock && f.offBlock)) {
    const airborneMin = next.airborne && next.touchdown ? Math.round((next.touchdown.getTime() - next.airborne.getTime()) / 60_000) : null;
    events.push({
      type: 'ops.flight.arrived',
      data: { flightId: f.id, flightNo: f.flightNo, tail: f.tail, blockMinutes: Math.round((next.onBlock.getTime() - next.offBlock.getTime()) / 60_000), flightMinutes: airborneMin, arrivedAt: next.onBlock.toISOString(), source: 'MESSAGE', station: next.actualArr ?? f.arr }
    });
  }
  const key = (x: FlightWithActuals) => JSON.stringify([x.etd, x.eta, x.status, x.offBlock, x.airborne, x.touchdown, x.onBlock, x.delayCodes, x.actualArr ?? null, x.divertingTo ?? null]);
  const changed = key(next) !== key(f);
  return { flight: changed ? { ...next, version: f.version + 1 } : f, events: changed ? events : [], changed };
}

/** Find the flight a message refers to: flight number and UTC day of the scheduled departure. */
export function matchesFlight(f: Pick<Flight, 'flightNo' | 'std'>, m: Pick<Movement, 'flightNo' | 'day'>): boolean {
  return f.flightNo === m.flightNo && f.std.getUTCDate() === m.day;
}
