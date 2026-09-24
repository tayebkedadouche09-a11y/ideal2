import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

test('API integration: health and authentication boundary', async (t) => {
  const app = await createApp();
  t.after(async () => { await app.close(); });
  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'ok');
  assert.equal((await app.inject({ method: 'GET', url: '/auth/me' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/projects' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/portal/profile' })).statusCode, 401);
});

test('API integration: sync routes require auth', async (t) => {
  const app = await createApp();
  t.after(async () => { await app.close(); });
  for (const [method, url] of [
    ['POST', '/sync/devices'], ['POST', '/sync/push'], ['GET', '/sync/pull'],
    ['GET', '/sync/conflicts'], ['GET', '/sync/mutations'],
  ] as const) {
    assert.equal((await app.inject({ method, url })).statusCode, 401, `${method} ${url}`);
  }
});

const FAKE = '00000000-0000-4000-8000-000000000099';

test('API integration: IDOR-sensitive endpoints reject unauthenticated access', async (t) => {
  const app = await createApp();
  t.after(async () => { await app.close(); });
  const paths: Array<['GET' | 'POST', string]> = [
    ['GET', `/projects/${FAKE}`], ['GET', `/projects/${FAKE}/lessons`], ['GET', `/projects/${FAKE}/timeline`],
    ['GET', `/projects/${FAKE}/zones`], ['GET', `/projects/${FAKE}/boq`], ['GET', `/projects/${FAKE}/captures`],
    ['POST', `/projects/${FAKE}/tasks`], ['POST', `/projects/${FAKE}/daily-reports`], ['POST', `/projects/${FAKE}/incidents`],
    ['GET', `/invoices/${FAKE}`], ['GET', `/documents/${FAKE}`],
    ['GET', `/sync/conflicts/${FAKE}`], ['POST', `/sync/conflicts/${FAKE}/resolve`],
    ['GET', `/captures/${FAKE}/content`],
  ];
  for (const [method, url] of paths) {
    const res = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
    assert.equal(res.statusCode, 401, `${method} ${url} got ${res.statusCode}`);
  }
});

test('API integration: sync push unauthenticated is 401', async (t) => {
  const app = await createApp();
  t.after(async () => { await app.close(); });
  const res = await app.inject({
    method: 'POST', url: '/sync/push',
    payload: { deviceId: 'device-test-01', mutations: [] },
  });
  assert.equal(res.statusCode, 401);
});
