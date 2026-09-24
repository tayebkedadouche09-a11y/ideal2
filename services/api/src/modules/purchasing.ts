import type { FastifyInstance } from 'fastify';
import { pool, tx } from '../db.js';
import { requireScope, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';
import { emitAutomationEvent } from './automation.js';

interface PoLineBody { material_id?: string; quantity?: number; unit_price?: number }
interface PoBody {
  supplier_id?: string; project_id?: string; expected_delivery?: string; lines?: PoLineBody[];
}

const PO_TRANSITIONS: Record<string, string[]> = {
  draft: ['requested'],
  requested: ['approved', 'cancelled'],
  approved: ['ordered', 'cancelled'],
  ordered: ['partially_received', 'received', 'cancelled'],
  partially_received: ['partially_received', 'received'],
};

export function purchasingRoutes(app: FastifyInstance): void {
  app.get('/purchase-orders', async (req) => {
    requireScope(req, 'purchasing', 'read');
    const auth = requireAuth(req);
    const { status } = req.query as { status?: string };
    const params: unknown[] = [auth.companyId];
    let where = `company_id = $1`;
    if (status) { params.push(status); where += ` AND status = $${params.length}::purchase_status`; }
    const res = await pool.query(
      `SELECT po.*, s.name AS supplier_name FROM purchase_order po JOIN supplier s ON s.id = po.supplier_id
        WHERE ${where} ORDER BY po.created_at DESC`, params,
    );
    return { purchaseOrders: res.rows };
  });

  app.post('/purchase-orders', async (req, reply) => {
    requireScope(req, 'purchasing', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as PoBody;
    if (!b.supplier_id || !b.lines?.length) throw new HttpError(400, 'supplier_id and lines are required');
    if (b.lines.some((l) => !l.material_id || !l.quantity || l.quantity <= 0)) throw new HttpError(400, 'Invalid line');
    const supplierId = b.supplier_id;
    const lines = b.lines;

    const id = await tx(async (c) => {
      const sup = await c.query(`SELECT id FROM supplier WHERE id = $1 AND company_id = $2`, [supplierId, auth.companyId]);
      if (sup.rowCount === 0) throw new HttpError(404, 'Supplier not found');
      const numRes = await c.query<{ n: string }>(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(number, '\\D', '', 'g'), '')::bigint), 0) + 1 AS n
           FROM purchase_order WHERE company_id = $1 AND number ~ '^PO-[0-9]+$'`,
        [auth.companyId],
      );
      const number = `PO-${String(numRes.rows[0]!.n).padStart(5, '0')}`;
      const po = await c.query<{ id: string }>(
        `INSERT INTO purchase_order (company_id, supplier_id, number, project_id, expected_delivery, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [auth.companyId, b.supplier_id, number, b.project_id ?? null, b.expected_delivery ?? null, auth.userId],
      );
      for (const l of lines) {
        await c.query(
          `INSERT INTO purchase_line (purchase_order_id, material_id, quantity, unit_price) VALUES ($1,$2,$3,$4)`,
          [po.rows[0]!.id, l.material_id, l.quantity, l.unit_price ?? 0],
        );
      }
      return po.rows[0]!.id;
    });
    await audit(req, 'create', 'purchase_order', id, b);
    return reply.code(201).send({ id });
  });

  app.post('/purchase-orders/:id/transition', async (req) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const { to } = (req.body ?? {}) as { to?: string };
    if (!to) throw new HttpError(400, 'to is required');
    // approval requires approve scope; other transitions require write
    requireScope(req, 'purchasing', to === 'approved' ? 'approve' : 'write');
    const r = await tx(async (c) => {
      const cur = await c.query<{ status: string }>(
        `SELECT status FROM purchase_order WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, auth.companyId],
      );
      if (cur.rowCount === 0) throw new HttpError(404, 'Purchase order not found');
      if (!(PO_TRANSITIONS[cur.rows[0]!.status] ?? []).includes(to)) {
        throw new HttpError(409, `Illegal transition ${cur.rows[0]!.status} → ${to}`);
      }
      await c.query(`UPDATE purchase_order SET status = $2::purchase_status WHERE id = $1`, [id, to]);
      return { from: cur.rows[0]!.status, to };
    });
    await audit(req, to === 'approved' ? 'approve' : 'status_change', 'purchase_order', id, r);
    // Automation hook: requested POs await approval — rules can notify approvers (spec §44)
    if (to === 'requested') {
      void emitAutomationEvent(req, {
        trigger_type: 'approval_needed',
        severity: 'info',
        entity_type: 'purchase_order',
        entity_id: id,
        title: `Bon de commande à approuver`,
        body: `Transition ${r.from} → ${r.to}.`,
      });
    }
    return r;
  });

  // Goods receipt: increases physical stock and PO received quantities (spec §23)
  app.post('/purchase-orders/:id/goods-receipt', async (req, reply) => {
    requireScope(req, 'purchasing', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { lines?: { purchase_line_id?: string; quantity?: number }[]; note?: string };
    if (!b.lines?.length) throw new HttpError(400, 'lines are required');
    const receiptLines = b.lines;

    const out = await tx(async (c) => {
      const po = await c.query<{ status: string; number: string }>(
        `SELECT status, number FROM purchase_order WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [id, auth.companyId],
      );
      const poRow = po.rows[0];
      if (!poRow) throw new HttpError(404, 'Purchase order not found');
      if (!['ordered', 'partially_received'].includes(poRow.status)) {
        throw new HttpError(409, `Cannot receive goods for a ${poRow.status} order`);
      }

      const loc = await c.query<{ id: string }>(
        `SELECT id FROM stock_location WHERE company_id = $1 ORDER BY (kind = 'warehouse') DESC, created_at LIMIT 1`,
        [auth.companyId],
      );
      if (loc.rowCount === 0) throw new HttpError(409, 'No stock location exists — create one first');

      const grnId = (
        await c.query(
          `INSERT INTO goods_receipt (company_id, purchase_order_id, received_by, note) VALUES ($1,$2,$3,$4) RETURNING id`,
          [auth.companyId, id, auth.userId, b.note ?? null],
        )
      ).rows[0]!.id as string;

      for (const l of receiptLines) {
        if (!l.purchase_line_id || !l.quantity || l.quantity <= 0) throw new HttpError(400, 'Invalid receipt line');
        const line = await c.query<{ material_id: string; quantity: string; received_quantity: string }>(
          `SELECT pl.material_id, pl.quantity, pl.received_quantity FROM purchase_line pl
             JOIN purchase_order po ON po.id = pl.purchase_order_id
            WHERE pl.id = $1 AND po.company_id = $2 FOR UPDATE OF pl`, [l.purchase_line_id, auth.companyId],
        );
        const pl = line.rows[0];
        if (!pl) throw new HttpError(404, 'Purchase line not found');
        const remaining = Number(pl.quantity) - Number(pl.received_quantity);
        if (l.quantity > remaining + 0.001) throw new HttpError(409, `Receive exceeds ordered remaining (${remaining})`);

        await c.query(`UPDATE purchase_line SET received_quantity = received_quantity + $2 WHERE id = $1`, [l.purchase_line_id, l.quantity]);
        await c.query(
          `INSERT INTO stock_level (material_id, location_id, company_id, physical, reserved)
           VALUES ($1,$2,$3,$4,0)
           ON CONFLICT (material_id, location_id) DO UPDATE SET physical = stock_level.physical + $4`,
          [pl.material_id, loc.rows[0]!.id, auth.companyId, l.quantity],
        );
        await c.query(
          `INSERT INTO stock_movement (company_id, material_id, location_id, kind, quantity, purchase_line_id, reason, created_by)
           VALUES ($1,$2,$3,'entry',$4,$5,'goods receipt',$6)`,
          [auth.companyId, pl.material_id, loc.rows[0]!.id, l.quantity, l.purchase_line_id, auth.userId],
        );
      }

      // Recompute PO status from received ratios
      const sums = await c.query<{ ordered: string; received: string }>(
        `SELECT COALESCE(SUM(quantity),0) AS ordered, COALESCE(SUM(received_quantity),0) AS received
           FROM purchase_line WHERE purchase_order_id = $1`, [id],
      );
      const ordered = Number(sums.rows[0]!.ordered);
      const received = Number(sums.rows[0]!.received);
      const next = received >= ordered ? 'received' : received > 0 ? 'partially_received' : poRow.status;
      await c.query(`UPDATE purchase_order SET status = $2::purchase_status WHERE id = $1`, [id, next]);
      return { goodsReceiptId: grnId, status: next };
    });

    await audit(req, 'create', 'goods_receipt', out.goodsReceiptId, { purchase_order_id: id });
    return reply.code(201).send(out);
  });

  app.get('/purchase-orders/:id', async (req) => {
    requireScope(req, 'purchasing', 'read');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const po = await pool.query(
      `SELECT po.*, s.name AS supplier_name FROM purchase_order po JOIN supplier s ON s.id = po.supplier_id
        WHERE po.id = $1 AND po.company_id = $2`, [id, auth.companyId],
    );
    if (po.rowCount === 0) throw new HttpError(404, 'Purchase order not found');
    const lines = await pool.query(
      `SELECT pl.*, m.name AS material_name, m.unit FROM purchase_line pl JOIN material m ON m.id = pl.material_id
        WHERE pl.purchase_order_id = $1 ORDER BY pl.id`, [id],
    );
    return { purchaseOrder: po.rows[0], lines: lines.rows };
  });
}
