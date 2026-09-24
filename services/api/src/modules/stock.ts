import type { FastifyInstance } from 'fastify';
import { pool, tx } from '../db.js';
import { requireScope, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';
import { availableStock } from '@company-os/domain';
import { emitAutomationEvent } from './automation.js';

interface MovementBody {
  material_id?: string;
  location_id?: string;
  kind?: 'entry' | 'exit' | 'transfer' | 'adjustment';
  quantity?: number;
  batch_number?: string;
  expiry_date?: string;
  reason?: string;
  unit_cost?: number;
}

interface ReservationBody {
  material_id?: string;
  quantity?: number;
}

export function stockRoutes(app: FastifyInstance): void {
  app.get('/stock', async (req) => {
    requireScope(req, 'stock', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(
      `SELECT sl.material_id, sl.location_id, m.sku, m.name, m.unit, m.min_stock, m.max_stock,
              sl.physical, sl.reserved, (sl.physical - sl.reserved) AS available,
              l.name AS location_name
         FROM stock_level sl
         JOIN material m ON m.id = sl.material_id
         LEFT JOIN stock_location l ON l.id = sl.location_id
        WHERE sl.company_id = $1
        ORDER BY m.name`,
      [auth.companyId],
    );
    // Alerts: at/below minimum threshold (spec §22, §58)
    const alerts = res.rows
      .filter((r) => Number(r.physical) <= Number(r.min_stock))
      .map((r) => ({ material_id: r.material_id, name: r.name, physical: r.physical, min_stock: r.min_stock }));
    // Automation events from real state (spec §44) — dedup handled inside
    for (const a of alerts) {
      void emitAutomationEvent(req, {
        trigger_type: 'stock_low',
        severity: Number(a.physical) === 0 ? 'critical' : 'warning',
        entity_type: 'material',
        entity_id: a.material_id,
        material_id: a.material_id,
        title: `Stock bas: ${a.name}`,
        body: `${a.physical} restants (seuil ${a.min_stock}).`,
        quantity: Number(a.physical),
      });
    }
    return { levels: res.rows, alerts };
  });

  app.post('/stock/movements', async (req, reply) => {
    requireScope(req, 'stock', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as MovementBody;
    if (!b.material_id || !b.kind || !b.quantity || b.quantity <= 0) {
      throw new HttpError(400, 'material_id, kind and positive quantity are required');
    }
    if (b.kind === 'entry' && !b.location_id) {
      throw new HttpError(400, 'location_id is required for entries');
    }

    const result = await tx(async (c) => {
      // Upsert physical level
      if (b.kind === 'entry') {
        await c.query(
          `INSERT INTO stock_level (material_id, location_id, company_id, physical, reserved)
           VALUES ($1,$2,$3,$4,0)
           ON CONFLICT (material_id, location_id)
           DO UPDATE SET physical = stock_level.physical + $4`,
          [b.material_id, b.location_id, auth.companyId, b.quantity],
        );
      } else {
        // exit / transfer / adjustment out
        const dec = await c.query<{ physical: string }>(
          `UPDATE stock_level SET physical = physical - $4
            WHERE material_id = $1 AND location_id = $2 AND company_id = $3 AND physical >= $4
           RETURNING physical`,
          [b.material_id, b.location_id, auth.companyId, b.quantity],
        );
        if (dec.rowCount === 0) throw new HttpError(409, 'Insufficient physical stock');
      }

      const mv = await c.query<{ id: string }>(
        `INSERT INTO stock_movement (company_id, material_id, location_id, kind, quantity, batch_number, expiry_date, reason, unit_cost, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [auth.companyId, b.material_id, b.location_id ?? null, b.kind, b.quantity, b.batch_number ?? null,
         b.expiry_date ?? null, b.reason ?? null, b.unit_cost ?? null, auth.userId],
      );
      return mv.rows[0]!.id;
    });

    await audit(req, 'create', 'stock_movement', result, b);
    if (b.kind === 'adjustment') await audit(req, 'stock_adjustment', 'stock_movement', result, b);
    return reply.code(201).send({ id: result });
  });

  app.post('/projects/:id/material-reservations', async (req, reply) => {
    requireScope(req, 'stock', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as ReservationBody;
    if (!b.material_id || !b.quantity || b.quantity <= 0) {
      throw new HttpError(400, 'material_id and positive quantity are required');
    }

    const reservation = await tx(async (c) => {
      // Reserve only against available (physical − reserved) stock (spec §22)
      const upd = await c.query<{ physical: string; reserved: string }>(
        `UPDATE stock_level SET reserved = reserved + $4
          WHERE material_id = $1 AND location_id IS NOT NULL AND company_id = $2
            AND (physical - reserved) >= $4
         RETURNING physical, reserved`,
        [b.material_id, auth.companyId, id, b.quantity],
      );
      if (upd.rowCount === 0) throw new HttpError(409, 'Insufficient available stock to reserve');

      const ins = await c.query<{ id: string }>(
        `INSERT INTO project_material_reservation (company_id, project_id, material_id, quantity, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [auth.companyId, id, b.material_id, b.quantity, auth.userId],
      );
      return ins.rows[0]!.id;
    });

    await audit(req, 'create', 'project_material_reservation', reservation, b);
    return reply.code(201).send({ id: reservation });
  });
}

// availableStock re-exported for API contract tests
export { availableStock };
