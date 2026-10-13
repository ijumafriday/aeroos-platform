import { DomainError } from '@aeroos/kernel';

/**
 * Flight dispatch: mass & balance (CAT.POL.MAB.100/105), performance-limited weights, the fuel plan
 * (CAT.OP.MPA.181 basic fuel scheme), tankering economics, the ICAO flight plan (Doc 4444) and the dispatch
 * release that brings them together with airworthiness, crew legality and overflight permits.
 * Pure functions; masses in kg, arms in metres from the reference datum, money in USD.
 */

/* ------------------------------------------------------------------ reference data */

export interface TypeData {
  type: string;
  icaoType: string;
  wake: 'L' | 'M' | 'H';
  seats: number;
  mzfw: number;
  mtow: number;
  mlw: number;
  maxFuel: number;
  /** Mean aerodynamic chord: leading edge (arm) and length, for %MAC. */
  lemac: number;
  mac: number;
  /** Centre-of-gravity envelope in %MAC (simplified: constant over weight). */
  fwdLimit: number;
  aftLimit: number;
  crewArm: number;
  paxArm: number;
  holdFwdArm: number;
  holdAftArm: number;
  fuelArm: number;
  /** Average cruise burn and holding burn (1,500 ft). */
  burnKgPerHour: number;
  holdKgPerMin: number;
  cruiseKt: number;
}

export interface AircraftWeight { tail: string; basicEmptyKg: number; basicArm: number; weighedOn: string }

/** Standard masses (CAT.POL.MAB.100, table 1 and 3): all-adult 84 kg, child 35 kg; crew 85 / 75 kg. */
export const STANDARD = { adult: 84, child: 35, infant: 0, flightCrew: 85, cabinCrew: 75 } as const;
/** Standard checked-bag mass per piece by flight type (CAT.POL.MAB.100, table 3): domestic 11, European region 13, intercontinental 15 kg. */
export const bagMass = (kind: 'DOMESTIC' | 'EUROPE' | 'INTERCONTINENTAL') => (kind === 'DOMESTIC' ? 11 : kind === 'EUROPE' ? 13 : 15);
/** Aircraft are reweighed at least every 4 years (CAT.POL.MAB.100(b)). */
export const REWEIGH_YEARS = 4;

/* ------------------------------------------------------------------ mass & balance */

export interface LoadInput {
  flightCrew: number;
  cabinCrew: number;
  adults: number;
  children: number;
  infants: number;
  bags: number;
  holdFwdKg: number;
  holdAftKg: number;
  /** Take-off fuel (block − taxi) and trip fuel, from the fuel plan. */
  takeoffFuelKg: number;
  tripFuelKg: number;
}

export interface LoadResult {
  dow: number;
  paxMass: number;
  bagMass: number;
  zfw: number;
  tow: number;
  lw: number;
  zfwMac: number;
  towMac: number;
  lwMac: number;
  limits: { mzfw: number; tow: number; lw: number; towBy: 'MTOW' | 'RTOW'; lwBy: 'MLW' | 'RLW' };
  underload: number;
  findings: string[];
}

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

export function massAndBalance(t: TypeData, a: AircraftWeight, l: LoadInput, o: { bagKind: 'DOMESTIC' | 'EUROPE' | 'INTERCONTINENTAL'; rtow: number | null; rlw: number | null; now: Date }): LoadResult {
  for (const [k, v] of Object.entries(l)) if (!Number.isFinite(v) || v < 0) throw new DomainError('LOAD_INVALID', `${k} must be zero or more`, 422);
  if (l.flightCrew < 2) throw new DomainError('LOAD_INVALID', 'At least two flight crew', 422);
  const findings: string[] = [];
  const crew = l.flightCrew * STANDARD.flightCrew + l.cabinCrew * STANDARD.cabinCrew;
  const paxMass = l.adults * STANDARD.adult + l.children * STANDARD.child + l.infants * STANDARD.infant;
  const bags = l.bags * bagMass(o.bagKind);
  const dow = a.basicEmptyKg + crew;
  const zfw = dow + paxMass + bags + l.holdFwdKg + l.holdAftKg;
  const tow = zfw + l.takeoffFuelKg;
  const lw = tow - l.tripFuelKg;
  // Moments: checked bags in the aft hold, cargo where the load planner put it.
  const zfwMoment = a.basicEmptyKg * a.basicArm + crew * t.crewArm + paxMass * t.paxArm + l.holdFwdKg * t.holdFwdArm + (l.holdAftKg + bags) * t.holdAftArm;
  const towMoment = zfwMoment + l.takeoffFuelKg * t.fuelArm;
  // Landing: trip fuel burned from the tanks moves the centre of gravity too.
  const lwMoment = towMoment - l.tripFuelKg * t.fuelArm;
  const mac = (moment: number, mass: number) => round(((moment / mass - t.lemac) / t.mac) * 100, 1);
  const zfwMac = mac(zfwMoment, zfw), towMac = mac(towMoment, tow), lwMac = mac(lwMoment, lw);
  const towLimit = o.rtow !== null && o.rtow < t.mtow ? o.rtow : t.mtow;
  const lwLimit = o.rlw !== null && o.rlw < t.mlw ? o.rlw : t.mlw;
  const limits = { mzfw: t.mzfw, tow: towLimit, lw: lwLimit, towBy: (towLimit < t.mtow ? 'RTOW' : 'MTOW') as 'MTOW' | 'RTOW', lwBy: (lwLimit < t.mlw ? 'RLW' : 'MLW') as 'MLW' | 'RLW' };
  if (zfw > t.mzfw) findings.push(`Zero-fuel mass ${round(zfw)} kg exceeds MZFW ${t.mzfw} kg`);
  if (tow > towLimit) findings.push(`Take-off mass ${round(tow)} kg exceeds the ${limits.towBy === 'RTOW' ? 'runway/performance limit' : 'MTOW'} ${towLimit} kg`);
  if (lw > lwLimit) findings.push(`Landing mass ${round(lw)} kg exceeds the ${limits.lwBy === 'RLW' ? 'landing performance limit' : 'MLW'} ${lwLimit} kg`);
  if (l.takeoffFuelKg > t.maxFuel) findings.push(`Fuel ${l.takeoffFuelKg} kg exceeds tank capacity ${t.maxFuel} kg`);
  if (l.adults + l.children > t.seats) findings.push(`${l.adults + l.children} seated passengers for ${t.seats} seats`);
  if (l.infants > l.adults) findings.push('More infants than adults to hold them');
  for (const [name, v] of [['zero-fuel', zfwMac], ['take-off', towMac], ['landing', lwMac]] as const) {
    if (v < t.fwdLimit || v > t.aftLimit) findings.push(`Centre of gravity at ${name} mass ${v} %MAC outside ${t.fwdLimit}–${t.aftLimit} %MAC`);
  }
  const weighed = new Date(`${a.weighedOn}T00:00:00Z`);
  weighed.setUTCFullYear(weighed.getUTCFullYear() + REWEIGH_YEARS);
  if (weighed.getTime() < o.now.getTime()) findings.push(`${a.tail} was last weighed on ${a.weighedOn}: reweighing is overdue (every ${REWEIGH_YEARS} years)`);
  return {
    dow: round(dow), paxMass: round(paxMass), bagMass: round(bags), zfw: round(zfw), tow: round(tow), lw: round(lw), zfwMac, towMac, lwMac, limits,
    underload: round(Math.min(t.mzfw - zfw, towLimit - tow, lwLimit - lw)), findings
  };
}

/* ------------------------------------------------------------------ fuel (CAT.OP.MPA.181, basic scheme) */

export interface FuelPlan {
  taxi: number;
  trip: number;
  contingency: number;
  alternate: number;
  finalReserve: number;
  extra: number;
  required: number;
  block: number;
  /** block − required (negative = short). */
  margin: number;
}

export function fuelPlan(t: TypeData, i: { tripMinutes: number; alternateMinutes: number; taxi?: number; extra?: number; block: number }): FuelPlan {
  if (i.tripMinutes <= 0) throw new DomainError('FUEL_INVALID', 'Trip time must be positive', 422);
  const taxi = Math.round(i.taxi ?? 200);
  const trip = Math.round((t.burnKgPerHour * i.tripMinutes) / 60);
  // Contingency: 5 % of trip fuel, never less than 5 minutes holding at 1,500 ft above the destination.
  const contingency = Math.round(Math.max(trip * 0.05, t.holdKgPerMin * 5));
  const alternate = Math.round((t.burnKgPerHour * i.alternateMinutes) / 60);
  const finalReserve = Math.round(t.holdKgPerMin * 30);
  const extra = Math.round(i.extra ?? 0);
  const required = taxi + trip + contingency + alternate + finalReserve + extra;
  return { taxi, trip, contingency, alternate, finalReserve, extra, required, block: Math.round(i.block), margin: Math.round(i.block) - required };
}

/**
 * Tankering: carrying fuel for the next sector from a cheaper station. Each kilogram carried costs extra burn
 * (about 3 % of the carried mass per flight hour); it pays when the price difference beats that. Limited by
 * the structural/performance margins (landing mass is usually the binding one) and the tanks.
 */
export const TANKERING_BURN_PER_HOUR = 0.03;

export function tankering(i: { priceDepPerKg: number; priceArrPerKg: number; flightMinutes: number; landingMargin: number; takeoffMargin: number; tankMargin: number; neededAtArrivalKg: number }):
  { carryKg: number; savingUsd: number; worthIt: boolean; reason: string } {
  const penalty = TANKERING_BURN_PER_HOUR * (i.flightMinutes / 60);
  const perKg = i.priceArrPerKg - i.priceDepPerKg * (1 + penalty);
  const room = Math.max(0, Math.min(i.landingMargin, i.takeoffMargin, i.tankMargin, i.neededAtArrivalKg));
  if (perKg <= 0) return { carryKg: 0, savingUsd: 0, worthIt: false, reason: 'Fuel at destination is not dearer than carrying it' };
  if (room <= 0) return { carryKg: 0, savingUsd: 0, worthIt: false, reason: 'No mass or tank margin to carry extra fuel' };
  const carryKg = Math.floor(room / 100) * 100;
  return { carryKg, savingUsd: Math.round(carryKg * perKg), worthIt: carryKg > 0, reason: `Carry ${carryKg} kg: ${round(perKg * 1000, 2)} USD saved per tonne after the extra burn` };
}

/* ------------------------------------------------------------------ ICAO flight plan (Doc 4444) */

const pad4 = (n: number) => String(n).padStart(4, '0');
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(Math.round(minutes % 60)).padStart(2, '0')}`;

export function icaoFlightPlan(i: {
  operatorIcao: string; flightNo: string; tail: string; t: TypeData; dep: string; arr: string; eobt: Date; tripMinutes: number;
  cruiseLevel: number; route: string; alternates: string[]; equipment?: string; pbn?: string
}): string {
  const number = i.flightNo.replace(/^[A-Z0-9]{2}(?=\d)/, '');
  const callsign = `${i.operatorIcao}${number}`;
  if (!/^[A-Z]{3}[0-9A-Z]{1,4}$/.test(callsign)) throw new DomainError('FPL_CALLSIGN', `Cannot form an ICAO callsign from ${i.flightNo}`, 422);
  const eobt = `${String(i.eobt.getUTCHours()).padStart(2, '0')}${String(i.eobt.getUTCMinutes()).padStart(2, '0')}`;
  const dof = i.eobt.toISOString().slice(2, 10).replace(/-/g, '');
  const speed = `N${pad4(i.t.cruiseKt)}`;
  const level = `F${String(i.cruiseLevel).padStart(3, '0')}`;
  return [
    `(FPL-${callsign}-IS`,
    `-${i.t.icaoType}/${i.t.wake}-${i.equipment ?? 'SDE2E3FGHIJ1RWY/LB1'}`,
    `-${i.dep}${eobt}`,
    `-${speed}${level} ${i.route || 'DCT'}`,
    `-${i.arr}${hhmm(i.tripMinutes)}${i.alternates.length ? ` ${i.alternates.slice(0, 2).join(' ')}` : ''}`,
    `-PBN/${i.pbn ?? 'A1B1C1D1'} DOF/${dof} REG/${i.tail.replace('-', '')})`
  ].join('\n');
}

/* ------------------------------------------------------------------ overflight permits */

export interface Permit { country: string; number: string; validFrom: string; validTo: string; types: string[] }

/** Countries on the route that require a permit, and whether a valid one covers this flight's date and type. */
export function permitCheck(countries: { code: string; permitRequired: boolean }[], permits: Permit[], date: string, type: string): { country: string; ok: boolean; permit: string | null; note: string }[] {
  return countries.filter(c => c.permitRequired).map(c => {
    const p = permits.find(x => x.country === c.code && x.validFrom <= date && x.validTo >= date && (x.types.length === 0 || x.types.includes(type)));
    return { country: c.code, ok: !!p, permit: p?.number ?? null, note: p ? `valid to ${p.validTo}` : `No valid ${c.code} overflight permit for ${type} on ${date}` };
  });
}

/* ------------------------------------------------------------------ dispatch release */

export interface ReleaseCheck { code: string; ok: boolean; message: string }

export const releasable = (checks: ReleaseCheck[]) => checks.every(c => c.ok);

/**
 * After release, a last-minute change within tolerance is recorded on the load sheet (LMC); beyond it the
 * release is withdrawn and the load sheet is redone (operator's LMC tolerance, here 500 kg or 10 passengers).
 */
export const LMC_TOLERANCE = { kg: 500, pax: 10 };
export function lmcWithinTolerance(before: { tow: number; pax: number }, after: { tow: number; pax: number }) {
  return Math.abs(after.tow - before.tow) <= LMC_TOLERANCE.kg && Math.abs(after.pax - before.pax) <= LMC_TOLERANCE.pax;
}
