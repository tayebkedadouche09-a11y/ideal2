/**
 * Real PostgreSQL multi-tenant E2E tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { createApp } from './app.js';

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://companyos:companyos@localhost:5432/companyos';

async function ensureCompanies() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const password = 'E2ePass123!';
  const emailA = `e2e-a-${Date.now()}@test.dz`;
  const emailB = `e2e-b-${Date.now()}@test.dz`;
  try {
    await client.query('BEGIN');
    const a = await client.query<{ id: string }>(
      `INSERT INTO company (name) VALUES ($1) RETURNING id`,
      [`E2E Co A ${Date.now()}`],
    );
    const b = await client.query<{ id: string }>(
      `INSERT INTO company (name) VALUES ($1) RETURNING id`,
      [`E2E Co B ${Date.now()}`],
    );
    const companyA = a.rows[0]!.id;
    const companyB = b.rows[0]!.id;
    const roleA = (
      await client.query<{ id: string }>(
        `INSERT INTO role (company_id, key, name) VALUES ($1,'owner','Owner') RETURNING id`,
        [companyA],
      )
    ).rows[0]!.id;
    const roleB = (
      await client.query<{ id: string }>(
        `INSERT INTO role (company_id, key, name) VALUES ($1,'owner','Owner') RETURNING id`,
        [companyB],
      )
    ).rows[0]!.id;
    const hash = await hashPassword(password);
    const userA = (
      await client.query<{ id: string }>(
        `INSERT INTO "user" (company_id, email, password_hash, full_name, locale)
         VALUES ($1,$2,$3,'Owner A','fr') RETURNING id`,
        [companyA, emailA, hash],
      )
    ).rows[0]!.id;
    const userB = (
      await client.query<{ id: string }>(
        `INSERT INTO "user" (company_id, email, password_hash, full_name, locale)
         VALUES ($1,$2,$3,'Owner B','fr') RETURNING id`,
        [companyB, emailB, hash],
      )
    ).rows[0]!.id;
    await client.query(`INSERT INTO user_role (user_id, role_id) VALUES ($1,$2)`, [userA, roleA]);
    await client.query(`INSERT INTO user_role (user_id, role_id) VALUES ($1,$2)`, [userB, roleB]);
    await client.query('COMMIT');
    return { companyA, companyB, emailA, emailB, password };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

async function login(app: Awaited<ReturnType<typeof createApp>>, email: string, password: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  assert.equal(res.statusCode, 200, `login failed for ${email}: ${res.body}`);
  const body = res.json() as { accessToken: string; refreshToken: string };
  assert.ok(body.accessToken);
  return body;
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

test('E2E multi-tenant: auth, client CRUD, project, IDOR isolation, sync', async (t) => {
  const { emailA, emailB, password } = await ensureCompanies();
  const app = await createApp();
  t.after(async () => {
    await app.close();
  });

  const bad = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: emailA, password: 'wrong' },
  });
  assert.equal(bad.statusCode, 401);

  const loginA = await login(app, emailA, password);
  const loginB = await login(app, emailB, password);
  const hA = authHeader(loginA.accessToken);
  const hB = authHeader(loginB.accessToken);

  const meA = await app.inject({ method: 'GET', url: '/auth/me', headers: hA });
  assert.equal(meA.statusCode, 200);
  assert.equal(meA.json().user.email, emailA);

  const createClient = await app.inject({
    method: 'POST',
    url: '/clients',
    headers: hA,
    payload: { name: 'Client Alpha', city: 'Algiers' },
  });
  assert.equal(createClient.statusCode, 201, createClient.body);
  const clientId = createClient.json().id as string;

  const listB = await app.inject({ method: 'GET', url: '/clients', headers: hB });
  assert.equal(listB.statusCode, 200);
  assert.ok(!listB.json().clients.some((c: { id: string }) => c.id === clientId));

  const getCross = await app.inject({
    method: 'GET',
    url: `/clients/${clientId}`,
    headers: hB,
  });
  assert.ok([403, 404].includes(getCross.statusCode));

  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const projIns = await db.query<{ id: string }>(
    `INSERT INTO project (company_id, client_id, code, name, status)
     SELECT u.company_id, $1, $2, $3, 'planned'
       FROM "user" u WHERE u.email = $4
     RETURNING id`,
    [clientId, `P-E2E-${Date.now()}`, 'Chantier Alpha', emailA],
  );
  await db.end();
  const projectId = projIns.rows[0]!.id;

  const getProjectB = await app.inject({
    method: 'GET',
    url: `/projects/${projectId}`,
    headers: hB,
  });
  assert.ok([403, 404].includes(getProjectB.statusCode));

  const taskRes = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/tasks`,
    headers: hA,
    payload: { title: 'Prep surface' },
  });
  assert.equal(taskRes.statusCode, 201, taskRes.body);

  const incidentRes = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/incidents`,
    headers: hA,
    payload: { title: 'Spill', description: 'Minor resin spill', severity: 'low' },
  });
  assert.equal(incidentRes.statusCode, 201, incidentRes.body);

  const reportRes = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/daily-reports`,
    headers: hA,
    payload: {
      report_date: new Date().toISOString().slice(0, 10),
      work_performed: 'Day 1 progress',
      manpower_count: 4,
    },
  });
  assert.equal(reportRes.statusCode, 201, reportRes.body);

  const crossTask = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/tasks`,
    headers: hB,
    payload: { title: 'Hacker task' },
  });
  assert.ok([403, 404].includes(crossTask.statusCode));

  const deviceReg = await app.inject({
    method: 'POST',
    url: '/sync/devices',
    headers: hA,
    payload: { deviceId: 'e2e-device-01', platform: 'web', appVersion: '0.1.0' },
  });
  assert.ok([200, 201].includes(deviceReg.statusCode), deviceReg.body);

  const mutId = `mut-${Date.now()}-1`;
  const push1 = await app.inject({
    method: 'POST',
    url: '/sync/push',
    headers: hA,
    payload: {
      deviceId: 'e2e-device-01',
      mutations: [
        {
          clientMutationId: mutId,
          entityType: 'daily_report',
          operation: 'create',
          payload: {
            project_id: projectId,
            report_date: new Date().toISOString().slice(0, 10),
            work_performed: 'Offline report',
          },
        },
      ],
    },
  });
  assert.ok([200, 201].includes(push1.statusCode), push1.body);

  const push2 = await app.inject({
    method: 'POST',
    url: '/sync/push',
    headers: hA,
    payload: {
      deviceId: 'e2e-device-01',
      mutations: [
        {
          clientMutationId: mutId,
          entityType: 'daily_report',
          operation: 'create',
          payload: {
            project_id: projectId,
            report_date: new Date().toISOString().slice(0, 10),
            work_performed: 'Offline report',
          },
        },
      ],
    },
  });
  assert.ok([200, 201].includes(push2.statusCode), push2.body);

  const logout = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: hA,
    payload: { refreshToken: loginA.refreshToken },
  });
  assert.equal(logout.statusCode, 200);
});
