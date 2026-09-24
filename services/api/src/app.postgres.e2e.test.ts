import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from './app.js';
import { pool } from './db.js';

const maybe = process.env.DATABASE_URL ? test : test.skip;

maybe('PostgreSQL E2E: tenant isolation, sync idempotence, version conflict and resolution', async (t) => {
  const suffix = randomUUID();
  const companyA = randomUUID(), companyB = randomUUID();
  const userA = randomUUID(), userB = randomUUID();
  const roleA = randomUUID(), roleB = randomUUID();
  const clientA = randomUUID(), clientB = randomUUID();
  const projectA = randomUUID(), projectB = randomUUID(), incidentA = randomUUID();
  const deviceA = 'e2e-device-a-' + suffix.slice(0, 12);
  const deviceB = 'e2e-device-b-' + suffix.slice(0, 12);
  const mutationCreate = 'e2e-create-' + suffix;
  const mutationConflict = 'e2e-conflict-' + suffix;

  await pool.query('BEGIN');
  try {
    await pool.query('INSERT INTO company (id,name) VALUES ($1,$2),($3,$4)', [companyA, 'E2E Company A ' + suffix, companyB, 'E2E Company B ' + suffix]);
    await pool.query('INSERT INTO role (id,company_id,key,name) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)', [roleA,companyA,'owner','Owner',roleB,companyB,'owner','Owner']);
    await pool.query('INSERT INTO "user" (id,company_id,email,password_hash,full_name) VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
      [userA,companyA,'a-' + suffix + '@e2e.test','x','E2E A',userB,companyB,'b-' + suffix + '@e2e.test','x','E2E B']);
    await pool.query('INSERT INTO user_role (user_id,role_id) VALUES ($1,$2),($3,$4)', [userA,roleA,userB,roleB]);
    await pool.query('INSERT INTO client (id,company_id,name) VALUES ($1,$2,$3),($4,$5,$6)', [clientA,companyA,'Client A',clientB,companyB,'Client B']);
    await pool.query('INSERT INTO project (id,company_id,client_id,code,name) VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
      [projectA,companyA,clientA,'E2E-A-'+suffix.slice(0,8),'Project A',projectB,companyB,clientB,'E2E-B-'+suffix.slice(0,8),'Project B']);
    await pool.query('INSERT INTO incident (id,company_id,project_id,title,description,row_version) VALUES ($1,$2,$3,$4,$5,2)',
      [incidentA,companyA,projectA,'Server title','server state']);
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }

  const app = await createApp();
  t.after(async () => {
    await app.close();
    await pool.query('DELETE FROM sync_conflict WHERE company_id IN ($1,$2)', [companyA,companyB]);
    await pool.query('DELETE FROM sync_mutation WHERE company_id IN ($1,$2)', [companyA,companyB]);
    await pool.query('DELETE FROM device_session WHERE company_id IN ($1,$2)', [companyA,companyB]);
    await pool.query('DELETE FROM audit_log WHERE company_id IN ($1,$2)', [companyA,companyB]);
    await pool.query('DELETE FROM project WHERE id IN ($1,$2)', [projectA,projectB]);
    await pool.query('DELETE FROM client WHERE id IN ($1,$2)', [clientA,clientB]);
    await pool.query('DELETE FROM user_role WHERE user_id IN ($1,$2)', [userA,userB]);
    await pool.query('DELETE FROM role WHERE id IN ($1,$2)', [roleA,roleB]);
    await pool.query('DELETE FROM "user" WHERE id IN ($1,$2)', [userA,userB]);
    await pool.query('DELETE FROM company WHERE id IN ($1,$2)', [companyA,companyB]);
  });

  const authA = { authorization: 'Bearer ' + app.jwt.sign({ sub: userA, typ: 'access' }) };
  const authB = { authorization: 'Bearer ' + app.jwt.sign({ sub: userB, typ: 'access' }) };

  const crossGet = await app.inject({ method: 'GET', url: '/projects/' + projectA, headers: authB });
  assert.equal(crossGet.statusCode, 404);

  const crossTask = await app.inject({ method: 'POST', url: '/projects/' + projectA + '/tasks', headers: authB, payload: { title: 'cross-company' } });
  assert.equal(crossTask.statusCode, 404);

  const devA = await app.inject({ method: 'POST', url: '/sync/devices', headers: authA, payload: { deviceId: deviceA, platform: 'web' } });
  assert.equal(devA.statusCode, 201);
  const devB = await app.inject({ method: 'POST', url: '/sync/devices', headers: authB, payload: { deviceId: deviceB, platform: 'web' } });
  assert.equal(devB.statusCode, 201);

  const pushPayload = {
    deviceId: deviceA,
    mutations: [{
      clientMutationId: mutationCreate,
      entityType: 'daily_report',
      operation: 'create',
      payload: { project_id: projectA, report_date: '2026-09-24', work_performed: 'E2E work', manpower_count: 2 }
    }]
  };
  const first = await app.inject({ method: 'POST', url: '/sync/push', headers: authA, payload: pushPayload });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().results[0].status, 'applied');

  const duplicate = await app.inject({ method: 'POST', url: '/sync/push', headers: authA, payload: pushPayload });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().results[0].status, 'duplicate');

  const crossPush = await app.inject({
    method: 'POST', url: '/sync/push', headers: authB,
    payload: { deviceId: deviceB, mutations: [{
      clientMutationId: 'e2e-cross-' + suffix,
      entityType: 'daily_report', operation: 'create',
      payload: { project_id: projectA, report_date: '2026-09-24', work_performed: 'forbidden', manpower_count: 1 }
    }]}
  });
  assert.equal(crossPush.statusCode, 200);
  assert.equal(crossPush.json().results[0].status, 'rejected');

  const conflict = await app.inject({
    method: 'POST', url: '/sync/push', headers: authA,
    payload: { deviceId: deviceA, mutations: [{
      clientMutationId: mutationConflict,
      entityType: 'incident', operation: 'update', entityId: incidentA,
      baseVersion: 1, payload: { title: 'Client wins' }
    }]}
  });
  assert.equal(conflict.statusCode, 200);
  assert.equal(conflict.json().results[0].status, 'conflict');
  const conflictId = conflict.json().results[0].conflictId;
  assert.ok(conflictId);

  const stored = await pool.query('SELECT client_payload, server_payload FROM sync_conflict WHERE id = $1', [conflictId]);
  assert.equal(stored.rows[0].client_payload.title, 'Client wins');
  assert.equal(stored.rows[0].server_payload.title, 'Server title');

  const resolved = await app.inject({
    method: 'POST', url: '/sync/conflicts/' + conflictId + '/resolve', headers: authA,
    payload: { resolution: 'client_wins' }
  });
  assert.equal(resolved.statusCode, 200);

  const incident = await pool.query('SELECT title,row_version FROM incident WHERE id = $1 AND company_id = $2', [incidentA,companyA]);
  assert.equal(incident.rows[0].title, 'Client wins');
  assert.equal(Number(incident.rows[0].row_version), 3);

  const mutations = await app.inject({ method: 'GET', url: '/sync/mutations', headers: authA });
  assert.equal(mutations.statusCode, 200);
  assert.ok(mutations.json().mutations.length >= 2);

  const bConflicts = await app.inject({ method: 'GET', url: '/sync/conflicts', headers: authB });
  assert.equal(bConflicts.statusCode, 200);
  assert.equal(bConflicts.json().conflicts.length, 0);

  const auditRows = await pool.query(
    "SELECT action FROM audit_log WHERE company_id = $1 AND entity_type IN ('device_session','daily_report','incident','sync_conflict') ORDER BY created_at",
    [companyA]
  );
  assert.ok(auditRows.rows.some((r) => r.action === 'create'));
  assert.ok(auditRows.rows.some((r) => r.action === 'update'));
});
