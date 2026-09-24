import type { FastifyInstance } from 'fastify';
import { pool, tx } from '../db.js';
import { requireScope, assertClientAccess, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';
import { invoiceStatus, outstanding, computeQuoteTotals, type QuoteLineInput } from '@company-os/domain';

interface InvoiceLineBody {
  description?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
}
interface InvoiceBody {
  client_id?: string;
  contract_id?: string;
  project_id?: string;
  tax_rate?: number;
  due_date?: string;
  notes?: string;
  lines?: InvoiceLineBody[];
}
interface PaymentBody {
  amount?: number;
  method?: 'cash' | 'bank_transfer' | 'cheque' | 'other';
  reference?: string;
  paid_at?: string;
}

async function recalcInvoice(c: import('pg').PoolClient, invoiceId: string): Promise<void> {
  const lines = await c.query<{ quantity: string; unit_price: string }>(
    `SELECT quantity, unit_price FROM invoice_line WHERE invoice_id = $1 ORDER BY position`, [invoiceId],
  );
  const inv = await c.query<{ tax_rate: string }>(`SELECT tax_rate FROM invoice WHERE id = $1`, [invoiceId]);
  const inputs: QuoteLineInput[] = lines.rows.map((l) => ({ quantity: Number(l.quantity), unitPrice: Number(l.unit_price) }));
  const t = computeQuoteTotals(inputs, Number(inv.rows[0]?.tax_rate ?? 0));
  await c.query(`UPDATE invoice SET subtotal = $2, tax_amount = $3, total = $4, updated_at = now() WHERE id = $1`,
    [invoiceId, t.subtotal, t.taxAmount, t.total]);
}

/** Recompute stored status from append-only payment truth (spec §35). */
async function refreshInvoiceStatus(c: import('pg').PoolClient, invoiceId: string): Promise<void> {
  const inv = await c.query<{ total: string; due_date: Date | null; status: string }>(
    `SELECT total, due_date, status FROM invoice WHERE id = $1`, [invoiceId],
  );
  const row = inv.rows[0];
  if (!row) return;
  const paidRes = await c.query<{ sum: string }>(
    `SELECT COALESCE(SUM(p.amount), 0) AS sum
       FROM payment p LEFT JOIN payment_reversal r ON r.payment_id = p.id
      WHERE p.invoice_id = $1 AND r.id IS NULL`, [invoiceId],
  );
  const next = invoiceStatus(Number(row.total), Number(paidRes.rows[0]!.sum), row.due_date);
  if (next !== row.status && row.status !== 'draft' && row.status !== 'cancelled') {
    await c.query(`UPDATE invoice SET status = $2::invoice_status, updated_at = now() WHERE id = $1`, [invoiceId, next]);
  }
}

export function financeRoutes(app: FastifyInstance): void {
  app.get('/invoices', async (req) => {
    requireScope(req, 'finance', 'read');
    const auth = requireAuth(req);
    const { status, client_id, project_id } = req.query as { status?: string; client_id?: string; project_id?: string };
    const params: unknown[] = [auth.companyId];
    let where = `company_id = $1`;
    if (status) { params.push(status); where += ` AND status = $${params.length}::invoice_status`; }
    if (client_id) { params.push(client_id); where += ` AND client_id = $${params.length}::uuid`; }
    if (project_id) { params.push(project_id); where += ` AND project_id = $${params.length}::uuid`; }
    const res = await pool.query(`SELECT * FROM invoice WHERE ${where} ORDER BY issue_date DESC, created_at DESC`, params);
    return { invoices: res.rows };
  });

  app.post('/invoices', async (req, reply) => {
    requireScope(req, 'finance', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as InvoiceBody;
    if (!b.client_id) throw new HttpError(400, 'client_id is required');
    if (b.lines?.some((l) => !l.description)) throw new HttpError(400, 'Each line needs a description');
    assertClientAccess(req, b.client_id);

    const id = await tx(async (c) => {
      const client = await c.query(`SELECT id FROM client WHERE id = $1 AND company_id = $2`, [b.client_id, auth.companyId]);
      if (client.rowCount === 0) throw new HttpError(404, 'Client not found');

      const numRes = await c.query<{ n: string }>(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(number, '\\D', '', 'g'), '')::bigint), 0) + 1 AS n
           FROM invoice WHERE company_id = $1 AND number ~ '^FACT-[0-9]+$'`,
        [auth.companyId],
      );
      const number = `FACT-${String(numRes.rows[0]!.n).padStart(5, '0')}`;

      const inv = await c.query<{ id: string }>(
        `INSERT INTO invoice (company_id, client_id, contract_id, project_id, number, tax_rate, due_date, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [auth.companyId, b.client_id, b.contract_id ?? null, b.project_id ?? null, number,
         b.tax_rate ?? 0, b.due_date ?? null, b.notes ?? null, auth.userId],
      );
      const invoiceId = inv.rows[0]!.id;
      let pos = 0;
      for (const l of b.lines ?? []) {
        await c.query(
          `INSERT INTO invoice_line (invoice_id, position, description, quantity, unit, unit_price, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [invoiceId, pos++, l.description!, l.quantity ?? 1, l.unit ?? null, l.unit_price ?? 0,
           Math.round((l.quantity ?? 1) * (l.unit_price ?? 0) * 100) / 100],
        );
      }
      await recalcInvoice(c, invoiceId);
      return invoiceId;
    });

    await audit(req, 'create', 'invoice', id, { client_id: b.client_id });
    return reply.code(201).send({ id });
  });

  app.get('/invoices/:id', async (req) => {
    requireScope(req, 'finance', 'read');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const res = await pool.query(`SELECT * FROM invoice WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
    if (res.rowCount === 0) throw new HttpError(404, 'Invoice not found');
    const [lines, payments] = await Promise.all([
      pool.query(`SELECT * FROM invoice_line WHERE invoice_id = $1 ORDER BY position`, [id]),
      pool.query(
        `SELECT p.*, r.id AS reversal_id FROM payment p
           LEFT JOIN payment_reversal r ON r.payment_id = p.id
          WHERE p.invoice_id = $1 ORDER BY p.paid_at DESC, p.created_at DESC`, [id],
      ),
    ]);
    const paid = payments.rows.filter((p) => !p.reversal_id).reduce((s, p) => s + Number(p.amount), 0);
    const inv = res.rows[0];
    return {
      invoice: inv,
      lines: lines.rows,
      payments: payments.rows,
      paid,
      due: outstanding(Number(inv.total), paid),
    };
  });

  app.put('/invoices/:id', async (req) => {
    requireScope(req, 'finance', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as InvoiceBody;
    await tx(async (c) => {
      const cur = await c.query<{ status: string }>(`SELECT status FROM invoice WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, auth.companyId]);
      if (cur.rowCount === 0) throw new HttpError(404, 'Invoice not found');
      if (!['draft', 'approved'].includes(cur.rows[0]!.status)) {
        throw new HttpError(409, 'Only draft or approved invoices can be edited');
      }
      const fields = ['tax_rate', 'due_date', 'notes', 'contract_id', 'project_id'] as const;
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      for (const f of fields) {
        if ((b as Record<string, unknown>)[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push((b as Record<string, unknown>)[f]); }
      }
      if (sets.length > 0) { vals.push(id); await c.query(`UPDATE invoice SET ${sets.join(', ')}, updated_at = now() WHERE id = $${i}`, vals); }
      if (b.lines) {
        await c.query(`DELETE FROM invoice_line WHERE invoice_id = $1`, [id]);
        let pos = 0;
        for (const l of b.lines) {
          if (!l.description) throw new HttpError(400, 'Each line needs a description');
          await c.query(
            `INSERT INTO invoice_line (invoice_id, position, description, quantity, unit, unit_price, line_total)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [id, pos++, l.description, l.quantity ?? 1, l.unit ?? null, l.unit_price ?? 0,
             Math.round((l.quantity ?? 1) * (l.unit_price ?? 0) * 100) / 100],
          );
        }
      }
      await recalcInvoice(c, id);
    });
    await audit(req, 'update', 'invoice', id, { tax_rate: b.tax_rate, lines: b.lines?.length });
    return { ok: true };
  });

  app.post('/invoices/:id/transition', async (req) => {
    requireScope(req, 'finance', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const { to } = (req.body ?? {}) as { to?: string };
    const allowed: Record<string, string[]> = { approved: ['draft'], issued: ['approved'], cancelled: ['draft', 'approved', 'issued'] };
    if (!to || !allowed[to]) throw new HttpError(400, 'to must be approved|issued|cancelled');
    const r = await tx(async (c) => {
      const cur = await c.query<{ status: string }>(`SELECT status FROM invoice WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, auth.companyId]);
      if (cur.rowCount === 0) throw new HttpError(404, 'Invoice not found');
      if (!allowed[to]!.includes(cur.rows[0]!.status)) throw new HttpError(409, `Illegal transition ${cur.rows[0]!.status} → ${to}`);
      await c.query(`UPDATE invoice SET status = $2::invoice_status, updated_at = now() WHERE id = $1`, [id, to]);
      return { from: cur.rows[0]!.status, to };
    });
    await audit(req, 'status_change', 'invoice', id, r);
    return r;
  });

  // Payment — append-only event; invoice/debt state derives from it (spec §35)
  app.post('/invoices/:id/payments', async (req, reply) => {
    requireScope(req, 'finance', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as PaymentBody;
    if (!b.amount || b.amount <= 0) throw new HttpError(400, 'amount must be positive');
    if (!b.method) throw new HttpError(400, 'method is required');
    const amount = b.amount;
    const method = b.method;

    const out = await tx(async (c) => {
      const inv = await c.query<{ id: string; client_id: string; status: string; total: string }>(
        `SELECT id, client_id, status, total FROM invoice WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [id, auth.companyId],
      );
      const invoice = inv.rows[0];
      if (!invoice) throw new HttpError(404, 'Invoice not found');
      if (['draft', 'cancelled'].includes(invoice.status)) throw new HttpError(409, `Cannot pay a ${invoice.status} invoice`);

      const paidRes = await c.query<{ sum: string }>(
        `SELECT COALESCE(SUM(p.amount), 0) AS sum FROM payment p
           LEFT JOIN payment_reversal r ON r.payment_id = p.id
          WHERE p.invoice_id = $1 AND r.id IS NULL`, [id],
      );
      const alreadyPaid = Number(paidRes.rows[0]!.sum);
      const remaining = outstanding(Number(invoice.total), alreadyPaid);
      if (amount > remaining + 0.001) throw new HttpError(409, `Payment exceeds remaining balance (${remaining})`);

      const pay = await c.query<{ id: string }>(
        `INSERT INTO payment (company_id, invoice_id, client_id, amount, method, reference, paid_at, created_by)
         VALUES ($1,$2,$3,$4,$5::payment_method,$6,COALESCE($7::date, CURRENT_DATE),$8) RETURNING id`,
        [auth.companyId, id, invoice.client_id, amount, method, b.reference ?? null, b.paid_at ?? null, auth.userId],
      );
      await refreshInvoiceStatus(c, id);
      return { paymentId: pay.rows[0]!.id, paidTotal: alreadyPaid + amount };
    });

    await audit(req, 'payment', 'payment', out.paymentId, { invoice_id: id, amount, method });
    return reply.code(201).send(out);
  });

  // Financial correction without deleting history (spec §60)
  app.post('/payments/:id/reversal', async (req, reply) => {
    requireScope(req, 'finance', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const { reason } = (req.body ?? {}) as { reason?: string };
    if (!reason) throw new HttpError(400, 'reason is required');

    const out = await tx(async (c) => {
      const pay = await c.query<{ invoice_id: string; company_id: string }>(
        `SELECT invoice_id, company_id FROM payment WHERE id = $1`, [id],
      );
      const p = pay.rows[0];
      if (!p || p.company_id !== auth.companyId) throw new HttpError(404, 'Payment not found');
      const dup = await c.query(`SELECT 1 FROM payment_reversal WHERE payment_id = $1`, [id]);
      if (dup.rowCount! > 0) throw new HttpError(409, 'Payment already reversed');
      await c.query(
        `INSERT INTO payment_reversal (payment_id, reason, reversed_by) VALUES ($1,$2,$3)`,
        [id, reason, auth.userId],
      );
      await refreshInvoiceStatus(c, p.invoice_id);
      return { invoiceId: p.invoice_id };
    });

    await audit(req, 'payment', 'payment_reversal', id, { reason, invoice_id: out.invoiceId });
    return reply.code(201).send(out);
  });

  app.get('/debts', async (req) => {
    requireScope(req, 'finance', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(
      `SELECT i.id, i.number, i.client_id, c.name AS client_name, i.total, i.due_date, i.status,
              COALESCE((SELECT SUM(p.amount) FROM payment p LEFT JOIN payment_reversal r ON r.payment_id = p.id
                         WHERE p.invoice_id = i.id AND r.id IS NULL), 0) AS paid
         FROM invoice i JOIN client c ON c.id = i.client_id
        WHERE i.company_id = $1 AND i.status IN ('issued','partially_paid','overdue')
        ORDER BY i.due_date NULLS LAST`,
      [auth.companyId],
    );
    const rows = res.rows.map((r) => ({ ...r, outstanding: outstanding(Number(r.total), Number(r.paid)) }));
    const now = new Date().toISOString().slice(0, 10);
    const buckets = {
      overdue: rows.filter((r) => r.due_date && String(r.due_date).slice(0, 10) < now),
      dueSoon: rows.filter((r) => r.due_date && String(r.due_date).slice(0, 10) >= now),
      partiallyPaid: rows.filter((r) => Number(r.paid) > 0),
    };
    const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
    return { rows, buckets, totalOutstanding };
  });

  app.get('/reports/financial', async (req) => {
    requireScope(req, 'finance', 'read');
    const auth = requireAuth(req);
    const { from, to } = req.query as { from?: string; to?: string };
    const range = [from ?? '1900-01-01', to ?? '2999-12-31'];
    const [invoiced, collected, byClient, byMonth] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS amount FROM invoice
          WHERE company_id = $1 AND status NOT IN ('draft','cancelled') AND issue_date BETWEEN $2 AND $3`,
        [auth.companyId, ...range],
      ),
      pool.query(
        `SELECT COALESCE(SUM(p.amount),0) AS amount FROM payment p
           LEFT JOIN payment_reversal r ON r.payment_id = p.id
          WHERE p.company_id = $1 AND r.id IS NULL AND p.paid_at BETWEEN $2 AND $3`,
        [auth.companyId, ...range],
      ),
      pool.query(
        `SELECT c.id AS client_id, c.name, COALESCE(SUM(i.total),0) AS invoiced
           FROM invoice i JOIN client c ON c.id = i.client_id
          WHERE i.company_id = $1 AND i.status NOT IN ('draft','cancelled')
          GROUP BY c.id, c.name ORDER BY SUM(i.total) DESC LIMIT 20`,
        [auth.companyId],
      ),
      pool.query(
        `SELECT date_trunc('month', issue_date) AS month, COALESCE(SUM(total),0) AS invoiced
           FROM invoice WHERE company_id = $1 AND status NOT IN ('draft','cancelled')
          GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
        [auth.companyId],
      ),
    ]);
    return { invoiced: invoiced.rows[0], collected: collected.rows[0], byClient: byClient.rows, byMonth: byMonth.rows };
  });
}
