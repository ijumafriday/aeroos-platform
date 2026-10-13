import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzleSchema, sqlSchema } from './lib';

const sql = sqlSchema();
const orm = drizzleSchema();

test('the checker sees the schema (sanity)', () => {
  assert.ok(sql.size > 30, `only ${sql.size} tables from migrations`);
  assert.ok(orm.length > 25, `only ${orm.length} Drizzle tables`);
});

test('every table and column the code maps exists in the migrations (no drift between ORM and SQL)', () => {
  const problems: string[] = [];
  for (const t of orm) {
    const cols = sql.get(t.table);
    if (!cols) { problems.push(`table ${t.table} not created by any migration (${t.where})`); continue; }
    for (const c of t.columns) if (!cols.has(c.column.toLowerCase())) problems.push(`${t.table}.${c.column} missing (${t.where})`);
  }
  assert.deepEqual(problems, []);
});

test('the migration reader follows renames and drops (self-test on a temporary migration set)', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'schema-'));
  mkdirSync(join(root, 'apps/api/db/migrations'), { recursive: true });
  writeFileSync(join(root, 'apps/api/db/migrations/0001.sql'), `CREATE TABLE s.a (id text PRIMARY KEY, x int, y int, CONSTRAINT c CHECK (x > 0));
    /* block */ ALTER TABLE s.a DROP COLUMN x, DROP COLUMN y, ADD COLUMN z int;
    ALTER TABLE s.a RENAME COLUMN z TO w;
    CREATE TABLE s.b (id text);
    ALTER TABLE s.b RENAME TO c;
    DROP TABLE IF EXISTS s.c;
    DO $$ BEGIN CREATE TABLE fake (q int); END $$;`);
  const { sqlSchema } = await import('./lib');
  const t = sqlSchema(root);
  assert.deepEqual([...t.get('s.a')!].sort(), ['id', 'w']);
  assert.equal(t.has('s.b'), false);
  assert.equal(t.has('s.c'), false);
  assert.equal(t.has('fake'), false);
});
