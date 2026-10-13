import { DomainError } from '@aeroos/kernel';

/**
 * Engine condition trend monitoring (ECTM) and oil consumption — the engine health part of the CAMO's
 * reliability programme (AMC1 CAMO.A.315(b) / Part-M M.A.302(f)).
 *
 * Inputs are stabilised-cruise snapshots corrected to standard day by the engine's monitoring software
 * (deltas against the engine's baseline model): ΔEGT (°C), ΔN2 (%), ΔFF (%), vibration (units) and the take-off
 * EGT margin (°C). The rules below are the usual OEM-style ones — a step shift between two averaging windows,
 * a margin below the operator's limit, a margin trend that runs out soon, vibration above the limit — with the
 * limits held per engine type. They flag engines to look at; they do not replace the OEM's own diagnostics.
 */

export interface EngineSnapshot { at: Date; fh: number; egtDev: number; n2Dev: number; ffDevPct: number; vib: number; egtMargin: number }

export interface EngineLimits {
  egtMarginAmber: number; egtMarginRed: number; egtShift: number; n2Shift: number; ffShift: number; vibMax: number;
  /** Oil: alert (investigate) and maximum (AMM limit) consumption, quarts per engine flight hour. */
  oilAlertQph: number; oilMaxQph: number;
}

export type AlertLevel = 'AMBER' | 'RED';
export type EngineAlertCode = 'EGT_MARGIN' | 'EGT_MARGIN_TREND' | 'EGT_SHIFT' | 'N2_SHIFT' | 'FF_SHIFT' | 'VIBRATION' | 'OIL_CONSUMPTION' | 'OIL_RISING';
export interface EngineAlert { code: EngineAlertCode; level: AlertLevel; message: string; action: string }

/** Snapshots averaged per window for shift detection. */
export const SHIFT_WINDOW = 5;
/** Margin trend: warn when the projected margin reaches the red limit within this many flight hours. */
export const MARGIN_HORIZON_FH = 500;

/** Least-squares slope (y per x) and intercept; null with fewer than 3 points or no spread in x. */
export function linearFit(points: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  if (points.length < 3) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n, my = points.reduce((s, p) => s + p.y, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  return { slope, intercept: my - slope * mx };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Step change: mean of the last `window` values against the `window` before them. */
export function shift(values: number[], window = SHIFT_WINDOW): number | null {
  if (values.length < 2 * window) return null;
  return mean(values.slice(-window)) - mean(values.slice(-2 * window, -window));
}

/** Trend alerts for one engine from its snapshots (any order). */
export function engineAlerts(snapshots: EngineSnapshot[], l: EngineLimits): EngineAlert[] {
  const s = [...snapshots].sort((a, b) => a.fh - b.fh || a.at.getTime() - b.at.getTime());
  if (!s.length) return [];
  const out: EngineAlert[] = [];
  const last = s[s.length - 1];
  // smoothed current margin: the mean of the last window (one noisy reading does not raise an alert)
  const margin = mean(s.slice(-SHIFT_WINDOW).map(x => x.egtMargin));
  if (margin <= l.egtMarginRed) {
    out.push({ code: 'EGT_MARGIN', level: 'RED', message: `EGT margin ${margin.toFixed(0)} °C — at or below the ${l.egtMarginRed} °C limit`, action: 'Plan engine removal / performance restoration; consider de-rate limits' });
  } else if (margin <= l.egtMarginAmber) {
    out.push({ code: 'EGT_MARGIN', level: 'AMBER', message: `EGT margin ${margin.toFixed(0)} °C — below ${l.egtMarginAmber} °C`, action: 'Engine wash; borescope hot section; plan the shop visit' });
  }
  const recent = s.filter(x => x.fh >= last.fh - 1000);
  const fit = linearFit(recent.map(x => ({ x: x.fh, y: x.egtMargin })));
  if (fit && fit.slope < 0 && margin > l.egtMarginRed) {
    const fhToRed = (l.egtMarginRed - (fit.intercept + fit.slope * last.fh)) / fit.slope;
    if (fhToRed >= 0 && fhToRed <= MARGIN_HORIZON_FH) {
      out.push({ code: 'EGT_MARGIN_TREND', level: 'AMBER', message: `EGT margin falling ${(-fit.slope * 100).toFixed(1)} °C per 100 FH — reaches ${l.egtMarginRed} °C in about ${Math.round(fhToRed)} FH`, action: 'Forecast the removal; reserve a shop slot or spare engine' });
    }
  }
  const checks: [EngineAlertCode, number | null, number, string, string][] = [
    ['EGT_SHIFT', shift(s.map(x => x.egtDev)), l.egtShift, '°C', 'Borescope HPT/combustor; check EGT probes and bleed valves'],
    ['N2_SHIFT', shift(s.map(x => x.n2Dev)), l.n2Shift, '%', 'Check VBV/VSV rigging and N2 sensor; borescope HPC'],
    ['FF_SHIFT', shift(s.map(x => x.ffDevPct)), l.ffShift, '%', 'Check fuel flow transmitter and air leaks (bleed, ducts)']
  ];
  for (const [code, d, lim, unit, action] of checks) {
    if (d !== null && Math.abs(d) >= lim) {
      out.push({ code, level: Math.abs(d) >= 2 * lim ? 'RED' : 'AMBER', message: `${code.replace('_SHIFT', '')} step ${d > 0 ? '+' : ''}${d.toFixed(1)} ${unit} between the last two ${SHIFT_WINDOW}-flight averages`, action });
    }
  }
  const vib = mean(s.slice(-3).map(x => x.vib));
  if (vib > l.vibMax) out.push({ code: 'VIBRATION', level: vib > 1.5 * l.vibMax ? 'RED' : 'AMBER', message: `Vibration ${vib.toFixed(1)} above ${l.vibMax}`, action: 'Fan trim balance; inspect fan blades and bearings' });
  return out;
}

/* ------------------------------------------------------------------ oil */

export interface OilUplift { at: Date; fh: number; quarts: number }
export interface OilRate { at: Date; fh: number; qph: number }

/**
 * Consumption between uplifts: the oil added at an uplift was used since the previous uplift. The current rate
 * is quarts over hours across the last uplifts covering at least `minHours` (a single short sector is too noisy).
 */
export function oilConsumption(uplifts: OilUplift[], l: EngineLimits, minHours = 20): { rates: OilRate[]; current: number | null; alerts: EngineAlert[] } {
  const u = [...uplifts].sort((a, b) => a.fh - b.fh);
  const rates: OilRate[] = [];
  for (let i = 1; i < u.length; i++) {
    const h = u[i].fh - u[i - 1].fh;
    if (h > 0) rates.push({ at: u[i].at, fh: u[i].fh, qph: u[i].quarts / h });
  }
  const windowRate = (end: number) => {
    let q = 0, h = 0;
    for (let i = end; i >= 1 && h < minHours; i--) { q += u[i].quarts; h += u[i].fh - u[i - 1].fh; }
    return h >= minHours ? { qph: q / h, hours: h } : null;
  };
  const cur = u.length > 1 ? windowRate(u.length - 1) : null;
  const alerts: EngineAlert[] = [];
  if (cur) {
    if (cur.qph >= l.oilMaxQph) {
      alerts.push({ code: 'OIL_CONSUMPTION', level: 'RED', message: `Oil consumption ${cur.qph.toFixed(2)} qt/h — at or above the ${l.oilMaxQph} qt/h limit`, action: 'Do not dispatch until the cause is found (AMM): leak check, seals, scavenge, chip detectors' });
    } else if (cur.qph >= l.oilAlertQph) {
      alerts.push({ code: 'OIL_CONSUMPTION', level: 'AMBER', message: `Oil consumption ${cur.qph.toFixed(2)} qt/h — above the ${l.oilAlertQph} qt/h alert level`, action: 'Leak check; inspect chip detectors and filter; watch the next uplifts' });
    }
    // rising: the current window against the window before it
    let k = u.length - 1, h = 0;
    while (k >= 1 && h < cur.hours) { h += u[k].fh - u[k - 1].fh; k--; }
    const prev = k >= 1 ? windowRate(k) : null;
    if (prev && prev.qph > 0 && cur.qph >= 2 * prev.qph && cur.qph >= l.oilAlertQph / 2 && !alerts.length) {
      alerts.push({ code: 'OIL_RISING', level: 'AMBER', message: `Oil consumption doubled: ${prev.qph.toFixed(2)} → ${cur.qph.toFixed(2)} qt/h`, action: 'Leak check; inspect chip detectors and filter' });
    }
  }
  return { rates, current: cur ? cur.qph : null, alerts };
}

export function requireUplift(quarts: number, fh: number, lastFh: number | null) {
  if (!(quarts > 0) || quarts > 20) throw new DomainError('OIL_QUANTITY', 'Oil added must be between 0 and 20 quarts', 422);
  if (lastFh !== null && fh < lastFh) throw new DomainError('OIL_ORDER', `Aircraft hours ${fh} are before the last uplift (${lastFh} FH)`, 422);
}
