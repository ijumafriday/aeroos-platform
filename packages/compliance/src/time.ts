/**
 * Calendar-day arithmetic in an IANA time zone, using only Intl (no dependencies),
 * so MEL "calendar day" intervals are correct across DST changes.
 */

/** Offset of `zone` from UTC at instant `t`, in minutes (e.g. +120 for CEST). */
export function zoneOffsetMinutes(t: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60000);
}

/** The local calendar date of instant `t` in `zone`. */
export function localDate(t: number, zone: string): { y: number; m: number; d: number } {
  const off = zoneOffsetMinutes(t, zone);
  const l = new Date(t + off * 60000);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate() };
}

/** UTC instant of local midnight (00:00) on the given local date in `zone`. */
export function zonedMidnight(y: number, m: number, d: number, zone: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - zoneOffsetMinutes(guess, zone) * 60000;
  // Re-check once in case the offset differs at the corrected instant (DST transition day).
  const corrected = guess - zoneOffsetMinutes(t, zone) * 60000;
  if (corrected !== t) t = corrected;
  return new Date(t);
}

/**
 * End of the Nth calendar day after the day containing `t`, excluding that day itself.
 * Returned as the instant of local midnight that closes the interval.
 */
export function endOfCalendarDaysAfter(t: Date, days: number, zone: string): Date {
  const { y, m, d } = localDate(t.getTime(), zone);
  const target = new Date(Date.UTC(y, m - 1, d + days + 1));
  return zonedMidnight(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), zone);
}

/** Add calendar months in UTC, clamping to the last day of the target month (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(t: Date, months: number): Date {
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(t.getUTCDate(), last), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds(), t.getUTCMilliseconds()));
}
