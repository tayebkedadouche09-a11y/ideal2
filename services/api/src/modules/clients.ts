import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { requireScope, assertClientAccess, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';

interface ClientBody {
  name?: string;
  code?: string;
  legal_form?: string;
  nif?: string;
  nis?: string;
  rc?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export function clientRoutes(app: FastifyInstance): void {
  app.get('/clients', async (req) => {
    requireScope(req, 'clients', 'read');
    const auth = requireAuth(req);
    // Portal customers see only linked clients (spec §48)
    if (auth.clientScope !== 'all') {
      const ids = [...auth.clientScope];
      const res = await pool.query(`SELECT * FROM client WHERE company_id = $1 AND id = ANY($2::uuid[]) ORDER BY name`, [auth.companyId, ids]);
      return { clients: res.rows };
    }
    const res = await pool.query(`SELECT * FROM client WHERE company_id = $1 ORDER BY name`, [auth.companyId]);
    return { clients: res.rows };
  });

  app.post('/clients', async (req, reply) => {
    requireScope(req, 'clients', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as ClientBody;
    if (!b.name) throw new HttpError(400, 'name is required');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO client (company_id, name, code, legal_form, nif, nis, rc, address, city, phone, email, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [auth.companyId, b.name, b.code ?? null, b.legal_form ?? null, b.nif ?? null, b.nis ?? null,
       b.rc ?? null, b.address ?? null, b.city ?? null, b.phone ?? null, b.email ?? null, b.notes ?? null],
    );
    const id = res.rows[0]!.id;
    await audit(req, 'create', 'client', id, b);
    return reply.code(201).send({ id });
  });

  app.get('/clients/:id', async (req) => {
    requireScope(req, 'clients', 'read');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const res = await pool.query(`SELECT * FROM client WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
    const client = res.rows[0];
    if (!client) throw new HttpError(404, 'Client not found');
    assertClientAccess(req, id);

    // Complete client history (spec §6)
    const [contracts, quotes, projects, invoices, payments, comms] = await Promise.all([
      pool.query(`SELECT id, number, title, value, status, start_date, end_date FROM contract WHERE client_id = $1 ORDER BY created_at DESC`, [id]),
      pool.query(`SELECT id, number, title, status, total, created_at FROM quote WHERE client_id = $1 ORDER BY created_at DESC`, [id]),
      pool.query(`SELECT id, code, name, status, planned_start, planned_end FROM project WHERE client_id = $1 ORDER BY created_at DESC`, [id]),
      pool.query(`SELECT id, number, status, issue_date, due_date, total FROM invoice WHERE client_id = $1 ORDER BY issue_date DESC`, [id]),
      pool.query(`SELECT id, amount, method, paid_at, reference FROM payment WHERE client_id = $1 ORDER BY paid_at DESC`, [id]),
      pool.query(`SELECT id, kind, direction, subject, occurred_at FROM communication WHERE client_id = $1 ORDER BY occurred_at DESC LIMIT 50`, [id]),
    ]);
    return {
      client,
      contracts: contracts.rows,
      quotes: quotes.rows,
      projects: projects.rows,
      invoices: invoices.rows,
      payments: payments.rows,
      communications: comms.rows,
    };
  });

  app.patch('/clients/:id', async (req) => {
    requireScope(req, 'clients', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertClientAccess(req, id);
    const b = (req.body ?? {}) as ClientBody;

    const prev = await pool.query(`SELECT * FROM client WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
    if (prev.rowCount === 0) throw new HttpError(404, 'Client not found');

    const fields = ['name','code','legal_form','nif','nis','rc','address','city','phone','email','notes'] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const f of fields) {
      if (b[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(b[f]);
      }
    }
    if (sets.length === 0) throw new HttpError(400, 'No fields to update');
    sets.push(`updated_at = now()`);
    vals.push(id, auth.companyId);
    await pool.query(`UPDATE client SET ${sets.join(', ')} WHERE id = $${i++} AND company_id = $${i}`, vals);
    await audit(req, 'update', 'client', id, b, prev.rows[0]);
    return { ok: true };
  });
}
