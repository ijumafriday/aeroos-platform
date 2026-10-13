import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import type { Config } from '../../config';

const MIGRATION_LOCK = 727_274;
const DB_DIR = resolve(__dirname, '../../../db');

/**
 * Applies db/migrations/*.sql in order, as the owner role, exactly once each.
 * Applied files are checksummed: editing a migration that already ran is refused, because the
 * schema history is part of the audit evidence. A change is always a new file.
 * An advisory lock lets several API replicas start at once safely.
 */
export async function runMigrations(config: Config, log: (m: string) => void = console.log) {
  const client = new Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: 'aeroos_owner',
    password: config.dbPassword('aeroos_owner'),
    application_name: 'aeroos-migrator'
  });
  await connectWithRetry(client, log);
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS platform.schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map<string, string>(
      (await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM platform.schema_migrations')).rows.map(r => [r.name, r.checksum])
    );

    const sets: [string, string, boolean][] = [['migrations', '', true]];
    if (config.SEED_DEMO) sets.push(['seeds', 'seed:', false]);

    for (const [dir, prefix, strict] of sets) {
      const files = readdirSync(join(DB_DIR, dir)).filter(f => f.endsWith('.sql')).sort();
      for (const file of files) {
        const name = prefix + file;
        const sql = readFileSync(join(DB_DIR, dir, file), 'utf8');
        const sum = createHash('sha256').update(sql).digest('hex');
        const prev = applied.get(name);
        if (prev) {
          if (prev !== sum && strict) throw new Error(`Migration ${file} was modified after it was applied. Add a new migration instead.`);
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO platform.schema_migrations (name, checksum) VALUES ($1, $2)', [name, sum]);
          await client.query('COMMIT');
          log(`[migrate] applied ${name}`);
        } catch (e) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${name} failed: ${(e as Error).message}`);
        }
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    await client.end();
  }
}

async function connectWithRetry(client: Client, log: (m: string) => void) {
  for (let attempt = 1; ; attempt++) {
    try {
      await client.connect();
      return;
    } catch (e) {
      if (attempt >= 30) throw e;
      log(`[migrate] database not ready (${(e as Error).message}); retrying`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
