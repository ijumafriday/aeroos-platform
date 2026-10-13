import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRateLimitRoute, rateLimitIdentity } from './rate-limit';

test('normalizes numeric and UUID entity identifiers without collapsing semantic paths', () => {
  assert.equal(normalizeRateLimitRoute('/api/supply/orders/123/receive?x=1'), '/api/supply/orders/:id/receive');
  assert.equal(normalizeRateLimitRoute('/api/documents/550e8400-e29b-41d4-a716-446655440000/download'), '/api/documents/:id/download');
  assert.equal(normalizeRateLimitRoute('/api/health/ready'), '/api/health/ready');
});

test('identity hashing is deterministic and does not expose the source identity', () => {
  const a = rateLimitIdentity('u:subject:operator');
  assert.equal(a, rateLimitIdentity('u:subject:operator'));
  assert.notEqual(a, rateLimitIdentity('u:other:operator'));
  assert.equal(a.length, 32);
  assert.equal(a.includes('subject'), false);
});
