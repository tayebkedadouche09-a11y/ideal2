import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { requireScope, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';

interface SupplierBody {
  name?: string; code?: string; nif?: string; address?: string; city?: string;
  phone?: string; email?: string; lead_time_days?: number; notes?: string;
}

export function orgRoutes(app: FastifyInstance): void {
  app.get('/suppliers', async (req) => {
    requireScope(req, 'suppliers', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(`SELECT * FROM supplier WHERE company_id = $1 ORDER BY name`, [auth.companyId]);
    return { suppliers: res.rows };
  });

  app.post('/suppliers', async (req, reply) => {
    requireScope(req, 'suppliers', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as SupplierBody;
    if (!b.name) throw new HttpError(400, 'name is required');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO supplier (company_id, name, code, nif, address, city, phone, email, lead_time_days, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [auth.companyId, b.name, b.code ?? null, b.nif ?? null, b.address ?? null, b.city ?? null,
       b.phone ?? null, b.email ?? null, b.lead_time_days ?? null, b.notes ?? null],
    );
    await audit(req, 'create', 'supplier', res.rows[0]!.id, b);
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.patch('/suppliers/:id', async (req) => {
    requireScope(req, 'suppliers', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as SupplierBody;
    const fields = ['name', 'code', 'nif', 'address', 'city', 'phone', 'email', 'lead_time_days', 'notes'] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const f of fields) {
      if ((b as Record<string, unknown>)[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push((b as Record<string, unknown>)[f]); }
    }
    if (sets.length === 0) throw new HttpError(400, 'No fields to update');
    vals.push(id, auth.companyId);
    const res = await pool.query(`UPDATE supplier SET ${sets.join(', ')} WHERE id = $${i++} AND company_id = $${i} RETURNING id`, vals);
    if (res.rowCount === 0) throw new HttpError(404, 'Supplier not found');
    await audit(req, 'update', 'supplier', id, b);
    return { ok: true };
  });

  app.get('/stock-locations', async (req) => {
    requireScope(req, 'stock', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(`SELECT * FROM stock_location WHERE company_id = $1 ORDER BY name`, [auth.companyId]);
    return { locations: res.rows };
  });

  app.post('/stock-locations', async (req, reply) => {
    requireScope(req, 'stock', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { name?: string; kind?: string };
    if (!b.name) throw new HttpError(400, 'name is required');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO stock_location (company_id, name, kind) VALUES ($1,$2,COALESCE($3,'warehouse')) RETURNING id`,
      [auth.companyId, b.name, b.kind ?? null],
    );
    await audit(req, 'create', 'stock_location', res.rows[0]!.id, b);
    return reply.code(201).send({ id: res.rows[0]!.id });
  });
}
