import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname } from 'node:path';
import { pool, tx } from '../db.js';
import { config } from '../config.js';
import { requireScope, assertProjectAccess, assertClientAccess, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';

const LINK_TYPES = new Set(['client', 'supplier', 'contract', 'quote', 'project', 'invoice', 'vehicle', 'employee', 'equipment']);
const ALLOWED_MIME = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'text/csv', 'text/plain',
]);
const MAX_BYTES = 25 * 1024 * 1024;

async function storeObject(key: string, buffer: Buffer, mimeType: string): Promise<void> {
  if (config.storageProvider !== 'supabase') {
    const dir = join(config.storageDir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, key), buffer);
    return;
  }
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) throw new Error('Supabase Storage is not configured');
  const url = `${config.supabaseUrl.replace(/\\/$/, '')}/storage/v1/object/${encodeURIComponent(config.supabaseStorageBucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${config.supabaseServiceRoleKey}`, apikey: config.supabaseServiceRoleKey, 'Content-Type': mimeType, 'x-upsert': 'false' }, body: buffer });
  if (!res.ok) throw new Error(`Storage upload failed: ${res.status} ${await res.text()}`);
}

async function readObject(key: string, companyId: string): Promise<NodeJS.ReadableStream | Buffer> {
  if (config.storageProvider !== 'supabase') return createReadStream(join(config.storageDir, key));
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) throw new Error('Supabase Storage is not configured');
  const objectKey = key.includes('/') ? key : `${companyId}/${key}`;
  const url = `${config.supabaseUrl.replace(/\\/$/, '')}/storage/v1/object/authenticated/${encodeURIComponent(config.supabaseStorageBucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${config.supabaseServiceRoleKey}`, apikey: config.supabaseServiceRoleKey } });
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, 'Document storage object unavailable');
  return Buffer.from(await res.arrayBuffer());
}

export function documentRoutes(app: FastifyInstance): void {
  app.post('/documents/upload', async (req, reply) => {
    requireScope(req, 'documents', 'write');
    const auth = requireAuth(req);
    const parts = req.parts();
    let buffer: Buffer | null = null;
    let fileName = 'upload';
    let mimeType = 'application/octet-stream';
    const links: { entity_type: string; entity_id: string }[] = [];
    let customerVisible = false;

    for await (const part of parts) {
      if (part.type === 'file') {
        if (!ALLOWED_MIME.has(part.mimetype)) throw new HttpError(415, `Unsupported file type ${part.mimetype}`);
        buffer = await part.toBuffer();
        if (buffer.length > MAX_BYTES) throw new HttpError(413, 'File too large (max 25 MB)');
        fileName = part.filename;
        mimeType = part.mimetype;
      } else if (part.type === 'field') {
        if (part.fieldname === 'entity_type' && part.value && LINK_TYPES.has(String(part.value))) {
          links.push({ entity_type: String(part.value), entity_id: '' });
        } else if (part.fieldname === 'entity_id' && part.value) {
          if (links.length > 0 && links[links.length - 1]!.entity_id === '') links[links.length - 1]!.entity_id = String(part.value);
        } else if (part.fieldname === 'customer_visible') {
          customerVisible = String(part.value) === 'true';
        }
      }
    }
    if (!buffer) throw new HttpError(400, 'File is required');
    if (links.some((l) => !l.entity_id)) throw new HttpError(400, 'entity_id required for each entity_type');
    for (const l of links) {
      if (l.entity_type === 'project') assertProjectAccess(req, l.entity_id);
      if (l.entity_type === 'client') assertClientAccess(req, l.entity_id);
    }

    const sha = createHash('sha256').update(buffer).digest('hex');
    const docId = await tx(async (c) => {
      const dir = join(config.storageDir, auth.companyId);
      await mkdir(dir, { recursive: true });
      const key = `${Date.now()}-${sha.slice(0, 12)}${extname(fileName)}`;
      await writeFile(join(dir, key), buffer);
      const res = await c.query<{ id: string }>(
        `INSERT INTO document (company_id, uploaded_by, file_name, mime_type, size_bytes, storage_key, sha256, status, customer_visible)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8) RETURNING id`,
        [auth.companyId, auth.userId, fileName, mimeType, buffer.length, key, sha, customerVisible],
      );
      const id = res.rows[0]!.id;
      for (const l of links) {
        await c.query(`INSERT INTO document_link (document_id, entity_type, entity_id) VALUES ($1,$2,$3)`, [id, l.entity_type, l.entity_id]);
      }
      return id;
    });

    await audit(req, 'document_access', 'document', docId, { file_name: fileName, links });
    return reply.code(201).send({ id: docId });
  });

  app.get('/documents/:id/download', async (req, reply) => {
    requireScope(req, 'documents', 'read');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const res = await pool.query(`SELECT * FROM document WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
    const doc = res.rows[0];
    if (!doc) throw new HttpError(404, 'Document not found');
    await audit(req, 'document_access', 'document', id, { download: true });
    reply.header('content-type', doc.mime_type ?? 'application/octet-stream');
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(doc.file_name)}"`);
    return readObject(doc.storage_key, auth.companyId);
  });

  app.get('/documents', async (req) => {
    requireScope(req, 'documents', 'read');
    const auth = requireAuth(req);
    const { entity_type, entity_id } = req.query as { entity_type?: string; entity_id?: string };
    if (entity_type || entity_id) {
      if (!entity_type || !entity_id) throw new HttpError(400, 'entity_type and entity_id go together');
      const res = await pool.query(
        `SELECT d.* FROM document_link l JOIN document d ON d.id = l.document_id
          WHERE l.entity_type = $1 AND l.entity_id = $2 AND d.company_id = $3
          ORDER BY d.created_at DESC`, [entity_type, entity_id, auth.companyId],
      );
      return { documents: res.rows };
    }
    const res = await pool.query(`SELECT id, file_name, mime_type, size_bytes, status, classification, customer_visible, created_at FROM document WHERE company_id = $1 ORDER BY created_at DESC LIMIT 200`, [auth.companyId]);
    return { documents: res.rows };
  });

  app.post('/documents/:id/links', async (req, reply) => {
    requireScope(req, 'documents', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { entity_type?: string; entity_id?: string };
    if (!b.entity_type || !b.entity_id || !LINK_TYPES.has(b.entity_type)) throw new HttpError(400, 'Valid entity_type and entity_id are required');
    const doc = await pool.query(`SELECT id FROM document WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
    if (doc.rowCount === 0) throw new HttpError(404, 'Document not found');
    await pool.query(`INSERT INTO document_link (document_id, entity_type, entity_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, b.entity_type, b.entity_id]);
    await audit(req, 'update', 'document_link', id, b);
    return reply.code(201).send({ ok: true });
  });
}
