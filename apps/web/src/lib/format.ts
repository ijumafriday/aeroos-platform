const pad = (n: number) => String(n).padStart(2, '0');

export const zulu = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getUTCDate())} ${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
};

export function remaining(ms: number) {
  if (ms <= 0) return 'EXPIRED';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  return `${d ? `${d}d ` : ''}${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export const tone = (ms: number) => (ms <= 6 * 3_600_000 ? 'red' : ms <= 48 * 3_600_000 ? 'amber' : 'green');

export const catTone = (c: string) => (c === 'A' ? 'red' : c === 'B' ? 'amber' : c === 'C' ? 'cyan' : '');

export const short = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-6)}`;
