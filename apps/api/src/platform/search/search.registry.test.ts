import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from './search.registry';

test('search query parser separates domain/type filters from text', () => {
  assert.deepEqual(parseQuery('domain:safety type:report hydraulic leak'), { text: 'hydraulic leak', domain: 'safety', type: 'report' });
});

test('search query parser allows filter-only queries', () => {
  assert.deepEqual(parseQuery('type:flight'), { text: '', domain: null, type: 'flight' });
});
