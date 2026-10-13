import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventTypes, eventUse } from './lib';

const types = eventTypes();
const { produced, consumed, subscribed } = eventUse(types);

test('the checker sees the event contracts (sanity)', () => {
  assert.ok(types.length > 25, `only ${types.length} event types`);
  assert.ok(subscribed.size >= 4);
});

test('every subscription names a known topic', () => {
  const bad = [...subscribed].flatMap(([m, s]) => [...s].filter(t => t.startsWith('unknown:') || t.startsWith('unresolved:')).map(t => `${m}: ${t}`));
  assert.deepEqual(bad, []);
});

test('every event type in the contracts is actually produced somewhere', () => {
  assert.deepEqual(types.filter(t => !produced.has(t)), []);
});

test('every module that reacts to an event type subscribes to that event\'s topic', () => {
  const problems: string[] = [];
  for (const [type, mods] of consumed) {
    const topic = type.split('.')[0];
    for (const m of mods) {
      const subs = subscribed.get(m);
      if (topic === m) continue; // the module's own events (built, not consumed)
      if (!subs) { problems.push(`${m} handles ${type} but has no Kafka subscription at all`); continue; }
      if (!subs.has(topic) && !subs.has('*')) problems.push(`${m} handles ${type} but subscribes only to ${[...subs].join(', ')}`);
    }
  }
  assert.deepEqual(problems, []);
});
