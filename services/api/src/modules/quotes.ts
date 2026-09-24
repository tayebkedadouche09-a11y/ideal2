import type { FastifyInstance } from 'fastify';
import { pool, tx } from '../db.js';
import { requireScope, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';
import { canTransitionQuote, computeQuoteTotals, type QuoteLineInput } from '@company-os/domain';
import { emitAutomationEvent } from './automation.js';

interface LineBody {
  kind?: 'measurement' | 'material' | 'labor' | 'equipment' | 'transport' | 'other';
  description?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  discount_percent?: number;
  material_id?: string;
  measurement_id?: string;
}

interface QuoteBody {
  client_id?: string;
  contract_id?: string;
  title?: string;
  description?: string;
  tax_rate?: number;
  margin_target_percent?: number;
  terms?: string;
  valid_until?: string;
  lines?: LineBody[];
}

const LINE_KINDS = new Set(['measurement', 'material', 'labor', 'equipment', 'transport', 'other']);

async function recalcQuote(c: import('pg').PoolClient, quoteId: string): Promise<void> {
  const lines = await c.query<{ quantity: string; unit_price: string; discount_percent: number | null }>(
    `SELECT quantity, unit_price, discount_percent FROM quote_line WHERE quote_id = $1 ORDER BY position`,
    [quoteId],
  );
  const q = await c.query<{ tax_rate: string }>(`SELECT tax_rate FROM quote WHERE id = $1`, [quoteId]);
  const inputs: QuoteLineInput[] = lines.rows.map((l) => ({
    quantity: Number(l.quantity),
    unitPrice: Number(l.unit_price),
    discountPercent: l.discount_percent == null ? undefined : Number(l.discount_percent),
  }));
  const totals = computeQuoteTotals(inputs, Number(q.rows[0]?.tax_rate ?? 0));
  await c.query(
    `UPDATE quote SET subtotal = $2, tax_amount = $3, total = $4, updated_at = now() WHERE id = $1`,
    [quoteId, totals.subtotal, totals.taxAmount, totals.total],
  );
}

async function snapshotVersion(c: import('pg').PoolClient, quoteId: string, userId: string): Promise<void> {
  const quote = await c.query(`SELECT * FROM quote WHERE id = $1`, [quoteId]);
  const lines = await c.query(`SELECT * FROM quote_line WHERE quote_id = $1 ORDER BY position`, [quoteId]);
  const last = await c.query<{ version: number }>(
    `SELECT COALESCE(MAX(version), 0) AS version FROM quote_version WHERE quote_id = $1`,
    [quoteId],
  );
  await c.query(
    `INSERT INTO quote_version (quote_id, version, snapshot, created_by) VALUES ($1,$2,$3,$4)`,
    [quoteId, last.rows[0]!.version + 1, JSON.stringify({ quote: quote.rows[0], lines: lines.rows }), userId],
  );
}

export function quoteRoutes(app: FastifyInstance): void {
  app.get('/quotes', async (req) => {
    requireScope(req, 'quotes', 'read');
    const auth = requireAuth(req);
    const { status, client_id } = req.query as { status?: string; client_id?: string };
    const params: unknown[] = [auth.companyId];
    let where = `company_id = $1`;
    if (status) { params.push(status); where += ` AND status = $${params.length}::quote_status`; }
    if (client_id) { params.push(client_id); where += ` AND client_id = $${params.length}::uuid`; }
    const res = await pool.query(`SELECT * FROM quote WHERE ${where} ORDER BY created_at DESC`, params);
    return { quotes: res.rows };
  });

  app.post('/quotes', async (req, reply) => {
    requireScope(req, 'quotes', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as QuoteBody;
    if (!b.client_id || !b.title) throw new HttpError(400, 'client_id and title are required');
    if (b.lines?.some((l) => !l.kind || !LINE_KINDS.has(l.kind) || !l.description)) {
      throw new HttpError(400, 'Each line needs kind, description');
    }

    const id = await tx(async (c) => {
      const client = await c.query(`SELECT id FROM client WHERE id = $1 AND company_id = $2`, [b.client_id, auth.companyId]);
      if (client.rowCount === 0) throw new HttpError(404, 'Client not found');

      const numRes = await c.query<{ n: string }>(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(number, '\\D', '', 'g'), '')::bigint), 0) + 1 AS n
           FROM quote WHERE company_id = $1 AND number ~ '^DEVIS-[0-9]+$'`,
        [auth.companyId],
      );
      const number = `DEVIS-${String(numRes.rows[0]!.n).padStart(5, '0')}`;

      const q = await c.query<{ id: string }>(
        `INSERT INTO quote (company_id, client_id, contract_id, number, title, description, tax_rate, margin_target_percent, terms, valid_until, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [auth.companyId, b.client_id, b.contract_id ?? null, number, b.title, b.description ?? null,
         b.tax_rate ?? 0, b.margin_target_percent ?? null, b.terms ?? null, b.valid_until ?? null, auth.userId],
      );
      const quoteId = q.rows[0]!.id;

      let pos = 0;
      for (const l of b.lines ?? []) {
        const lineTotal = (l.quantity ?? 0) * (l.unit_price ?? 0) * (1 - (l.discount_percent ?? 0) / 100);
        await c.query(
          `INSERT INTO quote_line (quote_id, position, kind, description, quantity, unit, unit_price, discount_percent, line_total, material_id, measurement_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [quoteId, pos++, l.kind, l.description, l.quantity ?? 0, l.unit ?? null, l.unit_price ?? 0,
           l.discount_percent ?? 0, Math.round(lineTotal * 100) / 100, l.material_id ?? null, l.measurement_id ?? null],
        );
      }
      await recalcQuote(c, quoteId);
      await snapshotVersion(c, quoteId, auth.userId);
      return quoteId;
    });

    await audit(req, 'create', 'quote', id, { number: b.title, client_id: b.client_id });
    return reply.code(201).send({ id });
  });

  app.get('/quotes/:id', async (req) => {
    requireScope(req, 'quotes', 'read');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const res = await pool.query(`SELECT * FROM quote WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
    if (res.rowCount === 0) throw new HttpError(404, 'Quote not found');
    const [lines, versions] = await Promise.all([
      pool.query(`SELECT * FROM quote_line WHERE quote_id = $1 ORDER BY position`, [id]),
      pool.query(`SELECT id, version, created_by, created_at FROM quote_version WHERE quote_id = $1 ORDER BY version DESC`, [id]),
    ]);
    return { quote: res.rows[0], lines: lines.rows, versions: versions.rows };
  });

  app.get('/quotes/:id/versions/:version', async (req) => {
    requireScope(req, 'quotes', 'read');
    const auth = requireAuth(req);
    const { id, version } = req.params as { id: string; version: string };
    const res = await pool.query(
      `SELECT v.* FROM quote_version v JOIN quote q ON q.id = v.quote_id
        WHERE v.quote_id = $1 AND v.version = $2 AND q.company_id = $3`,
      [id, Number(version), auth.companyId],
    );
    if (res.rowCount === 0) throw new HttpError(404, 'Version not found');
    return res.rows[0];
  });

  app.put('/quotes/:id', async (req) => {
    requireScope(req, 'quotes', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as QuoteBody;

    const result = await tx(async (c) => {
      const cur = await c.query<{ status: string }>(`SELECT status FROM quote WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
      if (cur.rowCount === 0) throw new HttpError(404, 'Quote not found');
      if (!['draft', 'rejected'].includes(cur.rows[0]!.status)) {
        throw new HttpError(409, `Quote in status ${cur.rows[0]!.status} is immutable — create a revision workflow instead`);
      }
      const fields = ['title', 'description', 'tax_rate', 'margin_target_percent', 'terms', 'valid_until', 'contract_id'] as const;
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      for (const f of fields) {
        const key = f === 'tax_rate' ? 'tax_rate' : f;
        if ((b as Record<string, unknown>)[key] !== undefined) {
          sets.push(`${f} = $${i++}`);
          vals.push((b as Record<string, unknown>)[key]);
        }
      }
      if (sets.length > 0) {
        vals.push(id);
        await c.query(`UPDATE quote SET ${sets.join(', ')}, updated_at = now() WHERE id = $${i}`, vals);
      }
      if (b.lines) {
        await c.query(`DELETE FROM quote_line WHERE quote_id = $1`, [id]);
        let pos = 0;
        for (const l of b.lines) {
          if (!l.kind || !LINE_KINDS.has(l.kind) || !l.description) throw new HttpError(400, 'Invalid line');
          const lineTotal = (l.quantity ?? 0) * (l.unit_price ?? 0) * (1 - (l.discount_percent ?? 0) / 100);
          await c.query(
            `INSERT INTO quote_line (quote_id, position, kind, description, quantity, unit, unit_price, discount_percent, line_total, material_id, measurement_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [id, pos++, l.kind, l.description, l.quantity ?? 0, l.unit ?? null, l.unit_price ?? 0,
             l.discount_percent ?? 0, Math.round(lineTotal * 100) / 100, l.material_id ?? null, l.measurement_id ?? null],
          );
        }
      }
      await recalcQuote(c, id);
      await snapshotVersion(c, id, auth.userId);
      return true;
    });

    await audit(req, 'update', 'quote', id, { lines: b.lines?.length, tax_rate: b.tax_rate });
    return { ok: result };
  });

  // Workflow transitions — approve requires 'approve' scope, others 'write'
  app.post('/quotes/:id/transition', async (req) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const { to } = (req.body ?? {}) as { to?: string };
    if (!to) throw new HttpError(400, 'to is required');

    requireScope(req, 'quotes', to === 'approved' || to === 'rejected' ? 'approve' : 'write');

    const result = await tx(async (c) => {
      const cur = await c.query<{ status: string }>(`SELECT status FROM quote WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, auth.companyId]);
      if (cur.rowCount === 0) throw new HttpError(404, 'Quote not found');
      const from = cur.rows[0]!.status;
      if (!canTransitionQuote(from, to)) throw new HttpError(409, `Illegal transition ${from} → ${to}`);
      const patch = to === 'approved' ? `, approved_by = $3, approved_at = now()` : ``;
      await c.query(
        `UPDATE quote SET status = $2::quote_status${patch}, updated_at = now() WHERE id = $1`,
        to === 'approved' ? [id, to, auth.userId] : [id, to],
      );
      return { from, to };
    });

    await audit(req, to === 'approved' ? 'approve' : to === 'rejected' ? 'reject' : 'status_change', 'quote', id, result);
    // Automation hook: accepted quotes can notify sales/management or kick off planning (spec §44)
    if (to === 'accepted') {
      void emitAutomationEvent(req, {
        trigger_type: 'quote_accepted',
        severity: 'info',
        entity_type: 'quote',
        entity_id: id,
        title: `Devis accepté`,
        body: `Transition ${result.from} → ${result.to}.`,
      });
    }
    return result;
  });

  // Kept for API spec §32 compatibility
  app.post('/quotes/:id/approve', async (req, reply) => {
    requireScope(req, 'quotes', 'approve');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const r = await tx(async (c) => {
      const cur = await c.query<{ status: string }>(`SELECT status FROM quote WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, auth.companyId]);
      if (cur.rowCount === 0) throw new HttpError(404, 'Quote not found');
      if (!canTransitionQuote(cur.rows[0]!.status, 'approved')) throw new HttpError(409, `Cannot approve from ${cur.rows[0]!.status}`);
      await c.query(`UPDATE quote SET status = 'approved', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1`, [id, auth.userId]);
      return { from: cur.rows[0]!.status, to: 'approved' };
    });
    await audit(req, 'approve', 'quote', id, r);
    return reply.send(r);
  });

  // Convert accepted quote into a project without re-entry (spec §11/§14)
  app.post('/quotes/:id/convert-to-project', async (req, reply) => {
    requireScope(req, 'quotes', 'write');
    requireScope(req, 'projects', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };

    const out = await tx(async (c) => {
      const q = await c.query<{ status: string; client_id: string; title: string; total: string; number: string }>(
        `SELECT status, client_id, title, total, number FROM quote WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [id, auth.companyId],
      );
      const quote = q.rows[0];
      if (!quote) throw new HttpError(404, 'Quote not found');
      if (quote.status === 'converted') throw new HttpError(409, 'Quote already converted');
      if (!canTransitionQuote(quote.status, 'converted')) throw new HttpError(409, `Quote must be accepted before conversion (currently ${quote.status})`);

      const codeRes = await c.query<{ n: string }>(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::bigint), 0) + 1 AS n
           FROM project WHERE company_id = $1 AND code ~ '^P-[0-9]+$'`,
        [auth.companyId],
      );
      const code = `P-${String(codeRes.rows[0]!.n).padStart(4, '0')}`;

      const proj = await c.query<{ id: string }>(
        `INSERT INTO project (company_id, client_id, contract_id, quote_id, code, name, contract_value, status)
         VALUES ($1,$2,(SELECT contract_id FROM quote WHERE id = $3),$3,$4,$5,$6,'planned') RETURNING id`,
        [auth.companyId, quote.client_id, id, code, quote.title, Number(quote.total)],
      );
      const projectId = proj.rows[0]!.id;

      // Carry material lines over as planned consumption baselines via reservations
      const matLines = await c.query<{ material_id: string; quantity: string }>(
        `SELECT material_id, quantity FROM quote_line WHERE quote_id = $1 AND kind = 'material' AND material_id IS NOT NULL`,
        [id],
      );
      for (const l of matLines.rows) {
        await c.query(
          `INSERT INTO project_material_consumption (company_id, project_id, material_id, planned_quantity, actual_quantity, recorded_by)
           VALUES ($1,$2,$3,$4,0,$5)`,
          [auth.companyId, projectId, l.material_id, Number(l.quantity), auth.userId],
        );
      }

      await c.query(`UPDATE quote SET status = 'converted', updated_at = now() WHERE id = $1`, [id]);
      return { projectId, code };
    });

    await audit(req, 'convert', 'quote', id, out);
    return reply.code(201).send(out);
  });
}
