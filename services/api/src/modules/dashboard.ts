import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { requireScope } from '../auth/rbac.js';
import { requireAuth } from '../auth/context.js';

export function dashboardRoutes(app: FastifyInstance): void {
  app.get('/dashboard', async (req) => {
    requireScope(req, 'dashboard', 'read');
    const auth = requireAuth(req);
    const cid = auth.companyId;

    const [projects, delayed, invoices, stockAlerts, maintenanceDue, attendanceToday, incidents] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*)::int AS count FROM project WHERE company_id = $1 GROUP BY status`, [cid],
      ),
      pool.query(
        `SELECT id, code, name, planned_end FROM project
          WHERE company_id = $1 AND delayed = true AND status = 'in_progress'
          ORDER BY planned_end LIMIT 10`, [cid],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0) AS amount
           FROM invoice WHERE company_id = $1 AND status IN ('issued','partially_paid','overdue')`, [cid],
      ),
      pool.query(
        `SELECT m.name, sl.physical, m.min_stock, m.unit
           FROM stock_level sl JOIN material m ON m.id = sl.material_id
          WHERE sl.company_id = $1 AND sl.physical <= m.min_stock
          ORDER BY sl.physical / NULLIF(m.min_stock, 0) LIMIT 10`, [cid],
      ),
      pool.query(
        `SELECT v.registration, mt.next_due_date FROM maintenance mt
           JOIN vehicle v ON v.id = mt.vehicle_id
          WHERE mt.company_id = $1 AND mt.next_due_date IS NOT NULL
            AND mt.next_due_date <= CURRENT_DATE + INTERVAL '14 days'
          ORDER BY mt.next_due_date LIMIT 10`, [cid],
      ),
      pool.query(
        `SELECT kind, COUNT(*)::int AS count FROM attendance
          WHERE company_id = $1 AND date = CURRENT_DATE GROUP BY kind`, [cid],
      ),
      pool.query(
        `SELECT id, title, severity, reported_at FROM incident
          WHERE company_id = $1 AND status IN ('open','investigating')
          ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
          LIMIT 10`, [cid],
      ),
    ]);

    return {
      projectsByStatus: projects.rows,
      delayedProjects: delayed.rows,
      unpaidInvoices: invoices.rows[0],
      stockAlerts: stockAlerts.rows,
      maintenanceDue: maintenanceDue.rows,
      attendanceToday: attendanceToday.rows,
      openIncidents: incidents.rows,
    };
  });

  app.get('/dashboard/daily-briefing', async (req) => {
    requireScope(req, 'dashboard', 'read');
    const auth = requireAuth(req);
    const cid = auth.companyId;

    // Evidence-based briefing (spec §5): every line cites a query result,
    // no invention, no fabricated causes.
    const [active, delayed, attention, stock, fleet, finance] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM project WHERE company_id = $1 AND status = 'in_progress'`, [cid]),
      pool.query(`SELECT code, name FROM project WHERE company_id = $1 AND delayed = true AND status = 'in_progress'`, [cid]),
      pool.query(
        `SELECT code, name FROM project WHERE company_id = $1 AND status = 'in_progress'
           AND (planned_end < CURRENT_DATE OR delayed = true) LIMIT 5`, [cid],
      ),
      pool.query(
        `SELECT m.name, m.unit, sl.physical, m.min_stock,
                GREATEST(CEIL((sl.physical - m.min_stock) / GREATEST(
                  (SELECT COALESCE(AVG(ABS(sm.quantity)), 1) FROM stock_movement sm
                    WHERE sm.material_id = m.id AND sm.kind = 'exit' AND sm.created_at > now() - interval '30 days'), 1)), 0) AS days_left
           FROM stock_level sl JOIN material m ON m.id = sl.material_id
          WHERE sl.company_id = $1 AND sl.physical <= m.min_stock * 3`, [cid],
      ),
      pool.query(
        `SELECT v.registration, mt.next_due_date FROM maintenance mt
           JOIN vehicle v ON v.id = mt.vehicle_id
          WHERE mt.company_id = $1 AND mt.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`, [cid],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS overdue, COALESCE(SUM(total), 0) AS amount FROM invoice
          WHERE company_id = $1 AND status = 'overdue'`, [cid],
      ),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      projects: { active: active.rows[0]?.n ?? 0, delayed: delayed.rows, requiringAttention: attention.rows },
      stock: stock.rows,
      fleet: fleet.rows,
      finance: { overdueInvoices: finance.rows[0]?.overdue ?? 0, overdueAmount: finance.rows[0]?.amount ?? 0 },
      note: 'All figures are observed facts from operational data. No inferred causes are included.',
    };
  });
}
