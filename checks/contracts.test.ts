import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRoutes, matches, pythonCalls, skippedWebCalls, unresolvedRoutes, webCalls, workerCalls, type Call } from './lib';

const routes = apiRoutes();
const unmatched = (calls: Call[]) => calls.filter(c => !routes.some(r => matches(r, c.method, c.path))).map(c => `${c.method} ${c.path}  (${c.where})`);

test('the API has the routes this check expects to find (sanity)', () => {
  assert.ok(routes.length > 60, `only ${routes.length} routes found`);
  assert.ok(routes.some(r => r.method === 'POST' && r.path === '/api/amo/task-cards/:id/crs'));
});

test('every API call in the web app hits a real route with the right method', () => {
  const calls = webCalls();
  assert.ok(calls.length > 40, `only ${calls.length} calls found`);
  assert.deepEqual(unmatched(calls), []);
  assert.deepEqual(skippedWebCalls, [], 'calls whose path or method cannot be read statically — write the path as a literal or template');
});

test('every route decorator is statically readable (no versioned or computed paths the check would miss)', () => {
  assert.deepEqual(unresolvedRoutes, []);
});

test('the matcher rejects what it should (self-test)', () => {
  const r = { method: 'POST', path: '/api/ops/flights/:id/delay', where: '' };
  assert.ok(matches(r, 'POST', '/api/ops/flights/*/delay'));
  assert.ok(!matches(r, 'GET', '/api/ops/flights/*/delay'));
  assert.ok(!matches(r, 'POST', '/api/ops/flight/*/delay'));
  assert.ok(!matches(r, 'POST', '/api/ops/flights/*/delay/extra'));
});

test('a static segment is not shadowed by a :param route declared on the same controller', () => {
  const shadowed: string[] = [];
  for (const a of routes) for (const b of routes) {
    if (a === b || a.method !== b.method || a.where.split(':')[0] !== b.where.split(':')[0]) continue;
    const x = a.path.split('/'), y = b.path.split('/');
    if (x.length !== y.length) continue;
    // a declared before b, a has :param where b has a literal, otherwise equal → b is unreachable in Express-style routers
    const ai = Number(a.where.split(':')[1]), bi = Number(b.where.split(':')[1]);
    if (ai < bi && x.every((s, i) => s === y[i] || (s.startsWith(':') && !y[i].startsWith(':'))) && x.some((s, i) => s.startsWith(':') && !y[i].startsWith(':'))) shadowed.push(`${b.method} ${b.path} (${b.where}) shadowed by ${a.path}`);
  }
  assert.deepEqual(shadowed, []);
});

test('every internal call from the TypeScript worker hits a real route', () => {
  const calls = workerCalls();
  assert.ok(calls.length >= 5);
  assert.deepEqual(unmatched(calls), []);
});

test('the Python optimiser reports to real routes', () => {
  const calls = pythonCalls();
  assert.equal(calls.length, 2);
  assert.deepEqual(unmatched(calls), []);
});

test('no two handlers claim the same method and path', () => {
  const seen = new Map<string, string>();
  const dup: string[] = [];
  for (const r of routes) {
    const k = `${r.method} ${r.path.replace(/:[^/]+/g, ':')}`;
    if (seen.has(k)) dup.push(`${k}  (${seen.get(k)} and ${r.where})`);
    else seen.set(k, r.where);
  }
  assert.deepEqual(dup, []);
});
