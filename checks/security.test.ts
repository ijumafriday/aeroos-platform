import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { files, parse, visit, where } from './lib';

/**
 * Security posture checks for the penetration test scope (docs/certification/pentest-scope.md):
 *  - every route needs a signed-in user (global OIDC guard) unless marked @Public(), and a public route must have its
 *    own guard (service token, API key) — only explicit Kubernetes/compatibility health probes are open;
 *  - every request body goes through a validation pipe (no unvalidated JSON reaches a service).
 */
const OPEN = new Set([
  'apps/api/src/platform/platform.controllers.ts:HealthController.live',
  'apps/api/src/platform/platform.controllers.ts:HealthController.ready',
  'apps/api/src/platform/platform.controllers.ts:HealthController.health'
]);

const decos = (n: ts.Node) => ((ts.canHaveDecorators(n) ? ts.getDecorators(n) : undefined) ?? []).map(d => (ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression) ? d.expression : null)).filter((x): x is ts.CallExpression => !!x);
const named = (n: ts.Node, name: string) => decos(n).filter(d => (d.expression as ts.Identifier).text === name);
const VERBS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'All'];

interface Handler { id: string; at: string; isPublic: boolean; guarded: boolean; bodies: { validated: boolean; at: string }[] }
const handlers: Handler[] = [];
for (const f of files('apps/api/src')) {
  const sf = parse(f);
  visit(sf, n => {
    if (!ts.isClassDeclaration(n) || !named(n, 'Controller').length) return;
    const clsPublic = named(n, 'Public').length > 0, clsGuard = named(n, 'UseGuards').length > 0;
    for (const m of n.members) {
      if (!ts.isMethodDeclaration(m) || !decos(m).some(d => VERBS.includes((d.expression as ts.Identifier).text))) continue;
      // validated = a pipe instance is passed (@Body(new XPipe(…)) or @Body('prop', new XPipe(…))); a bare property name is not validation
      const bodies = m.parameters.filter(p => named(p, 'Body').length).map(p => ({ validated: named(p, 'Body')[0].arguments.some(a => ts.isNewExpression(a)), at: where(sf, p) }));
      handlers.push({
        id: `${where(sf, n).split(':')[0]}:${n.name?.text}.${m.name.getText(sf)}`, at: where(sf, m),
        isPublic: clsPublic || named(m, 'Public').length > 0, guarded: clsGuard || named(m, 'UseGuards').length > 0, bodies
      });
    }
  });
}

test('every route is authenticated: public ones carry their own guard (only the health probe is open)', () => {
  assert.ok(handlers.length > 100, `only ${handlers.length} handlers found (sanity)`);
  const open = handlers.filter(h => h.isPublic && !h.guarded && !OPEN.has(h.id)).map(h => `${h.id} (${h.at})`);
  assert.deepEqual(open, []);
});

test('every request body is validated by a pipe', () => {
  const raw = handlers.flatMap(h => h.bodies.filter(b => !b.validated).map(b => `${h.id} (${b.at})`));
  assert.deepEqual(raw, []);
});
