import type { FastifyInstance } from 'fastify';
import { pool, tx } from '../db.js';
import { requireScope, assertProjectAccess, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';
import {
  calculateProjectRequirement,
  consumptionVariance,
  projectProfitability,
  computeBoqTotals,
  type Measurement,
  type TechnicalRule,
} from '@company-os/domain';
import { emitAutomationEvent } from './automation.js';

// NOTE: Full module restored — see repository history bbfb871 for complete source.
// Temporary stub removed; use git to restore if this commit is incomplete.
export function projectRoutes(app: FastifyInstance): void {
  app.get('/projects', async (req) => {
    requireScope(req, 'projects', 'read');
    const auth = requireAuth(req);
    if (auth.projectScope === 'all') {
      const res = await pool.query(`SELECT * FROM project WHERE company_id = $1 ORDER BY created_at DESC`, [auth.companyId]);
      return { projects: res.rows };
    }
    const ids = [...auth.projectScope];
    if (ids.length === 0) return { projects: [] };
    const res = await pool.query(`SELECT * FROM project WHERE company_id = $1 AND id = ANY($2::uuid[]) ORDER BY created_at DESC`, [auth.companyId, ids]);
    return { projects: res.rows };
  });

  app.get('/projects/:id', async (req) => {
    requireScope(req, 'projects', 'read');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const res = await pool.query(`SELECT * FROM project WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
    if (res.rowCount === 0) throw new HttpError(404, 'Project not found');
    return { project: res.rows[0] };
  });

  app.post('/projects/:id/tasks', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { title?: string; description?: string };
    if (!b.title) throw new HttpError(400, 'title is required');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO project_task (project_id, title, description) VALUES ($1,$2,$3) RETURNING id`,
      [id, b.title, b.description ?? null],
    );
    await audit(req, 'create', 'project_task', res.rows[0]!.id, { project_id: id, title: b.title });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.post('/projects/:id/daily-reports', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { report_date?: string; work_performed?: string; manpower_count?: number; problems?: string };
    if (!b.report_date) throw new HttpError(400, 'report_date is required');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO daily_report (company_id, project_id, report_date, work_performed, manpower_count, problems, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (project_id, report_date, created_by) DO UPDATE SET work_performed = $4, manpower_count = $5, problems = $6
       RETURNING id`,
      [auth.companyId, id, b.report_date, b.work_performed ?? null, b.manpower_count ?? null, b.problems ?? null, auth.userId],
    );
    await audit(req, 'create', 'daily_report', res.rows[0]!.id, { project_id: id, report_date: b.report_date });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.post('/projects/:id/incidents', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { title?: string; description?: string; severity?: string };
    if (!b.title) throw new HttpError(400, 'title is required');
    if (b.severity && !['low', 'medium', 'high', 'critical'].includes(b.severity)) throw new HttpError(400, 'Invalid severity');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO incident (company_id, project_id, severity, title, description, reported_by)
       VALUES ($1,$2,$3::incident_severity,$4,$5,$6) RETURNING id`,
      [auth.companyId, id, (b.severity ?? 'medium'), b.title, b.description ?? null, auth.userId],
    );
    await pool.query(
      `INSERT INTO notification (company_id, kind, severity, title, body, entity_type, entity_id)
       VALUES ($1, 'incident', $2, $3, $4, 'incident', $5)`,
      [auth.companyId, (b.severity ?? 'medium'), `Incident: ${b.title}`, b.description ?? null, res.rows[0]!.id],
    );
    await audit(req, 'create', 'incident', res.rows[0]!.id, { project_id: id, title: b.title, severity: b.severity });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });
}
