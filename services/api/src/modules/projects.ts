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

interface MeasurementBody {
  zone?: string;
  zone_id?: string;
  kind?: 'area' | 'rect' | 'volume';
  length_m?: number;
  width_m?: number;
  height_m?: number;
  thickness_mm?: number;
  area_sqm_input?: number;
  product_type?: string;
  notes?: string;
}

interface ConsumptionBody {
  material_id?: string;
  actual_quantity?: number;
  reason_code?: string;
  reason_note?: string;
  /** When omitted, planned is computed from measurements + material_rule. */
  planned_quantity?: number;
  measurement_id?: string;
}

function toMeasurement(b: MeasurementBody): Measurement {
  if (b.kind === 'rect' && b.length_m != null && b.width_m != null) {
    return { kind: 'rect', lengthM: b.length_m, widthM: b.width_m };
  }
  if (b.kind === 'volume' && b.area_sqm_input != null && b.thickness_mm != null) {
    return { kind: 'volume', areaSqm: b.area_sqm_input, thicknessMm: b.thickness_mm };
  }
  if (b.area_sqm_input != null) return { kind: 'area', areaSqm: b.area_sqm_input };
  throw new HttpError(400, 'Invalid measurement payload for kind ' + String(b.kind));
}

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

    const [measurements, tasks, reports, team, consumption, incidents, expenses, docs] = await Promise.all([
      pool.query(`SELECT * FROM project_measurement WHERE project_id = $1 ORDER BY recorded_at DESC`, [id]),
      pool.query(`SELECT * FROM project_task WHERE project_id = $1 ORDER BY planned_start`, [id]),
      pool.query(`SELECT * FROM daily_report WHERE project_id = $1 ORDER BY report_date DESC LIMIT 30`, [id]),
      pool.query(
        `SELECT pm.role_on_project, e.first_name, e.last_name
           FROM project_member pm JOIN employee e ON e.id = pm.employee_id
          WHERE pm.project_id = $1`, [id],
      ),
      pool.query(
        `SELECT c.*, m.name AS material_name, m.unit
           FROM project_material_consumption c JOIN material m ON m.id = c.material_id
          WHERE c.project_id = $1 ORDER BY c.recorded_at DESC`, [id],
      ),
      pool.query(`SELECT * FROM incident WHERE project_id = $1 ORDER BY reported_at DESC`, [id]),
      pool.query(`SELECT * FROM expense WHERE project_id = $1 ORDER BY date DESC`, [id]),
      pool.query(
        `SELECT d.id, d.file_name, d.status, d.classification
           FROM document_link l JOIN document d ON d.id = l.document_id
          WHERE l.entity_type = 'project' AND l.entity_id = $1`, [id],
      ),
    ]);
    // Project 360° in one call (spec §14)
    return { project: res.rows[0], measurements: measurements.rows, tasks: tasks.rows, dailyReports: reports.rows, team: team.rows, consumption: consumption.rows, incidents: incidents.rows, expenses: expenses.rows, documents: docs.rows };
  });

  app.post('/projects/:id/measurements', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as MeasurementBody;
    if (!b.zone || !b.kind) throw new HttpError(400, 'zone and kind are required');

    if (b.zone_id) {
      const z = await pool.query(`SELECT 1 FROM project_zone WHERE id = $1 AND project_id = $2 AND company_id = $3`, [b.zone_id, id, auth.companyId]);
      if (z.rowCount === 0) throw new HttpError(404, 'Zone not found in this project');
    }
    const res = await pool.query<{ id: string }>(
      `INSERT INTO project_measurement
         (company_id, project_id, zone, zone_id, kind, length_m, width_m, height_m, thickness_mm, area_sqm_input, product_type, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [auth.companyId, id, b.zone, b.zone_id ?? null, b.kind, b.length_m ?? null, b.width_m ?? null, b.height_m ?? null,
       b.thickness_mm ?? null, b.area_sqm_input ?? null, b.product_type ?? null, b.notes ?? null, auth.userId],
    );
    await audit(req, 'create', 'project_measurement', res.rows[0]!.id, b);
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.post('/projects/:id/material-consumption', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as ConsumptionBody;
    if (!b.material_id || !b.actual_quantity || b.actual_quantity <= 0) {
      throw new HttpError(400, 'material_id and positive actual_quantity are required');
    }
    const actualQuantity: number = b.actual_quantity;

    const result = await tx(async (c) => {
      // Material + rule (rules are data, spec §19)
      const matRes = await c.query<{ id: string; unit: string }>(
        `SELECT id, unit FROM material WHERE id = $1 AND company_id = $2`, [b.material_id, auth.companyId],
      );
      const material = matRes.rows[0];
      if (!material) throw new HttpError(404, 'Material not found');

      let planned = b.planned_quantity ?? null;
      if (planned == null) {
        const [measRes, ruleRes] = await Promise.all([
          c.query(`SELECT kind, length_m, width_m, thickness_mm, area_sqm_input FROM project_measurement WHERE project_id = $1 AND company_id = $2`, [id, auth.companyId]),
          c.query<{ coverage_rate: string; coverage_unit: string; number_of_layers: number; loss_percent: string; reference_thickness_mm: string }>(
            `SELECT coverage_rate, coverage_unit, number_of_layers, loss_percent, reference_thickness_mm
               FROM material_rule WHERE material_id = $1 AND company_id = $2 ORDER BY valid_from DESC NULLS LAST LIMIT 1`,
            [b.material_id, auth.companyId],
          ),
        ]);
        const rule = ruleRes.rows[0];
        if (rule) {
          const technical: TechnicalRule = {
            coverageRatePerLayer: Number(rule.coverage_rate),
            coverageUnit: rule.coverage_unit as 'kg_per_m2' | 'l_per_m2',
            numberOfLayers: rule.number_of_layers,
            lossPercent: Number(rule.loss_percent),
            referenceThicknessMm: Number(rule.reference_thickness_mm),
          };
          const measurements: Measurement[] = measRes.rows.map((r) =>
            toMeasurement({ kind: r.kind, length_m: r.length_m == null ? undefined : Number(r.length_m), width_m: r.width_m == null ? undefined : Number(r.width_m), thickness_mm: r.thickness_mm == null ? undefined : Number(r.thickness_mm), area_sqm_input: r.area_sqm_input == null ? undefined : Number(r.area_sqm_input) }),
          );
          if (measurements.length > 0) {
            planned = calculateProjectRequirement(measurements, technical).totalQuantity;
          }
        }
      }

      const variance = consumptionVariance(planned ?? actualQuantity, actualQuantity);

      const insRes = await c.query<{ id: string }>(
        `INSERT INTO project_material_consumption
           (company_id, project_id, material_id, measurement_id, planned_quantity, actual_quantity, reason_code, reason_note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [auth.companyId, id, b.material_id, b.measurement_id ?? null, planned, actualQuantity,
         variance.abnormal ? (b.reason_code ?? 'unexplained') : (b.reason_code ?? null), b.reason_note ?? null, auth.userId],
      );

      // Consumption immediately reduces physical stock (spec §22, §61)
      const upd = await c.query<{ physical: string }>(
        `UPDATE stock_level SET physical = physical - $3
          WHERE material_id = $1 AND location_id IS NOT NULL
            AND company_id = $2 AND physical >= $3
         RETURNING physical`,
        [b.material_id, auth.companyId, b.actual_quantity],
      );
      if (upd.rowCount === 0) {
        throw new HttpError(409, 'Insufficient physical stock in any location');
      }
      await c.query(
        `INSERT INTO stock_movement (company_id, material_id, location_id, kind, quantity, project_id, reason, created_by)
         SELECT company_id, material_id, NULL, 'consumption', $3, $4, 'project consumption', $5
           FROM project_material_consumption WHERE id = $1 AND company_id = $2`,
        [insRes.rows[0]!.id, auth.companyId, actualQuantity, id, auth.userId],
      );
      return { id: insRes.rows[0]!.id, planned, variance };
    });

    await audit(req, 'create', 'project_material_consumption', result.id, { ...b, variance: result.variance });
    return reply.code(201).send(result);
  });

  // --- Project 360 sub-resources ---
  app.post('/projects/:id/tasks', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { title?: string; description?: string; planned_start?: string; planned_end?: string; assignee_employee_id?: string };
    if (!b.title) throw new HttpError(400, 'title is required');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO project_task (project_id, title, description, planned_start, planned_end, assignee_employee_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [id, b.title, b.description ?? null, b.planned_start ?? null, b.planned_end ?? null, b.assignee_employee_id ?? null],
    );
    await audit(req, 'create', 'project_task', res.rows[0]!.id, { project_id: id, title: b.title });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.patch('/projects/:id/tasks/:taskId', async (req) => {
    requireScope(req, 'projects', 'write');
    const { id, taskId } = req.params as { id: string; taskId: string };
    assertProjectAccess(req, id);
    const b = (req.body ?? {}) as { status?: string; title?: string; description?: string };
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const f of ['title', 'description'] as const) {
      if (b[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(b[f]); }
    }
    if (b.status) {
      if (!['todo', 'in_progress', 'blocked', 'done'].includes(b.status)) throw new HttpError(400, 'Invalid status');
      sets.push(`status = $${i++}::project_task_status`); vals.push(b.status);
    }
    if (sets.length === 0) throw new HttpError(400, 'No fields to update');
    vals.push(taskId, id);
    const res = await pool.query(`UPDATE project_task SET ${sets.join(', ')} WHERE id = $${i++} AND project_id = $${i} RETURNING id`, vals);
    if (res.rowCount === 0) throw new HttpError(404, 'Task not found');
    await audit(req, 'update', 'project_task', taskId, b);
    return { ok: true };
  });

  app.post('/projects/:id/team', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { employee_id?: string; user_id?: string; role_on_project?: string };
    if (!b.employee_id || !b.role_on_project) throw new HttpError(400, 'employee_id and role_on_project are required');
    const res = await pool.query(
      `INSERT INTO project_member (project_id, employee_id, user_id, role_on_project)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (project_id, employee_id) DO UPDATE SET role_on_project = $4, user_id = $3`,
      [id, b.employee_id, b.user_id ?? null, b.role_on_project],
    );
    await audit(req, 'create', 'project_member', id, b);
    return reply.code(201).send({ ok: true, rows: res.rowCount });
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
    const b = (req.body ?? {}) as {
      title?: string; description?: string; severity?: string;
      zone_id?: string; document_id?: string; latitude?: number; longitude?: number;
    };
    if (!b.title) throw new HttpError(400, 'title is required');
    if (b.severity && !['low', 'medium', 'high', 'critical'].includes(b.severity)) throw new HttpError(400, 'Invalid severity');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO incident (company_id, project_id, severity, title, description, reported_by, zone_id, document_id, latitude, longitude)
       VALUES ($1,$2,$3::incident_severity,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [auth.companyId, id, (b.severity ?? 'medium'), b.title, b.description ?? null, auth.userId,
       b.zone_id ?? null, b.document_id ?? null, b.latitude ?? null, b.longitude ?? null],
    );
    // Real notification record (spec §58) — surfaced in GET /notifications
    await pool.query(
      `INSERT INTO notification (company_id, kind, severity, title, body, entity_type, entity_id)
       VALUES ($1, 'incident', $3, $4, $5, 'incident', $6)`,
      [auth.companyId, id, (b.severity ?? 'medium'), `Incident: ${b.title}`, b.description ?? null, res.rows[0]!.id],
    );
    await audit(req, 'create', 'incident', res.rows[0]!.id, { project_id: id, title: b.title, severity: b.severity });
    // Automation hook (spec §44): incident events can drive notify/task rules
    void emitAutomationEvent(req, {
      trigger_type: 'incident_created',
      severity: b.severity ?? 'medium',
      entity_type: 'incident',
      entity_id: res.rows[0]!.id,
      project_id: id,
      title: `Incident: ${b.title}`,
      body: b.description ?? undefined,
    });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.get('/projects/:id/timeline', async (req) => {
    requireScope(req, 'projects', 'read');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const proj = await pool.query(`SELECT * FROM project WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
    if (proj.rowCount === 0) throw new HttpError(404, 'Project not found');
    const [tasks, milestones, reports, invoices] = await Promise.all([
      pool.query(`SELECT id, title, status, planned_start, planned_end FROM project_task WHERE project_id = $1 ORDER BY planned_start NULLS LAST`, [id]),
      pool.query(`SELECT id, title, due_date, completed_at FROM project_milestone WHERE project_id = $1 ORDER BY due_date NULLS LAST`, [id]),
      pool.query(`SELECT id, report_date, work_performed, manpower_count FROM daily_report WHERE project_id = $1 ORDER BY report_date DESC LIMIT 60`, [id]),
      pool.query(`SELECT id, number, status, issue_date, total FROM invoice WHERE project_id = $1 ORDER BY issue_date`, [id]),
    ]);
    return {
      project: { id, status: proj.rows[0]!.status, planned_start: proj.rows[0]!.planned_start, planned_end: proj.rows[0]!.planned_end, actual_start: proj.rows[0]!.actual_start, actual_end: proj.rows[0]!.actual_end },
      tasks: tasks.rows, milestones: milestones.rows, dailyReports: reports.rows, invoices: invoices.rows,
    };
  });

  app.get('/projects/:id/profitability', async (req) => {
    requireScope(req, 'projects', 'read');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);

    const projRes = await pool.query(`SELECT * FROM project WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
    const project = projRes.rows[0];
    if (!project) throw new HttpError(404, 'Project not found');

    // Actual cost assembled from operational truth (spec §49)
    const [matRes, laborRes, fuelRes, expenseRes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(c.actual_quantity * COALESCE(m.purchase_price, 0)), 0) AS cost
           FROM project_material_consumption c JOIN material m ON m.id = c.material_id
          WHERE c.project_id = $1`, [id],
      ),
      pool.query(
        `SELECT COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600, 0) * COALESCE(e.hourly_cost, 0)), 0) AS cost
           FROM work_log w JOIN employee e ON e.id = w.employee_id
          WHERE w.project_id = $1 AND w.start_time IS NOT NULL AND w.end_time IS NOT NULL`, [id],
      ),
      pool.query(`SELECT COALESCE(SUM(quantity_l * price_per_l), 0) AS cost FROM fuel_log WHERE project_id = $1`, [id]),
      pool.query(`SELECT COALESCE(SUM(amount), 0) AS cost FROM expense WHERE project_id = $1`, [id]),
    ]);

    const num = (v: unknown): number => Number(v ?? 0);
    const profitability = projectProfitability({
      revenue: num(project.contract_value),
      planned: {
        materials: num(project.budget_materials), labor: num(project.budget_labor),
        transport: num(project.budget_transport), vehicles: num(project.budget_vehicles),
        equipment: num(project.budget_equipment), subcontracting: num(project.budget_subcontracting),
        other: num(project.budget_other),
      },
      actual: {
        materials: num(matRes.rows[0]?.cost), labor: num(laborRes.rows[0]?.cost),
        fuel: num(fuelRes.rows[0]?.cost), vehicleCosts: 0,
        equipment: 0, subcontracting: 0, otherExpenses: num(expenseRes.rows[0]?.cost),
      },
    });
    return { profitability };
  });

  // ---------- Engineering: zones (spec §9, §67) ----------

  app.get('/projects/:id/zones', async (req) => {
    requireScope(req, 'projects', 'read');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const res = await pool.query(
      `SELECT z.*,
              (SELECT count(*) FROM project_measurement pm WHERE pm.zone_id = z.id) AS measurement_count,
              (SELECT COALESCE(SUM(pm.area_sqm), 0) FROM project_measurement pm WHERE pm.zone_id = z.id) AS measured_area_sqm
         FROM project_zone z WHERE z.project_id = $1 ORDER BY z.created_at`, [id],
    );
    return { zones: res.rows };
  });

  app.post('/projects/:id/zones', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { name?: string; description?: string; area_sqm?: number; status?: string };
    if (!b.name) throw new HttpError(400, 'name is required');
    if (b.status && !['planned', 'in_progress', 'completed', 'blocked'].includes(b.status)) {
      throw new HttpError(400, 'Invalid status');
    }
    const res = await pool.query<{ id: string }>(
      `INSERT INTO project_zone (company_id, project_id, name, description, area_sqm, status)
       VALUES ($1,$2,$3,$4,$5,$6::zone_status) RETURNING id`,
      [auth.companyId, id, b.name, b.description ?? null, b.area_sqm ?? null, b.status ?? 'planned'],
    );
    await audit(req, 'create', 'project_zone', res.rows[0]!.id, { project_id: id, name: b.name });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  // BOQ per zone: waste-aware quantities via the domain engine (spec §65),
  // planned totals roll up to the project (single source of truth, spec §7).
  app.get('/projects/:id/boq', async (req) => {
    requireScope(req, 'projects', 'read');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const res = await pool.query(
      `SELECT l.*, z.name AS zone_name FROM zone_boq_line l
         JOIN project_zone z ON z.id = l.zone_id
        WHERE z.project_id = $1 ORDER BY z.name, l.position, l.created_at`, [id],
    );
    const totals = computeBoqTotals(res.rows.map((r) => ({
      kind: String(r.kind), quantity: Number(r.quantity), unit_price: Number(r.unit_price),
      waste_factor_percent: r.waste_factor_percent == null ? null : Number(r.waste_factor_percent),
      discount_percent: r.discount_percent == null ? null : Number(r.discount_percent),
    })));
    return { lines: res.rows, totals };
  });

  app.post('/projects/:id/boq', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as {
      zone_id?: string; kind?: string; description?: string; quantity?: number; unit?: string;
      unit_price?: number; waste_factor_percent?: number; discount_percent?: number; material_id?: string;
    };
    if (!b.zone_id || !b.kind || !b.description || !b.quantity || b.quantity <= 0) {
      throw new HttpError(400, 'zone_id, kind, description and positive quantity are required');
    }
    const z = await pool.query(`SELECT id FROM project_zone WHERE id = $1 AND project_id = $2 AND company_id = $3`, [b.zone_id, id, auth.companyId]);
    if (z.rowCount === 0) throw new HttpError(404, 'Zone not found in this project');
    if (b.material_id) {
      const m = await pool.query(`SELECT 1 FROM material WHERE id = $1 AND company_id = $2`, [b.material_id, auth.companyId]);
      if (m.rowCount === 0) throw new HttpError(404, 'Material not found');
    }
    const pos = await pool.query<{ n: string }>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS n FROM zone_boq_line WHERE zone_id = $1`, [b.zone_id],
    );
    const totals = computeBoqTotals([{
      kind: b.kind, quantity: b.quantity, unit_price: Number(b.unit_price) || 0,
      waste_factor_percent: b.waste_factor_percent ?? null, discount_percent: null,
    }]);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO zone_boq_line
         (company_id, zone_id, kind, description, quantity, unit, unit_price, waste_factor_percent, discount_percent, material_id, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, quantity, unit_price, waste_factor_percent, discount_percent, kind`,
      [auth.companyId, b.zone_id, b.kind, b.description, b.quantity, b.unit ?? null, Number(b.unit_price) || 0,
       b.waste_factor_percent ?? 0, 0, b.material_id ?? null, Number(pos.rows[0]!.n)],
    );
    await audit(req, 'create', 'zone_boq_line', res.rows[0]!.id, { project_id: id, zone_id: b.zone_id, kind: b.kind, quantity: b.quantity });
    return reply.code(201).send({ id: res.rows[0]!.id, line_total: totals.lines[0]!.line_total, quantity_with_waste: totals.lines[0]!.quantity_with_waste });
  });
}
