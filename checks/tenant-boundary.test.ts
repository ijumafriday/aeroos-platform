import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib';

const migration = readFileSync(join(ROOT, 'apps/api/db/migrations/0030_platform_tenant_rls.sql'), 'utf8');
const moduleDb = readFileSync(join(ROOT, 'apps/api/src/platform/database/module-db.ts'), 'utf8');
const guards = readFileSync(join(ROOT, 'apps/api/src/platform/auth/guards.ts'), 'utf8');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

test('tenant-bearing tables are protected by a database RLS migration', () => {
  assert.match(migration, /information_schema\.columns/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /aeroos\.operator_id/);
  assert.match(migration, /WITH CHECK/);
});

test('database queries apply request tenant context before execution', () => {
  assert.match(moduleDb, /set_config\('aeroos\.operator_id'/);
  assert.match(moduleDb, /set_config\('aeroos\.system'/);
  assert.match(moduleDb, /currentTenantContext/);
});

test('internal API trust uses OIDC service tokens, not a shared internal token', () => {
  assert.match(guards, /verifyService/);
  assert.match(guards, /service_worker/);
  const roots = ['apps', 'services', 'deploy'];
  const offending = roots.flatMap(r => walk(join(ROOT, r))).filter(f => /\.(ts|tsx|py|ya?ml)$/.test(f))
    .filter(f => /INTERNAL_TOKEN|x-internal-token/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offending, []);
});
