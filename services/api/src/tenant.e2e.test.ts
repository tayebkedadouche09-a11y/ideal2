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

// ---------------------------------------------------------------------------
// Shared helpers for the extended acceptance suites below.
// ---------------------------------------------------------------------------

type App = Awaited<ReturnType<typeof createApp>>;

interface Org {
  companyId: string;
  userId: string;
  email: string;
  password: string;
}

/** Create an isolated company + owner user directly in PostgreSQL. */
async function createOrg(prefix: string): Promise<Org> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const password = 'E2ePass123!';
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `${prefix.toLowerCase()}-${stamp}@test.dz`;
    const companyId = (
      await client.query<{ id: string }>(`INSERT INTO company (name) VALUES ($1) RETURNING id`, [
        `${prefix} Co ${stamp}`,
      ])
    ).rows[0]!.id;
    const roleId = (
      await client.query<{ id: string }>(
        `INSERT INTO role (company_id, key, name) VALUES ($1,'owner','Owner') RETURNING id`,
        [companyId],
      )
    ).rows[0]!.id;
    const hash = await hashPassword(password);
    const userId = (
      await client.query<{ id: string }>(
        `INSERT INTO "user" (company_id, email, password_hash, full_name, locale)
         VALUES ($1,$2,$3,'Owner','fr') RETURNING id`,
        [companyId, email, hash],
      )
    ).rows[0]!.id;
    await client.query(`INSERT INTO user_role (user_id, role_id) VALUES ($1,$2)`, [userId, roleId]);
    return { companyId, userId, email, password };
  } finally {
    await client.end();
  }
}

/** Create a client (via API) and a project (via SQL) owned by `org`. */
async function newClientAndProject(
  app: App,
  h: Record<string, string>,
  org: Org,
  code: string,
): Promise<{ clientId: string; projectId: string }> {
  const c = await app.inject({ method: 'POST', url: '/clients', headers: h, payload: { name: `Client ${code}` } });
  assert.equal(c.statusCode, 201, c.body);
  const clientId = c.json().id as string;
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const projectId = (
    await db.query<{ id: string }>(
      `INSERT INTO project (company_id, client_id, code, name, status)
       VALUES ($1,$2,$3,$4,'planned') RETURNING id`,
      [org.companyId, clientId, `P-${code}-${Date.now()}`, `Project ${code}`],
    )
  ).rows[0]!.id;
  await db.end();
  return { clientId, projectId };
}

async function withDb<T>(fn: (q: <R>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    return await fn(async <R,>(sql: string, params: unknown[] = []): Promise<R[]> => {
      const res = await db.query(sql, params);
      return res.rows as R[];
    });
  } finally {
    await db.end();
  }
}

// ---------------------------------------------------------------------------
// Phase 1 acceptance: payments update invoice/debt and write audit history.
// (ROLE-MATRIX.md: "Un paiement met à jour facture/dette", "...crée un historique d'audit")
// ---------------------------------------------------------------------------

test('E2E finance acceptance: payment derives invoice/debt status and writes audit history', async (t) => {
  const app = await createApp();
  t.after(async () => {
    await app.close();
  });

  const org = await createOrg('Fin');
  const h = authHeader((await login(app, org.email, org.password)).accessToken);
  const { clientId } = await newClientAndProject(app, h, org, 'FIN');

  const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const inv = await app.inject({
    method: 'POST',
    url: '/invoices',
    headers: h,
    payload: { client_id: clientId, due_date: due, lines: [{ description: 'Sablage', quantity: 2, unit_price: 500 }] },
  });
  assert.equal(inv.statusCode, 201, inv.body);
  const invoiceId = inv.json().id as string;

  // draft -> approved -> issued (payments are forbidden on draft/cancelled)
  assert.equal(
    (await app.inject({ method: 'POST', url: `/invoices/${invoiceId}/transition`, headers: h, payload: { to: 'approved' } })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: `/invoices/${invoiceId}/transition`, headers: h, payload: { to: 'issued' } })).statusCode,
    200,
  );

  let detail = (await app.inject({ method: 'GET', url: `/invoices/${invoiceId}`, headers: h })).json() as {
    invoice: { total: string; status: string };
    paid: number;
    due: number;
  };
  assert.equal(Number(detail.invoice.total), 1000);
  assert.equal(detail.due, 1000);

  // Partial payment -> partially_paid, debt outstanding reflects it.
  const p1 = await app.inject({ method: 'POST', url: `/invoices/${invoiceId}/payments`, headers: h, payload: { amount: 400, method: 'bank_transfer' } });
  assert.equal(p1.statusCode, 201, p1.body);
  detail = (await app.inject({ method: 'GET', url: `/invoices/${invoiceId}`, headers: h })).json() as typeof detail;
  assert.equal(detail.paid, 400);
  assert.equal(detail.due, 600);
  assert.equal(detail.invoice.status, 'partially_paid');

  let debts = (await app.inject({ method: 'GET', url: '/debts', headers: h })).json() as {
    rows: Array<{ id: string; outstanding: number }>;
    totalOutstanding: number;
  };
  const row = debts.rows.find((r) => r.id === invoiceId);
  assert.ok(row, 'partially paid invoice appears in debts');
  assert.equal(row!.outstanding, 600);

  // Settle -> paid, removed from debts.
  const p2 = await app.inject({ method: 'POST', url: `/invoices/${invoiceId}/payments`, headers: h, payload: { amount: 600, method: 'cash' } });
  assert.equal(p2.statusCode, 201, p2.body);
  detail = (await app.inject({ method: 'GET', url: `/invoices/${invoiceId}`, headers: h })).json() as typeof detail;
  assert.equal(detail.paid, 1000);
  assert.equal(detail.due, 0);
  assert.equal(detail.invoice.status, 'paid');
  debts = (await app.inject({ method: 'GET', url: '/debts', headers: h })).json() as typeof debts;
  assert.ok(!debts.rows.some((r) => r.id === invoiceId), 'paid invoice leaves the debt list');

  // Overpayment is rejected (append-only integrity).
  const over = await app.inject({ method: 'POST', url: `/invoices/${invoiceId}/payments`, headers: h, payload: { amount: 1, method: 'cash' } });
  assert.equal(over.statusCode, 409);

  // Payment audit history exists for this company.
  const paymentAudits = await withDb((q) =>
    q<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'payment'`, [org.companyId]),
  );
  assert.ok(paymentAudits[0]!.n >= 2, `expected >=2 payment audit rows, got ${paymentAudits[0]!.n}`);

  // Cross-tenant: another company can neither pay nor read this invoice.
  const orgB = await createOrg('FinB');
  const hB = authHeader((await login(app, orgB.email, orgB.password)).accessToken);
  assert.equal((await app.inject({ method: 'POST', url: `/invoices/${invoiceId}/payments`, headers: hB, payload: { amount: 1, method: 'cash' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/invoices/${invoiceId}`, headers: hB })).statusCode, 404);
});

// ---------------------------------------------------------------------------
// Offline sync: device registration, idempotent push, conflict lifecycle
// (client_wins / server_wins), row_version bump, and cross-tenant isolation.
// ---------------------------------------------------------------------------

test('E2E offline sync: idempotency, conflict resolution, row_version, tenant isolation', async (t) => {
  const app = await createApp();
  t.after(async () => {
    await app.close();
  });

  const orgA = await createOrg('SyncA');
  const orgB = await createOrg('SyncB');
  const hA = authHeader((await login(app, orgA.email, orgA.password)).accessToken);
  const hB = authHeader((await login(app, orgB.email, orgB.password)).accessToken);
  const { projectId } = await newClientAndProject(app, hA, orgA, 'SYN');

  const reg = await app.inject({ method: 'POST', url: '/sync/devices', headers: hA, payload: { deviceId: 'dev-sync-a-01', platform: 'web', appVersion: '0.1.0' } });
  assert.ok([200, 201].includes(reg.statusCode), reg.body);

  const taskRes = await app.inject({ method: 'POST', url: `/projects/${projectId}/tasks`, headers: hA, payload: { title: 'Original' } });
  assert.equal(taskRes.statusCode, 201, taskRes.body);
  const taskId = taskRes.json().id as string;

  // Idempotent create: same clientMutationId pushed twice -> applied then duplicate.
  const mutId = `dr-${Date.now()}`;
  const createPush = {
    deviceId: 'dev-sync-a-01',
    mutations: [
      { clientMutationId: mutId, entityType: 'daily_report', operation: 'create', payload: { project_id: projectId, report_date: new Date().toISOString().slice(0, 10), work_performed: 'Day 1' } },
    ],
  };
  const push1 = await app.inject({ method: 'POST', url: '/sync/push', headers: hA, payload: createPush });
  assert.equal(push1.statusCode, 200, push1.body);
  assert.equal((push1.json() as { results: Array<{ status: string }> }).results[0]!.status, 'applied');
  const push2 = await app.inject({ method: 'POST', url: '/sync/push', headers: hA, payload: createPush });
  assert.equal((push2.json() as { results: Array<{ status: string }> }).results[0]!.status, 'duplicate');

  // Stale update (baseVersion 0 < server row_version 1) -> conflict.
  const conflictPush = await app.inject({
    method: 'POST',
    url: '/sync/push',
    headers: hA,
    payload: { deviceId: 'dev-sync-a-01', mutations: [
      { clientMutationId: `t-${Date.now()}`, entityType: 'project_task', operation: 'update', entityId: taskId, baseVersion: 0, payload: { title: 'ClientTitle', status: 'done' } },
    ] },
  });
  const cRes = (conflictPush.json() as { results: Array<{ status: string; conflictId?: string }> }).results[0]!;
  assert.equal(cRes.status, 'conflict', JSON.stringify(cRes));
  const conflictId = cRes.conflictId!;
  assert.ok(conflictId);

  // Conflict visibility is tenant-scoped.
  const confA = (await app.inject({ method: 'GET', url: '/sync/conflicts', headers: hA })).json() as { conflicts: Array<{ id: string }> };
  assert.ok(confA.conflicts.some((c) => c.id === conflictId));
  const confB = (await app.inject({ method: 'GET', url: '/sync/conflicts', headers: hB })).json() as { conflicts: Array<{ id: string }> };
  assert.ok(!confB.conflicts.some((c) => c.id === conflictId));

  // Another tenant cannot resolve it.
  assert.equal((await app.inject({ method: 'POST', url: `/sync/conflicts/${conflictId}/resolve`, headers: hB, payload: { resolution: 'client_wins' } })).statusCode, 404);

  // client_wins applies the client payload and bumps row_version.
  assert.equal((await app.inject({ method: 'POST', url: `/sync/conflicts/${conflictId}/resolve`, headers: hA, payload: { resolution: 'client_wins' } })).statusCode, 200);
  const afterClientWins = await withDb((q) =>
    q<{ title: string; status: string; row_version: string }>(`SELECT title, status, row_version FROM project_task WHERE id = $1`, [taskId]),
  );
  assert.equal(afterClientWins[0]!.title, 'ClientTitle');
  assert.equal(afterClientWins[0]!.status, 'done');
  assert.ok(Number(afterClientWins[0]!.row_version) >= 2, `row_version should bump, got ${afterClientWins[0]!.row_version}`);

  // Resolving twice is a 404 (already resolved).
  assert.equal((await app.inject({ method: 'POST', url: `/sync/conflicts/${conflictId}/resolve`, headers: hA, payload: { resolution: 'client_wins' } })).statusCode, 404);

  // server_wins leaves the record untouched (no row_version bump).
  const task2 = (await app.inject({ method: 'POST', url: `/projects/${projectId}/tasks`, headers: hA, payload: { title: 'Keep' } })).json().id as string;
  const swPush = await app.inject({
    method: 'POST',
    url: '/sync/push',
    headers: hA,
    payload: { deviceId: 'dev-sync-a-01', mutations: [
      { clientMutationId: `sw-${Date.now()}`, entityType: 'project_task', operation: 'update', entityId: task2, baseVersion: 0, payload: { title: 'Nope' } },
    ] },
  });
  const swConflict = (swPush.json() as { results: Array<{ conflictId?: string }> }).results[0]!.conflictId!;
  assert.equal((await app.inject({ method: 'POST', url: `/sync/conflicts/${swConflict}/resolve`, headers: hA, payload: { resolution: 'server_wins' } })).statusCode, 200);
  const afterServerWins = await withDb((q) => q<{ title: string; row_version: string }>(`SELECT title, row_version FROM project_task WHERE id = $1`, [task2]));
  assert.equal(afterServerWins[0]!.title, 'Keep');
  assert.equal(Number(afterServerWins[0]!.row_version), 1);

  // Cross-tenant mutation against A's task is rejected and not visible to B's pull.
  assert.ok([200, 201].includes((await app.inject({ method: 'POST', url: '/sync/devices', headers: hB, payload: { deviceId: 'dev-sync-b-01', platform: 'web' } })).statusCode));
  const bPush = await app.inject({
    method: 'POST',
    url: '/sync/push',
    headers: hB,
    payload: { deviceId: 'dev-sync-b-01', mutations: [
      { clientMutationId: `bx-${Date.now()}`, entityType: 'project_task', operation: 'update', entityId: taskId, baseVersion: 1, payload: { title: 'Hacked' } },
    ] },
  });
  assert.equal((bPush.json() as { results: Array<{ status: string }> }).results[0]!.status, 'rejected');
  const pullB = (await app.inject({ method: 'GET', url: '/sync/pull', headers: hB })).json() as { mutations: Array<{ entity_id: string | null }> };
  assert.ok(!pullB.mutations.some((m) => m.entity_id === taskId));
  const finalTask = await withDb((q) => q<{ title: string }>(`SELECT title FROM project_task WHERE id = $1`, [taskId]));
  assert.equal(finalTask[0]!.title, 'ClientTitle');
});

// ---------------------------------------------------------------------------
// Deep isolation: every project sub-resource rejects cross-tenant access and
// the audit trail never leaks another company's entity ids.
// ---------------------------------------------------------------------------

test('E2E isolation: project sub-resources reject cross-tenant access; audit does not leak', async (t) => {
  const app = await createApp();
  t.after(async () => {
    await app.close();
  });

  const orgA = await createOrg('IsoA');
  const orgB = await createOrg('IsoB');
  const hA = authHeader((await login(app, orgA.email, orgA.password)).accessToken);
  const hB = authHeader((await login(app, orgB.email, orgB.password)).accessToken);
  const { projectId } = await newClientAndProject(app, hA, orgA, 'ISO');

  const taskId = (await app.inject({ method: 'POST', url: `/projects/${projectId}/tasks`, headers: hA, payload: { title: 'A task' } })).json().id as string;
  const incidentId = (await app.inject({ method: 'POST', url: `/projects/${projectId}/incidents`, headers: hA, payload: { title: 'A incident', severity: 'low' } })).json().id as string;

  const today = new Date().toISOString().slice(0, 10);
  const attempts: Array<[string, string, unknown]> = [
    ['GET', `/projects/${projectId}`, undefined],
    ['GET', `/projects/${projectId}/timeline`, undefined],
    ['GET', `/projects/${projectId}/boq`, undefined],
    ['GET', `/projects/${projectId}/lessons`, undefined],
    ['POST', `/projects/${projectId}/tasks`, { title: 'hack' }],
    ['POST', `/projects/${projectId}/incidents`, { title: 'hack', severity: 'low' }],
    ['POST', `/projects/${projectId}/daily-reports`, { report_date: today, work_performed: 'x' }],
    ['POST', `/projects/${projectId}/measurements`, { zone: 'z', kind: 'area', area_sqm_input: 10 }],
  ];
  for (const [method, url, payload] of attempts) {
    const res = await app.inject({ method: method as 'GET' | 'POST', url, headers: hB, payload: payload as object | undefined });
    assert.ok([403, 404].includes(res.statusCode), `${method} ${url} -> ${res.statusCode} (${res.body})`);
  }

  // No audit row in company B references company A's entities.
  const leak = await withDb((q) =>
    q<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND entity_id = ANY($2::uuid[])`, [
      orgB.companyId,
      [projectId, taskId, incidentId],
    ]),
  );
  assert.equal(leak[0]!.n, 0, 'cross-tenant audit leakage detected');

  // Company A's own actions are audited under A.
  const aAudit = await withDb((q) =>
    q<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND entity_id = ANY($2::uuid[])`, [
      orgA.companyId,
      [taskId, incidentId],
    ]),
  );
  assert.ok(aAudit[0]!.n >= 2, `expected A's task+incident audited, got ${aAudit[0]!.n}`);
});

// ---------------------------------------------------------------------------
// Project creation via the public API (POST /projects). The web "Chantiers"
// screen creates projects through this route; it must validate tenant ownership
// of the client and reject duplicate company-scoped codes.
// ---------------------------------------------------------------------------

test('E2E project creation via API: POST /projects validates tenant and code uniqueness', async (t) => {
  const app = await createApp();
  t.after(async () => {
    await app.close();
  });

  const orgA = await createOrg('ProjA');
  const hA = authHeader((await login(app, orgA.email, orgA.password)).accessToken);
  const clientA = await app.inject({ method: 'POST', url: '/clients', headers: hA, payload: { name: 'Client Proj A' } });
  assert.equal(clientA.statusCode, 201, clientA.body);
  const clientAId = clientA.json().id as string;

  const code = `PRJ-${Date.now()}`;
  const created = await app.inject({
    method: 'POST',
    url: '/projects',
    headers: hA,
    payload: { name: 'Chantier A', code, client_id: clientAId, site_address: 'Alger' },
  });
  assert.equal(created.statusCode, 201, created.body);
  const projectId = created.json().id as string;
  assert.ok(projectId, 'expected a project id');

  const got = await app.inject({ method: 'GET', url: `/projects/${projectId}`, headers: hA });
  assert.equal(got.statusCode, 200, got.body);
  assert.equal(got.json().project.code, code);
  assert.equal(got.json().project.status, 'planned');

  const dup = await app.inject({
    method: 'POST',
    url: '/projects',
    headers: hA,
    payload: { name: 'Chantier A2', code, client_id: clientAId },
  });
  assert.equal(dup.statusCode, 409, `duplicate code should be 409, got ${dup.statusCode}: ${dup.body}`);

  const noClient = await app.inject({
    method: 'POST',
    url: '/projects',
    headers: hA,
    payload: { name: 'X', code: `X-${Date.now()}` },
  });
  assert.equal(noClient.statusCode, 400, noClient.body);

  // Cross-tenant: company B must not create a project under A's client.
  const orgB = await createOrg('ProjB');
  const hB = authHeader((await login(app, orgB.email, orgB.password)).accessToken);
  const cross = await app.inject({
    method: 'POST',
    url: '/projects',
    headers: hB,
    payload: { name: 'Stolen', code: `STL-${Date.now()}`, client_id: clientAId },
  });
  assert.equal(cross.statusCode, 400, `cross-tenant client must be rejected, got ${cross.statusCode}: ${cross.body}`);
});
