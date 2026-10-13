import { cabinOf } from './flight';
/**
 * Deterministic demo schedule for the fictional operator Nordkapp Air (NKX), generated per
 * operating day so a fresh stack always has "today". Times are UTC minutes after midnight.
 * Used only when SEED_DEMO=true.
 */
export interface DemoLeg { flightNo: string; dep: string; arr: string; stdMin: number; block: number }
/** Each crew slot is flown by two crews on alternating days, so the demo roster stays inside the cumulative limits. */
export interface DemoRotation { tail: string; type: string; qualification: string; legs: DemoLeg[]; crew: { key: string; legs: number[]; slot: number }[] }

const L = (n: number, dep: string, arr: string, h: number, m: number, block: number): DemoLeg => ({ flightNo: `NK${n}`, dep, arr, stdMin: h * 60 + m, block });

export const DEMO_ROTATIONS: DemoRotation[] = [
  {
    tail: 'LN-ABC', type: 'B737-800', qualification: 'B737',
    legs: [L(601, 'ENGM', 'ENBR', 5, 30, 55), L(602, 'ENBR', 'ENGM', 7, 5, 55), L(641, 'ENGM', 'ENVA', 9, 0, 55), L(642, 'ENVA', 'ENGM', 10, 35, 55),
      L(661, 'ENGM', 'EKCH', 13, 0, 70), L(662, 'EKCH', 'ENGM', 14, 50, 70), L(621, 'ENGM', 'ENZV', 17, 30, 55), L(622, 'ENZV', 'ENGM', 19, 5, 55)],
    crew: [{ key: 'AM', legs: [0, 1, 2, 3], slot: 1 }, { key: 'PM', legs: [4, 5, 6, 7], slot: 2 }]
  },
  {
    tail: 'LN-ABD', type: 'B737-800', qualification: 'B737',
    legs: [L(631, 'ENGM', 'ENTC', 6, 0, 110), L(632, 'ENTC', 'ENGM', 8, 35, 110), L(671, 'ENGM', 'ESSA', 11, 30, 60), L(672, 'ESSA', 'ENGM', 13, 15, 60),
      L(603, 'ENGM', 'ENBR', 15, 30, 55), L(604, 'ENBR', 'ENGM', 17, 5, 55)],
    crew: [{ key: 'AM', legs: [0, 1, 2, 3], slot: 3 }, { key: 'PM', legs: [4, 5], slot: 4 }]
  },
  {
    tail: 'LN-NGX', type: 'B737 MAX 8', qualification: 'B737',
    legs: [L(681, 'ENGM', 'EGLL', 7, 0, 125), L(682, 'EGLL', 'ENGM', 10, 0, 120), L(651, 'ENGM', 'ENBO', 13, 30, 85), L(652, 'ENBO', 'ENGM', 15, 40, 85)],
    crew: [{ key: 'D', legs: [0, 1, 2, 3], slot: 5 }]
  },
  {
    tail: 'LN-RKF', type: 'A320neo', qualification: 'A320',
    legs: [L(663, 'ENGM', 'EKCH', 6, 30, 70), L(664, 'EKCH', 'ENGM', 8, 20, 70), L(643, 'ENGM', 'ENVA', 12, 0, 55), L(644, 'ENVA', 'ENGM', 13, 35, 55)],
    crew: [{ key: 'D', legs: [0, 1, 2, 3], slot: 6 }]
  },
  {
    // AOG in the demo fleet: its flights need recovering — the optimiser's job.
    tail: 'LN-RKG', type: 'A320neo', qualification: 'A320',
    legs: [L(605, 'ENGM', 'ENBR', 8, 0, 55), L(606, 'ENBR', 'ENGM', 9, 35, 55), L(623, 'ENGM', 'ENZV', 15, 0, 55), L(624, 'ENZV', 'ENGM', 16, 35, 55)],
    crew: [{ key: 'D', legs: [0, 1, 2, 3], slot: 7 }]
  },
  {
    tail: 'LN-RTA', type: 'A330-300', qualification: 'A330',
    legs: [L(691, 'ENGM', 'GCLP', 9, 0, 285), L(692, 'GCLP', 'ENGM', 15, 0, 290)],
    crew: [{ key: 'D', legs: [0, 1], slot: 8 }]
  }
];

const CAPTAINS = ['Ola Hansen', 'Kari Nilsen', 'Erik Johansen', 'Ingrid Larsen', 'Lars Andersen', 'Silje Pedersen', 'Jonas Berg', 'Nora Haugen', 'Anders Lie',
  'Marit Dahl', 'Sindre Moen', 'Hanne Bakken', 'Petter Eide', 'Line Lund', 'Tor Solli', 'Eva Strand', 'Knut Holm', 'Ane Vik'];
const FIRST_OFFICERS = ['Emma Aas', 'Henrik Ruud', 'Sofie Lien', 'Magnus Berge', 'Ida Fossum', 'Aksel Næss', 'Thea Sandvik', 'Oskar Myhre', 'Maja Tveit',
  'Filip Aune', 'Julie Hagen', 'Sander Brekke', 'Live Rønning', 'Elias Ness', 'Vilde Ask', 'Mathias Moe', 'Tiril Lunde', 'Kasper Gran'];

export interface DemoCrew { id: string; name: string; rank: 'CPT' | 'FO'; base: string; qualifications: string[] }

const crewId = (rank: 'CPT' | 'FO', slot: number, odd: boolean, prefix = '') => `${prefix}${rank}-${String(slot).padStart(2, '0')}${odd ? 'B' : 'A'}`;

/** Two crews (A/B) per slot. */
export function demoCrew(rotations: DemoRotation[], prefix = '', names: { cpt: string[]; fo: string[] } = { cpt: CAPTAINS, fo: FIRST_OFFICERS }): DemoCrew[] {
  return rotations.flatMap(r => r.crew.map(c => ({ r, c }))).flatMap(({ r, c }) => ([false, true] as const).flatMap(odd => {
    const i = (c.slot - 1) * 2 + (odd ? 1 : 0);
    return [
      { id: crewId('CPT', c.slot, odd, prefix), name: names.cpt[i % names.cpt.length], rank: 'CPT' as const, base: r.legs[0].dep, qualifications: [r.qualification] },
      { id: crewId('FO', c.slot, odd, prefix), name: names.fo[i % names.fo.length], rank: 'FO' as const, base: r.legs[0].dep, qualifications: [r.qualification] }
    ];
  }));
}

export const DEMO_CREW: DemoCrew[] = demoCrew(DEMO_ROTATIONS);

/**
 * Second demo operator, Fjell Regional (FJR): a small turboprop network out of Bergen. It exists to
 * show operator scoping — users in both groups switch between the two; nobody else sees FJR data.
 */
export const FJR_ROTATIONS: DemoRotation[] = [
  {
    tail: 'LN-WFA', type: 'DHC-8-400', qualification: 'DHC8',
    legs: [L(401, 'ENBR', 'ENAL', 6, 10, 50), L(402, 'ENAL', 'ENBR', 7, 40, 50), L(411, 'ENBR', 'ENEV', 9, 10, 75), L(412, 'ENEV', 'ENBR', 11, 5, 75)],
    crew: [{ key: 'D', legs: [0, 1, 2, 3], slot: 1 }]
  },
  {
    tail: 'LN-WFB', type: 'DHC-8-400', qualification: 'DHC8',
    legs: [L(421, 'ENBR', 'ENTO', 7, 0, 45), L(422, 'ENTO', 'ENBR', 8, 25, 45), L(431, 'ENBR', 'ENHD', 14, 0, 40), L(432, 'ENHD', 'ENBR', 15, 20, 40)],
    crew: [{ key: 'D', legs: [0, 1, 2, 3], slot: 2 }]
  }
].map(r => ({ ...r, legs: r.legs.map(l => ({ ...l, flightNo: l.flightNo.replace(/^NK/, 'FJ') })) }));
export const FJR_CREW: DemoCrew[] = demoCrew(FJR_ROTATIONS, 'FJR-', {
  cpt: ['Arne Skogen', 'Brit Vatne', 'Dag Myklebust', 'Gro Hauge'], fo: ['Even Tysse', 'Frida Bøe', 'Hallvard Rød', 'Inger Sele']
});

/**
 * Airport standby at the base (ENGM): an early and a late shift for each type rating, a captain and a
 * first officer each. Crew recovery prefers them over calling crew out from a day off.
 */
const STANDBY_SHIFTS = [
  { key: 'S1', rating: 'B737', startMin: 4 * 60, endMin: 14 * 60 },
  { key: 'S2', rating: 'B737', startMin: 12 * 60, endMin: 22 * 60 },
  { key: 'S3', rating: 'A320', startMin: 4 * 60, endMin: 14 * 60 },
  { key: 'S4', rating: 'A320', startMin: 12 * 60, endMin: 22 * 60 }
] as const;
const STANDBY_NAMES = ['Rune Halvorsen', 'Kristin Aasen', 'Bjørn Sæther', 'Tone Rød', 'Geir Opsahl', 'Mona Kvam', 'Stian Lie', 'Hege Fjeld'];

export const DEMO_STANDBY_CREW: DemoCrew[] = STANDBY_SHIFTS.flatMap((s, i) => [
  { id: `CPT-${s.key}`, name: STANDBY_NAMES[i * 2], rank: 'CPT' as const, base: 'ENGM', qualifications: [s.rating] },
  { id: `FO-${s.key}`, name: STANDBY_NAMES[i * 2 + 1], rank: 'FO' as const, base: 'ENGM', qualifications: [s.rating] }
]);

export function demoStandby(date: string): { crewId: string; start: Date; end: Date }[] {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  return STANDBY_SHIFTS.flatMap(s => ['CPT', 'FO'].map(r => ({
    crewId: `${r}-${s.key}`, start: new Date(midnight + s.startMin * 60_000), end: new Date(midnight + s.endMin * 60_000)
  })));
}

export interface DemoFlight { id: string; flightNo: string; date: string; dep: string; arr: string; std: Date; sta: Date; tail: string; aircraftType: string; bookedPax: number }

/**
 * Deterministic demo load: 70–100 % of the cabin, and about one flight in six sold out, so crew
 * positioning sometimes has to use a jump seat (or find another flight).
 */
export function demoBookedPax(id: string, aircraftType: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const seats = cabinOf(aircraftType).seats;
  if (h % 6 === 0) return seats;
  return Math.floor(seats * (0.7 + ((h >>> 8) % 300) / 1000));
}
export interface DemoAssignment { crewId: string; flightId: string; role: 'CPT' | 'FO'; dutyKey: string }

export const flightId = (flightNo: string, date: string) => `${flightNo}-${date}`;

export function demoDay(date: string, rotations: DemoRotation[] = DEMO_ROTATIONS, prefix = ''): { flights: DemoFlight[]; assignments: DemoAssignment[] } {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const flights: DemoFlight[] = [];
  const assignments: DemoAssignment[] = [];
  for (const r of rotations) {
    r.legs.forEach(l => {
      const std = new Date(midnight + l.stdMin * 60_000);
      flights.push({ id: flightId(l.flightNo, date), flightNo: l.flightNo, date, dep: l.dep, arr: l.arr, std, sta: new Date(std.getTime() + l.block * 60_000), tail: r.tail, aircraftType: r.type, bookedPax: demoBookedPax(flightId(l.flightNo, date), r.type) });
    });
    const odd = Math.floor(midnight / 86_400_000) % 2 === 1;
    for (const c of r.crew) {
      for (const i of c.legs) {
        const id = flightId(r.legs[i].flightNo, date);
        const dutyKey = `${date}-${r.tail}-${c.key}`;
        assignments.push({ crewId: crewId('CPT', c.slot, odd, prefix), flightId: id, role: 'CPT', dutyKey }, { crewId: crewId('FO', c.slot, odd, prefix), flightId: id, role: 'FO', dutyKey });
      }
    }
  }
  return { flights, assignments };
}
