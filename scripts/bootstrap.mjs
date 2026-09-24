#!/usr/bin/env node
// Bootstrap: creates the REAL company and its first owner user (no demo data).
// Usage:
//   node scripts/bootstrap.mjs --name "SARL Example" --email owner@example.dz \
//        [--password 'S3cret!'] [--locale fr] [--full-name 'Direction'] \
//        [--legal-name ...] [--nif ...] [--nis ...] [--rc ...] [--address ...] [--phone ...]
// If --password is omitted, a strong one is generated and printed once.
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const scrypt = promisify(_scrypt);

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

function arg(name) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
}

const connStr = process.env.DATABASE_URL ?? 'postgres://companyos:companyos@localhost:5432/companyos';
const client = new pg.Client({ connectionString: connStr });
await client.connect();

const name = arg('name');
const email = (arg('email') ?? '').toLowerCase().trim();
if (!name || !email) {
  console.error('Usage: node scripts/bootstrap.mjs --name "Company" --email owner@example.dz [--password X] [--locale fr] [options]');
  await client.end();
  process.exit(1);
}
const password = arg('password') ?? randomBytes(18).toString('base64url');

await client.query('BEGIN');
try {
  const existing = await client.query(`SELECT id FROM company WHERE name = $1`, [name]);
  let companyId = existing.rows[0]?.id ?? null;
  if (!companyId) {
    companyId = (
      await client.query(
        `INSERT INTO company (name, legal_name, nif, nis, rc, address, phone, email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [name, arg('legal-name') ?? name, arg('nif'), arg('nis'), arg('rc'),
         arg('address'), arg('phone'), null],
      )
    ).rows[0].id;
  }

  const ownerRole = (
    await client.query(
      `INSERT INTO role (company_id, key, name) VALUES ($1,'owner','Owner') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;

  const owner = (
    await client.query(
      `INSERT INTO "user" (company_id, email, password_hash, full_name, locale)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [companyId, email, await hashPassword(password), arg('full-name') ?? 'Owner', arg('locale') ?? 'fr'],
    )
  ).rows[0].id;
  await client.query(`INSERT INTO user_role (user_id, role_id) VALUES ($1,$2)`, [owner, ownerRole]);

  await client.query('COMMIT');
  console.log(`Company "${name}" ready.`);
  console.log(`Owner login: ${email}`);
  console.log(`Password: ${password}`);
  console.log('(Store it now — it is not saved in clear anywhere.)');
} catch (err) {
  await client.query('ROLLBACK');
  console.error('FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
