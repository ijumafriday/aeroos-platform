import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authzUses, cerbosPolicies, realmRoles } from './lib';

const uses = authzUses();
const policies = cerbosPolicies();

test('the checker sees the authorisation calls (sanity)', () => {
  assert.ok(uses.length > 50, `only ${uses.length} found`);
  assert.ok(policies.size >= 10);
});

test('every resource kind the API checks has a Cerbos policy, resolvable statically', () => {
  const unresolved = uses.filter(u => !u.kind).map(u => `${u.action} (${u.where})`);
  assert.deepEqual(unresolved, [], 'could not tell which resource kind these calls use');
  const missing = [...new Set(uses.filter(u => u.kind && !policies.has(u.kind)).map(u => `${u.kind} (${u.where})`))];
  assert.deepEqual(missing, []);
});

test('every action the API checks is granted by some rule (otherwise Cerbos denies it for everyone)', () => {
  const missing = uses.filter(u => u.kind && policies.has(u.kind) && !policies.get(u.kind)!.has(u.action) && !policies.get(u.kind)!.has('*'))
    .map(u => `${u.kind}:${u.action} (${u.where})`);
  assert.deepEqual([...new Set(missing)], []);
});

test('every role named in a policy exists in the Keycloak realm', () => {
  const roles = realmRoles();
  const unknown = new Set<string>();
  for (const [kind, actions] of policies) for (const [, rs] of actions) for (const r of rs) if (r !== '*' && !roles.has(r)) unknown.add(`${r} (${kind})`);
  assert.deepEqual([...unknown], []);
});
