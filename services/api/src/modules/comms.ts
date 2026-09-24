import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { requireScope, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';

export function commsRoutes(app: FastifyInstance): void {
  app.get('/communications', async (req) => {
    requireScope(req, 'communications', 'read');
    const auth = requireAuth(req);
    const { client_id, project_id } = req.query as { client_id?: string; project_id?: string };
    const params: unknown[] = [auth.companyId];
    let where = `company_id = $1`;
    if (client_id) { params.push(client_id); where += ` AND client_id = $${params.length}::uuid`; }
    if (project_id) { params.push(project_id); where += ` AND project_id = $${params.length}::uuid`; }
    const res = await pool.query(`SELECT * FROM communication WHERE ${where} ORDER BY occurred_at DESC LIMIT 200`, params);
    return { communications: res.rows };
  });

  app.post('/communications', async (req, reply) => {
    requireScope(req, 'communications', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as {
      kind?: string; direction?: string; subject?: string; body?: string;
      client_id?: string; project_id?: string; contract_id?: string; invoice_id?: string;
    };
    if (!b.kind || !['email', 'note', 'call', 'letter', 'portal_message'].includes(b.kind)) {
      throw new HttpError(400, 'kind must be email|note|call|letter|portal_message');
    }
    const res = await pool.query<{ id: string }>(
      `INSERT INTO communication (company_id, kind, direction, subject, body, client_id, project_id, contract_id, invoice_id, created_by)
       VALUES ($1,$2::communication_kind,$3::communication_direction,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [auth.companyId, b.kind, (b.direction ?? 'outbound'), b.subject ?? null, b.body ?? null,
       b.client_id ?? null, b.project_id ?? null, b.contract_id ?? null, b.invoice_id ?? null, auth.userId],
    );
    await audit(req, 'create', 'communication', res.rows[0]!.id, { kind: b.kind, subject: b.subject });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  // Notification center — records created by real triggers (payments, incidents,
  // stock movements, maintenance) plus manual entries. Per-user view.
  app.get('/notifications', async (req) => {
    const auth = requireAuth(req);
    const res = await pool.query(
      `SELECT * FROM notification
        WHERE company_id = $1 AND (user_id IS NULL OR user_id = $2)
        ORDER BY created_at DESC LIMIT 100`,
      [auth.companyId, auth.userId],
    );
    return { notifications: res.rows };
  });

  app.post('/notifications/:id/read', async (req) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const res = await pool.query(
      `UPDATE notification SET read_at = now()
        WHERE id = $1 AND company_id = $2 AND (user_id IS NULL OR user_id = $2)`,
      [id, auth.companyId],
    );
    if (res.rowCount === 0) throw new HttpError(404, 'Notification not found');
    return { ok: true };
  });

  // Real trigger evaluation: creates notifications from operational state.
  // Intended for cron/n8n via service account; also callable by owner.
  app.post('/notifications/evaluate', async (req) => {
    requireScope(req, 'dashboard', 'read');
    const auth = requireAuth(req);
    const created: string[] = [];

    // 1. Overdue invoices (spec §58)
    const overdue = await pool.query<{ id: string; number: string; due_date: Date }>(
      `SELECT id, number, due_date FROM invoice
        WHERE company_id = $1 AND status IN ('issued','partially_paid') AND due_date < CURRENT_DATE`,
      [auth.companyId],
    );
    for (const inv of overdue.rows) {
      const dup = await pool.query(
        `SELECT 1 FROM notification WHERE company_id = $1 AND kind = 'overdue_invoice'
           AND entity_id = $2 AND created_at > now() - interval '7 days'`,
        [auth.companyId, inv.id],
      );
      if (dup.rowCount === 0) {
        const ins = await pool.query<{ id: string }>(
          `INSERT INTO notification (company_id, kind, severity, title, body, entity_type, entity_id)
           VALUES ($1,'overdue_invoice','warning',$2,$3,'invoice',$4) RETURNING id`,
          [auth.companyId, `Facture en retard: ${inv.number}`, `Échéance dépassée depuis le ${new Date(inv.due_date).toLocaleDateString('fr-FR')}`, inv.id],
        );
        created.push(ins.rows[0]!.id);
      }
    }

    // 2. Low stock (spec §58)
    const low = await pool.query<{ material_id: string; name: string; physical: string; min_stock: string; unit: string }>(
      `SELECT m.id AS material_id, m.name, sl.physical, m.min_stock, m.unit
         FROM stock_level sl JOIN material m ON m.id = sl.material_id
        WHERE sl.company_id = $1 AND sl.physical <= m.min_stock`,
      [auth.companyId],
    );
    for (const m of low.rows) {
      const dup = await pool.query(
        `SELECT 1 FROM notification WHERE company_id = $1 AND kind = 'low_stock'
           AND entity_id = $2 AND created_at > now() - interval '3 days'`,
        [auth.companyId, m.material_id],
      );
      if (dup.rowCount === 0) {
        const ins = await pool.query<{ id: string }>(
          `INSERT INTO notification (company_id, kind, severity, title, body, entity_type, entity_id)
           VALUES ($1,'low_stock','warning',$2,$3,'material',$4) RETURNING id`,
          [auth.companyId, `Stock bas: ${m.name}`, `${m.physical} ${m.unit} restants (seuil ${m.min_stock})`, m.material_id],
        );
        created.push(ins.rows[0]!.id);
      }
    }

    // 3. Maintenance due (spec §58)
    const due = await pool.query<{ vehicle_id: string; registration: string; next_due_date: Date }>(
      `SELECT v.id AS vehicle_id, v.registration, mt.next_due_date
         FROM maintenance mt JOIN vehicle v ON v.id = mt.vehicle_id
        WHERE mt.company_id = $1 AND mt.next_due_date IS NOT NULL
          AND mt.next_due_date <= CURRENT_DATE + INTERVAL '14 days'`,
      [auth.companyId],
    );
    for (const v of due.rows) {
      const dup = await pool.query(
        `SELECT 1 FROM notification WHERE company_id = $1 AND kind = 'maintenance'
           AND entity_id = $2 AND created_at > now() - interval '7 days'`,
        [auth.companyId, v.vehicle_id],
      );
      if (dup.rowCount === 0) {
        const ins = await pool.query<{ id: string }>(
          `INSERT INTO notification (company_id, kind, severity, title, body, entity_type, entity_id)
           VALUES ($1,'maintenance','info',$2,$3,'vehicle',$4) RETURNING id`,
          [auth.companyId, `Entretien à prévoir: ${v.registration}`, `Échéance: ${new Date(v.next_due_date).toLocaleDateString('fr-FR')}`, v.vehicle_id],
        );
        created.push(ins.rows[0]!.id);
      }
    }

    // 4. Delayed projects
    const delayed = await pool.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM project
        WHERE company_id = $1 AND delayed = true AND status = 'in_progress'`,
      [auth.companyId],
    );
    for (const p of delayed.rows) {
      const dup = await pool.query(
        `SELECT 1 FROM notification WHERE company_id = $1 AND kind = 'delay'
           AND entity_id = $2 AND created_at > now() - interval '7 days'`,
        [auth.companyId, p.id],
      );
      if (dup.rowCount === 0) {
        const ins = await pool.query<{ id: string }>(
          `INSERT INTO notification (company_id, kind, severity, title, body, entity_type, entity_id)
           VALUES ($1,'delay','warning',$2,$3,'project',$4) RETURNING id`,
          [auth.companyId, `Chantier en retard: ${p.code}`, p.name, p.id],
        );
        created.push(ins.rows[0]!.id);
      }
    }

    await audit(req, 'export', 'notification', null, { created: created.length });
    return { created: created.length, ids: created };
  });
}
