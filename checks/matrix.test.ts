import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPLIANCE_MATRIX } from '../packages/compliance/src/matrix';
import { cerbosPolicies, files, ROOT } from './lib';

/**
 * The compliance traceability matrix (packages/compliance/src/matrix.ts) must point at things that exist: an
 * inspector following a reference to a test, rule, policy, screen or audit action must find it.
 */
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const auditActions = (() => {
  const out = new Set<string>();
  for (const f of files('apps/api/src')) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!/action:/.test(line) || /^\s*(\/\/|\*)/.test(line)) continue;
      for (const m of line.matchAll(/'([a-z_]+\.[a-z_.]+)'/g)) out.add(m[1]);
    }
  }
  return out;
})();
const webRoutes = new Set([...read('apps/web/src/app/router.tsx').matchAll(/path: '([^']+)'/g)].map(m => m[1]));
const rulepackMethods = new Set([...read('packages/compliance/src/types.ts').matchAll(/^\s{2}([a-zA-Z]+)\(f: /gm)].map(m => m[1]));
const policies = cerbosPolicies();

test('matrix ids are unique and every row says who carries it', () => {
  const ids = COMPLIANCE_MATRIX.map(r => r.id);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), []);
  assert.ok(COMPLIANCE_MATRIX.length >= 25);
  for (const r of COMPLIANCE_MATRIX) {
    if (r.status === 'IMPLEMENTED') assert.ok((r.evidence.tests?.length ?? 0) > 0, `${r.id}: an implemented requirement needs a test`);
    if (r.status === 'DATA' || r.status === 'PROCEDURAL') assert.ok(r.organisation, `${r.id}: say what the organisation must provide`);
  }
});

test('every referenced test exists by file and name', () => {
  const missing: string[] = [];
  for (const r of COMPLIANCE_MATRIX) {
    for (const t of r.evidence.tests ?? []) {
      if (!existsSync(join(ROOT, t.file))) { missing.push(`${r.id}: ${t.file} (no such file)`); continue; }
      const live = read(t.file).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
      if (!live.includes(`test('${t.name}`)) missing.push(`${r.id}: ${t.file} has no test starting "${t.name}"`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every referenced audit action is recorded somewhere in the API', () => {
  assert.ok(auditActions.size > 50, `only ${auditActions.size} actions found (sanity)`);
  const missing = COMPLIANCE_MATRIX.flatMap(r => (r.evidence.auditActions ?? []).filter(a => !auditActions.has(a)).map(a => `${r.id}: ${a}`));
  assert.deepEqual(missing, []);
});

test('every referenced policy, screen and rulepack decision exists', () => {
  const missing: string[] = [];
  for (const r of COMPLIANCE_MATRIX) {
    for (const p of r.evidence.policies ?? []) if (!policies.has(p)) missing.push(`${r.id}: policy ${p}`);
    for (const p of r.evidence.routes ?? []) if (!webRoutes.has(p)) missing.push(`${r.id}: screen ${p}`);
    for (const p of r.evidence.rules ?? []) if (!rulepackMethods.has(p)) missing.push(`${r.id}: rule ${p}`);
  }
  assert.deepEqual(missing, []);
});
