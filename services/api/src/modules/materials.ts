import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { requireScope, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';

const CATEGORIES = new Set(['resin', 'hardener', 'primer', 'quartz', 'pigment', 'solvent', 'ppe', 'consumable', 'other']);

interface MaterialBody {
  sku?: string; name?: string; category?: string; unit?: string;
  purchase_price?: number; min_stock?: number; max_stock?: number;
  default_supplier_id?: string; shelf_life_days?: number; requires_batch?: boolean; active?: boolean;
}

export function materialRoutes(app: FastifyInstance): void {
  app.get('/materials', async (req) => {
    requireScope(req, 'stock', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(`SELECT * FROM material WHERE company_id = $1 ORDER BY name`, [auth.companyId]);
    return { materials: res.rows };
  });

  app.post('/materials', async (req, reply) => {
    requireScope(req, 'stock', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as MaterialBody;
    if (!b.sku || !b.name || !b.category || !b.unit) throw new HttpError(400, 'sku, name, category, unit are required');
    if (!CATEGORIES.has(b.category)) throw new HttpError(400, `category must be one of ${[...CATEGORIES].join(', ')}`);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO material (company_id, sku, name, category, unit, purchase_price, min_stock, max_stock, default_supplier_id, shelf_life_days, requires_batch)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [auth.companyId, b.sku, b.name, b.category, b.unit, b.purchase_price ?? null, b.min_stock ?? 0,
       b.max_stock ?? null, b.default_supplier_id ?? null, b.shelf_life_days ?? null, b.requires_batch ?? false],
    );
    await audit(req, 'create', 'material', res.rows[0]!.id, b);
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.patch('/materials/:id', async (req) => {
    requireScope(req, 'stock', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as MaterialBody;
    const fields = ['name', 'category', 'unit', 'purchase_price', 'min_stock', 'max_stock', 'default_supplier_id', 'shelf_life_days', 'requires_batch', 'active'] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const f of fields) {
      if ((b as Record<string, unknown>)[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push((b as Record<string, unknown>)[f]); }
    }
    if (sets.length === 0) throw new HttpError(400, 'No fields to update');
    vals.push(id, auth.companyId);
    const res = await pool.query(`UPDATE material SET ${sets.join(', ')} WHERE id = $${i++} AND company_id = $${i} RETURNING id`, vals);
    if (res.rowCount === 0) throw new HttpError(404, 'Material not found');
    await audit(req, 'update', 'material', id, b);
    return { ok: true };
  });

  app.get('/materials/:id/rules', async (req) => {
    requireScope(req, 'stock', 'read');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const res = await pool.query(
      `SELECT * FROM material_rule WHERE material_id = $1 AND company_id = $2 ORDER BY valid_from DESC NULLS LAST`,
      [id, auth.companyId],
    );
    return { rules: res.rows };
  });

  app.post('/materials/:id/rules', async (req, reply) => {
    requireScope(req, 'stock', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as {
      product_type?: string; coverage_rate?: number; coverage_unit?: string;
      number_of_layers?: number; loss_percent?: number; reference_thickness_mm?: number; valid_from?: string;
    };
    if (!b.product_type || !b.coverage_rate || !b.coverage_unit) {
      throw new HttpError(400, 'product_type, coverage_rate, coverage_unit are required');
    }
    if (!['kg_per_m2', 'l_per_m2'].includes(b.coverage_unit)) throw new HttpError(400, 'coverage_unit must be kg_per_m2 or l_per_m2');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO material_rule (company_id, material_id, product_type, coverage_rate, coverage_unit, number_of_layers, loss_percent, reference_thickness_mm, valid_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [auth.companyId, id, b.product_type, b.coverage_rate, b.coverage_unit,
       b.number_of_layers ?? 1, b.loss_percent ?? 0, b.reference_thickness_mm ?? 0, b.valid_from ?? null],
    );
    await audit(req, 'create', 'material_rule', res.rows[0]!.id, b);
    return reply.code(201).send({ id: res.rows[0]!.id });
  });
}
