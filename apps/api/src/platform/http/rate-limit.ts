import { createHash } from 'node:crypto';

/** Collapse per-entity REST paths so one caller cannot create an unbounded counter cardinality. */
export function normalizeRateLimitRoute(url: string): string {
  return url.split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

/** Hash identities before persisting rate-limit buckets. */
export function rateLimitIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
