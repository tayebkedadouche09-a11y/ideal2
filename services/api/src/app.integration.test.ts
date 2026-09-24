import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

test('API integration: health and authentication boundary', async (t) => {
  const app = await createApp();
  t.after(async () => { await app.close(); });

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'ok');

  const me = await app.inject({ method: 'GET', url: '/auth/me' });
  assert.equal(me.statusCode, 401);

  const projects = await app.inject({ method: 'GET', url: '/projects' });
  assert.equal(projects.statusCode, 401);

  const portal = await app.inject({ method: 'GET', url: '/portal/profile' });
  assert.equal(portal.statusCode, 401);
});
