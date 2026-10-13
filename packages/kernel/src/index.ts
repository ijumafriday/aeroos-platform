import { createHash, randomUUID } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted, undefined dropped, Dates as ISO-8601.
 * Every hash and signature in the platform is computed over this form, so the
 * same record always produces the same bytes regardless of key order or engine.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(v: unknown): unknown {
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(x => (x === undefined ? null : normalise(x)));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = normalise(x);
    }
    return out;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) throw new TypeError('Non-finite numbers cannot be canonicalised');
  if (typeof v === 'bigint') return v.toString();
  return v;
}

export const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

export const newId = () => randomUUID();

/** Errors that represent a broken business rule, not a bug. Mapped to 409/422 at the HTTP edge. */
export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number = 422) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };
export const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
