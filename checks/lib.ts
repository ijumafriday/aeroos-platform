/**
 * Static integration checks: read the source with the TypeScript compiler API (no build, no running stack)
 * and cross-check the places where separately written parts must agree.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export const ROOT = join(__dirname, '..');

export function files(dir: string, ext = /\.(ts|tsx)$/): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n === 'dist') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (ext.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

export function parse(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

export function visit(node: ts.Node, fn: (n: ts.Node) => void) {
  fn(node);
  node.forEachChild(c => visit(c, fn));
}

export const where = (sf: ts.SourceFile, n: ts.Node) => `${relative(ROOT, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;

/** String literal → text; template → text with every ${…} replaced by `*`; anything else → null. */
export function literal(n: ts.Expression | undefined): string | null {
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map(s => '*' + s.literal.text).join('');
  return null;
}

/* ------------------------------------------------------------------ API routes */

export interface Route { method: string; path: string; where: string }

const VERBS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options'];

function decorators(n: ts.Node): ts.Decorator[] {
  return (ts.canHaveDecorators(n) ? ts.getDecorators(n) : undefined)?.slice() ?? [];
}

/** Decorator name and its path argument(s): '' for none; `unresolved` when the argument is not a literal we can read. */
function decoratorCall(d: ts.Decorator): { name: string; args: string[]; unresolved: boolean } | null {
  if (!ts.isCallExpression(d.expression) || !ts.isIdentifier(d.expression.expression)) return null;
  const a = d.expression.arguments[0];
  const name = d.expression.expression.text;
  if (!a) return { name, args: [''], unresolved: false };
  const lit = literal(a);
  if (lit !== null) return { name, args: [lit], unresolved: false };
  if (ts.isArrayLiteralExpression(a)) {
    const xs = a.elements.map(e => literal(e));
    return { name, args: xs.filter((x): x is string => x !== null), unresolved: xs.some(x => x === null) };
  }
  if (ts.isObjectLiteralExpression(a)) {
    const path = a.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText() === 'path') as ts.PropertyAssignment | undefined;
    const version = a.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText() === 'version');
    const lit2 = path ? literal(path.initializer) : '';
    return { name, args: [lit2 ?? ''], unresolved: lit2 === null || version };
  }
  return { name, args: [], unresolved: true };
}

export const unresolvedRoutes: string[] = [];

const join2 = (...parts: (string | null)[]) => '/' + parts.filter(Boolean).map(p => p!.replace(/^\/|\/$/g, '')).filter(Boolean).join('/');

export function apiRoutes(prefix = 'api'): Route[] {
  const routes: Route[] = [];
  for (const f of files('apps/api/src')) {
    const sf = parse(f);
    visit(sf, n => {
      if (!ts.isClassDeclaration(n)) return;
      const ctrl = decorators(n).map(decoratorCall).find(d => d?.name === 'Controller');
      if (!ctrl) return;
      if (ctrl.unresolved) unresolvedRoutes.push(`controller ${where(sf, n)}`);
      for (const m of n.members) {
        for (const d of decorators(m).map(decoratorCall)) {
          if (!d || !VERBS.includes(d.name)) continue;
          if (d.unresolved) unresolvedRoutes.push(`${d.name} ${where(sf, m)}`);
          for (const c of ctrl.args) for (const a of d.args) routes.push({ method: d.name === 'All' ? '*' : d.name.toUpperCase(), path: join2(prefix, c, a), where: where(sf, m) });
        }
      }
    });
  }
  return routes;
}

/** Does a called path (with `*` wildcards, query string allowed) hit this route (with `:params`)? */
export function matches(route: Route, method: string, path: string): boolean {
  if (route.method !== method && route.method !== '*') return false;
  const want = route.path.split('/').filter(Boolean);
  const got = path.split('?')[0].split('/').filter(Boolean);
  if (want.length !== got.length) {
    // A wildcard can stand for several segments only at the end (e.g. `${a}/${b}` written as one expression).
    return false;
  }
  return want.every((w, i) => w.startsWith(':') || got[i] === w || got[i].includes('*') && new RegExp('^' + got[i].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$').test(w) || got[i] === '*');
}

/* ------------------------------------------------------------------ callers */

export interface Call { method: string; path: string; where: string }

/** Web: api(path[, {method}]), post(path, body), download(path), fetch('/api/…'). */
export const skippedWebCalls: string[] = [];

export function webCalls(): Call[] {
  const calls: Call[] = [];
  for (const f of files('apps/web/src')) {
    const sf = parse(f);
    const helpers = f.endsWith('lib/api.ts'); // where api/post/download themselves are defined
    visit(sf, n => {
      if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression)) return;
      const name = n.expression.text;
      if (!['api', 'post', 'download'].includes(name) && name !== 'fetch') return;
      const p = literal(n.arguments[0]);
      if (p === null && name !== 'fetch' && !helpers) { skippedWebCalls.push(`${name}(${n.arguments[0]?.getText(sf) ?? ''}) ${where(sf, n)}`); return; }
      if (!p || !p.startsWith('/')) return;
      if (name === 'api') {
        const opts = n.arguments[1];
        let method = 'GET';
        if (opts && ts.isObjectLiteralExpression(opts)) {
          for (const prop of opts.properties) {
            if (ts.isPropertyAssignment(prop) && prop.name.getText(sf) === 'method') {
              const m = literal(prop.initializer as ts.Expression);
              if (m === null) skippedWebCalls.push(`non-literal method ${where(sf, n)}`);
              method = m ?? 'GET';
            }
          }
        }
        calls.push({ method, path: '/api' + p, where: where(sf, n) });
      } else if (name === 'post') calls.push({ method: 'POST', path: '/api' + p, where: where(sf, n) });
      else if (name === 'download') calls.push({ method: 'GET', path: '/api' + p, where: where(sf, n) });
      else if (name === 'fetch' && p.startsWith('/api/')) calls.push({ method: 'GET', path: p, where: where(sf, n) });
    });
  }
  return calls;
}

/** TS worker: internalPost('org/sweep', …) → POST /api/internal/org/sweep. */
export function workerCalls(): Call[] {
  const calls: Call[] = [];
  for (const f of files('apps/worker/src')) {
    const sf = parse(f);
    visit(sf, n => {
      if (!ts.isCallExpression(n)) return;
      if (ts.isIdentifier(n.expression) && n.expression.text === 'internalPost') {
        const p = literal(n.arguments[0]);
        if (p) calls.push({ method: 'POST', path: '/api/internal/' + p, where: where(sf, n) });
      }
      if (ts.isIdentifier(n.expression) && n.expression.text === 'fetch') {
        const p = literal(n.arguments[0]);
        const m = p && /\/api\/internal\/.+/.exec(p);
        if (m && m[0] !== '/api/internal/*') calls.push({ method: 'POST', path: m[0], where: where(sf, n) }); // skip the generic helper itself
      }
    });
  }
  return calls;
}

/** Python optimiser: f"{API_URL}/api/internal/ops/{kind}/{run_id}/result" with kind from the call sites. */
export function pythonCalls(): Call[] {
  const src = readFileSync(join(ROOT, 'services/optimiser/aeroos_optimiser/worker.py'), 'utf8');
  const tpl = /f"\{API_URL\}(\/api\/internal\/[^"]+)"/.exec(src)?.[1];
  if (!tpl) return [];
  const kinds = new Set<string>(['recovery']); // default argument of _post
  for (const m of src.matchAll(/_post,\s*run_id,\s*payload,\s*"([^"]+)"/g)) kinds.add(m[1]);
  return [...kinds].map(k => ({ method: 'POST', path: tpl.replace('{kind}', k).replace(/\{[^}]+\}/g, '*'), where: 'services/optimiser/aeroos_optimiser/worker.py' }));
}

/* ------------------------------------------------------------------ authorisation */

export interface AuthzUse { kind: string | null; action: string; where: string }

/** The `kind` a resource-building function returns: a literal, or the literal passed for a `kind` parameter. */
function kindFromBuilder(fn: ts.FunctionLikeDeclaration, call: ts.CallExpression): string | null {
  let obj: ts.ObjectLiteralExpression | undefined;
  const body = fn.body;
  const unwrap = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) ? unwrap(e.expression) : e);
  if (body && !ts.isBlock(body)) {
    const e = unwrap(body);
    if (ts.isObjectLiteralExpression(e)) obj = e;
  } else if (body) {
    visit(body, n => {
      if (!obj && ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(unwrap(n.expression))) obj = unwrap(n.expression) as ts.ObjectLiteralExpression;
    });
  }
  const kindProp = obj?.properties.find(p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === 'kind');
  if (!kindProp) return null;
  const v = ts.isShorthandPropertyAssignment(kindProp) ? kindProp.name : unwrap(kindProp.initializer);
  const lit = literal(v);
  if (lit) return lit;
  if (ts.isIdentifier(v)) {
    const idx = fn.parameters.findIndex(p => p.name.getText() === v.text);
    return idx >= 0 ? literal(call.arguments[idx]) : null;
  }
  return null;
}

export function authzUses(): AuthzUse[] {
  const out: AuthzUse[] = [];
  for (const f of files('apps/api/src')) {
    const sf = parse(f);
    // Resource builders declared in this file: methods/functions/arrow consts by name.
    const builders = new Map<string, ts.FunctionLikeDeclaration>();
    visit(sf, n => {
      if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name) builders.set(n.name.getText(), n);
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isArrowFunction(n.initializer)) builders.set(n.name.getText(), n.initializer);
    });
    visit(sf, n => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
      const m = n.expression.name.text;
      if ((m !== 'check' && m !== 'decide') || !/authz$/.test(n.expression.expression.getText(sf))) return;
      const [, res, act] = n.arguments;
      let kind: string | null = null;
      if (res && ts.isObjectLiteralExpression(res)) {
        const k = res.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'kind') as ts.PropertyAssignment | undefined;
        kind = k ? literal(k.initializer) : null;
      } else if (res && ts.isCallExpression(res)) {
        const callee = ts.isPropertyAccessExpression(res.expression) ? res.expression.name.text : res.expression.getText(sf);
        const fn = builders.get(callee);
        if (fn) kind = kindFromBuilder(fn, res);
      }
      const actions = act && ts.isArrayLiteralExpression(act) ? act.elements.map(e => literal(e)) : [literal(act)];
      for (const a of actions) if (a) out.push({ kind, action: a, where: where(sf, n) });
    });
  }
  return out;
}

/** Cerbos resource policies → kind → { action → roles }. Tiny YAML reader for the policy shape we use. */
export function cerbosPolicies(): Map<string, Map<string, Set<string>>> {
  const out = new Map<string, Map<string, Set<string>>>();
  for (const f of files('infra/cerbos/policies', /\.ya?ml$/)) {
    if (f.includes('/tests/')) continue;
    const text = readFileSync(f, 'utf8');
    const kind = /^\s*resource:\s*"?([\w-]+)"?/m.exec(text)?.[1];
    if (!kind) continue;
    const actions = out.get(kind) ?? new Map<string, Set<string>>();
    const rules = text.split(/\n\s*-\s+actions:/).slice(1);
    for (const r of rules) {
      const acts = /^\s*\[([^\]]*)\]/.exec(r)?.[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean) ?? [];
      const roles = /roles:\s*\[([^\]]*)\]/.exec(r)?.[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean) ?? [];
      for (const a of acts) actions.set(a, new Set([...(actions.get(a) ?? []), ...roles]));
    }
    out.set(kind, actions);
  }
  return out;
}

/** Realm roles defined in the Keycloak import. */
export function realmRoles(): Set<string> {
  const realm = JSON.parse(readFileSync(join(ROOT, 'infra/keycloak/aeroos-realm.json'), 'utf8'));
  return new Set<string>((realm.roles?.realm ?? []).map((r: { name: string }) => r.name));
}

/* ------------------------------------------------------------------ events */

/** Event types declared in the contracts (keys of EventMap). */
export function eventTypes(): string[] {
  const sf = parse(join(ROOT, 'packages/contracts/src/index.ts'));
  const out: string[] = [];
  visit(sf, n => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'EventMap') {
      for (const m of n.members) if (m.name) out.push(literal(m.name as unknown as ts.Expression) ?? m.name.getText(sf).replace(/['"]/g, ''));
    }
  });
  return out;
}

/** Where each event type is produced (a `type: '<event>'` property) and consumed (compared: ===, !==, case). */
export function eventUse(types: string[]) {
  const set = new Set(types);
  const produced = new Map<string, string[]>();
  const consumed = new Map<string, string[]>(); // type → module dirs
  const subscribed = new Map<string, Set<string>>(); // module dir → topic prefixes
  const moduleOf = (f: string) => /apps\/api\/src\/modules\/(\w+)/.exec(f)?.[1] ?? /apps\/(\w+)\//.exec(f)?.[1] ?? relative(ROOT, f);
  const sources = [...files('apps/api/src'), ...files('packages').filter(f => !f.includes('/contracts/')), ...files('apps/worker/src')];
  for (const f of sources) {
    const sf = parse(f);
    const mod = moduleOf(f);
    visit(sf, n => {
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'type') {
        const v = literal(n.initializer);
        if (v && set.has(v)) produced.set(v, [...(produced.get(v) ?? []), where(sf, n)]);
      }
      if ((ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind)) || ts.isCaseClause(n)) {
        const exprs = ts.isCaseClause(n) ? [n.expression] : [n.left, n.right];
        for (const e of exprs) {
          const v = literal(e);
          if (v && set.has(v)) consumed.set(v, [...new Set([...(consumed.get(v) ?? []), mod])]);
        }
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'start' && /kafka$/.test(n.expression.expression.getText(sf))) {
        const topics = n.arguments[1];
        const s = subscribed.get(mod) ?? new Set<string>();
        const TOPIC_VALUES: Record<string, string> = { 'aeroos.camo.v1': 'camo', 'aeroos.amo.v1': 'amo', 'aeroos.org.v1': 'org', 'aeroos.ops.v1': 'ops', 'aeroos.platform.v1': 'platform' };
        if (topics && ts.isArrayLiteralExpression(topics)) {
          for (const t of topics.elements) {
            if (ts.isPropertyAccessExpression(t) && t.expression.getText(sf) === 'TOPICS') s.add(t.name.text);
            else {
              const lit = literal(t);
              s.add(lit ? TOPIC_VALUES[lit] ?? `unknown:${lit}` : `unresolved:${t.getText(sf)}`);
            }
          }
        } else if (topics) {
          s.add(/Object\.values\(TOPICS\)/.test(topics.getText(sf)) ? '*' : `unresolved:${topics.getText(sf)}`);
        }
        subscribed.set(mod, s);
      }
    });
  }
  return { produced, consumed, subscribed };
}

/* ------------------------------------------------------------------ database schema */

/** Columns per table as created by the SQL migrations (CREATE TABLE … / ALTER TABLE … ADD COLUMN …). */
export function sqlSchema(root = ROOT): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const dir = join(root, 'apps/api/db/migrations');
  const splitTop = (body: string) => {
    const parts: string[] = [];
    let d = 0, cur = '';
    for (const ch of body) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    return parts.map(x => x.trim()).filter(Boolean);
  };
  const id = (w: string) => w.replace(/"/g, '').toLowerCase();
  const CONSTRAINT = /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)$/i;
  for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/\$\$[\s\S]*?\$\$/g, "''");
    for (const stmt of sql.split(';').map(x => x.trim()).filter(Boolean)) {
      let m: RegExpExecArray | null;
      if ((m = /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([\w."]+)\s*\(([\s\S]*)\)[^)]*$/i.exec(stmt))) {
        const cols = new Set<string>();
        for (const p of splitTop(m[2])) { const w = p.split(/\s+/)[0]; if (w && !CONSTRAINT.test(w)) cols.add(id(w)); }
        tables.set(id(m[1]), cols);
      } else if ((m = /^ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?([\w."]+)\s+([\s\S]+)$/i.exec(stmt))) {
        let t = id(m[1]);
        for (const clause of splitTop(m[2])) {
          let c: RegExpExecArray | null;
          if ((c = /^RENAME\s+TO\s+([\w"]+)/i.exec(clause))) {
            const schema = t.includes('.') ? t.split('.')[0] + '.' : '';
            const nt = schema + id(c[1]);
            tables.set(nt, tables.get(t) ?? new Set());
            tables.delete(t);
            t = nt;
          } else if ((c = /^RENAME\s+(?:COLUMN\s+)?([\w"]+)\s+TO\s+([\w"]+)/i.exec(clause))) {
            const cols = tables.get(t); if (cols) { cols.delete(id(c[1])); cols.add(id(c[2])); }
          } else if ((c = /^DROP\s+(?:COLUMN\s+)?(?:IF EXISTS\s+)?([\w"]+)/i.exec(clause)) && !/^DROP\s+(CONSTRAINT|DEFAULT|NOT)\b/i.test(clause)) {
            tables.get(t)?.delete(id(c[1]));
          } else if ((c = /^ADD\s+(?:COLUMN\s+)?(?:IF NOT EXISTS\s+)?([\w"]+)/i.exec(clause)) && !CONSTRAINT.test(c[1])) {
            const cols = tables.get(t) ?? new Set<string>(); cols.add(id(c[1])); tables.set(t, cols);
          }
        }
      } else if ((m = /^DROP TABLE\s+(?:IF EXISTS\s+)?([\w.",\s]+?)(?:\s+(?:CASCADE|RESTRICT))?$/i.exec(stmt))) {
        for (const t of m[1].split(',')) tables.delete(id(t.trim()));
      }
    }
  }
  return tables;
}

/** Drizzle table definitions: schema.table → columns (first string argument of each column builder). */
export function drizzleSchema(): { table: string; columns: { prop: string; column: string }[]; where: string }[] {
  const out: { table: string; columns: { prop: string; column: string }[]; where: string }[] = [];
  for (const f of files('apps/api/src')) {
    const sf = parse(f);
    const schemas = new Map<string, string>(); // variable → schema name
    visit(sf, n => {
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isCallExpression(n.initializer) && n.initializer.expression.getText(sf) === 'pgSchema') {
        const s = literal(n.initializer.arguments[0]);
        if (s) schemas.set(n.name.getText(sf), s);
      }
    });
    if (!schemas.size) continue;
    visit(sf, n => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== 'table') return;
      const schema = schemas.get(n.expression.expression.getText(sf));
      const name = literal(n.arguments[0]);
      const cols = n.arguments[1];
      if (!schema || !name || !cols || !ts.isObjectLiteralExpression(cols)) return;
      const columns: { prop: string; column: string }[] = [];
      for (const p of cols.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        // innermost call of a chain like text('x').notNull().default(…)
        let e: ts.Expression = p.initializer;
        while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isCallExpression(e.expression.expression)) e = e.expression.expression;
        if (ts.isCallExpression(e)) {
          const c = literal(e.arguments[0]);
          if (c) columns.push({ prop: p.name.getText(sf), column: c });
        }
      }
      out.push({ table: `${schema}.${name}`, columns, where: where(sf, n) });
    });
  }
  return out;
}
