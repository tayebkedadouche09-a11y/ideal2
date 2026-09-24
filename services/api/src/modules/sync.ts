/**
 * V3 Offline Sync API — outbox push, pull, conflict resolution.
 * Server is authoritative. Never silently overwrite a newer server record.
 */
import type { FastifyInstance } from 'fastify';
import { pool, tx } from '../db.js';
import { requireAuth } from '../auth/context.js';
import { requireScope, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';

type MutationOp = 'create' | 'update' | 'delete' | 'action';

interface IncomingMutation {
  clientMutationId: string;
  entityType: string;
  operation: MutationOp;
  payload: Record<string, unknown>;
  clientEntityId?: string;
  entityId?: string;
  baseVersion?: number;
}

const ALLOWED_ENTITY_TYPES = new Set([
  'capture_item', 'daily_report', 'incident', 'project_task', 'voice_to_work', 'stock_movement',
]);

export function syncRoutes(app: FastifyInstance): void {
  app.post('/sync/devices', async (req, reply) => {
    const auth = requireAuth(req);
    const body = (req.body ?? {}) as { deviceId?: string; platform?: string; label?: string; appVersion?: string };
    if (!body.deviceId || body.deviceId.length < 8) throw new HttpError(400, 'deviceId required (min 8 chars)');
    const platform = body.platform ?? 'web';
    if (!['web', 'android', 'ios', 'desktop'].includes(platform)) throw new HttpError(400, 'Invalid platform');

    const res = await pool.query<{ id: string }>(
      `INSERT INTO device_session (company_id, user_id, device_id, platform, label, app_version, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_id, device_id) DO UPDATE
         SET platform = EXCLUDED.platform,
             label = COALESCE(EXCLUDED.label, device_session.label),
             app_version = COALESCE(EXCLUDED.app_version, device_session.app_version),
             last_seen_at = now(),
             revoked_at = NULL
       RETURNING id`,
      [auth.companyId, auth.userId, body.deviceId, platform, body.label ?? null, body.appVersion ?? null],
    );
    await audit(req, 'create', 'device_session', res.rows[0]!.id, { deviceId: body.deviceId, platform });
    return reply.code(201).send({ id: res.rows[0]!.id, deviceId: body.deviceId });
  });

  app.post('/sync/push', async (req, reply) => {
    const auth = requireAuth(req);
    requireScope(req, 'field', 'write');
    const body = (req.body ?? {}) as { deviceId?: string; mutations?: IncomingMutation[] };
    if (!body.deviceId) throw new HttpError(400, 'deviceId required');
    if (!Array.isArray(body.mutations) || body.mutations.length === 0) throw new HttpError(400, 'mutations array required');
    if (body.mutations.length > 50) throw new HttpError(400, 'Max 50 mutations per push');

    const dev = await pool.query(
      `SELECT id FROM device_session
        WHERE company_id = $1 AND user_id = $2 AND device_id = $3 AND revoked_at IS NULL`,
      [auth.companyId, auth.userId, body.deviceId],
    );
    if (dev.rowCount === 0) throw new HttpError(403, 'Device not registered or revoked — call POST /sync/devices first');
    await pool.query(
      `UPDATE device_session SET last_seen_at = now() WHERE company_id = $1 AND user_id = $2 AND device_id = $3`,
      [auth.companyId, auth.userId, body.deviceId],
    );

    const results: Array<{ clientMutationId: string; status: string; serverEntityId?: string; conflictId?: string; reason?: string }> = [];
    for (const m of body.mutations) {
      if (!m.clientMutationId || !m.entityType || !m.operation) {
        results.push({ clientMutationId: m.clientMutationId ?? '?', status: 'rejected', reason: 'Invalid mutation shape' });
        continue;
      }
      if (!ALLOWED_ENTITY_TYPES.has(m.entityType)) {
        results.push({ clientMutationId: m.clientMutationId, status: 'rejected', reason: `entityType not offline-capable: ${m.entityType}` });
        continue;
      }
      if (!['create', 'update', 'delete', 'action'].includes(m.operation)) {
        results.push({ clientMutationId: m.clientMutationId, status: 'rejected', reason: 'Invalid operation' });
        continue;
      }
      try {
        results.push(await applyMutation(auth.companyId, auth.userId, body.deviceId, m, req));
      } catch (err) {
        results.push({ clientMutationId: m.clientMutationId, status: 'rejected', reason: err instanceof Error ? err.message : 'apply failed' });
      }
    }
    return { results };
  });

  app.get('/sync/pull', async (req) => {
    const auth = requireAuth(req);
    requireScope(req, 'field', 'read');
    const q = req.query as { since?: string; limit?: string };
    const since = q.since ? new Date(q.since) : new Date(0);
    if (Number.isNaN(since.getTime())) throw new HttpError(400, 'Invalid since');
    const limit = Math.min(Number(q.limit ?? 100), 200);

    const mutations = await pool.query(
      `SELECT id, client_mutation_id, entity_type, entity_id, server_entity_id, operation, status,
              payload, conflict_reason, applied_at, created_at
         FROM sync_mutation
        WHERE company_id = $1 AND user_id = $2 AND created_at > $3
        ORDER BY created_at ASC LIMIT $4`,
      [auth.companyId, auth.userId, since.toISOString(), limit],
    );
    const conflicts = await pool.query(
      `SELECT id, mutation_id, entity_type, entity_id, client_payload, server_payload, created_at
         FROM sync_conflict WHERE company_id = $1 AND resolved_at IS NULL
        ORDER BY created_at ASC LIMIT 50`,
      [auth.companyId],
    );
    return { serverTime: new Date().toISOString(), mutations: mutations.rows, conflicts: conflicts.rows };
  });

  app.post('/sync/conflicts/:id/resolve', async (req, reply) => {
    const auth = requireAuth(req);
    requireScope(req, 'field', 'write');
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { resolution?: string };
    if (!body.resolution || !['client_wins', 'server_wins', 'merged', 'cancelled'].includes(body.resolution)) {
      throw new HttpError(400, 'resolution must be client_wins|server_wins|merged|cancelled');
    }
    const out = await tx(async (c) => {
      const conf = await c.query(
        `SELECT id, mutation_id FROM sync_conflict WHERE id = $1 AND company_id = $2 AND resolved_at IS NULL FOR UPDATE`,
        [id, auth.companyId],
      );
      if (conf.rowCount === 0) throw new HttpError(404, 'Conflict not found or already resolved');
      const row = conf.rows[0] as { id: string; mutation_id: string };
      await c.query(
        `UPDATE sync_conflict SET resolution = $1, resolved_by = $2, resolved_at = now() WHERE id = $3`,
        [body.resolution, auth.userId, id],
      );
      const mutationRes = await c.query<{ entity_type: string; entity_id: string | null; payload: Record<string, unknown> }>(
        `SELECT entity_type, entity_id, payload FROM sync_mutation WHERE id = $1 AND company_id = $2`,
        [row.mutation_id, auth.companyId],
      );
      const mutation = mutationRes.rows[0];
      if (!mutation) throw new HttpError(404, 'Mutation not found');
      if (body.resolution === 'client_wins' || body.resolution === 'merged') {
        if (!mutation.entity_id) throw new HttpError(400, 'Conflict has no entity_id');
        await applyResolvedPayload(c, auth.companyId, mutation.entity_type, mutation.entity_id, mutation.payload);
      }
      const newStatus = body.resolution === 'cancelled' || body.resolution === 'server_wins' ? 'rejected' : 'applied';
      await c.query(
        `UPDATE sync_mutation SET status = $1, applied_at = CASE WHEN $1 = 'applied' THEN now() ELSE applied_at END WHERE id = $2 AND company_id = $3`,
        [newStatus, row.mutation_id, auth.companyId],
      );
      return { conflictId: id, resolution: body.resolution };
    });
    await audit(req, 'update', 'sync_conflict', id, { resolution: body.resolution });
    return reply.send(out);
  });

  app.get('/sync/mutations', async (req) => {
    const auth = requireAuth(req);
    requireScope(req, 'field', 'read');
    const q = req.query as { since?: string; limit?: string; status?: string };
    const since = q.since ? new Date(q.since) : new Date(0);
    if (Number.isNaN(since.getTime())) throw new HttpError(400, 'Invalid since');
    const limit = Math.min(Math.max(Number(q.limit ?? 100), 1), 200);
    const params: unknown[] = [auth.companyId, auth.userId, since.toISOString()];
    let statusSql = '';
    if (q.status) { params.push(q.status); statusSql = ' AND status = $4'; }
    params.push(limit);
    const res = await pool.query(
      `SELECT id, client_mutation_id, device_id, entity_type, entity_id, server_entity_id,
              operation, status, payload, base_version, conflict_reason, applied_at, created_at
         FROM sync_mutation
        WHERE company_id = $1 AND user_id = $2 AND created_at > $3${statusSql}
        ORDER BY created_at ASC LIMIT ${params.length}`,
      params,
    );
    return { mutations: res.rows };
  });

  app.get('/sync/conflicts', async (req) => {
    const auth = requireAuth(req);
    requireScope(req, 'field', 'read');
    const res = await pool.query(
      `SELECT c.*, m.client_mutation_id, m.device_id, m.user_id
         FROM sync_conflict c JOIN sync_mutation m ON m.id = c.mutation_id
        WHERE c.company_id = $1 AND c.resolved_at IS NULL
        ORDER BY c.created_at ASC LIMIT 100`,
      [auth.companyId],
    );
    return { conflicts: res.rows };
  });
}

async function applyResolvedPayload(
  c: import('pg').PoolClient,
  companyId: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const configs: Record<string, { table: string; columns: string[]; companyWhere: string }> = {
    project_task: { table: 'project_task', columns: ['title','description','status','planned_start','planned_end','assignee_employee_id'], companyWhere: 'project_id IN (SELECT id FROM project WHERE company_id = COMPANY_PARAM)' },
    daily_report: { table: 'daily_report', columns: ['report_date','work_performed','manpower_count','problems'], companyWhere: 'company_id = COMPANY_PARAM' },
    incident: { table: 'incident', columns: ['severity','status','title','description','resolved_at'], companyWhere: 'company_id = COMPANY_PARAM' },
    capture_item: { table: 'capture_item', columns: ['title','note','latitude','longitude','captured_via','metadata','processing_status'], companyWhere: 'company_id = COMPANY_PARAM' },
  };
  const cfg = configs[entityType];
  if (!cfg) throw new HttpError(400, 'Conflict resolution is not supported for ' + entityType);
  const entries = Object.entries(payload).filter(([key]) => cfg.columns.includes(key));
  if (entries.length === 0) throw new HttpError(400, 'No resolvable fields in client payload');

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of entries) {
    sets.push(key + ' = $' + i++);
    values.push(value);
  }
  const entityParam = i++;
  const companyParam = i++;
  sets.push('row_version = row_version + 1');
  values.push(entityId, companyId);

  const where = cfg.companyWhere.replace('COMPANY_PARAM', '$' + companyParam);
  const res = await c.query(
    'UPDATE ' + cfg.table + ' SET ' + sets.join(', ') +
    ' WHERE id = $' + entityParam + ' AND ' + where,
    values,
  );
  if (res.rowCount === 0) throw new HttpError(404, 'Conflict entity not found in company');
}

async function applyMutation(
  companyId: string,
  userId: string,
  deviceId: string,
  m: IncomingMutation,
  req: import('fastify').FastifyRequest,
): Promise<{ clientMutationId: string; status: string; serverEntityId?: string; conflictId?: string; reason?: string }> {
  const existing = await pool.query<{ id: string; status: string; server_entity_id: string | null }>(
    `SELECT id, status, server_entity_id FROM sync_mutation WHERE company_id = $1 AND client_mutation_id = $2`,
    [companyId, m.clientMutationId],
  );
  if (existing.rowCount && existing.rows[0]) {
    const e = existing.rows[0];
    return {
      clientMutationId: m.clientMutationId,
      status: e.status === 'accepted' || e.status === 'applied' ? 'duplicate' : e.status,
      serverEntityId: e.server_entity_id ?? undefined,
      reason: 'Already processed',
    };
  }

  return tx(async (c) => {
    const ins = await c.query<{ id: string }>(
      `INSERT INTO sync_mutation
         (company_id, user_id, device_id, client_mutation_id, entity_type, entity_id,
          client_entity_id, operation, payload, base_version, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'accepted') RETURNING id`,
      [
        companyId, userId, deviceId, m.clientMutationId, m.entityType, m.entityId ?? null,
        m.clientEntityId ?? null, m.operation, JSON.stringify(m.payload ?? {}), m.baseVersion ?? null,
      ],
    );
    const mutationId = ins.rows[0]!.id;

    if (m.operation === 'create' && m.entityType === 'daily_report') {
      const p = m.payload;
      const projectId = String(p.project_id ?? '');
      if (!projectId) throw new Error('project_id required');
      const proj = await c.query(`SELECT id FROM project WHERE id = $1 AND company_id = $2`, [projectId, companyId]);
      if (proj.rowCount === 0) throw new Error('Project not found');
      const created = await c.query<{ id: string }>(
        `INSERT INTO daily_report
           (company_id, project_id, report_date, work_performed, manpower_count, problems, created_by)
         VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5,$6,$7) RETURNING id`,
        [companyId, projectId, p.report_date ?? null, p.work_performed ?? '', p.manpower_count ?? null, p.problems ?? null, userId],
      );
      await c.query(
        `UPDATE sync_mutation SET status = 'applied', server_entity_id = $1, applied_at = now() WHERE id = $2`,
        [created.rows[0]!.id, mutationId],
      );
      await audit(req, 'create', 'daily_report', created.rows[0]!.id, { via: 'sync', clientMutationId: m.clientMutationId });
      return { clientMutationId: m.clientMutationId, status: 'applied', serverEntityId: created.rows[0]!.id };
    }

    if (m.operation === 'create' && m.entityType === 'incident') {
      const p = m.payload;
      const projectId = String(p.project_id ?? '');
      if (!projectId) throw new Error('project_id required');
      const proj = await c.query(`SELECT id FROM project WHERE id = $1 AND company_id = $2`, [projectId, companyId]);
      if (proj.rowCount === 0) throw new Error('Project not found');
      const created = await c.query<{ id: string }>(
        `INSERT INTO incident (company_id, project_id, severity, title, description, reported_by)
         VALUES ($1,$2,COALESCE($3,'medium'),$4,$5,$6) RETURNING id`,
        [companyId, projectId, p.severity ?? 'medium', p.title ?? 'Incident', p.description ?? '', userId],
      );
      await c.query(
        `UPDATE sync_mutation SET status = 'applied', server_entity_id = $1, applied_at = now() WHERE id = $2`,
        [created.rows[0]!.id, mutationId],
      );
      await audit(req, 'create', 'incident', created.rows[0]!.id, { via: 'sync', clientMutationId: m.clientMutationId });
      return { clientMutationId: m.clientMutationId, status: 'applied', serverEntityId: created.rows[0]!.id };
    }

    if (m.operation === 'update' && m.entityId && m.baseVersion != null) {
      const tableMap: Record<string, string> = {
        project_task: 'project_task', daily_report: 'daily_report', incident: 'incident', capture_item: 'capture_item',
      };
      const table = tableMap[m.entityType];
      if (table) {
        const cur = await c.query<{ row_version: string }>(
          `SELECT t.row_version FROM ${table} t ${table === 'project_task' ? 'JOIN project p ON p.id = t.project_id' : ''} WHERE t.id = $1 ${table === 'project_task' ? 'AND p.company_id = $2' : 'AND t.company_id = $2'} FOR UPDATE`,
          [m.entityId, companyId],
        );
        if (cur.rowCount === 0) throw new Error('Entity not found');
        const serverVersion = Number(cur.rows[0]!.row_version);
        if (serverVersion > m.baseVersion) {
          const current = await c.query<{ row: Record<string, unknown> }>(
            `SELECT row_to_json(t) AS row FROM ${table} t ${table === 'project_task' ? 'JOIN project p ON p.id = t.project_id' : ''}
              WHERE t.id = $1 ${table === 'project_task' ? 'AND p.company_id = $2' : 'AND t.company_id = $2'}`,
            [m.entityId, companyId],
          );
          const serverPayload = current.rows[0]?.row ?? { row_version: serverVersion };
          const conf = await c.query<{ id: string }>(
            `INSERT INTO sync_conflict (company_id, mutation_id, entity_type, entity_id, client_payload, server_payload)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING id`,
            [companyId, mutationId, m.entityType, m.entityId, JSON.stringify(m.payload), JSON.stringify(serverPayload)],
          );
          await c.query(
            `UPDATE sync_mutation SET status = 'conflict', conflict_reason = 'version_mismatch', conflict_server_payload = $1::jsonb WHERE id = $2`,
            [JSON.stringify({ row_version: serverVersion }), mutationId],
          );
          return {
            clientMutationId: m.clientMutationId, status: 'conflict', conflictId: conf.rows[0]!.id,
            reason: `Server version ${serverVersion} > baseVersion ${m.baseVersion}`,
          };
        }
      }
    }

    await c.query(`UPDATE sync_mutation SET status = 'applied', applied_at = now() WHERE id = $1`, [mutationId]);
    return { clientMutationId: m.clientMutationId, status: 'applied', reason: 'Recorded; domain handler may complete asynchronously' };
  });
}
