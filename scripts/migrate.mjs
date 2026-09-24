#!/usr/bin/env node
// Migration runner — applies database/migrations/*.sql in lexicographic order.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'database', 'migrations');

const connStr =
  process.env.DATABASE_URL ?? 'postgres://companyos:companyos@localhost:5432/companyos';

const client = new pg.Client({ connectionString: connStr });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const applied = new Set(
  (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
);

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  process.stdout.write(`Applying ${file}... `);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log('ok');
    ran++;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  }
}

console.log(ran === 0 ? 'Database up to date.' : `Applied ${ran} migration(s).`);
await client.end();
