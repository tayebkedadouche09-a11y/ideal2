import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../db.js';
import { config } from '../config.js';
import { requireScope, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth, type AuthContext } from '../auth/context.js';

/** Portal endpoints require the customer role. */
function requireCustomer(req: Parameters<typeof requireScope>[0]): void {
  const auth = requireAuth(req);
  if (!auth.roles.includes('customer')) throw new HttpError(403, 'Portal access only');
  if (auth.clientScope === 'all' || auth.clientScope.size === 0) {
    throw new HttpError(403, 'No client link — contact your account manager');
  }
}

/** Strip internal fields before returning anything to a customer. */
function clientPublic(c: Record<string, unknown>): Record<string, unknown> {
  const { nif, nis, rc, notes, ...pub } = c;
  return pub;
}
function invoicePublic(i: Record<string, unknown>): Record<string, unknown> {
  const { created_by, notes, contract_id, ...pub } = i;
  return pub;
}
function projectPublic(p: Record<string, unknown>): Record<string, unknown> {
  const { budget_materials, budget_labor, budget_transport, budget_vehicles, budget_equipment, budget_subcontracting, budget_other, delayed, ...pub } = p;
  return pub;
}

/** Verify the linked client actually belongs to the caller's company (defensive isolation). */
async function guardClient(c: import('pg').PoolClient | import('pg').Pool, auth: AuthContext, clientId: string): Promise<void> {
  if (auth.clientScope === 'all' || !auth.clientScope.has(clientId)) {
    throw new HttpError(404, 'Not found');
  }
  const res = await c.query(`SELECT company_id FROM client WHERE id = $1`, [clientId]);
  const row = res.rows[0];
  if (!row || row.company_id !== auth.companyId) {
    throw new HttpError(404, 'Not found');
  }
}

export function portalRoutes(app: FastifyInstance): void {
  app.get('/portal/profile', async (req) => {
    requireCustomer(req);
    const auth = requireAuth(req);
    const ids = [...auth.clientScope];
    const res = await pool.query(`SELECT * FROM client WHERE id = ANY($1::uuid[])`, [ids]);
    return { clients: res.rows.map(clientPublic) };
  });

  app.get('/portal/projects', async (req) => {
    requireCustomer(req);
    const auth = requireAuth(req);
    const ids = [...auth.clientScope];
    const res = await pool.query(
      `SELECT id, code, name, site_address, status, planned_start, planned_end, actual_start, actual_end, contract_value, client_id
         FROM project WHERE client_id = ANY($1::uuid[]) AND company_id = $2
        ORDER BY created_at DESC`, [ids, auth.companyId],
    );
    return { projects: res.rows.map(projectPublic) };
  });

  app.get('/portal/projects/:id', async (req) => {
    requireCustomer(req);
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const proj = await pool.query(
      `SELECT id, code, name, site_address, status, planned_start, planned_end, actual_start, actual_end, contract_value, client_id
         FROM project WHERE id = $1 AND company_id = $2`, [id, auth.companyId],
    );
    const p = proj.rows[0];
    if (!p || auth.clientScope === 'all' || !auth.clientScope.has(p.client_id)) throw new HttpError(404, 'Not found');

    const [milestones, photos, quotes, communications] = await Promise.all([
      pool.query(`SELECT id, title, due_date, completed_at FROM project_milestone WHERE project_id = $1 ORDER BY due_date NULLS LAST`, [id]),
      pool.query(
        `SELECT d.id, d.file_name, d.created_at FROM document_link l JOIN document d ON d.id = l.document_id
          WHERE l.entity_type = 'project' AND l.entity_id = $1 AND d.customer_visible = true AND d.mime_type LIKE 'image/%'
          ORDER BY d.created_at DESC`, [id],
      ),
      pool.query(
        `SELECT id, number, title, status, total, created_at FROM quote
          WHERE client_id = $1 AND company_id = $2 AND status IN ('accepted','converted')`, [p.client_id, auth.companyId],
      ),
      pool.query(
        `SELECT id, subject, occurred_at FROM communication
          WHERE project_id = $1 AND kind = 'portal_message' ORDER BY occurred_at DESC LIMIT 50`, [id],
      ),
    ]);
    return { project: projectPublic(p), milestones: milestones.rows, photos: photos.rows, quotes: quotes.rows, communications: communications.rows };
  });

  app.get('/portal/invoices', async (req) => {
    requireCustomer(req);
    const auth = requireAuth(req);
    const ids = [...auth.clientScope];
    const res = await pool.query(
      `SELECT id, number, client_id, status, issue_date, due_date, subtotal, tax_amount, total
         FROM invoice WHERE client_id = ANY($1::uuid[]) AND company_id = $2
           AND status NOT IN ('draft')
        ORDER BY issue_date DESC`, [ids, auth.companyId],
    );
    return { invoices: res.rows.map(invoicePublic) };
  });

  app.get('/portal/payments', async (req) => {
    requireCustomer(req);
    const auth = requireAuth(req);
    const ids = [...auth.clientScope];
    const res = await pool.query(
      `SELECT p.id, p.invoice_id, p.amount, p.method, p.paid_at
         FROM payment p
        WHERE p.client_id = ANY($1::uuid[]) AND p.company_id = $2
          AND NOT EXISTS (SELECT 1 FROM payment_reversal r WHERE r.payment_id = p.id)
        ORDER BY p.paid_at DESC`, [ids, auth.companyId],
    );
    return { payments: res.rows };
  });

  app.get('/portal/documents', async (req) => {
    requireCustomer(req);
    const auth = requireAuth(req);
    const ids = [...auth.clientScope];
    const res = await pool.query(
      `SELECT DISTINCT d.id, d.file_name, d.mime_type, d.created_at
         FROM document d
         JOIN document_link l ON l.document_id = d.id
        WHERE d.company_id = $1 AND d.customer_visible = true
          AND ((l.entity_type = 'client' AND l.entity_id = ANY($2::uuid[]))
            OR (l.entity_type = 'project' AND l.entity_id IN (SELECT id FROM project WHERE client_id = ANY($2::uuid[]))))
        ORDER BY d.created_at DESC`, [auth.companyId, ids],
    );
    return { documents: res.rows };
  });

  app.get('/portal/communications', async (req) => {
    requireCustomer(req);
    const auth = requireAuth(req);
    const ids = [...auth.clientScope];
    const res = await pool.query(
      `SELECT id, subject, body, occurred_at, client_id, project_id
         FROM communication
        WHERE company_id = $1 AND kind = 'portal_message'
          AND (client_id = ANY($2::uuid[]) OR project_id IN (SELECT id FROM project WHERE client_id = ANY($2::uuid[])))
        ORDER BY occurred_at DESC LIMIT 100`, [auth.companyId, ids],
    );
    return { communications: res.rows };
  });

  // Two-way portal message thread — customer posts, staff answers via kind='portal_message'
  app.post('/portal/messages', async (req, reply) => {
    requireCustomer(req);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { client_id?: string; project_id?: string; subject?: string; body?: string };
    if (!b.body) throw new HttpError(400, 'body is required');
    if (!b.client_id || auth.clientScope === 'all' || !auth.clientScope.has(b.client_id)) throw new HttpError(404, 'Not found');
    await guardClient(pool, auth, b.client_id);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO communication (company_id, kind, direction, subject, body, client_id, project_id, created_by)
       VALUES ($1,'portal_message','inbound',$2,$3,$4,$5,$6) RETURNING id`,
      [auth.companyId, b.subject ?? null, b.body, b.client_id, b.project_id ?? null, auth.userId],
    );
    await audit(req, 'create', 'communication', res.rows[0]!.id, { portal_message: true });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  /** Download a customer-visible document — visibility re-checked server-side. */
  app.get('/portal/documents/:id/download', async (req, reply) => {
    requireCustomer(req);
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const ids = [...auth.clientScope];
    const res = await pool.query(
      `SELECT d.* FROM document d
         JOIN document_link l ON l.document_id = d.id
        WHERE d.id = $1 AND d.company_id = $2 AND d.customer_visible = true
          AND ((l.entity_type = 'client' AND l.entity_id = ANY($3::uuid[]))
            OR (l.entity_type = 'project' AND l.entity_id IN (SELECT id FROM project WHERE client_id = ANY($3::uuid[]))))
        LIMIT 1`, [id, auth.companyId, ids],
    );
    const doc = res.rows[0];
    if (!doc) throw new HttpError(404, 'Not found');
    await audit(req, 'document_access', 'document', id, { portal_download: true });
    reply.header('content-type', doc.mime_type ?? 'application/octet-stream');
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(doc.file_name)}"`);
    return createReadStream(join(config.storageDir, auth.companyId, doc.storage_key));
  });

  app.get('/portal/notifications', async (req) => {
    requireCustomer(req);
    const auth = requireAuth(req);
    const ids = [...auth.clientScope];
    const res = await pool.query(
      `SELECT n.id, n.kind, n.severity, n.title, n.body, n.created_at
         FROM notification n
        WHERE n.company_id = $1 AND n.user_id = $3
           OR (n.company_id = $1 AND n.user_id IS NULL AND n.entity_type = 'project'
               AND n.entity_id IN (SELECT id FROM project WHERE client_id = ANY($2::uuid[])))
        ORDER BY n.created_at DESC LIMIT 50`, [auth.companyId, ids, auth.userId],
    );
    return { notifications: res.rows };
  });
}
