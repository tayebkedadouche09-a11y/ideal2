import type { FastifyInstance } from 'fastify';
import { pool, tx } from '../db.js';
import { requireScope, assertProjectAccess, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';

export function intelligenceRoutes(app: FastifyInstance): void {
  // Historical project comparison — evidence for trends (spec §53)
  app.get('/intelligence/project-comparison', async (req) => {
    requireScope(req, 'reports', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.contract_value,
              COALESCE((SELECT SUM(c.actual_quantity * COALESCE(m.purchase_price,0))
                          FROM project_material_consumption c JOIN material m ON m.id = c.material_id
                         WHERE c.project_id = p.id), 0) AS material_cost,
              COALESCE((SELECT SUM(amount) FROM expense WHERE project_id = p.id), 0) AS other_cost,
              (SELECT COUNT(*)::int FROM incident WHERE project_id = p.id) AS incidents,
              CASE WHEN p.actual_end IS NOT NULL AND p.planned_end IS NOT NULL
                   THEN (p.actual_end - p.planned_end) END AS delay_days
         FROM project p
        WHERE p.company_id = $1 AND p.status = 'completed'
        ORDER BY p.actual_end DESC NULLS LAST LIMIT 50`,
      [auth.companyId],
    );
    const rows = res.rows.map((r) => ({
      ...r,
      revenue: Number(r.contract_value),
      cost: Number(r.material_cost) + Number(r.other_cost),
      margin: Number(r.contract_value) - Number(r.material_cost) - Number(r.other_cost),
    }));
    return { projects: rows };
  });

  // Anomaly detection — material variance above threshold with evidence (spec §20/§53)
  app.get('/intelligence/anomalies', async (req) => {
    requireScope(req, 'projects', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(
      `SELECT c.id, c.project_id, p.code AS project_code, m.name AS material_name, m.unit,
              c.planned_quantity, c.actual_quantity, c.variance, c.reason_code,
              ROUND((c.variance / NULLIF(c.planned_quantity, 0)) * 100, 1) AS variance_percent
         FROM project_material_consumption c
         JOIN material m ON m.id = c.material_id
         JOIN project p ON p.id = c.project_id
        WHERE c.company_id = $1 AND c.planned_quantity > 0
          AND ABS(c.variance) > c.planned_quantity * 0.10
        ORDER BY ABS(c.variance / NULLIF(c.planned_quantity, 0)) DESC
        LIMIT 50`,
      [auth.companyId],
    );
    return { anomalies: res.rows };
  });

  // Deterministic forecast — material depletion from observed 30-day consumption
  // (spec §47: forecasts carry assumptions, data source and confidence)
  app.get('/intelligence/forecast', async (req) => {
    requireScope(req, 'stock', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(
      `SELECT m.id, m.name, m.unit, sl.physical, m.min_stock,
              COALESCE((SELECT SUM(sm.quantity) / 30.0
                          FROM stock_movement sm
                         WHERE sm.material_id = m.id AND sm.kind = 'exit'
                           AND sm.created_at > now() - interval '30 days'), 0) AS daily_burn
         FROM stock_level sl JOIN material m ON m.id = sl.material_id
        WHERE sl.company_id = $1`,
      [auth.companyId],
    );
    const forecasts = res.rows.map((r) => {
      const burn = Number(r.daily_burn);
      const physical = Number(r.physical);
      return {
        materialId: r.id,
        name: r.name,
        unit: r.unit,
        physical,
        dailyBurn: Math.round(burn * 1000) / 1000,
        daysToDepletion: burn > 0 ? Math.floor(physical / burn) : null,
        belowThresholdDate: burn > 0 && physical / burn <= 30 ? new Date(Date.now() + (physical / burn) * 86400000).toISOString().slice(0, 10) : null,
        assumptions: ['30-day average consumption stays constant', 'No pending receipts included'],
        source: 'stock_movement (kind=exit, last 30 days), stock_level.physical',
        confidence: burn > 0 ? 'medium' : 'low',
        generatedAt: new Date().toISOString(),
      };
    });
    return { forecasts };
  });

  // Scenario simulator — hypothetical, never touches live data (spec §47b)
  app.post('/intelligence/scenarios', async (req, reply) => {
    requireScope(req, 'reports', 'read');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as {
      name?: string;
      changes?: { type?: string; percent?: number; count?: number }[];
    };
    if (!b.changes?.length) throw new HttpError(400, 'changes are required');
    const changes = b.changes;

    let scenarioId = '';
    const result = await tx(async (c) => {
      const scen = await c.query<{ id: string }>(
        `INSERT INTO scenario (company_id, name, definition, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
        [auth.companyId, b.name ?? 'Scenario', JSON.stringify(b.changes), auth.userId],
      );
      scenarioId = scen.rows[0]!.id;
      // Baseline: completed projects' average cost structure
      const base = await c.query<{ materials: string; labor: string; other: string; count: string }>(
        `SELECT
           COALESCE(AVG(over.materials), 0) AS materials,
           COALESCE(AVG(over.labor), 0) AS labor,
           COALESCE(AVG(over.other), 0) AS other,
           COUNT(*) AS count
          FROM (
            SELECT p.id,
              (SELECT COALESCE(SUM(cc.actual_quantity * COALESCE(mm.purchase_price,0)),0)
                 FROM project_material_consumption cc JOIN material mm ON mm.id = cc.material_id
                WHERE cc.project_id = p.id) AS materials,
              (SELECT COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (w.end_time - w.start_time))/3600,0) * COALESCE(e.hourly_cost,0)),0)
                 FROM work_log w JOIN employee e ON e.id = w.employee_id
                WHERE w.project_id = p.id) AS labor,
              (SELECT COALESCE(SUM(amount),0) FROM expense WHERE project_id = p.id) AS other
            FROM project p WHERE p.company_id = $1 AND p.status = 'completed'
          ) over`,
        [auth.companyId],
      );
      const baseline = {
        materials: Number(base.rows[0]?.materials ?? 0),
        labor: Number(base.rows[0]?.labor ?? 0),
        other: Number(base.rows[0]?.other ?? 0),
        projectsConsidered: Number(base.rows[0]?.count ?? 0),
      };
      let materials = baseline.materials;
      let labor = baseline.labor;
      let other = baseline.other;
      const applied: string[] = [];
      for (const ch of changes) {
        const pct = (ch.percent ?? 0) / 100;
        switch (ch.type) {
          case 'material_price_increase': materials *= 1 + pct; applied.push(`material cost ×${1 + pct}`); break;
          case 'labor_cost_increase': labor *= 1 + pct; applied.push(`labor cost ×${1 + pct}`); break;
          case 'add_team': labor *= 1 + 0.15 * (ch.count ?? 1); applied.push(`+${ch.count ?? 1} team(s) → labor ×${1 + 0.15 * (ch.count ?? 1)}`); break;
          case 'remove_team': labor *= Math.max(0, 1 - 0.15 * (ch.count ?? 1)); applied.push(`-${ch.count ?? 1} team(s) → labor ×${Math.max(0, 1 - 0.15 * (ch.count ?? 1))}`); break;
          case 'other_costs_increase': other *= 1 + pct; applied.push(`other costs ×${1 + pct}`); break;
          default: throw new HttpError(400, `Unknown change type ${ch.type}`);
        }
      }
      const runRes = await c.query<{ id: string }>(
        `INSERT INTO scenario_run (scenario_id, result, assumptions) VALUES ($1,$2,$3) RETURNING id`,
        [scen.rows[0]!.id, JSON.stringify({ baseline, scenario: { materials, labor, other } }), JSON.stringify(['Average of completed projects', 'Linear scaling', 'No capacity constraints'])],
      );
      return { scenarioId: scen.rows[0]!.id, runId: runRes.rows[0]!.id, baseline, scenario: { materials, labor, other }, applied };
    });

    await audit(req, 'export', 'scenario', scenarioId, { name: b.name });
    return reply.code(201).send(result);
  });

  // Lessons learned capture (spec §52)
  app.post('/projects/:id/lessons', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { category?: string; note?: string };
    if (!b.category || !b.note) throw new HttpError(400, 'category and note are required');
    const valid = ['what_went_well', 'what_went_wrong', 'material_variance', 'time_variance', 'supplier', 'equipment', 'quality', 'unexpected_cost', 'corrective_action'];
    if (!valid.includes(b.category)) throw new HttpError(400, `category must be one of ${valid.join(', ')}`);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO lesson_learned (company_id, project_id, category, note, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [auth.companyId, id, b.category, b.note, auth.userId],
    );
    await audit(req, 'create', 'lesson_learned', res.rows[0]!.id, { project_id: id, category: b.category });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  // Company-wide lessons feed for future intelligence (spec §52)
  app.get('/intelligence/lessons', async (req) => {
    requireScope(req, 'reports', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(
      `SELECT l.*, p.code AS project_code, p.name AS project_name
         FROM lesson_learned l JOIN project p ON p.id = l.project_id
        WHERE l.company_id = $1 ORDER BY l.created_at DESC LIMIT 100`,
      [auth.companyId],
    );
    return { lessons: res.rows };
  });

  // Company Brain — evidence retrieval + deterministic recommendations.
  // This is intentionally provider-free: it turns company history into traceable evidence
  // and rules-based suggestions; an LLM can be layered later without changing the data contract.
  app.get('/intelligence/company-brain', async (req) => {
    requireScope(req, 'ai', 'read');
    const auth = requireAuth(req);
    const q = req.query as { q?: string; project_id?: string };
    const query = q.q?.trim() ?? '';
    const params: unknown[] = [auth.companyId];
    const projectFilter = q.project_id ? ` AND project_id = ${params.push(q.project_id)}` : '';
    const limit = 40;
    const search = query ? ` AND to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,'')) @@ plainto_tsquery('simple',${params.push(query)})` : '';
    const memory = await pool.query(`SELECT id,title,content,kind,project_id,confidence,created_at,'knowledge' AS source
      FROM knowledge_item WHERE company_id=$1${projectFilter}${search} ORDER BY created_at DESC LIMIT ${limit}`, params);
    const lessonParams: unknown[] = [auth.companyId];
    const lessonProject = q.project_id ? ` AND project_id = ${lessonParams.push(q.project_id)}` : '';
    const lessonSearch = query ? ` AND to_tsvector('simple', coalesce(category,'') || ' ' || coalesce(note,'')) @@ plainto_tsquery('simple',${lessonParams.push(query)})` : '';
    const lessons = await pool.query(`SELECT l.id,l.category AS kind,l.note AS content,l.project_id,l.created_at,'lesson' AS source,p.code AS project_code,p.name AS project_name
      FROM lesson_learned l LEFT JOIN project p ON p.id=l.project_id WHERE l.company_id=$1${lessonProject}${lessonSearch} ORDER BY l.created_at DESC LIMIT ${limit}`, lessonParams);
    const incidentParams: unknown[] = [auth.companyId];
    const incidentProject = q.project_id ? ` AND project_id = ${incidentParams.push(q.project_id)}` : '';
    const incidentSearch = query ? ` AND to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'')) @@ plainto_tsquery('simple',${incidentParams.push(query)})` : '';
    const incidents = await pool.query(`SELECT id,title,description,project_id,severity,status,reported_at AS created_at,'incident' AS source
      FROM incident WHERE company_id=$1${incidentProject}${incidentSearch} ORDER BY reported_at DESC LIMIT ${limit}`, incidentParams);
    const evidence = [...memory.rows,...lessons.rows,...incidents.rows].sort((a,b)=>new Date(String(b.created_at)).getTime()-new Date(String(a.created_at)).getTime()).slice(0,60);
    const categoryCounts = new Map<string,number>();
    for(const row of [...lessons.rows,...incidents.rows]){const key=String(row.kind??row.severity??'general');categoryCounts.set(key,(categoryCounts.get(key)??0)+1);}
    const recurring = [...categoryCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([category,count])=>({category,count}));
    const recommendations:string[]=[];
    if(recurring.some(x=>['material_variance','unexpected_cost'].includes(x.category))) recommendations.push('Review material consumption variance and update BOQ waste factors before the next quote.');
    if(recurring.some(x=>['supplier','quality'].includes(x.category))) recommendations.push('Compare supplier and quality lessons before approving the next material purchase.');
    if(recurring.some(x=>['critical','high'].includes(x.category))) recommendations.push('Review repeated high-severity incidents and attach a corrective procedure to Company Memory.');
    if(!evidence.length) recommendations.push('Capture the first lessons, procedures and incident outcomes to build the company knowledge base.');
    return { query, generatedAt:new Date().toISOString(), evidence, recurring, recommendations, mode:'deterministic-evidence' };
  });
  // Audit trail access (spec §41) — audit module scope
  app.get('/audit', async (req) => {
    requireScope(req, 'audit', 'read');
    const auth = requireAuth(req);
    const { entity_type, entity_id, user_id, limit } = req.query as {
      entity_type?: string; entity_id?: string; user_id?: string; limit?: string;
    };
    const params: unknown[] = [auth.companyId];
    let where = `company_id = $1`;
    if (entity_type) { params.push(entity_type); where += ` AND entity_type = $${params.length}`; }
    if (entity_id) { params.push(entity_id); where += ` AND entity_id = $${params.length}::uuid`; }
    if (user_id) { params.push(user_id); where += ` AND user_id = $${params.length}::uuid`; }
    const lim = Math.min(Number(limit ?? 100) || 100, 500);
    const res = await pool.query(
      `SELECT a.*, u.email AS user_email FROM audit_log a LEFT JOIN "user" u ON u.id = a.user_id
        WHERE ${where} ORDER BY a.created_at DESC LIMIT ${lim}`,
      params,
    );
    return { entries: res.rows };
  });
}
