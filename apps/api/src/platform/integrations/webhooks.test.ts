import test from 'node:test';
import assert from 'node:assert/strict';
import { WebhookService } from './webhooks.service';

const service = new WebhookService(
  { NODE_ENV: 'development' } as never,
  {} as never,
  {} as never,
  {} as never
);

test('webhook event types must be current contract event names', () => {
  assert.deepEqual(service.validateEventTypes(['ops.flight.arrived', 'ops.flight.arrived']), ['ops.flight.arrived']);
  assert.throws(() => service.validateEventTypes(['ops.made_up.event']), /unknown event type/);
});

test('webhook endpoints reject embedded credentials', async () => {
  await assert.rejects(() => service.validateEndpoint('https://user:pass@example.com/hook'), /must not contain credentials/);
  assert.equal(await service.validateEndpoint('https://example.com/hook'), 'https://example.com/hook');
});
