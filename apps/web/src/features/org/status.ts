/** Shared presentation helpers for Organization Core. */
export const DAY = 86_400_000;
export const authTone = (s: string) => (s === 'ACTIVE' ? 'green' : s === 'SUSPENDED' ? 'red' : '');
export const expiryTone = (iso: string, now: number) => {
  const d = Date.parse(iso) - now;
  return d <= 7 * DAY ? 'red' : d <= 30 * DAY ? 'amber' : d <= 90 * DAY ? 'cyan' : '';
};
export const inDays = (iso: string, now: number) => {
  const d = Math.ceil((Date.parse(iso) - now) / DAY);
  return d <= 0 ? 'expired' : d === 1 ? 'tomorrow' : `in ${d} days`;
};
